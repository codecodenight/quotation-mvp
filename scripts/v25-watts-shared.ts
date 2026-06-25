import { existsSync } from "node:fs";
import { copyFile, mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import type { PrismaClient } from "@prisma/client";
import * as XLSX from "xlsx";

export const HEADER_SCAN_ROWS = 10;
export const MIN_HEADER_CELLS = 3;
export const INSERT_BATCH_SIZE = 500;

export type Bucket = "RECOVERABLE" | "NO_WATTS_IN_SOURCE" | "UNMATCHABLE";
export type MatchMethod = "exact" | "loose" | "file_no_watts_column";
export type ExtractionMode = "base" | "extended";

export type MissingProduct = {
  productId: string;
  productName: string;
  modelNo: string | null;
  category: string;
  sources: ProductSource[];
};

export type ProductSource = {
  sourceFileId: string;
  factoryName: string;
  purchasePrice: string;
  fileName: string;
  absolutePathSnapshot: string;
};

export type SourceFile = {
  id: string;
  fileName: string;
  absolutePathSnapshot: string;
  products: MissingProduct[];
};

export type WattsColumn = {
  index: number;
  header: string;
  kind: "direct" | "indirect";
};

export type SheetAnalysis = {
  sheetName: string;
  rows: unknown[][];
  headerRowIndex: number | null;
  headerPreview: string;
  modelColumns: number[];
  wattsColumns: WattsColumn[];
  modelSamples: string[];
};

export type FileAnalysis = {
  fileId: string;
  fileName: string;
  absolutePathSnapshot: string;
  readable: boolean;
  readError: string | null;
  sheetsAnalyzed: number;
  hasWattsColumn: boolean;
  wattsColumnHeaders: string[];
  headerPreviews: string[];
  sheets: SheetAnalysis[];
};

export type RowMatch = {
  sheetName: string;
  rowIndex: number;
  row: unknown[];
  identityValues: string[];
  wattsColumns: WattsColumn[];
  method: Exclude<MatchMethod, "file_no_watts_column">;
};

export type ProductAudit = {
  product: MissingProduct;
  bucket: Bucket;
  sourceFile: string;
  sheetName: string | null;
  matchMethod: MatchMethod | null;
  extracted: WattsExtraction | null;
  failureReason: string;
};

export type WattsExtraction = {
  rawValue: string;
  normalizedValue: string;
  displayValue: string;
  unit: "W";
  confidence: "high" | "medium";
  pattern: "direct" | "multiply" | "range";
  header: string;
};

type MissingProductRow = {
  id: string;
  product_name: string;
  model_no: string | null;
  category: string | null;
};

type HeaderInfo = {
  rowIndex: number;
  values: unknown[];
};

export const BASE_DIRECT_WATTS_HEADER_PATTERNS = [
  /^(?:watt|watts|wattage|power|actual\s*power|rated\s*power|rated\s*wattage|功率|实际功率|实测功率|额定功率|瓦数|w)$/i,
  /(?:^|[^a-z])w(?:$|[^a-z])/i,
];

export const BASE_INDIRECT_WATTS_HEADER_PATTERNS = [
  /光源/i,
  /^lamp$/i,
  /lamp\s*(?:type|source)?/i,
  /规格/i,
  /\bspec(?:ification)?s?\b/i,
  /描述/i,
  /description/i,
];

export const EXTENDED_INDIRECT_WATTS_HEADER_PATTERNS = [
  /光源/i,
  /^lamp$/i,
  /lamp\s*(?:type|source|color)?/i,
  /规格/i,
  /spec/i,
  /描述/i,
  /description/i,
  /特点|配置|feature/i,
  /product\s*detail/i,
  /产品[详描]述/i,
];

const MODEL_HEADER_PATTERNS = [
  /item\s*no/i,
  /model/i,
  /型号/i,
  /产品型号/i,
  /product\s*no/i,
  /编号/i,
  /款号/i,
  /^item$/i,
  /^product\s*name$/i,
  /^产品名称$/i,
  /^品名$/i,
  /^名称$/i,
  /^specifications?$/i,
  /^description$/i,
];

const BUSINESS_HEADER_PATTERNS = [
  /price/i,
  /fob/i,
  /unit\s*price/i,
  /单价/i,
  /价格/i,
  /含税/i,
  /不含税/i,
  /moq/i,
  /起订/i,
  /ctn/i,
  /carton/i,
  /package/i,
  /packing/i,
  /图片/i,
  /picture/i,
  /photo/i,
  /备注/i,
  /remark/i,
];

export async function loadMissingProducts(prisma: PrismaClient): Promise<{ missingWithSource: MissingProduct[]; missingWithoutSourceCount: number }> {
  const missingProductRows = await prisma.$queryRaw<MissingProductRow[]>`
    SELECT p.id,
           p.product_name,
           p.model_no,
           p.category
    FROM products p
    LEFT JOIN product_params pp
      ON pp.product_id = p.id
     AND pp.param_key = 'watts'
    WHERE pp.id IS NULL
    ORDER BY p.category, p.product_name
  `;
  const missingById = new Map(
    missingProductRows.map((row) => [
      row.id,
      {
        productId: row.id,
        productName: row.product_name,
        modelNo: row.model_no,
        category: cleanCategory(row.category),
        sources: [],
      } satisfies MissingProduct,
    ]),
  );
  const products = new Map<string, MissingProduct>();
  const seenSources = new Set<string>();

  for (const chunk of chunks([...missingById.keys()], 900)) {
    const offerRows = await prisma.supplierOffer.findMany({
      where: { productId: { in: chunk }, sourceFileId: { not: null } },
      select: {
        productId: true,
        sourceFileId: true,
        factoryName: true,
        purchasePrice: true,
        sourceFile: { select: { fileName: true, absolutePathSnapshot: true } },
      },
      orderBy: [{ sourceFileId: "asc" }, { factoryName: "asc" }],
    });

    for (const row of offerRows) {
      if (!row.sourceFileId || !row.sourceFile) continue;
      const product = products.get(row.productId) ?? missingById.get(row.productId);
      if (!product) continue;
      const sourceKey = `${row.productId}\u0000${row.sourceFileId}\u0000${row.factoryName}\u0000${row.purchasePrice.toString()}`;
      if (!seenSources.has(sourceKey)) {
        product.sources.push({
          sourceFileId: row.sourceFileId,
          factoryName: row.factoryName,
          purchasePrice: row.purchasePrice.toString(),
          fileName: row.sourceFile.fileName,
          absolutePathSnapshot: row.sourceFile.absolutePathSnapshot,
        });
        seenSources.add(sourceKey);
      }
      products.set(row.productId, product);
    }
  }

  return {
    missingWithSource: [...products.values()],
    missingWithoutSourceCount: missingProductRows.length - products.size,
  };
}

export function groupProductsBySourceFile(products: MissingProduct[]): SourceFile[] {
  const files = new Map<string, SourceFile>();
  const productSeenByFile = new Set<string>();
  for (const product of products) {
    for (const source of product.sources) {
      const file =
        files.get(source.sourceFileId) ??
        ({
          id: source.sourceFileId,
          fileName: source.fileName,
          absolutePathSnapshot: source.absolutePathSnapshot,
          products: [],
        } satisfies SourceFile);
      const key = `${source.sourceFileId}\u0000${product.productId}`;
      if (!productSeenByFile.has(key)) {
        file.products.push(product);
        productSeenByFile.add(key);
      }
      files.set(source.sourceFileId, file);
    }
  }
  return [...files.values()].sort((left, right) => left.fileName.localeCompare(right.fileName));
}

export function analyzeFile(
  file: SourceFile,
  options: { includeDirect: boolean; indirectPatterns?: RegExp[] } = { includeDirect: true },
): FileAnalysis {
  const analysis: FileAnalysis = {
    fileId: file.id,
    fileName: file.fileName,
    absolutePathSnapshot: file.absolutePathSnapshot,
    readable: false,
    readError: null,
    sheetsAnalyzed: 0,
    hasWattsColumn: false,
    wattsColumnHeaders: [],
    headerPreviews: [],
    sheets: [],
  };

  if (!existsSync(file.absolutePathSnapshot)) {
    analysis.readError = "source path missing";
    return analysis;
  }

  try {
    const workbook = XLSX.readFile(file.absolutePathSnapshot, { cellDates: false });
    analysis.readable = true;

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet?.["!ref"]) continue;
      const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: false });
      if (rows.length === 0) continue;

      const header = detectHeaderRow(rows, options.includeDirect, options.indirectPatterns);
      const headerValues = header?.values ?? [];
      const wattsColumns = findWattsColumns(headerValues, options.includeDirect, options.indirectPatterns);
      const modelColumns = findModelColumns(headerValues, options.includeDirect, options.indirectPatterns);
      const headerPreview = headerValues.map((cell) => cellToString(cell)).filter(Boolean).slice(0, 12).join(" / ");
      const modelSamples = collectModelSamples(rows, header?.rowIndex ?? null, modelColumns);

      analysis.sheetsAnalyzed += 1;
      if (headerPreview) analysis.headerPreviews.push(headerPreview);
      for (const column of wattsColumns) analysis.wattsColumnHeaders.push(column.header);
      analysis.sheets.push({
        sheetName,
        rows,
        headerRowIndex: header?.rowIndex ?? null,
        headerPreview,
        modelColumns,
        wattsColumns,
        modelSamples,
      });
    }
    analysis.wattsColumnHeaders = [...new Set(analysis.wattsColumnHeaders)].sort((left, right) => left.localeCompare(right));
    analysis.hasWattsColumn = analysis.wattsColumnHeaders.length > 0;
    analysis.headerPreviews = [...new Set(analysis.headerPreviews)].slice(0, 3);
  } catch (error) {
    analysis.readError = error instanceof Error ? error.message : String(error);
  }

  return analysis;
}

