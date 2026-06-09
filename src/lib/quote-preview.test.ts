import { describe, expect, test } from "vitest";

import { buildQuotePreview } from "./quote-preview";

describe("buildQuotePreview", () => {
  test("builds browser preview rows with the same display rules as quote export", () => {
    const preview = buildQuotePreview({
      customerName: "ACME",
      currency: "USD",
      profitMargin: "0.2",
      exchangeRate: "7.2",
      items: [
        {
          productId: "product-1",
          supplierOfferId: "offer-1",
          productName: "COB 灯带",
          modelNo: "COB-120",
          factoryName: "汇孚",
          purchasePrice: "10",
          purchaseCurrency: "RMB",
          quantity: 1,
          moq: "1,000/色",
          ctnQty: "10",
          ctnLength: "52.3",
          ctnWidth: "49.5",
          ctnHeight: "27.4",
          material: "PVC",
          size: "8mm",
          productRemark: "COB light strip\n120 LEDs/m",
          remark: "客户备注",
        },
        {
          productId: "product-2",
          supplierOfferId: "offer-2",
          productName: "GU10-3.3W",
          modelNo: "GU10-3.3W",
          factoryName: "未知工厂",
          purchasePrice: "3.6",
          purchaseCurrency: "RMB",
          quantity: 1,
          moq: "MOQ",
          ctnQty: null,
          ctnLength: "27",
          ctnWidth: null,
          ctnHeight: "25",
          material: null,
          size: null,
          productRemark: "GU10-3.3W",
          remark: null,
        },
      ],
    });

    expect(preview).toMatchObject({
      customerName: "ACME",
      currency: "USD",
      profitMargin: 0.2,
      exchangeRate: 7.2,
      purchaseCurrency: "RMB",
      totalWarnings: 5,
    });
    expect(preview.rows[0]).toMatchObject({
      productId: "product-1",
      supplierOfferId: "offer-1",
      modelNo: "COB-120",
      productDetails: "COB light strip\n120 LEDs/m\nSize: 8mm",
      factoryName: "汇孚",
      purchasePrice: "10.00 RMB",
      salePrice: "1.67",
      salePriceDisplay: "1.67 USD",
      moq: "1000",
      ctnQty: "10",
      ctnL: "52.3 cm",
      ctnW: "49.5 cm",
      ctnH: "27.4 cm",
      volume: "0.071 m³",
      remark: "客户备注",
      warnings: [],
    });
    expect(preview.rows[1].warnings).toEqual([
      "Product Details 过短或重复",
      "缺 Size",
      "MOQ 可能不是数量",
      "缺 CTN Qty",
      "缺 CTN L/W/H",
    ]);
  });

  test("uses purchase currency directly when sale and purchase currency are the same", () => {
    const preview = buildQuotePreview({
      customerName: "同币种客户",
      currency: "RMB",
      profitMargin: "0",
      exchangeRate: null,
      items: [
        {
          productId: "product-1",
          supplierOfferId: "offer-1",
          productName: "A60 Bulb",
          modelNo: "A60-12W",
          factoryName: "汇孚",
          purchasePrice: "10",
          purchaseCurrency: "RMB",
          quantity: 1,
          moq: "1000",
          ctnQty: "100",
          ctnLength: "67.5",
          ctnWidth: "34",
          ctnHeight: "25.5",
          material: null,
          size: "A60*118",
          productRemark: "A60 / 12W",
          remark: null,
        },
      ],
    });

    expect(preview.exchangeRate).toBeNull();
    expect(preview.rows[0].salePriceDisplay).toBe("10.00 RMB");
  });
});
