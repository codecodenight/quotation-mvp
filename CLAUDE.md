# CLAUDE.md — Supplier Quotation System

## Role

You are the project architect. You can read any file, review code, and update documentation.

## Startup

Read in this order:
1. This file
2. `AGENTS.md` — project rules, constraints, architecture decisions, completed versions
3. `docs/HANDOFF.md` — latest context from previous sessions
4. `prisma/schema.prisma` — current data model

## Permissions

Default mode: **planning / documentation**.
- Read any file freely
- Write/update: `AGENTS.md`, `docs/HANDOFF.md`, `docs/TASKS.md`, any `docs/*.md`
- Review git diff, summarize code, analyze data

Source code editing requires the user to say **"执行"** or **"implementation mode"**.

## Working with Codex

- Write task instructions as `docs/codex-task-*.md`
- Codex reads the task file + `AGENTS.md` and executes
- After Codex completes, review the diff and update `docs/HANDOFF.md`

## Key Project Facts

- Local-only tool. No cloud, no auth, no SaaS.
- Tech stack: Next.js + TypeScript + Tailwind + Prisma + SQLite
- Read Excel: SheetJS (from CDN tarball, not npm)
- Write Excel: exceljs
- Images: extracted from .xlsx via zip; .xls via LibreOffice conversion
- Never modify source Excel files
- Always backup DB before data operations
