# Image Backfill Audit

Date: 2026-06-09

Scope: Step 0 only. Read database metadata, check source file accessibility, and sample image extraction. No database updates, no product image writes, and no source Excel modification.

## Summary

| Metric | Result |
|--------|--------|
| Total products | 2,132 |
| Products with image_path | 486 |
| Products without image_path | 1,646 |
| No-image products with source file via supplier_offers | 1,646 |
| No-image products without source file | 0 |
| Distinct source files for no-image products | 84 |
| Source files readable now | 84 / 84 |
| External drive files | 79 files / 1,615 products |
| Local sample-data files | 5 files / 31 products |
| LibreOffice available for .xls conversion | Yes: `/opt/homebrew/bin/soffice` |

Conclusion for Step 0: the backfill is technically feasible. All no-image products can be traced to source Excel files, all source paths are currently readable, and the top 3 largest source files all contain extractable embedded images.

## Format Split

| Format | Source Files | Product Count Notes |
|--------|--------------|---------------------|
| .xlsx | 60 | 897 linked product appearances |
| .xls | 24 | 770 linked product appearances |

Note: linked product appearances can exceed the 1,646 unique no-image products because one product can have supplier offers from more than one source file.

## Source File Accessibility

All 84 source files referenced by no-image products are readable at their stored `absolute_path_snapshot`.

| Volume | Files | Products |
|--------|-------|----------|
| My Passport | 79 | 1,615 |
| local | 5 | 31 |

External drive status: `/Volumes/My Passport/` is mounted and accessible.

## Top Source Files By No-Image Product Count

| # | Source File | Format | Volume | Products |
|---|-------------|--------|--------|----------|
| 1 | 伊凡格灵LED灯丝灯泡报价2025.xls | .xls | My Passport | 195 |
| 2 | 刘林姐发 核价Wellux led filament bulb 202210.xls | .xls | My Passport | 169 |
| 3 | 3.Kyqee Track light（CNY).xls | .xls | My Passport | 151 |
| 4 | 天启智能2024产品目录报价24.5.13.xlsx1.xlsx | .xlsx | My Passport | 134 |
| 5 | 核价offer-solar floodlight+streetlamp 2023-04-23(2).xlsx | .xlsx | My Passport | 116 |
| 6 | 核价汇总 合力窄压宽压都有 - LED Bulbs - Wellux - 20240527.xlsx | .xlsx | My Passport | 70 |
| 7 | NEW~ CE LED Mirror Light - Welfull 20250819_RMB.xlsx | .xlsx | My Passport | 63 |
| 8 | 核价Offer-Solar Floodlight+Streetlamp 20230410 - 副本.xlsx | .xlsx | My Passport | 61 |
| 9 | 核价 汇总所有筒灯报价 LED Spotlight Quotation -  Wellux - 202308 - 副本.xlsx | .xlsx | My Passport | 53 |
| 10 | SI LI汇盈聚（V20）-35-20-16-15-20MINI磁吸报价2023-01-01.xlsx | .xlsx | My Passport | 51 |
| 11 | 三越三千高端产品报价标20240423.xls | .xls | My Passport | 32 |
| 12 | 2025-06 净化支架灯价格表(含税).xls | .xls | My Passport | 32 |
| 13 | 核价 Welfull Wellux - Quotation- LED Solar Floodlight & Streetlight 20240516.xlsx | .xlsx | My Passport | 31 |
| 14 | 核价 To DENI - Welfull Quotation - NEW LED Solar Floodlight & Street Light 20240522.xlsx | .xlsx | My Passport | 31 |
| 15 | 核价- LINEAR LUMINAIRE - WELLUX 20241107.xls | .xls | My Passport | 30 |
| 16 | 稣赐-壁灯广交会款询价单 20230406.xls | .xls | My Passport | 27 |
| 17 | 核价汇总 空包三防灯 Waterproof Lighting Fixture  - Wellux 202305.xls | .xls | My Passport | 26 |
| 18 | 核算-发价格敏感客户Table lamp - Wellux Lighting 20250423.xlsx | .xlsx | My Passport | 23 |
| 19 | 核价LED Panels - Wellux -202305 刘林姐发 无边框+压铸铝经济款核价.xlsx | .xlsx | My Passport | 22 |
| 20 | 核价 非标配置 LED Ceiling Lamp - Wellux - 20241112.xls | .xls | My Passport | 21 |

## Category Distribution For No-Image Products

| Category | No-Image Products |
|----------|-------------------|
| 灯丝灯 | 364 |
| 太阳能 | 161 |
| 轨道灯 | 153 |
| 球泡 | 137 |
| 橱柜灯 | 134 |
| 三防灯 | 73 |
| 面板灯 | 69 |
| 筒灯 | 67 |
| 镜前灯 | 63 |
| 磁吸灯 | 63 |
| 净化灯 | 62 |
| 应急灯 | 56 |
| 吸顶灯 | 49 |
| 线条灯 | 35 |
| 壁灯 | 27 |
| 台灯 | 23 |
| 灯带 | 21 |
| 庭院灯 | 19 |
| 路灯 | 16 |
| 投光灯 | 12 |

## Sample Extraction

Used existing `extractImagesFromExcel()` only. For `.xls` files, the function converted to temporary `.xlsx` through LibreOffice and removed the temp files afterward.

| Source File | Format | Products Without Image | Extracted Images | Sheet Breakdown | Result |
|-------------|--------|------------------------|------------------|-----------------|--------|
| 伊凡格灵LED灯丝灯泡报价2025.xls | .xls | 195 | 229 | `1`: 229 | PASS |
| 刘林姐发 核价Wellux led filament bulb 202210.xls | .xls | 169 | 113 | `1`: 113 | PASS |
| 3.Kyqee Track light（CNY).xls | .xls | 151 | 131 | `内置&一体化`: 58; `调焦&偏光&切光`: 28; `特殊外形`: 45 | PASS |

### Anchor Samples

| Source File | Sample Anchors |
|-------------|----------------|
| 伊凡格灵LED灯丝灯泡报价2025.xls | sheet `1`, rows 185 / 308 / 354 / 517, col 0 |
| 刘林姐发 核价Wellux led filament bulb 202210.xls | sheet `1`, rows 61 / 81 / 109 / 115 / 219 / 220 / 231 / 233, col 0 |
| 3.Kyqee Track light（CNY).xls | sheet `内置&一体化`, rows 7 / 12 / 17 / 21 / 25 / 100, col 3 |

## Risks For Step 1

- `products` has no `source_file_id` or `source_row_index`, so image matching must be inferred from `supplier_offers.source_file_id` plus Excel row content.
- Extracted image `anchorRow` is a drawing anchor, not a guaranteed data row. Matching should search the anchor row plus nearby rows.
- Some files have multiple images anchored to the same row. The script should avoid overwriting existing `image_path` and should keep deterministic first-match behavior.
- Fill-down imports may have several products associated with one visible row or one family image. Sharing one extracted image across same-model variants may be necessary.
- Some source files are customer quotation / 核价 files and may contain family-level images rather than one image per product.

## Step 0 Status

PASS. Stop here and wait for confirmation before Step 1.
