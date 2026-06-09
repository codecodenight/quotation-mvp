import { existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { extractImagesFromExcel } from "./image-extractor";

const solarSamplePath = join(
  process.cwd(),
  "sample-data",
  "hejia",
  "核价- Quotation- LED Solar Wall Light & Garden Light - 20240521.xlsx",
);
const legacyXlsPath = "/Volumes/My Passport/AI 报价/发客户报价单汇总/三防灯/Waterproof Lighting Fixture - Wellux 202305.xls";
const noImageSamplePath = join(process.cwd(), "sample-data", "test-multi-column.xlsx");

describe.runIf(existsSync(solarSamplePath))("extractImagesFromExcel", () => {
  test("extracts xlsx images with selected sheet row anchors", async () => {
    const images = await extractImagesFromExcel(solarSamplePath, "Led solar wall light");

    expect(images.length).toBeGreaterThan(0);
    expect(images.every((image) => image.sheetName === "Led solar wall light")).toBe(true);
    expect(images.some((image) => image.anchorRow >= 7)).toBe(true);
    expect(images[0]).toMatchObject({
      sheetName: "Led solar wall light",
      anchorRow: expect.any(Number),
      anchorCol: expect.any(Number),
      mediaName: expect.stringMatching(/^xl\/media\//),
      mimeType: expect.stringMatching(/^image\//),
    });
    expect(images[0].imageBuffer.length).toBeGreaterThan(0);
  });
});

describe.runIf(existsSync(noImageSamplePath))("extractImagesFromExcel without images", () => {
  test("returns an empty list for xlsx files without embedded media", async () => {
    const images = await extractImagesFromExcel(noImageSamplePath);

    expect(images).toEqual([]);
  });
});

describe.skipIf(process.env.RUN_XLS_IMAGE_TEST !== "1" || !existsSync(legacyXlsPath))(
  "extractImagesFromExcel xls conversion",
  () => {
    test(
      "extracts images from legacy xls through temporary LibreOffice conversion",
      async () => {
        const images = await extractImagesFromExcel(legacyXlsPath, "WP-G");

        expect(images.length).toBeGreaterThan(0);
        expect(images.every((image) => image.sheetName === "WP-G")).toBe(true);
        expect(images[0].imageBuffer.length).toBeGreaterThan(0);
      },
      150_000,
    );
  },
);
