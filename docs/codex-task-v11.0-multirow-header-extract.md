# V11.0 — 多行表头文件参数提取

## 目标

当前回填管线跳过 788 个 sheet（"no model column"），其中大量面板灯/筒灯文件实际上有丰富的参数数据。根因：`detectHeaderRow` 选非空单元格最多的行，在多行表头文件中选中了**子标题行**（如 "PS", "Glass", "Out Size", "Cut Size"...），跳过了包含 "型号" 的**主标题行**。

典型文件结构：

```
Row 0: ["合金小面板灯参数报价表 LED Panel Light Price"]
Row 1: ["客户名称："]
Row 2: ["非隔离窄压驱动..., LED:2835 22-24 lm, GLASS/PS/PMMA导光板"]
Row 3: ["图片Photos", "型号\nSize Inches", "额定功率Rated Power", "Price", null, "面环参数...", ...]  ← 主标题（有 "型号"）
Row 4: [null, null, null, "PS", "Glass", "Out Size±1", "Cut Size±2", "Height±1", "LED Number", "Input Voltage", ...]  ← 子标题（参数列名）
Row 5: ["暗装圆形", "2.5寸", "3W", 3.53, 3.48, "φ87", "φ65", 16, 15, "220-240V", ...]  ← 数据行
Row 6: [null, "3.5寸", "6W", 4.38, 4.26, "φ118", "φ95", 16, 30, "220-240V", ...]       ← 同组续行
```

关键特征：
1. **多行表头**：主标题（row 3）有型号列，子标题（row 4）有参数列名
2. **组标签填充**：column A 是形状组标签（"暗装圆形"、"暗装方形"、"明装圆形"），下方 null 行属于同组
3. **尺寸即型号**：column B 的值是 "2.5寸"、"3.5寸" 等尺寸标识，不是传统型号

## 前置

```bash
cp prisma/dev.db prisma/dev.db.bak-v11.0
```

---

## 新建文件：`scripts/v11.0-multirow-header-extract.ts`

```bash
npx tsx scripts/v11.0-multirow-header-extract.ts              # dry-run
npx tsx scripts/v11.0-multirow-header-extract.ts --apply       # 写入
```

### 核心算法

#### 1. 多行表头检测

不用 `detectHeaderRow`（选最多非空行），改为：

```typescript
function detectMultiRowHeader(rows: unknown[][]): { mainRow: number; subRow: number | null; mergedValues: unknown[] } | null {
  // 扫描前 10 行，找包含 MODEL_HEADER_PATTERNS 的行
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const row = rows[i];
    const hasModel = row.some(cell => {
      const norm = normalizeHeader(cellToString(cell));
      return norm && MODEL_HEADER_PATTERNS.some(p => p.test(norm));
    });

    if (hasModel) {
      // 检查下一行是否是子标题（填补主标题的 null 位置）
      const nextRow = rows[i + 1];
      if (nextRow) {
        const mainNulls = row.filter(c => !cellToString(c)).length;
        const nextNonEmpty = nextRow.filter(c => cellToString(c)).length;

        // 如果主标题有很多 null 且下一行有很多非空值 → 多行表头
        if (mainNulls >= 3 && nextNonEmpty >= 3) {
          // 合并：主标题优先，null 位置用子标题填充
          const merged = row.map((val, idx) =>
            cellToString(val) ? val : (nextRow[idx] ?? null)
          );
          return { mainRow: i, subRow: i + 1, mergedValues: merged };
        }
      }

      // 单行表头
      return { mainRow: i, subRow: null, mergedValues: [...row] };
    }
  }
  return null;
}
```

MODEL_HEADER_PATTERNS 复用回填脚本的定义：
```typescript
const MODEL_HEADER_PATTERNS = [
  /item\s*no/i, /model/i, /型号/i, /product\s*no/i,
  /编号/i, /款号/i, /^item$/i, /^product\s*name$/i,
  /^产品名称$/i, /^品名$/i, /^名称$/i,
  /^specifications?$/i, /^description$/i,
];
```

#### 2. 组标签填充（fill-down）

```typescript
function fillDownGroupLabel(data: unknown[][], groupColIndex: number): Map<number, string> {
  const labels = new Map<number, string>();
  let currentLabel = "";

  for (let i = 0; i < data.length; i++) {
    const cellVal = cellToString(data[i]?.[groupColIndex]);
    if (cellVal) {
      currentLabel = cellVal;
    }
    if (currentLabel) {
      labels.set(i, currentLabel);
    }
  }
  return labels;
}
```

#### 3. 组标签列检测

组标签列通常是第一列（column A），特征：
- 大部分行为空（null）
- 非空值包含形状关键词（圆形/方形/Round/Square）或安装方式（暗装/明装/Slim/Surface）

