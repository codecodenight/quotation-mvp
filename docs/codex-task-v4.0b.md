# Codex Task: V4.0B — 报价中心参数筛选 + 产品库参数详情

## 目标

两个改动：

1. **报价中心**（`/quotes`）的产品搜索增加品类 / 功率 / IP / CCT 筛选 + 搜索结果显示参数标签
2. **产品库**（`/products`）增加 CCT 筛选 + 参数标签点击展开全部参数

**不改报价导出逻辑，不改数据，不改 product_params 表。**

---

## 改动 1：报价中心参数筛选

### 涉及文件

- `src/app/quotes/page.tsx`（server component，121 行）
- `src/app/quotes/quotes-client.tsx`（client component，1,427 行）

### 当前状态

报价中心搜索只有两个字段：搜索产品（文本匹配 productName / modelNo / category）和工厂名。搜索结果表格显示：产品名 / 款号 / 材质尺寸 / 报价概况 / 检查。没有参数筛选，没有参数标签。

搜索是 URL param 驱动的 GET form（server 渲染页面传 products 到 client）。

### 1A. Server 端改动（`quotes/page.tsx`）

**URL params 扩展**：

```ts
searchParams: Promise<{
  search?: string;
  category?: string;      // NEW
  factory?: string;
  minWatts?: string;       // NEW
  maxWatts?: string;       // NEW
  ip?: string;             // NEW
  cct?: string;            // NEW
  error?: string;
}>;
```

**shouldLoadProducts 条件**：当前只在 search 或 factory 非空时加载产品。增加新筛选条件后，任一筛选非空都应加载。改为：

```ts
const shouldLoadProducts = [
  filters.search, filters.factory, filters.category,
  filters.minWatts, filters.maxWatts, filters.ip, filters.cct
].some(v => v.length > 0);
```

**新增数据查询**（参考 `products/page.tsx` 的 `getCategoryOptions`、`getIpOptions`）：

- `getCategoryOptions()` — groupBy category + count
- `getIpOptions()` — distinct ip normalized_value + count
- `getCctOptions()` — distinct cct normalized_value + count
- `getProductIdsByWattsRange()` — raw SQL CAST(normalized_value AS REAL)

这 4 个函数在 `products/page.tsx` 中已有实现（watts/category/ip）。可以直接从 `products/page.tsx` 中复制，或提取到共享模块 `src/lib/product-filters.ts`。**推荐提取到共享模块**，避免两个页面维护重复代码。

**产品查询增加参数 include**：

```ts
prisma.product.findMany({
  where: buildProductWhere(filters, wattsProductIds),
  include: {
    supplierOffers: {
      orderBy: [{ factoryName: "asc" }, { createdAt: "desc" }],
      take: 20,
    },
    params: {
      orderBy: { paramKey: "asc" },
    },
  },
  ...
})
```

注意：和 `products/page.tsx` 一样，offer 查询应使用 explicit `select`（不要 `include: true`），避免读到 `price_updated_at` 脏数据字段。参考 V4.0A 的写法。

**buildProductWhere 增加筛选条件**：category 精确匹配 + ip 参数关系查询 + cct 参数关系查询 + watts product_id in 过滤。和 products/page.tsx 的 `buildProductWhere` 逻辑一致。

**serializeProduct 扩展**：传递 params 到 client。

### 1B. Client 端改动（`quotes/quotes-client.tsx`）

**QuotesClientProps 扩展**：

```ts
type QuotesClientProps = {
  filters: QuoteFilters;
  shouldLoadProducts: boolean;
  products: QuoteProductOption[];
  quotes: QuoteHistoryRow[];
  categories: { category: string; count: number }[];   // NEW
  ipOptions: { value: string; count: number }[];         // NEW
  cctOptions: { value: string; count: number }[];        // NEW
};
```

**QuoteFilters 扩展**：

```ts
export type QuoteFilters = {
  search: string;
  category: string;     // NEW
  factory: string;
  minWatts: string;      // NEW
  maxWatts: string;      // NEW
  ip: string;            // NEW
  cct: string;           // NEW
  error: string;
};
```

**QuoteProductOption 扩展**：

在 `quotes-client.tsx` 中，`QuoteProductOption` 目前等于 `QuoteSelectionProduct`。需要扩展以包含 params 用于标签显示。

两种方式：
- A: 扩展 `QuoteSelectionProduct` 加 optional params 字段
- B: 在 `quotes-client.tsx` 单独定义包含 params 的类型

**推荐方式 A**：在 `quote-selection.ts` 的 `QuoteSelectionProduct` 类型加一个 optional 字段：

```ts
export type QuoteSelectionProduct = {
  id: string;
  productName: string;
  modelNo: string | null;
  material: string | null;
  size: string | null;
  remark: string | null;
  supplierOffers: QuoteSelectionOffer[];
  displayParams?: ProductParamDisplay[];  // NEW — optional, only for display
};
```

