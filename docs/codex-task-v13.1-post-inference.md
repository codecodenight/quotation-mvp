# V13.1 — AI 推断后处理 + 派生参数 + 覆盖率审计

V13.0 DeepSeek 推断完成后，执行后处理：验证 AI 结果一致性、补充派生参数、生成最终覆盖率审计报告。

**必须在 V13.0 commit 之后执行。**

## 前置

```bash
cp prisma/dev.db prisma/dev.db.bak-v13.1
```

## 新建文件：`scripts/v13.1-post-inference.ts`

```bash
npx tsx scripts/v13.1-post-inference.ts              # dry-run
npx tsx scripts/v13.1-post-inference.ts --apply       # 写入
```

---

## Part A — AI 推断一致性校验

检查 V13.0 AI 推断的值是否与同品类已有数据矛盾。

```typescript
// 对每个 source_field="deepseek_inference" 的记录：
// 1. 取该产品所在 (factory, category) 组内其他产品的同参数值分布
// 2. 如果 AI 推断值不在该组已有值集中，标记为 "outlier"
// 3. 不删除，只在报告中列出异常值供人工复查
```

仅报告，不自动删除。统计异常比例。

---

## Part B — 派生参数：luminous_efficacy

有 watts 和 lumens 但缺 luminous_efficacy 的产品，可直接计算。

```typescript
// luminous_efficacy = lumens / watts (lm/W)
// 取 normalized_value 转数字
// watts 为范围值（如 "10-20"）时取中值
// lumens 为范围值时取中值
// 结果保留整数
// 过滤异常：efficacy < 30 或 > 250 lm/W 的跳过
// source_field: "derived_efficacy"
// confidence: "medium"
```

预计 ~200+ 条。

---

## Part C — 品类缺口兜底

V12.3 跳过了 3 条品类默认值（轨道灯 CRI/PF 和应急灯 PF，样本 < 10）。
V13.0 AI 可能已经填了部分，但如果 V13.0 后样本数变够了（≥10 且 ≥85% 主导），执行兜底填充。

```typescript
const DEFERRED_DEFAULTS = [
  { category: '轨道灯', paramKey: 'cri', value: '80', rawValue: 'CRI≥80' },
  { category: '轨道灯', paramKey: 'pf', value: '0.5', rawValue: 'PF≥0.5' },
  { category: '应急灯', paramKey: 'pf', value: '0.5', rawValue: 'PF≥0.5' },
];

for each deferred default:
  // 动态验证：查该品类该参数当前分布
  // 如果 ≥10 样本且主导值 ≥85% 占比 → 传播到缺失产品
  // source_field: "category_default"
  // confidence: "low"
```

---

## Part D — 最终覆盖率审计

按 `docs/category-required-params.md` 的品类必要参数定义，生成完整的覆盖率矩阵。

```typescript
const CATEGORY_CORE_PARAMS = { ... }; // 同 V4.4C 定义

for each category:
  total products
  for each core param:
    count products with param
  count products with ALL core params complete
```

输出到报告。

---

## 报告：`docs/v13.1-post-inference-report.md`

```markdown
# V13.1 AI 推断后处理报告

模式: dry-run / apply
时间: ...
备份: prisma/dev.db.bak-v13.1

## Part A — AI 推断一致性校验

| 指标 | 数值 |
|---|---:|
| deepseek_inference 总记录 | X |
| 有同组参考数据 | X |
| 与同组一致 | X |
| 异常值 (outlier) | X |
| 异常比例 | X% |

### 异常值采样（前 30 条）

| category | product model | param_key | AI 值 | 同组主导值 |

## Part B — 派生 luminous_efficacy

| 指标 | 数值 |
|---|---:|
| 有 watts+lumens 的产品 | X |
| 已有 efficacy | X |
| 可派生 | X |
| 过滤（异常范围） | X |
| 实际新增 | X |

### 采样（前 20 条）

| category | model | watts | lumens | efficacy (lm/W) |

## Part C — 品类缺口兜底

| category | param_key | 当前样本 | 主导值占比 | 状态 | 新增 |
|---|---|---:|---:|---|---:|

## Part D — 最终覆盖率矩阵

### 品类核心参数完成率

| 品类 | 总产品 | 全部完成 | 完成率 | 核心参数数 |
|---|---:|---:|---:|---:|

### 逐参数覆盖率

| param_key | 覆盖产品 | 覆盖率 |
|---|---:|---:|

### 全局汇总

| 指标 | 数值 |
|---|---:|
| 总产品 | 10,284 |
| product_params | X |
| 核心参数全部完成产品 | X |
| 全局完成率 | X% |

## 汇总

| 指标 | 数值 |
|---|---:|
| Part B 新增 | X |
| Part C 新增 | X |
| product_params 变化 | 前 → 后 |
```

---

## Commit

```
V13.1: post-inference validation, efficacy derivation, and final coverage audit
```

## 不做什么

- Part A 不删除 AI 推断值（只报告异常）
- 不覆盖已有参数
- 不删产品/offers
- 不改 Prisma schema / 前端
- 不修改源 Excel 文件
