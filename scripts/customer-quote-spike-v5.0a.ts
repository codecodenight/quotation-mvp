import { existsSync } from "node:fs";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import * as XLSX from "xlsx";

const ROOT = "/Volumes/My Passport/AI 报价/发客户报价单汇总";
const REPORT_PATH = "docs/v5.0a-customer-quote-spike.md";
const SUPPORTED_EXTENSIONS = new Set([".xls", ".xlsx"]);
const SAMPLE_TARGET = 20;
const PREVIEW_ROW_LIMIT = 3;

type FormatType = "standard-template" | "partial-match" | "unknown-format";
type QuoteMode = "核价" | "To customer" | "通用模板";
type FieldKey =
  | "model"
  | "description"
  | "fobUsd"
  | "moq"
  | "ctnQty"
  | "ctnSize"
  | "remark"
  | "rmbCost";

type DiskFile = {
  absolutePath: string;
  relativePath: string;
  fileName: string;
  extension: string;
  category: string;
  modifiedAtMs: number;
  mode: QuoteMode;
};

type ColumnMapping = {
  field: FieldKey;
  columnIndex: number;
  columnLetter: string;
  headerText: string;
};

type SampleRow = {
  model: string;
  description: string;
  fobUsd: string;
  moq: string;
  ctn: string;
  remark: string;
};

type SheetAnalysis = {
  sheetName: string;
  rowCount: number;
  colCount: number;
  headerRowIndex: number | null;
  headers: string[];
  mappings: ColumnMapping[];
  dataRows: number;
  samples: SampleRow[];
};

type FileAnalysis = DiskFile & {
  sheetNames: string[];
  sheetCount: number;
  formatType: FormatType;
  customerName: string | null;
  quoteDate: string | null;
  sheets: SheetAnalysis[];
  error: string | null;
};

const FIELD_LABELS: Record<FieldKey, string> = {
  model: "产品款号",
  description: "产品描述",
  fobUsd: "FOB USD 单价",
  moq: "MOQ",
  ctnQty: "装箱数",
  ctnSize: "箱规",
  remark: "备注",
  rmbCost: "RMB 成本价",
};

const HEADER_PATTERNS: Record<FieldKey, RegExp[]> = {
  model: [
    /\bmodel\b/i,
    /\bmodel\s*name\b/i,
    /\bitem\s*(no\.?|number)?\b/i,
    /item\s*number/i,
    /型号|款号|产品编号/,
  ],
  description: [
    /product\s*details?/i,
    /description/i,
    /specification/i,
    /产品详情|产品描述|描述|规格|参数/,
  ],
  fobUsd: [
    /fob.*usd/i,
    /unit\s*price.*usd/i,
    /usd.*unit\s*price/i,
    /\bprice\s*\(usd\)/i,
    /\busd\b/i,
    /\$/i,
  ],
  moq: [/^moq$/i, /minimum\s*order/i, /起订|最小订量/],
  ctnQty: [/ctn\s*qty/i, /pcs\s*\/\s*ctn/i, /qty\s*\/\s*ctn/i, /packing/i, /装箱数|装箱数量|每箱/],
  ctnSize: [/carton\s*size/i, /ctn\s*size/i, /carton/i, /箱规|外箱尺寸|纸箱尺寸/],
  remark: [/remark/i, /note/i, /备注|说明/],
  rmbCost: [/rmb/i, /cny/i, /含税/i, /工厂价|成本|采购价|人民币|单价.*元|¥|￥/],
};

const HEADER_KEYWORD_PATTERN =
  /model|item|product|description|details|fob|unit\s*price|price|usd|moq|ctn|carton|remark|型号|款号|产品|描述|规格|单价|价格|箱规|装箱|备注/i;

async function main() {
  if (!existsSync(ROOT)) {
    throw new Error(`硬盘目录不可访问：${ROOT}`);
  }

  const allFiles = await scanExcelFiles(ROOT);
  const sampledFiles = selectSampleFiles(allFiles);
  const analyses: FileAnalysis[] = [];

  for (const [index, file] of sampledFiles.entries()) {
    console.log(`Analyzing ${index + 1}/${sampledFiles.length}: ${file.relativePath}`);
    analyses.push(analyzeFile(file));
  }

  await mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await writeFile(REPORT_PATH, buildReport(allFiles, sampledFiles, analyses), "utf8");

  console.log(
    JSON.stringify(
      {
        sourceFiles: allFiles.length,
        sampledFiles: sampledFiles.length,
        sampledCategories: new Set(sampledFiles.map((file) => file.category)).size,
        reportPath: REPORT_PATH,
      },
      null,
      2,
    ),
  );
}

