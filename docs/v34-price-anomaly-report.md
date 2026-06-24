# V34 价格异常检测报告

## 汇总

| 指标 | 数量 |
| --- | ---: |
| total offers | 10,763 |
| total flagged | 1,930 |

## Flag 数量

| price_flag | 数量 |
| --- | ---: |
| suspicious_low | 599 |
| suspicious_high | 36 |
| outlier_low | 463 |
| outlier_high | 832 |

## 品类中位数价格

| 品类 | median purchase_price |
| --- | ---: |
| (未分类) | 27.00 |
| 壁灯 | 11.00 |
| 充电灯 | 51.50 |
| 橱柜灯 | 21.00 |
| 磁吸灯 | 20.00 |
| 地埋灯 | 2.50 |
| 地埋灯/地插灯 | 64.00 |
| 灯带 | 6.00 |
| 灯管 | 5.54 |
| 灯丝灯 | 8.75 |
| 防潮灯 | 27.00 |
| 风扇灯 | 55.00 |
| 工作灯 | 71.20 |
| 轨道灯 | 93.63 |
| 净化灯 | 11.60 |
| 镜前灯 | 26.00 |
| 路灯 | 70.35 |
| 面板灯 | 8.00 |
| 皮线灯 | 10.00 |
| 球泡 | 4.51 |
| 三防灯 | 20.51 |
| 台灯 | 22.00 |
| 太阳能 | 95.00 |
| 太阳能壁灯 | 13.00 |
| 庭院灯 | 43.00 |
| 筒灯 | 16.00 |
| 投光灯 | 22.70 |
| 吸顶灯 | 29.31 |
| 线条灯 | 0.91 |
| 应急灯 | 15.40 |
| G4G9 | 9.00 |
| Highbay | 100.00 |

## 最极端异常价格样本 Top 20

| 工厂 | 品类 | model_no | product_name | price | flag | category median | score |
| --- | --- | --- | --- | ---: | --- | ---: | ---: |
| 瑞鑫 | 线条灯 | RP-A5075-F24 | RP-A5075-F24 | 2387.00 RMB | suspicious_high | 0.91 | 2623.08x |
| 博华 | 线条灯 | Input Voltage | Input Voltage | 2000.00 RMB | suspicious_high | 0.91 | 2197.80x |
| 瑞鑫 | 线条灯 | RP-A5075-O18 | RP-A5075-O18 | 1800.00 RMB | suspicious_high | 0.91 | 1978.02x |
| 瑞鑫 | 线条灯 | RP-A5075-F18 | RP-A5075-F18 | 1793.00 RMB | suspicious_high | 0.91 | 1970.33x |
| 博华 | 线条灯 | ESH-7535-150-50W | ESH-7535-150-50W | 1515.00 RMB | suspicious_high | 0.91 | 1664.84x |
| 瑞鑫 | 线条灯 | RP-C-5030-O15 | RP-C-5030-O15 | 1510.00 RMB | suspicious_high | 0.91 | 1659.34x |
| 瑞鑫 | 线条灯 | RP-C-7035-O15 | RP-C-7035-O15 | 1510.00 RMB | suspicious_high | 0.91 | 1659.34x |
| 博华 | 线条灯 | WL-ESL-7040 | WL-ESL-7040 | 1500.00 RMB | suspicious_high | 0.91 | 1648.35x |
| 瑞鑫 | 线条灯 | RP-A5075-O15 | RP-A5075-O15 | 1500.00 RMB | suspicious_high | 0.91 | 1648.35x |
| 瑞鑫 | 线条灯 | RP-A5075-F15 | RP-A5075-F15 | 1496.00 RMB | suspicious_high | 0.91 | 1643.96x |
| 博华 | 线条灯 | ESH-7535-120-40W | ESH-7535-120-40W | 1215.00 RMB | suspicious_high | 0.91 | 1335.16x |
| 瑞鑫 | 线条灯 | RP-C-5030-O12 | RP-C-5030-O12 | 1210.00 RMB | suspicious_high | 0.91 | 1329.67x |
| 瑞鑫 | 线条灯 | RP-C-7035-O12 | RP-C-7035-O12 | 1210.00 RMB | suspicious_high | 0.91 | 1329.67x |
| 瑞鑫 | 线条灯 | RP-A5075-O12 | RP-A5075-O12 | 1200.00 RMB | suspicious_high | 0.91 | 1318.68x |
| 瑞鑫 | 线条灯 | RP-A5075-U12 | RP-A5075-U12 | 1200.00 RMB | suspicious_high | 0.91 | 1318.68x |
| 瑞鑫 | 线条灯 | RP-A5075-F12 | RP-A5075-F12 | 1200.00 RMB | suspicious_high | 0.91 | 1318.68x |
| 瑞鑫 | 线条灯 | RP-C-5030-O09 | RP-C-5030-O09 | 910.00 RMB | outlier_high | 0.91 | 1000.00x |
| 瑞鑫 | 线条灯 | RP-A5075-F09 | RP-A5075-F09 | 902.00 RMB | outlier_high | 0.91 | 991.21x |
| 瑞鑫 | 线条灯 | RP-A5075-O09 | RP-A5075-O09 | 900.00 RMB | outlier_high | 0.91 | 989.01x |
| 一群狼 | 面板灯 | ￠54*0.02mm | ￠54*0.02mm | 0.01 RMB | suspicious_low | 8.00 | 800.00x |
