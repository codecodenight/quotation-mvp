# V11.1 — 反向匹配回填：用 supplier_offers 追溯源文件提取参数

## 背景

当前回填管线（v10.1-param-backfill.ts）是"正向匹配"：扫描 Excel → 找 model column → 用 cell value 查 DB product。但 **3,115 个产品从未被匹配到**——它们在 DB 里有记录、有 source_file_id 链接，但正向匹配找不到它们，因为：

- 导入时 model_no 可能是多列拼接生成的（如 "YMT-10218-500"），Excel cell 里只有 "YMT-10218"
- 导入时从 remark/size 拼了 model_no，原始 Excel model column 格式不同
- 文件被跳过（no model column / no header row）

**关键洞察：** 97% 的缺参数产品可以通过 `supplier_offers.source_file_id` 追溯到源 Excel。这意味着我们知道每个产品来自哪个文件，可以**反向搜索**。

## 前置

```bash
cp prisma/dev.db prisma/dev.db.bak-v11.1
```

## 新建文件：`scripts/v11.1-reverse-match-backfill.ts`

```bash
npx tsx scripts/v11.1-reverse-match-backfill.ts              # dry-run
npx tsx scripts/v11.1-reverse-match-backfill.ts --apply       # 写入
```

### 算法流程

#### 1. 数据加载

```typescript
// 加载缺少关键参数的产品（不限于 watts，提取所有可提取的参数）
// 条件：产品没有任何 excel_column 或 excel_multirow 来源的参数
// 即从未被正向回填匹配到的产品
const targetProducts = await prisma.$queryRaw<TargetProduct[]>`
  SELECT p.id, p.model_no, p.product_name, p.category, p.remark,
         so.source_file_id, so.purchase_price, so.factory_name,
         f.file_name, f.relative_path
  FROM products p
  JOIN supplier_offers so ON so.product_id = p.id AND so.source_file_id IS NOT NULL
  JOIN files f ON f.id = so.source_file_id AND f.file_type = 'excel'
  WHERE NOT EXISTS (
    SELECT 1 FROM product_params pp 
    WHERE pp.product_id = p.id 
    AND pp.source_field IN ('excel_column', 'excel_multirow')
  )
  ORDER BY f.id, p.id
`;
// 按 source_file_id 分组，每个文件只读一次
const productsByFile = groupBy(targetProducts, t => t.source_file_id);
```

#### 2. 文件处理循环

对每个文件：
1. 读取 Excel
2. 检测表头行（使用正向回填的 `detectHeaderRow` 逻辑 + V11.0 的 `detectMultiRowHeader` 逻辑）
3. 如果找到表头，识别参数列
4. 对该文件关联的每个产品，尝试匹配到具体数据行
5. 匹配成功则提取所有可识别的参数

#### 3. 行匹配策略（按优先级）

```typescript
function findProductRow(
  product: TargetProduct,
  dataRows: unknown[][],
  modelColIndex: number | null,
  priceColIndex: number | null,
  headerValues: unknown[],
): { rowIndex: number; confidence: "high" | "medium" } | null {

  // 策略 1：精确 model_no 匹配（在 model column 中）
  if (modelColIndex != null && product.model_no) {
    const exactMatch = dataRows.findIndex(row => {
      const cell = normalizeForMatch(cellToString(row[modelColIndex]));
      const model = normalizeForMatch(product.model_no);
      return cell === model;
    });
    if (exactMatch >= 0) return { rowIndex: exactMatch, confidence: "high" };
  }

  // 策略 2：model_no 包含 cell value 或反向
  // 适用于 "YMT-10218-500" 包含 "YMT-10218"
  if (modelColIndex != null && product.model_no) {
    const modelNorm = normalizeForMatch(product.model_no);
    const partialMatches: number[] = [];
    for (const [i, row] of dataRows.entries()) {
      const cell = normalizeForMatch(cellToString(row[modelColIndex]));
      if (!cell || cell.length < 3) continue;
      if (modelNorm.includes(cell) || cell.includes(modelNorm)) {
        partialMatches.push(i);
      }
    }
    if (partialMatches.length === 1) return { rowIndex: partialMatches[0], confidence: "high" };
  }

  // 策略 3：model_no 片段匹配（去掉尺寸/功率后缀后匹配）
  if (modelColIndex != null && product.model_no) {
    // 去掉常见后缀: -500, -400, -300mm, -18W, _φ87, 等
    const coreModel = extractCoreModel(product.model_no);
    if (coreModel && coreModel.length >= 3) {
      const coreMatches: number[] = [];
      for (const [i, row] of dataRows.entries()) {
        const cell = normalizeForMatch(cellToString(row[modelColIndex]));
        if (!cell) continue;
        if (cell.includes(normalizeForMatch(coreModel)) || normalizeForMatch(coreModel).includes(cell)) {
          coreMatches.push(i);
        }
      }
      if (coreMatches.length === 1) return { rowIndex: coreMatches[0], confidence: "medium" };
    }
  }

  // 策略 4：product_name 在任意列中出现
  // 适用于 product_name 是 Excel 某个 cell 的精确值
  if (product.product_name && product.product_name.length >= 4) {
    const nameNorm = normalizeForMatch(product.product_name);
    for (const [i, row] of dataRows.entries()) {
      for (const cell of row) {
        const cellNorm = normalizeForMatch(cellToString(cell));
        if (cellNorm && cellNorm.length >= 4 && cellNorm === nameNorm) {
          return { rowIndex: i, confidence: "medium" };
        }
      }
    }
  }

  // 策略 5：purchase_price 精确匹配（在 price column 中）
  // 仅当该价格在整个文件中是唯一的时候才使用
  if (priceColIndex != null && product.purchase_price > 0) {
    const priceStr = String(product.purchase_price);
    const priceMatches: number[] = [];
    for (const [i, row] of dataRows.entries()) {
      const cell = cellToString(row[priceColIndex]);
      if (parsePriceValue(cell) === product.purchase_price) {
        priceMatches.push(i);
      }
    }
    if (priceMatches.length === 1) return { rowIndex: priceMatches[0], confidence: "medium" };
  }

  return null;
}
```

