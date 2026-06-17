# V12.1 — 覆盖率第四轮综合提升

本任务包含 5 个 Part，全部写在一个脚本里，顺序执行。

## 前置

```bash
cp prisma/dev.db prisma/dev.db.bak-v12.1
```

## 新建文件：`scripts/v12.1-coverage-round4.ts`

```bash
npx tsx scripts/v12.1-coverage-round4.ts              # dry-run
npx tsx scripts/v12.1-coverage-round4.ts --apply       # 写入
```

依赖已有模块：

```typescript
import { ... } from "./v11-shared";
```

---

## Part A — 脏数据清理扩展（~190 条）

V11.5 / V12.0 Part A 只清理了 `reverse_match` 来源的价格数据。还有三类残留脏数据：

### A1. 价格误当参数（122 条）

来自 `excel_column` 和 `excel_multirow` 来源：

```sql
WHERE source_field IN ('excel_column', 'excel_multirow')
AND (
  raw_value LIKE '￥%'
  OR raw_value LIKE '¥%'
  OR raw_value LIKE 'US$%'
  OR raw_value LIKE 'US $%'
  OR (raw_value LIKE '$%' AND raw_value GLOB '$[0-9]*')
)
```

### A2. CRI 脏数据（~52 条）

```sql
WHERE param_key = 'cri' AND (
  -- mm 尺寸误当 CRI：8mm, 10mm, 12mm
  (normalized_value IN ('8','10','12') AND raw_value LIKE '%mm%')
  -- 流明值误当 CRI：21, 24
  OR (normalized_value IN ('21','24') AND raw_value LIKE '%流明%')
  -- 显指三位数异常：Ra000, Ra240, Ra400, Ra500, Ra600, Ra700, Ra800
  OR (normalized_value LIKE 'Ra%' AND LENGTH(REPLACE(normalized_value, 'Ra', '')) = 3)
  -- Ra45 太低
  OR normalized_value = 'Ra45'
  -- 纯数字 < 50（排除有效的 70-99）
  OR (normalized_value GLOB '[0-9]*' AND CAST(normalized_value AS REAL) < 50 AND normalized_value NOT LIKE '%-%')
)
```

### A3. PF 脏数据（~17 条）

```sql
WHERE param_key = 'pf' AND (
  -- CRI 值 80 误当 PF
  CAST(normalized_value AS REAL) >= 2.0
  -- 电压值误当 PF
  OR CAST(normalized_value AS REAL) >= 2.0
  -- 空值
  OR (normalized_value IS NULL OR normalized_value = '')
)
```

### A4. IP 脏数据（~22 条）

非 IP 值写入 IP 字段：

```sql
WHERE param_key = 'ip' AND normalized_value IN (
  '2years', '30000Hrs',
  'Lighting Control+Remote Control',
  'Lighting Control/PIR Sensor/Remote Control'
)
```

### 预期

删除 ~190 条脏记录。

---

## Part B — 垃圾产品清理第二轮（~250 产品）

当前 717 个零参数产品中大量是备注行、合同条款、规格描述、配件，不是真正的产品。

### 分类规则

在 V11.2 的 10 个分类器基础上，新增以下模式：

