# V10.8 — Sheet 名称参数提取 + 重跑管线

## 目标

很多 Excel 文件的 sheet 名称编码了结构化的参数信息，当前完全没有提取。这些信息对同一 sheet 下**所有产品**共享。

典型 sheet 名称及可提取参数：

| Sheet 名称 | driver_type | voltage | 其他 |
|---|---|---|---|
| `非隔离窄压Not isolation drive 22 lm` | 非隔离 | — | — |
| `隔离宽压隔离 isolation drive 24 lm` | 隔离 | — | — |
| `DOB CE线性恒流` | DOB | — | — |
| `全塑筒灯（165V-265V）` | — | 165-265V | — |
| `全塑筒灯（85V-265V）` | — | 85-265V | — |
| `IP65三防灯` | — | — | ip=65 |

当前 driver_type 覆盖率只有 **3.1%**（326/10,522），这是成本最低的提升方式。

## 前置

```bash
cp prisma/dev.db prisma/dev.db.bak-v10.8
```

**必须在 V10.7 之后运行**。

---

## 新建文件：`scripts/v10.8-sheet-name-extract.ts`

```bash
npx tsx scripts/v10.8-sheet-name-extract.ts              # dry-run
npx tsx scripts/v10.8-sheet-name-extract.ts --apply       # 写入
```

### 数据加载

```typescript
// 加载所有有关联产品的 Excel 文件及其 sheet 列表
// 使用 SheetJS 读取每个文件获取 SheetNames
// 然后查询该文件关联的所有产品
const sourceFiles = await prisma.$queryRaw<...>`
  SELECT DISTINCT
    f.id AS file_id,
    f.file_name,
    f.relative_path
  FROM supplier_offers so
  JOIN files f ON f.id = so.source_file_id
  WHERE so.source_file_id IS NOT NULL AND f.file_type = 'excel'
  ORDER BY f.relative_path
`;
```

### Sheet 名称解析规则

```typescript
interface SheetParam {
  paramKey: string;
  rawValue: string;
  normalizedValue: string;
  unit: string | null;
}

function parseSheetName(sheetName: string): SheetParam[] {
  const params: SheetParam[] = [];
  const text = sheetName.trim();

  // 1. driver_type: 非隔离 / 隔离 / DOB
  if (/非隔离/.test(text)) {
    params.push({ paramKey: "driver_type", rawValue: text, normalizedValue: "非隔离", unit: null });
  } else if (/隔离/.test(text) && !/非隔离/.test(text)) {
    params.push({ paramKey: "driver_type", rawValue: text, normalizedValue: "隔离", unit: null });
  }
  if (/\bDOB\b/i.test(text)) {
    params.push({ paramKey: "driver_type", rawValue: text, normalizedValue: "DOB", unit: null });
  }

  // 2. voltage: (165V-265V), (85V-265V), (100-240V), 括号内电压范围
  const voltageMatch = text.match(/[（(]\s*(\d+)\s*V?\s*[-~–]\s*(\d+)\s*V\s*[）)]/i);
  if (voltageMatch) {
    const v1 = parseInt(voltageMatch[1]), v2 = parseInt(voltageMatch[2]);
    if (v1 >= 12 && v2 <= 480) {
      params.push({ paramKey: "voltage", rawValue: `${v1}-${v2}V`, normalizedValue: `${v1}-${v2}`, unit: "V" });
    }
  }

  // 3. ip: IP65, IP44, IP20 出现在 sheet 名称中
  const ipMatch = text.match(/IP\s*(\d{2})/i);
  if (ipMatch) {
    params.push({ paramKey: "ip", rawValue: `IP${ipMatch[1]}`, normalizedValue: ipMatch[1], unit: null });
  }

  // 4. cct: 出现色温范围如 "3000K", "4000-6500K"
  const cctRangeMatch = text.match(/(\d{4})\s*[-~–]\s*(\d{4})\s*K/i);
  if (cctRangeMatch) {
    params.push({ paramKey: "cct", rawValue: `${cctRangeMatch[1]}-${cctRangeMatch[2]}K`, normalizedValue: `${cctRangeMatch[1]}-${cctRangeMatch[2]}`, unit: "K" });
  } else {
    const cctSingleMatch = text.match(/(\d{4})\s*K/i);
    if (cctSingleMatch) {
      const k = parseInt(cctSingleMatch[1]);
      if (k >= 1800 && k <= 10000) {
        params.push({ paramKey: "cct", rawValue: `${k}K`, normalizedValue: String(k), unit: "K" });
      }
    }
  }

  return params;
}
```

### 跳过规则

```typescript
function shouldSkipSheet(sheetName: string): boolean {
  // 跳过明确的非产品 sheet
  if (/汇总|目录|index|summary|封面|说明|template/i.test(sheetName)) return true;
  return false;
}
```

### 产品关联

Sheet 名称参数**共享给该 sheet 中所有已匹配的产品**。

