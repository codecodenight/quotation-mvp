# V27.0: 全参数源文件列审计 — 只读

## Goal

扫描所有 621 个 Excel 源文件的所有 sheet，识别每个列头对应的 param_key，量化全参数提取的天花板。为 V27.1 批量提取提供数据基础。

**只读审计，不写数据库。**

## Context

当前参数缺口（有源文件的 9,785 个产品）：

| 参数 | 缺口 | 覆盖率 |
|------|------|--------|
| beam_angle | 7,890 | 19.4% |
| lumens | 7,839 | 19.9% |
| luminous_efficacy | 6,936 | 29.1% |
| driver_type | 5,483 | 44.0% |
| material | 5,017 | 48.7% |
| ip | 3,969 | 40.6% |
| pf | 3,302 | 33.7% |

V25.1 只扫描了 watts 列。本任务扫描 ALL 列，建立列头→参数的完整映射。

## Script

写 `scripts/v27.0-full-param-audit.ts`，纯只读。

### A. 列头识别模式

```typescript
// 列头 → param_key 映射（按优先级排序，一个列头只匹配一个 param_key）

const HEADER_TO_PARAM: Array<{ param_key: string; patterns: RegExp[]; kind: 'direct' | 'indirect' }> = [
  // === watts（参考，不重新提取） ===
  { param_key: 'watts', patterns: [
    /^(?:watt|watts|wattage|power|actual\s*power|rated\s*power|功率|实际功率|实测功率|额定功率|瓦数)$/i,
    /(?:^|[\s(])(\d+)?w(?:$|[\s)])/i,  // "W" 或 "3W" 等
  ], kind: 'direct' },
  
  // === PF（功率因数） ===
  { param_key: 'pf', patterns: [
    /^(?:PF|P\.F\.|power\s*factor|功率因[数素])$/i,
    /\bPF\b/i,
  ], kind: 'direct' },
  
  // === IP（防护等级） ===
  { param_key: 'ip', patterns: [
    /^(?:IP|IP\s*(?:rating|grade|等级)|防[水护]等级|protection)$/i,
    /\bIP\s*\d{2}/i,  // 列头本身含 "IP65" 之类
  ], kind: 'direct' },
  
  // === material（材质） ===
  { param_key: 'material', patterns: [
    /^(?:material|材质|材料|外壳材[质料]|housing|body\s*material|灯体材[质料]|壳体)$/i,
  ], kind: 'direct' },
  
  // === beam_angle（光束角） ===
  { param_key: 'beam_angle', patterns: [
    /^(?:beam\s*angle|发光角[度]?|光束角|角度|照射角)$/i,
    /angle/i,
  ], kind: 'direct' },
  
  // === lumens（流明） ===
  { param_key: 'lumens', patterns: [
    /^(?:lumens?|lm|光通量|流明|luminous\s*flux|total\s*flux)$/i,
    /\blm\b/i,
  ], kind: 'direct' },

  // === luminous_efficacy（光效） ===
  { param_key: 'luminous_efficacy', patterns: [
    /^(?:efficacy|光效|光源效率|luminous\s*efficacy|lm\/w)$/i,
    /lm\s*\/\s*w/i,
  ], kind: 'direct' },
  
  // === driver_type（驱动类型） ===
  { param_key: 'driver_type', patterns: [
    /^(?:driver|驱动|电源|power\s*supply|driver\s*type|电源方案|驱动类型)$/i,
  ], kind: 'direct' },

  // === cri（显色指数） ===
  { param_key: 'cri', patterns: [
    /^(?:CRI|Ra|显色指数|显色|color\s*rendering)$/i,
  ], kind: 'direct' },

  // === cct（色温） ===
  { param_key: 'cct', patterns: [
    /^(?:CCT|色温|color\s*temp(?:erature)?|kelvin)$/i,
  ], kind: 'direct' },

  // === voltage（电压） ===
  { param_key: 'voltage', patterns: [
    /^(?:voltage|input\s*voltage|电压|输入电压|工作电压)$/i,
  ], kind: 'direct' },

  // === size_display ===
  { param_key: 'size_display', patterns: [
    /^(?:size|尺寸|外形尺寸|dimension|产品尺寸|灯体尺寸|整灯尺寸)$/i,
  ], kind: 'direct' },

  // === certification ===
  { param_key: 'certification', patterns: [
    /^(?:cert|certification|认证|certificate)$/i,
  ], kind: 'direct' },

  // === led_type ===
  { param_key: 'led_type', patterns: [
    /^(?:led\s*type|LED\s*(?:chip|芯片)|灯珠|光源类型|chip\s*type|LED\s*source)$/i,
  ], kind: 'direct' },

  // === base（灯头） ===
  { param_key: 'base', patterns: [
    /^(?:base|灯头|灯口|cap|lamp\s*base|接口)$/i,
  ], kind: 'direct' },

  // === led_count ===
  { param_key: 'led_count', patterns: [
    /^(?:led\s*(?:qty|count|数量|颗数)|灯珠数[量]?|LED\s*Qty)$/i,
  ], kind: 'direct' },

  // === warranty ===
  { param_key: 'warranty', patterns: [
    /^(?:warranty|质保|保修|guarantee)$/i,
  ], kind: 'direct' },

  // === dimmable ===
  { param_key: 'dimmable', patterns: [
    /^(?:dim(?:mable)?|调光|可调光)$/i,
  ], kind: 'direct' },
];
```

