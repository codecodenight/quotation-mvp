# Codex Task: V4.2 — Quote Quality UX（警告分层 + 排序增强）

## 目标

把扁平的 `string[]` 警告系统升级为三层分类，让用户一眼区分"客户会看到的问题"和"内部物流缺失"。同时增加 Product Details 文本质量检测，在预览阶段拦截中文字符、包装标签、过短内容等问题。

## 背景

V4.1 修了 3 个客户可见质量问题，但报价预览仍把 CTN 缺失和 Product Details 问题混在一起显示。验收发现：5 行中 4 行有 CTN 警告，真正重要的文本质量问题被淹没。

---

## Part 1: 警告类型系统

### 文件：`src/lib/quote-health.ts`

**新增类型**：

```typescript
export type WarningTier = "customer" | "quote" | "logistics";

export type CategorizedWarning = {
  message: string;
  tier: WarningTier;
};
```

**改 `buildProductIssues`**：返回 `CategorizedWarning[]`

```typescript
function buildProductIssues(product: QuoteHealthProductInput): CategorizedWarning[] {
  const issues: CategorizedWarning[] = [];
  const detailText = (product.remark || product.productName || "").trim();
  const modelNo = product.modelNo?.trim() ?? "";

  if (!detailText || (modelNo && detailText.toLowerCase() === modelNo.toLowerCase())) {
    issues.push({ message: "Product Details 过短或重复", tier: "customer" });
  }
  if (!product.size?.trim() && !product.hasSizeParam) {
    issues.push({ message: "缺 Size", tier: "quote" });
  }

  return issues;
}
```

**改 `buildOfferIssues`**：返回 `CategorizedWarning[]`

```typescript
function buildOfferIssues(offer: QuoteHealthOfferInput): CategorizedWarning[] {
  const issues: CategorizedWarning[] = [];

  if (!isPositiveNumber(offer.purchasePrice)) {
    issues.push({ message: "采购价异常", tier: "quote" });
  }
  if (offer.moq?.trim() && !/^[\d,]+/.test(offer.moq.trim())) {
    issues.push({ message: "MOQ 可能不是数量", tier: "quote" });
  }
  if (!offer.ctnQty?.trim()) {
    issues.push({ message: "缺 CTN Qty", tier: "logistics" });
  }
  if (!offer.ctnLength?.trim() || !offer.ctnWidth?.trim() || !offer.ctnHeight?.trim()) {
    issues.push({ message: "缺 CTN L/W/H", tier: "logistics" });
  }

  return issues;
}
```

**改 `QuoteOfferHealth`**：

```typescript
export type QuoteOfferHealth = {
  offerId: string;
  factoryName: string;
  issues: CategorizedWarning[];  // 改 string[] → CategorizedWarning[]
};
```

**改 `QuoteProductHealth`**：

```typescript
export type QuoteProductHealth = {
  productIssues: CategorizedWarning[];  // 改 string[] → CategorizedWarning[]
  offerIssues: QuoteOfferHealth[];
  totalIssueCount: number;
};
```

**改 `buildQuoteHealth`**：计数逻辑不变，内部已用新类型。

**改 `checkQuoteItemHealth`**：返回 `CategorizedWarning[]`

```typescript
export function checkQuoteItemHealth(
  product: QuoteHealthProductInput,
  offer: QuoteHealthOfferInput
): CategorizedWarning[] {
  return [...buildProductIssues(product), ...buildOfferIssues(offer)];
}
```

---

## Part 2: Product Details 质量检测

### 文件：`src/lib/quote-preview.ts`

在构建每行 `productDetails` 之后、返回 row 之前，对实际生成的文本做质量检测，追加 tier=customer 警告。

**新增函数**（放在同文件底部）：

```typescript
function checkProductDetailsQuality(details: string): CategorizedWarning[] {
  const warnings: CategorizedWarning[] = [];
  if (!details.trim()) return warnings;

  // 含中文字符（排除空串情况，已由 "Product Details 过短或重复" 覆盖）
  if (/[一-鿿]/.test(details)) {
    warnings.push({ message: "Product Details 含中文", tier: "customer" });
  }
  // 含包装标签（即使 cleanRemarkForCustomer 已过滤，这里做二次防线）
  if (/外箱尺寸|内盒尺寸|彩盒尺寸|包装尺寸|carton\s*size/i.test(details)) {
    warnings.push({ message: "Product Details 含包装标签", tier: "customer" });
  }
  // 有效行不足 2 行
  const lines = details.split("\n").filter((l) => l.trim()).length;
  if (lines < 2) {
    warnings.push({ message: "Product Details 不足 2 行", tier: "customer" });
  }

  return warnings;
}
```

**修改 `buildQuotePreview` 中的 map 逻辑**：

在 `const warnings = checkQuoteItemHealth(...)` 之后，追加：