#### 4. 核心 model 提取

```typescript
function extractCoreModel(modelNo: string): string | null {
  // 去掉尺寸后缀
  let core = modelNo
    .replace(/[-_]\d+(?:mm|cm|寸|inch(?:es)?|")/gi, "")   // -500mm, -3寸
    .replace(/[-_]\d+[Ww]$/g, "")                          // -18W
    .replace(/[-_]φ?\d+(?:[*×]\d+)?(?:mm)?$/g, "")        // _φ87, -87*65mm
    .replace(/[-_](?:圆形?|方形?|round|square)$/gi, "")   // -圆形
    .trim();
  
  // 如果去掉太多（只剩1-2字符），返回 null
  if (core.length < 3) return null;
  return core;
}
```

#### 5. Price column 检测

```typescript
function findPriceColumn(headerValues: unknown[]): number | null {
  const PRICE_PATTERNS = [
    /price/i, /单价/i, /含税/i, /报价/i, /fob/i,
    /unit\s*price/i, /rmb/i, /usd/i
  ];
  for (const [i, val] of headerValues.entries()) {
    const norm = normalizeHeader(cellToString(val));
    if (PRICE_PATTERNS.some(p => p.test(norm))) return i;
  }
  return null;
}

function parsePriceValue(cell: string): number | null {
  const cleaned = cell.replace(/[¥￥$,，\s]/g, "");
  const match = cleaned.match(/(\d+(?:\.\d+)?)/);
  return match ? parseFloat(match[1]) : null;
}
```

#### 6. 表头检测

复用已有逻辑，按优先级：
1. 先尝试 `detectMultiRowHeader`（V11.0 逻辑）
2. 再尝试 `detectStandardHeader`（标准逻辑：最多非空单元格的行）
3. 如果都找不到 model column，仍然继续——用策略 4/5（product_name/price）匹配

```typescript
function detectBestHeader(rows: unknown[][]): {
  headerValues: unknown[];
  dataStartRow: number;
  modelColIndex: number | null;
  priceColIndex: number | null;
} {
  // 尝试多行表头
  const multi = detectMultiRowHeader(rows);
  if (multi) {
    const modelCol = findModelColumn(multi.mergedValues);
    const priceCol = findPriceColumn(multi.mergedValues);
    return {
      headerValues: multi.mergedValues,
      dataStartRow: (multi.subRow ?? multi.mainRow) + 1,
      modelColIndex: modelCol,
      priceColIndex: priceCol,
    };
  }

  // 尝试标准表头
  let bestRow: unknown[] | null = null;
  let bestCount = 0;
  let bestIndex = 0;
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const row = rows[i] ?? [];
    const count = row.filter(c => cellToString(c)).length;
    if (count >= 3 && count > bestCount) {
      bestRow = row;
      bestCount = count;
      bestIndex = i;
    }
  }
  if (bestRow) {
    return {
      headerValues: bestRow,
      dataStartRow: bestIndex + 1,
      modelColIndex: findModelColumn(bestRow),
      priceColIndex: findPriceColumn(bestRow),
    };
  }

  return { headerValues: [], dataStartRow: 0, modelColIndex: null, priceColIndex: null };
}
```

