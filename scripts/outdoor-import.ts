import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { PrismaClient } from "@prisma/client";
import * as XLSX from "xlsx";

import { parsePriceValue, type SheetRows } from "../src/lib/excel-import";
import { upsertSupplierOffer, type SupplierOfferUpsertClient } from "../src/lib/supplier-offer-upsert";

const prisma = new PrismaClient();

const ROOT = "/Volumes/My Passport/AI 报价/各家工厂最新报价汇总";
const DEFAULT_DRY_RUN_REPORT_PATH = "docs/v2.18-dryrun-report.md";
const DEFAULT_APPLY_REPORT_PATH = "docs/v2.18-apply-report.md";
const PRICE_MIN = 0.01;
const PRICE_MAX = 100_000;
const SKIPPABLE_SHEET_NAME = /目录|index|cover|封面/i;
const runStartedAt = new Date();
const V218B_IMPORT_RELATIVE_PATHS = new Set(["户外照明 工业照明/户外工厂/伊特/2026/4.25 产品报价-含税.xlsx"]);

type FileMode = "import" | "analyze-only";

type OutdoorFileEntry = {
  relativePath: string;
  factory: string;
  targetCategory: string;
  mode: FileMode;
  note?: string;
};

type ColumnSignal = {
  index: number;
  letter: string;
  header: string;
  count: number;
  samples: string[];
};

type SheetAnalysis = {
  sheetName: string;
  rowCount: number;
  colCount: number;
  headerRows: number[];
  headerRowIndex: number;
  headers: string[];
  modelColumns: ColumnSignal[];
  priceColumns: ColumnSignal[];
  rmbPriceColumns: ColumnSignal[];
  fallbackPrice: boolean;
  skipReason: string | null;
};

type Mapping = {
  headerRowIndex: number;
  modelColumnIndex: number;
  priceColumnIndex: number;
  descriptionColumns: number[];
  wattColumnIndex: number | null;
};

type ImportRow = {
  modelNo: string;
  productName: string;
  purchasePrice: string;
  remark: string | null;
  sourceRowIndex: number;
};

type SheetDryRunResult = {
  relativePath: string;
  resolvedRelativePath: string;
  category: string;
  factory: string;
  sheetName: string;
  mode: FileMode;
  status: "ok" | "no-import-columns" | "no-valid-rows" | "read-error" | "analyze-only" | "already-imported";
  error: string | null;
  rowCount: number;
  headerRow: number | null;
  modelColumn: string;
  priceColumn: string;
  validRows: number;
  skippedRows: number;
  newProducts: number;
  reusedProducts: number;
  newOffers: number;
  updatedOffers: number;
  duplicateOffers: number;
  skippedReasons: Map<string, number>;
  samples: ImportRow[];
  priceColumns: string[];
  allPriceColumns: string[];
  warning: string | null;
};

type AnalyzeSheetResult = {
  relativePath: string;
  resolvedRelativePath: string;
  factory: string;
  sheetName: string;
  rowCount: number;
  headerRow: number | null;
  modelColumn: string;
  priceColumn: string;
  keywords: string[];
  suggestedCategory: string;
  categoryNote: string;
  samples: Array<{ modelNo: string; productName: string; description: string }>;
  skipReason: string | null;
};

type FileDryRunResult = {
  entry: OutdoorFileEntry;
  resolvedRelativePath: string;
  pathNote: string | null;
  readError: string | null;
  sheetCount: number;
  importSheets: SheetDryRunResult[];
  analyzeSheets: AnalyzeSheetResult[];
};

type SheetApplyResult = {
  relativePath: string;
  category: string;
  factory: string;
  sheetName: string;
  status: string;
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

type FileApplyResult = {
  entry: OutdoorFileEntry;
  resolvedRelativePath: string;
  pathNote: string | null;
  readError: string | null;
  sheetCount: number;
  sheets: SheetApplyResult[];
  images: number;
  imageFailures: number;
};

type DbCounts = {
  products: number;
  supplierOffers: number;
  priceHistory: number;
  filesMyPassport: number;
  categories: Record<string, number>;
};

type DryProduct = {
  id: string;
  modelNo: string;
};

type DryOffer = {
  productId: string;
  factoryName: string;
  purchasePrice: string;
};

const FILE_LIST: OutdoorFileEntry[] = [
  {
    relativePath:
      "户外照明 工业照明/户外工厂/凯晟德/2024年4月/汇孚2024产品报价更新/汇孚2024产品报价更新/TR-ES Qoutation  20240521.xlsx",
    factory: "凯晟德",
    targetCategory: "路灯",
    mode: "import",
    note: "⚠️ 品类待验证：TR-ES 暂按路灯，dry-run 样本需确认没有投光灯信号",
  },
  {
    relativePath: "户外照明 工业照明/户外工厂/凯晟德/202504报价/KCD-TB qoutation20250527.xlsx",
    factory: "凯晟德",
    targetCategory: "太阳能壁灯",
    mode: "import",
  },
  {
    relativePath: "户外照明 工业照明/户外工厂/凯晟德/202511香港展更新/LS model Light 100W qoutation251118.xlsx",
    factory: "凯晟德",
    targetCategory: "路灯",
    mode: "import",
  },
  {
    relativePath: "户外照明 工业照明/户外工厂/绿晟/202311/绿晟--F15系列泛光灯报价单不足瓦LS202311.xls",
    factory: "绿晟",
    targetCategory: "投光灯",
    mode: "import",
  },
  {
    relativePath: "户外照明 工业照明/户外工厂/绿晟/202311/绿晟--F15系列泛光灯报价单LS202311.xls",
    factory: "绿晟",
    targetCategory: "投光灯",
    mode: "import",
  },
  {
    relativePath: "户外照明 工业照明/户外工厂/绿晟/202410/绿晟--F15系列泛光灯报价单LS202410.xls",
    factory: "绿晟",
    targetCategory: "投光灯",
    mode: "import",
  },
  {
    relativePath: "户外照明 工业照明/户外工厂/绿晟/202510/绿晟--F15系列泛光灯报价单LS202512.xls",
    factory: "绿晟",
    targetCategory: "投光灯",
    mode: "import",
  },
  {
    relativePath: "户外照明 工业照明/户外工厂/绿晟/绿晟产品价格表202403/充电灯DC/绿晟-R02三面折叠款充电灯报价单LS202403.xls",
    factory: "绿晟",
    targetCategory: "充电灯",
    mode: "import",
  },
  {
    relativePath: "户外照明 工业照明/户外工厂/绿晟/绿晟产品价格表202403/充电灯DC/绿晟-R07R08R09充电灯报价单LS202403.xls",
    factory: "绿晟",
    targetCategory: "充电灯",
    mode: "import",
  },
  {
    relativePath: "户外照明 工业照明/户外工厂/绿晟/绿晟产品价格表202403/工作灯AC/绿晟-W12F款工作灯报价单LS202403.xls",
    factory: "绿晟",
    targetCategory: "工作灯",
    mode: "import",
  },
  {
    relativePath: "户外照明 工业照明/户外工厂/绿晟/绿晟产品价格表202403/充电灯DC/绿晟--R03充电灯报价单LS202403.xls",
    factory: "绿晟",
    targetCategory: "充电灯",
    mode: "import",
    note: "needs-review：价格列检测失败则跳过",
  },
  {
    relativePath: "户外照明 工业照明/户外工厂/绿晟/绿晟产品价格表202403/充电灯DC/绿晟-R01充电灯报价单LS202403.xls",
    factory: "绿晟",
    targetCategory: "充电灯",
    mode: "import",
    note: "needs-review：价格列检测失败则跳过",
  },
  {
    relativePath: "户外照明 工业照明/户外工厂/绿晟/绿晟产品价格表202403/充电灯DC/绿晟-R06充电灯报价单LS202403.xls",
    factory: "绿晟",
    targetCategory: "充电灯",
    mode: "import",
    note: "needs-review：价格列检测失败则跳过",
  },
  {
    relativePath: "户外照明 工业照明/户外工厂/绿晟/绿晟产品价格表202403/工作灯AC/绿晟-W12F款工作灯报价单20W50W.xls",
    factory: "绿晟",
    targetCategory: "工作灯",
    mode: "import",
    note: "needs-review：价格列检测失败则跳过",
  },
  {
    relativePath: "户外照明 工业照明/户外工厂/伊特/2023/0731 TG111波兰产品报价 迷你二代线性足瓦过新ERP 202308.xlsx",
    factory: "伊特",
    targetCategory: "投光灯",
    mode: "import",
  },
  {
    relativePath: "户外照明 工业照明/户外工厂/中屹/202406/24-6-20无边框报价（含 包装尺寸）.xlsx",
    factory: "中屹",
    targetCategory: "面板灯",
    mode: "import",
  },
  {
    relativePath: "户外照明 工业照明/户外工厂/中屹/中山中屹 报价 20230626/UFO-01HX90%230420.xlsx",
    factory: "中屹",
    targetCategory: "Highbay",
    mode: "import",
  },
  {
    relativePath: "户外照明 工业照明/户外工厂/中屹/中山中屹 报价 20230626/ZY-SL-02金钻price230420.xlsx",
    factory: "中屹",
    targetCategory: "路灯",
    mode: "import",
  },
  {
    relativePath: "户外照明 工业照明/户外工厂/伊特/2026/4.25 产品报价-含税.xlsx",
    factory: "伊特",
    targetCategory: "投光灯",
    mode: "import",
  },
];

async function main() {
  if (!existsSync(ROOT)) {
    throw new Error(`硬盘目录不可访问：${ROOT}`);
  }

  const isApply = process.argv.includes("--apply");
  const reportPath = getArgValue("--report") ?? (isApply ? DEFAULT_APPLY_REPORT_PATH : DEFAULT_DRY_RUN_REPORT_PATH);
  const backupPath = await backupDatabase();

  if (isApply) {
    const beforeCounts = await getDbCounts();
    const results = await runApply();
    const afterCounts = await getDbCounts();
    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, buildApplyReport({ results, backupPath, beforeCounts, afterCounts }), "utf8");
    const sheets = results.flatMap((result) => result.sheets);
    console.log(
      JSON.stringify(
        {
          mode: "apply",
          backupPath,
          reportPath,
          files: results.length,
          appliedSheets: sheets.filter((sheet) => sheet.status === "ok").length,
          validRows: sum(sheets.map((sheet) => sheet.validRows)),
          newProducts: sum(sheets.map((sheet) => sheet.newProducts)),
          newOffers: sum(sheets.map((sheet) => sheet.newOffers)),
          updatedOffers: sum(sheets.map((sheet) => sheet.updatedOffers)),
          priceHistory: sum(sheets.map((sheet) => sheet.priceHistory)),
        },
        null,
        2,
      ),
    );
    return;
  }

  const results = await runDryRun();
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, buildReport(results, backupPath), "utf8");

  const importSheets = results.flatMap((result) => result.importSheets);
  console.log(
    JSON.stringify(
      {
        mode: "dry-run",
        backupPath,
        reportPath,
        files: results.length,
        importFiles: FILE_LIST.filter((entry) => entry.mode === "import").length,
        analyzeOnlyFiles: FILE_LIST.filter((entry) => entry.mode === "analyze-only").length,
        importableSheets: importSheets.filter((sheet) => sheet.status === "ok").length,
        validRows: sum(importSheets.map((sheet) => sheet.validRows)),
        warnings: importSheets.filter((sheet) => sheet.warning || sheet.status !== "ok").length,
      },
      null,
      2,
    ),
  );
}

