# V4.4C — 必要参数覆盖率仪表盘

在 `/data-quality` 页面新增一个"必要参数完成率"区域，显示每个品类有多少产品的**全部必要参数**都已填充。这是衡量数据质量"是否达标"的核心指标。

**必须在 V13.0 commit 之后执行。**

## 数据源

必要参数定义在 `docs/category-required-params.md`。硬编码到查询中。

只统计 AI 可推断的参数 + 确定性可获得的参数，**排除 watts 和 size_display**——这两个缺失时意味着源文件没有数据，不是参数覆盖问题。

```typescript
// 每个品类的"核心参数"——产品有这些参数就算"规格完整"
const CATEGORY_CORE_PARAMS: Record<string, string[]> = {
  '筒灯':       ['voltage', 'cct', 'cri', 'pf', 'driver_type'],
  '面板灯':     ['voltage', 'cct', 'cri', 'pf', 'driver_type', 'material'],
  '磁吸灯':     ['voltage', 'cct', 'cri'],
  '吸顶灯':     ['voltage', 'cct', 'cri', 'pf', 'driver_type'],
  '灯丝灯':     ['voltage', 'cct', 'cri', 'pf', 'base'],
  '风扇灯':     ['voltage', 'cct', 'cri'],
  '球泡':       ['voltage', 'cct', 'cri', 'pf', 'base'],
  '壁灯':       ['voltage', 'cct', 'cri', 'driver_type', 'material'],
  '净化灯':     ['voltage', 'cct', 'cri', 'pf', 'driver_type'],
  '橱柜灯':     ['voltage', 'cct', 'cri'],
  '镜前灯':     ['voltage', 'cct', 'cri', 'driver_type'],
  '轨道灯':     ['voltage', 'cct', 'cri', 'pf', 'beam_angle'],
  '防潮灯':     ['voltage', 'cct', 'cri', 'ip', 'pf', 'driver_type'],
  '台灯':       ['voltage', 'cct', 'cri'],
  'G4G9':       ['voltage', 'cct', 'cri', 'base'],
  '灯管':       ['voltage', 'cct', 'cri', 'pf'],
  '线条灯':     ['voltage', 'cct', 'cri', 'ip'],
  '投光灯':     ['voltage', 'cct', 'cri', 'ip', 'pf', 'beam_angle', 'material'],
  '三防灯':     ['voltage', 'cct', 'cri', 'ip', 'pf'],
  '太阳能壁灯': ['cct', 'ip', 'material'],
  '太阳能':     ['cct', 'ip', 'material'],
  '路灯':       ['voltage', 'cct', 'cri', 'ip', 'pf', 'beam_angle'],
  '地埋灯/地插灯': ['voltage', 'cct', 'cri', 'ip', 'beam_angle'],
  '工作灯':     ['voltage', 'cct', 'cri', 'ip'],
  '庭院灯':     ['voltage', 'cct', 'ip', 'material'],
  'Highbay':    ['voltage', 'cct', 'cri', 'ip', 'pf', 'beam_angle'],
  '充电灯':     ['cct', 'ip', 'material'],
  '应急灯':     ['voltage', 'cct'],
  '灯带':       ['voltage', 'cct', 'cri', 'ip'],
  '皮线灯':     ['voltage', 'ip'],
};
```

## 后端查询

在 `src/lib/data-quality.ts` 新增函数：

```typescript
type CategoryCompletion = {
  category: string;
  totalProducts: number;
  completeProducts: number;  // 全部核心参数有值
  coreParamCount: number;    // 该品类核心参数数量
  paramBreakdown: Record<string, number>; // 每个核心参数的已有产品数
};

async function getCategoryCompletionData(): Promise<CategoryCompletion[]>
```

### 查询策略

对每个品类：
1. 查询该品类总产品数
2. 对每个核心参数，查 COUNT(DISTINCT product_id) WHERE param_key=X AND normalized_value 非空
3. 用 SQL 子查询或 TypeScript 计算"全部核心参数都有值"的产品数

推荐用单条 SQL 完成（避免 N+1）：

```sql
-- 对某个品类（如筒灯，核心参数 5 个）
SELECT COUNT(*) as complete_count FROM (
  SELECT p.id
  FROM products p
  WHERE p.category = '筒灯'
    AND (SELECT COUNT(DISTINCT pp.param_key) FROM product_params pp
         WHERE pp.product_id = p.id
         AND pp.param_key IN ('voltage','cct','cri','pf','driver_type')
         AND pp.normalized_value IS NOT NULL AND TRIM(pp.normalized_value) != ''
        ) = 5
)
```

由于品类数 30 且参数集不同，用 TypeScript 循环逐品类查询即可（30 次查询，每次 <100ms）。

## 前端

在 `/data-quality` 页面 V4.4B 的"品类×参数热力图"下方，新增"必要参数完成率"区域。

### 布局

```
┌──────────────────────────────────────────────────────┐
│ 核心参数完成率                                        │
│                                                      │
│ 全局完成率: ████████████░░░░ 72.3% (7,441 / 10,284)  │
│                                                      │
│ 品类          总数    完成    完成率    状态            │
│ 灯丝灯        588     520    88.4%    ██████████ 🟢   │
│ 球泡          371     295    79.5%    ████████░░ 🟡   │
│ 磁吸灯        800     612    76.5%    ████████░░ 🟡   │
│ ...                                                   │
│ 轨道灯        155      12     7.7%    █░░░░░░░░░ 🔴   │
│                                                      │
│ [展开] 逐参数覆盖明细                                  │
└──────────────────────────────────────────────────────┘
```

### 颜色编码（复用现有 coverageBgClass）

- ≥80%: 绿色 (bg-green-100)
- 40-79%: 黄色 (bg-amber-100)
- <40%: 红色 (bg-red-100)

### 可展开详情

点击品类行展开，显示该品类每个核心参数的覆盖率条形图（复用 V4.4B ParamCoverageBars 风格）。

### 排序

默认按完成率降序（高→低），让用户看到最差的在最下面。

---

## 实现文件

- `src/lib/data-quality.ts`: 新增 `getCategoryCompletionData()` 函数
- `src/app/(admin)/data-quality/page.tsx`: 新增 `CoreParamCompletion` 组件

## Commit

```
V4.4C: add required-param completion rate section to data quality dashboard
```

## 不做什么

- 不改现有仪表盘区域（SummaryCards、ParamCoverageBars、CategoryParamHeatmap）
- 不改品类表格
- 不改其他页面
- 不改数据/schema
- 不修改源 Excel 文件
