# V25.1: Watts 缺口回源审计 — 只读分析，不写数据库

## Goal

对全部 3,688 个缺 watts 的产品（有 source_file_id 的），逐个回源 Excel 文件，分类为三个桶：

- **RECOVERABLE**：能匹配到 Excel 行，且该行有功率值可提取
- **NO_WATTS_IN_SOURCE**：能匹配到 Excel 行（或文件本身无功率列），源数据没有 watts
- **UNMATCHABLE**：有 source_file_id 但无法在 Excel 中找到对应行

这是只读审计脚本，**不写任何数据**。

## Context

- V23.0 匹配率 43%（4,086/9,542），但 watts 只新增 11 条
- `supplier_offers` 有 `source_file_id` 但没有 `source_row_index` / `source_sheet_name`
- 缺 watts 产品约 3,688 个，分布在 ~300 个源文件
- DB 位置：`prisma/dev.db`，**本脚本不备份（因为不写库）**

## Script

写 `scripts/v25.1-watts-gap-audit.ts`，用 `tsx` 执行。**纯只读，不接受 --apply 参数。**

### A. 数据加载

```sql
-- 查询所有缺 watts 且有 source_file_id 的产品
SELECT p.id AS product_id, p.product_name, p.model_no, p.category,
       so.source_file_id, so.factory_name, so.purchase_price,
       f.file_name, f.absolute_path_snapshot
FROM products p
JOIN supplier_offers so ON so.product_id = p.id
JOIN files f ON f.id = so.source_file_id
WHERE NOT EXISTS (
  SELECT 1 FROM product_params pp WHERE pp.product_id = p.id AND pp.param_key = 'watts'
)
ORDER BY f.file_name, p.product_name
```

按 `source_file_id` 分组，每个文件只读一次。

### B. Excel 文件分析

对每个文件：

1. 读取所有 sheet
2. 对每个 sheet，扫描前 10 行找表头行（≥ 3 个非空 cell）
3. 检测**宽松 watts 列**——不仅匹配 V23.0 的 `watt|power|功率` pattern，还要额外匹配：
   - `光源` — 风扇灯常用，值如 "2*48W三色变光"
   - `Lamp` — 坎灯文件用，值如 "SMD 5630 3W" 或 "3W"
   - `规格` / `spec` — 有时功率嵌在规格描述里
   - `描述` / `description` — 同上
4. 记录文件级别信息：
   - `hasWattsColumn: boolean` — 是否有直接/间接 watts 列
   - `wattsColumnHeaders: string[]` — 匹配到的列头名
   - `sheetsAnalyzed: number`

### C. 产品→Excel 行匹配

对每个缺 watts 的产品：

1. **精确匹配**（与 V23.0 相同）：model_no 或 product_name 与某行的型号列精确匹配（忽略空格/大小写）
2. **宽松匹配**（新增）：
   - 去掉 model_no 中的空格、横杠、斜杠后 substring 匹配
   - product_name 去掉颜色后缀（白/黑/灰/银）后匹配
   - **限制**：只在同一个 source_file_id 的文件内匹配，不跨文件
3. 匹配到行后，检查该行是否有 watts 值：
   - 直接 watts 列：提取数字
   - 间接列（光源/Lamp/规格）：用 `/(\d+(?:\.\d+)?)\s*[Ww]/` 从值中提取
   - 有值 → RECOVERABLE
   - 列存在但值为空或不含数字 → NO_WATTS_IN_SOURCE
4. 匹配不到 → UNMATCHABLE

### D. 报告

写到 `docs/v25.1-watts-gap-audit-report.md`：

```markdown
# V25.1 Watts 缺口回源审计报告

## 总览
- 缺 watts 产品总数: N（有 source_file_id）
- 无 source_file_id 的缺 watts 产品: M
- 源文件总数: N
- 有 watts 列的文件: N
- 无 watts 列的文件: N

## 三桶分类

| 桶 | 产品数 | 占比 |
|----|--------|------|
| RECOVERABLE | N | % |
| NO_WATTS_IN_SOURCE | N | % |
| UNMATCHABLE | N | % |

## 按品类拆分

| 品类 | 总缺 | RECOVERABLE | NO_WATTS | UNMATCHABLE |
|------|------|-------------|----------|-------------|
| 线条灯 | 867 | N | N | N |
| 筒灯 | 581 | N | N | N |
| ... | | | | |

## RECOVERABLE 明细（前 50 个样本）

| 品类 | product_name | model_no | 源文件 | sheet | 匹配方式 | 提取值 |
|------|-------------|----------|--------|-------|---------|--------|
| ... |

## NO_WATTS_IN_SOURCE 文件列表

| 文件名 | 缺 watts 产品数 | 品类 | 表头预览 |
|--------|-----------------|------|---------|
| 伟润线性铝材套件... | 491 | 线条灯 | 型号/CAD尺寸/规格/铝材重量... |
| ... |

## UNMATCHABLE 样本（前 50 个）

| 品类 | product_name | model_no | 源文件 | 匹配失败原因 |
|------|-------------|----------|--------|-------------|
| ... |

## 宽松匹配 vs 精确匹配统计

| 匹配方式 | RECOVERABLE 数 |
|---------|---------------|
| 精确匹配 | N |
| 宽松匹配 | N |

## 结论与建议
（脚本自动生成：基于三桶比例，给出下一步建议）
```

### E. 控制台输出

JSON 格式摘要（与之前脚本一致），包含三桶数量和 reportPath。

## 验证

```bash
npx tsc --noEmit
# 脚本直接跑（无需 --apply，默认就是只读）
npx tsx scripts/v25.1-watts-gap-audit.ts
```

不需要 vitest（纯审计脚本，不改 src/）。

## 不要做

- **不写 product_params 表**
- **不备份数据库**（因为不写）
- 不修改任何 src/ 文件
- 不修改 schema
- 不创建新的 migration
