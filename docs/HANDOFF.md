# HANDOFF.md — Session Context for Cold Start

Last updated: 2026-06-13
Source: Claude web chat + Claude Code/Codex sessions covering V1.3 → V4.2

This file captures decisions, context, and reasoning that cannot be inferred from the codebase alone. Read this before making architectural decisions.

---

## Current State (after V4.4A)

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
- Structured parameter extraction (V3.0A-F): `product_params` key-value table with raw_value, normalized_value, unit, source_field, confidence; 31 categories all have params
- Product library param filters + tags (V4.0A): category dropdown, watts range, IP dropdown; product cards show param badges with confidence coloring; `product-param-display.ts` reusable formatter
- Quotes + product library param enhancement (V4.0B): quotes page category/watts/IP/CCT filters + param tags in search results and selected items; product library CCT filter + `<details>` expandable full param table; shared `product-filters.ts` module eliminates duplication
- Quote Product Details from params (V4.0C): `product-details-builder.ts` generates stable English spec lines (Power/CCT/IP/Size/Material/...) from `product_params`; ≥2 valid lines → use params, otherwise fallback to remark+size; size dedup when `size_display` exists; preview, export, and history detail all share the same path
- Tube/bulb split import with price column audit (V2.17): mixed 球泡/灯管 files classified by sheet content, imported with hardened price column detection; `isNonPriceHeader()` blocklist + `isPriceHeader()` semantic priority + model==price same-column rejection + empty-header exclusion
- Outdoor factory unclassified import (V2.18): 19 files across 5 factories (凯晟德/绿晟/伊特/中屹) imported with per-file category assignment; new category 充电灯; `scripts/outdoor-import.ts` with hardcoded FILE_LIST + dry-run/apply modes; KCD-TB reclassified from 投光灯 to 太阳能壁灯 based on dry-run sample review
- Quote quality fixes (V4.1): health check recognizes `size_display` / dimension params as satisfying size requirement; CCT extraction rejects tolerance values (±500K) and standalone values < 1800K; Product Details fallback filters Chinese packaging labels and empty-value lines; `lumens` added to PARAM_FORMATTERS
- Warning tier system (V4.2): flat `string[]` warnings upgraded to `CategorizedWarning[]` with 3 tiers (customer-visible / quote-risk / logistics); Product Details quality checks detect Chinese chars, packaging labels, < 2 lines; preview UI: tier badges (red/amber/gray), per-tier filter checkboxes, row sorting by severity, tier-colored row backgrounds; export prompt distinguishes customer-visible issues from logistics warnings
- Data quality dashboard (V4.4A): `/data-quality` read-only page with per-category coverage metrics (products, offers, images, params, size, CTN); 4 parallel SQL aggregations via `prisma.$queryRaw`; three-color coverage encoding (≥80% green, 40-79% amber, <40% red); category names link to `/products?category=XXX`
- 瑞雪净化灯污染审计 (V2.19A Step 0): `scripts/ruixue-audit.ts` read-only audit confirmed 1,368 junk products from "瑞雪报价2023.8.31 - 净化灯-.xlsx" — product names are numeric codes, prices are MOQ tiers (1000/3000/5000/10000), zero remark/size; quote_items=0, safe to delete; 6 legitimate products (T8AP60/T8GlassAC60/T8PC90 系列) with real names+images must be excluded from deletion; after cleanup predicted: 图片 11%→83%, 参数 12%→98%, Size 12%→96%, CTN 9%→73%
- 瑞雪净化灯垃圾删除 (V2.19A Step 1): `scripts/ruixue-cleanup.ts` with --dry-run/--apply modes; deleted 1,362 products + 1,362 offers + 4 params; preserved 6 T8 products; deletion scope adjusted from task spec's `NOT GLOB '*[a-zA-Z]*'`(only 852 hits) to `image_path IS NULL`(1,362 hits) because junk names like `1000pom/1000eco` contain letters; backup at `backups/dev-before-v2.19a-step1-20260613-202132.sqlite`

