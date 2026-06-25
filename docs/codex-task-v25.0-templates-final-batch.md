# V25.0: 最终批次模板 — 16 个品类一次性扫尾

## Goal

为剩余全部未覆盖品类添加报价模板，模板总数从 13 → 29，覆盖率从 78% → ~99%。

## Context

- 模板注册中心：`src/lib/quote-templates.ts` — `TEMPLATE_REGISTRY` Map，已有 13 个模板
- 共享 helpers：`src/lib/quote-templates/helpers.ts`
- 测试文件：`src/lib/quote-export.test.ts`（当前 23 tests）
- 所有模板遵循同一 pattern：参考 `solar-wall.ts`（14 列最简）和 `magnetic-track.ts`（15 列带特殊参数）
- 不需要新 helper 函数，全部复用现有的

## 模板定义

以下 16 个模板，每个创建一个文件 `src/lib/quote-templates/<filename>.ts`。

---

### 1. 壁灯 (290 products)

文件：`wall-lamp.ts` | 导出：`wallLampTemplate` | Sheet：`"LED Wall Lamp"`

| # | Header | width | 取值 |
|---|--------|-------|------|
| 1 | No. | 8 | rowIndex - 1 |
| 2 | Model No. | 18 | modelNo ?? productName |
| 3 | Power | 12 | watts + "W" |
| 4 | Size (mm) | 18 | size_display \|\| item.size |
| 5 | Material | 18 | material param \|\| item.material |
| 6 | CCT | 16 | formatCct |
| 7 | CRI | 10 | prefixValue "Ra" |
| 8 | Voltage | 16 | + "V" |
| 9 | Driver | 16 | driver_type |
| 10 | FOB Price (USD) | 16 | numFmt col 10 |
| 11 | MOQ (PCS) | 12 | cleanMoq |
| 12 | CTN QTY | 12 | |
| 13 | CTN Size (cm) | 18 | formatCtnSize |
| 14 | Packing Volume (m³) | 18 | calcVolume |

---

### 2. 净化灯 (214 products)

文件：`purification.ts` | 导出：`purificationTemplate` | Sheet：`"LED Purification Light"`

| # | Header | width | 取值 |
|---|--------|-------|------|
| 1 | No. | 8 | |
| 2 | Model No. | 18 | |
| 3 | Power | 12 | watts + "W" |
| 4 | Size (mm) | 18 | size_display \|\| item.size |
| 5 | CCT | 16 | formatCct |
| 6 | CRI | 10 | "Ra" |
| 7 | PF | 10 | readParam |
| 8 | Voltage | 16 | + "V" |
| 9 | Driver | 16 | driver_type |
| 10 | Luminous Efficacy | 18 | + "lm/W" |
| 11 | FOB Price (USD) | 16 | numFmt col 11 |
| 12 | MOQ (PCS) | 12 | |
| 13 | CTN QTY | 12 | |
| 14 | CTN Size (cm) | 18 | |
| 15 | Packing Volume (m³) | 18 | |

---

### 3. 路灯 (204 products)

文件：`street-light.ts` | 导出：`streetLightTemplate` | Sheet：`"LED Street Light"`

| # | Header | width | 取值 |
|---|--------|-------|------|
| 1 | No. | 8 | |
| 2 | Model No. | 18 | |
| 3 | Power | 12 | watts + "W" |
| 4 | Size (mm) | 18 | size_display \|\| item.size |
| 5 | CCT | 16 | formatCct |
| 6 | CRI | 10 | "Ra" |
| 7 | PF | 10 | readParam |
| 8 | Voltage | 16 | + "V" |
| 9 | IP | 10 | prefixValue "IP" |
| 10 | Beam Angle | 14 | + "°" |
| 11 | Luminous Efficacy | 18 | + "lm/W" |
| 12 | FOB Price (USD) | 16 | numFmt col 12 |
| 13 | MOQ (PCS) | 12 | |
| 14 | CTN QTY | 12 | |
| 15 | CTN Size (cm) | 18 | |
| 16 | Packing Volume (m³) | 18 | |

---

### 4. 橱柜灯 (204 products)

文件：`cabinet.ts` | 导出：`cabinetTemplate` | Sheet：`"LED Cabinet Light"`

| # | Header | width | 取值 |
|---|--------|-------|------|
| 1 | No. | 8 | |
| 2 | Model No. | 18 | |
| 3 | Power | 12 | watts + "W" |
| 4 | Size (mm) | 18 | size_display \|\| item.size |
| 5 | Material | 18 | material |
| 6 | CCT | 16 | formatCct |
| 7 | CRI | 10 | "Ra" |
| 8 | Voltage | 16 | + "V" |
| 9 | IP | 10 | "IP" |
| 10 | FOB Price (USD) | 16 | numFmt col 10 |
| 11 | MOQ (PCS) | 12 | |
| 12 | CTN QTY | 12 | |
| 13 | CTN Size (cm) | 18 | |
| 14 | Packing Volume (m³) | 18 | |

