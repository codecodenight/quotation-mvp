# Codex Task: V4.4A — 数据质量仪表盘

## 目标

新建 `/data-quality` 页面，按品类展示产品数、offer 数、图片覆盖率、参数覆盖率、CTN 覆盖率、Size 覆盖率。页面只读，不改数据、不改 schema。用户看完就知道该补哪些品类、哪些字段。

## 背景

系统已有 11,344 产品 / 12,428 offers / 37,236 params / 32 品类。但各品类数据完整度差异大（净化灯参数 12% vs 球泡 100%），目前没有全局视图。

---

## Part 1: 数据查询层

### 文件：`src/lib/data-quality.ts`（新建）

用 `prisma.$queryRaw` 做聚合查询，返回一个按品类分组的结构。

**返回类型**：

```typescript
export type CategoryQuality = {
  category: string;
  productCount: number;
  offerCount: number;
  imageCount: number;
  paramProductCount: number;
  sizeProductCount: number;
  ctnOfferCount: number;
};

export type DataQualitySummary = {
  categories: CategoryQuality[];
  totals: CategoryQuality;
};
```

**查询方式**：4 个独立 SQL 查询，在函数内 merge 成一个结构。

**Query 1** — 产品数 + 图片覆盖 + Size 字段覆盖：

```sql
SELECT
  COALESCE(category, '未分类') as category,
  COUNT(*) as product_count,
  SUM(CASE WHEN image_path IS NOT NULL AND image_path != '' THEN 1 ELSE 0 END) as image_count,
  SUM(CASE WHEN size IS NOT NULL AND TRIM(size) != '' THEN 1 ELSE 0 END) as with_size_field
FROM products
GROUP BY category
ORDER BY COUNT(*) DESC
```

**Query 2** — Offer 数 + CTN 覆盖：

```sql
SELECT
  COALESCE(p.category, '未分类') as category,
  COUNT(*) as offer_count,
  SUM(CASE WHEN so.ctn_qty IS NOT NULL AND TRIM(so.ctn_qty) != '' THEN 1 ELSE 0 END) as ctn_count
FROM supplier_offers so
JOIN products p ON so.product_id = p.id
GROUP BY p.category
```

**Query 3** — 有参数的产品数（每品类）：

```sql
SELECT
  COALESCE(p.category, '未分类') as category,
  COUNT(DISTINCT pp.product_id) as param_product_count
FROM product_params pp
JOIN products p ON pp.product_id = p.id
GROUP BY p.category
```

**Query 4** — 有 size_display/dimension param 的产品数（补充 Query 1 的 with_size_field）：

```sql
SELECT
  COALESCE(p.category, '未分类') as category,
  COUNT(DISTINCT pp.product_id) as size_param_count
FROM product_params pp
JOIN products p ON pp.product_id = p.id
WHERE pp.param_key IN ('size_display', 'length_mm', 'width_mm', 'height_mm')
  AND pp.normalized_value IS NOT NULL AND TRIM(pp.normalized_value) != ''
GROUP BY p.category
```

**Merge 逻辑**：

```typescript
export async function getDataQuality(): Promise<DataQualitySummary> {
  // Run all 4 queries in parallel
  const [productRows, offerRows, paramRows, sizeParamRows] = await Promise.all([...]);

  // Build a Map<category, CategoryQuality>, merge results from each query
  // sizeProductCount = max(with_size_field, size_param_count) per product —
  //   简化：用 union count 不好做，这里用 with_size_field + size_param_count 各自的值，
  //   最终展示用 "Size 字段" 和 "Size 参数" 分别显示也可以。
  //   更简单的方案：sizeProductCount = with_size_field（来自 products.size）+ 不重叠部分很难算，
  //   直接展示 "Size 覆盖 = 有 size 字段 OR 有 size_display 参数 的产品"
  //   ↓ 用一个 union 子查询代替 Query 1 的 with_size_field + Query 4：
}
```

**实际上更简洁的做法**：把 Query 4 去掉，把 Size 覆盖做成一个 union 查询：

```sql
SELECT COALESCE(p.category, '未分类') as category, COUNT(DISTINCT p.id) as size_count
FROM products p
WHERE (p.size IS NOT NULL AND TRIM(p.size) != '')
   OR EXISTS (
     SELECT 1 FROM product_params pp
     WHERE pp.product_id = p.id
       AND pp.param_key IN ('size_display','length_mm','width_mm','height_mm')
       AND pp.normalized_value IS NOT NULL AND TRIM(pp.normalized_value) != ''
   )
GROUP BY p.category
```

这样 Size 覆盖是精确的去重计数。用 3 个 query（产品+图片、offer+CTN、参数产品数）+ 1 个 size query = 4 个并行查询。

**Merge**：以品类为 key 建 Map，合并 4 个查询结果，计算 totals 行。

**导出函数**：`export async function getDataQuality(): Promise<DataQualitySummary>`

