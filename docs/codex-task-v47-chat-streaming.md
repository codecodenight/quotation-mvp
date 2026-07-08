# V47 — Chat 流式输出（Streaming）

> **补录说明**：本任务由 Claude Fable 5 于 2026-07-07 直接执行完成，此文档为事后补录的记录（非 Codex 执行指令）。

## 背景

原实现 `sendChatMessage` 是一次性 Server Action：用户等 DeepSeek 返回全文才看到回复（只有"正在查询... Ns"计时器）。改为逐字流式输出 + 工具执行状态提示。

## 架构

```
chat-client.tsx --POST--> /chat/api/stream (NDJSON)
                              │ 每轮调 createDeepSeekChatStream (SSE, stream:true)
                              │ 解析 content delta / tool_call delta
                              │ 工具轮：status → executeChatTool → tool_result
                              │ 文字轮：delta 逐条下发
                              └ done(toolCalls) / error
```

### 事件协议（每行一个 JSON）
| type | 字段 | 说明 |
| --- | --- | --- |
| `status` | tool | 开始执行某工具（前端显示"产品搜索中..."） |
| `delta` | text | 正文增量 |
| `tool_result` | result: ChatToolResult | 工具结果（渲染卡片/表格） |
| `done` | toolCalls: ToolCallRecord[] | 结束，回传记录供多轮上下文 |
| `error` | message | 错误 |

## 改动文件
- `src/lib/deepseek.ts`：新增 `createDeepSeekChatStream()`（fetch stream:true，返回 `ReadableStream`，120s 超时）
- `src/app/chat/api/stream/route.ts`（新建）：工具循环（MAX_TOOL_ROUNDS=5）+ SSE 解析（tool_call delta 按 index 累积 arguments 片段）
- `src/app/chat/chat-client.tsx`：`submitMessage` 改为 fetch + reader 逐行解析；新增 `isStreaming`/`streamStatus` 状态；先插入空 assistant 占位消息按 id patch；空占位在渲染时过滤

## 保留
- 旧 `sendChatMessage` Server Action 未删（`loadOffers` 等仍走 Server Actions）
- 多轮上下文机制不变（compactHistory / expandHistoryMessages）

## 验证
- curl 实测 `POST /chat/api/stream`（查询"面板灯 36W 最便宜的是哪家"）：delta 逐词流出 → status(search_products) → tool_result(35 个产品) 正常
- tsc 零错误；生产构建通过
