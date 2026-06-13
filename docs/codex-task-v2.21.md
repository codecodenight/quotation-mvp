# Codex Task: V2.21 — PDF 报价可解析性 Spike

## 目标

用 `pdfjs-dist` 对 16 份精选 PDF 做只读解析测试，判断哪些能被本地 JS 工具提取表格/价格数据。**不写 DB，不导入产品，不动源文件。**

## 背景

V2.20 扫描硬盘发现 617 份 PDF，73 份被文件名关键词标记为疑似报价。但其中有大量噪声：
- 父目录包含"价格"导致子文件（CTN.pdf、driver.pdf、sticker.pdf）被误判
- "Wellux/Welfull Quotation" 是客户报价单（FOB USD），不是工厂采购价
- 超大文件（>50 MB）几乎肯定是画册/包装设计

人工筛选后剩 16 份真正的 spike 候选。

## 依赖安装

```bash
npm install pdfjs-dist
```

注意：`pdfjs-dist` 在 Node.js 中不需要 canvas（我们只做文本提取，不渲染）。如果安装时有 optional canvas 依赖警告，忽略即可。

## Spike 文件列表

以下 16 份文件分三个 tier：

### Tier 1 — 高概率工厂报价（小文件，文件名明确含报价/价目）

```typescript
const SPIKE_FILES: SpikeFile[] = [
  // Tier 1: 高概率工厂报价
  { id: "S01", tier: 1, category: "灯带", factory: "迪闻", sizeKb: 215,
    path: "灯带/迪闻/20251105/Newest Quotation-3m 5m 10m RGB STRIP LIGHT 20251105.pdf" },
  { id: "S02", tier: 1, category: "G4G9", factory: "普雅", sizeKb: 117,
    path: "光源/G4G9/G4 G9源头工厂 普雅产品价目表220318杭州汇浮.pdf" },
  { id: "S03", tier: 1, category: "防潮灯", factory: "普照", sizeKb: 209,
    path: "户外照明 工业照明/防潮灯/普照/CL04防潮灯报价表2024年4月25 普照.pdf" },
  { id: "S04", tier: 1, category: "户外工厂-未判定", factory: "凯晟德", sizeKb: 644,
    path: "户外照明 工业照明/户外工厂/凯晟德/2023年9月/KCD-TG-01quotation 20230911更Ari.pdf" },
  { id: "S05", tier: 1, category: "三防灯", factory: "普照", sizeKb: 1200,
    path: "户外照明 工业照明/三防灯/普照/普照2025-4月更新/双色管A-报价表_20250403205611.pdf" },
  { id: "S06", tier: 1, category: "三防灯", factory: "普照", sizeKb: 211,
    path: "户外照明 工业照明/三防灯/普照/普照2025-4月更新/双色管B报价表_20250403205729.pdf" },
  { id: "S07", tier: 1, category: "磁吸灯", factory: "汇盈聚", sizeKb: 645,
    path: "室内照明/磁吸灯/汇盈聚/汇盈聚超薄轨道灯/汇盈聚 磁吸灯最新报价 20230106/SI LI汇盈聚17-30-35超薄磁吸报价2022-09.pdf" },
  { id: "S08", tier: 1, category: "面板灯", factory: "进成", sizeKb: 169,
    path: "室内照明/大面板/进成/报价单 明装打眼款260404(2).pdf" },
  { id: "S09", tier: 1, category: "面板灯", factory: "新时达", sizeKb: 296,
    path: "室内照明/大面板/新时达/二代欧洲款 无边框/刘林姐发-核价单/Frameless LED Big Panel - Wellux 20240814 3Yrs Warranty isolated driver without CE ERP CB.pdf" },
  { id: "S10", tier: 1, category: "风扇灯", factory: "伊特/杰莱特", sizeKb: 4800,
    path: "室内照明/风扇灯/伊特/2025年杰莱特风扇产品报价-全.pdf" },

  // Tier 2: 可能是报价但文件较大或不确定
  { id: "S11", tier: 2, category: "灯带", factory: "华浦", sizeKb: 6500,
    path: "灯带/广交会最终核价/L069 灯带套装价格参考/L069 LED STRIP.pdf" },
  { id: "S12", tier: 2, category: "工作灯", factory: "绿晟", sizeKb: 11900,
    path: "户外照明 工业照明/工作灯/绿晟luxson/绿晟工作灯报价2026-1-13/LED WORKLGHT2025.pdf" },
  { id: "S13", tier: 2, category: "市电壁灯", factory: "蒂罗曼", sizeKb: 22500,
    path: "户外照明 工业照明/市电壁灯/蒂罗曼/Alum Wall Lamp Price List - Wellux 202403.pdf" },
  { id: "S14", tier: 2, category: "太阳能壁灯", factory: "蓝德赛", sizeKb: 4100,
    path: "户外照明 工业照明/太阳能壁灯草坪灯地插灯/太阳能壁灯草坪灯/蓝德赛/Solar Garden Light Quotation -Welfull Group 20240226.pdf" },

  // Tier 3: 客户报价（Wellux 发客户，可能 FOB USD，用作对比参照）
  { id: "S15", tier: 3, category: "磁吸灯", factory: "汇盈聚(发客户)", sizeKb: 1600,
    path: "室内照明/磁吸灯/汇盈聚/磁吸灯 推广/发客户/Wellux Quotation of  Magnetic 20 Series-2021.12.2.pdf" },
  { id: "S16", tier: 3, category: "镜前灯", factory: "惠尔佳(发客户)", sizeKb: 1800,
    path: "室内照明/镜前灯/镜前灯-中山惠尔佳/非洲报价/Mirror + Mirror Light + Dinning Lamp Quotation - Welfull 20250821.pdf" },
];
```

