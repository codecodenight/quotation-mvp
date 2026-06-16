# HANDOFF.md — Session Context for Cold Start

Last updated: 2026-06-16
Source: Claude web chat + Claude Code/Codex sessions covering V1.3 → V10.3

This file captures decisions, context, and reasoning that cannot be inferred from the codebase alone. Read this before making architectural decisions.

---

## Current State (after V10.3)

### System Capabilities
- Full quote lifecycle: import → product library → search (cross-category) → preview (with health warnings) → export (customer/internal mode) → history search → reuse
- Historical customer FOB USD quote search + manual product binding (/customer-quotes)
- Historical quote expanded rows show same-product FOB USD history after a product is bound (V5.4)
- Customer quote file customer names normalized/extracted where safe (V5.4: 79→116 named records)
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
- Structured parameter extraction (V3.0A-H): `product_params` key-value table with raw_value, normalized_value, unit, source_field, confidence; 30 categories all have params
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
- 全品类污染扫描 (V2.19B): `scripts/pollution-scan.ts` scored 198 category×factory groups; 3🔴 (吸顶灯-力音/面板灯-侧发光核价/线条灯-广交会) + 11🟡; 人工审阅确认 5 组明确垃圾(54产品)、3 组部分垃圾(98产品需精细过滤)、4 组误报(G4G9旭航/Highbay隆景/G4G9核价/风扇灯鸿烁)、1 组需调查(伟润578产品price=0)
- 明确垃圾删除 (V2.19C): `scripts/junk-cleanup-v2.19c.ts` 删除 5 组 54 产品 + 81 offers (含 27 条挂在垃圾产品上的组外 offer) + 89 params + 2 price_history; 19 个垃圾产品有跨工厂额外 offer，说明污染扩散到了 offer 层
- 部分垃圾逐条审计 (V2.19D): `scripts/partial-junk-audit.ts` 对 3 组 98 产品逐条标记 junk/suspect/keep; 审阅发现: 40 junk 确认删除, COB suspect 也删(共41); 2 个尼奥 LST-5050 suspect 保留(真产品但 price=芯片型号→V2.19E); 瑞鑫 keep 中 ~9 个是规格/材质文本不是产品名(也有价格问题→后续处理)
- 价格异常调查 (V2.19E): `scripts/price-audit-v2.19e.ts` 调查 3 组; **伟润 578 产品 price=0 是假警报**——V2.19B 的 `CAST AS INTEGER` 把 <1 元铝型材单价截断成 0，实际全部有价格; 欧诺 22 产品价格偏低可能是 USD 不是 RMB; 尼奥 7 条确认价格错(芯片型号/灯珠数当价格)，remark 中可见真实价格(如 ￥3.72)
- 多报价对比 + 推荐报价 (V4.5): `src/lib/offer-ranking.ts` 纯函数推荐排序（完整度 0-40 + 价格排名 0-30 + 时效 0-20）; 产品库 offer 表格增加推荐列 + badge（最低价/资料全/最新/推荐）+ 按推荐分排序; 报价中心搜索结果显示前 3 个推荐报价; 已选产品 offer 选择器从 `<select>` 改为可展开对比卡片; 新产品默认选推荐 offer; 单 offer 产品不显示 badge; `priceUpdatedAt` 脏数据容错; `OFFER_BADGE_META` 在产品库 Server Component 和报价中心 Client Component 间共享
- PDF 文件盘点 + 入库索引 (V2.20): `scripts/pdf-inventory-v2.20.ts` 扫描 617 份 PDF，新增 584 条 + 更新 33 条 files 记录; 基于文件名/路径关键词分类为 7 类（quotation/catalog/spec/certificate-report/packaging-image/manual/other）; 73 份疑似报价 PDF 作为 V2.21 spike 候选; 分布：室内 279 / 户外 266 / 光源 39 / 灯带 33; 注意：73 候选有噪声（父目录含"价格"导致子文件误判），实际真正报价可能 30-40 份
- PDF 可解析性 Spike (V2.21): `scripts/pdf-spike-v2.21.ts` 用 `pdfjs-dist@6.0.227` 对 16 份精选 PDF 做只读解析; 4 importable（普雅G4G9/普照防潮灯/普照三防灯A/杰莱特风扇灯，全部 RMB 工厂报价）、10 manual-review（3 份接近 importable 但 table 检测阈值太严、5 份 USD 客户报价、2 份有价格但结构模糊）、2 skip（扫描件零文字）; 关键结论：pdfjs-dist 文本+坐标提取可用，RMB 工厂报价 PDF 有清晰表格结构，USD PDF 全是 Welfull 发客户报价不应导入为采购价
- PDF 报价导入 (V2.22): `scripts/pdf-import-v2.22.ts` + `scripts/pdf-import-profiles.ts` 采用 profile-based parser，导入 4 份 V2.21 确认的 RMB 工厂报价 PDF；+150 products +150 supplier_offers；保留 dry-run/apply 报告；源 PDF 只读
- PDF 导入产品参数提取 (V3.0H): `scripts/extract-params.ts --target=v3h` 对 G4G9/防潮灯/三防灯/风扇灯重跑参数提取；1,036 target products → 951 products with params；product_params 37,045→37,432
- PDF manual-review 再评估 (V2.23): `scripts/pdf-review-v2.23.ts` 对 V2.21 的 10 份 manual-review PDF 重新按多档 y-tolerance 聚类、价格/型号信号和 longest-run 评分；结果：1 份 profile-ready（普照三防灯双色管B）、5 份 custom-parser-review、4 份 USD/FOB 客户价明确排除；不写 DB、不导入、不做 OCR
- PDF 小批量补导 (V2.24): `S06-puzhao-sanfang-b` profile 导入普照三防灯双色管B PDF；+6 products +6 supplier_offers；解析成品尺寸、CTN Qty、CTN L/W/H；源 PDF 只读；V2.22 导入器支持 `PDF_IMPORT_VERSION/PDF_IMPORT_SLUG`，避免覆盖历史报告
- 普照三防灯旧价格异常修正 (V2.25): `scripts/puzhao-price-audit-v2.25.ts` 审计确认 `PZ-HP-B1/B2` 6 条 offer（price=1/2 RMB）是 V2.24 PDF 产品的重复品（来自 2025-10 Excel 导入列错位）；删除 6 产品 + 6 offers + 36 params；V2.24 正确价格（13.38–36.36）保留
- V2.24 PDF 产品参数提取 (V3.0I): `extract-params.ts --target=v3h` 对 6 个新三防灯产品补提参数；+42 params（9/6/6/9/6/6 per product）；watts/size_display/length_mm/width_mm/height_mm/series + 部分 voltage/cri/cct/material
- 尼奥/瑞鑫/欧诺数据修补 (V2.19F): `scripts/data-fix-v2.19f.ts` 三 Part 修补：Part A 尼奥灯带 4/7 条价格修正（从源 Excel 含税价列提取，3 条源行无独立价格跳过）+ 4 条 price_history；Part B 瑞鑫面板灯 5 条规格行删除（0.7PS/0.8PS/295*1195/595*1195/595*595）；Part C 欧诺面板灯 20 条 currency RMB→USD（源表头明确 FOB PRICE USD）+ 2 条 3W/5W 欧诺错误 offer 删除（共享产品保留）
- 数据质量遗留收口审计 (V2.19G): `scripts/data-quality-audit-v2.19g.ts` 只读审计 V2.19F 全部遗留异常；Part A 尼奥 3 条无源价格→待人工补价（LST-2835-180 有其他工厂参考价 14 RMB）；Part B 瑞鑫 4 条→保留（PP0.7/0.8/1.0 有 params，36/40W 有图）；Part C 欧诺 2 条→保留（圆形/方形有合理 RMB 价格）；Part D 48W 碰撞→4 keep on panel, 7 move to other categories；另发现 47 组通用 model_no 碰撞（24W灯管=26 factories, 18W灯管=24 等）
- 历史客户报价 Spike (V5.0A): `scripts/customer-quote-spike-v5.0a.ts` 只读分析 `发客户报价单汇总/` 176 个 Excel；抽样 20 文件 14 品类；FOB USD 可识别 90%、款号 80%、日期 95%、客户名 30%（仅 To XXX 文件）；0 unknown-format；结论值得建独立表导入
- 历史客户报价建表+导入 (V5.0B): `customer_quote_files` + `customer_quote_rows` 独立表（raw SQL migration）；导入 161 个文件 398 个 sheet 6,139 行；FOB USD 97%（5,959 行）；不写 supplier_offers/products
- 历史客户报价产品匹配 (V5.0C): `scripts/customer-quote-match-v5.0c.ts` 填充 `matched_product_id`；精确匹配 2,837 + 归一化匹配 10 = 2,847 行（46%）；未匹配原因：2,050 行无 raw_model + 1,242 行 model_no 不在产品库
- 报价中心历史售价参考 UI (V5.0D): 已选产品 offer 选择器下方新增折叠式"历史售价参考"区域；有记录才显示；最多 10 条，按日期降序；客户名为 NULL 显示"内部核价"；batch 查询所有已选产品
- 历史报价补匹配 (V5.0E): `scripts/customer-quote-rematch-v5.0e.ts` 激进归一化+品类交叉补匹配 55 行；匹配率 46%→47%（2,847→2,902）；剩余 3,237 行为空款号/序号型/产品库无候选，不再强匹配
- 历史客户报价搜索页 (V5.1): `/customer-quotes` 独立搜索页；搜 raw_model/描述/价格/文件名；客户名/日期范围/匹配状态/品类筛选；排序+分页（50行/页）；行展开显示原始 JSON/来源/表头；已匹配产品可跳转；侧边栏新增"历史报价"入口
- 源文件本地归档迁移 (V7.0A-B): 审计确认 682 个 My Passport 文件被 supplier_offers/price_history 引用；迁移 681 个到 `data/source-archive/` 并将 files.volume_name 切到 `local`；1 个同名 local relative_path 冲突文件保留在 My Passport 并记录在 `docs/v7.0b-migration-report.md`
- 彻底清除移动硬盘依赖 (V7.1): 碰撞文件 15 条 offer 迁移到本地副本 + 删除 1,044 条 My Passport 文件记录；files 表 1,737→693 全 local
- 空壳产品清理 (V6.3): 删除 4 个 0-offer 空壳产品（16W/32W/70W 面板灯 + 2835 路灯）+ 17 条 product_params
- 超长 model_no 清理 (V2.26): 15 个 model_no > 200 chars 的产品缩短为 `{工厂}-{品类码}-{瓦数}W-{序号}` 格式，原始规格文本移入 remark
- 文件路径可移植性 (V7.2): `file-paths.ts` 新增 3 级候选路径解析链（cwd+relative_path → marker-based snapshot extraction → absolute_path_snapshot fallback）；693/693 文件和 7,449/7,449 产品图片均可访问
- 客户名大小写修正 (V5.4-fix): 40 行 customer_quote_files 客户编码大小写修正（Htf→HTF 等）+ 1 行误导入记录删除