### Data (after V2.19A Step 1)
- Products: 9,982 across 32 categories (净化灯 1,559→197 after V2.19A cleanup)
- Supplier offers: 11,066
- Files (My Passport): 1,097+
- Price history: 9,899 records
- Product images: 7,563 products have images
- Product params: 37,236 (32 categories all have params; V3.0G added 187 net new params)
- Batch 1 categories growth: 投光灯 16→492, 面板灯 69→902, 线条灯 38→1,123, 路灯 15→213, 灯带 21→383
- Batch 2 categories growth: 吸顶灯 49→597, 筒灯 110→1,111, 三防灯 79→445, 磁吸灯 148→786, 净化灯 80→1,559, 镜前灯 63→185, 防潮灯 11→126
- Batch 3 categories growth: 风扇灯 0→264, 工作灯 0→97, G4G9 0→51, 太阳能壁灯 87→561, 壁灯 27→290, 橱柜灯 134→204
- Tube/bulb split growth: 球泡 151→341 (+190), 灯管 8→84 (+76)
- Outdoor factory import (V2.18/B): 充电灯 0→7, 投光灯 +48, 面板灯 +16, 路灯 +16, 工作灯 +12, 太阳能壁灯 +6, Highbay +3

### Data Sources on Disk (reorganized 2026-06-11)
User reorganized the external hard drive from a flat structure (~60 top-level dirs) to a hierarchical structure:
```
各家工厂最新报价汇总/
├── 室内照明/     (15 subcategories, 596 Excel files)
├── 光源/         (5 subcategories, 65 Excel files)
├── 灯带/         (11 subcategories, 51 Excel files)
└── 户外照明 工业照明/ (8 subcategories, 503 Excel files)
```
- Total: 1,215 Excel files + 617 PDFs across 38 level-2 category directories
- `发客户报价单汇总/` — customer quotes (FOB USD), NOT a price import source
- `户外工厂/` is a mixed-category directory (283 Excel files spanning 庭院灯/投光灯/路灯/Highbay/太阳能)

### V2.13A Source Inventory (commit 3af3681)
Full read-only scan of all 1,215 Excel files, classified into 4 tiers:
- **likely-importable: 683** — has RMB price + model column, not yet imported
- **enrichment-only: 328** — no RMB price but has specs/params/images
- **needs-review: 113** — ambiguous price semantics or structure
- **likely-skip: 91** — already imported / empty / template / catalog
- Read failures: 7
- New categories found on disk: 风扇灯(29), 工作灯(31), G4G9(7), 铝型材(6), T5(2), 支架(2), LED模组(2)
- Full report: `docs/v2.13a-source-inventory.md` (3,059 lines)
- Import candidates CSV: `docs/v2.13a-import-candidates.csv`
- Reusable scan script: `scripts/source-inventory.ts`

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

### Drive reorganization: new directory structure is authoritative (2026-06-11)
- Old flat DB paths are now invalid; 258 stale file records cleaned
- 9 stale files had 201 linked offers → source_file_id set to NULL (offers/products preserved)
- 3 ambiguous generic-name files (`图片1.png`, `02.jpg`, etc.) left untouched
- All remaining 477 file records have valid paths on current drive structure
- Cleanup report: `docs/stale-files-cleanup-report.md`

