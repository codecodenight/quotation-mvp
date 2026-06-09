# V2 Real Quote Run Report

Run date: 2026-06-08
Source folder checked: `/Volumes/My Passport/AI 报价/发客户报价单汇总`

Scope: generate 8 real customer-mode quotation workbooks from the current product library and record friction points.

Note: browser text input automation was blocked by the Browser plugin virtual clipboard issue, so the 8 exports were run through the server-side path using the existing database records and `quote-export.ts`. This still wrote real `quotes` + `quote_items` records and real Excel files. The UI search/selection friction was checked from the same search logic and current product library coverage.

## Summary

All 8 quotation exports completed.

| # | Scenario | Items | Data warnings | Export format | Price check | File |
|---|----------|-------|---------------|---------------|-------------|------|
| 1 | 太阳能单品类 | 3 | 6 | PASS | PASS | `outputs/quotes/2026-06-08-V2真实跑-01-太阳能-60701db3.xlsx` |
| 2 | 球泡单品类 | 3 | 0 | PASS | PASS | `outputs/quotes/2026-06-08-V2真实跑-02-球泡-e134adb6.xlsx` |
| 3 | 面板灯单品类 | 3 | 3 | PASS | PASS | `outputs/quotes/2026-06-08-V2真实跑-03-面板灯-2ccff7a1.xlsx` |
| 4 | 三防灯单品类 | 3 | 0 | PASS | PASS | `outputs/quotes/2026-06-08-V2真实跑-04-三防灯-a0b33a70.xlsx` |
| 5 | 线条灯单品类 | 3 | 0 | PASS | PASS | `outputs/quotes/2026-06-08-V2真实跑-05-线条灯-caa3ee75.xlsx` |
| 6 | 灯带单品类 | 3 | 8 | PASS | PASS | `outputs/quotes/2026-06-08-V2真实跑-06-灯带-9fd41f37.xlsx` |
| 7 | 跨品类：球泡 + 三防灯 + 线条灯 | 3 | 0 | PASS | PASS | `outputs/quotes/2026-06-08-V2真实跑-07-跨品类A-69358515.xlsx` |
| 8 | 跨品类：太阳能 + 灯带 + 面板灯 | 3 | 5 | PASS | PASS | `outputs/quotes/2026-06-08-V2真实跑-08-跨品类B-27f454f5.xlsx` |

Detailed JSON: `outputs/verification/v2-real-quote-run.json`

## Where It Got Stuck

### 1. Search

Current library search works for imported categories:

| Search term | Matches |
|-------------|---------|
| 太阳能 | 174 |
| 球泡 | 104 |
| 面板灯 | 67 |
| 三防灯 | 57 |
| 线条灯 | 32 |
| 灯带 | 21 |

Search gets stuck for categories that exist in the source folder but have not been imported yet:

| Source folder/category | Current product matches |
|------------------------|-------------------------|
| 筒灯 | 0 |
| 五面办公灯 | 0 |
| 办公灯 | 0 |
| 净化灯 | 0 |
| 轨道灯 | 0 |
| 台灯 | 0 |
| Highbay | 0 |

Impact: for these source-folder categories, the user cannot quote from the system until the relevant核价 files are imported.

### 2. Product Selection

Selection worked for all imported categories and mixed-category quotes. Cross-category quote generation passed in both mixed scenarios.

Friction:
- Current search returns first 50 matches; broad categories like 太阳能 have many similar rows.
- Without product image/short spec columns, choosing the exact product still depends on reading long Product Details.
- For categories with duplicate or similar model names, supplier offer choice may still require manual attention.

### 3. Missing Data

Health warnings correctly surfaced missing data before export.

Main gaps:

| Category | Warning pattern |
|----------|-----------------|
| 太阳能 | Missing CTN Qty and CTN L/W/H on selected offers |
| 面板灯 | Missing CTN Qty on selected offers |
| 灯带 | Missing CTN Qty, CTN L/W/H, and some Size |

Clean categories in this run:
- 球泡
- 三防灯
- 线条灯
- Mixed quote with 球泡 + 三防灯 + 线条灯

### 4. Export Format

All 8 exported customer-mode workbooks passed structural checks:
- 10 columns
- AutoFilter `A7:J7`
- Freeze panes at `A8`
- Customer-mode columns only, no factory/purchase price columns
- Workbook files written successfully

No export format blocker found.

### 5. Price Calculation

All 8 exports passed price checks.

Formula used:

```text
sale_price = purchase_price / 7.2 × (1 + 0.2)
```

The generated Excel values matched the expected two-decimal sale prices for every exported row.

No price calculation blocker found.

## Practical Next Step

The biggest real-use blocker is not export. It is product library coverage and missing data.

Recommended next step:
1. Import the currently uncovered source-folder categories first: 筒灯, 轨道灯, 台灯, Highbay, 净化灯.
2. Then batch-fill CTN data for 太阳能 / 灯带 / 面板灯.
3. After that, improve search usability for broad categories by adding stronger filters or quote-history reuse.