async function runApply(): Promise<FileApplyResult[]> {
  const results: FileApplyResult[] = [];
  for (const [index, entry] of FILE_LIST.entries()) {
    console.log(`Apply ${index + 1}/${FILE_LIST.length}: ${entry.relativePath}`);
    const resolved = await resolveDiskPath(entry.relativePath);
    const result: FileApplyResult = {
      entry,
      resolvedRelativePath: resolved.relativePath,
      pathNote: resolved.note,
      readError: null,
      sheetCount: 0,
      sheets: [],
      images: 0,
      imageFailures: 0,
    };

    if (entry.mode === "analyze-only") {
      results.push(result);
      continue;
    }
    if (shouldSkipForV218B(entry)) {
      result.sheets.push({
        relativePath: resolved.relativePath,
        category: entry.targetCategory,
        factory: entry.factory,
        sheetName: "-",
        status: "already-imported",
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
        error: "V2.18B 只导入伊特 4.25，本条为 V2.18 已处理条目，跳过",
      });
      results.push(result);
      continue;
    }

    try {
      const existingSourceOfferCount = await countExistingSourceOffers(resolved.relativePath);
      if (existingSourceOfferCount > 0) {
        result.sheets.push({
          relativePath: resolved.relativePath,
          category: entry.targetCategory,
          factory: entry.factory,
          sheetName: "-",
          status: "already-imported",
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
          duplicateOffers: existingSourceOfferCount,
          priceHistory: 0,
          error: `源文件已有 ${existingSourceOfferCount} 条 supplier_offers 引用，跳过以避免重复写价格历史`,
        });
        results.push(result);
        continue;
      }

      const absolutePath = path.join(ROOT, resolved.relativePath);
      const workbook = XLSX.readFile(absolutePath, { cellDates: false, WTF: false });
      result.sheetCount = workbook.SheetNames.length;
      const fileRecord = await ensureFileRecord(entry, resolved.relativePath);

      await prisma.$transaction(async (tx) => {
        const productCache = new Map<string, string>();
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
          const analysis = analyzeSheet(sheetName, rows, path.basename(resolved.relativePath));
          const sheetResult = emptySheetApplyResult(entry, resolved.relativePath, analysis);
          result.sheets.push(sheetResult);
          if (analysis.skipReason) {
            sheetResult.status = "skipped";
            sheetResult.error = analysis.skipReason;
            continue;
          }

          const mapping = buildMapping(analysis);
          const builtRows = buildImportRows(rows, mapping);
          sheetResult.validRows = builtRows.rows.length;
          sheetResult.skippedRows = builtRows.skippedRows.length;
          if (builtRows.rows.length === 0) {
            sheetResult.status = "skipped";
            sheetResult.error = "无有效数据行";
            continue;
          }

          for (const row of builtRows.rows) {
            const key = productKey(row.modelNo);
            if (!key) continue;

            let productId = productCache.get(key);
            if (!productId) {
              const existingProduct = await tx.product.findFirst({
                where: { modelNo: row.modelNo },
                orderBy: [{ createdAt: "asc" }],
                select: { id: true },
              });

              if (existingProduct) {
                productId = existingProduct.id;
                sheetResult.reusedProducts += 1;
              } else {
                const createdProduct = await tx.product.create({
                  data: {
                    productName: row.productName,
                    category: entry.targetCategory,
                    modelNo: row.modelNo,
                    material: null,
                    size: null,
                    imagePath: null,
                    remark: row.remark,
                  },
                  select: { id: true },
                });
                productId = createdProduct.id;
                sheetResult.newProducts += 1;
              }
              productCache.set(key, productId);
            } else {
              sheetResult.reusedProducts += 1;
            }

            const upsert = await upsertSupplierOffer(
              tx as unknown as SupplierOfferUpsertClient,
              {
                productId,
                factoryName: entry.factory,
                purchasePrice: row.purchasePrice,
                currency: "RMB",
                moq: null,
                ctnQty: null,
                ctnLength: null,
                ctnWidth: null,
                ctnHeight: null,
                sourceFileId: fileRecord.id,
                remark: null,
              },
              runStartedAt,
            );

            if (upsert.status === "created") {
              sheetResult.newOffers += 1;
            } else if (upsert.status === "updated") {
              if (upsert.priceChanged) {
                sheetResult.updatedOffers += 1;
                sheetResult.priceHistory += 1;
              }
              if (upsert.supplemented) {
                sheetResult.supplementedOffers += 1;
              }
            } else {
              sheetResult.duplicateOffers += 1;
            }
          }
        }
      });
    } catch (error) {
      result.readError = error instanceof Error ? error.message : String(error);
      if (result.sheets.length === 0) {
        result.sheets.push({
          relativePath: resolved.relativePath,
          category: entry.targetCategory,
          factory: entry.factory,
          sheetName: "-",
          status: "read-error",
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
          error: result.readError,
        });
      } else {
        for (const sheet of result.sheets) {
          sheet.error = sheet.error ?? result.readError;
        }
      }
    }

    results.push(result);
  }
  return results;
}