注意 `displayParams` 是 optional 的，不影响现有 `SelectedQuoteItem` 或 localStorage 逻辑。从 localStorage 恢复的旧数据没有这个字段也不会报错。

**搜索表单改动**：

当前搜索表单是 3 列（搜索 / 工厂 / 筛选按钮）。改为两行，和产品库布局对齐：

- 第一行：搜索 | 品类下拉 | 工厂 | 筛选按钮
- 第二行：最小功率 | 最大功率 | IP | CCT

```tsx
<form className="space-y-3">
  <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_180px_auto]">
    <Field label="搜索产品">
      <input name="search" ... />
    </Field>
    <Field label="品类">
      <select name="category" ...>
        <option value="">全部品类</option>
        {categories.map(...)}
      </select>
    </Field>
    <Field label="工厂">
      <input name="factory" ... />
    </Field>
    <div className="flex items-end">
      <button ...>筛选</button>
    </div>
  </div>
  <div className="grid gap-3 md:grid-cols-4">
    <Field label="最小功率">
      <input name="minWatts" ... />
    </Field>
    <Field label="最大功率">
      <input name="maxWatts" ... />
    </Field>
    <Field label="IP">
      <select name="ip" ...>...</select>
    </Field>
    <Field label="色温">
      <select name="cct" ...>
        <option value="">不限</option>
        {cctOptions.map(...)}
      </select>
    </Field>
  </div>
</form>
```

**ProductSelectionTable 参数标签**：

在产品行的 "产品" 列或 "材质/尺寸" 列下方，增加参数标签。复用 `product-param-display.ts` 的 `formatParamLabel` 和 `sortDisplayParams`。

```tsx
<td className="min-w-56 px-3 py-3">
  <div className="font-semibold text-ink">{product.productName}</div>
  <div className="mt-1 text-xs text-stone-600">{product.modelNo ?? "-"}</div>
  {product.displayParams && product.displayParams.length > 0 ? (
    <div className="mt-2 flex flex-wrap gap-1">
      {sortDisplayParams(product.displayParams).slice(0, 6).map((param, i) => (
        <span key={i} className="rounded-sm border border-stone-200 bg-stone-50 px-1.5 py-0.5 text-xs text-stone-600">
          {formatParamLabel(param)}
        </span>
      ))}
    </div>
  ) : null}
</td>
```

在报价中心搜索结果里最多显示 6 个标签（空间比产品库更紧凑）。不需要 confidence 颜色区分（报价场景只关心值，不关心提取置信度）。

---

## 改动 2：产品库增加 CCT 筛选

### 涉及文件

- `src/app/products/page.tsx`

### 改动内容

在产品库现有的第二行筛选（功率最小 / 最大 / IP / 最低价 / 最高价 / MOQ）中增加 CCT 下拉框。

**URL param**：`cct=3000`

**数据获取**：如果已提取到共享模块 `product-filters.ts`，直接调用 `getCctOptions()`。否则在 `page.tsx` 中新增。

**查询逻辑**：和 IP 一样用 Prisma 关系查询：

```ts
if (filters.cct) {
  and.push({
    params: { some: { paramKey: 'cct', normalizedValue: filters.cct } }
  });
}
```

**布局**：第二行从 6 列改为 7 列，或调整为两行内嵌：功率+IP+CCT 一组，价格+MOQ 一组。具体 grid 列数根据视觉效果调整，保持桌面端不换行即可。

---

## 改动 3：产品库参数详情展开

### 涉及文件

- `src/app/products/page.tsx`

### 改动内容

在产品卡片的参数标签行（V4.0A 的 `ParamTags` 组件），点击时展开一个完整参数表格，显示该产品所有 `product_params`。

但因为产品库是 server component，不能用 `useState` 做 client-side toggle。两种方案：

**方案 A（推荐）：用 HTML `<details>` 折叠**

```tsx
<details className="mt-2">
  <summary className="flex flex-wrap gap-1.5 cursor-pointer list-none">
    {/* 8 个 param tags — 和现在一样 */}
    {hiddenCount > 0 ? <span>+{hiddenCount} more</span> : null}
  </summary>
  <div className="mt-2">
    <table className="w-full text-xs">
      <thead>
        <tr className="border-b border-line text-stone-500">
          <th className="py-1 text-left">参数</th>
          <th className="py-1 text-left">值</th>
          <th className="py-1 text-left">来源</th>
          <th className="py-1 text-left">置信度</th>
        </tr>
      </thead>
      <tbody>
        {sortDisplayParams(params).map(param => (
          <tr key={param.id}>
            <td>{param.paramKey}</td>
            <td>{formatParamLabel(param)}</td>
            <td>{param.sourceField}</td>
            <td>{param.confidence}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
</details>
```

这样不需要改为 client component，用原生 `<details>` 即可。