### Price column detection hardening (V2.17E-F)
- V2.17D first attempt had systematic price column misdetection: `No./序号/功率/灯珠颗数` columns outranked real price columns by numeric density
- Fix: `isNonPriceHeader()` blocklist (序号/功率/电流/尺寸/灯珠颗数/数量 etc.) + `isPriceHeader()` semantic priority in `sortSignal()` + model==price same-column rejection + empty-header column exclusion + surcharge column exclusion (堵头/差价/配件)
- Result: 86/91 sheets fixed; remaining sheets correctly skipped as no-import-columns
- Lesson: any future import script must use semantic price column detection, not just numeric density

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
| V3.0A | DB-only 参数提取 | 从现有 DB 字段提取结构化参数到 `product_params` 表；5 品类（球泡/太阳能/灯带/净化灯/吸顶灯）472 产品 → 2,755 条参数（high 1,237 + medium 1,518） |
| — | 硬盘重组 + stale files 清理 | 用户重新整理硬盘目录：扁平→四大类三级结构。清理 258 条旧路径 file 记录，201 条 offers source_file_id 置空，477 条有效 |
| V2.13A | 源文件全量盘点 | 1,215 个 Excel 四档分类：683 likely-importable / 328 enrichment-only / 113 needs-review / 91 likely-skip。发现 7 个全新品类 |
| V2.13B | 导入计划审阅 | 683 候选按品类-工厂分组审阅；Batch 1 选定 5 品类 309 文件；新品类决策（风扇灯/工作灯/G4G9 建、铝型材/灯带连接器 不建）；市电壁灯→壁灯、LED橱柜灯→橱柜灯 |
| V2.14 B1 | 批量导入 Batch 1 | 309 文件（305 成功）自动检测导入；+2,870 产品 +3,093 offers +2,113 图片 +4,426 价格历史；投光灯/面板灯/线条灯/路灯/灯带 5 品类 |
| V3.0B | Batch 1 参数提取 | 5 品类 3,029 产品 → 8,898 条参数（覆盖 2,602 产品 86%）；投光灯 95%/路灯 90%/灯带 90%/线条灯 87%/面板灯 77%；新增 extractCct/extractPf/extractLmW；product_params 2,755→11,575 |
| V2.14 B2 | 批量导入 Batch 2 | 210 文件（210 成功）自动检测导入；+4,269 产品 +4,590 offers +2,579 图片 +2,820 价格历史；吸顶灯/筒灯/三防灯/磁吸灯/净化灯/镜前灯/防潮灯 7 品类 |
| V3.0C | Batch 2 参数提取 | 7 品类 4,809 产品 → 15,905 条参数（覆盖 2,773 产品）；筒灯 86% / 三防灯 89% / 防潮灯 93% / 净化灯 12%（源规格文本缺失）；product_params 11,575→26,758 |
| V4.0A | 产品库参数筛选 + 参数标签 | 品类下拉（带计数）+ 功率范围（raw SQL CAST）+ IP 下拉；产品卡片参数标签（优先级排序、confidence 颜色）；offer 查询改 explicit select 规避 price_updated_at 脏数据；`product-param-display.ts` 可复用格式化模块 |
| V4.0B | 报价中心参数筛选 + 产品库参数详情 | 报价中心品类/功率/IP/CCT 筛选 + 搜索结果&已选产品参数标签；产品库 CCT 筛选 + `<details>` 展开全参数表格（来源+置信度）；筛选逻辑提取到 `product-filters.ts` 共享模块 |
| V4.0C | 报价 Product Details 参数化生成 | `product-details-builder.ts` 按固定顺序生成英文规格行；≥2 有效行启用参数化，否则 fallback remark+size；Size 去重；预览/导出/历史共用同一路径；`prepareQuoteItems` + `getQuoteDetail` 改 explicit select |
| V3.0D | 剩余 12 品类参数提取 | 灯丝灯/轨道灯/橱柜灯/太阳能壁灯/庭院灯/应急灯/地埋灯/壁灯/台灯/灯管/Highbay/皮线灯 1,116 产品 → 5,165 条参数（覆盖 1,083 产品）；product_params 26,758→31,923；修正 `5m/50珠` 尺寸误提取和 `LUMEN: 1400LM` 光效误提取 |
| V2.14 B3 | 批量导入 Batch 3 | 115 文件（105 成功，10 无可导入 sheet）；+1,691 产品 +2,077 offers +1,567 图片 +952 价格历史；新增风扇灯/工作灯/G4G9；LED橱柜灯→橱柜灯、市电壁灯→壁灯、支架→线条灯 |
| V3.0E | Batch 3 参数提取 | 16 品类 4,092 产品 → 12,003 条参数（覆盖 3,306 产品）；新增风扇灯/工作灯/G4G9 extractor + `extractLabeledBase`；product_params 31,923→35,443；29 品类全部有参数 |
| V2.17 | 灯管/球泡分类 | 27 文件只读分类：12 球泡 / 9 灯管 / 3 混合 / 3 未知；`scripts/classify-tube-bulb.ts` 关键词匹配 + sheet 级分类 |
| V2.17B | 拆分导入计划 | 29 项导入计划（含 sheet 白名单）；佛山凯徽跳过、T5 一体化支架归灯管、嘉家旺文件名修复 |
| V2.17C | 拆分导入 dry-run | 96 sheets / 2,101 valid rows 预估；`scripts/tube-bulb-split-dryrun.ts` |
| V2.17D | 拆分导入 apply（有价格列误判） | +397 产品 +462 offers — 但 86/91 sheets 价格列误判（`No./序号/灯珠颗数` 当价格）；已回滚 |
| V2.17E | 价格列修复 round 1 | `isNonPriceHeader()` 黑名单 + `sortSignal()` 语义优先 + dry-run ⚠️ 标记；DB 回滚到 V2.17D 前 |
| V2.17F | 价格列修复 round 2 | 灯珠颗数入黑名单 + model==price 同列拒绝 + 空表头列排除 + 差价/配件列排除；报告 0 个 ⚠️ |
| V2.17G | 拆分导入 apply（修正后） | +266 产品 +330 offers +1,436 price_history；球泡 151→341、灯管 8→84；价格列全部有语义关键词 |
| V3.0F | 球泡/灯管参数提取 | 球泡 341/341（100%）+ 灯管 83/84（98.8%）→ +1,606 params；product_params 35,443→37,049；增强 `extractBulbParams` + `extractTubeLightParams` |
| V2.18 | 户外工厂-未判定导入 | 19 文件（18 import + 1 analyze-only）；15 sheets 导入 129 行 → +64 products +64 offers +63 price_history；新品类充电灯；KCD-TB 由投光灯改归太阳能壁灯；4 个 needs-review 文件检测失败静默跳过 |
| V2.18B | 伊特 4.25 投光灯导入 | 单文件 292 行 YLT-TG163 系列 → +44 products +44 offers +202 price_history；投光灯 444→492 |
| V3.0G | V2.18 户外产品参数提取 | 7 品类 2,315 产品重跑 → net +187 params；新建充电灯 extractor（7/7 100%）；product_params 37,049→37,236 |
| V4.1 | 报价质量修复（3 个客户可见问题） | 健康检查 size_display 参数感知；CCT lookbehind 加 ± + <1800K 阈值过滤（清除 22 条脏数据）；Product Details fallback 过滤包装标签 + 空值行；lumens 加入 PARAM_FORMATTERS |
| V4.2 | 报价警告分层 + Product Details 质量检测 | `CategorizedWarning` 三层分类（customer/quote/logistics）；预览 tier badges + 筛选 + 排序 + 分色行背景；Product Details 中文/包装/行数检测；导出提示区分客户可见 vs 普通警告 |
| V4.4A | 数据质量仪表盘 | `/data-quality` 只读页面；4 个并行 SQL 查询按品类统计图片/参数/Size/CTN 覆盖率；三色编码 + 品类跳转 |
| V2.19A-0 | 瑞雪净化灯污染审计 | `scripts/ruixue-audit.ts` 确认 1,368 垃圾产品（数字名、MOQ 价格、零 remark/size）；quote_items=0 安全删除；6 个正常产品需排除 |
| V2.19A-1 | 瑞雪净化灯垃圾删除 | `scripts/ruixue-cleanup.ts` 删除 1,362 产品+offers+4 params；保留 6 个 T8 产品；净化灯覆盖率跃升（图片 83%/参数 95%/Size 93%/CTN 71%）；全局 11,344→9,982 产品 |