### Data (after V10.3)
- Products: 10,522 across 31 categories (V10.3: +300 from unlinked file import)
- Supplier offers: 12,379 (V10.3: +1,295 new offers from 99 unlinked files)
- Files in DB: 688 Excel files, 1 still unlinked (汇盈报价单（20系列灯具）)
- Source archive: 681+ referenced files in `data/source-archive/` + `sample data/`
- Price history: 9,857 records
- Product images: 7,449 products have images
- Product params: 47,156 (V10.0→V10.3: +9,740 from backfill+derive pipeline)
- Param coverage: watts 56.8% (5,976) | lumens 14.4% (1,516) | efficacy 17.2% (1,813) | cri 12.2% (1,282) | cct 14.6% (1,540 unique) | pf 11.7% (1,231)
- **Drive elimination: COMPLETE** — DB has 0 My Passport references, all source files local
- **V10.3 known issue**: ~79 supplier_offers have incorrect prices (LiFePO4 battery voltages or serial numbers stored as purchase_price); file→product links are correct, only price field is wrong
- Batch 1 categories growth: 投光灯 16→492, 面板灯 69→902, 线条灯 38→1,123, 路灯 15→213, 灯带 21→383
- Batch 2 categories growth: 吸顶灯 49→597, 筒灯 110→1,111, 三防灯 79→445, 磁吸灯 148→786, 净化灯 80→1,559, 镜前灯 63→185, 防潮灯 11→126
- Batch 3 categories growth: 风扇灯 0→264, 工作灯 0→97, G4G9 0→51, 太阳能壁灯 87→561, 壁灯 27→290, 橱柜灯 134→204
- Tube/bulb split growth: 球泡 151→341 (+190), 灯管 8→84 (+76)
- Outdoor factory import (V2.18/B): 充电灯 0→7, 投光灯 +48, 面板灯 +16, 路灯 +16, 工作灯 +12, 太阳能壁灯 +6, Highbay +3
- **Historical customer quotes (V5.0B-E + V5.4)**: customer_quote_files 398 records, customer_quote_rows 6,139 rows (5,959 with FOB USD), 2,902 matched to products (47%); customer_name coverage 116/398 (29.1%) after V5.4; V5.2 adds manual product binding UI on /customer-quotes; V5.4 expanded detail shows same-product quote history

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
| V2.19B | 全品类污染扫描 | `scripts/pollution-scan.ts` 扫描 198 组 category×factory；3🔴+11🟡；审阅后分流：5 组明确垃圾→V2.19C、3 组部分垃圾→V2.19D、伟润 price=0→V2.19E、4 组误报不动 |
| V2.19C | 明确垃圾删除 | `scripts/junk-cleanup-v2.19c.ts` 删除 5 组 54 产品 + 81 offers（含 27 条组外 offer）+ 89 params；全局 9,982→9,928 产品 |
| V2.19D | 部分垃圾逐条审计 | `scripts/partial-junk-audit.ts` 3 组 98 产品逐条标记；40 junk + 1 suspect(COB) = 41 确认删除；2 LST suspect 保留→V2.19E |
| V2.19D-apply | 部分垃圾删除 | `scripts/junk-cleanup-v2.19d.ts` 删除 41 产品 + 44 offers + 63 params + 44 price_history；全局 9,928→9,887 |
| V2.19E | 价格异常调查 | 伟润假警报（INT 截断）/欧诺疑似 USD/尼奥 7 条芯片型号价格；源文件全部存在 |
| V4.5 | 多报价对比 + 推荐报价 | `offer-ranking.ts` 纯函数评分(完整度+价格+时效)；产品库 badge 列+推荐排序；报价中心搜索前3推荐+可展开对比卡片；默认选推荐 offer |
| V2.20 | PDF 文件盘点 + 入库索引 | 617 份 PDF 扫描，584 新建+33 更新 files 记录；7 类分类（quotation 73/catalog 109/spec 105/certificate 130/packaging 44/manual 9/other 147）；73 候选有噪声，真正报价约 30-40 份 |
| V2.21 | PDF 可解析性 Spike | pdfjs-dist 6.0.227 解析 16 份精选 PDF；4 importable（RMB 工厂报价）/ 10 manual-review / 2 skip（扫描件）；table 检测 y-coordinate 聚类有效但阈值偏严（3 份有价格但 table 未检出） |
| V2.22 | PDF 报价导入 | profile-based parser 导入 4 份 V2.21 确认的 RMB 工厂报价 PDF；+150 products +150 supplier_offers；dry-run/apply 报告保留 |
| V3.0H | PDF 导入产品参数提取 | G4G9/防潮灯/三防灯/风扇灯 1,036 产品重跑参数提取；951 产品有参数；product_params 37,045→37,432 |
| V2.23 | PDF manual-review 再评估 | 10 份 V2.21 manual-review PDF 只读复审；1 profile-ready（普照三防灯双色管B）/ 5 custom-parser-review / 4 USD 客户价排除 |
| V2.24 | PDF 小批量补导 | 只导入 V2.23 确认的 S06 普照三防灯双色管B；+6 products +6 offers；CTN Qty/L/W/H 同步写入 |
| V2.25 | 普照三防灯旧价格异常修正 | `PZ-HP-B1/B2` 6 条 price=1/2 确认为 V2.24 重复品（Excel 列错位）；删除 6 产品+6 offers+36 params |
| V3.0I | V2.24 PDF 产品参数提取 | 6 个三防灯产品补提参数；+42 params；watts/size_display/dimensions/series/voltage/cri/cct/material |
| V2.19F | 尼奥/瑞鑫/欧诺数据修补 | Part A: 尼奥 4/7 价格修正（源 Excel 含税价）；Part B: 瑞鑫 5 规格行删除；Part C: 欧诺 20 条 RMB→USD + 2 条错误 offer 删除 |
| V2.19G | 数据质量遗留收口审计 | 只读审计；尼奥 3 待人工补价 / 瑞鑫 4 保留 / 欧诺 2 保留 / 48W 碰撞拆分方案 + 47 组通用 model_no 碰撞发现 |
| V5.0A | 历史客户报价 Spike | 20 文件 14 品类抽样；FOB USD 90% / 款号 80% / 日期 95%；值得建独立表 |
| V5.0B | 历史客户报价建表+导入 | customer_quote_files + customer_quote_rows；161 文件 6,139 行；FOB USD 97% |
| V5.0C | 历史客户报价产品匹配 | 精确+归一化匹配 2,847 行（46%）；未匹配主因：无 raw_model 或 model_no 不在库 |
| V5.0D | 报价中心历史售价参考 UI | 已选产品折叠式历史 FOB USD 参考；有记录才显示；batch 查询 |
| V5.0E | 历史报价补匹配 | 激进归一化+品类交叉 +55 行；46%→47%；剩余不可安全自动匹配 |
| V5.1 | 历史客户报价搜索页 | /customer-quotes；搜索+筛选+排序+分页+行展开；侧边栏入口 |
| V5.2 | 历史报价人工绑定产品 | /customer-quotes 未匹配行可搜索产品库并绑定/解绑；Server Action + Client Component 分离 |
| V5.2A | 去掉页面硬编码版本标签 | header "V5.2" → "历史报价"，与 sidebar 一致 |
| V5.2B | 修复绑定按钮交互 | ProductBindingCell 从 summary 行移到展开区域；新增 MatchSummaryCell 行内显示匹配状态；列顺序调整（匹配列移至型号后） |
| V6.0 | 48W 跨品类碰撞拆分 | 11 offer 挂同一面板灯产品 → 4 keep + 7 move；新建 7 个 48W 产品（吸顶灯/球泡/灯管/净化灯/三防灯/线条灯/磁吸灯）；鑫盟泰按文件名归灯管不归球泡 |
| V6.1 | 跨品类碰撞只读审计 | 155 碰撞组（≥3 offers/product）：97 正常 + 54 疑似跨品类 + 4 无法判断；品类推断用 source path 关键词匹配（26 规则 + 球泡灯管合并目录特殊处理）；201 个 NULL source offer 不在碰撞组内 |
| V6.2A | 跨品类碰撞拆分计划（只读） | 54 组 470 offer → 311 auto-safe / 92 review-needed / 67 skip；190 个 target buckets；4 个 FK 引用产品标记风险；发现 SL-* 太阳能产品假阳性（太阳能 vs 太阳能壁灯命名差异） |
| V6.2B | 执行 auto-safe 碰撞拆分 | 排除 3 个 SL-* 假阳性后，新建 187 产品，迁移 302 offers；products 10039→10226；4 个空壳原产品保留未删；product_params/price_history 不动（schema 无 offer 级 FK）；9 项后验证全 PASS |
| V7.0A | 硬盘依赖审计 | 只读审计 files/FK/运行时依赖；682 个 My Passport 文件被 supplier_offers/price_history 引用，约 4.42GB；产品图片 0 条外置硬盘路径 |
| V7.0B | 源文件本地归档迁移 | 备份 DB 后复制 681 个引用源文件到 `data/source-archive/`，files local 12→693；1 个 relative_path 冲突文件保留 My Passport；FK 完整性验证 PASS |
| V5.4 | 客户名规范化 + 同产品历史售价 | customer_quote_files 有客户名记录 79→116；/customer-quotes 展开已绑定行时显示同产品历史 FOB USD 记录（最多 10 条） |
| V5.3 Spike | 历史报价匹配策略调研 | V6.2B 后再匹配 0 新增；50 条抽样：24 match-possible / 5 weak / 21 no-candidates；纯数字 raw_model 无候选；~795 行适合半自动候选建议；结论：不做全量模糊匹配，设计候选建议 + 人工确认 UI |
| V5.4-fix | 客户名大小写修正 | FIXES 数组驱动：Htf→HTF 等 + 删除误导入记录；40 行 affected；事务包裹 |
| V7.1 | 彻底清除移动硬盘依赖 | 碰撞文件（27MB size match 验证）15 条 offer 迁移到本地副本；1,044 条 My Passport file 记录删除；files 1,737→693 全 local；10 项验证全 PASS |
| V6.3 | 空壳产品清理 | V6.2B 拆分后 4 个 0-offer 空壳产品 + 17 params 删除；products 10,226→10,222 |
| V2.26 | 超长 model_no 清理 | 15 产品 model_no 缩短为 `{工厂短名}-{品类码}-{瓦数}W-{序号}` 格式（博登 12 + 欣益 2 + 汇孚 1）；原规格文本移入 remark（已有 remark 的保留不覆盖） |
| V7.2 | 文件路径可移植性 | `file-paths.ts` 新增 candidateFromLocalSnapshot 函数，用 marker 从 absolute_path_snapshot 提取项目相对路径；693/693 文件 + 7,449 图片均可访问；发现 relative_path 裸文件名隐患 |
| V7.3 | relative_path 修正 | 693 条 files 的 relative_path 从裸文件名改为项目相对路径 |
| V9.0 | 对话式报价界面 | DeepSeek V4 Flash 集成 + 聊天式界面，替代 table/filter UI |
| V9.0A | 聊天布局 + markdown 渲染 | 独立聊天布局 + 空结果澄清 |
| V10.0 | 源文件参数审计 | `v10.0-source-audit.ts` 扫描 688 文件提取列名→param_key 映射；发现覆盖率严重不足 |
| V10.1 | 参数回填管线 | `v10.1-param-backfill.ts` 从源 Excel 列值回填 product_params；product_params 37,416→45,513 |
| V10.2 | 回填管线修复 + 派生参数 | 扩展 MODEL_HEADER_PATTERNS + sheet-name fallback；V10.4 derive watts/efficacy (+1,646)；product_params→46,613 |
| V10.3 | 导入 100 个未链接文件 | `v10.3-import-unlinked.ts` 99/100 文件成功；+300 产品 +1,295 offers；重跑 backfill/derive/audit；products 10,222→10,522；product_params→47,156 |

