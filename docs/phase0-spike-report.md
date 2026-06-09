# Phase 0 Spike Report: Real Supplier Excel Files

Date: 2026-06-04

Scope: read-only inspection of supplier Excel files. No source files were modified, moved, renamed, or overwritten.

Note: expected directory `sample-data/supplier/` was not present. The available sample files were found in `sample data/`, and this report uses those 5 files.

## Method

- Installed SheetJS from the required CDN tarball:
  `npm install https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`
- Read workbooks with the `xlsx` module.
- Checked sheet names, used ranges, merged cells, visible cell values, likely header rows, and whether prices are stored in cells.
- For `.xlsx` files, also checked workbook package media/drawing entries as a signal for embedded images.

Import percentage below means: estimated percentage of visible product rows that can be imported with simple manual column mapping for the available columns, without semantic parsing of long description text. Missing target fields are explicitly noted.

## Sample Summary

| Metric | Count |
|---|---:|
| Files inspected | 5 |
| `.xlsx` files | 3 |
| `.xls` files | 2 |
| Single-sheet files | 4 |
| Multi-sheet files | 1 |
| Files with embedded images/drawings detected or picture columns | 4 |
| Files with one-product-per-sheet layout | 0 |
| Files with populated cell-based prices | 4 |
| Files with no populated prices in inspected rows | 1 |

Approximate visible product rows:

| File | Approx. product rows | Approx. rows with cell-based prices |
|---|---:|---:|
| `2024 KEBON Suit quotation.xlsx` | 8 | 8 |
| `2026.4.28 皮线灯报价单.xls` | 174 | 174 |
| `5-COBT-3月11日报价单-2025.xls` | 6 | 6 |
| `低压灯带-汇孚-20240805.xlsx` | 25 template/variant rows | 0 |
| `报价单 幻彩cct 和3m RGB 灯条汇孚240222.xlsx` | 2 | 2 |

## Per-File Analysis

### 1. `2024 KEBON Suit quotation.xlsx`

- Format: `.xlsx`
- Sheets: `Sheet1`
- Used range: `A2:IF40`
- Structure:
  - Quotation/invoice layout, not a pure product table.
  - Product table header at row 13.
  - Product rows appear at rows 15-22.
  - Normal rows/columns for the product area, but the workbook has many unused columns in the used range.
  - 22 merged ranges. Merges are mostly title/payment/signature areas, not the main product rows.
  - Embedded media detected: 7 media files and drawing relationships.
  - Not one-product-per-sheet.
- Field locations:
  - Product name: column `B` (`Item No.`), but this is more like product/item description than a dedicated product-name field.
  - Model no.: not clearly separate. Column `B` contains item/product labels such as `led neon-6*12-12V Mixed Silicone`.
  - Price: column `K` (`Unit Price/USD(roll/set)`), values are `￥33.00`, `￥75.00`, etc.
  - MOQ: not found. Column `J` is `Total QTY(roll/set)`, but visible values are blank in product rows.
  - Material: not a separate column. Some material-like text appears inside column `B` or `E`, such as `Mixed Silicone` / `Pure Silicone`.
  - Size: not a separate column. Size-like values appear in column `B`, column `E`, and quantity/length column `F`.
- Problems:
  - Header says `Unit Price/USD`, but price values display RMB symbol `￥`. Currency is uncertain.
  - Product name and model number are not distinct fields.
  - Material and size require text interpretation from item/description columns.
  - Product table starts below invoice metadata, so header-row selection is required.
- Estimated clean import:
  - About `8/8` product rows (`100%`) can import as raw product rows with item label, description, length/quality, voltage, color, and price.
  - If product name, model no., material, size, and MOQ must all be independent mapped columns, clean coverage is much lower because MOQ is absent and material/size are embedded text.
- Not confident:
  - Currency.
  - Whether column `J` is intended as MOQ or only order quantity.
  - Whether column `B` should be treated as product name, model, or both.

### 2. `2026.4.28 皮线灯报价单.xls`

