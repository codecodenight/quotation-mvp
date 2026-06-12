# Codex Task: V3.0E — Batch 3 产品参数提取

## 目标

对 V2.14 Batch 3 新导入的产品 + 3 个全新品类提取结构化参数到 `product_params` 表。

**只从 DB 字段提取。不读源 Excel。不改其他表。**

## 范围

16 个品类，1,867 个无参数产品需要提取：

| 品类 | 总产品 | 已有参数 | 无参数 | 提取来源 |
|---|---:|---:|---:|---|
| 太阳能壁灯 | 555 | 85 | 470 | v3d 已有 extractor |
| 风扇灯 | 264 | 0 | 264 | **新品类，需新 extractor** |
| 壁灯 | 290 | 27 | 263 | v3d 已有 extractor |
| 线条灯 | 1,123 | 977 | 146 | v3b 已有 extractor |
| 太阳能 | 310 | 173 | 137 | v3a 已有 extractor |
| 皮线灯 | 138 | 3 | 135 | v3d 已有 extractor |
| 灯丝灯 | 579 | 471 | 108 | v3d 已有 extractor |
| 工作灯 | 85 | 0 | 85 | **新品类，需新 extractor** |
| 橱柜灯 | 204 | 132 | 72 | v3d 已有 extractor |
| G4G9 | 51 | 0 | 51 | **新品类，需新 extractor** |
| Highbay | 40 | 6 | 34 | v3d 已有 extractor |
| 地埋灯/地插灯 | 87 | 56 | 31 | v3d 已有 extractor |
| 庭院灯 | 79 | 53 | 26 | v3d 已有 extractor |
| 应急灯 | 87 | 68 | 19 | v3d 已有 extractor |
| 轨道灯 | 169 | 155 | 14 | v3d 已有 extractor |
| 台灯 | 31 | 19 | 12 | v3d 已有 extractor |

## 实现方式

**扩展现有 `scripts/extract-params.ts`**，新增 `v3e` target config。

### 需要做的改动

1. `TARGET_CATEGORY_CONFIGS` 增加 `v3e` 条目，包含全部 16 个品类
2. `extractProductParams()` switch 增加 3 个新 case（风扇灯、工作灯、G4G9）
3. 新增 3 个品类提取函数
4. 现有 13 个品类用已有 extractor（v3a/b/c/d），不改

### 脚本行为

v3e target 处理所有 16 个品类的全部产品（包括已有参数的）。脚本会先清除目标产品的旧参数再重新提取，这对已有参数的产品是幂等的（同一 extractor + 同一数据 = 同一结果）。

---

## 3 个新品类提取规则

### 风扇灯 Fan Light（264 产品）

**remark 格式 A**（~18 产品，"CCT: 5%"类）：
```
CCT: 5%
CCT+RGB: 9%
```
→ 这是**价格浮动百分比**，不是色温。不要提取为 CCT。

**remark 格式 B**（~246 产品，Product Details 长文本）：
```
Product Details: Size:φ500mm Color:black Material:PC+PS+HIPS 
Motor Power:20W Lamp power:48W Lumen:2200LM±10% 
433 Remote Control Stepless dimming Six-speed speed adjustment
```

有些含 `Voltage：100-265V`。

| param_key | 提取源 | 提取方式 | confidence | 备注 |
|---|---|---|---|---|
| watts | remark (`Lamp power:48W` / 通用 `XXW`) | extractWatts | high | 会同时提取 Motor Power，dedup 保留第一个 |
| lumens | remark (`Lumen:2200LM`) | extractLumens | medium | |
| material | remark (`Material:PC+PS+HIPS`) | extractLabeledMaterial | medium | |
| voltage | remark (`Voltage：100-265V`) | extractVoltage | high | |
| color | remark (`Color:black`) | 正则 `Color\s*[:：]\s*([^,\s]+(?:\/[^,\s]+)*)` | medium | 新 param_key |

**注意**：风扇灯 remark 中 "CCT: 5%" 不是色温。但 extractCct 匹配 `\d{4}K` 格式，"5%" 不会匹配，所以**不需要特殊过滤**——通用提取自然跳过。

### 工作灯 Work Light（85 产品）

