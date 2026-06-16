import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

import { PrismaClient } from "@prisma/client";
import * as XLSX from "xlsx";

import { parsePriceValue } from "../src/lib/excel-import";

const prisma = new PrismaClient();

const REPORT_PATH = path.join("docs", "v10.3-import-report.md");
const APPLY_MODE = process.argv.includes("--apply");
const HEADER_SCAN_ROWS = 10;
const MIN_HEADER_CELLS = 3;
const PRICE_MAX = 10_000_000;

const SKIPPABLE_SHEET_NAME = /目录|index|cover|封面/i;

const CATEGORY_MAP: Record<string, string | null> = {
  LED橱柜灯: "橱柜灯",
  市电壁灯: "壁灯",
  支架: "线条灯",
  hejia: null,
  "sample data": null,
};

const MODEL_HEADER_PATTERNS = [
  /item\s*no/i,
  /model/i,
  /型号/i,
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

type UnlinkedFileRow = {
  id: string;
  fileName: string;
  relativePath: string;
  folderName: string | null;
  factoryGuess: string | null;
};

type ProductCacheItem = {
  id: string;
  modelNo: string | null;
  productName: string;
  category: string | null;
};

type HeaderInfo = {
  rowIndex: number;
  values: unknown[];
};

type PriceColumn = {
  index: number;
  header: string;
  count: number;
  hasCurrencySymbol: boolean;
  rmbHeader: boolean;
  samples: string[];
};

type SheetResult = {
  fileName: string;
  sheetName: string;
  category: string;
  headerRow: number | null;
  modelColumn: string | null;
  priceColumn: string | null;
  validRows: number;
  skippedRows: number;
  newProducts: number;
  reusedProducts: number;
  newOffers: number;
  skippedOffers: number;
  fallbackZeroPriceRows: number;
  error: string | null;
};

type FileResult = {
  fileId: string;
  fileName: string;
  relativePath: string;
  category: string;
  factory: string;
  sheetCount: number;
  parsedSheets: number;
  skippedSheets: number;
  scannedRows: number;
  validRows: number;
  skippedRows: number;
  newProducts: number;
  reusedProducts: number;
  newOffers: number;
  skippedOffers: number;
  fallbackZeroPriceRows: number;
  readError: string | null;
  sheetResults: SheetResult[];
};

type Totals = {
  mode: "dry-run" | "apply";
  files: number;
  parsedFiles: number;
  failedFiles: number;
  skippedSheets: number;
  scannedRows: number;
  validRows: number;
  skippedRows: number;
  newProducts: number;
  reusedProducts: number;
  newOffers: number;
  skippedOffers: number;
  fallbackZeroPriceRows: number;
  productsBefore: number;
  productsAfter: number;
  offersBefore: number;
  offersAfter: number;
};

type CategoryStats = {
  category: string;
  fileIds: Set<string>;
  newProducts: number;
  reusedProducts: number;
  newOffers: number;
};

type FactoryStats = {
  factory: string;
  fileIds: Set<string>;
  newOffers: number;
};

type CreatedProductSample = {
  modelNo: string;
  category: string;
  productName: string;
  sourceFile: string;
};

async function main() {
  const [productsBefore, offersBefore] = await Promise.all([prisma.product.count(), prisma.supplierOffer.count()]);
  const files = await loadUnlinkedFiles();
  const productCache = await loadProducts();
  const offerKeys = await loadExistingOfferKeys();
  const createdProductSamples: CreatedProductSample[] = [];
  const fileResults: FileResult[] = [];

  for (const [index, file] of files.entries()) {
    if (index === 0 || (index + 1) % 20 === 0 || index + 1 === files.length) {
      console.log(`Importing ${index + 1}/${files.length}: ${file.relativePath}`);
    }

    fileResults.push(await processFile(file, productCache, offerKeys, createdProductSamples));
  }

  const [productsAfter, offersAfter] = await Promise.all([prisma.product.count(), prisma.supplierOffer.count()]);
  const totals = buildTotals({ files, fileResults, productsBefore, productsAfter, offersBefore, offersAfter });

  await mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await writeFile(REPORT_PATH, buildReport(totals, fileResults, createdProductSamples), "utf8");

  console.log(
    JSON.stringify(
      {
        mode: totals.mode,
        reportPath: REPORT_PATH,
        files: totals.files,
        parsedFiles: totals.parsedFiles,
        failedFiles: totals.failedFiles,
        scannedRows: totals.scannedRows,
        validRows: totals.validRows,
        newProducts: totals.newProducts,
        reusedProducts: totals.reusedProducts,
        newOffers: totals.newOffers,
        skippedOffers: totals.skippedOffers,
        fallbackZeroPriceRows: totals.fallbackZeroPriceRows,
        products: `${totals.productsBefore} -> ${totals.productsAfter}`,
        supplierOffers: `${totals.offersBefore} -> ${totals.offersAfter}`,
      },
      null,
      2,
    ),
  );

  await prisma.$disconnect();
}

async function loadUnlinkedFiles(): Promise<UnlinkedFileRow[]> {
  return prisma.$queryRaw<UnlinkedFileRow[]>`
    SELECT
      f.id,
      f.file_name AS fileName,
      f.relative_path AS relativePath,
      f.folder_name AS folderName,
      f.factory_guess AS factoryGuess
    FROM files f
    WHERE f.file_type = 'excel'
      AND f.id NOT IN (
        SELECT DISTINCT source_file_id FROM supplier_offers WHERE source_file_id IS NOT NULL
      )
    ORDER BY f.relative_path
  `;
}

async function loadProducts(): Promise<ProductCacheItem[]> {
  return prisma.product.findMany({
    select: { id: true, modelNo: true, productName: true, category: true },
    orderBy: [{ category: "asc" }, { modelNo: "asc" }, { productName: "asc" }],
  });
}

async function loadExistingOfferKeys(): Promise<Set<string>> {
  const rows = await prisma.supplierOffer.findMany({
    select: { productId: true, factoryName: true, sourceFileId: true },
    where: { sourceFileId: { not: null } },
  });
  return new Set(rows.map((row) => offerKey(row.productId, row.factoryName, row.sourceFileId ?? "")));
}

async function processFile(
  file: UnlinkedFileRow,
  productCache: ProductCacheItem[],
  offerKeys: Set<string>,
  createdProductSamples: CreatedProductSample[],
): Promise<FileResult> {
  const physicalPath = resolvePhysicalPath(file.relativePath);
  const category = resolveCategory(file.folderName, file.fileName);
  const factory = cleanText(file.factoryGuess) || inferFactory(file.relativePath) || "未知";
  const result: FileResult = {
    fileId: file.id,
    fileName: file.fileName,
    relativePath: file.relativePath,
    category,
    factory,
    sheetCount: 0,
    parsedSheets: 0,
    skippedSheets: 0,
    scannedRows: 0,
    validRows: 0,
    skippedRows: 0,
    newProducts: 0,
    reusedProducts: 0,
    newOffers: 0,
    skippedOffers: 0,
    fallbackZeroPriceRows: 0,
    readError: null,
    sheetResults: [],
  };

  if (!existsSync(physicalPath)) {
    result.readError = "file missing";
    return result;
  }

  try {
    const workbook = XLSX.readFile(physicalPath, { cellDates: false });
    result.sheetCount = workbook.SheetNames.length;

    for (const sheetName of workbook.SheetNames) {
      if (SKIPPABLE_SHEET_NAME.test(sheetName)) {
        result.skippedSheets += 1;
        continue;
      }

      const sheet = workbook.Sheets[sheetName];
      const range = sheet?.["!ref"] ? XLSX.utils.decode_range(sheet["!ref"]) : null;
      if (!sheet || !range) {
        result.skippedSheets += 1;
        result.sheetResults.push(emptySheetResult(file.fileName, sheetName, category, "empty sheet"));
        continue;
      }

      const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: false });
      const sheetResult = await processSheet({
        file,
        sheetName,
        rows,
        category,
        factory,
        productCache,
        offerKeys,
        createdProductSamples,
      });
      result.sheetResults.push(sheetResult);

      if (sheetResult.error) {
        result.skippedSheets += 1;
      } else {
        result.parsedSheets += 1;
      }

      result.scannedRows += sheetResult.validRows + sheetResult.skippedRows;
      result.validRows += sheetResult.validRows;
      result.skippedRows += sheetResult.skippedRows;
      result.newProducts += sheetResult.newProducts;
      result.reusedProducts += sheetResult.reusedProducts;
      result.newOffers += sheetResult.newOffers;
      result.skippedOffers += sheetResult.skippedOffers;
      result.fallbackZeroPriceRows += sheetResult.fallbackZeroPriceRows;
    }
  } catch (error) {
    result.readError = error instanceof Error ? error.message : String(error);
  }

  return result;
}

