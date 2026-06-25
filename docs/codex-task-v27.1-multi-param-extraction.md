# V27.1: 全参数批量提取 — 基于 V27.0 审计结果

## Goal

读取 V27.0 审计报告 (`docs/v27.0-full-param-audit-report.md`) 确认列头→参数映射正确后，对所有缺失参数的产品做一次性全参数提取。

**依赖 V27.0 先跑完。** V27.0 报告是本任务的输入。

## Context

目标参数（按缺口大小排序）：
- beam_angle, lumens, luminous_efficacy, driver_type, material, ip, pf
- 次要：cri, cct, voltage, size_display, certification, led_type, base, led_count

已有覆盖率 >90% 的参数（cri, cct, voltage）只在有新列匹配时提取，不做特殊处理。

## Script

写 `scripts/v27.1-multi-param-extraction.ts`，支持 `--dry-run`（默认）和 `--apply`。

### A. 列头→param_key 映射

使用与 V27.0 完全相同的 `HEADER_TO_PARAM` 模式数组（可直接从 V27.0 脚本 import，或复制）。

**但增加值验证器：**

```typescript
const PARAM_VALIDATORS: Record<string, (raw: string, category: string) => string | null> = {
  pf: (raw) => {
    // 必须是 0.0~1.0 之间的小数，或 ">0.5" 之类
    const m = raw.match(/([\d.]+)/);
    if (!m) return null;
    const v = parseFloat(m[1]);
    if (v >= 0.3 && v <= 1.0) return m[1];
    // 有些写 ">0.5" 或 "≥0.9"
    const gt = raw.match(/[>≥]\s*([\d.]+)/);
    if (gt) return `>${gt[1]}`;
    return null;
  },

  ip: (raw) => {
    // 必须匹配 IP + 2位数字
    const m = raw.match(/IP\s*(\d{2})/i);
    if (m) return `IP${m[1]}`;
    // 有些只写数字如 "20", "65"
    const n = raw.match(/^(\d{2})$/);
    if (n && ['20','44','54','55','65','66','67','68'].includes(n[1])) return `IP${n[1]}`;
    return null;
  },

  material: (raw) => {
    // 非空文本，长度 ≥ 2
    const s = raw.trim();
    if (s.length < 2) return null;
    // 排除纯数字
    if (/^\d+(\.\d+)?$/.test(s)) return null;
    return s;
  },

  beam_angle: (raw) => {
    // 数字，1~360度
    const m = raw.match(/(\d+(?:\.\d+)?)\s*[°度]?/);
    if (!m) return null;
    const v = parseFloat(m[1]);
    if (v >= 1 && v <= 360) return m[1];
    return null;
  },

  lumens: (raw) => {
    // 数字，>0
    const m = raw.match(/([\d,]+(?:\.\d+)?)\s*(?:lm)?/i);
    if (!m) return null;
    const v = parseFloat(m[1].replace(/,/g, ''));
    if (v > 0 && v < 100000) return String(v);
    return null;
  },

  luminous_efficacy: (raw) => {
    // 数字，通常 50~250 lm/W
    const m = raw.match(/([\d.]+)\s*(?:lm\s*\/?\s*w)?/i);
    if (!m) return null;
    const v = parseFloat(m[1]);
    if (v >= 10 && v <= 300) return m[1];
    return null;
  },

  driver_type: (raw) => {
    const s = raw.trim();
    if (s.length < 2) return null;
    if (/^\d+(\.\d+)?$/.test(s)) return null;
    return s;
  },

  cri: (raw) => {
    const m = raw.match(/(\d+)/);
    if (!m) return null;
    const v = parseInt(m[1], 10);
    if (v >= 60 && v <= 100) return m[1];
    // Ra>80 格式
    const gt = raw.match(/[>≥]\s*(\d+)/);
    if (gt) return `>${gt[1]}`;
    return null;
  },

  cct: (raw) => {
    const s = raw.trim();
    if (s.length < 2) return null;
    return s;
  },

  voltage: (raw) => {
    const s = raw.trim();
    if (s.length < 2) return null;
    return s;
  },

  size_display: (raw) => {
    const s = raw.trim();
    if (s.length < 3) return null;
    return s;
  },

  certification: (raw) => {
    const s = raw.trim();
    if (s.length < 2) return null;
    return s;
  },

  led_type: (raw) => {
    const s = raw.trim();
    if (s.length < 2) return null;
    if (/^\d+(\.\d+)?$/.test(s)) return null;
    return s;
  },

  base: (raw) => {
    const s = raw.trim();
    if (s.length < 2) return null;
    return s;
  },

  led_count: (raw) => {
    const m = raw.match(/(\d+)/);
    if (!m) return null;
    const v = parseInt(m[1], 10);
    if (v > 0 && v < 10000) return m[1];
    return null;
  },
};
```

