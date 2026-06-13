# Codex Task: V4.5 — 多报价对比 + 推荐报价

## 目标

产品库和报价中心的多工厂报价对比体验升级：标出最优报价、增强 offer 选择 UI、加入推荐逻辑。**不改 schema。**

## 背景

当前状态：
- 产品库 `products/page.tsx`：每个产品卡片有 offer 表格（工厂/采购价/MOQ/CTN/交期/来源/备注/操作），但无标注哪个最便宜/最新/最完整
- 报价中心 `quotes-client.tsx`：
  - 搜索结果只显示 "N 条供应商报价" + 默认第一条
  - 已选产品用 `<select>` 下拉选 offer，每条只显示 `{工厂} / {价格} / MOQ {moq}` 一行文字，无法对比

9,887 产品中很多有多个工厂报价，需要快速对比和选最优。

---

## Part 1: 推荐报价逻辑

### 文件：`src/lib/offer-ranking.ts`（新建）

纯函数模块，不依赖 Prisma。

**输入类型**（复用已有 `QuoteSelectionOffer` 或定义兼容子集）：

```typescript
export type RankableOffer = {
  id: string;
  factoryName: string;
  purchasePrice: string | { toString(): string };
  currency: string;
  moq: string | null;
  ctnQty: string | null;
  ctnLength: string | null;
  ctnWidth: string | null;
  ctnHeight: string | null;
  leadTime?: string | null;
  remark?: string | null;
  priceUpdatedAt?: Date | string | null;
};
```

**评分函数**：

```typescript
export type OfferScore = {
  offerId: string;
  total: number;        // 0-100
  completeness: number; // 0-40
  priceRank: number;    // 0-30
  recency: number;      // 0-20
  badges: OfferBadge[];
};

export type OfferBadge = "lowest-price" | "most-complete" | "newest" | "recommended";

export function rankOffers(offers: RankableOffer[]): OfferScore[];
```

**评分规则**：

1. **完整度 (0-40)**：
   - 有 MOQ：+8
   - 有 CTN Qty：+8
   - 有 CTN L/W/H 全部：+8
   - 有 lead_time：+8
   - 有 remark（非空）：+8

2. **价格排名 (0-30)**：
   - 在同组 offers 中按 `parseFloat(purchasePrice)` 排名
   - 最低价：30 分
   - 第二低：20 分
   - 第三低：10 分
   - 其他：0 分
   - 价格 ≤ 0 的 offer 排在最后（无效价格）

3. **时效 (0-20)**：
   - 有 `priceUpdatedAt`：
     - ≤ 6 个月：20 分
     - ≤ 12 个月：10 分
     - > 12 个月：5 分
   - 无 `priceUpdatedAt`：0 分

4. **Badge 分配**：
   - `lowest-price`：价格最低的那个（排除 ≤0）
   - `most-complete`：完整度最高的那个
   - `newest`：priceUpdatedAt 最新的那个（有值时）
   - `recommended`：总分最高的那个

返回按 total 降序排列的 `OfferScore[]`。

### 测试：`src/lib/offer-ranking.test.ts`（新建）

覆盖：
- 单个 offer → recommended
- 多 offer 排名、badge 分配
- 价格 = 0 排最后
- 无 priceUpdatedAt 不影响其他评分
- 所有 offer 完整度相同时按价格排序

---

## Part 2: 产品库 offer 表格增强

### 文件：`src/app/products/page.tsx`

**改动 1：offer 表格行高亮**

当前 offer 表格（line ~291-355）在每行前面加一列 badge：

```tsx
<td className="px-3 py-3">
  {badges.map(badge => (
    <span key={badge} className={badgeClass(badge)}>
      {badgeLabel(badge)}
    </span>
  ))}
</td>
```

Badge 样式：
- `lowest-price`：绿底白字 "最低价"
- `most-complete`：蓝底白字 "资料全"
- `newest`：紫底白字 "最新"
- `recommended`：金底黑字 "⭐ 推荐"

