import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { PrismaClient } from "@prisma/client";
import * as XLSX from "xlsx";

import { parsePriceValue, type SheetRows } from "../src/lib/excel-import";
import { extractImagesFromExcel, storeExtractedImage, type ExtractedImage } from "../src/lib/image-extractor";
import { upsertSupplierOffer, type SupplierOfferUpsertClient } from "../src/lib/supplier-offer-upsert";
import { normalizeCsvPath, resolveRelativePath } from "./classify-tube-bulb";

const prisma = new PrismaClient();

const ROOT = "/Volumes/My Passport/AI 报价/各家工厂最新报价汇总";
const PLAN_PATH = "docs/tube-bulb-split-import-plan.md";
const DEFAULT_REPORT_PATH = "docs/tube-bulb-split-apply-result.md";
const BACKUP_DIR = "backups";
const PRICE_MIN = 0.01;
const PRICE_MAX = 100_000;
const IMAGE_ROW_RADIUS = 3;
const SCAN_CATEGORIES = ["球泡", "灯管"] as const;
const SKIPPABLE_SHEET_NAME = /目录|index|cover|封面/i;

const skipImages = process.argv.includes("--skip-images");
const reportPath = getArgValue("--report") ?? DEFAULT_REPORT_PATH;
const runStartedAt = new Date();

type SplitCategory = (typeof SCAN_CATEGORIES)[number];

function resolveCategory(category: string): string {
  if (category !== "球泡" && category !== "灯管") {
    throw new Error(`V2.17D 不允许写入非拆分品类：${category}`);
  }
  return category;
}

type Candidate = {
  relativePath: string;
  originalRelativePath: string;
  category: string;
  factory: string;
  reason: string;
  plannedSheets: string[];
  strictWhitelist: boolean;
  pathNote: string | null;
  absolutePath: string | null;
  fileName: string;
  size: number;
  modifiedAtMs: number;
  modifiedDate: string;
};

type SplitPlanEntry = {
  relativePath: string;
  factory: string;
  category: SplitCategory;
  sheetNames: string[];
  reason: string;
};

type SplitSkipEntry = {
  relativePath: string;
  factory: string;
  reason: string;
};

type SplitImportPlan = {
  entries: SplitPlanEntry[];
  skipEntries: SplitSkipEntry[];
};

type DiskFile = {
  absolutePath: string;
  relativePath: string;
  fileName: string;
  size: number;
  modifiedAtMs: number;
  modifiedDate: string;
};

type ColumnSignal = {
  index: number;
  letter: string;
  header: string;
  count: number;
  samples: string[];
};

type SheetAnalysis = {
  name: string;
  rowCount: number;
  colCount: number;
  headerRows: number[];
  headerRowIndex: number;
  headers: string[];
  priceColumns: ColumnSignal[];
  rmbPriceColumns: ColumnSignal[];
  usdPriceColumns: ColumnSignal[];
  modelColumns: ColumnSignal[];
  fallbackPrice: boolean;
  skipped: boolean;
  skipReason: string | null;
};

type Mapping = {
  headerRowIndex: number;
  modelColumnIndex: number;
  priceColumnIndex: number;
  descriptionColumns: number[];
  sizeColumn: number | null;
  moqColumn: number | null;
  ctnQtyColumn: number | null;
  ctnSizeColumn: number | null;
  ctnLengthColumn: number | null;
  ctnWidthColumn: number | null;
  ctnHeightColumn: number | null;
};

type ImportRow = {
  candidate: Candidate;
  sheetName: string;
  category: string;
  modelNo: string;
  productName: string;
  size: string | null;
  remark: string | null;
  factoryName: string;
  purchasePrice: string;
  currency: string;
  moq: string | null;
  ctnQty: string | null;
  ctnLength: string | null;
  ctnWidth: string | null;
  ctnHeight: string | null;
  sourceRowIndex: number;
};

type BuiltFile = {
  candidate: Candidate;
  sheets: Array<{
    name: string;
    analysis: SheetAnalysis;
    mapping: Mapping;
    rows: ImportRow[];
    skippedRows: Array<{ rowNumber: number; reason: string; sample: string }>;
  }>;
  readError: string | null;
  detection: {
    sheets: number;
    headerDetected: boolean;
    modelDetected: boolean;
    rmbPriceDetected: boolean;
    fallbackPrice: boolean;
    unableToDetect: boolean;
  };
};

type FileResult = {
  candidate: Candidate;
  sheets: number;
  importRows: number;
  skippedRows: number;
  success: boolean;
  skippedNoSheet: boolean;
  readFailed: boolean;
  error: string | null;
  newProducts: number;
  reusedProducts: number;
  newOffers: number;
  updatedOffers: number;
  supplementedOffers: number;
  skippedOffers: number;
  images: number;
  imageFailures: number;
  priceHistory: number;
  detection: BuiltFile["detection"];
  sheetResults: SheetApplyResult[];
};

type SheetApplyResult = {
  relativePath: string;
  category: string;
  factory: string;
  sheetName: string;
  headerRow: number | null;
  modelColumn: string;
  priceColumn: string;
  validRows: number;
  skippedRows: number;
  newProducts: number;
  reusedProducts: number;
  newOffers: number;
  updatedOffers: number;
  supplementedOffers: number;
  duplicateOffers: number;
  priceHistory: number;
  error: string | null;
};

type ApplySample = {
  productId: string;
  modelNo: string;
  category: string;
  factory: string;
  sheetName: string;
  price: string;
};

type Totals = Omit<FileResult, "candidate" | "error" | "detection" | "sheetResults"> & {
  inputFiles: number;
};

type DbCounts = {
  products: number;
  supplierOffers: number;
  filesMyPassport: number;
  productImages: number;
  priceHistory: number;
  productParams: number;
  danglingOfferRefs: number;
  categories: Record<string, number>;
};

async function main() {
  if (!existsSync(ROOT)) {
    throw new Error(`硬盘目录不可访问：${ROOT}`);
  }
  if (!existsSync(PLAN_PATH)) {
    throw new Error(`拆分导入计划不存在：${PLAN_PATH}`);
  }

  const diskIndex = await buildDiskIndex(ROOT);
  const plan = parseSplitImportPlan(await readFile(PLAN_PATH, "utf8"));
  const candidates = await loadCandidates(plan, diskIndex);
  const backupPath = await backupDatabase();
  const beforeCounts = await getDbCounts();
  const samples: { newProducts: ApplySample[]; updatedOffers: ApplySample[] } = {
    newProducts: [],
    updatedOffers: [],
  };
  const results = await runApply(candidates, samples);
  const afterCounts = await getDbCounts();

  await mkdir("docs", { recursive: true });
  await writeFile(
    reportPath,
    buildReport({
      backupPath,
      beforeCounts,
      afterCounts,
      results,
      samples,
      skipEntries: plan.skipEntries,
    }),
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        mode: "apply",
        inputFiles: candidates.length,
        successFiles: results.filter((result) => result.success).length,
        skippedNoSheet: results.filter((result) => result.skippedNoSheet).length,
        readFailures: results.filter((result) => result.readFailed).length,
        backupPath,
        reportPath,
      },
      null,
      2,
    ),
  );
}

function getArgValue(flag: string): string | null {
  const equalsPrefix = `${flag}=`;
  const equalsArg = process.argv.find((arg) => arg.startsWith(equalsPrefix));
  if (equalsArg) {
    return equalsArg.slice(equalsPrefix.length) || null;
  }

  const index = process.argv.indexOf(flag);
  if (index >= 0) {
    const value = process.argv[index + 1];
    if (value && !value.startsWith("--")) {
      return value;
    }
  }

  return null;
}

