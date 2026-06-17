# V11.3 — 列头即数值模式：从 Excel 列头提取 watts/efficacy 参数

## 背景

约 1,240 个产品已被回填管线匹配到了 Excel 行（有 excel_column 来源的参数如 note/size_display），但没有 watts。根因：这些 Excel 文件的功率不是一个"功率"列，而是**列头本身就是功率值**。

典型结构（面板灯/三防灯/净化灯）：

```
型号    | 3W   | 5W   | 9W   | 12W  | 15W  | 18W  | 24W
--------|------|------|------|------|------|------|------
2.5寸圆 | 3.53 | -    | -    | -    | -    | -    | -
3.5寸圆 | -    | -    | 4.38 | -    | -    | -    | -
4寸圆   | -    | -    | 9.22 | -    | -    | -    | -
```

每个 (行 × 列) 交叉点是一个价格。列头 "3W" 告诉我们这个产品的功率是 3W。

当前审计报告中"未识别"列名里大量是这种模式：
- "3W" (31 files), "5W" (27), "9W" (22), "18W" (19), "20W" (20)
- "100lm/w" (18 files), "110lm/w", "120lm/w", "130lm/w" — 光效等级
- ">80", ">0.5" — CRI/PF 等级
- "IP65", "IP20" — IP 等级
- "220-240V", "85-265V", "165-265V" — 电压范围

## 前置

```bash
cp prisma/dev.db prisma/dev.db.bak-v11.3
```

## 新建文件：`scripts/v11.3-column-header-watts.ts`

```bash
npx tsx scripts/v11.3-column-header-watts.ts              # dry-run
npx tsx scripts/v11.3-column-header-watts.ts --apply       # 写入
```

### 算法

#### 1. 识别数值列头

```typescript
type ValueHeader = {
  colIndex: number;
  rawHeader: string;
  paramKey: string;      // watts | luminous_efficacy | cri | pf | ip | voltage
  normalizedValue: string;
  unit: string | null;
};

function detectValueHeaders(headerValues: unknown[]): ValueHeader[] {
  const results: ValueHeader[] = [];
  
  for (const [i, val] of headerValues.entries()) {
    const raw = cellToString(val).trim();
    if (!raw) continue;

    // watts: "3W", "5W", "9W", "12W", "18W±10%", "20w"
    const wattsMatch = raw.match(/^(\d+(?:\.\d+)?)\s*[Ww](?:\s*±\s*\d+%)?$/);
    if (wattsMatch) {
      results.push({ colIndex: i, rawHeader: raw, paramKey: "watts", normalizedValue: wattsMatch[1], unit: "W" });
      continue;
    }

    // luminous_efficacy: "100lm/w", "110lm/W", "130LM/W"
    const efficacyMatch = raw.match(/^(\d+(?:\.\d+)?)\s*(?:lm\/[Ww]|LM\/W)(?:\s*±\s*\d+%)?$/i);
    if (efficacyMatch) {
      results.push({ colIndex: i, rawHeader: raw, paramKey: "luminous_efficacy", normalizedValue: efficacyMatch[1], unit: "lm/W" });
      continue;
    }

    // cri: ">80", "≥80", "Ra>80", "Ra≥80"
    const criMatch = raw.match(/^(?:Ra\s*)?[>≥]\s*(\d{2})$/i);
    if (criMatch && Number(criMatch[1]) >= 60 && Number(criMatch[1]) <= 99) {
      results.push({ colIndex: i, rawHeader: raw, paramKey: "cri", normalizedValue: criMatch[1], unit: null });
      continue;
    }

    // pf: ">0.5", "≥0.5", ">0.9", "PF>0.5"
    const pfMatch = raw.match(/^(?:PF\s*)?[>≥]\s*(0\.\d+)$/i);
    if (pfMatch) {
      results.push({ colIndex: i, rawHeader: raw, paramKey: "pf", normalizedValue: pfMatch[1], unit: null });
      continue;
    }

    // ip: "IP65", "IP20", "IP44"
    const ipMatch = raw.match(/^IP\s*(\d{2})$/i);
    if (ipMatch) {
      results.push({ colIndex: i, rawHeader: raw, paramKey: "ip", normalizedValue: ipMatch[1], unit: null });
      continue;
    }

    // voltage: "220-240V", "85-265V", "165-265V", "AC220V"
    const voltageMatch = raw.match(/^(?:AC\s*)?(\d+)\s*(?:[-~–]\s*(\d+)\s*)?V$/i);
    if (voltageMatch) {
      const v = voltageMatch[2] ? `${voltageMatch[1]}-${voltageMatch[2]}` : voltageMatch[1];
      results.push({ colIndex: i, rawHeader: raw, paramKey: "voltage", normalizedValue: v, unit: "V" });
      continue;
    }

    // cct: "2700-6500K", "3000K", "4000K", "6500K"
    const cctMatch = raw.match(/^(\d{3,5})\s*(?:[-~–]\s*(\d{3,5})\s*)?[Kk]$/);
    if (cctMatch) {
      const cct = cctMatch[2] ? `${cctMatch[1]}-${cctMatch[2]}` : cctMatch[1];
      results.push({ colIndex: i, rawHeader: raw, paramKey: "cct", normalizedValue: cct, unit: "K" });
      continue;
    }
  }

  return results;
}
```

