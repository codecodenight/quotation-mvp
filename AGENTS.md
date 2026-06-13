# AGENTS.md — Supplier Quotation System MVP

## Project Definition

Local-only supplier quotation management system.
Core loop: scan files → import Excel → product library → quotation export.
Not a cloud SaaS. Not an AI agent. A structured data tool.

Reference: docs/project-brief.md for full background.
Reference: docs/phase0-spike-report.md for Excel spike findings.

---

## Core Constraints (non-negotiable)

1. This is a LOCAL tool. No cloud deployment in MVP.
2. Tech stack: Next.js + TypeScript + Tailwind CSS + Prisma + SQLite.
3. Do NOT use: Supabase, Vercel, RAG, vector DB, AI Agent, LLM calls.
4. Do NOT use: Baidu Netdisk sync, Feishu bot, PDF AI parsing.
5. Do NOT build multi-user auth or tenant system.
6. Do NOT develop any phase before the previous phase is reviewed and approved.
7. Do NOT add features, fields, or tables beyond what is specified.

---

## Phase 0: Real Excel Spike

### Status: COMPLETED ✓

### Findings Summary

5 real supplier Excel files inspected (3 .xlsx, 2 .xls).

What works:
- Prices are stored in cells, not images, in 4/5 files (1 file was a blank template).
- Product identifier + price can be column-mapped for ~80-100% of rows in price-bearing files.
- No one-product-per-sheet layout found.
- SheetJS successfully reads both .xlsx and .xls files.

What does NOT work:
- MOQ is not a separate column in ANY file. Zero coverage.
- Material and size are almost always embedded in description/参数 free text, not independent columns.
- Product name and model number are often combined or one is missing.
- Tables do not start at row 1 — header row selection is required.
- Multi-sheet files have different headers per sheet.
- Multiple price columns are common (tax/no-tax, RMB/USD, packaging variants).
- Some files are templates/requests with blank prices, not completed quotations.

### Decision (per pre-committed rule)

Six-field clean mapping: <30% → would be STOP.
Core-field mapping (product identifier + price): ≥70% → PROCEED.

**Verdict: PROCEED WITH ADJUSTMENTS.**

The column-mapping model works for the core data loop (which product, which factory, what price).
Enrichment fields (MOQ, material, size) cannot be obtained via column mapping in v1.
The system is still valuable with reduced field coverage.

---

## Phase 0 Design Adjustments (mandatory for Phase 4+)

These adjustments override the original project-brief assumptions.

### 1. Required vs Optional Fields in Import

Original assumption: 6 fields (product name, model no., price, MOQ, material, size) all mapped from columns.
Reality: only product identifier + price are reliably available as columns.

New rule:
- Required mapped fields: product identifier (name or model or spec) + price column + currency
- Optional mapped fields: MOQ, material, size (allow NULL)
- Always store: raw description/参数 text for future text extraction
- Always store: full raw row as JSON (raw_row_data)

### 2. Import Flow Redesign

The Excel import flow must include these steps (in order):

```
Select file
→ Select sheet (for multi-sheet files)
→ Select header row (tables don't start at row 1)
→ Preview data
→ Map required fields: product identifier column + price column + currency
→ Map optional fields: MOQ / material / size (allow skip)
→ Map description/参数 column (for raw text preservation)
→ Store full raw row JSON
→ Write to raw_products
```

### 3. Multi-Price Column Handling

Many files have multiple price columns (含税/不含税, RMB/USD, packaging variants).
The import UI must let the user choose WHICH price column to use and label its currency.
Do not assume one price column per file.

### 4. Schema Adjustments

These fields in raw_products are nullable:
- raw_moq (NULL in most imports)
- raw_material (NULL in most imports)
- raw_size (NULL in most imports)

New fields to add:
- raw_products.raw_description — stores original 描述/参数 text (future text extraction source)
- raw_products.source_sheet_name — which sheet the row came from (multi-sheet files)
- raw_products.header_row_index — which row was used as header during import

### 5. Impact on Phase 5 (Product Triage)

When converting raw_products → products + supplier_offers:
- Do NOT expect MOQ/material/size to be auto-filled from import
- Product triage page must support manual field entry for missing data
- Future AI text extraction from raw_description is not a nice-to-have — it is a validated need