注意：`prisma.$queryRaw` 返回的数字列类型是 `bigint`，需要 `Number()` 转换。参考 `product-filters.ts:74` 的 `cnt: bigint` 用法。

---

## Part 2: 页面

### 文件：`src/app/data-quality/page.tsx`（新建）

Server Component，调用 `getDataQuality()` 渲染。

**页面结构**：

```
┌─────────────────────────────────────────────────────┐
│ Data Quality Dashboard                               │
│ 数据质量仪表盘                                        │
├─────────────────────────────────────────────────────┤
│  [11,344]     [12,428]     [67%]     [X%]     [Y%] │
│  产品          报价         图片覆盖   参数覆盖  CTN覆盖│
├─────────────────────────────────────────────────────┤
│ 品类明细表（按产品数降序）                              │
│ ┌────────┬────┬────┬──────┬──────┬──────┬──────┐    │
│ │ 品类    │产品 │报价 │图片%  │参数%  │Size% │CTN%  │    │
│ ├────────┼────┼────┼──────┼──────┼──────┼──────┤    │
│ │ 净化灯  │1559│... │ 45%  │ 12%  │ ...  │ ...  │    │
│ │ ...     │    │    │      │      │      │      │    │
│ └────────┴────┴────┴──────┴──────┴──────┴──────┘    │
└─────────────────────────────────────────────────────┘
```

**顶部总览卡片**（5 张）：

1. 产品总数（链接 `/products`）
2. 报价总数
3. 图片覆盖率 = `totals.imageCount / totals.productCount * 100`%
4. 参数覆盖率 = `totals.paramProductCount / totals.productCount * 100`%
5. CTN 覆盖率 = `totals.ctnOfferCount / totals.offerCount * 100`%

**品类明细表**：

列定义：

| 列 | 值 | 颜色规则 | 链接 |
|---|---|---|---|
| 品类 | category | — | `/products?category={category}` |
| 产品数 | productCount | — | `/products?category={category}` |
| 报价数 | offerCount | — | — |
| 图片覆盖 | `imageCount/productCount` 显示为百分比 | ≥80% 绿色，40-79% 琥珀，<40% 红色 | — |
| 参数覆盖 | `paramProductCount/productCount` 百分比 | 同上 | — |
| Size 覆盖 | `sizeProductCount/productCount` 百分比 | 同上 | — |
| CTN 覆盖 | `ctnOfferCount/offerCount` 百分比 | 同上 | — |

**百分比颜色函数**：

```typescript
function coverageClass(rate: number): string {
  if (rate >= 0.8) return "text-green-700";
  if (rate >= 0.4) return "text-amber-700";
  return "text-red-700";
}
```

**百分比格式**：`(rate * 100).toFixed(0)%`，分子/分母用 `text-xs text-stone-500` 显示在百分比下方。

例如：

```
67%
7,563 / 11,344
```

**默认排序**：按 productCount 降序（和 SQL ORDER BY 一致）。

**表格样式**：参考 quotes-client.tsx 的 preview table 风格（`bg-[#3F4A35]` 表头白字、`divide-y divide-line` 行分隔）。

---

## Part 3: 导航

### 文件：`src/components/sidebar.tsx`

在 navItems 数组中，在"报价中心"之后新增：

```typescript
{ href: "/data-quality", label: "数据质量", icon: BarChart3 },
```

`BarChart3` 从 `lucide-react` 导入。

---

## 执行步骤

### Step 1: 新建数据查询模块

创建 `src/lib/data-quality.ts`，实现 `getDataQuality()`。

### Step 2: 新建页面

创建 `src/app/data-quality/page.tsx`，Server Component。

### Step 3: 更新导航

在 `src/components/sidebar.tsx` 添加入口。

### Step 4: 验证

```bash
npx tsc --noEmit --pretty false
npm run lint
npm test
npm run build
```

### Step 5: 提交

```bash
git add src/lib/data-quality.ts src/app/data-quality/page.tsx src/components/sidebar.tsx
git commit -m "V4.4A: data quality dashboard — per-category coverage metrics"
```

---

## 验收标准

1. `/data-quality` 页面可访问，显示所有 32 个品类
2. 总览卡片数字与实际 DB 一致（产品 ~11,344、图片 ~7,563）
3. 每个百分比列有颜色编码（绿/琥珀/红）
4. 品类名可点击跳转到 `/products?category=XXX`
5. 侧边栏显示"数据质量"入口
6. `tsc --noEmit` 无错误
7. 所有已有测试通过
8. 页面加载 < 2 秒（4 个并行 SQL 查询）

## 不做的事

- 不改任何数据
- 不改 Prisma schema
- 不做客户端排序/筛选（Server Component 足够，品类才 32 行）
- 不做"修复"功能（只看不改）
- 不做 Product Details 质量检测统计（V4.2 的 tier 系统已在报价预览覆盖）
- 不加测试文件（纯展示页面，查询正确性靠验收数字核对）