## 脚本：`scripts/pdf-spike-v2.21.ts`

### 核心逻辑

```typescript
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

// pdfjs-dist Node.js import (legacy build for Node compatibility)
// Try: import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
// If that fails, try: import * as pdfjsLib from "pdfjs-dist";
// The exact import path depends on the installed version — check node_modules/pdfjs-dist/

const ROOT = "/Volumes/My Passport/AI 报价/各家工厂最新报价汇总";
```

### 每个 PDF 提取流程

```
对每个 spike 文件：
1. 检查文件是否存在
2. 用 pdfjs-dist 加载 PDF
3. 读取前 5 页（或全部，取较小值）
4. 每页调用 page.getTextContent()
5. 收集所有 textContent.items

对 textContent.items 中的每个 item：
- item.str = 文字内容
- item.transform[4] = x 坐标
- item.transform[5] = y 坐标
- item.width = 宽度
- item.height = 高度
```

### 分析维度

对每个 PDF 产出以下分析：

**1. 文本 vs 扫描判断**

```typescript
type PdfType = "text" | "scan" | "mixed";

// 规则：
// - 前 5 页总字符数 < 50 → "scan"
// - 前 5 页每页都有 > 20 个字符 → "text"
// - 部分页有文字、部分没有 → "mixed"
```

**2. 关键词检测**

在提取的全文中搜索以下关键词（大小写不敏感），记录命中数：

```typescript
const PRICE_KEYWORDS = ["¥", "￥", "RMB", "USD", "单价", "价格", "报价", "price", "unit price", "FOB"];
const MODEL_KEYWORDS = ["型号", "model", "item no", "product code", "编号"];
const SPEC_KEYWORDS = ["功率", "watt", "power", "MOQ", "最小订量", "CTN", "包装", "packing"];
const CURRENCY_PATTERNS = [/\d+\.\d{1,2}\s*(元|¥|￥|RMB|USD|\$)/i, /¥\s*\d+/];
```

**3. 行结构检测（表格推断）**

