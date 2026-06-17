# V11.4 — 标题行全 sheet 参数提取

## 背景

很多 Excel 文件在表头行之前有 1-3 行标题/描述行，包含适用于整个 sheet 所有产品的参数：

```
Row 0: "合金小面板灯参数报价表 LED Panel Light Price"
Row 1: "客户名称："
Row 2: "非隔离窄压驱动Not isolation drive ，LED:2835 22-24 lm ,GLASS/PS/PMMA导光板"
Row 3: [headers...]
```

Row 2 包含 driver_type（非隔离）、luminous_efficacy 线索（22-24 lm per LED）、material（GLASS/PS/PMMA）。这些参数应写给该 sheet 下的所有已匹配产品。

V10.8 已从 sheet 名提取 driver_type/voltage/ip。本任务从**标题行文本**中提取更多参数。

## 前置

```bash
cp prisma/dev.db prisma/dev.db.bak-v11.4
```

## 新建文件：`scripts/v11.4-title-row-extract.ts`

```bash
npx tsx scripts/v11.4-title-row-extract.ts              # dry-run
npx tsx scripts/v11.4-title-row-extract.ts --apply       # 写入
```

### 算法

#### 1. 标题行识别

表头行之前的所有非空行都是标题行候选。识别表头行后，收集 row 0 到 headerRow-1 的所有文本：

```typescript
function collectTitleText(rows: unknown[][], headerRowIndex: number): string {
  const texts: string[] = [];
  for (let i = 0; i < headerRowIndex; i++) {
    const row = rows[i] ?? [];
    for (const cell of row) {
      const val = cellToString(cell);
      if (val && val.length > 3) texts.push(val);
    }
  }
  return texts.join(" ");
}
```

#### 2. 参数提取正则

从合并后的标题文本中提取参数：

```typescript
function extractTitleParams(titleText: string): TitleParam[] {
  const params: TitleParam[] = [];
  const seen = new Set<string>();
  const add = (p: TitleParam) => { if (!seen.has(p.paramKey)) { seen.add(p.paramKey); params.push(p); } };

  // driver_type
  if (/非隔离/.test(titleText)) {
    add({ paramKey: "driver_type", rawValue: "非隔离", normalizedValue: "非隔离", unit: null });
  } else if (/隔离/.test(titleText) && !/非隔离/.test(titleText)) {
    add({ paramKey: "driver_type", rawValue: "隔离", normalizedValue: "隔离", unit: null });
  }
  if (/\bDOB\b/i.test(titleText)) {
    add({ paramKey: "driver_type", rawValue: "DOB", normalizedValue: "DOB", unit: null });
  }
  if (/恒流IC/i.test(titleText)) {
    add({ paramKey: "driver_type", rawValue: "恒流IC", normalizedValue: "恒流IC", unit: null });
  }

  // voltage: "220-240V", "AC220V", "165-265V"
  const voltMatch = titleText.match(/(?:AC\s*)?(\d{2,3})\s*[-~–]\s*(\d{2,3})\s*V/i);
  if (voltMatch) {
    add({ paramKey: "voltage", rawValue: `${voltMatch[1]}-${voltMatch[2]}V`, 
          normalizedValue: `${voltMatch[1]}-${voltMatch[2]}`, unit: "V" });
  } else {
    const singleVolt = titleText.match(/(?:AC\s*)?(\d{2,3})\s*V(?:\b|[^a-zA-Z])/i);
    if (singleVolt && Number(singleVolt[1]) >= 12) {
      add({ paramKey: "voltage", rawValue: `${singleVolt[1]}V`,
            normalizedValue: singleVolt[1], unit: "V" });
    }
  }

  // ip: "IP65", "IP20", "IP44"
  const ipMatch = titleText.match(/IP\s*(\d{2})/i);
  if (ipMatch) {
    add({ paramKey: "ip", rawValue: `IP${ipMatch[1]}`, normalizedValue: ipMatch[1], unit: null });
  }

  // cri: "Ra>80", "Ra≥80", "CRI>80", "显指>80"
  const criMatch = titleText.match(/(?:Ra|CRI|显指)\s*[>≥]\s*(\d{2})/i);
  if (criMatch) {
    add({ paramKey: "cri", rawValue: `Ra>${criMatch[1]}`, normalizedValue: criMatch[1], unit: null });
  }

  // pf: "PF>0.5", "PF≥0.9", "功率因数>0.5"
  const pfMatch = titleText.match(/(?:PF|功率因[数素])\s*[>≥]\s*(0\.\d+)/i);
  if (pfMatch) {
    add({ paramKey: "pf", rawValue: `PF>${pfMatch[1]}`, normalizedValue: pfMatch[1], unit: null });
  }

  // material: "GLASS/PS/PMMA导光板", "铝+PC", "全塑", "压铸铝"
  const materialPatterns: Array<[RegExp, string]> = [
    [/压铸铝/i, "压铸铝"],
    [/全塑/i, "全塑"],
    [/铝\+?PC/i, "铝+PC"],
    [/PC\+?铝/i, "铝+PC"],
    [/全铝/i, "全铝"],
    [/不锈钢/i, "不锈钢"],
  ];
  for (const [pattern, value] of materialPatterns) {
    if (pattern.test(titleText)) {
      add({ paramKey: "material", rawValue: value, normalizedValue: value, unit: null });
      break;
    }
  }

  // cct: "3000K", "2700-6500K", "三色" (= 3000/4000/6500K)
  const cctMatch = titleText.match(/(\d{4})\s*[-~–]\s*(\d{4})\s*K/i);
  if (cctMatch) {
    add({ paramKey: "cct", rawValue: `${cctMatch[1]}-${cctMatch[2]}K`,
          normalizedValue: `${cctMatch[1]}-${cctMatch[2]}`, unit: "K" });
  }
  if (/三色|3\s*CCT|tri-?color/i.test(titleText) && !seen.has("cct")) {
    add({ paramKey: "cct", rawValue: "三色", normalizedValue: "3000/4000/6500", unit: "K" });
  }

  // certification: "CE", "SAA", "CB"
  const certMatch = titleText.match(/\b(CE|SAA|CB|UL|ETL|DLC|FCC|TUV|ENEC)\b/gi);
  if (certMatch) {
    const certs = [...new Set(certMatch.map(c => c.toUpperCase()))].join(", ");
    add({ paramKey: "certification", rawValue: certs, normalizedValue: certs, unit: null });
  }

  return params;
}
```

