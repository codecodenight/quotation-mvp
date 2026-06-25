# V28.1: Luminous Efficacy 计算 — watts + lumens → efficacy

## Goal

435 个产品同时有 watts 和 lumens 但缺 luminous_efficacy。直接计算：efficacy = lumens / watts。

## Context

- luminous_efficacy 当前覆盖 2,874/10,025 (28.7%)
- 435 个产品有 watts 和 lumens 可以直接计算
- 这是纯数学计算，不涉及 Excel 文件读取

## Script

写 `scripts/v28.1-efficacy-calculation.ts`，支持 `--dry-run`（默认）和 `--apply`。

### A. 查询

```sql
SELECT p.id, p.product_name, p.category,
  w.normalized_value as watts_val,
  l.normalized_value as lumens_val
FROM products p
INNER JOIN product_params w ON w.product_id = p.id AND w.param_key = 'watts'
INNER JOIN product_params l ON l.product_id = p.id AND l.param_key = 'lumens'
LEFT JOIN product_params e ON e.product_id = p.id AND e.param_key = 'luminous_efficacy'
WHERE e.id IS NULL
  AND CAST(w.normalized_value AS REAL) > 0
  AND CAST(l.normalized_value AS REAL) > 0
```

### B. 计算与校验

```typescript
const watts = parseFloat(wattsVal);
const lumens = parseFloat(lumensVal);
const efficacy = lumens / watts;

// 合理性校验：LED 光效通常 50~250 lm/W
if (efficacy < 10 || efficacy > 300) {
  // 记录为异常，跳过
  continue;
}
```

### C. 写入

```
paramKey: "luminous_efficacy"
rawValue: `${Math.round(efficacy)} lm/W`
normalizedValue: String(Math.round(efficacy))
unit: "lm/W"
sourceField: "v28.1_calculated"
confidence: "high"
```

### D. 备份

`--apply` 前备份。

### E. 报告

写到 `docs/v28.1-efficacy-calculation-report.md`：

```markdown
# V28.1 Luminous Efficacy 计算报告

## 统计
- 目标产品数: N
- 计算成功: N
- 跳过（异常值）: N

## 按品类

| 品类 | 计算数 | 均值 lm/W | 范围 |
|------|--------|----------|------|

## 异常值样本（前 10 条）

| 品类 | product_name | watts | lumens | 计算值 | 原因 |
|------|-------------|-------|--------|--------|------|

## 写入样本（前 20 条）

## luminous_efficacy 覆盖率变化
```

### F. 验证

```bash
npx tsc --noEmit
npx tsx scripts/v28.1-efficacy-calculation.ts            # dry-run
npx tsx scripts/v28.1-efficacy-calculation.ts --apply     # 写入
```

## 不要做

- 不修改 src/ 文件
- 不修改已有 product_params
- 不读 Excel 文件