async function buildDiskIndex(root: string): Promise<Map<string, DiskFile>> {
  const index = new Map<string, DiskFile>();
  await walk(root);
  return index;

  async function walk(currentPath: string) {
    const entries = await readdir(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const name = normalizeText(entry.name);
      if (name.startsWith(".") || name.startsWith("~$")) {
        continue;
      }

      const absolutePath = path.join(currentPath, entry.name);
      if (entry.isSymbolicLink()) {
        continue;
      }
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      if (!entry.isFile() || !/\.(xlsx|xls)$/i.test(name)) {
        continue;
      }

      const fileStat = await stat(absolutePath);
      const relativePath = portableRelative(root, absolutePath);
      index.set(normalizeKey(relativePath), {
        absolutePath,
        relativePath,
        fileName: name,
        size: fileStat.size,
        modifiedAtMs: fileStat.mtimeMs,
        modifiedDate: formatDate(new Date(fileStat.mtimeMs)),
      });
    }
  }
}

async function loadCandidates(plan: SplitImportPlan, diskIndex: Map<string, DiskFile>): Promise<Candidate[]> {
  const pathCounts = new Map<string, number>();
  for (const entry of plan.entries) {
    pathCounts.set(entry.relativePath, (pathCounts.get(entry.relativePath) ?? 0) + 1);
  }

  const candidates: Candidate[] = [];
  for (const entry of plan.entries) {
    const resolved = await resolveDiskPath(entry.relativePath, diskIndex);
    const diskFile = diskIndex.get(normalizeKey(resolved.relativePath)) ?? null;
    candidates.push({
      relativePath: resolved.relativePath,
      originalRelativePath: entry.relativePath,
      category: entry.category,
      factory: entry.factory,
      reason: entry.reason,
      plannedSheets: entry.sheetNames,
      strictWhitelist: (pathCounts.get(entry.relativePath) ?? 0) > 1,
      pathNote: resolved.note,
      absolutePath: diskFile?.absolutePath ?? null,
      fileName: diskFile?.fileName ?? path.basename(resolved.relativePath),
      size: diskFile?.size ?? 0,
      modifiedAtMs: diskFile?.modifiedAtMs ?? 0,
      modifiedDate: diskFile?.modifiedDate ?? "",
    });
  }

  return candidates;
}

export function parseSplitImportPlan(markdown: string): SplitImportPlan {
  const entries: SplitPlanEntry[] = [];
  const skipEntries: SplitSkipEntry[] = [];
  let section: "bulb" | "tube" | "skip" | null = null;

  for (const line of markdown.split(/\r?\n/)) {
    if (line.startsWith("## ")) {
      if (line.includes("直接导入为球泡")) {
        section = "bulb";
      } else if (line.includes("直接导入为灯管")) {
        section = "tube";
      } else if (line.includes("Skip 文件")) {
        section = "skip";
      } else {
        section = null;
      }
      continue;
    }

    if (!section || !line.trim().startsWith("|") || /^\|\s*-+/.test(line)) {
      continue;
    }
    const cells = splitMarkdownRow(line);
    if (cells[0] === "文件") {
      continue;
    }

    if ((section === "bulb" || section === "tube") && cells.length >= 4) {
      entries.push({
        relativePath: normalizeCsvPath(cells[0]),
        factory: normalizeText(cells[1]),
        category: section === "bulb" ? "球泡" : "灯管",
        sheetNames: splitSheetNames(cells[2]),
        reason: normalizeText(cells[3]),
      });
    } else if (section === "skip" && cells.length >= 3 && cells[0] !== "-") {
      skipEntries.push({
        relativePath: normalizeCsvPath(cells[0]),
        factory: normalizeText(cells[1]),
        reason: normalizeText(cells[2]),
      });
    }
  }

  return { entries, skipEntries };
}

function selectPlannedSheets({
  availableSheets,
  plannedSheets,
  strictWhitelist,
}: {
  availableSheets: string[];
  plannedSheets: string[];
  strictWhitelist: boolean;
}): { selectedSheets: string[]; missingSheets: string[] } {
  if (!strictWhitelist) {
    return { selectedSheets: availableSheets, missingSheets: [] };
  }

  const availableByKey = new Map(availableSheets.map((sheet) => [normalizeSheetKey(sheet), sheet]));
  const selectedSheets: string[] = [];
  const missingSheets: string[] = [];
  for (const sheet of plannedSheets) {
    const matched = availableByKey.get(normalizeSheetKey(sheet));
    if (matched) {
      selectedSheets.push(matched);
    } else {
      missingSheets.push(sheet);
    }
  }
  return { selectedSheets, missingSheets };
}

async function resolveDiskPath(
  relativePath: string,
  diskIndex: Map<string, DiskFile>,
): Promise<{ relativePath: string; note: string | null }> {
  if (diskIndex.has(normalizeKey(relativePath))) {
    return { relativePath, note: null };
  }

  const directory = path.posix.dirname(relativePath);
  const absoluteDirectory = path.join(ROOT, directory);
  try {
    const entries = await readdir(absoluteDirectory, { withFileTypes: true });
    const available = entries
      .filter((entry) => entry.isFile())
      .filter((entry) => !entry.name.startsWith(".") && !entry.name.startsWith("~$"))
      .filter((entry) => /\.(xlsx|xls)$/i.test(entry.name))
      .map((entry) => path.posix.join(directory, normalizeCsvPath(entry.name)));
    return resolveRelativePath(relativePath, available);
  } catch {
    return { relativePath, note: null };
  }
}

function splitMarkdownRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let current = "";
  let escaped = false;
  for (const char of trimmed) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "|") {
      cells.push(normalizeCsvPath(current));
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(normalizeCsvPath(current));
  return cells;
}

function splitSheetNames(value: string): string[] {
  const normalized = normalizeCsvPath(value);
  if (!normalized || normalized === "-" || normalized === "全部/待读取") {
    return [];
  }
  return normalized
    .split(",")
    .map(normalizeCsvPath)
    .filter(Boolean);
}