如果 offer 只有 1 条，不显示 badge（无对比意义）。

**改动 2：表头加列**

在"工厂"前插入"推荐"列。

**改动 3：offer 排序**

按 `rankOffers()` 的 total 分数降序排列（替换当前的 `factoryName asc, createdAt desc`）。

注意：排序在前端做（`rankOffers` 是纯函数），不改 Prisma query 的 orderBy。

**改动 4：查询增加 priceUpdatedAt**

在 `supplierOffers` 的 select 中加入 `priceUpdatedAt: true`，在表格中显示为相对时间（"3个月前"）或日期。

注意：`priceUpdatedAt` 有部分脏数据（非法时间戳）。显示时用 `try/catch` 包裹日期格式化，无效值显示 "-"。

---

## Part 3: 报价中心 offer 选择增强

### 文件：`src/app/quotes/quotes-client.tsx`

**改动 1：搜索结果增强**

当前搜索结果（line ~798-811）显示 "N 条供应商报价 / 默认：XXX"。改为：

```tsx
<div className="space-y-1">
  <div className="font-medium text-ink">{offers.length} 条报价</div>
  {rankedOffers.slice(0, 3).map((ranked, i) => {
    const offer = offerMap.get(ranked.offerId)!;
    return (
      <div key={offer.id} className="flex items-center gap-2 text-xs">
        {ranked.badges.includes("recommended") && (
          <span className="rounded bg-amber-100 px-1 text-amber-800">推荐</span>
        )}
        <span className="font-medium">{offer.factoryName}</span>
        <span>{formatMoney(offer.purchasePrice, offer.currency)}</span>
        {offer.moq && <span className="text-stone-500">MOQ {offer.moq}</span>}
      </div>
    );
  })}
</div>
```

最多显示前 3 条（按推荐排序），推荐条标注。

**改动 2：已选产品 offer 选择器**

当前用 `<select>` 下拉（line ~652-669）。改为可展开的 offer 对比卡片：

```tsx
{/* 当前选中的 offer 摘要行 */}
<div className="flex items-center gap-2 rounded-md border border-line p-2">
  <span className="font-medium">{selectedOffer.factoryName}</span>
  <span>{formatMoney(selectedOffer.purchasePrice, selectedOffer.currency)}</span>
  {selectedScore?.badges.includes("recommended") && (
    <span className="rounded bg-amber-100 px-1 text-xs text-amber-800">推荐</span>
  )}
  <button onClick={toggle}>
    {expanded ? <ChevronDown /> : <ChevronRight />} 切换报价
  </button>
</div>

{/* 展开后的 offer 对比列表 */}
{expanded && (
  <div className="mt-2 space-y-1">
    {rankedOffers.map((ranked) => {
      const offer = offerMap.get(ranked.offerId)!;
      const isSelected = offer.id === item.selectedOfferId;
      return (
        <button
          key={offer.id}
          onClick={() => selectOffer(offer.id)}
          className={`w-full rounded-md border p-2 text-left text-sm ${
            isSelected ? "border-leaf bg-leaf/5" : "border-line hover:border-leaf"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="font-medium">{offer.factoryName}</span>
            <span>{formatMoney(offer.purchasePrice, offer.currency)}</span>
          </div>
          <div className="mt-1 flex gap-3 text-xs text-stone-500">
            <span>MOQ {offer.moq ?? "-"}</span>
            <span>CTN {offer.ctnQty ?? "-"}</span>
          </div>
          <div className="mt-1 flex gap-1">
            {ranked.badges.map(badge => (
              <span key={badge} className={badgeClass(badge)}>{badgeLabel(badge)}</span>
            ))}
          </div>
        </button>
      );
    })}
  </div>
)}
```

**保留兼容**：`selectedOfferId` 状态和序列化逻辑不变，只是选择 UI 从 `<select>` 变成卡片列表。

**改动 3：加入产品时默认选推荐 offer**

当前 `createSelectedQuoteItem` 取 `supplierOffers[0]`。改为取 `rankOffers()` 返回的第一个（即推荐 offer）：

```typescript
// src/lib/quote-selection.ts
import { rankOffers } from "./offer-ranking";