async function runDryRun(): Promise<FileDryRunResult[]> {
  const [products, offers] = await Promise.all([
    prisma.product.findMany({ select: { id: true, modelNo: true }, where: { modelNo: { not: null } } }),
    prisma.supplierOffer.findMany({ select: { productId: true, factoryName: true, purchasePrice: true } }),
  ]);

  const productByModel = new Map<string, DryProduct>();
  for (const product of products) {
    const key = productKey(product.modelNo);
    if (key && !productByModel.has(key)) {
      productByModel.set(key, { id: product.id, modelNo: product.modelNo ?? "" });
    }
  }

  const offerByProductFactory = new Map<string, DryOffer>();
  for (const offer of offers) {
    offerByProductFactory.set(offerKey(offer.productId, offer.factoryName), {
      productId: offer.productId,
      factoryName: offer.factoryName,
      purchasePrice: offer.purchasePrice.toString(),
    });
  }

  let dryProductSeq = 0;
  const results: FileDryRunResult[] = [];

  for (const [index, entry] of FILE_LIST.entries()) {
    console.log(`Dry-run ${index + 1}/${FILE_LIST.length}: ${entry.relativePath}`);
    const resolved = await resolveDiskPath(entry.relativePath);
    const result: FileDryRunResult = {
      entry,
      resolvedRelativePath: resolved.relativePath,
      pathNote: resolved.note,
      readError: null,
      sheetCount: 0,
      importSheets: [],
      analyzeSheets: [],
    };

    try {
      if (shouldSkipForV218B(entry)) {
        result.importSheets.push({
          ...emptySheetResult(entry, resolved.relativePath, "-", "already-imported", null),
          warning: "V2.18B 只导入伊特 4.25，本条为 V2.18 已处理条目，跳过",
        });
        results.push(result);
        continue;
      }

      const existingSourceOfferCount = await countExistingSourceOffers(resolved.relativePath);
      if (entry.mode === "import" && existingSourceOfferCount > 0) {
        result.importSheets.push({
          ...emptySheetResult(entry, resolved.relativePath, "-", "already-imported", null),
          duplicateOffers: existingSourceOfferCount,
          warning: `源文件已有 ${existingSourceOfferCount} 条 supplier_offers 引用，跳过以避免重复写价格历史`,
        });
        results.push(result);
        continue;
      }

      const workbook = XLSX.readFile(path.join(ROOT, resolved.relativePath), { cellDates: false, WTF: false });
      result.sheetCount = workbook.SheetNames.length;

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

        const analysis = analyzeSheet(sheetName, rows, path.basename(resolved.relativePath));
        if (entry.mode === "analyze-only") {
          result.analyzeSheets.push(buildAnalyzeSheetResult(entry, resolved.relativePath, rows, analysis));
          continue;
        }

        result.importSheets.push(
          buildSheetDryRun({
            entry,
            resolvedRelativePath: resolved.relativePath,
            rows,
            analysis,
            productByModel,
            offerByProductFactory,
            nextDryProductId: () => `dry-product-v2.18-${++dryProductSeq}`,
          }),
        );
      }
    } catch (error) {
      result.readError = error instanceof Error ? error.message : String(error);
      if (entry.mode === "import") {
        result.importSheets.push(emptySheetResult(entry, resolved.relativePath, "-", "read-error", result.readError));
      } else {
        result.analyzeSheets.push({
          relativePath: entry.relativePath,
          resolvedRelativePath: resolved.relativePath,
          factory: entry.factory,
          sheetName: "-",
          rowCount: 0,
          headerRow: null,
          modelColumn: "-",
          priceColumn: "-",
          keywords: [],
          suggestedCategory: "读取失败",
          categoryNote: "读取失败",
          samples: [],
          skipReason: result.readError,
        });
      }
    }

    results.push(result);
  }

  return results;
}

function buildSheetDryRun({
  entry,
  resolvedRelativePath,
  rows,
  analysis,
  productByModel,
  offerByProductFactory,
  nextDryProductId,
}: {
  entry: OutdoorFileEntry;
  resolvedRelativePath: string;
  rows: SheetRows;
  analysis: SheetAnalysis;
  productByModel: Map<string, DryProduct>;
  offerByProductFactory: Map<string, DryOffer>;
  nextDryProductId: () => string;
}): SheetDryRunResult {
  const result = emptySheetResult(
    entry,
    resolvedRelativePath,
    analysis.sheetName,
    analysis.skipReason ? "no-import-columns" : "ok",
    analysis.skipReason,
  );
  result.rowCount = analysis.rowCount;
  result.headerRow = analysis.headerRowIndex + 1;
  result.modelColumn = formatColumnSignal(analysis.modelColumns[0]);
  result.priceColumn = formatColumnSignal(analysis.rmbPriceColumns[0] ?? analysis.priceColumns[0]);
  result.priceColumns = analysis.rmbPriceColumns.map(formatColumnSignal);
  result.allPriceColumns = analysis.priceColumns.map(formatColumnSignal);
  result.warning = entry.note ?? null;

  if (analysis.skipReason) {
    addReason(result.skippedReasons, analysis.skipReason, analysis.rowCount);
    return result;
  }

  const mapping = buildMapping(analysis);
  const builtRows = buildImportRows(rows, mapping);
  result.validRows = builtRows.rows.length;
  result.skippedRows = builtRows.skippedRows.length;
  result.skippedReasons = builtRows.skippedRows.reduce((reasons, row) => {
    addReason(reasons, row.reason, 1);
    return reasons;
  }, new Map<string, number>());
  result.samples = builtRows.rows.slice(0, entry.note?.includes("TR-ES") ? 5 : 3);
  if (result.validRows === 0) {
    result.status = "no-valid-rows";
  }

  for (const row of builtRows.rows) {
    const modelKey = productKey(row.modelNo);
    if (!modelKey) {
      continue;
    }

    let product = productByModel.get(modelKey);
    if (!product) {
      product = { id: nextDryProductId(), modelNo: row.modelNo };
      productByModel.set(modelKey, product);
      result.newProducts += 1;
    } else {
      result.reusedProducts += 1;
    }

    const key = offerKey(product.id, entry.factory);
    const existingOffer = offerByProductFactory.get(key);
    if (!existingOffer) {
      offerByProductFactory.set(key, {
        productId: product.id,
        factoryName: entry.factory,
        purchasePrice: row.purchasePrice,
      });
      result.newOffers += 1;
      continue;
    }

    if (sameDecimal(existingOffer.purchasePrice, row.purchasePrice)) {
      result.duplicateOffers += 1;
    } else {
      existingOffer.purchasePrice = row.purchasePrice;
      result.updatedOffers += 1;
    }
  }

  return result;
}

