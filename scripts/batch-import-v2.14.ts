import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { PrismaClient } from "@prisma/client";
import * as XLSX from "xlsx";

import { parsePriceValue, type SheetRows } from "../src/lib/excel-import";
import { extractImagesFromExcel, storeExtractedImage, type ExtractedImage } from "../src/lib/image-extractor";
import { upsertSupplierOffer, type SupplierOfferUpsertClient } from "../src/lib/supplier-offer-upsert";

const prisma = new PrismaClient();

const ROOT = "/Volumes/My Passport/AI 报价/各家工厂最新报价汇总";
const CSV_PATH = "docs/v2.13a-import-candidates.csv";
const BACKUP_DIR = "backups";
const PRICE_MIN = 0.01;
const PRICE_MAX = 100_000;
const IMAGE_ROW_RADIUS = 3;
const BATCH_CONFIGS = {
  "1": {
    label: "Batch 1",
    reportPath: "docs/v2.14-batch1-report.md",
    backupPrefix: "dev-before-v2.14-batch1",
    expectedInputFiles: 309,
    categories: ["投光灯", "面板灯", "线条灯", "路灯", "灯带"],
  },
  "2": {
    label: "Batch 2",
    reportPath: "docs/v2.14-batch2-report.md",
    backupPrefix: "dev-before-v2.14-batch2",
    expectedInputFiles: 210,
    categories: ["吸顶灯", "筒灯", "三防灯", "磁吸灯", "净化灯", "镜前灯", "防潮灯"],
  },
} as const;

const batchConfig = readBatchConfig();
const REPORT_PATH = batchConfig.reportPath;
const EXPECTED_INPUT_FILES = batchConfig.expectedInputFiles;
const SCAN_CATEGORIES: string[] = [...batchConfig.categories];
const SCAN_CATEGORY_SET = new Set<string>(SCAN_CATEGORIES);
const SKIPPABLE_SHEET_NAME = /目录|index|cover|封面/i;

const applyMode = process.argv.includes("--apply");
const skipImages = process.argv.includes("--skip-images");
const runStartedAt = new Date();

function readBatchConfig() {
  const batchArg = process.argv.find((arg) => arg.startsWith("--batch="));
  const batch = batchArg?.split("=")[1] ?? (process.argv.includes("--batch2") ? "2" : "1");
  const config = BATCH_CONFIGS[batch as keyof typeof BATCH_CONFIGS];
  if (!config) {
    throw new Error(`未知 V2.14 batch：${batch}。可用参数：--batch=1 或 --batch=2`);
  }
  return config;
}

type Candidate = {
  relativePath: string;
  category: string;
  factory: string;
  classification: string;
  reason: string;
  estimatedProducts: number;
  absolutePath: string | null;
  fileName: string;
  size: number;
  modifiedAtMs: number;
  modifiedDate: string;
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
};

type Totals = Omit<FileResult, "candidate" | "error" | "detection"> & {
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

type DryProduct = {
  id: string;
  modelNo: string;
  category: string | null;
  imagePath: string | null;
};

type DryOffer = {
  productId: string;
  factoryName: string;
  purchasePrice: string;
  moq: string | null;
  ctnQty: string | null;
  ctnLength: string | null;
  ctnWidth: string | null;
  ctnHeight: string | null;
};

async function main() {
  if (!existsSync(ROOT)) {
    throw new Error(`硬盘目录不可访问：${ROOT}`);
  }
  if (!existsSync(CSV_PATH)) {
    throw new Error(`候选 CSV 不存在：${CSV_PATH}`);
  }

  const diskIndex = await buildDiskIndex(ROOT);
  const candidates = await loadCandidates(diskIndex);
  if (candidates.length !== EXPECTED_INPUT_FILES) {
    throw new Error(`${batchConfig.label} 候选文件数量异常：期望 ${EXPECTED_INPUT_FILES}，实际 ${candidates.length}`);
  }

  const backupPath = applyMode ? await backupDatabase() : null;
  const beforeCounts = await getDbCounts();
  const results = applyMode
    ? await runApply(candidates)
    : await runDryRun(candidates);
  const afterCounts = applyMode ? await getDbCounts() : beforeCounts;

  await mkdir("docs", { recursive: true });
  await writeFile(
    REPORT_PATH,
    buildReport({
      mode: applyMode ? "apply" : "dry-run",
      backupPath,
      beforeCounts,
      afterCounts,
      results,
    }),
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        mode: applyMode ? "apply" : "dry-run",
        batchLabel: batchConfig.label,
        inputFiles: candidates.length,
        successFiles: results.filter((result) => result.success).length,
        skippedNoSheet: results.filter((result) => result.skippedNoSheet).length,
        readFailures: results.filter((result) => result.readFailed).length,
        reportPath: REPORT_PATH,
      },
      null,
      2,
    ),
  );
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