async function processSheet(input: {
  file: UnlinkedFileRow;
  sheetName: string;
  rows: unknown[][];
  category: string;
  factory: string;
  productCache: ProductCacheItem[];
  offerKeys: Set<string>;
  createdProductSamples: CreatedProductSample[];
}): Promise<SheetResult> {
  const { file, sheetName, rows, category, factory, productCache, offerKeys, createdProductSamples } = input;
  const header = detectHeaderRow(rows.slice(0, HEADER_SCAN_ROWS));
  if (!header) return emptySheetResult(file.fileName, sheetName, category, `no header row with >= ${MIN_HEADER_CELLS} cells`);

  const headers = buildHeaders(header.values, maxColumnCount(rows));
  const modelColumn = findModelColumn(headers) ?? findModelColumnByValues(rows, header.rowIndex);
  const priceColumn = findPriceColumn(headers, rows, header.rowIndex, modelColumn);
  const sizeColumn = findOptionalColumn(headers, [/^size$/i, /尺寸/i, /规格/i, /product\s*size/i, /dimension/i], new Set([modelColumn ?? -1, priceColumn?.index ?? -1]));
  const remarkColumn = findOptionalColumn(
    headers,
    [/description/i, /details/i, /spec/i, /参数/i, /描述/i, /配置/i, /备注/i],
    new Set([modelColumn ?? -1, priceColumn?.index ?? -1, sizeColumn ?? -1]),
  );

  if (modelColumn == null && !canUseSheetNameAsModel(sheetName)) {
    return emptySheetResult(file.fileName, sheetName, category, "no model column");
  }

  const sheetResult: SheetResult = {
    fileName: file.fileName,
    sheetName,
    category,
    headerRow: header.rowIndex + 1,
    modelColumn: modelColumn == null ? "sheet name fallback" : columnLabel(modelColumn),
    priceColumn: priceColumn ? `${columnLabel(priceColumn.index)} ${priceColumn.header || "(未命名)"}` : "none, default 0",
    validRows: 0,
    skippedRows: 0,
    newProducts: 0,
    reusedProducts: 0,
    newOffers: 0,
    skippedOffers: 0,
    fallbackZeroPriceRows: 0,
    error: null,
  };

  const dataRows = rows.slice(header.rowIndex + 1);
  for (const rawRow of dataRows) {
    const row = normalizeRow(rawRow);
    if (isBlankRow(row)) continue;

    const modelValue = modelColumn == null ? buildSheetFallbackModel(sheetName, row, headers) : cleanModelNo(row[modelColumn]);
    if (!modelValue || !isLikelyModelValue(modelValue) || isHeaderLikeModel(modelValue)) {
      sheetResult.skippedRows += 1;
      continue;
    }

    const priceValue = priceColumn ? parsePositivePrice(row[priceColumn.index]) : null;
    if (!priceValue) sheetResult.fallbackZeroPriceRows += 1;

    sheetResult.validRows += 1;
    const product = await findOrCreateProduct({
      modelNo: modelValue,
      category,
      productName: buildProductName(modelValue, sheetName, category),
      size: cellAt(row, sizeColumn),
      remark: cellAt(row, remarkColumn),
      productCache,
      createdProductSamples,
      sourceFile: file.fileName,
    });

    if (product.created) {
      sheetResult.newProducts += 1;
    } else {
      sheetResult.reusedProducts += 1;
    }

    const sourceOfferKey = offerKey(product.product.id, factory, file.id);
    if (offerKeys.has(sourceOfferKey)) {
      sheetResult.skippedOffers += 1;
      continue;
    }

    if (APPLY_MODE) {
      await prisma.supplierOffer.create({
        data: {
          id: randomUUID(),
          productId: product.product.id,
          factoryName: factory,
          purchasePrice: priceValue ?? "0",
          currency: "RMB",
          sourceFileId: file.id,
          moq: null,
          remark: null,
        },
      });
    }

    offerKeys.add(sourceOfferKey);
    sheetResult.newOffers += 1;
  }

  if (sheetResult.validRows === 0) {
    sheetResult.error = "no valid data rows";
  }

  return sheetResult;
}

