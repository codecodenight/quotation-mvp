# Domain Docs

How engineering skills should consume this repo's domain documentation.

## Before exploring, read these

- `CONTEXT.md` at the repo root, if it exists.
- `docs/HANDOFF.md`, which currently carries the richest project context and V45 state.
- `docs/adr/`, reading ADRs that touch the area about to be changed.
- `AGENTS.md` for project constraints, architecture decisions, and completed versions.
- `prisma/schema.prisma` for the current data model.

If `CONTEXT.md` or `docs/adr/` do not exist yet, proceed silently. The `domain-modeling` skill should create them lazily when project terms or architectural decisions need to be recorded.

## File structure

This is a single-context repo:

```text
/
├── CONTEXT.md
├── docs/
│   ├── HANDOFF.md
│   ├── agents/
│   └── adr/
└── src/
```

## Use the glossary's vocabulary

When output names a domain concept, use the term as defined in `CONTEXT.md`. If the concept is not defined yet, use the existing vocabulary from `docs/HANDOFF.md` and note the gap for `domain-modeling`.

Pay special attention to terms that have caused ambiguity:

- `supplier_offers.purchase_price` is factory purchase/cost price, normally RMB.
- Historical customer quote prices are FOB USD sale prices and must not be written to `supplier_offers.purchase_price`.
- `sale_price` is calculated for customer quote output.
- `price_flag` marks price anomaly state, such as `suspicious_low`, `suspicious_high`, and `outlier_high`.

## Flag ADR conflicts

If output contradicts an existing ADR, surface it explicitly rather than silently overriding it.
