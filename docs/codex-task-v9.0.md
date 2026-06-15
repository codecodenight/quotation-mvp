# V9.0 — 对话式报价界面

## 背景

产品最终形态是一个对话窗口：用户输入自然语言，系统返回产品报价、工厂对比、历史售价等结构化结果，并能完成报价单闭环。现有 Next.js UI 保留作为管理后台（数据导入/清洗），对话界面是面向客户的唯一入口。

LLM 用 DeepSeek V4 Flash API（OpenAI 兼容格式），模型 ID `deepseek-v4-flash`，通过 tool_use/function_calling 调用已有后端逻辑。不需要多模态。

## 依赖

- `openai` npm 包（DeepSeek API 兼容 OpenAI 格式，用这个 SDK 调用）
- DeepSeek API Key（环境变量 `DEEPSEEK_API_KEY`）

## 新增文件结构

```
src/app/chat/
  page.tsx            — Server Component，加载页面
  chat-client.tsx     — Client Component，聊天 UI + 消息渲染
  actions.ts          — Server Action：接收消息 → 调 DeepSeek → 执行 tool calls → 返回结果

src/lib/chat-tools.ts — tool 定义 + 执行函数（所有 DB 查询集中在这里）
```

## 架构

```
用户输入 → Server Action (actions.ts)
  → 构造 messages + tools → 调 DeepSeek API
  → DeepSeek 返回 tool_call → chat-tools.ts 执行对应函数（Prisma 查询）
  → tool result 再送回 DeepSeek → DeepSeek 返回最终文字回复
  → Server Action 返回：{ text: string, toolResults: ToolResult[] }
  → 前端渲染：文字 + 结构化卡片
```

一次用户输入可能触发多轮 tool call（DeepSeek 决定调几次）。Server Action 内部循环处理，直到 DeepSeek 返回纯文字回复（不再调 tool）为止。

## Tool 定义

### 1. `search_products`

搜索产品库，返回匹配产品 + 推荐报价。

参数：
```typescript
{
  query?: string,       // 关键词（型号/产品名/工厂名）
  category?: string,    // 品类精确匹配
  min_watts?: number,   // 功率下限
  max_watts?: number,   // 功率上限
  factory?: string,     // 工厂名模糊匹配
  limit?: number        // 返回数量，默认 10，最大 20
}
```

返回：
```typescript
{
  total: number,
  products: Array<{
    id: string,
    model_no: string | null,
    product_name: string,
    category: string | null,
    image_path: string | null,       // 前端渲染图片用
    recommended_offer: {
      id: string,
      factory_name: string,
      purchase_price: string,
      currency: string,
      moq: string | null,
    } | null,
    offer_count: number,
    params: Array<{ key: string, value: string, unit: string | null }>,
  }>
}
```

实现：复用 `buildProductWhere` 逻辑（quotes/page.tsx:189）+ `rankOffers`（offer-ranking.ts）取推荐 offer。

### 2. `get_product_offers`

获取一个产品的全部供应商报价，按推荐排序。

参数：
```typescript
{
  product_id: string
}
```

返回：
```typescript
{
  product_name: string,
  model_no: string | null,
  category: string | null,
  image_path: string | null,
  offers: Array<{
    id: string,
    factory_name: string,
    purchase_price: string,
    currency: string,
    moq: string | null,
    ctn_qty: string | null,
    ctn_dimensions: string | null,  // "L×W×H" 格式
    lead_time: string | null,
    price_updated_at: string | null,
    recommendation_score: number,
    badges: string[],
  }>,
  params: Array<{ key: string, value: string, unit: string | null }>
}
```

实现：Prisma findUnique + include offers + rankOffers。

### 3. `search_customer_history`

搜索历史客户 FOB USD 报价。

参数：
```typescript
{
  query?: string,          // 搜索关键词（型号/描述/文件名）
  customer_name?: string,  // 客户名
  category?: string,       // 品类
  limit?: number           // 默认 10
}
```