**remark 格式 A**（~16 产品，结构化中英文）：
```
灯体尺寸 Size (mm): 115*110*27
描述 Description: Material: Aluminium body +Plastic cover+Iron bracket 
  View angle:120° Color Temp: 3000k/4000k /6000k 
  Cable: 1.5M H07RN-F 3G*1.0mm² cable + plug
标称功率Wattage (±10%）: 20w
电压Voltage/Hz: AC220-240V 50/60Hz
显指CRI: >80
光效Lumens (±10%）: 90LM/W
驱动 Driver: Linear 线性
```

**remark 格式 B**（~53 产品，简洁 Key:Value）：
```
Material: Alu+PC
CCT: 6500K
Beam Angle: 90°
Warranty: 2 years
```

| param_key | 提取源 | 提取方式 | confidence |
|---|---|---|---|
| watts | remark (`Wattage: 20w`) | extractLabeledWatts + extractWatts | high |
| voltage | remark (`AC220-240V`) | extractVoltage | high |
| cri | remark (`CRI: >80`) | extractLabeledCri + extractCri | high |
| luminous_efficacy | remark (`90LM/W`) | extractLmW | medium |
| beam_angle | remark (`View angle:120°` / `Beam Angle: 90°`) | extractBeamAngles | high |
| material | remark (`Material: Aluminium...` / `Material: Alu+PC`) | extractLabeledMaterial | medium |
| cct | remark (`CCT: 6500K` / `Color Temp: 3000k/4000k/6000k`) | extractLabeledCct + extractCct | medium |
| ip | remark | extractIp | high |
| warranty | remark (`Warranty: 2 years`) | extractWarranty | medium |

工作灯数据质量很好，大部分通用提取器直接可用。

### G4G9 光源（51 产品）

**remark 格式**（高度结构化，几乎全部产品）：
```
Rated wattage(W): 3
Lumen [lm]: 3000K=330LM 4000K=350LM 6500K=350LM
CRI: Ra>80
CCT[K]: 2700K 3000K 4000K 6500K
Base: G9
Material: thermal conductive plastic
```

| param_key | 提取源 | 提取方式 | confidence |
|---|---|---|---|
| watts | remark (`Rated wattage(W): 3`) | extractLabeledWatts | high |
| lumens | remark (`330LM`) | extractLumens | medium |
| cri | remark (`CRI: Ra>80`) | extractLabeledCri | high |
| cct | remark (`2700K 3000K 4000K 6500K`) | extractCct | medium |
| base | remark (`Base: G9`) / product_name | extractBases + 新 `extractLabeledBase` | high |
| material | remark (`Material: thermal conductive plastic`) | extractLabeledMaterial | medium |

**注意**：`Lumen [lm]: 3000K=330LM 4000K=350LM 6500K=350LM` 格式特殊——每个色温对应不同 lumen 值。extractLumens 会提取第一个匹配（330LM），这是可接受的。

---

## 新增提取函数

### extractLabeledBase（新通用函数）

G4G9 的 remark 有 `Base: G9`。现有 `extractBases` 从 product_name/model_no 提取裸 base 值，但不匹配 `Base:` label。

```typescript
function extractLabeledBase(value: string, sourceField: SourceField): ExtractedParam[] {
  const params: ExtractedParam[] = [];
  const match = value.match(/Base\s*[:：]\s*(E14|E27|E26|B22|GU10|GU5\.3|MR16|G9|G4|R7S)\b/i);
  if (match) {
    params.push(param("base", match[0], match[1].toUpperCase(), null, sourceField, "high"));
  }
  return params;
}
```

### 风扇灯提取函数

```typescript
function extractFanLightParams(product: ProductForExtraction): ExtractedParam[] {
  const params: ExtractedParam[] = [];
  const remark = readSource(product, "remark");
  const modelNo = readSource(product, "model_no");
  const productName = readSource(product, "product_name");

  params.push(...extractWatts(remark, "remark"));
  params.push(...extractLabeledWatts(remark, "remark"));
  params.push(...extractWatts(modelNo, "model_no"));
  params.push(...extractLumens(remark, "remark"));
  params.push(...extractLabeledMaterial(remark, "remark"));
  params.push(...extractVoltage(remark, "remark"));
  params.push(...extractIp(remark, "remark"));
  params.push(...extractCct(remark, "remark"));
  params.push(...extractLabeledCct(remark, "remark"));

  return params;
}
```

### 工作灯提取函数

