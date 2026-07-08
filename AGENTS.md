# AGENTS.md - Supplier Quotation System

## Project Summary

Supplier Quotation System is a local-first quotation management tool for small-business purchasing workflows.

The core workflow is:

```text
Scan local files
Import supplier Excel files
Normalize products and supplier offers
Search and compare products
Preview customer quotations
Export formatted Excel quotation files
```

This repository contains application code, schema, scripts, and project documentation. It intentionally does not contain the operator's live SQLite database, product images, generated quotation files, or real customer and supplier source files.

## Non-Negotiable Boundaries

1. The MVP is a local/private tool, not a public SaaS platform.
2. Use Next.js, TypeScript, Tailwind CSS, Prisma, and SQLite.
3. Do not add multi-tenant auth, cloud sync, vector search, RAG, or agent-style automation unless explicitly requested in a future phase.
4. Never delete, move, rename, overwrite, or mutate source quotation files.
5. Do not commit secrets, local databases, source archives, product images, generated quotes, backups, or local assistant memory.
6. Keep imports deterministic and auditable. Data-cleanup scripts should support dry-run review before applying changes.
7. Prefer focused changes that match the existing data model and workflows.

## Data Boundary

Ignored local data includes:

- `.env*` except `.env.example`
- `.claude/`
- `prisma/dev.db`
- `*.sqlite`
- `backups/`
- `data/images/`
- `data/source-archive/`
- `sample-data/`
- `sample data/`
- `outputs/`

Do not add absolute local machine paths, external drive paths, real customer file names, API keys, or private pricing files to tracked documentation.

## Excel Rules

- Read Excel with SheetJS from the CDN tarball registered as the `xlsx` module.
- Do not install `xlsx` from the npm registry.
- Write quotation exports with ExcelJS.
- Support both `.xlsx` and `.xls` inputs.
- Treat source Excel files as read-only.

## Database Rules

- Use UUID primary keys for application tables.
- Store currency fields wherever prices are stored.
- Keep supplier purchase currency separate from customer quotation currency.
- Store source-file references through stable file records rather than trusting raw absolute paths.
- Keep carton dimensions as separate L/W/H fields when possible.
- Calculate derived carton volume at export time instead of storing it.

## Import Workflow

Supplier file import should support:

```text
Select file
Select sheet
Select header row
Preview rows
Map product identifier
Map price column and currency
Map optional fields
Preserve raw row data
Write structured records
```

Many real supplier sheets have variable headers, multiple price columns, missing MOQ fields, and mixed description/specification text. The importer should make these choices explicit instead of assuming a single universal layout.

## Product And Quote Workflow

- Product records are the cleaned catalog layer.
- Supplier offers represent factory pricing and carton data.
- Quote items snapshot pricing details at the time of quotation.
- Quote preview must show customer-facing output before export.
- Quote health checks should surface missing or suspicious data before generating files.
- Customer-facing exports must not expose internal purchase prices or factory-only information.

## Development Notes

- Keep source data out of Git.
- Add tests around shared parsing, pricing, ranking, and export logic.
- Use small, reviewable scripts for one-off data maintenance.
- Put reusable business rules in `src/lib/` instead of duplicating them in pages or scripts.
- Document meaningful workflow changes in `docs/`.
