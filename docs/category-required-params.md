# 品类必要参数定义

定义每个品类的"必要参数"——报价时客户需要看到的规格。
用于衡量"覆盖率是否达标"和指导 V13.0 DeepSeek AI 推断目标。

W = watts, V = voltage, CCT = cct, CRI = cri, IP = ip, PF = pf,
DT = driver_type, MAT = material, LE = luminous_efficacy,
BA = beam_angle, BASE = base, SIZE = size_display

## 室内照明

| 品类 | 产品数 | 必要参数 | 说明 |
|---|---:|---|---|
| 筒灯 | 1,125 | W, V, CCT, CRI, PF, DT, SIZE | IP 通常 20，已由品类推断覆盖 |
| 面板灯 | 855 | W, V, CCT, CRI, PF, DT, SIZE, MAT | |
| 磁吸灯 | 800 | W, V, CCT, CRI, SIZE | 多为 48V 低压系统 |
| 吸顶灯 | 624 | W, V, CCT, CRI, PF, DT, SIZE | |
| 灯丝灯 | 588 | W, V, CCT, CRI, PF, BASE | 无 IP/beam 需求 |
| 风扇灯 | 400 | W, V, CCT, CRI, SIZE | 特殊品类，风扇+灯 |
| 球泡 | 371 | W, V, CCT, CRI, PF, BASE | |
| 壁灯 | 290 | W, V, CCT, CRI, DT, MAT | |
| 净化灯 | 233 | W, V, CCT, CRI, PF, DT, SIZE | 常用于洁净室 |
| 橱柜灯 | 204 | W, V, CCT, CRI, SIZE | |
| 镜前灯 | 194 | W, V, CCT, CRI, DT | |
| 轨道灯 | 155 | W, V, CCT, CRI, PF, BA | |
| 防潮灯 | 138 | W, V, CCT, CRI, IP, PF, DT | |
| 台灯 | 31 | W, V, CCT, CRI | |
| G4G9 | 61 | W, V, CCT, CRI, BASE | 光源类 |
| 灯管 | 92 | W, V, CCT, CRI, PF, SIZE | |

## 户外/工业照明

| 品类 | 产品数 | 必要参数 | 说明 |
|---|---:|---|---|
| 线条灯 | 1,143 | W, V, CCT, CRI, IP, SIZE | 室内外都有 |
| 投光灯 | 542 | W, V, CCT, CRI, IP, PF, BA, MAT | |
| 三防灯 | 442 | W, V, CCT, CRI, IP, PF, SIZE | |
| 太阳能壁灯 | 476 | W, CCT, IP, MAT | 无 V（太阳能供电） |
| 太阳能 | 310 | W, CCT, IP, MAT | 无 V |
| 路灯 | 224 | W, V, CCT, CRI, IP, PF, BA | |
| 地埋灯/地插灯 | 87 | W, V, CCT, CRI, IP, BA | |
| 工作灯 | 86 | W, V, CCT, CRI, IP | |
| 庭院灯 | 79 | W, V, CCT, IP, MAT | |
| Highbay | 51 | W, V, CCT, CRI, IP, PF, BA, LE | |
| 充电灯 | 7 | W, CCT, IP, MAT | 电池供电 |
| 应急灯 | 98 | W, V, CCT | |

## 灯带

| 品类 | 产品数 | 必要参数 | 说明 |
|---|---:|---|---|
| 灯带 | 399 | W, V, CCT, CRI, IP | W 为每米功率 |
| 皮线灯 | 171 | W, V, IP | 装饰类 |

## 不适用品类

| 品类 | 产品数 | 说明 |
|---|---:|---|
| 未分类 | 4 | 需人工归类 |
| 地埋灯 | 4 | 合并到 地埋灯/地插灯 |

## 参数覆盖率统计基准

"达标"定义：每个产品的**全部必要参数**都有值（任意 confidence）。

统计方式：
```sql
-- 对每个产品，检查其品类的必要参数是否全部有值
-- 覆盖率 = 全部必要参数有值的产品数 / 总产品数
```