```typescript
function findGroupLabelColumn(dataRows: unknown[][], headerValues: unknown[]): number | null {
  // 候选：前 3 列中，非空比例 < 50% 且含形状关键词
  const shapeKeywords = /圆形|方形|Round|Square|暗装|明装|Slim|Surface/i;

  for (let col = 0; col < Math.min(3, (dataRows[0]?.length ?? 0)); col++) {
    let nonEmpty = 0;
    let hasShape = false;
    const sampleSize = Math.min(dataRows.length, 30);
    for (let row = 0; row < sampleSize; row++) {
      const val = cellToString(dataRows[row]?.[col]);
      if (val) {
        nonEmpty++;
        if (shapeKeywords.test(val)) hasShape = true;
      }
    }
    const fillRate = nonEmpty / sampleSize;
    if (fillRate < 0.5 && hasShape) return col;
  }
  return null;
}
```

#### 4. 产品匹配 — shape + size 组合

```typescript
function matchProductByShapeAndSize(
  groupLabel: string,
  sizeValue: string,
  candidates: LinkedProduct[],
  category: string | null,
): LinkedProduct | null {
  // 从组标签中提取形状
  const shape = extractShape(groupLabel); // "圆形" | "方形" | null
  const install = extractInstall(groupLabel); // "暗装" | "明装" | null

  // 从尺寸值中提取寸数
  const sizeNorm = extractSize(sizeValue); // "2.5寸" | "3.5寸" | null

  if (!sizeNorm) return null;

  // 搜索策略：
  // 1. 先找 product_name 同时包含 shape 和 size 的（如 "2.5寸圆形"）
  // 2. 找 product_name 包含 install+shape+size 的（如 "暗装圆形_φ83×23mm-2.5寸"）
  // 3. 只匹配 size 的（如 "2.5寸"）

  let matches: LinkedProduct[] = [];

  if (shape && sizeNorm) {
    // 策略 1：size + shape
    matches = candidates.filter(p =>
      p.productName.includes(sizeNorm) && p.productName.includes(shape)
    );
    if (matches.length === 1) return matches[0];
  }

  if (install && shape && sizeNorm && matches.length !== 1) {
    // 策略 2：install + shape + size（更具体）
    const installShape = candidates.filter(p =>
      p.productName.includes(sizeNorm) &&
      p.productName.includes(shape) &&
      p.productName.includes(install)
    );
    if (installShape.length === 1) return installShape[0];
    if (installShape.length > 1) matches = installShape;
  }

  if (matches.length !== 1 && sizeNorm) {
    // 策略 3：只用 size
    const sizeOnly = candidates.filter(p => p.productName.includes(sizeNorm));
    if (sizeOnly.length === 1) return sizeOnly[0];
  }

  // 多个匹配 → 全部写入（因为同规格不同产品通常共享参数）
  if (matches.length > 1) return matches[0]; // 取第一个，其他通过 existingParamKeys 去重

  return null;
}

function extractShape(label: string): string | null {
  if (/圆形|[Rr]ound/i.test(label)) return "圆形";
  if (/方形|[Ss]quare/i.test(label)) return "方形";
  return null;
}

function extractInstall(label: string): string | null {
  if (/暗装|[Ss]lim/i.test(label)) return "暗装";
  if (/明装|[Ss]urface/i.test(label)) return "明装";
  return null;
}

function extractSize(value: string): string | null {
  const m = value.match(/(\d+(?:\.\d+)?)\s*寸/);
  if (m) return `${m[1]}寸`;
  const m2 = value.match(/(\d+(?:\.\d+)?)\s*[Ii]nch/);
  if (m2) return `${m2[1]}寸`; // 统一为寸
  return null;
}
```

#### 5. 参数列映射

合并后的表头可以用 HEADER_TO_PARAM 映射。需要补充的映射：

```typescript
// 这些在现有 HEADER_TO_PARAM 中可能已有部分
const ADDITIONAL_MAPPINGS: Record<string, string> = {
  "out size": "size_display",
  "cut size": "cutout_mm",
  "output voltage": "voltage",    // 注意：与 input voltage 区分
  "output current": "note",       // 驱动输出电流，存为 note
  "led number": "led_count",
  "额定功率": "watts",             // "额定功率Rated Power"
  "rated power": "watts",
  "实测功率": "watts",             // "实测功率Actual Test Power"
  "actual test power": "watts",
};
```

注意区分 Input Voltage（产品输入电压）和 Output Voltage（驱动输出电压）。Input Voltage → `voltage`，Output Voltage → `note`。

#### 6. 数据加载