```typescript
const productDetails = buildProductDetails({ ...item, salePrice });
const detailsQuality = checkProductDetailsQuality(productDetails);
const allWarnings = [...warnings, ...detailsQuality];
```

然后 row 用 `allWarnings` 代替 `warnings`，`productDetails` 复用已构建值（不要重复调用 `buildProductDetails`）。

**需要 import `CategorizedWarning`** from `./quote-health`。

### `QuotePreviewRow` 改类型：

```typescript
export type QuotePreviewRow = {
  // ...其他字段不变...
  warnings: CategorizedWarning[];  // 改 string[] → CategorizedWarning[]
};
```

### `QuotePreviewData` 增加 tier 统计：

```typescript
export type QuotePreviewData = {
  // ...其他字段不变...
  totalWarnings: number;
  tierCounts: { customer: number; quote: number; logistics: number };
};
```

计算 `tierCounts`：

```typescript
const tierCounts = { customer: 0, quote: 0, logistics: 0 };
for (const row of rows) {
  for (const w of row.warnings) {
    tierCounts[w.tier]++;
  }
}
```

---

## Part 3: UI 改造

### 文件：`src/app/quotes/quotes-client.tsx`

#### 3A. 预览总览 badge — 分 tier 显示

替换当前单一 `警告 N 条` badge（~line 958-966），改为最多 3 个 badge：

```tsx
<div className="flex flex-wrap gap-2">
  {preview.tierCounts.customer > 0 && (
    <span className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
      客户可见 {preview.tierCounts.customer}
    </span>
  )}
  {preview.tierCounts.quote > 0 && (
    <span className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
      报价风险 {preview.tierCounts.quote}
    </span>
  )}
  {preview.tierCounts.logistics > 0 && (
    <span className="rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-600">
      物流缺失 {preview.tierCounts.logistics}
    </span>
  )}
  {preview.totalWarnings === 0 && (
    <span className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
      无警告
    </span>
  )}
</div>
```

颜色方案：customer=红, quote=琥珀, logistics=石灰灰。

#### 3B. 筛选 — 按 tier 过滤

替换 `showProblemRowsOnly` 单一 checkbox，改为 tier 过滤状态。

**新增 state**（在 QuotesClient 组件中）：

```typescript
const [warningFilter, setWarningFilter] = useState<Set<WarningTier>>(new Set());
// 空 set = 显示全部行；非空 = 只显示包含所选 tier 警告的行
```

**Preview section 的过滤 UI**（替换原来的 `只看有问题的行` checkbox）：

```tsx
<div className="flex flex-wrap items-center gap-3">
  <span className="text-sm font-medium text-stone-700">筛选：</span>
  <label className="inline-flex items-center gap-1.5 text-sm text-red-800">
    <input type="checkbox" checked={warningFilter.has("customer")} onChange={...} className="h-4 w-4 accent-red-600" />
    客户可见
  </label>
  <label className="inline-flex items-center gap-1.5 text-sm text-amber-800">
    <input type="checkbox" checked={warningFilter.has("quote")} onChange={...} className="h-4 w-4 accent-amber-600" />
    报价风险
  </label>
  <label className="inline-flex items-center gap-1.5 text-sm text-stone-600">
    <input type="checkbox" checked={warningFilter.has("logistics")} onChange={...} className="h-4 w-4 accent-stone-500" />
    物流缺失
  </label>
</div>
```

**行可见性逻辑**：

```typescript
const visibleRows = warningFilter.size === 0
  ? preview.rows
  : preview.rows.filter((row) =>
      row.warnings.some((w) => warningFilter.has(w.tier))
    );
```

**PreviewSection 的 props 改签名**：去掉 `showProblemRowsOnly` / `onShowProblemRowsOnlyChange`，改为 `warningFilter: Set<WarningTier>` / `onWarningFilterChange`。或者把 filter 逻辑下放到 PreviewSection 内部——选择最小改动路线即可。

#### 3C. 行排序

`visibleRows` 在 filter 之后、渲染之前排序：

```typescript
function warningPriority(row: QuotePreviewRow): number {
  const hasCustomer = row.warnings.some((w) => w.tier === "customer");
  const hasQuote = row.warnings.some((w) => w.tier === "quote");
  const hasLogistics = row.warnings.some((w) => w.tier === "logistics");

  if (hasCustomer) return 0;  // 最前
  if (hasQuote) return 1;
  if (hasLogistics) return 2;
  return 3;  // 无警告最后（但在物流之后）
}

const sortedRows = [...visibleRows].sort((a, b) => warningPriority(a) - warningPriority(b));
```

注意：排序只在预览表中生效，不影响导出顺序。

#### 3D. 行背景色按最高 tier

`PreviewRow` 中，根据 `warnings` 中最高 tier 决定行背景色：