---

### 5. 镜前灯 (181 products)

文件：`mirror-light.ts` | 导出：`mirrorLightTemplate` | Sheet：`"LED Mirror Light"`

| # | Header | width | 取值 |
|---|--------|-------|------|
| 1 | No. | 8 | |
| 2 | Model No. | 18 | |
| 3 | Power | 12 | watts + "W" |
| 4 | Size (mm) | 18 | size_display \|\| item.size |
| 5 | Material | 18 | material |
| 6 | CCT | 16 | formatCct |
| 7 | CRI | 10 | "Ra" |
| 8 | Voltage | 16 | + "V" |
| 9 | IP | 10 | "IP" |
| 10 | Driver | 16 | driver_type |
| 11 | Luminous Efficacy | 18 | + "lm/W" |
| 12 | FOB Price (USD) | 16 | numFmt col 12 |
| 13 | MOQ (PCS) | 12 | |
| 14 | CTN QTY | 12 | |
| 15 | CTN Size (cm) | 18 | |
| 16 | Packing Volume (m³) | 18 | |

---

### 6. 皮线灯 (169 products)

文件：`string-light.ts` | 导出：`stringLightTemplate` | Sheet：`"LED String Light"`

| # | Header | width | 取值 |
|---|--------|-------|------|
| 1 | No. | 8 | |
| 2 | Model No. | 18 | |
| 3 | Power | 12 | watts + "W" |
| 4 | CCT | 16 | formatCct |
| 5 | Voltage | 16 | + "V" |
| 6 | Size (mm) | 18 | size_display \|\| item.size |
| 7 | Material | 18 | material |
| 8 | FOB Price (USD) | 16 | numFmt col 8 |
| 9 | MOQ (PCS) | 12 | |
| 10 | CTN QTY | 12 | |
| 11 | CTN Size (cm) | 18 | |
| 12 | Packing Volume (m³) | 18 | |

最简模板（12 列），皮线灯参数极少。

---

### 7. 轨道灯 (155 products)

文件：`track-light.ts` | 导出：`trackLightTemplate` | Sheet：`"LED Track Light"`

| # | Header | width | 取值 |
|---|--------|-------|------|
| 1 | No. | 8 | |
| 2 | Model No. | 18 | |
| 3 | Power | 12 | watts + "W" |
| 4 | Size (mm) | 18 | size_display \|\| item.size |
| 5 | CCT | 16 | formatCct |
| 6 | CRI | 10 | "Ra" |
| 7 | PF | 10 | readParam |
| 8 | Voltage | 16 | + "V" |
| 9 | Beam Angle | 14 | + "°" |
| 10 | FOB Price (USD) | 16 | numFmt col 10 |
| 11 | MOQ (PCS) | 12 | |
| 12 | CTN QTY | 12 | |
| 13 | CTN Size (cm) | 18 | |
| 14 | Packing Volume (m³) | 18 | |

---

### 8. 防潮灯 (138 products)

文件：`moisture-proof.ts` | 导出：`moistureProofTemplate` | Sheet：`"LED Moisture-proof Light"`

| # | Header | width | 取值 |
|---|--------|-------|------|
| 1 | No. | 8 | |
| 2 | Model No. | 18 | |
| 3 | Power | 12 | watts + "W" |
| 4 | Size (mm) | 18 | size_display \|\| item.size |
| 5 | Material | 18 | material |
| 6 | CCT | 16 | formatCct |
| 7 | CRI | 10 | "Ra" |
| 8 | PF | 10 | readParam |
| 9 | Voltage | 16 | + "V" |
| 10 | IP | 10 | "IP" |
| 11 | Driver | 16 | driver_type |
| 12 | FOB Price (USD) | 16 | numFmt col 12 |
| 13 | MOQ (PCS) | 12 | |
| 14 | CTN QTY | 12 | |
| 15 | CTN Size (cm) | 18 | |
| 16 | Packing Volume (m³) | 18 | |

---

### 9. 应急灯 (98 products)

文件：`emergency.ts` | 导出：`emergencyTemplate` | Sheet：`"LED Emergency Light"`

