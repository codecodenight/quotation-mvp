# Stale Files Cleanup Dry-Run Report

Generated: 2026-06-11T11:54:56.601Z
Backup: `backups/dev-before-stale-files-cleanup-20260611-195255.sqlite`

## Scope

- Source list: `docs/drive-db-diff-details.csv`
- Included: `status = db-file-missing-no-match` only
- Excluded: `status = db-path-missing-candidate-on-disk`
- Dry-run only: no database rows were updated or deleted.

## Step 0 — Baseline

| Metric | Count |
|---|---:|
| files total | 747 |
| files on My Passport | 735 |
| supplier_offers | 2230 |
| supplier_offers with source_file_id | 2230 |
| raw_products | 35 |
| products | 2140 |
| product_params | 2755 |
| price_history | 0 |

## Step 1 — Stale File Identification

| Check | Count |
|---|---:|
| CSV rows with db-file-missing-no-match | 258 |
| Unique stale file IDs from CSV | 258 |
| Stale file IDs found in DB | 258 |
| Stale file IDs missing from DB | 0 |
| Candidate-on-disk rows excluded | 3 |

## Step 2 — Reference Summary

| Reference | Files | Rows |
|---|---:|---:|
| supplier_offers.source_file_id | 9 | 201 |
| raw_products.source_file_id | 0 | 0 |
| price_history.old_source_file_id | 0 | 0 |
| price_history.new_source_file_id | 0 | 0 |
| no references | 249 | 249 files |

## 3.1 Operation Plan

| Operation | Records | Notes |
|---|---:|---|
| raw_products.source_file_id needs handling | 0 | FK is required/Restrict; must choose handling before deleting files. |
| supplier_offers.source_file_id -> NULL | 201 | Preserve offers and products; clear stale source link. |
| price_history old/new source refs -> NULL | 0 | No rows currently affected if 0. |
| files records delete | 258 | Delete stale records after references are handled. |
| not processed (candidate-on-disk) | 3 | Generic names / ambiguous candidates; leave untouched. |

## 3.2 Affected supplier_offers

| File | Offers | Categories | DB Path |
|---|---:|---|---|
| 3.Kyqee Track light（CNY).xls | 151 | 轨道灯: 151 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/室内照明/轨道灯/开启/开启目录和报价/3.Kyqee Track light（CNY).xls |
| 优泽价格产品系列 2023.10.xlsx | 24 | 球泡: 24 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/光源/球泡灯管/优泽/优泽价格产品系列 2023.10.xlsx |
| 中山开启轨道系列报价2021.5.13.xlsx | 17 | 磁吸灯: 17 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/室内照明/磁吸灯/中山开启/中山开启轨道系列报价2021.5.13.xlsx |
| 炬星应急灯管报价单（欧标汇孚林总).xls | 3 | 应急灯: 3 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/光源/球泡灯管/炬星/炬星应急灯管报价单（欧标汇孚林总).xls |
| 东莞弘磊照明科技有限公司报价表--杭州汇孚.xls | 2 | 地埋灯/地插灯: 2 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/户外照明 工业照明/LED 地埋灯地插灯/东莞弘磊照明/东莞弘磊照明科技有限公司报价表--杭州汇孚.xls |
| 二代五星庭院灯AX-FB-TYD garden light20240316.xls | 1 | 庭院灯: 1 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/户外照明 工业照明/户外工厂/艾轩/202404 艾轩/二代五星庭院灯AX-FB-TYD garden light20240316.xls |
| 云霄庭院灯报价.xlsx | 1 | 庭院灯: 1 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/户外照明 工业照明/户外工厂/艾轩/202410/云霄庭院灯报价.xlsx |
| 荣耀庭院灯AX-FB-TYD garden light 20240316.xls | 1 | 庭院灯: 1 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/户外照明 工业照明/户外工厂/艾轩/202404 艾轩/荣耀庭院灯AX-FB-TYD garden light 20240316.xls |
| 菱形庭院灯报价含税-202309.xls | 1 | 庭院灯: 1 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/户外照明 工业照明/户外工厂/艾轩/2023/艾轩 9月更新/庭院灯/菱形庭院灯报价含税-202309.xls |

## 3.3 raw_products Handling

No `raw_products` reference the 258 stale files. No raw_products handling is required before deleting these file records.

## 3.4 price_history Handling

No `price_history` rows reference the 258 stale files.

## 3.5 Verification Expectations For Apply

| Check | Before | After expected |
|---|---:|---:|
| files (My Passport) | 735 | 477 |
| files (total) | 747 | 489 |
| supplier_offers | 2230 | 2230 |
| products | 2140 | 2140 |
| offers with source_file_id | 2230 | 2029 |
| raw_products | 35 | 35 if no raw rows affected; otherwise depends on chosen option |
| product_params | 2755 | 2755 |
| price_history | 0 | 0 |

## Full stale file type summary

| File type | Count |
|---|---:|
| excel | 107 |
| image | 98 |
| pdf | 53 |

## Stop Point

STOP. Review this dry-run report before applying cleanup.


## Apply Result

Applied: 2026-06-11T12:00:50.201Z

| Operation | Count |
|---|---:|
| stale IDs processed | 258 |
| supplier_offers.source_file_id cleared | 201 |
| files deleted | 258 |
| candidate-on-disk rows left untouched | 3 |

### Before / After Verification

| Check | Before | After | Expected |
|---|---:|---:|---:|
| files total | 747 | 489 | 489 |
| files on My Passport | 735 | 477 | 477 |
| stale files still in DB | 258 | 0 | 0 |
| supplier_offers | 2230 | 2230 | 2230 |
| supplier_offers with source_file_id | 2230 | 2029 | 2029 |
| supplier_offers refs to stale files | 201 | 0 | 0 |
| raw_products | 35 | 35 | 35 |
| raw_products refs to stale files | 0 | 0 | 0 |
| products | 2140 | 2140 | 2140 |
| product_params | 2755 | 2755 | 2755 |
| price_history | 0 | 0 | 0 |
| dangling supplier_offers source refs | 0 | 0 | 0 |
| dangling raw_products source refs | 0 | 0 | 0 |
