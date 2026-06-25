import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearAllChatStorage,
  loadDraftItems,
  loadMessages,
  loadSettings,
  saveDraftItems,
  saveMessages,
  saveSettings,
  type DraftItem,
  type QuoteSettings,
  type StoredMessage,
} from "./chat-storage";

const mockStorage = new Map<string, string>();

vi.stubGlobal("localStorage", {
  getItem: (key: string) => mockStorage.get(key) ?? null,
  setItem: (key: string, value: string) => mockStorage.set(key, value),
  removeItem: (key: string) => mockStorage.delete(key),
  clear: () => mockStorage.clear(),
});

const draftItem: DraftItem = {
  productId: "product-1",
  productName: "Panel Light",
  modelNo: "PNL-36W",
  category: "面板灯",
  offerId: "offer-1",
  factoryName: "Factory A",
  purchasePrice: "12.5",
  currency: "RMB",
  moq: "1000/色",
  quantity: 2,
  remark: "sample remark",
};

const settings: QuoteSettings = {
  customerName: "HTF",
  profitMargin: "0.2",
  currency: "USD",
  exchangeRate: "7.2",
  customerMode: true,
};

describe("chat storage", () => {
  beforeEach(() => {
    mockStorage.clear();
  });

  it("round-trips serialized messages", () => {
    const messages: StoredMessage[] = [
      {
        id: "message-1",
        role: "user",
        text: "找 36W 面板灯",
        toolCalls: [],
      },
      {
        id: "message-2",
        role: "assistant",
        text: "找到 3 个产品。",
        toolCalls: [
          {
            id: "call-1",
            name: "search_products",
            arguments: "{\"query\":\"36W 面板灯\"}",
            result: "{\"total\":3}",
          },
        ],
      },
    ];

    saveMessages(messages);

    expect(loadMessages()).toEqual(messages);
  });

  it("returns an empty message array when localStorage is empty", () => {
    expect(loadMessages()).toEqual([]);
  });

  it("returns an empty message array when stored JSON is invalid", () => {
    mockStorage.set("chat-messages", "{broken");

    expect(loadMessages()).toEqual([]);
  });

  it("limits saved messages to the latest 50", () => {
    const messages = Array.from({ length: 55 }, (_, index): StoredMessage => ({
      id: `message-${index}`,
      role: index % 2 === 0 ? "user" : "assistant",
      text: `message ${index}`,
      toolCalls: [],
    }));

    saveMessages(messages);

    const loaded = loadMessages();
    expect(loaded).toHaveLength(50);
    expect(loaded[0]?.id).toBe("message-5");
    expect(loaded.at(-1)?.id).toBe("message-54");
  });

  it("round-trips serialized draft items", () => {
    saveDraftItems([draftItem]);

    expect(loadDraftItems()).toEqual([draftItem]);
  });

  it("round-trips serialized quote settings", () => {
    saveSettings(settings);

    expect(loadSettings()).toEqual(settings);
  });

  it("returns null settings when localStorage is empty", () => {
    expect(loadSettings()).toBeNull();
  });

  it("clears all chat storage keys", () => {
    saveMessages([{ id: "message-1", role: "user", text: "hello", toolCalls: [] }]);
    saveDraftItems([draftItem]);
    saveSettings(settings);

    clearAllChatStorage();

    expect(loadMessages()).toEqual([]);
    expect(loadDraftItems()).toEqual([]);
    expect(loadSettings()).toBeNull();
  });
});
