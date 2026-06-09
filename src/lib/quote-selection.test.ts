import { describe, expect, test } from "vitest";

import {
  allSelectedOffersUseCurrency,
  buildReusableQuoteDraft,
  buildQuoteFormData,
  createDefaultQuoteDraft,
  createSelectedQuoteItem,
} from "./quote-selection";

const solarProduct = {
  id: "product-solar",
  productName: "Solar Flood Light",
  modelNo: "SL-100",
  material: null,
  size: null,
  remark: null,
  supplierOffers: [
    {
      id: "offer-solar",
      factoryName: "太阳能工厂",
      purchasePrice: "13.34",
      currency: "RMB",
      moq: "100/色",
      ctnQty: "10",
      ctnLength: "52",
      ctnWidth: "49",
      ctnHeight: "27",
    },
  ],
};

const triProofProduct = {
  id: "product-triproof",
  productName: "Tri-proof Light",
  modelNo: "WP-B-112",
  material: null,
  size: null,
  remark: null,
  supplierOffers: [
    {
      id: "offer-triproof",
      factoryName: "三防灯工厂",
      purchasePrice: "18.8",
      currency: "RMB",
      moq: null,
      ctnQty: null,
      ctnLength: null,
      ctnWidth: null,
      ctnHeight: null,
    },
  ],
};

describe("quote selection helpers", () => {
  test("builds the existing quote FormData contract from cross-search selected items", () => {
    const selectedItems = new Map([
      [
        solarProduct.id,
        {
          ...createSelectedQuoteItem(solarProduct),
          quantity: "2",
          remark: "太阳能备注",
        },
      ],
      [triProofProduct.id, createSelectedQuoteItem(triProofProduct)],
    ]);

    const formData = buildQuoteFormData({
      customerName: "南美客户",
      profitMargin: "0.2",
      currency: "USD",
      exchangeRate: "7.2",
      customerMode: true,
      selectedItems,
    });

    expect(formData.getAll("productIds")).toEqual(["product-solar", "product-triproof"]);
    expect(formData.get("supplierOfferId:product-solar")).toBe("offer-solar");
    expect(formData.get("quantity:product-solar")).toBe("2");
    expect(formData.get("remark:product-solar")).toBe("太阳能备注");
    expect(formData.get("supplierOfferId:product-triproof")).toBe("offer-triproof");
    expect(formData.get("quantity:product-triproof")).toBe("1");
    expect(formData.get("customerMode")).toBe("on");
  });

  test("detects same-currency selections for the exchange-rate UI", () => {
    const selectedItems = new Map([
      [solarProduct.id, createSelectedQuoteItem(solarProduct)],
      [triProofProduct.id, createSelectedQuoteItem(triProofProduct)],
    ]);

    expect(allSelectedOffersUseCurrency(selectedItems, "RMB")).toBe(true);
    expect(allSelectedOffersUseCurrency(selectedItems, "USD")).toBe(false);
    expect(allSelectedOffersUseCurrency(new Map(), "RMB")).toBe(false);
  });

  test("creates a clean new-quote draft after successful export or manual reset", () => {
    const draft = createDefaultQuoteDraft();

    expect(draft.selectedItems.size).toBe(0);
    expect(draft.customerName).toBe("");
    expect(draft.profitMargin).toBe("0.2");
    expect(draft.currency).toBe("USD");
    expect(draft.exchangeRate).toBe("7.2");
    expect(draft.lastEditableExchangeRate).toBe("7.2");
    expect(draft.customerMode).toBe(true);
  });

  test("reuses a quote with current supplier offers and copied quote parameters", () => {
    const result = buildReusableQuoteDraft({
      quote: {
        customerName: "老客户",
        profitMargin: 0.25,
        currency: "USD",
        exchangeRate: 7.15,
      },
      currentProducts: [solarProduct, triProofProduct],
      items: [
        {
          productId: solarProduct.id,
          productName: solarProduct.productName,
          modelNo: solarProduct.modelNo,
          supplierOfferId: "offer-solar",
          quantity: 6,
          remark: "沿用备注",
        },
        {
          productId: triProofProduct.id,
          productName: triProofProduct.productName,
          modelNo: triProofProduct.modelNo,
          supplierOfferId: "old-offer",
          quantity: 2,
          remark: null,
        },
      ],
    });

    expect(result.selectedItems.size).toBe(2);
    expect(result.customerName).toBe("老客户");
    expect(result.profitMargin).toBe("0.25");
    expect(result.currency).toBe("USD");
    expect(result.exchangeRate).toBe("7.15");
    expect(result.selectedItems.get(solarProduct.id)?.selectedOfferId).toBe("offer-solar");
    expect(result.selectedItems.get(solarProduct.id)?.quantity).toBe("6");
    expect(result.selectedItems.get(solarProduct.id)?.remark).toBe("沿用备注");
    expect(result.selectedItems.get(triProofProduct.id)?.selectedOfferId).toBe("offer-triproof");
    expect(result.warnings).toEqual([
      "Tri-proof Light：原供应商报价已变更，已改用当前第一条报价。",
    ]);
    expect(result.skippedItems).toEqual([]);
  });

  test("skips reused quote items that no longer match a current product or usable offer", () => {
    const result = buildReusableQuoteDraft({
      quote: {
        customerName: "老客户",
        profitMargin: 0.2,
        currency: "USD",
        exchangeRate: null,
      },
      currentProducts: [{ ...solarProduct, supplierOffers: [] }],
      items: [
        {
          productId: solarProduct.id,
          productName: solarProduct.productName,
          modelNo: solarProduct.modelNo,
          supplierOfferId: "offer-solar",
          quantity: 1,
          remark: null,
        },
        {
          productId: "missing-product",
          productName: "Missing Light",
          modelNo: "MISSING-1",
          supplierOfferId: "missing-offer",
          quantity: 1,
          remark: null,
        },
      ],
    });

    expect(result.selectedItems.size).toBe(0);
    expect(result.exchangeRate).toBe("");
    expect(result.skippedItems).toEqual([
      { label: "Solar Flood Light", reason: "当前产品没有可用供应商报价，已跳过。" },
      { label: "Missing Light", reason: "产品已不在库中，已跳过。" },
    ]);
  });
});