| # | Header | width | 取值 |
|---|--------|-------|------|
| 1 | No. | 8 | |
| 2 | Model No. | 18 | |
| 3 | Power | 12 | watts + "W" |
| 4 | Size (mm) | 18 | size_display \|\| item.size |
| 5 | Material | 18 | material |
| 6 | CCT | 16 | formatCct |
| 7 | Voltage | 16 | + "V" |
| 8 | FOB Price (USD) | 16 | numFmt col 8 |
| 9 | MOQ (PCS) | 12 | |
| 10 | CTN QTY | 12 | |
| 11 | CTN Size (cm) | 18 | |
| 12 | Packing Volume (m³) | 18 | |

---

### 10. 灯管 (91 products)

文件：`tube.ts` | 导出：`tubeTemplate` | Sheet：`"LED Tube"`

| # | Header | width | 取值 |
|---|--------|-------|------|
| 1 | No. | 8 | |
| 2 | Model No. | 18 | |
| 3 | Power | 12 | watts + "W" |
| 4 | Size (mm) | 18 | size_display \|\| item.size |
| 5 | CCT | 16 | formatCct |
| 6 | CRI | 10 | "Ra" |
| 7 | PF | 10 | readParam |
| 8 | Voltage | 16 | + "V" |
| 9 | Lumens | 14 | + "lm" |
| 10 | Luminous Efficacy | 18 | + "lm/W" |
| 11 | FOB Price (USD) | 16 | numFmt col 11 |
| 12 | MOQ (PCS) | 12 | |
| 13 | CTN QTY | 12 | |
| 14 | CTN Size (cm) | 18 | |
| 15 | Packing Volume (m³) | 18 | |

---

### 11. 地埋灯/地插灯 (87 products)

文件：`inground.ts` | 导出：`ingroundTemplate` | Sheet：`"LED Inground Light"`

| # | Header | width | 取值 |
|---|--------|-------|------|
| 1 | No. | 8 | |
| 2 | Model No. | 18 | |
| 3 | Power | 12 | watts + "W" |
| 4 | Size (mm) | 18 | size_display \|\| item.size |
| 5 | Material | 18 | material |
| 6 | CCT | 16 | formatCct |
| 7 | CRI | 10 | "Ra" |
| 8 | PF | 10 | readParam |
| 9 | Voltage | 16 | + "V" |
| 10 | IP | 10 | "IP" |
| 11 | Beam Angle | 14 | + "°" |
| 12 | FOB Price (USD) | 16 | numFmt col 12 |
| 13 | MOQ (PCS) | 12 | |
| 14 | CTN QTY | 12 | |
| 15 | CTN Size (cm) | 18 | |
| 16 | Packing Volume (m³) | 18 | |

---

### 12. 工作灯 (86 products)

文件：`work-light.ts` | 导出：`workLightTemplate` | Sheet：`"LED Work Light"`

| # | Header | width | 取值 |
|---|--------|-------|------|
| 1 | No. | 8 | |
| 2 | Model No. | 18 | |
| 3 | Power | 12 | watts + "W" |
| 4 | Size (mm) | 18 | size_display \|\| item.size |
| 5 | Material | 18 | material |
| 6 | CCT | 16 | formatCct |
| 7 | CRI | 10 | "Ra" |
| 8 | Voltage | 16 | + "V" |
| 9 | IP | 10 | "IP" |
| 10 | Beam Angle | 14 | + "°" |
| 11 | Luminous Efficacy | 18 | + "lm/W" |
| 12 | FOB Price (USD) | 16 | numFmt col 12 |
| 13 | MOQ (PCS) | 12 | |
| 14 | CTN QTY | 12 | |
| 15 | CTN Size (cm) | 18 | |
| 16 | Packing Volume (m³) | 18 | |

---

### 13. 庭院灯 (78 products)

文件：`garden.ts` | 导出：`gardenTemplate` | Sheet：`"LED Garden Light"`

| # | Header | width | 取值 |
|---|--------|-------|------|
| 1 | No. | 8 | |
| 2 | Model No. | 18 | |
| 3 | Power | 12 | watts + "W" |
| 4 | Size (mm) | 18 | size_display \|\| item.size |
| 5 | Material | 18 | material |
| 6 | CCT | 16 | formatCct |
| 7 | Voltage | 16 | + "V" |
| 8 | IP | 10 | "IP" |
| 9 | Lumens | 14 | + "lm" |
| 10 | FOB Price (USD) | 16 | numFmt col 10 |
| 11 | MOQ (PCS) | 12 | |
| 12 | CTN QTY | 12 | |
| 13 | CTN Size (cm) | 18 | |
| 14 | Packing Volume (m³) | 18 | |

---

### 14. G4G9 (61 products)

