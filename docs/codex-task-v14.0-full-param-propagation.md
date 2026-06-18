# V14.0 — 全参数补全大版本

当前完成率 54.9%（5621/10244，排除 32 个配件）。本任务用三种补全策略依次填充所有 9 个核心参数的缺口，目标 62-67%。

**执行顺序**：Remark 提取 → 文件级传播 → 工厂+品类传播。先执行的方法优先级更高，后续方法只填剩余缺口。

**依赖：V13.9 已完成。**

## 前置

```bash
cp prisma/dev.db prisma/dev.db.bak-v14.0
```

## 新建文件：`scripts/v14.0-full-param-propagation.ts`

```bash
npx tsx scripts/v14.0-full-param-propagation.ts              # dry-run
npx tsx scripts/v14.0-full-param-propagation.ts --apply       # 写入
```

---

## 公共基础

从 `v11-shared.ts` 导入：
```typescript
import { CATEGORY_CORE_PARAMS, loadAccessoryProductIds, escapeMd, INSERT_BATCH_SIZE, productParamKey } from "./v11-shared";
```

加载数据：
1. 所有 products（id, productName, modelNo, category, remark）
2. 所有现有 product_params（productId, paramKey, normalizedValue）
3. accessoryIds（通过 `loadAccessoryProductIds`）
4. product → source_file_id 映射（通过 supplier_offers，取 first offer: `ROW_NUMBER() OVER (PARTITION BY product_id ORDER BY created_at ASC)`）
5. product → factory_name 映射（同上 first offer）

构建 `existingParamKeys: Set<string>`，key 格式 = `${productId}::${paramKey}`（复用 `productParamKey` 函数）。

每次插入新 param 后立即更新 `existingParamKeys`，确保后续方法不重复填充。

所有新 param 的 `confidence` = `"low"`，因为是统计推断。

---

## Part A — Remark 多参数提取

V13.3 已提取 CCT + voltage。本部分对 **所有 9 个核心参数** 用正则从 remark 提取，但只填尚未有值的。

### 提取规则

每个参数的正则按以下顺序匹配，取第一个命中值。

#### 1. voltage

```typescript
// 已有 V13.3 处理，但仍可能有遗漏
// "Voltage: 220-240V" / "电压: 100-240V" / "输入电压Voltage: 200-240VAC"
// "100-240V/50Hz" / "220～240V" / "AC220V" / "DC24V" / "DC12V"
/(?:voltage|电压|输入电压)[:\s：/]*(?:AC|DC)?\s*(\d{1,3}[-–～~]\d{1,3})\s*V?/i
/(?:voltage|电压)[:\s：/]*(?:AC|DC)?\s*(\d{1,3})\s*V/i
/\b(?:AC|DC)\s*(\d{1,3}[-–～~]\d{1,3})\s*V/i
/\b(?:AC|DC)\s*(\d{1,3})\s*V\b/i
// 归一化：保留数字范围，去掉 AC/DC/V 字符
```

#### 2. cct

```typescript
// 已有 V13.3 处理，但补充：
// "色温C.C.T: 6500K" / "CCT/色温: 3000K/4000K/6500K"
// "色温: dimmable/涂鸦调色" → 排除（non-numeric）
/(?:CCT|C\.C\.T|色温|color\s*temp)[:\s：/]*(\d{4,5})\s*K/i
// 多色温：取第一个值
// 排除：值不含数字的（如 "dimmable"）
```

#### 3. cri

```typescript
// "RA80" / "CRI: >80" / "Ra≥80" / "CRI/显指: >80" / "显色指数: ≥80"
/\bRA\s*[>≥]?\s*(\d{2,3})/i
/\bCRI\s*[:\s：>≥]*(\d{2,3})/i
/显[色指][指数]*\s*[:\s：>≥]*(\d{2,3})/
// 归一化为 ">80" 或 ">90" 或 ">95"（向下取标准档）
// 80-84 → ">80", 85-89 → ">80", 90-94 → ">90", 95+ → ">95"
```

#### 4. pf

```typescript
// "PF0.5" / "PF>0.9" / "PF＞0.5" / "PF: ≥0.5" / "功率因素PF: DF0.7" / "PF/功率因素: >0.9"
/\bPF\s*[:\s：>≥＞]*[DF]?\s*(0\.\d+)/i
/功率因[素数]\s*[:\s：>≥＞]*[DF]?\s*(0\.\d+)/
// 归一化为 ">0.5" 或 ">0.9"
// 0.5-0.89 → ">0.5", 0.9+ → ">0.9"
```

#### 5. ip

```typescript
// "IP65" / "IP44" / "IP20" / "防水等级：IP65" / "Others/其他功能: IP44"
/\bIP\s*(\d{2})\b/i
/防水[等级]*\s*[:\s：]*IP\s*(\d{2})/
// 归一化为 "IP" + 两位数字，如 "IP65"
```

#### 6. material

```typescript
// "Material: ALU body + PS diffusor" / "材质: 铝/ADC12" / "Materials/材料: PC+PMMA+ABS"
/(?:material|材[质料]|材料)[:\s：/]*([^\n,;]{3,40})/i
// 取匹配的 rawValue，不做归一化（material 值太多样）
// 但必须排除占位符值：如 "Material: Material", "材质: -"
```

#### 7. driver_type