---

## What's Next

### 已定路线（按优先级）

**阶段一：参数覆盖率提升（当前最高优先级）**

用户明确要求："这一关不能跳也不能绕"。每个参数对终端用户都重要，缺参数的产品不可交付。

1. **V10.6：扩展列名映射 + 第二轮回填** — 审计 Section I 显示大量未映射列：`实际功率`→watts (13 files)、`额定功率`→watts (10 files)、`整灯光效`→efficacy (11 files)、`显色指数`→cri (9 files)、`功率因数`→pf (12 files)、`灯具尺寸`→size_display (12 files) 等。扩展 HEADER_TO_PARAM 后重跑 backfill。
2. **V10.7：列头即数值模式** — 面板灯/三防灯 Excel 用 "3W"/"5W"/"9W" 做列头，每个 (size行 × W列) 组合需写入 watts 参数。同理 "100lm/w"/"110lm/w" 列头代表光效等级。
3. **V10.8：品类深挖** — 覆盖率最差品类需品类专用解析器或确认数据天花板：线条灯 watts 18.6%、磁吸灯 lumens 0%、皮线灯 watts 4.1%、灯带 watts 27.9%、镜前灯 watts 17.5%。

**阶段二：数据天花板策略**

对源文件确实没有的参数，三个选项需用户决策：
- 找补充数据源（规格书、网站数据）
- AI 辅助推断（DeepSeek 根据同品类已知参数推断缺失值，标注 confidence=low）
- 接受天花板，UI 上做 graceful degradation

