import type { ToolCallRecord } from "@/lib/chat-tools";

const STORAGE_KEYS = {
  messages: "chat-messages",
  draftItems: "chat-draft-items",
  settings: "chat-settings",
} as const;

const MAX_STORED_MESSAGES = 50;

export type StoredMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  toolCalls: ToolCallRecord[];
};

export type DraftItem = {
  productId: string;
  productName: string;
  modelNo: string | null;
  category: string | null;
  offerId: string;
  factoryName: string;
  purchasePrice: string;
  currency: string;
  moq: string | null;
  quantity: number;
  remark: string;
};

export type QuoteSettings = {
  customerName: string;
  profitMargin: string;
  currency: string;
  exchangeRate: string;
  customerMode: boolean;
};

export function saveMessages(messages: StoredMessage[]): void {
  try {
    getStorage()?.setItem(
      STORAGE_KEYS.messages,
      JSON.stringify(messages.filter((message) => message.id !== "welcome").slice(-MAX_STORED_MESSAGES)),
    );
  } catch {
    // localStorage may be disabled or full.
  }
}

export function loadMessages(): StoredMessage[] {
  try {
    const stored = getStorage()?.getItem(STORAGE_KEYS.messages);
    if (!stored) {
      return [];
    }
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveDraftItems(items: DraftItem[]): void {
  try {
    getStorage()?.setItem(STORAGE_KEYS.draftItems, JSON.stringify(items));
  } catch {
    // localStorage may be disabled or full.
  }
}

export function loadDraftItems(): DraftItem[] {
  try {
    const stored = getStorage()?.getItem(STORAGE_KEYS.draftItems);
    if (!stored) {
      return [];
    }
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveSettings(settings: QuoteSettings): void {
  try {
    getStorage()?.setItem(STORAGE_KEYS.settings, JSON.stringify(settings));
  } catch {
    // localStorage may be disabled or full.
  }
}

export function loadSettings(): QuoteSettings | null {
  try {
    const stored = getStorage()?.getItem(STORAGE_KEYS.settings);
    if (!stored) {
      return null;
    }
    return JSON.parse(stored) as QuoteSettings;
  } catch {
    return null;
  }
}

export function clearAllChatStorage(): void {
  try {
    const storage = getStorage();
    storage?.removeItem(STORAGE_KEYS.messages);
    storage?.removeItem(STORAGE_KEYS.draftItems);
    storage?.removeItem(STORAGE_KEYS.settings);
  } catch {
    // localStorage may be disabled.
  }
}

function getStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
