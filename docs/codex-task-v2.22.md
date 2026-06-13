# Codex Task: V2.22 — PDF 报价 Profile-Based 导入器

## 目标

用 profile 机制导入 V2.21 确认的 4 份 RMB 工厂报价 PDF 到产品库。Profile 可扩展，后续确认更多 PDF 时加 profile 即可。**不做 UI，不碰 USD 报价，不做 OCR。**

## 背景

V2.21 spike 用 `pdfjs-dist` 对 16 份 PDF 做了只读解析，确认 4 份 importable：

| ID | Category | Factory | Pages | 估计行数 | 价格列表头 |
|---|---|---|---:|---:|---|
| S02 | G4G9 | 普雅 | 1 | ~10 | 含税裸灯报价 |
| S03 | 防潮灯 | 普照 | 1 | ~10 | 含税出厂 |
| S05 | 三防灯 | 普照 | 1 | ~12 | 含税单价 |
| S10 | 风扇灯 | 杰莱特 | 12 | ~91 | 含税单价 / PRICE |

V2.21 spike 脚本（`scripts/pdf-spike-v2.21.ts`）已有完整的 pdfjs-dist 文本提取 + y-coordinate 行分组 + 价格列检测逻辑。V2.22 应复用这些函数。

## 依赖

`pdfjs-dist` 已在 V2.21 安装，无需新依赖。

---

## Profile 结构

### 文件：`scripts/pdf-import-profiles.ts`（新建）

```typescript
export type PdfImportProfile = {
  id: string;
  relativePath: string;       // 相对于 ROOT
  category: string;           // DB category
  factoryName: string;        // DB factory_name
  currency: "RMB";            // V2.22 只处理 RMB
  
  // 表头关键词匹配（用于自动识别列）
  columnHints: {
    modelNo: string[];         // 匹配型号列，如 ["型号", "model"]
    purchasePrice: string[];   // 匹配价格列，如 ["含税", "单价", "报价", "price"]
    wattage?: string[];        // 匹配功率列
    moq?: string[];            // 匹配 MOQ 列
    size?: string[];           // 匹配尺寸列
    material?: string[];       // 匹配材质列
    remark?: string[];         // 匹配备注列
    ctnQty?: string[];         // 匹配装箱数列
  };
  
  // 产品名生成规则
  productNameRule: "model-as-name" | "category-factory-model";

  // 可选：只解析特定页（默认全部，但最多 20 页）
  pages?: number[];
  
  // 可选：行分组 y 坐标容差（默认 2）
  yTolerance?: number;
  
  // 可选：最少列数才算数据行（默认 3）
  minDataColumns?: number;

  // 可选：跳过行数（前 N 行跳过，用于跳过非表格的公司抬头等）
  skipRowsBefore?: number;
};
```

### 4 个初始 Profile

```typescript
export const PDF_IMPORT_PROFILES: PdfImportProfile[] = [
  {
    id: "S02-puya-g4g9",
    relativePath: "光源/G4G9/G4 G9源头工厂 普雅产品价目表220318杭州汇浮.pdf",
    category: "G4G9",
    factoryName: "普雅",
    currency: "RMB",
    columnHints: {
      modelNo: ["型号"],
      purchasePrice: ["含税", "报价"],
      wattage: ["功率"],
    },
    productNameRule: "model-as-name",
  },
  {
    id: "S03-puzhao-fangchao",
    relativePath: "户外照明 工业照明/防潮灯/普照/CL04防潮灯报价表2024年4月25 普照.pdf",
    category: "防潮灯",
    factoryName: "普照",
    currency: "RMB",
    columnHints: {
      modelNo: ["产品型号", "型号"],
      purchasePrice: ["含税出厂", "含税", "单价"],
      material: ["材质"],
      size: ["产品尺寸", "尺寸"],
      ctnQty: ["装箱"],
    },
    productNameRule: "model-as-name",
  },
  {
    id: "S05-puzhao-sanfang",
    relativePath: "户外照明 工业照明/三防灯/普照/普照2025-4月更新/双色管A-报价表_20250403205611.pdf",
    category: "三防灯",
    factoryName: "普照",
    currency: "RMB",
    columnHints: {
      modelNo: ["产品型号", "型号"],
      purchasePrice: ["含税单价", "含税", "单价"],
      wattage: ["功率"],
      size: ["灯体尺寸", "尺寸"],
      remark: ["备注"],
    },
    productNameRule: "model-as-name",
  },
  {
    id: "S10-jielaite-fanshan",
    relativePath: "室内照明/风扇灯/伊特/2025年杰莱特风扇产品报价-全.pdf",
    category: "风扇灯",
    factoryName: "杰莱特",
    currency: "RMB",
    columnHints: {
      modelNo: ["产品型号", "model", "型号"],
      purchasePrice: ["含税单价", "price", "含税"],
      wattage: ["功率", "power"],
      moq: ["起订量", "moq"],
    },
    productNameRule: "model-as-name",
  },
];
```

