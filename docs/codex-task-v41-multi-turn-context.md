# V41: Multi-turn 上下文 — 让 DeepSeek 记住前几轮搜了什么

## 背景

当前 Chat 的历史传递只发送 `{role, text}` 对。每一轮的 tool call（搜索参数）和 tool result（搜索结果）全部丢弃。DeepSeek 在第二轮完全不知道前一轮返回了哪些产品。

**典型失败场景：**
- 用户："面板灯 36W" → 搜到 5 款
- 用户："第三个是哪个工厂的" → DeepSeek 不知道"第三个"是什么
- 用户："把最便宜的加到报价" → DeepSeek 无法识别

**根因：** `toOpenAIMessage` 只取 `{role, content: text}`，丢弃 tool_calls 和 tool result messages。

## 目标

- 历史消息带上 tool call + compact result，让 DeepSeek 在后续轮次能看到前几轮搜了什么
- 使用 OpenAI-standard 格式重建完整消息序列（assistant+tool_calls → tool results → assistant text）
- 控制上下文体积：只最近 3 条 assistant 消息带 tool 数据，更早的只传 text
- 不改工具定义，不改 system prompt，不改 UI 渲染

## 数据结构变更

### 1. 新增 `ToolInteractionRound` 类型

`src/app/chat/actions.ts` 中新增：

```typescript
export type ToolCallRecord = {
  id: string;                 // tool_call_id（DeepSeek 返回的）
  name: string;               // function name
  arguments: string;          // JSON string of args
  result: string;             // compact JSON string（已经过 compactForLLM）
};

export type ChatMessageInput = {
  role: "user" | "assistant";
  text: string;
  toolCalls?: ToolCallRecord[];  // 只有 assistant 消息有
};
```

注意：当前 `ChatMessageInput` 没有 `toolCalls` 字段，需要扩展。

### 2. 扩展 `AssistantChatResponse`

```typescript
export type AssistantChatResponse = {
  text: string;
  toolResults: ChatToolResult[];          // 给 UI 渲染（完整数据）
  toolCalls: ToolCallRecord[];            // 给历史传递（compact 数据）
};
```

## 实现

### 1. 服务端：收集 tool call records

在 `sendChatMessage` 的 tool call 循环中，把每一次 tool call 记录下来：

```typescript
const allToolCallRecords: ToolCallRecord[] = [];

// 在循环内部，每处理一个 toolCall 时：
allToolCallRecords.push({
  id: toolCall.id,
  name: toolCall.function.name,
  arguments: toolCall.function.arguments,
  result: JSON.stringify(compactForLLM(result.toolName, result.data)),
});
```

最终 return 中加入 `toolCalls: allToolCallRecords`。

### 2. 服务端：重建历史消息序列

当前 `toOpenAIMessage` 是一对一映射。改为一对多，能展开 tool 交互：

```typescript
function expandHistoryMessages(history: ChatMessageInput[]): ChatCompletionMessageParam[] {
  const expanded: ChatCompletionMessageParam[] = [];

  for (const msg of history) {
    if (msg.role === "user") {
      expanded.push({ role: "user", content: msg.text });
      continue;
    }

    // assistant message
    if (!msg.toolCalls || msg.toolCalls.length === 0) {
      expanded.push({ role: "assistant", content: msg.text });
      continue;
    }

    // assistant with tool calls: reconstruct the full sequence
    // 一个 assistant message 带所有 tool_calls，然后所有 tool results，最后 final text
    expanded.push({
      role: "assistant",
      content: null,
      tool_calls: msg.toolCalls.map((tc) => ({
        id: tc.id,
        type: "function" as const,
        function: { name: tc.name, arguments: tc.arguments },
      })),
    });

    for (const tc of msg.toolCalls) {
      expanded.push({
        role: "tool",
        tool_call_id: tc.id,
        content: tc.result,
      });
    }

    // Final assistant text
    if (msg.text) {
      expanded.push({ role: "assistant", content: msg.text });
    }
  }

  return expanded;
}
```

然后 `sendChatMessage` 中的 messages 构建改为：

```typescript
const messages: ChatCompletionMessageParam[] = [
  { role: "system", content: CHAT_SYSTEM_PROMPT },
  ...expandHistoryMessages(history.slice(-MAX_HISTORY_MESSAGES)),
  { role: "user", content: safeMessage },
];
```

删除旧的 `toOpenAIMessage` 函数。

### 3. 客户端：存储 toolCalls 并传入历史

`src/app/chat/chat-client.tsx` 中：