async function findOrCreateProduct(input: {
  modelNo: string;
  category: string;
  productName: string;
  size: string | null;
  remark: string | null;
  productCache: ProductCacheItem[];
  createdProductSamples: CreatedProductSample[];
  sourceFile: string;
}): Promise<{ product: ProductCacheItem; created: boolean }> {
  const { modelNo, category, productName, size, remark, productCache, createdProductSamples, sourceFile } = input;
  const existing = findExistingProduct(modelNo, category, productCache);
  if (existing) return { product: existing, created: false };

  const created: ProductCacheItem = APPLY_MODE
    ? await prisma.product.create({
        data: {
          id: randomUUID(),
          modelNo,
          productName,
          category,
          size,
          remark,
        },
        select: { id: true, modelNo: true, productName: true, category: true },
      })
    : {
        id: `dry-${randomUUID()}`,
        modelNo,
        productName,
        category,
      };

  productCache.push(created);
  if (createdProductSamples.length < 100) {
    createdProductSamples.push({ modelNo, category, productName, sourceFile });
  }

  return { product: created, created: true };
}

function findExistingProduct(modelValue: string, category: string, products: ProductCacheItem[]): ProductCacheItem | null {
  const normalizedModel = normalizeForMatch(modelValue);
  if (!normalizedModel) return null;

  const exactMatches = products.filter((product) => normalizeForMatch(product.modelNo ?? "") === normalizedModel);
  const exactSameCategory = exactMatches.filter((product) => product.category === category);
  if (exactSameCategory.length === 1) return exactSameCategory[0];
  if (exactMatches.length === 1) return exactMatches[0];

  const containsMatches = products.filter((product) => {
    const normalizedProductModel = normalizeForMatch(product.modelNo ?? "");
    return (
      normalizedProductModel.length >= 3 &&
      normalizedModel.length >= 3 &&
      (normalizedProductModel.includes(normalizedModel) || normalizedModel.includes(normalizedProductModel))
    );
  });
  const containsSameCategory = containsMatches.filter((product) => product.category === category);
  if (containsSameCategory.length === 1) return containsSameCategory[0];
  return containsMatches.length === 1 ? containsMatches[0] : null;
}

