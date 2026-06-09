# TASKS.md — Task Queue

Last updated: 2026-06-09

Status labels: Draft → Ready → In Progress → Done → Deferred

---

## Done (recent)

| Version | Task | Completed |
|---|---|---|
| V2.6 | Product image extraction (.xlsx zip + .xls LibreOffice) | 2026-06-08 |
| V2.5 | Quote history search / detail / reuse | 2026-06-08 |
| V2.4 | Duplicate product audit + Type A/B split | 2026-06-08 |
| V2.3 | Product identifier cleanup | 2026-06-08 |
| V2.2 | Quote session cleanup + data quality tools + PD cleanup | 2026-06-08 |
| V2.1 | Batch import 25 categories + price_updated_at | 2026-06-08 |
| V2.0 | MVP milestone | 2026-06-08 |

Full history in AGENTS.md Completed table.

---

## Ready / Draft

### V2.7 — Batch image backfill (Draft)

Scope: Re-scan source .xlsx files for existing 1,280 products, extract images for those that don't have one yet.

Why: V2.6 built the extraction pipeline but only tested on 1 file (14 products got images). The other 1,266 products have no image.

Approach: Script that iterates products → finds source file → extracts image → stores thumbnail.

Depends on: ability to trace product back to source file (may need supplier_offer → source file mapping).

### V2.8 — Batch import expansion (Draft)

Scope: Import additional factory files from `/Volumes/My Passport/AI 报价/各家工厂最新报价汇总/`.

Why: Only ~80/1,700 Excel files imported. Many categories have <10 products.

Approach: Same as V2.1 — scan report → user confirms → batch import script. Now with automatic image extraction.

Priority categories: 灯管(7), Highbay(7), 地插灯(5), 防潮灯(4), 大面板灯(2), 庭院灯(1).

### V2.9 — CTN / Size gap filling (Draft)

Scope: Fill missing CTN and Size data for 太阳能, 灯带, 面板灯.

Why: These categories can export but preview shows many warnings. 33% CTN coverage is low.

Approach: Find source files with CTN data that matches existing products. May require manual UI entry for products without any source CTN.

### V2.10 — Price update workflow (Draft)

Scope: When importing a newer factory file, detect existing products and show "price changed: 2.96 → 3.30, update?"

Why: Current import creates new records or skips. No way to UPDATE an existing supplier_offer's price.

Schema impact: May need `supplier_offers.source_file` or `supplier_offers.version` field.

### V3.0 — Desktop packaging / Tauri (Draft)

Scope: Package as .dmg (Mac) so end user can double-click to open.

Why: Current startup requires `npm run dev` in terminal. Non-technical user can't do this.

---

## Deferred (not planned)

| Task | Why deferred |
|---|---|
| PDF parsing | High effort, uncertain value. Most data is in Excel. |
| AI text extraction | Structured import (V1.9) covers most cases. |
| Multi-user auth | Single user tool. |
| Customer entity management | Free-text customer name works for now. |
| Cloud deployment | Local-only by design. |