async function loadCandidates(diskIndex: Map<string, DiskFile>): Promise<Candidate[]> {
  const csvText = await import("node:fs/promises").then((fs) => fs.readFile(CSV_PATH, "utf8"));
  const rows = parseCsv(csvText);
  const [header, ...body] = rows;
  const headerIndex = new Map(header.map((name, index) => [name, index]));

  const candidates = body
    .map((row): Candidate | null => {
      const relativePath = normalizeText(row[headerIndex.get("path") ?? -1]);
      const category = normalizeText(row[headerIndex.get("category") ?? -1]);
      const factory = normalizeText(row[headerIndex.get("factory") ?? -1]);
      const classification = normalizeText(row[headerIndex.get("classification") ?? -1]);
      if (classification !== "likely-importable" || !SCAN_CATEGORY_SET.has(category)) {
        return null;
      }

      const diskFile = diskIndex.get(normalizeKey(relativePath)) ?? null;
      return {
        relativePath,
        category,
        factory,
        classification,
        reason: normalizeText(row[headerIndex.get("reason") ?? -1]),
        estimatedProducts: Number(normalizeText(row[headerIndex.get("estimated_products") ?? -1])) || 0,
        absolutePath: diskFile?.absolutePath ?? null,
        fileName: diskFile?.fileName ?? path.basename(relativePath),
        size: diskFile?.size ?? 0,
        modifiedAtMs: diskFile?.modifiedAtMs ?? 0,
        modifiedDate: diskFile?.modifiedDate ?? "",
      };
    })
    .filter((candidate): candidate is Candidate => Boolean(candidate));

  return candidates.sort((a, b) => {
    const categoryDelta = SCAN_CATEGORIES.indexOf(a.category) - SCAN_CATEGORIES.indexOf(b.category);
    if (categoryDelta !== 0) return categoryDelta;
    const factoryDelta = a.factory.localeCompare(b.factory, "zh-Hans-CN");
    if (factoryDelta !== 0) return factoryDelta;
    const modifiedDelta = a.modifiedAtMs - b.modifiedAtMs;
    if (modifiedDelta !== 0) return modifiedDelta;
    return a.relativePath.localeCompare(b.relativePath, "zh-Hans-CN");
  });
}