export function analyzeFiles(
  files: SourceFile[],
  logPrefix: string,
  options: { includeDirect: boolean; indirectPatterns?: RegExp[] } = { includeDirect: true },
): Map<string, FileAnalysis> {
  const analyses = new Map<string, FileAnalysis>();
  for (const [index, file] of files.entries()) {
    if (index === 0 || (index + 1) % 25 === 0 || index + 1 === files.length) {
      console.log(`${logPrefix} ${index + 1}/${files.length}: ${file.fileName}`);
    }
    analyses.set(file.id, analyzeFile(file, options));
  }
  return analyses;
}

export function auditProduct(product: MissingProduct, analysisByFile: Map<string, FileAnalysis>, extractionMode: ExtractionMode = "base"): ProductAudit {
  const analyses = product.sources.map((source) => analysisByFile.get(source.sourceFileId)).filter((analysis): analysis is FileAnalysis => Boolean(analysis));
  const readableAnalyses = analyses.filter((analysis) => analysis.readable);
  if (readableAnalyses.length === 0) {
    return buildAudit(product, "UNMATCHABLE", firstSourceFileName(product), null, null, null, "source file unreadable or missing");
  }

  const noWattsFiles = readableAnalyses.filter((analysis) => !analysis.hasWattsColumn);
  const recoverableMatches: Array<{ analysis: FileAnalysis; match: RowMatch; extracted: WattsExtraction }> = [];
  const matchedNoValue: Array<{ analysis: FileAnalysis; match: RowMatch }> = [];
  let ambiguousMatches = 0;

  for (const analysis of readableAnalyses.filter((item) => item.hasWattsColumn)) {
    const match = matchProductInFile(product, analysis);
    if (match.status === "ambiguous") {
      ambiguousMatches += 1;
      continue;
    }
    if (match.status !== "matched") continue;

    const extracted = extractWattsFromRow(match.match.row, match.match.wattsColumns, extractionMode);
    if (extracted) recoverableMatches.push({ analysis, match: match.match, extracted });
    else matchedNoValue.push({ analysis, match: match.match });
  }

  const exactRecoverable = recoverableMatches.find((item) => item.match.method === "exact");
  const chosenRecoverable = exactRecoverable ?? recoverableMatches[0];
  if (chosenRecoverable) {
    return buildAudit(
      product,
      "RECOVERABLE",
      chosenRecoverable.analysis.fileName,
      chosenRecoverable.match.sheetName,
      chosenRecoverable.match.method,
      chosenRecoverable.extracted,
      "",
    );
  }

  if (matchedNoValue.length > 0) {
    const chosen = matchedNoValue[0];
    return buildAudit(product, "NO_WATTS_IN_SOURCE", chosen.analysis.fileName, chosen.match.sheetName, chosen.match.method, null, "matched source row has no watts value");
  }

  if (noWattsFiles.length > 0) {
    return buildAudit(product, "NO_WATTS_IN_SOURCE", noWattsFiles[0].fileName, null, "file_no_watts_column", null, "source file has no recognizable watts column");
  }

  return buildAudit(
    product,
    "UNMATCHABLE",
    firstSourceFileName(product),
    null,
    null,
    null,
    ambiguousMatches > 0 ? "ambiguous row matches in source file" : "no matching source row found",
  );
}

