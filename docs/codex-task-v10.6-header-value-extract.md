# V10.6 — 列头参数值提取 + 回填映射补全 + 重跑管线

## 目标

当前回填管线只能提取"列名→param_key，单元格→值"的标准模式。但大量 Excel 文件把参数值编码在**列头**里（如 "3W"、"100lm/w"、">80"），单元格反而是价格。这类文件包括面板灯、三防灯、投光灯等。

V10.6 新建一个专门脚本，扫描所有 688 个 Excel，从列头中提取参数值写入 product_params。同时补全现有回填脚本的列名映射缺口，然后重跑全管线。

## 前置

```bash
cp prisma/dev.db prisma/dev.db.bak-v10.6
```

---

## 阶段一：列头参数值提取

### 新建文件：`scripts/v10.6-header-value-extract.ts`

```bash
npx tsx scripts/v10.6-header-value-extract.ts              # dry-run
npx tsx scripts/v10.6-header-value-extract.ts --apply       # 写入
```

### 核心思路

许多 Excel 的列头本身就是参数值：

| 文件类型 | 列头示例 | 含义 |
|---|---|---|
| 面板灯（一群狼） | `3W`, `5W`, `9W`, `18W` | 瓦数 |
| 三防灯 | `100LM/W 含税价`, `110LM/W 含税价` | 光效 |
| 面板灯汇总表 | `22-24LM`, `方案22-24LM` | 光效/流明 |
| 多品类 | `IP65`, `IP20` | 防护等级 |
| 多品类 | `220-240V`, `85-265V` | 电压 |
| 多品类 | `>80`, `≥0.5` | CRI / PF |
| 多品类 | `2700-6500K` | 色温 |

对于这些文件，每个产品行（已匹配到 DB 产品）的参数值不在单元格中，而是在列头中。

### 数据加载

```typescript
// 加载所有有关联产品的 Excel 文件
const sourceFiles = await prisma.$queryRaw<...>`
  SELECT DISTINCT
    f.id AS file_id,
    f.file_name,
    f.relative_path,
    p.id AS product_id,
    p.model_no,
    p.product_name,
    p.category
  FROM supplier_offers so
  JOIN files f ON f.id = so.source_file_id
  JOIN products p ON p.id = so.product_id
  WHERE so.source_file_id IS NOT NULL AND f.file_type = 'excel'
  ORDER BY f.relative_path
`;
```

### 列头参数检测

对每个 sheet 的表头行，逐列检测：

```typescript
interface HeaderParam {
  columnIndex: number;
  paramKey: string;
  rawValue: string;
  normalizedValue: string;
  unit: string | null;
}

function detectHeaderParams(headers: string[]): HeaderParam[] {
  const result: HeaderParam[] = [];
  for (const [index, header] of headers.entries()) {
    const parsed = parseHeaderAsParam(header);
    if (parsed) result.push({ columnIndex: index, ...parsed });
  }
  return result;
}
```

### parseHeaderAsParam 规则

按优先级尝试解析（在去除括号、单位后缀、空格后）：

```typescript
function parseHeaderAsParam(header: string): { paramKey: string; rawValue: string; normalizedValue: string; unit: string | null } | null {
  const text = header.trim();
  if (!text || text.length > 30) return null;

  // 1. watts: "3W", "5W±10%", "18W", "100W"
  const wattsMatch = text.match(/^(\d+(?:\.\d+)?)\s*W\b/i);
  if (wattsMatch) {
    return { paramKey: "watts", rawValue: text, normalizedValue: wattsMatch[1], unit: "W" };
  }

  // 2. luminous_efficacy: "100lm/w", "110LM/W±10%", "80Lm/w"
  const efficacyMatch = text.match(/^(\d+(?:\.\d+)?)\s*lm\s*\/\s*w/i);
  if (efficacyMatch) {
    return { paramKey: "luminous_efficacy", rawValue: text, normalizedValue: efficacyMatch[1], unit: "lm/W" };
  }

  // 3. voltage: "220-240V", "85-265V", "165-265V", "100-265V"
  const voltageMatch = text.match(/^(\d+)\s*[-~–]\s*(\d+)\s*V$/i);
  if (voltageMatch) {
    return { paramKey: "voltage", rawValue: text, normalizedValue: `${voltageMatch[1]}-${voltageMatch[2]}`, unit: "V" };
  }

  // 4. cct: "2700-6500K", "2700-6500k"
  const cctMatch = text.match(/^(\d+)\s*[-~–]\s*(\d+)\s*K$/i);
  if (cctMatch) {
    const n1 = parseInt(cctMatch[1]), n2 = parseInt(cctMatch[2]);
    if (n1 >= 1800 && n2 <= 10000) {
      return { paramKey: "cct", rawValue: text, normalizedValue: `${n1}-${n2}`, unit: "K" };
    }
  }

  // 5. ip: "IP65", "IP20", "IP44"
  const ipMatch = text.match(/^IP\s*(\d{2})$/i);
  if (ipMatch) {
    return { paramKey: "ip", rawValue: text, normalizedValue: ipMatch[1], unit: null };
  }

  // 6. cri: ">80", "≥80", ">0.5" (PF), "＞80"
  //    CRI 范围 60-100，PF 范围 0-1
  const criPfMatch = text.match(/^[>≥＞]\s*(\d+(?:\.\d+)?)$/);
  if (criPfMatch) {
    const value = parseFloat(criPfMatch[1]);
    if (value >= 60 && value <= 100) {
      return { paramKey: "cri", rawValue: text, normalizedValue: String(value), unit: null };
    }
    if (value > 0 && value <= 1) {
      return { paramKey: "pf", rawValue: text, normalizedValue: String(value), unit: null };
    }
  }

  return null;
}
```