#### 2. 判断列下面是否有数据（价格/数值）

如果一个"3W"列下面有数据（不全为空），说明该行的产品与这个瓦数关联。

```typescript
function hasDataInColumn(dataRows: unknown[][], colIndex: number, rowIndex: number): boolean {
  const cell = cellToString(dataRows[rowIndex]?.[colIndex]);
  return cell !== "" && cell !== "-" && cell !== "/" && cell !== "\\";
}
```

#### 3. 产品匹配

使用标准回填的匹配逻辑（model column → product DB lookup）。也使用 V11.0 的组标签+尺寸匹配逻辑。

#### 4. 参数写入

对每个 (product × value_header) 组合，如果该列有数据（说明产品有这个规格）：

```typescript
// 只有当对应单元格有值（通常是价格或"✓"）时，才写入列头参数
if (hasDataInColumn(dataRows, valueHeader.colIndex, rowOffset)) {
  const key = `${product.productId}\0${valueHeader.paramKey}`;
  if (!existingParamKeys.has(key)) {
    plannedParams.push({
      productId: product.productId,
      paramKey: valueHeader.paramKey,
      rawValue: valueHeader.rawHeader,
      normalizedValue: valueHeader.normalizedValue,
      unit: valueHeader.unit,
      sourceField: "column_header_value",
      confidence: "high",  // 列头就是参数值，很可靠
    });
    existingParamKeys.add(key);
  }
}
```

#### 5. 处理同一产品多列有数据的情况

同一行可能在 "3W" 和 "5W" 列下都有数据（说明这是一个多功率产品）。但这种情况很少见——通常每行只在一个功率列下有数据。

如果同一行在多个功率列有数据：
- 不写 watts 参数（因为不确定哪个是主功率）
- 在 note 中记录所有可用功率

#### 6. 文件选择

只处理包含 value-header 列的文件：

```typescript
// 先检测 value headers 数量 >= 2，再继续
const valueHeaders = detectValueHeaders(headerValues);
if (valueHeaders.length < 2) continue; // 单个可能是噪声
```

### 报告：`docs/v11.3-column-header-watts-report.md`

```markdown
# V11.3 列头即数值模式参数提取报告

模式: dry-run / apply
时间: ...

## 汇总

| 指标 | 数值 |
|---|---:|
| 扫描文件数 | X |
| 含数值列头的文件 | X |
| 含数值列头的 sheet | X |
| 匹配产品行数 | X |
| 新增参数 | X |
| 跳过（已存在） | X |
| 跳过（多功率冲突） | X |
| product_params 变化 | 前 → 后 |

## 按 param_key 统计

| param_key | 新增记录 | 覆盖产品数 |

## 检测到的数值列头

| 列头原文 | 解析为 param_key | 归一化值 | 出现文件数 | 匹配产品行数 |

## 按品类统计

| 品类 | 含数值列头 sheet | 匹配行 | 新增参数 |

## 匹配采样（前 50 条）

| 文件名 | Sheet | 产品 | 列头 | param_key | 值 |

## 多功率冲突采样

| 文件名 | 产品 | 有数据的功率列 |
```

---

## Commit

```
V11.3: extract params from value-as-column-header pattern

- New v11.3-column-header-watts.ts
- Detect column headers that ARE parameter values (3W, 100lm/w, >80, IP65, etc.)
- If a product row has data under a value header, that value is the product's param
- Handles watts, efficacy, cri, pf, ip, voltage, cct as column headers
- Multi-watts conflict detection (skip if ambiguous)
- Re-run derive and audit
```

## 重跑管线

```bash
npx tsx scripts/v11.3-column-header-watts.ts --apply
npx tsx scripts/v10.4-derive-params.ts --apply
npx tsx scripts/v10.0-source-audit.ts
```

## 不做什么

- 不改现有脚本
- 不删产品
- 不改 Prisma schema
- 不改前端
- 不修改源 Excel 文件
