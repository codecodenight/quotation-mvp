# V26.1: 非磁吸灯 UNMATCHABLE no_match 宽松匹配 — 509 个产品

## Goal

V25.4 诊断的 838 个 no_match 产品中，V26.0 处理磁吸灯 329 个。本任务处理剩余 509 个（面板灯 107、灯带 124、线条灯 46、太阳能壁灯 32、路灯 18、灯管 15、镜前灯 16、三防灯 19、风扇灯 14、其他）。

源文件明确有 watts 列，但 model_no 匹配失败。用标准化匹配修复。

## Context

**按文件 top groups（all no_match, 非磁吸灯）：**
```
2022-7-26压铸面板灯经济款成本表.xlsx         面板灯  71
2022-7-26压铸面板灯常规款成本表.xlsx         面板灯  36
汇孚画册+广交会灯带选品核价_136th.xlsx       灯带    29
1、220V无导线报价单-04(1).xls              灯带    25
副本博登报价单2025年8月.xls                太阳能壁灯 22
11、纯硅胶挤出报价格表-04(1).xls            灯带    20
太阳能产品报价表-2023.10.14.xlsx           路灯    18
锐晶照明单价表2026 .xlsx                  线条灯  17
光极报价2023.10.10.xlsx                  灯管    15
惠尔佳照明-2025系统报价单.xlsx             镜前灯  14
9、高压无导线柔性灯带价格表-04(1).xlsx       灯带    14
线条灯系列价格清单-雄企202410.xls          线条灯  14
8、高压有导线柔性灯带单价表-04.xlsx          灯带    13
低压核价+套装 138th.xlsx                  灯带    12
瑞盛达产品报价单2024年10月（TO汇浮）.xlsx    面板灯  12
核价wellux quotation of waterproof...     三防灯  11
核价 LED Linear Light ES series...        线条灯  10
欣益进系列报价2023-05.xlsx                太阳能壁灯 10
风扇灯含税报价表格-25.7.xls               风扇灯  10
嘉兴宝珑异形泡报价单0922.xlsx              灯丝灯  9
... (其余文件各 1~8 个)
```

- DB 位置：`prisma/dev.db`，操作前必须备份

## Script

写 `scripts/v26.1-remaining-nomatch.ts`，支持 `--dry-run`（默认）和 `--apply`。

### A. 数据加载

1. 查询所有缺 watts 的非磁吸灯产品 + source_file_id
2. 过滤条件：`category != '磁吸灯'`（磁吸灯由 V26.0 处理）
3. 只处理有 source_file_id 且在 V25.4 诊断中属于 UNMATCHABLE 的产品
   - 简化判断：产品缺 watts + 有 source_file_id + 从对应文件的 Excel 可找到 watts 列但 strict match 失败

### B. 标准化匹配

与 V26.0 相同的标准化逻辑，但增加更多分类特有模式：

```typescript
function normalizeModelNo(raw: string): string {
  let s = raw.trim();
  s = s.toUpperCase();
  s = s.replace(/\s+/g, '');
  // 去掉常见后缀："-3W", "/5W", " 10W" 等功率后缀（保留在原始值中用于提取）
  // 统一分隔符
  s = s.replace(/[-/_.\s]/g, '');
  return s;
}
```

**额外匹配策略（面板灯成本表专用）：**
- 成本表的型号列可能只有数字编号（如 "YD-01"），而 DB model_no 带品牌前缀
- 尝试子串匹配：如果 DB model_no 包含 Excel 型号值，视为匹配
- 子串匹配仅在同一 source_file_id 内、且唯一匹配时接受

**灯带专用：**
- 灯带 model_no 常含规格信息（LED 类型 + 电压 + 尺寸），与 Excel 列可能用不同格式
- 尝试去除所有非字母数字字符后比较

### C. 匹配约束

- 只在同一个 source_file_id 的文件内匹配
- 标准化后长度 ≥ 3
- 只接受唯一匹配（多行匹配跳过，计为 ambiguous_after_normalization）
- 匹配到的行必须在 watts 列有非空值

### D. 写入

```
sourceField: "v26.1_remaining_nomatch"
confidence: "high"
paramKey: "watts"
```

### E. 报告

写到 `docs/v26.1-remaining-nomatch-report.md`：

```markdown
# V26.1 非磁吸灯 UNMATCHABLE 匹配修复报告

## 统计
- 目标产品数: N (非磁吸灯 no_match)
- 标准化后匹配成功: N
- 有 watts 值: N
- 仍然 no_match: N
- 新 ambiguous: N

## 按品类

| 品类 | 目标数 | 匹配成功 | 有 watts | 仍 no_match |
|------|--------|---------|---------|------------|

## 按文件（top 20）

| 文件名 | 品类 | 目标数 | 匹配成功 | 有 watts | 仍 no_match |
|--------|------|--------|---------|---------|------------|

## 命名差异模式

| 文件 | DB model_no 样本 | Excel 型号样本 | 差异模式 |
|------|-----------------|---------------|---------|

## 写入样本（前 20 条）

## product_params / watts 覆盖率变化
```

### F. 验证

```bash
npx tsc --noEmit
npx tsx scripts/v26.1-remaining-nomatch.ts            # dry-run
npx tsx scripts/v26.1-remaining-nomatch.ts --apply     # 写入
```

## 不要做

- 不修改 src/ 文件
- 不处理磁吸灯（V26.0 负责）
- 不跨文件匹配
- 不修改已有 product_params
