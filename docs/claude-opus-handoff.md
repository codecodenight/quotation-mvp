# Claude Opus Handoff — Supplier Quotation System

Date: 2026-06-07
Workspace: `/Users/bigmac/Desktop/Codex Projects/quotation-mvp`

## 1. Project Goal

This project is a local-only supplier quotation management system.

Core business loop:

```text
Scan local Excel files
→ Import quote data
→ Maintain product library and supplier offers
→ Select products for customer quote
→ Export customer-facing Excel quotation
```

This is not a cloud SaaS product, not an AI agent, and not a multi-user system.
The current focus is a practical local tool for real supplier quotation data.

Hard constraints:

- Local only.
- Tech stack: Next.js + TypeScript + Tailwind CSS + Prisma + SQLite.
- Read Excel with SheetJS `xlsx`.
- Write quotation Excel with `exceljs`.
- Do not move, rename, delete, or overwrite source Excel files.
- No Supabase, Vercel, vector DB, RAG, LLM calls, auth, or tenant system in MVP.

Primary reference files:

- `AGENTS.md`
- `docs/project-brief.md`
- `docs/phase0-spike-report.md`

## 2. Current Status

The MVP loop is already working.

Completed:

| Version | Scope | Status |
|---------|-------|--------|
| Phase 0 | Real Excel spike | Done |
| Phase 1 | Project setup | Done |
| Phase 2 | File scanner | Done |
| Phase 3 | Product CRUD | Done |
| Phase 4 | Excel import | Done |
| Phase 5 | Product triage | Done |
| Phase 6 | Quotation export | Done |
| V1.1 | 核价文件导入 | Done |
| V1.2 | 报价单客户模式导出 | Done |
| V1.3 | CTN 三列拆分 + 客户模式导出更新 | Done |
| V1.4 | CTN 批量回填 + 产品类别清洗 | Done |
| V1.5 | 报价单 Product Details / MOQ 显示清洗 | Done |
| V1.6 | 报价前数据体检提示 | Done |
| V1.7 | 产品库 CTN 补录入口 + 报价页跳转修资料 | Done |

Current data:

- Products: 457 across 7 categories
  - 太阳能
  - 球泡
  - 面板灯
  - 三防灯
  - 线条灯
  - 灯带
  - 皮线灯
- Supplier offers: 1,073
- Imported from 33 quotation / 核价 files

Current CTN coverage after backfill:

- Total supplier offers: 1,073
- With `ctn_qty`: 496
- With L/W/H: 499

Current backup:

```text
backups/dev-before-category-normalization-20260607.sqlite
```

## 3. Data Sources

There are two import paths.

### 3.1 Supplier Quotation Files

These are raw factory quotation files.

Flow:

```text
Excel file
→ raw_products
→ triage
→ products + supplier_offers
```

This path exists but is less used in the current real data flow.

### 3.2 核价 Files

These are already structured quote/check-price files.

Flow:

```text
Excel file
→ products + supplier_offers
```

This skips `raw_products`.

The currently imported Excel sources are quotation / 核价 files, not raw factory source files.
This was explicitly checked before continuing V1 work.

核价 import supports carton size in two modes:

- Mode A: one column like `52.3×49.5×27.4 cm`, parsed into L/W/H.
- Mode B: three separate columns L / W / H, stored directly.

Mode B takes priority if both are mapped.

Parser:

```text
src/lib/hejia-import.ts
parseCtnSize()
```

## 4. Database Notes

Important tables:

- `files`
- `raw_products`
- `products`
- `supplier_offers`
- `quotes`
- `quote_items`

All IDs are UUIDs.

Important `supplier_offers` fields:

- `purchase_price`
- `currency`
- `moq`
- `ctn_qty`
- `ctn_length`
- `ctn_width`
- `ctn_height`
- `ctn_size`
- `remark`

Carton-size decision:

- New data uses `ctn_length`, `ctn_width`, `ctn_height`.
- These store pure numeric text in centimeters, without unit suffix.
- `ctn_size` is legacy and is retained but not written by new imports.
- No `ctn_volume` field exists.
- Volume is calculated during Excel export:

