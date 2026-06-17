# V12.3 — 工厂+品类传播 + 品类默认值

确定性提取已用尽，但品类级统计显示 CRI/PF/driver_type/voltage 有强主导值（≥85% 的已有产品共享同一值）。本任务分两步利用这个信号。

**必须在 V12.2 commit 之后执行。**

## 前置

```bash
cp prisma/dev.db prisma/dev.db.bak-v12.3
```

## 新建文件：`scripts/v12.3-category-defaults.ts`

```bash
npx tsx scripts/v12.3-category-defaults.ts              # dry-run
npx tsx scripts/v12.3-category-defaults.ts --apply       # 写入
```

---

## Part A — 工厂+品类传播

比文件级传播更广：同一 factory_name + category 的产品，如果 ≥60% 共享同一 param_key 的 normalized_value，且 ≥5 个产品有该值，则传播到该组内缺失该参数的产品。

```typescript
// 通过 supplier_offers.factory_name 确定产品的工厂
// 同一产品可能有多个工厂的 offer → 用任意一个（第一个即可）
// param_keys: voltage, cri, pf, driver_type, cct
// source_field: "factory_category_propagation"
// confidence: "low"
```

### 实现逻辑

```typescript
for each (factory, category) group with ≥5 products:
  for each param_key in [voltage, cri, pf, driver_type, cct]:
    count products WITH this param_key and their normalized_value distribution
    find dominant value (highest count)
    if dominant_count / total_with_param >= 0.60 AND dominant_count >= 3:
      for each product in this group MISSING this param_key:
        if not in existingParamKeys:
          plan insert(param_key, dominant_value, source="factory_category_propagation", confidence="low")
```

预计产出：~470 params

---

## Part B — 品类默认值

对品类内有强主导值的参数，将默认值应用到缺失该参数的所有产品。

### 安全规则

1. 只对"该品类中已有此参数的产品"计算主导值占比，NOT 全品类产品
2. 主导值占比 ≥ 85%
3. 已有样本数 ≥ 10（避免小样本偏差）
4. 不覆盖已有值
5. source_field: "category_default"
6. confidence: "low"

### 默认值表（从数据验证得出）

```typescript
const CATEGORY_DEFAULTS: Array<{
  category: string;
  paramKey: string;
  value: string;
  unit: string | null;
  rawValue: string;
}> = [
  // CRI defaults — 品类主导值占比 ≥85%
  { category: "线条灯",     paramKey: "cri", value: "80", unit: null, rawValue: "CRI≥80" },
  { category: "筒灯",       paramKey: "cri", value: "80", unit: null, rawValue: "CRI≥80" },
  { category: "磁吸灯",     paramKey: "cri", value: "90", unit: null, rawValue: "CRI≥90" },
  { category: "灯丝灯",     paramKey: "cri", value: "80", unit: null, rawValue: "CRI≥80" },
  { category: "太阳能壁灯", paramKey: "cri", value: "80", unit: null, rawValue: "CRI≥80" },
  { category: "风扇灯",     paramKey: "cri", value: "80", unit: null, rawValue: "CRI≥80" },
  { category: "吸顶灯",     paramKey: "cri", value: "80", unit: null, rawValue: "CRI≥80" },
  { category: "三防灯",     paramKey: "cri", value: "80", unit: null, rawValue: "CRI≥80" },
  { category: "太阳能",     paramKey: "cri", value: "80", unit: null, rawValue: "CRI≥80" },
  { category: "路灯",       paramKey: "cri", value: "80", unit: null, rawValue: "CRI≥80" },
  { category: "轨道灯",     paramKey: "cri", value: "80", unit: null, rawValue: "CRI≥80" },
  { category: "地埋灯/地插灯", paramKey: "cri", value: "80", unit: null, rawValue: "CRI≥80" },

  // PF defaults — 品类主导值占比 ≥85%
  { category: "筒灯",       paramKey: "pf", value: "0.5", unit: null, rawValue: "PF≥0.5" },
  { category: "灯丝灯",     paramKey: "pf", value: "0.5", unit: null, rawValue: "PF≥0.5" },
  { category: "太阳能壁灯", paramKey: "pf", value: "0.5", unit: null, rawValue: "PF≥0.5" },
  { category: "投光灯",     paramKey: "pf", value: "0.9", unit: null, rawValue: "PF≥0.9" },
  { category: "灯带",       paramKey: "pf", value: "0.5", unit: null, rawValue: "PF≥0.5" },
  { category: "太阳能",     paramKey: "pf", value: "0.9", unit: null, rawValue: "PF≥0.9" },
  { category: "路灯",       paramKey: "pf", value: "0.9", unit: null, rawValue: "PF≥0.9" },
  { category: "轨道灯",     paramKey: "pf", value: "0.5", unit: null, rawValue: "PF≥0.5" },
  { category: "应急灯",     paramKey: "pf", value: "0.5", unit: null, rawValue: "PF≥0.5" },
  { category: "灯管",       paramKey: "pf", value: "0.5", unit: null, rawValue: "PF≥0.5" },
  { category: "地埋灯/地插灯", paramKey: "pf", value: "0.5", unit: null, rawValue: "PF≥0.5" },
  { category: "净化灯",     paramKey: "pf", value: "0.5", unit: null, rawValue: "PF≥0.5" },

  // driver_type defaults — 品类主导值占比 ≥85%
  { category: "灯丝灯",     paramKey: "driver_type", value: "LC", unit: null, rawValue: "LC" },
  { category: "壁灯",       paramKey: "driver_type", value: "非隔离", unit: null, rawValue: "非隔离" },
  { category: "镜前灯",     paramKey: "driver_type", value: "隔离", unit: null, rawValue: "隔离" },

  // voltage defaults — 品类主导值占比 ≥85%
  { category: "灯丝灯",     paramKey: "voltage", value: "220-240", unit: "V", rawValue: "220-240V" },
  { category: "轨道灯",     paramKey: "voltage", value: "220-240", unit: "V", rawValue: "220-240V" },
  { category: "风扇灯",     paramKey: "voltage", value: "110-265", unit: "V", rawValue: "110-265V" },
];
```

