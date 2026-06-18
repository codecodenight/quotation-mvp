# V16.2 — 光效 (lm/W) 数据修复：误分类 + 列头提取

## 背景

luminous_efficacy (lm/W) 数据存在两个问题：

1. **误分类**：61 条 `param_key='lumens'` 的记录实际是 lm/W 值（raw_value 含 "LM/W"），分布在 6 个品类
2. **列头参数缺失**：Wellux Highbay 文件的 FOB USD 列头包含 "160lm/w" 等光效信息，从未被提取

**依赖：无。可与 V17.1 并行。**

## 前置

```bash
cp prisma/dev.db prisma/dev.db.bak-v16.2
```

## 新建文件：`scripts/v16.2-efficacy-fix.ts`

```bash
npx tsx scripts/v16.2-efficacy-fix.ts              # dry-run
npx tsx scripts/v16.2-efficacy-fix.ts --apply       # 执行
```

---

## Part A — 误分类 lumens → luminous_efficacy（61 条记录）

### 数据现状

```sql
-- 这 61 条记录：param_key='lumens' 但 raw_value 含 lm/W
SELECT param_key, raw_value, normalized_value FROM product_params
WHERE param_key = 'lumens' AND UPPER(raw_value) LIKE '%LM/W%';
```

| 品类 | 记录数 | 样例 raw_value | 当前 normalized_value |
|---|---:|---|---|
| Highbay | 22 | `110-120LM/W`, `120-130LM/W`, `90-100lm/w` | 110, 120, 90（只取了下限） |
| 路灯 | 15 | `80-90lm/w`, `90-100lm/w`, `130LM/W` | 80, 90, 130 |
| 筒灯 | 14 | `80LM/W`, `75-80lm/w`, `70-75lm/w`, `70lm/w` | 80, 75, 70 |
| 轨道灯 | 4 | `80LM/W` | 80 |
| 工作灯 | 3 | `90LM/W` | 90 |
| 投光灯 | 2 | `Luminous Flux:80Lm/w±10% CRI: >70Ra±5% CCT: 2700 to 6500K±5%` | 80 |
| 路灯 | 1 | `130LM/W` | 130 |

### 与现有 luminous_efficacy 的重叠情况

这 61 条记录中，部分产品已有 luminous_efficacy 记录：

| 情况 | 记录数 | 操作 |
|---|---:|---|
| 产品无 luminous_efficacy | 8 | reclassify：param_key 改为 `luminous_efficacy` |
| 产品有 efficacy，值相同（仅归一化差异：`90` vs `90-100`） | 40 | 删除冗余 lumens 记录 |
| 产品有 efficacy，值相同，完全匹配 | 4 | 删除冗余 lumens 记录 |
| 产品有 efficacy 但值错误（筒灯 `80lm/5W` → `16`） | 9 | 修正 efficacy，删除 lumens |

### 处理逻辑

```typescript
// 查找所有误分类记录
const misclassified = await prisma.$queryRawUnsafe(`
  SELECT pp.id, pp.product_id, pp.raw_value, pp.normalized_value, pp.source_field, pp.confidence
  FROM product_params pp
  WHERE pp.param_key = 'lumens' AND UPPER(pp.raw_value) LIKE '%LM/W%'
`);

for (const record of misclassified) {
  // 1. 从 raw_value 提取正确的 lm/W 值
  //    正则: /(\d+(?:\s*-\s*\d+)?)\s*[Ll][Mm]\/[Ww]/
  //    "110-120LM/W" → "110-120"
  //    "80LM/W" → "80"
  //    "Luminous Flux:80Lm/w±10%..." → "80"
  const correctValue = extractEfficacy(record.raw_value);

  // 2. 检查该产品是否已有 luminous_efficacy
  const existing = await prisma.productParam.findFirst({
    where: { productId: record.product_id, paramKey: 'luminous_efficacy' }
  });

  if (!existing) {
    // Case 1: 没有 → reclassify
    await prisma.productParam.update({
      where: { id: record.id },
      data: { paramKey: 'luminous_efficacy', normalizedValue: correctValue }
    });
  } else if (isWrongEfficacy(existing.normalizedValue)) {
    // Case 2: 现有 efficacy 错误（如 "16", "11", "14" — 筒灯被错算成 total lumens/watts）
    // 判断标准：normalized_value 为纯数字且 < 50（LED 光效不可能低于 50 lm/W）
    await prisma.productParam.update({
      where: { id: existing.id },
      data: { normalizedValue: correctValue, rawValue: record.raw_value }
    });
    await prisma.productParam.delete({ where: { id: record.id } });
  } else {
    // Case 3: 已有正确 efficacy → 删除冗余 lumens 记录
    await prisma.productParam.delete({ where: { id: record.id } });
  }
}
```

### extractEfficacy 函数

```typescript
function extractEfficacy(raw: string): string {
  // 匹配 "110-120LM/W", "80Lm/w", "90-100lm/w" 等
  const match = raw.match(/(\d+(?:\s*[-–]\s*\d+)?)\s*[Ll][Mm]\/[Ww]/);
  if (!match) return raw;
  return match[1].replace(/\s+/g, '');
}
```

### isWrongEfficacy 函数

```typescript
function isWrongEfficacy(value: string | null): boolean {
  if (!value) return true;
  const num = parseFloat(value);
  // LED 光效正常范围 50-250 lm/W；< 50 一定是误算
  return !isNaN(num) && num < 50;
}
```

---

## Part B — Wellux Highbay 列头光效提取（6 个产品）

### 文件信息

文件：`data/source-archive/Highbay/核价LED Highbay - Wellux - 20230506 - 副本.xls`

DB 中来自该文件的 6 个产品（全部 luminous_efficacy = NULL）：