```typescript
const JUNK_PATTERNS_V2: JunkPattern[] = [
  // 合同/付款条款
  { name: "contract_terms", test: (name) => /^(?:\d+[\.:、]?\s*)?(?:Payment|FOB|T\/T|Validity|Delivery|Lead Time|MOQ|Bulk order|Sample|warranty|质保|交期|付款|报价有效|包装)/i.test(name) },
  // 备注/注释行
  { name: "remark_row", test: (name) => /^(?:\d+[\.:、]?\s*)?(?:Remark|备注|注[：:]|以上产品|如果包装|不含税|含税|不含运费)/i.test(name) },
  // 纯尺寸/包装信息
  { name: "packaging_info", test: (name) => /^\d+[\.\*x×]\d+[\.\*x×]?\d*\s*(?:cm|mm|pcs|pieces|sets)?$/i.test(name) },
  // 纯数量/容量
  { name: "quantity_row", test: (name) => /^\d+\s*(?:PCS|pieces|sets|pcs\/|月)$/i.test(name) },
  // Excel 公式残留
  { name: "excel_formula", test: (name) => /^=DISPIMG\(|^=IMAGE\(/i.test(name) },
  // 银行信息
  { name: "bank_info", test: (name) => /^(?:BANK|Beneficiary|Account|SWIFT|IBAN|Fax:|Tel\s|E-mail:|CONTACT)/i.test(name) },
  // 纯电线/线材描述（非产品）
  { name: "wire_spec", test: (name) => /^[12]\*[\d.]+平方.*(?:PVC|电缆|棕蓝|红黑)/i.test(name) },
  // 纯 LED 规格描述（非产品名）
  { name: "led_spec_only", test: (name) => /^(?:LED Qty:|Chip Type:|SMD\s*\d{4}\b)(?:\s|$)/i.test(name) },
  // 太阳能配件/电池规格
  { name: "solar_spec", test: (name) => /^(?:Capacity:|Back up time:|Cable Length:)/i.test(name) },
  // 包材尺寸
  { name: "carton_size", test: (name) => /^\d+[\.\*x×]\d+[\.\*x×]\d+\s*cm$/i.test(name) },
  // 空或极短+价格符号
  { name: "price_note", test: (name) => /^(?:价格[：:]|￥\d|¥\d|RGB \+ ￥)/i.test(name) },
];
```

### 安全约束

与 V11.2 相同：

```typescript
function isSafeToDelete(product: Product): boolean {
  // 有图片 → 不删
  if (product.image_path) return false;
  // 有 quote_items → 不删
  if (product.quoteItemCount > 0) return false;
  // 有 customer_quote_rows → 不删  
  if (product.customerQuoteRowCount > 0) return false;
  return true;
}
```

查询模板：

```sql
SELECT p.id, p.product_name, p.model_no, p.category, p.image_path,
  (SELECT COUNT(*) FROM quote_items qi WHERE qi.product_id = p.id) as qi_count,
  (SELECT COUNT(*) FROM price_history ph WHERE ph.product_id = p.id) as ph_count,
  (SELECT COUNT(*) FROM supplier_offers so WHERE so.product_id = p.id) as so_count
FROM products p
WHERE NOT EXISTS (SELECT 1 FROM product_params pp WHERE pp.product_id = p.id)
```

注意 `customer_quote_rows` 表的 FK 不是直接 product_id — 查 schema 确认关联方式。如果没有直接 FK 就跳过这个检查。

### 删除方式

事务内级联删除，和 V11.2 相同：

```typescript
// 先删 price_history、supplier_offers、product_params（零参数产品应该没有）
// 再删 product
```

### 预期

717 中约 449 有图片不可删。剩余 ~268，其中模式匹配后预计删除 ~200-250。

---

## Part C — 文件级参数传播（70% 阈值）

V12.0 Part D 用 90% 阈值传播了 44 条参数。降低到 70% 可以再覆盖 ~860 条。

### 与 V12.0 Part D 的区别

1. 阈值从 90% 降到 70%
2. 最低样本数从 5 降到 3（适配小文件）
3. 跳过已被 90% 阈值传播的组（`source_field = 'file_propagation'` 已存在的不重复）
4. confidence = "low"（和 V12.0 一致）
5. source_field = "file_propagation_70"（区分来源）

### 传播参数范围

与 V12.0 一致：

```typescript
const PROPAGATABLE_PARAMS = ["voltage", "driver_type", "ip", "cri", "pf", "cct", "material"];
```

### 预期

按诊断数据：voltage +192, cct +193, cri +141, material +131, pf +105, ip +78, driver_type +20 ≈ 860 新参数。

---

## Part D — 品类 IP 推断（~1,563 产品）

以下 4 个品类 100% 为室内产品，行业标准 IP20：