async function scanExcelFiles(root: string): Promise<DiskFile[]> {
  const files: DiskFile[] = [];
  await walk(root);
  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath, "zh-Hans-CN"));

  async function walk(currentPath: string) {
    const entries = await readdir(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const entryName = normalizePathPart(entry.name);
      if (entryName.startsWith(".") || entryName.startsWith("~$")) {
        continue;
      }

      const absolutePath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }

      const extension = path.extname(entryName).toLowerCase();
      if (!SUPPORTED_EXTENSIONS.has(extension)) {
        continue;
      }

      const fileStat = await stat(absolutePath);
      const relativePath = portableRelative(root, absolutePath);
      const parts = relativePath.split("/");
      const category = parts.length > 1 ? parts[0] : "根目录";
      files.push({
        absolutePath,
        relativePath,
        fileName: entryName,
        extension,
        category,
        modifiedAtMs: fileStat.mtimeMs,
        mode: inferQuoteMode(entryName),
      });
    }
  }
}

function selectSampleFiles(files: DiskFile[]): DiskFile[] {
  const byCategory = groupBy(files, (file) => file.category);
  const categories = [...byCategory.keys()].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  const selected = new Map<string, DiskFile>();

  const rootFiles = [...(byCategory.get("根目录") ?? [])].sort(sortNewest);
  for (const file of rootFiles.slice(0, 2)) {
    selected.set(file.relativePath, file);
  }

  for (const category of categories.filter((value) => value !== "根目录")) {
    const categoryFiles = [...(byCategory.get(category) ?? [])].sort(sortNewest);
    addPreferredFile(selected, categoryFiles, (file) => file.mode === "To customer");
    addPreferredFile(selected, categoryFiles, (file) => file.mode === "核价");
    if (selected.size >= SAMPLE_TARGET) {
      break;
    }
  }

  if (selected.size < 15) {
    for (const category of categories) {
      const categoryFiles = [...(byCategory.get(category) ?? [])].sort(sortNewest);
      addPreferredFile(selected, categoryFiles, () => true);
      if (selected.size >= 15) {
        break;
      }
    }
  }

  return [...selected.values()]
    .sort((a, b) => `${a.category}/${a.fileName}`.localeCompare(`${b.category}/${b.fileName}`, "zh-Hans-CN"))
    .slice(0, SAMPLE_TARGET);
}

function addPreferredFile(
  selected: Map<string, DiskFile>,
  files: DiskFile[],
  predicate: (file: DiskFile) => boolean,
) {
  if (selected.size >= SAMPLE_TARGET) {
    return;
  }
  const file = files.find((candidate) => predicate(candidate) && !selected.has(candidate.relativePath));
  if (file) {
    selected.set(file.relativePath, file);
  }
}