async function runApply(
  candidates: Candidate[],
  samples: { newProducts: ApplySample[]; updatedOffers: ApplySample[] },
): Promise<FileResult[]> {
  const results: FileResult[] = [];
  for (const [index, candidate] of candidates.entries()) {
    if ((index + 1) % 10 === 0 || index === 0) {
      console.log(`Apply ${index + 1}/${candidates.length}: ${candidate.relativePath}`);
    }

    const built = await buildFile(candidate);
    const result = emptyFileResult(candidate, built);
    if (built.readError) {
      result.readFailed = true;
      result.error = built.readError;
      results.push(result);
      continue;
    }
    if (built.sheets.length === 0) {
      result.skippedNoSheet = true;
      result.error = "无可导入 sheet";
      results.push(result);
      continue;
    }

    try {
      const fileRecord = await ensureFileRecord(candidate);
      const rowProductRefs: Array<{ productId: string; sheetName: string; sourceRowIndex: number }> = [];
      await prisma.$transaction(async (tx) => {
        const productCache = new Map<string, string>();
        for (const sheet of built.sheets) {
          const sheetResult = emptySheetApplyResult(candidate, sheet);
          result.sheetResults.push(sheetResult);
          result.sheets += 1;
          result.importRows += sheet.rows.length;
          result.skippedRows += sheet.skippedRows.length;
          sheetResult.validRows = sheet.rows.length;
          sheetResult.skippedRows = sheet.skippedRows.length;
          for (const row of sheet.rows) {
            const cacheKey = productKey(row.modelNo);
            if (!cacheKey) continue;

            let productId = productCache.get(cacheKey);
            if (!productId) {
              const existingProduct = await tx.product.findFirst({
                where: { modelNo: row.modelNo },
                orderBy: [{ createdAt: "asc" }],
                select: { id: true },
              });

              if (existingProduct) {
                productId = existingProduct.id;
                result.reusedProducts += 1;
                sheetResult.reusedProducts += 1;
              } else {
                const createdProduct = await tx.product.create({
                  data: {
                    productName: row.productName,
                    category: resolveCategory(row.category),
                    modelNo: row.modelNo,
                    material: null,
                    size: row.size,
                    imagePath: null,
                    remark: row.remark,
                  },
                  select: { id: true },
                });
                productId = createdProduct.id;
                result.newProducts += 1;
                sheetResult.newProducts += 1;
                if (samples.newProducts.length < 10) {
                  samples.newProducts.push({
                    productId,
                    modelNo: row.modelNo,
                    category: resolveCategory(row.category),
                    factory: row.factoryName,
                    sheetName: row.sheetName,
                    price: row.purchasePrice,
                  });
                }
              }
              productCache.set(cacheKey, productId);
            } else {
              result.reusedProducts += 1;
              sheetResult.reusedProducts += 1;
            }

            const upsert = await upsertSupplierOffer(
              tx as unknown as SupplierOfferUpsertClient,
              {
                productId,
                factoryName: row.factoryName,
                purchasePrice: row.purchasePrice,
                currency: row.currency,
                moq: row.moq,
                ctnQty: row.ctnQty,
                ctnLength: row.ctnLength,
                ctnWidth: row.ctnWidth,
                ctnHeight: row.ctnHeight,
                sourceFileId: fileRecord.id,
                remark: null,
              },
              runStartedAt,
            );

            if (upsert.status === "created") {
              result.newOffers += 1;
              sheetResult.newOffers += 1;
            } else if (upsert.status === "updated") {
              if (upsert.priceChanged) {
                result.updatedOffers += 1;
                result.priceHistory += 1;
                sheetResult.updatedOffers += 1;
                sheetResult.priceHistory += 1;
                if (samples.updatedOffers.length < 10) {
                  samples.updatedOffers.push({
                    productId,
                    modelNo: row.modelNo,
                    category: resolveCategory(row.category),
                    factory: row.factoryName,
                    sheetName: row.sheetName,
                    price: row.purchasePrice,
                  });
                }
              }
              if (upsert.supplemented) {
                result.supplementedOffers += 1;
                sheetResult.supplementedOffers += 1;
              }
            } else {
              result.skippedOffers += 1;
              sheetResult.duplicateOffers += 1;
            }

            rowProductRefs.push({ productId, sheetName: row.sheetName, sourceRowIndex: row.sourceRowIndex });
          }
        }
      });

      if (!skipImages) {
        const imageResult = await attachImages(candidate, fileRecord.id, rowProductRefs);
        result.images = imageResult.importedImages;
        result.imageFailures = imageResult.failedImages;
      }
      result.success = true;
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
      if (result.sheetResults.length === 0) {
        result.sheetResults.push({
          relativePath: candidate.relativePath,
          category: candidate.category,
          factory: candidate.factory,
          sheetName: "-",
          headerRow: null,
          modelColumn: "-",
          priceColumn: "-",
          validRows: 0,
          skippedRows: 0,
          newProducts: 0,
          reusedProducts: 0,
          newOffers: 0,
          updatedOffers: 0,
          supplementedOffers: 0,
          duplicateOffers: 0,
          priceHistory: 0,
          error: result.error,
        });
      } else {
        for (const sheetResult of result.sheetResults) {
          sheetResult.error = result.error;
        }
      }
    }

    results.push(result);
  }
  return results;
}

async function buildFile(candidate: Candidate): Promise<BuiltFile> {
  if (!candidate.absolutePath) {
    return emptyBuiltFile(candidate, "文件在硬盘上不存在");
  }

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.readFile(candidate.absolutePath, { cellDates: false, WTF: false });
  } catch (error) {
    return emptyBuiltFile(candidate, error instanceof Error ? error.message : String(error));
  }

  const selection = selectPlannedSheets({
    availableSheets: workbook.SheetNames,
    plannedSheets: candidate.plannedSheets,
    strictWhitelist: candidate.strictWhitelist,
  });
  if (selection.missingSheets.length > 0) {
    return emptyBuiltFile(candidate, `计划 sheet 在文件中不存在：${selection.missingSheets.join(", ")}`);
  }

  const sheets: BuiltFile["sheets"] = [];
  const analyses: SheetAnalysis[] = [];
  for (const sheetName of selection.selectedSheets) {
    const worksheet = workbook.Sheets[sheetName];
    const rows = normalizeRows(
      XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
        header: 1,
        raw: false,
        defval: "",
        blankrows: false,
      }),
    );
    const analysis = analyzeSheet(sheetName, rows, candidate.fileName);
    analyses.push(analysis);
    if (analysis.skipped) {
      continue;
    }

    const mapping = buildMapping(rows, analysis);
    const builtRows = buildImportRows(candidate, sheetName, rows, mapping);
    if (builtRows.rows.length < 3) {
      continue;
    }

    sheets.push({
      name: sheetName,
      analysis,
      mapping,
      rows: builtRows.rows,
      skippedRows: builtRows.skippedRows,
    });
  }

  const headerDetected = analyses.some((analysis) => analysis.headerRows.length > 0);
  const modelDetected = analyses.some((analysis) => analysis.modelColumns.length > 0);
  const rmbPriceDetected = analyses.some((analysis) => analysis.rmbPriceColumns.length > 0);
  const fallbackPrice = analyses.some((analysis) => analysis.fallbackPrice);
  return {
    candidate,
    sheets,
    readError: null,
    detection: {
      sheets: analyses.length,
      headerDetected,
      modelDetected,
      rmbPriceDetected,
      fallbackPrice,
      unableToDetect: sheets.length === 0,
    },
  };
}

function analyzeSheet(sheetName: string, rows: SheetRows, fileName: string): SheetAnalysis {
  const rowCount = rows.length;
  const colCount = Math.max(0, ...rows.map((row) => row.length));
  if (rowCount === 0 || colCount === 0) {
    return emptySheetAnalysis(sheetName, "空 sheet");
  }
  if (SKIPPABLE_SHEET_NAME.test(sheetName)) {
    return emptySheetAnalysis(sheetName, "目录/封面 sheet");
  }

  const headerRows = findHeaderRows(rows);
  const headerRowIndex = headerRows[0] ? headerRows[0] - 1 : findBestHeaderIndex(rows);
  const headers = buildHeaders(rows, headerRowIndex, colCount);
  const threshold = rowCount < 30 ? 3 : 5;
  const filePriceHint = priceHintFromText(fileName);

  const priceColumns: ColumnSignal[] = [];
  const rmbPriceColumns: ColumnSignal[] = [];
  const usdPriceColumns: ColumnSignal[] = [];
  const modelColumns: ColumnSignal[] = [];

  for (let index = 0; index < colCount; index += 1) {
    const values = rows.map((row) => row[index] ?? "").slice(headerRowIndex + 1);
    const nonEmptyValues = values.filter(Boolean);
    const header = headers[index] ?? "";
    const priceValues = nonEmptyValues.filter((value) => parsePositivePrice(value) !== null);
    const modelValues = nonEmptyValues.filter((value) => isLikelyModelValue(value) || isLikelyModelHeader(header));
    const priceSamples = uniqueSamples(priceValues);
    const modelSamples = uniqueSamples(nonEmptyValues.filter(isLikelyModelValue));

    if (priceValues.length >= threshold) {
      const signal = columnSignal(index, header, priceValues.length, priceSamples);
      if (!header.trim()) {
        // No header: numeric density alone is not enough to trust this as a price column.
      } else if (!(isNonPriceHeader(header) && !isPriceHeader(header))) {
        priceColumns.push(signal);
        if (isUsdPriceHeader(header) || filePriceHint === "usd") {
          usdPriceColumns.push(signal);
        }
        if (isRmbPriceHeader(header) || (filePriceHint === "rmb" && !isUsdPriceHeader(header))) {
          rmbPriceColumns.push(signal);
        }
      }
    }

    if (modelValues.length >= threshold) {
      modelColumns.push(columnSignal(index, header, modelValues.length, modelSamples));
    }
  }

  priceColumns.sort(sortSignal);
  rmbPriceColumns.sort(sortSignal);
  usdPriceColumns.sort(sortSignal);
  modelColumns.sort(sortSignal);

  const fallbackPrice = rmbPriceColumns.length === 0 && priceColumns.length > 0 && filePriceHint === "rmb";
  const selectedPriceColumn = rmbPriceColumns[0] ?? priceColumns[0];
  const sameModelAndPriceColumn = modelColumns[0] && selectedPriceColumn && modelColumns[0].index === selectedPriceColumn.index;
  const hasImportColumns = modelColumns.length > 0 && (rmbPriceColumns.length > 0 || fallbackPrice) && !sameModelAndPriceColumn;
  if (!hasImportColumns) {
    return {
      name: sheetName,
      rowCount,
      colCount,
      headerRows,
      headerRowIndex,
      headers,
      priceColumns,
      rmbPriceColumns,
      usdPriceColumns,
      modelColumns,
      fallbackPrice,
      skipped: true,
      skipReason: sameModelAndPriceColumn ? "型号列和价格列相同" : "未检测到型号列或 RMB 价格列",
    };
  }

  return {
    name: sheetName,
    rowCount,
    colCount,
    headerRows,
    headerRowIndex,
    headers,
    priceColumns,
    rmbPriceColumns,
    usdPriceColumns,
    modelColumns,
    fallbackPrice,
    skipped: false,
    skipReason: null,
  };
}

