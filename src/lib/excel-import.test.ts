import { describe, expect, test } from "vitest";
import { join } from "node:path";

import { buildRawProductRows, parseMultiPrice, parsePriceValue, readWorkbookPreview } from "./excel-import";

describe("parsePriceValue", () => {
  test("parses common RMB/USD formatted prices and leaves blanks as null", () => {
    expect(parsePriceValue("￥43.60")).toBe("43.60");
    expect(parsePriceValue("$0.33")).toBe("0.33");
    expect(parsePriceValue("1,234.50")).toBe("1234.50");
    expect(parsePriceValue("  $ 3.20 USD ")).toBe("3.20");
    expect(parsePriceValue("￥23.30元")).toBe("23.30");
    expect(parsePriceValue("0")).toBeNull();
    expect(parsePriceValue("/")).toBeNull();
    expect(parsePriceValue("待报价")).toBeNull();
  });

  test("prefers the first number after an RMB symbol when spec numbers appear before price", () => {
    expect(parsePriceValue("15000MA ¥282.5")).toBe("282.5");
    expect(parsePriceValue("10000MA ¥240.0 15000MA ¥246.0")).toBe("240.0");
    expect(parsePriceValue("5米灯带 ¥34.0 10米灯带 ¥45.0")).toBe("34.0");
    expect(parsePriceValue("10米灯带 ¥59.0 15米灯带 ¥70.0")).toBe("59.0");
    expect(parsePriceValue("￥128.5")).toBe("128.5");
    expect(parsePriceValue("26.5")).toBe("26.5");
    expect(parsePriceValue("$3.50")).toBe("3.50");
    expect(parsePriceValue("含税价 18.32")).toBe("18.32");
  });
});

describe("parseMultiPrice", () => {
  test("parses multi-price variant cells with two or more variant-price pairs", () => {
    expect(parseMultiPrice("3CCT:9 12CCT:10.5")).toEqual([
      { variant: "3CCT", price: "9" },
      { variant: "12CCT", price: "10.5" },
    ]);
    expect(parseMultiPrice("3CCT:9; 12CCT:10.5, RGBCCT:15")).toEqual([
      { variant: "3CCT", price: "9" },
      { variant: "12CCT", price: "10.5" },
      { variant: "RGBCCT", price: "15" },
    ]);
  });

  test("returns null for single-price, blank, and non-price cells", () => {
    expect(parseMultiPrice("3CCT:9")).toBeNull();
    expect(parseMultiPrice("¥9.5")).toBeNull();
    expect(parseMultiPrice("")).toBeNull();
    expect(parseMultiPrice(null)).toBeNull();
    expect(parseMultiPrice("/")).toBeNull();
    expect(parseMultiPrice("待报价")).toBeNull();
  });
});

describe("readWorkbookPreview", () => {
  test("reads real .xlsx and .xls supplier samples with SheetJS", () => {
    const root = process.cwd();
    const xlsxPreview = readWorkbookPreview(join(root, "sample data", "2024 KEBON Suit quotation.xlsx"));
    const xlsPreview = readWorkbookPreview(join(root, "sample data", "5-COBT-3月11日报价单-2025.xls"));

    expect(xlsxPreview.sheetNames.length).toBeGreaterThan(0);
    expect(xlsxPreview.rows.length).toBeGreaterThan(0);
    expect(xlsPreview.sheetNames.length).toBeGreaterThan(0);
    expect(xlsPreview.rows.length).toBeGreaterThan(0);
  });
});

describe("buildRawProductRows", () => {
  test("maps required and optional columns into raw_products rows with full raw JSON", () => {
    const rows = [
      ["报价单"],
      ["序号", "型号", "参数", "单价", "MOQ", "材质", "尺寸"],
      ["1", "RD-001", "尺寸: 3M 材质: PVC", "￥12.50", "1000/色", "PVC", "3M"],
      ["2", "RD-002", "尺寸: 5M", "", "", "", "5M"],
      ["", "", "", "", "", "", ""],
    ];

    const mapped = buildRawProductRows({
      sourceFileId: "file-1",
      sheetName: "灯带",
      headerRowIndex: 2,
      rows,
      mapping: {
        identifierColumn: 1,
        identifierTarget: "rawModelNo",
        priceColumn: 3,
        currency: "RMB",
        moqColumn: 4,
        materialColumn: 5,
        sizeColumn: 6,
        descriptionColumn: 2,
      },
    });

    expect(mapped).toHaveLength(2);
    expect(mapped[0]).toMatchObject({
      sourceFileId: "file-1",
      rawProductName: null,
      rawModelNo: "RD-001",
      rawPrice: "12.50",
      rawCurrency: "RMB",
      rawMoq: "1000/色",
      rawMaterial: "PVC",
      rawSize: "3M",
      rawDescription: "尺寸: 3M 材质: PVC",
      sourceSheetName: "灯带",
      headerRowIndex: 2,
    });
    expect(mapped[1]).toMatchObject({
      rawModelNo: "RD-002",
      rawPrice: null,
      rawMoq: null,
      rawMaterial: null,
      rawSize: "5M",
    });
    expect(mapped[0].rawRowData).toEqual({
      rowNumber: 3,
      cells: [
        { columnIndex: 0, columnLabel: "A", header: "序号", value: "1" },
        { columnIndex: 1, columnLabel: "B", header: "型号", value: "RD-001" },
        { columnIndex: 2, columnLabel: "C", header: "参数", value: "尺寸: 3M 材质: PVC" },
        { columnIndex: 3, columnLabel: "D", header: "单价", value: "￥12.50" },
        { columnIndex: 4, columnLabel: "E", header: "MOQ", value: "1000/色" },
        { columnIndex: 5, columnLabel: "F", header: "材质", value: "PVC" },
        { columnIndex: 6, columnLabel: "G", header: "尺寸", value: "3M" },
      ],
    });
  });

  test("requires identifier column, price column, and currency", () => {
    expect(() =>
      buildRawProductRows({
        sourceFileId: "file-1",
        sheetName: "Sheet1",
        headerRowIndex: 1,
        rows: [["型号", "价格"], ["A", "1"]],
        mapping: { identifierColumn: null, identifierTarget: "rawProductName", priceColumn: 1, currency: "RMB" },
      }),
    ).toThrow("产品标识列不能为空");

    expect(() =>
      buildRawProductRows({
        sourceFileId: "file-1",
        sheetName: "Sheet1",
        headerRowIndex: 1,
        rows: [["型号", "价格"], ["A", "1"]],
        mapping: { identifierColumn: 0, identifierTarget: "rawProductName", priceColumn: 1, currency: "" },
      }),
    ).toThrow("币种不能为空");
  });
});