```typescript
function rowBgClass(warnings: CategorizedWarning[]): string {
  if (warnings.some((w) => w.tier === "customer")) return "bg-red-50";
  if (warnings.some((w) => w.tier === "quote")) return "bg-amber-50";
  if (warnings.some((w) => w.tier === "logistics")) return "bg-stone-50";
  return "";
}
```

替换原来的 `hasWarnings ? "bg-amber-50" : ""`。

#### 3E. 警告列内分组显示

PreviewRow 的"检查"列（~line 1067-1086），按 tier 分组展示：

```tsx
{hasWarnings ? (
  <div className="space-y-2 text-xs">
    {customerWarnings.length > 0 && (
      <div>
        <div className="font-semibold text-red-800">客户可见</div>
        {customerWarnings.map((w) => <div key={w.message} className="text-red-700">{w.message}</div>)}
      </div>
    )}
    {quoteWarnings.length > 0 && (
      <div>
        <div className="font-semibold text-amber-800">报价风险</div>
        {quoteWarnings.map((w) => <div key={w.message} className="text-amber-700">{w.message}</div>)}
      </div>
    )}
    {logisticsWarnings.length > 0 && (
      <div>
        <div className="font-semibold text-stone-600">物流缺失</div>
        {logisticsWarnings.map((w) => <div key={w.message} className="text-stone-500">{w.message}</div>)}
      </div>
    )}
    <Link href={...} className="...">去产品库补资料</Link>
  </div>
) : (
  <span className="text-xs font-medium text-green-700">通过</span>
)}
```

#### 3F. 已选区 + 搜索结果区的 QuoteHealthSummary

`QuoteHealthSummary` 组件（~line 1484）也需要适配 `CategorizedWarning[]`：

- `health.productIssues` 现在是 `CategorizedWarning[]`
- tag 颜色按 `.tier` 区分（customer=红底, quote=琥珀底, logistics=灰底）

```tsx
{health.productIssues.map((issue) => (
  <span
    key={issue.message}
    className={`rounded-md border px-2 py-0.5 text-xs ${
      issue.tier === "customer"
        ? "border-red-200 bg-red-50 text-red-700"
        : issue.tier === "quote"
          ? "border-amber-200 bg-amber-50 text-amber-800"
          : "border-stone-200 bg-stone-50 text-stone-600"
    }`}
  >
    {issue.message}
  </span>
))}
```

`QuoteOfferHealthList` 类似：`offer.issues` 是 `CategorizedWarning[]`，显示 `issue.message`，颜色按 tier。

#### 3G. 导出前提示文案

~line 1034-1036，替换 `有 N 条警告，仍要导出？`：

```tsx
{preview.tierCounts.customer > 0 ? (
  <span className="text-sm text-red-800">
    有 {preview.tierCounts.customer} 条客户可见问题，建议修复后再导出
  </span>
) : preview.totalWarnings > 0 ? (
  <span className="text-sm text-amber-800">有 {preview.totalWarnings} 条警告，仍要导出？</span>
) : null}
```

#### 3H. 预览底部统计

~line 988-990 统计行改为 tier 分类统计：

```tsx
<div className="text-sm text-stone-600">
  客户可见 {preview.tierCounts.customer} / 报价风险 {preview.tierCounts.quote} / 物流 {preview.tierCounts.logistics}
  {" "}/ 问题行 {problemRows.length} / 共 {preview.rows.length} 行
</div>
```

---

## Part 4: 类型导入链

需要确认以下 import 路径正确：

1. `quotes-client.tsx` import `{ type CategorizedWarning, type WarningTier }` from `@/lib/quote-health`
2. `quote-preview.ts` import `{ type CategorizedWarning }` from `./quote-health`
3. `quote-preview.ts` 的 `QuotePreviewRow.warnings` 类型对齐

---

## 测试

### `src/lib/quote-health.test.ts`

更新已有 3 个测试用例，适配 `CategorizedWarning[]` 类型：

```typescript
// 旧
expect(health.productIssues).toEqual(["Product Details 过短或重复", "缺 Size"]);
// 新
expect(health.productIssues).toEqual([
  { message: "Product Details 过短或重复", tier: "customer" },
  { message: "缺 Size", tier: "quote" },
]);

// 旧
expect(health.offerIssues[0].issues).toEqual(["采购价异常", "MOQ 可能不是数量", "缺 CTN Qty", "缺 CTN L/W/H"]);
// 新
expect(health.offerIssues[0].issues).toEqual([
  { message: "采购价异常", tier: "quote" },
  { message: "MOQ 可能不是数量", tier: "quote" },
  { message: "缺 CTN Qty", tier: "logistics" },
  { message: "缺 CTN L/W/H", tier: "logistics" },
]);
```

新增测试：

