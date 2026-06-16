# V10.9 — product_name / model_no 深度参数提取

## 目标

当前 `v10.4-derive-params.ts` 只从 product_name/model_no 提取 **watts** 和派生 **luminous_efficacy**。但大量产品名中还包含：

- IP 等级（`IP44`, `IP65`, `Protection：IP65`, `Waterproof rate：IP44`）
- CRI（`RA80`, `RA70`, `Ra>80`, `显指＞80`）
- CCT（`5000K`, `6500K`, `2700-6500K`, `3000K/6500K`, `Color temperature：5000K`）
- 流明（`500lm`, `800lm`, `Luminous flux：500lm`, `1440LM`）
- 光束角（`120°`, `90º`, `60度`, `Baem:90º`）
- 电压（`AC100-240V`, `220-240V`, `DC12V`, `DC24V`）
- 驱动类型（`DOB`, `恒流IC驱动`, `DOB恒流IC驱动`, `非隔离`）
- 材料（`压铸铝`, `ABS+PC`, `PC+ABS`, `铝`, `Aluminum`, `stainless steel`）

特别是太阳能灯/庭院灯品类有 ~46 个产品，product_name 是完整规格描述（如 `Material：ABS+PC ... Protection：IP65 ... Color temperature：5000K RA70`），几乎所有参数都能提取。

预估新增：**500-700 条参数**。

## 前置

```bash
cp prisma/dev.db prisma/dev.db.bak-v10.9
```

**必须在 V10.8 之后运行**（管线已在 V10.8 末尾跑过一轮）。

---

## 新建文件：`scripts/v10.9-name-deep-extract.ts`

```bash
npx tsx scripts/v10.9-name-deep-extract.ts              # dry-run
npx tsx scripts/v10.9-name-deep-extract.ts --apply       # 写入
```

### 核心思路

遍历所有 products，对每个产品的 product_name 和 model_no 尝试提取每种参数。只写入该产品尚缺的 param_key。INSERT-only，不删不改。

### 数据加载

```typescript
const products = await prisma.product.findMany({
  select: { id: true, modelNo: true, productName: true, category: true },
});

// 加载所有已有参数，构建 Set
const existingParams = await prisma.productParam.findMany({
  select: { productId: true, paramKey: true },
});
const existingSet = new Set(existingParams.map(p => `${p.productId}\0${p.paramKey}`));
```

### 提取规则

对每个产品，依次尝试提取以下参数（只写入 existingSet 中不存在的）：

