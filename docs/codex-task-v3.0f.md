# Codex Task: V3.0F — 球泡/灯管参数提取

## 目标

为 V2.17G 新导入的球泡/灯管产品提取结构化参数到 `product_params` 表。

**只从 DB 字段提取。不读源 Excel。不改其他表。**

## 范围

| 品类 | 总产品 | 已有参数 | 无参数 | 说明 |
|---|---:|---:|---:|---|
| 球泡 | 341 | 151 | 190 | `extractBulbParams()` 存在但未接入 switch，且不完整 |
| 灯管 | 84 | 8 | 76 | `extractTubeLightParams()` 逻辑过于简单 |

## 实现方式

扩展 `scripts/extract-params.ts`，新增 `v3f` target config，增强两个提取函数。

### 需要做的改动

1. `TARGET_CATEGORY_CONFIGS` 增加 `v3f` 条目：`categories: ["球泡", "灯管"]`
2. `extractProductParams()` switch 增加 `case "球泡"` → 调用 `extractBulbParams()`
3. 增强 `extractBulbParams()` — 覆盖结构化 remark 字段
4. 增强 `extractTubeLightParams()` — 覆盖结构化 remark 字段
5. 错误提示 throw message 中加入 `--target=v3f`

---

## 球泡 remark 格式分析

### 格式 A：结构化中文（~109 产品）

```
产品规格: A58/58×106mm
电压: 110-130V
功率: 6W
实际功率: 6W±10%
PF: 0.5
显指: 80
套件材质: PAL+PC
包装材质: 350克灰卡
```

### 格式 B：价格表风格（~67 产品）

```
欧标IC新ERP D级 三年质保: ¥3.50
IC 新ERP E级 三年质保: ¥3.35
```

remark 里基本没有参数，但 model_no / product_name 含 watts/base/shape：
- `G45 7W E14/E27`
- `C37/F37 8w E14/E27`
- `LED BULB POWER 30W COLOUR 6500K BASE E27 P.F. 0,9`

### 格式 C：英文结构化（~14 产品）

```
Body Materials: PA body+PC cover
Watts: 9W ±10%
Lumen: >95lm/w
Voltage: AC220-240V
CRI: >80
PF: >0.5
Base: E27
Beam Angle: 220°
```

或：

```
Voltage: 220-240/ 185-265V
CRI: 80
Base: E27
PF: >0.9
CCT: 2700-6500K
Housing Material: Plastic+Aluminum
Beam Angle: 300°
power: 40W土10%
lumen: 4000lm±10%
```

### 球泡提取规则

| param_key | 提取源 | 提取方式 | confidence |
|---|---|---|---|
| watts | model_no, product_name, remark | extractWatts + extractLabeledWatts | high |
| base | model_no, product_name, remark | extractBases + extractLabeledBase | high |
| shape | model_no | 现有正则 `A\d{2,3}\|C3[57]\|G\d{2,3}...` | high |
| voltage | remark | extractVoltage | high |
| cri | remark | extractCri + extractLabeledCri | high |
| pf | remark | extractPf | medium |
| lumens | remark | extractLumens + extractLumensLoose | medium |
| lm_w | remark | extractLmW | medium |
| cct | remark | extractCct + extractLabeledCct | medium |
| material | remark | extractLabeledMaterial + extractChineseMaterial | medium |
| beam_angle | model_no, remark | extractBeamAngles | high |
| dimmable | remark | 现有可调光/不可调光检测 | high |
| size | remark | extractCommonSizeParams | medium |

### 增强后的 `extractBulbParams()`

```typescript
export function extractBulbParams(product: ProductForExtraction): ExtractedParam[] {
  const params: ExtractedParam[] = [];
  const modelNo = readSource(product, "model_no");
  const productName = readSource(product, "product_name");
  const remark = readSource(product, "remark");

  // 从 model_no, product_name, remark 提取 watts 和 base
  for (const sourceField of ["model_no", "product_name", "remark"] as SourceField[]) {
    const value = readSource(product, sourceField);
    params.push(...extractBases(value, sourceField));
    params.push(...extractWatts(value, sourceField));
  }

  // remark labeled watts（"功率: 6W" / "Watts: 9W" / "power: 40W"）
  params.push(...extractLabeledWatts(remark, "remark"));

  // remark labeled base（"Base: E27"）
  params.push(...extractLabeledBase(remark, "remark"));

  // shape 从 model_no
  pushFirstMatch(params, modelNo, /\b(A\d{2,3}|C3[57]\w?|G\d{2,3}|PAR\d{2,3}|R\d{2,3}|T\d{2,3}|BR\d{2,3}|ED\d{2,3})\b/i, {
    paramKey: "shape",
    sourceField: "model_no",
    confidence: "high",
  });

  // dimmable
  const lowerRemark = remark.toLowerCase();
  if (/不可调光|non[-\s]?dim|not\s+dimmable/.test(lowerRemark)) {
    params.push(param("dimmable", "不可调光", "no", null, "remark", "high"));
  } else if (/可调光|dimmable/.test(lowerRemark)) {
    params.push(param("dimmable", "可调光", "yes", null, "remark", "high"));
  }

  // remark 结构化字段
  params.push(...extractVoltage(remark, "remark"));
  params.push(...extractCri(remark, "remark"));
  params.push(...extractLabeledCri(remark, "remark"));
  params.push(...extractPf(remark, "remark"));
  params.push(...extractLumens(remark, "remark"));
  params.push(...extractLumensLoose(remark, "remark"));
  params.push(...extractLmW(remark, "remark"));
  params.push(...extractCct(remark, "remark"));
  params.push(...extractLabeledCct(remark, "remark"));
  params.push(...extractLabeledMaterial(remark, "remark"));
  params.push(...extractChineseMaterial(remark, "remark"));
  params.push(...extractBeamAngles(modelNo, "model_no"));
  params.push(...extractBeamAngles(remark, "remark"));
  params.push(...extractCommonSizeParams(remark, "remark"));

  return params;
}
```

