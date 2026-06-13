# Claude Sync — Codex-led PDF Work V2.23 / V2.24

Date: 2026-06-14  
Prepared for: Claude / Claude Code  
Workspace: `/Users/bigmac/Desktop/Codex Projects/quotation-mvp`  
Latest commit at handoff: `dc39d08 V2.24: import S06 PDF quotation profile`

## Context

Claude quota was temporarily exhausted after the PDF import direction was agreed. Codex then took over the next PDF-focused work:

1. V2.23 — re-evaluate the PDF manual-review queue from V2.21.
2. V2.24 — import the one PDF that became profile-ready after V2.23 review.

The project remains local-only. No cloud services, no LLM calls, no OCR, and no source PDF modifications were introduced.

## Current Data State

Verified directly from `prisma/dev.db` after V2.24:

| Metric | Count |
|---|---:|
| Products | 10,043 |
| Categories | 30 |
| Supplier offers | 11,097 |
| Product params | 37,432 |
| Products with images | 7,453 |
| Price history records | 9,853 |
| PDF file records | 677 |

## Recent Commit Chain

| Commit | Scope |
|---|---|
| `d47f902` | V2.21 PDF parseability spike |
| `8ee56d1` | V2.22 profile-based PDF quotation importer |
| `6b6962c` | V3.0H parameter extraction for PDF-imported products |
| `3021d93` | V2.23 manual-review PDF re-evaluation |
| `dc39d08` | V2.24 S06 PDF profile import |

## V2.23 — Manual-review PDF Re-evaluation

### Goal

Take the 10 PDF files marked `manual-review` in V2.21 and re-check whether any can be safely imported without building a full generic PDF UI.

### What Codex Built

New script:

- `scripts/pdf-review-v2.23.ts`

Generated reports:

- `docs/v2.23-pdf-manual-review-report.md`
- `docs/v2.23-pdf-manual-review-details.csv`

Updated:

- `docs/HANDOFF.md`

### Method

The script re-runs text extraction with `pdfjs-dist`, then scores each PDF by:

- page count
- text extraction quality
- row grouping under multiple `yTolerance` values
- model-like tokens
- RMB / USD price signals
- longest table-like row run
- price semantic signals

It does not write to the database.
It does not import any products.
It does not edit any PDF files.

### Result

| Classification | Count | Meaning |
|---|---:|---|
| `profile-ready` | 1 | Can use existing profile-based parser with small profile addition |
| `custom-parser-review` | 5 | Probably parseable, but needs custom logic per family |
| `excluded-usd-fob` | 4 | Customer/sale-price PDFs, should not be imported as supplier cost |

The one `profile-ready` file was:

```text
/Volumes/My Passport/AI 报价/各家工厂最新报价汇总/户外照明 工业照明/三防灯/普照/普照2025-4月更新/双色管B报价表_20250403205729.pdf
```

Profile name used later in V2.24:

```text
S06-puzhao-sanfang-b
```

### Important Decision

Do not build a general PDF import UI yet.

Reason: V2.21/V2.23 showed only a small subset of the 617 PDFs are immediately safe to import. The pragmatic path is profile-based scripted import for clearly structured RMB factory quote PDFs.

## V2.24 — S06 PDF Profile Import

### Goal

Import only the V2.23-confirmed profile-ready PDF:

```text
户外照明 工业照明/三防灯/普照/普照2025-4月更新/双色管B报价表_20250403205729.pdf
```

This is a factory RMB quotation PDF, not a customer FOB USD quote.

### Files Modified

Code:

- `scripts/pdf-import-profiles.ts`
- `scripts/pdf-import-v2.22.ts`

Docs:

- `docs/v2.24-pdf-import-dryrun.md`
- `docs/v2.24-pdf-import-result.md`
- `docs/HANDOFF.md`

### Code Changes

`scripts/pdf-import-profiles.ts`

- Added profile `S06-puzhao-sanfang-b`
- Category: `三防灯`
- Factory: `普照`
- Currency: `RMB`
- Parser: `puzhao-sanfang`
- Added hints for model, wattage, price, product size, CTN size, CTN Qty, and remark

`scripts/pdf-import-v2.22.ts`

- Added environment-controlled report naming:
  - `PDF_IMPORT_VERSION`
  - `PDF_IMPORT_SLUG`
- This avoids overwriting V2.22 reports when running later PDF batches.
- Added import fields for:
  - `ctnQty`
  - `ctnLength`
  - `ctnWidth`
  - `ctnHeight`
- Enhanced the `puzhao-sanfang` parser:
  - model can appear in any cell in a row, not only the first cell
  - `*` / `×` are preserved in model numbers, fixing models like `PZ-HP-B-1*600`
  - decimal prices without explicit `¥` can be parsed for known Puzhao Sanfang rows
  - product size and CTN size are split when two dimension strings appear in one row
  - CTN Qty is read from the value after the CTN dimension
  - remark filtering removes price, size, carton size, CTN Qty, and plain integer noise

### Dry-run

Report:

```text
docs/v2.24-pdf-import-dryrun.md
```

