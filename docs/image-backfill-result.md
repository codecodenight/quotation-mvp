# Image Backfill Result

Generated: 2026-06-09T14:10:17.521Z

## Scope

- Mode: apply
- Source Excel files: read-only
- Apply writes: thumbnail files are stored under data/images/ and products.image_path is updated.
- Matching rule: image anchor row +/- 1 row; short model numbers require exact cell match.

## Summary

| Metric | Count |
|---|---:|
| Total products | 2132 |
| Products with image before | 486 |
| Products without image before | 1646 |
| Source files scanned | 84 |
| Readable files | 84 |
| Missing/unreadable files | 0 |
| Target no-image product links | 1799 |
| Candidate products in those files | 2214 |
| Products with unusable model_no | 0 |
| Extracted images | 3020 |
| Images matched to products | 599 |
| Images not matched | 1504 |
| Products that would receive images | 601 |
| Existing-image matches skipped | 437 |
| Duplicate product matches skipped | 480 |
| Stored thumbnail images | 599 |
| Updated products | 601 |
| Failed image stores | 0 |
| Sheet read failures | 0 |
| File errors | 0 |
| Products with image after | 1087 |
| Products without image after | 1045 |

## Verification

| Check | Result |
|---|---|
| DB backup | `backups/dev-before-image-backfill-20260609-220846.sqlite` |
| `products.image_path IS NOT NULL` before | 486 |
| `products.image_path IS NOT NULL` after | 1,087 |
| Net increase | 601 |
| Sample thumbnail files checked | 5 / 5 exist |
| Visual thumbnail check | PASS: opened `data/images/source/fa13e660-689b-4a83-b2f5-bcc7d355cc41/Sheet1/image3-bafa0d4bef04-thumb.jpg` |

## File Results

