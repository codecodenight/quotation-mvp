# Codex Task: 灯管/球泡文件分类分析（只读）

## 目标

对 `光源/球泡灯管/` 目录下 27 个 likely-importable 文件做只读分析，确定每个文件（每个 sheet）应归入「球泡」还是「灯管」品类，输出分类计划供人工确认。

**纯只读。不写 DB。不导入。不改任何文件。**

## 背景

硬盘目录 `光源/球泡灯管/` 混合了两个品类的产品：
- **球泡**（DB 已有 151 产品）：A 泡、T 泡、G 泡、C37、GU10、PAR、蜡烛泡等
- **灯管**（DB 已有 8 产品）：T8、T5 管

V2.13B 决定先不导入这 27 个文件，等内容拆分后再导。现在做分类分析。

## 文件列表（27 个 likely-importable）

| 工厂 | 文件 | 预估产品 |
|---|---|---:|
| 佛山凯徽 | 2年质保，光效高点的询价单2023.10.31.xlsx | 31 |
| 光极 | 光极报价2023.10.10.xlsx | 98 |
| 光极 | 光极球泡报价单-230812.xlsx | 23 |
| 合力 | 杭州汇孚 包装成本，堵头成本差价表.xlsx (×2, 202304/202404) | 6+6 |
| 合力 | 杭州汇孚 灯管报价表-2023.3.24.xlsx | 29 |
| 合力 | 杭州汇孚球泡报价表-2023.3.26.xlsx | 41 |
| 合力 | 杭州汇孚 ERP灯管报价表-2023.8.25(1).xlsx | 19 |
| 合力 | 刘林灯管报价-2023.6.21.xlsx | 25 |
| 合力 | 价格成本表-2023 10月和4月对比.xlsx | 42 |
| 合力 | 价格成本表-2023.10.06...xlsx | 42 |
| 合力 | g泡，gu10,c37 价格-2023.10.09.xlsx | 23 |
| 合力 | 产品目录-价格-2024.4.14.xlsx | 25 |
| 合力 | A泡价格-2024.4.14.xlsx | 33 |
| 合力 | t8 灯管 -2024.4.14.xlsx | 23 |
| 合力 | 汇总报价单 - A泡 10-13 (1).xlsx | 16 |
| 合力 | 异性泡-汇总 报价单2024.10.13.xlsx | 15 |
| 合力 | NEW ERP T8 TUBE -2024.10.08.xlsx | 20 |
| 合力 | T泡各系列 汇总报价单-2024.10.13.xlsx | 15 |
| 合力 | AC&DC 12V-80V T泡价格 -2025.9.27.xlsx | 15 |
| 合力 | T5一体化支架价格(1).xlsx | 18 |
| 嘉家旺 | 嘉家旺 202404.xlsx | 117 |
| 嘉家旺 | 嘉家旺整体报价(1) 12月.xlsx | 117 |
| 嘉家旺 | 嘉家旺整体报价23.04.18(1).xlsx | 115 |
| 上格 | 上格ED玉兰花灯报价单1114 - 20230107 更新报价.xlsx | 6 |
| 鑫盟泰 | 2026.04T8玻璃灯管系列价格表-含税(1).xlsx | 28 |
| 鑫盟泰 | T8玻璃灯管系列价格表-含税 20230301 一群狼.xlsx | 22 |

## 分类规则

### 从文件名预判

**明确球泡**（文件名含 球泡/A泡/T泡/G泡/异性泡/C37/GU10）：
- 光极球泡报价单-230812.xlsx
- 杭州汇孚球泡报价表-2023.3.26.xlsx
- g泡，gu10,c37 价格-2023.10.09.xlsx
- A泡价格-2024.4.14.xlsx
- 汇总报价单 - A泡 10-13 (1).xlsx
- 异性泡-汇总 报价单2024.10.13.xlsx
- T泡各系列 汇总报价单-2024.10.13.xlsx
- AC&DC 12V-80V T泡价格 -2025.9.27.xlsx

**明确灯管**（文件名含 灯管/T8/T5/TUBE）：
- 杭州汇孚 灯管报价表-2023.3.24.xlsx
- 杭州汇孚 ERP灯管报价表-2023.8.25(1).xlsx
- 刘林灯管报价-2023.6.21.xlsx
- t8 灯管 -2024.4.14.xlsx
- NEW ERP T8 TUBE -2024.10.08.xlsx
- T5一体化支架价格(1).xlsx
- 2026.04T8玻璃灯管系列价格表-含税(1).xlsx
- T8玻璃灯管系列价格表-含税 20230301 一群狼.xlsx