function buildAnalyzeSheetResult(
  entry: OutdoorFileEntry,
  resolvedRelativePath: string,
  rows: SheetRows,
  analysis: SheetAnalysis,
): AnalyzeSheetResult {
  const mapping = analysis.skipReason ? null : buildMapping(analysis);
  const samples = mapping ? buildAnalyzeSamples(rows, mapping, 15) : buildFallbackAnalyzeSamples(rows, analysis.headerRowIndex, 15);
  const textForKeywords = [
    entry.relativePath,
    analysis.sheetName,
    ...analysis.headers,
    ...samples.flatMap((sample) => [sample.modelNo, sample.productName, sample.description]),
  ].join(" ");
  const category = suggestCategory(textForKeywords);

  return {
    relativePath: entry.relativePath,
    resolvedRelativePath,
    factory: entry.factory,
    sheetName: analysis.sheetName,
    rowCount: analysis.rowCount,
    headerRow: analysis.rowCount > 0 ? analysis.headerRowIndex + 1 : null,
    modelColumn: formatColumnSignal(analysis.modelColumns[0]),
    priceColumn: formatColumnSignal(analysis.rmbPriceColumns[0] ?? analysis.priceColumns[0]),
    keywords: category.keywords,
    suggestedCategory: category.suggestedCategory,
    categoryNote: category.note,
    samples,
    skipReason: analysis.skipReason,
  };
}

function analyzeSheet(sheetName: string, rows: SheetRows, fileName: string): SheetAnalysis {
  const rowCount = rows.length;
  const colCount = Math.max(0, ...rows.map((row) => row.length));
  if (rowCount === 0 || colCount === 0) {
    return emptyAnalysis(sheetName, "空 sheet");
  }
  if (SKIPPABLE_SHEET_NAME.test(sheetName)) {
    return emptyAnalysis(sheetName, "目录/封面 sheet");
  }

  const headerRows = findHeaderRows(rows);
  const headerRowIndex = headerRows[0] ? headerRows[0] - 1 : findBestHeaderIndex(rows);
  const headers = buildHeaders(rows, headerRowIndex, colCount);
  const threshold = rowCount < 30 ? 3 : 5;
  const filePriceHint = priceHintFromText(fileName);

  const modelColumns: ColumnSignal[] = [];
  const priceColumns: ColumnSignal[] = [];
  const rmbPriceColumns: ColumnSignal[] = [];

  for (let index = 0; index < colCount; index += 1) {
    const values = rows.map((row) => row[index] ?? "").slice(headerRowIndex + 1);
    const nonEmptyValues = values.filter(Boolean);
    const header = headers[index] ?? "";
    const priceValues = nonEmptyValues.filter((value) => parsePositivePrice(value) !== null);
    const modelValues = nonEmptyValues.filter((value) => isLikelyModelValue(value) || isLikelyModelHeader(header));

    if (priceValues.length >= threshold) {
      const signal = columnSignal(index, header, priceValues.length, uniqueSamples(priceValues));
      if (!header.trim()) {
        // No header: numeric density alone is not enough to trust this as a price column.
      } else if (!(isNonPriceHeader(header) && !isPriceHeader(header))) {
        priceColumns.push(signal);
        if (isRmbPriceHeader(header) || (filePriceHint === "rmb" && !isUsdPriceHeader(header))) {
          rmbPriceColumns.push(signal);
        }
      }
    }

    const modelThreshold = isLikelyModelHeader(header) ? 1 : threshold;
    if (modelValues.length >= modelThreshold) {
      modelColumns.push(columnSignal(index, header, modelValues.length, uniqueSamples(nonEmptyValues.filter(isLikelyModelValue))));
    }
  }

  priceColumns.sort(sortSignal);
  rmbPriceColumns.sort(sortSignal);
  modelColumns.sort(sortModelSignal);

  const fallbackPrice = rmbPriceColumns.length === 0 && priceColumns.length > 0 && filePriceHint === "rmb";
  const selectedPriceColumn = rmbPriceColumns[0] ?? priceColumns[0];
  const sameModelAndPriceColumn = modelColumns[0] && selectedPriceColumn && modelColumns[0].index === selectedPriceColumn.index;
  const hasImportColumns = modelColumns.length > 0 && (rmbPriceColumns.length > 0 || fallbackPrice) && !sameModelAndPriceColumn;

  return {
    sheetName,
    rowCount,
    colCount,
    headerRows,
    headerRowIndex,
    headers,
    modelColumns,
    priceColumns,
    rmbPriceColumns,
    fallbackPrice,
    skipReason: hasImportColumns ? null : sameModelAndPriceColumn ? "型号列和价格列相同" : "未检测到型号列或 RMB 价格列",
  };
}

function buildMapping(analysis: SheetAnalysis): Mapping {
  const modelColumnIndex = analysis.modelColumns[0].index;
  const priceColumnIndex = (analysis.rmbPriceColumns[0] ?? analysis.priceColumns[0]).index;
  const excluded = new Set([modelColumnIndex, priceColumnIndex]);
  const descriptionColumns = analysis.headers
    .map((header, index) => ({ header, index }))
    .filter(({ header, index }) => header && !excluded.has(index) && !isPriceHeader(header) && !isNoHeader(header) && !isPhotoHeader(header) && isDescriptionHeader(header))
    .map(({ index }) => index)
    .slice(0, 12);

  return {
    headerRowIndex: analysis.headerRowIndex,
    modelColumnIndex,
    priceColumnIndex,
    descriptionColumns,
    wattColumnIndex: findHeaderColumn(analysis.headers, [/^watt/i, /^power$/i, /功率/, /实际功率/], excluded),
  };
}

function buildImportRows(rows: SheetRows, mapping: Mapping): {
  rows: ImportRow[];
  skippedRows: Array<{ rowNumber: number; reason: string; sample: string }>;
} {
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
    modelNo = appendWattVariant(modelNo, cellAt(row, mapping.wattColumnIndex));
    if (!purchasePrice || !Number.isFinite(priceNumber) || priceNumber < PRICE_MIN || priceNumber > PRICE_MAX) {
      skippedRows.push({ rowNumber, reason: "价格列非有效 RMB 数字", sample: rawPrice ?? nonEmptyCells.slice(0, 4).join(" / ") });
      continue;
    }
    if (isHeaderLikeModel(modelNo)) {
      skippedRows.push({ rowNumber, reason: "表头/说明行被跳过", sample: modelNo });
      continue;
    }

    importRows.push({
      modelNo,
      productName: modelNo,
      purchasePrice,
      remark: mergeDescription(row, rows, mapping),
      sourceRowIndex: rowIndex,
    });
  }

  return { rows: importRows, skippedRows };
}

function buildAnalyzeSamples(rows: SheetRows, mapping: Mapping, limit: number) {
  const samples: AnalyzeSheetResult["samples"] = [];
  const importRows = buildImportRows(rows, mapping).rows;
  for (const row of importRows.slice(0, limit)) {
    samples.push({
      modelNo: row.modelNo,
      productName: row.productName,
      description: truncate(row.remark ?? "", 160),
    });
  }
  return samples;
}

function buildFallbackAnalyzeSamples(rows: SheetRows, headerRowIndex: number, limit: number) {
  const samples: AnalyzeSheetResult["samples"] = [];
  for (let rowIndex = headerRowIndex + 1; rowIndex < rows.length && samples.length < limit; rowIndex += 1) {
    const values = (rows[rowIndex] ?? []).map(normalizeText).filter(Boolean);
    if (values.length < 2) continue;
    samples.push({
      modelNo: values.find(isLikelyModelValue) ?? values[0] ?? "",
      productName: values[0] ?? "",
      description: truncate(values.slice(1, 8).join(" / "), 160),
    });
  }
  return samples;
}

