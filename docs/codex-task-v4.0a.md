# Codex Task: V4.0A — 产品库参数筛选 + 参数展示

## 目标

把 `product_params`（26,758 条）暴露到产品管理页面，让用户能按结构化参数筛选产品，并在产品卡片上看到提取出的关键参数。

**不改报价页面，不改导出逻辑，不改数据。只改产品库 UI + 查询。**

## 当前状态

- 产品库页面：`src/app/products/page.tsx`（server component，602 行）
- 现有筛选：搜索（产品名/款号/类目文本匹配）、工厂、价格范围、MOQ、质量标签
- 没有品类下拉框（品类混在搜索文本里）
- 没有参数筛选
- 产品卡片只显示：产品名、品类 badge、款号、材质、尺寸、remark
- `product_params` 已有 Prisma relation：`Product.params -> ProductParam[]`
- 页面 limit = 50 产品

## 改动范围

### 1. 品类下拉筛选

在筛选区增加品类 `<select>` 下拉框。

**数据获取**：页面加载时用 `groupBy` 查品类列表 + 计数：

```ts
const categories = await prisma.product.groupBy({
  by: ['category'],
  _count: true,
  where: { category: { not: null } },
  orderBy: { _count: { category: 'desc' } },
});
```

**UI**：`<select name="category">` 放在搜索框右侧。选项格式：`面板灯 (886)`。默认 "全部品类"。

**URL param**：`category=面板灯`（精确匹配）。

**查询**：`buildProductWhere` 增加 `if (filters.category) and.push({ category: filters.category });`

### 2. 功率筛选（watts）

增加功率范围筛选：minWatts / maxWatts。

**查询方式**：`product_params.normalized_value` 是文本字段，功率值全部是纯数字（整数或小数如 "18", "4.5"）。用 `$queryRawUnsafe` 或 Prisma raw query 获取匹配的 product_id 列表，再传入主查询的 `id: { in: ids }` 过滤。

```sql
SELECT DISTINCT product_id FROM product_params
WHERE param_key = 'watts'
  AND CAST(normalized_value AS REAL) >= ?
  AND CAST(normalized_value AS REAL) <= ?
```

**UI**：两个 input（最小瓦数 / 最大瓦数），放在参数筛选行。

**URL params**：`minWatts=10&maxWatts=50`

### 3. IP 等级筛选

增加 IP 等级下拉筛选。

**数据获取**：页面加载时查 distinct IP 值：

```sql
SELECT DISTINCT normalized_value, COUNT(*) as cnt
FROM product_params
WHERE param_key = 'ip'
GROUP BY normalized_value
ORDER BY cnt DESC
```

当前值分布：IP65 (102), IP54 (67), IP20 (45), IP44 (39)。

**UI**：`<select name="ip">` 下拉框。选项格式：`IP65 (102)`。默认 "不限"。

**URL param**：`ip=IP65`

**查询**：

```ts
if (filters.ip) {
  and.push({
    params: { some: { paramKey: 'ip', normalizedValue: filters.ip } }
  });
}
```

### 4. 产品卡片参数展示

在产品卡片的 款号/材质/尺寸 行下方，增加参数标签行。

**数据**：Prisma include 加 `params: true`：

```ts
prisma.product.findMany({
  include: {
    supplierOffers: { ... },
    params: {
      orderBy: { paramKey: 'asc' },
    },
  },
  ...
})
```

**展示逻辑**：

```
显示顺序（按 paramKey 优先级）：
watts → ip → voltage → cct → material → beam_angle → pf → luminous_efficacy → 其他

格式：每个 param 一个小标签
  - watts: "18W"（normalizedValue + unit）
  - ip: "IP65"（normalizedValue）
  - voltage: "AC220-240V"（normalizedValue）
  - cct: "3000K"（normalizedValue + unit）
  - material: "Aluminum"（normalizedValue）
  - beam_angle: "120°"（normalizedValue + "°"）
  - 其他: "key: value"

样式：圆角小标签，浅蓝/灰底，text-xs
```

**限制**：最多展示 8 个参数标签。如果产品有更多参数，末尾显示 "+N more"。

**confidence 颜色**：
- high: `border-blue-200 bg-blue-50 text-blue-700`
- medium: `border-stone-200 bg-stone-50 text-stone-600`

### 5. 筛选区域布局调整

当前筛选是一行 5 列。改为两行：

**第一行（基础）**：搜索 | 品类下拉 | 工厂 | 筛选按钮
**第二行（参数+价格）**：功率最小 | 功率最大 | IP | 最低价 | 最高价 | MOQ

第二行默认可见（不折叠）。用 `grid gap-3 md:grid-cols-4` 和 `md:grid-cols-6` 控制响应式。

把筛选按钮放第一行右侧。两行共用一个 `<form>`。

---

## URL 参数变更

新增：
- `category`：品类精确匹配
- `minWatts`：最小功率
- `maxWatts`：最大功率
- `ip`：IP 等级精确匹配

`searchParams` 类型更新：

