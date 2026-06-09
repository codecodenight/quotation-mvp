# Claude Sync — Project Status After V2.2

This document is for Claude Opus. Assume Claude already remembers the project through **V2.2**.

Current project: local supplier quotation management system.
Core loop: scan/import Excel -> product library -> quote preview -> export customer quotation Excel.

## Current Stage

The project is past V2.0 MVP readiness and is now in **post-V2.0 data quality optimization**.

Completed through:

| Version | Scope | Status |
|---|---|---|
| V2.0 | MVP daily internal use ready | Done |
| V2.1 | Batch import uncovered categories + price_updated_at | Done |
| V2.2 | Quote session cleanup + data quality tools + Product Details cleanup | Done |
| V2.3 | Product identifier cleanup | Done |
| V2.4 | Duplicate product audit + Wall Light Type A/B split | Done |

## Current Data Snapshot

- Products: **1,280** across 25 categories
- Supplier offers: **1,901**
- Imported from: **80+ quotation / 核价 files**
- CTN coverage: **33%** (`619 ctn_qty / 584 L/W/H out of 1,901 offers`)
- Price timestamp coverage: **43%** (`816 offers with price_updated_at`)

Quality audit after V2.4:

- Missing model_no: **0**
- Numeric-only model_no: **0**
- Wall light temporary model_no: **0**
- Duplicate model_no groups: **0**
- Products without supplier offers: **0**
- Duplicate supplier offer groups: **0**

## V2.3 — Product Identifier Cleanup

Problem found during real quoting:

Some products had poor customer-facing identifiers:

- `地插灯/太阳能壁灯` had products with `model_no = 1/2/3/4/5`
- `皮线灯` had products with missing `model_no`
- `壁灯` had temporary model numbers like `壁灯-10W SMD-ABS-135*90*105mm-11`

### V2.3 Actions Completed

1. Fixed 5 numeric-only 欣益进 solar wall light products.
   - Example: `1` -> `XYJ-SWL-500LM`
   - Product names changed to customer-readable English names like `Solar Wall Light 500LM`
   - Old `size` values like `14 / 23 / 18` were cleared because they were packaging L column values, not product size.
   - Also filled MOQ and CTN fields from the source sheet:
     - `moq = 3000`
     - `ctn_qty`
     - `ctn_length / ctn_width / ctn_height`

2. Fixed 2 皮线灯 products with real source model numbers.
   - `皮线灯-单色` -> `RD-F-05-AY`
   - `皮线灯-双彩` -> `RD-DF-05-AY`

3. Fixed one mislinked supplier offer.
   - A `7.9 RMB` offer was incorrectly attached to `皮线灯-单色`
   - Source file showed it was actually `皮线灯-幻彩 / RD-D-05-AY`
   - Created product `皮线灯-幻彩 / RD-D-05-AY`
   - Moved the `7.9 RMB` supplier offer to that new product

4. Replaced 27 稣赐 wall light temporary model numbers.
   - Changed from temporary Chinese composite names to customer-readable `Wall Light ...` names
   - Example:
     - Before: `壁灯-10W SMD-ABS-135*90*105mm-11`
     - After: `Wall Light 10W SMD ABS 135x90x105mm`
   - Filled `material`, `size`, and richer `remark` from the source Excel row.
   - Did **not** change prices.
   - Did **not** merge products, because source images may distinguish same-spec rows.

### Important User Feedback During V2.3

The user asked why batch wall-light renaming was done before confirming the naming rule.

Resolution:

- A before/after comparison report was generated.
- User reviewed/accepted the direction.
- The work proceeded.

Future instruction for Claude:

When doing data quality cleanup with naming rules, **show before/after examples before writing to DB unless the user explicitly approves direct execution**. This is especially important when user-facing product names are changed.

### V2.3 Reports

- `docs/v2.3-product-identifier-audit.md`
- `docs/v2.3-product-identifier-cleanup-plan.md`
- `docs/v2.3-wall-light-identifier-cleanup-report.md`
- `docs/v2.3-wall-light-before-after-comparison.md`

