# V29.1: 同文件同品类参数传播

## Goal

如果同一个 Excel 文件中、同一个品类的所有已知产品的某参数值完全一致（100% 一致，≥3 个样本），将该值传播到同文件同品类中缺失该参数的产品。

## Context

已验证的传播潜力（100% uniform, ≥3 samples per file-category combo）：

| param_key | 可填缺口 |
|-----------|---------|
| material | ~857 |
| ip | ~750 |
| beam_angle | ~360 |
| driver_type | ~51 |
| pf | ~43 |

这比品类默认值更精确，因为限定了同一供应商（同文件）+ 同一品类。

## 依赖

V29.0 先跑完（品类默认值填入后，V29.1 的检查会跳过已有参数，不会冲突）。

## Script

写 `scripts/v29.1-file-category-propagation.ts`，支持 `--dry-run`（默认）和 `--apply`。

### A. 目标参数

```typescript
const TARGET_PARAMS = ['beam_angle', 'material', 'ip', 'driver_type', 'pf'];
```

### B. 处理流程

对每个 param_key：

1. **找 uniform 组合**：
```sql
SELECT so.source_file_id, p.category, MIN(pp.normalized_value) as uniform_val
FROM supplier_offers so
JOIN products p ON p.id = so.product_id
JOIN product_params pp ON pp.product_id = p.id
WHERE pp.param_key = ?
GROUP BY so.source_file_id, p.category
HAVING COUNT(DISTINCT pp.normalized_value) = 1 AND COUNT(*) >= 3
```

2. **找缺失产品**：对每个 uniform 组合，查询同 file + 同 category 但缺该 param 的产品

3. **写入**

### C. 值校验

对传播值做基本合理性检查：
- beam_angle: 1-360
- ip: 匹配 IP\d{2} 模式
- material: 长度 2-50，非纯数字
- driver_type: 长度 2-50，非纯数字
- pf: 0.3-1.0 范围的小数

### D. 写入

```
source_field: "v29.1_file_propagation"
confidence: "medium"
```

### E. 备份

`--apply` 前备份。

### F. 报告

写到 `docs/v29.1-file-category-propagation-report.md`：

```markdown
# V29.1 同文件同品类参数传播报告

## 统计

| param_key | uniform 组合数 | 传播到产品数 | 新增 product_params |
|-----------|-------------|------------|-------------------|

## 按品类 top 20

| 品类 | beam_angle | material | ip | driver_type | pf | 总计 |
|------|-----------|---------|-----|-----------|-----|------|

## 写入样本（每个 param_key 前 5 条）

含文件名 + 品类 + uniform 值 + 被填产品名

## 覆盖率变化

| param_key | 之前 | 新增 | 之后 |
|-----------|------|------|------|

## product_params 总量变化
```

### G. 验证

```bash
npx tsc --noEmit
npx tsx scripts/v29.1-file-category-propagation.ts            # dry-run
npx tsx scripts/v29.1-file-category-propagation.ts --apply     # 写入
```

## 不要做

- 不修改 src/ 文件
- 不修改已有 product_params（只 INSERT）
- uniform 组合必须 100% 一致（不能是 "多数值"）
- 最少 3 个样本才传播（避免 1-2 个产品的巧合一致）