async function runDryRun(candidates: Candidate[]): Promise<FileResult[]> {
  const [products, offers] = await Promise.all([
    prisma.product.findMany({
      select: { id: true, modelNo: true, category: true, imagePath: true },
      where: { modelNo: { not: null } },
    }),
    prisma.supplierOffer.findMany({
      select: {
        productId: true,
        factoryName: true,
        purchasePrice: true,
        moq: true,
        ctnQty: true,
        ctnLength: true,
        ctnWidth: true,
        ctnHeight: true,
      },
    }),
  ]);
  const productByModel = new Map<string, DryProduct>();
  for (const product of products) {
    const key = productKey(product.modelNo);
    if (key && !productByModel.has(key)) {
      productByModel.set(key, {
        id: product.id,
        modelNo: product.modelNo ?? "",
        category: product.category,
        imagePath: product.imagePath,
      });
    }
  }
  let dryProductSeq = 0;
  const offerByProductFactory = new Map(
    offers.map((offer): [string, DryOffer] => [
      offerKey(offer.productId, offer.factoryName),
      {
        productId: offer.productId,
        factoryName: offer.factoryName,
        purchasePrice: offer.purchasePrice.toString(),
        moq: offer.moq,
        ctnQty: offer.ctnQty,
        ctnLength: offer.ctnLength,
        ctnWidth: offer.ctnWidth,
        ctnHeight: offer.ctnHeight,
      },
    ]),
  );

  const results: FileResult[] = [];
  for (const [index, candidate] of candidates.entries()) {
    if ((index + 1) % 10 === 0 || index === 0) {
      console.log(`Dry-run ${index + 1}/${candidates.length}: ${candidate.relativePath}`);
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

    result.success = true;
    result.sheets = built.sheets.length;
    result.importRows = built.sheets.reduce((sum, sheet) => sum + sheet.rows.length, 0);
    result.skippedRows = built.sheets.reduce((sum, sheet) => sum + sheet.skippedRows.length, 0);

    for (const row of built.sheets.flatMap((sheet) => sheet.rows)) {
      const modelKey = productKey(row.modelNo);
      if (!modelKey) continue;
      let product = productByModel.get(modelKey);
      if (!product) {
        product = {
          id: `dry-product-${++dryProductSeq}`,
          modelNo: row.modelNo,
          category: row.category,
          imagePath: null,
        };
        productByModel.set(modelKey, product);
        result.newProducts += 1;
      } else {
        result.reusedProducts += 1;
      }

      const key = offerKey(product.id, row.factoryName);
      const existingOffer = offerByProductFactory.get(key);
      if (!existingOffer) {
        offerByProductFactory.set(key, {
          productId: product.id,
          factoryName: row.factoryName,
          purchasePrice: row.purchasePrice,
          moq: row.moq,
          ctnQty: row.ctnQty,
          ctnLength: row.ctnLength,
          ctnWidth: row.ctnWidth,
          ctnHeight: row.ctnHeight,
        });
        result.newOffers += 1;
        continue;
      }

      const priceChanged = !sameDecimal(existingOffer.purchasePrice, row.purchasePrice);
      const supplemented = hasSupplement(existingOffer, row);
      if (priceChanged) {
        existingOffer.purchasePrice = row.purchasePrice;
        existingOffer.moq = coalesceExisting(existingOffer.moq, row.moq);
        existingOffer.ctnQty = coalesceExisting(existingOffer.ctnQty, row.ctnQty);
        existingOffer.ctnLength = coalesceExisting(existingOffer.ctnLength, row.ctnLength);
        existingOffer.ctnWidth = coalesceExisting(existingOffer.ctnWidth, row.ctnWidth);
        existingOffer.ctnHeight = coalesceExisting(existingOffer.ctnHeight, row.ctnHeight);
        result.updatedOffers += 1;
        result.priceHistory += 1;
      } else if (supplemented) {
        existingOffer.moq = coalesceExisting(existingOffer.moq, row.moq);
        existingOffer.ctnQty = coalesceExisting(existingOffer.ctnQty, row.ctnQty);
        existingOffer.ctnLength = coalesceExisting(existingOffer.ctnLength, row.ctnLength);
        existingOffer.ctnWidth = coalesceExisting(existingOffer.ctnWidth, row.ctnWidth);
        existingOffer.ctnHeight = coalesceExisting(existingOffer.ctnHeight, row.ctnHeight);
        result.supplementedOffers += 1;
      } else {
        result.skippedOffers += 1;
      }
    }

    results.push(result);
  }
  return results;
}

async function runApply(candidates: Candidate[]): Promise<FileResult[]> {
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
          result.sheets += 1;
          result.importRows += sheet.rows.length;
          result.skippedRows += sheet.skippedRows.length;
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
              } else {
                const createdProduct = await tx.product.create({
                  data: {
                    productName: row.productName,
                    category: row.category,
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
              }
              productCache.set(cacheKey, productId);
            } else {
              result.reusedProducts += 1;
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
            } else if (upsert.status === "updated") {
              if (upsert.priceChanged) {
                result.updatedOffers += 1;
                result.priceHistory += 1;
              }
              if (upsert.supplemented) {
                result.supplementedOffers += 1;
              }
            } else {
              result.skippedOffers += 1;
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

  const sheets: BuiltFile["sheets"] = [];
  const analyses: SheetAnalysis[] = [];
  for (const sheetName of workbook.SheetNames) {
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
      priceColumns.push(signal);
      if (isUsdPriceHeader(header) || filePriceHint === "usd") {
        usdPriceColumns.push(signal);
      }
      if (isRmbPriceHeader(header) || (filePriceHint === "rmb" && !isUsdPriceHeader(header))) {
        rmbPriceColumns.push(signal);
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
  const hasImportColumns = modelColumns.length > 0 && (rmbPriceColumns.length > 0 || fallbackPrice);
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
      skipReason: "未检测到型号列或 RMB 价格列",
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
  const backupPath = path.join(BACKUP_DIR, `${batchConfig.backupPrefix}-${stamp}.sqlite`);
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
  mode,
  backupPath,
  beforeCounts,
  afterCounts,
  results,
}: {
  mode: "dry-run" | "apply";
  backupPath: string | null;
  beforeCounts: DbCounts;
  afterCounts: DbCounts;
  results: FileResult[];
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

  const lines: string[] = [
    `# V2.14 ${batchConfig.label} — 批量导入报告`,
    "",
    `Generated: ${new Date().toISOString()}`,
    `Mode: ${mode}`,
    ...(backupPath ? [`Backup: \`${backupPath}\``] : []),
    `Images: ${skipImages ? "skipped by flag" : mode === "apply" ? "enabled" : "dry-run only"}`,
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
    "## 品类汇总",
    "",
    "| 品类 | 文件 | 成功 | 数据行 | 新产品 | 复用 | 新 offers | 更新 | 补充 | 图片 |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...SCAN_CATEGORIES.map((category) => {
      const row = categorySummary.get(category);
      return `| ${escapeMd(category)} | ${row?.files ?? 0} | ${row?.success ?? 0} | ${row?.importRows ?? 0} | ${row?.newProducts ?? 0} | ${row?.reusedProducts ?? 0} | ${row?.newOffers ?? 0} | ${row?.updatedOffers ?? 0} | ${row?.supplementedOffers ?? 0} | ${row?.images ?? 0} |`;
    }),
    "",
    "## 跳过/失败文件",
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
    "## 自动检测命中统计",
    "",
    "| 品类 | 文件 | header 检测到 | model 检测到 | RMB price 检测到 | fallback price | 无法检测 |",
    "|---|---:|---:|---:|---:|---:|---:|",
    ...SCAN_CATEGORIES.map((category) => {
      const row = detectionSummary.get(category);
      return `| ${escapeMd(category)} | ${row?.files ?? 0} | ${row?.headers ?? 0} | ${row?.models ?? 0} | ${row?.rmbPrices ?? 0} | ${row?.fallbackPrices ?? 0} | ${row?.unable ?? 0} |`;
    }),
    "",
    "## 每文件明细（前 50 个）",
    "",
    "| 文件 | 品类 | 工厂 | Sheets | 数据行 | 新产品 | 复用 | 新 offers | 更新 | 补充 | 图片 | 错误 |",
    "|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|",
    ...results.slice(0, 50).map(
      (result) =>
        `| ${escapeMd(result.candidate.relativePath)} | ${escapeMd(result.candidate.category)} | ${escapeMd(result.candidate.factory)} | ${result.sheets} | ${result.importRows} | ${result.newProducts} | ${result.reusedProducts} | ${result.newOffers} | ${result.updatedOffers} | ${result.supplementedOffers} | ${result.images} | ${escapeMd(result.error ?? "-")} |`,
    ),
    "",
  ];

  if (mode === "apply") {
    lines.push(...buildVerificationSection(beforeCounts, afterCounts));
  } else {
    lines.push("## 验证（apply mode only）", "", "- Dry-run 未写入数据库。", "");
  }

  lines.push("## 说明", "");
  lines.push("- 源 Excel 文件只读，未移动、未重命名、未覆盖。");
  lines.push("- Product lookup 按 `model_no` 复用，offer upsert 按 `product + factory` 更新。");
  lines.push("- 文件处理顺序为品类 → 工厂 → 修改时间升序，较新的价格会覆盖旧价格。");
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
      `${category} products`,
      beforeCounts.categories[category] ?? 0,
      afterCounts.categories[category] ?? 0,
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

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }
    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(cell);
      if (row.some((value) => value.length > 0)) {
        rows.push(row);
      }
      row = [];
      cell = "";
      continue;
    }
    cell += char;
  }

  row.push(cell);
  if (row.some((value) => value.length > 0)) {
    rows.push(row);
  }
  return rows;
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
  return /rmb|人民币|含税|不含税|单价|价格|报价|出厂|工厂价|成本|采购|cny|元/i.test(text) && !isUsdPriceHeader(text);
}

