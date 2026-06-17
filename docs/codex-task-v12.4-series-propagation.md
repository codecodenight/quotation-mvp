# V12.4 — 同系列参数传播

同工厂同品类的产品中，型号前缀相同的产品（同系列）几乎一定共享 voltage/CRI/PF/driver_type/material 等规格。本任务从 model_no 提取系列前缀，在系列内传播参数。

**必须在 V12.3 commit 之后执行。**

## 前置

```bash
cp prisma/dev.db prisma/dev.db.bak-v12.4
```

## 新建文件：`scripts/v12.4-series-propagation.ts`

```bash
npx tsx scripts/v12.4-series-propagation.ts              # dry-run
npx tsx scripts/v12.4-series-propagation.ts --apply       # 写入
```

---

## 核心逻辑

### Step 1 — 提取系列前缀

```typescript
function extractSeriesPrefix(modelNo: string): string | null {
  if (!modelNo || modelNo.length < 3) return null;
  
  let prefix = modelNo.trim();
  
  // 1. 去掉尾部瓦数: "-100W", "-40w", "-48W"
  prefix = prefix.replace(/[-\s]\d+[Ww]$/i, '');
  
  // 2. 去掉尾部纯数字段: "-8118", "-300", "-1200"
  prefix = prefix.replace(/[-\s]\d{2,}$/, '');
  
  // 3. 如果还有尾部 "-数字字母混合" 且前面有内容，再试一次
  //    e.g. "YLT-TG163-100W" → step1 → "YLT-TG163"
  //    e.g. "LP-6060-48W" → step1 → "LP-6060"
  
  // 4. 最终前缀太短(< 3 chars)或等于原值(无法分组)则返回 null
  if (prefix.length < 3 || prefix === modelNo.trim()) return null;
  
  return prefix;
}
```

### Step 2 — 分组

```typescript
// 按 (factory_name, category, series_prefix) 分组
// factory_name 来自 supplier_offers（取任一 offer 的 factory_name）
// 最少 3 个产品的组才处理
```

### Step 3 — 传播

```typescript
const PROPAGATABLE_PARAMS = ['voltage', 'cct', 'cri', 'pf', 'driver_type', 'material'] as const;

for each (factory, category, prefix) group with >= 3 products:
  for each param_key in PROPAGATABLE_PARAMS:
    // 收集组内已有该参数的产品的值分布
    const distribution = getValueDistribution(group, param_key);
    if (distribution.size === 0) continue;
    
    const dominant = getDominantValue(distribution);
    const total_with_param = sum(distribution.values());
    
    // 一致性检查：主导值 ≥ 70% 且 ≥ 2 个产品有该值
    if (dominant.count < 2) continue;
    if (dominant.count / total_with_param < 0.70) continue;
    
    // 传播到组内缺失该参数的产品
    for each product in group WHERE missing param_key:
      insert(param_key, dominant.value, source="series_propagation", confidence="low")
```

### 与 V12.3 的关系

- V12.3 Part A 是 factory+category 级传播（≥60% 阈值，不区分系列）
- V12.4 是 factory+category+series 级传播（≥70% 阈值，更精确）
- V12.4 运行在 V12.3 之后，V12.3 填不了的（因为工厂内值不统一），V12.4 按系列细分后可能统一
- existingParamKeys 检查确保不重复插入

---

## 预计规模

基于诊断数据，factory+category 组中有部分覆盖的：

| param_key | 组内缺口产品 |
|---|---:|
| material | 1,994 |
| voltage | 1,842 |
| cct | 1,662 |
| pf | 1,129 |
| cri | 749 |
| driver_type | 502 |

系列分组会比 factory+category 更精细，实际产出取决于系列内一致性。保守估计总产出 **2,000-4,000 params**。

---

## 报告：`docs/v12.4-series-propagation-report.md`

```markdown
# V12.4 同系列参数传播报告

模式: dry-run / apply
时间: ...
备份: prisma/dev.db.bak-v12.4

## 系列分组统计

| 指标 | 数值 |
|---|---:|
| 有效 model_no 产品 | X |
| 提取到系列前缀 | X |
| 系列组数（≥3 产品） | X |

## 传播结果

| param_key | 触发系列组 | 新增 params | 受益产品 |
|---|---:|---:|---:|

### 采样（前 50 条）

| factory | category | series_prefix | param_key | value | 系列产品数 | 已有占比 | 受益产品 |

## 覆盖率变化

| param_key | 之前 | 之后 | 变化 | 覆盖率 |
|---|---:|---:|---:|---:|

## 汇总

| 指标 | 数值 |
|---|---:|
| 新增 params | X |
| product_params 变化 | 前 → 后 |
```

---

## Commit

```
V12.4: propagate params within same model series (factory+category+prefix groups)
```

## 不做什么

- 不改现有脚本
- 不删产品/参数
- 不改 Prisma schema / 前端
- 不修改源 Excel 文件
- 不覆盖已有参数
- 前缀提取失败的产品直接跳过