---

## What's Next

### 已定路线（按优先级）
1. **V2.19A Step 2-3: 净化灯源文件审查 + 补导** — 审查瑞雪原始 Excel 确认列错位原因；评估剩余 likely-importable 净化灯文件是否值得导入
3. **数据充实** — 683 个 likely-importable 文件中仍有大量未导入；参数覆盖率可通过源文件二次提取提升
4. **Desktop packaging (Tauri)** — 非技术用户可脱离终端使用

### 已完成
- ~~Stale files cleanup~~ ✅ commit d274faa
- ~~V2.13A — 源文件只读扫描~~ ✅ commit 3af3681
- ~~V2.13B — 导入计划审阅~~ ✅ `docs/v2.13b-import-plan.md`
- ~~V2.14 Batch 1~~ ✅ commit cc288a2 — 5 品类 305/309 文件成功导入，+2,870 产品 +3,093 offers +2,113 图片
- ~~V3.0A — DB-only 参数提取~~ ✅ commit bd188ab — 5 品类 472 产品 → 2,755 条参数
- ~~V3.0B — Batch 1 参数提取~~ ✅ commit fd0b179 — 5 品类 3,029 产品 → 8,898 条参数，product_params 11,575
- ~~V2.14 Batch 2~~ ✅ 210/210 文件成功导入，+4,269 产品 +4,590 offers +2,579 图片
- ~~V3.0C — Batch 2 参数提取~~ ✅ 7 品类 4,809 产品 → 15,905 条参数，product_params 26,758
- ~~V4.0A — 产品库参数筛选~~ ✅ commit 50d0ac4 — 品类下拉 + 功率范围 + IP 筛选 + 产品卡片参数标签
- ~~V4.0B — 报价中心参数筛选 + 产品库参数详情~~ ✅ commit b7c5028 — 报价中心品类/功率/IP/CCT + 参数标签；产品库 CCT + 展开详情；共享 product-filters.ts
- ~~V4.0C — 报价 Product Details 参数化~~ ✅ commit cf48d03 — 结构化英文规格行 + remark fallback + Size 去重
- ~~V3.0D — 剩余 12 品类参数提取~~ ✅ 12 品类 1,116 产品 → 5,165 条参数，product_params 31,923，26 品类全部有参数
- ~~V2.14 Batch 3~~ ✅ 115 文件（105 成功），+1,691 产品 +2,077 offers +1,567 图片；新增风扇灯/工作灯/G4G9
- ~~V3.0E — Batch 3 参数提取~~ ✅ 16 品类 4,092 产品 → 12,003 条参数，product_params 35,443，29 品类全部有参数
- ~~V2.17 — 灯管/球泡分类~~ ✅ 27 文件分类：12 球泡 / 9 灯管 / 3 混合 / 1 跳过
- ~~V2.17E-F — 价格列检测修复~~ ✅ 系统性误判修复，两轮迭代，报告 0 个 ⚠️
- ~~V2.17G — 拆分导入 apply~~ ✅ commit 53dba12 — +266 产品 +330 offers；球泡 341、灯管 84
- ~~V3.0F — 球泡/灯管参数提取~~ ✅ commit 1dccea0 — 球泡 100%、灯管 98.8%；product_params 37,049
- ~~V2.18 — 户外工厂-未判定导入~~ ✅ commit 6dac394 — 18 文件导入 +64 products +64 offers；新品类充电灯；KCD-TB→太阳能壁灯
- ~~V2.18B — 伊特 4.25 投光灯导入~~ ✅ commit cfc7abe — +44 products +44 offers +202 price_history
- ~~V3.0G — V2.18 户外产品参数提取~~ ✅ commit e3fedea — 充电灯 7/7 100%；net +187 params；product_params 37,236
- ~~V4.1 — 报价质量修复~~ ✅ commit b0fd659 — size_display 参数感知 + CCT 容差过滤 + Product Details fallback 清洗 + lumens formatter
- ~~V4.2 — 报价警告分层~~ ✅ commit 4b3a97b — CategorizedWarning 三层 + tier badges/filter/sort + Product Details 质量检测
- ~~V4.4A — 数据质量仪表盘~~ ✅ commit 12e6428 — /data-quality 页面，30 个品类覆盖率一览
- ~~V2.19A Step 0 — 瑞雪净化灯污染审计~~ ✅ commit 61ad1ce — 1,368 垃圾产品确认，quote_items=0 安全删除，6 个正常产品需排除
- ~~V2.19A Step 1 — 瑞雪净化灯垃圾删除~~ ✅ commit 9ffe2f1 — 1,362 产品+offers 删除，6 个 T8 产品保留，净化灯图片 11%→83%

