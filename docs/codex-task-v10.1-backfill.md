# V10.1 — 从源 Excel 回填产品参数

## 目标

遍历所有有关联产品的源 Excel 文件，读取表头列名，把列值回填到 `product_params` 表。只补充新参数，不覆盖已有参数。

## 背景

V10.0 审计发现：
- 光效出现在 181 个文件 → DB 只覆盖 4% 产品
- CRI 出现在 148 个文件 → DB 只覆盖 8%
- PF 出现在 140 个文件 → DB 只覆盖 9%
- driver_type 出现在 63 个文件 → DB 覆盖 0%

原因是导入管线只读了价格/型号/尺寸/备注列，Excel 里其他列从未入库。

10,024 个产品可通过 `supplier_offers.source_file_id` 追溯到源文件。

## 前置

- 先备份数据库：`cp prisma/dev.db prisma/dev.db.bak-v10.1`

## 实现

### 脚本：`scripts/v10.1-param-backfill.ts`

支持两种模式：
```bash
npx tsx scripts/v10.1-param-backfill.ts              # dry-run（默认）
npx tsx scripts/v10.1-param-backfill.ts --apply       # 写入 DB
```

### 整体流程

```
对每个有关联产品的源文件 {
  1. 读 Excel，检测表头行
  2. 从表头识别：型号列 + 参数列（复用 V10.0 的 HEADER_TO_PARAM 映射）
  3. 从 DB 获取该文件关联的所有 (product_id, model_no, product_name, purchase_price)
  4. 对每个数据行 {
     a. 取型号列的值，归一化
     b. 匹配到哪个 product（见匹配策略）
     c. 如果匹配成功，提取每个参数列的值
     d. 跳过已有的 param（同 product_id + param_key）
     e. 记录待插入的 params
  }
}
批量插入 product_params
生成报告
```

### 表头检测

复用 V10.0 审计脚本的逻辑：
- 扫描前 10 行，找非空单元格最多且 ≥ 5 个的行作为表头
- 列名归一化：trim、去换行、去括号后缀

### 列名→param_key 映射

直接复用 V10.0 的 `HEADER_TO_PARAM` 常量（完整映射表见 `scripts/v10.0-source-audit.ts` 第 131-228 行）。复制过来或抽取到共享模块都行。

只处理映射到 param_key 的列。未识别列跳过。

### 型号列识别

表头匹配以下模式的列作为型号列（取第一个匹配的）：
- `item no` / `model` / `型号` / `product no` / `编号`

如果找不到型号列，跳过该 sheet，记录跳过原因。

### 行→产品匹配策略

对每个文件，预加载该文件关联的产品列表：

```sql
SELECT DISTINCT p.id, p.model_no, p.product_name, so.purchase_price
FROM supplier_offers so
JOIN products p ON p.id = so.product_id
WHERE so.source_file_id = ?
```

归一化函数（用于匹配）：
```typescript
function normalizeForMatch(text: string): string {
  return text
    .replace(/[\r\n]+/g, " ")  // 换行→空格
    .replace(/\s+/g, " ")       // 合并空格
    .trim()
    .toLowerCase();
}
```

匹配逻辑（按优先级）：
1. **精确匹配**：`normalizeForMatch(excelModelValue) === normalizeForMatch(product.model_no)`
2. **包含匹配**：归一化后的 Excel 值包含 product.model_no，或反过来
3. **product_name 匹配**：同上逻辑对 product_name

如果匹配到多个产品，取最长匹配的那个。如果仍然有多个，跳过该行（宁可漏不可错）。

### 参数值提取

对匹配成功的行，遍历所有已识别的参数列：

```typescript
const cellValue = String(row[columnIndex] ?? "").trim();
if (!cellValue || cellValue === "-" || cellValue === "/") continue;
```