export function matchProductInFile(product: MissingProduct, analysis: FileAnalysis): { status: "matched"; match: RowMatch } | { status: "ambiguous"; matches: RowMatch[] } | { status: "unmatched" } {
  const exactMatches: RowMatch[] = [];
  const looseMatches: RowMatch[] = [];

  for (const sheet of analysis.sheets) {
    if (sheet.headerRowIndex == null || sheet.modelColumns.length === 0 || sheet.wattsColumns.length === 0) continue;
    for (let rowIndex = sheet.headerRowIndex + 1; rowIndex < sheet.rows.length; rowIndex += 1) {
      const row = sheet.rows[rowIndex] ?? [];
      if (isBlankRow(row)) continue;
      const identityCells = sheet.modelColumns.map((columnIndex) => cellToString(row[columnIndex])).filter(Boolean);
      if (identityCells.length === 0) continue;
      if (identityCells.some((cell) => isExactProductMatch(product, cell))) {
        exactMatches.push({ sheetName: sheet.sheetName, rowIndex, row, identityValues: identityCells, wattsColumns: sheet.wattsColumns, method: "exact" });
        continue;
      }
      if (identityCells.some((cell) => isLooseProductMatch(product, cell))) {
        looseMatches.push({ sheetName: sheet.sheetName, rowIndex, row, identityValues: identityCells, wattsColumns: sheet.wattsColumns, method: "loose" });
      }
    }
  }

  const exact = chooseUniqueRowMatch(exactMatches);
  if (exact.status !== "unmatched") return exact;
  return chooseUniqueRowMatch(looseMatches);
}

