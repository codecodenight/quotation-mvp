# V15.0 — 全参数激进补全

当前完成率 60.5%（6201/10244）。本任务用两轮统计推断将完成率推到 80%+。

**执行顺序**：品类默认值 → 工厂+品类传播（降阈值）。先执行的方法优先级更高。

**依赖：V14.0 已完成。**

## 前置

```bash
cp prisma/dev.db prisma/dev.db.bak-v15.0
```

## 新建文件：`scripts/v15.0-aggressive-gap-fill.ts`

```bash
npx tsx scripts/v15.0-aggressive-gap-fill.ts              # dry-run
npx tsx scripts/v15.0-aggressive-gap-fill.ts --apply       # 写入
```

---

## 公共基础

从 `v11-shared.ts` 导入：
```typescript
import { CATEGORY_CORE_PARAMS, loadAccessoryProductIds, escapeMd, INSERT_BATCH_SIZE, productParamKey } from "./v11-shared";
```

9 个核心参数：`voltage, cct, cri, pf, ip, driver_type, material, beam_angle, base`

**关键约束**：只填充该产品品类 `CATEGORY_CORE_PARAMS[category]` 中定义的参数。非核心参数不填。

加载数据方式同 V14.0：
- products 全量
- product_params 全量
- accessoryIds
- first offer 映射（product → source_file_id, factory_name）
- `existingParamKeys: Set<string>`，每次插入后立即更新

---

## Part A — 品类级默认值（≥60% 阈值）

对每个品类的每个核心参数，统计该品类内所有非 accessory 产品已有值的分布。如果某值占比 ≥ 60%，则将该值填充到同品类内缺少该参数的所有非 accessory 产品。

### 逻辑

```
对每个 category:
  对每个 param_key in CATEGORY_CORE_PARAMS[category]:
    统计该品类内已有该 param 的值分布（基于 product_params + 前面已计划的新 params）
    找到最高频值及其占比
    如果占比 ≥ 60% 且样本数 ≥ 3:
      对该品类内缺少此 param 的产品:
        填充为该主导值
```

### 约束

- source_field: `"category_default_v15"`
- confidence: `"low"`
- 只统计 normalizedValue 非空的记录
- 一个品类一个参数只产生一个默认值（最高频值）

### 预估

CCT: ~694 新记录（线条灯 223, 球泡 108, 灯管 91, 壁灯 89, 筒灯 74, 风扇灯 52 等）
其他参数合计: ~5000+ 新记录（IP 3843 估计值包含非核心参数，实际需 CATEGORY_CORE_PARAMS 过滤后会少很多）

---

## Part B — 工厂+品类传播（30% 阈值，≥3 样本）

Part A 之后仍有缺口的参数，用工厂+品类分组统计进一步填充。阈值从 V14.0 的 50% 降到 30%，最低样本从 5 降到 3。

### 逻辑

```
对每个 param_key in [所有 9 个核心参数]:
  对每个 (factory_name, category) 组合:
    统计已有 param 值分布（含 Part A 新增记录）
    找到最高频值
    如果占比 ≥ 30% 且样本数 ≥ 3:
      对该组合内缺少此 param 的非 accessory 产品:
        如果该 param 在 CATEGORY_CORE_PARAMS[product.category] 中:
          填充为该主导值
```

### 约束

- factory_name 来自 first offer
- factory_name 为 null 则跳过
- source_field: `"factory_category_propagation_v15"`
- confidence: `"low"`
- Part A 已填充的不重复填（通过 existingParamKeys 去重）

---

## Part C — 覆盖率重算 + 报告

完成 A/B 后，重新统计完成率（排除 accessory），与 V14.0 基线对比。

报告写入 `docs/v15.0-aggressive-gap-fill-report.md`。

```markdown
# V15.0 激进补全报告

模式: dry-run / apply
时间: ...
备份: prisma/dev.db.bak-v15.0

## 汇总

| 方法 | 新增记录数 |
|---|---:|
| A: 品类默认值 60% | X |
| B: 工厂+品类 30% | X |
| 合计 | X |

## Part A 明细

| param_key | 新增 |
|---|---:|
| voltage | X |
| cct | X |
| cri | X |
| pf | X |
| ip | X |
| material | X |
| driver_type | X |
| beam_angle | X |
| base | X |

### Part A 品类×参数明细（前 30 行，按新增数降序）

| category | param_key | 默认值 | 新增数 |
|---|---|---|---:|

## Part B 明细

| param_key | 新增 |
|---|---:|

## 覆盖率变化

| 指标 | V14.0 | V15.0 |
|---|---:|---:|
| 核心参数覆盖范围产品 | 10244 | X |
| 全部完成产品 | 6201 | X |
| 全局完成率 | 60.5% | X% |

### 逐品类完成率

| 品类 | 产品数 | V14.0完成 | V15.0完成 | 完成率 |
|---|---:|---:|---:|---:|

### 逐参数覆盖率

| param_key | 覆盖 | 需覆盖 | 覆盖率 |
|---|---:|---:|---:|

### 仍未完成的产品分析

| 缺失参数数 | 产品数 |
|---:|---:|
| 1 | X |
| 2 | X |
| 3+ | X |

#### 仍缺 CCT 的产品（按品类）

| 品类 | 仍缺 CCT |
|---|---:|

## DB 计数

| 表 | 执行前 | 执行后 | 变化 |
|---|---:|---:|---:|
| products | 10284 | 10284 | 0 |
| product_params | 90359 | X | +X |
```

---

## Commit

```
V15.0: aggressive gap fill with category defaults and lowered factory+category thresholds
```

## 不做什么

- 不删除任何记录
- 不改 category
- 不改 Prisma schema / 前端
- 不修改源 Excel 文件
- 不调用 DeepSeek API（留给下一版本）
- 不改已有的 V13.x/V14.0 脚本
- 不修改 CATEGORY_CORE_PARAMS 定义
- 不给非核心参数填值