---

## Development Order

```
Phase 0: Real Excel spike              ✓ COMPLETED
Phase 1: Project setup                 ✓ COMPLETED
Phase 2: File scanner                  ✓ COMPLETED
Phase 3: Product CRUD                  ✓ COMPLETED
Phase 4: Excel import (adjusted design) ✓ COMPLETED
Phase 5: Product triage (产品整理)       ✓ COMPLETED
Phase 6: Quotation export              ✓ COMPLETED
```

Each phase requires review before the next begins.
Phase 1 and Phase 2 may be done together.

### Completed

| Version | Scope | Status |
|---------|-------|--------|
| Phase 0 | Real Excel spike | ✓ |
| Phase 1 | Project setup | ✓ |
| Phase 2 | File scanner | ✓ |
| Phase 3 | Product CRUD | ✓ |
| Phase 4 | Excel import | ✓ |
| Phase 5 | Product triage | ✓ |
| Phase 6 | Quotation export | ✓ |
| V1.1 | 核价文件导入 | ✓ |
| V1.2 | 报价单客户模式导出 | ✓ |
| V1.3 | CTN 三列拆分 + 客户模式导出更新 | ✓ |
| V1.4 | CTN 批量回填 + 产品类别清洗 | ✓ |
| V1.5 | 报价单 Product Details / MOQ 显示清洗 | ✓ |
| V1.6 | 报价前数据体检提示 | ✓ |
| V1.7 | 产品库 CTN 补录入口 + 报价页跳转修资料 | ✓ |
| V1.8 | 报价预览/确认 | ✓ |
| V1.9 | 核价导入增强（多列合并 + 价格清洗 + 非数据行跳过） | ✓ |
| V1.10 | 真实验收 + 跨搜索选品 + 同币种汇率 UI | ✓ |
| **V2.0** | **MVP 定稿 — 日常内部使用就绪** | **✓** |
| V2.1 | 批量导入未覆盖品类 + price_updated_at 时间戳 | ✓ |
| V2.2 | 报价会话清理 + 数据质量工具 + Product Details 清洗 | ✓ |
| V2.3 | 产品标识清洗（缺款号 / 纯数字款号 / 壁灯临时款号） | ✓ |
| V2.4 | 重复产品审计 + 壁灯 Type A/B 区分 | ✓ |
| V2.5 | 报价历史搜索 / 详情 / 复用 | ✓ |
| V2.6 | 产品图提取（.xlsx zip 解压 + .xls LibreOffice 转换 + 缩略图生成） | ✓ |
| V2.7 | 第二目录批量导入 + parsePriceValue ¥ 符号修复 | ✓ |
| V2.8 | 数据质量审计 + Importer 增强 + Review 文件补导 | ✓ |
| V2.9 | 2-Offer 重复清理 + Image Backfill | ✓ |
| V2.10 | 价格版本追踪（import upsert + price_history） | ✓ |
| V2.11 | Multi-price parser（多价格单元格拆分导入） | ✓ |
| V2.12 | Image backfill round 2（扩大锚点搜索 + 组件匹配） | ✓ |
| V2.15 | 品类字段模板定义（V3.0 前置规范） | ✓ |
| V2.16 | 表头误导入产品清理（4 products + 5 offers） | ✓ |
| V3.0A | DB-only 参数提取（球泡/太阳能/灯带/净化灯/吸顶灯） | ✓ |
| V2.13A | 重组硬盘源文件全量盘点（1,215 Excel 四档分类） | ✓ |
| V2.14 Batch 1 | 批量导入第一批（投光灯/面板灯/线条灯/路灯/灯带） | ✓ |
| V3.0B | Batch 1 参数提取（投光灯/面板灯/线条灯/路灯/灯带） | ✓ |
| V2.14 Batch 2 | 批量导入第二批（吸顶灯/筒灯/三防灯/磁吸灯/净化灯/镜前灯/防潮灯） | ✓ |
| V3.0C | Batch 2 参数提取（吸顶灯/筒灯/三防灯/磁吸灯/净化灯/镜前灯/防潮灯） | ✓ |
| V3.0D | 剩余 12 品类参数提取（灯丝灯/轨道灯/橱柜灯/太阳能壁灯等） | ✓ |
| V2.14 Batch 3 | 批量导入第三批（风扇灯/工作灯/G4G9 + 剩余补导品类） | ✓ |
| V3.0E | Batch 3 参数提取（风扇灯/工作灯/G4G9 + 剩余补导品类） | ✓ |
| V4.0A | 产品库参数筛选 + 参数标签（品类下拉/功率范围/IP 筛选） | ✓ |
| V4.0B | 报价中心参数筛选 + 产品库参数详情 + 共享 product-filters.ts | ✓ |
| V4.0C | 报价 Product Details 参数化生成（product-details-builder.ts） | ✓ |
| V2.17 | 灯管/球泡分类（27 文件只读 sheet 级分类） | ✓ |
| V2.17E-F | 价格列检测修复（黑名单 + 语义优先 + 同列排除） | ✓ |
| V2.17G | 灯管/球泡拆分导入 apply（+266 products +330 offers） | ✓ |
| V3.0F | 球泡/灯管参数提取（球泡 100% / 灯管 98.8%） | ✓ |
| V2.18 | 户外工厂-未判定导入（18 文件，新品类充电灯） | ✓ |
| V2.18B | 伊特 4.25 投光灯导入（+44 products +202 price_history） | ✓ |
| V3.0G | V2.18 户外产品参数提取（充电灯 extractor + 7 品类重跑） | ✓ |
| V4.1 | 报价质量修复（size 参数感知 + CCT 容差过滤 + fallback 清洗） | ✓ |
| V4.2 | 报价警告分层 + Product Details 质量检测（三层 CategorizedWarning + tier UI） | ✓ |
| V4.4A | 数据质量仪表盘（/data-quality 只读覆盖率页面） | ✓ |
| V2.19A-0 | 瑞雪净化灯污染审计（1,368 垃圾产品确认，安全删除） | ✓ |
| V2.19A-1 | 瑞雪净化灯垃圾删除（-1,362 产品/offers，净化灯覆盖 11%→83%） | ✓ |
| V2.19B | 全品类污染扫描（3🔴 + 11🟡，误报 4 组已排除） | ✓ |
| V2.19C | 明确垃圾删除（5 组 -54 产品 -81 offers -89 params） | ✓ |
| V2.19D | 部分垃圾逐条审计（3 组 98 产品：40 junk / 3 suspect / 55 keep） | ✓ |
| V2.19D-apply | 部分垃圾删除（41 产品 -44 offers -63 params -44 price_history） | ✓ |