- Format: `.xls`
- Sheets: `合金线`, `1米10珠`, `1米20珠`, `1米40珠`, `草帽灯`, `窗帘灯`, `球泡灯串`, `露营灯`, `霓虹灯`, `氛围灯`, `树星灯`, `吸顶灯`
- Structure:
  - Multi-sheet quotation workbook.
  - Sheets are product categories, not one product per sheet.
  - Most sheets use normal tabular rows with a title row, header row, then product rows.
  - Merged cells exist on many sheets. Most are title rows or picture/parameter blocks.
  - Some rows have blank `参数` because a previous row's merged image/parameter area visually spans multiple rows.
  - Prices are stored in cells.
- Common field locations:
  - `合金线`, `1米10珠`, `1米20珠`, `1米40珠`:
    - Product name: column `B` (`名称`)
    - Model no.: column `C` (`型号`)
    - Price: columns `F` and sometimes `G:H:I` depending on packaging type
    - MOQ: not found
    - Material: not separate; may be embedded in `参数`
    - Size: not separate; may be embedded in `参数`
  - `草帽灯`:
    - Product name: not found as a separate column
    - Model no.: column `A` (`型号`)
    - Price: column `D` (`单价（RMB）`)
    - MOQ: not found
    - Material: not found
    - Size: embedded in column `C` (`参数`)
  - `窗帘灯`, `露营灯`, `霓虹灯`, `氛围灯`, `树星灯`, `吸顶灯`:
    - Product name: not found as a separate column; sheet name gives category
    - Model no.: column `B` (`Item No. 型号`)
    - Price: column `E`, or columns `E:F` for `树星灯`
    - MOQ: not found
    - Material: embedded in column `D` (`Parameter 参数`) on some rows
    - Size: embedded in column `D` (`Parameter 参数`) on some rows
  - `球泡灯串`:
    - Product name: not found as a separate column; sheet name gives category
    - Model no.: column `B`
    - Price: columns `E:H`, one price per bulb type (`S14`, `G40`, `G45`, `C9`)
    - MOQ: not found
    - Material: embedded in column `D`
    - Size: embedded in column `D`
- Problems:
  - Multi-sheet mapping is required because headers differ by sheet.
  - Several sheets have multiple price columns representing packaging/material/bulb-type variants.
  - Product name is absent on many sheets; only model and parameter/category are present.
  - `参数` sometimes contains material, size, power, voltage, bead count, and color in one text field.
  - Merged cells may require fill-down behavior for repeated picture/parameter context.
- Estimated clean import:
  - About `174/174` visible product rows have a model/code and at least one cell-based price.
  - About `108/174` rows have an explicit product-name column (`名称`) in addition to model and price.
  - Estimated clean column-only import: approximately `60-100%`, depending on whether using sheet name/category as product name is allowed. Without that allowance, rows from many category sheets lack product-name columns.
- Not confident:
  - Whether product category from sheet name should be stored as product name, product category, or only source metadata.
  - Whether multiple price columns should become separate supplier offers or variant rows.
  - How to preserve merged parameter context without accidentally copying the wrong text to repeated rows.

### 3. `5-COBT-3月11日报价单-2025.xls`

- Format: `.xls`
- Sheets: `COBT`
- Used range: `A1:L9`
- Structure:
  - Small, regular table.
  - Header at row 3.
  - Product rows at rows 4-9.
  - 1 merged range in title area.
  - No one-product-per-sheet layout.
  - Prices are stored in cells.
- Field locations:
  - Product name: not found as a separate column. Column `B` (`规格`) contains the main specification/code.
  - Model no.: column `B` (`规格`), e.g. `COBT-120-8MM-10CM-免驱`.
  - Price: columns `G` (`价格`), `H` (`含税`), `I` (USD-like value), `J` (`带背胶单价`), `K` (`带背胶 含税`), `L` (USD-like value).
  - MOQ: not found.
  - Material: not found.
  - Size: columns `C` (`板宽`) and `F` (`单元`) contain width/unit size information.
- Problems:
  - Product name is not independent from model/specification.
  - Multiple price columns represent tax/back-adhesive/currency variants.
  - Currency of columns `I` and `L` appears USD due `$`, while other price columns appear RMB; headers do not explicitly label currency.
