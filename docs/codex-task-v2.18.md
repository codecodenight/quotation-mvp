# Codex Task: V2.18 — 户外工厂-未判定导入（Dry-run + Apply）

## 目标

将 19 个户外工厂未分类文件导入数据库，含品类分配、价格列检测、upsert 写入。
新品类：**充电灯**。

**不读 enrichment-only 文件。不读 _lenovo 冲突文件。不修改源 Excel。**

## 背景

- DB 状态：11,236 products / 12,320 offers / 37,049 params
- 价格列检测已在 V2.17E+F 修复（`isNonPriceHeader` 黑名单 + `isPriceHeader` 语义优先 + model==price 排除 + 空表头排除 + 附加费列排除）
- 参考脚本：`scripts/tube-bulb-split-apply.ts`（1,758 行），复用其核心结构

## 文件清单（硬编码）

脚本内硬编码 `FILE_LIST` 数组，每条含 `relativePath`、`factory`、`targetCategory`、`mode`。

### 导入文件（18 文件）

| # | relativePath（相对于 ROOT） | factory | targetCategory |
|---|---|---|---|
| 1 | `户外照明 工业照明/户外工厂/凯晟德/2024年4月/汇孚2024产品报价更新/汇孚2024产品报价更新/TR-ES Qoutation  20240521.xlsx` | 凯晟德 | 路灯 |
| 2 | `户外照明 工业照明/户外工厂/凯晟德/202504报价/KCD-TB qoutation20250527.xlsx` | 凯晟德 | 太阳能壁灯 |
| 3 | `户外照明 工业照明/户外工厂/凯晟德/202511香港展更新/LS model Light 100W qoutation251118.xlsx` | 凯晟德 | 路灯 |
| 4 | `户外照明 工业照明/户外工厂/绿晟/202311/绿晟--F15系列泛光灯报价单不足瓦LS202311.xls` | 绿晟 | 投光灯 |
| 5 | `户外照明 工业照明/户外工厂/绿晟/202311/绿晟--F15系列泛光灯报价单LS202311.xls` | 绿晟 | 投光灯 |
| 6 | `户外照明 工业照明/户外工厂/绿晟/202410/绿晟--F15系列泛光灯报价单LS202410.xls` | 绿晟 | 投光灯 |
| 7 | `户外照明 工业照明/户外工厂/绿晟/202510/绿晟--F15系列泛光灯报价单LS202512.xls` | 绿晟 | 投光灯 |
| 8 | `户外照明 工业照明/户外工厂/绿晟/绿晟产品价格表202403/充电灯DC/绿晟-R02三面折叠款充电灯报价单LS202403.xls` | 绿晟 | 充电灯 |
| 9 | `户外照明 工业照明/户外工厂/绿晟/绿晟产品价格表202403/充电灯DC/绿晟-R07R08R09充电灯报价单LS202403.xls` | 绿晟 | 充电灯 |
| 10 | `户外照明 工业照明/户外工厂/绿晟/绿晟产品价格表202403/工作灯AC/绿晟-W12F款工作灯报价单LS202403.xls` | 绿晟 | 工作灯 |
| 11 | `户外照明 工业照明/户外工厂/绿晟/绿晟产品价格表202403/充电灯DC/绿晟--R03充电灯报价单LS202403.xls` | 绿晟 | 充电灯 |
| 12 | `户外照明 工业照明/户外工厂/绿晟/绿晟产品价格表202403/充电灯DC/绿晟-R01充电灯报价单LS202403.xls` | 绿晟 | 充电灯 |
| 13 | `户外照明 工业照明/户外工厂/绿晟/绿晟产品价格表202403/充电灯DC/绿晟-R06充电灯报价单LS202403.xls` | 绿晟 | 充电灯 |
| 14 | `户外照明 工业照明/户外工厂/绿晟/绿晟产品价格表202403/工作灯AC/绿晟-W12F款工作灯报价单20W50W.xls` | 绿晟 | 工作灯 |
| 15 | `户外照明 工业照明/户外工厂/伊特/2023/0731 TG111波兰产品报价 迷你二代线性足瓦过新ERP 202308.xlsx` | 伊特 | 投光灯 |
| 16 | `户外照明 工业照明/户外工厂/中屹/202406/24-6-20无边框报价（含 包装尺寸）.xlsx` | 中屹 | 面板灯 |
| 17 | `户外照明 工业照明/户外工厂/中屹/中山中屹 报价 20230626/UFO-01HX90%230420.xlsx` | 中屹 | Highbay |
| 18 | `户外照明 工业照明/户外工厂/中屹/中山中屹 报价 20230626/ZY-SL-02金钻price230420.xlsx` | 中屹 | 路灯 |

