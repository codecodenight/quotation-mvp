# V24.0: 第三批品类模板 — 磁吸灯 / 灯丝灯 / 风扇灯 / 太阳能

## Goal

添加 4 个品类专用报价模板，模板覆盖率从 58% 提升到 ~78%（5,825→7,877 / 10,025）。

## Context

- 模板注册中心：`src/lib/quote-templates.ts` — `TEMPLATE_REGISTRY` Map，已有 9 个模板
- 共享 helpers：`src/lib/quote-templates/helpers.ts` — `readParam`, `appendSuffix`, `prefixValue`, `formatCct`, `cleanMoq`, `formatCtnSize`, `calcVolume`, `thinBorder`, `writeHeader`
- 测试文件：`src/lib/quote-export.test.ts`（当前 19 tests）
- 所有模板遵循相同 pattern：`QuoteTemplateConfig` interface + `writeRow` + `writeHeader`
- 参考已有模板：`solar-wall.ts`（14 列最简），`downlight.ts`（17 列最复杂），`bulb.ts`（有 local helper）

## Part A: 磁吸灯模板

文件：`src/lib/quote-templates/magnetic-track.ts`
导出：`magneticTrackTemplate`
品类：`"磁吸灯"`
Sheet：`"LED Magnetic Track Light"`

### 列定义（15 列）

| # | Header | key | width | 取值逻辑 |
|---|--------|-----|-------|---------|
| 1 | No. | no | 8 | rowIndex - 1 |
| 2 | Model No. | modelNo | 18 | item.modelNo ?? item.productName |
| 3 | Power | power | 12 | `readParam(item, "watts")` + "W" |
| 4 | Track System | trackSystem | 16 | `readParam(item, "track_system")` |
| 5 | Size (mm) | size | 18 | `readParam(item, "size_display") \|\| item.size \|\| ""` |
| 6 | Material | material | 18 | `readParam(item, "material") \|\| item.material \|\| ""` |
| 7 | CCT | cct | 16 | `formatCct(readParam(item, "cct"))` |
| 8 | CRI | cri | 10 | `prefixValue(readParam(item, "cri"), "Ra")` |
| 9 | Beam Angle | beamAngle | 14 | `appendSuffix(readParam(item, "beam_angle"), "°")` |
| 10 | Voltage | voltage | 16 | `appendSuffix(readParam(item, "voltage"), "V")` |
| 11 | FOB Price (USD) | salePrice | 16 | item.salePrice, numFmt: `'#,##0.00 "USD"'` |
| 12 | MOQ (PCS) | moq | 12 | `cleanMoq(item.moq)` |
| 13 | CTN QTY | ctnQty | 12 | `item.ctnQty ?? ""` |
| 14 | CTN Size (cm) | ctnSize | 18 | `formatCtnSize(item)` |
| 15 | Packing Volume (m³) | volume | 18 | `calcVolume(...)` |

Price cell numFmt 在 column 11。

## Part B: 灯丝灯模板

文件：`src/lib/quote-templates/filament.ts`
导出：`filamentTemplate`
品类：`"灯丝灯"`
Sheet：`"LED Filament Bulb"`

### 列定义（16 列）

| # | Header | key | width | 取值逻辑 |
|---|--------|-----|-------|---------|
| 1 | No. | no | 8 | rowIndex - 1 |
| 2 | Model No. | modelNo | 18 | item.modelNo ?? item.productName |
| 3 | Power | power | 12 | watts + "W" |
| 4 | Base | base | 12 | `readParam(item, "base")` |
| 5 | LED Type | ledType | 14 | `readParam(item, "led_type")` |
| 6 | CCT | cct | 14 | formatCct |
| 7 | CRI | cri | 10 | prefixValue "Ra" |
| 8 | PF | pf | 10 | readParam |
| 9 | Voltage | voltage | 16 | + "V" |
| 10 | Lumens | lumens | 14 | + "lm" |
| 11 | Luminous Efficacy | luminousEfficacy | 18 | + "lm/W" |
| 12 | FOB Price (USD) | salePrice | 16 | numFmt col 12 |
| 13 | MOQ (PCS) | moq | 12 | cleanMoq |
| 14 | CTN QTY | ctnQty | 12 | |
| 15 | CTN Size (cm) | ctnSize | 18 | formatCtnSize |
| 16 | Packing Volume (m³) | volume | 18 | calcVolume |

