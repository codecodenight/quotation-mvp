# V28.2: 清理 V28.0 坏数据 + warranty/dimmable Excel 补提

## Goal

1. 删除 V28.0 中 52 条 regex 终止不当的 material 和 size_display 记录
2. 从 Excel 列提取 warranty 和 dimmable（V27.0 审计已识别列，V27.1 跳过了这两个参数）

## Part A: 清理坏数据

### material（19 条）

```sql
DELETE FROM product_params
WHERE source_field = 'v28.0_remark_extraction'
  AND param_key = 'material'
  AND (raw_value LIKE '%灯珠%' OR raw_value LIKE '%控制%'
    OR raw_value LIKE '%Lumen%' OR raw_value LIKE '%lm%'
    OR raw_value LIKE '%扇叶%' OR raw_value LIKE '%可正反转%'
    OR raw_value LIKE '%功率%' OR raw_value LIKE '%电机%'
    OR raw_value LIKE '%Warranty%' OR raw_value LIKE '%Yrs%');
```

预期删除 19 条。执行前 COUNT 确认数量。

### size_display（33 条）

```sql
DELETE FROM product_params
WHERE source_field = 'v28.0_remark_extraction'
  AND param_key = 'size_display'
  AND LENGTH(raw_value) > 30;
```

预期删除 33 条。执行前 COUNT 确认数量。

## Part B: warranty + dimmable Excel 提取

写 `scripts/v28.2-warranty-dimmable-extraction.ts`，支持 `--dry-run`（默认）和 `--apply`。

### 复用 V27.1 架构

复用 V27.1 的整体流程（按文件分组、header 检测、exact match），但只提取 warranty 和 dimmable 两个参数。

### HEADER_TO_PARAM

```typescript
const HEADER_TO_PARAM = [
  { param_key: 'warranty', patterns: [/^(?:warranty|质保|保修|guarantee)$/i] },
  { param_key: 'dimmable', patterns: [/^(?:dim(?:mable)?|调光|可调光)$/i] },
];
```

### PARAM_VALIDATORS

```typescript
const PARAM_VALIDATORS = {
  warranty: (raw: string) => {
    // "2年", "3 years", "2", "5年"
    const m = raw.match(/(\d+)\s*(?:years?|年)?/i);
    if (!m) return null;
    const v = parseInt(m[1], 10);
    if (v >= 1 && v <= 10) return String(v);
    return null;
  },
  dimmable: (raw: string) => {
    const s = raw.trim().toLowerCase();
    // "yes", "no", "Y", "N", "√", "可调光", "不可调", "triac", "0-10V"
    if (/^(?:yes|y|√|是|可调光?|dimmable)$/i.test(s)) return 'yes';
    if (/^(?:no|n|×|否|不可调光?|non-dim)$/i.test(s)) return 'no';
    // 如果是具体调光类型也视为 yes
    if (/triac|0-10v|dali|pwm/i.test(s)) return s;
    // 非空文本也记录
    if (s.length >= 1 && s.length <= 30) return s;
    return null;
  },
};
```

### 写入

```
source_field: "v28.2_excel_extraction"
confidence: "high"
```

### 备份

`--apply` 前备份。

### 报告

写到 `docs/v28.2-cleanup-and-warranty-report.md`：

```markdown
# V28.2 清理 + warranty/dimmable 提取报告

## Part A: 清理
- material 删除数: N（预期 19）
- size_display 删除数: N（预期 33）

## Part B: warranty + dimmable 提取
- 扫描文件数: N
- warranty 新增: N
- dimmable 新增: N

## warranty 写入样本（前 10）
## dimmable 写入样本
## product_params 总量变化
```

### 验证

```bash
npx tsc --noEmit
npx tsx scripts/v28.2-warranty-dimmable-extraction.ts            # dry-run
npx tsx scripts/v28.2-warranty-dimmable-extraction.ts --apply     # 写入
```

## 不要做

- 不修改 src/ 文件
- 不修改已有 product_params（只 INSERT 新的 + DELETE 指定坏数据）
- 不用 normalized/loose match — 只用精确匹配
