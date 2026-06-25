import { describe, expect, it } from "vitest";

import {
  buildChatQuoteFormData,
  clampToolLimit,
  compactForLLM,
  expandHistoryMessages,
  formatCartonDimensions,
  isWattageOnlyModel,
  normalizeToolText,
  parseToolNumber,
  selectRecommendedChatOffer,
  serializeChatProductOffer,
  toDisplayParams,
  type ChatQuoteDraftInput,
  type ChatMessageInput,
  type ProductOffersResult,
  type SearchProductsResult,
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

  it("compacts search product results to the fields needed by the LLM", () => {
    const result: SearchProductsResult = {
      total: 1,
      products: [
        {
          id: "product-1",
          model_no: "DL-10W",
          product_name: "10W Downlight",
          category: "筒灯",
          image_path: "/images/product-1.jpg",
          offer_count: 2,
          recommended_offer: {
            id: "offer-1",
            factory_name: "Factory A",
            purchase_price: "12.50",
            currency: "RMB",
            moq: "100",
            price_flag: null,
            source_file_id: "file-1",
            source_file_name: "factory-a.xlsx",
          },
          params: [{ key: "watts", value: "10", unit: "W" }],
        },
      ],
    };

    expect(compactForLLM("search_products", result)).toEqual({
      total: 1,
      products: [
        {
          id: "product-1",
          model_no: "DL-10W",
          product_name: "10W Downlight",
          category: "筒灯",
          offer_count: 2,
          recommended_offer: {
            id: "offer-1",
            factory_name: "Factory A",
            purchase_price: "12.50",
            currency: "RMB",
            moq: "100",
            price_flag: null,
          },
          params: [{ key: "watts", value: "10", unit: "W" }],
        },
      ],
    });
  });

  it("removes image paths from compact search product results", () => {
    const result: SearchProductsResult = {
      total: 1,
      products: [
        {
          id: "product-1",
          model_no: "DL-10W",
          product_name: "10W Downlight",
          category: "筒灯",
          image_path: "/images/product-1.jpg",
          offer_count: 1,
          recommended_offer: null,
          params: [],
        },
      ],
    };

    expect(JSON.stringify(compactForLLM("search_products", result))).not.toContain("image_path");
  });

  it("limits compact product offers to the first five offers", () => {
    const result = buildProductOffersResult(8);
    const compacted = compactForLLM("get_product_offers", result) as ProductOffersResult;

    expect(compacted.offers.map((offer) => offer.id)).toEqual([
      "offer-1",
      "offer-2",
      "offer-3",
      "offer-4",
      "offer-5",
    ]);
  });

  it("removes logistics and UI-only fields from compact product offers", () => {
    const result = buildProductOffersResult(1);
    const compactedJson = JSON.stringify(compactForLLM("get_product_offers", result));

    expect(compactedJson).not.toContain("ctn_dimensions");
    expect(compactedJson).not.toContain("lead_time");
    expect(compactedJson).not.toContain("badges");
    expect(compactedJson).not.toContain("price_updated_at");
    expect(compactedJson).not.toContain("source_file_id");
    expect(compactedJson).not.toContain("source_file_name");
  });

  it("leaves compact factory comparison results unchanged", () => {
    const result = {
      category: "筒灯",
      comparison: [{ factory_name: "Factory A", product_count: 3 }],
    };

    expect(compactForLLM("compare_factories", result)).toBe(result);
  });

  it("leaves compact customer history results unchanged", () => {
    const result = {
      total: 1,
      rows: [{ raw_model: "DL-10W", sale_price_usd: 2.5 }],
    };

    expect(compactForLLM("search_customer_history", result)).toBe(result);
  });

  it("expands user history messages to OpenAI user messages", () => {
    expect(expandHistoryMessages([{ role: "user", text: "面板灯 36W" }])).toEqual([
      { role: "user", content: "面板灯 36W" },
    ]);
  });

  it("expands assistant history without tool calls to a text message", () => {
    expect(expandHistoryMessages([{ role: "assistant", text: "找到 5 款面板灯" }])).toEqual([
      { role: "assistant", content: "找到 5 款面板灯" },
    ]);
  });

  it("expands assistant history with tool calls and compact tool results", () => {
    const history: ChatMessageInput[] = [
      {
        role: "assistant",
        text: "找到 5 款面板灯",
        toolCalls: [
          {
            id: "tc_1",
            name: "search_products",
            arguments: '{"query":"面板灯","min_watts":36,"max_watts":36}',
            result: '{"total":5,"products":[]}',
          },
        ],
      },
    ];

    expect(expandHistoryMessages(history)).toEqual([
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "tc_1",
            type: "function",
            function: {
              name: "search_products",
              arguments: '{"query":"面板灯","min_watts":36,"max_watts":36}',
            },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: "tc_1",
        content: '{"total":5,"products":[]}',
      },
      { role: "assistant", content: "找到 5 款面板灯" },
    ]);
  });

  it("expands mixed history messages in order", () => {
    const history: ChatMessageInput[] = [
      { role: "user", text: "面板灯 36W" },
      {
        role: "assistant",
        text: "找到 5 款面板灯",
        toolCalls: [
          {
            id: "tc_1",
            name: "search_products",
            arguments: '{"query":"面板灯","min_watts":36,"max_watts":36}',
            result: '{"total":5,"products":[]}',
          },
        ],
      },
      { role: "user", text: "最便宜的是哪个" },
    ];

    expect(expandHistoryMessages(history)).toEqual([
      { role: "user", content: "面板灯 36W" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "tc_1",
            type: "function",
            function: {
              name: "search_products",
              arguments: '{"query":"面板灯","min_watts":36,"max_watts":36}',
            },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: "tc_1",
        content: '{"total":5,"products":[]}',
      },
      { role: "assistant", content: "找到 5 款面板灯" },
      { role: "user", content: "最便宜的是哪个" },
    ]);
  });
});

function buildProductOffersResult(offerCount: number): ProductOffersResult {
  return {
    product_id: "product-1",
    product_name: "10W Downlight",
    model_no: "DL-10W",
    category: "筒灯",
    image_path: "/images/product-1.jpg",
    offers: Array.from({ length: offerCount }, (_, index) => ({
      id: `offer-${index + 1}`,
      factory_name: `Factory ${index + 1}`,
      purchase_price: String(10 + index),
      currency: "RMB",
      moq: "100",
      price_flag: null,
      source_file_id: `file-${index + 1}`,
      source_file_name: `factory-${index + 1}.xlsx`,
      ctn_qty: "20",
      ctn_dimensions: "40×30×20",
      lead_time: "15 days",
      price_updated_at: "2026-06-25T00:00:00.000Z",
      recommendation_score: 100 - index,
      badges: [],
    })),
    params: [{ key: "watts", value: "10", unit: "W" }],
  };
}