#### 3. 产品关联

标题行参数适用于该 sheet 的所有产品。找法：

```typescript
// 方法 1：通过正向/反向匹配已关联到该 sheet 的产品
// 方法 2：通过 supplier_offers.source_file_id 关联的产品，结合 sheet 名过滤

// 简单做法：取该文件关联的所有产品
const fileProducts = await getProductsByFileId(file.id);
// 对每个产品，如果该参数不存在，写入
for (const product of fileProducts) {
  for (const param of titleParams) {
    const key = `${product.id}\0${param.paramKey}`;
    if (existingParamKeys.has(key)) continue;
    plannedParams.push({
      productId: product.id,
      paramKey: param.paramKey,
      rawValue: param.rawValue,
      normalizedValue: param.normalizedValue,
      unit: param.unit,
      sourceField: "title_row",
      confidence: "medium",
    });
    existingParamKeys.add(key);
  }
}
```

#### 4. 安全规则

- 只处理 Excel 文件，不处理 PDF
- 标题行文本长度 < 5 的跳过
- voltage 值必须在合理范围（12V-480V）
- 不覆盖已有参数（existingParamKeys 去重）
- 同一 sheet 如果有多个矛盾的 voltage 值，跳过 voltage

### 报告：`docs/v11.4-title-row-report.md`

```markdown
# V11.4 标题行参数提取报告

模式: dry-run / apply
时间: ...

## 汇总

| 指标 | 数值 |
|---|---:|
| 扫描文件数 | X |
| 含标题行参数的文件 | X |
| 含标题行参数的 sheet | X |
| 受益产品数 | X |
| 新增参数 | X |
| 跳过（已存在） | X |
| product_params 变化 | 前 → 后 |

## 按 param_key 统计

| param_key | 新增记录 | 覆盖产品数 |

## 按品类统计

| 品类 | 含标题参数 sheet | 受益产品 | 新增参数 |

## 标题行采样（前 50 条）

| 文件名 | Sheet | 标题文本(前80字) | 提取 param_key |

## 产品关联采样

| 文件名 | Sheet | 提取参数 | 受益产品数 | 示例产品 model_no |
```

---

## Commit

```
V11.4: extract sheet-level params from title/description rows

- New v11.4-title-row-extract.ts
- Scan rows before header for driver_type, voltage, ip, cri, pf, material, cct, certification
- Apply extracted params to ALL products linked to that file/sheet
- Re-run derive and audit
```

## 重跑管线

```bash
npx tsx scripts/v11.4-title-row-extract.ts --apply
npx tsx scripts/v10.4-derive-params.ts --apply
npx tsx scripts/v10.0-source-audit.ts
```

## 不做什么

- 不改现有脚本
- 不删产品
- 不改 Prisma schema
- 不改前端
- 不修改源 Excel 文件