function detectHeaderRow(rows: unknown[][]): HeaderInfo | null {
  let best: { rowIndex: number; values: unknown[]; score: number } | null = null;

  for (const [rowIndex, row] of rows.entries()) {
    const values = normalizeRow(row);
    const nonEmptyCount = values.filter(Boolean).length;
    if (nonEmptyCount < MIN_HEADER_CELLS) continue;

    const text = values.join(" ");
    const signalScore = (MODEL_HEADER_PATTERNS.some((pattern) => pattern.test(text)) ? 8 : 0) + (isRmbPriceHeader(text) ? 8 : 0);
    const score = nonEmptyCount + signalScore;
    if (!best || score > best.score) {
      best = { rowIndex, values: row, score };
    }
  }

  return best ? { rowIndex: best.rowIndex, values: best.values } : null;
}

function buildHeaders(headerValues: unknown[], colCount: number): string[] {
  return Array.from({ length: colCount }, (_, index) => cleanText(headerValues[index]));
}

function findModelColumn(headers: string[]): number | null {
  for (const [index, header] of headers.entries()) {
    const normalized = normalizeHeader(header);
    if (!normalized) continue;
    if (MODEL_HEADER_PATTERNS.some((pattern) => pattern.test(normalized))) return index;
  }
  return null;
}