export function extractWattsFromRow(row: unknown[], columns: WattsColumn[], mode: ExtractionMode = "base"): WattsExtraction | null {
  for (const column of columns) {
    const rawValue = cellToString(row[column.index]);
    if (!rawValue) continue;
    const extracted = column.kind === "direct" ? extractDirectWatts(rawValue) : extractIndirectWatts(rawValue, mode);
    if (extracted) return { ...extracted, rawValue, header: column.header };
  }
  return null;
}

export function extractDirectWatts(value: string): Omit<WattsExtraction, "rawValue" | "header"> | null {
  const indirect = extractIndirectWatts(value, "extended");
  if (indirect) return indirect;
  const number = value.replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  if (!number) return null;
  return { normalizedValue: number[0], displayValue: `${number[0]}W`, unit: "W", confidence: "high", pattern: "direct" };
}

export function extractIndirectWatts(value: string, mode: ExtractionMode): Omit<WattsExtraction, "rawValue" | "header"> | null {
  const compact = value.replace(/,/g, "").trim();
  const multiply = compact.match(/(\d+(?:\.\d+)?)\s*[*×xX]\s*(\d+(?:\.\d+)?)\s*[Ww]\b/);
  if (multiply) {
    const normalized = formatNumber(Number(multiply[1]) * Number(multiply[2]));
    return { normalizedValue: normalized, displayValue: `${multiply[1]}*${multiply[2]}W`, unit: "W", confidence: "high", pattern: "multiply" };
  }

  if (mode === "extended") {
    const range = compact.match(/(\d+(?:\.\d+)?)\s*[-~–—]\s*\d+(?:\.\d+)?\s*[Ww]\b/i);
    if (range) return { normalizedValue: range[1], displayValue: `${range[1]}W`, unit: "W", confidence: "medium", pattern: "range" };
  }

  const direct = compact.match(/(\d+(?:\.\d+)?)\s*[Ww]\b/);
  if (direct) return { normalizedValue: direct[1], displayValue: `${direct[1]}W`, unit: "W", confidence: "high", pattern: "direct" };
  return null;
}