返回：
```typescript
{
  total: number,
  rows: Array<{
    raw_model: string | null,
    raw_description: string | null,
    sale_price_usd: number | null,
    customer_name: string | null,
    quote_date: string | null,
    matched_product_name: string | null,
  }>
}
```

实现：复用 customer-quotes/page.tsx 的 `buildWhere` 逻辑。

### 4. `compare_factories`

同品类/同规格跨工厂价格对比。

参数：
```typescript
{
  category: string,          // 必填：品类
  watts?: number,            // 可选：功率精确匹配
  query?: string             // 可选：关键词进一步筛选
}
```

返回：
```typescript
{
  category: string,
  comparison: Array<{
    factory_name: string,
    product_count: number,
    price_range: { min: string, max: string, currency: string },
    sample_product: { model_no: string | null, product_name: string, price: string },
  }>
}
```

实现：按 category 查 products + offers，GROUP BY factory_name 聚合。

### 5. `add_to_quote`

把产品+报价加入当前报价单草稿。

参数：
```typescript
{
  product_id: string,
  offer_id: string,
  quantity?: number   // 默认 1
}
```

返回：
```typescript
{
  added: { product_name: string, factory_name: string, price: string },
  draft_item_count: number
}
```

实现：不写 DB，只更新会话状态。状态存在 Server Action 的闭包里或用 cookie/header 传递。

**方案选择**：用 `quoteDraft` 数组存在前端 state 里，每次调 `add_to_quote` 时前端直接添加（不走 LLM tool call）。前端维护草稿列表，生成报价单时一次性提交。这样更简单可靠。

### 6. `generate_quote`

基于当前草稿生成报价单 Excel。

参数：
```typescript
{
  customer_name: string,
  currency: string,         // "USD" | "EUR" | "GBP" | ...
  profit_margin: number,    // 0.3 = 30%
  exchange_rate?: number    // 同币种时不传
}
```

返回：
```typescript
{
  download_url: string,     // /api/quotes/{id}/download
  item_count: number,
  total_sale_amount: string
}
```

实现：复用 `createQuote`（quotes/actions.ts:33）的核心逻辑——`prepareQuoteItems` + `writeQuoteWorkbook`。报价单生成后存到 outputs/quotes/ 并写 DB。

## 前端 UI

### 页面布局：`src/app/chat/chat-client.tsx`

```
┌───────────────────────────────────────┐
│  报价助手                    [报价草稿(N)]│ ← 顶栏，右侧报价草稿按钮
├───────────────────────────────────────┤
│                                       │
│  消息区域（竖向滚动）                    │
│                                       │
│  [AssistantMessage]                   │
│    文字 + ProductCardList             │
│                                       │
│  [UserMessage]                        │
│    纯文字                              │
│                                       │
│  [AssistantMessage]                   │
│    文字 + OfferComparisonTable        │
│                                       │
├───────────────────────────────────────┤
│  [输入框...]                    [发送] │ ← 底部固定
└───────────────────────────────────────┘
```

### 组件

#### `ChatMessage`
- `role: "user" | "assistant"`
- `text: string` — LLM 的文字回复
- `toolResults?: ToolResult[]` — 结构化数据，按 tool 类型渲染不同组件

#### `ProductCard`
- 产品图片（`/api/products/{id}/image`，已有路由）
- 型号、品类、关键参数 badges
- 推荐报价（工厂、价格、MOQ）
- [查看全部报价] 按钮 → 触发 `get_product_offers` 的新消息
- [加入报价单] 按钮 → 直接添加到前端草稿 state

#### `OfferComparisonTable`
- 表格形式：工厂 | 价格 | MOQ | CTN | 更新日期 | 推荐标签
- 每行有 [加入报价单] 按钮

#### `HistoryTable`
- 历史报价行：型号 | 价格 | 客户 | 日期

#### `FactoryComparisonCard`
- 工厂名 | 产品数 | 价格区间 | 代表产品

#### `QuoteDraftPanel`
- 抽屉式侧边栏（点击顶栏 [报价草稿] 打开）
- 已添加产品列表（产品名、工厂、价格、数量）
- 数量编辑、删除按钮
- 底部：客户名、币种、利润率、汇率输入
- [生成报价单] 按钮 → 调用 generate_quote

