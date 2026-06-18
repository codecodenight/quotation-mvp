# V13.3 — Remark 结构化文本 CCT/Voltage 提取

V13.0 DeepSeek 和 V13.2 规则填充后仍有 ~4,768 产品缺 CCT。调查发现其中 ~151 个产品的 remark 字段含有可提取的 CCT 值或关键词，另有 ~57 个产品含有 voltage 值。现有提取管线（V3.0/V10.9/V11.1）漏掉了这些产品——V10.9 只解析 product_name 不解析 remark，V3.0 的正则不覆盖所有格式。

**依赖：V13.2 已完成。**

## 前置

```bash
cp prisma/dev.db prisma/dev.db.bak-v13.3
```

## 新建文件：`scripts/v13.3-remark-extraction.ts`

```bash
npx tsx scripts/v13.3-remark-extraction.ts              # dry-run
npx tsx scripts/v13.3-remark-extraction.ts --apply       # 写入
```

---

## Part A — CCT 提取（三类模式）

### 模式 1：显式 K 值（~90 个产品）

从 remark 提取包含明确色温数值的文本：

```typescript
// 匹配模式（优先级从高到低）：
// 1. 范围值: "2700-6500K", "3000-6500K" → normalized: "2700-6500"
// 2. 多值: "3000K/4000K/5000K" → normalized: "3000-5000"（取首尾值）
// 3. 单值: "6500K", "4000K" → normalized: "6500", "4000"

// 正则: /(\d{4})(?:\s*[-\/]\s*(\d{4}))?\s*K/g
// 如果匹配多个独立 K 值（如 "3000K/4000K/6500K"），取 min-max 范围

// 过滤：
// - 值 < 1800 或 > 10000 跳过（不是色温）
// - 如果 remark 中色温值前有 ± 号则跳过（如 ±500K 是容差不是色温）
```

source_field: `remark_extraction`, confidence: `medium`

### 模式 2：中文色温关键词（~24 个产品）

```typescript
const CCT_KEYWORDS: Record<string, string> = {
  '暖白': '3000',
  '暖光': '3000',
  '冷白': '6500',
  '正白': '4000',
  '中性白': '4000',
};

const CCT_RANGE_KEYWORDS: Record<string, string> = {
  '三色': '3000-6500',
  '三色变光': '3000-6500',
  '双色': '3000-6500',
  '双色变光': '3000-6500',
  '可调色温': '3000-6500',
};

// 搜索 product_name 和 remark
// 如果同时匹配到 暖白+冷白 → '3000-6500'
// 如果匹配到 '白光/中性光/暖光' 这种多选描述 → '3000-6500'
// 注意：单独出现的 '白光' 可能是冷白(6500K)也可能是泛指，跳过
```

source_field: `keyword_extraction`, confidence: `low`

### 模式 3：3CCT 格式（~37 个产品）

```typescript
// remark 中 "3CCT" 或 "色温corol: 3CCT" → normalized: "3000-6500"
// remark 中 "开关CCT" → normalized: "3000-6500"（开关三色变光）
```

source_field: `keyword_extraction`, confidence: `low`

### 排除规则

```typescript
// 以下不提取：
// - "色温: 单色" → 未指定具体色温
// - "色温: /" → 空值
// - "色温: 定制" → 可定制
// - "色温: 可选" → 可选
// - 已有 CCT 参数（normalized_value 非空）的产品
```

---

## Part B — Voltage 提取（~57 个产品）

从 remark 提取电压值：

```typescript
// 匹配模式：
// "220-240V", "AC220-240V" → normalized: "220-240"
// "100-240V", "AC100-240V" → normalized: "100-240"
// "85-265V", "85-265VAC" → normalized: "85-265"
// "165-265V" → normalized: "165-265"
// "DC12V", "12V" → normalized: "12"
// "DC24V", "24V" → normalized: "24"
// "48V", "DC48V" → normalized: "48"
// "Voltage(VAC): 220-240V" → normalized: "220-240"
// "电压V: 220-240V" → normalized: "220-240"

// 正则: /(?:AC|DC)?\s*(\d{1,3}(?:\s*-\s*\d{1,3})?)\s*V(?:AC)?/gi
// 过滤：值 > 500 跳过
// 去 AC/DC/V 前后缀存入 normalized_value
```

source_field: `remark_extraction`, confidence: `medium`

---

## 报告：`docs/v13.3-remark-extraction-report.md`

```markdown
# V13.3 Remark 提取报告

模式: dry-run / apply
时间: ...
备份: prisma/dev.db.bak-v13.3

## Part A — CCT 提取

| 模式 | 扫描产品 | 匹配 | 跳过(已有) | 跳过(排除) | 新增 |
|---|---:|---:|---:|---:|---:|

### 按品类统计

| 品类 | 新增 CCT |
|---|---:|

### 采样（前 20 条）

| category | model | 来源文本 | 提取值 |

## Part B — Voltage 提取

| 指标 | 数量 |
|---|---:|

### 采样（前 10 条）

## 覆盖率变化

| 指标 | 变化前 | 变化后 |
|---|---:|---:|
| CCT 覆盖率(需覆盖) | 52.8% | X% |
| Voltage 覆盖率(需覆盖) | 81.8% | X% |
| product_params | 85,508 | X |
| 核心参数全部完成产品 | 4,084 | X |
| 全局完成率 | 39.7% | X% |

## DB 计数

| 表 | 执行前 | 执行后 | 变化 |
|---|---:|---:|---:|
| products | 10,284 | 10,284 | 0 |
| product_params | X | X | X |
```

---

## Commit

```
V13.3: extract CCT and voltage from remark structured text
```

## 不做什么

- 不调用 DeepSeek API
- 不覆盖已有参数
- 不删产品/offers/参数
- 不改 Prisma schema / 前端
- 不修改源 Excel 文件
- 不从 model_no 猜测 CCT（数字含义不确定）