function buildReport(results: FileDryRunResult[], backupPath: string): string {
  const importFiles = results.filter((result) => result.entry.mode === "import");
  const analyzeFiles = results.filter((result) => result.entry.mode === "analyze-only");
  const importSheets = importFiles.flatMap((result) => result.importSheets);
  const analyzeSheets = analyzeFiles.flatMap((result) => result.analyzeSheets);
  const okSheets = importSheets.filter((sheet) => sheet.status === "ok");
  const issueSheets = importSheets.filter(
    (sheet) => (sheet.status !== "ok" && sheet.status !== "already-imported") || (Boolean(sheet.warning) && sheet.status !== "already-imported"),
  );
  const categorySummary = summarizeByCategory(importSheets);

  const lines: string[] = [];
  lines.push("# V2.18 — 户外工厂未判定导入 Dry Run");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push("Mode: dry-run only. No database writes. No source file changes.");
  lines.push(`Backup created before dry-run: \`${backupPath}\``);
  lines.push("");

  lines.push("## 总览");
  lines.push("");
  lines.push("| 指标 | 值 |");
  lines.push("|---|---:|");
  lines.push(`| 文件清单 | ${FILE_LIST.length} |`);
  lines.push(`| import 文件 | ${importFiles.length} |`);
  lines.push(`| analyze-only 文件 | ${analyzeFiles.length} |`);
  lines.push(`| 读取失败文件 | ${results.filter((result) => result.readError).length} |`);
  lines.push(`| import sheets | ${importSheets.length} |`);
  lines.push(`| 可导入 sheets | ${okSheets.length} |`);
  lines.push(`| valid rows | ${sum(importSheets.map((sheet) => sheet.validRows))} |`);
  lines.push(`| skipped rows | ${sum(importSheets.map((sheet) => sheet.skippedRows))} |`);
  lines.push(`| 预估 new products | ${sum(importSheets.map((sheet) => sheet.newProducts))} |`);
  lines.push(`| 预估 reused products | ${sum(importSheets.map((sheet) => sheet.reusedProducts))} |`);
  lines.push(`| 预估 new offers | ${sum(importSheets.map((sheet) => sheet.newOffers))} |`);
  lines.push(`| 预估 updated offers | ${sum(importSheets.map((sheet) => sheet.updatedOffers))} |`);
  lines.push(`| duplicate/no-change offers | ${sum(importSheets.map((sheet) => sheet.duplicateOffers))} |`);
  lines.push(`| 风险/需确认 sheets | ${issueSheets.length} |`);
  lines.push("");

  lines.push("## 品类汇总");
  lines.push("");
  lines.push("| 品类 | Sheets | valid rows | skipped rows | new products | reused products | new offers | updated | duplicates |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const [category, row] of Array.from(categorySummary.entries()).sort((a, b) => a[0].localeCompare(b[0], "zh-Hans-CN"))) {
    lines.push(
      `| ${escapeMd(category)} | ${row.sheets} | ${row.validRows} | ${row.skippedRows} | ${row.newProducts} | ${row.reusedProducts} | ${row.newOffers} | ${row.updatedOffers} | ${row.duplicateOffers} |`,
    );
  }
  lines.push("");

  lines.push("## 每文件汇总");
  lines.push("");
  lines.push("| # | 文件 | 工厂 | 目标品类 | 模式 | Sheet 数 | 可导入 sheets | valid rows | 价格列 | 问题 |");
  lines.push("|---:|---|---|---|---|---:|---:|---:|---|---|");
  for (const [index, result] of results.entries()) {
    const sheetCount = result.entry.mode === "import" ? result.importSheets.length : result.analyzeSheets.length;
    const okCount = result.importSheets.filter((sheet) => sheet.status === "ok").length;
    const priceColumns = unique(result.importSheets.flatMap((sheet) => sheet.priceColumns.length > 0 ? sheet.priceColumns : [sheet.priceColumn]).filter((value) => value !== "-")).slice(0, 4);
    const issues = [
      result.readError,
      ...result.importSheets
        .filter((sheet) => sheet.status !== "ok" && sheet.status !== "already-imported")
        .map((sheet) => `${sheet.sheetName}: ${sheet.error ?? sheet.status}`),
      result.entry.note,
    ].filter(Boolean);
    lines.push(
      `| ${index + 1} | ${escapeMd(result.resolvedRelativePath)} | ${escapeMd(result.entry.factory)} | ${escapeMd(result.entry.targetCategory)} | ${result.entry.mode} | ${result.sheetCount || sheetCount} | ${okCount} | ${sum(result.importSheets.map((sheet) => sheet.validRows))} | ${escapeMd(priceColumns.join("; ") || "-")} | ${escapeMd(issues.join("；") || "-")} |`,
    );
  }
  lines.push("");

  lines.push("## 每 Sheet 明细");
  lines.push("");
  lines.push("| 文件 | 品类 | 工厂 | Sheet | 状态 | Header Row | Model Column | Price Column | valid | skipped | new product | new offer | updated | dup | 跳过原因 Top |");
  lines.push("|---|---|---|---|---|---:|---|---|---:|---:|---:|---:|---:|---:|---|");
  for (const sheet of importSheets) {
    lines.push(
      `| ${escapeMd(sheet.resolvedRelativePath)} | ${escapeMd(sheet.category)} | ${escapeMd(sheet.factory)} | ${escapeMd(sheet.sheetName)} | ${sheet.status} | ${sheet.headerRow ?? "-"} | ${escapeMd(sheet.modelColumn)} | ${escapeMd(formatPriceColumnForReport(sheet.priceColumn))} | ${sheet.validRows} | ${sheet.skippedRows} | ${sheet.newProducts} | ${sheet.newOffers} | ${sheet.updatedOffers} | ${sheet.duplicateOffers} | ${escapeMd(formatReasonCounts(sheet.skippedReasons))} |`,
    );
  }
  lines.push("");

  lines.push("## 样本行");
  lines.push("");
  lines.push("| 文件 | Sheet | 品类 | model_no | price | remark |");
  lines.push("|---|---|---|---|---:|---|");
  for (const sheet of importSheets) {
    for (const sample of sheet.samples) {
      lines.push(
        `| ${escapeMd(sheet.resolvedRelativePath)} | ${escapeMd(sheet.sheetName)} | ${escapeMd(sheet.category)} | ${escapeMd(sample.modelNo)} | ${sample.purchasePrice} | ${escapeMd(truncate(sample.remark ?? "", 90))} |`,
      );
    }
  }
  lines.push("");

  lines.push("## TR-ES 路灯验证样本");
  lines.push("");
  const tresSheets = importSheets.filter((sheet) => sheet.resolvedRelativePath.includes("TR-ES"));
  if (tresSheets.length === 0) {
    lines.push("未读取到 TR-ES 文件。");
  } else {
    lines.push("| Sheet | model_no | price | remark |");
    lines.push("|---|---|---:|---|");
    for (const sheet of tresSheets) {
      for (const sample of sheet.samples.slice(0, 5)) {
        lines.push(`| ${escapeMd(sheet.sheetName)} | ${escapeMd(sample.modelNo)} | ${sample.purchasePrice} | ${escapeMd(truncate(sample.remark ?? "", 120))} |`);
      }
    }
  }
  lines.push("");

  if (analyzeSheets.length > 0) {
    lines.push("## Analyze-only 文件");
    lines.push("");
    lines.push("🔍 以下文件只分析，apply 时跳过。");
    lines.push("");
    lines.push("| Sheet | rows | Header Row | Model Column | Price Column | 关键词 | 建议品类 | 说明 |");
    lines.push("|---|---:|---:|---|---|---|---|---|");
    for (const sheet of analyzeSheets) {
      lines.push(
        `| ${escapeMd(sheet.sheetName)} | ${sheet.rowCount} | ${sheet.headerRow ?? "-"} | ${escapeMd(sheet.modelColumn)} | ${escapeMd(formatPriceColumnForReport(sheet.priceColumn))} | ${escapeMd(sheet.keywords.join(", ") || "-")} | ${escapeMd(sheet.suggestedCategory)} | ${escapeMd(sheet.categoryNote)} |`,
      );
    }
    lines.push("");
    for (const sheet of analyzeSheets) {
      lines.push(`### ${escapeMd(sheet.sheetName)}`);
      lines.push("");
      if (sheet.skipReason) {
        lines.push(`检测提示：${sheet.skipReason}`);
        lines.push("");
      }
      lines.push("| # | model / product | description |");
      lines.push("|---:|---|---|");
      sheet.samples.forEach((sample, index) => {
        lines.push(`| ${index + 1} | ${escapeMd(sample.modelNo || sample.productName)} | ${escapeMd(sample.description)} |`);
      });
      if (sheet.samples.length === 0) {
        lines.push("| - | - | - |");
      }
      lines.push("");
    }
  }

  lines.push("## 风险项 / 检测失败");
  lines.push("");
  lines.push("| 文件 | 品类 | 工厂 | Sheet | 问题 |");
  lines.push("|---|---|---|---|---|");
  if (issueSheets.length === 0) {
    lines.push("| - | - | - | - | 无 |");
  } else {
    for (const sheet of issueSheets) {
      lines.push(
        `| ${escapeMd(sheet.resolvedRelativePath)} | ${escapeMd(sheet.category)} | ${escapeMd(sheet.factory)} | ${escapeMd(sheet.sheetName)} | ${escapeMd(sheet.error ?? sheet.warning ?? sheet.status)} |`,
      );
    }
  }
  lines.push("");

  lines.push("## 路径修正");
  lines.push("");
  lines.push("| 计划路径 | 实际读取路径 | 说明 |");
  lines.push("|---|---|---|");
  const pathNotes = results.filter((result) => result.pathNote);
  if (pathNotes.length === 0) {
    lines.push("| - | - | 无 |");
  } else {
    for (const result of pathNotes) {
      lines.push(`| ${escapeMd(result.entry.relativePath)} | ${escapeMd(result.resolvedRelativePath)} | ${escapeMd(result.pathNote ?? "")} |`);
    }
  }
  lines.push("");

  lines.push("## 说明");
  lines.push("");
  lines.push("- 本报告只做 dry-run：未调用 Prisma create/update/delete，没有写入 files/products/supplier_offers/price_history。");
  lines.push("- 只读取 19 个硬编码目标文件；不读取 enrichment-only，不读取 `_lenovo` 冲突文件。");
  if (analyzeFiles.length > 0) {
    lines.push("- analyze-only 文件不进入导入估算。");
  } else {
    lines.push("- 本次没有 analyze-only 文件，19 个文件全部按 import 流程评估。");
  }
  lines.push("- `updated offers` 表示同 product + factory 已存在但价格不同；真正 apply 时会走价格版本追踪。");

  return lines.join("\n");
}

