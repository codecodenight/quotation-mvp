# Drive vs Database Diff Report

Generated: 2026-06-11T11:22:00.110Z
Drive root: `/Volumes/My Passport/AI 报价`

## Executive Summary

| Metric | Count |
|---|---:|
| Disk tracked files (.xls/.xlsx/.csv/PDF/images/archives + .xlsm/.xlsb noted) | 5467 |
| Disk files supported by current scanner | 5467 |
| Disk unsupported Excel-like files (.xlsm/.xlsb) | 0 |
| DB files on My Passport | 735 |
| DB files referenced by imports | 85 |
| Exact path + metadata still match | 474 |
| Same path but size/mtime changed | 0 |
| DB path missing but matched elsewhere on disk | 3 |
| DB file missing with no disk match | 258 |
| Disk files not known to DB by path/name/size | 5003 |
| Imported-source risk rows | 9 |
| Scan elapsed | 0.4s |

Interpretation: this report is read-only. No database rows and no source files were modified.

## Excel-Focused Summary

| Metric | Count |
|---|---:|
| Disk Excel files supported by scanner | 1391 |
| DB Excel records on My Passport | 441 |
| New disk Excel files unknown to DB | 1128 |
| DB Excel files missing with no disk match | 107 |
| Imported DB Excel files missing with no disk match | 9 |
| DB Excel paths missing but candidate exists | 0 |

Hidden files and unsupported extensions are intentionally excluded to match the app scanner behavior.

## Disk Inventory By Top Folder

| Top folder | Total | Excel | PDF | Image | Archive | Unsupported Excel |
|---|---:|---:|---:|---:|---:|---:|
| 各家工厂最新报价汇总 | 5226 | 1215 | 617 | 3379 | 15 | 0 |
| 发客户报价单汇总 | 241 | 176 | 36 | 28 | 1 | 0 |

## Highest Priority: Imported Source Files With Path/Content Risk

| Status | File | DB refs | DB path | Disk path / note |
|---|---|---:|---|---|
| db-file-missing-no-match | 3.Kyqee Track light（CNY).xls | 151 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/室内照明/轨道灯/开启/开启目录和报价/3.Kyqee Track light（CNY).xls | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | 东莞弘磊照明科技有限公司报价表--杭州汇孚.xls | 2 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/户外照明 工业照明/LED 地埋灯地插灯/东莞弘磊照明/东莞弘磊照明科技有限公司报价表--杭州汇孚.xls | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | 中山开启轨道系列报价2021.5.13.xlsx | 17 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/室内照明/磁吸灯/中山开启/中山开启轨道系列报价2021.5.13.xlsx | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | 二代五星庭院灯AX-FB-TYD garden light20240316.xls | 1 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/户外照明 工业照明/户外工厂/艾轩/202404 艾轩/二代五星庭院灯AX-FB-TYD garden light20240316.xls | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | 云霄庭院灯报价.xlsx | 1 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/户外照明 工业照明/户外工厂/艾轩/202410/云霄庭院灯报价.xlsx | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | 优泽价格产品系列 2023.10.xlsx | 24 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/光源/球泡灯管/优泽/优泽价格产品系列 2023.10.xlsx | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | 炬星应急灯管报价单（欧标汇孚林总).xls | 3 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/光源/球泡灯管/炬星/炬星应急灯管报价单（欧标汇孚林总).xls | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | 荣耀庭院灯AX-FB-TYD garden light 20240316.xls | 1 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/户外照明 工业照明/户外工厂/艾轩/202404 艾轩/荣耀庭院灯AX-FB-TYD garden light 20240316.xls | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | 菱形庭院灯报价含税-202309.xls | 1 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/户外照明 工业照明/户外工厂/艾轩/2023/艾轩 9月更新/庭院灯/菱形庭院灯报价含税-202309.xls | DB file path is missing and no same filename/size candidate was found on disk. |

## Same Path But File Changed

None.

## DB Paths Missing But A Candidate Exists On Disk

| Status | Severity | File | DB refs | DB path | Disk path / note |
|---|---|---|---:|---|---|
| db-path-missing-candidate-on-disk | medium | 图片1.png | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/虹宇/4种防静电袋/图片1.png | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/户外照明 工业照明/户外工厂/伊特/伊特给 图片和技术资料/伊特泽俊新款太阳能路灯视频/图片1.png ; /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/室内照明/筒灯/极峰/图片1.png ; /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/室内照明/应急灯/应急指示灯/图片1.png |
| db-path-missing-candidate-on-disk | medium | 02.jpg | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/虹宇/画册/无导线高压灯带画册/jpg/02.jpg | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/室内照明/大面板/辰景/工厂图片/Inside photos/02.jpg |
| db-path-missing-candidate-on-disk | medium | Christy-quotation-LED STRIP LIGHT - 202305.pdf | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/虹宇/虹宇202304更新/Christy-quotation-LED STRIP LIGHT - 202305.pdf | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/迪闻/Christy-quotation-LED STRIP LIGHT - 202305.pdf ; /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/跨境产品/灯带套装 东莞迪闻/Christy-quotation-LED STRIP LIGHT - 202305.pdf |

## DB Files Missing With No Match On Disk