---

## 导入脚本：`scripts/pdf-import-v2.22.ts`（新建）

### 命令行接口

```bash
# Dry-run 全部 profile
npx tsx scripts/pdf-import-v2.22.ts --dry-run

# Dry-run 单个 profile
npx tsx scripts/pdf-import-v2.22.ts --dry-run --profile S02-puya-g4g9

# 实际导入
npx tsx scripts/pdf-import-v2.22.ts --apply

# 实际导入单个
npx tsx scripts/pdf-import-v2.22.ts --apply --profile S03-puzhao-fangchao
```

### 核心流程

```
对每个 profile：
1. 检查 PDF 文件存在
2. 用 pdfjs-dist 提取全部文本项（复用 V2.21 spike 的提取逻辑）
3. 按 y 坐标分组成行（复用 V2.21 的 groupRows）
4. 自动检测表头行：找第一行同时包含 modelNo 和 purchasePrice 的关键词
5. 从表头行确定列映射：每个 columnHint 匹配表头的哪个 cell
6. 表头之后的行就是数据行，按列映射提取字段
7. 数据清洗：
   - 价格：去掉 ¥/￥/元/RMB，parseFloat
   - 型号：trim
   - 功率：提取数字 + W
   - 跳过价格 ≤ 0 或无型号的行
8. 生成 ImportRecord[]
```

### 数据结构

```typescript
type ImportRecord = {
  profileId: string;
  rowIndex: number;
  // 产品字段
  productName: string;
  modelNo: string;
  category: string;
  // offer 字段
  factoryName: string;
  purchasePrice: number;
  currency: string;
  moq: string | null;
  size: string | null;
  material: string | null;
  remark: string | null;
  // 来源
  sourceFilePath: string;
  // 原始行数据（调试用）
  rawValues: string[];
};
```

### 表头检测逻辑

```typescript
function findHeaderRow(rows: TableRow[], hints: PdfImportProfile["columnHints"]): {
  headerRowIndex: number;
  columnMap: Map<string, number>;  // field name → cell index in row
} | null {
  // 遍历前 20 行，找第一行同时包含 modelNo 和 purchasePrice 关键词的行
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const row = rows[i];
    const modelCol = findColumnByKeywords(row.values, hints.modelNo);
    const priceCol = findColumnByKeywords(row.values, hints.purchasePrice);
    
    if (modelCol !== null && priceCol !== null && modelCol !== priceCol) {
      const columnMap = new Map<string, number>();
      columnMap.set("modelNo", modelCol);
      columnMap.set("purchasePrice", priceCol);
      
      // 尝试匹配其他可选列
      for (const [field, keywords] of Object.entries(hints)) {
        if (field === "modelNo" || field === "purchasePrice") continue;
        if (!keywords || keywords.length === 0) continue;
        const col = findColumnByKeywords(row.values, keywords);
        if (col !== null && !columnMap.has(field)) {
          columnMap.set(field, col);
        }
      }
      
      return { headerRowIndex: i, columnMap };
    }
  }
  return null;
}

function findColumnByKeywords(values: string[], keywords: string[]): number | null {
  for (const keyword of keywords) {
    const lower = keyword.toLowerCase();
    const index = values.findIndex(v => v.toLowerCase().includes(lower));
    if (index >= 0) return index;
  }
  return null;
}
```

**注意**：V2.21 spike 发现某些 PDF 的表头分布在多行上（如 S02 普雅的表头跨 3 行）。如果单行匹配失败，尝试将相邻 2-3 行的 values 合并后重新匹配。

### DB 操作（--apply 模式）

遵循现有导入逻辑（参考 `scripts/batch-import-v2.14.ts` 和 `src/lib/hejia-import.ts`）：

1. **备份 DB**：`cp data/dev.sqlite backups/dev-before-v2.22-pdf-{timestamp}.sqlite`

2. **查找/创建 source file 记录**：在 `files` 表中查找该 PDF 的记录（V2.20 已入库）。用 `file.id` 作为 `source_file_id`。

3. **Upsert 产品**：按 `model_no + category` 查找
   - 已存在：不改产品字段（保留 Excel 导入的更丰富数据）
   - 不存在：创建新产品（`product_name` 按 profile 的 `productNameRule` 生成）

4. **Upsert Offer**：按 `product_id + factory_name` 查找
   - 已存在且价格变化：更新 `purchase_price` + `price_updated_at`，写 `price_history`
   - 已存在且价格相同：跳过
   - 不存在：创建新 `supplier_offer`

5. **不写 `product_params`**（参数提取是 V3.0 系列的事，后续单独跑）

### Dry-run 报告

写入 `docs/v2.22-pdf-import-dryrun.md`：