```ts
type ProductsPageProps = {
  searchParams: Promise<{
    search?: string;
    category?: string;       // NEW
    factory?: string;
    minPrice?: string;
    maxPrice?: string;
    minWatts?: string;        // NEW
    maxWatts?: string;        // NEW
    ip?: string;              // NEW
    moq?: string;
    quality?: string;
    productId?: string;
    error?: string;
  }>;
};
```

质量筛选标签栏 (`PRODUCT_QUALITY_FILTERS`) 保持不变，不需要改。

---

## 关键实现细节

### 功率筛选的 raw query

因为 `normalized_value` 是 text 类型，不能用 Prisma 的 `gte/lte` 做数字比较。需要用 raw SQL：

```ts
async function getProductIdsByWattsRange(min?: number, max?: number): Promise<string[]> {
  if (min === undefined && max === undefined) return [];

  let sql = `SELECT DISTINCT product_id FROM product_params WHERE param_key = 'watts'`;
  const params: number[] = [];

  if (min !== undefined) {
    sql += ` AND CAST(normalized_value AS REAL) >= ?`;
    params.push(min);
  }
  if (max !== undefined) {
    sql += ` AND CAST(normalized_value AS REAL) <= ?`;
    params.push(max);
  }

  const rows = await prisma.$queryRawUnsafe<{ product_id: string }[]>(sql, ...params);
  return rows.map(r => r.product_id);
}
```

然后在 `buildProductWhere` 中：

```ts
if (wattsProductIds.length > 0) {
  and.push({ id: { in: wattsProductIds } });
}
```

注意：如果用户填了 watts 筛选但没有匹配产品，应返回空结果（`id: { in: [] }`），不是跳过筛选。

### 品类下拉和 IP 下拉的选项加载

在页面组件中，和产品查询并行加载：

```ts
const [products, sourceFiles, qualityStats, categories, ipOptions] = await Promise.all([
  prisma.product.findMany({ ... }),
  prisma.file.findMany({ ... }),
  getProductQualityStats(),
  getCategoryOptions(),       // NEW
  getIpOptions(),             // NEW
]);
```

### 保持品类筛选标签联动

`buildProductsHref` 需要在生成质量标签链接时保留新的 URL params（category, minWatts, maxWatts, ip）。

---

## 不做的事

- 不改报价页面（`/quotes`）的产品搜索 — 那是 V4.0B
- 不改报价导出 Excel 的 Product Details — 那是 V4.0C
- 不加参数编辑功能
- 不加 CCT / 材质 / 电压筛选（这些值需要归一化，放后续版本）
- 不改 product_params 数据
- 不加分页（保持 LIMIT 50）

---

## 验收标准

1. **品类下拉**：选"面板灯"后 URL 变成 `?category=面板灯`，只显示面板灯产品，下拉选项带产品数
2. **功率筛选**：填 minWatts=10 maxWatts=50，只显示有 watts 参数在 10-50 范围内的产品
3. **IP 筛选**：选 IP65，只显示有 IP65 参数的产品
4. **多筛选联合**：品类=投光灯 + 功率 10-50 + IP65，结果是交集
5. **参数标签**：有参数的产品在卡片上显示 `[18W] [IP65] [AC220-240V]` 等标签
6. **无参数产品**：没有 product_params 的产品不显示参数行（不报错）
7. **质量标签联动**：点质量标签后，品类/功率/IP 筛选保持不变
8. **空结果**：筛选条件过严导致 0 结果时，正常显示"没有符合条件的产品"
9. **tsc / lint / build / test** 全部通过

---

## 执行步骤

### Step 1: 备份

```bash
cp prisma/dev.db backups/dev-before-v4.0a-$(date +%Y%m%d-%H%M%S).sqlite
```

### Step 2: 修改产品页面

文件：`src/app/products/page.tsx`

1. `searchParams` 类型加 `category / minWatts / maxWatts / ip`
2. `normalizeFilters` 处理新参数
3. 新增 `getCategoryOptions()`、`getIpOptions()`、`getProductIdsByWattsRange()` 函数
4. `buildProductWhere` 增加 category / watts / ip 筛选条件
5. `buildProductsHref` 保留新参数
6. 修改筛选区 UI：两行布局 + 品类下拉 + 功率输入 + IP 下拉
7. 产品卡片增加参数标签行
8. Prisma include 加 `params: { orderBy: { paramKey: 'asc' } }`

### Step 3: 参数标签组件

在 `page.tsx` 内新增辅助组件（不需要新文件）：

- `ParamTags`：接收 `ProductParam[]`，按优先级排序，渲染标签
- `formatParamLabel(param)`：根据 paramKey 格式化显示文本

### Step 4: 验证

```bash
npx tsc --noEmit --pretty false
npm run lint
npm run build
npm test
```

手动验证：
- 开 dev server（`npm run dev`）
- 测试品类下拉筛选
- 测试功率范围筛选
- 测试 IP 下拉筛选
- 测试多条件组合
- 确认无参数产品不显示标签行
- 确认质量标签联动正常

### Step 5: 提交

```bash
git add src/app/products/page.tsx
git commit -m "V4.0A: product library param filters + param tags display"
```