| Status | Severity | File | DB refs | DB path | Disk path / note |
|---|---|---|---:|---|---|
| db-file-missing-no-match | low | LED Cabinet Light  E-cataogue - Wellux.pdf | 0 | /Volumes/My Passport/AI 报价/发客户报价单汇总/橱柜灯-天启/LED Cabinet Light  E-cataogue - Wellux.pdf | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | LED Cabinet Light - Wellux - 20230913 - FOB RMB.xlsx | 0 | /Volumes/My Passport/AI 报价/发客户报价单汇总/橱柜灯-天启/LED Cabinet Light - Wellux - 20230913 - FOB RMB.xlsx | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | LED Cabinet Light - Wellux - 20240403 FOB USD.xlsx | 0 | /Volumes/My Passport/AI 报价/发客户报价单汇总/橱柜灯-天启/LED Cabinet Light - Wellux - 20240403 FOB USD.xlsx | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | 1_01.jpg | 0 | /Volumes/My Passport/AI 报价/发客户报价单汇总/橱柜灯-天启/Photos - LED Cabinet Light - Wellux/1_01.jpg | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | 1_06.jpg | 0 | /Volumes/My Passport/AI 报价/发客户报价单汇总/橱柜灯-天启/Photos - LED Cabinet Light - Wellux/1_06.jpg | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | 1_07.jpg | 0 | /Volumes/My Passport/AI 报价/发客户报价单汇总/橱柜灯-天启/Photos - LED Cabinet Light - Wellux/1_07.jpg | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | Photos.jpg | 0 | /Volumes/My Passport/AI 报价/发客户报价单汇总/橱柜灯-天启/Photos - LED Cabinet Light - Wellux/Photos.jpg | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | WL-T001 (1).png | 0 | /Volumes/My Passport/AI 报价/发客户报价单汇总/橱柜灯-天启/Photos - LED Cabinet Light - Wellux/WL-T001 (1).png | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | WL-T001 (2).png | 0 | /Volumes/My Passport/AI 报价/发客户报价单汇总/橱柜灯-天启/Photos - LED Cabinet Light - Wellux/WL-T001 (2).png | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | WL-T015.png | 0 | /Volumes/My Passport/AI 报价/发客户报价单汇总/橱柜灯-天启/Photos - LED Cabinet Light - Wellux/WL-T015.png | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | WL-T038.png | 0 | /Volumes/My Passport/AI 报价/发客户报价单汇总/橱柜灯-天启/Photos - LED Cabinet Light - Wellux/WL-T038.png | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | WL-T042.png | 0 | /Volumes/My Passport/AI 报价/发客户报价单汇总/橱柜灯-天启/Photos - LED Cabinet Light - Wellux/WL-T042.png | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | WL-T048 (1).png | 0 | /Volumes/My Passport/AI 报价/发客户报价单汇总/橱柜灯-天启/Photos - LED Cabinet Light - Wellux/WL-T048 (1).png | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | WL-T048 (2).png | 0 | /Volumes/My Passport/AI 报价/发客户报价单汇总/橱柜灯-天启/Photos - LED Cabinet Light - Wellux/WL-T048 (2).png | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | WL-T048B.png | 0 | /Volumes/My Passport/AI 报价/发客户报价单汇总/橱柜灯-天启/Photos - LED Cabinet Light - Wellux/WL-T048B.png | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | WL-T048C (2).png | 0 | /Volumes/My Passport/AI 报价/发客户报价单汇总/橱柜灯-天启/Photos - LED Cabinet Light - Wellux/WL-T048C (2).png | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | WL-T048C(1).png | 0 | /Volumes/My Passport/AI 报价/发客户报价单汇总/橱柜灯-天启/Photos - LED Cabinet Light - Wellux/WL-T048C(1).png | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | WL-T048D.png | 0 | /Volumes/My Passport/AI 报价/发客户报价单汇总/橱柜灯-天启/Photos - LED Cabinet Light - Wellux/WL-T048D.png | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | WL-T054B.png | 0 | /Volumes/My Passport/AI 报价/发客户报价单汇总/橱柜灯-天启/Photos - LED Cabinet Light - Wellux/WL-T054B.png | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | WL-T081 & T054.png | 0 | /Volumes/My Passport/AI 报价/发客户报价单汇总/橱柜灯-天启/Photos - LED Cabinet Light - Wellux/WL-T081 & T054.png | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | WL-T087.png | 0 | /Volumes/My Passport/AI 报价/发客户报价单汇总/橱柜灯-天启/Photos - LED Cabinet Light - Wellux/WL-T087.png | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | 核价 LED Cabinet Light - Wellux - 20230912.xlsx | 0 | /Volumes/My Passport/AI 报价/发客户报价单汇总/橱柜灯-天启/核价 LED Cabinet Light - Wellux - 20230912.xlsx | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | high | 优泽价格产品系列 2023.10.xlsx | 24 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/光源/球泡灯管/优泽/优泽价格产品系列 2023.10.xlsx | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | high | 炬星应急灯管报价单（欧标汇孚林总).xls | 3 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/光源/球泡灯管/炬星/炬星应急灯管报价单（欧标汇孚林总).xls | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | high | 中山开启轨道系列报价2021.5.13.xlsx | 17 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/室内照明/磁吸灯/中山开启/中山开启轨道系列报价2021.5.13.xlsx | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | high | 3.Kyqee Track light（CNY).xls | 151 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/室内照明/轨道灯/开启/开启目录和报价/3.Kyqee Track light（CNY).xls | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | high | 东莞弘磊照明科技有限公司报价表--杭州汇孚.xls | 2 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/户外照明 工业照明/LED 地埋灯地插灯/东莞弘磊照明/东莞弘磊照明科技有限公司报价表--杭州汇孚.xls | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | high | 菱形庭院灯报价含税-202309.xls | 1 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/户外照明 工业照明/户外工厂/艾轩/2023/艾轩 9月更新/庭院灯/菱形庭院灯报价含税-202309.xls | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | high | 二代五星庭院灯AX-FB-TYD garden light20240316.xls | 1 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/户外照明 工业照明/户外工厂/艾轩/202404 艾轩/二代五星庭院灯AX-FB-TYD garden light20240316.xls | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | high | 荣耀庭院灯AX-FB-TYD garden light 20240316.xls | 1 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/户外照明 工业照明/户外工厂/艾轩/202404 艾轩/荣耀庭院灯AX-FB-TYD garden light 20240316.xls | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | high | 云霄庭院灯报价.xlsx | 1 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/户外照明 工业照明/户外工厂/艾轩/202410/云霄庭院灯报价.xlsx | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | Wellux quotation of multifunction solar led strip 202201013.xlsx | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/中山心杰 太阳能灯带/Wellux quotation of multifunction solar led strip 202201013.xlsx | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | 太阳能灯带5.25.xls | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/中山心杰 太阳能灯带/太阳能灯带5.25.xls | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | 太阳能灯带规格书(1).xls | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/中山心杰 太阳能灯带/太阳能灯带规格书(1).xls | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | 核价wellux quotation of multifunction solar led strip 20220727.xlsx | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/中山心杰 太阳能灯带/核价wellux quotation of multifunction solar led strip 20220727.xlsx | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | COB灯带常规报价2302A 弥影.pdf | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/弥影/COB灯带常规报价2302A 弥影.pdf | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | COB灯带画册 弥影.pdf | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/弥影/COB灯带画册 弥影.pdf | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | To 弥影 - 汇孚集团COB 灯带  202504广交会 更新.xlsx | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/弥影/To 弥影 - 汇孚集团COB 灯带  202504广交会 更新.xlsx | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | To 弥影 - 汇孚集团COB 灯带  202509广交会.xlsx | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/弥影/To 弥影 - 汇孚集团COB 灯带  202509广交会.xlsx | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | 2024 CL LIGHTING - Smart LED light catalog.pdf | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/彩澜/2024 CL LIGHTING - Smart LED light catalog.pdf | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | CL Lighting - LED strip light catalog.pdf | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/彩澜/CL Lighting - LED strip light catalog.pdf | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | COB-Smart-led-strip-kit.pdf | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/彩澜/COB-Smart-led-strip-kit.pdf | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | RGB WIFI+IR music Strip Light Kit.pdf | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/彩澜/RGB WIFI+IR music Strip Light Kit.pdf | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | COB灯带价格-10-10 诚祥电子.xlsx | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/未徕/COB 未徕/COB灯带价格-10-10 诚祥电子.xlsx | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | 明微-未徕COB灯带产品知识2-20230714.pdf | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/未徕/COB 未徕/明微-未徕COB灯带产品知识2-20230714.pdf | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | EN_light_说明书2.pdf | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/灯带说明书/EN_light_说明书2.pdf | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | 2023 HENSAN LIGHTING CATALOG(1)外贸公司画册.pdf | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/画册 各家/2023 HENSAN LIGHTING CATALOG(1)外贸公司画册.pdf | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | DXM512 +SPI.pdf | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/画册 各家/DXM512 +SPI.pdf | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | Feb_2026_A4_US_catalogue_LO_RES_RGB.pdf | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/画册 各家/Feb_2026_A4_US_catalogue_LO_RES_RGB.pdf | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | HL-N0817V24-Cxx.pdf | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/画册 各家/HL-N0817V24-Cxx.pdf | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | LEDVANCE 灯带.pdf | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/画册 各家/LEDVANCE 灯带.pdf | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | LEDYi-CATALOGUE-2023-2024.pdf | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/画册 各家/LEDYi-CATALOGUE-2023-2024.pdf | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | New product 2024 天都.pdf | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/画册 各家/New product 2024 天都.pdf | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | 2024 KEBON Suit quotation.xlsx | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/科邦/2024 KEBON Suit quotation.xlsx | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | 2026全品类画册-CN.pdf | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/科邦/2026全品类画册-CN.pdf | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | 2026全品类画册-EN.pdf | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/科邦/2026全品类画册-EN.pdf | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | KEBON Lighting Catalog 科邦.pdf | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/科邦/KEBON Lighting Catalog 科邦.pdf | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | KEBON Lighting New Product Catalog 科邦.pdf | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/科邦/KEBON Lighting New Product Catalog 科邦.pdf | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | To科邦 汇孚集团 (2) 样品清单.xls | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/科邦/To科邦 汇孚集团 (2) 样品清单.xls | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | 汇孚集团.xls | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/科邦/汇孚集团.xls | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | 科邦全品类画册2023（中）(1).pdf | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/科邦/科邦全品类画册2023（中）(1).pdf | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | 24继续照明-画册.pdf | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/继续照明/24继续照明-画册.pdf | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | 25继续照明（欧美版本）.pdf | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/继续照明/25继续照明（欧美版本）.pdf | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | Decorative LED Strip Set - Wellux 2024-2025.pdf | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/继续照明/Decorative LED Strip Set - Wellux 2024-2025.pdf | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | To 继续  - 汇孚广交会灯带样品清单(1).xlsx | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/继续照明/To 继续  - 汇孚广交会灯带样品清单(1).xlsx | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | 低压灯带-汇孚-20240805(1).xlsx | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/继续照明/低压灯带-汇孚-20240805(1).xlsx | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | 低压灯带-汇孚-20240805.xlsx | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/继续照明/低压灯带-汇孚-20240805.xlsx | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | 继续向上图册.pdf | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/继续照明/继续向上图册.pdf | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | 12V-2835-8MM-120D CCT.jpg | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/继续照明/继续广交会送样/产品图片/产品图片/12V-2835-8MM-120D CCT.jpg | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | 12V-2835-8MM-60D.jpg | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/继续照明/继续广交会送样/产品图片/产品图片/12V-2835-8MM-60D.jpg | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | 12V-5050-RGB-60D.jpg | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/继续照明/继续广交会送样/产品图片/产品图片/12V-5050-RGB-60D.jpg | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | 220V-2835-10MM-240-IC.jpg | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/继续照明/继续广交会送样/产品图片/产品图片/220V-2835-10MM-240-IC.jpg | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | 220V-2835-10MM-240D 单排免驱.jpg | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/继续照明/继续广交会送样/产品图片/产品图片/220V-2835-10MM-240D 单排免驱.jpg | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | 220V-2835-11MM-120D 2line.jpg | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/继续照明/继续广交会送样/产品图片/产品图片/220V-2835-11MM-120D 2line.jpg | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | 220V-2835-6.8MM-120D.jpg | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/继续照明/继续广交会送样/产品图片/产品图片/220V-2835-6.8MM-120D.jpg | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | 220V-2835-8MM-120D-IC.jpg | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/继续照明/继续广交会送样/产品图片/产品图片/220V-2835-8MM-120D-IC.jpg | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | 220V-2835-8MM-120D.jpg | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/继续照明/继续广交会送样/产品图片/产品图片/220V-2835-8MM-120D.jpg | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | 220V-5050-13.5MM-96D.jpg | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/继续照明/继续广交会送样/产品图片/产品图片/220V-5050-13.5MM-96D.jpg | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | 24V-2835-8MM-120D.jpg | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/继续照明/继续广交会送样/产品图片/产品图片/24V-2835-8MM-120D.jpg | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | NEON-RGB幻彩.jpg | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/继续照明/继续广交会送样/产品图片/产品图片/NEON-RGB幻彩.jpg | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | 龙鳞灯带.jpg | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/继续照明/继续广交会送样/产品图片/产品图片/龙鳞灯带.jpg | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | 12V-2835-8-120D-CCT.pdf | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/继续照明/继续广交会送样/测试报告/12V-2835-8-120D-CCT.pdf | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | 12V-2835-8-60D-20R 4000K.pdf | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/继续照明/继续广交会送样/测试报告/12V-2835-8-60D-20R 4000K.pdf | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | 220V-2835-10-240D-10IC.pdf | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/继续照明/继续广交会送样/测试报告/220V-2835-10-240D-10IC.pdf | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | 220V-2835-10-240D-622 单排免驱.pdf | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/继续照明/继续广交会送样/测试报告/220V-2835-10-240D-622 单排免驱.pdf | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | 220V-2835-11-120D-25R NW.pdf | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/继续照明/继续广交会送样/测试报告/220V-2835-11-120D-25R NW.pdf | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | 220V-2835-6.8-120D  6000K.pdf | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/继续照明/继续广交会送样/测试报告/220V-2835-6.8-120D  6000K.pdf | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | 220V-2835-8-120D-10IC.pdf | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/继续照明/继续广交会送样/测试报告/220V-2835-8-120D-10IC.pdf | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | 220V-2835-8-120D-16R 6000K.pdf | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/继续照明/继续广交会送样/测试报告/220V-2835-8-120D-16R 6000K.pdf | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | 220V-5050-13.5-96D-RGB.pdf | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/继续照明/继续广交会送样/测试报告/220V-5050-13.5-96D-RGB.pdf | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | 24V-2835-8-120D-40R 131  24-26lm.pdf | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/继续照明/继续广交会送样/测试报告/24V-2835-8-120D-40R 131  24-26lm.pdf | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | 24V-5050-10-60D-RGB.pdf | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/继续照明/继续广交会送样/测试报告/24V-5050-10-60D-RGB.pdf | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | E-catalog-New罗普来特.pdf | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/罗普来特/E-catalog-New罗普来特.pdf | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | 图片2.png | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/虹宇/4种防静电袋/图片2.png | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | 图片3.png | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/虹宇/4种防静电袋/图片3.png | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | 图片4.png | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/虹宇/4种防静电袋/图片4.png | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | 核价wellux quotation LED STRIP 2020.08.20 刘林姐发.xlsx | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/虹宇/4种防静电袋/核价wellux quotation LED STRIP 2020.08.20 刘林姐发.xlsx | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | HongYu-LED strip-220V-9.1.xls | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/虹宇/HongYu-LED strip-220V-9.1.xls | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | LED strip-220V.xlsx | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/虹宇/LED strip-220V.xlsx | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | 20220529Welfull Inspection report-虹宇照明-LED Light belt-STELLAR-#W1122X007.pdf | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/虹宇/玲姐虹宇下单合同参考/20220529Welfull Inspection report-虹宇照明-LED Light belt-STELLAR-#W1122X007.pdf | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | 20220530Welfull Inspection report-虹宇照明-LED Light .pdf | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/虹宇/玲姐虹宇下单合同参考/20220530Welfull Inspection report-虹宇照明-LED Light .pdf | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | To 虹宇-W1122X007-灯带-急单出迪拜.xls | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/虹宇/玲姐虹宇下单合同参考/To 虹宇-W1122X007-灯带-急单出迪拜.xls | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | To 虹宇-W1122X011-灯带.xls | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/虹宇/玲姐虹宇下单合同参考/To 虹宇-W1122X011-灯带.xls | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | W1122X007 装箱单 5-29.xls | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/虹宇/玲姐虹宇下单合同参考/W1122X007 装箱单 5-29.xls | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | 副本To 华浦- W1124X018- Elmark+Stellar灯带- 下单文件- 20240627.xls | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/虹宇/玲姐虹宇下单合同参考/副本To 华浦- W1124X018- Elmark+Stellar灯带- 下单文件- 20240627.xls | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | 20220530Welfull Inspection report - LED Strips(1).pdf | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/虹宇/玲姐虹宇下单合同参考/发客户 抹掉所有的客户logo/20220530Welfull Inspection report - LED Strips(1).pdf | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | 虹宇-EL 出货数据-梳理8.25.xlsx | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/虹宇/玲姐虹宇下单合同参考/虹宇-EL 出货数据-梳理8.25.xlsx | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | 虹宇-LF22X001.xls | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/虹宇/玲姐虹宇下单合同参考/虹宇-LF22X001.xls | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | 虹宇-LF22X001B.xls | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/虹宇/玲姐虹宇下单合同参考/虹宇-LF22X001B.xls | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | 低压+无导线 灯带系列 画册.pdf | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/虹宇/画册/低压+无导线 灯带系列 画册.pdf | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | 低压+柔性套装画册.pdf | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/虹宇/画册/低压+柔性套装画册.pdf | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | 华浦-COB灯带.pdf | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/虹宇/画册/华浦-COB灯带.pdf | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | 华浦小包装画册.pdf | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/虹宇/画册/华浦小包装画册.pdf | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | 品而亮画册.pdf | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/虹宇/画册/品而亮画册.pdf | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | 太阳能产品.pdf | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/虹宇/画册/太阳能产品.pdf | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | 01-02.jpg | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/虹宇/画册/无导线高压灯带画册/jpg/01-02.jpg | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | 03-04.jpg | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/虹宇/画册/无导线高压灯带画册/jpg/03-04.jpg | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | 05-06.jpg | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/虹宇/画册/无导线高压灯带画册/jpg/05-06.jpg | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | 07-08.jpg | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/虹宇/画册/无导线高压灯带画册/jpg/07-08.jpg | DB file path is missing and no same filename/size candidate was found on disk. |
| db-file-missing-no-match | low | 09-10.jpg | 0 | /Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/虹宇/画册/无导线高压灯带画册/jpg/09-10.jpg | DB file path is missing and no same filename/size candidate was found on disk. |
| ... | ... | ... | ... | ... | 138 more in CSV |