## Part C: 风扇灯模板

文件：`src/lib/quote-templates/fan-light.ts`
导出：`fanLightTemplate`
品类：`"风扇灯"`
Sheet：`"LED Fan Light"`

### 列定义（14 列）

| # | Header | key | width | 取值逻辑 |
|---|--------|-----|-------|---------|
| 1 | No. | no | 8 | |
| 2 | Model No. | modelNo | 18 | |
| 3 | Power | power | 12 | watts + "W" |
| 4 | Size (mm) | size | 18 | readParam("size_display") \|\| item.size |
| 5 | Material | material | 18 | readParam("material") \|\| item.material |
| 6 | CCT | cct | 16 | formatCct |
| 7 | CRI | cri | 10 | prefixValue "Ra" |
| 8 | Voltage | voltage | 16 | + "V" |
| 9 | IP | ip | 10 | prefixValue "IP" |
| 10 | FOB Price (USD) | salePrice | 16 | numFmt col 10 |
| 11 | MOQ (PCS) | moq | 12 | |
| 12 | CTN QTY | ctnQty | 12 | |
| 13 | CTN Size (cm) | ctnSize | 18 | |
| 14 | Packing Volume (m³) | volume | 18 | |

风扇灯没有 PF / Driver / Beam Angle，但有 IP。

## Part D: 太阳能模板（generic, 非壁灯）

文件：`src/lib/quote-templates/solar.ts`
导出：`solarTemplate`
品类：`"太阳能"`
Sheet：`"Solar LED Light"`

### 列定义（16 列）

| # | Header | key | width | 取值逻辑 |
|---|--------|-----|-------|---------|
| 1 | No. | no | 8 | |
| 2 | Model No. | modelNo | 18 | |
| 3 | Power | power | 12 | watts + "W" |
| 4 | Size (mm) | size | 18 | readParam("size_display") \|\| item.size |
| 5 | Material | material | 18 | readParam("material") \|\| item.material |
| 6 | CCT | cct | 16 | formatCct |
| 7 | CRI | cri | 10 | prefixValue "Ra" |
| 8 | PF | pf | 10 | readParam |
| 9 | IP | ip | 10 | prefixValue "IP" |
| 10 | Beam Angle | beamAngle | 14 | + "°" |
| 11 | Lumens | lumens | 14 | + "lm" |
| 12 | FOB Price (USD) | salePrice | 16 | numFmt col 12 |
| 13 | MOQ (PCS) | moq | 12 | |
| 14 | CTN QTY | ctnQty | 12 | |
| 15 | CTN Size (cm) | ctnSize | 18 | |
| 16 | Packing Volume (m³) | volume | 18 | |

太阳能（generic）比太阳能壁灯多 PF / Beam Angle / Size。

## Part E: 注册

`src/lib/quote-templates.ts` 添加 4 个 import + `registerTemplate` 调用（保持字母序插入）。

## Part F: 测试

`src/lib/quote-export.test.ts` 每个模板加一个 workbook 导出测试，参照现有 `downlightTemplate` 测试模式：
- 构造一个 quote 对象，items 含 1 条该品类产品
- category 字段设为对应品类名
- 调用 `writeQuoteWorkbook`
- 读回 workbook，验证 sheet name、列数、row 值

## Part G: 验证

```bash
npx tsc --noEmit
npx vitest run src/lib/quote-export.test.ts
npx vitest run
```

## 不要做

- 不修改 `src/lib/quote-export.ts`（模板发现逻辑已在 V21.0 完成）
- 不修改 helpers.ts（复用现有函数）
- 不修改任何 `src/app/` 文件
- 不修改数据库