- Estimated clean import:
  - About `6/6` rows (`100%`) can import as raw rows with specification/model and prices.
  - Full six-field mapping is incomplete because product name, MOQ, and material are absent.
- Not confident:
  - Exact meaning of `$` columns.
  - Whether `规格` should be stored as product name, model no., or both.

### 4. `低压灯带-汇孚-20240805.xlsx`

- Format: `.xlsx`
- Sheets: `Sheet1`
- Used range: `A2:V28`
- Structure:
  - Looks like a quotation request/template rather than a completed supplier quotation.
  - Header at row 2.
  - Rows 3-27 list product/model and quality variants.
  - 11 merged ranges, mostly repeated model cells spanning base/2-year variants.
  - No embedded media/drawing files detected.
  - Not one-product-per-sheet.
- Field locations:
  - Product name: not found as a separate column.
  - Model no.: column `A` (`型号`), with merged/fill-down behavior needed for 2-year variant rows.
  - Price: column `M` (`单价`) and option columns `N:V`, but inspected rows are blank in these price columns.
  - MOQ: not found.
  - Material: column `D` (`板材材质`) exists, but only sparse values were populated in inspected rows.
  - Size: column `C` (`板宽`) exists, but only sparse values were populated in inspected rows.
- Problems:
  - Price columns are present but not filled.
  - Many attributes are blank; merged model cells require fill-down.
  - Some rows are variant rows (`基础款`, `2年款`) rather than standalone products.
- Estimated clean import:
  - `0/25` rows (`0%`) as price-bearing supplier-offer rows because prices are not populated.
  - Some model/attribute rows can be imported as incomplete raw rows, but not as usable quoted products with price.
- Not confident:
  - Whether the blank price cells mean supplier did not quote yet or whether prices exist in hidden/unsupported content. Visible SheetJS cell values for price columns were blank.

### 5. `报价单 幻彩cct 和3m RGB 灯条汇孚240222.xlsx`

- Format: `.xlsx`
- Sheets: `LED lights`
- Used range: `A1:F11`
- Structure:
  - Small table with pictures, item, description, and price.
  - Header is effectively multi-row/merged: row 1 has main headers; row 2 repeats `Item` / `Description`.
  - 6 merged ranges, including picture and price header areas.
  - Embedded media detected: 5 media files and drawing relationships.
  - Product rows at rows 3-4.
  - Not one-product-per-sheet.
- Field locations:
  - Product name: column `B` (`Item`)
  - Model no.: not found.
  - Price: column `D` (`Unit Price`) contains RMB-formatted values like `￥43.60`; column `F` also contains numeric values (`41.7`, `26.6`) without a clear header.
  - MOQ: not found.
  - Material: embedded in column `C` (`Description`) for at least one row, e.g. `PU + Cu`.
  - Size: embedded in column `C` (`Description`), e.g. `3000 x 10 x 2.5mm`.
- Problems:
  - Product rows are few but not fully normalized.
  - Model number is absent.
  - Column `F` has numeric values but no clear visible header from the parsed cells.
  - Material and size are in descriptive text, not independent columns.
- Estimated clean import:
  - About `2/2` rows (`100%`) can import as raw rows with product item, description, and visible price.
  - Full six-field mapping is incomplete because model no. and MOQ are absent, and material/size require text extraction.
- Not confident:
  - Meaning of column `F`.
  - Whether `Item` should be considered product name when there is no separate model.

## Cross-File Observations

- Prices were cell-based in 4 of 5 files. The exception was `低压灯带-汇孚-20240805.xlsx`, where price columns existed but were visibly blank.
- Pictures/media are common, but inspected prices were not image-only in the populated quotation files.
- MOQ was not found as a clear independent column in any inspected file.
- Material and size commonly appear inside long `Description` / `参数` text instead of dedicated columns.
- Product name and model number are often combined or one of them is missing.
- Several files require header-row selection because product tables do not start at row 1.
- Multi-price columns are common and need explicit handling as packaging, tax, currency, material, or bulb-type variants.
- No inspected file used a one-product-per-sheet layout.

No verdict is provided here.
