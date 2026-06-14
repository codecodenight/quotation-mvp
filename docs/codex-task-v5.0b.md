# Codex Task: V5.0B — 历史客户报价建表 + 导入

## 目标

1. 创建独立的历史客户报价表（`customer_quote_files` + `customer_quote_rows`）
2. 导入 `发客户报价单汇总/` 全部 176 个 Excel 文件
3. 提取：款号、FOB USD 售价、描述、MOQ、CTN、箱规、备注、客户名、报价日期

**不写 `supplier_offers`，不写 `products`，不改现有表。**

## 背景

V5.0A spike（commit `c6aafa6`）已验证：
- FOB USD 可识别 90%，款号 80%，日期 95%
- 0 个 unknown-format，格式足够稳定
- 估算 ~18,000 行候选数据
- 客户名只在 `To XXX` 文件稳定（30%），核价文件无客户名

系统当前只有采购价链路（`supplier_offers.purchase_price` = 工厂 RMB）。客户历史售价（FOB USD）需要独立数据层，不能混入 supplier_offers。

## 依赖

- SheetJS（已在项目中）
- sqlite3 CLI（schema migration 用 raw SQL，不用 Prisma schema-engine）

---

## Part 1: Schema Migration

用 raw SQL 建表（Prisma schema-engine 在这台 Mac 上有 empty error bug）。

### 建表 SQL

```sql
CREATE TABLE IF NOT EXISTS customer_quote_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_name TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  sheet_name TEXT NOT NULL,
  customer_name TEXT,          -- 从 "To XXX" 文件名提取，核价文件为 NULL
  quote_date TEXT,             -- ISO 格式 YYYY-MM-DD 或 YYYY-MM
  format_type TEXT NOT NULL,   -- standard-template / partial-match / unknown-format
  row_count INTEGER NOT NULL DEFAULT 0,
  header_row INTEGER,
  header_snapshot TEXT,        -- 表头行原文（A=xxx | B=xxx ...）
  column_mapping TEXT,         -- JSON: { model: "B", fob_usd: "M", ... }
  imported_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(relative_path, sheet_name)
);

CREATE TABLE IF NOT EXISTS customer_quote_rows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id INTEGER NOT NULL REFERENCES customer_quote_files(id) ON DELETE CASCADE,
  row_number INTEGER NOT NULL,
  raw_model TEXT,
  raw_description TEXT,
  sale_price_usd REAL,
  sale_price_text TEXT,        -- 原始文本（如 "$3.21"）
  rmb_cost REAL,               -- 核价文件的 RMB 成本价（仅记录，不写 supplier_offers）
  moq TEXT,
  ctn_qty TEXT,
  ctn_size TEXT,
  remark TEXT,
  raw_row_json TEXT,           -- 整行原始数据 JSON
  matched_product_id INTEGER REFERENCES products(id),  -- 默认 NULL，后续匹配
  UNIQUE(file_id, row_number)
);

CREATE INDEX idx_cqr_file_id ON customer_quote_rows(file_id);
CREATE INDEX idx_cqr_matched_product ON customer_quote_rows(matched_product_id);
CREATE INDEX idx_cqf_customer ON customer_quote_files(customer_name);
CREATE INDEX idx_cqf_quote_date ON customer_quote_files(quote_date);
```

### 执行方式

```bash
# 先备份
cp prisma/dev.db backups/dev-before-v5.0b-$(date +%Y%m%d-%H%M%S).sqlite

# 执行 migration
sqlite3 prisma/dev.db < scripts/v5.0b-migration.sql
```

把上面的 SQL 写入 `scripts/v5.0b-migration.sql`。

### 更新 Prisma Schema

在 `prisma/schema.prisma` 末尾追加对应的 model 定义（只做映射，不跑 `prisma db push`）：

```prisma
model CustomerQuoteFile {
  id             Int      @id @default(autoincrement())
  fileName       String   @map("file_name")
  relativePath   String   @map("relative_path")
  sheetName      String   @map("sheet_name")
  customerName   String?  @map("customer_name")
  quoteDate      String?  @map("quote_date")
  formatType     String   @map("format_type")
  rowCount       Int      @default(0) @map("row_count")
  headerRow      Int?     @map("header_row")
  headerSnapshot String?  @map("header_snapshot")
  columnMapping  String?  @map("column_mapping")
  importedAt     String   @default("") @map("imported_at")
  rows           CustomerQuoteRow[]

  @@unique([relativePath, sheetName])
  @@map("customer_quote_files")
}

model CustomerQuoteRow {
  id               Int      @id @default(autoincrement())
  fileId           Int      @map("file_id")
  rowNumber        Int      @map("row_number")
  rawModel         String?  @map("raw_model")
  rawDescription   String?  @map("raw_description")
  salePriceUsd     Float?   @map("sale_price_usd")
  salePriceText    String?  @map("sale_price_text")
  rmbCost          Float?   @map("rmb_cost")
  moq              String?
  ctnQty           String?  @map("ctn_qty")
  ctnSize          String?  @map("ctn_size")
  remark           String?
  rawRowJson       String?  @map("raw_row_json")
  matchedProductId Int?     @map("matched_product_id")
  file             CustomerQuoteFile @relation(fields: [fileId], references: [id], onDelete: Cascade)
  matchedProduct   Product?          @relation(fields: [matchedProductId], references: [id])

  @@unique([fileId, rowNumber])
  @@map("customer_quote_rows")
}
```

