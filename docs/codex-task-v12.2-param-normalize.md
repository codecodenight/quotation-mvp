# V12.2 — 参数值标准化 + 去重

参数 normalized_value 格式严重不一致，导致筛选和对话接口失效。本任务统一格式并去除重复记录。

**必须在 V12.1 commit 之后执行。**

## 前置

```bash
cp prisma/dev.db prisma/dev.db.bak-v12.2
```

## 新建文件：`scripts/v12.2-param-normalize.ts`

```bash
npx tsx scripts/v12.2-param-normalize.ts              # dry-run
npx tsx scripts/v12.2-param-normalize.ts --apply       # 写入
```

---

## Part A — normalized_value 标准化

对以下 param_key 的 normalized_value 做 UPDATE（不删不增）：

### A1. voltage

目标格式：纯数字范围，不含 V/AC/DC 前缀后缀。类型信息保留在 raw_value。

```typescript
const VOLTAGE_RULES: NormalizeRule[] = [
  // "220-240V" → "220-240", "AC220-240V" → "220-240", "DC24V" → "24"
  // "48V" → "48", "AC220V" → "220"
  // 步骤：strip AC/DC prefix, strip V/v suffix, trim
  { regex: /^(?:AC|DC)?\s*(\d+(?:\s*[-~–]\s*\d+)?)\s*V?$/i, normalize: (m) => m[1].replace(/\s+/g, "").replace(/[~–]/g, "-") },
];
// unit 统一设为 "V"
```

当前数据：

| 原值 | 数量 | 目标 |
|---|---:|---|
| 220-240 | 642 | 不变 |
| 165-265V | 162 | 165-265 |
| AC220-240V | 158 | 220-240 |
| 220-240V | 125 | 220-240 |
| AC110-265V | 125 | 110-265 |
| 48V | 121 | 48 |
| 110-265V | 116 | 110-265 |
| 110-240V | 107 | 110-240 |
| DC24V | 97 | 24 |
| DC12V | 65 | 12 |

### A2. CRI

目标格式：纯数字（如 "80"），不含 Ra 前缀。

```typescript
// "Ra80" → "80", "Ra90" → "90", "80.00" → "80"
// strip "Ra" prefix, strip trailing .00
```

当前数据：

| 原值 | 数量 | 目标 |
|---|---:|---|
| 80 | 1,046 | 不变 |
| Ra80 | 612 | 80 |
| 70 | 268 | 不变 |
| Ra70 | 164 | 70 |
| 90 | 137 | 不变 |
| Ra90 | 58 | 90 |
| 80.00 | 3 | 80 |
| 70.00 | 2 | 70 |

### A3. IP

目标格式：纯数字（如 "65"），不含 IP/IPX 前缀。

```typescript
// "IP65" → "65", "IP20" → "20", "IP54" → "54", "IPX4" → "X4"（保留 X）
// "IP68" → "68", "IP44" → "44"
```

当前数据：

| 原值 | 数量 | 目标 |
|---|---:|---|
| IP65 | 141 | 65 |
| IP54 | 111 | 54 |
| IP44 | 50 | 44 |
| IP20 | 45 | 20 |
| IP68 | 2 | 68 |

### A4. CCT

```typescript
// 反向范围修正："6500-4000" → "4000-6500"（小值在前）
// 脏值标记跳过（不 UPDATE）："CCT", "tunable", "3CCT"
// 多值不改（"3000/4000/6500" 保留原样，对话接口可处理）
```

| 原值 | 数量 | 目标 |
|---|---:|---|
| 6500-4000 | 31 | 4000-6500 |
| 1800-21000 | 24 | 跳过（可能是 2100 的 typo，不安全改） |

### A5. PF

```typescript
// "≥ 0.9" → "0.9", "≥0.5" → "0.5"（strip 比较符号和空格）
// ">0.7" → "0.7"
```

### 实现方式

```typescript
// 逐 param_key 批量 UPDATE
// 用 SQL CASE WHEN 或分批 prisma.productParam.update
// 记录每个 param_key 的 affected 行数
```

---

## Part B — 重复记录去重

同一 product_id + param_key 有多条记录时，保留最佳一条，删除其余。

### 优先级规则

```typescript
const CONFIDENCE_RANK: Record<string, number> = {
  "high": 4,
  "medium": 3,
  "low": 2,
  "inferred": 1,
};

const SOURCE_RANK: Record<string, number> = {
  "excel_column": 10,
  "excel_multirow": 9,
  "excel_header": 8,
  "column_header_value": 8,
  "reverse_match": 7,
  "title_row": 6,
  "product_name": 5,
  "product_name_v2": 5,
  "model_no": 4,
  "sheet_name": 3,
  "derived": 2,
  "file_propagation": 1,
  "file_propagation_70": 1,
  "category_inference": 0,
};

// 排序：confidence DESC, source_rank DESC, id ASC（最早创建）
// 保留第一条，删除其余
```

### 当前重复规模

| param_key | 记录数 | 产品数 | 多余记录 |
|---|---:|---:|---:|
| cct | 3,737 | 2,495 | 1,242 |
| base | 881 | 806 | 75 |
| certification | 971 | 966 | 5 |

### 安全约束

- 只删除重复记录中的低优先级条目
- 如果两条记录 normalized_value 不同（如 CCT "3000" 和 "6500"），**不删**——产品确实有两个 CCT 值
- 只删 normalized_value 完全相同的重复（标准化之后比较）

```sql
-- 找重复：同产品同参数同 normalized_value 的多条记录
SELECT product_id, param_key, normalized_value, COUNT(*) as cnt
FROM product_params
GROUP BY product_id, param_key, normalized_value
HAVING cnt > 1
```

---

## 报告：`docs/v12.2-param-normalize-report.md`

```markdown
# V12.2 参数值标准化 + 去重报告

模式: dry-run / apply
时间: ...
备份: prisma/dev.db.bak-v12.2

## Part A — 标准化

| param_key | 扫描记录 | 修改记录 | 示例变更 |
|---|---:|---:|---|

### Part A 修改采样（前 30 条）

| param_key | 原 normalized_value | 新 normalized_value | product model_no |

## Part B — 去重

| param_key | 重复组数 | 删除记录 |
|---|---:|---:|

### Part B 删除采样（前 30 条）

| param_key | normalized_value | source_field | confidence | product model_no |

## 汇总

| 指标 | 数值 |
|---|---:|
| Part A 修改记录 | X |
| Part B 删除记录 | X |
| product_params 变化 | 前 → 后 |
```

---

## Commit

```
V12.2: normalize param values (voltage/CRI/IP/CCT/PF) and deduplicate same-value records
```

## 不做什么

- 不改现有脚本
- 不删产品
- 不改 Prisma schema
- 不改前端
- 不修改源 Excel 文件
- 不改 raw_value（只改 normalized_value 和 unit）
- 不删不同 normalized_value 的"重复"（产品确实可以有多个 CCT 值）
