# V40: Chat tool result 瘦身

## 背景

Chat tool 的结果同时服务两个消费者：
1. **DeepSeek LLM**：需要价格、型号、参数等字段来推理和回答用户问题
2. **前端 UI**：需要图片路径、source file、推荐分数等字段来渲染卡片

当前两者共用同一份 JSON。一个 10 产品的 `search_products` 结果可能超过 10KB，其中大量字段 LLM 不需要（`image_path`、`sourceFileId`、`sourceFile`、`ctn_dimensions`、`lead_time`、`price_updated_at`、`recommendation_score`、`badges`）。这浪费 token、拖慢推理、增加成本。

## 目标

- Tool 结果分两份：compact（给 LLM）和 full（给 UI）
- LLM 收到的 JSON 只保留推理必需字段
- UI 渲染不受影响
- 不改工具定义、不改 system prompt、不改 DB 查询

## 实现

### 1. 新增 `compactForLLM` 函数

`src/lib/chat-tools.ts` 中新增一个函数，根据 toolName 裁剪结果：

```typescript
export function compactForLLM(toolName: string, data: unknown): unknown {
  switch (toolName) {
    case "search_products":
      return compactSearchProducts(data as SearchProductsResult);
    case "get_product_offers":
      return compactProductOffers(data as ProductOffersResult);
    case "compare_factories":
      return data; // 已经很紧凑
    case "search_customer_history":
      return data; // 已经很紧凑
    default:
      return data;
  }
}
```

#### `compactSearchProducts`

```typescript
function compactSearchProducts(result: SearchProductsResult) {
  return {
    total: result.total,
    products: result.products.map(product => ({
      id: product.id,
      model_no: product.model_no,
      product_name: product.product_name,
      category: product.category,
      offer_count: product.offer_count,
      recommended_offer: product.recommended_offer ? {
        id: product.recommended_offer.id,
        factory_name: product.recommended_offer.factory_name,
        purchase_price: product.recommended_offer.purchase_price,
        currency: product.recommended_offer.currency,
        moq: product.recommended_offer.moq,
        price_flag: product.recommended_offer.price_flag,
      } : null,
      params: product.params,
    })),
  };
}
```

**移除的字段**：`image_path`、`source_file_id`、`source_file_name`（from recommended_offer）

#### `compactProductOffers`

```typescript
function compactProductOffers(result: ProductOffersResult) {
  return {
    product_id: result.product_id,
    product_name: result.product_name,
    model_no: result.model_no,
    category: result.category,
    offers: result.offers.map(offer => ({
      id: offer.id,
      factory_name: offer.factory_name,
      purchase_price: offer.purchase_price,
      currency: offer.currency,
      moq: offer.moq,
      price_flag: offer.price_flag,
      recommendation_score: offer.recommendation_score,
    })),
    params: result.params,
  };
}
```

**移除的字段**：`image_path`（顶层）、`source_file_id`、`source_file_name`、`ctn_qty`、`ctn_dimensions`、`lead_time`、`price_updated_at`、`badges`（from offers）

### 2. 在 `sendChatMessage` 中使用 compact 版本

`src/app/chat/actions.ts` 中，tool result 回传给 DeepSeek 时使用 compact 版本：

```typescript
import { compactForLLM } from "@/lib/chat-tools";

// 在 tool call 循环中：
const result = await executeChatTool(toolCall.function.name, args);
toolResults.push(result);  // UI 仍用完整版
toolMessages.push({
  role: "tool",
  tool_call_id: toolCall.id,
  content: JSON.stringify(compactForLLM(result.toolName, result.data)),  // LLM 用精简版
});
```

当前代码（第 99 行）：
```typescript
content: JSON.stringify(result.data),
```

改为：
```typescript
content: JSON.stringify(compactForLLM(result.toolName, result.data)),
```

### 3. 限制 `get_product_offers` 返回给 LLM 的 offer 数量

在 `compactProductOffers` 中，只保留前 5 条 offer（已按推荐分排序）：

```typescript
offers: result.offers.slice(0, 5).map(offer => ({ ... })),
```

UI 侧仍然显示所有 offer（`result.data` 不变）。

## 测试

### `src/lib/chat-tools.test.ts` 新增

```
- compactForLLM("search_products", ...) 保留 id/model_no/product_name/category/params/recommended_offer
- compactForLLM("search_products", ...) 移除 image_path
- compactForLLM("get_product_offers", ...) offers 最多 5 条
- compactForLLM("get_product_offers", ...) 移除 ctn_dimensions/lead_time/badges
- compactForLLM("compare_factories", ...) 原样返回
- compactForLLM("search_customer_history", ...) 原样返回
```

## 验证

```bash
npm run test:quick
npx tsc --noEmit
```

## 不做
- 不改工具定义（`CHAT_TOOL_DEFINITIONS`）
- 不改 system prompt
- 不改 DB 查询或 Prisma select
- 不合并或新增工具
- 不改前端 UI 渲染逻辑
- 不删除任何数据