不限于文件关联产品，直接加载同品类所有产品（因为这些文件的产品可能通过 size 名称匹配，不走 supplier_offers）：

```typescript
// 加载所有文件
const allFiles = await prisma.file.findMany({
  where: { fileType: "excel" },
  select: { id: true, fileName: true, relativePath: true },
});

// 按品类预加载产品
const allProducts = await prisma.product.findMany({
  select: { id: true, modelNo: true, productName: true, category: true },
});
const productsByCategory = new Map<string, LinkedProduct[]>();
for (const p of allProducts) {
  const cat = p.category ?? "";
  const list = productsByCategory.get(cat) ?? [];
  list.push({ productId: p.id, modelNo: p.modelNo, productName: p.productName, category: p.category });
  productsByCategory.set(cat, list);
}
```

#### 7. 主循环

```typescript
for (const file of allFiles) {
  const category = inferCategoryFromFile(file.relativePath, file.fileName);
  const candidates = category ? (productsByCategory.get(category) ?? []) : [];
  if (candidates.length === 0) continue;

  const physicalPath = resolvePhysicalPath(file.relativePath);
  if (!existsSync(physicalPath)) continue;

  const workbook = XLSX.readFile(physicalPath, { cellDates: false });

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: false });

    // 先用标准 detectHeaderRow 检查 → 如果能正常检测到 model column，跳过（backfill 已处理）
    const standardHeader = detectStandardHeader(rows);
    if (standardHeader) continue; // 这个 sheet 已被回填处理过

    // 尝试多行表头检测
    const multiHeader = detectMultiRowHeader(rows);
    if (!multiHeader) continue;

    const modelColIndex = findModelColumn(multiHeader.mergedValues);
    if (modelColIndex == null) continue;

    const paramColumns = findParamColumns(multiHeader.mergedValues, modelColIndex);
    if (paramColumns.length === 0) continue;

    // 检测组标签列
    const dataStartRow = (multiHeader.subRow ?? multiHeader.mainRow) + 1;
    const dataRows = rows.slice(dataStartRow);
    const groupColIndex = findGroupLabelColumn(dataRows, multiHeader.mergedValues);

    // fill-down 组标签
    const groupLabels = groupColIndex != null
      ? fillDownGroupLabel(dataRows, groupColIndex)
      : new Map<number, string>();

    // Sheet 名称参数（driver_type, voltage, ip）
    const sheetParams = parseSheetName(sheetName);

    // 遍历数据行
    for (const [rowOffset, row] of dataRows.entries()) {
      if (isBlankRow(row)) continue;

      const sizeValue = cellToString(row[modelColIndex]);
      if (!sizeValue) continue;

      const groupLabel = groupLabels.get(rowOffset) ?? "";

      // 匹配产品
      const product = matchProductByShapeAndSize(groupLabel, sizeValue, candidates, category);
      if (!product) continue;

      // 提取参数
      for (const col of paramColumns) {
        const value = cellToString(row[col.index]);
        if (!value) continue;
        const key = `${product.productId}\0${col.paramKey}`;
        if (existingParamKeys.has(key)) continue;

        plannedParams.push({
          productId: product.productId,
          paramKey: col.paramKey,
          rawValue: value,
          normalizedValue: normalizeParamValue(col.paramKey, value),
          unit: getUnit(col.paramKey),
          sourceField: "excel_multirow",
          confidence: "medium",
        });
        existingParamKeys.add(key);
      }

      // Sheet 级参数（driver_type, voltage from sheet name）
      for (const sp of sheetParams) {
        const key = `${product.productId}\0${sp.paramKey}`;
        if (existingParamKeys.has(key)) continue;
        plannedParams.push({
          productId: product.productId,
          paramKey: sp.paramKey,
          rawValue: sp.rawValue,
          normalizedValue: sp.normalizedValue,
          unit: sp.unit,
          sourceField: "sheet_name",
          confidence: "medium",
        });
        existingParamKeys.add(key);
      }
    }
  }
}
```

#### 8. 跳过已处理 sheet 的判断

```typescript
function detectStandardHeader(rows: unknown[][]): boolean {
  // 模拟回填脚本的 detectHeaderRow + findModelColumn
  // 如果标准检测能找到 model column → 回填已处理，跳过
  let bestRow = null;
  let bestCount = 0;
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const count = rows[i].filter(c => cellToString(c)).length;
    if (count >= 3 && count > bestCount) {
      bestRow = rows[i];
      bestCount = count;
    }
  }
  if (!bestRow) return false;
  return bestRow.some(cell => {
    const norm = normalizeHeader(cellToString(cell));
    return norm && MODEL_HEADER_PATTERNS.some(p => p.test(norm));
  });
}
```