### Current Data (after V2.19C)

- Products: 9,887 across 32 categories (V2.19A-D cumulative: -1,457 junk products)
- Supplier offers: 10,941
- Product params: 37,045 (32 品类全部有参数)
- Product images: ~7,550 (~76% coverage)
- Imported from 563+ source files with active supplier offers (1,097 My Passport file records)
- CTN coverage: ctn_qty ~2,813 / L×W×H ~1,787 out of 10,941 offers
- Price timestamp coverage: ~95%
- Price history: 9,853 records

### V2.0 Definition — Daily Internal Use Ready

V2.0 means the system is ready for daily internal use by the developer/operator.
It does NOT mean ready for non-technical end users or external deployment.

**V2.0 acceptance criteria (all passed 2026-06-08):**

1. Real quotation files import without manual database work.
2. Customer quote export matches the approved template without manual format fixes.
3. Quote health warnings catch missing/bad data before export.
4. User can fix product data from the UI, not from SQLite/scripts.
5. Source Excel files remain read-only and safe.
6. Quote preview shows exactly what the Excel will contain before generating.
7. Products from different categories can be selected in one quote.
8. Pricing formula verified: purchase_price / exchange_rate × (1 + profit_margin).

**V2.0 verified workflow (30-minute standard):**

```
Import factory Excel (multi-column merge, price cleaning, row skipping)
→ Check product library (fix missing data via UI)
→ Search products across categories
→ Select products + supplier offers
→ Preview quote in browser (with health warnings)
→ Confirm export
→ Customer-mode Excel ready to send
```

