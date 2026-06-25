import { describe, expect, it } from "vitest";

import {
  buildChatQuoteFormData,
  clampToolLimit,
  formatCartonDimensions,
  isWattageOnlyModel,
  normalizeToolText,
  parseToolNumber,
  selectRecommendedChatOffer,
  serializeChatProductOffer,
  toDisplayParams,
  type ChatQuoteDraftInput,
} from "./chat-tools";

describe("chat tool helpers", () => {
  it("clamps tool limits to a safe range", () => {
    expect(clampToolLimit(undefined, 10, 20)).toBe(10);
    expect(clampToolLimit(0, 10, 20)).toBe(10);
    expect(clampToolLimit(8, 10, 20)).toBe(8);
    expect(clampToolLimit(99, 10, 20)).toBe(20);
  });

  it("parses numeric tool args defensively", () => {
    expect(parseToolNumber("36W")).toBe(36);
    expect(parseToolNumber("1,234.5")).toBe(1234.5);
    expect(parseToolNumber("abc")).toBeNull();
    expect(parseToolNumber(null)).toBeNull();
  });

  it("normalizes text without collapsing intentional filename spacing", () => {
    expect(normalizeToolText("  面板灯 36W  ")).toBe("面板灯 36W");
    expect(normalizeToolText(null)).toBe("");
  });

  it("formats carton dimensions only when all dimensions exist", () => {
    expect(formatCartonDimensions("46", "42.5", "33.5")).toBe("46×42.5×33.5");
    expect(formatCartonDimensions("46", null, "33.5")).toBeNull();
  });

  it("detects pure wattage models", () => {
    expect(isWattageOnlyModel("10W")).toBe(true);
    expect(isWattageOnlyModel("36w")).toBe(true);
    expect(isWattageOnlyModel("0.5W")).toBe(true);
    expect(isWattageOnlyModel("100W")).toBe(true);
    expect(isWattageOnlyModel(null)).toBe(true);
  });

  it("passes real model numbers", () => {
    expect(isWattageOnlyModel("JJL-T5210")).toBe(false);
    expect(isWattageOnlyModel("YB05-120-圆形")).toBe(false);
    expect(isWattageOnlyModel("W-JD01-10")).toBe(false);
    expect(isWattageOnlyModel("ON-SPDS10")).toBe(false);
    expect(isWattageOnlyModel("3W筒灯")).toBe(false);
  });

  it("converts params to compact display rows", () => {
    expect(
      toDisplayParams([
        { paramKey: "watts", rawValue: "36W", normalizedValue: "36", unit: "W", confidence: "high" },
        { paramKey: "unknown", rawValue: "x", normalizedValue: null, unit: null, confidence: "low" },
      ]),
    ).toEqual([
      { key: "watts", value: "36", unit: "W" },
      { key: "unknown", value: "x", unit: null },
    ]);
  });

  it("includes source file details in chat product offers", () => {
    expect(
      serializeChatProductOffer({
        id: "offer-1",
        factoryName: "Factory A",
        purchasePrice: { toString: () => "12.50" },
        currency: "RMB",
        moq: "100",
        priceFlag: "suspicious_low",
        sourceFileId: "file-1",
        sourceFile: { id: "file-1", fileName: "factory-a.xlsx" },
      }),
    ).toEqual({
      id: "offer-1",
      factory_name: "Factory A",
      purchase_price: "12.50",
      currency: "RMB",
      moq: "100",
      price_flag: "suspicious_low",
      source_file_id: "file-1",
      source_file_name: "factory-a.xlsx",
    });
  });

  it("prefers unflagged recommended offers over flagged low prices", () => {
    const offers = [
      {
        id: "flagged-cheap",
        factoryName: "Factory A",
        purchasePrice: { toString: () => "0.10" },
        currency: "RMB",
        moq: null,
        ctnQty: null,
        ctnLength: null,
        ctnWidth: null,
        ctnHeight: null,
        priceUpdatedAt: null,
        remark: null,
        sourceFileId: null,
        sourceFile: null,
        priceFlag: "suspicious_low",
      },
      {
        id: "normal",
        factoryName: "Factory B",
        purchasePrice: { toString: () => "12.50" },
        currency: "RMB",
        moq: "100",
        ctnQty: "20",
        ctnLength: "40",
        ctnWidth: "30",
        ctnHeight: "20",
        priceUpdatedAt: new Date(),
        remark: "ok",
        sourceFileId: null,
        sourceFile: null,
        priceFlag: null,
      },
    ];

    expect(selectRecommendedChatOffer(offers)?.id).toBe("normal");
  });

  it("builds quote FormData compatible with the existing quote action", () => {
    const draft: ChatQuoteDraftInput = {
      customerName: "Test Customer",
      profitMargin: "0.2",
      currency: "USD",
      exchangeRate: "7.2",
      customerMode: true,
      items: [
        {
          productId: "product-1",
          offerId: "offer-1",
          quantity: 2,
          remark: "sample",
        },
      ],
    };

    const formData = buildChatQuoteFormData(draft);
    expect(formData.get("customerName")).toBe("Test Customer");
    expect(formData.get("profitMargin")).toBe("0.2");
    expect(formData.get("currency")).toBe("USD");
    expect(formData.get("exchangeRate")).toBe("7.2");
    expect(formData.get("customerMode")).toBe("on");
    expect(formData.getAll("productIds")).toEqual(["product-1"]);
    expect(formData.get("supplierOfferId:product-1")).toBe("offer-1");
    expect(formData.get("quantity:product-1")).toBe("2");
    expect(formData.get("remark:product-1")).toBe("sample");
  });

  it("defaults chat quote FormData to customer mode when omitted", () => {
    const draft = {
      customerName: "Test Customer",
      profitMargin: "0.2",
      currency: "USD",
      exchangeRate: "7.2",
      items: [
        {
          productId: "product-1",
          offerId: "offer-1",
          quantity: 2,
          remark: "sample",
        },
      ],
    } as ChatQuoteDraftInput;

    expect(buildChatQuoteFormData(draft).get("customerMode")).toBe("on");
  });
});
