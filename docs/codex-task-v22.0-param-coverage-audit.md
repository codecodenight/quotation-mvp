# V22.0: 参数覆盖率审计

## Goal

生成 品类 × param_key 覆盖率矩阵，找出哪些品类的哪些关键参数覆盖率低，为后续参数回填提供优先级排序。

## Context

- 10,025 产品，93,857 条 product_params
- 已有 9 个品类报价模板（面板灯/投光灯/线条灯/球泡/灯带/筒灯/三防灯/吸顶灯/太阳能壁灯）
- 每个模板有特定列，这些列对应的 param_key 如果覆盖率低，导出的 Excel 就会有空列
- DB 位置：`prisma/dev.db`

## Script

写 `scripts/v22.0-param-coverage-audit.ts`，用 `tsx` 执行（项目已有 tsx 依赖）。

### Part A: 全局覆盖率矩阵

对每个品类（products.category），统计该品类的产品数和各 param_key 的覆盖数。

输出格式（Markdown 表格）：

```
| 品类 | 产品数 | watts | cct | cri | pf | voltage | ip | material | size_display | driver_type | beam_angle | luminous_efficacy | ... |
|------|--------|-------|-----|-----|----|---------|----|----------|-------------|-------------|------------|-------------------|-----|
| 线条灯 | 1135 | 260(23%) | 1135(100%) | ... |
```

只列出产品数 > 50 的品类（排除长尾）。
param_key 列只列出在任一模板中用到的参数（约 15 个核心参数）。

核心参数清单：
`watts`, `cct`, `cri`, `pf`, `voltage`, `ip`, `material`, `size_display`, `driver_type`, `beam_angle`, `luminous_efficacy`, `base`, `shape`, `led_type`, `leds_per_meter`, `cutout_mm`, `sensor`, `lumens`

### Part B: 模板列→参数映射

对每个已注册的模板品类，列出该模板所有列用到的 param_key，以及覆盖率。标记 < 50% 的为 RED，50-80% 为 YELLOW，> 80% 为 GREEN。

```
面板灯 (850 products):
  watts: 800/850 (94%) GREEN
  cct: 850/850 (100%) GREEN
  material: 300/850 (35%) RED
  ...
```

### Part C: 产品名中的可回填参数

抽样检查覆盖率 < 50% 的 品类×param_key 组合。对每个组合：
1. 取缺失该参数的产品 50 条
2. 用正则从 product_name 中尝试提取（比如 watts 匹配 `\d+W`）
3. 报告可回填比例

这是评估回填可行性的数据，不执行实际回填。

正则建议：
- watts: `/(\d+)\s*[Ww]/`
- cct: `/(\d{4})\s*[Kk]/` 或 `/\b(2700|3000|4000|5000|6000|6500)\b/`
- voltage: `/(\d{2,3})\s*[Vv]/` 或 `/AC\s*(\d+-\d+)/i`
- ip: `/IP\s*(\d{2})/i`
- beam_angle: `/(\d+)\s*°/` 或 `/(\d+)\s*degree/i`
- material: `/(aluminum|plastic|iron|glass|acrylic|PC|ABS|steel)/i`
- base: `/(E27|E14|E26|B22|GU10|GU5\.3|MR16|G9|G4)/i`

### Part D: 报告

写到 `docs/v22.0-param-coverage-audit-report.md`：
- Part A 的全局矩阵表格
- Part B 的逐品类红绿灯
- Part C 的回填可行性评估
- 总结：哪些 品类×param_key 是最值得回填的（高价值 = 高频品类 + 模板需要 + 可回填率高）

### 约束

- 只读分析，不修改任何数据
- 不修改 src/ 下的任何文件
- 不需要跑 tsc 或 vitest（纯脚本任务）
