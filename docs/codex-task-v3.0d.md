# Codex Task: V3.0D — 剩余 12 品类参数提取

## 目标

对现有 DB 中 12 个无参数品类（1,116 产品）做结构化参数提取，写入 `product_params` 表。

**只从 DB 字段提取（product_name, model_no, remark, size, material + offer remark）。不读源 Excel。不改其他表。**

## 范围

| 品类 | 产品数 | 有 remark | 有 size | 有 material | 预期覆盖 |
|---|---:|---:|---:|---:|---|
| 灯丝灯 | 471 | 471 | 471 | 0 | 高（remark 有 Watts/Lumens/BASE） |
| 轨道灯 | 155 | 155 | 151 | 0 | 中（remark 多为 size 重复，watts 在 model_no） |
| 橱柜灯 | 134 | 132 | 108 | 0 | 中（remark 有"功率: 4W"） |
| 太阳能壁灯 | 87 | 85 | 70 | 0 | 中（remark 是中文长文本，有 IP/LM/色温） |
| 庭院灯 | 74 | 73 | 37 | 0 | 低（remark 只有 "Product details: 30W"） |
| 应急灯 | 70 | 68 | 65 | 0 | 低（remark 是型号重复，无规格） |
| 地埋灯/地插灯 | 58 | 56 | 9 | 0 | 中（remark 有 Specification/IP/CCT/Wattage） |
| 壁灯 | 27 | 27 | 27 | 27 | 高（remark 有 Wattage/Material/CRI） |
| 台灯 | 23 | 23 | 0 | 0 | 中（remark 有 "Technical Data: ... Size: D12*H30 CM Material: Metal"） |
| 灯管 | 8 | 8 | 8 | 0 | 低（remark 只有 "0.6M"，watts 在 product_name） |
| Highbay | 6 | 6 | 6 | 0 | 高（remark 有 Watt/Material/CCT/Beam Angle/IP） |
| 皮线灯 | 3 | 3 | 3 | 3 | 低（中文描述为主） |

## 实现方式

**扩展现有 `scripts/extract-params.ts`**，新增 `v3d` target config。

### 需要做的改动

1. `TARGET_CATEGORY_CONFIGS` 增加 `v3d` 条目，包含 12 个品类
2. `TargetCategory` 类型自动扩展
3. `extractProductParams()` switch 增加 12 个 case
4. 新增 12 个品类提取函数
5. 报告路径默认 `docs/v3.0d-dry-run-report.md`

### 不需要改的

- 框架逻辑（dry-run/apply、dedupeParams、confidence 排序、报告生成）
- 现有通用提取函数
- 现有 V3.0B/V3.0C 品类的提取逻辑

---

## 各品类提取规则

### 灯丝灯 Filament（471 产品）

**remark 格式**：
```
Watts: 2W
Lumens: 140Lm
LED Chip Model: 1PCS
Product Size（mm): 95*138
```
或简单版：`Lumens: 240Lm`

**model_no/product_name 格式**：`G95南瓜金色 G95 Pumpkin Golden - 2W - E27 - 95*135`
→ 有些含 watts + base + size

| param_key | 提取源 | 提取方式 | confidence |
|---|---|---|---|
| watts | remark (`Watts: XXW`) / model_no / product_name | extractWatts | high |
| lumens | remark (`Lumens: XXXLm`) | extractLumens | medium |
| base | product_name (`E14`, `E27`, `B22`, `GU10`) | 正则 `\b(E14\|E27\|E26\|B22\|GU10\|GU5\.3\|G9\|G4)\b` | high |

### 轨道灯 Track Light（155 产品）

**remark 格式**：大部分 remark = size（如 `Ø52*H120`），少量 `Description: LED Track light`。
**model_no 格式**：`XRS019A(F4)-32W`（末尾有 watts）或 `K1220-8A`（末尾数字可能是 watts）。

| param_key | 提取源 | 提取方式 | confidence |
|---|---|---|---|
| watts | model_no（`-XXW` 后缀） | extractWatts（已有 model_no 提取） | high |

轨道灯的主要价值在功率，其他参数源数据极少。

### 橱柜灯 Cabinet Light（134 产品）

**remark 格式**：`功率: 4W` 或 `功率: 4.5W`

| param_key | 提取源 | 提取方式 | confidence |
|---|---|---|---|
| watts | remark (`功率: XXW`) | extractWatts / extractLabeledWatts | high |
| base | product_name (`MR16`, `GU10`, `GU5.3`) | 正则同灯丝灯 | high |

