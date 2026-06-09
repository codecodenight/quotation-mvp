import { describe, expect, test } from "vitest";

import { buildSupplierOfferFromRaw, parseTriageProductForm } from "./raw-product-triage";

const rawProduct = {
  id: "raw-1",
  sourceFileId: "file-1",
  factoryName: "汇孚",
  rawPrice: { toString: () => "12.50" },
  rawCurrency: "RMB",
  rawMoq: "1000/色",
};

describe("parseTriageProductForm", () => {
  test("normalizes manual product fields and requires product name", () => {
    expect(
      parseTriageProductForm({
        productName: "  COB 灯带 ",
        category: "",
        modelNo: " COB-120 ",
        material: "",
        size: " 8mm ",
        imagePath: "",
        remark: "",
      }),
    ).toEqual({
      productName: "COB 灯带",
      category: null,
      modelNo: "COB-120",
      material: null,
      size: "8mm",
      imagePath: null,
      remark: null,
    });

    expect(() => parseTriageProductForm({ productName: "" })).toThrow("产品名不能为空");
  });
});

describe("buildSupplierOfferFromRaw", () => {
  test("uses raw price, currency, factory, and source file with optional manual MOQ override", () => {
    expect(buildSupplierOfferFromRaw(rawProduct, "product-1", "2000/款")).toEqual({
      productId: "product-1",
      factoryName: "汇孚",
      purchasePrice: "12.50",
      currency: "RMB",
      moq: "2000/款",
      leadTime: null,
      sourceFileId: "file-1",
      remark: null,
    });

    expect(buildSupplierOfferFromRaw(rawProduct, "product-1", "")).toMatchObject({
      moq: "1000/色",
    });
  });

  test("rejects raw rows missing price, currency, or factory", () => {
    expect(() =>
      buildSupplierOfferFromRaw({ ...rawProduct, rawPrice: null }, "product-1", null),
    ).toThrow("raw_price 为空");
    expect(() =>
      buildSupplierOfferFromRaw({ ...rawProduct, rawCurrency: null }, "product-1", null),
    ).toThrow("raw_currency 为空");
    expect(() =>
      buildSupplierOfferFromRaw({ ...rawProduct, factoryName: null }, "product-1", null),
    ).toThrow("factory_name 为空");
  });
});
