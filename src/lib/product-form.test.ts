import { describe, expect, test } from "vitest";

import { parseProductForm, parseSupplierOfferForm } from "./product-form";

describe("parseProductForm", () => {
  test("requires a product name and normalizes optional empty fields to null", () => {
    const parsed = parseProductForm({
      productName: "  灯带  ",
      category: "",
      modelNo: "  COB-120 ",
      material: "",
      size: "  8mm ",
      imagePath: "",
      remark: "",
    });

    expect(parsed).toEqual({
      productName: "灯带",
      category: null,
      modelNo: "COB-120",
      material: null,
      size: "8mm",
      imagePath: null,
      remark: null,
    });

    expect(() => parseProductForm({ productName: " " })).toThrow("产品名不能为空");
  });
});

describe("parseSupplierOfferForm", () => {
  test("requires factory, positive price, and currency", () => {
    const parsed = parseSupplierOfferForm({
      productId: "product-1",
      factoryName: "  汇孚 ",
      purchasePrice: "12.50",
      currency: " RMB ",
      moq: "",
      ctnQty: " 10 ",
      ctnLength: " 52.3 ",
      ctnWidth: " 49.5 ",
      ctnHeight: " 27.4 ",
      leadTime: "  15天 ",
      sourceFileId: "",
      remark: "",
    });

    expect(parsed).toEqual({
      productId: "product-1",
      factoryName: "汇孚",
      purchasePrice: "12.50",
      currency: "RMB",
      moq: null,
      ctnQty: "10",
      ctnLength: "52.3",
      ctnWidth: "49.5",
      ctnHeight: "27.4",
      leadTime: "15天",
      sourceFileId: null,
      remark: null,
    });

    expect(() =>
      parseSupplierOfferForm({
        productId: "product-1",
        factoryName: "",
        purchasePrice: "12",
        currency: "RMB",
      }),
    ).toThrow("工厂名不能为空");

    expect(() =>
      parseSupplierOfferForm({
        productId: "product-1",
        factoryName: "汇孚",
        purchasePrice: "0",
        currency: "RMB",
      }),
    ).toThrow("采购价必须大于 0");
  });
});