function emptySheetAnalysis(sheetName: string, reason: string): SheetAnalysis {
  return {
    name: sheetName,
    rowCount: 0,
    colCount: 0,
    headerRows: [],
    headerRowIndex: 0,
    headers: [],
    priceColumns: [],
    rmbPriceColumns: [],
    usdPriceColumns: [],
    modelColumns: [],
    fallbackPrice: false,
    skipped: true,
    skipReason: reason,
  };
}

function buildMapping(rows: SheetRows, analysis: SheetAnalysis): Mapping {
  const modelColumnIndex = analysis.modelColumns[0].index;
  const priceColumnIndex = (analysis.rmbPriceColumns[0] ?? analysis.priceColumns[0]).index;
  const excluded = new Set([modelColumnIndex, priceColumnIndex]);
  const columns = analysis.headers.map((header, index) => ({ index, header }));
  const descriptionColumns = columns
    .filter((column) => {
      if (excluded.has(column.index)) return false;
      if (!column.header) return false;
      if (isPhotoHeader(column.header) || isNoHeader(column.header) || isPriceHeader(column.header)) return false;
      return isDescriptionHeader(column.header);
    })
    .map((column) => column.index)
    .slice(0, 12);

  return {
    headerRowIndex: analysis.headerRowIndex,
    modelColumnIndex,
    priceColumnIndex,
    descriptionColumns,
    sizeColumn: findColumn(columns, [/^size$/i, /dimension/i, /product size/i, /尺寸/, /规格/], excluded),
    moqColumn: findColumn(columns, [/moq/i, /起订/, /最小起订/], excluded),
    ctnQtyColumn: findColumn(columns, [/ctn.*qty/i, /qty.*ctn/i, /pcs.*ctn/i, /装箱/, /每箱/, /外箱.*数量/, /case pack/i], excluded),
    ctnSizeColumn: findColumn(columns, [/carton.*size/i, /ctn.*size/i, /outer.*box/i, /箱规/, /外箱.*尺寸/, /包装.*尺寸/, /纸箱.*尺寸/], excluded),
    ctnLengthColumn: findColumn(columns, [/^l$/i, /^length$/i, /ctn l/i, /carton.*l/i, /^长$/, /长度/], excluded),
    ctnWidthColumn: findColumn(columns, [/^w$/i, /^width$/i, /ctn w/i, /carton.*w/i, /^宽$/, /宽度/], excluded),
    ctnHeightColumn: findColumn(columns, [/^h$/i, /^height$/i, /ctn h/i, /carton.*h/i, /^高$/, /高度/], excluded),
  };
}

function buildImportRows(candidate: Candidate, sheetName: string, rows: SheetRows, mapping: Mapping) {
  const importRows: ImportRow[] = [];
  const skippedRows: Array<{ rowNumber: number; reason: string; sample: string }> = [];
  let lastModelNo: string | null = null;

  for (let rowIndex = mapping.headerRowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    const rowNumber = rowIndex + 1;
    if (isEmptyRow(row)) {
      continue;
    }

    const nonEmptyCells = row.map(normalizeText).filter(Boolean);
    if (nonEmptyCells.length === 1) {
      skippedRows.push({ rowNumber, reason: "分类/小标题行", sample: nonEmptyCells[0] });
      continue;
    }

    const rawPrice = cellAt(row, mapping.priceColumnIndex);
    const purchasePrice = parsePriceValue(rawPrice);
    const priceNumber = purchasePrice ? Number(purchasePrice) : NaN;
    let modelNo = cleanModelNo(cellAt(row, mapping.modelColumnIndex));
    if (modelNo) {
      lastModelNo = modelNo;
    } else if (purchasePrice && lastModelNo) {
      modelNo = lastModelNo;
    }

    if (!modelNo) {
      skippedRows.push({ rowNumber, reason: "缺少产品款号", sample: nonEmptyCells.slice(0, 4).join(" / ") });
      continue;
    }
    if (!purchasePrice || !Number.isFinite(priceNumber) || priceNumber < PRICE_MIN || priceNumber > PRICE_MAX) {
      skippedRows.push({ rowNumber, reason: "价格列非有效 RMB 数字", sample: rawPrice ?? nonEmptyCells.slice(0, 4).join(" / ") });
      continue;
    }
    if (isHeaderLikeModel(modelNo)) {
      skippedRows.push({ rowNumber, reason: "表头/说明行被跳过", sample: modelNo });
      continue;
    }

    const dimensions = readCtnDimensions(row, mapping);
    importRows.push({
      candidate,
      sheetName,
      category: candidate.category,
      modelNo,
      productName: modelNo,
      size: cellAt(row, mapping.sizeColumn),
      remark: mergeDescription(row, rows, mapping),
      factoryName: candidate.factory,
      purchasePrice,
      currency: "RMB",
      moq: cellAt(row, mapping.moqColumn),
      ctnQty: cleanIntegerText(cellAt(row, mapping.ctnQtyColumn)),
      ctnLength: dimensions.length,
      ctnWidth: dimensions.width,
      ctnHeight: dimensions.height,
      sourceRowIndex: rowIndex,
    });
  }

  return { rows: importRows, skippedRows };
}

async function ensureFileRecord(candidate: Candidate) {
  if (!candidate.absolutePath) {
    throw new Error("文件在硬盘上不存在，无法建立 file record");
  }

  const existing = await prisma.file.findUnique({
    where: {
      volumeName_relativePath: {
        volumeName: "My Passport",
        relativePath: candidate.relativePath,
      },
    },
  });
  if (existing) {
    return existing;
  }

  const fileStat = await stat(candidate.absolutePath);
  return prisma.file.create({
    data: {
      fileName: candidate.fileName,
      fileType: "excel",
      fileSize: BigInt(fileStat.size),
      folderName: candidate.category,
      factoryGuess: candidate.factory,
      volumeName: "My Passport",
      relativePath: candidate.relativePath,
      absolutePathSnapshot: candidate.absolutePath,
      modifiedAt: fileStat.mtime,
    },
  });
}