**V2.0 known limitations (accepted, not blocking):**

- CTN coverage ~47% — source data limitation, not system limitation.
- No automatic product dedup — duplicate model numbers may exist across imports.
- Category derived from sheet name — "sheet1" is not meaningful for some files.
- Large files (80MB+) may be slow during import preview.
- Runs via `npm run dev` only — no desktop packaging.
- Single user — no auth or multi-user support.
- Customer name is free text — no customer entity management.
- ~~No price version tracking~~ — resolved in V2.10 (import upsert + price_history table).
- Quote history simple-list limitation resolved in V2.5 (search/detail/reuse added).
- Generated quote file paths are absolute — fragile if files are moved.

### Post-V2.0 Roadmap

Ordered by estimated business impact, not technical difficulty.

| Version | Scope | Why |
|---------|-------|-----|
| V2.1 | 批量导入未覆盖品类 + price_updated_at 时间戳 | Scale product library coverage |
| V2.2 | 报价会话清理 + 数据质量工具 + Product Details 清洗 | Improve daily quotation workflow |
| V2.3 | 产品标识清洗 | Clean customer-facing model names |
| V2.4 | 重复产品审计 + 壁灯 Type A/B 区分 | Clean up duplicate model numbers |
| V2.5 | Quote history search/detail/reuse | Find and reuse previous quotes |
| V2.6 | 产品图提取 | Import embedded product images for newly imported quote files |
| ~~V2.10~~ | ~~价格版本追踪~~ | ~~Import upsert + price_history table~~ ✓ |
| ~~V2.11~~ | ~~Multi-price parser~~ | ~~Handle `3CCT:9 12CCT:10.5` style cells~~ ✓ |
| ~~V2.12~~ | ~~Image backfill round 2~~ | ~~Wider anchor search for generated model_no products~~ ✓ |
| V3.0 | AI / 规则化参数提取 | Auto-extract specs from unstructured text |
| V3.1 | Customer entity management | Replace free-text customer names with records |
| V3.2 | Desktop packaging (Tauri) | Non-technical users can run without terminal |

These are candidates, not commitments. Priority may change based on real usage feedback.

---

## Data Sources — Two Import Paths

The app supports two Excel import paths:

- Supplier quotation files: imported into `raw_products`, then reviewed in product triage.
- 核价 files: imported directly into `products` + `supplier_offers`, skipping `raw_products`.

核价 import supports two carton size mapping modes:
- Mode A (single column): "52.3×49.5×27.4 cm" → parsed into ctn_length/width/height
- Mode B (three columns): L/W/H mapped separately → stored directly
Mode B takes priority if both are mapped. Parser: parseCtnSize() in hejia-import.ts.

---

## Technical Rules

### Excel Library Rule (FINAL — resolved by format audit)

Reading: SheetJS (xlsx), installed from CDN tarball, NOT from npm registry.
Writing (quotation export): exceljs, installed from npm.

```bash
npm install https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz
npm install exceljs
```

The CDN install registers as the `xlsx` module name.
Code usage: `const XLSX = require('xlsx')` or `import * as XLSX from 'xlsx'`.

Do NOT run `npm install xlsx` — that pulls stale 0.18.5 from npm with unpatched CVE.

Rationale: 31.6% of supplier files are .xls. exceljs cannot read .xls.
SheetJS reads both .xlsx and .xls natively. exceljs produces better styled export output.

---

### ID Rule

Use UUID (v4) primary keys for ALL database tables.
Do not use auto-increment integer IDs.

Rationale: future migration, sync, backup merge, or multi-instance scenarios
are far easier with UUIDs. Cheap to do now, painful to retrofit.

---

### Currency Rule

Add currency fields wherever prices exist.

Required fields:
- `supplier_offers.currency` — factory's quoted currency (typically RMB)
- `quotes.currency` — customer-facing currency for the entire quote (typically USD)
- `quote_items.purchase_currency` — snapshot of supplier currency at time of quote

`sale_currency` lives on `quotes` (one quote = one currency), not repeated per item.

MVP assumption: supplier prices in RMB, customer quotes in USD.

---

### File Path Rule

Do not store only raw absolute paths. External drive mount paths change.

