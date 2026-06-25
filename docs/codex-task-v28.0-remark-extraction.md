# V28.0: Remark 字段结构化数据提取 — 全参数

## Goal

products.remark 字段包含大量结构化参数数据，尤其是太阳能系列产品。解析 remark 提取所有可识别的参数，写入 product_params。

## Context

remark 数据样本：

**太阳能产品（典型格式）：**
```
Material：ABS+PC Panel：1.5W/5.5V/280mA Battery：3.7V 18650 1200mAh*1
LED：48PCS Luminous flux：500lm Color temperature：6500K RA80
Protection：IP54 Induction：PIR Charging:7-8 hours Warranty: 2 years
```

**筒灯（典型格式）：**
```
描述: GU10 地插灯 灯头类型：GU10 材质：压铸铝 防水等级：IP65
工作温度：-25°∽＋40° 质保：2年
```

**灯丝灯（典型格式）：**
```
BASE: E27 Watts: 1W Lumens: 70Lm LED Chip Model: 1PCS
Product Size（mm): 95*138
```

当前有 remark 的产品数：~8,162

## Script

写 `scripts/v28.0-remark-extraction.ts`，支持 `--dry-run`（默认）和 `--apply`。

### A. 参数提取模式

```typescript
type ExtractorResult = { paramKey: string; rawValue: string; normalizedValue: string };

// 从 remark 文本中提取所有可识别参数
function extractParamsFromRemark(remark: string): ExtractorResult[] {
  const results: ExtractorResult[] = [];
  
  // IP / Protection
  // 匹配: "Protection：IP54", "防水等级：IP65", "IP65", "Waterproof rate：IP65"
  const ipMatch = remark.match(/(?:protection|防[水护]等级|waterproof\s*rate|IP)\s*[:：]?\s*IP\s*(\d{2})/i)
    || remark.match(/\bIP\s*(\d{2})\b/i);
  if (ipMatch) {
    results.push({ paramKey: 'ip', rawValue: `IP${ipMatch[1]}`, normalizedValue: `IP${ipMatch[1]}` });
  }
  
  // Material / 材质
  // 匹配: "Material：ABS+PC", "材质：压铸铝", "Material：Aluminum die casting + glass"
  const materialMatch = remark.match(/(?:material|材质)\s*[:：]\s*([^\n,;]{2,50}?)(?=\s+(?:Panel|Solar|Battery|LED|Luminous|Color|Protection|Induction|Charging|Warranty|Lighting|Waterproof|工作|质保|防水|灯头|描述)|$)/i);
  if (materialMatch) {
    results.push({ paramKey: 'material', rawValue: materialMatch[1].trim(), normalizedValue: materialMatch[1].trim() });
  }
  
  // Lumens / 光通量
  // 匹配: "Luminous flux：500lm", "流明：1000lm", "Lumens: 70Lm"
  const lumensMatch = remark.match(/(?:luminous\s*flux|lumens?|流明|光通量)\s*[:：]\s*(\d+(?:\.\d+)?)\s*lm/i);
  if (lumensMatch) {
    results.push({ paramKey: 'lumens', rawValue: `${lumensMatch[1]}lm`, normalizedValue: lumensMatch[1] });
  }
  
  // Watts / 功率
  // 匹配: "Watts: 1W", "功率: 10W"（不匹配 Panel 后面的 W 值如 "Panel：1.5W"）
  const wattsMatch = remark.match(/(?:^|[^Panel：:])(?:watts?|功率|power)\s*[:：]\s*(\d+(?:\.\d+)?)\s*w/i);
  if (wattsMatch) {
    results.push({ paramKey: 'watts', rawValue: `${wattsMatch[1]}W`, normalizedValue: wattsMatch[1] });
  }
  
  // CRI / Ra
  // 匹配: "RA80", "Ra>80", "CRI：80"
  const criMatch = remark.match(/(?:CRI|Ra)\s*[:：>]?\s*(\d{2,3})/i);
  if (criMatch) {
    const v = parseInt(criMatch[1], 10);
    if (v >= 60 && v <= 100) {
      results.push({ paramKey: 'cri', rawValue: `Ra${v}`, normalizedValue: String(v) });
    }
  }
  
  // CCT / 色温
  // 匹配: "Color temperature：6500K", "色温：3000K"
  const cctMatch = remark.match(/(?:color\s*temp(?:erature)?|色温|CCT)\s*[:：]\s*(\d{4,5})\s*K/i);
  if (cctMatch) {
    results.push({ paramKey: 'cct', rawValue: `${cctMatch[1]}K`, normalizedValue: cctMatch[1] });
  }
  
  // Base / 灯头
  // 匹配: "BASE: E27", "灯头类型：GU10"
  const baseMatch = remark.match(/(?:base|灯头(?:类型)?)\s*[:：]\s*(E\d+|GU\d+|G\d+|B\d+|MR\d+)/i);
  if (baseMatch) {
    results.push({ paramKey: 'base', rawValue: baseMatch[1].toUpperCase(), normalizedValue: baseMatch[1].toUpperCase() });
  }
  
  // LED count
  // 匹配: "LED：48PCS", "LED：2*91PCS", "灯珠数：60"
  const ledCountMatch = remark.match(/LED\s*[:：]\s*(?:(\d+)\s*\*\s*)?(\d+)\s*PCS/i);
  if (ledCountMatch) {
    const count = ledCountMatch[1] 
      ? String(parseInt(ledCountMatch[1], 10) * parseInt(ledCountMatch[2], 10))
      : ledCountMatch[2];
    results.push({ paramKey: 'led_count', rawValue: `${count}pcs`, normalizedValue: count });
  }
  
  // Warranty / 质保
  // 匹配: "Warranty: 2 years", "质保：2年"
  const warrantyMatch = remark.match(/(?:warranty|质保|保修)\s*[:：]\s*(\d+)\s*(?:years?|年)/i);
  if (warrantyMatch) {
    results.push({ paramKey: 'warranty', rawValue: `${warrantyMatch[1]}年`, normalizedValue: warrantyMatch[1] });
  }
  
  // Beam angle
  // 匹配: "角度：120°", "Beam angle: 120°"
  const beamMatch = remark.match(/(?:beam\s*angle|角度|发光角|光束角)\s*[:：]\s*(\d+)\s*[°度]/i);
  if (beamMatch) {
    const v = parseInt(beamMatch[1], 10);
    if (v >= 1 && v <= 360) {
      results.push({ paramKey: 'beam_angle', rawValue: `${v}°`, normalizedValue: String(v) });
    }
  }
  
  // Size
  // 匹配: "Product Size（mm): 95*138", "产品尺寸：xxx"
  const sizeMatch = remark.match(/(?:product\s*size|产品尺寸|尺寸|外形尺寸)\s*[（(]?\s*(?:mm)?\s*[）)]?\s*[:：]\s*([^\n,;]{3,40})/i);
  if (sizeMatch) {
    results.push({ paramKey: 'size_display', rawValue: sizeMatch[1].trim(), normalizedValue: sizeMatch[1].trim() });
  }

  // Voltage
  // 匹配: "Voltage: AC85-265V", "电压：220V"
  const voltageMatch = remark.match(/(?:voltage|input\s*voltage|电压|工作电压)\s*[:：]\s*([^\n,;]{2,30})/i);
  if (voltageMatch) {
    results.push({ paramKey: 'voltage', rawValue: voltageMatch[1].trim(), normalizedValue: voltageMatch[1].trim() });
  }

  return results;
}
```