```typescript
interface ExtractedParam {
  paramKey: string;
  rawValue: string;
  normalizedValue: string;
  unit: string | null;
}

function extractParamsFromName(name: string): ExtractedParam[] {
  const params: ExtractedParam[] = [];
  if (!name) return params;

  // === 1. IP 等级 ===
  // 匹配: "IP44", "IP65", "IP20", "Protection：IP65", "Waterproof rate：IP44"
  const ipMatch = name.match(/IP\s*(\d{2})\b/i);
  if (ipMatch) {
    params.push({
      paramKey: "ip",
      rawValue: `IP${ipMatch[1]}`,
      normalizedValue: ipMatch[1],
      unit: null,
    });
  }

  // === 2. CRI ===
  // 匹配: "RA80", "RA70", "Ra>80", "Ra≥80", "显指＞80", "CRI>80", "CRI 80"
  const criPatterns = [
    /\bRA\s*[>≥]?\s*(\d{2})\b/i,
    /\bCRI\s*[>≥]?\s*(\d{2,3})\b/i,
    /显指\s*[>≥＞]\s*(\d{2})\b/,
    /显色指数\s*[>≥＞]?\s*(\d{2})\b/,
  ];
  for (const pat of criPatterns) {
    const m = name.match(pat);
    if (m) {
      const val = parseInt(m[1]);
      if (val >= 60 && val <= 100) {
        params.push({
          paramKey: "cri",
          rawValue: m[0].trim(),
          normalizedValue: String(val),
          unit: null,
        });
        break;
      }
    }
  }

  // === 3. CCT（色温）===
  // 匹配: "5000K", "6500K", "2700-6500K", "3000K/6500K", "Color temperature：5000K"
  // 范围型
  const cctRangeMatch = name.match(/(\d{4})\s*[-~–\/]\s*(\d{4})\s*K\b/i);
  if (cctRangeMatch) {
    const k1 = parseInt(cctRangeMatch[1]), k2 = parseInt(cctRangeMatch[2]);
    if (k1 >= 1800 && k2 <= 10000) {
      params.push({
        paramKey: "cct",
        rawValue: `${k1}-${k2}K`,
        normalizedValue: `${k1}-${k2}`,
        unit: "K",
      });
    }
  } else {
    // 单值型: "5000K", "6500K"（但排除电池电压之类的假阳性）
    const cctSingleMatch = name.match(/(?:color\s*temperature|色温)[：:]\s*(\d{4})\s*K/i)
      || name.match(/\b(\d{4})\s*K\b/i);
    if (cctSingleMatch) {
      const k = parseInt(cctSingleMatch[1]);
      if (k >= 1800 && k <= 10000) {
        params.push({
          paramKey: "cct",
          rawValue: `${k}K`,
          normalizedValue: String(k),
          unit: "K",
        });
      }
    }
  }

  // === 4. Lumens ===
  // 匹配: "500lm", "800LM", "1440LM", "Luminous flux：500lm", "450lm"
  // 排除: "lm/w"（那是光效不是流明）, "22 lm"（可能是 lm/LED）
  const lumensPatterns = [
    /Luminous\s*flux[：:]\s*(\d+)\s*lm/i,
    /(?<![\/])\b(\d{2,6})\s*LM\b(?!\s*\/\s*W)/i,
    /(\d{2,6})\s*流明/,
  ];
  for (const pat of lumensPatterns) {
    const m = name.match(pat);
    if (m) {
      const val = parseInt(m[1]);
      // 排除太小的值（可能是 lm/LED）和太大的值
      if (val >= 50 && val <= 100000) {
        params.push({
          paramKey: "lumens",
          rawValue: m[0].trim(),
          normalizedValue: String(val),
          unit: "lm",
        });
        break;
      }
    }
  }

  // === 5. 光束角 ===
  // 匹配: "120°", "90º", "60度", "Baem:90º", "beam angle 120"
  const beamPatterns = [
    /[Bb](?:a|ea)m[^a-zA-Z]*?(\d{1,3})\s*[°º]/,
    /\b(\d{1,3})\s*[°º]\b/,
    /(\d{1,3})\s*度(?!电)/,
  ];
  for (const pat of beamPatterns) {
    const m = name.match(pat);
    if (m) {
      const val = parseInt(m[1]);
      // 合理的 beam angle 范围: 10-360
      if (val >= 10 && val <= 360) {
        params.push({
          paramKey: "beam_angle",
          rawValue: m[0].trim(),
          normalizedValue: String(val),
          unit: "°",
        });
        break;
      }
    }
  }

  // === 6. 输入电压 ===
  // 匹配: "AC100-240V", "220-240V", "AC220V", "DC12V", "DC24V"
  // 排除: 电池电压 "DC3.2V", "3.7V"（太低，非输入电压）
  const voltagePatterns = [
    /\b(?:AC|Input[：:]?\s*AC?)\s*(\d{2,3})\s*[-~–]\s*(\d{2,3})\s*V/i,
    /\b(\d{2,3})\s*[-~–]\s*(\d{2,3})\s*V\b(?!.*battery)/i,
    /\bAC\s*(\d{3})\s*V\b/i,
    /\bDC\s*(\d{2})\s*V\b/i,
  ];
  for (const pat of voltagePatterns) {
    const m = name.match(pat);
    if (m) {
      if (m[2]) {
        // 范围型
        const v1 = parseInt(m[1]), v2 = parseInt(m[2]);
        if (v1 >= 12 && v2 <= 480) {
          params.push({
            paramKey: "voltage",
            rawValue: m[0].trim(),
            normalizedValue: `${v1}-${v2}`,
            unit: "V",
          });
          break;
        }
      } else {
        // 单值型
        const v = parseInt(m[1]);
        if (v >= 12 && v <= 480) {
          params.push({
            paramKey: "voltage",
            rawValue: m[0].trim(),
            normalizedValue: String(v),
            unit: "V",
          });
          break;
        }
      }
    }
  }

  // === 7. 驱动类型 ===
  // 匹配: "DOB", "恒流IC驱动", "DOB恒流IC驱动", "非隔离", "隔离"
  if (/\bDOB\b/i.test(name)) {
    params.push({ paramKey: "driver_type", rawValue: "DOB", normalizedValue: "DOB", unit: null });
  } else if (/非隔离/.test(name)) {
    params.push({ paramKey: "driver_type", rawValue: "非隔离", normalizedValue: "非隔离", unit: null });
  } else if (/隔离/.test(name) && !/非隔离/.test(name)) {
    params.push({ paramKey: "driver_type", rawValue: "隔离", normalizedValue: "隔离", unit: null });
  } else if (/恒流/.test(name)) {
    params.push({ paramKey: "driver_type", rawValue: "恒流", normalizedValue: "恒流", unit: null });
  }

  // === 8. 材料 ===
  // 匹配: "压铸铝", "铝材", "ABS+PC", "PC+ABS", "Aluminum", "stainless steel"
  // 优先匹配 "Material：" 格式
  const materialKV = name.match(/Material[：:]\s*([^\n,]{2,30}?)(?=\s+(?:Color|Panel|Solar|Battery|LED|Luminous|Protection|Induction|Charging|Warranty|Lighting|Waterproof|Diffuser|switch|Fit|With|Radar)|$)/i);
  if (materialKV) {
    params.push({
      paramKey: "material",
      rawValue: materialKV[1].trim(),
      normalizedValue: materialKV[1].trim(),
      unit: null,
    });
  } else {
    const matPatterns: [RegExp, string][] = [
      [/压铸铝/, "压铸铝"],
      [/铝[材合]/, "铝"],
      [/\bABS\s*\+\s*PC\b/i, "ABS+PC"],
      [/\bPC\s*\+\s*ABS\b/i, "PC+ABS"],
      [/\bAluminum\b/i, "Aluminum"],
      [/\bstainless\s+steel\b/i, "Stainless Steel"],
    ];
    for (const [pat, norm] of matPatterns) {
      if (pat.test(name)) {
        params.push({ paramKey: "material", rawValue: norm, normalizedValue: norm, unit: null });
        break;
      }
    }
  }

  // === 9. 光效（luminous_efficacy）===
  // 匹配: "100lm/w", "80-90LM/W", "110LM/W"
  // 当前 derive 不从 name 提取光效
  const efficacyMatch = name.match(/(\d+(?:\.\d+)?)\s*(?:[-~–]\s*\d+)?\s*LM\s*\/\s*W/i);
  if (efficacyMatch) {
    params.push({
      paramKey: "luminous_efficacy",
      rawValue: efficacyMatch[0].trim(),
      normalizedValue: efficacyMatch[1],
      unit: "lm/W",
    });
  }

  return params;
}
```