### B. 处理流程

1. **加载产品**: 查询所有产品 + 已有 param_keys + source_file_id（via supplier_offers）
2. **按文件分组**: 和 V25.1 相同方式
3. **对每个文件**:
   a. XLSX.readFile 打开
   b. 对每个 sheet，检测 header row
   c. 识别所有 param 列（用 HEADER_TO_PARAM 模式）
   d. 对该文件的每个产品，在 sheet 中匹配行（exact match on model_no）
   e. **匹配到行后**，遍历所有 param 列：
      - 如果产品已有该 param → 跳过
      - 如果该列为空 → 跳过
      - 用 PARAM_VALIDATORS 验证值 → 通过则记录
4. **写入 product_params**（--apply 模式）

### C. 匹配策略

只用 **exact match**（精确匹配），不用 normalized/loose match。V26 证明了宽松匹配的风险。

复用 V25.1 的匹配逻辑：
- 在 sheet 的 model 列中精确查找 product.model_no
- 如果找到唯一匹配行 → 使用
- 如果找到 ≥2 行 → 跳过该 sheet（ambiguous）
- 如果找不到 → 跳过该 sheet

### D. 写入格式

```
source_field: "v27.1_multi_param"
confidence: "high"（直接列精确匹配）
```

### E. 备份

`--apply` 模式下先备份到 `backups/dev-before-v27.1-{timestamp}.sqlite`。

### F. 报告

写到 `docs/v27.1-multi-param-extraction-report.md`：

```markdown
# V27.1 全参数批量提取报告

## 统计总览

| param_key | 提取前覆盖 | 新提取 | 提取后覆盖 | 增量 |
|-----------|-----------|--------|-----------|------|

## 按品类 × param_key 矩阵

| 品类 | beam_angle | lumens | efficacy | driver | material | ip | pf | ... |
|------|-----------|--------|---------|--------|---------|----|----|-----|
| 筒灯 | +N | +N | +N | +N | +N | +N | +N |
| ... |

## 按文件 top 20（新提取数最多的文件）

| 文件名 | 涉及产品数 | 匹配成功 | 新提取参数总数 | 按 param_key 分 |
|--------|-----------|---------|-------------|---------------|

## 值验证拦截统计

| param_key | 总尝试 | 验证通过 | 验证拦截 | 拦截率 | 拦截样本(前5) |
|-----------|--------|---------|---------|--------|-------------|

## 写入样本（每个 param_key 前 5 条）

## product_params 覆盖率变化
```

### G. 验证

```bash
npx tsc --noEmit
npx tsx scripts/v27.1-multi-param-extraction.ts            # dry-run
npx tsx scripts/v27.1-multi-param-extraction.ts --apply     # 写入
```

## 不要做

- 不修改 src/ 文件
- 不 UPDATE/DELETE 已有 product_params（只 INSERT 新的）
- 不用 normalized/loose match — 只用精确匹配
- 不从"间接"列提取（V25.3/V26 的教训 — 间接列语义不确定）
- 不提取 watts（已由 V25.2 处理过）

## V26 教训总结（Codex 必须遵守）

1. **列头标注 ≠ 实际内容**：磁吸灯文件的 "watts" 列实际存的是尺寸/重量
2. **值验证是硬要求**：每个参数必须通过类型验证器才能写入
3. **宁可漏提不可误提**：覆盖率低于预期可以接受，但写入错误数据不可接受