function findModelColumnByValues(rows: unknown[][], headerRowIndex: number): number | null {
  const dataRows = rows.slice(headerRowIndex + 1, headerRowIndex + 31).map(normalizeRow);
  const colCount = maxColumnCount(dataRows);
  let best: { index: number; count: number } | null = null;

  for (let index = 0; index < colCount; index += 1) {
    const values = dataRows.map((row) => row[index] ?? "").filter(Boolean);
    const modelCount = values.filter(isLikelyModelValue).length;
    if (modelCount < 2) continue;
    if (!best || modelCount > best.count) best = { index, count: modelCount };
  }

  return best?.index ?? null;
}

function findPriceColumn(headers: string[], rows: unknown[][], headerRowIndex: number, modelColumn: number | null): PriceColumn | null {
  const dataRows = rows.slice(headerRowIndex + 1, headerRowIndex + 61).map(normalizeRow);
  const colCount = maxColumnCount(dataRows);
  const candidates: PriceColumn[] = [];

  for (let index = 0; index < colCount; index += 1) {
    if (index === modelColumn) continue;
    const header = headers[index] ?? "";
    if (isUsdPriceHeader(header) || isNonPriceHeader(header)) continue;

    const samples: string[] = [];
    let count = 0;
    let hasCurrencySymbol = false;

    for (const row of dataRows) {
      const value = row[index] ?? "";
      const parsed = parsePositivePrice(value);
      if (!parsed) continue;
      count += 1;
      if (/[¥￥]/.test(value)) hasCurrencySymbol = true;
      if (samples.length < 5) samples.push(value);
    }

    if (count === 0) continue;
    candidates.push({
      index,
      header,
      count,
      hasCurrencySymbol,
      rmbHeader: isRmbPriceHeader(header),
      samples,
    });
  }

  return candidates.sort(sortPriceColumn)[0] ?? null;
}

function sortPriceColumn(a: PriceColumn, b: PriceColumn): number {
  return Number(b.rmbHeader) - Number(a.rmbHeader) || Number(b.hasCurrencySymbol) - Number(a.hasCurrencySymbol) || b.count - a.count || a.index - b.index;
}

function findOptionalColumn(headers: string[], tests: RegExp[], excluded: Set<number>): number | null {
  for (const [index, header] of headers.entries()) {
    if (excluded.has(index)) continue;
    if (tests.some((test) => test.test(normalizeHeader(header)))) return index;
  }
  return null;
}

function resolveCategory(folderName: string | null, fileName: string): string {
  const folder = cleanText(folderName);
  const mapped = folder ? CATEGORY_MAP[folder] : undefined;
  if (mapped) return mapped;
  if (mapped === null || !folder) return inferCategoryFromFileName(fileName);
  return folder;
}

function inferCategoryFromFileName(fileName: string): string {
  const text = normalizeForMatch(fileName);
  if (/灯带|strip/.test(text)) return "灯带";
  if (/投光|flood/.test(text)) return "投光灯";
  if (/面板|panel/.test(text)) return "面板灯";
  if (/皮线/.test(text)) return "皮线灯";
  if (/spotlight/.test(text)) return "筒灯";
  return "(未分类)";
}

function inferFactory(relativePath: string): string | null {
  const parts = relativePath.split(/[\\/]/).filter(Boolean);
  if (parts.length < 2) return null;
  return cleanText(parts.at(-2));
}

