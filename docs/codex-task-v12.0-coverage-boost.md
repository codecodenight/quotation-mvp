# V12.0 — 参数覆盖率第三轮综合提升

本任务包含 4 个 Part，全部写在一个脚本里，顺序执行。

## 前置

```bash
cp prisma/dev.db prisma/dev.db.bak-v12.0
```

## 新建文件：`scripts/v12.0-coverage-boost.ts`

```bash
npx tsx scripts/v12.0-coverage-boost.ts              # dry-run（全部 Part）
npx tsx scripts/v12.0-coverage-boost.ts --apply       # 写入
```

---

## Part A — V11.5 残留脏数据清理

V11.5 清理了 184 条脏数据，但漏了 12 条 `$` 开头的价格值（无 "US" 前缀）。

```typescript
// 删除条件
WHERE source_field = 'reverse_match'
AND (
  raw_value LIKE '$%'                    -- $0.61, $1.87, $15.73 等
  AND raw_value GLOB '$[0-9]*'           -- 确认是 $ + 数字，不是 $XXXXX 产品代码
)
```

预期删除：12 条。

---

## Part B — 列头即数值模式修复（V11.3 根因修复）

### 问题

V11.3 只产出 4 条参数。根因：`detectBestHeader` 的 `mergeHeaderRows` 把多行表头合并后，"3W" 变成 "非隔离窄压驱动 3W"，导致 `detectValueHeaders` 的正则 `^(\d+)\s*[Ww]$` 无法匹配。

### 典型结构

```
Row 3: 型号 |     非隔离窄压驱动     |     (广义组标签，跨多列)
Row 4:      | 3W | 5W | 9W | 12W    |     (子行含数值列头)
Row 5: 2.5寸| 3.53|    |    |        |     (数据行)
```

合并后 headerValues[1] = "非隔离窄压驱动 3W"，`detectValueHeaders` 匹配失败。

### 修复方案

不改 `v11-shared.ts`。在 V12 脚本中：

```typescript
import { detectMultiRowHeader, detectBestHeader } from "./v11-shared";

function getValueHeaderSource(rows: unknown[][]): unknown[] | null {
  const multi = detectMultiRowHeader(rows);
  if (multi && multi.subRow != null) {
    // 子行存在时，用原始子行做 value-header 检测
    return rows[multi.subRow] ?? null;
  }
  // 无子行时，用标准 header
  const best = detectBestHeader(rows);
  return best.headerValues.length > 0 ? best.headerValues as unknown[] : null;
}

// detectValueHeaders 复用 V11.3 的逻辑（见下方），但输入换成子行原值
```

### detectValueHeaders

和 V11.3 完全相同的正则（复制过来，不 import V11.3）：

- watts: `^(\d+(?:\.\d+)?)\s*[Ww](?:\s*±\s*\d+%)?$`
- efficacy: `^(\d+(?:\.\d+)?)\s*(?:lm\/[Ww]|LM\/W)(?:\s*±\s*\d+%)?$/i`
- cri: `^(?:Ra\s*)?[>≥]\s*(\d{2})$/i`（60-99 范围）
- pf: `^(?:PF\s*)?[>≥]\s*(0\.\d+)$/i`
- ip: `^IP\s*(\d{2})$/i`
- voltage: `^(?:AC\s*)?(\d+)\s*(?:[-~–]\s*(\d+)\s*)?V$/i`
- cct: `^(\d{4})\s*(?:[-~–]\s*(\d{4})\s*)?[Kk]$`（1800-10000 范围）

### 行匹配

沿用 `detectBestHeader` 返回的 `modelColIndex` 和 `dataStartRow`。匹配逻辑和 V11.3 相同：
1. `modelColIndex` 必须存在
2. `valueHeaders.length >= 2`
3. 每行：用 model column 的 cell 值通过 `matchProduct` 匹配到 DB 产品
4. 检查哪些 value-header 列在该行有数据
5. 如果同一行多个 watts 列有数据，不写 watts（歧义）
6. 不覆盖已有参数

### 目标

当前 1,237 个 "matched but no watts" 产品中，很大一部分来自使用数值列头的文件。修复后预期新增数百条 watts/efficacy/cri/pf/ip/voltage 参数。

---

## Part C — 复合型号自解析

### 问题

124 个灯丝灯的 model_no 格式为 `"C35乳白 C35 Milky White - 4W - E14 E27 - E14 35*98 E27 35*92"`，包含 watts/base/size 信息。这些产品可能已有 watts（来自其他提取路径），但可能缺少 base 和更精确的 size_display。

### 解析规则