### B. 处理流程

1. 查询所有 remark 非空的产品
2. 对每个产品，用 `extractParamsFromRemark` 提取所有参数
3. 对每个提取结果，检查产品是否已有该 param_key → 已有则跳过
4. 对 watts 值额外做品类合理性校验（复用 V26.2 的 CATEGORY_WATTS_RANGE）
5. 对太阳能壁灯/太阳能产品的 watts 提取，排除 Panel/Solar panel 的瓦数
   - remark 中 "Panel：1.5W" 是太阳能面板功率，不是灯具功率
   - 只匹配明确标记为 "Watts:" 或 "功率:" 的值

### C. 写入

```
sourceField: "v28.0_remark_extraction"
confidence: "high"（结构化标签提取）
```

### D. 备份

`--apply` 前备份到 `backups/dev-before-v28.0-{timestamp}.sqlite`

### E. 报告

写到 `docs/v28.0-remark-extraction-report.md`：

```markdown
# V28.0 Remark 结构化数据提取报告

## 统计
- 扫描产品数（有 remark）: N
- 提取到参数的产品数: N
- 新增 product_params 总数: N
- 跳过（已有参数）: N

## 按 param_key

| param_key | 新增数 | 提取前覆盖 | 提取后覆盖 | 增量 |
|-----------|--------|-----------|-----------|------|

## 按品类（前 20）

| 品类 | 扫描数 | 提取产品数 | 新增参数数 | 主要 param_keys |
|------|--------|-----------|-----------|---------------|

## 写入样本（每个 param_key 前 5 条）

## product_params 总量变化
```

### F. 验证

```bash
npx tsc --noEmit
npx tsx scripts/v28.0-remark-extraction.ts            # dry-run
npx tsx scripts/v28.0-remark-extraction.ts --apply     # 写入
```

## 不要做

- 不修改 src/ 文件
- 不修改已有 product_params
- 不从太阳能产品的 "Panel：XW" 提取 watts（V25.3 教训）
- 不提取纯数字无标签的值（如 remark 里孤立的 "65" 不应当作 IP65）
