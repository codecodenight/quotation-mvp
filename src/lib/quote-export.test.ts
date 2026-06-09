import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import ExcelJS from "exceljs";
import { describe, expect, test } from "vitest";

import { calculateSalePrice, writeQuoteWorkbook } from "./quote-export";

const quote = {
  id: "quote-1",
  customerName: "ACME",
  currency: "USD",
  profitMargin: "0.2",
  exchangeRate: "7.2",
  createdAt: new Date("2026-06-05T08:00:00.000Z"),
  items: [
    {
      productName: "COB 灯带",
      modelNo: "COB-120",
      factoryName: "汇孚",
      purchasePrice: "10",
      purchaseCurrency: "RMB",
      salePrice: "1.67",
      quantity: 1,
      moq: "1000/色",
      ctnQty: "10",
      ctnLength: "52.3",
      ctnWidth: "49.5",
      ctnHeight: "27.4",
      material: "PVC",
      size: "8mm",
      productRemark: "COB light strip\n120 LEDs/m",
      remark: "客户备注",
    },
  ],
};

describe("calculateSalePrice", () => {
  test("divides by exchange rate when purchase and sale currency differ", () => {
    expect(
      calculateSalePrice({
        purchasePrice: "10",
        purchaseCurrency: "RMB",
        saleCurrency: "USD",
        exchangeRate: "7.2",
        profitMargin: "0.2",
      }),
    ).toBe("1.67");

    expect(
      calculateSalePrice({
        purchasePrice: "10",
        purchaseCurrency: "USD",
        saleCurrency: "USD",
        exchangeRate: "7.2",
        profitMargin: "0.2",
      }),
    ).toBe("12.00");
  });

  test("rejects missing exchange rate for cross-currency quotes", () => {
    expect(() =>
      calculateSalePrice({
        purchasePrice: "10",
        purchaseCurrency: "RMB",
        saleCurrency: "USD",
        exchangeRate: null,
        profitMargin: "0.2",
      }),
    ).toThrow("汇率不能为空");
  });
});