export function createSelectedQuoteItem(product: QuoteSelectionProduct): SelectedQuoteItem {
  const ranked = rankOffers(product.supplierOffers);
  const bestOfferId = ranked.length > 0 ? ranked[0].offerId : product.supplierOffers[0]?.id ?? "";
  return {
    product,
    selectedOfferId: bestOfferId,
    quantity: "",
    remark: "",
  };
}
```

**改动 4：查询增加 priceUpdatedAt**

在 `quotes/actions.ts` 的搜索产品查询中，`supplierOffers` select 加入 `priceUpdatedAt: true`。

同步更新 `QuoteSelectionOffer` 类型加入 `priceUpdatedAt?: string | null`。

---

## Part 4: Badge 样式统一

在 `offer-ranking.ts` 中导出 badge 元数据：

```typescript
export const OFFER_BADGE_META: Record<OfferBadge, { label: string; className: string }> = {
  "lowest-price": { label: "最低价", className: "bg-green-100 text-green-800 border-green-200" },
  "most-complete": { label: "资料全", className: "bg-blue-100 text-blue-800 border-blue-200" },
  "newest": { label: "最新", className: "bg-purple-100 text-purple-800 border-purple-200" },
  "recommended": { label: "推荐", className: "bg-amber-100 text-amber-800 border-amber-200" },
};
```

产品库（Server Component）和报价中心（Client Component）都用这个配置。

---

## 执行步骤

### Step 1: 新建推荐逻辑

创建 `src/lib/offer-ranking.ts` + `src/lib/offer-ranking.test.ts`。

### Step 2: 修改产品库

修改 `src/app/products/page.tsx`：加 badge 列、排序、priceUpdatedAt。

### Step 3: 修改报价中心

修改 `src/app/quotes/quotes-client.tsx`：搜索结果增强、offer 选择器改卡片、默认推荐。
修改 `src/lib/quote-selection.ts`：`createSelectedQuoteItem` 用推荐排序。
修改 `src/app/quotes/actions.ts`：查询加 priceUpdatedAt。

### Step 4: 验证

```bash
npx tsc --noEmit --pretty false
npm run lint
npm test
npm run build
```

### Step 5: 提交

```bash
git add src/lib/offer-ranking.ts src/lib/offer-ranking.test.ts \
  src/app/products/page.tsx \
  src/app/quotes/quotes-client.tsx src/app/quotes/actions.ts \
  src/lib/quote-selection.ts
git commit -m "V4.5: multi-offer comparison with ranking badges and smart defaults"
```

## 验收标准

1. 产品库 offer 表格：推荐列 + badge（最低价/资料全/最新/推荐）+ 按推荐排序
2. 报价中心搜索结果：显示前 3 条排名 offer 而非只显示第一条
3. 报价中心已选产品：offer 选择器从 `<select>` 变成可展开的对比卡片列表
4. 加入产品时默认选推荐 offer（不是第一条）
5. Badge 样式统一（绿/蓝/紫/金）
6. 单 offer 产品不显示 badge（无对比意义）
7. priceUpdatedAt 脏数据不 crash（无效值显示 "-"）
8. `tsc --noEmit` 无错误
9. 所有已有测试通过
10. `offer-ranking.test.ts` 新测试通过

## 不做的事

- 不改 schema
- 不加新的数据库查询逻辑（排名在前端/纯函数中计算）
- 不改 quote preview / export 流程
- 不做 offer 搜索/筛选（当前产品维度够用）
- 不修复 priceUpdatedAt 脏数据（只做显示容错）
