import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { buildHejiaImportRows, buildHejiaSupplierOfferRemark } from "./hejia-import";
import { readSheetRows } from "./excel-import";

describe("buildHejiaImportRows", () => {
  test("merges multiple description columns and reports skipped non-data rows", () => {
    const rows = [
      ["Welfull quotation"],
      [],
      [],
      ["Item No.", "Power", "Voltage", "CCT", "Material", "Size", "Price(RMB)", "MOQ", "PCS/CTN", "Ctn Size(CM)", "工厂"],
      ["A60-12W", "12W", "AC220V", "3000-6500K", "Aluminum+PC", "A60*118", "1.90", "5000PCS", "100", "67.5*34*25.5", "汇孚"],
      ["A60-15W", "15W", "AC220V", "3000-6500K", "Aluminum+PC", "A70*129", "2.35", "5000PCS", "100", "72.5*36.5*27", ""],
      ["High Power Series", "", "", "", "", "", "High Power Series", "", "", "", ""],
      ["A60-18W", "18W", "AC220V", "3000-6500K", "Aluminum+PC", "A80*150", "$3.20", "5000", "50", "41.5*41.5*31", "汇孚"],
    ];

    const imported = buildHejiaImportRows({
      sourceFileId: "file-1",
      sheetName: "LED Bulb",
      headerRowIndex: 4,
      rows,
      mapping: {
        modelNoColumn: 0,
        descriptionColumns: [1, 2, 3, 4, 5],
        sizeColumn: 5,
        factoryNameColumn: 10,
        factoryPriceColumn: 6,
        moqColumn: 7,
        ctnQtyColumn: 8,
        ctnSizeColumn: 9,
        currency: "RMB",
      },
    });

    expect(imported.products).toHaveLength(3);
    expect(imported.offers).toHaveLength(3);
    expect(imported.products[0]).toMatchObject({
      modelNo: "A60-12W",
      productName: "A60-12W",
      sourceRowIndex: 4,
      remark: "Power: 12W\nVoltage: AC220V\nCCT: 3000-6500K\nMaterial: Aluminum+PC\nSize: A60*118",
    });
    expect(imported.offers[2]).toMatchObject({
      modelNo: "A60-18W",
      purchasePrice: "3.20",
      ctnQty: "50",
      ctnLength: "41.5",
      ctnWidth: "41.5",
      ctnHeight: "31",
    });
    expect(imported.skippedRows).toEqual([
      {
        rowIndex: 7,
        reason: "价格列非有效数字",
        rawData: "High Power Series |  |  |  |  |  | High Power Series |  |  |  | ",
      },
    ]);
  });

  test("dedupes products by model number while preserving multiple supplier offers", () => {
    const rows = [
      ["报价单"],
      ["型号", "描述", "尺寸", "MOQ", "CTN Qty", "Carton Size", "工厂", "单价", "客户价", "系数"],
      ["WL-001", "太阳能壁灯", "10cm", "1000", "10 pcs", "52.3×49.5×27.4 cm", "博登", "￥61", "$8.47", "7.2"],
      ["WL-001", "太阳能壁灯", "10cm", "1000", "12PCS", "54×50×28 cm", "蓝赛", "￥62", "$8.61", "7.2"],
      ["WL-002", "太阳能花园灯", "20cm", "", "8", "40×30×20 cm", "蓝赛", "21.2", "$2.94", ""],
      ["WL-003", "无价格", "", "", "", "", "蓝赛", "", "", ""],
    ];

    const imported = buildHejiaImportRows({
      sourceFileId: "file-1",
      sheetName: "Solar",
      headerRowIndex: 2,
      rows,
      mapping: {
        modelNoColumn: 0,
        descriptionColumn: 1,
        sizeColumn: 2,
        moqColumn: 3,
        ctnQtyColumn: 4,
        ctnSizeColumn: 5,
        factoryNameColumn: 6,
        factoryPriceColumn: 7,
        customerUsdPriceColumn: 8,
        coefficientColumn: 9,
        currency: "RMB",
      },
    });

    expect(imported.products).toEqual([
      {
        modelNo: "WL-001",
        productName: "太阳能壁灯",
        category: "Solar",
        size: "10cm",
        remark: "太阳能壁灯",
        sourceRowIndex: 2,
      },
      {
        modelNo: "WL-002",
        productName: "太阳能花园灯",
        category: "Solar",
        size: "20cm",
        remark: "太阳能花园灯",
        sourceRowIndex: 4,
      },
    ]);
    expect(imported.offers).toHaveLength(3);
    expect(imported.offers.map((offer) => [offer.modelNo, offer.factoryName, offer.purchasePrice])).toEqual([
      ["WL-001", "博登", "61"],
      ["WL-001", "蓝赛", "62"],
      ["WL-002", "蓝赛", "21.2"],
    ]);
    expect(imported.offers[0]).toMatchObject({
      currency: "RMB",
      moq: "1000",
      sourceFileId: "file-1",
      customerUsdPrice: "$8.47",
      coefficient: "7.2",
      ctnQty: "10",
      ctnLength: "52.3",
      ctnWidth: "49.5",
      ctnHeight: "27.4",
    });
    expect(imported.skippedRows).toEqual([{ rowIndex: 6, reason: "价格列非有效数字", rawData: "WL-003 | 无价格 |  |  |  |  | 蓝赛 |  |  | " }]);
  });

  test("prefers separately mapped carton dimensions over a combined carton size column", () => {
    const imported = buildHejiaImportRows({
      sourceFileId: "file-1",
      sheetName: "Solar",
      headerRowIndex: 1,
      rows: [
        ["型号", "工厂", "单价", "CTN Qty", "Carton Size", "L", "W", "H"],
        ["WL-001", "博登", "61", "1,000PCS", "1×2×3 cm", "60cm", "50 CM", "30厘米"],
      ],
      mapping: {
        modelNoColumn: 0,
        factoryNameColumn: 1,
        factoryPriceColumn: 2,
        ctnQtyColumn: 3,
        ctnSizeColumn: 4,
        ctnLengthColumn: 5,
        ctnWidthColumn: 6,
        ctnHeightColumn: 7,
        currency: "RMB",
      },
    });

    expect(imported.offers[0]).toMatchObject({
      ctnQty: "1000",
      ctnLength: "60",
      ctnWidth: "50",
      ctnHeight: "30",
    });
  });

  test("optionally fills down merged model cells", () => {
    const baseInput = {
      sourceFileId: "file-1",
      sheetName: "Filament",
      headerRowIndex: 1,
      rows: [
        ["Model", "Factory", "Price"],
        ["A", "德雷普", "1"],
        ["", "德雷普", "2"],
        ["", "德雷普", "3"],
        ["B", "德雷普", "4"],
        ["", "德雷普", "5"],
        ["C", "德雷普", "6"],
      ],
      mapping: {
        modelNoColumn: 0,
        factoryNameColumn: 1,
        factoryPriceColumn: 2,
        currency: "RMB",
      },
    };

    const withoutFillDown = buildHejiaImportRows(baseInput);
    const withFillDown = buildHejiaImportRows({
      ...baseInput,
      mapping: {
        ...baseInput.mapping,
        fillDownModelColumn: true,
      },
    });

    expect(withoutFillDown.offers).toHaveLength(3);
    expect(withoutFillDown.skippedRows).toHaveLength(3);
    expect(withFillDown.offers.map((offer) => offer.modelNo)).toEqual(["A", "A", "A", "B", "B", "C"]);
    expect(withFillDown.products.map((product) => product.modelNo)).toEqual(["A", "B", "C"]);
    expect(withFillDown.skippedRows).toHaveLength(0);
  });

  test("keeps legacy single description column behavior without header labels", () => {
    const imported = buildHejiaImportRows({
      sourceFileId: "file-1",
      sheetName: "Spotlight",
      headerRowIndex: 1,
      rows: [
        ["Model", "MARKS", "Factory", "Price"],
        ["WL-SL2-01", "black/white spotlight", "美莱德", "9.5"],
      ],
      mapping: {
        modelNoColumn: 0,
        descriptionColumn: 1,
        factoryNameColumn: 2,
        factoryPriceColumn: 3,
        currency: "RMB",
      },
    });

    expect(imported.products[0]).toMatchObject({
      productName: "black/white spotlight",
      remark: "black/white spotlight",
    });
  });

  test("builds supplier offer remark from optional customer USD price and coefficient", () => {
    expect(buildHejiaSupplierOfferRemark({ customerUsdPrice: "$8.47", coefficient: "7.2" })).toBe(
      "客户USD价: $8.47\n系数/汇率: 7.2",
    );
    expect(buildHejiaSupplierOfferRemark({ customerUsdPrice: null, coefficient: null })).toBeNull();
  });

  test("maps the three real hejia samples with different header rows and column positions", () => {
    const root = process.cwd();
    const cases = [
      {
        file: "核价- Quotation- LED Solar Wall Light & Garden Light - 20240521.xlsx",
        sheetName: "Led solar wall light",
        headerRowIndex: 7,
        mapping: {
          modelNoColumn: 0,
          descriptionColumn: 2,
          sizeColumn: 4,
          moqColumn: 8,
          ctnQtyColumn: 7,
          ctnSizeColumn: 9,
          ctnLengthColumn: 9,
          ctnWidthColumn: 10,
          ctnHeightColumn: 11,
          factoryNameColumn: 12,
          factoryPriceColumn: 13,
          customerUsdPriceColumn: 3,
          coefficientColumn: 14,
          currency: "RMB",
        },
      },
      {
        file: "核价 220V LED Strips - Wellux 20251125.xlsx",
        sheetName: "LED Strips",
        headerRowIndex: 6,
        mapping: {
          modelNoColumn: 1,
          descriptionColumn: 2,
          sizeColumn: 16,
          moqColumn: null,
          ctnQtyColumn: null,
          ctnSizeColumn: null,
          ctnLengthColumn: null,
          ctnWidthColumn: null,
          ctnHeightColumn: null,
          factoryNameColumn: 13,
          factoryPriceColumn: 14,
          customerUsdPriceColumn: 12,
          coefficientColumn: 15,
          currency: "RMB",
        },
      },
      {
        file: "核价Wellux Quotation of led spotlight 20240229 (1).xlsx",
        sheetName: "Sheet1",
        headerRowIndex: 5,
        mapping: {
          modelNoColumn: 1,
          descriptionColumn: 10,
          sizeColumn: 3,
          moqColumn: 6,
          ctnQtyColumn: null,
          ctnSizeColumn: null,
          ctnLengthColumn: null,
          ctnWidthColumn: null,
          ctnHeightColumn: null,
          factoryNameColumn: 11,
          factoryPriceColumn: 12,
          customerUsdPriceColumn: 8,
          coefficientColumn: null,
          currency: "RMB",
        },
      },
    ];

    const counts = cases.map((testCase) => {
      const rows = readSheetRows(join(root, "sample-data", "hejia", testCase.file), testCase.sheetName);
      return buildHejiaImportRows({
        sourceFileId: "file-1",
        sheetName: testCase.sheetName,
        headerRowIndex: testCase.headerRowIndex,
        rows,
        mapping: testCase.mapping,
      });
    });

    expect(counts.map((result) => result.products.length)).toEqual([14, 21, 6]);
    expect(counts.map((result) => result.offers.length)).toEqual([14, 23, 6]);
    expect(counts[0].offers[0]).toMatchObject({ modelNo: "WL-S3W-850", factoryName: "博登", purchasePrice: "61" });
    expect(counts[1].offers[0]).toMatchObject({
      modelNo: "LST-220V-NW-2835-120P-10",
      factoryName: "华浦 含税铜板",
      purchasePrice: "1.87",
    });
    expect(counts[2].offers[0]).toMatchObject({ modelNo: "WL-SL2-01", factoryName: "美莱德", purchasePrice: "9.5" });
    expect(counts[0].offers[0]).toMatchObject({
      ctnQty: "16",
      ctnLength: "45.5",
      ctnWidth: "38.0",
      ctnHeight: "17.0",
    });
  });
});