### 重要排除规则

```typescript
function shouldSkipExtraction(product: ProductRow, paramKey: string, value: string): boolean {
  // 电池电压不是产品输入电压
  if (paramKey === "voltage") {
    const name = product.productName;
    // 检查匹配值附近是否有电池相关词
    const idx = name.indexOf(value);
    if (idx >= 0) {
      const context = name.substring(Math.max(0, idx - 30), idx + value.length + 30);
      if (/battery|电池|充电|NI-MH|lithium|LiFePO4|18650|14500/i.test(context)) {
        return true;
      }
    }
  }

  // 太阳能面板功率不是灯具功率（不影响本脚本，watts 已在 derive 中处理）

  // "度" 后面跟 "电" 是用电量不是角度
  if (paramKey === "beam_angle" && /度电/.test(value)) {
    return true;
  }

  return false;
}
```

### 写入逻辑

```typescript
const plannedParams: Array<{
  productId: string;
  paramKey: string;
  rawValue: string;
  normalizedValue: string;
  unit: string | null;
  sourceField: string;
  confidence: string;
}> = [];

for (const product of products) {
  const nameParams = extractParamsFromName(product.productName);
  const modelParams = product.modelNo ? extractParamsFromName(product.modelNo) : [];

  // 合并，name 优先
  const allParams = [...nameParams];
  for (const mp of modelParams) {
    if (!allParams.some(p => p.paramKey === mp.paramKey)) {
      allParams.push(mp);
    }
  }

  for (const param of allParams) {
    const key = `${product.id}\0${param.paramKey}`;
    if (existingSet.has(key)) continue;
    if (shouldSkipExtraction(product, param.paramKey, param.rawValue)) continue;

    plannedParams.push({
      productId: product.id,
      paramKey: param.paramKey,
      rawValue: param.rawValue,
      normalizedValue: param.normalizedValue,
      unit: param.unit,
      sourceField: "product_name",
      confidence: "medium",
    });
    existingSet.add(key);
  }
}
```

