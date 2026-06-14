import { existsSync } from "node:fs";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { PrismaClient } from "@prisma/client";
import * as XLSX from "xlsx";

const ROOT = "/Volumes/My Passport/AI 报价/发客户报价单汇总";
const REPORT_PATH = "docs/v5.0b-import-report.md";
const SUPPORTED_EXTENSIONS = new Set([".xls", ".xlsx"]);

const prisma = new PrismaClient();

type Mode = "dry-run" | "apply";
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

type QuoteRow = {
  rowNumber: number;
  rawModel: string | null;
  rawDescription: string | null;
  salePriceUsd: number | null;
  salePriceText: string | null;
  rmbCost: number | null;
  moq: string | null;
  ctnQty: string | null;
  ctnSize: string | null;
  remark: string | null;
  rawRowJson: string;
};

type SheetImport = {
  sheetName: string;
  rowCount: number;
  colCount: number;
  headerRowIndex: number | null;
  headerSnapshot: string | null;
  mappings: ColumnMapping[];
  formatType: FormatType;
  rows: QuoteRow[];
};

type FileImport = DiskFile & {
  customerName: string | null;
  quoteDate: string | null;
  sheets: SheetImport[];
  error: string | null;
};

type CategorySummary = {
  category: string;
  files: Set<string>;
  sheets: number;
  rows: number;
  rowsWithFob: number;
  rowsWithModel: number;
  standard: number;
  partial: number;
  unknown: number;
};

type ApplyStats = {
  insertedFiles: number;
  skippedFiles: number;
  insertedRows: number;
  skippedRows: number;
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
  ctnSize: [/carton\s*size/i, /ctn\s*size/i, /l\*w\*h/i, /carton/i, /箱规|外箱尺寸|纸箱尺寸/],
  remark: [/remark/i, /note/i, /备注|说明/],
  rmbCost: [/rmb/i, /cny/i, /含税/i, /工厂价|成本|采购价|人民币|单价.*元|¥|￥/],
};

const HEADER_KEYWORD_PATTERN =
  /model|item|product|description|details|fob|unit\s*price|price|usd|moq|ctn|carton|remark|型号|款号|产品|描述|规格|单价|价格|箱规|装箱|备注/i;

async function main() {
  const mode = parseMode();
  if (!existsSync(ROOT)) {
    throw new Error(`硬盘目录不可访问：${ROOT}`);
  }

  const files = await scanExcelFiles(ROOT);
  const imports: FileImport[] = [];
  for (const [index, file] of files.entries()) {
    if ((index + 1) % 25 === 0 || index === 0) {
      console.log(`Parsing ${index + 1}/${files.length}: ${file.relativePath}`);
    }
    imports.push(analyzeFile(file));
  }

  if (mode === "dry-run") {
    printDryRun(imports);
    return;
  }

  const applyStats = await applyImports(imports);
  await mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await writeFile(REPORT_PATH, buildApplyReport(imports, applyStats), "utf8");
  console.log(`Wrote ${REPORT_PATH}`);
  console.log(
    JSON.stringify(
      {
        files: imports.length,
        insertedFiles: applyStats.insertedFiles,
        skippedFiles: applyStats.skippedFiles,
        insertedRows: applyStats.insertedRows,
        skippedRows: applyStats.skippedRows,
      },
      null,
      2,
    ),
  );
}

function parseMode(): Mode {
  const args = new Set(process.argv.slice(2));
  if (args.has("--apply")) return "apply";
  if (args.has("--dry-run")) return "dry-run";
  throw new Error("Usage: npx tsx scripts/customer-quote-import-v5.0b.ts --dry-run|--apply");
}

async function scanExcelFiles(root: string): Promise<DiskFile[]> {
  const files: DiskFile[] = [];
  await walk(root);
  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath, "zh-Hans-CN"));

  async function walk(currentPath: string) {
    const entries = await readdir(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const entryName = normalizePathPart(entry.name);
      if (entryName.startsWith(".") || entryName.startsWith("~$")) continue;

      const absolutePath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;

      const extension = path.extname(entryName).toLowerCase();
      if (!SUPPORTED_EXTENSIONS.has(extension)) continue;

      const fileStat = await stat(absolutePath);
      const relativePath = portableRelative(root, absolutePath);
      const parts = relativePath.split("/");
      files.push({
        absolutePath,
        relativePath,
        fileName: entryName,
        extension,
        category: parts.length > 1 ? parts[0] : "根目录",
        modifiedAtMs: fileStat.mtimeMs,
        mode: inferQuoteMode(entryName),
      });
    }
  }
}