对每个参数值做归一化：
- `watts`：提取数字部分，去掉 "W" "w" 后缀 → `normalizedValue = "36"`, `unit = "W"`
- `luminous_efficacy`：提取数字，去掉 "lm/w" 等 → `normalizedValue = "160"`, `unit = "lm/W"`
- `lumens`：提取数字，去掉 "lm" "LM" → `normalizedValue = "2880"`, `unit = "lm"`
- `cct`：提取数字，去掉 "K" → `normalizedValue = "6500"`, `unit = "K"`
- `cri`：提取数字，去掉 ">" → `normalizedValue = "80"`, `unit = null`
- `pf`：提取数字，去掉 ">≥" → `normalizedValue = "0.9"`, `unit = null`
- `ip`：提取数字 → `normalizedValue = "65"`, `unit = null`
- `beam_angle`：提取数字，去掉 "°" → `normalizedValue = "120"`, `unit = "°"`
- `voltage`：保留原文（如 "220-240V"）→ `normalizedValue = "220-240"`, `unit = "V"`
- `driver_type` / `flicker` / `material` / `warranty` / `certification`：原文保留，`normalizedValue = cellValue`
- 其他：原文保留

参考现有 `extract-params.ts` 里的归一化逻辑（如 `extractCommonWatts`、`extractCommonCCT` 等正则），但不需要完全复制——这里是从独立列读值，格式比从 remark 里正则提取要干净得多。

### 去重

插入前检查：同一个 `(product_id, param_key)` 如果 DB 里已经有记录，**跳过**。

```sql
SELECT product_id, param_key FROM product_params
WHERE product_id IN (?) AND param_key IN (?)
```

批量预加载，不要逐条查询。

### 写入

```typescript
// 每个待插入的 param
{
  id: randomUUID(),
  product_id: matchedProductId,
  param_key: paramKey,
  raw_value: cellValue,            // Excel 原始单元格值
  normalized_value: normalizedVal, // 归一化后的值
  unit: unit,
  source_field: "excel_column",    // 新增来源标记，区别于现有的 "remark"/"size" 等
  confidence: "high",              // 直接从 Excel 列读取，置信度高
}
```

用 Prisma `createMany` 批量插入，每 500 条一批。

### 报告：`docs/v10.1-backfill-report.md`

```markdown
# V10.1 参数回填报告

模式: dry-run / apply
时间: ...

## 汇总

| 指标 | 数值 |
|---|---|
| 扫描文件数 | X |
| 跳过文件（无型号列）| Y |
| 扫描数据行 | X |
| 匹配成功行 | X |
| 匹配失败行 | X |
| 待插入新参数 | X |
| 跳过（已存在）| X |
| 实际插入 | X（dry-run 时为 0）|
| product_params 变化 | 前 37,416 → 后 ? |

## 按 param_key 统计

| param_key | 新增记录数 | 覆盖新产品数 | 覆盖率变化（旧→新）|

## 按品类统计

| 品类 | 匹配行数 | 新增参数数 |

## 匹配失败采样（前 50 行）

| 文件名 | Sheet | 行号 | Excel 型号值 | 跳过原因 |

## 跳过文件列表

| 文件名 | 原因 |
```

## 运行

```bash
# 1. 备份
cp prisma/dev.db prisma/dev.db.bak-v10.1

# 2. Dry-run
npx tsx scripts/v10.1-param-backfill.ts

# 3. 检查报告
# 确认匹配率、新增参数数量合理

# 4. 正式执行
npx tsx scripts/v10.1-param-backfill.ts --apply
```

## 验证

1. dry-run 模式不修改 DB（前后 product_params count 不变）
2. 匹配率 > 50%（匹配成功行 / 总数据行）
3. 新增参数中 watts 补充最多（目标从 47% 提到 70%+）
4. luminous_efficacy 从 4% 显著提升
5. driver_type 从 0% 有新增
6. 报告生成且可读
7. apply 后用 SQL 抽查几个产品的新参数是否正确

## 不做什么

- 不处理 100 个无关联产品的文件（那些文件的数据从未导入，需要完整的产品导入流程，不是参数回填能解决的）
- 不修改现有参数值（只补充新的）
- 不改 Schema
- 不改前端或搜索逻辑

## Commit

`V10.1: backfill product params from source Excel column values`