| 品类 | 产品数 | 现有 IP 覆盖 | 推断值 |
|---|---:|---:|---|
| 灯丝灯 | 588 | 0 (0%) | IP20 |
| 球泡 | 371 | 0 (0%) | IP20 |
| 风扇灯 | 400 | 0 (0%) | IP20 |
| 橱柜灯 | 204 | 0 (0%) | IP20 |

### 规则

```typescript
const CATEGORY_IP_MAP: Record<string, string> = {
  "灯丝灯": "20",
  "球泡": "20",
  "风扇灯": "20",
  "橱柜灯": "20",
};

// 只为没有 ip 参数的产品添加
// source_field = "category_inference"
// confidence = "low"
// raw_value = "IP20"
// normalized_value = "20"
```

### 安全约束

- 只为产品 category 精确匹配 4 个品类的产品添加
- 只为当前没有 ip 参数的产品添加
- 不覆盖任何已有参数

### 预期

+1,563 IP 参数。IP 覆盖率从 17.8% 提升到 ~33%。

---

## Part E — product_name 参数再提取

V10.9 已做过 product_name 提取，但只覆盖了部分模式。本轮用更宽泛的正则，只为缺失该参数的产品添加。

### 目标字段

扫描 `product_name`（主要）和 `model_no`（辅助），拼合后做正则匹配：

```typescript
const text = `${product.product_name} ${product.model_no ?? ""}`;
```

### 提取规则

```typescript
const NAME_EXTRACTORS: NameExtractor[] = [
  {
    paramKey: "ip",
    // IP20, IP44, IP54, IP65, IP67, IP68, IPX4
    regex: /\bIP\s*[Xx]?\s*(\d{2})\b/i,
    normalize: (m) => m[1],
    validate: (v) => ["20","40","44","45","54","55","65","66","67","68"].includes(v),
  },
  {
    paramKey: "voltage",
    // 220-240V, AC100-277V, DC12V, DC24V, 100-265V
    regex: /\b(?:AC|DC)?\s*(\d{2,3})\s*[-~–]\s*(\d{2,3})\s*V\b/i,
    normalize: (m) => `${m[1]}-${m[2]}`,
    unit: "V",
  },
  {
    paramKey: "voltage",
    // 单一电压: AC220V, DC12V, DC24V, 230V
    regex: /\b(AC|DC)\s*(\d{2,3})\s*V\b/i,
    normalize: (m) => `${m[1]}${m[2]}`,
    unit: "V",
  },
  {
    paramKey: "cct",
    // 3000K, 4000K, 6500K, 2700-6500K
    regex: /\b(\d{4})\s*(?:[-~–]\s*(\d{4})\s*)?[Kk]\b/,
    normalize: (m) => m[2] ? `${m[1]}-${m[2]}` : m[1],
    validate: (v) => {
      const nums = v.split("-").map(Number);
      return nums.every(n => n >= 1800 && n <= 10000);
    },
    unit: "K",
  },
  {
    paramKey: "cct",
    // 3CCT, CCT可调, 双色温, 三色温
    regex: /\b(?:3CCT|CCT可调|双色温|三色温|(?:2|3)色)\b/i,
    normalize: () => "tunable",
  },
  {
    paramKey: "cri",
    // CRI>80, CRI≥90, Ra>80, Ra≥80
    regex: /\b(?:CRI|Ra)\s*[>≥]\s*(\d{2})\b/i,
    normalize: (m) => m[1],
    validate: (v) => Number(v) >= 60 && Number(v) <= 99,
  },
  {
    paramKey: "pf",
    // PF>0.9, PF≥0.5
    regex: /\bPF\s*[>≥=]\s*(0\.\d+)\b/i,
    normalize: (m) => m[1],
  },
  {
    paramKey: "driver_type",
    // DOB, IC驱动, 恒流, 恒流IC, 线性
    regex: /\b(DOB|IC驱动|恒流IC|恒流|线性方案?)\b/i,
    normalize: (m) => m[1],
  },
];
```

### 安全约束