### parseSheetName

复用 V10.8 的 sheet 名称解析逻辑：

```typescript
function parseSheetName(sheetName: string): SheetParam[] {
  const params: SheetParam[] = [];
  const text = sheetName.trim();

  // driver_type
  if (/非隔离/.test(text)) {
    params.push({ paramKey: "driver_type", rawValue: text, normalizedValue: "非隔离", unit: null });
  } else if (/隔离/.test(text) && !/非隔离/.test(text)) {
    params.push({ paramKey: "driver_type", rawValue: text, normalizedValue: "隔离", unit: null });
  }
  if (/\bDOB\b/i.test(text)) {
    params.push({ paramKey: "driver_type", rawValue: text, normalizedValue: "DOB", unit: null });
  }

  // voltage from sheet name: (165-265V), (85-265V)
  const voltMatch = text.match(/[（(]\s*(\d+)\s*V?\s*[-~–]\s*(\d+)\s*V\s*[）)]/i);
  if (voltMatch) {
    params.push({ paramKey: "voltage", rawValue: `${voltMatch[1]}-${voltMatch[2]}V`, normalizedValue: `${voltMatch[1]}-${voltMatch[2]}`, unit: "V" });
  }

  // ip from sheet name
  const ipMatch = text.match(/IP\s*(\d{2})/i);
  if (ipMatch) {
    params.push({ paramKey: "ip", rawValue: `IP${ipMatch[1]}`, normalizedValue: ipMatch[1], unit: null });
  }

  return params;
}
```

### normalizeParamValue

对不同 param_key 的值做归一化：

```typescript
function normalizeParamValue(paramKey: string, raw: string): string {
  switch (paramKey) {
    case "watts": {
      const m = raw.match(/(\d+(?:\.\d+)?)/);
      return m ? m[1] : raw;
    }
    case "voltage": return raw.replace(/[（）()]/g, "").trim();
    case "pf": return raw;
    case "cri": return raw;
    case "luminous_efficacy": {
      const m = raw.match(/(\d+(?:\.\d+)?)/);
      return m ? m[1] : raw;
    }
    case "led_count": {
      const m = raw.match(/(\d+)/);
      return m ? m[1] : raw;
    }
    case "size_display": return raw;
    case "cutout_mm": return raw.replace(/[φΦ]/g, "").trim();
    default: return raw;
  }
}
```

---

## 报告：`docs/v11.0-multirow-header-report.md`

```markdown
# V11.0 多行表头文件参数提取报告

模式: dry-run / apply
时间: ...

## 汇总

| 指标 | 数值 |
|---|---:|
| 扫描文件数 | X |
| 含多行表头的文件 | X |
| 含多行表头的 sheet | X |
| 匹配产品行数 | X |
| 新增参数 | X |
| 跳过（已存在） | X |
| product_params 变化 | 前 → 后 |

## 按 param_key 统计

| param_key | 新增记录 | 覆盖产品数 |

## 按品类统计

| 品类 | 多行表头 sheet 数 | 匹配行 | 新增参数 |

## 按改进来源

| 来源 | 新增参数 |
|---|---:|
| 多行表头参数列 | X |
| Sheet 名称参数 | X |

## 匹配采样（前 50 条）

| 文件名 | Sheet | 组标签 | 尺寸 | 匹配产品 | 提取 param_key |

## 未匹配采样（前 30 条）

| 文件名 | Sheet | 组标签 | 尺寸值 | 原因 |
```

---

## 重跑管线

```bash
npx tsx scripts/v11.0-multirow-header-extract.ts --apply
npx tsx scripts/v10.4-derive-params.ts --apply
npx tsx scripts/v10.0-source-audit.ts
```

---

## Commit

```
V11.0: extract params from multi-row-header files (面板灯/筒灯)

- New v11.0-multirow-header-extract.ts: handle files with split headers
- Multi-row header merging: combine main header (型号) + sub-header (param columns)
- Group label fill-down for shape identifiers (暗装圆形, 暗装方形, etc.)
- Shape+size composite product matching (圆形 + 2.5寸 → 2.5寸圆形)
- Extract voltage, pf, cri, efficacy, led_count, size, cutout from data columns
- Extract driver_type from sheet names (隔离/非隔离/DOB)
- Re-run derive and audit
```

## 不做什么

- 不改 v10.1-param-backfill.ts（避免回归风险）
- 不改 V10.6/V10.8/V10.9 脚本
- 不改 Prisma schema
- 不改前端
- 不删除现有产品或参数
- 不处理灯管文件（结构完全不同，需要独立任务）
- 不创建新产品（只为已有产品写入参数）