function buildApplyReport({
  results,
  backupPath,
  beforeCounts,
  afterCounts,
}: {
  results: FileApplyResult[];
  backupPath: string;
  beforeCounts: DbCounts;
  afterCounts: DbCounts;
}): string {
  const sheets = results.flatMap((result) => result.sheets);
  const categories = ["投光灯", "路灯", "太阳能壁灯", "充电灯", "工作灯", "面板灯", "Highbay"];
  const categorySummary = summarizeApplyByCategory(sheets);
  const lines: string[] = [];

  lines.push("# V2.18 — 户外工厂未判定导入 Apply Report");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push("Mode: apply. Source Excel files were read-only.");
  lines.push(`Backup: \`${backupPath}\``);
  lines.push("");

  lines.push("## 总览");
  lines.push("");
  lines.push("| 指标 | 值 |");
  lines.push("|---|---:|");
  lines.push(`| 文件清单 | ${FILE_LIST.length} |`);
  lines.push(`| import 文件 | ${FILE_LIST.filter((entry) => entry.mode === "import").length} |`);
  lines.push(`| analyze-only 跳过 | ${FILE_LIST.filter((entry) => entry.mode === "analyze-only").length} |`);
  lines.push(`| 读取失败文件 | ${results.filter((result) => result.readError).length} |`);
  lines.push(`| sheets | ${sheets.length} |`);
  lines.push(`| valid rows | ${sum(sheets.map((sheet) => sheet.validRows))} |`);
  lines.push(`| skipped rows | ${sum(sheets.map((sheet) => sheet.skippedRows))} |`);
  lines.push(`| new products | ${sum(sheets.map((sheet) => sheet.newProducts))} |`);
  lines.push(`| reused products | ${sum(sheets.map((sheet) => sheet.reusedProducts))} |`);
  lines.push(`| new offers | ${sum(sheets.map((sheet) => sheet.newOffers))} |`);
  lines.push(`| updated offers | ${sum(sheets.map((sheet) => sheet.updatedOffers))} |`);
  lines.push(`| supplemented offers | ${sum(sheets.map((sheet) => sheet.supplementedOffers))} |`);
  lines.push(`| duplicate/no-change offers | ${sum(sheets.map((sheet) => sheet.duplicateOffers))} |`);
  lines.push(`| price_history created | ${sum(sheets.map((sheet) => sheet.priceHistory))} |`);
  lines.push("");

  lines.push("## Before / After");
  lines.push("");
  lines.push("| 表/范围 | Before | After | Delta |");
  lines.push("|---|---:|---:|---:|");
  lines.push(`| products | ${beforeCounts.products} | ${afterCounts.products} | ${formatDelta(afterCounts.products - beforeCounts.products)} |`);
  lines.push(`| supplier_offers | ${beforeCounts.supplierOffers} | ${afterCounts.supplierOffers} | ${formatDelta(afterCounts.supplierOffers - beforeCounts.supplierOffers)} |`);
  lines.push(`| price_history | ${beforeCounts.priceHistory} | ${afterCounts.priceHistory} | ${formatDelta(afterCounts.priceHistory - beforeCounts.priceHistory)} |`);
  lines.push(`| files (My Passport) | ${beforeCounts.filesMyPassport} | ${afterCounts.filesMyPassport} | ${formatDelta(afterCounts.filesMyPassport - beforeCounts.filesMyPassport)} |`);
  for (const category of categories) {
    lines.push(
      `| ${escapeMd(category)} products | ${beforeCounts.categories[category] ?? 0} | ${afterCounts.categories[category] ?? 0} | ${formatDelta((afterCounts.categories[category] ?? 0) - (beforeCounts.categories[category] ?? 0))} |`,
    );
  }
  lines.push("");

  lines.push("## 品类汇总");
  lines.push("");
  lines.push("| 品类 | Sheets | valid rows | new products | reused products | new offers | updated | supplemented | duplicate | price_history |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const [category, row] of Array.from(categorySummary.entries()).sort((a, b) => a[0].localeCompare(b[0], "zh-Hans-CN"))) {
    lines.push(
      `| ${escapeMd(category)} | ${row.sheets} | ${row.validRows} | ${row.newProducts} | ${row.reusedProducts} | ${row.newOffers} | ${row.updatedOffers} | ${row.supplementedOffers} | ${row.duplicateOffers} | ${row.priceHistory} |`,
    );
  }
  lines.push("");

  lines.push("## 每 Sheet 明细");
  lines.push("");
  lines.push("| 文件 | 品类 | 工厂 | Sheet | 状态 | Header Row | Model Column | Price Column | valid | skipped | new products | reused | new offers | updated | supplemented | duplicate | price_history | error |");
  lines.push("|---|---|---|---|---|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|");
  for (const sheet of sheets) {
    lines.push(
      `| ${escapeMd(sheet.relativePath)} | ${escapeMd(sheet.category)} | ${escapeMd(sheet.factory)} | ${escapeMd(sheet.sheetName)} | ${escapeMd(sheet.status)} | ${sheet.headerRow ?? "-"} | ${escapeMd(sheet.modelColumn)} | ${escapeMd(sheet.priceColumn)} | ${sheet.validRows} | ${sheet.skippedRows} | ${sheet.newProducts} | ${sheet.reusedProducts} | ${sheet.newOffers} | ${sheet.updatedOffers} | ${sheet.supplementedOffers} | ${sheet.duplicateOffers} | ${sheet.priceHistory} | ${escapeMd(sheet.error ?? "-")} |`,
    );
  }
  lines.push("");

  lines.push("## 跳过 / 风险项");
  lines.push("");
  lines.push("| 文件 | 品类 | 工厂 | Sheet | 原因 |");
  lines.push("|---|---|---|---|---|");
  const issues = sheets.filter((sheet) => (sheet.status !== "ok" && sheet.status !== "already-imported") || (Boolean(sheet.error) && sheet.status !== "already-imported"));
  if (issues.length === 0) {
    lines.push("| - | - | - | - | 无 |");
  } else {
    for (const issue of issues) {
      lines.push(`| ${escapeMd(issue.relativePath)} | ${escapeMd(issue.category)} | ${escapeMd(issue.factory)} | ${escapeMd(issue.sheetName)} | ${escapeMd(issue.error ?? issue.status)} |`);
    }
  }
  lines.push("");

  lines.push("## 说明");
  lines.push("");
  if (FILE_LIST.some((entry) => entry.mode === "analyze-only")) {
    lines.push("- analyze-only 文件本次 apply 跳过。");
  } else {
    lines.push("- 本次没有 analyze-only 文件，19 个文件全部按 import 流程处理。");
  }
  lines.push("- 4 个 needs-review 文件未检测到型号/RMB 价格列，apply 时按计划跳过。");
  lines.push("- `KCD-TB qoutation20250527.xlsx` 已按审核改归 `太阳能壁灯`。");
  lines.push("- 源 Excel 文件只读，未移动、未重命名、未覆盖。");

  return lines.join("\n");
}