#### 3a. 扩展 `ChatMessage` 类型

```typescript
type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  toolResults: ChatToolResult[];        // UI 渲染用
  toolCalls: ToolCallRecord[];          // 历史传递用
};
```

#### 3b. 更新 `appendAssistantResponse`

```typescript
function appendAssistantResponse(response: AssistantChatResponse) {
  setQueryStartTime(null);
  setMessages((current) => [
    ...current,
    {
      id: crypto.randomUUID(),
      role: "assistant",
      text: response.text,
      toolResults: response.toolResults,
      toolCalls: response.toolCalls,
    },
  ]);
}
```

#### 3c. 更新 `compactHistory`

```typescript
const compactHistory = useMemo(() => {
  const history = messages
    .filter((message) => message.id !== "welcome")
    .slice(-10);

  // 只最近 3 条 assistant 消息带 tool 数据，更早的只传 text
  const TOOL_CONTEXT_LIMIT = 3;
  let assistantWithToolCount = 0;

  // 从后往前遍历，标记哪些 assistant 消息带 tool context
  const toolContextSet = new Set<string>();
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (msg.role === "assistant" && msg.toolCalls.length > 0) {
      if (assistantWithToolCount < TOOL_CONTEXT_LIMIT) {
        toolContextSet.add(msg.id);
        assistantWithToolCount++;
      }
    }
  }

  return history.map((msg) => ({
    role: msg.role,
    text: msg.text,
    toolCalls: toolContextSet.has(msg.id) ? msg.toolCalls : undefined,
  }));
}, [messages]);
```

#### 3d. 其他创建 ChatMessage 的地方

在客户端代码中搜索所有 `setMessages` 调用，确保每个新 `ChatMessage` 对象都有 `toolCalls: []`。包括：

- `submitMessage` 中创建 user message 时：`toolCalls: []`
- `getProductOffersForChat` 回调中添加的 assistant message：`toolCalls: []`
- 任何其他 `setMessages` 调用

### 4. 上下文体积控制

- `MAX_HISTORY_MESSAGES` 保持 10（对消息条目数的限制）
- 新增 `TOOL_CONTEXT_LIMIT = 3`（最多 3 条 assistant 消息带 tool 数据）
- 更早的 assistant 消息只传 `text`，不带 `toolCalls`
- tool result 已经经过 `compactForLLM` 裁剪（V40）

## 测试

### `src/app/chat/actions.test.ts` 新增（或 `src/lib/chat-tools.test.ts` 中新增）

因为 `sendChatMessage` 依赖 DeepSeek API，无法单测。测 `expandHistoryMessages` 这个纯函数：

```
- expandHistoryMessages: user message → 单条 {role: "user", content}
- expandHistoryMessages: assistant without toolCalls → 单条 {role: "assistant", content}
- expandHistoryMessages: assistant with toolCalls → assistant(null + tool_calls) + tool results + assistant(text)
- expandHistoryMessages: mixed sequence preserves order
```

在 `chat-tools.test.ts` 中新增即可（import from actions.ts）。但 `expandHistoryMessages` 在 actions.ts 中是内部函数。两个选择：

**选择 A**：把 `expandHistoryMessages` 放在 `chat-tools.ts` 中导出（推荐，因为 `chat-tools.ts` 已有其他工具函数，且不涉及 "use server"）

**选择 B**：在 `actions.ts` 中导出并在测试中直接 import

选择 A。将 `expandHistoryMessages` 放在 `src/lib/chat-tools.ts` 并导出。

### 测试数据构造

```typescript
const historyWithTools: ChatMessageInput[] = [
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
```

验证展开后：
1. `{role: "user", content: "面板灯 36W"}`
2. `{role: "assistant", content: null, tool_calls: [{id: "tc_1", ...}]}`
3. `{role: "tool", tool_call_id: "tc_1", content: '{"total":5,"products":[]}'}`
4. `{role: "assistant", content: "找到 5 款面板灯"}`
5. `{role: "user", content: "最便宜的是哪个"}`

## 验证

```bash
npm run test:quick
npx tsc --noEmit
```

## 不做

- 不改 system prompt
- 不改工具定义
- 不改 UI 消息渲染逻辑（toolResults 卡片渲染不变）
- 不改 quote draft 流程
- 不做对话持久化（刷新后对话仍然丢失，V42+ 的事）
- 不做 token 计数或动态截断（简单的 TOOL_CONTEXT_LIMIT=3 足够）
- 不删除任何数据