Store three fields:
- `volume_name` — drive/volume label
- `relative_path` — path relative to the scanned root
- `absolute_path_snapshot` — full path at scan time (convenience cache only)

Resolve files using volume_name + relative_path. Fall back to snapshot.

---

### File Serving Rule

Browsers cannot load local files via absolute filesystem paths.

Implement a local API route: `/api/files/[id]`

This route:
1. Looks up the file record by ID in the database
2. Resolves the file path from volume_name + relative_path
3. Streams the file content to the browser

Use for: image preview, PDF preview, file download.

Do NOT accept raw file paths from the browser.
Do NOT expose arbitrary filesystem paths to the client.

---

### File Safety Rule

The system MUST NEVER:
- Delete source files
- Move source files
- Rename source files
- Overwrite source files

The system MAY ONLY:
- Read file metadata
- Read file content for parsing
- Stream files for preview via API
- Store parsed/structured data in SQLite

---

### Scan Reliability Rule

If a file cannot be read during scanning, skip it and log the error.
Never stop the entire scan because of one bad file.

Handle gracefully:
- Permission denied
- File locked by another process
- Hidden / system files
- Unsupported file types
- Broken symlinks
- Extremely large files (set a size threshold, log and skip)

---

### Cheap Duplicate Signals

During file scanning, store:
- `file_size`
- `modified_at`
- `file_name`
- `relative_path`

Do NOT compute full content hashes in MVP.
Hashing hundreds of GB is too slow for scanning.
Content hash may be added later as an optional per-file operation.

---

### Encoding Rule

Handle Chinese filenames and content carefully.

Requirements:
- Preserve original Chinese file names in the database
- Normalize filenames (Unicode NFC/NFD) before string matching
- Do not assume all text is UTF-8
- CSV files from Chinese Excel are often GBK / GB18030 — detect and handle
- Prioritize .xlsx handling; .xls via SheetJS handles encoding internally

---

## App Delivery Note

For MVP development, running via `npm run dev` on localhost is acceptable.

If the end user is non-technical, a desktop wrapper will be needed later:
- Tauri (preferred, smaller binary)
- or Electron

Do NOT implement desktop packaging in MVP unless explicitly requested.

---

## Sample Data Structure

```
sample-data/
├── supplier/          ← Phase 0 files (3–5 real files from different factories)
│   ├── factory-a.xlsx
│   ├── factory-b.xls
│   └── ...
├── client-ref/        ← Reference only: 1–2 existing customer quotations
│   └── quote-sample.xlsx
└── README.md          ← One line per file: factory name, product category, notes
```

---

## Database Tables (summary)

| Table | Purpose | Key notes |
|-------|---------|-----------|
| files | Scanned file index from external drive | volume_name + relative_path + absolute_path_snapshot |
| raw_products | Raw rows imported from Excel, pre-cleanup | raw_moq/raw_material/raw_size all NULLABLE; has raw_description, source_sheet_name, header_row_index, raw_row_data JSON |
| products | Cleaned, confirmed product catalog entries | MOQ/material/size may be manually entered |
| supplier_offers | Per-factory pricing for each product | currency field; ctn_qty (装箱数); ctn_length/ctn_width/ctn_height (箱规 L/W/H, 纯数字, cm); ctn_size (legacy, 保留不写入); moq as String (DB 存原始值, 导出时清洗) |
| quotes | Customer quotation header | customer, currency (sale), margin, exchange_rate |
| quote_items | Line items in a quotation | purchase_currency snapshot, product, prices, quantity |

All tables use UUID primary keys.
All price fields include a currency column.
All timestamps use ISO 8601.

---

### Quotation Format — Matches User's Real Format

Reference template: sample-data/客户模式报价单-CTN三列示例.xlsx

Structure:
- Row 1: 报价单 (title, merged across all columns)
- Row 3: 客户 / 报价币种 / 报价日期
- Row 4: 利润率 / 汇率
- Row 6-7: Double-row header
- Row 8+: Data

Customer mode — 10 columns (A-J):