注意：`Product` model 需要加一行反向关系 `customerQuoteRows CustomerQuoteRow[]`。

---

## Part 2: 导入脚本

### 脚本：`scripts/customer-quote-import-v5.0b.ts`（新建）

### 命令行

```bash
# dry-run（只读，不写 DB）
npx tsx scripts/customer-quote-import-v5.0b.ts --dry-run

# apply（写 DB）
npx tsx scripts/customer-quote-import-v5.0b.ts --apply
```

### 核心逻辑

复用 V5.0A spike 的解析逻辑（表头探测、列识别、数据提取）。关键区别：

1. **扫全量**：不抽样，处理 `发客户报价单汇总/` 下全部 176 个 Excel 文件（排除 macOS `._` 资源分叉）
2. **写 DB**：`--apply` 模式写入 `customer_quote_files` + `customer_quote_rows`
3. **幂等**：UNIQUE 约束 `(relative_path, sheet_name)` 和 `(file_id, row_number)` 防重复导入；再次运行跳过已存在的记录
4. **客户名提取**：
   - `To XXX` 文件名 → 提取 XXX 作为 customer_name
   - 核价文件 → customer_name = NULL
   - 文件名或 sheet 前几行有 "To:" / "Customer:" → 也提取
5. **日期提取**：
   - 文件名中的 `20230515` / `202305` / `2023.05` → 转 ISO 格式
   - sheet 前几行有 "Date:" → 也提取
6. **FOB USD 价格提取**：
   - 解析 `$3.21` / `3.21` 等格式
   - 存原始文本到 `sale_price_text`，解析后的数字到 `sale_price_usd`
7. **RMB 成本价**：如果核价文件有 RMB 列（含税/工厂价/￥），存到 `rmb_cost`
8. **raw_row_json**：整行所有列的 key-value JSON，保留原始数据
9. **过滤空行**：跳过全空行、小标题行（所有列都是文本且无数字价格的行）

### dry-run 输出

`--dry-run` 输出到 stdout，格式：

```
=== Customer Quote Import V5.0B (dry-run) ===
Source: /Volumes/My Passport/AI 报价/发客户报价单汇总/

Files found: 176
Files with parseable sheets: N
Total sheets: N
Total data rows: N

Per-category summary:
| 品类 | 文件数 | Sheet数 | 行数 | standard-template | partial-match | unknown |
|---|---:|---:|---:|---:|---:|---:|

Per-file detail:
[file_name] [sheets] [rows] [format_type] [customer] [date]
...
```

### apply 输出

`--apply` 输出到 `docs/v5.0b-import-report.md`：

```markdown
# V5.0B — 历史客户报价导入报告

Generated: {timestamp}
Mode: apply

## 总结

| 指标 | 数量 |
|---|---:|
| 文件总数 | N |
| 导入文件数 | N |
| 跳过文件数（已存在/无数据） | N |
| Sheet 总数 | N |
| 导入行数 | N |
| 有 FOB USD 的行 | N |
| 有款号的行 | N |
| 有客户名的文件 | N |

## 按品类统计

| 品类 | 文件 | Sheet | 行数 | FOB USD% | 款号% |
|---|---:|---:|---:|---:|---:|

## 错误/跳过清单

（如有读取失败、表头未识别等）
```

---

## 执行步骤

### Step 1: 创建 migration SQL + 执行

```bash
# 写 migration 文件
# 备份 DB
cp prisma/dev.db backups/dev-before-v5.0b-$(date +%Y%m%d-%H%M%S).sqlite
# 执行
sqlite3 prisma/dev.db < scripts/v5.0b-migration.sql
```

### Step 2: 更新 Prisma schema

编辑 `prisma/schema.prisma`，追加 `CustomerQuoteFile` + `CustomerQuoteRow` model。给 `Product` model 加 `customerQuoteRows` 反向关系。

### Step 3: 创建导入脚本 + dry-run

```bash
npx tsx scripts/customer-quote-import-v5.0b.ts --dry-run
```

确认文件数、行数合理。

### Step 4: apply

```bash
npx tsx scripts/customer-quote-import-v5.0b.ts --apply
```

### Step 5: 验证

```bash
npx tsc --noEmit --pretty false
sqlite3 prisma/dev.db "SELECT COUNT(*) FROM customer_quote_files"
sqlite3 prisma/dev.db "SELECT COUNT(*) FROM customer_quote_rows"
sqlite3 prisma/dev.db "SELECT COUNT(*) FROM customer_quote_rows WHERE sale_price_usd IS NOT NULL"
```

### Step 6: 提交

```bash
git add scripts/v5.0b-migration.sql scripts/customer-quote-import-v5.0b.ts prisma/schema.prisma docs/v5.0b-import-report.md
git commit -m "V5.0B: historical customer quote import — customer_quote_files + customer_quote_rows"
```

## 验收标准

1. `customer_quote_files` 和 `customer_quote_rows` 表已创建
2. Prisma schema 包含对应 model，`tsc --noEmit` 通过
3. 导入覆盖 ≥160 个文件（176 减去读取失败的）
4. `sale_price_usd IS NOT NULL` 行数 ≥ 总行数 70%
5. dry-run 和 apply 报告完整
6. 不写 `supplier_offers` / `products` / `quote_items`
7. DB 备份存在

## 不做的事

- 不写 supplier_offers
- 不写 products
- 不改现有表数据
- 不做产品匹配（matched_product_id 全部为 NULL）
- 不建 UI
- 不改源文件
