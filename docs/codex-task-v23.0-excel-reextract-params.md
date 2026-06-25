# V23.0: Excel 列头重提取 — 从原始文件补全缺失参数

## Goal

对已导入的产品，回溯原始 Excel 文件，用列头→param_key 映射提取缺失参数。这是提升 param 覆盖率的唯一有效路径（V22.1 证明从产品名提取天花板只有 1.3%）。

## 核心发现

Excel 文件的列头包含丰富的参数信息，但导入时只映射了 model_no/price/moq/material/size，大量参数列被忽略：

```
投光灯 Excel 列头: Picture | Model | Power | Size | Luminos Flux(lm/W) | CCT | Beam | CRI | IP grade | MOQ | PRICE
筒灯 Excel 列头: Product picture | Product No. | Watt | Material | Size | Cut-out | Beam angle | Price
灯丝灯 Excel 列头: Picture | Model No. | BASE | Watts | Lumens | LED Chip Model | Product Size | pc/carton | Price
```

## Context

- 原始 Excel 文件在 `data/source-archive/` 本地可读
- `supplier_offers.source_file_id` → `files.id` → `files.absolute_path_snapshot` 可以定位原始文件
- `files` 表有 693 条记录，其中 621 个关联了 offer
- 已有 94,274 条 product_params，目标提升到 100,000+
- DB 位置：`prisma/dev.db`，操作前必须备份

## Script

写 `scripts/v23.0-excel-reextract-params.ts`，用 `tsx` 执行。支持 `--dry-run`（默认）和 `--apply` 两种模式。

### A. 列头→param_key 映射表

```typescript
const HEADER_TO_PARAM: Array<{ pattern: RegExp; paramKey: string; unit: string | null; extractValue?: (cellValue: string) => { normalized: string; raw: string } | null }> = [
  // watts / power / 功率
  { pattern: /^(?:watt|power|功率|实际功率|额定功率|w数)/i, paramKey: "watts", unit: "W" },
  // CCT / 色温
  { pattern: /^(?:cct|色温|color\s*temp|kelvin)/i, paramKey: "cct", unit: "K" },
  // CRI / 显色
  { pattern: /^(?:cri|显色|ra)/i, paramKey: "cri", unit: null },
  // PF / 功率因数
  { pattern: /^(?:pf|功率因[数素]|power\s*factor)/i, paramKey: "pf", unit: null },
  // Voltage / 电压
  { pattern: /^(?:voltage|电压|input\s*voltage|工作电压)/i, paramKey: "voltage", unit: "V" },
  // IP / 防护等级
  { pattern: /^(?:ip\s*(?:grade|rating|等级|防护)?|防护等级|protection)/i, paramKey: "ip", unit: null },
  // Material / 材质
  { pattern: /^(?:material|材[质料]|外壳材[质料]|body\s*material|housing)/i, paramKey: "material", unit: null },
  // Beam angle / 发光角度
  { pattern: /^(?:beam\s*angle|发光角度?|光束角|照射角度|ba[ea]m)/i, paramKey: "beam_angle", unit: "°" },
  // Luminous efficacy / 光效
  { pattern: /^(?:lumino(?:us|s)\s*(?:efficacy|flux)|光效|lm\s*\/\s*w|efficacy)/i, paramKey: "luminous_efficacy", unit: "lm/W" },
  // Base / 灯头
  { pattern: /^(?:base|灯头|灯座|lamp\s*base|cap\s*type)/i, paramKey: "base", unit: null },
  // Lumens / 光通量
  { pattern: /^(?:lumen|光通量|luminous\s*flux|总光通)/i, paramKey: "lumens", unit: "lm" },
  // LED chip / LED 型号
  { pattern: /^(?:led\s*(?:chip|type|model)|芯片|灯珠型号|smd\s*type)/i, paramKey: "led_type", unit: null },
  // Cut-out / 开孔
  { pattern: /^(?:cut[\s-]*out|开孔|嵌入孔)/i, paramKey: "cutout_mm", unit: "mm" },
  // Driver / 驱动
  { pattern: /^(?:driver|驱动|电源|power\s*supply)/i, paramKey: "driver_type", unit: null },
  // Sensor / 感应
  { pattern: /^(?:sensor|感应|雷达|pir|motion)/i, paramKey: "sensor", unit: null },
  // Size / 尺寸 — 只在产品没有 size_display 时提取
  { pattern: /^(?:size|尺寸|dimension|外形尺寸|产品尺寸)/i, paramKey: "size_display", unit: "mm" },
];
```

### B. 产品→Excel 行匹配

对每个文件：
1. 读取 Excel，自动检测表头行（第一行有 ≥ 3 个非空单元格且包含至少一个可识别列头）
2. 识别 "型号/Model" 列（用于匹配产品）
3. 对该文件关联的每个产品（通过 source_file_id），在数据行中匹配 model_no 或 product_name
4. 匹配成功后，读取该行所有列值

型号列识别模式：
```
/^(?:model|型号|产品型号|product\s*no|item\s*no|编号)/i
```

产品匹配规则：
- 精确匹配 model_no（忽略空格/大小写）
- 如果 model_no 匹配失败，尝试 product_name 包含匹配
- 匹配失败的产品跳过，记入报告

### C. 值提取和清洗

对匹配到的每个列值：
1. 如果该 product_id + param_key 已存在于 product_params → 跳过
2. 清洗值：
   - 去除前后空格
   - 空值或纯符号（`-`, `/`, `N/A`）→ 跳过
   - watts: 提取数字部分（`10W±10%` → `10`）
   - cct: 提取数字（`6000-6500K` → `6000-6500`）
   - ip: 提取数字（`IP65` → `65`）
   - cri: 提取数字（`＞80` → `80`, `Ra80` → `80`）
   - beam_angle: 提取数字（`120°` → `120`）
   - size: 标准化分隔符（`90*28*58mm` → `90×28×58`）
3. 生成 INSERT 记录

### D. 安全规则

- 只 INSERT 新的 product_params 行，不 UPDATE 或 DELETE
- source_field = `v23.0_excel_reextract`
- confidence = `high`（直接来自原始数据源）
- 每个文件处理后立即报告进度（不要一次性全部完成后才输出）
- 如果 Excel 文件路径不存在（absolute_path_snapshot 过期）→ 跳过，记录
- 如果文件读取失败 → 跳过，记录错误
- 限制单次 INSERT 批量大小 500

### E. 报告

写到 `docs/v23.0-excel-reextract-params-report.md`：

```markdown
# V23.0 Excel 列头重提取报告

## 备份
路径: backups/dev-before-v23.0-YYYYMMDD-HHMMSS.sqlite

## 文件处理统计
- 总文件数: N
- 可读取: N
- 不可访问: N（列出路径）
- 有表头匹配: N
- 无可识别表头: N

## 产品匹配统计
- 总产品数: N
- 匹配成功: N
- 匹配失败: N

## 参数提取统计

| param_key | 新增数 | 之前总覆盖 | 之后总覆盖 |
|-----------|--------|-----------|-----------|
| watts | +N | X | Y |
| cct | +N | X | Y |
| ...

## 按品类覆盖率变化

| 品类 | watts 变化 | cct 变化 | cri 变化 | ... |
|------|-----------|---------|---------|-----|
| 线条灯 | 23%→N% | 100% | ... |

## 总计
- product_params: before → after
- 提取成功: N 条
```

### F. 验证

1. `--dry-run` 先跑一次确认数量
2. `--apply` 执行
3. 检查 product_params 总数增长
4. 不需要跑 tsc/vitest（纯数据操作，不改 src/）
