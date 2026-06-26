# Supplier Quotation System MVP

Local-first quotation management tool for supplier price files, product library cleanup, customer quotation generation, and historical price reference.

This is not a SaaS product. It is a local business data tool built around real supplier Excel/PDF quotation files and a local SQLite database.

## What It Does

- Scans and indexes local quotation files.
- Imports supplier quotation Excel files into structured products and supplier offers.
- Supports customer quote files as historical FOB USD references.
- Builds a searchable product library with images, factories, prices, CTN data, and structured parameters.
- Lets users search products by category, power, IP, CCT, and text.
- Ranks supplier offers and shows historical customer sale prices during quotation.
- Previews quotes with quality warnings before export.
- Exports customer-facing or internal Excel quotation sheets.
- Provides quote history, customer quote search, and a data quality dashboard.
- Includes a prototype conversational quotation page with optional DeepSeek integration.

## Current State

As of V10.3:

- Products: 10,522
- Supplier offers: 12,379
- Product parameters: 47,156
- Product images: about 7,449 local images
- Excel source files indexed locally: 688
- External hard drive dependency: removed for daily use

The repository does not include the live SQLite database, product images, source quotation files, generated quote files, or customer/supplier raw data.

## Tech Stack

- Next.js App Router
- TypeScript
- Tailwind CSS
- Prisma
- SQLite
- SheetJS for reading `.xlsx` / `.xls`
- ExcelJS for writing formatted quote exports
- pdfjs-dist for PDF spike/import scripts
- Vitest for tests

## Important Data Boundary

The codebase is safe to share, but the real business data is intentionally ignored by Git.

Ignored local data includes:

- `prisma/dev.db`
- `backups/`
- `data/images/`
- `data/source-archive/`
- `sample-data/`
- `sample data/`
- `outputs/`
- `.env*`

That means a fresh clone contains the app code and documentation, but not the working product catalog. To run with real data, the operator must provide a local `prisma/dev.db` and any archived source/image folders separately.

## Local Setup

```bash
npm install
cp .env.example .env
npx prisma generate
npm run dev
```

Default local URL:

```text
http://localhost:3000
```

If using an existing local database, place it at:

```text
prisma/dev.db
```

If starting with an empty database:

```bash
npx prisma migrate dev
```

Optional chat feature:

```env
DEEPSEEK_API_KEY=your_key_here
```

The core quotation workflow does not require the chat feature or any cloud service.

## Main Pages

- `/` — overview
- `/scan` — file scanning
- `/files` — scanned file list
- `/import` — Excel import flow
- `/products` — product library
- `/triage` — raw product cleanup
- `/quotes` — quote center and Excel export
- `/customer-quotes` — imported historical customer FOB USD quotes
- `/data-quality` — data coverage dashboard
- `/chat` — optional conversational quote interface

## Core Workflow

```text
Scan files
→ Import Excel / PDF profile data
→ Normalize products and supplier offers
→ Enrich parameters and images
→ Search products
→ Select supplier offers
→ Preview quote and warnings
→ Export formatted Excel quotation
→ Reuse quote history and customer historical prices
```

## Verification

```bash
npx tsc --noEmit --pretty false
npm run lint
npm test
npm run build
```

Known current lint status: the project may contain a few warning-only unused variables in older maintenance scripts. These do not block builds or tests.

## Project Documentation

Key context files:

- `AGENTS.md` — project rules, constraints, data model decisions, phase history
- `docs/HANDOFF.md` — current project state, roadmap, and reasoning for future contributors
- `docs/release-readiness-checklist.md` — Beta/private release readiness gates and evidence checklist
- `docs/project-brief.md` — original business background
- `docs/phase0-spike-report.md` — initial Excel feasibility spike

Recent import and parameter pipeline reports live under `docs/`, including:

- `docs/v10.0-audit-report.md`
- `docs/v10.2-backfill-report.md`
- `docs/v10.3-import-report.md`
- `docs/v10.4-derive-report.md`

## Notes For Contributors

- Do not commit real databases, product images, generated quote files, or supplier/customer source files.
- Do not move, rename, delete, or overwrite source files from scripts.
- Read Excel with SheetJS, not ExcelJS.
- Write quote exports with ExcelJS.
- Treat `supplier_offers.purchase_price` as factory purchase cost, not customer sale price.
- Historical customer quotes are modeled separately from system-generated quotes.
- Prefer small, auditable scripts for one-off data migrations and write reports under `docs/`.
