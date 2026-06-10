# HANDOFF.md — Session Context for Cold Start

Last updated: 2026-06-10
Source: Claude web chat session covering V1.3 → V2.16

This file captures decisions, context, and reasoning that cannot be inferred from the codebase alone. Read this before making architectural decisions.

---

## Current State (after V2.16)

### System Capabilities
- Full quote lifecycle: import → product library → search (cross-category) → preview (with health warnings) → export (customer/internal mode) → history search → reuse
- Image extraction from .xlsx (zip + drawing anchors) and .xls (LibreOffice conversion)
- Multi-column merge import (V1.9): specs spread across Power/Voltage/CCT/etc. columns get merged into Product Details
- Price cleaning: strips $, ¥, currency suffixes during import; V2.7 fix: ¥ symbol priority in mixed spec+price cells
- Non-data row skipping: sub-headers in data area auto-detected and skipped
- Quote session management: auto-clear after export, "新建报价" button
- Same-currency auto-detection: exchange rate auto-sets to 1 when currencies match
- Fill-down model column support (V2.8 B1): merged cells / fill-down style model columns handled via `fillDownModelColumn: true`
- Generated model_no (V2.8 C): files without stable model columns can generate customer-readable model from spec/power/size columns
- Price version tracking (V2.10): import upsert by `product_id + factory_name` — update price + write `price_history` instead of creating duplicate offers
- Multi-price parser (V2.11): cells like `3CCT:9 12CCT:10.5` split into separate variant products/offers with suffix
- Image backfill round 2 (V2.12): rowRadius 1→3 + generated model component matching; 1,087→1,119 products with images

### Data
- Products: 2,140 across 26 categories (V2.16 removed 4 mistaken header-row products)
- Supplier offers: 2,230
- Imported from: ~116 files
- CTN coverage: ctn_qty 999 / L×W×H 597 out of 2,230 offers
- Price timestamps: 69% (1,674 offers with price_updated_at)
- Product images: 1,119 products have images (52% coverage, backfill from 84 source files, two rounds)

### Data Sources on Disk
- `/Volumes/My Passport/AI 报价/发客户报价单汇总` — customer quotation summaries by category (98 Excel files)
- `/Volumes/My Passport/AI 报价/各家工厂最新报价汇总` — factory quotations by factory (1,613 Excel files)
- ~1,000 PDF files (not parseable by current system)

---

## Key Decisions Made (with reasoning)

### Carton Size: L/W/H three separate fields, not one combined string
- Decided over template analysis showing customer needs L/W/H in separate columns
- `ctn_size` (legacy field) kept but not written to by new imports
- Volume calculated at export time: L×W×H/1,000,000 m³

### MOQ: store raw, clean at export
- DB keeps original string ("1000/色", "500PCS")
- Export-time `cleanMoq()` extracts leading digits
- Preserves source data fidelity

### Price semantics: only import factory RMB prices
- The 80MB summary file (`核价 Welfull ... 给南美客户 汇总.xls`) contains FOB USD = customer prices, NOT purchase prices
- Importing FOB USD as purchase_price would double-count margin
- RMB columns (单价/含税) in that file are derived from factory source files
- Primary data source = individual factory quotation files in category folders, not the summary file

### Product images: .xlsx zip extraction, .xls via LibreOffice
- SheetJS free version cannot extract images
- .xlsx: unzip → xl/media/ → xl/drawings/ anchor XML → row mapping
- .xls: `soffice --headless --convert-to xlsx` → then same path
- Thumbnail: 300px max width, JPEG, stored in `data/images/`
- `products.image_path` stores thumbnail path

### V2.0 definition: "daily internal use ready"
- NOT "ready for non-technical end users" (needs Tauri packaging)
- NOT "all data imported" (only ~4% of files imported)
- Acceptance: user can complete a real customer quote workflow in <30 minutes without terminal (except npm run dev)

### Data import strategy: quality over quantity
- Don't import all 2000 files blindly
- Each category needs: newest factory quotation file with RMB prices
- ~50-100 files are actually needed, not 2000
- Import in layers: high-frequency categories first, others on demand

### Two import directories have different price semantics (confirmed V2.7)
- `发客户报价单汇总` = customer-facing quotes, prices are FOB USD (sale price). Do NOT batch-import as purchase_price.
- `各家工厂最新报价汇总` = factory quotations, prices are RMB (cost price). This is the correct source for supplier_offers.purchase_price.
- V2.7 imported 30 files / 37 sheet entries from the second directory with strict price column verification.

### Fill-down model column (V2.8)
- Many factory files use merged cells or fill-down style: one model covers multiple variant rows, lower rows have empty model column
- `HejiaImportMapping.fillDownModelColumn: boolean` added — when true, empty model cells inherit previous non-empty value
- Validated with 德雷普灯丝灯: 91 → 271 valid rows

### Generated model_no for files without model column (V2.8)
- Some files have no stable model column (e.g., 一群狼净化灯 only has `灯珠型号=2835`)
- Solution: generate customer-readable model from multiple columns (sheet + category + spec + power)
- Applied to #26 中千, #27 一群狼, #28-30 恒百利
- Also used to solve variant collapse: #1 德雷普 and #15 优泽 GX53 had multiple wattage variants under one model — generated model with `Model + Watts + Base + Size` to differentiate

### Duplicate offer cleanup threshold (V2.8)
- V2.8 A3 cleaned groups with ≥ 3 duplicate offers per model+factory
- 204 groups with exactly 2 offers remain — not blocking, can be addressed in V2.9
- Price difference > 30% groups (e.g., 合力 T80-A with RMB/USD mixed prices) were approved for cleanup after manual review