async function attachImages(
  candidate: Candidate,
  sourceFileId: string,
  rowRefs: Array<{ productId: string; sheetName: string; sourceRowIndex: number }>,
): Promise<{ importedImages: number; failedImages: number }> {
  if (!candidate.absolutePath || rowRefs.length === 0) {
    return { importedImages: 0, failedImages: 0 };
  }

  let extractedImages: ExtractedImage[];
  try {
    extractedImages = await extractImagesFromExcel(candidate.absolutePath);
  } catch {
    return { importedImages: 0, failedImages: 1 };
  }
  if (extractedImages.length === 0) {
    return { importedImages: 0, failedImages: 0 };
  }

  const products = await prisma.product.findMany({
    where: { id: { in: Array.from(new Set(rowRefs.map((row) => row.productId))) } },
    select: { id: true, imagePath: true },
  });
  const imageByProductId = new Map(products.map((product) => [product.id, product.imagePath]));
  const uniqueRows = dedupeRowRefs(rowRefs);
  let importedImages = 0;
  let failedImages = 0;

  for (const row of uniqueRows) {
    if (imageByProductId.get(row.productId)) {
      continue;
    }
    const image = findNearestImage(extractedImages, row.sheetName, row.sourceRowIndex);
    if (!image) {
      continue;
    }

    try {
      const stored = await storeExtractedImage({ image, sourceFileId, sheetName: row.sheetName });
      await prisma.product.update({
        where: { id: row.productId },
        data: { imagePath: stored.thumbnailPath },
      });
      imageByProductId.set(row.productId, stored.thumbnailPath);
      importedImages += 1;
    } catch {
      failedImages += 1;
    }
  }

  return { importedImages, failedImages };
}

function findNearestImage(images: ExtractedImage[], sheetName: string, sourceRowIndex: number): ExtractedImage | null {
  return (
    images
      .filter((image) => normalizeText(image.sheetName) === normalizeText(sheetName))
      .map((image) => ({ image, distance: Math.abs(image.anchorRow - sourceRowIndex) }))
      .filter((match) => match.distance <= IMAGE_ROW_RADIUS)
      .sort((a, b) => a.distance - b.distance)[0]?.image ?? null
  );
}

function dedupeRowRefs(rowRefs: Array<{ productId: string; sheetName: string; sourceRowIndex: number }>) {
  const seen = new Set<string>();
  const out: Array<{ productId: string; sheetName: string; sourceRowIndex: number }> = [];
  for (const row of rowRefs) {
    if (seen.has(row.productId)) continue;
    seen.add(row.productId);
    out.push(row);
  }
  return out;
}

async function backupDatabase(): Promise<string> {
  await mkdir(BACKUP_DIR, { recursive: true });
  const stamp = runStartedAt
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\..+$/, "")
    .replace("T", "-");
  const backupPath = path.join(BACKUP_DIR, `dev-before-v2.17g-tube-bulb-${stamp}.sqlite`);
  await copyFile("prisma/dev.db", backupPath);
  return backupPath;
}

