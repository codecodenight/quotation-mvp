# V10.2 + V10.4 + V10.5 批次 A — 回填管线修复 + 派生参数 + 终极审计

三阶段顺序执行，一次跑完不停。

- 阶段一 = V10.2：修复回填管线
- 阶段二 = V10.4：派生参数补全
- 阶段三 = V10.5：重跑审计出最终覆盖率

## 前置

```bash
cp prisma/dev.db prisma/dev.db.bak-v10.2
```

---

## 阶段一：修复回填管线

改动文件：`scripts/v10.1-param-backfill.ts`

### 1. 扩展 MODEL_HEADER_PATTERNS（第 141 行）

当前值：
```typescript
const MODEL_HEADER_PATTERNS = [/item\s*no/i, /model/i, /型号/i, /product\s*no/i, /编号/i, /款号/i];
```

替换为：
```typescript
const MODEL_HEADER_PATTERNS = [
  /item\s*no/i,
  /model/i,
  /型号/i,
  /product\s*no/i,
  /编号/i,
  /款号/i,
  /^item$/i,
  /^product\s*name$/i,
  /^产品名称$/i,
  /^品名$/i,
  /^名称$/i,
  /^specifications?$/i,
  /^description$/i,
];
```

后五个是 fallback——当没有真正的型号列时，用产品名/规格列作为匹配键。现有 `matchProduct` 已经在第三优先级用 `productName` 做 contains 匹配，所以这些列的值能被匹配逻辑处理。

### 2. 降低 MIN_HEADER_CELLS

第 14 行：
```typescript
const MIN_HEADER_CELLS = 5;
```
改为：
```typescript
const MIN_HEADER_CELLS = 3;
```

原因：审计报告显示 "产品目录-价格-2024.4.14.xlsx" 的 18 个 sheet 全部因为 "no header row with >= 5 cells" 被跳过。这些 sheet 列数少但有有效数据。

### 3. Sheet 名作为型号的 fallback

在 `scanFile` 函数中，`findModelColumn` 返回 null 之后、push skippedSheet 之前（约第 447-449 行），插入一个 fallback 分支：

```typescript
// 原代码：
// if (modelColumnIndex == null) {
//   result.skippedSheets.push(...);
//   continue;
// }

// 改为：
if (modelColumnIndex == null) {
  // Fallback: try using sheet name as model identifier
  const sheetModelResult = trySheetNameAsModel(
    sheetName, file, header, rows.slice(header.rowIndex + 1),
    existingParamKeys, plannedParams, matchFailures, result
  );
  if (!sheetModelResult) {
    result.skippedSheets.push({ fileName: file.fileName, sheetName, reason: "no model column" });
  }
  continue;
}
```

新增函数 `trySheetNameAsModel`：

```typescript
function trySheetNameAsModel(
  sheetName: string,
  file: SourceFile,
  header: HeaderInfo,
  dataRows: unknown[][],
  existingParamKeys: Set<string>,
  plannedParams: PlannedParam[],
  matchFailures: MatchFailure[],
  result: FileResult,
): boolean {
  const normalizedSheet = normalizeForMatch(sheetName);
  if (normalizedSheet.length < 2) return false;

  // Check if any linked product's model_no starts with or contains the sheet name
  const candidateProducts = file.products.filter((p) => {
    const nm = normalizeForMatch(p.modelNo ?? "");
    return nm.length >= 2 && (nm.startsWith(normalizedSheet) || normalizedSheet.startsWith(nm));
  });
  if (candidateProducts.length === 0) return false;

  const paramColumns = findParamColumns(header.values, -1); // -1 = no model column to exclude
  if (paramColumns.length === 0) return false;

  // Find watts column for composite model construction
  const wattsColumn = paramColumns.find((c) => c.paramKey === "watts");
  let matchedAny = false;

  for (const [offset, row] of dataRows.entries()) {
    if (isBlankRow(row)) continue;
    const rowNumber = header.rowIndex + 2 + offset;

    // Construct composite model: sheetName + watts value (e.g., "LLS-A" + "10W" → "LLS-A-10W")
    let compositeModel = sheetName;
    if (wattsColumn) {
      const wattsRaw = cellToString(row[wattsColumn.index]);
      const wattsNum = wattsRaw.replace(/[^\d.]/g, "");
      if (wattsNum) {
        compositeModel = `${sheetName}-${wattsNum}W`;
      }
    }

    result.scannedRows += 1;
    const matched = matchProduct(compositeModel, candidateProducts);
    if (!matched.product) {
      // Also try just sheet name
      const fallback = matchProduct(sheetName, candidateProducts);
      if (!fallback.product) {
        result.failedRows += 1;
        pushFailure(matchFailures, file.fileName, sheetName, rowNumber, compositeModel, matched.reason || "no product match via sheet name");
        continue;
      }
      matched.product = fallback.product;
    }

    matchedAny = true;
    result.matchedRows += 1;

    for (const column of paramColumns) {
      const rawValue = cellToString(row[column.index]);
      if (!isUsefulParamValue(rawValue)) continue;
      const key = productParamKey(matched.product.productId, column.paramKey);
      if (existingParamKeys.has(key)) {
        result.existingParamsSkipped += 1;
        continue;
      }
      const normalized = normalizeParamValue(column.paramKey, rawValue);
      plannedParams.push({
        id: randomUUID(),
        productId: matched.product.productId,
        productModel: matched.product.modelNo ?? "",
        productName: matched.product.productName,
        category: matched.product.category ?? "(未分类)",
        sourceFileId: file.id,
        fileName: file.fileName,
        sheetName,
        rowNumber,
        header: column.header,
        paramKey: column.paramKey,
        rawValue,
        normalizedValue: normalized.normalizedValue,
        unit: normalized.unit,
      });
      existingParamKeys.add(key);
      result.plannedParams += 1;
    }
  }

  return matchedAny;
}
```