| File | Ext | Target products | Images | Matched products | Unmatched images | Skipped existing | Error |
|---|---|---:|---:|---:|---:|---:|---|
| 伊凡格灵LED灯丝灯泡报价2025.xls | .xls | 195 | 229 | 24 | 85 | 120 | - |
| 刘林姐发 核价Wellux led filament bulb 202210.xls | .xls | 169 | 113 | 0 | 113 | 0 | - |
| 3.Kyqee Track light（CNY).xls | .xls | 151 | 131 | 66 | 19 | 46 | - |
| 天启智能2024产品目录报价24.5.13.xlsx1.xlsx | .xlsx | 134 | 144 | 95 | 0 | 51 | - |
| 核价offer-solar floodlight+streetlamp 2023-04-23(2).xlsx | .xlsx | 116 | 52 | 44 | 0 | 8 | - |
| 核价汇总 合力窄压宽压都有 - LED Bulbs - Wellux - 20240527.xlsx | .xlsx | 70 | 30 | 0 | 30 | 0 | - |
| NEW~ CE LED Mirror Light - Welfull 20250819_RMB.xlsx | .xlsx | 63 | 57 | 48 | 3 | 6 | - |
| 核价Offer-Solar Floodlight+Streetlamp 20230410 - 副本.xlsx | .xlsx | 61 | 61 | 4 | 31 | 26 | - |
| 核价 汇总所有筒灯报价 LED Spotlight Quotation -  Wellux - 202308 - 副本.xlsx | .xlsx | 53 | 47 | 12 | 28 | 7 | - |
| SI LI汇盈聚（V20）-35-20-16-15-20MINI磁吸报价2023-01-01.xlsx | .xlsx | 51 | 61 | 1 | 7 | 53 | - |
| 三越三千高端产品报价标20240423.xls | .xls | 32 | 37 | 32 | 0 | 5 | - |
| 2025-06 净化支架灯价格表(含税).xls | .xls | 32 | 19 | 0 | 19 | 0 | - |
| 核价 To DENI - Welfull Quotation - NEW LED Solar Floodlight & Street Light 20240522.xlsx | .xlsx | 31 | 48 | 31 | 1 | 16 | - |
| 核价 Welfull Wellux - Quotation- LED Solar Floodlight & Streetlight 20240516.xlsx | .xlsx | 31 | 48 | 0 | 1 | 47 | - |
| 核价- LINEAR LUMINAIRE - WELLUX 20241107.xls | .xls | 30 | 39 | 28 | 5 | 6 | - |
| 稣赐-壁灯广交会款询价单 20230406.xls | .xls | 27 | 16 | 0 | 16 | 0 | - |
| 核价汇总 空包三防灯 Waterproof Lighting Fixture  - Wellux 202305.xls | .xls | 26 | 147 | 10 | 94 | 43 | - |
| 核算-发价格敏感客户Table lamp - Wellux Lighting 20250423.xlsx | .xlsx | 23 | 32 | 23 | 1 | 8 | - |
| 核价LED Panels - Wellux -202305 刘林姐发 无边框+压铸铝经济款核价.xlsx | .xlsx | 22 | 21 | 5 | 13 | 3 | - |
| 核价 220V LED Strips - Wellux 20251125.xlsx | .xlsx | 21 | 29 | 20 | 1 | 8 | - |
| 核价 非标配置 LED Ceiling Lamp - Wellux - 20241112.xls | .xls | 21 | 38 | 13 | 14 | 11 | - |
| 核价To Ullorja Group - CE 3CCT LED Downlight - Wellux - 20240506.xls | .xls | 20 | 7 | 3 | 2 | 2 | - |
| 核价-2025.12.30 Wellux panel light quotation to enerlux.xlsx | .xlsx | 18 | 11 | 4 | 6 | 1 | - |
| 刘林姐发 - 核价Wellux Quotation of led bulb 20230905.xlsx | .xlsx | 18 | 11 | 7 | 2 | 2 | - |
| 优泽价格产品系列 2023.10.xlsx | .xlsx | 18 | 17 | 1 | 8 | 8 | - |
| To Anas - LED Street Lamp - Wellux 202305.xlsx | .xlsx | 16 | 18 | 6 | 9 | 3 | - |
| 核价汇总 - LED Waterproof Lighting Fixture  - Wellux 202310.xlsx | .xlsx | 15 | 98 | 5 | 92 | 1 | - |
| 核价- Quotation- LED Solar Wall Light & Garden Light - 20240521.xlsx | .xlsx | 15 | 65 | 13 | 39 | 13 | - |
| 核价 一群狼  Plastic LED Downlight - Wellux 202408.xlsx | .xlsx | 15 | 33 | 4 | 21 | 8 | - |
| 核价To Comprodirecto - LED Blubs - Wellux - 20240418.xlsx | .xlsx | 15 | 12 | 0 | 12 | 0 | - |
| 欣柯技21年6月最新报价-应急球泡.xlsx | .xlsx | 15 | 12 | 0 | 0 | 12 | - |
| 核价LED Ceiling Lamp - Wellux - 20230502.xls | .xls | 14 | 88 | 5 | 80 | 3 | - |
| 核价汇总 出非洲工程宽压 LED Waterproof Lighting Fixture  - Wellux 202403.xlsx | .xlsx | 12 | 127 | 9 | 114 | 4 | - |
| 汇孚集团南美球泡订单询价 2023.9.20.xlsx | .xlsx | 12 | 9 | 0 | 0 | 9 | - |
| 汇浮太阳能庭院灯报价单2026年1月22日.xlsx | .xlsx | 12 | 53 | 0 | 53 | 0 | - |
| 核价汇总 过欧标 LED Waterproof Lighting Fixture  - Wellux 202506.xlsx | .xlsx | 11 | 144 | 2 | 129 | 13 | - |
| 核价 LED Linear Light LLS-D - WELLUX 20260624.xlsx | .xlsx | 10 | 9 | 8 | 1 | 0 | - |
| 核价 LED linear light quotation LLS-A - Welfull 20250430 USD.xlsx | .xlsx | 10 | 13 | 7 | 1 | 5 | - |
| 核价LED Waterproof Lighting Fixture  - Wellux 202305 普照 UTQ.xlsx | .xlsx | 9 | 25 | 1 | 23 | 1 | - |
| 核价Wellux Quotation of led panel 20231030 刘林姐发.xlsx | .xlsx | 8 | 20 | 7 | 12 | 1 | - |
| 核价绿晟 F22 To HTF - Eco LED Floodlight LF-I - Wellux - 20251024.xls | .xls | 8 | 3 | 2 | 1 | 0 | - |
| 核价To HTF - LED Ceiling Light - LC-H - Wellux 20250305.xlsx | .xlsx | 8 | 11 | 6 | 5 | 0 | - |
| 支架面环&模组光源--报价表 光极.xls | .xls | 8 | 39 | 0 | 0 | 39 | - |
| 核价  NEW ~ LINEAR LUMINAIRE - WELLUX 202506.xlsx | .xlsx | 7 | 19 | 6 | 7 | 6 | - |
| 核价LED Highbay - Wellux - 20230506 - 副本.xls | .xls | 7 | 53 | 7 | 33 | 13 | - |
| ERP F级&E级 T8 TUBE 更新 -2025.3.25.xlsx | .xlsx | 7 | 0 | 0 | 0 | 0 | - |
| 核价Emergency Charging Tube - Wellux - 20230310.xlsx | .xlsx | 7 | 11 | 0 | 10 | 1 | - |
| 20 size Magic lighting fixture 核价.xlsx | .xlsx | 7 | 25 | 0 | 0 | 25 | - |
| 核价Wellux Quotation of led spotlight 20240229 (1).xlsx | .xlsx | 6 | 11 | 6 | 3 | 2 | - |
| 核价Wellux Quotation of led spotlight 20240229 (1).xlsx | .xlsx | 6 | 11 | 0 | 3 | 8 | - |
| 稣赐花灯核价 LED Ceiling Price - Wellux 20240314.xlsx | .xlsx | 6 | 13 | 6 | 2 | 5 | - |
| 100-265V橄榄灯 2026.5.07 .xls | .xls | 6 | 1 | 0 | 0 | 1 | - |
| 宽板支架-三色拨码调光报价.xlsx | .xlsx | 6 | 2 | 0 | 2 | 0 | - |
| 昭关 宽板支架2025.4.11报价(1).xlsx | .xlsx | 6 | 3 | 0 | 3 | 0 | - |
| (刘林姐发 汇总版本 已瘦身)核价线条灯-linear light wellux quotation -25.4.30 .xlsx | .xlsx | 5 | 70 | 5 | 49 | 16 | - |
| NEW太阳能报价单2024 0719.xls | .xls | 5 | 17 | 0 | 17 | 0 | - |
| Judeng hotselling products RMB 20250214.xlsx | .xlsx | 5 | 108 | 1 | 51 | 56 | - |
| 玲姐发核算- Quotation- Led solar wall lamp- 欣益进户外太阳能壁灯-20240312.xlsx | .xlsx | 4 | 10 | 2 | 1 | 7 | - |
| 核价 LED linear light quotation LLS-A - Welfull 20250430 RMB.xlsx | .xlsx | 4 | 13 | 0 | 4 | 9 | - |
| 核价 中千 To HACHIZAI - Plastic LED Panel - Wellux 20240530 泰国 线性过EMC 工程客户.xlsx | .xlsx | 4 | 13 | 4 | 9 | 0 | - |
| 核价 弘跃款 LED Bulkhead(LB-D) Quotation - Wellux - 20240506.xlsx | .xlsx | 4 | 24 | 4 | 4 | 16 | - |
| To Anas - LED Floodlight - Wellux - 202305.xls | .xls | 4 | 24 | 4 | 20 | 0 | - |
| 汇孚新品庭院小品报价单 2024年10月12日.xls | .xls | 4 | 33 | 0 | 0 | 33 | - |
| 2023年5月灯杯支架和灯杯报价.xlsx | .xlsx | 4 | 4 | 0 | 3 | 1 | - |
| 阿拉丁-7425宽板支架报价单.xlsx | .xlsx | 4 | 5 | 0 | 5 | 0 | - |
| 2026.4.28 皮线灯报价单.xls | .xls | 3 | 93 | 1 | 92 | 0 | - |
| test-multi-column.xlsx | .xlsx | 3 | 0 | 0 | 0 | 0 | - |
| 核价wellux quotation of  led linear fixture 2022.4.8.xls | .xls | 3 | 25 | 3 | 21 | 1 | - |
| 太阳能系列S3 S5.xlsx | .xlsx | 3 | 22 | 0 | 1 | 21 | - |
| 核价Magnetic Track System Round Shape - Wellux 20241126.xlsx | .xlsx | 3 | 27 | 1 | 1 | 25 | - |
| 核价 To Spectrum - Solar Floodlight+Streetlamp - Wellux - 202305.xlsx | .xlsx | 2 | 21 | 0 | 19 | 2 | - |
| 核价LED Big Panel Quotation - Welfull -20240426.xlsx | .xlsx | 2 | 14 | 1 | 11 | 2 | - |
| 炬星应急灯管报价单（欧标汇孚林总).xls | .xls | 2 | 3 | 0 | 2 | 1 | - |
| 中山开启轨道系列报价2021.5.13.xlsx | .xlsx | 2 | 31 | 0 | 6 | 25 | - |
| 户外GU10系列--报价单 光极.xlsx | .xlsx | 2 | 6 | 0 | 0 | 6 | - |
| 360度旋转拆叠轨道灯.xlsx | .xlsx | 2 | 2 | 0 | 0 | 2 | - |
| 核价Smart matter LED bulb-Welfull 20231113.xls | .xls | 1 | 2 | 1 | 1 | 0 | - |
| 荣耀庭院灯AX-FB-TYD garden light 20240316.xls | .xls | 1 | 3 | 1 | 1 | 1 | - |
| 核价- Quotation- LED Solar Wall Light & Garden Light - 20240521.xlsx | .xlsx | 1 | 65 | 0 | 28 | 37 | - |
| 灯丝泡价格 2024.4.14.xlsx | .xlsx | 1 | 5 | 0 | 0 | 5 | - |
| ERP T5 TUBE PRICE-2024.3.21.xlsx | .xlsx | 1 | 0 | 0 | 0 | 0 | - |
| 二代五星庭院灯AX-FB-TYD garden light20240316.xls | .xls | 1 | 2 | 1 | 1 | 0 | - |
| 云霄庭院灯报价.xlsx | .xlsx | 1 | 3 | 1 | 2 | 0 | - |
| 太阳能壁灯2025(X）+(1).xlsx | .xlsx | 1 | 2 | 0 | 1 | 1 | - |

## Top Match Samples

| File | model_no | Row | Matched cell | product_id |
|---|---|---:|---|---|
| 伊凡格灵LED灯丝灯泡报价2025.xls | G95南瓜金色 G95 Pumpkin Golden | 309 | G95南瓜金色 G95 Pumpkin Golden | 45cd45e5-cb13-4565-9406-7053e4709c03 |
| 伊凡格灵LED灯丝灯泡报价2025.xls | G125斜纹金色长灯丝 G95 Twill Golden Long Filament | 355 | G125斜纹金色长灯丝 G95 Twill Golden Long Filament | d10e1c67-6ea7-4c43-a0f8-10e51d3e7356 |
| 伊凡格灵LED灯丝灯泡报价2025.xls | G95长灯丝 G95 Long Filament | 200 | G95长灯丝 G95 Long Filament | 71f80b91-2875-4b47-86fd-faafb0acbec4 |
| 3.Kyqee Track light（CNY).xls | K1221-18 | 22 | K1221-18 | 223a364b-6a7f-4cb7-b8f9-ba1a88bf8741 |
| 3.Kyqee Track light（CNY).xls | K1221-18A | 18 | K1221-18A | d6f40351-4a11-4294-b0e7-d5f9cb65f074 |
| 3.Kyqee Track light（CNY).xls | XRS019A(T)-45W | 100 | XRS019A(T)-45W | 0627912f-7d99-40d1-89eb-104dacbf257b |
| 天启智能2024产品目录报价24.5.13.xlsx1.xlsx | GU10玻璃灯杯平盖 | 6 | GU10玻璃灯杯平盖 | ce54cc2d-8618-4e3a-8db9-3e35b162d0a1 |
| 天启智能2024产品目录报价24.5.13.xlsx1.xlsx | MR16玻璃灯杯 | 3 | MR16玻璃灯杯 | 45bb81f8-0358-4511-af19-9dfa8eead074 |
| 天启智能2024产品目录报价24.5.13.xlsx1.xlsx | GU10玻璃灯杯 透镜 | 9 | GU10玻璃灯杯 透镜 | b68a7bcb-898f-44d5-8a4b-f3df19145a12 |
| 核价offer-solar floodlight+streetlamp 2023-04-23(2).xlsx | SL-S-B-30W | 4 | SL-S-B-30W | 904da581-b1b9-49e4-8b98-ece433105593 |
| 核价offer-solar floodlight+streetlamp 2023-04-23(2).xlsx | SL-S-C-30W | 25 | SL-S-C-30W | 0ee93983-d353-402c-9739-884d4856b7e8 |
| 核价offer-solar floodlight+streetlamp 2023-04-23(2).xlsx | SL-SS-D-60W | 54 | SL-SS-D-60W | d8dddbc3-4b6a-41dd-ac8d-54e39f7c59a3 |
| NEW~ CE LED Mirror Light - Welfull 20250819_RMB.xlsx | LWL-P-600 | 15 | LWL-P-600 | be66b9c8-24df-4b77-8c87-f3492de8090a |
| NEW~ CE LED Mirror Light - Welfull 20250819_RMB.xlsx | LWL-P-450 | 13 | LWL-P-450 | 05876ecb-dc65-4b3f-be98-dd6b7dbbffa3 |
| NEW~ CE LED Mirror Light - Welfull 20250819_RMB.xlsx | LWL-P-70 | 6 | LWL-P-70 | 11fb5db6-5938-4a09-9cbc-0c667f7cfcda |
| 核价Offer-Solar Floodlight+Streetlamp 20230410 - 副本.xlsx | SL-SS-F-300W | 51 | SL-SS-F-300W | d307c843-3179-4d06-bcb2-240fe4a69066 |
| 核价Offer-Solar Floodlight+Streetlamp 20230410 - 副本.xlsx | SL-S-D-200W | 55 | SL-S-D-200W | 35e395f2-5545-4529-9e6c-d4d27a55d772 |
| 核价Offer-Solar Floodlight+Streetlamp 20230410 - 副本.xlsx | SL-SS-F-200W | 50 | SL-SS-F-200W | 4d5f263f-ef37-4992-bd5b-2dffe13129c8 |
| 核价 汇总所有筒灯报价 LED Spotlight Quotation -  Wellux - 202308 - 副本.xlsx | LD-B-GU10-S | 8 | LD-B-GU10-S | 16ab4cc4-a65d-46d8-937c-fdb6abb58b9e |
| 核价 汇总所有筒灯报价 LED Spotlight Quotation -  Wellux - 202308 - 副本.xlsx | LD-B-MR11-R | 5 | LD-B-MR11-R | 337f0209-7bac-4915-bcb5-34add0d821bf |
| 核价 汇总所有筒灯报价 LED Spotlight Quotation -  Wellux - 202308 - 副本.xlsx | LD-B-GU10-R | 11 | LD-B-GU10-R | c1ebd1ea-c2f7-4aae-bf1c-7c39a4b7d334 |
| SI LI汇盈聚（V20）-35-20-16-15-20MINI磁吸报价2023-01-01.xlsx | M20-3-LB6 | 14 | M20-3-LB6 | 5f000217-e781-4d63-a4d3-716c028dd720 |
| 三越三千高端产品报价标20240423.xls | SYJ-027 EXIT | 7 | SYJ-027 EXIT | ed573dfa-0e20-4643-b239-80705249922e |
| 三越三千高端产品报价标20240423.xls | SYJ-208 猫眼双头灯 | 9 | SYJ-208 猫眼双头灯 | 1fb760bd-a03c-4de9-8f9e-4ae076ae2890 |
| 三越三千高端产品报价标20240423.xls | SYJ-018双头灯 | 11 | SYJ-018双头灯 | 66ab7900-021e-4aee-8b59-7ccf607ddf93 |
| 核价 To DENI - Welfull Quotation - NEW LED Solar Floodlight & Street Light 20240522.xlsx | SL-FH-50W | 7 | SL-FH-50W | a6dff276-f2f0-44f5-b888-e7a7cbe39700 |
| 核价 To DENI - Welfull Quotation - NEW LED Solar Floodlight & Street Light 20240522.xlsx | SL-FH-100W | 8 | SL-FH-100W | e32ef4ff-4a54-404d-b1ea-8379f0a4cd9d |
| 核价 To DENI - Welfull Quotation - NEW LED Solar Floodlight & Street Light 20240522.xlsx | SL-FH-150W | 9 | SL-FH-150W | 6933207b-b27a-49d9-909d-3b1308ee6026 |
| 核价- LINEAR LUMINAIRE - WELLUX 20241107.xls | 经济款喷白铁材LED净化灯HS-GT7523F双支灯条 | 14 | 经济款喷白铁材LED净化灯HS-GT7523F双支灯条 | e7aa37a8-a795-4572-a2ad-63867ebfb446 |
| 核价- LINEAR LUMINAIRE - WELLUX 20241107.xls | 100MM宽方形头喷白铁材HS-T32款净化灯4支灯条 | 30 | 100MM宽方形头喷白铁材HS-T32款净化灯4支灯条 | bae053c0-79ec-4984-8edc-2119cbc3aa87 |
| 核价- LINEAR LUMINAIRE - WELLUX 20241107.xls | 三防灯全塑PC防水HS-S55351s椭圆形 | 43 | 三防灯全塑PC防水HS-S55351s椭圆形 | 438ba9af-12e2-46d2-a572-922b777d05b0 |
| 核价汇总 空包三防灯 Waterproof Lighting Fixture  - Wellux 202305.xls | WP-G-206 | 9 | WP-G-206 | b5ccd731-ecc0-4120-8781-e73d0758af07 |
| 核价汇总 空包三防灯 Waterproof Lighting Fixture  - Wellux 202305.xls | WP -H - 212 | 6 | WP -H - 212 | 4d6b5990-ef96-4a21-81f0-a1b789c08d94 |
| 核价汇总 空包三防灯 Waterproof Lighting Fixture  - Wellux 202305.xls | WP-B-215 | 11 | WP-B-215 | cb88865a-024b-4ac3-909d-94832b5cd17d |
| 核算-发价格敏感客户Table lamp - Wellux Lighting 20250423.xlsx | TB-A-04 | 10 | TB-A-04 | 99bdb5ce-57e9-4131-bdd7-cc9d028443b7 |
| 核算-发价格敏感客户Table lamp - Wellux Lighting 20250423.xlsx | TB-B-15 | 31 | TB-B-15 | 623204d7-6b31-4ffb-ae41-11ba25071cad |
| 核算-发价格敏感客户Table lamp - Wellux Lighting 20250423.xlsx | TB-A-08 | 15 | TB-A-08 | b463557d-6733-4ab5-9a5f-5d798ee7d17a |
| 核价LED Panels - Wellux -202305 刘林姐发 无边框+压铸铝经济款核价.xlsx | LPR1-6WR | 7 | LPR1-6WR | cf79743a-7be8-4be7-a383-b52f119e99ce |
| 核价LED Panels - Wellux -202305 刘林姐发 无边框+压铸铝经济款核价.xlsx | LPR1-6WS | 14 | LPR1-6WS | e855d271-f4a1-43ea-9685-1d734e7d7a15 |
| 核价LED Panels - Wellux -202305 刘林姐发 无边框+压铸铝经济款核价.xlsx | LPS1-6WR | 20 | LPS1-6WR | df586123-928a-4f1e-b706-b73c37cba424 |
| 核价 220V LED Strips - Wellux 20251125.xlsx | LST-220V-NW-2835-120P-10 | 7 | LST-220V-NW-2835-120P-10 | 1581b88d-d845-487a-8384-690cab25da7e |
| 核价 220V LED Strips - Wellux 20251125.xlsx | LST-220V-NW-2835-240P-2-10 | 8 | LST-220V-NW-2835-240P-2-10 | 198c824b-fd46-463b-ae5a-7e88ef66c098 |
| 核价 220V LED Strips - Wellux 20251125.xlsx | LST-220V-NW-2835-120P-20 | 9 | LST-220V-NW-2835-120P-20 | 73e2dc45-1999-4302-8a1c-baee16cdd787 |
| 核价 非标配置 LED Ceiling Lamp - Wellux - 20241112.xls | LC-B-12W | 12 | LC-B-12W | c088325e-3264-4491-9a2f-c1d01c79fb2c |
| 核价 非标配置 LED Ceiling Lamp - Wellux - 20241112.xls | LC-C3-12W | 25 | LC-C3-12W | d0f71c6b-3ec5-4a75-a3ba-5a20ed6f8b8d |
| 核价 非标配置 LED Ceiling Lamp - Wellux - 20241112.xls | LC-B-18W | 13 | LC-B-18W | 7978963d-f10f-4284-9cf6-9d168264480e |
| 核价To Ullorja Group - CE 3CCT LED Downlight - Wellux - 20240506.xls | LPR1-3WS | 11 | LPR1-3WS | a669919b-0875-4299-b0ee-083ec8e90966 |
| 核价To Ullorja Group - CE 3CCT LED Downlight - Wellux - 20240506.xls | LPR1-3WR | 5 | LPR1-3WR | 9b070336-1bd1-4db9-9023-754df1943cef |
| 核价To Ullorja Group - CE 3CCT LED Downlight - Wellux - 20240506.xls | LPS1-24WS | 24 | LPS1-24WS | a4ba179d-a4f9-40c0-a400-5ca6e86bdc58 |
| 核价-2025.12.30 Wellux panel light quotation to enerlux.xlsx | LPR7-8WR | 6 | LPR7-8WR | 1673d3f3-af07-4cfa-a2ea-d10c4cb15f19 |
| 核价-2025.12.30 Wellux panel light quotation to enerlux.xlsx | LPR7-8WS | 11 | LPR7-8WS | 1a14fefa-68e6-420f-b1fc-efb584e35259 |
| 核价-2025.12.30 Wellux panel light quotation to enerlux.xlsx | LPS7-12WR | 16 | LPS7-12WR | 4651ff48-1bcc-4a88-9066-2766cde1ceb4 |
| 刘林姐发 - 核价Wellux Quotation of led bulb 20230905.xlsx | GU10-3.3W | 10 | GU10-3.3W | a93ec687-7ea2-43c7-b288-ad09bb5410b9 |
| 刘林姐发 - 核价Wellux Quotation of led bulb 20230905.xlsx | MR16-3W | 13 | MR16-3W | 30775137-0dbb-46b1-96bb-278ece382651 |
| 刘林姐发 - 核价Wellux Quotation of led bulb 20230905.xlsx | PAR20-8W | 19 | PAR20-8W | e4b6b385-a8db-4528-be5c-225e65403e50 |
| 优泽价格产品系列 2023.10.xlsx | R80 10W | 13 | R80 10W | 3e35d258-8a60-4067-9d67-c139d4c921b5 |