**阶段三：对话式界面 + 打包**

数据质量达标后回到产品形态：
4. **V9.x → 对话式界面迭代** — 已有 V9.0/V9.0A 的 DeepSeek 集成 + 聊天布局基础
5. **V8.0：Tauri MVP** — Next.js + Tauri 单文件安装包
6. **V5.5：半自动匹配候选 UI**

**按需 / 低优先级**
- V10.3 价格列误检清洗（~79 条 offer price 不正确）
- PDF custom-parser（5 份候选，边际收益低）
- 客户实体管理（V3.1，当前 free-text 够用）

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
- ~~V2.19B — 全品类污染扫描~~ ✅ commit de1d24f — 198 组扫描，3🔴+11🟡，审阅分流到 V2.19C/D/E
- ~~V2.19C — 明确垃圾删除~~ ✅ commit 5f9d9f7 — 5 组 54 产品 + 81 offers 删除，全局 9,982→9,928
- ~~V2.19D — 部分垃圾逐条审计~~ ✅ commit b9bf2e9 — 3 组 98 产品标记：40 junk + 3 suspect + 55 keep
- ~~V2.19D apply — 部分垃圾删除~~ ✅ commit d25fd2e — 41 产品 + 44 offers 删除，全局 9,928→9,887
- ~~V2.19E — 价格异常调查~~ ✅ commit fcdddbe — 伟润假警报(INT截断)、欧诺疑似USD、尼奥7条芯片价
- ~~V4.5 — 多报价对比 + 推荐报价~~ ✅ commit 3ccead1 — offer-ranking 纯函数评分；产品库 badge 列+推荐排序；报价中心搜索前3+对比卡片；默认选推荐 offer
- ~~V2.20 — PDF 文件盘点 + 入库索引~~ ✅ commit ed22666 — 617 PDF 扫描，584 新建+33 更新；73 候选报价 PDF 识别；files 表 1,141→1,725
- ~~V2.21 — PDF 可解析性 Spike~~ ✅ commit d47f902 — pdfjs-dist 解析 16 PDF；4 importable / 10 manual-review / 2 skip
- ~~V2.22 — PDF 报价导入~~ ✅ commit 8ee56d1 — 4 份 RMB 工厂报价 PDF 导入；+150 products +150 offers
- ~~V3.0H — PDF 导入产品参数提取~~ ✅ G4G9/防潮灯/三防灯/风扇灯 重跑参数；product_params 37,045→37,432
- ~~V2.23 — PDF manual-review 再评估~~ ✅ 10 份 manual-review PDF 只读复审；1 profile-ready / 5 custom-parser-review / 4 USD 客户价排除
- ~~V2.24 — PDF 小批量补导~~ ✅ S06 普照三防灯双色管B PDF 导入；+6 products +6 offers；CTN Qty/L/W/H 写入
- ~~V2.25 — 普照三防灯旧价格异常修正~~ ✅ commit 1132dcb — 6 条 price=1/2 重复品删除；V2.24 正确价格 13.38–36.36 保留
- ~~V3.0I — V2.24 PDF 产品参数提取~~ ✅ commit 1ccb735 — 6 产品 +42 params；watts/size/dimensions/series
- ~~V2.19F — 尼奥/瑞鑫/欧诺数据修补~~ ✅ commit c28513b — 尼奥 4 价格修正；瑞鑫 5 规格行删除；欧诺 20 条 RMB→USD + 2 错误 offer 删除
- ~~V2.19G — 数据质量遗留收口审计~~ ✅ commit 476e1d6 — 只读审计全部 V2.19F 遗留：尼奥 3 待人工补价 / 瑞鑫 4 保留 / 欧诺 2 保留 / 48W 拆分方案 / 47 组通用 model_no 碰撞
- ~~V5.0A — 历史客户报价 Spike~~ ✅ commit c6aafa6 — 20 文件 14 品类抽样；FOB USD 90%/款号 80%/日期 95%；格式稳定，值得建表
- ~~V5.0B — 历史客户报价建表+导入~~ ✅ commit cff8ba4 — customer_quote_files 398 + customer_quote_rows 6,139；FOB USD 5,959 行 97%
- ~~V5.0C — 历史客户报价产品匹配~~ ✅ commit b8bf804 — 2,847 行 matched_product_id（46%）；精确 2,837 + 归一化 10
- ~~V5.0D — 报价中心历史售价参考 UI~~ ✅ commit 4e8d434 — 已选产品折叠式历史 FOB USD 参考区域
- ~~V5.0E — 历史报价补匹配~~ ✅ commit c25b382 — +55 行补匹配（46%→47%），剩余不可安全匹配
- ~~V5.1 — 历史客户报价搜索页~~ ✅ commit 9a1cfa8 — /customer-quotes 搜索+筛选+分页+行展开
- ~~V5.2 — 历史报价人工绑定产品~~ ✅ commit f9e3e52 — 未匹配行搜索+绑定/解绑；Server Action + ProductBindingCell Client Component
- ~~V5.2A — 去掉页面硬编码版本标签~~ ✅ commit 9be2c16 — header "V5.2"→"历史报价"
- ~~V5.2B — 修复绑定按钮交互~~ ✅ commit 785c61b — ProductBindingCell 移至展开区域，解决 details/summary 点击冲突；真实验收确认 SL-W-B-1→SL-W-B 绑定后报价页显示 $5.81 历史售价参考
- ~~V6.0 — 48W 跨品类碰撞拆分~~ ✅ commit c5d63c2 — 7 offer 迁移到 7 个新品类产品，原面板灯保留 4 offer；products 10032→10039
- ~~V6.1 — 跨品类碰撞只读审计~~ ✅ commit d03e4c4 — 155 碰撞组：97 正常 + 54 疑似跨品类 + 4 无法判断；品类推断 26 规则 + 球泡灯管特殊处理
- ~~V6.2A — 跨品类碰撞拆分计划~~ ✅ commit 69b4116 — 54 组 470 offer 分层：311 auto-safe / 92 review-needed / 67 skip；190 target buckets
- ~~V6.2B — 执行 auto-safe 碰撞拆分~~ ✅ commit c51766e — 排除 3 SL-* 假阳性后新建 187 产品，迁移 302 offers；products 10039→10226；9 项后验证全 PASS
- ~~V5.3 Spike — 历史报价匹配策略调研~~ ✅ commit 8a7d902 — 0 新增安全匹配；50 抽样 24/5/21 split；~795 行适合半自动候选建议；结论：候选建议 UI，不做全量模糊匹配
- ~~V5.4-fix — 客户名大小写修正~~ ✅ commit 0331d17 — 40 行 customer_quote_files 客户编码修正 + 1 行误导入删除
- ~~V7.0A — 硬盘依赖审计~~ ✅ 682 个 My Passport 文件被 FK 引用；产品图片 0 条外置路径
- ~~V7.0B — 源文件本地归档迁移~~ ✅ commit 9d4453b — 681 个引用源文件→data/source-archive/；1 个冲突文件保留
- ~~V7.1 — 彻底清除移动硬盘依赖~~ ✅ commit d48f6c3 — 碰撞文件 15 offer 迁移 + 1,044 My Passport 记录删除；files 1,737→693
- ~~V6.3 — 空壳产品清理~~ ✅ commit fd7a578 — 4 产品 + 17 params 删除；products 10,226→10,222
- ~~V2.26 — 超长 model_no 清理~~ ✅ commit fd7a578 — 15 产品 model_no 缩短，原规格移入 remark；0 重复
- ~~V7.2 — 文件路径可移植性~~ ✅ commit fd7a578 — file-paths.ts 3 级候选链；693/693 文件 + 7,449/7,449 图片全部可访问

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
- V2.19C 发现垃圾产品可能挂有组外 offer：54 个垃圾产品除了 5 组匹配的 54 条 offer，还有 27 条其他工厂/文件的 offer。删产品必须连同所有 offer 一起删。未来清理脚本都应检查目标产品的全部 offer，不仅是匹配组的 offer
- V2.19E 伟润假警报教训：`CAST(purchase_price AS INTEGER)` 把 <1 元价格截断成 0，导致 V2.19B 报告"534 price=0"。实际上伟润是铝型材套件，单价 0.048-3.8 元/米完全正常。未来扫描脚本的价格统计不应用 INT 截断，改用 REAL 或保留原始精度
- V2.23 复审结果说明：S06 普照三防灯双色管B是唯一可直接进入 V2.24 profile 导入的 manual-review PDF；S09/S13/S15/S16 都是 USD/FOB 客户价，继续严格排除，不得写入 `supplier_offers.purchase_price`；S14 同时含 RMB 与 USD，必须人工确认列语义后再写 parser
- V2.24 导入器补强：普照三防灯 PDF parser 不再假设型号在第 1 列，改为行内查找 `PZ-`；型号清洗保留 `*`/`×`，避免 `PZ-HP-B-1*600` 被截断；remark 过滤 RMB 价格、尺寸和 CTN，避免 fallback 报价泄露采购价
- V2.24 发现但未处理：DB 中已有 6 条 `PZ-HP-B1/B2` 普照三防灯旧 offer，价格为 `1/2 RMB`，source 指向 2025-10 Excel 文件；它们不是本次 S06 PDF 导入产生，需后续 V2.25 审计，不应在 V2.24 里盲删
- V2.25 确认 `PZ-HP-B1/B2` 全部是 V2.24 PDF 产品的重复品（model_no 格式略不同：`B1-1*600` vs `B-1*600 18W`），旧价格 1/2 RMB 来自 Excel 导入列错位
- V2.19F Part A 尼奥灯带源 Excel 表头快照：价格在 col T（含税价格），col G（LED Chip/m）才是被错导入的列（2835/5050 是芯片型号不是价格）。3 条 COB 行（rows 9/19/20）在源 Excel 中确实没有价格列，跳过是正确的
- V2.19F Part C 欧诺源文件确认：`核价Wellux Quotation` 表头 row 5 col P 明确标注 `FOB PRICE (USD)`，20 条 offer 标记 RMB 是导入时的默认值错误。`3W`/`5W` 是来自地插灯文件的功率列被当价格+model_no
- V2.19G 确认 V2.19F 遗留全部收口：尼奥 3 条 COB 行源 Excel 确实没有独立价格列（rows 9/19/20 无价格单元格），标记待人工补价而非代码修复是正确处置；瑞鑫 PP 和 36/40W 有 params/图片不该删；欧诺圆形/方形有合理 RMB 价格保留
- V5.0 方向确立：`supplier_offers.purchase_price` 只放采购价（工厂 RMB），历史客户 FOB USD 售价需要独立数据层。`发客户报价单汇总/` 约 176 个 Excel（151 核价 + 25 To客户），24 品类子目录。V5.0A spike 先验证格式稳定性和字段可提取性
- V2.19F 发现 48W model_no 碰撞：面板灯品类中 model_no="48W" 的产品挂了 11 个不同工厂的 offer（一群狼/中山呈明/凯益德/合力/宏硕/普照/景上/瑞鑫/鑫盟泰/锐晶/鹏荣），价格 0.3–48，来源文件跨品类（球泡/净化灯/三防灯/磁吸灯/灯管）。这是系统性的 model_no 碰撞问题，不是单个工厂的数据错误，需要单独解决
- V6.1 审计规模超预期：原估计"真碰撞个位数"，实际 54 组疑似跨品类碰撞。几乎全是纯瓦数 model_no（24W/18W/30W...），说明 batch import 时不同品类文件里的同瓦数行被合并到一个产品上了
- V6.2A 发现品类命名假阳性：SL-FA-60W/SL-FD-100W/SL-FD-200W 三个产品 product.category="太阳能" 但推断品类="太阳能壁灯"，是命名差异不是真碰撞。且这三个产品持有 52 条 customer_quote_rows + 6 条 quote_items FK 引用，迁移后会变成 0-offer 产品。V6.2B 正确排除
- V6.2B 发现 products 表实际 schema 与任务文件假设不符：无 min_price/max_price/avg_price/unit 字段；product_params 无 supplier_offer_id；price_history 无 product_id。Codex 正确适配，params 保持不动（无法精准按 offer 拆分），price_history 通过 supplier_offer_id 间接关联不需更新
- V5.3 Spike 匹配天花板确认：V6.2B 新建 187 产品后 exact/normalized 再匹配仍为 0，原因是新旧产品共享 model_no 导致歧义增加而非减少。剩余 1,657 行有 raw_model 但产品库无唯一匹配：48% 可通过前缀/品类+瓦数找到候选（但需人工确认），42% 是纯数字行号无法匹配
- V5.3 Spike 硬盘依赖初探：files 表 1,725 条 volume_name="My Passport" / 12 条 "local"；10,837 条 supplier_offers 引用外置硬盘文件；产品图片已在本地 data/images/；DB 数据独立于硬盘但源文件溯源依赖硬盘
- V7.1 碰撞文件迁移：V7.0B 跳过的 1 个冲突文件（`(刘林姐发 汇总版本 已瘦身)核价线条灯...xlsx`，27.4MB），经 size match 验证后 15 条 offer 迁移到本地副本；冲突原因是 My Passport 版本和 local 版本同名不同 ID
- V7.2 relative_path 裸文件名发现：693 条 files 的 relative_path 全部是裸文件名（如 `核价...xlsx`），不含 `data/source-archive/` 前缀。cwd+relative_path 解析路径不存在，全靠 candidateFromLocalSnapshot 的 marker 解析兜底。当前可用，但 Tauri 打包后 absolute_path_snapshot 失效，只有 relative_path 可靠，必须在打包前修正

