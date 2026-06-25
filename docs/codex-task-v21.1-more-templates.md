# V21.1: 报价模板引擎 — 4 个高频品类模板

## Goal

在 V21.0 面板灯模板基础上，新增投光灯、线条灯、球泡、灯带 4 个品类的报价模板。这 4 个加上已有的面板灯，覆盖最高频的 5 个报价品类。

## Context

- V21.0 已建立模板架构：`src/lib/quote-templates.ts` 注册表 + `src/lib/quote-templates/panel.ts` 面板灯模板
- 报价汇总表列结构参考（每个品类的列定义来自之前的分析）
- 各品类产品数：投光灯 542 / 线条灯 1139 / 球泡 371 / 灯带 396
- 模板文件复用 panel.ts 的 helper 模式（readParam / appendSuffix / prefixValue / thinBorder / cleanMoq / formatCtnSize / calcVolume）

## Changes

### A. 提取公共 helper

把 `panel.ts` 中的通用函数移到 `src/lib/quote-templates/helpers.ts`：

```typescript
export function readParam(item: QuoteTemplateItem, key: string): string
export function appendSuffix(value: string, suffix: string): string
export function prefixValue(value: string, prefix: string): string
export function formatCct(value: string): string
export function cleanMoq(raw: string | null): string
export function formatCtnSize(item: QuoteTemplateItem): string
export function calcVolume(length: string | null, width: string | null, height: string | null): number | string
export function thinBorder(): Partial<Borders>
```

`panel.ts` 改为 import 这些函数。

### B. 投光灯模板 `src/lib/quote-templates/floodlight.ts`

品类: `投光灯`  
Sheet 名: `LED Floodlight`  

| 列 | Header | 数据来源 |
|---|---|---|
| A | No. | 行号 |
| B | Model No. | modelNo |
| C | Power | params.watts + "W" |
| D | Size (mm) | params.size_display |
| E | Material | params.material |
| F | CCT | params.cct + "K" |
| G | CRI | "Ra" + params.cri |
| H | PF | params.pf |
| I | Voltage | params.voltage + "V" |
| J | Driver | params.driver_type |
| K | IP | "IP" + params.ip |
| L | Beam Angle | params.beam_angle + "°" |
| M | FOB Price (USD) | salePrice |
| N | MOQ (PCS) | moq |
| O | CTN QTY | ctnQty |
| P | CTN Size (cm) | L × W × H |
| Q | Packing Volume (m³) | 计算 |

投光灯比面板灯多 Beam Angle 列。

### C. 线条灯模板 `src/lib/quote-templates/linear.ts`

品类: `线条灯`  
Sheet 名: `LED Linear Light`

| 列 | Header | 数据来源 |
|---|---|---|
| A | No. | 行号 |
| B | Model No. | modelNo |
| C | Power | params.watts + "W" |
| D | Length (mm) | params.length_mm 或 params.size_display |
| E | Material | params.material |
| F | CCT | params.cct + "K" |
| G | CRI | "Ra" + params.cri |
| H | PF | params.pf |
| I | Voltage | params.voltage + "V" |
| J | IP | "IP" + params.ip |
| K | FOB Price (USD) | salePrice |
| L | MOQ (PCS) | moq |
| M | CTN QTY | ctnQty |
| N | CTN Size (cm) | L × W × H |
| O | Packing Volume (m³) | 计算 |

线条灯用 Length 代替 Size，无 Driver 和 Beam Angle。

### D. 球泡模板 `src/lib/quote-templates/bulb.ts`

品类: `球泡`  
Sheet 名: `LED Bulb`

| 列 | Header | 数据来源 |
|---|---|---|
| A | No. | 行号 |
| B | Model No. | modelNo |
| C | Power | params.watts + "W" |
| D | Base | params.base（E27/E14/B22 等）|
| E | Shape | params.shape 或产品名提取（A60/T80/C37 等）|
| F | CCT | params.cct + "K" |
| G | CRI | "Ra" + params.cri |
| H | PF | params.pf |
| I | Voltage | params.voltage + "V" |
| J | Driver | params.driver_type |
| K | Luminous Efficacy | params.luminous_efficacy + "lm/W" |
| L | FOB Price (USD) | salePrice |
| M | MOQ (PCS) | moq |
| N | CTN QTY | ctnQty |
| O | CTN Size (cm) | L × W × H |
| P | Packing Volume (m³) | 计算 |

球泡特有列：Base、Shape、Luminous Efficacy。

### E. 灯带模板 `src/lib/quote-templates/strip.ts`

品类: `灯带`  
Sheet 名: `LED Strips`

| 列 | Header | 数据来源 |
|---|---|---|
| A | No. | 行号 |
| B | Model No. | modelNo |
| C | W/m | params.watts（灯带功率通常以 W/m 表示）|
| D | Voltage | params.voltage + "V" |
| E | LED Chip | params.led_type |
| F | LEDs/m | params.leds_per_meter 或 params.led_count |
| G | CCT | params.cct + "K" |
| H | CRI | "Ra" + params.cri |
| I | IP | "IP" + params.ip |
| J | PCB Width | params.width_mm + "mm" |
| K | FOB Price (USD/m) | salePrice |
| L | MOQ (m) | moq |
| M | CTN QTY | ctnQty |
| N | CTN Size (cm) | L × W × H |
| O | Packing Volume (m³) | 计算 |

灯带特有列：W/m、LED Chip、LEDs/m、PCB Width。

### F. 注册模板

在 `src/lib/quote-templates.ts` 中 import 并注册 4 个新模板。

### G. 验证

1. `npx tsc --noEmit` — 0 errors
2. `npx vitest run` — all pass
3. 为每个新模板写一个测试用例（参考 panel 测试的模式），验证列头和数据行
4. 启动 dev server，对每个品类做一次导出测试，确认 Excel 格式正确

### H. 报告

写到 `docs/v21.1-more-templates-report.md`：
- 每个品类模板的列数和特殊列
- 公共 helper 提取清单
- 测试结果
- tsc / vitest 结果