#### 7. 参数提取

复用 V11.0 的 `findParamColumns` + `HEADER_TO_PARAM` + `normalizeParamValue`。

对每个匹配到的行，提取所有可识别的参数列值：

```typescript
for (const col of paramColumns) {
  const rawValue = cellToString(row[col.index]);
  if (!isUsefulParamValue(rawValue)) continue;
  const key = `${product.id}\0${col.paramKey}`;
  if (existingParamKeys.has(key)) continue;
  
  plannedParams.push({
    productId: product.id,
    paramKey: col.paramKey,
    rawValue,
    normalizedValue: normalizeParamValue(col.paramKey, rawValue).normalizedValue,
    unit: normalizeParamValue(col.paramKey, rawValue).unit,
    sourceField: "reverse_match",
    confidence: matchResult.confidence === "high" ? "high" : "medium",
  });
  existingParamKeys.add(key);
}
```

#### 8. 排除规则

```typescript
// 跳过伟润铝材套件（已确认数据天花板）
if (/伟润.*铝材套件/i.test(file.fileName)) continue;

// 跳过灯管（结构太特殊）
if (product.category === "灯管") continue;

// product_name 垃圾检测——如果产品本身是垃圾，不浪费时间匹配
function isLikelyJunk(product: TargetProduct): boolean {
  const name = product.product_name;
  if (/^US?\$[\d.]+$/.test(name)) return true;   // "US$2.91"
  if (/^\d+(?:pcs|sets|pieces|套|条)$/i.test(name)) return true;  // "600sets"
  if (/^N\.W\.|^G\.W\./i.test(name)) return true; // weight entries
  if (/^\d+[*×]\d+[*×]\d+\s*cm$/i.test(name)) return true; // "38*21.5*19cm"
  if (/^包装方式|^外箱|^产品标贴/i.test(name)) return true;
  return false;
}
```

### 报告：`docs/v11.1-reverse-match-report.md`

```markdown
# V11.1 反向匹配回填报告

模式: dry-run / apply
时间: ...

## 汇总

| 指标 | 数值 |
|---|---:|
| 目标产品数（从未被正向回填匹配） | X |
| 跳过（铝材套件/灯管/垃圾） | X |
| 扫描文件数 | X |
| 匹配成功 - high confidence | X |
| 匹配成功 - medium confidence | X |
| 匹配失败 | X |
| 新增参数 | X |
| 跳过（已存在） | X |
| product_params 变化 | 前 → 后 |

## 按品类统计

| 品类 | 目标产品 | high匹配 | medium匹配 | 失败 | 新增参数 |

## 按匹配策略统计

| 策略 | 匹配数 | 占比 |
|---|---:|---:|
| 策略1: 精确 model_no | X | X% |
| 策略2: model_no 互包含 | X | X% |
| 策略3: 核心 model 片段 | X | X% |
| 策略4: product_name 精确 | X | X% |
| 策略5: price 唯一匹配 | X | X% |

## 按 param_key 统计

| param_key | 新增记录 | 覆盖产品数 |

## 匹配采样（前 50 条）

| 品类 | model_no | 匹配策略 | confidence | 文件名 | 提取 param_key |

## 未匹配采样（前 30 条）

| 品类 | model_no | product_name(前50字) | 文件名 | 尝试的策略 |
```

---

## Commit

```
V11.1: reverse-match backfill via supplier_offers source file links

- New v11.1-reverse-match-backfill.ts
- Reverse matching: product → source file → row → params
- 5 matching strategies: exact model, partial model, core model fragment, product_name, unique price
- Targets 3,115 products never matched by forward backfill
- Skips aluminum profiles (data ceiling) and junk products
- Re-run derive and audit
```

## 重跑管线

```bash
npx tsx scripts/v11.1-reverse-match-backfill.ts --apply
npx tsx scripts/v10.4-derive-params.ts --apply
npx tsx scripts/v10.0-source-audit.ts
```

## 不做什么

- 不改现有脚本（v10.1, v11.0）
- 不删产品（垃圾清理是 V11.2 的任务）
- 不改 Prisma schema
- 不改前端
- 不创建新产品
- 不处理灯管
- 不处理铝材套件（确认为数据天花板）
- 不修改源 Excel 文件
