# V21.2: 报价模板引擎 — 第二批 4 个品类模板

## Goal

新增筒灯、三防灯、吸顶灯、太阳能壁灯 4 个品类报价模板。加上 V21.0-V21.1 的 5 个，共 9 个品类模板。

## Context

- 模板架构已建立：`src/lib/quote-templates.ts` 注册表 + `src/lib/quote-templates/helpers.ts` 公共函数
- 已有模板：面板灯、投光灯、线条灯、球泡、灯带
- 复用 helpers.ts 的 readParam / appendSuffix / prefixValue / formatCct / cleanMoq / formatCtnSize / calcVolume / thinBorder
- writeHeader 可以提到 helpers.ts 里（当前每个模板文件都有一份相同的局部 writeHeader）

## Changes

### A. 提取 writeHeader 到 helpers.ts

把重复的 `writeHeader(ws, template)` 函数移到 helpers.ts 导出。更新现有 5 个模板文件 import。

### B. 筒灯模板 `src/lib/quote-templates/downlight.ts`

品类: `筒灯`  
Sheet 名: `LED Downlight`

| 列 | Header | 数据来源 |
|---|---|---|
| A | No. | 行号 |
| B | Model No. | modelNo |
| C | Power | params.watts + "W" |
| D | Size (mm) | params.size_display |
| E | Cutout (mm) | params.cutout_mm |
| F | Material | params.material |
| G | CCT | params.cct + "K" |
| H | CRI | "Ra" + params.cri |
| I | PF | params.pf |
| J | Voltage | params.voltage + "V" |
| K | Driver | params.driver_type |
| L | Beam Angle | params.beam_angle + "°" |
| M | FOB Price (USD) | salePrice |
| N | MOQ (PCS) | moq |
| O | CTN QTY | ctnQty |
| P | CTN Size (cm) | L × W × H |
| Q | Packing Volume (m³) | 计算 |

筒灯特有列：Cutout (开孔尺寸)、Beam Angle。

### C. 三防灯模板 `src/lib/quote-templates/triproof.ts`

品类: `三防灯`  
Sheet 名: `LED Tri-proof Light`

| 列 | Header | 数据来源 |
|---|---|---|
| A | No. | 行号 |
| B | Model No. | modelNo |
| C | Power | params.watts + "W" |
| D | Length (mm) | params.length_mm 或 params.size_display |
| E | CCT | params.cct + "K" |
| F | CRI | "Ra" + params.cri |
| G | PF | params.pf |
| H | Voltage | params.voltage + "V" |
| I | IP | "IP" + params.ip |
| J | Luminous Efficacy | params.luminous_efficacy + "lm/W" |
| K | FOB Price (USD) | salePrice |
| L | MOQ (PCS) | moq |
| M | CTN QTY | ctnQty |
| N | CTN Size (cm) | L × W × H |
| O | Packing Volume (m³) | 计算 |

三防灯无 Material/Driver/Beam Angle，有 IP 和 Luminous Efficacy。

### D. 吸顶灯模板 `src/lib/quote-templates/ceiling.ts`

品类: `吸顶灯`  
Sheet 名: `LED Ceiling Lamp`

| 列 | Header | 数据来源 |
|---|---|---|
| A | No. | 行号 |
| B | Model No. | modelNo |
| C | Power | params.watts + "W" |
| D | Size (mm) | params.size_display 或 diameter_mm |
| E | Material | params.material |
| F | CCT | params.cct + "K" |
| G | CRI | "Ra" + params.cri |
| H | PF | params.pf |
| I | Voltage | params.voltage + "V" |
| J | Driver | params.driver_type |
| K | FOB Price (USD) | salePrice |
| L | MOQ (PCS) | moq |
| M | CTN QTY | ctnQty |
| N | CTN Size (cm) | L × W × H |
| O | Packing Volume (m³) | 计算 |

吸顶灯 Size 优先用 diameter_mm（圆形吸顶灯），无 IP/Beam Angle。

### E. 太阳能壁灯模板 `src/lib/quote-templates/solar-wall.ts`

品类: `太阳能壁灯`  
Sheet 名: `Solar Wall Light`

| 列 | Header | 数据来源 |
|---|---|---|
| A | No. | 行号 |
| B | Model No. | modelNo |
| C | Power | params.watts + "W" |
| D | Material | params.material |
| E | CCT | params.cct + "K" |
| F | CRI | "Ra" + params.cri |
| G | IP | "IP" + params.ip |
| H | Lumens | params.lumens + "lm" |
| I | Sensor | params.sensor |
| J | FOB Price (USD) | salePrice |
| K | MOQ (PCS) | moq |
| L | CTN QTY | ctnQty |
| M | CTN Size (cm) | L × W × H |
| N | Packing Volume (m³) | 计算 |

太阳能壁灯特有列：Lumens、Sensor。无 Voltage/PF/Driver（太阳能供电）。

### F. 注册模板

在 `src/lib/quote-templates.ts` 中 import 并注册 4 个新模板。

### G. 验证

1. `npx tsc --noEmit` — 0 errors
2. `npx vitest run` — all pass
3. 为每个新模板写一个测试用例（参考现有测试模式），验证列头和数据行
4. 不要修改 `src/lib/quote-export.ts`、`src/app/` 下的任何文件

### H. 报告

写到 `docs/v21.2-more-templates-batch2-report.md`