```typescript
// "驱动: 非隔离" / "Driver/电源驱动: No-isolated/非隔离" / "Driver: isolated"
/(?:driver|驱动|电源驱动)[:\s：/]*(?:No-isolated|非隔离)/i  → "non-isolated"
/(?:driver|驱动|电源驱动)[:\s：/]*(?:isolated|隔离)/i  → "isolated"  // 注意：先匹配 no-isolated
```

#### 8. beam_angle

```typescript
// "Beam Angle: 120°" / "发光角度: 120°"
/(?:beam\s*angle|发光角度|光束角)[:\s：]*(\d{2,3})\s*°?/i
// 归一化为纯数字字符串，如 "120"
```

#### 9. base

```typescript
// "灯头类型：GU10" / "Base: E27" / "lamp base: E14"
/(?:base|灯头[类型]*)[:\s：]*([EGe][UuCc]?\d{1,2})/i
// 归一化为大写，如 "E27", "GU10", "E14"
```

### 排除规则

- 跳过 accessory 产品
- 跳过 remark 为空或 < 5 字符的产品
- 跳过 `existingParamKeys` 中已有的 product×param 组合
- 跳过只有该品类核心参数列表里不包含的参数（只填核心参数）
- material 排除占位符值：raw 值匹配 `/^[-\/\s]*$|^material$/i` 则跳过

### source_field

所有 Part A 记录：`source_field = "remark_extraction_v14"`

---

## Part B — 文件级传播（70% 阈值）

对所有 9 个核心参数，按 source_file_id 分组统计已有值的分布。如果某文件内 ≥70% 的产品共享同一 normalizedValue，则将该值填充到同文件内缺少该参数的产品。

### 逻辑

```
对每个 param_key in [voltage, cct, cri, ip, pf, driver_type, material, beam_angle, base]:
  对每个 source_file_id:
    统计该文件内非 accessory 产品的 param 值分布
    如果某值占比 ≥ 70% 且样本数 ≥ 3:
      对该文件内缺少此 param 的非 accessory 产品:
        如果该 param 在该产品品类的 CATEGORY_CORE_PARAMS 中:
          填充为该主导值
```

### 约束

- 只填核心参数（检查 `CATEGORY_CORE_PARAMS[product.category]`）
- 一个产品可能通过多个 offer 关联多个文件 → 使用 first offer 的 source_file_id
- source_field: `"file_propagation_v14"`
- confidence: `"low"`

---

## Part C — 工厂+品类传播（50% 阈值）

对所有 9 个核心参数，按 factory_name + category 分组。如果该组合内 ≥50% 的产品共享同一 normalizedValue，且样本数 ≥5，则填充。

### 逻辑

```
对每个 param_key in [voltage, cct, cri, ip, pf, driver_type, material, beam_angle, base]:
  对每个 (factory_name, category) 组合:
    统计已有 param 值分布（仅非 accessory, 使用 first offer）
    如果某值占比 ≥ 50% 且样本数 ≥ 5:
      对该组合内缺少此 param 的非 accessory 产品:
        如果该 param 在该产品品类的 CATEGORY_CORE_PARAMS 中:
          填充为该主导值
```

### 约束

- factory_name 来自 first offer（`ROW_NUMBER() OVER (PARTITION BY product_id ORDER BY created_at ASC)`）
- 如果 factory_name 为 null，跳过该产品
- source_field: `"factory_category_propagation_v14"`
- confidence: `"low"`

---

## Part D — 覆盖率重算 + 报告

完成 A/B/C 后，重新统计完成率（排除 accessory），与 V13.9 基线对比。

报告写入 `docs/v14.0-full-param-propagation-report.md`。

```markdown
# V14.0 全参数补全报告

模式: dry-run / apply
时间: ...
备份: prisma/dev.db.bak-v14.0

## 汇总

| 方法 | 新增记录数 |
|---|---:|
| A: Remark 多参数提取 | X |
| B: 文件级传播 70% | X |
| C: 工厂+品类传播 50% | X |
| 合计 | X |

## Part A 明细

| param_key | 新增 |
|---|---:|
| voltage | X |
| cct | X |
| cri | X |
| pf | X |
| ip | X |
| material | X |
| driver_type | X |
| beam_angle | X |
| base | X |

### Part A 样本（每参数最多 5 条）

| category | product_name | param_key | raw_value | normalized_value | remark 片段 |
|---|---|---|---|---|---|

## Part B 明细

| param_key | 新增 |
|---|---:|

## Part C 明细

| param_key | 新增 |
|---|---:|

## 覆盖率变化

| 指标 | V13.9 | V14.0 |
|---|---:|---:|
| 核心参数覆盖范围产品 | 10244 | X |
| 全部完成产品 | 5621 | X |
| 全局完成率 | 54.9% | X% |

### 逐品类完成率（仅变化品类）

| 品类 | 产品数 | V13.9完成 | V14.0完成 | 变化 |
|---|---:|---:|---:|---:|

### 逐参数覆盖率

| param_key | 覆盖 | 需覆盖 | 覆盖率 |
|---|---:|---:|---:|

## DB 计数

| 表 | 执行前 | 执行后 | 变化 |
|---|---:|---:|---:|
| products | 10284 | 10284 | 0 |
| product_params | 88623 | X | +X |
```

---

## Commit

```
V14.0: full parameter propagation via remark extraction, file-level and factory+category defaults
```

## 不做什么

- 不删除任何记录
- 不改 category
- 不改 Prisma schema / 前端
- 不修改源 Excel 文件
- 不调用 DeepSeek API
- 不改已有的 V13.x 脚本
- 不标记新配件（V13.9 已完成）
- 不修改 CATEGORY_CORE_PARAMS 定义
