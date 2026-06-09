# Dangling Quote Items Cleanup Result

Generated: 2026-06-10 00:39 Asia/Shanghai

## Scope

- Task: delete quote items that reference a missing supplier offer.
- Target missing supplier offer: `fba596bd-3a5d-4737-a94b-fed6f151d0cb`
- Target quote items:
  - `9565cf63-1bfe-4a60-aad5-c95da571cb73`
  - `8d1382a4-2d20-4422-be55-b7fbfc0de604`
- DB backup: `backups/dev-before-dangling-quote-items-20260610-003627.sqlite`

## Step 1 — Backup + Confirmation

Backup completed before deletion.

Pre-delete dangling quote items:

| quote_item_id | quote | missing supplier_offer_id | purchase_price | currency |
|---|---|---|---:|---|
| `9565cf63-1bfe-4a60-aad5-c95da571cb73` | V1.8 Preview Test | `fba596bd-3a5d-4737-a94b-fed6f151d0cb` | 2.35 | RMB |
| `8d1382a4-2d20-4422-be55-b7fbfc0de604` | V2真实跑-02-球泡 | `fba596bd-3a5d-4737-a94b-fed6f151d0cb` | 2.35 | RMB |

Confirmation:

- Total dangling quote items before cleanup: 2
- No other dangling quote items found.
- Each affected test quote had 3 items before cleanup, with 1 dangling item each.

## Step 2 — Delete

Executed:

```sql
DELETE FROM quote_items WHERE id IN (
  '9565cf63-1bfe-4a60-aad5-c95da571cb73',
  '8d1382a4-2d20-4422-be55-b7fbfc0de604'
);
```

Result:

- Deleted rows: 2

## Step 3 — Verification

Post-delete verification:

| Check | Result |
|---|---:|
| Dangling quote_items | 0 |
| Remaining quote_items total | 76 |
| V1.8 Preview Test remaining items | 2 |
| V2真实跑-02-球泡 remaining items | 2 |

Target IDs no longer exist in `quote_items`.

Project verification:

| Command | Result |
|---|---|
| `npm test` | Passed: 15 files, 62 passed, 1 skipped |
| `npm run lint` | Passed |
| `npm run build` | Passed |

Build notes:

- Next.js build completed successfully.
- Existing Turbopack warnings remain in `src/lib/image-extractor.ts` for broad dynamic image file path patterns. These warnings are unrelated to this cleanup and did not block the build.

## Final Result

Cleanup completed.

- Removed 2 dangling test quote items.
- No dangling quote items remain.
- No source Excel files or output quote files were modified.
