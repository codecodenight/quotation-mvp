import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import JSZip from "jszip";
import { afterEach, describe, expect, test } from "vitest";

import { writeQuoteWorkbook, type QuoteWorkbookData, type QuoteWorkbookItem } from "./quote-export";

const tempDirs: string[] = [];
const TINY_JPEG = Buffer.from(
  [
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////",
    "////////////////////////////////////////////////2wBDAf//////////////////////",
    "////////////////////////////////////////////////////////////////wAARCAABAAED",
    "ASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA",
    "/9oADAMBAAIQAxAAAAH/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAqf/xAAUEQEA",
    "AAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/ASP/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQ",
    "E/ASP/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/Al//xAAUEAEAAAAAAAAAAAAAAAAA",
    "AAAA/9oACAEBAAE/IV//2gAMAwEAAgADAAAAEP/EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAI",
    "AQMBAT8QE//EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQIBAT8QE//EABQQAQAAAAAAAAAA",
    "AAAAAAAAABD/2gAIAQEAAT8QE//Z",
  ].join(""),
  "base64",
);

const baseItem: QuoteWorkbookItem = {
  productId: "product-panel",
  supplierOfferId: "offer-panel",
  productName: "LED Slim Panel Light",
  modelNo: "PNL-36W",
  category: "面板灯",
  factoryName: "Panel Factory",
  purchasePrice: "50",
  purchaseCurrency: "RMB",
  salePrice: "8.50",
  quantity: 1,
  moq: "500",
  ctnQty: "8",
  ctnLength: "62",
  ctnWidth: "62",
  ctnHeight: "28",
  material: "PS",
  size: "600x600",
  productRemark: "LED Slim Panel Light",
  productParams: [],
  remark: null,
};

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("quote workbook product images", () => {
  test("embeds product images in templated exports through the table model", async () => {
    const dir = await makeTempDir();
    const imagePath = await makeJpeg(dir);
    const filePath = join(dir, "templated.xlsx");

    await writeQuoteWorkbook(quoteWithItems([{ ...baseItem, imagePath }]), filePath, { customerMode: true });

    const zip = await readWorkbookZip(filePath);
    expect(mediaFiles(zip)).toContain("xl/media/image1.jpeg");
    expect(await sharedStrings(zip)).toContain("Photo");
    expect(await sharedStrings(zip)).not.toContain(imagePath);
  });

  test("embeds product images in generic mixed-category exports", async () => {
    const dir = await makeTempDir();
    const imagePath = await makeJpeg(dir);
    const filePath = join(dir, "generic.xlsx");

    await writeQuoteWorkbook(
      quoteWithItems([
        { ...baseItem, imagePath },
        {
          ...baseItem,
          productId: "product-downlight",
          supplierOfferId: "offer-downlight",
          category: "筒灯",
          imagePath: null,
        },
      ]),
      filePath,
      { customerMode: true },
    );

    const zip = await readWorkbookZip(filePath);
    expect(mediaFiles(zip)).toContain("xl/media/image1.jpeg");
    expect(await sharedStrings(zip)).toContain("Photo");
    expect(await sharedStrings(zip)).not.toContain(imagePath);
  });
});

function quoteWithItems(items: QuoteWorkbookItem[]): QuoteWorkbookData {
  return {
    id: "quote-image-test",
    customerName: "ACME",
    currency: "USD",
    profitMargin: "0.2",
    exchangeRate: "7.2",
    createdAt: new Date("2026-06-05T08:00:00.000Z"),
    items,
  };
}

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "quote-images-"));
  tempDirs.push(dir);
  return dir;
}

async function makeJpeg(dir: string): Promise<string> {
  const imagePath = join(dir, "fixture-product.jpg");
  await writeFile(imagePath, TINY_JPEG);
  return imagePath;
}

async function readWorkbookZip(filePath: string): Promise<JSZip> {
  return JSZip.loadAsync(await readFile(filePath));
}

function mediaFiles(zip: JSZip): string[] {
  return Object.keys(zip.files).filter((name) => name.startsWith("xl/media/")).sort();
}

async function sharedStrings(zip: JSZip): Promise<string> {
  return (await zip.file("xl/sharedStrings.xml")?.async("string")) ?? "";
}