### 运行时验证

脚本在 apply 前必须**动态验证**每条默认值仍然满足 ≥85% 占比和 ≥10 样本。如果不满足，跳过并记录在报告中。

```typescript
for each default in CATEGORY_DEFAULTS:
  // 查询该品类中有此 param_key 的产品的 normalized_value 分布
  const distribution = await getParamDistribution(default.category, default.paramKey);
  const total = sum(distribution.values());
  const dominantCount = distribution.get(default.value) ?? 0;
  if (total < 10 || dominantCount / total < 0.85):
    skip and log "验证失败: {category} {paramKey}={value}, {dominantCount}/{total}={pct}%"
    continue
  
  // 查询该品类中缺少此 param_key 的产品
  const missingProducts = await getMissingProducts(default.category, default.paramKey);
  for each product in missingProducts:
    if not in existingParamKeys:
      plan insert
```

### 预计产出

| param_key | 预计新增 |
|---|---:|
| cri | ~5,000 |
| pf | ~3,500 |
| driver_type | ~1,100 |
| voltage | ~500 |
| **合计** | **~10,000+** |

---

## 报告：`docs/v12.3-category-defaults-report.md`

```markdown
# V12.3 工厂+品类传播 + 品类默认值报告

模式: dry-run / apply
时间: ...
备份: prisma/dev.db.bak-v12.3

## Part A — 工厂+品类传播

| param_key | 传播组数 | 新增 params |
|---|---:|---:|

### Part A 采样（前 30 条）

| factory | category | param_key | value | 组内产品 | 已有占比 | 受益产品 |

## Part B — 品类默认值

### 验证结果

| category | param_key | value | 样本数 | 占比 | 状态（通过/跳过） |

### 按品类×参数插入明细

| category | param_key | value | 缺口产品 | 实际新增 |
|---|---|---|---:|---:|

### Part B 采样（前 50 条）

| category | param_key | value | product model_no | product_name |

## 汇总

| 指标 | 数值 |
|---|---:|
| Part A 新增 | X |
| Part B 新增 | X |
| product_params 变化 | 前 → 后 |

## 覆盖率变化（COUNT DISTINCT product_id）

| param_key | 之前 | 之后 | 变化 | 覆盖率 |
|---|---:|---:|---:|---:|
```

---

## Commit

```
V12.3: factory+category propagation and category-level defaults for CRI/PF/driver_type/voltage
```

## 不做什么

- 不改 CCT（品类内值差异大，不适合默认值）
- 不改现有脚本
- 不删产品/参数/offers
- 不改 Prisma schema
- 不改前端
- 不修改源 Excel 文件
- 不覆盖已有参数值
- 不对样本数 < 10 的品类做默认值推断