### 排除规则

不是所有匹配上述模式的列头都是参数值。排除以下情况：

```typescript
function shouldSkipHeaderParam(header: string, allHeaders: string[]): boolean {
  // 排除明确的价格列
  if (/含税|不含税|价格|报价|price|rmb|cny|出厂|成本|单价/i.test(header)) return true;
  // 排除商务列
  if (/moq|装箱|外箱|carton|packing|package/i.test(header)) return true;
  // 排除图片/序号列
  if (/图片|photo|picture|序号|no\./i.test(header)) return true;
  return false;
}
```

**关键区分：`3W` vs `3W 含税价`**

- `3W` → 纯参数值列头 → 提取 watts=3
- `3W 含税价` → 价格列（含税 关键词）→ 跳过
- `100LM/W 含税价` → 虽然含 "含税"，但也含参数值 → **提取 luminous_efficacy=100**，因为参数值匹配在前

修正：对于"参数值 + 价格关键词"组合（如 `100LM/W 含税价`），**仍然提取参数值**。判定标准是列头的**开头**是否匹配参数模式。

### 产品匹配

复用 V10.3 的匹配逻辑：每个文件有关联的产品列表，按 model_no 匹配。

对于"列头即参数值"的列，**每个有非空单元格的数据行**都会为其匹配产品写入参数。

```typescript
// 对于每个 data row
for (const row of dataRows) {
  const modelValue = row[modelColumn]; // "2.5寸圆形"
  const product = findExistingProduct(modelValue, file.products);
  if (!product) continue;

  // 对于该行中每个 headerParam 列
  for (const hp of headerParams) {
    const cellValue = row[hp.columnIndex];
    // 只有当单元格非空时才写入（表示该产品有此参数对应的变体）
    if (!cellValue || !cellValue.trim()) continue;

    // 检查是否已有该参数
    const key = `${product.id}\0${hp.paramKey}`;
    if (existingParamKeys.has(key)) continue;

    // 计划写入
    plannedParams.push({
      productId: product.id,
      paramKey: hp.paramKey,
      rawValue: hp.rawValue,
      normalizedValue: hp.normalizedValue,
      unit: hp.unit,
      sourceField: "excel_header",
      confidence: "medium",
    });
    existingParamKeys.add(key);
  }
}
```

**注意**：如果一个产品在多个 "watts" 列头下都有值（如 3W、5W、9W 列都有价格），只写第一个匹配的 watts 值。因为当前产品粒度不区分瓦数变体。用 `existingParamKeys` set 自动去重。

### 报告：`docs/v10.6-header-extract-report.md`

```markdown
# V10.6 列头参数值提取报告

模式: dry-run / apply
时间: ...

## 汇总

| 指标 | 数值 |
|---|---:|
| 扫描文件数 | X |
| 含列头参数的文件 | X |
| 含列头参数的 Sheet | X |
| 检测到的列头参数列 | X |
| 匹配产品行数 | X |
| 新增参数 | X |
| 跳过（已存在） | X |
| product_params 变化 | 前 → 后 |

## 按 param_key 统计

| param_key | 新增记录数 | 覆盖新产品数 |

## 按品类统计

| 品类 | 含列头参数 Sheet 数 | 匹配行 | 新增参数 |

## 列头参数采样（前 100 条）

| 文件名 | Sheet | 列头 | param_key | 值 | 匹配产品 |
```

---

## 阶段二：回填映射补全

### 修改 `scripts/v10.1-param-backfill.ts`

在 HEADER_TO_PARAM 中添加缺失的映射：

```typescript
// 新增到 HEADER_TO_PARAM
显色指数: "cri",
材料: "material",
"ip等级": "ip",
产品规格: "size_display",
"lumen efficiency": "luminous_efficacy",
"light efficiency": "luminous_efficacy",
"luminous efficiency": "luminous_efficacy",
灯珠数量: "led_count",
led数量: "led_count",
// 加强 size_display 变体
"太阳能板尺寸": "size_display",
面板尺寸: "size_display",
外形尺寸: "size_display",
```

---

## 阶段三：重跑管线

### Step 1: 运行列头参数提取

```bash
npx tsx scripts/v10.6-header-value-extract.ts --apply
```

### Step 2: 更新备份后重跑回填

```bash
cp prisma/dev.db prisma/dev.db.bak-v10.2
npx tsx scripts/v10.1-param-backfill.ts --apply
```

### Step 3: 重跑派生

```bash
npx tsx scripts/v10.4-derive-params.ts --apply
```

### Step 4: 重跑审计

```bash
npx tsx scripts/v10.0-source-audit.ts
```

---

## Commit

```
V10.6: extract param values from column headers, expand backfill mappings

- New v10.6-header-value-extract.ts: parse watts/efficacy/ip/voltage/cri/pf/cct
  from column headers like "3W", "100lm/w", "IP65", ">80"
- Expand HEADER_TO_PARAM: 显色指数→cri, 材料→material, IP等级→ip, etc.
- Re-run backfill, derive, and audit for updated coverage
```

## 不做什么

- 不修改 V10.3 导入脚本
- 不修改 extract-params.ts
- 不改 Prisma schema
- 不改前端
- 不删除现有产品或参数
- 不从 sheet 名称提取参数（太模糊，留给后续版本）
