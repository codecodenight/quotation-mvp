# Codex Task: V3.0G — V2.18/V2.18B 新产品参数提取

## 目标

为 V2.18 + V2.18B 新导入的 108 个产品提取结构化参数到 `product_params` 表。

**只从 DB 字段提取。不读源 Excel。不改其他表。**

## 范围

| 品类 | 总产品 | 已有参数 | 无参数 | extractor |
|---|---:|---:|---:|---|
| 投光灯 | 492 | 422 | 70 | extractFloodlightParams ✅ |
| 面板灯 | 902 | 681 | 221 | extractPanelParams ✅ |
| 太阳能壁灯 | 561 | 301 | 260 | extractSolarWallLightParams ✅ |
| 路灯 | 213 | 178 | 35 | extractStreetLightParams ✅ |
| 工作灯 | 97 | 66 | 31 | extractWorkLightParams ✅ |
| Highbay | 43 | 35 | 8 | extractHighbayParams ✅ |
| 充电灯 | 7 | 0 | 7 | **需新建** |

extract-params 是 clear-and-reinsert 模式，会重新提取全部 ~2,315 个产品的参数。已有参数的产品会被清除后重新写入（幂等）。只有无参数的产品会产生净增长。

## 实现方式

扩展 `scripts/extract-params.ts`。

### 1. 新增 `v3g` target config

```typescript
v3g: {
  title: "V3.0G",
  categories: ["充电灯", "投光灯", "面板灯", "太阳能壁灯", "路灯", "工作灯", "Highbay"],
  defaultReport: "docs/v3.0g-dry-run-report.md",
},
```

### 2. 新增 `case "充电灯"` switch entry

```typescript
case "充电灯":
  params.push(...extractChargingLightParams(product));
  break;
```

### 3. 新建 `extractChargingLightParams()` 函数

充电灯 remark 样本：

**R02 系列**（英文结构化）：
```
Material: ABS+PC Beam Angle: 120° PF: / Power: 20W Lumen: 2000LM Warranty: 3Years 产品尺寸(MM): 234*164*30
```

**R07/R08/R09 系列**（中文结构化）：
```
材质: ABS/PA6/POM/PC 色温: 6500K 功率: 8W Warranty: 2 Years 产品尺寸(MM): 95*95*75
```

提取规则（复用现有 extractor 函数）：

| param_key | 提取源 | 提取方式 | confidence |
|---|---|---|---|
| watts | model_no, product_name, remark | extractWatts + extractLabeledWatts | high |
| lumens | remark | extractLumens + extractLumensLoose | medium |
| beam_angle | remark | extractBeamAngles | high |
| cct | remark | extractCct + extractLabeledCct | medium |
| material | remark | extractLabeledMaterial + extractChineseMaterial | medium |
| pf | remark | extractPf | medium |
| voltage | remark | extractVoltage | high |
| size | remark | extractCommonSizeParams | medium |

函数结构参考 `extractWorkLightParams()`：

```typescript
function extractChargingLightParams(product: ProductForExtraction): ExtractedParam[] {
  const params: ExtractedParam[] = [];
  const modelNo = readSource(product, "model_no");
  const productName = readSource(product, "product_name");
  const remark = readSource(product, "remark");

  for (const sourceField of ["model_no", "product_name", "remark"] as SourceField[]) {
    const value = readSource(product, sourceField);
    params.push(...extractWatts(value, sourceField));
  }
  params.push(...extractLabeledWatts(remark, "remark"));

  params.push(...extractVoltage(remark, "remark"));
  params.push(...extractLumens(remark, "remark"));
  params.push(...extractLumensLoose(remark, "remark"));
  params.push(...extractBeamAngles(remark, "remark"));
  params.push(...extractCct(remark, "remark"));
  params.push(...extractLabeledCct(remark, "remark"));
  params.push(...extractLabeledMaterial(remark, "remark"));
  params.push(...extractChineseMaterial(remark, "remark"));
  params.push(...extractPf(remark, "remark"));
  params.push(...extractCommonSizeParams(remark, "remark"));

  return params;
}
```

### 4. 更新错误提示

`readTargetConfig()` 的 throw message 中加入 `--target=v3g`。

## 执行步骤

### Step 1: 备份

```bash
cp prisma/dev.db backups/dev-before-v3.0g-$(date +%Y%m%d-%H%M%S).sqlite
```

### Step 2: 修改脚本

修改 `scripts/extract-params.ts`：
- 增加 `v3g` target config
- 增加 `case "充电灯"` → `extractChargingLightParams(product)`
- 新建 `extractChargingLightParams()` 函数
- 错误提示加入 `--target=v3g`

### Step 3: Dry-run

```bash
npx tsx scripts/extract-params.ts --target v3g --report docs/v3.0g-dry-run-report.md
```

检查：
- 充电灯 7/7 应有提取（watts 100%，其他 >50%）
- 其他 6 品类无参数产品的覆盖率应上升
- product_params before/after 应一致（dry-run 不写 DB）

### Step 4: Apply

```bash
npx tsx scripts/extract-params.ts --target v3g --apply --report docs/v3.0g-report.md
```

### Step 5: 验证 + 提交

```bash
sqlite3 prisma/dev.db "
SELECT p.category, COUNT(DISTINCT p.id) as total,
       COUNT(DISTINCT pp.product_id) as with_params,
       COUNT(DISTINCT pp.id) as param_count
FROM products p
LEFT JOIN product_params pp ON pp.product_id = p.id
WHERE p.category IN ('充电灯','投光灯','面板灯','太阳能壁灯','路灯','工作灯','Highbay')
GROUP BY p.category ORDER BY total DESC;
"
```

期望：
- 充电灯 with_params 从 0 增加到 7
- 其他品类 with_params 增长（新产品获得参数）
- product_params 总数有净增长

```bash
npx tsc --noEmit --pretty false
npm run lint
npm run build
npm test
git add scripts/extract-params.ts docs/v3.0g-report.md docs/v3.0g-dry-run-report.md
git commit -m "V3.0G: extract params for V2.18 outdoor products + new charging light category"
```

## 验收标准

1. 充电灯 7 产品全部有参数提取
2. 其他 6 品类的无参数产品数减少
3. product_params 总数有净增长
4. tsc / lint / build / test 全过

## 不做的事

- 不读源 Excel 文件
- 不改 products / supplier_offers / files / price_history
- 不改已有品类的 extractor 逻辑（充电灯以外的 case 不动）
- 不改 UI
- 不改 Prisma schema