### B. 处理流程

1. 从 `supplier_offers` 获取所有 distinct `source_file_id` → `files`
2. 对每个文件，用 XLSX.readFile 打开
3. 对每个 sheet：
   a. 检测 header row（复用 V25.1 的 `detectHeaderRow` 逻辑）
   b. 对每个列头，用上面的模式匹配 param_key
   c. 采样该列前 10 个非空值，记录到报告
4. 汇总：
   - 每个 param_key 在多少个文件/sheet 中被识别
   - 每个 param_key 可覆盖多少个当前缺失该参数的产品

### C. 产品匹配预检

对每个文件里的产品（通过 `supplier_offers` 关联），做 exact match 尝试（复用 V25.1 的模型号匹配逻辑），统计：
- 匹配成功 + 该列有值：可提取
- 匹配成功 + 该列为空：列存在但无数据
- 匹配失败：不可匹配

### D. 报告

写到 `docs/v27.0-full-param-audit-report.md`：

```markdown
# V27.0 全参数源文件列审计报告

## 列头识别汇总

| param_key | 出现文件数 | 出现 sheet 数 | 涉及产品数 | 当前缺失该参数的产品数 | 预计可提取 |
|-----------|-----------|-------------|-----------|---------------------|-----------|

## 按 param_key 详细

### beam_angle
| 文件名 | sheet 名 | 列头原文 | 值样本(前5) | 涉及产品数 | 缺该参数数 | 可匹配+有值 |
|--------|---------|---------|------------|-----------|-----------|------------|
| ... |

### lumens
... (同上格式)

### (每个 param_key 一个小节)

## 列头未识别统计

| 列头原文 | 出现次数 | 值样本 | 建议 param_key |
|---------|---------|--------|---------------|
（列出出现 ≥5 次但未匹配到任何 param_key 的列头，帮助发现遗漏模式）

## 整体天花板预估

| param_key | 当前覆盖 | 审计天花板 | 增量 |
|-----------|---------|-----------|------|

## product_params 当前统计
```

### E. 验证

```bash
npx tsc --noEmit
npx tsx scripts/v27.0-full-param-audit.ts
```

## 关键约束

- **纯只读**，不写 product_params，不备份数据库
- 不修改 src/ 文件
- 文件读取时，对无法访问的文件（磁盘未挂载）跳过并记录
- 列头匹配要保守：宁可漏判，不要误判（V26 教训）
- 对每个匹配到的列，采样值是关键 — 用于验证列头分类是否正确（例如"watts"列实际放的是尺寸）