```markdown
# V2.22 — PDF 报价导入 Dry-Run 报告

Generated: {timestamp}
Profiles: 4
Total records: N

## Summary

| Profile | Category | Factory | PDF Pages | Rows Parsed | Valid Records | Price Range | Existing Products | New Products | Price Updates |
|---|---|---|---:|---:|---:|---|---:|---:|---:|
| S02-puya-g4g9 | G4G9 | 普雅 | 1 | 10 | 8 | 6.9-21.2 | 2 | 6 | 1 |
| ... | ... | ... | ... | ... | ... | ... | ... | ... | ... |

## S02-puya-g4g9 — G4G9 / 普雅

### Column Mapping
| Field | Header Text | Column Index |
|---|---|---:|
| modelNo | 型号 | 4 |
| purchasePrice | 含税裸灯报价 | 11 |
| ... | ... | ... |

### Parsed Records
| # | Model | Price | MOQ | Size | Status |
|---:|---|---:|---|---|---|
| 1 | PY-G9-2.2W-230-L | 6.90 | - | Ф14.5*58 | new product |
| 2 | PY-G9-4.2W-230-L | 8.40 | - | Ф16*63 | existing, price update 7.50→8.40 |
| ... | ... | ... | ... | ... | ... |

### Skipped Rows
| # | Reason | Raw Values |
|---:|---|---|
| 0 | header row | [序, 产品类型, ...] |
| ... | ... | ... |

---
（每个 profile 重复上面格式）
```

### Apply 模式输出

写入 `docs/v2.22-pdf-import-result.md`：

```markdown
# V2.22 — PDF 报价导入结果

Generated: {timestamp}
Mode: apply
DB Backup: backups/dev-before-v2.22-pdf-{timestamp}.sqlite

## Summary

| Metric | Count |
|---|---:|
| Profiles processed | 4 |
| Products created | N |
| Products existing (skipped) | N |
| Offers created | N |
| Offers updated (price change) | N |
| Offers unchanged (skipped) | N |
| Price history records | N |
| Rows skipped (invalid) | N |

## By Profile
（同 dry-run 格式，标注实际操作结果）
```

### 安全边界

- 如果某个 profile 解析出 0 条有效记录 → 报错并跳过该 profile，不中断其他 profile
- 如果价格 ≤ 0 或 > 50000 → 跳过该行
- 如果型号为空或纯数字 → 跳过该行
- 如果解析的总行数超过 profile 估计的 3 倍 → 警告（可能误检测了非数据行）
- dry-run 不写 DB
- apply 先备份

---

## 执行步骤

### Step 1: 新建文件

创建 `scripts/pdf-import-profiles.ts` + `scripts/pdf-import-v2.22.ts`。

从 `scripts/pdf-spike-v2.21.ts` 复用以下函数（copy 过来，不要 import，避免耦合）：
- `groupRows` / 行分组逻辑
- pdfjs-dist 文本提取逻辑
- `normalizeText`

不要复用 spike 的 verdict/classification 逻辑——那是分析用的，导入器不需要。

### Step 2: Dry-run

```bash
npx tsx scripts/pdf-import-v2.22.ts --dry-run
```

确认 4 个 profile 都能正确解析，列映射正确，价格合理。

### Step 3: Apply

```bash
npx tsx scripts/pdf-import-v2.22.ts --apply
```

### Step 4: 验证

```bash
npx tsc --noEmit --pretty false
```

用 sqlite3 快速验证：

```bash
sqlite3 data/dev.sqlite "SELECT category, factory_name, COUNT(*) FROM supplier_offers so JOIN products p ON so.product_id = p.id WHERE so.factory_name IN ('普雅','普照','杰莱特') GROUP BY category, factory_name"
```

### Step 5: 提交

```bash
git add scripts/pdf-import-profiles.ts scripts/pdf-import-v2.22.ts \
  docs/v2.22-pdf-import-dryrun.md docs/v2.22-pdf-import-result.md
git commit -m "V2.22: profile-based PDF quotation importer — 4 factory RMB PDFs"
```

## 验收标准

1. 4 个 profile 全部成功解析（表头检测 + 列映射）
2. dry-run 报告显示每个 profile 的解析行数、价格范围、新/旧/更新统计
3. apply 后产品和 offer 正确写入 DB
4. 已存在的产品不覆盖（保留 Excel 导入的丰富数据）
5. 价格变化写入 `price_history`
6. source_file_id 正确关联到 V2.20 入库的 files 记录
7. DB 备份存在
8. `tsc --noEmit` 通过
9. 脚本可重复运行（第二次跑 apply 应该全部 skip/unchanged）
10. profile 文件独立，后续加新 PDF 只需加 profile 条目

## 不做的事

- 不做 UI（纯脚本）
- 不处理 USD 报价
- 不处理扫描件 PDF
- 不做 OCR
- 不写 `product_params`（后续 V3.0 系列跑）
- 不修改现有 Excel 导入逻辑
- 不修改 schema
