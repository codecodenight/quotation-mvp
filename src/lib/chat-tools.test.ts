import { describe, expect, it } from "vitest";

import {
  buildChatQuoteFormData,
  clampToolLimit,
  formatCartonDimensions,
  normalizeToolText,
  parseToolNumber,
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
});