### 关键发现
- V2.14 Batch 1 自动检测成功率 98.7%（305/309），`scripts/batch-import-v2.14.ts` 可直接复用于 Batch 2/3
- V2.14 Batch 2 自动检测成功率 100%（210/210），说明同一脚本适合继续跑 Batch 3
- V2.14 Batch 3 自动检测成功率 91.3%（105/115），10 个文件无可导入 sheet，0 读取失败
- V2.14 Batch 3 新建风扇灯/工作灯/G4G9 三个品类，品类映射按计划执行：LED橱柜灯→橱柜灯、市电壁灯→壁灯、支架→线条灯
- V3.0E 新品类覆盖：风扇灯 237/264（89.8%），工作灯 66/85（77.6%），G4G9 51/51（100%）
- V3.0F 球泡 100% 覆盖（watts 95.9%/base 62.5%/size 54.3%），灯管 98.8% 覆盖（watts 82.1%/voltage 66.7%/lumens 48.8%）
- V2.18 dry-run 审核发现 KCD-TB 文件样本是 Solar wall light，果断改归太阳能壁灯；伊特 4.25 分析确认为单一投光灯品类（292 行 YLT-TG163），V2.18B 单独导入
- V2.18 needs-review 4 文件（R01/R03/R06/W12F-20W50W）全部检测失败：无型号列或 RMB 价格列，静默跳过，符合预期
- V3.0G 充电灯 extractor 覆盖 7/7（watts 100%/material 100%/size 100%/beam_angle 57%/lumens 57%）
- V3.0B 验证了 Batch 1 导入质量：remark 字段高度结构化（投光灯/路灯 Key:Value 格式），参数覆盖率 86%
- V3.0C 覆盖 2,773/4,809（57.7%）目标产品；筒灯/三防灯/防潮灯覆盖较好，净化灯低覆盖主要因为大多数新增记录没有 remark/size
- `extractCct`/`extractPf`/`extractLmW` 是可复用的通用函数，Batch 2 品类可直接用
- 新增功率边界防护：`XY-KD80W` 这类型号片段不会被误当成 `80W`
- 脏数据防护：`单组可连接最大功率` 不覆盖实际功率，已有测试
- 新品类决策已定：风扇灯/工作灯/G4G9 新建（Batch 3）；铝型材/灯带连接器 不进产品库；支架归入线条灯
- 品类名映射已定：市电壁灯→壁灯，LED橱柜灯→橱柜灯
- V4.0A 功率筛选需 raw SQL（`CAST(normalized_value AS REAL)`），Prisma string comparison 不支持数字语义
- 部分 offer 的 `price_updated_at` 存在非法时间戳，V4.0A 用 explicit select 规避
- V4.0B 筛选逻辑成功提取到 `product-filters.ts`，`getParamOptions()` 通用函数同时支持 IP/CCT/未来新参数
- CCT normalized_value 混合精确值（3000）和范围值（6000-6500），下拉按原值展示，精确匹配过滤
- V4.0C `buildProductDetailsFromParams` 用 `PARAM_FORMATTERS` 数组驱动，新增参数只需加一行配置
- V4.0C 改 `prepareQuoteItems` 和 `getQuoteDetail` 为 explicit select，连带消除 `price_updated_at` 脏数据风险
- V3.0D 让全部 26 品类进入 `product_params` 体系；灯丝灯 100% 覆盖，壁灯/Highbay 100% 覆盖，皮线灯只提取长度和材质，不把珠数当宽度
- V3.0D 修正了通用光效提取：`LUMEN: 1400LM` 只作为 lumens，不再误提取为 luminous_efficacy
- V2.17D 价格列误判教训：纯数字密度排序不可靠，`No./序号/灯珠颗数` 等列数字密度高于真正价格列；必须用语义优先 + 黑名单过滤
- V2.17G 产品目录-价格-2024.4.14.xlsx 12/18 sheets 因 model==price 同列或无价格列被正确跳过，宁可少导不污染价格
- V4.1 真实报价验收（5 产品 4 品类）发现 5 个问题：3 个客户可见（size/CCT/fallback）已修、1 个数据源限制（KCD specs）暂搁、1 个 UX 问题（CTN 警告淹没）→ V4.2 解决
- V4.1 CCT 提取 `6500±500K` → `500K` 误提取根因：lookbehind 缺 `±` + 无最低阈值；双重防线修复后 22 条脏数据全清
- V4.2 警告分层设计：tier 分类放在数据层（`CategorizedWarning`），颜色/标签放在 UI 配置（`WARNING_TIER_META`），实现了数据与呈现解耦
- V2.19A 审计发现瑞雪净化灯 1,368 产品中有 6 个是正常数据（T8AP60/T8GlassAC60/T8PC90 系列，有真实产品名和图片），删除时必须排除。删除范围应用 product_name 全数字判断，不能简单用 `factory_name LIKE '瑞雪%'`
- V2.19A 价格分布确认垃圾性质：339 个产品各分布在 1000/3000/5000/10000 四个价位，恰好是 MOQ 梯度，不是 RMB 价格
- V2.19A Step 1 口径调整教训：`NOT GLOB '*[a-zA-Z]*'` 只命中 852/1,368（62%），因为垃圾编码含字母后缀（`1000pom`/`1000eco`）。最终用 `image_path IS NULL` 作删除条件，在审计已验证"6 个有图=6 个正常"的前提下更精确

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