- 只写入产品当前缺失的参数
- source_field = "product_name_v2"
- confidence = "medium"
- 每个产品每个 param_key 只写第一个匹配

### 预期

根据诊断：IP 从名字提取极少（~1 条），CCT ~95 条，voltage ~53 条，CRI ~7 条。总计 ~150-200 新参数。

---

## 报告：`docs/v12.1-coverage-round4-report.md`

```markdown
# V12.1 覆盖率第四轮综合提升报告

模式: dry-run / apply
时间: ...
备份: prisma/dev.db.bak-v12.1

## Part A — 脏数据清理

| 类别 | 检测 | 删除 |
|---|---:|---:|
| A1 价格误当参数 | X | X |
| A2 CRI 脏数据 | X | X |
| A3 PF 脏数据 | X | X |
| A4 IP 脏数据 | X | X |
| 合计 | X | X |

### A1 按 (source_field, param_key)

| source_field | param_key | 数量 |

### A2 脏 CRI 采样

| normalized_value | raw_value | source_field | 数量 |

### A3 脏 PF 采样

| normalized_value | raw_value | source_field | 数量 |

### A4 脏 IP 采样

| normalized_value | source_field | 数量 |

## Part B — 垃圾产品清理

| 指标 | 数值 |
|---|---:|
| 零参数产品总数 | X |
| 匹配垃圾模式 | X |
| 有图片跳过 | X |
| 有 quote_items 跳过 | X |
| 安全删除 | X |

### 按模式分类

| 模式 | 匹配数 | 删除数 | 跳过（图片） |

### 删除采样（前 50 条）

| category | product_name | 模式 |

## Part C — 文件级参数传播（70%）

| 指标 | 数值 |
|---|---:|
| 扫描文件数 | X |
| 触发组数 | X |
| 受益产品数 | X |
| 新增参数 | X |

### 按 param_key

| param_key | 新增 | 受益产品 | 传播文件数 |

### 采样（前 30 条）

| param_key | 值 | 文件名 | 比例 | 受益产品数 |

## Part D — 品类 IP 推断

| 品类 | 推断产品数 | 已有跳过 |
|---|---:|---:|

## Part E — product_name 参数再提取

| param_key | 新增 | 已有跳过 |
|---|---:|---:|

### 采样（前 30 条）

| param_key | raw_value | product_name | model_no |

## 汇总

| 指标 | 数值 |
|---|---:|
| Part A 删除参数 | X |
| Part B 删除产品 | X |
| Part C 新增参数 | X |
| Part D 新增参数 | X |
| Part E 新增参数 | X |
| products 变化 | 前 → 后 |
| product_params 变化 | 前 → 后 |

## 覆盖率变化（去重产品数）

注意：使用 COUNT(DISTINCT product_id) 统计，非记录数。

| param_key | 之前 | 之后 | 变化 | 覆盖率 |
```

---

## Commit

```
V12.1: coverage round 4 — cleanup, propagation, category IP, name extraction

- Part A: clean ~190 dirty params (prices in excel_column/multirow, bad CRI/PF/IP values)
- Part B: junk product cleanup round 2 (contract terms, notes, specs as products)
- Part C: file-level param propagation at 70% threshold
- Part D: category-based IP20 inference for 灯丝灯/球泡/风扇灯/橱柜灯
- Part E: product_name regex extraction v2 for IP/voltage/CCT/CRI/PF/driver_type
```

## 重跑管线

```bash
npx tsx scripts/v12.1-coverage-round4.ts --apply
npx tsx scripts/v10.4-derive-params.ts --apply
npx tsx scripts/v10.0-source-audit.ts
```

## 不做什么

- 不改 v11-shared.ts 或其他现有脚本
- 不改 Prisma schema
- 不改前端
- 不修改源 Excel 文件
- Part C 不传播 watts/lumens/beam_angle/led_count/size_display（产品级差异化参数）
- Part D 只推断 IP，不推断 CRI/PF/voltage（这些品类内差异太大）
- 覆盖率统计用 COUNT(DISTINCT product_id)，不再用记录数