async function getDbCounts(): Promise<DbCounts> {
  const [
    products,
    supplierOffers,
    filesMyPassport,
    productImages,
    priceHistory,
    productParams,
    danglingOfferRefs,
    categories,
  ] = await Promise.all([
    prisma.product.count(),
    prisma.supplierOffer.count(),
    prisma.file.count({ where: { volumeName: "My Passport" } }),
    prisma.product.count({ where: { imagePath: { not: null } } }),
    prisma.priceHistory.count(),
    prisma.productParam.count(),
    prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) as count
      FROM supplier_offers so
      WHERE so.source_file_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM files f WHERE f.id = so.source_file_id)
    `,
    prisma.product.groupBy({
      by: ["category"],
      _count: { _all: true },
    }),
  ]);

  return {
    products,
    supplierOffers,
    filesMyPassport,
    productImages,
    priceHistory,
    productParams,
    danglingOfferRefs: Number(danglingOfferRefs[0]?.count ?? 0),
    categories: Object.fromEntries(categories.map((row) => [row.category ?? "(null)", row._count._all])),
  };
}

function buildReport({
  backupPath,
  beforeCounts,
  afterCounts,
  results,
  samples,
  skipEntries,
}: {
  backupPath: string;
  beforeCounts: DbCounts;
  afterCounts: DbCounts;
  results: FileResult[];
  samples: { newProducts: ApplySample[]; updatedOffers: ApplySample[] };
  skipEntries: SplitSkipEntry[];
}): string {
  const totals = results.reduce((acc, result) => {
    acc.inputFiles += 1;
    acc.sheets += result.sheets;
    acc.importRows += result.importRows;
    acc.skippedRows += result.skippedRows;
    acc.success = acc.success || result.success;
    acc.skippedNoSheet = acc.skippedNoSheet || result.skippedNoSheet;
    acc.readFailed = acc.readFailed || result.readFailed;
    acc.newProducts += result.newProducts;
    acc.reusedProducts += result.reusedProducts;
    acc.newOffers += result.newOffers;
    acc.updatedOffers += result.updatedOffers;
    acc.supplementedOffers += result.supplementedOffers;
    acc.skippedOffers += result.skippedOffers;
    acc.images += result.images;
    acc.imageFailures += result.imageFailures;
    acc.priceHistory += result.priceHistory;
    return acc;
  }, emptyTotals());

  const categorySummary = buildCategorySummary(results);
  const detectionSummary = buildDetectionSummary(results);
  const skippedOrFailed = results.filter((result) => result.skippedNoSheet || result.readFailed || result.error);
  const successCount = results.filter((result) => result.success).length;
  const skippedCount = results.filter((result) => result.skippedNoSheet).length;
  const readFailedCount = results.filter((result) => result.readFailed).length;
  const sheetResults = results.flatMap((result) => result.sheetResults);
  const pathNotes = results.filter((result) => result.candidate.pathNote);

  const lines: string[] = [
    "# V2.17G — 灯管/球泡拆分导入 Apply Result",
    "",
    `Generated: ${new Date().toISOString()}`,
    "Mode: apply",
    `Backup: \`${backupPath}\``,
    `Images: ${skipImages ? "skipped by flag" : "enabled"}`,
    "",
    "## 总览",
    "",
    "| 指标 | 值 |",
    "|---|---:|",
    `| 输入文件 | ${results.length} |`,
    `| 成功处理 | ${successCount} |`,
    `| 跳过（无可导入 sheet） | ${skippedCount} |`,
    `| 读取失败 | ${readFailedCount} |`,
    `| 可导入 sheets | ${totals.sheets} |`,
    `| 数据行 | ${totals.importRows} |`,
    `| 跳过行 | ${totals.skippedRows} |`,
    `| 新建产品 | ${totals.newProducts} |`,
    `| 复用产品 | ${totals.reusedProducts} |`,
    `| 新建 offers | ${totals.newOffers} |`,
    `| 更新 offers（价格变动） | ${totals.updatedOffers} |`,
    `| 补充 offers（CTN/MOQ） | ${totals.supplementedOffers} |`,
    `| 跳过 offers（无变化） | ${totals.skippedOffers} |`,
    `| 图片新提取 | ${totals.images} |`,
    `| 图片失败 | ${totals.imageFailures} |`,
    `| price_history 新增 | ${totals.priceHistory} |`,
    "",
    "## Before / After Counts",
    "",
    "| 表/范围 | Before | After | Delta |",
    "|---|---:|---:|---:|",
    `| products | ${beforeCounts.products} | ${afterCounts.products} | ${formatDelta(afterCounts.products - beforeCounts.products)} |`,
    `| supplier_offers | ${beforeCounts.supplierOffers} | ${afterCounts.supplierOffers} | ${formatDelta(afterCounts.supplierOffers - beforeCounts.supplierOffers)} |`,
    `| price_history | ${beforeCounts.priceHistory} | ${afterCounts.priceHistory} | ${formatDelta(afterCounts.priceHistory - beforeCounts.priceHistory)} |`,
    `| 球泡 products | ${beforeCounts.categories["球泡"] ?? 0} | ${afterCounts.categories["球泡"] ?? 0} | ${formatDelta((afterCounts.categories["球泡"] ?? 0) - (beforeCounts.categories["球泡"] ?? 0))} |`,
    `| 灯管 products | ${beforeCounts.categories["灯管"] ?? 0} | ${afterCounts.categories["灯管"] ?? 0} | ${formatDelta((afterCounts.categories["灯管"] ?? 0) - (beforeCounts.categories["灯管"] ?? 0))} |`,
    "",
    "## 品类汇总",
    "",
    "| 品类 | 文件 | 成功 | 数据行 | 新产品 | 复用 | 新 offers | 更新 | 补充 | 图片 |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...SCAN_CATEGORIES.map((category) => {
      const row = categorySummary.get(category);
      return `| ${escapeMd(formatCategoryLabel(category))} | ${row?.files ?? 0} | ${row?.success ?? 0} | ${row?.importRows ?? 0} | ${row?.newProducts ?? 0} | ${row?.reusedProducts ?? 0} | ${row?.newOffers ?? 0} | ${row?.updatedOffers ?? 0} | ${row?.supplementedOffers ?? 0} | ${row?.images ?? 0} |`;
    }),
    "",
    "## 每文件/Sheet 明细",
    "",
    "| 文件 | 品类 | 工厂 | Sheet | Header Row | Model Column | Price Column | valid | skipped | new products | reused products | new offers | updated offers | duplicate offers | price_history | error |",
    "|---|---|---|---|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|",
    ...sheetResults.map(
      (sheet) =>
        `| ${escapeMd(sheet.relativePath)} | ${escapeMd(sheet.category)} | ${escapeMd(sheet.factory)} | ${escapeMd(sheet.sheetName)} | ${sheet.headerRow ?? "-"} | ${escapeMd(sheet.modelColumn)} | ${escapeMd(sheet.priceColumn)} | ${sheet.validRows} | ${sheet.skippedRows} | ${sheet.newProducts} | ${sheet.reusedProducts} | ${sheet.newOffers} | ${sheet.updatedOffers} | ${sheet.duplicateOffers} | ${sheet.priceHistory} | ${escapeMd(sheet.error ?? "-")} |`,
    ),
    "",
    "## 跳过/失败项",
    "",
    "| 文件 | 品类 | 工厂 | 原因 |",
    "|---|---|---|---|",
    ...(skippedOrFailed.length > 0
      ? skippedOrFailed.map(
          (result) =>
            `| ${escapeMd(result.candidate.relativePath)} | ${escapeMd(result.candidate.category)} | ${escapeMd(result.candidate.factory)} | ${escapeMd(result.error ?? "未知")} |`,
        )
      : ["| - | - | - | - |"]),
    "",
    "## 计划 Skip 文件",
    "",
    "| 文件 | 工厂 | 理由 |",
    "|---|---|---|",
    ...(skipEntries.length > 0
      ? skipEntries.map((item) => `| ${escapeMd(item.relativePath)} | ${escapeMd(item.factory)} | ${escapeMd(item.reason)} |`)
      : ["| - | - | - |"]),
    "",
    "## 路径修正",
    "",
    "| 计划路径 | 实际读取路径 | 说明 |",
    "|---|---|---|",
    ...(pathNotes.length > 0
      ? pathNotes.map(
          (result) =>
            `| ${escapeMd(result.candidate.originalRelativePath)} | ${escapeMd(result.candidate.relativePath)} | ${escapeMd(result.candidate.pathNote ?? "")} |`,
        )
      : ["| - | - | 无 |"]),
    "",
    "## 自动检测命中统计",
    "",
    "| 品类 | 文件 | header 检测到 | model 检测到 | RMB price 检测到 | fallback price | 无法检测 |",
    "|---|---:|---:|---:|---:|---:|---:|",
    ...SCAN_CATEGORIES.map((category) => {
      const row = detectionSummary.get(category);
      return `| ${escapeMd(formatCategoryLabel(category))} | ${row?.files ?? 0} | ${row?.headers ?? 0} | ${row?.models ?? 0} | ${row?.rmbPrices ?? 0} | ${row?.fallbackPrices ?? 0} | ${row?.unable ?? 0} |`;
    }),
    "",
    "## 每文件汇总",
    "",
    "| 文件 | 品类 | 工厂 | Sheets | 数据行 | 新产品 | 复用 | 新 offers | 更新 | 补充 | 图片 | 错误 |",
    "|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|",
    ...results.map(
      (result) =>
        `| ${escapeMd(result.candidate.relativePath)} | ${escapeMd(result.candidate.category)} | ${escapeMd(result.candidate.factory)} | ${result.sheets} | ${result.importRows} | ${result.newProducts} | ${result.reusedProducts} | ${result.newOffers} | ${result.updatedOffers} | ${result.supplementedOffers} | ${result.images} | ${escapeMd(result.error ?? "-")} |`,
    ),
    "",
    "## 抽查 — 新建产品 10 条",
    "",
    "| product_id | model_no | category | factory | sheet | price |",
    "|---|---|---|---|---|---:|",
    ...(samples.newProducts.length > 0
      ? samples.newProducts.map(
          (sample) =>
            `| ${sample.productId} | ${escapeMd(sample.modelNo)} | ${escapeMd(sample.category)} | ${escapeMd(sample.factory)} | ${escapeMd(sample.sheetName)} | ${sample.price} |`,
        )
      : ["| - | - | - | - | - | - |"]),
    "",
    "## 抽查 — 更新 Offer 10 条",
    "",
    "| product_id | model_no | category | factory | sheet | new_price |",
    "|---|---|---|---|---|---:|",
    ...(samples.updatedOffers.length > 0
      ? samples.updatedOffers.map(
          (sample) =>
            `| ${sample.productId} | ${escapeMd(sample.modelNo)} | ${escapeMd(sample.category)} | ${escapeMd(sample.factory)} | ${escapeMd(sample.sheetName)} | ${sample.price} |`,
        )
      : ["| - | - | - | - | - | - |"]),
    "",
  ];

  lines.push(...buildVerificationSection(beforeCounts, afterCounts));

  lines.push("## 说明", "");
  lines.push("- 源 Excel 文件只读，未移动、未重命名、未覆盖。");
  lines.push("- Product lookup 按 `model_no` 复用，offer upsert 按 `product + factory` 更新。");
  lines.push("- 混合文件严格按计划 sheet 白名单导入，非混合文件读取文件内全部 sheet 后由列检测过滤。");
  lines.push("- 图片只补充给当前无图的产品，已有图片不覆盖。");

  return lines.join("\n");
}