export async function backupDatabase(label: string): Promise<string> {
  const dbPath = path.join("prisma", "dev.db");
  if (!existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);
  await mkdir("backups", { recursive: true });
  const backupPath = path.join("backups", `dev-before-${label}-${timestampForFile()}.sqlite`);
  const tempPath = `${backupPath}.tmp`;
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await rm(tempPath, { force: true });
      await copyFile(dbPath, tempPath);
      await rename(tempPath, backupPath);
      return backupPath;
    } catch (error) {
      lastError = error;
      await rm(tempPath, { force: true });
      if (attempt < 3) await sleep(1000 * attempt);
    }
  }
  throw lastError;
}

function detectHeaderRow(rows: unknown[][], includeDirect: boolean, indirectPatterns: RegExp[] | undefined): HeaderInfo | null {
  let fallback: HeaderInfo | null = null;
  for (let rowIndex = 0; rowIndex < Math.min(rows.length, HEADER_SCAN_ROWS); rowIndex += 1) {
    const values = rows[rowIndex] ?? [];
    const nonEmptyCount = values.filter((cell) => cellToString(cell)).length;
    if (nonEmptyCount < MIN_HEADER_CELLS) continue;
    if (!fallback) fallback = { rowIndex, values };
    if (values.some((cell) => isModelHeader(cellToString(cell)) || isWattsHeader(cellToString(cell), includeDirect, indirectPatterns))) {
      return { rowIndex, values };
    }
  }
  return fallback;
}

function findWattsColumns(headerValues: unknown[], includeDirect: boolean, indirectPatterns: RegExp[] | undefined): WattsColumn[] {
  const columns: WattsColumn[] = [];
  for (const [index, value] of headerValues.entries()) {
    const header = cellToString(value);
    const normalized = normalizeHeader(header);
    if (!normalized || isBusinessHeader(normalized)) continue;
    if (includeDirect && BASE_DIRECT_WATTS_HEADER_PATTERNS.some((pattern) => pattern.test(normalized))) {
      columns.push({ index, header, kind: "direct" });
      continue;
    }
    const patterns = indirectPatterns ?? BASE_INDIRECT_WATTS_HEADER_PATTERNS;
    if (patterns.some((pattern) => pattern.test(normalized))) {
      columns.push({ index, header, kind: "indirect" });
    }
  }
  return columns;
}

function findModelColumns(headerValues: unknown[], includeDirect: boolean, indirectPatterns: RegExp[] | undefined): number[] {
  const direct: number[] = [];
  for (const [index, value] of headerValues.entries()) {
    if (isModelHeader(cellToString(value))) direct.push(index);
  }
  if (direct.length > 0) return direct;

  const fallback: number[] = [];
  for (const [index, value] of headerValues.entries()) {
    const normalized = normalizeHeader(cellToString(value));
    if (!normalized || isBusinessHeader(normalized) || isWattsHeader(normalized, includeDirect, indirectPatterns)) continue;
    fallback.push(index);
    if (fallback.length >= 4) break;
  }
  return fallback;
}

function collectModelSamples(rows: unknown[][], headerRowIndex: number | null, modelColumns: number[]): string[] {
  if (headerRowIndex == null || modelColumns.length === 0) return [];
  const samples: string[] = [];
  for (let rowIndex = headerRowIndex + 1; rowIndex < rows.length && samples.length < 5; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    const value = modelColumns.map((columnIndex) => cellToString(row[columnIndex])).filter(Boolean).join(" / ");
    if (value) samples.push(value);
  }
  return samples;
}

function chooseUniqueRowMatch(matches: RowMatch[]): { status: "matched"; match: RowMatch } | { status: "ambiguous"; matches: RowMatch[] } | { status: "unmatched" } {
  if (matches.length === 0) return { status: "unmatched" };
  const unique = new Map<string, RowMatch>();
  for (const match of matches) unique.set(`${match.sheetName}\u0000${match.rowIndex}`, match);
  const values = [...unique.values()];
  if (values.length === 1) return { status: "matched", match: values[0] };
  return { status: "ambiguous", matches: values };
}