describe("writeQuoteWorkbook", () => {
  test("writes the internal mode workbook with factory and purchase columns", async () => {
    const dir = await mkdtemp(join(tmpdir(), "quote-export-"));
    const filePath = join(dir, "quote.xlsx");

    try {
      await writeQuoteWorkbook(quote, filePath, { customerMode: false });

      const bytes = await readFile(filePath);
      expect(bytes.length).toBeGreaterThan(0);

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(filePath);
      const sheet = workbook.getWorksheet("报价单");

      expect(sheet).toBeDefined();
      expect(sheet?.getCell("A1").value).toBe("报价单");
      expect(sheet?.getCell("A3").value).toBe("客户");
      expect(sheet?.getCell("B3").value).toBe("ACME");
      expect(sheet?.getCell("A6").value).toBe("Model Name");
      expect(sheet?.getCell("A8").value).toBe("COB-120");
      expect(sheet?.getCell("D4").value).toBe("汇率（1 USD = ? RMB）");
      expect(sheet?.getRow(6).values).toEqual([
        undefined,
        "Model Name",
        "Product Details",
        "Factory Name",
        "Purchase Price",
        "Unit Price (USD)",
        "MOQ",
        "CTN Qty",
        "Carton Size",
        "Carton Size",
        "Carton Size",
        "Carton Size",
        "Remark",
      ]);
      expect(sheet?.getRow(7).values).toEqual([
        undefined,
        "Model Name",
        "Product Details",
        "Factory Name",
        "Purchase Price",
        "Unit Price (USD)",
        "MOQ",
        "CTN Qty",
        "L",
        "W",
        "H",
        "Volume",
        "Remark",
      ]);
      expect(sheet?.getCell("E8").value).toBe(1.67);
      expect(sheet?.getCell("F8").value).toBe("1000");
      expect(sheet?.getCell("H8").value).toBe("52.3 cm");
      expect(sheet?.getCell("I8").value).toBe("49.5 cm");
      expect(sheet?.getCell("J8").value).toBe("27.4 cm");
      expect(sheet?.getCell("K8").value).toBe("0.071 m³");
      expect(sheet?.autoFilter).toEqual("A7:L7");
      expect(sheet?.views[0]).toMatchObject({ state: "frozen", ySplit: 7, topLeftCell: "A8" });
      expect(sheet?.getColumn(1).width).toBeGreaterThanOrEqual(18);
      expect(sheet?.getColumn(2).width).toBe(48);
      expect(sheet?.getCell("B8").value).toBe("COB light strip\n120 LEDs/m\nSize: 8mm");
      expect(sheet?.getCell("A6").border?.bottom?.style).toBe("thin");
      expect(sheet?.getCell("A6").fill).toMatchObject({
        fgColor: { argb: "FF3F4A35" },
      });
      expect(sheet?.getCell("H7").fill).toMatchObject({
        fgColor: { argb: "FF6B7A5A" },
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("omits factory and purchase price columns in customer mode", async () => {
    const dir = await mkdtemp(join(tmpdir(), "quote-export-"));
    const filePath = join(dir, "quote-customer.xlsx");

    try {
      await writeQuoteWorkbook(quote, filePath, { customerMode: true });

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(filePath);
      const sheet = workbook.getWorksheet("报价单");

      expect(sheet?.getRow(6).values).toEqual([
        undefined,
        "Model Name",
        "Product Details",
        "Unit Price (USD)",
        "MOQ",
        "CTN Qty",
        "Carton Size",
        "Carton Size",
        "Carton Size",
        "Carton Size",
        "Remark",
      ]);
      expect(sheet?.getRow(7).values).toEqual([
        undefined,
        "Model Name",
        "Product Details",
        "Unit Price (USD)",
        "MOQ",
        "CTN Qty",
        "L",
        "W",
        "H",
        "Volume",
        "Remark",
      ]);
      expect(sheet?.getRow(6).values).not.toContain("Factory Name");
      expect(sheet?.getRow(6).values).not.toContain("Purchase Price");
      expect(sheet?.getCell("A8").value).toBe("COB-120");
      expect(sheet?.getCell("B8").value).toBe("COB light strip\n120 LEDs/m\nSize: 8mm");
      expect(sheet?.getCell("C8").value).toBe(1.67);
      expect(sheet?.getCell("D8").value).toBe("1000");
      expect(sheet?.getCell("E8").value).toBe("10");
      expect(sheet?.getCell("F8").value).toBe("52.3 cm");
      expect(sheet?.getCell("G8").value).toBe("49.5 cm");
      expect(sheet?.getCell("H8").value).toBe("27.4 cm");
      expect(sheet?.getCell("I8").value).toBe("0.071 m³");
      expect(sheet?.autoFilter).toEqual("A7:J7");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("cleans invalid MOQ text and removes duplicated model prefix from product details", async () => {
    const dir = await mkdtemp(join(tmpdir(), "quote-export-"));
    const filePath = join(dir, "quote-clean-details.xlsx");
    const quoteWithDirtyText = {
      ...quote,
      items: [
        {
          ...quote.items[0],
          productName: "GU10-3.3W",
          modelNo: "GU10-3.3W",
          moq: "MOQ",
          productRemark: "GU10-3.3W / 3.3W / GU10",
          size: "Φ50*55",
        },
        {
          ...quote.items[0],
          productName: "Package only",
          modelNo: "PKG-1",
          moq: "Package",
          productRemark: "PKG-1",
          size: null,
        },
      ],
    };

    try {
      await writeQuoteWorkbook(quoteWithDirtyText, filePath, { customerMode: true });

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(filePath);
      const sheet = workbook.getWorksheet("报价单");

      expect(sheet?.getCell("B8").value).toBe("3.3W / GU10\nSize: Φ50*55");
      expect(sheet?.getCell("D8").value).toBe("");
      expect(sheet?.getCell("B9").value).toBe("Package only");
      expect(sheet?.getCell("D9").value).toBe("");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
