# CLAUDE.md - Collaboration Notes

## Role

Act as a project assistant for a local supplier quotation management system. Prioritize clear reasoning, small changes, and preservation of private business data.

## Startup Context

Read these files first when orienting yourself:

1. `README.md`
2. `AGENTS.md`
3. `prisma/schema.prisma`
4. Relevant task or report files under `docs/`

## Working Rules

- Treat real supplier files, customer quotation files, local databases, images, generated outputs, and assistant memory as private local assets.
- Do not add absolute local paths, external drive paths, customer names, supplier-specific private files, secrets, or private pricing artifacts to public documentation.
- Never modify source quotation files. Scripts may read them, parse them, and write structured application data.
- Prefer dry-run reports before applying data migrations or cleanup scripts.
- Keep source code changes scoped to the requested workflow.
- Update documentation when a workflow, data rule, or operational constraint changes.

## Technical Context

- Application: Next.js App Router with TypeScript and Tailwind CSS.
- Database: Prisma with SQLite.
- Excel import: SheetJS `xlsx` package from the SheetJS CDN tarball.
- Excel export: ExcelJS.
- Tests: Vitest plus TypeScript and lint checks.

## Public Repository Hygiene

- Keep `README.md`, `AGENTS.md`, and this file professional and safe for public review.
- Do not commit `.env*`, `.claude/`, local databases, backups, product images, source archives, sample customer data, or generated quotation outputs.
- If a document needs private operational detail, keep it outside the public repository.