| product_id | product_name | factory |
|---|---|---|
| 25173736-d12a-4658-ba89-d74c02d4d88f | HB-HVD | 隆景 |
| cb04168c-81ca-45c1-a393-b5a30e25192b | HB-HVE | 隆景 |
| d48f9b60-0402-4ce1-ac51-1212f40deb90 | HB-HV | 隆景 |
| 4ce32c4b-98cd-499f-9b93-960f7544f6e1 | HB-HS | 隆景 |
| 69815238-cc8f-4252-9b40-e65c4f41d261 | HB-HSD | 隆景 |
| e89bde85-55cb-4957-9ba6-f90bfcbae43c | HB-HY | 隆景 |

### 文件结构（已分析）

8 个 sheet，光效信息位置：

| Sheet | 光效位置 | 值 |
|---|---|---|
| 汇总 | R4/R8/R12/R16/R20/R24 列头子标题 | `AC200-265V PF>0.99 90-100LM/W`, `AC120-265V PF>0.9 120-130LM/W` 等多个档位 |
| HB-F | 独立列 col 5 数据单元格 | `90-100lm/w` |
| HB-G | 待确认 | — |
| HB-J | 待确认 | — |
| HB-H Pro | R3 col 18: `FOB USD\n160lm/w 1CCT` | **160** |
| HB-HV Pro | R3 col 19: `FOB USD\n160lm/w\nWithout flickering\nFactory` | **160** |
| HB-HVS Eco | R3 col 19: `FOB USD\n160lm/w\nWithout flickering\nBran` | **160** |
| HB-K Eco | R3 col 18: `FOB USD\n160lm/w 1CCT` | **160** |

### 提取逻辑

```typescript
import * as XLSX from 'xlsx';

// 1. 读文件
const wb = XLSX.readFile('data/source-archive/Highbay/核价LED Highbay - Wellux - 20230506 - 副本.xls');

// 2. 遍历每个 sheet
for (const sheetName of wb.SheetNames) {
  const ws = wb.Sheets[sheetName];
  
  // 3. 扫描前 5 行的所有单元格，提取 lm/W
  //    正则匹配：/(\d+(?:\s*[-–]\s*\d+)?)\s*[Ll][Mm]\/[Ww]/g
  //    记录：{ sheetName, lmwValues: string[] }
  
  // 4. 同时扫描数据列（col header 含 "lm/w" 或 "lumen"）获取每行的值
}

// 5. 构建 sheet→lm/W 映射
//    已知结果（可硬编码或用正则验证）：
//    汇总: [90-100, 120-130, 140-150, 160, 170] (多档)
//    HB-F: [90-100]
//    HB-H Pro: [160]
//    HB-HV Pro: [160]
//    HB-HVS Eco: [160]
//    HB-K Eco: [160]
```

### 产品→sheet 匹配策略

由于 `supplier_offers` 无 `sheet_name` 字段，用产品名匹配 sheet 内容：

1. 读取每个 sheet 的产品名列（通常 col 1-3 的 "Model" 列）
2. 在 sheet 数据行中搜索 6 个产品名（HB-HVD, HB-HVE, HB-HV, HB-HS, HB-HSD, HB-HY）
3. 如果产品名出现在某 sheet → 该 sheet 的 lm/W 适用于该产品
4. **汇总 sheet 特殊处理**：产品在汇总 sheet 中有多列 FOB（对应不同 lm/W），提取所有适用的 lm/W 值

### 插入

对每个产品，插入所有匹配到的 luminous_efficacy 值（去重）：

```typescript
// 去重：检查 existingParamKeys（同 V14-V16 模式）
const key = `${productId}::luminous_efficacy::${normalizedValue}`;
if (existingKeys.has(key)) continue;

await prisma.productParam.create({
  data: {
    id: crypto.randomUUID(),
    productId,
    paramKey: 'luminous_efficacy',
    rawValue: `FOB USD ${normalizedValue}lm/w`,  // 记录来源
    normalizedValue,
    sourceField: 'column_header_value',
    confidence: 'medium',
  }
});
```

---

## 报告：`docs/v16.2-efficacy-fix-report.md`

```markdown
# V16.2 光效数据修复报告

模式: dry-run / apply
时间: ...
备份: prisma/dev.db.bak-v16.2

## Part A: lumens → luminous_efficacy 修正

| 操作 | 记录数 |
|---|---:|
| reclassify（无 efficacy → 新建） | X |
| 修正错误 efficacy（< 50 lm/W） | X |
| 删除冗余 lumens（已有正确 efficacy） | X |
| 合计影响产品 | X |

### 修正后各品类 luminous_efficacy 覆盖

| 品类 | 产品总数 | 有 efficacy | 覆盖率 |
|---|---:|---:|---:|

## Part B: Wellux Highbay 列头提取

| Sheet | 检测到 lm/W | 匹配产品 | 插入记录 |
|---|---|---:|---:|

### 提取详情

| product_id | product_name | 来源 sheet | 值 |
|---|---|---|---|

## DB 计数

| 表 | 执行前 | 执行后 | 变化 |
|---|---:|---:|---:|
| product_params | X | X | X |
| — luminous_efficacy | X | X | +X |
| — lumens | X | X | -X |
```

---

## Commit

```
V16.2: fix lumens→luminous_efficacy misclassification and extract column header lm/W
```

## 不做什么

- 不从 lumens÷watts 计算光效（当前 lumens 数据质量不足，算出来很多是垃圾）
- 不改前端 / Prisma schema
- 不修改源 Excel 文件
- 不处理 Wellux Highbay 以外的文件（其他文件的列头光效留给后续版本）
- 不改已有脚本
