# V29.0: 品类级默认值推理 — beam_angle + IP

## Goal

对品类内参数高度一致的产品（≥90% 一致性，≥10 个样本），补全缺失的 beam_angle 和 IP 参数。同时删除 4 条坏 dimmable 记录。

## Context

已验证的品类默认值（从现有数据中计算）：

### beam_angle 默认值

| 品类 | 默认值 | 一致率 | 样本数 | 可填缺口 |
|------|--------|--------|--------|---------|
| 灯丝灯 | 360° | 100% | 45 | ~502 |
| 三防灯 | 120° | 97% | 39 | ~394 |
| 防潮灯 | 120° | 96% | 28 | ~110 |
| 应急灯 | 180° | 100% | 8 | ~90 |
| Highbay | 90° | 100% | 47 | ~2 |

不包含的品类（一致性不够或样本太少）：
- 筒灯（38°/120°/60° 分散）
- 球泡（220°/100°/38° 分散）
- 磁吸灯（24°/110°/270° 分散）
- 吸顶灯（仅 11 样本，112° 只占 82%）
- 灯管（仅 2 样本）
- 净化灯（仅 3 样本）

### IP 默认值

| 品类 | 默认值 | 一致率 | 样本数 | 可填缺口 |
|------|--------|--------|--------|---------|
| 面板灯 | IP20 | 95% | 22 | ~828 |
| 磁吸灯 | IP20 | 99% | 107 | ~688 |
| 镜前灯 | IP44 | 98% | 88 | ~93 |
| Highbay | IP65 | 100% | 47 | ~2 |

## Script

写 `scripts/v29.0-category-defaults.ts`，支持 `--dry-run`（默认）和 `--apply`。

### A. 清理坏 dimmable

```sql
DELETE FROM product_params
WHERE source_field = 'v28.2_excel_extraction'
  AND param_key = 'dimmable'
  AND raw_value = '加2.2元';
```

预期删除 4 条。

### B. 默认值配置

```typescript
const CATEGORY_DEFAULTS: Array<{
  category: string;
  paramKey: string;
  defaultValue: string;
  rawValue: string;
}> = [
  // beam_angle
  { category: '灯丝灯', paramKey: 'beam_angle', defaultValue: '360', rawValue: '360°' },
  { category: '三防灯', paramKey: 'beam_angle', defaultValue: '120', rawValue: '120°' },
  { category: '防潮灯', paramKey: 'beam_angle', defaultValue: '120', rawValue: '120°' },
  { category: '应急灯', paramKey: 'beam_angle', defaultValue: '180', rawValue: '180°' },
  { category: 'Highbay', paramKey: 'beam_angle', defaultValue: '90', rawValue: '90°' },
  // ip
  { category: '面板灯', paramKey: 'ip', defaultValue: 'IP20', rawValue: 'IP20' },
  { category: '磁吸灯', paramKey: 'ip', defaultValue: 'IP20', rawValue: 'IP20' },
  { category: '镜前灯', paramKey: 'ip', defaultValue: 'IP44', rawValue: 'IP44' },
  { category: 'Highbay', paramKey: 'ip', defaultValue: 'IP65', rawValue: 'IP65' },
];
```

### C. 处理流程

1. 对每个默认值配置：
   a. 查询该品类中缺失该 param_key 的产品
   b. 为每个产品插入 product_params 记录

### D. 写入

```
source_field: "v29.0_category_default"
confidence: "medium"
```

### E. 备份

`--apply` 前备份。

### F. 报告

写到 `docs/v29.0-category-defaults-report.md`：

```markdown
# V29.0 品类默认值推理报告

## 清理
- dimmable 删除: N

## 按品类 × 参数

| 品类 | param_key | 默认值 | 新增数 |
|------|-----------|--------|--------|

## 覆盖率变化

| param_key | 之前 | 新增 | 之后 |
|-----------|------|------|------|

## product_params 总量变化
```

### G. 验证

```bash
npx tsc --noEmit
npx tsx scripts/v29.0-category-defaults.ts            # dry-run
npx tsx scripts/v29.0-category-defaults.ts --apply     # 写入
```

## 不要做

- 不修改 src/ 文件
- 不修改已有 product_params（只 INSERT + 指定 DELETE）
- 不给一致性不够的品类设默认值