async function backupDatabase(): Promise<string> {
  await mkdir("backups", { recursive: true });
  const stamp = runStartedAt
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\..+$/, "")
    .replace("T", "-");
  const backupPath = path.join("backups", `dev-before-v2.18-${stamp}.sqlite`);
  await copyFile("prisma/dev.db", backupPath);
  return backupPath;
}

async function ensureFileRecord(entry: OutdoorFileEntry, relativePath: string) {
  const absolutePath = path.join(ROOT, relativePath);
  const existing = await prisma.file.findUnique({
    where: {
      volumeName_relativePath: {
        volumeName: "My Passport",
        relativePath,
      },
    },
  });
  if (existing) {
    return existing;
  }

  const fileStat = await stat(absolutePath);
  return prisma.file.create({
    data: {
      fileName: path.basename(relativePath),
      fileType: "excel",
      fileSize: BigInt(fileStat.size),
      folderName: entry.targetCategory,
      factoryGuess: entry.factory,
      volumeName: "My Passport",
      relativePath,
      absolutePathSnapshot: absolutePath,
      modifiedAt: fileStat.mtime,
    },
  });
}

async function getDbCounts(): Promise<DbCounts> {
  const [products, supplierOffers, priceHistory, filesMyPassport, categories] = await Promise.all([
    prisma.product.count(),
    prisma.supplierOffer.count(),
    prisma.priceHistory.count(),
    prisma.file.count({ where: { volumeName: "My Passport" } }),
    prisma.product.groupBy({
      by: ["category"],
      _count: { _all: true },
    }),
  ]);

  return {
    products,
    supplierOffers,
    priceHistory,
    filesMyPassport,
    categories: Object.fromEntries(categories.map((row) => [row.category ?? "(null)", row._count._all])),
  };
}

async function countExistingSourceOffers(relativePath: string): Promise<number> {
  const fileRecord = await prisma.file.findUnique({
    where: {
      volumeName_relativePath: {
        volumeName: "My Passport",
        relativePath,
      },
    },
    select: { id: true },
  });
  if (!fileRecord) return 0;
  return prisma.supplierOffer.count({ where: { sourceFileId: fileRecord.id } });
}

function shouldSkipForV218B(entry: OutdoorFileEntry): boolean {
  return entry.mode === "import" && !V218B_IMPORT_RELATIVE_PATHS.has(entry.relativePath);
}

async function resolveDiskPath(relativePath: string): Promise<{ relativePath: string; note: string | null }> {
  const normalized = normalizePathValue(relativePath);
  if (existsSync(path.join(ROOT, normalized))) {
    return { relativePath: normalized, note: null };
  }

  const directory = path.posix.dirname(normalized);
  const fileName = path.posix.basename(normalized);
  const absoluteDirectory = path.join(ROOT, directory);
  try {
    const entries = await readdir(absoluteDirectory, { withFileTypes: true });
    const sameExt = entries
      .filter((entry) => entry.isFile())
      .filter((entry) => !entry.name.startsWith(".") && !entry.name.startsWith("~$"))
      .filter((entry) => path.extname(entry.name).toLowerCase() === path.extname(fileName).toLowerCase());
    const targetKey = withoutSpaces(fileName);
    const matches = sameExt.filter((entry) => withoutSpaces(entry.name) === targetKey);
    if (matches.length === 1) {
      const resolved = path.posix.join(directory, normalizePathValue(matches[0].name));
      return { relativePath: resolved, note: "文件名空格/Unicode 差异，按同目录唯一文件匹配" };
    }
    return { relativePath: normalized, note: matches.length > 1 ? "同目录去空格匹配到多个候选，未自动替换" : null };
  } catch {
    return { relativePath: normalized, note: null };
  }
}

function emptySheetApplyResult(entry: OutdoorFileEntry, resolvedRelativePath: string, analysis: SheetAnalysis): SheetApplyResult {
  return {
    relativePath: resolvedRelativePath,
    category: entry.targetCategory,
    factory: entry.factory,
    sheetName: analysis.sheetName,
    status: analysis.skipReason ? "skipped" : "ok",
    headerRow: analysis.rowCount > 0 ? analysis.headerRowIndex + 1 : null,
    modelColumn: formatColumnSignal(analysis.modelColumns[0]),
    priceColumn: formatColumnSignal(analysis.rmbPriceColumns[0] ?? analysis.priceColumns[0]),
    validRows: 0,
    skippedRows: 0,
    newProducts: 0,
    reusedProducts: 0,
    newOffers: 0,
    updatedOffers: 0,
    supplementedOffers: 0,
    duplicateOffers: 0,
    priceHistory: 0,
    error: analysis.skipReason,
  };
}

function emptySheetResult(
  entry: OutdoorFileEntry,
  resolvedRelativePath: string,
  sheetName: string,
  status: SheetDryRunResult["status"],
  error: string | null,
): SheetDryRunResult {
  return {
    relativePath: entry.relativePath,
    resolvedRelativePath,
    category: entry.targetCategory,
    factory: entry.factory,
    sheetName,
    mode: entry.mode,
    status,
    error,
    rowCount: 0,
    headerRow: null,
    modelColumn: "-",
    priceColumn: "-",
    validRows: 0,
    skippedRows: 0,
    newProducts: 0,
    reusedProducts: 0,
    newOffers: 0,
    updatedOffers: 0,
    duplicateOffers: 0,
    skippedReasons: new Map(),
    samples: [],
    priceColumns: [],
    allPriceColumns: [],
    warning: null,
  };
}

function emptyAnalysis(sheetName: string, reason: string): SheetAnalysis {
  return {
    sheetName,
    rowCount: 0,
    colCount: 0,
    headerRows: [],
    headerRowIndex: 0,
    headers: [],
    modelColumns: [],
    priceColumns: [],
    rmbPriceColumns: [],
    fallbackPrice: false,
    skipReason: reason,
  };
}

function normalizeRows(rows: unknown[][]): SheetRows {
  return rows.map((row) => row.map((cell) => normalizeText(cell)));
}

function findHeaderRows(rows: SheetRows): number[] {
  return rows
    .slice(0, 20)
    .map((row, index) => ({ row, number: index + 1 }))
    .filter(({ row }) => {
      const text = row.join(" ");
      const nonEmpty = row.filter((cell) => cell !== "").length;
      return nonEmpty >= 2 && /型号|款号|model|item|code|品名|产品|规格|spec|单价|price|价格|报价|rmb|人民币|含税|工厂/i.test(text);
    })
    .map(({ number }) => number);
}

function findBestHeaderIndex(rows: SheetRows): number {
  const candidate = rows.slice(0, 20).findIndex((row) => row.filter((cell) => cell !== "").length >= 2);
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
  return { index, letter: columnLetter(index), header, count, samples: samples.slice(0, 3) };
}