function buildAudit(
  product: MissingProduct,
  bucket: Bucket,
  sourceFile: string,
  sheetName: string | null,
  matchMethod: MatchMethod | null,
  extracted: WattsExtraction | null,
  failureReason: string,
): ProductAudit {
  return { product, bucket, sourceFile, sheetName, matchMethod, extracted, failureReason };
}

function isExactProductMatch(product: MissingProduct, excelValue: string): boolean {
  const excel = normalizeExact(excelValue);
  if (!excel) return false;
  return productIdentityValues(product, "exact").some((identity) => identity === excel);
}

function isLooseProductMatch(product: MissingProduct, excelValue: string): boolean {
  const excel = normalizeLoose(excelValue);
  if (!isUsefulLooseIdentity(excel)) return false;
  return productIdentityValues(product, "loose").some((identity) => isUsefulLooseIdentity(identity) && (excel.includes(identity) || identity.includes(excel)));
}

function productIdentityValues(product: MissingProduct, mode: "exact" | "loose"): string[] {
  const rawValues = [product.modelNo ?? "", product.productName, stripColorSuffix(product.productName)];
  const normalized = rawValues.map((value) => (mode === "exact" ? normalizeExact(value) : normalizeLoose(value))).filter(Boolean);
  return [...new Set(normalized)];
}

function isUsefulLooseIdentity(value: string): boolean {
  if (value.length < 4) return false;
  if (/^\d+(?:\.\d+)?$/.test(value)) return false;
  if (/^\d+(?:\.\d+)?w$/i.test(value)) return false;
  const generic = new Set(["led", "light", "lamp", "product", "quotation", "型号", "产品", "规格", "功率"]);
  return !generic.has(value);
}

function stripColorSuffix(value: string): string {
  return value.replace(/(?:白|黑|灰|银|金|哑白|哑黑|white|black|grey|gray|silver|gold)$/i, "").trim();
}

function normalizeExact(value: string): string {
  return value.normalize("NFC").toLowerCase().replace(/\s+/g, "").trim();
}

function normalizeLoose(value: string): string {
  return normalizeExact(value).replace(/[\-_/\\–—()（）.,，:：+]+/g, "");
}

function normalizeHeader(value: string): string {
  return value
    .normalize("NFC")
    .replace(/[\r\n]+/g, " ")
    .replace(/[（(][^）)]*[）)]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isModelHeader(value: string): boolean {
  const normalized = normalizeHeader(value);
  return Boolean(normalized && MODEL_HEADER_PATTERNS.some((pattern) => pattern.test(normalized)));
}

function isWattsHeader(value: string, includeDirect: boolean, indirectPatterns: RegExp[] | undefined): boolean {
  const normalized = normalizeHeader(value);
  const patterns = [...(includeDirect ? BASE_DIRECT_WATTS_HEADER_PATTERNS : []), ...(indirectPatterns ?? BASE_INDIRECT_WATTS_HEADER_PATTERNS)];
  return Boolean(normalized && patterns.some((pattern) => pattern.test(normalized)));
}

function isBusinessHeader(value: string): boolean {
  const normalized = normalizeHeader(value);
  return BUSINESS_HEADER_PATTERNS.some((pattern) => pattern.test(normalized));
}

function isBlankRow(row: unknown[]): boolean {
  return row.every((cell) => !cellToString(cell));
}

export function cellToString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value).trim();
  return String(value).trim();
}

function cleanCategory(value: string | null): string {
  const trimmed = value?.trim();
  return trimmed || "(未分类)";
}

function firstSourceFileName(product: MissingProduct): string {
  return product.sources[0]?.fileName ?? "-";
}

export function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size));
  return out;
}

export function formatInteger(value: number): string {
  return value.toLocaleString("en-US");
}

export function formatPercent(numerator: number, denominator: number): string {
  if (denominator <= 0) return "0%";
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

export function md(value: string | number | null | undefined): string {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

function timestampForFile(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "";
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)));
}