```typescript
function parseCompoundModel(modelNo: string): ParsedParams[] {
  const params: ParsedParams[] = [];
  // 模式：用 " - " 分隔的字段
  const segments = modelNo.split(/\s+-\s+/).map(s => s.trim());
  if (segments.length < 3) return params;

  // 第二段通常是 watts: "4W", "4.9W", "10W"
  const wattsMatch = segments[1]?.match(/^(\d+(?:\.\d+)?)\s*[Ww]$/);
  if (wattsMatch) {
    params.push({ paramKey: "watts", rawValue: segments[1], normalizedValue: wattsMatch[1], unit: "W" });
  }

  // 第三段通常是 base: "E14 E27", "E27", "E14", "E27 E40"
  const baseMatch = segments[2]?.match(/^(E\d+(?:\s+E\d+)?)$/i);
  if (baseMatch) {
    params.push({ paramKey: "base", rawValue: segments[2], normalizedValue: segments[2], unit: null });
  }

  // 第四段通常是 size: "E14 35*98 E27 35*92", "60*105", "125*175"
  if (segments[3]) {
    const sizeMatch = segments[3].match(/(\d+\*\d+)/);
    if (sizeMatch) {
      params.push({ paramKey: "size_display", rawValue: segments[3], normalizedValue: segments[3], unit: null });
    }
  }

  return params;
}
```

### 适用范围

扫描所有 model_no 含 ` - ` 分隔符且 ≥3 段的产品。只写入产品尚未拥有的参数。

---

## Part D — 同文件同参数传播

### 原理

很多 Excel 文件中，同一个 sheet 的所有产品共享相同的 voltage / driver_type / ip / cri / pf。例如：一个 sheet 里 80% 的产品已有 `voltage=220-240V`，剩余 20% 缺失——它们大概率也是 `220-240V`。

### 规则

```typescript
// 对每个 (source_file_id, param_key) 组合：
// 1. 统计该文件关联的所有产品中，有该 param 的产品数和值分布
// 2. 如果某个值占比 >= 90%（绝对多数），则传播给同文件缺失该 param 的产品
// 3. 标记 source_field = "file_propagation", confidence = "low"

const PROPAGATABLE_PARAMS = [
  "voltage", "driver_type", "ip", "cri", "pf", "cct", "material"
];

// 不传播 watts/lumens/beam_angle/led_count/size_display（这些是产品级差异化参数）
```

### 安全约束

- 只在同一个 source_file_id 内传播（不跨文件）
- 90% 阈值：如果一个文件有 20 个产品，18 个都有 `voltage=220-240V`，2 个没有，才传播
- 最少 5 个已有产品才启用传播（样本太小不可信）
- 不覆盖已有参数
- confidence = "low"，与 extraction 的 "high"/"medium" 区分

### 预期效果

大幅提升 voltage / driver_type / ip / cri / pf 覆盖率（这些参数通常是文件级/sheet 级常量）。

---

## 报告：`docs/v12.0-coverage-boost-report.md`

```markdown
# V12.0 参数覆盖率第三轮提升报告

模式: dry-run / apply
时间: ...
备份: prisma/dev.db.bak-v12.0

## Part A — 脏数据清理

| 指标 | 数值 |
|---|---:|
| 检测到 | X |
| 删除 | X |

## Part B — 列头数值修复

| 指标 | 数值 |
|---|---:|
| 扫描文件数 | X |
| 检测到数值列头的文件 | X |
| 检测到数值列头的 sheet | X |
| 匹配产品行数 | X |
| 新增参数 | X |
| 跳过（已存在） | X |
| 跳过（多 watts 冲突） | X |

### Part B 按 param_key

| param_key | 新增记录 |

### Part B 检测到的数值列头

| 列头原文 | 解析为 param_key | 出现文件数 | 匹配行数 |

## Part C — 复合型号解析

| 指标 | 数值 |
|---|---:|
| 扫描产品数 | X |
| 解析成功 | X |
| 新增参数 | X |
| 跳过（已存在） | X |

### Part C 按 param_key

| param_key | 新增记录 |

## Part D — 同文件参数传播

| 指标 | 数值 |
|---|---:|
| 扫描文件数 | X |
| 触发传播的 (文件, param_key) 组 | X |
| 受益产品数 | X |
| 新增参数 | X |
| 跳过（已存在） | X |

### Part D 按 param_key

| param_key | 新增记录 | 受益产品数 | 传播源文件数 |

### Part D 采样（前 30 条）

| param_key | 传播值 | 文件名 | 已有比例 | 受益产品数 |

## 汇总

| 指标 | 数值 |
|---|---:|
| Part A 删除 | X |
| Part B 新增 | X |
| Part C 新增 | X |
| Part D 新增 | X |
| product_params 变化 | 前 → 后 |

## 覆盖率变化

| param_key | 之前 | 之后 | 变化 |
```

---

## Commit

```
V12.0: coverage boost round 3 — value-header fix, model parsing, file propagation

- Part A: clean 12 residual $-prefix dirty params
- Part B: fix column-header-value detection by using raw sub-row values
- Part C: parse compound model_no (灯丝灯 format) for base/size
- Part D: propagate voltage/driver_type/ip/cri/pf/cct/material within same source file (90% threshold)
- Re-run derive and audit
```

## 重跑管线

```bash
npx tsx scripts/v12.0-coverage-boost.ts --apply
npx tsx scripts/v10.4-derive-params.ts --apply
npx tsx scripts/v10.0-source-audit.ts
```

## 不做什么

- 不改 v11-shared.ts 或其他现有脚本
- 不删产品
- 不改 Prisma schema
- 不改前端
- 不修改源 Excel 文件
- 不传播 watts/lumens/beam_angle/led_count/size_display（产品级差异化参数）