```text
L × W × H / 1,000,000
```

MOQ decision:

- DB keeps original `supplier_offers.moq`.
- Export cleans it at display time.
- Example: `1000/色` exports as `1000`.

## 5. Quotation Export Format

Reference template:

```text
sample-data/客户模式报价单-CTN三列示例.xlsx
```

Customer mode has 10 columns A-J:

| Col | Header | Source |
|-----|--------|--------|
| A | Model Name | `products.model_no` |
| B | Product Details | `products.remark` + newline + `Size: products.size` |
| C | Unit Price ({currency}) | calculated sale price |
| D | MOQ | cleaned `supplier_offers.moq` |
| E | CTN Qty | `supplier_offers.ctn_qty` |
| F | L | `supplier_offers.ctn_length + " cm"` |
| G | W | `supplier_offers.ctn_width + " cm"` |
| H | H | `supplier_offers.ctn_height + " cm"` |
| I | Volume | calculated m3 |
| J | Remark | user input |

Internal mode has 12 columns:

- Same as customer mode.
- Adds Factory Name and Purchase Price before Unit Price.

Formatting requirements already implemented:

- Double-row header.
- Title row.
- Header fill colors.
- Borders.
- Freeze at A8.
- AutoFilter on row 7.
- Product Details wraps text.

Pricing formula:

```text
sale_price = purchase_price / exchange_rate × (1 + profit_margin)
```

Same currency:

```text
exchange_rate = 1
```

Exchange rate user meaning:

```text
1 sale_currency = X purchase_currency
```

Example:

```text
1 USD = 7.2 RMB
```

UI label:

```text
汇率（1 报价币种 = ? 采购币种）
```

## 6. Recent Conversation Context

The user asked how far the project is from V2.0 and what V2.0 acceptance should mean.

Suggested answer given:

- MVP loop is functional.
- Distance to V2.0: roughly 3-4 small steps.
- The gap is not basic feasibility anymore.
- The gap is production usability for real customer quotation work.

Suggested V2.0 acceptance standard:

1. Real quotation files can be imported and used without manual database work.
2. Customer quote export is usable without manually fixing headers, price, MOQ, CTN, or Product Details.
3. Quote health warnings catch obvious missing or bad data before export.
4. User can fix data from the UI, not from SQLite/scripts.
5. Source Excel files remain read-only and safe.
6. Historical quotes are findable and reusable.

Suggested next steps before V2.0:

1. V1.8: Quote preview / confirmation before generating Excel.
2. V1.9: Quote history enhancements: open/download exported quote, search by customer/date.
3. V1.10: Real end-to-end acceptance run with 10-20 products across categories.
4. Update AGENTS.md to define V2.0 scope and acceptance criteria.

The user then asked for this handoff document so Claude Opus can analyze what should happen next.

## 7. Why V1.8 Quote Preview Was Recommended

Current quote generation flow:

```text
Search products
→ choose supplier offer
→ enter customer / margin / currency / exchange rate
→ click generate
→ Excel file is written
```

Problem:

- There is no final preview before writing the Excel.
- If price, MOQ, CTN, Product Details, or selected supplier offer is wrong, the user only sees it after generating/opening Excel.
- This is risky for real customer quotes.

Recommended V1.8:

```text
Search/select products
→ choose offers
→ enter quote parameters
→ preview quote rows in browser
→ confirm export
→ write Excel + DB quote
```

Preview should show at least:

- Model Name
- Product Details
- Supplier offer selected
- Purchase price
- Sale price
- MOQ
- CTN Qty
- L/W/H
- Volume
- Remark
- Any health warnings

Important: this should not require a schema change.

## 8. Recent V1.6 and V1.7 Details

### V1.6 Quote Health Warnings

Implemented in:

```text
src/lib/quote-health.ts
src/lib/quote-health.test.ts
src/app/quotes/page.tsx
```

Warnings:

- Missing CTN L/W/H.
- Missing CTN Qty.
- MOQ empty or obviously header text.
- Product Details too short or duplicated.
- Size empty.
- Purchase price <= 0.