### parsePriceValue ¥ symbol priority (V2.7 bugfix)
- Cells like "15000MA ¥282.5" contain spec numbers before the RMB price
- Old parser extracted first number (15000), new parser extracts first number after ¥ (282.5)
- Cells without ¥/￥ keep original behavior

---

## Version History (this session)

| Version | What | Key Decision |
|---|---|---|
| V1.3 | CTN three-column split + export template match | Template is authoritative over AGENTS.md text |
| V1.8 | Quote preview/confirmation | Server action for preview (ExcelJS can't go in client bundle) |
| V1.9 | Import enhancement (multi-column merge + price cleaning) | descriptionColumns: number[] replaces descriptionColumn: number |
| V1.10 | Real acceptance + cross-search selection fix | Preview "bug" was cross-origin (127.0.0.1 vs localhost), not code bug |
| V2.0 | MVP milestone | 8 acceptance criteria, all passed |
| V2.1 | Batch import 25 categories + price_updated_at | Category from folder name, not sheet name; model_no conflict = reuse product |
| V2.2 | Quote session cleanup + data quality tools | Auto-clear after export; product library quality filters |
| V2.3 | Product identifier cleanup | Wall light temp model_no → customer-readable names (done by Codex independently) |
| V2.4 | Duplicate audit + Type A/B split | Don't merge same-spec products (may differ by photo) |
| V2.5 | Quote history search/detail/reuse | Reuse uses CURRENT prices, not snapshot |
| V2.6 | Product image extraction | .xlsx zip + .xls LibreOffice conversion path |
| V2.7 | Second directory batch import + parsePriceValue bugfix | Only import factory RMB prices, never FOB USD; ¥ symbol priority fix; 471 new products, 328 images auto-extracted |
| V2.8 | Data quality audit + importer enhancement + review file import | Category merge (30→26), duplicate offer cleanup (-347), fill-down support, generated model_no for files without model column; +381 products, +145 images |
| V2.9 | 2-offer duplicate cleanup + image backfill | Cleaned 203 duplicate 2-offer groups (-203 offers); backfilled images from 84 source files (486→1,087 products with images, 51% coverage) |
| V2.10 | Price version tracking | Import upsert (product_id + factory_name) + price_history table; re-import updates price instead of creating duplicate; CTN/MOQ supplement without overwrite; quotes-client UX polish (scroll-to-history after export) |
| V2.11 | Multi-price parser | `parseMultiPrice()` splits `3CCT:9 12CCT:10.5` into variant products/offers; +12 products from #26 中千 |
| V2.12 | Image backfill round 2 | rowRadius 1→3 + generated model component matching; +32 products with images (1,087→1,119, 52% coverage) |
| V2.15 | 品类字段模板定义 | 26 品类结构化参数字段定义 + product_params 数据模型 + 提取安全规则。V3.0 核心输入。 |
| V2.16 | 表头误导入产品清理 | 删除 4 个 Excel 表头行误导入产品 + 5 条 offers（2,144→2,140 / 2,235→2,230） |

---

## What's Next

### 已定路线（按优先级）
1. **V2.13A — 源文件只读扫描**（任务文件已写好，等外接硬盘）— 9 个优先目录，四档分类（likely-importable / enrichment-only / needs-review / likely-skip）
2. **V2.13B — 人工确认导入清单** — 根据 V2.13A 报告决定每个品类/工厂导哪个版本
3. **V2.14 — 批量补导** — 补工厂 RMB 价 / CTN / 图片 / 规格 / price_history
4. **V3.0A — DB-only 参数提取** — 先处理球泡/太阳能/灯带/净化灯/吸顶灯（~700 产品），只用现有 DB 字段，只提 high/medium confidence
5. **V3.0B — source-aware 参数提取** — V2.14 补数据后，处理灯丝灯/三防灯/轨道灯等低覆盖品类

### 关键发现（V2.15 extraction spike）
- V3.0 不需要等硬盘：球泡/太阳能/灯带/净化灯/吸顶灯从现有 DB 字段就能提取大部分参数
- 灯丝灯是最大品类(471)但 watts/base 只有 37% 可提取，必须等 V2.14 补源数据
- 太阳能的 product_name 就是完整规格书，提取效果最好

### Not Now
- PDF parsing (high effort, uncertain value)
- Multi-user auth (single user tool)
- Customer entity management (V3.1)

---

## Working Rules

- Always backup DB before data scripts: `cp prisma/dev.db backups/dev-before-{task}-{date}.sqlite`
- Data cleanup pattern: read-only audit → user confirmation → backup → apply → post-audit → tests
- For naming/identifier changes: show before/after examples BEFORE writing to DB
- Codex task instructions: always include Step 0 checkpoint (report current state, wait for confirmation)
- Source Excel files are NEVER modified, moved, renamed, or deleted
- Schema changes use raw SQL + sqlite3 (Prisma schema-engine has empty error bug on this Mac)

---

## Workflow Migration

This is the first session using a structured handoff. Previous sessions used ad-hoc handoff documents:
- `docs/claude-opus-handoff.md` (V1.7 → V2.0 context)
- `docs/claude-sync-v2.4-from-v2.2.md` (V2.2 → V2.4 context)

Going forward:
- This HANDOFF.md is the single source of session context
- CLAUDE.md defines Claude Code Opus's role and permissions
- AGENTS.md remains the project rules and constraints reference
- Task instructions go in `docs/codex-task-*.md`
