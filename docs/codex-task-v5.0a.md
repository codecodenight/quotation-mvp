# Codex Task: V5.0A — 历史客户报价 Spike

## 目标

只读分析 `发客户报价单汇总` 目录下的客户报价 Excel 文件，回答三个问题：

1. 文件格式是否稳定？
2. 能否稳定提取：客户名 / 日期 / 产品名或款号 / 描述 / FOB USD 售价 / MOQ / CTN / 备注？
3. 是否值得进入 V5.0B 建表和导入？

**不写 DB，不改源文件，不改 schema。**

## 背景

系统当前只建模了采购价链路（`supplier_offers.purchase_price`），缺少历史客户售价参考。`发客户报价单汇总` 目录包含用户发给客户的 FOB USD 报价单，按品类组织在子目录中。这些文件是 Wellux/Welfull 品牌的标准报价模板。

目录位置：
```
/Volumes/My Passport/AI 报价/发客户报价单汇总/
```

约 176 个 Excel 文件（排除 macOS `._` 资源分叉），覆盖 24 个品类子目录。文件命名模式主要有两种：
- `核价` 前缀（~151 个）：内部核价版本，通常含 RMB 成本列 + USD 售价列
- `To XXX` 前缀（~25 个）：发给特定客户的版本，通常只有 USD 售价

## 依赖

SheetJS（已在项目中）。无新依赖。

---

## 脚本：`scripts/customer-quote-spike-v5.0a.ts`（新建）

### 命令行

```bash
npx tsx scripts/customer-quote-spike-v5.0a.ts
```

只读，无 `--apply` 模式。

### 抽样策略

从 `发客户报价单汇总` 的子目录中选 15-20 个文件，覆盖：
- 不同品类（至少 8 个品类子目录）
- 不同命名模式（`核价` / `To XXX` / 通用模板）
- 不同年份（2022/2023/2024/2025）
- 不同格式（.xlsx / .xls）
- 根目录下的汇总文件（如 `核价 Welfull LED Products Quotations ... 汇总.xls`）

选样不需要硬编码文件清单——扫描目录，每个品类子目录选最新的 1-2 个文件，再加根目录汇总文件。

### 对每个抽样文件做什么

1. 用 SheetJS 读取
2. 列出全部 sheet 名称
3. 对每个 sheet：
   - 扫描前 10 行，找表头行（包含 Model/Item/Product/型号/产品 等关键词的行）
   - 记录表头行号和每列的表头文本
   - 尝试识别以下列：
     - **产品款号**：Model / Item No. / 型号
     - **产品描述**：Description / Product Details / 描述
     - **FOB 单价**：FOB Price / Unit Price / USD / 单价
     - **MOQ**：MOQ / Minimum Order
     - **装箱数**：PCS/CTN / Packing
     - **箱规**：CTN Size / Carton Size
     - **备注**：Remark / 备注
     - **RMB 成本价**（核价文件可能有）：含税 / 工厂价 / RMB / 成本
   - 统计数据行数（表头之后、非空行数）
   - 抽取前 3 行数据样本
4. 尝试从文件名或 sheet 前几行提取：
   - **客户名**：`To XXX` 中的 XXX / 表头区域的 "To:" / "Customer:" 等
   - **报价日期**：文件名中的日期（20230515 / 202305 等）/ 表头区域的 Date
5. 判断该文件的格式类型：
   - `standard-template`：标准 Wellux 报价模板，列识别完整
   - `partial-match`：部分列能识别，但缺少关键列
   - `unknown-format`：表头不匹配已知模式

### 输出

写入 `docs/v5.0a-customer-quote-spike.md`：

```markdown
# V5.0A — 历史客户报价 Spike 报告

Generated: {timestamp}
Mode: read-only
Source: /Volumes/My Passport/AI 报价/发客户报价单汇总/

## 目录概览

| 品类子目录 | 文件数 | 抽样数 |
|---|---:|---:|

## 格式一致性判断

| 格式类型 | 文件数 | 占比 |
|---|---:|---:|
| standard-template | N | N% |
| partial-match | N | N% |
| unknown-format | N | N% |

## 可提取字段覆盖率

| 字段 | 可识别文件数 | 覆盖率 |
|---|---:|---:|
| 产品款号 | N | N% |
| FOB USD 单价 | N | N% |
| 产品描述 | N | N% |
| MOQ | N | N% |
| CTN | N | N% |
| 客户名 | N | N% |
| 报价日期 | N | N% |
| RMB 成本价 | N | N% |

## 逐文件分析

### {file_name}

- 路径：{relative_path}
- 格式：.xlsx / .xls
- Sheet 数：N
- 格式类型：standard-template / partial-match / unknown-format
- 客户名：{提取结果或"未识别"}
- 报价日期：{提取结果或"未识别"}

#### Sheet: {sheet_name}

表头行：Row N
```text
A=xxx | B=xxx | C=xxx | ...
```

列映射：
| 字段 | 列 | 表头文本 |
|---|---|---|

数据行数：N
数据样本（前 3 行）：
| Model | Description | FOB USD | MOQ | CTN | Remark |
|---|---|---:|---|---|---|

---
（每个文件重复以上格式）

## 结论

### 格式稳定性
（是/否，具体说明）

### 推荐可提取字段
（哪些字段可以稳定提取，哪些不稳定）

### 估算可导入规模
（约 N 个文件 × N 行/文件 = N 条历史客户报价行）

### V5.0B 建议
（是否值得进入 V5.0B 建表，以及建议的 schema 方向）

### 异常和风险
（格式不一致的文件、特殊情况、需要人工判断的点）
```

---

## 执行步骤

### Step 1: 创建脚本

新建 `scripts/customer-quote-spike-v5.0a.ts`。

### Step 2: 运行

```bash
npx tsx scripts/customer-quote-spike-v5.0a.ts
```

如果硬盘未挂载，报错退出。

### Step 3: 验证

```bash
npx tsc --noEmit --pretty false
```

### Step 4: 提交

```bash
git add scripts/customer-quote-spike-v5.0a.ts docs/v5.0a-customer-quote-spike.md
git commit -m "V5.0A: customer quotation format spike — 发客户报价单汇总 readability analysis"
```

## 验收标准

1. 抽样覆盖 ≥8 个品类、≥15 个文件
2. 报告包含每个文件的表头快照和列映射
3. 格式一致性有明确判断（standard-template 占比）
4. 客户名和日期提取有覆盖率统计
5. 有明确的 V5.0B 是否值得做的结论
6. 脚本不写 DB、不改源文件
7. `tsc --noEmit` 通过

## 不做的事

- 不写 DB
- 不建新表
- 不改 schema
- 不改源文件
- 不做产品匹配
- 不导入任何数据
