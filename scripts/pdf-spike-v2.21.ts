import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getDocument, version as pdfjsVersion } from "pdfjs-dist/legacy/build/pdf.mjs";

type PdfType = "text" | "scan" | "mixed";
type Verdict = "importable" | "manual-review" | "skip";
type Confidence = "high" | "medium" | "low" | "none";

type SpikeFile = {
  id: string;
  tier: number;
  category: string;
  factory: string;
  sizeKb: number;
  path: string;
};

type TextItem = {
  page: number;
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

type TableRow = {
  page: number;
  y: number;
  cells: TextItem[];
  values: string[];
};

type TableDetection = {
  hasTable: boolean;
  consistentRows: number;
  dominantColumnCount: number;
  sampleRows: string[][];
};

type PriceColumnDetection = {
  found: boolean;
  confidence: Confidence;
  headerMatch: string | null;
  sampleValues: string[];
  columnIndex: number | null;
};

type SpikeResult = {
  id: string;
  tier: number;
  category: string;
  factory: string;
  fileName: string;
  relativePath: string;
  fileSizeKb: number;
  fileExists: boolean;
  totalPages: number;
  analyzedPages: number;
  pdfType: PdfType;
  totalChars: number;
  charsPerPage: number[];
  priceKeywordHits: number;
  modelKeywordHits: number;
  specKeywordHits: number;
  currencyPatternHits: number;
  detectedCurrency: "RMB" | "USD" | "mixed" | null;
  table: TableDetection;
  priceColumn: PriceColumnDetection;
  textSample: string;
  verdict: Verdict;
  verdictReason: string;
  error: string | null;
};

const ROOT = "/Volumes/My Passport/AI 报价/各家工厂最新报价汇总";
const REPORT_PATH = "docs/v2.21-pdf-spike-report.md";
const CSV_PATH = "docs/v2.21-pdf-spike-details.csv";

const SPIKE_FILES: SpikeFile[] = [
  {
    id: "S01",
    tier: 1,
    category: "灯带",
    factory: "迪闻",
    sizeKb: 215,
    path: "灯带/迪闻/20251105/Newest Quotation-3m 5m 10m RGB STRIP LIGHT 20251105.pdf",
  },
  {
    id: "S02",
    tier: 1,
    category: "G4G9",
    factory: "普雅",
    sizeKb: 117,
    path: "光源/G4G9/G4 G9源头工厂 普雅产品价目表220318杭州汇浮.pdf",
  },
  {
    id: "S03",
    tier: 1,
    category: "防潮灯",
    factory: "普照",
    sizeKb: 209,
    path: "户外照明 工业照明/防潮灯/普照/CL04防潮灯报价表2024年4月25 普照.pdf",
  },
  {
    id: "S04",
    tier: 1,
    category: "户外工厂-未判定",
    factory: "凯晟德",
    sizeKb: 644,
    path: "户外照明 工业照明/户外工厂/凯晟德/2023年9月/KCD-TG-01quotation 20230911更Ari.pdf",
  },
  {
    id: "S05",
    tier: 1,
    category: "三防灯",
    factory: "普照",
    sizeKb: 1200,
    path: "户外照明 工业照明/三防灯/普照/普照2025-4月更新/双色管A-报价表_20250403205611.pdf",
  },
  {
    id: "S06",
    tier: 1,
    category: "三防灯",
    factory: "普照",
    sizeKb: 211,
    path: "户外照明 工业照明/三防灯/普照/普照2025-4月更新/双色管B报价表_20250403205729.pdf",
  },
  {
    id: "S07",
    tier: 1,
    category: "磁吸灯",
    factory: "汇盈聚",
    sizeKb: 645,
    path: "室内照明/磁吸灯/汇盈聚/汇盈聚超薄轨道灯/汇盈聚 磁吸灯最新报价 20230106/SI LI汇盈聚17-30-35超薄磁吸报价2022-09.pdf",
  },
  {
    id: "S08",
    tier: 1,
    category: "面板灯",
    factory: "进成",
    sizeKb: 169,
    path: "室内照明/大面板/进成/报价单 明装打眼款260404(2).pdf",
  },
  {
    id: "S09",
    tier: 1,
    category: "面板灯",
    factory: "新时达",
    sizeKb: 296,
    path: "室内照明/大面板/新时达/二代欧洲款 无边框/刘林姐发-核价单/Frameless LED Big Panel - Wellux 20240814 3Yrs Warranty isolated driver without CE ERP CB.pdf",
  },
  {
    id: "S10",
    tier: 1,
    category: "风扇灯",
    factory: "伊特/杰莱特",
    sizeKb: 4800,
    path: "室内照明/风扇灯/伊特/2025年杰莱特风扇产品报价-全.pdf",
  },
  {
    id: "S11",
    tier: 2,
    category: "灯带",
    factory: "华浦",
    sizeKb: 6500,
    path: "灯带/广交会最终核价/L069 灯带套装价格参考/L069 LED STRIP.pdf",
  },
  {
    id: "S12",
    tier: 2,
    category: "工作灯",
    factory: "绿晟",
    sizeKb: 11900,
    path: "户外照明 工业照明/工作灯/绿晟luxson/绿晟工作灯报价2026-1-13/LED WORKLGHT2025.pdf",
  },
  {
    id: "S13",
    tier: 2,
    category: "市电壁灯",
    factory: "蒂罗曼",
    sizeKb: 22500,
    path: "户外照明 工业照明/市电壁灯/蒂罗曼/Alum Wall Lamp Price List - Wellux 202403.pdf",
  },
  {
    id: "S14",
    tier: 2,
    category: "太阳能壁灯",
    factory: "蓝德赛",
    sizeKb: 4100,
    path: "户外照明 工业照明/太阳能壁灯草坪灯地插灯/太阳能壁灯草坪灯/蓝德赛/Solar Garden Light Quotation -Welfull Group 20240226.pdf",
  },
  {
    id: "S15",
    tier: 3,
    category: "磁吸灯",
    factory: "汇盈聚(发客户)",
    sizeKb: 1600,
    path: "室内照明/磁吸灯/汇盈聚/磁吸灯 推广/发客户/Wellux Quotation of  Magnetic 20 Series-2021.12.2.pdf",
  },
  {
    id: "S16",
    tier: 3,
    category: "镜前灯",
    factory: "惠尔佳(发客户)",
    sizeKb: 1800,
    path: "室内照明/镜前灯/镜前灯-中山惠尔佳/非洲报价/Mirror + Mirror Light + Dinning Lamp Quotation - Welfull 20250821.pdf",
  },
];

const PRICE_KEYWORDS = ["¥", "￥", "RMB", "CNY", "USD", "单价", "价格", "报价", "price", "unit price", "FOB"];
const MODEL_KEYWORDS = ["型号", "model", "item no", "item number", "product code", "编号", "款号"];
const SPEC_KEYWORDS = ["功率", "watt", "power", "MOQ", "最小订量", "CTN", "包装", "packing"];
const PRICE_HEADER_PATTERN = /(单价|价格|报价|价目|price|unit\s*price|amount|fob|rmb|usd|¥|￥|\$)/i;
const MODEL_HEADER_PATTERN = /(型号|model|item\s*(no|number)|product\s*code|编号|款号)/i;
const PRICE_VALUE_PATTERN = /(?:¥|￥|\$|RMB|CNY|USD)?\s*\d{1,4}(?:,\d{3})*(?:\.\d{1,2})?\s*(?:元|RMB|CNY|USD|\$)?/i;
const CURRENCY_PATTERNS = [/\d+\.\d{1,2}\s*(元|¥|￥|RMB|CNY|USD|\$)/gi, /[¥￥$]\s*\d+(?:\.\d+)?/g];

function normalizeText(value: string): string {
  return value.normalize("NFC").replace(/\s+/g, " ").trim();
}

function countKeywordHits(text: string, keywords: string[]): number {
  const lower = text.toLowerCase();
  return keywords.reduce((count, keyword) => {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const matches = lower.match(new RegExp(escaped, "gi"));
    return count + (matches?.length ?? 0);
  }, 0);
}

function countPatternHits(text: string): number {
  return CURRENCY_PATTERNS.reduce((count, pattern) => {
    const matches = text.match(pattern);
    return count + (matches?.length ?? 0);
  }, 0);
}

function detectCurrency(text: string): "RMB" | "USD" | "mixed" | null {
  const rmbHits = (text.match(/(RMB|CNY|¥|￥|\d+(?:\.\d+)?\s*元)/gi) ?? []).length;
  const usdHits = (text.match(/(USD|US\$|\$|FOB)/gi) ?? []).length;

  if (rmbHits > 0 && usdHits > 0) return "mixed";
  if (rmbHits > 0) return "RMB";
  if (usdHits > 0) return "USD";
  return null;
}

function getPdfType(charsPerPage: number[]): PdfType {
  const totalChars = charsPerPage.reduce((sum, count) => sum + count, 0);
  if (totalChars < 50) return "scan";

  const pagesWithText = charsPerPage.filter((count) => count > 20).length;
  if (pagesWithText === charsPerPage.length) return "text";
  return "mixed";
}

function groupRows(items: TextItem[]): TableRow[] {
  const rowsByPage = new Map<number, TextItem[]>();
  for (const item of items) {
    const pageItems = rowsByPage.get(item.page) ?? [];
    pageItems.push(item);
    rowsByPage.set(item.page, pageItems);
  }

  const rows: TableRow[] = [];

  for (const [page, pageItems] of [...rowsByPage.entries()].sort((a, b) => a[0] - b[0])) {
    const sortedByY = [...pageItems].sort((a, b) => b.y - a.y);
    const buckets: TextItem[][] = [];

    for (const item of sortedByY) {
      const bucket = buckets.find((existing) => Math.abs(existing[0].y - item.y) <= 2);
      if (bucket) {
        bucket.push(item);
      } else {
        buckets.push([item]);
      }
    }

    for (const bucket of buckets) {
      const cells = bucket
        .filter((item) => normalizeText(item.str))
        .sort((a, b) => a.x - b.x);
      if (cells.length === 0) continue;
      rows.push({
        page,
        y: cells.reduce((sum, item) => sum + item.y, 0) / cells.length,
        cells,
        values: cells.map((item) => normalizeText(item.str)),
      });
    }
  }

  return rows;
}

function getDominantColumnCount(rows: TableRow[]): number {
  const counts = new Map<number, number>();
  for (const row of rows) {
    if (row.values.length < 2) continue;
    counts.set(row.values.length, (counts.get(row.values.length) ?? 0) + 1);
  }

  return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ?? 0;
}

function getLongestConsistentRun(rows: TableRow[], dominantColumnCount: number): number {
  if (dominantColumnCount < 3) return 0;

  let longest = 0;
  let current = 0;

  for (const row of rows) {
    const matches = Math.abs(row.values.length - dominantColumnCount) <= 1 && row.values.length >= 3;
    if (matches) {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }

  return longest;
}

function detectTable(rows: TableRow[]): TableDetection {
  const tableRows = rows.filter((row) => row.values.length >= 3);
  const dominantColumnCount = getDominantColumnCount(tableRows);
  const consistentRows = getLongestConsistentRun(tableRows, dominantColumnCount);
  const sampleRows = tableRows
    .filter((row) => Math.abs(row.values.length - dominantColumnCount) <= 1 || row.values.length >= 4)
    .slice(0, 3)
    .map((row) => row.values.slice(0, 8));

  return {
    hasTable: consistentRows >= 5 || (dominantColumnCount >= 4 && tableRows.length >= 8),
    consistentRows,
    dominantColumnCount,
    sampleRows,
  };
}

function looksLikePriceValue(value: string): boolean {
  const text = normalizeText(value);
  if (!text) return false;
  if (/[年月日]|20\d{2}/.test(text)) return false;
  const hasCurrencySignal = /[¥￥$]|RMB|CNY|USD|元/i.test(text);
  if (!hasCurrencySignal) {
    const nonNumericRemainder = text.replace(/[0-9.,\s]/g, "");
    if (nonNumericRemainder) return false;
    if (!/\d+\.\d{1,2}/.test(text)) return false;
  }
  if (!hasCurrencySignal && /[°±%×*]|[xX](?=\d)|(?:cm|mm|lm|lumen|ra|pf|pcs|ctn)\b|[WK]\b/i.test(text)) {
    return false;
  }
  if (!hasCurrencySignal && /\d+\s*[-~]\s*\d+/.test(text)) {
    return false;
  }
  if (!PRICE_VALUE_PATTERN.test(text)) return false;

  const numericMatches = text.match(/\d{1,4}(?:,\d{3})*(?:\.\d{1,2})?/g) ?? [];
  if (numericMatches.length === 0) return false;

  return numericMatches.some((match) => {
    const parsed = Number.parseFloat(match.replace(/,/g, ""));
    return Number.isFinite(parsed) && parsed > 0 && parsed < 10000;
  });
}

function detectPriceColumn(rows: TableRow[], table: TableDetection): PriceColumnDetection {
  const tableRows = rows.filter((row) => row.values.length >= 3);
  const headerRows = tableRows.slice(0, Math.min(12, tableRows.length));
  const headerMatchRow = headerRows.find((row) => row.values.some((value) => PRICE_HEADER_PATTERN.test(value)));
  const headerCellIndex = headerMatchRow?.values.findIndex((value) => PRICE_HEADER_PATTERN.test(value)) ?? -1;
  const headerMatch = headerCellIndex >= 0 ? headerMatchRow?.values[headerCellIndex] ?? null : null;

  if (headerMatchRow && headerCellIndex >= 0) {
    const sampleValues = tableRows
      .slice(tableRows.indexOf(headerMatchRow) + 1)
      .map((row) => row.values[headerCellIndex])
      .filter((value): value is string => Boolean(value) && looksLikePriceValue(value))
      .slice(0, 5);

    if (sampleValues.length >= 2) {
      return {
        found: true,
        confidence: "high",
        headerMatch,
        sampleValues,
        columnIndex: headerCellIndex,
      };
    }
  }

  const maxColumns = Math.max(0, ...tableRows.map((row) => row.values.length));
  const columnScores = Array.from({ length: maxColumns }, (_, columnIndex) => {
    const values = tableRows
      .map((row) => row.values[columnIndex])
      .filter((value): value is string => Boolean(value));
    const priceValues = values.filter(looksLikePriceValue);
    const modelLikeValues = values.filter((value) => MODEL_HEADER_PATTERN.test(value));

    return {
      columnIndex,
      priceValues,
      score: priceValues.length - modelLikeValues.length * 2,
    };
  }).sort((a, b) => b.score - a.score || b.priceValues.length - a.priceValues.length);

  const best = columnScores[0];
  if (best && best.priceValues.length >= 4 && best.score > 0) {
    return {
      found: true,
      confidence: table.hasTable ? "medium" : "low",
      headerMatch,
      sampleValues: best.priceValues.slice(0, 5),
      columnIndex: best.columnIndex,
    };
  }

  if (best && best.priceValues.length >= 2) {
    return {
      found: true,
      confidence: "low",
      headerMatch,
      sampleValues: best.priceValues.slice(0, 5),
      columnIndex: best.columnIndex,
    };
  }

  return {
    found: false,
    confidence: "none",
    headerMatch,
    sampleValues: [],
    columnIndex: null,
  };
}

function classify(result: Omit<SpikeResult, "verdict" | "verdictReason">): { verdict: Verdict; reason: string } {
  if (result.error) {
    return { verdict: "skip", reason: `解析失败：${result.error}` };
  }
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
  if (result.table.hasTable && result.priceColumn.found) {
    return { verdict: "manual-review", reason: "有表格结构 + 低置信价格列，需人工确认" };
  }
  if (result.table.hasTable && !result.priceColumn.found) {
    return { verdict: "manual-review", reason: "有表格结构但价格列不明确" };
  }
  if (!result.table.hasTable && result.priceKeywordHits > 0) {
    return { verdict: "manual-review", reason: "有价格关键词但无明确表格结构" };
  }
  return { verdict: "skip", reason: "无表格结构且无价格信号" };
}

function errorResult(file: SpikeFile, error: string, fileExists: boolean, fileSizeKb: number): SpikeResult {
  const base = {
    id: file.id,
    tier: file.tier,
    category: file.category,
    factory: file.factory,
    fileName: path.basename(file.path),
    relativePath: file.path,
    fileSizeKb,
    fileExists,
    totalPages: 0,
    analyzedPages: 0,
    pdfType: "scan" as PdfType,
    totalChars: 0,
    charsPerPage: [],
    priceKeywordHits: 0,
    modelKeywordHits: 0,
    specKeywordHits: 0,
    currencyPatternHits: 0,
    detectedCurrency: null,
    table: {
      hasTable: false,
      consistentRows: 0,
      dominantColumnCount: 0,
      sampleRows: [],
    },
    priceColumn: {
      found: false,
      confidence: "none" as Confidence,
      headerMatch: null,
      sampleValues: [],
      columnIndex: null,
    },
    textSample: "",
    error,
  };
  const verdict = classify(base);

  return {
    ...base,
    verdict: verdict.verdict,
    verdictReason: verdict.reason,
  };
}

async function analyzePdf(file: SpikeFile): Promise<SpikeResult> {
  const absolutePath = path.join(ROOT, file.path);
  const fileExists = existsSync(absolutePath);
  const fileSizeKb = fileExists ? Math.round((statSync(absolutePath).size / 1024) * 10) / 10 : file.sizeKb;

  if (!fileExists) {
    return errorResult(file, "文件不存在", false, fileSizeKb);
  }

  try {
    const pdfBytes = new Uint8Array(readFileSync(absolutePath));
    const task = getDocument({
      data: pdfBytes,
      disableWorker: true,
      useSystemFonts: true,
      stopAtErrors: false,
    });
    const pdf = await task.promise;
    const totalPages = pdf.numPages;
    const maxPages = fileSizeKb > 30_000 ? 2 : Math.min(5, totalPages);
    const textItems: TextItem[] = [];
    const charsPerPage: number[] = [];

    for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      let pageChars = 0;

      for (const rawItem of content.items) {
        const item = rawItem as {
          str?: string;
          transform?: number[];
          width?: number;
          height?: number;
        };
        const value = normalizeText(item.str ?? "");
        if (!value || !item.transform) continue;

        pageChars += value.length;
        textItems.push({
          page: pageNumber,
          str: value,
          x: Number(item.transform[4] ?? 0),
          y: Number(item.transform[5] ?? 0),
          width: Number(item.width ?? 0),
          height: Number(item.height ?? 0),
        });
      }

      charsPerPage.push(pageChars);
    }

    await task.destroy();

    const fullText = textItems.map((item) => item.str).join(" ");
    const rows = groupRows(textItems);
    const table = detectTable(rows);
    const priceColumn = detectPriceColumn(rows, table);
    const base = {
      id: file.id,
      tier: file.tier,
      category: file.category,
      factory: file.factory,
      fileName: path.basename(file.path),
      relativePath: file.path,
      fileSizeKb,
      fileExists,
      totalPages,
      analyzedPages: maxPages,
      pdfType: getPdfType(charsPerPage),
      totalChars: fullText.length,
      charsPerPage,
      priceKeywordHits: countKeywordHits(fullText, PRICE_KEYWORDS),
      modelKeywordHits: countKeywordHits(fullText, MODEL_KEYWORDS),
      specKeywordHits: countKeywordHits(fullText, SPEC_KEYWORDS),
      currencyPatternHits: countPatternHits(fullText),
      detectedCurrency: detectCurrency(fullText),
      table,
      priceColumn,
      textSample: fullText.slice(0, 500),
      error: null,
    };
    const verdict = classify(base);

    return {
      ...base,
      verdict: verdict.verdict,
      verdictReason: verdict.reason,
    };
  } catch (error) {
    return errorResult(file, error instanceof Error ? error.message : String(error), true, fileSizeKb);
  }
}

function csvEscape(value: string | number | boolean | null): string {
  const text = value == null ? "" : String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function writeCsv(results: SpikeResult[]): void {
  const headers = [
    "id",
    "tier",
    "category",
    "factory",
    "file_name",
    "size_kb",
    "exists",
    "pdf_type",
    "pages",
    "analyzed_pages",
    "total_chars",
    "price_keywords",
    "model_keywords",
    "spec_keywords",
    "currency_patterns",
    "currency",
    "has_table",
    "table_rows",
    "table_cols",
    "price_col_found",
    "price_col_confidence",
    "price_col_index",
    "price_samples",
    "verdict",
    "reason",
    "error",
    "relative_path",
  ];

  const rows = results.map((result) =>
    [
      result.id,
      result.tier,
      result.category,
      result.factory,
      result.fileName,
      result.fileSizeKb,
      result.fileExists,
      result.pdfType,
      result.totalPages,
      result.analyzedPages,
      result.totalChars,
      result.priceKeywordHits,
      result.modelKeywordHits,
      result.specKeywordHits,
      result.currencyPatternHits,
      result.detectedCurrency ?? "",
      result.table.hasTable,
      result.table.consistentRows,
      result.table.dominantColumnCount,
      result.priceColumn.found,
      result.priceColumn.confidence,
      result.priceColumn.columnIndex ?? "",
      result.priceColumn.sampleValues.join(" | "),
      result.verdict,
      result.verdictReason,
      result.error ?? "",
      result.relativePath,
    ].map(csvEscape).join(",")
  );

  writeFileSync(CSV_PATH, [headers.join(","), ...rows].join("\n"), "utf8");
}

function formatSampleRows(rows: string[][]): string {
  if (rows.length === 0) return "_No table-like rows detected._";

  const maxCols = Math.min(8, Math.max(...rows.map((row) => row.length)));
  const header = Array.from({ length: maxCols }, (_, index) => `Col ${index + 1}`);
  const divider = header.map(() => "---");
  const body = rows.map((row) =>
    Array.from({ length: maxCols }, (_, index) => (row[index] ?? "").replace(/\|/g, "\\|")).join(" | ")
  );

  return [`| ${header.join(" | ")} |`, `| ${divider.join(" | ")} |`, ...body.map((row) => `| ${row} |`)].join("\n");
}

function writeMarkdown(results: SpikeResult[]): void {
  const now = new Date().toISOString();
  const verdictCounts = new Map<Verdict, number>();
  for (const result of results) {
    verdictCounts.set(result.verdict, (verdictCounts.get(result.verdict) ?? 0) + 1);
  }

  const importable = results.filter((result) => result.verdict === "importable");
  const manualReview = results.filter((result) => result.verdict === "manual-review");
  const skipped = results.filter((result) => result.verdict === "skip");

  const lines: string[] = [
    "# V2.21 — PDF 可解析性 Spike 报告",
    "",
    `Generated: ${now}`,
    `Library: pdfjs-dist ${pdfjsVersion}`,
    `Files analyzed: ${results.length}`,
    "",
    "## Summary",
    "",
    "| Verdict | Count | 说明 |",
    "|---|---:|---|",
    `| importable | ${verdictCounts.get("importable") ?? 0} | 有表格+价格列，可进入 V2.22 候选 |`,
    `| manual-review | ${verdictCounts.get("manual-review") ?? 0} | 有部分信号但需人工确认 |`,
    `| skip | ${verdictCounts.get("skip") ?? 0} | 扫描件/无价格/解析失败/表格不成立 |`,
    "",
    "## Verdict Lists",
    "",
    "### Importable",
    "",
    importable.length
      ? importable.map((result) => `- ${result.id} ${result.category}/${result.factory}: ${result.fileName}`).join("\n")
      : "- None",
    "",
    "### Manual Review",
    "",
    manualReview.length
      ? manualReview.map((result) => `- ${result.id} ${result.category}/${result.factory}: ${result.fileName} — ${result.verdictReason}`).join("\n")
      : "- None",
    "",
    "### Skip",
    "",
    skipped.length
      ? skipped.map((result) => `- ${result.id} ${result.category}/${result.factory}: ${result.fileName} — ${result.verdictReason}`).join("\n")
      : "- None",
    "",
    "## Results by File",
    "",
  ];

  for (const result of results) {
    lines.push(
      `### ${result.id} — ${result.category}/${result.factory}/${result.fileName} (Tier ${result.tier})`,
      "",
      "| 属性 | 值 |",
      "|---|---|",
      `| Relative Path | ${result.relativePath.replace(/\|/g, "\\|")} |`,
      `| File Exists | ${result.fileExists ? "yes" : "no"} |`,
      `| File Size | ${result.fileSizeKb.toLocaleString()} KB |`,
      `| PDF Type | ${result.pdfType} |`,
      `| Pages | ${result.totalPages} total / ${result.analyzedPages} analyzed |`,
      `| Total Chars | ${result.totalChars.toLocaleString()} |`,
      `| Chars Per Page | ${result.charsPerPage.join(", ") || "-"} |`,
      `| Price Keywords | ${result.priceKeywordHits} hits |`,
      `| Model Keywords | ${result.modelKeywordHits} hits |`,
      `| Spec Keywords | ${result.specKeywordHits} hits |`,
      `| Currency Pattern Hits | ${result.currencyPatternHits} hits |`,
      `| Currency | ${result.detectedCurrency ?? "none"} |`,
      `| Table Detected | ${result.table.hasTable ? "yes" : "no"} (${result.table.consistentRows} consistent rows, ${result.table.dominantColumnCount} cols) |`,
      `| Price Column | ${result.priceColumn.found ? "yes" : "no"} (${result.priceColumn.confidence}${result.priceColumn.columnIndex != null ? `, col ${result.priceColumn.columnIndex + 1}` : ""}) |`,
      `| Price Samples | ${result.priceColumn.sampleValues.join(", ") || "-"} |`,
      `| Error | ${result.error ?? "-"} |`,
      `| **Verdict** | **${result.verdict}** |`,
      `| Reason | ${result.verdictReason.replace(/\|/g, "\\|")} |`,
      "",
      "**Sample Rows:**",
      "",
      formatSampleRows(result.table.sampleRows),
      "",
      "**Text Sample (first 500 chars):**",
      "",
      "```text",
      result.textSample || "(empty)",
      "```",
      "",
      "---",
      ""
    );
  }

  lines.push(
    "## Conclusions",
    "",
    `- Importable files: ${importable.length}.`,
    `- Manual-review files: ${manualReview.length}.`,
    `- Skipped files: ${skipped.length}.`,
    "- V2.22 should only target PDFs that are text PDFs with table rows and an identifiable price column.",
    "- Customer quotation PDFs with USD/mixed currency should not be imported as supplier purchase prices without manual confirmation.",
    "- Scanned PDFs and catalog-style PDFs remain out of scope unless a future OCR/manual workflow is explicitly approved.",
    "",
    "## Output Files",
    "",
    `- CSV details: ${CSV_PATH}`,
    `- Script: ${fileURLToPath(import.meta.url)}`,
    ""
  );

  writeFileSync(REPORT_PATH, lines.join("\n"), "utf8");
}

async function main(): Promise<void> {
  if (!existsSync(ROOT)) {
    throw new Error(`Drive root not mounted: ${ROOT}`);
  }

  mkdirSync(path.dirname(REPORT_PATH), { recursive: true });

  const results: SpikeResult[] = [];
  for (const file of SPIKE_FILES) {
    console.log(`Analyzing ${file.id}: ${file.path}`);
    results.push(await analyzePdf(file));
  }

  writeCsv(results);
  writeMarkdown(results);

  const summary = results.reduce<Record<Verdict, number>>(
    (counts, result) => {
      counts[result.verdict] += 1;
      return counts;
    },
    { importable: 0, "manual-review": 0, skip: 0 }
  );

  console.log({
    files: results.length,
    ...summary,
    reportPath: REPORT_PATH,
    csvPath: CSV_PATH,
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