### 太阳能壁灯 Solar Wall Light（87 产品）

**remark 格式**：中文长文本，内含：
- `IP65`
- `XXXlm` / `XXXLM`
- `6500±500K` / `6500K`
- `感应角度120度`
- `18650 1*2000MAH 3.7V`

| param_key | 提取源 | 提取方式 | confidence |
|---|---|---|---|
| ip | remark | extractIp | high |
| lumens | remark / product_name (`500LM`) | extractLumens | medium |
| cct | remark (`6500K`, `6500±500K`) | extractLabeledCct | medium |
| battery_spec | remark (`18650 1*2000MAH 3.7V`) | 正则 `18650\s+\d+\*\d+MAH\s+[\d.]+V` | medium |
| sensor | remark (感应/PIR/motion) | extractSensor | medium |

### 庭院灯 Garden Light（74 产品）

**remark 格式**：`Product details: 50W` 或 `Product details: 30W 标300W`

| param_key | 提取源 | 提取方式 | confidence |
|---|---|---|---|
| watts | remark (`Product details: XXW`) / model_no | extractWatts | high |

### 应急灯 Emergency Light（70 产品）

**remark 格式**：`型号 specifications and models: SYJ-017 EXIT`
→ remark 基本是型号重复，无规格参数。

| param_key | 提取源 | 提取方式 | confidence |
|---|---|---|---|
| watts | model_no / product_name | extractWatts（如果有） | high |

预期覆盖率极低。

### 地埋灯/地插灯 In-Ground Light（58 产品）

**remark 格式**：
```
Specification: Φ43*245MM black housing+spike
Material: die casting aluminum
IP Grade：IP65
CCT: 3000K
Wattage: 5WCOB
```

| param_key | 提取源 | 提取方式 | confidence |
|---|---|---|---|
| watts | remark (`Wattage: XXWCOB` / `Wattage: XXW`) | extractWatts | high |
| ip | remark (`IP Grade：IP65`) | extractIp | high |
| cct | remark (`CCT: 3000K`) | extractLabeledCct | medium |
| material | remark (`Material: die casting aluminum`) | extractLabeledMaterial | medium |
| beam_angle | remark (`Beam Angle: XX°`) | extractBeamAngles | high |

### 壁灯 Wall Light（27 产品）

**remark 格式**：
```
Wattage: 12W SMD
Material: ABS
Housing: 黑/白
Driver: 非隔离裸板
CRI: 80
```

| param_key | 提取源 | 提取方式 | confidence |
|---|---|---|---|
| watts | remark (`Wattage: XXW`) | extractWatts | high |
| material | remark (`Material: XXX`) / material 字段 | extractLabeledMaterial | medium |
| cri | remark (`CRI: 80`) | extractLabeledCri | high |
| ip | remark | extractIp | high |

### 台灯 Table Lamp（23 产品）

**remark 格式**：
```
Technical Data: TB-A-01 Size: D12*H30 CM Material: Metal with powder coating+Pine bracket Function: ON/OFF Switch online
```

| param_key | 提取源 | 提取方式 | confidence |
|---|---|---|---|
| material | remark (`Material: XXX`) | extractLabeledMaterial | medium |

台灯无功率、无色温、尺寸在 size 字段也是空。主要提取 material。预期覆盖率低。

### 灯管 Tube Light（8 产品）

**remark 格式**：`0.6M`（和 size 重复）。product_name = `8W`, `18W` 等。

| param_key | 提取源 | 提取方式 | confidence |
|---|---|---|---|
| watts | product_name | extractWatts | high |

### Highbay（6 产品）

**remark 格式**：
```
Watt (±5%): 100W
Material: Aluminum+Optical Lens
CCT: 3000K /4000K /6500K
Beam Angle: 90°
IP: 65
```

| param_key | 提取源 | 提取方式 | confidence |
|---|---|---|---|
| watts | remark (`Watt: XXXW`) | extractWatts | high |
| material | remark (`Material: XXX`) | extractLabeledMaterial | medium |
| cct | remark (`CCT: 3000K /4000K /6500K`) | extractLabeledCct | medium |
| beam_angle | remark (`Beam Angle: 90°`) | extractBeamAngles | high |
| ip | remark (`IP: 65`) | extractIp | high |

### 皮线灯 Fairy String Light（3 产品）

**remark 格式**：中文描述（`50珠皮线灯 灯珠距离：10厘米 USB供电`）

