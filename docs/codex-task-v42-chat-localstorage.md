# V42: Chat localStorage 持久化

## 背景

当前 Chat 页面所有状态都在 React state 中，刷新即丢。用户在对话中搜索、加草稿、调设置，一次误刷新全部重来。

单用户产品，不需要数据库级持久化。用 `localStorage` 即可。

## 目标

- 刷新后恢复：对话消息、草稿 items、报价设置（客户名/利润率/币种/汇率/customerMode）
- 新增"清空对话"和"清空草稿"按钮
- 不保存 draftPreview / quoteResult（恢复后重新预览）
- toolResults 不存入 localStorage（体积过大且含非序列化数据），恢复后历史消息的产品卡片不显示

## 实现

### 1. 新增 `src/lib/chat-storage.ts`

纯客户端模块，封装 localStorage 读写：

```typescript
const STORAGE_KEYS = {
  messages: "chat-messages",
  draftItems: "chat-draft-items",
  settings: "chat-settings",
} as const;
```

#### 存储内容

**messages**：只存 `{ id, role, text, toolCalls }[]`（不存 `toolResults`）。
- 存的时候过滤掉 welcome message
- 读的时候前置 welcome message
- 最多存 50 条（避免 localStorage 容量问题）

**draftItems**：存 `DraftItem[]` 原样序列化。

**settings**：存 `QuoteSettings` 原样序列化。

#### 函数签名

```typescript
export type StoredMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  toolCalls: ToolCallRecord[];
};

export function saveMessages(messages: StoredMessage[]): void;
export function loadMessages(): StoredMessage[];

export function saveDraftItems(items: DraftItem[]): void;  
export function loadDraftItems(): DraftItem[];

export function saveSettings(settings: QuoteSettings): void;
export function loadSettings(): QuoteSettings | null;

export function clearAllChatStorage(): void;
```

所有函数内部 try-catch（localStorage 可能被禁用或满），失败时静默不抛。

`DraftItem` 和 `QuoteSettings` 类型需要从 `chat-client.tsx` 中提取出来，或者在 `chat-storage.ts` 中重新定义（推荐后者以避免循环依赖，使用相同的字段结构）。

### 2. 修改 `src/app/chat/chat-client.tsx`

#### 2a. 初始化时从 localStorage 读取

```typescript
const [messages, setMessages] = useState<ChatMessage[]>(() => {
  const stored = loadMessages();
  const welcome: ChatMessage = {
    id: "welcome",
    role: "assistant",
    text: "你可以直接问产品、价格、工厂对比或历史报价。我会查本地报价库，不会编造数据。",
    toolResults: [],
    toolCalls: [],
  };
  if (stored.length === 0) {
    return [welcome];
  }
  return [welcome, ...stored.map(msg => ({ ...msg, toolResults: [] }))];
});

const [draftItems, setDraftItems] = useState<DraftItem[]>(() => loadDraftItems());

const [settings, setSettings] = useState<QuoteSettings>(() => {
  return loadSettings() ?? {
    customerName: "",
    profitMargin: "0.2",
    currency: "USD",
    exchangeRate: "7.2",
    customerMode: true,
  };
});
```

#### 2b. 状态变更时写入 localStorage

用 `useEffect` 监听 state 变化并保存：

```typescript
useEffect(() => {
  const toStore = messages
    .filter(msg => msg.id !== "welcome")
    .slice(-50)
    .map(msg => ({ id: msg.id, role: msg.role, text: msg.text, toolCalls: msg.toolCalls }));
  saveMessages(toStore);
}, [messages]);

useEffect(() => {
  saveDraftItems(draftItems);
}, [draftItems]);

useEffect(() => {
  saveSettings(settings);
}, [settings]);
```

#### 2c. "清空对话"按钮

在 header 区域（报价草稿按钮旁边）加一个"清空对话"按钮：

```tsx
<button
  type="button"
  onClick={() => {
    setMessages([{
      id: "welcome",
      role: "assistant", 
      text: "你可以直接问产品、价格、工厂对比或历史报价。我会查本地报价库，不会编造数据。",
      toolResults: [],
      toolCalls: [],
    }]);
  }}
  className="inline-flex items-center gap-1.5 rounded-md border border-line bg-white px-3 py-2 text-sm text-muted hover:border-red-300 hover:text-red-600"
>
  清空对话
</button>
```

#### 2d. "清空草稿"按钮

在草稿面板（DraftPanel）底部，当 `draftItems.length > 0` 时显示：

```tsx
<button
  type="button"
  onClick={() => {
    setDraftItems([]);
    clearDraftPreview();
  }}
  className="text-xs text-muted hover:text-red-600"
>
  清空草稿
</button>
```

### 3. 恢复后的表现

- 对话消息恢复，但没有产品卡片（`toolResults: []`）。这是可以接受的——用户看到文字记录，如果需要卡片可以重新搜索。
- 草稿 items 完整恢复（productId, offerId, quantity, remark 等）。
- 设置完整恢复。
- draftPreview 为 null，用户需要重新点"预览报价"。

## 测试

### `src/lib/chat-storage.test.ts` 新增

需要 mock `localStorage`：

```typescript
const mockStorage = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => mockStorage.get(key) ?? null,
  setItem: (key: string, value: string) => mockStorage.set(key, value),
  removeItem: (key: string) => mockStorage.delete(key),
  clear: () => mockStorage.clear(),
});
```

测试用例：
```
- saveMessages + loadMessages 往返序列化
- loadMessages 在 localStorage 为空时返回空数组
- loadMessages 在 JSON 损坏时返回空数组（不抛异常）
- saveMessages 限制最多 50 条
- saveDraftItems + loadDraftItems 往返序列化
- saveSettings + loadSettings 往返序列化
- loadSettings 在 localStorage 为空时返回 null
- clearAllChatStorage 清除所有 key
```

## 验证

```bash
npm run test:quick
npx tsc --noEmit
```

## 不做
- 不存 toolResults（太大，且含非纯 JSON 数据）
- 不存 draftPreview / quoteResult
- 不做跨浏览器/跨设备同步
- 不做会话列表/多会话切换
- 不改 DeepSeek 相关逻辑
- 不删除任何数据