**需分析内容**（文件名不明确）：
- 光极报价2023.10.10.xlsx（可能混合）
- 佛山凯徽 2年质保... .xlsx
- 包装成本，堵头成本差价表.xlsx ×2（可能是配件？）
- 价格成本表 ×2（可能混合）
- 产品目录-价格-2024.4.14.xlsx
- 嘉家旺 ×3（整体报价，很可能混合）
- 上格ED玉兰花灯报价单（应该是球泡类）

### 从 sheet 内容分类

对"需分析内容"的文件，读取每个 sheet 的数据行，用以下关键词判断：

**球泡关键词**（出现在 sheet 名、model_no、product_name 中）：
- 型号模式：`A\d{2}` (A60/A70/A80)、`C3[57]`、`G4[05]`、`G50`、`R50`、`PAR`、`GU10`、`GU5.3`、`E14`、`E27`
- 名称关键词：`球泡|蜡烛|尖泡|拉尾|玉兰花|蘑菇|反射灯|G泡|T泡|A泡|异形泡`
- sheet 名关键词：`球泡|bulb|A泡|T泡|G泡|C37|GU10|PAR|蜡烛|LED灯泡`

**灯管关键词**：
- 型号模式：`T[58]`、`TUBE`
- 名称关键词：`灯管|日光灯管|一体化支架`
- sheet 名关键词：`灯管|T8|T5|tube`

**分类逻辑**（每个 sheet 独立判断）：
1. sheet 名匹配灯管关键词 → 灯管
2. sheet 名匹配球泡关键词 → 球泡
3. 统计 sheet 数据行中灯管/球泡关键词命中数：
   - 灯管命中 > 球泡命中 → 灯管
   - 球泡命中 > 灯管命中 → 球泡
   - 都是 0 或相等 → unknown（需人工确认）

---

## 脚本

新建 `scripts/classify-tube-bulb.ts`。

### 运行方式

```bash
npx tsx scripts/classify-tube-bulb.ts --report docs/tube-bulb-classify-report.md
```

### 输入

从 `docs/v2.13a-import-candidates.csv` 读取 `category == "灯管"` 且 `classification == "likely-importable"` 的 27 个文件。

### 输出

报告 `docs/tube-bulb-classify-report.md`：

```markdown
# 灯管/球泡文件分类报告

Generated: {timestamp}

## 总览

| 指标 | 值 |
|---|---:|
| 分析文件 | 27 |
| 明确球泡（文件名） | X |
| 明确灯管（文件名） | Y |
| 需分析内容 | Z |
| 混合文件（含两种 sheet） | M |
| 无法判定 | U |

## 分类结果

### 球泡

| 文件 | 工厂 | Sheets | 数据行 | 分类依据 |
|---|---|---:|---:|---|

### 灯管

| 文件 | 工厂 | Sheets | 数据行 | 分类依据 |
|---|---|---:|---:|---|

### 混合（需按 sheet 拆分导入）

| 文件 | 工厂 | 球泡 sheets | 灯管 sheets | 分类依据 |
|---|---|---|---|---|

### 无法判定

| 文件 | 工厂 | Sheets | 数据行 | 备注 |
|---|---|---:|---:|---|

## 每文件明细

对每个文件列出：
- 文件路径
- 各 sheet 名称
- 各 sheet 数据行数
- 球泡/灯管关键词命中统计
- 样本 model_no/product_name（前 5 行）
- 分类结论

## 导入建议

基于分类结果，给出下一步导入的建议：
- 纯球泡文件 → category="球泡"
- 纯灯管文件 → category="灯管"  
- 混合文件 → 列出哪些 sheet 导入为球泡，哪些 sheet 导入为灯管
- 无法判定 → 标记为需人工复核
```

### 关键实现

- 复用 `scripts/source-inventory.ts` 的 `findHeaderRows`、`isLikelyModelValue` 等函数
- 读取 Excel 用 SheetJS
- 对每个 sheet：找到 header row，提取 model column，读 model_no / product_name 值
- 用关键词匹配分类
- 最后写 markdown 报告

---

## 执行步骤

### Step 1: 验证外接硬盘

```bash
ls "/Volumes/My Passport/AI 报价/各家工厂最新报价汇总/光源/球泡灯管/"
```

### Step 2: 实现脚本 + 运行

```bash
npx tsx scripts/classify-tube-bulb.ts --report docs/tube-bulb-classify-report.md
```

### Step 3: 验证 + 提交

```bash
npx tsc --noEmit --pretty false
npm run lint
npm run build
npm test
git add scripts/classify-tube-bulb.ts docs/tube-bulb-classify-report.md
git commit -m "V2.17: classify tube/bulb files for split import"
```

---

## 不做的事

- 不写 DB
- 不导入任何产品
- 不修改源 Excel 文件
- 不改 UI
- 不处理 enrichment-only / needs-review 文件
- 不处理 `户外工厂-未判定` 文件（那是下一步）