### 批量写入

```typescript
if (APPLY_MODE && plannedParams.length > 0) {
  const BATCH = 500;
  for (let i = 0; i < plannedParams.length; i += BATCH) {
    const batch = plannedParams.slice(i, i + BATCH);
    await prisma.$executeRawUnsafe(
      `INSERT INTO product_params (id, product_id, param_key, raw_value, normalized_value, unit, source_field, confidence)
       VALUES ${batch.map(() => "(?, ?, ?, ?, ?, ?, ?, ?)").join(", ")}`,
      ...batch.flatMap(p => [
        randomUUID(), p.productId, p.paramKey, p.rawValue, p.normalizedValue, p.unit, p.sourceField, p.confidence,
      ])
    );
  }
}
```

---

## 报告：`docs/v10.9-name-extract-report.md`

```markdown
# V10.9 product_name 深度参数提取报告

模式: dry-run / apply
时间: ...

## 汇总

| 指标 | 数值 |
|---|---:|
| 扫描产品数 | X |
| 含可提取参数的产品 | X |
| 新增参数 | X |
| 跳过（已存在） | X |
| 跳过（排除规则） | X |
| product_params 变化 | 前 → 后 |

## 按 param_key 统计

| param_key | 新增记录 | 覆盖产品数 | 已有总数 → 新总数 |
|---|---:|---:|---:|
| ip | X | X | 794 → X |
| cri | X | X | 1,282 → X |
| cct | X | X | 2,794 → X |
| lumens | X | X | 1,516 → X |
| beam_angle | X | X | 551 → X |
| voltage | X | X | 2,551 → X |
| driver_type | X | X | 326 → X |
| material | X | X | 2,369 → X |
| luminous_efficacy | X | X | 1,813 → X |

## 按品类统计

| 品类 | 含可提取参数产品 | 新增参数 | 主要提取项 |

## 采样（前 50 条）

| 产品名 | param_key | 提取值 | source |
```

---

## 重跑管线

V10.9 提取完后，重跑 derive（可能有新的 watts 可用于派生 efficacy）和 audit：

```bash
npx tsx scripts/v10.9-name-deep-extract.ts --apply
npx tsx scripts/v10.4-derive-params.ts --apply
npx tsx scripts/v10.0-source-audit.ts
```

---

## Commit

```
V10.9: deep extract params from product_name (ip, cri, cct, lumens, beam_angle, voltage, material, driver_type, efficacy)

- New v10.9-name-deep-extract.ts: parse 9 param types from product names
- Handles structured specs (Protection：IP65) and inline values (120°, RA80)
- Context-aware exclusions (battery voltage ≠ input voltage)
- Re-run derive and audit for final coverage
```

## 不做什么

- 不改 v10.4-derive-params.ts（避免冲突）
- 不改 v10.1 backfill
- 不改 v10.6/v10.8 脚本
- 不改 Prisma schema
- 不改前端
- 不删除现有产品或参数
- 不提取 watts（v10.4 已处理）