### 分析文件（1 文件，仅 dry-run 输出样本，apply 跳过）

| # | relativePath | factory | mode |
|---|---|---|---|
| 19 | `户外照明 工业照明/户外工厂/伊特/2026/4.25 产品报价-含税.xlsx` | 伊特 | analyze-only |

## 实现方式

新建 `scripts/outdoor-import.ts`（单文件，含 dry-run 和 apply 模式）。

### 核心结构（参考 `tube-bulb-split-apply.ts`）

```
ROOT = "/Volumes/My Passport/AI 报价/各家工厂最新报价汇总"

FILE_LIST: Array<{
  relativePath: string;
  factory: string;
  targetCategory: string;
  mode: "import" | "analyze-only";
}>
```

### 从 tube-bulb-split-apply.ts 复制的函数

以下函数原样复制（不 import，避免耦合）：

- `isNonPriceHeader(header)` — 黑名单（序号/No./功率/灯珠颗数/数量/…）
- `isPriceHeader(header)` — 语义关键词检测
- `isRmbPriceHeader(header)` — RMB/人民币 + 排除附加费（堵头/差价/配件/…）
- `sortSignal(a, b)` — 语义优先排序
- `analyzeSheet()` — sheet 级检测（表头/型号列/价格列）
- `buildMapping()` — 列映射
- `buildImportRows()` — 行提取
- `normalizeRows()` — SheetJS 行标准化

### 不复制的函数（逻辑不同）

- `parseSplitImportPlan()` — 不解析 markdown，改用硬编码 FILE_LIST
- `loadCandidates()` — 简化为直接遍历 FILE_LIST + 检查文件存在
- `resolveCategory()` — 去掉品类限制检查，直接使用 targetCategory
- `main()` — 重写，支持 `--apply` 和默认 dry-run 两种模式

### 复用的 import

```typescript
import { parsePriceValue, type SheetRows } from "../src/lib/excel-import";
import { extractImagesFromExcel, storeExtractedImage, type ExtractedImage } from "../src/lib/image-extractor";
import { upsertSupplierOffer, type SupplierOfferUpsertClient } from "../src/lib/supplier-offer-upsert";
```

### 两种运行模式

#### Dry-run（默认，不加 `--apply`）

```bash
npx tsx scripts/outdoor-import.ts --report docs/v2.18-dryrun-report.md
```

对所有 19 文件：
1. 读取 Excel → 逐 sheet 检测表头、型号列、价格列
2. 生成报告：
   - 每文件：sheet 数 / 可导入 sheet / 检测到的价格列 / 行数
   - 每可导入 sheet：表头行号 / 型号列 / 价格列 / 有效行数 / 前 3 行样本（model_no / product_name / price / remark 截断 60 字符）
   - 不写 DB

3. 对 #1 TR-ES（路灯 medium confidence）：在报告中加注 `⚠️ 品类待验证`，额外输出前 5 行样本
4. 对 #19 伊特 4.25（analyze-only）：输出完整分析：
   - 每 sheet 名
   - 每 sheet 前 15 行的 model_no / product_name / description 样本
   - 检测到的品类关键词（投光/路灯/工矿/UFO/泛光/…）
   - 建议品类
   - 标注 `🔍 分析模式 — apply 时跳过`

#### Apply（加 `--apply`）

```bash
npx tsx scripts/outdoor-import.ts --apply --report docs/v2.18-apply-report.md
```

对 18 个 import 文件（跳过 analyze-only）：
1. 备份 DB
2. 逐文件处理：读 Excel → 检测 → 提取行 → upsert product + offer + price_history
3. 图片提取（.xlsx 文件 zip 解压；.xls 文件跳过图片或用 LibreOffice）
4. 生成 apply 报告：before/after DB 统计 + 每文件结果

### Product upsert 逻辑

与 tube-bulb-split-apply.ts 完全一致：
- `findFirst({ where: { modelNo } })` → 存在则复用 product，不存在则 create
- `category` 取 FILE_LIST 中的 `targetCategory`（不取原有品类）
- `upsertSupplierOffer()` 处理 offer + price_history

### 新品类处理

`充电灯` 不需要预创建。`products.category` 是自由文本字段，直接写入 `"充电灯"` 即可。

### 需要注意的 .xls 文件