function buildVerificationSection(beforeCounts: DbCounts, afterCounts: DbCounts): string[] {
  const lines = ["## 验证（apply mode only）", "", "| 检查项 | 操作前 | 操作后 | 变化 |", "|---|---:|---:|---:|"];
  const rows: Array<[string, number, number]> = [
    ["products", beforeCounts.products, afterCounts.products],
    ["supplier_offers", beforeCounts.supplierOffers, afterCounts.supplierOffers],
    ["files (My Passport)", beforeCounts.filesMyPassport, afterCounts.filesMyPassport],
    ...SCAN_CATEGORIES.map((category): [string, number, number] => [
      `${formatCategoryLabel(category)} products`,
      beforeCounts.categories[resolveCategory(category)] ?? 0,
      afterCounts.categories[resolveCategory(category)] ?? 0,
    ]),
    ["products with images", beforeCounts.productImages, afterCounts.productImages],
    ["price_history", beforeCounts.priceHistory, afterCounts.priceHistory],
    ["product_params", beforeCounts.productParams, afterCounts.productParams],
    ["悬空 offer refs", beforeCounts.danglingOfferRefs, afterCounts.danglingOfferRefs],
  ];

  for (const [label, before, after] of rows) {
    lines.push(`| ${escapeMd(label)} | ${before} | ${after} | ${formatDelta(after - before)} |`);
  }
  lines.push("");
  return lines;
}

function formatCategoryLabel(csvCategory: string): string {
  const dbCategory = resolveCategory(csvCategory);
  return dbCategory === csvCategory ? csvCategory : `${csvCategory} → ${dbCategory}`;
}

function buildCategorySummary(results: FileResult[]) {
  const summary = new Map<
    string,
    {
      files: number;
      success: number;
      importRows: number;
      newProducts: number;
      reusedProducts: number;
      newOffers: number;
      updatedOffers: number;
      supplementedOffers: number;
      images: number;
    }
  >();
  for (const result of results) {
    const row =
      summary.get(result.candidate.category) ??
      {
        files: 0,
        success: 0,
        importRows: 0,
        newProducts: 0,
        reusedProducts: 0,
        newOffers: 0,
        updatedOffers: 0,
        supplementedOffers: 0,
        images: 0,
      };
    row.files += 1;
    row.success += result.success ? 1 : 0;
    row.importRows += result.importRows;
    row.newProducts += result.newProducts;
    row.reusedProducts += result.reusedProducts;
    row.newOffers += result.newOffers;
    row.updatedOffers += result.updatedOffers;
    row.supplementedOffers += result.supplementedOffers;
    row.images += result.images;
    summary.set(result.candidate.category, row);
  }
  return summary;
}

function buildDetectionSummary(results: FileResult[]) {
  const summary = new Map<
    string,
    { files: number; headers: number; models: number; rmbPrices: number; fallbackPrices: number; unable: number }
  >();
  for (const result of results) {
    const row = summary.get(result.candidate.category) ?? {
      files: 0,
      headers: 0,
      models: 0,
      rmbPrices: 0,
      fallbackPrices: 0,
      unable: 0,
    };
    row.files += 1;
    row.headers += result.detection.headerDetected ? 1 : 0;
    row.models += result.detection.modelDetected ? 1 : 0;
    row.rmbPrices += result.detection.rmbPriceDetected ? 1 : 0;
    row.fallbackPrices += result.detection.fallbackPrice ? 1 : 0;
    row.unable += result.detection.unableToDetect ? 1 : 0;
    summary.set(result.candidate.category, row);
  }
  return summary;
}

function emptyTotals(): Totals {
  return {
    inputFiles: 0,
    sheets: 0,
    importRows: 0,
    skippedRows: 0,
    success: false,
    skippedNoSheet: false,
    readFailed: false,
    newProducts: 0,
    reusedProducts: 0,
    newOffers: 0,
    updatedOffers: 0,
    supplementedOffers: 0,
    skippedOffers: 0,
    images: 0,
    imageFailures: 0,
    priceHistory: 0,
  };
}

function emptyFileResult(candidate: Candidate, built: BuiltFile): FileResult {
  return {
    candidate,
    sheets: 0,
    importRows: 0,
    skippedRows: 0,
    success: false,
    skippedNoSheet: false,
    readFailed: false,
    error: null,
    newProducts: 0,
    reusedProducts: 0,
    newOffers: 0,
    updatedOffers: 0,
    supplementedOffers: 0,
    skippedOffers: 0,
    images: 0,
    imageFailures: 0,
    priceHistory: 0,
    detection: built.detection,
    sheetResults: [],
  };
}

function emptySheetApplyResult(candidate: Candidate, sheet: BuiltFile["sheets"][number]): SheetApplyResult {
  return {
    relativePath: candidate.relativePath,
    category: candidate.category,
    factory: candidate.factory,
    sheetName: sheet.name,
    headerRow: sheet.analysis.headerRowIndex + 1,
    modelColumn: formatColumnSignal(sheet.analysis.modelColumns[0]),
    priceColumn: formatColumnSignal(sheet.analysis.rmbPriceColumns[0] ?? sheet.analysis.priceColumns[0]),
    validRows: 0,
    skippedRows: 0,
    newProducts: 0,
    reusedProducts: 0,
    newOffers: 0,
    updatedOffers: 0,
    supplementedOffers: 0,
    duplicateOffers: 0,
    priceHistory: 0,
    error: null,
  };
}

function emptyBuiltFile(candidate: Candidate, readError: string): BuiltFile {
  return {
    candidate,
    sheets: [],
    readError,
    detection: {
      sheets: 0,
      headerDetected: false,
      modelDetected: false,
      rmbPriceDetected: false,
      fallbackPrice: false,
      unableToDetect: true,
    },
  };
}

function normalizeRows(rows: unknown[][]): SheetRows {
  return rows.map((row) => row.map((cell) => normalizeText(cell)));
}

function findHeaderRows(rows: SheetRows): number[] {
  return rows
    .slice(0, 10)
    .map((row, index) => ({ row, number: index + 1 }))
    .filter(({ row }) => {
      const text = row.join(" ");
      const nonEmpty = row.filter((cell) => cell !== "").length;
      return nonEmpty >= 2 && /型号|款号|model|item|code|品名|产品|规格|spec|单价|price|价格|报价|rmb|人民币|含税|工厂/i.test(text);
    })
    .map(({ number }) => number);
}

function findBestHeaderIndex(rows: SheetRows): number {
  const candidate = rows.slice(0, 10).findIndex((row) => row.filter((cell) => cell !== "").length >= 2);
  return candidate >= 0 ? candidate : 0;
}

function buildHeaders(rows: SheetRows, headerRowIndex: number, colCount: number): string[] {
  const headers: string[] = [];
  const headerRow = rows[headerRowIndex] ?? [];
  const previousRow = headerRowIndex > 0 ? rows[headerRowIndex - 1] ?? [] : [];
  for (let index = 0; index < colCount; index += 1) {
    headers.push(normalizeText(headerRow[index] || previousRow[index] || ""));
  }
  return headers;
}

function parsePositivePrice(value: string): number | null {
  const parsed = parsePriceValue(value);
  if (!parsed) return null;
  const numeric = Number(parsed);
  if (!Number.isFinite(numeric) || numeric <= 0 || numeric > 10_000_000) return null;
  if (/^\d{4}$/.test(parsed) && numeric >= 1900 && numeric <= 2100) return null;
  return numeric;
}

function isLikelyModelValue(value: string): boolean {
  const text = normalizeText(value);
  if (text.length < 2 || text.length > 100) return false;
  if (/单价|price|报价|含税|不含税|金额|合计|小计|备注/i.test(text)) return false;
  if (/^[\d,.]+$/.test(text)) return false;
  return /[A-Za-z]/.test(text) && /\d/.test(text);
}

function isLikelyModelHeader(header: string): boolean {
  return /型号|款号|model|item|code|产品编码|产品型号|货号/i.test(normalizeText(header));
}

function isRmbPriceHeader(header: string): boolean {
  const text = normalizeText(header);
  if (isUsdPriceHeader(text)) return false;
  if (isAccessoryPriceHeader(text)) return false;
  return /rmb|人民币|含税|不含税|单价|价格|报价|出厂|工厂价|成本|采购|cny|元/i.test(text);
}

