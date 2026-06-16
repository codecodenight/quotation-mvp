# V10.3 — 导入 100 个未关联文件的产品 + 重跑覆盖率管线

## 目标

100 个 Excel 文件在 `files` 表中有记录，但没有任何 `supplier_offers` 关联。它们包含约 5,000+ 行产品数据，从未被导入。本任务把这些文件里的产品导入 DB，然后重跑参数回填 + 派生 + 审计。

## 前置

```bash
cp prisma/dev.db prisma/dev.db.bak-v10.3
```

---

## 阶段一：导入脚本

### 新建文件：`scripts/v10.3-import-unlinked.ts`

```bash
npx tsx scripts/v10.3-import-unlinked.ts              # dry-run
npx tsx scripts/v10.3-import-unlinked.ts --apply       # 写入
```

### 查询未关联文件

```sql
SELECT f.id, f.file_name, f.relative_path, f.folder_name, f.factory_guess
FROM files f
WHERE f.file_type = 'excel'
  AND f.id NOT IN (
    SELECT DISTINCT source_file_id FROM supplier_offers WHERE source_file_id IS NOT NULL
  )
```

这返回 100 行。每行有：
- `id` — 文件在 files 表的主键，会写入 `supplier_offers.source_file_id`
- `folder_name` — 作为产品分类（如 "面板灯"、"投光灯"）
- `factory_guess` — 作为工厂名（如 "一群狼"、"凯晟德"）
- `relative_path` — 文件物理路径（相对于 `process.cwd()`）

### 分类映射

部分 folder_name 需要规范化（参考 `batch-import-v2.14.ts` 第 62-66 行）：

```typescript
const CATEGORY_MAP: Record<string, string> = {
  "LED橱柜灯": "橱柜灯",
  "市电壁灯": "壁灯",
  "支架": "线条灯",
  "hejia": null,        // 需要从文件名推断
  "sample data": null,   // 同上
};
```

当 folder_name 映射为 null 时，从文件名推断分类：
- 文件名含 "灯带" / "strip" → "灯带"
- 文件名含 "投光" / "flood" → "投光灯"
- 文件名含 "面板" / "panel" → "面板灯"
- 文件名含 "皮线" → "皮线灯"
- 文件名含 "spotlight" → "筒灯"
- 其他 → "(未分类)"

### Excel 解析

对每个文件：

```typescript
const wb = XLSX.readFile(physicalPath, { cellDates: false });
for (const sheetName of wb.SheetNames) {
  // 跳过目录/封面
  if (/目录|index|cover|封面/i.test(sheetName)) continue;

  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: false });
  // 1. 检测表头行（复用 V10.2 的 detectHeaderRow 逻辑，MIN_HEADER_CELLS=3）
  // 2. 检测型号列（复用 V10.2 的 MODEL_HEADER_PATTERNS）
  // 3. 检测价格列
  // 4. 如果没有型号列，尝试 sheet 名 fallback（复用 V10.2 逻辑）
}
```

### 型号列检测

复用 V10.2 的 MODEL_HEADER_PATTERNS。另外增加值级别检测（参考 `batch-import-v2.14.ts` 第 1427 行）：

```typescript
function isLikelyModelValue(value: string): boolean {
  const text = value.trim();
  if (text.length < 2 || text.length > 100) return false;
  if (/^[\d,.]+$/.test(text)) return false;
  if (/单价|price|报价|含税|不含税/i.test(text)) return false;
  return true; // 比原版更宽松：不要求同时有字母和数字
}
```

注意：原版 `isLikelyModelValue` 要求同时有字母和数字，但很多中文型号（如 "2.5寸圆形"、"暗装圆形"）只有中文+数字。所以这里放宽条件。

### 价格列检测

检测含有 ¥ 或纯数字的列，优先选 RMB 表头的列：

```typescript
function isRmbPriceHeader(header: string): boolean {
  return /rmb|人民币|含税|不含税|单价|价格|报价|出厂|工厂价|成本|cny|元/i.test(header)
    && !/usd|fob|美金|美元/i.test(header);
}
```

如果找不到价格列，仍然导入产品但 purchase_price 设为 "0"（产品和参数比价格更重要）。

### 产品匹配与创建

对每个数据行，提取 model 值后：

