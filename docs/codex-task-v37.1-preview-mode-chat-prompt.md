# V37.1: 预览模式区分 + Chat 先搜后比

## 部分 A：报价预览内部模式

### 问题
预览表格固定按客户模式展示，切换"客户模式/内部模式"后内容无变化。内部模式缺少工厂名和采购价列。

### 修改 1：`src/lib/quote-preview.ts`

`QuotePreviewInput` 增加 `customerMode` 字段（可选，默认 `true`）：

```typescript
export type QuotePreviewInput = {
  customerName: string;
  currency: string;
  profitMargin: string | number | { toString(): string };
  exchangeRate: string | number | { toString(): string } | null;
  customerMode?: boolean;
  items: QuotePreviewItem[];
};
```

`QuotePreviewData` 增加 `customerMode` 字段，直传到返回值：

```typescript
export type QuotePreviewData = {
  // ...existing fields...
  customerMode: boolean;
};
```

在 `buildQuotePreview` return 中加：
```typescript
customerMode: input.customerMode !== false,
```

### 修改 2：`src/app/(admin)/quotes/actions.ts`

`previewQuote` 将 `input.customerMode` 传入 `buildQuotePreview`：

```typescript
return buildQuotePreview({
  customerName: input.customerName,
  currency: input.currency,
  profitMargin: input.profitMargin,
  exchangeRate: input.exchangeRate,
  customerMode: input.customerMode,
  items: quoteItems.map(...),
});
```

### 修改 3：`src/app/(admin)/quotes/quotes-client.tsx`

在 `QuotePreviewPanel` 的表头和行中，根据 `preview.customerMode` 条件渲染两列：

表头（在 `Unit Price` 之前插入）：
```tsx
{!preview.customerMode && <th className="px-3 py-3">Factory</th>}
{!preview.customerMode && <th className="px-3 py-3 text-right">采购价</th>}
```

行（在 `salePriceDisplay` 之前插入）：
```tsx
{!preview.customerMode && <td className="px-3 py-3 text-stone-600">{row.factoryName}</td>}
{!preview.customerMode && <td className="px-3 py-3 text-right font-mono text-stone-600">{row.purchasePrice}</td>}
```

同步修改 `colSpan`：空行的 colSpan 从 11 改为 `{preview.customerMode ? 11 : 13}`。

## 部分 B：Chat 先搜后比

### 问题
系统 prompt 规则 8 说"对比价格时优先使用 compare_factories"，导致 DeepSeek 收到"工厂对比"类请求时直接调 compare_factories 跳过 search_products，用户看不到产品卡。

### 修改 `src/lib/deepseek.ts`

把规则 8 改为：

```
8. 对比工厂时，必须先调 search_products 获取产品列表，再调 compare_factories 做分组对比。不能跳过搜索直接对比。
```

## 验证

```bash
npx vitest run
npx next build
```

## 不做
- 不改导出逻辑
- 不改数据模型
- 不删除数据