文件：`g4g9.ts` | 导出：`g4g9Template` | Sheet：`"LED G4/G9 Bulb"`

| # | Header | width | 取值 |
|---|--------|-------|------|
| 1 | No. | 8 | |
| 2 | Model No. | 18 | |
| 3 | Power | 12 | watts + "W" |
| 4 | Base | 12 | readParam("base") |
| 5 | Size (mm) | 18 | size_display \|\| item.size |
| 6 | CCT | 14 | formatCct |
| 7 | CRI | 10 | "Ra" |
| 8 | Voltage | 16 | + "V" |
| 9 | Luminous Efficacy | 18 | + "lm/W" |
| 10 | FOB Price (USD) | 16 | numFmt col 10 |
| 11 | MOQ (PCS) | 12 | |
| 12 | CTN QTY | 12 | |
| 13 | CTN Size (cm) | 18 | |
| 14 | Packing Volume (m³) | 18 | |

---

### 15. Highbay (49 products)

文件：`highbay.ts` | 导出：`highbayTemplate` | Sheet：`"LED Highbay"`

| # | Header | width | 取值 |
|---|--------|-------|------|
| 1 | No. | 8 | |
| 2 | Model No. | 18 | |
| 3 | Power | 12 | watts + "W" |
| 4 | Size (mm) | 18 | size_display \|\| item.size |
| 5 | CCT | 16 | formatCct |
| 6 | CRI | 10 | "Ra" |
| 7 | PF | 10 | readParam |
| 8 | Voltage | 16 | + "V" |
| 9 | IP | 10 | "IP" |
| 10 | Beam Angle | 14 | + "°" |
| 11 | Luminous Efficacy | 18 | + "lm/W" |
| 12 | Driver | 16 | driver_type |
| 13 | FOB Price (USD) | 16 | numFmt col 13 |
| 14 | MOQ (PCS) | 12 | |
| 15 | CTN QTY | 12 | |
| 16 | CTN Size (cm) | 18 | |
| 17 | Packing Volume (m³) | 18 | |

---

### 16. 台灯 (31 products)

文件：`desk-lamp.ts` | 导出：`deskLampTemplate` | Sheet：`"LED Desk Lamp"`

| # | Header | width | 取值 |
|---|--------|-------|------|
| 1 | No. | 8 | |
| 2 | Model No. | 18 | |
| 3 | Power | 12 | watts + "W" |
| 4 | Size (mm) | 18 | size_display \|\| item.size |
| 5 | Material | 18 | material |
| 6 | CCT | 16 | formatCct |
| 7 | CRI | 10 | "Ra" |
| 8 | Voltage | 16 | + "V" |
| 9 | FOB Price (USD) | 16 | numFmt col 9 |
| 10 | MOQ (PCS) | 12 | |
| 11 | CTN QTY | 12 | |
| 12 | CTN Size (cm) | 18 | |
| 13 | Packing Volume (m³) | 18 | |

---

## 通用 writeRow 模式

所有 16 个模板的 `writeRow` 共享同一结构，参考 `solar-wall.ts`：

```typescript
writeRow: (ws, rowIndex, item) => {
  const row = ws.getRow(rowIndex);
  row.values = [ /* ... 按列顺序填值 ... */ ];
  row.height = 22;
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = thinBorder();
  });
  row.getCell(N).numFmt = '#,##0.00 "USD"';  // N = FOB Price 列号
},
```

每个模板的 `writeHeader` 一律用：
```typescript
writeHeader: (ws) => writeHeader(ws, xxxTemplate),
```

## 注册

`src/lib/quote-templates.ts` 新增 16 个 import + `registerTemplate` 调用。保持字母序。

注意：`地埋灯/地插灯` 品类名含 `/`，但只是 category 字符串匹配，不影响文件名。

## 测试

`src/lib/quote-export.test.ts` 新增 16 个测试（参照现有 magnetic-track 测试模式）。每个测试：
- 构造单品类 quote
- 设置 `category` 字段为对应品类名
- 调用 `writeQuoteWorkbook`
- 验证 sheet name、header row、至少 3 个 cell 值

## 验证

```bash
npx tsc --noEmit
npx vitest run src/lib/quote-export.test.ts
npx vitest run
```

写结果到 `docs/v25.0-templates-final-batch-report.md`。

## 不要做

- 不修改 `src/lib/quote-export.ts`
- 不修改 `src/lib/quote-templates/helpers.ts`
- 不修改任何 `src/app/` 文件
- 不修改数据库
- 不为 `充电灯`(7) 和 `地埋灯`(4，与 `地埋灯/地插灯` 重复) 单独建模板（太少不值得）