```typescript
// 1. 归一化
const normalizedModel = normalizeForMatch(excelModelValue);

// 2. 查找已有产品（Tier 1: 精确匹配）
let product = await findExistingProduct(normalizedModel, "exact");

// 3. Tier 2: 包含匹配（model_no 互相包含）
if (!product) {
  product = await findExistingProduct(normalizedModel, "contains");
}

// 4. 如果没找到，创建新产品
if (!product) {
  product = await createProduct({
    productName: buildProductName(excelModelValue, sheetName, category),
    category: resolvedCategory,
    modelNo: excelModelValue.trim(),
    size: sizeColumnValue ?? null,
    remark: remarkColumnValue ?? null,
  });
  stats.newProducts++;
} else {
  stats.reusedProducts++;
}

// 5. 创建 SupplierOffer
await createSupplierOffer({
  productId: product.id,
  factoryName: file.factoryGuess ?? "未知",
  purchasePrice: priceValue ?? "0",
  currency: "RMB",
  sourceFileId: file.id,
  moq: null,
  remark: null,
});
stats.newOffers++;
```

### 精确和包含匹配的实现

```typescript
// 维护一个产品缓存，避免重复查询
const productCache = new Map<string, { id: string; modelNo: string }>();

// 初始化：预加载所有产品的 id + model_no
const allProducts = await prisma.product.findMany({
  select: { id: true, modelNo: true, productName: true },
});

// 精确匹配
function findExact(normalizedModel: string): Product | null {
  return allProducts.find(p => normalizeForMatch(p.modelNo ?? "") === normalizedModel) ?? null;
}

// 包含匹配（仅当唯一匹配时使用）
function findContains(normalizedModel: string): Product | null {
  const matches = allProducts.filter(p => {
    const nm = normalizeForMatch(p.modelNo ?? "");
    return nm.length >= 3 && normalizedModel.length >= 3
      && (nm.includes(normalizedModel) || normalizedModel.includes(nm));
  });
  // 只在唯一匹配时使用，多个匹配则放弃
  return matches.length === 1 ? matches[0] : null;
}
```

### buildProductName

```typescript
function buildProductName(model: string, sheetName: string, category: string): string {
  // 如果 model 本身够描述性（> 5 字符），直接用
  if (model.trim().length > 5) return model.trim();
  // 否则加上 sheet 名或品类
  return `${model.trim()} (${category})`;
}
```

### 去重保护

在创建 SupplierOffer 前，检查是否已存在同 (product_id, factory_name, source_file_id) 的记录：

```typescript
const existing = await prisma.supplierOffer.findFirst({
  where: { productId: product.id, factoryName: factory, sourceFileId: file.id },
});
if (existing) { stats.skippedOffers++; continue; }
```

### 报告：`docs/v10.3-import-report.md`

```markdown
# V10.3 未关联文件导入报告

模式: dry-run / apply
时间: ...

## 汇总

| 指标 | 数值 |
|---|---:|
| 扫描文件数 | 100 |
| 成功解析文件 | X |
| 解析失败文件 | X |
| 跳过 Sheet | X |
| 扫描数据行 | X |
| 新建产品 | X |
| 复用已有产品 | X |
| 新建 SupplierOffer | X |
| 跳过（已存在） | X |
| 产品总数变化 | 10,222 → ? |
| supplier_offers 变化 | 前 → 后 |

## 按品类统计

| 品类 | 文件数 | 新建产品 | 复用产品 | 新建 Offer |

## 按工厂统计

| 工厂 | 文件数 | 新建 Offer |

## 解析失败文件

| 文件名 | 原因 |

## 新建产品采样（前 100 条）

| 型号 | 品类 | 产品名 | 来源文件 |
```

### 运行

```bash
npx tsx scripts/v10.3-import-unlinked.ts --apply
```

---

## 阶段二：重跑参数管线

导入完成后，新关联的文件需要跑参数回填 + 派生 + 审计。

### Step 1: 更新备份（backfill 脚本需要）

```bash
cp prisma/dev.db prisma/dev.db.bak-v10.2
```

### Step 2: 重跑回填

```bash
npx tsx scripts/v10.1-param-backfill.ts --apply
```

这会扫描所有 588 + 新关联的文件，对新关联文件的数据行执行参数回填。已有参数会被跳过（去重逻辑）。

报告覆盖到 `docs/v10.2-backfill-report.md`。

### Step 3: 重跑派生

```bash
npx tsx scripts/v10.4-derive-params.ts --apply
```

为新导入的产品派生 watts（从 product_name）和 luminous_efficacy（从 watts + lumens）。

报告覆盖到 `docs/v10.4-derive-report.md`。

### Step 4: 重跑审计

```bash
npx tsx scripts/v10.0-source-audit.ts
```

报告覆盖到 `docs/v10.0-audit-report.md`。

---

## Commit

```
V10.3: import products from 100 unlinked files, re-run param pipeline

- New v10.3-import-unlinked.ts: scan 100 files with no linked products
- Find-or-create Product records, create SupplierOffer links
- Re-run backfill, derive, and audit for updated coverage
```

## 不做什么

- 不修改现有导入脚本（batch-import-v2.14.ts）
- 不修改 extract-params.ts
- 不改 Prisma schema
- 不改前端
- 不删除现有产品或参数