Dry-run result:

| Metric | Count |
|---|---:|
| Profiles | 1 |
| PDF pages | 1 |
| Rows parsed | 18 |
| Valid records | 6 |
| Skipped rows | 0 |
| New products predicted | 6 |
| New offers predicted | 6 |
| Price range | 13.38-36.36 RMB |

### Apply

Report:

```text
docs/v2.24-pdf-import-result.md
```

DB backup:

```text
backups/dev-before-v2.24-pdf-20260614002624.sqlite
```

DB changes:

| Metric | Before | After | Delta |
|---|---:|---:|---:|
| products | 10,037 | 10,043 | +6 |
| supplier_offers | 11,091 | 11,097 | +6 |
| price_history | 9,853 | 9,853 | 0 |

Imported rows:

| Model | Price | Size | CTN Qty | CTN L/W/H |
|---|---:|---|---:|---|
| `PZ-HP-B-1*600 18W` | 13.38 | `600*75*25` | 40 | `62 / 34 / 33.5` |
| `PZ-HP-B-1*1200 36W` | 24.31 | `1200*75*25` | 20 | `122 / 34 / 17.5` |
| `PZ-HP-B-1*1500 48W` | 33.24 | `1500*75*25` | 20 | `152 / 34 / 17.5` |
| `PZ-HP-B2-1*600 18W` | 15.84 | `600*75*25` | 40 | `62 / 34 / 33.5` |
| `PZ-HP-B2-1*1200 36W` | 26.72 | `1200*75*25` | 20 | `122 / 34 / 17.5` |
| `PZ-HP-B2-1*1500 48W` | 36.36 | `1500*75*25` | 20 | `152 / 34 / 17.5` |

Source file id:

```text
63c1f8bd-80c3-42ea-b435-2b8f1520d0f9
```

## Verification Performed

Fresh verification after V2.24:

| Check | Result |
|---|---|
| `npx tsc --noEmit --pretty false` | Passed |
| `npm run lint -- --max-warnings=0` | Passed |
| `npm test` | 23 files passed, 121 tests passed, 1 skipped |
| `npm run build` | Passed |

Build still emits existing Turbopack warnings from `src/lib/image-extractor.ts` dynamic image paths. These warnings predate V2.24 and did not fail the build.

## Local Environment Note

During the V2.24 run, Prisma's native query engine was blocked by macOS system policy:

```text
library load denied by system policy
```

Resolution used locally:

```text
codesign --force --sign - node_modules/.prisma/client/libquery_engine-darwin-arm64.dylib.node node_modules/@prisma/engines/libquery_engine-darwin-arm64.dylib.node
```

This changed only ignored `node_modules` files. No source code or database schema was changed for this workaround.

## Known Follow-up Found During V2.24

V2.24 revealed, but did not touch, a likely old Excel import anomaly in 普照三防灯:

Existing products/offers:

```text
PZ-HP-B1-1*600   price 1 RMB
PZ-HP-B1-1*1200  price 1 RMB
PZ-HP-B1-1*1500  price 1 RMB
PZ-HP-B2-1*600   price 2 RMB
PZ-HP-B2-1*1200  price 2 RMB
PZ-HP-B2-1*1500  price 2 RMB
```

Source path:

```text
户外照明 工业照明/三防灯/普照/普照2025-10月更新/2025年10月份汇孚广交会报价-三防灯-净化灯/25年10月汇孚广交会双色管报价表25.10.13.xlsx.xlsx
```

Interpretation:

- These are not from V2.24.
- They likely came from an older Excel import where a non-price numeric column was treated as price.
- Do not delete blindly.
- Recommended next task: V2.25 audit this specific source and either correct or remove the bad offers safely.

## Recommended Next Steps

1. **V3.0I — Extract params for V2.24 PDF products**
   - The 6 new S06 products currently have no `product_params`.
   - Likely extractable fields: watts, size_display, material, voltage, CRI, lumens_per_watt, maybe CCT for B2 rows.

2. **V2.25 — 普照三防灯 old price anomaly audit**
   - Investigate the 6 old `PZ-HP-B1/B2` offers with price `1/2 RMB`.
   - Confirm whether quote_items reference them before changing anything.
   - Prefer correction from source over deletion if real price is recoverable.

3. **PDF custom parser review**
   - V2.23 left 5 PDFs in `custom-parser-review`.
   - Only proceed if the expected yield justifies parser work.

4. **Keep generic PDF UI deferred**
   - Current evidence supports profile-based imports, not a general user-facing PDF mapper.

## Files Claude Should Inspect First

For V2.24 parser review:

- `scripts/pdf-import-v2.22.ts`
- `scripts/pdf-import-profiles.ts`
- `docs/v2.24-pdf-import-result.md`

For PDF pipeline context:

- `docs/v2.21-pdf-spike-report.md`
- `docs/v2.23-pdf-manual-review-report.md`
- `docs/HANDOFF.md`

For immediate follow-up:

- Search DB for `PZ-HP-B1` / `PZ-HP-B2`
- Inspect the 2025-10 普照 Excel source listed above