**注意**：现有 `extractBulbParams` 已 export，有测试引用。保持 export 和函数签名不变。

---

## 灯管 remark 格式分析

### 格式 A：lumen 结构化（~33 产品）

```
光通量/lumen: 1200m±10%
实际功率/REAL POWER: 10.8-12W
电压范围/voltage: 100-265V
显指: ≥70
外箱尺寸: 63.6*20*16CM
```

### 格式 B：电压结构化（~22 产品）

```
电压: 180-265V
实际功率: 8.1W
显指: RA70
```

或：

```
光通量: 1800LM±10%
电压: 185-265V
```

### 格式 C：仅箱规（~14 产品）

```
大包装纸箱尺寸: 121
```

几乎无可提取参数。model_no 如 `CFH28101` 也无规律。跳过。

### 格式 D：空 remark（~7 产品）

model_no 如 `T8-18W`、`T5-18W` 可提取 watts。

### 灯管提取规则

| param_key | 提取源 | 提取方式 | confidence |
|---|---|---|---|
| watts | model_no, product_name, remark | extractWatts + extractLabeledWatts | high |
| voltage | remark | extractVoltage | high |
| cri | remark | extractCri + extractLabeledCri | high |
| pf | remark | extractPf | medium |
| lumens | remark | extractLumens + extractLumensLoose | medium |
| cct | remark | extractCct + extractLabeledCct | medium |

### 增强后的 `extractTubeLightParams()`

```typescript
function extractTubeLightParams(product: ProductForExtraction): ExtractedParam[] {
  const params: ExtractedParam[] = [];
  const modelNo = readSource(product, "model_no");
  const productName = readSource(product, "product_name");
  const remark = readSource(product, "remark");

  // watts 从所有字段
  params.push(...extractWatts(modelNo, "model_no"));
  params.push(...extractWatts(productName, "product_name"));
  params.push(...extractWatts(remark, "remark"));
  params.push(...extractLabeledWatts(remark, "remark"));

  // remark 结构化字段
  params.push(...extractVoltage(remark, "remark"));
  params.push(...extractCri(remark, "remark"));
  params.push(...extractLabeledCri(remark, "remark"));
  params.push(...extractPf(remark, "remark"));
  params.push(...extractLumens(remark, "remark"));
  params.push(...extractLumensLoose(remark, "remark"));
  params.push(...extractCct(remark, "remark"));
  params.push(...extractLabeledCct(remark, "remark"));

  return params;
}
```

---

## 执行步骤

### Step 1: 备份

```bash
cp prisma/dev.db backups/dev-before-v3.0f-$(date +%Y%m%d-%H%M%S).sqlite
```

### Step 2: 修改脚本

修改 `scripts/extract-params.ts`：
- 增加 `v3f` target config
- 增加 `case "球泡"` → `extractBulbParams(product)`
- 增强 `extractBulbParams()` 函数体（保持 export + 签名不变）
- 增强 `extractTubeLightParams()` 函数体
- 错误提示加入 `--target=v3f`

### Step 3: Dry-run

```bash
npx tsx scripts/extract-params.ts --target v3f --report docs/v3.0f-dry-run-report.md
```

检查：
- 球泡 190 个无参数产品中大部分应有提取
- 灯管 76 个无参数产品中 ~55 个应有提取（14 carton-only + 7 empty 可能无参数）
- 格式 B（价格表风格）球泡至少应从 model_no/product_name 提取 watts/base

### Step 4: Apply

```bash
npx tsx scripts/extract-params.ts --target v3f --apply --report docs/v3.0f-report.md
```

### Step 5: 验证 + 提交

```bash
sqlite3 prisma/dev.db "
SELECT p.category, COUNT(DISTINCT pp.id) as params, COUNT(DISTINCT pp.product_id) as products_with_params
FROM product_params pp
JOIN products p ON pp.product_id = p.id
WHERE p.category IN ('球泡', '灯管')
GROUP BY p.category;
"
```

期望：
- 球泡 products_with_params 从 151 增加（目标 300+）
- 灯管 products_with_params 从 8 增加（目标 50+）
- product_params 总数从 35,443 增加

```bash
npx tsc --noEmit --pretty false
npm run lint
npm run build
npm test
git add scripts/extract-params.ts docs/v3.0f-report.md docs/v3.0f-dry-run-report.md
git commit -m "V3.0F: extract params for bulb and tube products"
```

---

## 不做的事

- 不读源 Excel 文件
- 不改 products / supplier_offers / files / price_history
- 不新建品类
- 不改 UI
- 不改已有品类的 extractor 逻辑（球泡/灯管以外的 case 不动）