## New Disk Files Unknown To DB

This list is intentionally summarized. Full details are in `docs/drive-db-diff-details.csv`.

| Top folder | Unknown files |
|---|---:|
| 各家工厂最新报价汇总 | 5003 |

### New Unknown Files — Most Recently Modified

| File | Type | Size | Modified | Path |
|---|---|---:|---|---|
| 优博产品报价总表.xlsx | excel | 87762944 | 2026-05-29T10:25:51.960Z | 各家工厂最新报价汇总/室内照明/筒灯/优博/202510/优博产品报价总表.xlsx |
| 防潮灯-报价单-欧诺 202310.xls | excel | 1256448 | 2026-05-29T10:25:44.160Z | 各家工厂最新报价汇总/户外照明 工业照明/防潮灯/欧诺/防潮灯-报价单-欧诺 202310.xls |
| 25年10月汇孚广交会三防灯SMD报价表10.12.xlsx | excel | 31992574 | 2026-05-27T06:56:06.790Z | 各家工厂最新报价汇总/户外照明 工业照明/三防灯/普照/普照2025-10月更新/2025年10月份汇孚广交会报价-三防灯-净化灯/25年10月汇孚广交会三防灯SMD报价表10.12.xlsx |
| 瑞鑫面板灯报价202604.xlsx | excel | 16234 | 2026-05-25T10:07:23.310Z | 各家工厂最新报价汇总/室内照明/大面板/瑞鑫/瑞鑫面板灯报价202604.xlsx |
| 汇孚小徐整理价格-20230921(1).xlsx | excel | 683190 | 2026-05-25T08:43:32.310Z | 各家工厂最新报价汇总/户外照明 工业照明/防潮灯/恒百利/恒百利10月/汇孚小徐整理价格-20230921(1).xlsx |
| 汇总报价单 - A泡  10-13 (1).xlsx | excel | 40566 | 2026-05-22T08:38:42.620Z | 各家工厂最新报价汇总/光源/球泡灯管/合力/202410/汇总报价单 - A泡  10-13 (1).xlsx |
| 上格样册2022.pdf | pdf | 34259772 | 2026-05-22T07:40:08.620Z | 各家工厂最新报价汇总/光源/球泡灯管/上格/上格样册2022.pdf |
| 核价LED Filament Bulb Quotation-Wellux-2021-12-17.xlsx | excel | 8376352 | 2026-05-22T06:40:08.380Z | 各家工厂最新报价汇总/光源/灯丝灯/德雷普/核价LED Filament Bulb Quotation-Wellux-2021-12-17.xlsx |
| 产品目录-价格-2024.4.14.xlsx | excel | 68301045 | 2026-05-21T07:16:47.200Z | 各家工厂最新报价汇总/光源/球泡灯管/合力/202404/产品目录-价格-2024.4.14.xlsx |
| LED Highbay Driver Quation 2025T.xlsx | excel | 849778 | 2026-05-19T10:24:31.720Z | 各家工厂最新报价汇总/户外照明 工业照明/户外工厂/工矿灯-隆景/2025年10月/LED Highbay Driver Quation 2025T.xlsx |
| LED Grden Quation 2026T(含税）.xlsx | excel | 308227 | 2026-05-19T10:24:25.100Z | 各家工厂最新报价汇总/户外照明 工业照明/户外工厂/工矿灯-隆景/2025年10月/庭院灯 市电/LED Grden Quation 2026T(含税）.xlsx |
| Datasheet SL-S-K (TR-R1).pdf | pdf | 8471420 | 2026-05-18T08:42:21.730Z | 各家工厂最新报价汇总/户外照明 工业照明/户外工厂/凯晟德/202605/TR-R1 一体路灯/Datasheet SL-S-K (TR-R1).pdf |
| LED Street Light Quation 2025T.xlsx | excel | 1262761 | 2026-05-18T07:02:12.160Z | 各家工厂最新报价汇总/户外照明 工业照明/户外工厂/工矿灯-隆景/2025年10月/LED Street Light Quation 2025T.xlsx |
| 300W.pdf | pdf | 6800926 | 2026-05-15T05:54:31.130Z | 各家工厂最新报价汇总/户外照明 工业照明/户外工厂/凯晟德/202605/TR-R1 一体路灯/TR-R1透镜/300/300W.pdf |
| T8三防灯报价表-汇孚.xlsx | excel | 12249341 | 2026-05-14T09:16:07.880Z | 各家工厂最新报价汇总/户外照明 工业照明/三防灯/普照/普照2026-4月更新 /T8三防灯报价表-汇孚.xlsx |
| 200W (4)大.jpeg | image | 118375 | 2026-05-14T06:08:11.840Z | 各家工厂最新报价汇总/户外照明 工业照明/户外工厂/伊特/2026/新品太阳能路灯报价 /200/200W (4)大.jpeg |
| 200W (1)大.jpeg | image | 140970 | 2026-05-14T06:08:10.400Z | 各家工厂最新报价汇总/户外照明 工业照明/户外工厂/伊特/2026/新品太阳能路灯报价 /200/200W (1)大.jpeg |
| 200W (1) 拷贝大.jpeg | image | 152705 | 2026-05-14T06:08:09.220Z | 各家工厂最新报价汇总/户外照明 工业照明/户外工厂/伊特/2026/新品太阳能路灯报价 /200/200W (1) 拷贝大.jpeg |
| 200W (2)大.jpeg | image | 122969 | 2026-05-14T06:08:07.860Z | 各家工厂最新报价汇总/户外照明 工业照明/户外工厂/伊特/2026/新品太阳能路灯报价 /200/200W (2)大.jpeg |
| 200W组合大.jpeg | image | 207320 | 2026-05-14T06:08:06.080Z | 各家工厂最新报价汇总/户外照明 工业照明/户外工厂/伊特/2026/新品太阳能路灯报价 /200/200W组合大.jpeg |
| 100W (1)大.jpeg | image | 108865 | 2026-05-14T06:07:32.000Z | 各家工厂最新报价汇总/户外照明 工业照明/户外工厂/伊特/2026/新品太阳能路灯报价 /100/100W (1)大.jpeg |
| 100W (2)大.jpeg | image | 106816 | 2026-05-14T06:07:30.570Z | 各家工厂最新报价汇总/户外照明 工业照明/户外工厂/伊特/2026/新品太阳能路灯报价 /100/100W (2)大.jpeg |
| 100W (3)大.jpeg | image | 131313 | 2026-05-14T06:07:29.100Z | 各家工厂最新报价汇总/户外照明 工业照明/户外工厂/伊特/2026/新品太阳能路灯报价 /100/100W (3)大.jpeg |
| 100W组合大.jpeg | image | 198863 | 2026-05-14T06:07:27.580Z | 各家工厂最新报价汇总/户外照明 工业照明/户外工厂/伊特/2026/新品太阳能路灯报价 /100/100W组合大.jpeg |
| 2026年杰莱特产品报价 极致六代太阳能路灯 (1).xlsx | excel | 2447831 | 2026-05-14T02:16:49.810Z | 各家工厂最新报价汇总/户外照明 工业照明/户外工厂/伊特/2026/新品太阳能路灯报价 /2026年杰莱特产品报价 极致六代太阳能路灯 (1).xlsx |
| 5.13 LD26产品报价-含税.xlsx | excel | 3284502 | 2026-05-14T02:16:47.610Z | 各家工厂最新报价汇总/户外照明 工业照明/户外工厂/伊特/2026/新品太阳能路灯报价 /5.13 LD26产品报价-含税.xlsx |
| TR- R1 Qoutation to 20260512(1).xlsx | excel | 5126810 | 2026-05-13T10:03:03.870Z | 各家工厂最新报价汇总/户外照明 工业照明/户外工厂/凯晟德/202605/TR-R1 一体路灯/TR- R1 Qoutation to 20260512(1).xlsx |
| 汇浮太阳能路灯报价单2026年3月30日(1).xlsx | excel | 5739735 | 2026-05-13T09:46:39.130Z | 各家工厂最新报价汇总/户外照明 工业照明/户外工厂/中千/202601/汇浮太阳能路灯报价单2026年3月30日(1).xlsx |
| 微信图片_20260513101917_5_426.jpg | image | 155652 | 2026-05-13T02:21:54.170Z | 各家工厂最新报价汇总/户外照明 工业照明/户外工厂/凯晟德/202605/TR-R1 一体路灯/微信图片_20260513101917_5_426.jpg |
| 微信图片_20260513101913_4_426.jpg | image | 511755 | 2026-05-13T02:21:54.160Z | 各家工厂最新报价汇总/户外照明 工业照明/户外工厂/凯晟德/202605/TR-R1 一体路灯/微信图片_20260513101913_4_426.jpg |
| 微信图片_20260513101921_6_426.jpg | image | 149371 | 2026-05-13T02:21:54.160Z | 各家工厂最新报价汇总/户外照明 工业照明/户外工厂/凯晟德/202605/TR-R1 一体路灯/微信图片_20260513101921_6_426.jpg |
| 微信图片_20260513101933_8_426.jpg | image | 124302 | 2026-05-13T02:21:54.140Z | 各家工厂最新报价汇总/户外照明 工业照明/户外工厂/凯晟德/202605/TR-R1 一体路灯/微信图片_20260513101933_8_426.jpg |
| 微信图片_20260513101926_7_426.jpg | image | 103081 | 2026-05-13T02:21:54.110Z | 各家工厂最新报价汇总/户外照明 工业照明/户外工厂/凯晟德/202605/TR-R1 一体路灯/微信图片_20260513101926_7_426.jpg |
| 微信图片_20260513101941_9_426.jpg | image | 167978 | 2026-05-13T02:21:54.110Z | 各家工厂最新报价汇总/户外照明 工业照明/户外工厂/凯晟德/202605/TR-R1 一体路灯/微信图片_20260513101941_9_426.jpg |
| 微信图片_20260513101906_3_426.jpg | image | 143461 | 2026-05-13T02:21:54.100Z | 各家工厂最新报价汇总/户外照明 工业照明/户外工厂/凯晟德/202605/TR-R1 一体路灯/微信图片_20260513101906_3_426.jpg |
| 锐晶照明商超系列，线条灯2026系列价格表.xlsx | excel | 4907907 | 2026-05-12T09:58:53.880Z | 各家工厂最新报价汇总/室内照明/线条灯办公灯/锐晶/2026-3/锐晶照明商超系列，线条灯2026系列价格表.xlsx |
| High Sky Mirror Quotation- Wellux Lighting 20260512.xlsx | excel | 47507381 | 2026-05-12T09:51:20.930Z | 各家工厂最新报价汇总/室内照明/吸顶灯/伊明特/2026/天境灯 /High Sky Mirror Quotation- Wellux Lighting 20260512.xlsx |
| 核价LED Ceiling Lamp Quotation - Wellux Lighting 20260512.xlsx | excel | 9478135 | 2026-05-12T09:50:12.720Z | 各家工厂最新报价汇总/室内照明/吸顶灯/伊明特/2026/核价LED Ceiling Lamp Quotation - Wellux Lighting 20260512.xlsx |
| 核价 High Sky Mirror Quotation- Wellux Lighting 20260512.xlsx | excel | 47508034 | 2026-05-12T09:50:08.160Z | 各家工厂最新报价汇总/室内照明/吸顶灯/伊明特/2026/天境灯 /核价 High Sky Mirror Quotation- Wellux Lighting 20260512.xlsx |
| 20260407 High Sky Mirror Quotation.xlsx | excel | 47560090 | 2026-05-12T09:44:33.610Z | 各家工厂最新报价汇总/室内照明/吸顶灯/伊明特/2026/天境灯 /20260407 High Sky Mirror Quotation.xlsx |
| LED Ceiling Lamp Quotation - Wellux Lighting 20260512.xlsx | excel | 9476062 | 2026-05-12T09:39:33.670Z | 各家工厂最新报价汇总/室内照明/吸顶灯/伊明特/2026/LED Ceiling Lamp Quotation - Wellux Lighting 20260512.xlsx |
| 核价 LED  ceiling Lamp  Wellux Lighting  20251126.xlsx | excel | 32702097 | 2026-05-12T09:38:11.960Z | 各家工厂最新报价汇总/室内照明/吸顶灯/伊明特/核价 LED  ceiling Lamp  Wellux Lighting  20251126.xlsx |
| Frameless LED Big Panel - Wellux RMB 20260512.xlsx | excel | 1195165 | 2026-05-12T08:07:49.460Z | 各家工厂最新报价汇总/室内照明/大面板/新时达/二代欧洲款 无边框/刘林姐发-核价单/Frameless LED Big Panel - Wellux RMB 20260512.xlsx |
| 乐道国内客户最新报价表xls(2026.3.13).xls | excel | 13144576 | 2026-05-12T07:48:24.480Z | 各家工厂最新报价汇总/户外照明 工业照明/净化灯/乐道/202603/乐道国内客户最新报价表xls(2026.3.13).xls |
| 欧标铁皮款线条灯2605508.xlsx | excel | 190182 | 2026-05-12T07:32:36.200Z | 各家工厂最新报价汇总/室内照明/线条灯办公灯/瑞鑫/欧标铁皮款线条灯2605508.xlsx |
| 26V1-2瑞鑫线条灯价格202604.xlsx | excel | 7525959 | 2026-05-12T07:30:56.700Z | 各家工厂最新报价汇总/室内照明/线条灯办公灯/瑞鑫/26V1-2瑞鑫线条灯价格202604.xlsx |
| 核算-Frameless LED Big Panel - Wellux 20240813.xlsx | excel | 1212610 | 2026-05-12T06:57:14.560Z | 各家工厂最新报价汇总/室内照明/大面板/新时达/二代欧洲款 无边框/刘林姐发-核价单/核算-Frameless LED Big Panel - Wellux 20240813.xlsx |
| 太阳能系列2026-4-15.pdf | pdf | 19533488 | 2026-05-11T09:50:17.880Z | 各家工厂最新报价汇总/户外照明 工业照明/户外工厂/花牌/太阳能系列2026-4-15.pdf |
| T泡各系列  汇总报价单-2024.10.13   .xlsx | excel | 53385 | 2026-05-08T12:15:53.290Z | 各家工厂最新报价汇总/光源/球泡灯管/合力/202410/T泡各系列  汇总报价单-2024.10.13   .xlsx |
| T泡 价格表 2024.03.29.xlsx | excel | 24804111 | 2026-05-08T12:15:51.450Z | 各家工厂最新报价汇总/光源/球泡灯管/合力/202404/T泡 价格表 2024.03.29.xlsx |
| 上格ED玉兰花灯报价单出南美(1)202605.xlsx | excel | 72358 | 2026-05-08T11:22:27.350Z | 各家工厂最新报价汇总/光源/球泡灯管/上格/上格ED玉兰花灯报价单出南美(1)202605.xlsx |
| 经济5075不可拼接线条灯 25-10.xlsx | excel | 839303 | 2026-05-08T10:58:32.800Z | 各家工厂最新报价汇总/室内照明/线条灯办公灯/瑞鑫/经济5075不可拼接线条灯 25-10.xlsx |
| 防潮灯 2026.xlsx | excel | 497297 | 2026-05-08T09:09:04.420Z | 各家工厂最新报价汇总/户外照明 工业照明/防潮灯/弘跃/防潮灯 2026.xlsx |
| HP-B2报价-汇孚.xlsx | excel | 7129445 | 2026-05-08T08:45:21.450Z | 各家工厂最新报价汇总/户外照明 工业照明/三防灯/普照/普照2026-4月更新 /HP-B2报价-汇孚.xlsx |
| 三防灯2025.3.26-昭关报价.xlsx | excel | 522665 | 2026-05-08T08:30:06.260Z | 各家工厂最新报价汇总/户外照明 工业照明/三防灯/恒百利/202504更新/三防灯2025.3.26-昭关报价.xlsx |
| 防潮灯2024RMB(202404.xlsx | excel | 235337 | 2026-05-06T08:21:59.890Z | 各家工厂最新报价汇总/户外照明 工业照明/防潮灯/弘跃/防潮灯2024RMB(202404.xlsx |
| 三防灯SMD报价表-汇孚.xlsx | excel | 821257 | 2026-05-06T08:19:30.410Z | 各家工厂最新报价汇总/户外照明 工业照明/三防灯/普照/普照2026-4月更新 /三防灯SMD报价表-汇孚.xlsx |
| 副本碧利常规款Price List-Panel Light - RMB _宽压和窄压价格都有 202604.xls | excel | 146944 | 2026-05-06T07:08:16.540Z | 各家工厂最新报价汇总/室内照明/小面板灯/三赢/副本碧利常规款Price List-Panel Light - RMB _宽压和窄压价格都有 202604.xls |
| 瑞鑫底发光-20230322.xls | excel | 20480 | 2026-05-06T06:40:31.330Z | 各家工厂最新报价汇总/室内照明/大面板/瑞鑫/瑞鑫底发光-20230322.xls |
| 宏硕净化灯报价2025.4 (2).xlsx | excel | 4272893 | 2026-05-06T06:17:10.900Z | 各家工厂最新报价汇总/户外照明 工业照明/净化灯/宏硕/宏硕净化灯报价2025.4 (2).xlsx |
| 宏硕T5T8净化灯价宽压格表2026.03.19.xlsx | excel | 8339170 | 2026-05-06T06:17:03.880Z | 各家工厂最新报价汇总/户外照明 工业照明/净化灯/宏硕/宏硕T5T8净化灯价宽压格表2026.03.19.xlsx |
| 宏硕T5T8净化灯220V价格表2026.03.19.xlsx | excel | 8428327 | 2026-05-06T06:08:18.680Z | 各家工厂最新报价汇总/户外照明 工业照明/净化灯/宏硕/宏硕T5T8净化灯220V价格表2026.03.19.xlsx |
| 三赢无边框和压铸铝小面板-20240411.xls | excel | 11230208 | 2026-05-06T03:09:37.570Z | 各家工厂最新报价汇总/室内照明/小面板灯/三赢/2024价格/三赢无边框和压铸铝小面板-20240411.xls |
| 碧利常规款 Price List-Panel Light - RMB  202604价格.xls | excel | 149504 | 2026-05-06T03:07:32.830Z | 各家工厂最新报价汇总/室内照明/小面板灯/三赢/碧利常规款 Price List-Panel Light - RMB  202604价格.xls |
| 6319fbbf0d355d96ec8595bac8292058.png | image | 3387654 | 2026-05-05T09:12:58.000Z | 各家工厂最新报价汇总/户外照明 工业照明/户外工厂/凯晟德/202605/TR-R1 一体路灯/反光杯高清图/500/6319fbbf0d355d96ec8595bac8292058.png |
| 3933c53c69752c86bd155290a958bf8c.png | image | 3647944 | 2026-05-05T09:12:51.000Z | 各家工厂最新报价汇总/户外照明 工业照明/户外工厂/凯晟德/202605/TR-R1 一体路灯/反光杯高清图/400/3933c53c69752c86bd155290a958bf8c.png |
| b51b86f8e89be9ff253aae5a866793bd.png | image | 3331695 | 2026-05-05T09:12:25.000Z | 各家工厂最新报价汇总/户外照明 工业照明/户外工厂/凯晟德/202605/TR-R1 一体路灯/反光杯高清图/200/b51b86f8e89be9ff253aae5a866793bd.png |
| 25557752f0503b91cf18d9c875af9c8f.png | image | 3456885 | 2026-05-05T09:12:16.000Z | 各家工厂最新报价汇总/户外照明 工业照明/户外工厂/凯晟德/202605/TR-R1 一体路灯/反光杯高清图/100/25557752f0503b91cf18d9c875af9c8f.png |
| 4d3f601124485e62601237b8ebe11da9.jpg | image | 41554 | 2026-05-05T09:11:58.000Z | 各家工厂最新报价汇总/户外照明 工业照明/户外工厂/凯晟德/202605/TR-R1 一体路灯/反光杯高清图/100/4d3f601124485e62601237b8ebe11da9.jpg |
| 3933c53c69752c86bd155290a958bf8c.png | image | 3647944 | 2026-05-05T09:01:18.000Z | 各家工厂最新报价汇总/户外照明 工业照明/户外工厂/凯晟德/202605/TR-R1 一体路灯/反光杯高清图/300/3933c53c69752c86bd155290a958bf8c.png |
| 60f2899c31a3fa998ca690c446c2cd6c的副本.jpg | image | 45193 | 2026-05-05T06:17:13.000Z | 各家工厂最新报价汇总/户外照明 工业照明/户外工厂/凯晟德/202605/TR-R1 一体路灯/反光杯高清图/100/60f2899c31a3fa998ca690c446c2cd6c的副本.jpg |
| 60f2899c31a3fa998ca690c446c2cd6c的副本2.jpg | image | 45193 | 2026-05-05T06:17:13.000Z | 各家工厂最新报价汇总/户外照明 工业照明/户外工厂/凯晟德/202605/TR-R1 一体路灯/反光杯高清图/200/60f2899c31a3fa998ca690c446c2cd6c的副本2.jpg |
| 60f2899c31a3fa998ca690c446c2cd6c.jpg | image | 45193 | 2026-05-05T06:17:13.000Z | 各家工厂最新报价汇总/户外照明 工业照明/户外工厂/凯晟德/202605/TR-R1 一体路灯/反光杯高清图/300/60f2899c31a3fa998ca690c446c2cd6c.jpg |
| 60f2899c31a3fa998ca690c446c2cd6c的副本4.jpg | image | 45193 | 2026-05-05T06:17:13.000Z | 各家工厂最新报价汇总/户外照明 工业照明/户外工厂/凯晟德/202605/TR-R1 一体路灯/反光杯高清图/400/60f2899c31a3fa998ca690c446c2cd6c的副本4.jpg |
| 60f2899c31a3fa998ca690c446c2cd6c的副本3.jpg | image | 45193 | 2026-05-05T06:17:13.000Z | 各家工厂最新报价汇总/户外照明 工业照明/户外工厂/凯晟德/202605/TR-R1 一体路灯/反光杯高清图/500/60f2899c31a3fa998ca690c446c2cd6c的副本3.jpg |
| 50W-7.png | image | 3592988 | 2026-05-05T06:14:33.000Z | 各家工厂最新报价汇总/户外照明 工业照明/户外工厂/凯晟德/202605/TR-R1 一体路灯/反光杯高清图/100/50W-7.png |
| 灯杆的副本.png | image | 1969872 | 2026-05-05T06:13:07.000Z | 各家工厂最新报价汇总/户外照明 工业照明/户外工厂/凯晟德/202605/TR-R1 一体路灯/反光杯高清图/200/灯杆的副本.png |
| 灯杆的副本.png | image | 1969872 | 2026-05-05T06:13:07.000Z | 各家工厂最新报价汇总/户外照明 工业照明/户外工厂/凯晟德/202605/TR-R1 一体路灯/反光杯高清图/300/灯杆的副本.png |
| 灯杆的副本.png | image | 1969872 | 2026-05-05T06:13:07.000Z | 各家工厂最新报价汇总/户外照明 工业照明/户外工厂/凯晟德/202605/TR-R1 一体路灯/反光杯高清图/400/灯杆的副本.png |
| 灯杆的副本2.png | image | 1969872 | 2026-05-05T06:13:07.000Z | 各家工厂最新报价汇总/户外照明 工业照明/户外工厂/凯晟德/202605/TR-R1 一体路灯/反光杯高清图/500/灯杆的副本2.png |
| 2026.04常规款压铸铝拨码三色面板灯产品参数报价汇总表(含税).xlsx | excel | 1077130 | 2026-04-30T09:24:43.590Z | 各家工厂最新报价汇总/室内照明/小面板灯/一群狼/2026年4月/2026.04常规款压铸铝拨码三色面板灯产品参数报价汇总表(含税).xlsx |
| 25年10月汇孚广交会双色管报价表25.10.13.xlsx.xlsx | excel | 29194237 | 2026-04-30T09:10:31.800Z | 各家工厂最新报价汇总/户外照明 工业照明/三防灯/普照/普照2025-10月更新/2025年10月份汇孚广交会报价-三防灯-净化灯/25年10月汇孚广交会双色管报价表25.10.13.xlsx.xlsx |
| 2024-11-6   臻森成品报价表 南美常规款.xlsx | excel | 10074499 | 2026-04-30T08:50:48.130Z | 各家工厂最新报价汇总/户外照明 工业照明/净化灯/臻森 净化灯/2024-11-6   臻森成品报价表 南美常规款.xlsx |
| 2023-12-4HS常规项净化支架灯成品报价表(1).xlsx | excel | 10335187 | 2026-04-30T08:50:44.460Z | 各家工厂最新报价汇总/户外照明 工业照明/净化灯/臻森 净化灯/2023-12-4HS常规项净化支架灯成品报价表(1).xlsx |
| 25年10月汇孚广交会净化灯SMD报价表10.12.xlsx.xlsx | excel | 4741639 | 2026-04-30T08:28:24.230Z | 各家工厂最新报价汇总/户外照明 工业照明/三防灯/普照/普照2025-10月更新/2025年10月份汇孚广交会报价-三防灯-净化灯/25年10月汇孚广交会净化灯SMD报价表10.12.xlsx.xlsx |
| 500W-7.png | image | 4806340 | 2026-04-30T06:55:01.000Z | 各家工厂最新报价汇总/户外照明 工业照明/户外工厂/凯晟德/202605/TR-R1 一体路灯/TR-R1透镜/500/500W-7.png |
| 500w-1.png | image | 3511184 | 2026-04-30T06:46:07.000Z | 各家工厂最新报价汇总/户外照明 工业照明/户外工厂/凯晟德/202605/TR-R1 一体路灯/TR-R1透镜/500/500w-1.png |
| 400W-7.png | image | 4102546 | 2026-04-30T06:45:18.000Z | 各家工厂最新报价汇总/户外照明 工业照明/户外工厂/凯晟德/202605/TR-R1 一体路灯/TR-R1透镜/400/400W-7.png |
| 50w-1.png | image | 4265604 | 2026-04-30T06:44:55.000Z | 各家工厂最新报价汇总/户外照明 工业照明/户外工厂/凯晟德/202605/TR-R1 一体路灯/TR-R1透镜/100/50w-1.png |
| 50W-7.png | image | 4357829 | 2026-04-30T06:44:35.000Z | 各家工厂最新报价汇总/户外照明 工业照明/户外工厂/凯晟德/202605/TR-R1 一体路灯/TR-R1透镜/100/50W-7.png |
| 200w-1.png | image | 4089663 | 2026-04-30T06:43:50.000Z | 各家工厂最新报价汇总/户外照明 工业照明/户外工厂/凯晟德/202605/TR-R1 一体路灯/TR-R1透镜/200/200w-1.png |
| 200W-7.png | image | 3638764 | 2026-04-30T06:43:28.000Z | 各家工厂最新报价汇总/户外照明 工业照明/户外工厂/凯晟德/202605/TR-R1 一体路灯/TR-R1透镜/200/200W-7.png |
| 400w-1.png | image | 4471296 | 2026-04-30T06:43:07.000Z | 各家工厂最新报价汇总/户外照明 工业照明/户外工厂/凯晟德/202605/TR-R1 一体路灯/TR-R1透镜/400/400w-1.png |
| 500w-3.png | image | 1955644 | 2026-04-30T06:41:32.000Z | 各家工厂最新报价汇总/户外照明 工业照明/户外工厂/凯晟德/202605/TR-R1 一体路灯/反光杯高清图/500/500w-3.png |
| 500w-3.png | image | 1955644 | 2026-04-30T06:41:32.000Z | 各家工厂最新报价汇总/户外照明 工业照明/户外工厂/凯晟德/202605/TR-R1 一体路灯/TR-R1透镜/500/500w-3.png |
| 500w-4.png | image | 2116252 | 2026-04-30T06:41:22.000Z | 各家工厂最新报价汇总/户外照明 工业照明/户外工厂/凯晟德/202605/TR-R1 一体路灯/反光杯高清图/500/500w-4.png |
| 500w-4.png | image | 2116252 | 2026-04-30T06:41:22.000Z | 各家工厂最新报价汇总/户外照明 工业照明/户外工厂/凯晟德/202605/TR-R1 一体路灯/TR-R1透镜/500/500w-4.png |
| 500w-5.png | image | 1038278 | 2026-04-30T06:41:11.000Z | 各家工厂最新报价汇总/户外照明 工业照明/户外工厂/凯晟德/202605/TR-R1 一体路灯/反光杯高清图/500/500w-5.png |
| 500w-5.png | image | 1038278 | 2026-04-30T06:41:11.000Z | 各家工厂最新报价汇总/户外照明 工业照明/户外工厂/凯晟德/202605/TR-R1 一体路灯/TR-R1透镜/500/500w-5.png |
| 500w-6.png | image | 998511 | 2026-04-30T06:41:00.000Z | 各家工厂最新报价汇总/户外照明 工业照明/户外工厂/凯晟德/202605/TR-R1 一体路灯/反光杯高清图/500/500w-6.png |
| 500w-6.png | image | 998511 | 2026-04-30T06:41:00.000Z | 各家工厂最新报价汇总/户外照明 工业照明/户外工厂/凯晟德/202605/TR-R1 一体路灯/TR-R1透镜/500/500w-6.png |
| 500W-7.png | image | 4743857 | 2026-04-30T06:40:48.000Z | 各家工厂最新报价汇总/户外照明 工业照明/户外工厂/凯晟德/202605/TR-R1 一体路灯/反光杯高清图/500/500W-7.png |
| 500W-8.png | image | 4357095 | 2026-04-30T06:40:36.000Z | 各家工厂最新报价汇总/户外照明 工业照明/户外工厂/凯晟德/202605/TR-R1 一体路灯/反光杯高清图/500/500W-8.png |
| 500W-8.png | image | 4357095 | 2026-04-30T06:40:36.000Z | 各家工厂最新报价汇总/户外照明 工业照明/户外工厂/凯晟德/202605/TR-R1 一体路灯/TR-R1透镜/500/500W-8.png |
| 500w-1.png | image | 3615762 | 2026-04-30T06:40:23.000Z | 各家工厂最新报价汇总/户外照明 工业照明/户外工厂/凯晟德/202605/TR-R1 一体路灯/反光杯高清图/500/500w-1.png |
| 500w-2.png | image | 3902680 | 2026-04-30T06:40:10.000Z | 各家工厂最新报价汇总/户外照明 工业照明/户外工厂/凯晟德/202605/TR-R1 一体路灯/反光杯高清图/500/500w-2.png |
| 500w-2.png | image | 3902680 | 2026-04-30T06:40:10.000Z | 各家工厂最新报价汇总/户外照明 工业照明/户外工厂/凯晟德/202605/TR-R1 一体路灯/TR-R1透镜/500/500w-2.png |
| 400W-8.png | image | 3981983 | 2026-04-30T06:39:37.000Z | 各家工厂最新报价汇总/户外照明 工业照明/户外工厂/凯晟德/202605/TR-R1 一体路灯/反光杯高清图/400/400W-8.png |
| 400W-8.png | image | 3981983 | 2026-04-30T06:39:37.000Z | 各家工厂最新报价汇总/户外照明 工业照明/户外工厂/凯晟德/202605/TR-R1 一体路灯/TR-R1透镜/400/400W-8.png |
| 400w-1.png | image | 4292619 | 2026-04-30T06:39:24.000Z | 各家工厂最新报价汇总/户外照明 工业照明/户外工厂/凯晟德/202605/TR-R1 一体路灯/反光杯高清图/400/400w-1.png |
| 400w-2.png | image | 4185627 | 2026-04-30T06:39:13.000Z | 各家工厂最新报价汇总/户外照明 工业照明/户外工厂/凯晟德/202605/TR-R1 一体路灯/反光杯高清图/400/400w-2.png |
| 400w-2.png | image | 4185627 | 2026-04-30T06:39:13.000Z | 各家工厂最新报价汇总/户外照明 工业照明/户外工厂/凯晟德/202605/TR-R1 一体路灯/TR-R1透镜/400/400w-2.png |
| 400w-3.png | image | 3199292 | 2026-04-30T06:38:29.000Z | 各家工厂最新报价汇总/户外照明 工业照明/户外工厂/凯晟德/202605/TR-R1 一体路灯/反光杯高清图/400/400w-3.png |
| 400w-3.png | image | 3199292 | 2026-04-30T06:38:29.000Z | 各家工厂最新报价汇总/户外照明 工业照明/户外工厂/凯晟德/202605/TR-R1 一体路灯/TR-R1透镜/400/400w-3.png |
| 400w-4.png | image | 3343615 | 2026-04-30T06:38:17.000Z | 各家工厂最新报价汇总/户外照明 工业照明/户外工厂/凯晟德/202605/TR-R1 一体路灯/反光杯高清图/400/400w-4.png |
| 400w-4.png | image | 3343615 | 2026-04-30T06:38:17.000Z | 各家工厂最新报价汇总/户外照明 工业照明/户外工厂/凯晟德/202605/TR-R1 一体路灯/TR-R1透镜/400/400w-4.png |
| 400w-5.png | image | 1128916 | 2026-04-30T06:38:05.000Z | 各家工厂最新报价汇总/户外照明 工业照明/户外工厂/凯晟德/202605/TR-R1 一体路灯/反光杯高清图/400/400w-5.png |
| 400w-5.png | image | 1128916 | 2026-04-30T06:38:05.000Z | 各家工厂最新报价汇总/户外照明 工业照明/户外工厂/凯晟德/202605/TR-R1 一体路灯/TR-R1透镜/400/400w-5.png |
| 400w-6.png | image | 1141513 | 2026-04-30T06:37:53.000Z | 各家工厂最新报价汇总/户外照明 工业照明/户外工厂/凯晟德/202605/TR-R1 一体路灯/反光杯高清图/400/400w-6.png |
| 400w-6.png | image | 1141513 | 2026-04-30T06:37:53.000Z | 各家工厂最新报价汇总/户外照明 工业照明/户外工厂/凯晟德/202605/TR-R1 一体路灯/TR-R1透镜/400/400w-6.png |

## Unsupported Excel-like Files

None found.

## Suggested Next Step

1. Do not import yet. First reconcile `files` table metadata with the hard drive truth for moved/missing files.
2. For imported-source risk rows, prefer updating DB file paths/metadata to the current hard-drive file if a strong candidate exists.
3. For DB files missing with no match and no import references, mark as stale scan records rather than treating them as source data.
4. After file metadata is reconciled, run V2.13A source inventory on the priority folders, then V2.14 import planning.
