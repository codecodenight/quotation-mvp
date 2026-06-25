# V26.0: 磁吸灯 SI LI 文件匹配修复 — 329 个 UNMATCHABLE 产品

## Goal

V25.4 诊断发现磁吸灯 329 个 UNMATCHABLE 产品集中在 ~13 个 SI LI 报价文件。这些文件明确有 watts 列，但产品匹配失败（全部是 no_match，非 ambiguous）。分析命名差异并修复匹配，提取 watts 写入 product_params。

## Context

- 磁吸灯缺 watts 451 个，其中 329 个 UNMATCHABLE（全部 no_match）
- 集中在这些文件（V25.4 报告摘录）：
  ```
  SI LI异形磁吸道轨组合报价-浙江汇孚-2021年11月.xlsx          62
  SI LI异形磁吸道轨组合报价2024-11-19(1).xlsx                42
  SI LI汇盈聚（V20）-35-20-16-15-20MINI磁吸报价2023-01-01.xlsx 39
  SI LI汇盈聚-20款磁吸报价2024-10-15-.xlsx                   38
  M05-M10款磁吸报价-2025-03-01.xlsx                         37
  20款磁吸报价(A款）2025-03-15.xlsx                          20
  磁吸轨道报价.xls                                          19
  SI LI汇盈聚-超薄磁吸报价2024-04(RMB）.xlsx                  17
  SI LI汇盈聚17-30-35超薄磁吸报价2022-09.xlsx                 14
  其他多个 SI LI 文件                                        ~31
  ```
- 全部 no_match，说明 DB 里的 model_no 和 Excel 里的型号列值格式不同
- DB 位置：`prisma/dev.db`，操作前必须备份

## Script

写 `scripts/v26.0-magnetic-track-matching.ts`，支持 `--dry-run`（默认）和 `--apply`。

### A. 诊断阶段

1. 查询所有缺 watts 的磁吸灯产品 + source_file_id
2. 对每个相关文件，读取 Excel，输出：
   - 型号列的前 10 个样本值
   - 对应 DB 产品的 model_no 前 10 个
   - 两者的差异模式（前缀不同？分隔符不同？大小写？空格？）
3. 把差异模式写入报告的 "诊断" 部分

### B. 匹配策略

基于诊断结果，实现宽松匹配：

1. **标准化函数**：对 model_no 和 Excel 型号值都做相同处理：
   - 去除所有空格
   - 转大写
   - 去除常见前缀（如 "SI LI-", "SILI-"）
   - 将 `-` `/` `_` `.` 统一为空串
   - 对比标准化后的值

2. **限制条件**（防止误匹配）：
   - 只在同一个 source_file_id 的文件内匹配
   - 标准化后长度 ≥ 3（太短的不匹配）
   - 只接受唯一匹配（多行匹配则跳过）

3. 匹配到行后提取 watts 值（直接 watts 列 + 间接列提取）

### C. 写入

```
sourceField: "v26.0_magnetic_matching"
confidence: "high"（唯一匹配）
paramKey: "watts"
```

### D. 报告

写到 `docs/v26.0-magnetic-track-matching-report.md`：

```markdown
# V26.0 磁吸灯匹配修复报告

## 诊断：命名差异分析

| 文件 | Excel 样本 | DB model_no 样本 | 差异模式 |
|------|-----------|-----------------|---------|
| SI LI异形... | xxx | xxx | xxx |

## 匹配结果
- 目标产品数: 329
- 标准化后匹配成功: N
- 有 watts 值: N
- 仍然 no_match: N
- ambiguous (标准化后): N

## 按文件

| 文件名 | 目标数 | 匹配成功 | 有 watts | 仍 no_match |
|--------|--------|---------|---------|------------|

## 写入样本（前 20 条）

## product_params / watts 覆盖率变化
```

### E. 验证

```bash
npx tsc --noEmit
npx tsx scripts/v26.0-magnetic-track-matching.ts            # dry-run
npx tsx scripts/v26.0-magnetic-track-matching.ts --apply     # 写入
```

## 不要做

- 不修改 src/ 文件
- 不跨文件匹配
- 不修改已有 product_params