### Layout

聊天页面用独立 layout，**不显示管理后台的侧边栏**（Sidebar）。

```
src/app/chat/layout.tsx
```

```typescript
export default function ChatLayout({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen flex-col">{children}</div>;
}
```

这样 `/chat` 是全屏对话界面，`/products`、`/quotes` 等管理页面仍保留原有侧边栏。

## DeepSeek API 集成

### 配置

```typescript
// src/lib/deepseek.ts
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: "https://api.deepseek.com/v1",
});
```

### System Prompt

```
你是一个照明产品报价助手。用户会用中文询问产品价格、工厂对比、历史报价等问题。

你可以使用以下工具查询数据库：
- search_products: 搜索产品和价格
- get_product_offers: 查看某产品的所有供应商报价
- search_customer_history: 查询历史客户报价记录
- compare_factories: 对比不同工厂的价格

规则：
1. 用户问价格时，先调 search_products 搜索，用结果回答
2. 金额保留两位小数
3. 如果搜索无结果，告知用户并建议换关键词
4. 不要编造数据，所有价格和产品信息都必须来自工具返回
5. 回复简洁，不要重复工具已返回的结构化数据（前端会渲染卡片），只补充工具未覆盖的分析或建议
```

### 消息循环

```typescript
async function chat(userMessage: string, history: ChatMessage[]): Promise<AssistantResponse> {
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history.map(toOpenAIMessage),
    { role: "user", content: userMessage },
  ];

  let response = await client.chat.completions.create({
    model: "deepseek-v4-flash",
    messages,
    tools: TOOL_DEFINITIONS,
  });

  const toolResults: ToolResult[] = [];

  // 循环处理 tool calls，直到 DeepSeek 返回纯文字
  while (response.choices[0].finish_reason === "tool_calls") {
    const toolCalls = response.choices[0].message.tool_calls!;
    const toolMessages = [];

    for (const tc of toolCalls) {
      const result = await executeTool(tc.function.name, JSON.parse(tc.function.arguments));
      toolResults.push({ toolName: tc.function.name, data: result });
      toolMessages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: JSON.stringify(result),
      });
    }

    messages.push(response.choices[0].message);
    messages.push(...toolMessages);

    response = await client.chat.completions.create({
      model: "deepseek-v4-flash",
      messages,
      tools: TOOL_DEFINITIONS,
    });
  }

  return {
    text: response.choices[0].message.content ?? "",
    toolResults,
  };
}
```

### 错误处理

- DeepSeek API 超时/错误 → 返回友好提示"网络繁忙，请稍后重试"
- Tool 执行错误 → 返回错误信息给 DeepSeek，让它向用户解释
- 前端 loading 状态：发送后显示"正在查询..."动画

## 环境变量

`.env.local`（不提交 git）：
```
DEEPSEEK_API_KEY=sk-...
```

`.env.example`（提交 git）：
```
DEEPSEEK_API_KEY=your-deepseek-api-key-here
```

## 不做的事

- 用户登录/注册（你给客户网址直接用）
- 消息持久化到 DB（刷新页面清空，够用）
- 流式输出（V9.0 先用完整返回，后续可加 streaming）
- 移动端适配（桌面浏览器优先）
- 管理后台功能（导入/清洗/数据质量页面不动）

## 验证

1. 输入"面板灯 36W"→ 返回产品卡片列表
2. 输入"投光灯 100W 最便宜"→ 返回按价格排序的结果
3. 输入"上次给 HTF 报的面板灯"→ 返回历史报价表
4. 输入"面板灯 48W 有哪些工厂"→ 返回工厂对比
5. 点击 [加入报价单] → 草稿面板更新
6. 填写客户名/利润率 → [生成报价单] → 下载 Excel
7. 无结果时返回友好提示
8. DeepSeek API 错误时不崩溃

## Commit

`V9.0: conversational quotation interface with DeepSeek integration`