注意：`findParamColumns(header.values, -1)` 需要处理 modelColumnIndex = -1 的情况。当前代码第 569 行 `if (index === modelColumnIndex) continue;` 在 index 永远不等于 -1 时不会跳过任何列，这是正确行为。

### 4. 改进 "multiple matches" 消歧

修改 `matchProduct` 函数（第 585 行起），增加一个可选参数 `rowContext`：

```typescript
type RowContext = {
  wattsValue?: string;    // 同行 watts 列的值
  rowValues?: unknown[];  // 整行数据
  paramColumns?: ParamColumn[];
};
```

在 `chooseLongestUnique` 返回 tie 时，如果有 rowContext.wattsValue，用 watts 值做二次过滤：

```typescript
// 在 matchProduct 末尾，当所有三个优先级都返回 tie 时：
// 如果 rowContext 有 wattsValue，过滤候选产品
if (rowContext?.wattsValue) {
  const wattsNorm = rowContext.wattsValue.replace(/[^\d.]/g, "");
  if (wattsNorm) {
    const wattsFiltered = allTiedProducts.filter((p) => {
      const nm = normalizeForMatch(p.modelNo ?? "") + " " + normalizeForMatch(p.productName);
      return nm.includes(wattsNorm + "w") || nm.includes(wattsNorm + " w");
    });
    if (wattsFiltered.length === 1) {
      return { product: wattsFiltered[0], reason: "" };
    }
  }
}
```

在 `scanFile` 的数据行循环中（第 480 行），传入 rowContext：

```typescript
// 构建 rowContext
const wattsCol = paramColumns.find((c) => c.paramKey === "watts");
const rowContext: RowContext = {};
if (wattsCol) {
  rowContext.wattsValue = cellToString(row[wattsCol.index]);
}
const matched = matchProduct(excelModel, file.products, rowContext);
```

### 5. 补充 HEADER_TO_PARAM

在 HEADER_TO_PARAM 对象（第 169-266 行）中添加以下条目：

```typescript
// cct — "Color Temperature" 出现在 21 个文件
"color temperature": "cct",

// beam_angle — "Angle" 出现在 17 个文件，"角度" 出现在 13 个文件
"angle": "beam_angle",
"角度": "beam_angle",
"发光角度": "beam_angle",

// cri — "显值" 出现在 11 个文件
"显值": "cri",

// driver_type — "驱动方案" 出现在 15 个文件
"驱动方案": "driver_type",
"驱动类型": "driver_type",

// ambient_temp — "Working temperature" 出现在 13 个文件
"working temperature": "ambient_temp",
"工作温度": "ambient_temp",

// size_display — 多个未映射的尺寸表头
"成品尺寸": "size_display",
"灯体尺寸": "size_display",
"灯具尺寸": "size_display",
"整灯尺寸": "size_display",

// led_type — "灯珠" / "灯珠类型" 出现在 17+ 个文件
"灯珠": "led_type",
"灯珠类型": "led_type",

// color — "颜色" / "Body Color" 出现在 15-20 个文件
"颜色": "color",
"body color": "color",
"color": "color",
```

### 6. 修复 "luminous flux" 映射错误

第 200 行：
```typescript
"luminous flux": "luminous_efficacy",
```
改为：
```typescript
"luminous flux": "lumens",
```

光通量（Luminous Flux）的单位是流明（lm），不是光效（lm/W）。这是一个数据质量 bug。

### 7. 更新报告路径

第 11 行：
```typescript
const REPORT_PATH = path.join("docs", "v10.1-backfill-report.md");
```
改为：
```typescript
const REPORT_PATH = path.join("docs", "v10.2-backfill-report.md");
```

### 运行

```bash
npx tsx scripts/v10.1-param-backfill.ts --apply
```

### 验证