```typescript
// 1. 将所有 text items 按 y 坐标分组（tolerance ±2pt）
// 2. 每个 y-group 就是一个"行"
// 3. 统计每行有多少个 text items（即"列数"）
// 4. 如果连续 5+ 行有相同列数（±1），判定为"有表格结构"

type TableDetection = {
  hasTable: boolean;
  consistentRows: number;      // 列数一致的连续行数
  dominantColumnCount: number;  // 最常见的列数
  sampleRows: string[][];      // 前 3 行的文字内容（每行按 x 排序）
};
```

**4. 价格列识别**

```typescript
// 在检测到的表格行中：
// 1. 找到含数字且格式像价格的列（\d+\.\d{1,2} 或 \d{1,4}）
// 2. 如果表头行包含"单价/price/价格"等关键词 → 强信号
// 3. 如果某列大部分值是 2-4 位数字带小数 → 中信号
// 4. 记录找到的价格列位置和样本值

type PriceColumnDetection = {
  found: boolean;
  confidence: "high" | "medium" | "low" | "none";
  headerMatch: string | null;   // 匹配的表头关键词
  sampleValues: string[];       // 前 5 个疑似价格值
  columnIndex: number | null;
};
```

### 输出结构

```typescript
type SpikeResult = {
  id: string;
  tier: number;
  category: string;
  factory: string;
  fileName: string;
  fileSizeKb: number;
  fileExists: boolean;
  totalPages: number;
  analyzedPages: number;

  // 文本分析
  pdfType: "text" | "scan" | "mixed";
  totalChars: number;
  charsPerPage: number[];

  // 关键词
  priceKeywordHits: number;
  modelKeywordHits: number;
  specKeywordHits: number;
  currencyPatternHits: number;
  detectedCurrency: string | null;  // "RMB" | "USD" | "mixed" | null

  // 表格
  table: TableDetection;

  // 价格列
  priceColumn: PriceColumnDetection;

  // 文本样本（前 500 字符，用于人工检查）
  textSample: string;

  // 最终判定
  verdict: "importable" | "manual-review" | "skip";
  verdictReason: string;
};
```

### 判定规则

```typescript
function classify(result: SpikeResult): { verdict: string; reason: string } {
  if (result.pdfType === "scan") {
    return { verdict: "skip", reason: "扫描件，无可提取文字" };
  }
  if (result.priceKeywordHits === 0 && result.currencyPatternHits === 0) {
    return { verdict: "skip", reason: "无价格相关关键词" };
  }
  if (result.table.hasTable && result.priceColumn.found && result.priceColumn.confidence !== "low") {
    if (result.detectedCurrency === "USD" || result.detectedCurrency === "mixed") {
      return { verdict: "manual-review", reason: `有表格+价格列但货币是 ${result.detectedCurrency}` };
    }
    return { verdict: "importable", reason: "有表格结构 + 可识别价格列" };
  }
  if (result.table.hasTable && !result.priceColumn.found) {
    return { verdict: "manual-review", reason: "有表格结构但价格列不明确" };
  }
  if (!result.table.hasTable && result.priceKeywordHits > 0) {
    return { verdict: "manual-review", reason: "有价格关键词但无明确表格结构" };
  }
  return { verdict: "skip", reason: "无表格结构且无价格信号" };
}
```

## 报告格式

写入 `docs/v2.21-pdf-spike-report.md`：

