import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getDocument, version as pdfjsVersion } from "pdfjs-dist/legacy/build/pdf.mjs";

type Currency = "RMB" | "USD" | "mixed" | "none";
type Action =
  | "profile-ready"
  | "custom-parser-review"
  | "exclude-customer-usd"
  | "skip-scan-or-weak";

type ReviewFile = {
  id: string;
  category: string;
  factory: string;
  relativePath: string;
  v21Reason: string;
};

type TextItem = {
  page: number;
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

type Row = {
  page: number;
  y: number;
  values: string[];
  text: string;
  priceValues: string[];
  modelSignals: number;
  priceSignals: number;
};

type RowAnalysis = {
  tolerance: number;
  rows: Row[];
  tableRows: Row[];
  priceRows: Row[];
  modelAndPriceRows: Row[];
  dominantCols: number;
  longestRun: number;
};

type ReviewResult = {
  id: string;
  category: string;
  factory: string;
  fileName: string;
  relativePath: string;
  exists: boolean;
  fileSizeKb: number;
  pages: number;
  analyzedPages: number;
  chars: number;
  charsPerPage: number[];
  currency: Currency;
  bestTolerance: number;
  totalRows: number;
  tableRows: number;
  priceRows: number;
  modelAndPriceRows: number;
  dominantCols: number;
  longestRun: number;
  priceSamples: string[];
  modelSamples: string[];
  sampleRows: string[][];
  action: Action;
  reason: string;
  v21Reason: string;
  error: string | null;
};

const ROOT = "/Volumes/My Passport/AI 报价/各家工厂最新报价汇总";
const REPORT_PATH = "docs/v2.23-pdf-manual-review-report.md";
const CSV_PATH = "docs/v2.23-pdf-manual-review-details.csv";

const REVIEW_FILES: ReviewFile[] = [
  {
    id: "S01",
    category: "灯带",
    factory: "迪闻",
    relativePath: "灯带/迪闻/20251105/Newest Quotation-3m 5m 10m RGB STRIP LIGHT 20251105.pdf",
    v21Reason: "有表格结构 + 低置信价格列，需人工确认",
  },
  {
    id: "S04",
    category: "户外工厂-未判定",
    factory: "凯晟德",
    relativePath: "户外照明 工业照明/户外工厂/凯晟德/2023年9月/KCD-TG-01quotation 20230911更Ari.pdf",
    v21Reason: "有价格关键词但无明确表格结构",
  },
  {
    id: "S06",
    category: "三防灯",
    factory: "普照",
    relativePath: "户外照明 工业照明/三防灯/普照/普照2025-4月更新/双色管B报价表_20250403205729.pdf",
    v21Reason: "有价格关键词但无明确表格结构",
  },
  {
    id: "S07",
    category: "磁吸灯",
    factory: "汇盈聚",
    relativePath: "室内照明/磁吸灯/汇盈聚/汇盈聚超薄轨道灯/汇盈聚 磁吸灯最新报价 20230106/SI LI汇盈聚17-30-35超薄磁吸报价2022-09.pdf",
    v21Reason: "有价格关键词但无明确表格结构",
  },
  {
    id: "S08",
    category: "面板灯",
    factory: "进成",
    relativePath: "室内照明/大面板/进成/报价单 明装打眼款260404(2).pdf",
    v21Reason: "有价格关键词但无明确表格结构",
  },
  {
    id: "S09",
    category: "面板灯",
    factory: "新时达",
    relativePath:
      "室内照明/大面板/新时达/二代欧洲款 无边框/刘林姐发-核价单/Frameless LED Big Panel - Wellux 20240814 3Yrs Warranty isolated driver without CE ERP CB.pdf",
    v21Reason: "有表格+价格列但货币是 USD",
  },
  {
    id: "S13",
    category: "市电壁灯",
    factory: "蒂罗曼",
    relativePath: "户外照明 工业照明/市电壁灯/蒂罗曼/Alum Wall Lamp Price List - Wellux 202403.pdf",
    v21Reason: "有表格+价格列但货币是 USD",
  },
  {
    id: "S14",
    category: "太阳能壁灯",
    factory: "蓝德赛",
    relativePath:
      "户外照明 工业照明/太阳能壁灯草坪灯地插灯/太阳能壁灯草坪灯/蓝德赛/Solar Garden Light Quotation -Welfull Group 20240226.pdf",
    v21Reason: "有表格+价格列但货币是 mixed",
  },
  {
    id: "S15",
    category: "磁吸灯",
    factory: "汇盈聚(发客户)",
    relativePath: "室内照明/磁吸灯/汇盈聚/磁吸灯 推广/发客户/Wellux Quotation of  Magnetic 20 Series-2021.12.2.pdf",
    v21Reason: "有表格+价格列但货币是 USD",
  },
  {
    id: "S16",
    category: "镜前灯",
    factory: "惠尔佳(发客户)",
    relativePath:
      "室内照明/镜前灯/镜前灯-中山惠尔佳/非洲报价/Mirror + Mirror Light + Dinning Lamp Quotation - Welfull 20250821.pdf",
    v21Reason: "有表格+价格列但货币是 USD",
  },
];

const MODEL_PATTERN = /(model|item|型号|款号|编号|product\s*code|KCD|TG\d|PZ-|JH-|HY|JC|WEL|WL-|SL-|CL\d)/i;
const PRICE_HEADER_PATTERN = /(单价|价格|报价|price|unit\s*price|fob|exw|出厂|含税|裸灯|RMB|CNY|USD|¥|￥|\$)/i;
const PRICE_VALUE_PATTERN = /(?:[¥￥$]\s*)?\d{1,4}(?:,\d{3})*(?:\.\d{1,2})?\s*(?:元|RMB|CNY|USD)?/gi;
const NON_PRICE_PATTERN = /(尺寸|size|power|功率|watt|lumen|lm\/w|ra|cri|pf|cct|色温|电压|voltage|year|date|tel|phone|email)/i;

function normalizeText(value: string): string {
  return value.normalize("NFC").replace(/\s+/g, " ").trim();
}

function detectCurrency(text: string): Currency {
  const rmbHits = (text.match(/(RMB|CNY|¥|￥|\d+(?:\.\d+)?\s*元|含税|出厂)/gi) ?? []).length;
  const usdHits = (text.match(/(USD|US\$|\$|FOB)/gi) ?? []).length;
  if (rmbHits > 0 && usdHits > 0) return "mixed";
  if (rmbHits > 0) return "RMB";
  if (usdHits > 0) return "USD";
  return "none";
}

function isPriceValue(value: string): boolean {
  const text = normalizeText(value);
  if (!text || /20\d{2}[-/年.]?\d{0,2}|电话|Tel|Mobile|Email/i.test(text)) return false;
  const hasCurrency = /[¥￥$]|RMB|CNY|USD|元/i.test(text);
  const hasHeader = PRICE_HEADER_PATTERN.test(text);
  if (!hasCurrency && !hasHeader && NON_PRICE_PATTERN.test(text)) return false;

  const matches = [...text.matchAll(PRICE_VALUE_PATTERN)]
    .map((match) => match[0])
    .map((raw) => Number.parseFloat(raw.replace(/[¥￥$,\s]|RMB|CNY|USD|元/gi, "")))
    .filter((num) => Number.isFinite(num) && num > 0.05 && num < 5000);

  if (matches.length === 0) return false;
  if (!hasCurrency && !hasHeader && !/\d+\.\d{1,2}/.test(text)) return false;
  return true;
}

function extractPriceValues(value: string): string[] {
  if (!isPriceValue(value)) return [];
  return [...normalizeText(value).matchAll(PRICE_VALUE_PATTERN)]
    .map((match) => normalizeText(match[0]))
    .filter((raw) => {
      const parsed = Number.parseFloat(raw.replace(/[¥￥$,\s]|RMB|CNY|USD|元/gi, ""));
      return Number.isFinite(parsed) && parsed > 0.05 && parsed < 5000;
    });
}

function groupRows(items: TextItem[], tolerance: number): Row[] {
  const byPage = new Map<number, TextItem[]>();
  for (const item of items) {
    const pageItems = byPage.get(item.page) ?? [];
    pageItems.push(item);
    byPage.set(item.page, pageItems);
  }

  const rows: Row[] = [];
  for (const [page, pageItems] of byPage) {
    const buckets: TextItem[][] = [];
    for (const item of [...pageItems].sort((left, right) => right.y - left.y)) {
      const bucket = buckets.find((candidate) => Math.abs(candidate[0].y - item.y) <= tolerance);
      if (bucket) {
        bucket.push(item);
      } else {
        buckets.push([item]);
      }
    }

    for (const bucket of buckets) {
      const values = bucket
        .filter((item) => normalizeText(item.str).length > 0)
        .sort((left, right) => left.x - right.x)
        .map((item) => normalizeText(item.str));
      if (values.length === 0) continue;
      const text = values.join(" ");
      const priceValues = values.flatMap(extractPriceValues);
      rows.push({
        page,
        y: bucket.reduce((sum, item) => sum + item.y, 0) / bucket.length,
        values,
        text,
        priceValues,
        modelSignals: values.filter((value) => MODEL_PATTERN.test(value)).length,
        priceSignals: values.filter((value) => PRICE_HEADER_PATTERN.test(value) || isPriceValue(value)).length,
      });
    }
  }
  return rows.sort((left, right) => left.page - right.page || right.y - left.y);
}

function longestRun(rows: Row[], dominantCols: number): number {
  let longest = 0;
  let current = 0;
  for (const row of rows) {
    const matches = row.values.length >= 3 && Math.abs(row.values.length - dominantCols) <= 2;
    if (matches) {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }
  return longest;
}

function analyzeRows(rows: Row[], tolerance: number): RowAnalysis {
  const tableRows = rows.filter((row) => row.values.length >= 3);
  const counts = new Map<number, number>();
  for (const row of tableRows) {
    counts.set(row.values.length, (counts.get(row.values.length) ?? 0) + 1);
  }
  const dominantCols = [...counts.entries()].sort((left, right) => right[1] - left[1] || right[0] - left[0])[0]?.[0] ?? 0;
  const priceRows = rows.filter((row) => row.priceValues.length > 0 || row.priceSignals >= 2);
  const modelAndPriceRows = priceRows.filter((row) => row.modelSignals > 0 || MODEL_PATTERN.test(row.text));
  return {
    tolerance,
    rows,
    tableRows,
    priceRows,
    modelAndPriceRows,
    dominantCols,
    longestRun: longestRun(tableRows, dominantCols),
  };
}

function scoreAnalysis(analysis: RowAnalysis): number {
  return (
    analysis.modelAndPriceRows.length * 6 +
    analysis.priceRows.length * 3 +
    Math.min(analysis.longestRun, 12) * 2 +
    Math.min(analysis.dominantCols, 10)
  );
}

function classify(result: Omit<ReviewResult, "action" | "reason">): Pick<ReviewResult, "action" | "reason"> {
  if (result.error || !result.exists || result.chars < 50) {
    return { action: "skip-scan-or-weak", reason: "扫描件、无文字或解析失败；不适合无 OCR 导入。" };
  }
  if (result.currency === "USD") {
    return { action: "exclude-customer-usd", reason: "价格语义为 USD/FOB 客户价，不应写入 purchase_price。" };
  }
  if (result.currency === "mixed") {
    return { action: "custom-parser-review", reason: "同时出现 RMB/USD 信号，需要人工确认应取哪一列；不能自动导入。" };
  }
  if (result.modelAndPriceRows >= 4 && result.priceRows >= 4 && result.longestRun >= 4) {
    return { action: "profile-ready", reason: "RMB 价格行和型号/规格行稳定，可进入下一步 profile parser。" };
  }
  if (result.currency === "RMB" && result.priceRows >= 3) {
    return { action: "custom-parser-review", reason: "存在 RMB 价格行，但行列结构不够稳定，需要单文件 profile 规则。" };
  }
  return { action: "skip-scan-or-weak", reason: "价格/型号信号不足，不建议投入导入器。" };
}

async function extractTextItems(file: ReviewFile): Promise<{
  items: TextItem[];
  pages: number;
  analyzedPages: number;
  charsPerPage: number[];
}> {
  const absolutePath = path.join(ROOT, file.relativePath);
  const pdfBytes = new Uint8Array(readFileSync(absolutePath));
  const task = getDocument({ data: pdfBytes, useSystemFonts: true, stopAtErrors: false });
  const pdf = await task.promise;
  const analyzedPages = Math.min(pdf.numPages, file.id === "S13" ? 8 : 12);
  const items: TextItem[] = [];
  const charsPerPage: number[] = [];

  for (let pageNumber = 1; pageNumber <= analyzedPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    let chars = 0;
    for (const rawItem of content.items) {
      const item = rawItem as { str?: string; transform?: number[]; width?: number; height?: number };
      const value = normalizeText(item.str ?? "");
      if (!value || !item.transform) continue;
      chars += value.length;
      items.push({
        page: pageNumber,
        str: value,
        x: Number(item.transform[4] ?? 0),
        y: Number(item.transform[5] ?? 0),
        width: Number(item.width ?? 0),
        height: Number(item.height ?? 0),
      });
    }
    charsPerPage.push(chars);
  }
  await task.destroy();
  return { items, pages: pdf.numPages, analyzedPages, charsPerPage };
}

async function analyzeFile(file: ReviewFile): Promise<ReviewResult> {
  const absolutePath = path.join(ROOT, file.relativePath);
  const fileName = path.basename(file.relativePath);
  const exists = existsSync(absolutePath);
  const fileSizeKb = exists ? Math.round((statSync(absolutePath).size / 1024) * 10) / 10 : 0;

  if (!exists) {
    return {
      id: file.id,
      category: file.category,
      factory: file.factory,
      fileName,
      relativePath: file.relativePath,
      exists: false,
      fileSizeKb,
      pages: 0,
      analyzedPages: 0,
      chars: 0,
      charsPerPage: [],
      currency: "none",
      bestTolerance: 0,
      totalRows: 0,
      tableRows: 0,
      priceRows: 0,
      modelAndPriceRows: 0,
      dominantCols: 0,
      longestRun: 0,
      priceSamples: [],
      modelSamples: [],
      sampleRows: [],
      action: "skip-scan-or-weak",
      reason: "文件不存在。",
      v21Reason: file.v21Reason,
      error: "文件不存在",
    };
  }

  try {
    const extracted = await extractTextItems(file);
    const fullText = extracted.items.map((item) => item.str).join(" ");
    const analyses = [2, 3, 4, 5, 6].map((tolerance) => analyzeRows(groupRows(extracted.items, tolerance), tolerance));
    const best = analyses.sort((left, right) => scoreAnalysis(right) - scoreAnalysis(left))[0];
    const priceSamples = [...new Set(best.priceRows.flatMap((row) => row.priceValues))].slice(0, 8);
    const modelSamples = best.rows
      .filter((row) => row.modelSignals > 0 || MODEL_PATTERN.test(row.text))
      .map((row) => row.text)
      .slice(0, 5);
    const sampleRows = best.priceRows.slice(0, 8).map((row) => row.values.slice(0, 10));
    const base = {
      id: file.id,
      category: file.category,
      factory: file.factory,
      fileName,
      relativePath: file.relativePath,
      exists,
      fileSizeKb,
      pages: extracted.pages,
      analyzedPages: extracted.analyzedPages,
      chars: fullText.length,
      charsPerPage: extracted.charsPerPage,
      currency: detectCurrency(fullText),
      bestTolerance: best.tolerance,
      totalRows: best.rows.length,
      tableRows: best.tableRows.length,
      priceRows: best.priceRows.length,
      modelAndPriceRows: best.modelAndPriceRows.length,
      dominantCols: best.dominantCols,
      longestRun: best.longestRun,
      priceSamples,
      modelSamples,
      sampleRows,
      v21Reason: file.v21Reason,
      error: null,
    };
    return { ...base, ...classify(base) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      id: file.id,
      category: file.category,
      factory: file.factory,
      fileName,
      relativePath: file.relativePath,
      exists,
      fileSizeKb,
      pages: 0,
      analyzedPages: 0,
      chars: 0,
      charsPerPage: [],
      currency: "none",
      bestTolerance: 0,
      totalRows: 0,
      tableRows: 0,
      priceRows: 0,
      modelAndPriceRows: 0,
      dominantCols: 0,
      longestRun: 0,
      priceSamples: [],
      modelSamples: [],
      sampleRows: [],
      action: "skip-scan-or-weak",
      reason: `解析失败：${message}`,
      v21Reason: file.v21Reason,
      error: message,
    };
  }
}

function csvEscape(value: string | number | boolean | null): string {
  const text = value == null ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function writeCsv(results: ReviewResult[]): void {
  const headers = [
    "id",
    "category",
    "factory",
    "file_name",
    "currency",
    "action",
    "reason",
    "price_rows",
    "model_price_rows",
    "longest_run",
    "dominant_cols",
    "price_samples",
    "relative_path",
  ];
  const rows = results.map((result) =>
    [
      result.id,
      result.category,
      result.factory,
      result.fileName,
      result.currency,
      result.action,
      result.reason,
      result.priceRows,
      result.modelAndPriceRows,
      result.longestRun,
      result.dominantCols,
      result.priceSamples.join(" | "),
      result.relativePath,
    ].map(csvEscape).join(","),
  );
  writeFileSync(CSV_PATH, [headers.join(","), ...rows].join("\n"), "utf8");
}

function markdownTable(rows: string[][]): string {
  if (rows.length === 0) return "_No rows._";
  const width = Math.min(10, Math.max(...rows.map((row) => row.length)));
  const header = Array.from({ length: width }, (_, index) => `Col ${index + 1}`);
  const divider = header.map(() => "---");
  const body = rows.map((row) =>
    Array.from({ length: width }, (_, index) => (row[index] ?? "").replace(/\|/g, "\\|")),
  );
  return [`| ${header.join(" | ")} |`, `| ${divider.join(" | ")} |`, ...body.map((row) => `| ${row.join(" | ")} |`)].join("\n");
}

function writeMarkdown(results: ReviewResult[]): void {
  const counts = new Map<Action, number>();
  for (const result of results) counts.set(result.action, (counts.get(result.action) ?? 0) + 1);

  const lines: string[] = [
    "# V2.23 — PDF Manual-Review Re-evaluation",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Library: pdfjs-dist ${pdfjsVersion}`,
    `Files analyzed: ${results.length}`,
    "",
    "## Summary",
    "",
    "| Action | Count | Meaning |",
    "|---|---:|---|",
    `| profile-ready | ${counts.get("profile-ready") ?? 0} | RMB 工厂价，表格/价格行足够稳定，可进入下一步 profile parser |`,
    `| custom-parser-review | ${counts.get("custom-parser-review") ?? 0} | 有 RMB/mixed 价格信号，但需要人工确认或单文件规则 |`,
    `| exclude-customer-usd | ${counts.get("exclude-customer-usd") ?? 0} | USD/FOB 客户价，不应导入 supplier_offers.purchase_price |`,
    `| skip-scan-or-weak | ${counts.get("skip-scan-or-weak") ?? 0} | 扫描件或信号不足，暂不投入 |`,
    "",
    "## Recommended Next Step",
    "",
    "- V2.23 仍然不写 DB；本报告只决定后续是否值得做 V2.24 PDF profile 导入。",
    "- `profile-ready` 可进入下一步脚本导入；`exclude-customer-usd` 明确排除；`custom-parser-review` 需要人工看样本后再决定。",
    "",
    "## Results",
    "",
    "| ID | Category | Factory | Currency | Action | Price Rows | Model+Price Rows | Longest Run | Price Samples | Reason |",
    "|---|---|---|---|---|---:|---:|---:|---|---|",
    ...results.map(
      (result) =>
        `| ${result.id} | ${result.category} | ${result.factory} | ${result.currency} | ${result.action} | ${result.priceRows} | ${result.modelAndPriceRows} | ${result.longestRun} | ${result.priceSamples.join(", ").replace(/\|/g, "\\|") || "-"} | ${result.reason.replace(/\|/g, "\\|")} |`,
    ),
    "",
    "## File Details",
    "",
  ];

  for (const result of results) {
    lines.push(
      `### ${result.id} — ${result.category}/${result.factory}/${result.fileName}`,
      "",
      `- Relative path: ${result.relativePath}`,
      `- V2.21 reason: ${result.v21Reason}`,
      `- Pages: ${result.pages}; analyzed: ${result.analyzedPages}; chars: ${result.chars}`,
      `- Best row tolerance: ${result.bestTolerance}; rows: ${result.totalRows}; table rows: ${result.tableRows}; dominant cols: ${result.dominantCols}; longest run: ${result.longestRun}`,
      `- Price samples: ${result.priceSamples.join(", ") || "-"}`,
      `- Model samples: ${result.modelSamples.join(" / ") || "-"}`,
      `- Action: **${result.action}** — ${result.reason}`,
      "",
      "**Price-like sample rows**",
      "",
      markdownTable(result.sampleRows),
      "",
    );
  }

  lines.push(
    "## Output Files",
    "",
    `- CSV: ${CSV_PATH}`,
    `- Script: ${fileURLToPath(import.meta.url)}`,
    "",
  );
  writeFileSync(REPORT_PATH, lines.join("\n"), "utf8");
}

async function main() {
  if (!existsSync(ROOT)) {
    throw new Error(`Drive root not mounted: ${ROOT}`);
  }
  mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  const results: ReviewResult[] = [];
  for (const file of REVIEW_FILES) {
    console.log(`Reviewing ${file.id}: ${file.relativePath}`);
    results.push(await analyzeFile(file));
  }
  writeCsv(results);
  writeMarkdown(results);
  console.log({
    files: results.length,
    profileReady: results.filter((result) => result.action === "profile-ready").length,
    customParserReview: results.filter((result) => result.action === "custom-parser-review").length,
    excludeCustomerUsd: results.filter((result) => result.action === "exclude-customer-usd").length,
    skip: results.filter((result) => result.action === "skip-scan-or-weak").length,
    reportPath: REPORT_PATH,
    csvPath: CSV_PATH,
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
