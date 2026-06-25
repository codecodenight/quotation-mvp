# V25.4: UNMATCHABLE 979 条精细诊断 — 只读审计

## Goal

V25.1 把 979 个产品归入 UNMATCHABLE（有 watts 列但匹配失败）。本任务做更精细的诊断：为什么匹配失败？哪些是 ambiguous（多行匹配），哪些是 no-match？按文件输出可操作的建议。

**只读审计，不写数据库。**

## Context

- UNMATCHABLE 的两类失败原因：
  - `ambiguous row matches`：product 匹配到 ≥2 行，无法确定
  - `no matching source row found`：product 在文件中找不到
- 最大的 UNMATCHABLE 来源：磁吸灯 329、面板灯 145、灯带 131

## Script

写 `scripts/v25.4-unmatchable-diagnostic.ts`，纯只读。

### A. 数据加载

与 V25.1 相同方式查询缺 watts 产品 + source_file_id，但只处理在 V25.1 中被标记为 UNMATCHABLE 的。

实际做法：重跑 V25.1 匹配逻辑，但只输出 UNMATCHABLE 的详细诊断信息（不需要 import V25.1，可以独立实现简化版匹配）。

### B. 诊断信息

对每个 UNMATCHABLE 产品，输出：

1. **失败类型**：`ambiguous` 或 `no_match`
2. **如果 ambiguous**：
   - 列出匹配到的所有行号 + 该行的型号列值 + watts 值
   - 说明为什么无法消歧（例如型号完全相同的多行，不同 sheet 的多行）
3. **如果 no_match**：
   - 列出产品的 model_no 和 product_name
   - 列出该文件所有 sheet 的型号列样本值（前 5 个），方便人工判断差异

### C. 报告

写到 `docs/v25.4-unmatchable-diagnostic-report.md`：

```markdown
# V25.4 UNMATCHABLE 诊断报告

## 总览
- UNMATCHABLE 产品数: 979
- ambiguous: N
- no_match: N

## 按文件统计

| 文件名 | 品类 | 总 UNMATCHABLE | ambiguous | no_match | 该文件有 watts 列 |
|--------|------|----------------|-----------|----------|-----------------|
| ... |

## ambiguous 详细样本（前 30 条）

| 品类 | model_no | 源文件 | 匹配行数 | 行号 | 各行 watts 值 |
|------|----------|--------|---------|------|-------------|
| ... |

## no_match 详细样本（前 30 条）

| 品类 | model_no | product_name | 源文件 | 文件型号列样本 |
|------|----------|-------------|--------|-------------|
| ... |

## 可操作建议

### 高收益文件（ambiguous ≥ 10 且有 watts 列的文件）
- 建议：考虑在匹配逻辑中增加 purchase_price 作为消歧维度

### no_match 模式分析
- 列出 model_no 与文件型号列值的常见差异模式
  例如：DB 里 "XY-5103 - 3W" vs Excel 里 "SY-5103/3W"（前缀不同 + 分隔符不同）

## 说明
- 本报告只读数据库和源 Excel 文件
```

### D. 控制台输出

JSON 摘要。

### E. 验证

```bash
npx tsc --noEmit
npx tsx scripts/v25.4-unmatchable-diagnostic.ts
```

## 不要做

- **不写 product_params 表**
- **不备份数据库**（因为不写）
- 不修改任何 src/ 文件