```typescript
function extractWorkLightParams(product: ProductForExtraction): ExtractedParam[] {
  const params: ExtractedParam[] = [];
  const remark = readSource(product, "remark");
  const modelNo = readSource(product, "model_no");
  const productName = readSource(product, "product_name");

  params.push(...extractWatts(remark, "remark"));
  params.push(...extractLabeledWatts(remark, "remark"));
  params.push(...extractWatts(modelNo, "model_no"));
  params.push(...extractVoltage(remark, "remark"));
  params.push(...extractCri(remark, "remark"));
  params.push(...extractLabeledCri(remark, "remark"));
  params.push(...extractLmW(remark, "remark"));
  params.push(...extractBeamAngles(remark, "remark"));
  params.push(...extractLabeledMaterial(remark, "remark"));
  params.push(...extractCct(remark, "remark"));
  params.push(...extractLabeledCct(remark, "remark"));
  params.push(...extractIp(remark, "remark"));
  params.push(...extractWarranty(remark, "remark"));
  params.push(...extractCertification(remark, "remark"));

  return params;
}
```

### G4G9 提取函数

```typescript
function extractG4G9Params(product: ProductForExtraction): ExtractedParam[] {
  const params: ExtractedParam[] = [];
  const remark = readSource(product, "remark");
  const modelNo = readSource(product, "model_no");
  const productName = readSource(product, "product_name");

  params.push(...extractLabeledWatts(remark, "remark"));
  params.push(...extractWatts(remark, "remark"));
  params.push(...extractWatts(modelNo, "model_no"));
  params.push(...extractLumens(remark, "remark"));
  params.push(...extractCri(remark, "remark"));
  params.push(...extractLabeledCri(remark, "remark"));
  params.push(...extractCct(remark, "remark"));
  params.push(...extractLabeledCct(remark, "remark"));
  params.push(...extractLabeledBase(remark, "remark"));
  params.push(...extractBases(productName, "product_name"));
  params.push(...extractBases(modelNo, "model_no"));
  params.push(...extractLabeledMaterial(remark, "remark"));
  params.push(...extractVoltage(remark, "remark"));

  return params;
}
```

---

## 执行步骤

### Step 1: 备份

```bash
cp prisma/dev.db backups/dev-before-v3.0e-$(date +%Y%m%d-%H%M%S).sqlite
```

### Step 2: 扩展脚本

修改 `scripts/extract-params.ts`：
- 增加 `v3e` target config（16 个品类）
- 增加 3 个新 case 到 switch（风扇灯、工作灯、G4G9）
- 新增 `extractFanLightParams`、`extractWorkLightParams`、`extractG4G9Params`
- 新增 `extractLabeledBase` 通用函数
- 现有品类 case 已存在，不需改

### Step 3: Dry-run

```bash
npx tsx scripts/extract-params.ts --target v3e --report docs/v3.0e-dry-run-report.md
```

### Step 4: Apply

```bash
npx tsx scripts/extract-params.ts --target v3e --apply --report docs/v3.0e-report.md
```

### Step 5: 验证 + 提交

```sql
SELECT p.category, COUNT(DISTINCT pp.id) as params, COUNT(DISTINCT pp.product_id) as products_with_params
FROM product_params pp
JOIN products p ON pp.product_id = p.id
WHERE p.category IN ('风扇灯','工作灯','G4G9','太阳能壁灯','Highbay','壁灯','皮线灯','应急灯','地埋灯/地插灯','太阳能','橱柜灯','灯丝灯','线条灯','庭院灯','台灯','轨道灯')
GROUP BY p.category
ORDER BY params DESC;
```

- 风扇灯 / 工作灯 / G4G9 应有参数
- 其他 13 品类的覆盖产品数应增加
- product_params 总数应从 31,923 增加
- 29 品类全部应有 params

```bash
npx tsc --noEmit --pretty false
npm run lint
npm run build
npm test
git add scripts/extract-params.ts src/lib/param-extraction.test.ts docs/v3.0e-report.md docs/v3.0e-dry-run-report.md AGENTS.md docs/HANDOFF.md
git commit -m "V3.0E: extract params for Batch 3 products + 3 new categories"
```

---

## 不做的事

- 不读源 Excel 文件
- 不改 products / supplier_offers / files / price_history
- 不新建品类
- 不改 UI
- 不改已有品类的 extractor 逻辑