function parsePositivePrice(value: string): string | null {
  const parsed = parsePriceValue(value);
  if (!parsed) return null;
  const numeric = Number(parsed);
  if (!Number.isFinite(numeric) || numeric <= 0 || numeric > PRICE_MAX) return null;
  if (/^\d{4}$/.test(parsed) && numeric >= 1900 && numeric <= 2100) return null;
  return parsed;
}

function buildSheetFallbackModel(sheetName: string, row: string[], headers: string[]): string | null {
  const base = cleanModelNo(sheetName);
  if (!base || !canUseSheetNameAsModel(base)) return null;

  const wattsColumn = headers.findIndex((header) => /功率|power|watt|watts/i.test(header));
  const watts = wattsColumn >= 0 ? firstNumber(row[wattsColumn]) : null;
  return watts ? `${base}-${watts}W` : base;
}

function canUseSheetNameAsModel(sheetName: string): boolean {
  const normalized = normalizeForMatch(sheetName);
  return normalized.length >= 3 && !/^sheet\s*\d*$/i.test(normalized);
}

function buildProductName(model: string, _sheetName: string, category: string): string {
  return model.trim().length > 5 ? model.trim() : `${model.trim()} (${category})`;
}

function isLikelyModelValue(value: string): boolean {
  const text = cleanText(value);
  if (text.length < 2 || text.length > 100) return false;
  if (/^[\d,.]+$/.test(text)) return false;
  if (/单价|price|报价|含税|不含税/i.test(text)) return false;
  return true;
}

function isHeaderLikeModel(modelNo: string): boolean {
  return /型号|款号|model|item|code|产品名称|品名|规格|spec/i.test(modelNo) && !/\d/.test(modelNo.replace(/\d{2,}/g, ""));
}

function isRmbPriceHeader(header: string): boolean {
  return /rmb|人民币|含税|不含税|单价|价格|报价|出厂|工厂价|成本|cny|元/i.test(cleanText(header)) && !isUsdPriceHeader(header);
}

function isUsdPriceHeader(header: string): boolean {
  return /usd|fob|美金|美元|us\$|\$/i.test(cleanText(header));
}

function isNonPriceHeader(header: string): boolean {
  return /no\.?|序号|型号|款号|model|item|图片|photo|picture|尺寸|size|规格|spec|功率|power|watt|电压|voltage|色温|cct|光通|lumen|箱|ctn|carton|包装|package|moq|数量|qty|pcs/i.test(
    cleanText(header),
  );
}

function cleanModelNo(value: string | null | undefined): string | null {
  const text = cleanText(value);
  if (!text || /^[-/\\]+$/.test(text)) return null;
  return text;
}

function normalizeHeader(value: string): string {
  return cleanText(value)
    .replace(/[\r\n]+/g, " ")
    .replace(/[（(][^）)]*[）)]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizeForMatch(value: string): string {
  return cleanText(value).toLowerCase();
}

function cleanText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFC")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeRow(row: unknown[]): string[] {
  return row.map(cleanText);
}

function isBlankRow(row: string[]): boolean {
  return row.every((cell) => !cell);
}

function cellAt(row: string[], columnIndex: number | null): string | null {
  if (columnIndex == null || columnIndex < 0) return null;
  const value = cleanText(row[columnIndex]);
  return value || null;
}

function maxColumnCount(rows: unknown[][]): number {
  return rows.reduce((max, row) => Math.max(max, row.length), 0);
}

function firstNumber(value: string): string | null {
  const match = cleanText(value).replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  return match?.[0] ?? null;
}

function resolvePhysicalPath(relativePath: string): string {
  return path.isAbsolute(relativePath) ? relativePath : path.join(process.cwd(), relativePath);
}

function offerKey(productId: string, factoryName: string, sourceFileId: string): string {
  return `${productId}\u0000${normalizeForMatch(factoryName)}\u0000${sourceFileId}`;
}

function columnLabel(index: number): string {
  let value = index + 1;
  let label = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - 1) / 26);
  }
  return label;
}