**需要的数据**：`ParamTags` 组件当前接收 `ProductParamDisplay[]`，只有 `paramKey / rawValue / normalizedValue / unit / confidence`。展开表格需要额外字段 `sourceField` 和 `id`。

扩展 `ProductParamDisplay` 类型或直接使用 Prisma 返回的完整 param 对象。Prisma include 已经返回了完整 `ProductParam`，所以 `ParamTags` 直接接收完整类型即可。

---

## 共享筛选逻辑提取

### 新建文件：`src/lib/product-filters.ts`

从 `products/page.tsx` 提取出以下函数：

```ts
export async function getCategoryOptions(): Promise<{ category: string; count: number }[]>
export async function getIpOptions(): Promise<{ value: string; count: number }[]>
export async function getCctOptions(): Promise<{ value: string; count: number }[]>
export async function getProductIdsByWattsRange(minWatts: string, maxWatts: string): Promise<string[] | null>
```

两个页面都 import 这些函数，避免重复代码。

`products/page.tsx` 中删除对应的 inline 函数，改为 import。

---

## 不做的事

- 不改报价导出 Excel 的 Product Details — 那是 V4.0C
- 不改 product_params 数据
- 不加参数编辑功能
- 不改已选产品表（SelectedProductsTable）的显示 — 只改搜索结果表
- 不加材质 / 电压筛选（值归一化未做，留后续）

---

## 验收标准

1. **报价中心品类筛选**：选"投光灯"后搜索结果只显示投光灯产品
2. **报价中心功率筛选**：填 minWatts=10 maxWatts=50，只显示有 watts 参数在此范围的产品
3. **报价中心 IP 筛选**：选 IP65，只显示有 IP65 参数的产品
4. **报价中心 CCT 筛选**：选 3000，只显示有 3000K 色温的产品
5. **多筛选联合**：品类=投光灯 + 功率 10-50 + IP65，结果为交集
6. **报价中心参数标签**：搜索结果产品行显示参数小标签（最多 6 个）
7. **产品库 CCT 筛选**：产品库第二行增加 CCT 下拉，选值后过滤正常
8. **产品库参数展开**：产品卡片的参数标签可点击展开，显示全部参数表格（含来源、置信度）
9. **筛选联动**：报价中心只要有任一筛选非空就触发产品加载（不仅仅是 search 和 factory）
10. **共享模块**：`product-filters.ts` 被两个页面共用，`products/page.tsx` 不再有 inline 的 getCategoryOptions 等函数
11. **tsc / lint / build / test** 全部通过
12. **旧功能不受影响**：已选产品表、报价参数面板、预览、导出、历史报价全部正常

---

## 执行步骤

### Step 1: 备份

```bash
cp prisma/dev.db backups/dev-before-v4.0b-$(date +%Y%m%d-%H%M%S).sqlite
```

### Step 2: 提取共享筛选模块

新建 `src/lib/product-filters.ts`，从 `products/page.tsx` 移入：
- `getCategoryOptions()`
- `getIpOptions()`
- `getProductIdsByWattsRange()`
- `parseOptionalNonNegativeDecimal()`
- 新增 `getCctOptions()`

更新 `products/page.tsx` 改为 import 这些函数。确认产品库功能不受影响。

### Step 3: 报价中心 server 端

修改 `src/app/quotes/page.tsx`：
- 扩展 searchParams 类型
- 调用共享筛选函数
- 扩展 buildProductWhere
- 扩展 serializeProduct 传递 params
- 传递 categories / ipOptions / cctOptions 到 client

### Step 4: 报价中心 client 端

修改 `src/app/quotes/quotes-client.tsx`：
- 扩展 QuoteFilters 类型
- 扩展 QuotesClientProps 接收筛选选项
- 搜索表单增加品类 / 功率 / IP / CCT
- ProductSelectionTable 增加参数标签
- import product-param-display 模块

### Step 5: 产品库 CCT + 参数展开

修改 `src/app/products/page.tsx`：
- 增加 CCT 筛选（URL param + 下拉 + 查询条件）
- ParamTags 改为 `<details>` 折叠，展开时显示完整参数表格

### Step 6: QuoteSelectionProduct 类型扩展

修改 `src/lib/quote-selection.ts`：
- 加 `displayParams?: ProductParamDisplay[]`（可选字段）

### Step 7: 验证

```bash
npx tsc --noEmit --pretty false
npm run lint
npm run build
npm test
```

手动验证：
- 报价中心：品类筛选、功率筛选、IP 筛选、CCT 筛选、组合筛选
- 报价中心：搜索结果参数标签显示
- 产品库：CCT 筛选
- 产品库：参数标签展开详情
- 已选产品 / 预览 / 导出 / 历史报价不受影响

### Step 8: 提交

```bash
git add src/lib/product-filters.ts src/lib/quote-selection.ts src/app/products/page.tsx src/app/quotes/page.tsx src/app/quotes/quotes-client.tsx
git commit -m "V4.0B: quotes param filters + product library CCT filter and param details"
```