function analyzeFile(file: DiskFile): FileImport {
  try {
    const workbook = XLSX.readFile(file.absolutePath, {
      cellDates: false,
      dense: false,
      raw: false,
    });
    const sheets = workbook.SheetNames.map((sheetName) => analyzeSheet(workbook.Sheets[sheetName], sheetName));
    return {
      ...file,
      customerName: extractCustomerName(file, workbook),
      quoteDate: extractQuoteDate(file, workbook),
      sheets,
      error: null,
    };
  } catch (error) {
    return {
      ...file,
      customerName: extractCustomerFromFileName(file.fileName),
      quoteDate: extractDateFromText(file.fileName),
      sheets: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function analyzeSheet(sheet: XLSX.WorkSheet | undefined, sheetName: string): SheetImport {
  if (!sheet) {
    return emptySheet(sheetName);
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
  const quoteRows = headerRowIndex == null ? [] : buildQuoteRows(normalizedRows, headerRowIndex, headers, mappings);

  return {
    sheetName,
    rowCount,
    colCount,
    headerRowIndex,
    headerSnapshot: buildHeaderSnapshot(headers),
    mappings,
    formatType: inferSheetFormatType(mappings, quoteRows),
    rows: quoteRows,
  };
}

function emptySheet(sheetName: string): SheetImport {
  return {
    sheetName,
    rowCount: 0,
    colCount: 0,
    headerRowIndex: null,
    headerSnapshot: null,
    mappings: [],
    formatType: "unknown-format",
    rows: [],
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

  if (bestRow) return bestRow.index;

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
    if (pattern.test(text)) score += 2;
  }

  if (field === "fobUsd" && /rmb|cny|含税|工厂价|成本|采购价|人民币|¥|￥/i.test(text)) score -= 5;
  if (field === "rmbCost" && /fob|usd|\$/i.test(text)) score -= 5;
  if (field === "ctnQty" && /size|尺寸|箱规/i.test(text)) score -= 2;
  if (field === "ctnSize" && /qty|pcs|数量/i.test(text)) score -= 2;
  return Math.max(score, 0);
}

function buildQuoteRows(rows: string[][], headerRowIndex: number, headers: string[], mappings: ColumnMapping[]): QuoteRow[] {
  const getMapping = (field: FieldKey) => mappings.find((mapping) => mapping.field === field);
  const model = getMapping("model");
  const description = getMapping("description");
  const fobUsd = getMapping("fobUsd");
  const rmbCost = getMapping("rmbCost");
  const moq = getMapping("moq");
  const ctnQty = getMapping("ctnQty");
  const ctnSize = getMapping("ctnSize");
  const remark = getMapping("remark");
  const result: QuoteRow[] = [];

  for (let index = headerRowIndex + 1; index < rows.length; index += 1) {
    const row = rows[index] ?? [];
    const rawModel = nullable(cellAt(row, model));
    const rawDescription = nullable(cellAt(row, description));
    const salePriceText = nullable(cellAt(row, fobUsd));
    const salePriceUsd = salePriceText ? parsePriceValue(salePriceText) : null;
    const rmbCostText = nullable(cellAt(row, rmbCost));
    const rmbCostValue = rmbCostText ? parsePriceValue(rmbCostText) : null;
    const rawRowJson = JSON.stringify(buildRawRowObject(row, headers));
    const quoteRow: QuoteRow = {
      rowNumber: index + 1,
      rawModel,
      rawDescription,
      salePriceUsd,
      salePriceText,
      rmbCost: rmbCostValue,
      moq: nullable(cellAt(row, moq)),
      ctnQty: nullable(cellAt(row, ctnQty)),
      ctnSize: nullable(cellAt(row, ctnSize)),
      remark: nullable(cellAt(row, remark)),
      rawRowJson,
    };

    if (shouldKeepRow(row, quoteRow)) {
      result.push(quoteRow);
    }
  }
  return result;
}

function shouldKeepRow(row: string[], quoteRow: QuoteRow): boolean {
  const nonEmpty = row.map(normalizeCell).filter(Boolean);
  if (nonEmpty.length === 0) return false;
  if (quoteRow.salePriceUsd != null) return true;
  if (quoteRow.rawModel && /\d/.test(quoteRow.rawModel) && (quoteRow.rawDescription || quoteRow.rmbCost != null)) return true;
  if (quoteRow.rawDescription && quoteRow.rmbCost != null) return true;
  return false;
}

function buildRawRowObject(row: string[], headers: string[]): Record<string, string> {
  const object: Record<string, string> = {};
  const maxColumns = Math.max(row.length, headers.length);
  for (let index = 0; index < maxColumns; index += 1) {
    const value = normalizeCell(row[index]);
    if (!value) continue;
    const header = normalizeCell(headers[index]);
    object[header || XLSX.utils.encode_col(index)] = value;
  }
  return object;
}

function inferSheetFormatType(mappings: ColumnMapping[], rows: QuoteRow[]): FormatType {
  const fields = new Set(mappings.map((mapping) => mapping.field));
  if (fields.has("model") && fields.has("fobUsd") && (fields.has("description") || fields.has("moq") || fields.has("ctnQty"))) {
    return "standard-template";
  }
  if (rows.length > 0 && (fields.has("model") || fields.has("fobUsd") || fields.has("rmbCost"))) {
    return "partial-match";
  }
  return "unknown-format";
}

async function applyImports(imports: FileImport[]): Promise<ApplyStats> {
  const stats: ApplyStats = { insertedFiles: 0, skippedFiles: 0, insertedRows: 0, skippedRows: 0 };

  for (const file of imports) {
    if (file.error) {
      stats.skippedFiles += 1;
      continue;
    }

    for (const sheet of file.sheets) {
      if (sheet.rows.length === 0) {
        stats.skippedFiles += 1;
        continue;
      }

      const existing = await queryOne<{ id: number }>(
        "SELECT id FROM customer_quote_files WHERE relative_path = ? AND sheet_name = ?",
        [file.relativePath, sheet.sheetName],
      );
      if (existing) {
        stats.skippedFiles += 1;
        stats.skippedRows += sheet.rows.length;
        continue;
      }

      await execute(
        `INSERT INTO customer_quote_files
          (file_name, relative_path, sheet_name, customer_name, quote_date, format_type, row_count, header_row, header_snapshot, column_mapping)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          file.fileName,
          file.relativePath,
          sheet.sheetName,
          file.customerName,
          file.quoteDate,
          sheet.formatType,
          sheet.rows.length,
          sheet.headerRowIndex == null ? null : sheet.headerRowIndex + 1,
          sheet.headerSnapshot,
          JSON.stringify(buildColumnMappingObject(sheet.mappings)),
        ],
      );
      const inserted = await queryOne<{ id: number }>(
        "SELECT id FROM customer_quote_files WHERE relative_path = ? AND sheet_name = ?",
        [file.relativePath, sheet.sheetName],
      );
      if (!inserted) {
        throw new Error(`Failed to load inserted customer quote file id: ${file.relativePath} / ${sheet.sheetName}`);
      }

      for (const row of sheet.rows) {
        await execute(
          `INSERT OR IGNORE INTO customer_quote_rows
            (file_id, row_number, raw_model, raw_description, sale_price_usd, sale_price_text, rmb_cost, moq, ctn_qty, ctn_size, remark, raw_row_json, matched_product_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
          [
            inserted.id,
            row.rowNumber,
            row.rawModel,
            row.rawDescription,
            row.salePriceUsd,
            row.salePriceText,
            row.rmbCost,
            row.moq,
            row.ctnQty,
            row.ctnSize,
            row.remark,
            row.rawRowJson,
          ],
        );
      }
      stats.insertedFiles += 1;
      stats.insertedRows += sheet.rows.length;
    }
  }

  return stats;
}

async function execute(sql: string, values: unknown[]) {
  await prisma.$executeRawUnsafe(sql, ...values);
}

async function queryOne<T>(sql: string, values: unknown[]): Promise<T | null> {
  const rows = await prisma.$queryRawUnsafe<T[]>(sql, ...values);
  return rows[0] ?? null;
}

function printDryRun(imports: FileImport[]) {
  const summary = summarize(imports);
  const totalSheets = imports.reduce((sum, file) => sum + file.sheets.length, 0);
  const totalRows = imports.flatMap((file) => file.sheets).reduce((sum, sheet) => sum + sheet.rows.length, 0);
  const parseableFiles = imports.filter((file) => file.sheets.some((sheet) => sheet.rows.length > 0)).length;

  console.log("\n=== Customer Quote Import V5.0B (dry-run) ===");
  console.log(`Source: ${ROOT}/`);
  console.log("");
  console.log(`Files found: ${imports.length}`);
  console.log(`Files with parseable sheets: ${parseableFiles}`);
  console.log(`Total sheets: ${totalSheets}`);
  console.log(`Total data rows: ${totalRows}`);
  console.log("");
  console.log("Per-category summary:");
  console.log("| 品类 | 文件数 | Sheet数 | 行数 | standard-template | partial-match | unknown |");
  console.log("|---|---:|---:|---:|---:|---:|---:|");
  for (const row of summary) {
    console.log(`| ${row.category} | ${row.files.size} | ${row.sheets} | ${row.rows} | ${row.standard} | ${row.partial} | ${row.unknown} |`);
  }
  console.log("");
  console.log("Per-file detail:");
  for (const file of imports) {
    const rows = file.sheets.reduce((sum, sheet) => sum + sheet.rows.length, 0);
    const formatType = file.sheets.some((sheet) => sheet.formatType === "standard-template")
      ? "standard-template"
      : file.sheets.some((sheet) => sheet.formatType === "partial-match")
        ? "partial-match"
        : "unknown-format";
    console.log(
      `[${file.fileName}] [sheets=${file.sheets.length}] [rows=${rows}] [${formatType}] [customer=${file.customerName ?? "-"}] [date=${file.quoteDate ?? "-"}]`,
    );
  }
}

function buildApplyReport(imports: FileImport[], stats: ApplyStats): string {
  const allSheets = imports.flatMap((file) => file.sheets.map((sheet) => ({ file, sheet })));
  const rows = allSheets.flatMap(({ sheet }) => sheet.rows);
  const rowsWithFob = rows.filter((row) => row.salePriceUsd != null).length;
  const rowsWithModel = rows.filter((row) => row.rawModel).length;
  const filesWithCustomer = imports.filter((file) => file.customerName).length;
  const summary = summarize(imports);
  const errors = imports.filter((file) => file.error);
  const skippedSheets = allSheets.filter(({ sheet }) => sheet.rows.length === 0);

  return [
    "# V5.0B — 历史客户报价导入报告",
    "",
    `Generated: ${new Date().toISOString()}`,
    "Mode: apply",
    "",
    "## 总结",
    "",
    "| 指标 | 数量 |",
    "|---|---:|",
    `| 文件总数 | ${imports.length} |`,
    `| 覆盖物理文件数 | ${new Set(allSheets.filter(({ sheet }) => sheet.rows.length > 0).map(({ file }) => file.relativePath)).size} |`,
    `| 导入 file-sheet 记录 | ${stats.insertedFiles} |`,
    `| 跳过 file-sheet 记录（已存在/无数据） | ${stats.skippedFiles} |`,
    `| Sheet 总数 | ${allSheets.length} |`,
    `| 导入行数 | ${stats.insertedRows} |`,
    `| 有 FOB USD 的行 | ${rowsWithFob} |`,
    `| 有款号的行 | ${rowsWithModel} |`,
    `| 有客户名的文件 | ${filesWithCustomer} |`,
    "",
    "## 按品类统计",
    "",
    "| 品类 | 文件 | Sheet | 行数 | FOB USD% | 款号% |",
    "|---|---:|---:|---:|---:|---:|",
    ...summary.map(
      (row) =>
        `| ${escapeMarkdown(row.category)} | ${row.files.size} | ${row.sheets} | ${row.rows} | ${percentage(row.rowsWithFob, row.rows)} | ${percentage(row.rowsWithModel, row.rows)} |`,
    ),
    "",
    "## 错误/跳过清单",
    "",
    errors.length === 0 ? "- 读取失败：0" : errors.map((file) => `- ${escapeMarkdown(file.relativePath)}: ${escapeMarkdown(file.error ?? "")}`).join("\n"),
    "",
    `- 无可导入数据 sheet：${skippedSheets.length}`,
    ...skippedSheets.slice(0, 80).map(({ file, sheet }) => `  - ${escapeMarkdown(file.relativePath)} / ${escapeMarkdown(sheet.sheetName)}`),
    skippedSheets.length > 80 ? `  - ... 另有 ${skippedSheets.length - 80} 个 sheet` : "",
    "",
  ].join("\n");
}

function summarize(imports: FileImport[]): CategorySummary[] {
  const map = new Map<string, CategorySummary>();
  for (const file of imports) {
    const summary =
      map.get(file.category) ??
      ({
        category: file.category,
        files: new Set<string>(),
        sheets: 0,
        rows: 0,
        rowsWithFob: 0,
        rowsWithModel: 0,
        standard: 0,
        partial: 0,
        unknown: 0,
      } satisfies CategorySummary);
    summary.files.add(file.relativePath);
    for (const sheet of file.sheets) {
      summary.sheets += 1;
      summary.rows += sheet.rows.length;
      summary.rowsWithFob += sheet.rows.filter((row) => row.salePriceUsd != null).length;
      summary.rowsWithModel += sheet.rows.filter((row) => row.rawModel).length;
      if (sheet.formatType === "standard-template") summary.standard += 1;
      if (sheet.formatType === "partial-match") summary.partial += 1;
      if (sheet.formatType === "unknown-format") summary.unknown += 1;
    }
    map.set(file.category, summary);
  }
  return [...map.values()].sort((a, b) => b.rows - a.rows || a.category.localeCompare(b.category, "zh-Hans-CN"));
}

function buildColumnMappingObject(mappings: ColumnMapping[]): Record<string, string> {
  const output: Record<string, string> = {};
  for (const mapping of mappings) {
    output[mapping.field] = mapping.columnLetter;
  }
  return output;
}

function buildHeaderSnapshot(headers: string[]): string | null {
  if (headers.length === 0) return null;
  return headers.map((header, index) => `${XLSX.utils.encode_col(index)}=${header || "-"}`).join(" | ");
}

function cellAt(row: string[], mapping: ColumnMapping | undefined): string {
  if (!mapping) return "";
  return normalizeCell(row[mapping.columnIndex]);
}

function parsePriceValue(raw: string): number | null {
  const text = normalizeCell(raw).replace(/,/g, "");
  const currencyMatch = text.match(/[¥￥$]\s*(-?\d+(?:\.\d+)?)/);
  const labeledMatch = text.match(/\b(?:RMB|CNY|USD)\s*(-?\d+(?:\.\d+)?)/i);
  const suffixMatch = text.match(/(-?\d+(?:\.\d+)?)\s*(?:RMB|CNY|USD|元)\b/i);
  const plainMatch = text.match(/-?\d+(?:\.\d+)?/);
  const value = currencyMatch?.[1] ?? labeledMatch?.[1] ?? suffixMatch?.[1] ?? plainMatch?.[0];
  if (!value) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractCustomerName(file: DiskFile, workbook: XLSX.WorkBook): string | null {
  const fromName = extractCustomerFromFileName(file.fileName);
  if (fromName) return fromName;

  for (const sheetName of workbook.SheetNames.slice(0, 3)) {
    const rows = XLSX.utils.sheet_to_json<string[]>(workbook.Sheets[sheetName], {
      header: 1,
      raw: false,
      defval: "",
      blankrows: false,
    });
    for (const row of rows.slice(0, 8)) {
      const text = row.map((cell) => normalizeCell(cell)).join(" ");
      const explicitCustomer = text.match(/\b(?:Customer|Client)\b[:：]\s*([A-Za-z0-9\u4e00-\u9fa5][A-Za-z0-9\u4e00-\u9fa5 _.-]{1,40})/i);
      const chineseCustomer = text.match(/客户[:：]\s*([A-Za-z0-9\u4e00-\u9fa5][A-Za-z0-9\u4e00-\u9fa5 _.-]{1,40})/i);
      const explicitTo = text.match(/(?:^|\s)\bTo\b\s*[:：]\s*([A-Za-z0-9\u4e00-\u9fa5][A-Za-z0-9\u4e00-\u9fa5 _.-]{1,40})/i);
      const match = explicitCustomer ?? chineseCustomer ?? explicitTo;
      if (match?.[1]) {
        const cleaned = cleanupExtractedText(match[1]);
        if (cleaned && !/^(wer|wellux|welfull|quotation|price|messrs|print your logo|high model|middle east)$/i.test(cleaned)) {
          return cleaned;
        }
      }
    }
  }
  return null;
}

function extractQuoteDate(file: DiskFile, workbook: XLSX.WorkBook): string | null {
  const fromName = extractDateFromText(file.fileName);
  if (fromName) return fromName;

  for (const sheetName of workbook.SheetNames.slice(0, 3)) {
    const rows = XLSX.utils.sheet_to_json<string[]>(workbook.Sheets[sheetName], {
      header: 1,
      raw: false,
      defval: "",
      blankrows: false,
    });
    for (const row of rows.slice(0, 8)) {
      const text = row.map((cell) => normalizeCell(cell)).join(" ");
      const match = text.match(/(?:Date|报价日期|日期)[:：]?\s*([0-9]{4}[-/.年]?[0-9]{1,2}[-/.月]?[0-9]{0,2})/i);
      if (match?.[1]) return normalizeDate(match[1]);
    }
  }
  return null;
}

function extractCustomerFromFileName(fileName: string): string | null {
  const name = path.basename(fileName, path.extname(fileName));
  const match = name.match(/\bTo\s+(.+?)(?:\s*[-_]\s*|$)/i);
  if (!match?.[1]) return null;
  const cleaned = cleanupExtractedText(match[1]);
  return cleaned || null;
}

function extractDateFromText(text: string): string | null {
  const compact = text.match(/(20\d{2})[._\-\s年]?([01]?\d)(?:[._\-\s月]?([0-3]?\d))?/);
  if (!compact) return null;
  const year = compact[1];
  const month = compact[2]?.padStart(2, "0");
  const day = compact[3]?.padStart(2, "0");
  return day ? `${year}-${month}-${day}` : `${year}-${month}`;
}

function normalizeDate(value: string): string {
  const normalized = value.replace(/[年月/.]/g, "-").replace(/日/g, "").replace(/--+/g, "-").replace(/-$/, "");
  return extractDateFromText(normalized) ?? normalized;
}

function inferQuoteMode(fileName: string): QuoteMode {
  if (/核价|核算|利润/i.test(fileName)) return "核价";
  if (/\bTo\s+/i.test(fileName)) return "To customer";
  return "通用模板";
}

function portableRelative(root: string, absolutePath: string): string {
  return normalizePathPart(path.relative(root, absolutePath).split(path.sep).join("/"));
}

function normalizePathPart(value: string): string {
  return value.normalize("NFC");
}

function normalizeCell(value: unknown): string {
  if (value == null) return "";
  return String(value).normalize("NFC").replace(/\s+/g, " ").trim();
}

function nullable(value: string): string | null {
  const normalized = normalizeCell(value);
  return normalized.length > 0 ? normalized : null;
}

function cleanupExtractedText(value: string): string {
  return value
    .replace(/\b(Quotation|Quote|Price|FOB|USD|Wellux|Welfull|LED)\b.*$/i, "")
    .replace(/[-_]+$/g, "")
    .trim();
}

function escapeMarkdown(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, "<br>");
}

function percentage(count: number, total: number): string {
  if (total === 0) return "0%";
  return `${Math.round((count / total) * 100)}%`;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
