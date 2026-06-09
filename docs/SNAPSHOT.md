# SNAPSHOT.md — Project State Snapshot

Last updated: 2026-06-09
Update method: Opus regenerates from repo after each major version

---

## What This Is

Local-only supplier quotation management system for foreign trade LED lighting.
Core loop: factory Excel → import → product library → customer quotation Excel.

## Tech Stack

- Next.js + TypeScript + Tailwind CSS
- Prisma + SQLite (local DB, `prisma/dev.db`)
- SheetJS (read Excel, from CDN tarball, NOT npm)
- exceljs (write quotation Excel)
- sharp (thumbnail generation)
- adm-zip + xml2js (xlsx image extraction)
- LibreOffice soffice (xls → xlsx conversion for image extraction)

## Directory Structure

```
quotation-mvp/
├── prisma/schema.prisma          # data model
├── prisma/dev.db                 # SQLite database
├── prisma/migrations/            # raw SQL migrations
├── src/
│   ├── app/
│   │   ├── scan/                 # file scanner page
│   │   ├── files/                # file list page
│   │   ├── products/             # product library page
│   │   ├── import/               # Excel import page (hejia + factory modes)
│   │   ├── quotes/               # quote center (create, preview, export, history)
│   │   └── api/
│   │       ├── files/[id]/       # file streaming
│   │       ├── products/[id]/image/  # product thumbnail API
│   │       └── quotes/[id]/download/ # quote Excel download
│   └── lib/
│       ├── hejia-import.ts       # 核价 import core (multi-column merge, price cleaning)
│       ├── quote-export.ts       # Excel quotation export (customer/internal mode)
│       ├── quote-preview.ts      # preview data builder (server-only)
│       ├── quote-health.ts       # data health warnings
│       ├── quote-history.ts      # history search/detail/reuse
│       ├── quote-selection.ts    # cross-search product selection state
│       ├── image-extractor.ts    # xlsx/xls product image extraction
│       ├── product-form.ts       # product editing helpers
│       ├── file-scanner.ts       # external drive file scanner
│       └── excel-import.ts       # factory raw Excel import
├── scripts/                      # one-time data scripts
├── sample-data/                  # test files and templates
├── data/images/                  # extracted product images + thumbnails
├── outputs/quotes/               # generated quotation Excel files
├── backups/                      # DB snapshots before data operations
├── docs/                         # reports, task instructions, handoffs
├── AGENTS.md                     # project rules and constraints
└── CLAUDE.md                     # Claude Code startup config
```

## Database Tables

| Table | Records | Purpose |
|---|---|---|
| products | 1,280 | Cleaned product catalog |
| supplier_offers | 1,901 | Per-factory pricing with CTN/MOQ |
| files | ~417 | Scanned file index |
| raw_products | varies | Raw rows from factory Excel import |
| quotes | ~22 | Customer quotation headers |
| quote_items | ~60 | Quotation line items with price snapshots |

## Key Fields

```
products: id, productName, modelNo, category, material, size, remark, imagePath
supplier_offers: id, productId, factoryName, purchasePrice, currency, moq,
                 ctnQty, ctnLength, ctnWidth, ctnHeight, ctnSize(legacy),
                 priceUpdatedAt, remark
quotes: id, customerName, currency, profitMargin, exchangeRate, createdAt, filePath
quote_items: id, quoteId, productId, supplierOfferId, purchasePrice,
             purchaseCurrency, quantity, remark
```

## Data Coverage

- 25 categories covered
- Top categories: 灯丝灯(200), 太阳能(174), 轨道灯(151), 橱柜灯(134), 球泡(104)
- CTN coverage: 33% (source data limitation)
- Price timestamps: 43% of offers
- Product images: 13 products (V2.6, not yet batch-applied)
- Clean categories (full data): 球泡, 三防灯, 线条灯
- Sparse categories (<10 products): 灯管, Highbay, 地插灯, 防潮灯, 大面板灯, 庭院灯

## Data Sources on Disk

```
/Volumes/My Passport/AI 报价/
├── 发客户报价单汇总/     # 98 Excel files, customer quotation summaries by category
└── 各家工厂最新报价汇总/  # 1,613 Excel files, factory quotations by factory
```

~80 files imported so far out of ~1,700 total Excel files.
~1,000 PDF files exist but are not parseable by the current system.

## Running

```bash
cd "/Users/bigmac/Desktop/Codex Projects/quotation-mvp"
npm run dev
# → http://localhost:3000
```

Not a git repo currently.