function isUsdPriceHeader(header: string): boolean {
  return /usd|fob|美金|美元|us\$|\$/i.test(normalizeText(header));
}

function isPriceHeader(header: string): boolean {
  return isRmbPriceHeader(header) || isUsdPriceHeader(header) || /price|金额|合计/i.test(normalizeText(header));
}

function isNonPriceHeader(header: string): boolean {
  const text = normalizeText(header);
  if (!text) return false;
  if (/^[\d./-]+$/.test(text)) return true;
  if (/^[\d一二三四五六七八九十]+月$/i.test(text)) return true;
  if (/^(no\.?|序号|序\s*号|item\s*no\.?|sn|s\/n|编号|bom\s*no\.?|bom)$/i.test(text)) return true;
  if (/^(功率|w数|watt(age)?|power|电流|current|电压|voltage|尺寸|size|规格|spec|长度|length|直径|diameter|数量|qty|quantity|pcs|灯珠颗数|灯珠数|led\s*qty|bead|重量|weight|净重|毛重|体积|cbm|箱数|包装|包装数|彩盒|纸箱|光通量|lumen|色温|cct|显指|cri|光效|pf|df|频率|hz)$/i.test(text)) {
    return true;
  }
  if (/^(产品名称|品名|product\s*name|名称|品类|类别|category|type|系列|series|颜色|color|材质|material|灯头|base|角度|angle|认证|cert)$/i.test(text)) {
    return true;
  }
  if (/序号|产品名称|品名|产品规格|规格|功率|w数|watt|电流|current|电压|voltage|尺寸|size|长度|length|直径|diameter|数量|qty|quantity|pcs|光通量|lumen|色温|cct|显指|cri|光效|pf|灯珠颗数|灯珠数|led\s*qty|bead|包装|彩盒|纸箱/i.test(text)) {
    return true;
  }
  if (isAccessoryPriceHeader(text)) return true;
  return false;
}

function isAccessoryPriceHeader(header: string): boolean {
  return /堵头|差价|配件|加价|附加|升级|差额|补差|运费差|包装差|物料差/i.test(normalizeText(header));
}

function priceHintFromText(text: string): "rmb" | "usd" | "unknown" {
  if (/fob|usd|美金|美元/i.test(text)) return "usd";
  if (/核价|rmb|人民币|含税|不含税|cny|采购价|工厂价|报价|价格/i.test(text)) return "rmb";
  return "unknown";
}

function columnSignal(index: number, header: string, count: number, samples: string[]): ColumnSignal {
  return {
    index,
    letter: columnLetter(index),
    header,
    count,
    samples: samples.slice(0, 3),
  };
}

function sortSignal(a: ColumnSignal, b: ColumnSignal): number {
  const aPrice = isPriceHeader(a.header) ? 1 : 0;
  const bPrice = isPriceHeader(b.header) ? 1 : 0;
  if (aPrice !== bPrice) return bPrice - aPrice;
  return b.count - a.count || a.index - b.index;
}

function uniqueSamples(values: string[]): string[] {
  return Array.from(new Set(values.map(normalizeText).filter(Boolean))).slice(0, 5);
}

function findColumn(
  columns: Array<{ index: number; header: string }>,
  tests: RegExp[],
  excluded: Set<number>,
): number | null {
  for (const test of tests) {
    const found = columns.find((column) => !excluded.has(column.index) && test.test(column.header));
    if (found) return found.index;
  }
  return null;
}

function isDescriptionHeader(header: string): boolean {
  return /description|details|spec|power|watt|voltage|cct|lumen|flux|material|warranty|base|beam|pf|cri|参数|描述|功率|电压|色温|光通|材质|质保|底座|灯头|工作模式|功能|配置|驱动|显指|光效|尺寸|规格/i.test(
    normalizeText(header),
  );
}

function isPhotoHeader(header: string): boolean {
  return /photo|picture|image|图片|照片|图\s*片|产品图片/i.test(normalizeText(header));
}

function isNoHeader(header: string): boolean {
  return /^(no\.?|序号|序\s*号)$/i.test(normalizeText(header));
}

function mergeDescription(row: string[], rows: SheetRows, mapping: Mapping): string | null {
  const parts: string[] = [];
  const header = rows[mapping.headerRowIndex] ?? [];
  for (const columnIndex of mapping.descriptionColumns) {
    const value = cellAt(row, columnIndex);
    if (!value) continue;
    const label = normalizeText(header[columnIndex]) || `列 ${columnIndex + 1}`;
    parts.push(`${label}: ${value}`);
  }
  return parts.length > 0 ? parts.join("\n") : null;
}

function readCtnDimensions(row: string[], mapping: Mapping) {
  const direct = {
    length: cleanDimensionText(cellAt(row, mapping.ctnLengthColumn)),
    width: cleanDimensionText(cellAt(row, mapping.ctnWidthColumn)),
    height: cleanDimensionText(cellAt(row, mapping.ctnHeightColumn)),
  };
  if (direct.length && direct.width && direct.height) {
    return direct;
  }
  return parseCtnSize(cellAt(row, mapping.ctnSizeColumn));
}

function parseCtnSize(value: string | null): { length: string | null; width: string | null; height: string | null } {
  const raw = normalizeText(value);
  if (!raw) return { length: null, width: null, height: null };
  const parts = raw
    .replace(/\s*(cm|厘米|mm)\s*$/i, "")
    .split(/\s*[×xX*]\s*/)
    .map(cleanDimensionText);
  if (parts.length !== 3 || parts.some((part) => !part)) {
    return { length: null, width: null, height: null };
  }
  return { length: parts[0], width: parts[1], height: parts[2] };
}

function cleanIntegerText(value: string | null): string | null {
  const text = normalizeText(value);
  if (!text) return null;
  const match = text.match(/^[\d,]+/);
  return match ? match[0].replace(/,/g, "") : null;
}

function cleanDimensionText(value: string | null): string | null {
  const match = normalizeText(value).replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  return match ? match[0] : null;
}

function cleanModelNo(value: string | null): string | null {
  const text = normalizeText(value);
  if (!text) return null;
  if (/^[-/\\]+$/.test(text)) return null;
  return text;
}

function isHeaderLikeModel(modelNo: string): boolean {
  return /型号|款号|model|item|code|产品名称|品名|规格|spec/i.test(modelNo) && !/\d/.test(modelNo.replace(/\d{2,}/g, ""));
}

function cellAt(row: string[], columnIndex: number | null): string | null {
  if (columnIndex === null || columnIndex === undefined) return null;
  const value = normalizeText(row[columnIndex]);
  return value || null;
}

function isEmptyRow(row: string[]): boolean {
  return row.every((cell) => normalizeText(cell) === "");
}

function productKey(modelNo: string | null | undefined): string | null {
  const key = normalizeText(modelNo).toLowerCase();
  return key || null;
}

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFC")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeKey(value: string): string {
  return normalizeCsvPath(value).replaceAll("\\", "/").toLowerCase();
}

function normalizeSheetKey(value: string): string {
  return normalizeText(value).toLowerCase();
}

function portableRelative(root: string, absolutePath: string): string {
  return path.relative(root, absolutePath).split(path.sep).join("/").normalize("NFC");
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function columnLetter(index: number): string {
  let value = index + 1;
  let label = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - 1) / 26);
  }
  return label;
}

function formatColumnSignal(signal: ColumnSignal | undefined): string {
  if (!signal) return "-";
  const header = signal.header ? ` ${signal.header}` : "";
  return `${signal.letter}${header} (${signal.count})`;
}

function formatDelta(delta: number): string {
  if (delta > 0) return `+${delta}`;
  return String(delta);
}

function escapeMd(value: unknown): string {
  return normalizeText(value).replaceAll("|", "\\|");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