## Files With Extracted Images But No Matches

| File | Images | Target products | Note |
|---|---:|---:|---|
| 刘林姐发 核价Wellux led filament bulb 202210.xls | 113 | 169 | 需要检查行锚点与 model_no 距离 |
| 核价汇总 合力窄压宽压都有 - LED Bulbs - Wellux - 20240527.xlsx | 30 | 70 | 需要检查行锚点与 model_no 距离 |
| 2025-06 净化支架灯价格表(含税).xls | 19 | 32 | 需要检查行锚点与 model_no 距离 |
| 核价 Welfull Wellux - Quotation- LED Solar Floodlight & Streetlight 20240516.xlsx | 48 | 31 | 需要检查行锚点与 model_no 距离 |
| 稣赐-壁灯广交会款询价单 20230406.xls | 16 | 27 | 需要检查行锚点与 model_no 距离 |
| 核价To Comprodirecto - LED Blubs - Wellux - 20240418.xlsx | 12 | 15 | 需要检查行锚点与 model_no 距离 |
| 欣柯技21年6月最新报价-应急球泡.xlsx | 12 | 15 | 需要检查行锚点与 model_no 距离 |
| 汇孚集团南美球泡订单询价 2023.9.20.xlsx | 9 | 12 | 需要检查行锚点与 model_no 距离 |
| 汇浮太阳能庭院灯报价单2026年1月22日.xlsx | 53 | 12 | 需要检查行锚点与 model_no 距离 |
| 支架面环&模组光源--报价表 光极.xls | 39 | 8 | 需要检查行锚点与 model_no 距离 |
| 核价Emergency Charging Tube - Wellux - 20230310.xlsx | 11 | 7 | 需要检查行锚点与 model_no 距离 |
| 20 size Magic lighting fixture 核价.xlsx | 25 | 7 | 需要检查行锚点与 model_no 距离 |
| 核价Wellux Quotation of led spotlight 20240229 (1).xlsx | 11 | 6 | 需要检查行锚点与 model_no 距离 |
| 100-265V橄榄灯 2026.5.07 .xls | 1 | 6 | 需要检查行锚点与 model_no 距离 |
| 宽板支架-三色拨码调光报价.xlsx | 2 | 6 | 需要检查行锚点与 model_no 距离 |
| 昭关 宽板支架2025.4.11报价(1).xlsx | 3 | 6 | 需要检查行锚点与 model_no 距离 |
| NEW太阳能报价单2024 0719.xls | 17 | 5 | 需要检查行锚点与 model_no 距离 |
| 核价 LED linear light quotation LLS-A - Welfull 20250430 RMB.xlsx | 13 | 4 | 需要检查行锚点与 model_no 距离 |
| 汇孚新品庭院小品报价单 2024年10月12日.xls | 33 | 4 | 需要检查行锚点与 model_no 距离 |
| 2023年5月灯杯支架和灯杯报价.xlsx | 4 | 4 | 需要检查行锚点与 model_no 距离 |
| 阿拉丁-7425宽板支架报价单.xlsx | 5 | 4 | 需要检查行锚点与 model_no 距离 |
| 太阳能系列S3 S5.xlsx | 22 | 3 | 需要检查行锚点与 model_no 距离 |
| 核价 To Spectrum - Solar Floodlight+Streetlamp - Wellux - 202305.xlsx | 21 | 2 | 需要检查行锚点与 model_no 距离 |
| 炬星应急灯管报价单（欧标汇孚林总).xls | 3 | 2 | 需要检查行锚点与 model_no 距离 |
| 中山开启轨道系列报价2021.5.13.xlsx | 31 | 2 | 需要检查行锚点与 model_no 距离 |
| 户外GU10系列--报价单 光极.xlsx | 6 | 2 | 需要检查行锚点与 model_no 距离 |
| 360度旋转拆叠轨道灯.xlsx | 2 | 2 | 需要检查行锚点与 model_no 距离 |
| 核价- Quotation- LED Solar Wall Light & Garden Light - 20240521.xlsx | 65 | 1 | 需要检查行锚点与 model_no 距离 |
| 灯丝泡价格 2024.4.14.xlsx | 5 | 1 | 需要检查行锚点与 model_no 距离 |
| 太阳能壁灯2025(X）+(1).xlsx | 2 | 1 | 需要检查行锚点与 model_no 距离 |

## Sheet Image Counts For Top Files

- 伊凡格灵LED灯丝灯泡报价2025.xls: 1: 229
- 刘林姐发 核价Wellux led filament bulb 202210.xls: 1: 113
- 3.Kyqee Track light（CNY).xls: 内置&一体化: 58; 调焦&偏光&切光: 28; 特殊外形: 45
- 天启智能2024产品目录报价24.5.13.xlsx1.xlsx: 玻璃灯杯（可用）: 5; 氛围灯系列: 89; 感应灯系列: 50
- 核价offer-solar floodlight+streetlamp 2023-04-23(2).xlsx: Street Lamp: 20; Floodlight: 18; Work light: 4; led light: 10
- 核价汇总 合力窄压宽压都有 - LED Bulbs - Wellux - 20240527.xlsx: Sheet1: 30
- NEW~ CE LED Mirror Light - Welfull 20250819_RMB.xlsx: Plastic LED Mirror Light: 16; Metal LED Mirror Light: 41
- 核价Offer-Solar Floodlight+Streetlamp 20230410 - 副本.xlsx: Solar Products List: 1; Street Lamp: 18; Floodlight: 19; Work light: 4; Garden Lamp 1: 10; Garden Lamp 2: 9
- 核价 汇总所有筒灯报价 LED Spotlight Quotation -  Wellux - 202308 - 副本.xlsx: LD-B CCT: 8; LD-B High end: 9; LD-B2 Middle end: 5; LD-C UGR: 8; LD-C2 UGR: 7; LD-G: 3; LD-H UGR: 3; LD-I: 4
- SI LI汇盈聚（V20）-35-20-16-15-20MINI磁吸报价2023-01-01.xlsx: 35系列灯具: 15; 20系列灯具: 13; 20MINI系列灯具: 12; 16系列灯具: 12; 电源配件: 9
- 三越三千高端产品报价标20240423.xls: Sheet1: 37
- 2025-06 净化支架灯价格表(含税).xls: 经济款弧形H系列成本: 2; 高光效弧形H系列成本: 2; 经济款低功率方形F系列成本: 3; 高功率高光效方形F系列成本: 3; 经济款低功率椭圆T系列成本: 3; 高功率高光效椭圆T系列成本: 3; T5方形支架系列成本: 3
- 核价 To DENI - Welfull Quotation - NEW LED Solar Floodlight & Street Light 20240522.xlsx: Solar Wall Lamp: 48
- 核价 Welfull Wellux - Quotation- LED Solar Floodlight & Streetlight 20240516.xlsx: Solar Wall Lamp: 48
- 核价- LINEAR LUMINAIRE - WELLUX 20241107.xls: 臻森常规款汇总: 24; 南非热销款: 15
- 稣赐-壁灯广交会款询价单 20230406.xls: 第1页: 16
- 核价汇总 空包三防灯 Waterproof Lighting Fixture  - Wellux 202305.xls: WP-G: 33; WP-H: 30; WP-B带灯管: 18; WP-B 空包: 18; WP-D: 20; 普照H款 我们样册上没有 贵 不推荐: 25; Lighting Fixture with LED Tubes: 3
- 核算-发价格敏感客户Table lamp - Wellux Lighting 20250423.xlsx: Decorative table lamp: 32
- 核价LED Panels - Wellux -202305 刘林姐发 无边框+压铸铝经济款核价.xlsx: LED PANEL LP-1: 12; LED PANEL LP-9: 9
- 核价 220V LED Strips - Wellux 20251125.xlsx: LED Strips: 29

## Decision

Apply completed. Review verification below.