方案：对每个文件的每个 sheet，找出该 sheet 中有 offer 的所有产品，给它们写入从 sheet 名称提取的参数。

如何判断哪些产品属于哪个 sheet？使用 SheetJS 读取每个 sheet 的数据，复用 V10.3 / V10.1 的型号匹配逻辑找出已匹配产品。

**简化方案**：因为同一文件的所有关联产品通常都在同一品类下，且 sheet 名称参数（driver_type/voltage/ip）通常对整个文件通用——直接把参数写给文件关联的所有产品：

```typescript
// 获取文件关联的所有产品 ID
const fileProducts = await prisma.$queryRaw<{ product_id: number }[]>`
  SELECT DISTINCT product_id
  FROM supplier_offers
  WHERE source_file_id = ${file.id}
`;

// 获取这些产品已有的参数
const existingParams = await prisma.$queryRaw<{ product_id: number; param_key: string }[]>`
  SELECT product_id, param_key
  FROM product_params
  WHERE product_id IN (${Prisma.join(fileProducts.map(p => p.product_id))})
    AND param_key IN ('driver_type', 'voltage', 'ip', 'cct')
`;

const existingSet = new Set(existingParams.map(p => `${p.product_id}\0${p.param_key}`));

// 如果文件只有一个 sheet 有数据，或所有 sheet 提取出相同参数 → 写给所有产品
// 如果不同 sheet 提取出不同参数 → 需要按 sheet 分组写入
```

**多 sheet 不同参数**：如果一个文件有多个 sheet 且提取出不同的参数值（如 "隔离" sheet 和 "非隔离" sheet），需要按 sheet 分配产品：

```typescript
// 读取每个 sheet，找出哪些产品在哪个 sheet 中
for (const sheetName of workbook.SheetNames) {
  if (shouldSkipSheet(sheetName)) continue;

  const sheetParams = parseSheetName(sheetName);
  if (sheetParams.length === 0) continue;

  // 读取 sheet 数据，找 model column，匹配产品
  const sheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];

  // 复用 header 检测 + model column 检测
  const headerRow = findHeaderRow(data);
  if (!headerRow) continue;

  const modelCol = findModelColumn(headerRow);
  if (modelCol < 0) continue;

  // 提取该 sheet 中的产品
  const sheetProductIds = new Set<number>();
  for (const row of data.slice(headerRow.index + 1)) {
    const modelValue = row[modelCol]?.toString().trim();
    if (!modelValue) continue;
    const product = findProduct(modelValue, fileProducts);
    if (product) sheetProductIds.add(product.id);
  }

  // 给这些产品写入 sheet 级参数
  for (const productId of sheetProductIds) {
    for (const param of sheetParams) {
      const key = `${productId}\0${param.paramKey}`;
      if (existingSet.has(key)) continue;
      plannedParams.push({
        productId,
        paramKey: param.paramKey,
        rawValue: param.rawValue,
        normalizedValue: param.normalizedValue,
        unit: param.unit,
        sourceField: "sheet_name",
        confidence: "medium",
      });
      existingSet.add(key);
    }
  }
}
```

### 报告：`docs/v10.8-sheet-name-report.md`

```markdown
# V10.8 Sheet 名称参数提取报告

模式: dry-run / apply
时间: ...

## 汇总

| 指标 | 数值 |
|---|---:|
| 扫描文件数 | X |
| 含可解析 sheet 名称的文件 | X |
| 可解析 sheet 数 | X |
| 匹配产品数 | X |
| 新增参数 | X |
| 跳过（已存在） | X |
| product_params 变化 | 前 → 后 |

## 按 param_key 统计

| param_key | 新增记录 | 覆盖产品数 |
|---|---:|---:|
| driver_type | X | X |
| voltage | X | X |
| ip | X | X |
| cct | X | X |

## 按品类统计

| 品类 | 可解析 sheet 数 | 匹配产品 | 新增参数 |

## sheet 名称采样（前 50 条）

| 文件名 | Sheet 名称 | 提取 param_key | 提取值 | 受益产品数 |
```

---

## 重跑管线

```bash
npx tsx scripts/v10.8-sheet-name-extract.ts --apply
npx tsx scripts/v10.4-derive-params.ts --apply
npx tsx scripts/v10.0-source-audit.ts
```

---

## Commit

```
V10.8: extract params from sheet names (driver_type, voltage, ip, cct)

- New v10.8-sheet-name-extract.ts: parse structured params from sheet names
- Targets driver_type (隔离/非隔离/DOB), voltage ranges, IP ratings, CCT
- Per-sheet product association for multi-sheet files
- Re-run derive and audit for updated coverage
```

## 不做什么

- 不改 v10.1-param-backfill.ts（V10.7 已改）
- 不改 v10.6 脚本
- 不改 Prisma schema
- 不改前端
- 不删除现有产品或参数
- 不从 sheet 名称提取模糊信息（如 "22 lm" 可能是 lm/LED 不是 lm/W）