| Col | Row 6 Header | Row 7 Sub | Source |
|-----|-------------|-----------|--------|
| A | Model Name | (merged) | products.model_no |
| B | Product Details | (merged) | products.remark + "\nSize: " + products.size |
| C | Unit Price ({currency}) | (merged) | Calculated sale_price |
| D | MOQ | (merged) | supplier_offers.moq (cleaned: strip /色, pcs, keep leading digits) |
| E | CTN Qty | (merged) | supplier_offers.ctn_qty |
| F | Carton Size (F6:I6 merged) | L | supplier_offers.ctn_length + " cm" |
| G | | W | supplier_offers.ctn_width + " cm" |
| H | | H | supplier_offers.ctn_height + " cm" |
| I | | Volume | Calculated: L×W×H / 1,000,000, 3 decimal places, " m³" |
| J | Remark | (merged) | User input |

Internal mode (customerMode=false) — 12 columns (A-L):
Insert Factory Name (col C) and Purchase Price (col D) before Unit Price.
All subsequent columns shift right by 2. Carton Size merges H6:K6.

Key formatting:
- Row 6: fill #3F4A35, white bold text
- Row 7 (Carton sub-headers only): fill #6B7A5A, white bold text
- Row 3-4 labels: fill #ECE5D8, bold
- Borders: thin, color #D8D1C2
- Freeze: A8 (rows 1-7 frozen)
- AutoFilter: row 7
- Unit Price format: #,##0.00 "{currency}"
- Product Details: wrapText, width 48

---

### Pricing Formula

sale_price = purchase_price / exchange_rate × (1 + profit_margin)

- Same currency: exchange_rate = 1, formula simplifies to purchase × (1 + margin)
- Different currency: user enters exchange rate as "1 sale_currency = X purchase_currency"
  (e.g., 1 USD = 7.2 RMB → exchange_rate = 7.2)
- UI label: "汇率（1 报价币种 = ? 采购币种）"

---

## Key Architecture Decisions

### Carton Size — L/W/H 三字段分存

Carton Size 拆成 ctn_length / ctn_width / ctn_height 三个独立 String 字段，存纯数字（不带单位）。
导出时拼 " cm" 后缀。旧字段 ctn_size 保留但不再写入新数据。

Reason: 客户报价单需要 L/W/H 分列显示，便于客户做装柜计算。
单一字段 "L×W×H" 解析分隔符不可靠（×/x/X/* 混用）。

### Volume — 导出时计算，不存数据库

Volume = ctn_length × ctn_width × ctn_height / 1,000,000 (m³)
导出时动态计算，不存 ctn_volume 字段。

Reason: Volume 是 L×W×H 的确定性函数，存了反而可能与三个维度不一致。

### MOQ — DB 存原始值，导出时清洗

supplier_offers.moq 保留原始字符串（如 "1000/色"、"500PCS"）。
导出时用 cleanMoq() 提取开头连续数字。

Reason: 保留源数据完整性，清洗逻辑可随时调整不影响已有数据。

---

## What This Project Is NOT (in MVP)

- Not a chatbot or conversational AI
- Not a cloud/SaaS platform
- Not a multi-user system
- Not a PDF parser
- Not a Feishu/WeChat bot
- Not an email automation tool
- Not a product matching / dedup AI

These may be built as future enhancements on top of the MVP data layer.

---

## Current Immediate Task

None. Pending next task assignment.

## Known Data Quality Issues (post V4.2)

1. 1 组 `model_no + factory_name` 仍有 2 条 offer（WL-S02-6W / 绿晟，有 quote_items 引用无法删除）
2. ~3,781 个产品无图（主要原因：源文件无嵌入图片、generated model 无法匹配、anchor 偏移 >3 行、.xls 文件跳过图片提取）
3. V3.0G 已让 32 个品类全部进入 product_params 体系；剩余缺参数产品主要受 DB 字段文本缺失限制
4. V2.18 needs-review 4 文件（绿晟 R01/R03/R06 + W12F-20W50W）无型号列/RMB 价格列，暂时无法导入
5. V4.1 已清除 CCT < 1800K 脏数据（22→0）；V4.2 警告系统可在导出前检测 Product Details 中文/包装/行数问题
6. 凯晟德太阳能壁灯（TK-13 A 等）只有 `Chip Type: SMD2835`，源数据限制，待补规格