Non-blocking:

- The user can still export.
- This is a warning, not a hard validation.

### V1.7 Repair Loop

Implemented in:

```text
src/lib/product-form.ts
src/lib/product-form.test.ts
src/app/products/page.tsx
src/app/quotes/page.tsx
```

Changes:

- Quote page now shows `去产品库补资料` when a product has quote health warnings.
- Link goes to `/products?productId={id}#product-{id}`.
- Product library supports editing CTN fields in supplier offer form:
  - CTN Qty
  - Carton L (cm)
  - Carton W (cm)
  - Carton H (cm)
- Product library list displays CTN information.

V1.7 validation passed:

- `npm test`
- `npx tsc --noEmit`
- `npm run lint`
- `npm run build`
- Manual page request checks.

## 9. Important Existing Files for Review

Core schema:

```text
prisma/schema.prisma
```

Excel import:

```text
src/app/import/page.tsx
src/app/import/actions.ts
src/lib/hejia-import.ts
```

Product management:

```text
src/app/products/page.tsx
src/app/products/actions.ts
src/lib/product-form.ts
```

Quote export:

```text
src/app/quotes/page.tsx
src/app/quotes/actions.ts
src/lib/quote-export.ts
src/lib/quote-health.ts
```

File scanner:

```text
src/lib/file-scanner.ts
src/app/scan/scan-panel.tsx
src/app/api/scan/route.ts
```

## 10. Open Questions for Claude Opus

Please analyze the project from the perspective of what should happen next.

Key questions:

1. Is V1.8 quote preview the correct next step, or should quote history/search be done first?
2. What should be the exact V2.0 acceptance standard?
3. Should V2.0 mean "ready for daily internal use" or "ready for customer-facing delivery without developer support"?
4. What are the biggest remaining business risks?
5. What are the biggest data risks?
6. What UI workflows still feel too technical for a non-technical user?
7. Are there any features that should explicitly not be built before V2.0?
8. Does the current schema still look sufficient for V2.0, or is there a blocker?

Recommended constraints for future advice:

- Do not propose cloud deployment.
- Do not propose AI parsing / LLM extraction before the current structured workflow is stable.
- Do not propose source-file mutation.
- Prefer small V1.x steps that can be reviewed one by one.
- Keep source Excel files read-only.

## 11. Suggested Short-Term Roadmap

Proposed remaining path to V2.0:

### V1.8 — Quote Preview / Confirmation

Goal:

- Prevent wrong customer quotes before Excel is generated.

Main behavior:

- User selects products/offers and quote parameters.
- App shows a preview table matching customer quote output.
- User confirms export.

No schema change expected.

### V1.9 — Quote History Usability

Goal:

- Make previous quotes easy to find and open.

Main behavior:

- Search by customer.
- Filter by date.
- Open/download exported Excel file from history.
- Show quote item summary clearly.

No schema change expected unless file-serving needs metadata improvements.

### V1.10 — Real Acceptance Run

Goal:

- Validate V2.0 readiness with real usage.

Suggested test:

- Build one customer quotation with 10-20 products.
- Include at least:
  - 球泡
  - 面板灯
  - 三防灯
  - 太阳能
  - 线条灯 or 灯带
- Verify:
  - sale price
  - exchange-rate direction
  - MOQ cleanup
  - CTN Qty
  - L/W/H
  - Volume
  - Product Details
  - customer-mode hidden columns
  - internal-mode cost columns

### V2.0 Definition

Once the above passes, update `AGENTS.md` with:

- V2.0 scope.
- V2.0 acceptance checklist.
- V2.0 non-goals.
- Next phase after V2.0.

## 12. Context Length / Compression Note

The previous conversation is long.

The current working approach is to keep durable decisions in `AGENTS.md`.
That makes context compression acceptable.

Risk:

- Details that only live in chat may be lost or softened by compression.

Mitigation:

- After each accepted version, write the final rule or decision into `AGENTS.md`.
- Use handoff documents like this for cross-model analysis.

