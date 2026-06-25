# V38C: suspicious_low 价格门禁

## 背景

V34/V36 用 IQR 方法在 `supplier_offers.price_flag` 中标记了异常价格：
- `suspicious_low`: 599 条（采购价低于同品类 Q1-3×IQR，可能是录入错误或单位混淆）
- `suspicious_high`: 36 条
- `outlier_high`: 684 条

Chat 路径（`chat-tools.ts`）已用 `priceFlag` 降权异常报价。但**报价管线完全忽略 priceFlag**：
- `prepareQuoteItems`（actions.ts）不从 DB 查询 `priceFlag`
- `quote-health.ts` 不检查价格标记
- 预览和导出不显示任何价格异常警告
- 用户可以无感知地将 `suspicious_low` 报价发给客户

## 目标

- 预览时对 `suspicious_low` 报价显示醒目警告
- 导出时要求用户确认后才能生成含 `suspicious_low` 的报价单
- `outlier_high` 和 `suspicious_high` 只做提示，不阻断

## 数据流打通

### 1. Prisma 查询加 `priceFlag`

`src/app/(admin)/quotes/actions.ts` 的 `prepareQuoteItems` 函数，在 `select` 中加入 `priceFlag: true`：

```typescript
const offers = await prisma.supplierOffer.findMany({
  where: { id: { in: offerIds } },
  select: {
    id: true,
    productId: true,
    factoryName: true,
    purchasePrice: true,
    currency: true,
    priceFlag: true,   // ← 新增
    moq: true,
    // ...rest
  },
});
```

### 2. 传递 `priceFlag` 到 QuoteWorkbookItem

`src/lib/quote-export.ts` 的 `QuoteWorkbookItem`：

```typescript
export type QuoteWorkbookItem = {
  // ...existing fields...
  priceFlag?: string | null;
};
```

### 3. actions.ts 中构建 items 时传入 priceFlag

`createQuote` 和 `previewQuote` 的 items map 中加入 `priceFlag: offer.priceFlag`。

### 4. QuoteTableSourceItem 加 `priceFlag`

`src/lib/quote-table-model.ts` 的 `QuoteTableSourceItem` 加 `priceFlag?: string | null`。

## 警告生成

### 在 `buildQuoteTableWarnings` 中加价格标记检查

`src/lib/quote-table-model.ts` 中 `buildQuoteTableWarnings` 函数，在调用 `checkQuoteItemHealth` 之后，追加价格标记警告：

```typescript
function buildQuoteTableWarnings(item: QuoteTableSourceItem): CategorizedWarning[] {
  // ...existing health + details warnings...
  
  if (item.priceFlag === "suspicious_low") {
    warnings.push({ message: "采购价异常偏低（suspicious_low）", tier: "quote" });
  } else if (item.priceFlag === "outlier_high") {
    warnings.push({ message: "采购价统计离群高值（outlier_high）", tier: "logistics" });
  } else if (item.priceFlag === "suspicious_high") {
    warnings.push({ message: "采购价异常偏高（suspicious_high）", tier: "logistics" });
  }
  
  return warnings;
}
```

注意 tier 分级：
- `suspicious_low` 用 `"quote"` tier（直接影响报价质量，高优先级）
- `outlier_high` / `suspicious_high` 用 `"logistics"` tier（提示性，低优先级）

## UI 门禁

### `src/app/(admin)/quotes/quotes-client.tsx`

#### 预览面板：警告提示

预览面板已有 warnings 显示机制（`tierCounts`）。`suspicious_low` 作为 `quote` tier 警告会自动出现在现有 warning 统计中。不需要额外 UI 修改。

#### 导出按钮：确认门禁

在"生成报价单"按钮的提交逻辑中，检查预览数据是否包含 `suspicious_low` 警告。如果有，弹出确认对话框：

```typescript
const hasSuspiciousLow = preview.rows.some(row => 
  row.warnings.some(w => w.message.includes("suspicious_low"))
);

if (hasSuspiciousLow) {
  const confirmed = window.confirm(
    `报价单包含 ${suspiciousLowCount} 个采购价异常偏低的产品。\n确认继续生成吗？`
  );
  if (!confirmed) return;
}
```

找到当前的"生成报价单"提交逻辑，在 `createQuote(formData)` 调用之前插入这段检查。

**注意**：门禁在客户端（浏览器），不在服务端。`createQuote` 服务端 action 不做阻断——用户在确认对话框中点"确认"后可以正常导出。

## 测试

### `src/lib/quote-table-model.test.ts` 新增

```
- priceFlag="suspicious_low" 的 item → warnings 包含 "suspicious_low"，tier="quote"
- priceFlag="outlier_high" 的 item → warnings 包含 "outlier_high"，tier="logistics"
- priceFlag=null 的 item → 无价格标记相关 warning
```

### 现有测试

现有 fixture 不含 `priceFlag`（可选字段），应该继续通过。

## 验证

```bash
npx vitest run
npx tsc --noEmit
```

## 不做
- 不改 Chat 路径（已有降权逻辑）
- 不改数据模型
- 不改价格标记的检测算法（V34/V36 已定）
- 不在 Excel 导出中显示价格标记
- 不删除任何数据