function emptySheetResult(fileName: string, sheetName: string, category: string, error: string): SheetResult {
  return {
    fileName,
    sheetName,
    category,
    headerRow: null,
    modelColumn: null,
    priceColumn: null,
    validRows: 0,
    skippedRows: 0,
    newProducts: 0,
    reusedProducts: 0,
    newOffers: 0,
    skippedOffers: 0,
    fallbackZeroPriceRows: 0,
    error,
  };
}

function buildTotals(input: {
  files: UnlinkedFileRow[];
  fileResults: FileResult[];
  productsBefore: number;
  productsAfter: number;
  offersBefore: number;
  offersAfter: number;
}): Totals {
  const { files, fileResults, productsBefore, productsAfter, offersBefore, offersAfter } = input;
  return {
    mode: APPLY_MODE ? "apply" : "dry-run",
    files: files.length,
    parsedFiles: fileResults.filter((file) => !file.readError && file.validRows > 0).length,
    failedFiles: fileResults.filter((file) => file.readError).length,
    skippedSheets: fileResults.reduce((sum, file) => sum + file.skippedSheets, 0),
    scannedRows: fileResults.reduce((sum, file) => sum + file.scannedRows, 0),
    validRows: fileResults.reduce((sum, file) => sum + file.validRows, 0),
    skippedRows: fileResults.reduce((sum, file) => sum + file.skippedRows, 0),
    newProducts: fileResults.reduce((sum, file) => sum + file.newProducts, 0),
    reusedProducts: fileResults.reduce((sum, file) => sum + file.reusedProducts, 0),
    newOffers: fileResults.reduce((sum, file) => sum + file.newOffers, 0),
    skippedOffers: fileResults.reduce((sum, file) => sum + file.skippedOffers, 0),
    fallbackZeroPriceRows: fileResults.reduce((sum, file) => sum + file.fallbackZeroPriceRows, 0),
    productsBefore,
    productsAfter,
    offersBefore,
    offersAfter,
  };
}