```typescript
test("assigns correct tier to each warning type", () => {
  const health = buildQuoteHealth({
    productName: "Test",
    modelNo: "Test",
    remark: "Test",
    size: "",
    supplierOffers: [{
      id: "o1",
      factoryName: "F1",
      purchasePrice: "10",
      moq: "100",
      ctnQty: null,
      ctnLength: null,
      ctnWidth: null,
      ctnHeight: null,
    }],
  });
  // product issues
  expect(health.productIssues).toEqual([
    { message: "Product Details 过短或重复", tier: "customer" },
    { message: "缺 Size", tier: "quote" },
  ]);
  // offer issues: only logistics
  expect(health.offerIssues[0].issues.every(i => i.tier === "logistics")).toBe(true);
});
```

### Product Details 质量检测测试

新建或追加到 `src/lib/quote-preview.test.ts`：

```typescript
import { describe, expect, test } from "vitest";
import { buildQuotePreview } from "./quote-preview";

describe("buildQuotePreview Product Details quality", () => {
  function makeItem(overrides: Partial<Parameters<typeof buildQuotePreview>[0]["items"][0]>) {
    return {
      productId: "p1",
      supplierOfferId: "o1",
      productName: "Test Product",
      modelNo: "TP-100",
      factoryName: "Factory",
      purchasePrice: "10",
      purchaseCurrency: "RMB",
      quantity: "100",
      moq: "100",
      ctnQty: "10",
      ctnLength: "50",
      ctnWidth: "40",
      ctnHeight: "30",
      material: null,
      size: "100*50*30",
      productRemark: null,
      productParams: [],
      remark: "",
      ...overrides,
    };
  }

  test("detects Chinese characters in Product Details", () => {
    const result = buildQuotePreview({
      customerName: "Test",
      currency: "USD",
      profitMargin: "0.2",
      exchangeRate: "7.2",
      items: [makeItem({ productRemark: "产品单灯尺寸(MM): 128*93*28\nPower: 20W" })],
    });
    const customerWarnings = result.rows[0].warnings.filter(w => w.tier === "customer");
    expect(customerWarnings.some(w => w.message === "Product Details 含中文")).toBe(true);
  });

  test("detects fewer than 2 useful lines", () => {
    const result = buildQuotePreview({
      customerName: "Test",
      currency: "USD",
      profitMargin: "0.2",
      exchangeRate: "7.2",
      items: [makeItem({ productRemark: "20W", size: null })],
    });
    const customerWarnings = result.rows[0].warnings.filter(w => w.tier === "customer");
    expect(customerWarnings.some(w => w.message === "Product Details 不足 2 行")).toBe(true);
  });
});
```

如果 `quote-preview.test.ts` 不存在则新建；如果已存在则追加。

---

## 执行步骤

### Step 1: 备份

```bash
cp prisma/dev.db backups/dev-before-v4.2-$(date +%Y%m%d-%H%M%S).sqlite
```

### Step 2: 改 quote-health.ts

按 Part 1 改类型和函数返回值。

### Step 3: 改 quote-preview.ts

按 Part 2 加 `checkProductDetailsQuality`，改 `QuotePreviewRow.warnings` 类型，加 `tierCounts`。

### Step 4: 改 quotes-client.tsx

按 Part 3 全部子项 (3A-3H) 改 UI。

### Step 5: 更新测试

按 Part 4 更新已有测试 + 新增测试。

### Step 6: 验证

```bash
npx tsc --noEmit --pretty false
npm run lint
npm test
npm run build
```

### Step 7: 提交

```bash
git add src/lib/quote-health.ts src/lib/quote-health.test.ts \
        src/lib/quote-preview.ts src/lib/quote-preview.test.ts \
        src/app/quotes/quotes-client.tsx
git commit -m "V4.2: warning tier system, Product Details quality checks, preview UX"
```

---

## 验收标准

1. 预览 badge 按 tier 分色显示（红/琥珀/灰），不再是单一琥珀
2. 筛选按 tier 工作（勾"客户可见"只显示含 customer 警告的行）
3. 行排序：customer 问题行在最前，纯 logistics 行在最后
4. 行背景色按最高 tier 区分（红/琥珀/灰/无色）
5. Product Details 含中文 → 红色 customer 警告
6. Product Details 不足 2 行 → 红色 customer 警告
7. 已选区 / 搜索区的 health tag 颜色也按 tier 区分
8. 导出前提示区分"客户可见问题"和普通警告
9. 所有测试通过
10. `tsc --noEmit` 无错误

## 不做的事

- 不改数据源 / 不重跑参数提取
- 不改导出 Excel 格式
- 不改 Prisma schema
- 不改搜索排序（搜索列表行排序是服务端 Prisma query，本版只做预览排序）
- 不加"自动修复"功能
