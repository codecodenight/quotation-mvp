# V4.4B — 数据质量仪表盘：参数覆盖率明细

当前仪表盘（V4.4A）只显示"参数覆盖"一个总数。用户无法看到 watts/voltage/cct/ip 各自的覆盖率，也看不到哪些品类×参数组合最差。本任务添加参数级明细。

## 不涉及 DB 数据变更，纯前端+查询

---

## 改动文件

### 1. `src/lib/data-quality.ts`

添加两个新查询和类型：

```typescript
export type ParamKeyCoverage = {
  paramKey: string;
  productCount: number;   // COUNT(DISTINCT product_id)
  percentage: number;      // productCount / totalProducts * 100
};

export type CategoryParamCoverage = {
  category: string;
  paramKey: string;
  productCount: number;
};
```

新查询（加到 `getDataQuality` 的 `Promise.all` 里）：

```sql
-- 全局 param_key 覆盖率（去重产品数）
SELECT pp.param_key,
  COUNT(DISTINCT pp.product_id) as product_count
FROM product_params pp
WHERE pp.param_key IN (
  'watts','voltage','cct','cri','ip','pf',
  'driver_type','material','luminous_efficacy','base','size_display'
)
GROUP BY pp.param_key
ORDER BY product_count DESC

-- 品类 × param_key 矩阵
SELECT COALESCE(p.category, '未分类') as category,
  pp.param_key,
  COUNT(DISTINCT pp.product_id) as product_count
FROM product_params pp
JOIN products p ON pp.product_id = p.id
WHERE pp.param_key IN (
  'watts','voltage','cct','cri','ip','pf',
  'driver_type','material','luminous_efficacy'
)
GROUP BY p.category, pp.param_key
```

把结果加入 `DataQualitySummary` 返回值：

```typescript
export type DataQualitySummary = {
  categories: CategoryQuality[];
  totals: CategoryQuality & { totalProducts: number };
  paramCoverage: ParamKeyCoverage[];           // 新增
  categoryParamMatrix: CategoryParamCoverage[]; // 新增
};
```

### 2. `src/app/(admin)/data-quality/page.tsx`

在现有品类明细表格**上方**添加两个新 section：

#### Section A: 参数覆盖率总览

水平条形图风格，每个 param_key 一行：

```
参数覆盖率明细
──────────────────────────────────────
watts        ████████████░░░░░░░░  61.6%  (6,375 / 10,346)
voltage      ███████░░░░░░░░░░░░░  35.2%  (3,638 / 10,346)
material     ██████░░░░░░░░░░░░░░  31.7%  (3,281 / 10,346)
...
```

实现方式：用 Tailwind `bg-leaf` 做条，`bg-stone-200` 做底。无需 chart 库。

参数显示名映射：

```typescript
const PARAM_DISPLAY_NAMES: Record<string, string> = {
  watts: "功率 (W)",
  voltage: "电压 (V)",
  cct: "色温 (K)",
  cri: "显色指数",
  ip: "防护等级",
  pf: "功率因数",
  driver_type: "驱动类型",
  material: "材质",
  luminous_efficacy: "光效 (lm/W)",
  base: "灯头",
  size_display: "尺寸",
};
```

颜色分级（复用现有 `coverageClass`）：

- ≥80% → green
- ≥50% → default
- ≥30% → amber
- <30% → red

#### Section B: 品类×参数矩阵（热力图）

表格形式，行=品类（按产品数降序取 Top 15），列=关键参数（watts/voltage/cct/cri/ip/pf）。

每个单元格显示覆盖率百分比，背景色按分级着色：

```
品类          watts   voltage   cct     cri     ip      pf
───────────────────────────────────────────────────────────
线条灯        52%     11%       18%     10%     5%      7%
筒灯          68%     25%       35%     20%     7%      21%
面板灯        75%     47%       42%     31%     2%      30%
...
```

颜色等级同上。如果某品类某参数 0 产品有该参数，显示 `—` 灰色。

---

## 样式要求

- 和现有页面风格一致（Tailwind + `text-ink` / `bg-paper` / `border-line` / `shadow-panel`）
- 保持现有 5 个 SummaryCard 不变
- 新增内容放在 SummaryCard 和品类明细表之间
- 矩阵表格可水平滚动（`overflow-x-auto`）
- 移动端：条形图正常显示，矩阵表格横滑

---

## 不做什么

- 不改 DB schema
- 不写入数据
- 不改其他页面
- 不引入新 npm 依赖
- 不加图表库（纯 CSS 条形图）

## Commit

```
V4.4B: add per-param coverage bars and category×param heatmap to data quality dashboard
```