绿晟所有文件（#4-#14）和伊特 TG111（#15）是 `.xls` 格式：
- SheetJS 读取：`XLSX.readFile()` 原生支持 .xls，无需特殊处理
- 图片提取：`.xls` 不支持 zip 解压提取图片。两种选择：
  - A）跳过 .xls 图片（`--skip-images` 或条件判断）
  - B）用 LibreOffice 转 .xlsx 后提取（已有 `image-extractor.ts` 支持）
  - **选 A**：跳过 .xls 图片。.xlsx 文件（凯晟德 3 个 + 中屹 3 个 + 伊特 4.25）正常提取。

---

## 执行步骤

### Step 1: 备份

```bash
cp prisma/dev.db backups/dev-before-v2.18-$(date +%Y%m%d-%H%M%S).sqlite
```

### Step 2: 新建脚本

新建 `scripts/outdoor-import.ts`。

从 `scripts/tube-bulb-split-apply.ts` 复制以下函数（保持原样）：
- 价格列检测：`isNonPriceHeader`, `isPriceHeader`, `isRmbPriceHeader`, `sortSignal`
- Sheet 分析：`analyzeSheet`, `buildMapping`, `buildImportRows`, `normalizeRows`
- 行构建辅助：`findHeaderRow`, `findModelColumn`, `findPriceColumn`, `findColumnByPattern` 等（所有被 `analyzeSheet` / `buildMapping` / `buildImportRows` 调用的内部函数）
- DB 操作：`ensureFileRecord`, `getDbCounts`, `backupDatabase`
- 图片：`attachImages`（或简化版本）
- 工具函数：`getArgValue`, `normalizeKey`, `productKey`, `normalizeText` 等

新写的部分：
- `FILE_LIST` 硬编码数组
- `main()` 函数（dry-run / apply 分支）
- 报告生成函数（参考 tube-bulb-split 的 `buildReport` 但简化）
- analyze-only 文件的样本输出逻辑

### Step 3: Dry-run

```bash
npx tsx scripts/outdoor-import.ts --report docs/v2.18-dryrun-report.md
```

检查报告：
- 18 个 import 文件是否都成功检测到价格列
- 价格列是否合理（关键词含 RMB/元/价格/报价/price）
- needs-review 文件（#11-14）：如果检测失败，报告中标 `⚠️ 检测失败 — 跳过`
- TR-ES 样本是否确认是路灯产品
- 伊特 4.25 分析结果

### Step 4: Apply（需 Claude 审核 dry-run 报告后才执行）

```bash
npx tsx scripts/outdoor-import.ts --apply --report docs/v2.18-apply-report.md
```

### Step 5: 验证 + 提交

```bash
sqlite3 prisma/dev.db "
SELECT '--- category breakdown ---';
SELECT category, COUNT(*) FROM products
WHERE category IN ('投光灯','路灯','充电灯','工作灯','面板灯','Highbay')
GROUP BY category ORDER BY COUNT(*) DESC;
SELECT '--- totals ---';
SELECT 'products' as t, COUNT(*) FROM products
UNION ALL SELECT 'offers', COUNT(*) FROM supplier_offers
UNION ALL SELECT 'price_history', COUNT(*) FROM price_history;
"
```

期望增量（基于 ~434 行估计，扣除 #19 的 115 行）：
- products 增加 100-300（部分型号可能已存在 → 复用）
- offers 增加 200-400
- 充电灯品类首次出现，预计 30-50 产品
- 投光灯 / 路灯 / 工作灯 数量增长

```bash
npx tsc --noEmit --pretty false
npm run lint
npm run build
npm test
git add scripts/outdoor-import.ts docs/v2.18-dryrun-report.md docs/v2.18-apply-report.md docs/outdoor-unclassified-import-plan.md
git commit -m "V2.18: import outdoor factory unclassified files"
```

## 验收标准

1. dry-run 报告：18 个 import 文件中 ≥15 个成功检测价格列
2. dry-run 报告：无 ⚠️ 价格列可疑（序号/功率/灯珠误判）
3. dry-run 报告：伊特 4.25 输出了 sheet 级品类分析样本
4. apply 报告：products / offers / price_history 增量与 dry-run 预估基本一致
5. 充电灯品类有产品写入
6. tsc / lint / build / test 全过

## 不做的事

- 不读 enrichment-only 文件
- 不读 _lenovo 冲突文件
- 不修改源 Excel 文件
- 不导入 伊特 4.25 产品报价-含税（仅分析）
- 不做参数提取（V3.0G 单独做）
- 不改 UI
- 不改 Prisma schema
- 不改现有品类已有产品的品类字段