function buildReport(totals: Totals, fileResults: FileResult[], createdProductSamples: CreatedProductSample[]): string {
  const categoryStats = buildCategoryStats(fileResults);
  const factoryStats = buildFactoryStats(fileResults);
  const failedSheets = fileResults.flatMap((file) => file.sheetResults.filter((sheet) => sheet.error));

  return `# V10.3 未关联文件导入报告

模式: ${totals.mode}
时间: ${new Date().toISOString()}

## 汇总

| 指标 | 数值 |
|---|---:|
| 扫描文件数 | ${totals.files.toLocaleString()} |
| 成功解析文件 | ${totals.parsedFiles.toLocaleString()} |
| 解析失败文件 | ${totals.failedFiles.toLocaleString()} |
| 跳过 Sheet | ${totals.skippedSheets.toLocaleString()} |
| 扫描数据行 | ${totals.scannedRows.toLocaleString()} |
| 有效数据行 | ${totals.validRows.toLocaleString()} |
| 跳过数据行 | ${totals.skippedRows.toLocaleString()} |
| 新建产品 | ${totals.newProducts.toLocaleString()} |
| 复用已有产品 | ${totals.reusedProducts.toLocaleString()} |
| 新建 SupplierOffer | ${totals.newOffers.toLocaleString()} |
| 跳过（已存在） | ${totals.skippedOffers.toLocaleString()} |
| 无价格列 / 价格为空，写 0 | ${totals.fallbackZeroPriceRows.toLocaleString()} |
| 产品总数变化 | ${totals.productsBefore.toLocaleString()} → ${totals.productsAfter.toLocaleString()} |
| supplier_offers 变化 | ${totals.offersBefore.toLocaleString()} → ${totals.offersAfter.toLocaleString()} |

## 按品类统计

| 品类 | 文件数 | 新建产品 | 复用产品 | 新建 Offer |
|---|---:|---:|---:|---:|
${categoryStats
  .map(
    (stat) =>
      `| ${escapeMd(stat.category)} | ${stat.fileIds.size.toLocaleString()} | ${stat.newProducts.toLocaleString()} | ${stat.reusedProducts.toLocaleString()} | ${stat.newOffers.toLocaleString()} |`,
  )
  .join("\n")}

## 按工厂统计

| 工厂 | 文件数 | 新建 Offer |
|---|---:|---:|
${factoryStats.map((stat) => `| ${escapeMd(stat.factory)} | ${stat.fileIds.size.toLocaleString()} | ${stat.newOffers.toLocaleString()} |`).join("\n")}

## Sheet 明细（前 200 个）

| 文件名 | Sheet | 品类 | 表头行 | 型号列 | 价格列 | 有效行 | 新产品 | 复用产品 | 新 Offer | 0 价格行 | 问题 |
|---|---|---|---:|---|---|---:|---:|---:|---:|---:|---|
${fileResults
  .flatMap((file) => file.sheetResults)
  .slice(0, 200)
  .map(
    (sheet) =>
      `| ${escapeMd(sheet.fileName)} | ${escapeMd(sheet.sheetName)} | ${escapeMd(sheet.category)} | ${sheet.headerRow ?? "-"} | ${escapeMd(sheet.modelColumn ?? "-")} | ${escapeMd(sheet.priceColumn ?? "-")} | ${sheet.validRows.toLocaleString()} | ${sheet.newProducts.toLocaleString()} | ${sheet.reusedProducts.toLocaleString()} | ${sheet.newOffers.toLocaleString()} | ${sheet.fallbackZeroPriceRows.toLocaleString()} | ${escapeMd(sheet.error ?? "-")} |`,
  )
  .join("\n")}

## 解析失败文件 / Sheet

| 文件名 | Sheet | 原因 |
|---|---|---|
${failedSheets.map((sheet) => `| ${escapeMd(sheet.fileName)} | ${escapeMd(sheet.sheetName)} | ${escapeMd(sheet.error ?? "-")} |`).join("\n")}

## 读取失败文件

| 文件名 | 路径 | 原因 |
|---|---|---|
${fileResults
  .filter((file) => file.readError)
  .map((file) => `| ${escapeMd(file.fileName)} | ${escapeMd(file.relativePath)} | ${escapeMd(file.readError ?? "-")} |`)
  .join("\n")}

## 新建产品采样（前 100 条）

| 型号 | 品类 | 产品名 | 来源文件 |
|---|---|---|---|
${createdProductSamples
  .slice(0, 100)
  .map((sample) => `| ${escapeMd(sample.modelNo)} | ${escapeMd(sample.category)} | ${escapeMd(sample.productName)} | ${escapeMd(sample.sourceFile)} |`)
  .join("\n")}
`;
}

function buildCategoryStats(fileResults: FileResult[]): CategoryStats[] {
  const byCategory = new Map<string, CategoryStats>();
  for (const file of fileResults) {
    const stat = byCategory.get(file.category) ?? { category: file.category, fileIds: new Set<string>(), newProducts: 0, reusedProducts: 0, newOffers: 0 };
    stat.fileIds.add(file.fileId);
    stat.newProducts += file.newProducts;
    stat.reusedProducts += file.reusedProducts;
    stat.newOffers += file.newOffers;
    byCategory.set(file.category, stat);
  }
  return [...byCategory.values()].sort((a, b) => b.newOffers - a.newOffers || a.category.localeCompare(b.category));
}

function buildFactoryStats(fileResults: FileResult[]): FactoryStats[] {
  const byFactory = new Map<string, FactoryStats>();
  for (const file of fileResults) {
    const stat = byFactory.get(file.factory) ?? { factory: file.factory, fileIds: new Set<string>(), newOffers: 0 };
    stat.fileIds.add(file.fileId);
    stat.newOffers += file.newOffers;
    byFactory.set(file.factory, stat);
  }
  return [...byFactory.values()].sort((a, b) => b.newOffers - a.newOffers || a.factory.localeCompare(b.factory));
}

function escapeMd(value: unknown): string {
  return cleanText(value).replace(/\|/g, "\\|");
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