function isUsdPriceHeader(header: string): boolean {
  return /usd|fob|美金|美元|us\$|\$/i.test(normalizeText(header));
}

function isPriceHeader(header: string): boolean {
  return isRmbPriceHeader(header) || isUsdPriceHeader(header) || /price|金额|合计/i.test(normalizeText(header));
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

function offerKey(productId: string, factoryName: string): string {
  return `${productId}::${normalizeText(factoryName).toLowerCase()}`;
}

function sameDecimal(left: string, right: string): boolean {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
    return Math.abs(leftNumber - rightNumber) < 0.000001;
  }
  return left === right;
}

function hasSupplement(existingOffer: DryOffer, row: ImportRow): boolean {
  return (
    (isBlank(existingOffer.moq) && !isBlank(row.moq)) ||
    (isBlank(existingOffer.ctnQty) && !isBlank(row.ctnQty)) ||
    (isBlank(existingOffer.ctnLength) && !isBlank(row.ctnLength)) ||
    (isBlank(existingOffer.ctnWidth) && !isBlank(row.ctnWidth)) ||
    (isBlank(existingOffer.ctnHeight) && !isBlank(row.ctnHeight))
  );
}

function coalesceExisting(existingValue: string | null, incomingValue: string | null): string | null {
  return isBlank(existingValue) && !isBlank(incomingValue) ? incomingValue : existingValue;
}

function isBlank(value: string | null | undefined): boolean {
  return value === null || value === undefined || value.trim().length === 0;
}

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFC")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeKey(value: string): string {
  return normalizeText(value).replaceAll("\\", "/").toLowerCase();
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

function formatDelta(delta: number): string {
  if (delta > 0) return `+${delta}`;
  return String(delta);
}

function escapeMd(value: unknown): string {
  return normalizeText(value).replaceAll("|", "\\|");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