function sortSignal(a: ColumnSignal, b: ColumnSignal): number {
  const aPrice = isPriceHeader(a.header) ? 1 : 0;
  const bPrice = isPriceHeader(b.header) ? 1 : 0;
  if (aPrice !== bPrice) return bPrice - aPrice;
  return b.count - a.count || a.index - b.index;
}

function sortModelSignal(a: ColumnSignal, b: ColumnSignal): number {
  const aModel = modelHeaderScore(a.header);
  const bModel = modelHeaderScore(b.header);
  if (aModel !== bModel) return bModel - aModel;
  return b.count - a.count || a.index - b.index;
}

function modelHeaderScore(header: string): number {
  const text = normalizeText(header);
  if (/^(model|model\s*no\.?|model\s*number|型号|款号|产品型号|货号|type)$/i.test(text)) {
    return 3;
  }
  if (isLikelyModelHeader(text)) {
    return 2;
  }
  if (/spec|规格|尺寸|功率|watt|power|lumen|色温|cct|voltage|电压|picture|image|photo|图片|价格|price|含税|rmb/i.test(text)) {
    return 0;
  }
  return 1;
}

function uniqueSamples(values: string[]): string[] {
  return Array.from(new Set(values.map(normalizeText).filter(Boolean))).slice(0, 5);
}

function isDescriptionHeader(header: string): boolean {
  return /description|details|spec|power|watt|voltage|cct|lumen|flux|material|warranty|base|beam|pf|cri|参数|描述|功率|电压|色温|光通|材质|质保|底座|灯头|工作模式|功能|配置|驱动|显指|光效|尺寸|规格/i.test(
    normalizeText(header),
  );
}

function findHeaderColumn(headers: string[], tests: RegExp[], excluded: Set<number>): number | null {
  for (const test of tests) {
    const index = headers.findIndex((header, columnIndex) => !excluded.has(columnIndex) && test.test(normalizeText(header)));
    if (index >= 0) return index;
  }
  return null;
}

function appendWattVariant(modelNo: string, wattValue: string | null): string {
  const watt = normalizeText(wattValue);
  if (!watt || /\d+(?:\.\d+)?\s*w/i.test(modelNo)) {
    return modelNo;
  }
  const match = watt.match(/\d+(?:\.\d+)?\s*w/i);
  return match ? `${modelNo} ${match[0].replace(/\s+/g, "")}` : modelNo;
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

function suggestCategory(text: string): { suggestedCategory: string; keywords: string[]; note: string } {
  const normalized = normalizeText(text);
  const rules: Array<{ category: string; pattern: RegExp; label: string }> = [
    { category: "Highbay", pattern: /high\s*bay|highbay|ufo|工矿|矿灯|高棚/i, label: "Highbay/UFO/工矿" },
    { category: "路灯", pattern: /street\s*light|solar\s*street|路灯|道路|zy-sl|tr-es|sl[-\s]?\d/i, label: "street/路灯/SL/TR-ES" },
    { category: "投光灯", pattern: /flood|泛光|投光|tg\d|tg-|tb\d|tb-|spot\s*light/i, label: "flood/泛光/投光/TG/TB" },
    { category: "工作灯", pattern: /work\s*light|working\s*lamp|工作灯/i, label: "work/工作灯" },
    { category: "充电灯", pattern: /充电灯|recharge|dc\s*lamp|r0[1-9]/i, label: "充电/R 系列" },
    { category: "面板灯", pattern: /panel|面板|无边框/i, label: "panel/面板" },
    { category: "壁灯", pattern: /wall\s*light|壁灯/i, label: "wall/壁灯" },
  ];
  const matches = rules.filter((rule) => rule.pattern.test(normalized));
  const categories = Array.from(new Set(matches.map((match) => match.category)));
  if (categories.length === 0) {
    return { suggestedCategory: "待人工确认", keywords: [], note: "未检测到明确品类关键词" };
  }
  if (categories.length === 1) {
    return { suggestedCategory: categories[0], keywords: matches.map((match) => match.label), note: "单一品类关键词" };
  }
  return {
    suggestedCategory: "混合/需按 sheet 或行拆分",
    keywords: matches.map((match) => `${match.category}:${match.label}`),
    note: `检测到多个品类：${categories.join(", ")}`,
  };
}

function cellAt(row: string[], columnIndex: number | null): string | null {
  if (columnIndex === null || columnIndex === undefined) return null;
  const value = normalizeText(row[columnIndex]);
  return value || null;
}

function isEmptyRow(row: string[]): boolean {
  return row.every((cell) => normalizeText(cell) === "");
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

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFC")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizePathValue(value: string): string {
  return String(value ?? "")
    .normalize("NFC")
    .replaceAll("\\", "/")
    .trim();
}

function withoutSpaces(value: string): string {
  return normalizePathValue(value).replace(/\s+/g, "").toLowerCase();
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

function formatPriceColumnForReport(priceColumn: string): string {
  if (!priceColumn || priceColumn === "-") return priceColumn;
  return isPriceHeader(priceColumn) ? priceColumn : `${priceColumn} ⚠️无价格关键词`;
}

function addReason(map: Map<string, number>, reason: string, count: number) {
  map.set(reason, (map.get(reason) ?? 0) + count);
}

function formatReasonCounts(map: Map<string, number>): string {
  const entries = Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  return entries
    .slice(0, 3)
    .map(([reason, count]) => `${reason}×${count}`)
    .join("; ");
}

function summarizeByCategory(sheets: SheetDryRunResult[]) {
  const summary = new Map<
    string,
    {
      sheets: number;
      validRows: number;
      skippedRows: number;
      newProducts: number;
      reusedProducts: number;
      newOffers: number;
      updatedOffers: number;
      duplicateOffers: number;
    }
  >();
  for (const sheet of sheets) {
    const row =
      summary.get(sheet.category) ??
      {
        sheets: 0,
        validRows: 0,
        skippedRows: 0,
        newProducts: 0,
        reusedProducts: 0,
        newOffers: 0,
        updatedOffers: 0,
        duplicateOffers: 0,
      };
    row.sheets += 1;
    row.validRows += sheet.validRows;
    row.skippedRows += sheet.skippedRows;
    row.newProducts += sheet.newProducts;
    row.reusedProducts += sheet.reusedProducts;
    row.newOffers += sheet.newOffers;
    row.updatedOffers += sheet.updatedOffers;
    row.duplicateOffers += sheet.duplicateOffers;
    summary.set(sheet.category, row);
  }
  return summary;
}

function summarizeApplyByCategory(sheets: SheetApplyResult[]) {
  const summary = new Map<
    string,
    {
      sheets: number;
      validRows: number;
      newProducts: number;
      reusedProducts: number;
      newOffers: number;
      updatedOffers: number;
      supplementedOffers: number;
      duplicateOffers: number;
      priceHistory: number;
    }
  >();
  for (const sheet of sheets) {
    const row =
      summary.get(sheet.category) ??
      {
        sheets: 0,
        validRows: 0,
        newProducts: 0,
        reusedProducts: 0,
        newOffers: 0,
        updatedOffers: 0,
        supplementedOffers: 0,
        duplicateOffers: 0,
        priceHistory: 0,
      };
    row.sheets += 1;
    row.validRows += sheet.validRows;
    row.newProducts += sheet.newProducts;
    row.reusedProducts += sheet.reusedProducts;
    row.newOffers += sheet.newOffers;
    row.updatedOffers += sheet.updatedOffers;
    row.supplementedOffers += sheet.supplementedOffers;
    row.duplicateOffers += sheet.duplicateOffers;
    row.priceHistory += sheet.priceHistory;
    summary.set(sheet.category, row);
  }
  return summary;
}

function formatDelta(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function truncate(value: string, length: number): string {
  const text = normalizeText(value);
  return text.length > length ? `${text.slice(0, length)}...` : text;
}

function sum(values: number[]): number {
  return values.reduce((acc, value) => acc + value, 0);
}

function escapeMd(value: unknown): string {
  return normalizeText(value).replaceAll("|", "\\|");
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