| param_key | 提取源 | 提取方式 | confidence |
|---|---|---|---|
| leds_per_meter | remark | 无法提取（`50珠` 不是 per meter） | — |

预期几乎无法提取。跳过品类级定制。只走通用提取（watts from model_no / extractIp 等）。

---

## 通用提取策略

大多数品类可以复用已有的通用提取函数。对于新品类，建议用"通用提取组合"而非每品类都写完整的定制函数：

```ts
function extractGenericParams(product: ProductForExtraction): ExtractedParam[] {
  const params: ExtractedParam[] = [];
  const remark = readSource(product, "remark");
  const modelNo = readSource(product, "model_no");
  const productName = readSource(product, "product_name");
  const combined = `${remark} ${modelNo} ${productName}`;

  params.push(...extractWatts(combined, remark ? "remark" : "model_no"));
  params.push(...extractIp(remark, "remark"));
  params.push(...extractLabeledCct(remark, "remark"));
  params.push(...extractLabeledMaterial(remark, "remark"));
  params.push(...extractLabeledCri(remark, "remark"));
  params.push(...extractBeamAngles(remark, "remark"));
  params.push(...extractLumens(remark, "remark"));
  params.push(...extractVoltage(remark, "remark"));

  return params;
}
```

可以把"品类无特殊规则"的品类（应急灯、庭院灯、皮线灯、灯管）都路由到这个通用函数，只在有特殊规则的品类（灯丝灯、壁灯、Highbay、地埋灯、太阳能壁灯）加定制逻辑。

---

## 灯丝灯特殊：base 提取

灯丝灯的 `base`（灯头类型）是重要参数，现有 `extractBulbParams` 里已有类似逻辑。

从 product_name 提取 `E14`, `E27`, `E26`, `B22`, `GU10`, `GU5.3`, `G9`, `G4`。

正则：`\b(E14|E27|E26|B22|GU10|GU5\.3|MR16|G9|G4)\b`（不区分大小写）。

注意：橱柜灯也有 `MR16`, `GU10` base，可以共用同一个提取函数。

---

## 执行步骤

### Step 1: 备份

```bash
cp prisma/dev.db backups/dev-before-v3.0d-$(date +%Y%m%d-%H%M%S).sqlite
```

### Step 2: 扩展脚本

修改 `scripts/extract-params.ts`：
- 增加 `v3d` target config，包含 12 个品类
- 增加 12 个 case 到 switch
- 新增品类提取函数（灯丝灯、轨道灯、橱柜灯、太阳能壁灯、地埋灯、壁灯、台灯、Highbay）
- 低价值品类（应急灯、庭院灯、灯管、皮线灯）使用通用提取函数
- 新增 `extractBase()` 通用函数

### Step 3: Dry-run

```bash
npx tsx scripts/extract-params.ts --target v3d --report docs/v3.0d-dry-run-report.md
```

检查每品类覆盖率和样本。

### Step 4: Apply

```bash
npx tsx scripts/extract-params.ts --target v3d --apply --report docs/v3.0d-report.md
```

### Step 5: 验证 + 提交

```sql
SELECT p.category, COUNT(DISTINCT pp.id) as params, COUNT(DISTINCT pp.product_id) as products_with_params
FROM product_params pp
JOIN products p ON pp.product_id = p.id
WHERE p.category IN ('灯丝灯','轨道灯','橱柜灯','太阳能壁灯','庭院灯','应急灯','地埋灯/地插灯','壁灯','台灯','灯管','Highbay','皮线灯')
GROUP BY p.category
ORDER BY params DESC;
```

- 所有 26 品类现在都应有 params
- 灯丝灯 / 壁灯 / Highbay 覆盖率应最高
- product_params 总数应从 26,758 增加
- products / supplier_offers / files 不变

```bash
npx tsc --noEmit --pretty false
npm run lint
npm run build
npm test
git add scripts/extract-params.ts src/lib/param-extraction.test.ts docs/v3.0d-report.md docs/v3.0d-dry-run-report.md AGENTS.md docs/HANDOFF.md
git commit -m "V3.0D: extract params for remaining 12 categories"
```

---

## 不做的事

- 不读源 Excel 文件
- 不改 products / supplier_offers / files / price_history
- 不新建品类
- 不改 UI
- 只提 high/medium confidence，不提 low
- 不为源数据极少的品类（应急灯、皮线灯）写复杂定制提取器
