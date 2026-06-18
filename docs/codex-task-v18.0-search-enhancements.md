# V18.0 — 搜索排序 + 筛选器增强

## 背景

报价中心当前有品类、功率范围、IP、CCT 四个筛选器。搜索结果无排序（数据库默认顺序）。用户日常找产品需要 voltage/material 筛选和结果排序。

**依赖：无。可与 V17.1 并行。**

## 改动范围

1. `src/lib/product-filters.ts` — 新增 `getVoltageOptions()`、`getMaterialOptions()`
2. `src/app/(admin)/quotes/page.tsx` — 扩展 `buildProductWhere` + 传新 options + 排序逻辑
3. `src/app/(admin)/quotes/quotes-client.tsx` — 新增筛选器 UI + 排序选择器

---

## Part A — 新增筛选器数据源

文件：`src/lib/product-filters.ts`

新增两个函数，复用已有的 `getParamOptions` 内部函数：

```typescript
export async function getVoltageOptions(): Promise<ProductFilterOption[]> {
  return getParamOptions("voltage");
}

export async function getMaterialOptions(): Promise<ProductFilterOption[]> {
  return getParamOptions("material");
}
```

---

## Part B — 后端搜索逻辑扩展

文件：`src/app/(admin)/quotes/page.tsx`

### B1: 扩展 QuoteFilters

在 `quotes-client.tsx` 的 `QuoteFilters` 类型中新增：

```typescript
export type QuoteFilters = {
  search: string;
  category: string;
  factory: string;
  minWatts: string;
  maxWatts: string;
  ip: string;
  cct: string;
  voltage: string;    // 新增
  material: string;   // 新增
  sort: string;       // 新增：排序方式
  error: string;
};
```

### B2: 扩展 buildProductWhere

在 `page.tsx` 的 `buildProductWhere` 中，IP 和 CCT 下面新增：

```typescript
if (filters.voltage) {
  and.push(buildParamFilter("voltage", filters.voltage));
}
if (filters.material) {
  and.push(buildParamFilter("material", filters.material));
}
```

`buildParamFilter` 已在 V16.1 中实现（OR 逻辑），直接复用。

### B3: 传递新 options 到客户端

在 `page.tsx` 的 `Promise.all` 中加入：

```typescript
const [wattsProductIds, categories, ipOptions, cctOptions, voltageOptions, materialOptions, quotes] = await Promise.all([
  getProductIdsByWattsRange(filters.minWatts, filters.maxWatts),
  getCategoryOptions(),
  getIpOptions(),
  getCctOptions(),
  getVoltageOptions(),     // 新增
  getMaterialOptions(),    // 新增
  prisma.quote.findMany({ ... }),
]);
```

传给 `<QuotesClient>` 组件。

### B4: 解析新 searchParams

```typescript
voltage: params.voltage?.trim() ?? "",
material: params.material?.trim() ?? "",
sort: params.sort?.trim() ?? "",
```

并加入 `shouldLoadProducts` 的检查数组。

### B5: 排序逻辑

产品查询时根据 `filters.sort` 添加 `orderBy`：

| sort 值 | orderBy | 说明 |
|---|---|---|
| `""` 或 `"default"` | 不加 orderBy（默认） | 当前行为 |
| `"price-asc"` | `supplierOffers: { _min: { purchasePrice: "asc" } }` | 最低 offer 价格升序 |
| `"price-desc"` | `supplierOffers: { _min: { purchasePrice: "desc" } }` | 最低 offer 价格降序 |
| `"newest"` | `{ createdAt: "desc" }` | 最新产品 |
| `"name"` | `{ productName: "asc" }` | 按名称 |

注意：Prisma 对 relation aggregate 排序的支持：用 `orderBy: { supplierOffers: { _count: "desc" } }` 是支持的，但 `_min` 排序可能不直接支持。

**如果 Prisma 不支持 `_min` relation 排序**，替代方案：
1. 查出产品后在 JS 层排序（简单但不影响分页）
2. 当前没有分页（搜索结果全量返回），所以 JS 排序是可行的

在获取到 products 后：

```typescript
function sortProducts(products: QuoteProductOption[], sort: string): QuoteProductOption[] {
  switch (sort) {
    case "price-asc":
      return [...products].sort((a, b) => {
        const minA = Math.min(...a.supplierOffers.map(o => o.purchasePrice));
        const minB = Math.min(...b.supplierOffers.map(o => o.purchasePrice));
        return minA - minB;
      });
    case "price-desc":
      return [...products].sort((a, b) => {
        const minA = Math.min(...a.supplierOffers.map(o => o.purchasePrice));
        const minB = Math.min(...b.supplierOffers.map(o => o.purchasePrice));
        return minB - minA;
      });
    case "newest":
      return [...products].sort((a, b) => 
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    case "name":
      return [...products].sort((a, b) =>
        (a.productName ?? "").localeCompare(b.productName ?? "")
      );
    default:
      return products;
  }
}
```

在传给 `<QuotesClient>` 之前应用排序。注意排序中 `purchasePrice` 要排除 0 和异常高值——用 `o.purchasePrice > 0 ? o.purchasePrice : Infinity` 过滤。

---

## Part C — 前端筛选器 UI

文件：`src/app/(admin)/quotes/quotes-client.tsx`

### C1: 扩展 QuotesClientProps

```typescript
type QuotesClientProps = {
  filters: QuoteFilters;
  shouldLoadProducts: boolean;
  products: QuoteProductOption[];
  quotes: QuoteHistoryRow[];
  categories: { category: string; count: number }[];
  ipOptions: { value: string; count: number }[];
  cctOptions: { value: string; count: number }[];
  voltageOptions: { value: string; count: number }[];    // 新增
  materialOptions: { value: string; count: number }[];   // 新增
};
```

### C2: 新增筛选器 select

在现有 CCT 筛选器 `<select name="cct">` 下方，按同样模式新增两个 `<select>`：

```tsx
{/* Voltage */}
<select name="voltage" defaultValue={filters.voltage} className={selectClass}>
  <option value="">电压</option>
  {voltageOptions.map((option) => (
    <option key={option.value} value={option.value}>
      {option.value}V ({option.count})
    </option>
  ))}
</select>

{/* Material */}
<select name="material" defaultValue={filters.material} className={selectClass}>
  <option value="">材质</option>
  {materialOptions.map((option) => (
    <option key={option.value} value={option.value}>
      {option.value} ({option.count})
    </option>
  ))}
</select>
```

### C3: 排序选择器

在筛选区域末尾或搜索按钮旁边，新增排序 select：

```tsx
<select name="sort" defaultValue={filters.sort} className={selectClass}>
  <option value="">排序</option>
  <option value="price-asc">价格 ↑</option>
  <option value="price-desc">价格 ↓</option>
  <option value="newest">最新</option>
  <option value="name">名称</option>
</select>
```

### C4: voltage/material 筛选器同样使用 V16.1 OR 逻辑

后端 `buildParamFilter` 已处理。前端只需传值。

---

## Commit

```
V18.0: add voltage/material filters and search result sorting to quotes page
```

## 不做什么

- 不加 beam_angle 筛选器（值太分散，下拉不实用）
- 不改数据库 / 数据脚本
- 不改产品库页面（只改报价中心）
- 不改导出逻辑
- 不修改源 Excel 文件
- 不加分页（当前搜索结果量级不需要）
