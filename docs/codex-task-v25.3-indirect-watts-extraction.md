# V25.3: 间接列 watts 提取 — Lamp / 光源 / 规格 列深度扫描

## Goal

V25.1 把 2,174 个产品归入 NO_WATTS_IN_SOURCE，但其中相当一部分源文件有间接 watts 列（如 "Lamp"、"光源"、"规格"），只是 cell 值的 watts 提取失败了。本任务做更深入的间接列值分析和提取。

## Context

关键文件分析：

1. **坎灯报价单-all.xls**（302 缺 watts / 筒灯）
   - 24 个 sheet，其中 6 个有 "Watt"/"Power" 直接列
   - 其余 18 个 sheet 用 "Lamp" 列，值可能是 "SMD5630 3W" 或 "3W" 或纯文字 "LED"
   - V25.1 把 "Lamp" 识别为 indirect watts 列，但 extractWattsFromRow 可能取不到

2. **鸿烁照明隐形扇系列报价.xls**（风扇灯 110，部分在 RECOVERABLE 已捞到 118）
   - "光源" 列值如 "2*48W三色变光" → 需要 `(\d+)\s*[Ww]` 提取

3. **羽成太阳能报价表(2).xlsx**（62 缺 watts / 太阳能壁灯）
   - "特点与配置" 列可能含 watts 信息

## Script

写 `scripts/v25.3-indirect-watts-extraction.ts`，支持 `--dry-run`（默认）和 `--apply`。

### A. 扩展间接列头识别

在 V25.1 的基础上增加：
```typescript
const EXTENDED_INDIRECT_PATTERNS = [
  /光源/i,               // 已有
  /^lamp$/i,             // 已有
  /lamp\s*(?:type|source|color)?/i,  // 扩展：包含 "Lamps colors"
  /规格/i,               // 已有
  /spec/i,               // 已有
  /描述/i,               // 已有
  /description/i,        // 已有
  /特点|配置|feature/i,  // 新增
  /product\s*detail/i,   // 新增
  /产品[详描]述/i,       // 新增
];
```

### B. 增强 watts 值提取

对间接列值，使用更宽松的提取模式：

```typescript
function extractWattsFromIndirectValue(value: string): string | null {
  // 1. 直接模式：10W, 3.5W
  const direct = value.match(/(\d+(?:\.\d+)?)\s*[Ww]\b/);
  if (direct) return direct[1];
  
  // 2. 乘法模式：2*48W → 96, 2×24W → 48
  const multiply = value.match(/(\d+)\s*[*×x]\s*(\d+(?:\.\d+)?)\s*[Ww]/i);
  if (multiply) return String(Number(multiply[1]) * Number(multiply[2]));
  
  // 3. 范围模式：36-48W → 取第一个
  const range = value.match(/(\d+(?:\.\d+)?)\s*[-~]\s*\d+(?:\.\d+)?\s*[Ww]/i);
  if (range) return range[1];
  
  return null;
}
```

### C. 处理流程

1. 查询所有 NO_WATTS_IN_SOURCE 产品（V25.1 报告中的 2,174 个）
   - 实际查询方式：缺 watts + 有 source_file_id + 不在 V25.2 已写入的集合中
   - 简单做法：直接查缺 watts 且 source_field != 'v25.2_recoverable_watts' 的产品
2. 对每个源文件，用扩展模式扫描所有 sheet 的所有列头
3. 对间接列值用增强提取逻辑
4. 只提取高置信的（直接或乘法模式），范围模式的标记为 confidence=medium
5. 写入 product_params：
   ```
   sourceField: "v25.3_indirect_watts"
   confidence: "high" 或 "medium"
   ```

### D. 报告

写到 `docs/v25.3-indirect-watts-extraction-report.md`：

```markdown
# V25.3 间接列 Watts 提取报告

## 统计
- 扫描产品数: N
- 新增 watts: N
- 来自直接模式: N
- 来自乘法模式: N
- 来自范围模式: N

## 按品类

| 品类 | 提取数 | 主要来源列 |
|------|--------|-----------|
| ... |

## 间接列头统计

| 列头原文 | 匹配文件数 | 可提取 watts 数 |
|---------|-----------|---------------|
| Lamp | N | N |
| 光源 | N | N |
| ... |

## 写入样本（前 30 条）

## product_params / watts 覆盖率变化
```

### E. 验证

```bash
npx tsc --noEmit
npx tsx scripts/v25.3-indirect-watts-extraction.ts          # dry-run
npx tsx scripts/v25.3-indirect-watts-extraction.ts --apply   # 写入
```

## 不要做

- 不修改 src/ 文件
- 不修改 schema
- 不 UPDATE 或 DELETE 已有数据
- 不修改 V25.1 或 V25.2 的脚本