- 跳过 sheet 数应从 1,203 显著下降（目标 < 600）
- 新增参数数应 > V10.1 的 6,451
- 报告生成到 `docs/v10.2-backfill-report.md`

---

## 阶段二：派生参数补全

### 新建文件：`scripts/v10.4-derive-params.ts`

⚠️ **绝对不能用 extract-params.ts**——它会 `deleteMany` 清空品类下所有已有参数（包括 V10.1/V10.2 回填的高质量 excel_column 数据）。这个脚本只能 INSERT，不能 DELETE。

```bash
npx tsx scripts/v10.4-derive-params.ts              # dry-run（默认）
npx tsx scripts/v10.4-derive-params.ts --apply       # 写入
```

### 功能

#### Step 1：从 product_name / model_no 提取 watts

```
查出所有没有 watts 参数的产品（product_params 中无 param_key='watts'）。

对每个产品 {
  text = product.product_name
  matches = text.matchAll(/(?<![A-Za-z0-9])(\d+(?:\.\d+)?)\s*W(?![A-Za-z0-9])/gi)

  过滤掉上下文包含 "最大功率|总功率|max power|total power|连接最大|可连接" 的匹配

  if (matches.length === 0) {
    text = product.model_no
    重新匹配
  }

  if (matches.length > 0) {
    取第一个匹配的数字部分
    插入 product_param:
      param_key = "watts"
      raw_value = match[0]
      normalized_value = 提取的数字
      unit = "W"
      source_field = text来源是product_name则"product_name"，是model_no则"model_no"
      confidence = "medium"
  }
}
```

#### Step 2：从 watts + lumens 派生 luminous_efficacy

```
查出所有同时有 watts 和 lumens 参数，但没有 luminous_efficacy 参数的产品。

对每个产品 {
  wattsVal = parseFloat(watts.normalized_value)
  lumensVal = parseFloat(lumens.normalized_value)

  // 跳过范围值（如 "10-20"）和无效值
  if (isNaN(wattsVal) || isNaN(lumensVal) || wattsVal <= 0) continue

  efficacy = lumensVal / wattsVal

  // 合理性检查：LED 光效一般在 10-300 lm/W 范围内
  if (efficacy < 10 || efficacy > 300) continue

  插入 product_param:
    param_key = "luminous_efficacy"
    raw_value = `${lumensVal}lm/${wattsVal}W`
    normalized_value = Math.round(efficacy).toString()
    unit = "lm/W"
    source_field = "derived"
    confidence = "medium"
}
```

#### 去重

预加载所有目标产品的现有 (product_id, param_key) 组合。只插入不存在的组合。

#### 写入

用 `prisma.productParam.createMany`，500 条一批。每条记录 `id = randomUUID()`。

### 报告：`docs/v10.4-derive-report.md`

```markdown
# V10.4 派生参数补全报告

模式: dry-run / apply
时间: ...

## 汇总

| 指标 | 数值 |
|---|---:|
| 无 watts 产品数 | X |
| 从 product_name 提取 watts | X |
| 从 model_no 提取 watts | X |
| 可派生 efficacy 的产品数 | X |
| 派生 luminous_efficacy | X |
| 总新增参数 | X |
| product_params 变化 | 前 → 后 |

## 按品类统计

| 品类 | 新增 watts | 新增 efficacy |
|---|---:|---:|

## watts 提取采样（前 50 条）

| 产品型号 | 品类 | product_name | 提取值 |

## efficacy 派生采样（前 50 条）

| 产品型号 | 品类 | lumens | watts | 派生光效 |
```

### 运行

```bash
npx tsx scripts/v10.4-derive-params.ts --apply
```

---

## 阶段三：终极审计

### 运行

```bash
npx tsx scripts/v10.0-source-audit.ts
```

这会覆盖 `docs/v10.0-audit-report.md`，生成包含 V10.2 + V10.4 改进后的最新覆盖率数据。

### 验证

Section III（品类 × 参数矩阵）中：
- watts 整体覆盖率目标 > 70%
- luminous_efficacy 目标 > 15%
- 其他参数应有可见提升

---

## Commit

一次提交：

```
V10.2: fix backfill pipeline, derive params, re-audit coverage

- Expand model column detection patterns
- Add sheet-name-as-model fallback for sheets without model columns
- Improve disambiguation for short model names using watts context
- Add 20+ new header-to-param mappings
- Fix "luminous flux" mismapping (was efficacy, should be lumens)
- Lower MIN_HEADER_CELLS from 5 to 3
- New v10.4-derive-params.ts: extract watts from product_name, derive efficacy from watts+lumens
- Re-run source audit with updated coverage
```

## 不做什么

- 不修改 `extract-params.ts`（它会删除已有参数）
- 不导入新产品（V10.3 批次 B 的工作）
- 不改 Prisma schema
- 不改前端 / API / 搜索逻辑
- 不处理 100 个未关联文件