### V2.3 Backups

- `backups/dev-before-v2.3-product-identifier-cleanup-20260608-191507.sqlite`
- `backups/dev-before-v2.3-wall-light-identifier-cleanup-20260608-191941.sqlite`

## V2.4 — Duplicate Product Audit + Wall Light Type A/B

After V2.3, duplicate `model_no` appeared because some wall light source rows had the same spec but different source rows/photos/prices.

Audit found:

- Duplicate model_no groups: **6**
- Products involved: **12**
- Duplicate supplier offer groups: **0**
- Products without supplier offers: **0**

Decision:

- Do **not** merge these products.
- Reason: source rows may be distinguished by photos even when text specs match.
- Keep them separate and append `Type A / Type B`.

### V2.4 Actions Completed

12 wall light products were renamed with `Type A / Type B` suffixes.

Examples:

| Before | After |
|---|---|
| `Wall Light 10W SMD ABS 135x90x105mm` | `Wall Light 10W SMD ABS 135x90x105mm Type A` |
| `Wall Light 10W SMD ABS 135x90x105mm` | `Wall Light 10W SMD ABS 135x90x105mm Type B` |
| `Wall Light 10W SMD 铝 110x90x130mm` | `Wall Light 10W SMD 铝 110x90x130mm Type A/B` |

Only changed:

- `products.product_name`
- `products.model_no`

Did not change:

- supplier offers
- prices
- source files
- size
- material
- remark

### V2.4 Reports

- `docs/v2.4-duplicate-product-audit.md`
- `docs/v2.4-duplicate-product-type-suffix-report.md`

### V2.4 Backup

- `backups/dev-before-v2.4-duplicate-type-suffix-20260608-193933.sqlite`

## Validation Status

After V2.3 and V2.4:

- `npm test` passed
- `npm run lint` passed
- `npx tsc --noEmit` passed
- `npm run build` passed

No source Excel files were modified.

## Current Risk / Known Issues

1. Wall light `Type A / Type B` is a pragmatic label, not a true factory model.
   - This is acceptable for now because the source file did not provide real model numbers.
   - If images become important, the system needs image preview/product image support.

2. CTN coverage remains partial.
   - This is source-data limitation, not an export bug.

3. Customer names are still free text.
   - No customer entity management yet.

4. Price versioning is still missing.
   - Current supplier offer price edits overwrite old data.

5. Quote history is still simple.
   - No search/filter by customer/date/product yet.

6. Generated quote file paths are still filesystem paths.
   - Fragile if output files move.

## Recommended Next Steps

Suggested next direction: **V2.5 Quote History Search / Reuse**.

Why:

- Product identifier and duplicate cleanup are now in good shape.
- The next daily-use pain will likely be finding old quotes by customer/date/product.
- This is lower risk than schema-heavy price versioning and more immediately useful.

Possible V2.5 scope:

1. Add `/quotes` search/filter controls:
   - customer name
   - date range
   - product/model keyword
   - currency

2. Quote detail view:
   - show quote header
   - show line items
   - show purchase price snapshot and sale price
   - link to exported Excel file if it still exists

3. Optional “reuse quote” workflow:
   - load previous quote items into current quote page
   - user can adjust margin/exchange rate/remarks before export

Alternative next directions:

- V2.5 Price version tracking if supplier price updates become the immediate pain.
- Product image/source-row preview if wall light Type A/B needs visual confirmation.
- Customer entity management if customer repeat quotes become common.

## Important Working Rules For Future Claude Work

- This is a local-only tool. No cloud, no SaaS, no auth unless explicitly requested.
- Do not modify source Excel files.
- Always back up `prisma/dev.db` before data cleanup scripts.
- For data cleanup, prefer:
  1. read-only audit report
  2. user confirmation
  3. backup
  4. apply script
  5. post-apply audit
  6. tests/build
- Use SheetJS for reading Excel.
- Use exceljs for writing quotation exports.
- Keep database changes conservative; avoid new schema unless the user explicitly asks.