```markdown
# V2.21 — PDF 可解析性 Spike 报告

Generated: {timestamp}
Library: pdfjs-dist {version}
Files analyzed: 16

## Summary

| Verdict | Count | 说明 |
|---|---:|---|
| importable | N | 有表格+价格列，可进 V2.22 |
| manual-review | N | 有部分信号但需人工确认 |
| skip | N | 扫描件/无价格/画册 |

## Results by File

### S01 — 灯带/迪闻/Newest Quotation (Tier 1)

| 属性 | 值 |
|---|---|
| PDF Type | text / scan / mixed |
| Pages | total / analyzed |
| Total Chars | N |
| Price Keywords | N hits |
| Model Keywords | N hits |
| Currency | RMB / USD / mixed / none |
| Table Detected | yes/no (N consistent rows, N columns) |
| Price Column | yes/no (confidence: high/medium/low) |
| **Verdict** | **importable / manual-review / skip** |
| Reason | ... |

**Sample Rows:**
| Col 1 | Col 2 | Col 3 | ... |
|---|---|---|---|
| ... | ... | ... | ... |

**Text Sample (first 500 chars):**
```
{raw text}
```

---
（每个文件重复上面的格式）

## Conclusions

- importable 文件数和品类分布
- 常见 PDF 报价格式特征
- V2.22 导入器是否值得做
- 已知局限（如坐标精度、合并单元格、嵌入图片遮挡文字）
```

同时写入 `docs/v2.21-pdf-spike-details.csv`：

```csv
id,tier,category,factory,file_name,size_kb,pdf_type,total_chars,price_keywords,model_keywords,currency,has_table,table_rows,table_cols,price_col_found,price_col_confidence,verdict,reason
S01,1,灯带,迪闻,Newest Quotation...,215,text,2340,5,3,RMB,yes,12,6,yes,high,importable,...
```

## 执行步骤

### Step 1: 安装 pdfjs-dist

```bash
npm install pdfjs-dist
```

### Step 2: 新建脚本

创建 `scripts/pdf-spike-v2.21.ts`。

关键实现注意：
- `pdfjs-dist` 在 Node.js 中的 import 路径可能是 `pdfjs-dist/legacy/build/pdf.mjs` 或 `pdfjs-dist`，取决于版本。检查 `node_modules/pdfjs-dist/` 确定正确路径。
- 不需要设置 `workerSrc`（单线程模式足够，我们只解析 16 个文件）。
- 用 `readFileSync` 读取 PDF 为 `Uint8Array`，传给 `getDocument({ data })`.
- 每个 PDF 限制处理前 5 页。超大文件（>30 MB）跳过全文提取，只读前 2 页采样。
- 所有错误（文件不存在、解析失败、加密 PDF）都 catch 并记录到结果，不中断脚本。

### Step 3: 运行

```bash
npx tsx scripts/pdf-spike-v2.21.ts
```

确保硬盘 `/Volumes/My Passport` 已挂载。

### Step 4: 验证

- 确认报告 `docs/v2.21-pdf-spike-report.md` 完整生成
- 确认 CSV `docs/v2.21-pdf-spike-details.csv` 有 16 行数据
- 确认 `npx tsc --noEmit --pretty false` 通过

### Step 5: 提交

```bash
git add scripts/pdf-spike-v2.21.ts docs/v2.21-pdf-spike-report.md docs/v2.21-pdf-spike-details.csv package.json package-lock.json
git commit -m "V2.21: PDF parseability spike — pdfjs-dist text+table extraction on 16 candidates"
```

## 验收标准

1. `pdfjs-dist` 安装成功
2. 脚本对 16 个文件逐一解析，跳过不存在的文件
3. 每个文件有完整分析结果（pdfType, keywords, table, priceColumn, verdict）
4. 报告包含每个文件的 sample rows 和 text sample
5. verdict 判定逻辑合理（scan→skip, 有表格+价格→importable, 有信号但模糊→manual-review）
6. CSV 可导入 Excel 查看
7. 不修改任何源 PDF
8. 不写 DB
9. `tsc --noEmit` 通过
10. 脚本可重复运行

## 不做的事

- 不导入产品/offers 到 DB
- 不修改源 PDF 文件
- 不使用 OCR / AI / 云服务
- 不使用 Tabula / Java
- 不安装 canvas（pdfjs-dist 文本提取不需要）
- 不做 PDF 渲染/截图
- 不处理加密 PDF（记录为 skip）