- V10.0 参数覆盖率审计揭示核心问题：导入管线只读几个固定列，光效/流明/CRI 等关键参数缺失 >85%。用户判断：缺参数的产品不可交付，AI 不能替代数据对齐
- V10.1 backfill 从源 Excel 列值回填参数，首次实现 Excel 列→product_params 管道。HEADER_TO_PARAM 映射是可扩展的
- V10.2 扩展回填修复：skipped sheets 从 1,203 降到 1,104；sheet-name-as-model fallback 救回部分无型号列的 sheet；luminous flux→lumens 修正（之前误映射到 luminous_efficacy）
- V10.4 派生参数：从 product_name/model_no 提取 watts (+498)，从 watts+lumens 计算 luminous_efficacy (+1,148)；5 条太阳能壁灯 efficacy >250 lm/W 是假值（3W 太阳能板瓦数≠LED 瓦数）
- V10.3 导入未链接文件：92% 产品复用率说明匹配逻辑质量高；面板灯 26 文件 2,465 行全部复用已有产品；价格列误检影响 ~79 条 offer（LiFePO4 Battery 和 序列 列被当做价格），但不影响参数覆盖率
- V10.3 覆盖率反降（watts 57.7%→56.8%）：因为新增 300 产品但参数增量不足。V10.3 的价值是管道铺设（文件→产品链路），参数增长的瓶颈在列名映射和 Excel 结构解析
- V10.0 审计发现列头即数值模式：面板灯/三防灯 Excel 用 "3W"/"5W"/"9W" 做列头，下面放价格。这种结构意味着参数编码在列头而非数据单元格中，需要专门处理逻辑
- `extract-params.ts` 第 1902 行有 `deleteMany` 操作，会清除所有现有参数后重建。V10.x 管线的 backfill/derive 脚本都是只 INSERT 不 DELETE，避免破坏 excel_column 来源的参数。两条路径不能混用

### Not Now
- 通用 PDF 导入 UI（当前只有少量 PDF 适合导入，先用 profile-based 脚本）
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