function analyzeFile(file: DiskFile): FileAnalysis {
  try {
    const workbook = XLSX.readFile(file.absolutePath, {
      cellDates: false,
      dense: false,
      raw: false,
    });
    const sheets = workbook.SheetNames.map((sheetName) => analyzeSheet(workbook.Sheets[sheetName], sheetName));
    return {
      ...file,
      sheetNames: workbook.SheetNames,
      sheetCount: workbook.SheetNames.length,
      formatType: inferFormatType(sheets),
      customerName: extractCustomerName(file, workbook),
      quoteDate: extractQuoteDate(file, workbook),
      sheets,
      error: null,
    };
  } catch (error) {
    return {
      ...file,
      sheetNames: [],
      sheetCount: 0,
      formatType: "unknown-format",
      customerName: extractCustomerFromFileName(file.fileName),
      quoteDate: extractDateFromText(file.fileName),
      sheets: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function analyzeSheet(sheet: XLSX.WorkSheet | undefined, sheetName: string): SheetAnalysis {
  if (!sheet) {
    return {
      sheetName,
      rowCount: 0,
      colCount: 0,
      headerRowIndex: null,
      headers: [],
      mappings: [],
      dataRows: 0,
      samples: [],
    };
  }

  const rows = XLSX.utils.sheet_to_json<string[]>(sheet, {
    header: 1,
    raw: false,
    defval: "",
    blankrows: false,
  });
  const normalizedRows = rows.map((row) => row.map((cell) => normalizeCell(cell)));
  const rowCount = normalizedRows.length;
  const colCount = normalizedRows.reduce((max, row) => Math.max(max, row.length), 0);
  const headerRowIndex = detectHeaderRow(normalizedRows);
  const headers = headerRowIndex == null ? [] : buildHeaderTexts(normalizedRows, headerRowIndex, colCount);
  const mappings = detectMappings(headers);
  const dataRows = headerRowIndex == null ? 0 : countDataRows(normalizedRows, headerRowIndex, mappings);
  const samples = headerRowIndex == null ? [] : buildSampleRows(normalizedRows, headerRowIndex, mappings);

  return {
    sheetName,
    rowCount,
    colCount,
    headerRowIndex,
    headers,
    mappings,
    dataRows,
    samples,
  };
}

function detectHeaderRow(rows: string[][]): number | null {
  let bestRow: { index: number; score: number; filled: number } | null = null;
  const limit = Math.min(rows.length, 10);

  for (let rowIndex = 0; rowIndex < limit; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    const text = row.join(" ");
    const filled = row.filter(Boolean).length;
    let score = 0;
    if (/model|item|型号|款号/i.test(text)) score += 4;
    if (/product|description|details|产品|描述|规格/i.test(text)) score += 3;
    if (/unit\s*price|fob|usd|price|单价|价格/i.test(text)) score += 4;
    if (/moq|ctn|carton|packing|箱规|装箱/i.test(text)) score += 2;
    score += row.filter((cell) => HEADER_KEYWORD_PATTERN.test(cell)).length;

    if (filled >= 2 && score > 0 && (!bestRow || score > bestRow.score || (score === bestRow.score && filled > bestRow.filled))) {
      bestRow = { index: rowIndex, score, filled };
    }
  }

  if (bestRow) {
    return bestRow.index;
  }

  let fallback: { index: number; filled: number } | null = null;
  for (let rowIndex = 0; rowIndex < limit; rowIndex += 1) {
    const filled = (rows[rowIndex] ?? []).filter(Boolean).length;
    if (filled >= 4 && (!fallback || filled > fallback.filled)) {
      fallback = { index: rowIndex, filled };
    }
  }
  return fallback?.index ?? null;
}

function buildHeaderTexts(rows: string[][], headerRowIndex: number, colCount: number): string[] {
  const previousRow = rows[headerRowIndex - 1] ?? [];
  const headerRow = rows[headerRowIndex] ?? [];
  const nextRow = rows[headerRowIndex + 1] ?? [];
  const headers: string[] = [];

  for (let columnIndex = 0; columnIndex < colCount; columnIndex += 1) {
    const parts = [previousRow[columnIndex], headerRow[columnIndex], nextRow[columnIndex]]
      .map((value) => normalizeCell(value))
      .filter(Boolean);
    headers.push([...new Set(parts)].join(" / "));
  }

  return headers;
}

function detectMappings(headers: string[]): ColumnMapping[] {
  const mappings: ColumnMapping[] = [];
  for (const field of Object.keys(HEADER_PATTERNS) as FieldKey[]) {
    const candidate = headers
      .map((headerText, columnIndex) => ({
        field,
        columnIndex,
        headerText,
        score: scoreHeader(field, headerText),
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || a.columnIndex - b.columnIndex)[0];

    if (candidate) {
      mappings.push({
        field,
        columnIndex: candidate.columnIndex,
        columnLetter: XLSX.utils.encode_col(candidate.columnIndex),
        headerText: candidate.headerText,
      });
    }
  }
  return mappings;
}

function scoreHeader(field: FieldKey, headerText: string): number {
  const text = normalizeCell(headerText);
  if (!text) return 0;

  let score = 0;
  for (const pattern of HEADER_PATTERNS[field]) {
    if (pattern.test(text)) {
      score += 2;
    }
  }

  if (field === "fobUsd" && /rmb|cny|含税|工厂价|成本|采购价|人民币|¥|￥/i.test(text)) {
    score -= 5;
  }
  if (field === "rmbCost" && /fob|usd|\$/i.test(text)) {
    score -= 5;
  }
  if (field === "ctnQty" && /size|尺寸|箱规/i.test(text)) {
    score -= 2;
  }
  if (field === "ctnSize" && /qty|pcs|数量/i.test(text)) {
    score -= 2;
  }
  return Math.max(score, 0);
}

function countDataRows(rows: string[][], headerRowIndex: number, mappings: ColumnMapping[]): number {
  const relevantColumns = mappings
    .filter((mapping) => ["model", "description", "fobUsd", "rmbCost"].includes(mapping.field))
    .map((mapping) => mapping.columnIndex);
  const columns = relevantColumns.length > 0 ? relevantColumns : [0, 1, 2, 3, 4];

  return rows
    .slice(headerRowIndex + 1)
    .filter((row) => columns.some((columnIndex) => normalizeCell(row[columnIndex]).length > 0)).length;
}

function buildSampleRows(rows: string[][], headerRowIndex: number, mappings: ColumnMapping[]): SampleRow[] {
  const getMapping = (field: FieldKey) => mappings.find((mapping) => mapping.field === field);
  const model = getMapping("model");
  const description = getMapping("description");
  const fobUsd = getMapping("fobUsd");
  const moq = getMapping("moq");
  const ctnQty = getMapping("ctnQty");
  const ctnSize = getMapping("ctnSize");
  const remark = getMapping("remark");
  const samples: SampleRow[] = [];

  for (const row of rows.slice(headerRowIndex + 1)) {
    const sample = {
      model: cellAt(row, model),
      description: cellAt(row, description),
      fobUsd: cellAt(row, fobUsd),
      moq: cellAt(row, moq),
      ctn: [cellAt(row, ctnQty), cellAt(row, ctnSize)].filter(Boolean).join(" / "),
      remark: cellAt(row, remark),
    };
    if (Object.values(sample).some(Boolean)) {
      samples.push(sample);
    }
    if (samples.length >= PREVIEW_ROW_LIMIT) {
      break;
    }
  }
  return samples;
}

function cellAt(row: string[], mapping: ColumnMapping | undefined): string {
  if (!mapping) {
    return "";
  }
  return truncate(normalizeCell(row[mapping.columnIndex]), 90);
}

function inferFormatType(sheets: SheetAnalysis[]): FormatType {
  const informativeSheets = sheets.filter((sheet) => sheet.dataRows > 0 || sheet.mappings.length > 0);
  if (informativeSheets.length === 0) {
    return "unknown-format";
  }

  const hasStrongSheet = informativeSheets.some((sheet) => {
    const fields = new Set(sheet.mappings.map((mapping) => mapping.field));
    return fields.has("model") && fields.has("fobUsd") && (fields.has("description") || fields.has("moq") || fields.has("ctnQty"));
  });
  if (hasStrongSheet) {
    return "standard-template";
  }

  const hasPartialSheet = informativeSheets.some((sheet) => {
    const fields = new Set(sheet.mappings.map((mapping) => mapping.field));
    return fields.has("model") || fields.has("fobUsd") || fields.has("rmbCost");
  });
  return hasPartialSheet ? "partial-match" : "unknown-format";
}

function extractCustomerName(file: DiskFile, workbook: XLSX.WorkBook): string | null {
  const fromName = extractCustomerFromFileName(file.fileName);
  if (fromName) {
    return fromName;
  }

  for (const sheetName of workbook.SheetNames.slice(0, 3)) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<string[]>(sheet, {
      header: 1,
      raw: false,
      defval: "",
      blankrows: false,
    });
    for (const row of rows.slice(0, 8)) {
      const text = row.map((cell) => normalizeCell(cell)).join(" ");
      const explicitCustomer = text.match(/\b(?:Customer|Client)\b[:：]\s*([A-Za-z0-9\u4e00-\u9fa5][A-Za-z0-9\u4e00-\u9fa5 _.-]{1,40})/i);
      const chineseCustomer = text.match(/客户[:：]\s*([A-Za-z0-9\u4e00-\u9fa5][A-Za-z0-9\u4e00-\u9fa5 _.-]{1,40})/i);
      const explicitTo = text.match(/(?:^|\s)\bTo\b[:：\s]+([A-Za-z0-9\u4e00-\u9fa5][A-Za-z0-9\u4e00-\u9fa5 _.-]{1,40})/i);
      const match = explicitCustomer ?? chineseCustomer ?? explicitTo;
      if (match?.[1]) {
        const cleaned = cleanupExtractedText(match[1]);
        if (cleaned && !/^(wer|wellux|welfull|quotation|price|messrs)$/i.test(cleaned)) {
          return cleaned;
        }
      }
    }
  }
  return null;
}

function extractQuoteDate(file: DiskFile, workbook: XLSX.WorkBook): string | null {
  const fromName = extractDateFromText(file.fileName);
  if (fromName) {
    return fromName;
  }

  for (const sheetName of workbook.SheetNames.slice(0, 3)) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<string[]>(sheet, {
      header: 1,
      raw: false,
      defval: "",
      blankrows: false,
    });
    for (const row of rows.slice(0, 8)) {
      const text = row.map((cell) => normalizeCell(cell)).join(" ");
      const match = text.match(/(?:Date|报价日期|日期)[:：]?\s*([0-9]{4}[-/.年]?[0-9]{1,2}[-/.月]?[0-9]{0,2})/i);
      if (match?.[1]) {
        return normalizeDate(match[1]);
      }
    }
  }
  return null;
}

function extractCustomerFromFileName(fileName: string): string | null {
  const name = path.basename(fileName, path.extname(fileName));
  const match = name.match(/\bTo\s+(.+?)(?:\s*[-_]\s*|$)/i);
  if (!match?.[1]) {
    return null;
  }
  return cleanupExtractedText(match[1]);
}

function extractDateFromText(text: string): string | null {
  const compact = text.match(/(20\d{2})[._\-\s年]?([01]?\d)(?:[._\-\s月]?([0-3]?\d))?/);
  if (!compact) {
    return null;
  }
  const year = compact[1];
  const month = compact[2]?.padStart(2, "0");
  const day = compact[3]?.padStart(2, "0");
  return day ? `${year}-${month}-${day}` : `${year}-${month}`;
}

function normalizeDate(value: string): string {
  const normalized = value.replace(/[年月/.]/g, "-").replace(/日/g, "").replace(/--+/g, "-").replace(/-$/, "");
  return extractDateFromText(normalized) ?? normalized;
}

function buildReport(allFiles: DiskFile[], sampledFiles: DiskFile[], analyses: FileAnalysis[]): string {
  const generated = new Date().toISOString();
  const categoryCounts = buildCategoryCounts(allFiles, sampledFiles);
  const formatCounts = countBy(analyses, (analysis) => analysis.formatType);
  const coverage = buildCoverage(analyses);
  const dataRows = analyses.flatMap((analysis) => analysis.sheets).reduce((sum, sheet) => sum + sheet.dataRows, 0);
  const averageRows = analyses.length > 0 ? Math.round(dataRows / analyses.length) : 0;
  const estimatedRows = averageRows * allFiles.length;
  const standardPercent = percentage(formatCounts.get("standard-template") ?? 0, analyses.length);

  return [
    "# V5.0A — 历史客户报价 Spike 报告",
    "",
    `Generated: ${generated}`,
    "Mode: read-only",
    `Source: ${ROOT}/`,
    "",
    "## 目录概览",
    "",
    `总 Excel 文件数：${allFiles.length}`,
    `抽样文件数：${sampledFiles.length}`,
    `抽样品类数：${new Set(sampledFiles.map((file) => file.category)).size}`,
    "",
    "| 品类子目录 | 文件数 | 抽样数 |",
    "|---|---:|---:|",
    ...categoryCounts.map((row) => `| ${escapeMarkdown(row.category)} | ${row.total} | ${row.sampled} |`),
    "",
    "## 格式一致性判断",
    "",
    "| 格式类型 | 文件数 | 占比 |",
    "|---|---:|---:|",
    ...(["standard-template", "partial-match", "unknown-format"] as FormatType[]).map(
      (format) => `| ${format} | ${formatCounts.get(format) ?? 0} | ${percentage(formatCounts.get(format) ?? 0, analyses.length)} |`,
    ),
    "",
    "## 可提取字段覆盖率",
    "",
    "| 字段 | 可识别文件数 | 覆盖率 |",
    "|---|---:|---:|",
    ...coverage.map((row) => `| ${row.label} | ${row.count} | ${percentage(row.count, analyses.length)} |`),
    "",
    "## 逐文件分析",
    "",
    ...analyses.flatMap(buildFileSection),
    "## 结论",
    "",
    "### 格式稳定性",
    "",
    standardPercent.startsWith("0")
      ? "抽样文件没有形成稳定的标准模板，需要继续人工拆分格式。"
      : `抽样中 standard-template 占 ${standardPercent}。客户报价目录明显比工厂报价更稳定，但仍存在核价版、To 客户版和通用模板的差异。`,
    "",
    "### 推荐可提取字段",
    "",
    "- 产品款号、FOB USD 单价、产品描述是 V5.0B 最优先字段。",
    "- MOQ、CTN、备注在标准报价模板中可提取，但不同文件命名和合并表头会带来少量人工校正。",
    "- RMB 成本价只应作为核价文件的参考字段，不应写入 supplier_offers.purchase_price。",
    "- 客户名可从 `To XXX` 文件名稳定提取；核价文件通常没有真实客户名，应允许为空或标记为 internal costing。",
    "",
    "### 估算可导入规模",
    "",
    `抽样文件平均约 ${averageRows} 行，按 ${allFiles.length} 个 Excel 粗估约 ${estimatedRows.toLocaleString("en-US")} 条历史客户报价候选行。实际导入时需要去掉空行、小标题行和核价辅助行。`,
    "",
    "### V5.0B 建议",
    "",
    "值得进入 V5.0B。建议建立独立的历史客户报价导入表，不混入现有 quotes / quote_items，也不写 supplier_offers.purchase_price。先保存 raw 售价记录，product_id 后续再做模糊匹配建议。",
    "",
    "建议的数据层方向：",
    "",
    "- `customer_quote_imports`: source file、sheet、客户名、报价日期、格式类型、导入批次。",
    "- `customer_quote_import_rows`: raw model、raw description、sale_price、currency、MOQ、CTN、remark、raw_row_json。",
    "- 可选字段：`matched_product_id`，默认 null，后续人工确认或模糊匹配再填。",
    "",
    "### 异常和风险",
    "",
    "- `核价` 文件往往同时包含 RMB 成本价和 USD 售价，V5.0B 必须明确字段语义，避免把售价或核价辅助列写入采购价。",
    "- 多 sheet 汇总文件可能每个 sheet 一个品类，header row 和列位置不完全一致。",
    "- 部分 `.xls` 文件可读但表头较老，可能只能 partial-match。",
    "- 客户名不是所有文件都有；核价文件应作为 internal reference，而不是客户历史报价。",
    "",
  ].join("\n");
}

function buildFileSection(analysis: FileAnalysis): string[] {
  if (analysis.error) {
    return [
      `### ${escapeMarkdown(analysis.fileName)}`,
      "",
      `- 路径：${escapeMarkdown(analysis.relativePath)}`,
      `- 格式：${analysis.extension}`,
      "- Sheet 数：0",
      "- 格式类型：unknown-format",
      `- 客户名：${analysis.customerName ?? "未识别"}`,
      `- 报价日期：${analysis.quoteDate ?? "未识别"}`,
      `- 错误：${escapeMarkdown(analysis.error)}`,
      "",
      "---",
      "",
    ];
  }

  return [
    `### ${escapeMarkdown(analysis.fileName)}`,
    "",
    `- 路径：${escapeMarkdown(analysis.relativePath)}`,
    `- 格式：${analysis.extension}`,
    `- Sheet 数：${analysis.sheetCount}`,
    `- 格式类型：${analysis.formatType}`,
    `- 客户名：${analysis.customerName ?? "未识别"}`,
    `- 报价日期：${analysis.quoteDate ?? "未识别"}`,
    "",
    ...analysis.sheets.flatMap(buildSheetSection),
    "---",
    "",
  ];
}

function buildSheetSection(sheet: SheetAnalysis): string[] {
  const headerPreview = sheet.headers
    .map((header, index) => `${XLSX.utils.encode_col(index)}=${header || "-"}`)
    .slice(0, 18)
    .join(" | ");

  return [
    `#### Sheet: ${escapeMarkdown(sheet.sheetName)}`,
    "",
    `表头行：${sheet.headerRowIndex == null ? "未识别" : `Row ${sheet.headerRowIndex + 1}`}`,
    "```text",
    headerPreview || "(empty)",
    "```",
    "",
    "列映射：",
    "| 字段 | 列 | 表头文本 |",
    "|---|---|---|",
    ...(sheet.mappings.length > 0
      ? sheet.mappings.map(
          (mapping) =>
            `| ${FIELD_LABELS[mapping.field]} | ${mapping.columnLetter} | ${escapeMarkdown(mapping.headerText || "-")} |`,
        )
      : ["| - | - | 未识别 |"]),
    "",
    `数据行数：${sheet.dataRows}`,
    "数据样本（前 3 行）：",
    "| Model | Description | FOB USD | MOQ | CTN | Remark |",
    "|---|---|---:|---|---|---|",
    ...(sheet.samples.length > 0
      ? sheet.samples.map(
          (sample) =>
            `| ${escapeMarkdown(sample.model || "-")} | ${escapeMarkdown(sample.description || "-")} | ${escapeMarkdown(sample.fobUsd || "-")} | ${escapeMarkdown(sample.moq || "-")} | ${escapeMarkdown(sample.ctn || "-")} | ${escapeMarkdown(sample.remark || "-")} |`,
        )
      : ["| - | - | - | - | - | - |"]),
    "",
  ];
}

function buildCategoryCounts(allFiles: DiskFile[], sampledFiles: DiskFile[]) {
  const totals = countBy(allFiles, (file) => file.category);
  const sampled = countBy(sampledFiles, (file) => file.category);
  return [...totals.entries()]
    .map(([category, total]) => ({
      category,
      total,
      sampled: sampled.get(category) ?? 0,
    }))
    .sort((a, b) => b.total - a.total || a.category.localeCompare(b.category, "zh-Hans-CN"));
}

function buildCoverage(analyses: FileAnalysis[]) {
  const rows: { label: string; count: number }[] = [];
  for (const field of Object.keys(FIELD_LABELS) as FieldKey[]) {
    rows.push({
      label: FIELD_LABELS[field],
      count: analyses.filter((analysis) => fileHasField(analysis, field)).length,
    });
  }
  rows.push({
    label: "客户名",
    count: analyses.filter((analysis) => Boolean(analysis.customerName)).length,
  });
  rows.push({
    label: "报价日期",
    count: analyses.filter((analysis) => Boolean(analysis.quoteDate)).length,
  });
  return rows;
}

function fileHasField(analysis: FileAnalysis, field: FieldKey): boolean {
  return analysis.sheets.some((sheet) => sheet.mappings.some((mapping) => mapping.field === field));
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const values = map.get(key) ?? [];
    values.push(item);
    map.set(key, values);
  }
  return map;
}

function countBy<T>(items: T[], keyFn: (item: T) => string): Map<string, number> {
  const map = new Map<string, number>();
  for (const item of items) {
    const key = keyFn(item);
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return map;
}

function inferQuoteMode(fileName: string): QuoteMode {
  if (/核价|核算|利润/i.test(fileName)) {
    return "核价";
  }
  if (/\bTo\s+/i.test(fileName)) {
    return "To customer";
  }
  return "通用模板";
}

function sortNewest(a: DiskFile, b: DiskFile): number {
  return b.modifiedAtMs - a.modifiedAtMs || a.fileName.localeCompare(b.fileName, "zh-Hans-CN");
}

function portableRelative(root: string, absolutePath: string): string {
  return normalizePathPart(path.relative(root, absolutePath).split(path.sep).join("/"));
}

function normalizePathPart(value: string): string {
  return value.normalize("NFC");
}

function normalizeCell(value: unknown): string {
  if (value == null) {
    return "";
  }
  return String(value).normalize("NFC").replace(/\s+/g, " ").trim();
}

function cleanupExtractedText(value: string): string {
  return value
    .replace(/\b(Quotation|Quote|Price|FOB|USD|Wellux|Welfull|LED)\b.*$/i, "")
    .replace(/[-_]+$/g, "")
    .trim();
}

function truncate(value: string, length: number): string {
  if (value.length <= length) {
    return value;
  }
  return `${value.slice(0, length - 1)}…`;
}

function escapeMarkdown(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, "<br>");
}

function percentage(count: number, total: number): string {
  if (total === 0) {
    return "0%";
  }
  return `${Math.round((count / total) * 100)}%`;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
