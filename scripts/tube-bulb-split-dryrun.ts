import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { PrismaClient } from "@prisma/client";
import * as XLSX from "xlsx";

import { parsePriceValue, type SheetRows } from "../src/lib/excel-import";
import { normalizeCsvPath, resolveRelativePath } from "./classify-tube-bulb";

const ROOT = "/Volumes/My Passport/AI 报价/各家工厂最新报价汇总";
const PLAN_PATH = "docs/tube-bulb-split-import-plan.md";
const REPORT_PATH = "docs/tube-bulb-split-dryrun.md";
const PRICE_MIN = 0.01;
const PRICE_MAX = 100_000;

type SplitCategory = "球泡" | "灯管";

export type SplitPlanEntry = {
  relativePath: string;
  factory: string;
  category: SplitCategory;
  sheetNames: string[];
  reason: string;
};

export type SplitSkipEntry = {
  relativePath: string;
  factory: string;
  reason: string;
};

export type SplitImportPlan = {
  entries: SplitPlanEntry[];
  skipEntries: SplitSkipEntry[];
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
};

type DryRunRow = {
  modelNo: string;
  purchasePrice: string;
};

type SheetDryRunResult = {
  relativePath: string;
  resolvedRelativePath: string;
  category: SplitCategory;
  factory: string;
  sheetName: string;
  status: "ok" | "no-import-columns" | "no-valid-rows" | "missing-planned-sheet" | "read-error";
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
  modelSamples: string[];
  priceSamples: string[];
};

type FileDryRunResult = {
  entry: SplitPlanEntry;
  resolvedRelativePath: string;
  pathNote: string | null;
  strictWhitelist: boolean;
  selectedSheets: string[];
  missingSheets: string[];
  readError: string | null;
  sheets: SheetDryRunResult[];
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

const prisma = new PrismaClient();

async function main() {
  const planText = await readFile(readArg("--plan") ?? PLAN_PATH, "utf8");
  const reportPath = readArg("--report") ?? REPORT_PATH;
  const plan = parseSplitImportPlan(planText);
  const results = await runDryRun(plan);
  await writeFile(reportPath, buildReport(plan, results), "utf8");

  const allSheets = results.flatMap((result) => result.sheets);
  console.log(
    JSON.stringify(
      {
        reportPath,
        planEntries: plan.entries.length,
        skippedFiles: plan.skipEntries.length,
        selectedSheets: allSheets.length,
        validRows: sum(allSheets.map((sheet) => sheet.validRows)),
        readErrors: results.filter((result) => result.readError).length,
        missingPlannedSheets: sum(results.map((result) => result.missingSheets.length)),
      },
      null,
      2,
    ),
  );
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

export function selectPlannedSheets({
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

async function runDryRun(plan: SplitImportPlan): Promise<FileDryRunResult[]> {
  if (!existsSync(ROOT)) {
    throw new Error(`硬盘目录不可访问：${ROOT}`);
  }

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
  const pathCounts = new Map<string, number>();
  for (const entry of plan.entries) {
    pathCounts.set(entry.relativePath, (pathCounts.get(entry.relativePath) ?? 0) + 1);
  }

  const results: FileDryRunResult[] = [];
  for (const entry of plan.entries) {
    const strictWhitelist = (pathCounts.get(entry.relativePath) ?? 0) > 1;
    const resolved = await resolveDiskPath(entry.relativePath);
    const fileResult: FileDryRunResult = {
      entry,
      resolvedRelativePath: resolved.relativePath,
      pathNote: resolved.note,
      strictWhitelist,
      selectedSheets: [],
      missingSheets: [],
      readError: null,
      sheets: [],
    };

    try {
      const workbook = XLSX.readFile(path.join(ROOT, resolved.relativePath), { cellDates: false, WTF: false });
      const selection = selectPlannedSheets({
        availableSheets: workbook.SheetNames,
        plannedSheets: entry.sheetNames,
        strictWhitelist,
      });
      fileResult.selectedSheets = selection.selectedSheets;
      fileResult.missingSheets = selection.missingSheets;

      for (const missingSheet of selection.missingSheets) {
        fileResult.sheets.push(emptySheetResult(entry, resolved.relativePath, missingSheet, "missing-planned-sheet", "计划 sheet 在文件中不存在"));
      }

      for (const sheetName of selection.selectedSheets) {
        const sheet = workbook.Sheets[sheetName];
        const rows = normalizeRows(
          XLSX.utils.sheet_to_json<unknown[]>(sheet, {
            header: 1,
            raw: false,
            defval: "",
            blankrows: false,
          }),
        );
        const analysis = analyzeSheet(sheetName, rows, path.basename(resolved.relativePath));
        const sheetResult = buildSheetDryRun({
          entry,
          resolvedRelativePath: resolved.relativePath,
          rows,
          analysis,
          productByModel,
          offerByProductFactory,
          nextDryProductId: () => `dry-product-${++dryProductSeq}`,
        });
        fileResult.sheets.push(sheetResult);
      }
    } catch (error) {
      fileResult.readError = error instanceof Error ? error.message : String(error);
      fileResult.sheets.push(emptySheetResult(entry, resolved.relativePath, "-", "read-error", fileResult.readError));
    }

    results.push(fileResult);
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
  entry: SplitPlanEntry;
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
  result.modelSamples = analysis.modelColumns[0]?.samples ?? [];
  result.priceSamples = (analysis.rmbPriceColumns[0] ?? analysis.priceColumns[0])?.samples ?? [];

  if (analysis.skipReason) {
    addReason(result.skippedReasons, analysis.skipReason, analysis.rowCount);
    return result;
  }

  const mapping = buildMapping(rows, analysis);
  const builtRows = buildImportRows(rows, mapping);
  result.validRows = builtRows.rows.length;
  result.skippedRows = builtRows.skippedRows.length;
  result.skippedReasons = builtRows.skippedRows.reduce((reasons, row) => {
    addReason(reasons, row.reason, 1);
    return reasons;
  }, new Map<string, number>());
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

function analyzeSheet(sheetName: string, rows: SheetRows, fileName: string): SheetAnalysis {
  const rowCount = rows.length;
  const colCount = Math.max(0, ...rows.map((row) => row.length));
  if (rowCount === 0 || colCount === 0) {
    return emptyAnalysis(sheetName, "空 sheet");
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
      if (!(isNonPriceHeader(header) && !isPriceHeader(header))) {
        priceColumns.push(signal);
        if (isRmbPriceHeader(header) || (filePriceHint === "rmb" && !isUsdPriceHeader(header))) {
          rmbPriceColumns.push(signal);
        }
      }
    }

    if (modelValues.length >= threshold) {
      modelColumns.push(columnSignal(index, header, modelValues.length, uniqueSamples(nonEmptyValues.filter(isLikelyModelValue))));
    }
  }

  priceColumns.sort(sortSignal);
  rmbPriceColumns.sort(sortSignal);
  modelColumns.sort(sortSignal);

  const fallbackPrice = rmbPriceColumns.length === 0 && priceColumns.length > 0 && filePriceHint === "rmb";
  const hasImportColumns = modelColumns.length > 0 && (rmbPriceColumns.length > 0 || fallbackPrice);

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
    skipReason: hasImportColumns ? null : "未检测到型号列或 RMB 价格列",
  };
}

function buildMapping(rows: SheetRows, analysis: SheetAnalysis): Mapping {
  const modelColumnIndex = analysis.modelColumns[0].index;
  const priceColumnIndex = (analysis.rmbPriceColumns[0] ?? analysis.priceColumns[0]).index;
  const excluded = new Set([modelColumnIndex, priceColumnIndex]);
  const descriptionColumns = analysis.headers
    .map((header, index) => ({ header, index }))
    .filter(({ header, index }) => header && !excluded.has(index) && !isPriceHeader(header) && isDescriptionHeader(header))
    .map(({ index }) => index)
    .slice(0, 12);

  return {
    headerRowIndex: analysis.headerRowIndex,
    modelColumnIndex,
    priceColumnIndex,
    descriptionColumns,
  };
}

function buildImportRows(rows: SheetRows, mapping: Mapping): {
  rows: DryRunRow[];
  skippedRows: Array<{ rowNumber: number; reason: string; sample: string }>;
} {
  const importRows: DryRunRow[] = [];
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

    importRows.push({ modelNo, purchasePrice });
  }

  return { rows: importRows, skippedRows };
}

function buildReport(plan: SplitImportPlan, results: FileDryRunResult[]): string {
  const sheetResults = results.flatMap((result) => result.sheets);
  const totals = {
    selectedSheets: sheetResults.length,
    validRows: sum(sheetResults.map((sheet) => sheet.validRows)),
    skippedRows: sum(sheetResults.map((sheet) => sheet.skippedRows)),
    newProducts: sum(sheetResults.map((sheet) => sheet.newProducts)),
    reusedProducts: sum(sheetResults.map((sheet) => sheet.reusedProducts)),
    newOffers: sum(sheetResults.map((sheet) => sheet.newOffers)),
    updatedOffers: sum(sheetResults.map((sheet) => sheet.updatedOffers)),
    duplicateOffers: sum(sheetResults.map((sheet) => sheet.duplicateOffers)),
    readErrors: results.filter((result) => result.readError).length,
    missingSheets: sum(results.map((result) => result.missingSheets.length)),
  };
  const categorySummary = summarizeByCategory(sheetResults);

  const lines: string[] = [];
  lines.push("# V2.17E — 价格列修复后灯管/球泡拆分导入 Dry Run");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push("Mode: dry-run only, no database writes, no source file changes.");
  lines.push("");
  lines.push("## 总览");
  lines.push("");
  lines.push("| 指标 | 值 |");
  lines.push("|---|---:|");
  lines.push(`| 计划导入项 | ${plan.entries.length} |`);
  lines.push(`| Skip 文件 | ${plan.skipEntries.length} |`);
  lines.push(`| 处理 sheet | ${totals.selectedSheets} |`);
  lines.push(`| valid rows | ${totals.validRows} |`);
  lines.push(`| skipped rows | ${totals.skippedRows} |`);
  lines.push(`| new products | ${totals.newProducts} |`);
  lines.push(`| reused products | ${totals.reusedProducts} |`);
  lines.push(`| new offers | ${totals.newOffers} |`);
  lines.push(`| updated offers（价格不同） | ${totals.updatedOffers} |`);
  lines.push(`| duplicates（已有/本轮重复 offer） | ${totals.duplicateOffers} |`);
  lines.push(`| read errors | ${totals.readErrors} |`);
  lines.push(`| missing planned sheets | ${totals.missingSheets} |`);
  lines.push("");

  lines.push("## 品类汇总");
  lines.push("");
  lines.push("| 品类 | Sheets | valid rows | skipped rows | new products | new offers | updated | duplicates |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|---:|");
  for (const category of ["球泡", "灯管"] as const) {
    const row = categorySummary.get(category);
    lines.push(
      `| ${category} | ${row?.sheets ?? 0} | ${row?.validRows ?? 0} | ${row?.skippedRows ?? 0} | ${row?.newProducts ?? 0} | ${row?.newOffers ?? 0} | ${row?.updatedOffers ?? 0} | ${row?.duplicateOffers ?? 0} |`,
    );
  }
  lines.push("");

  lines.push("## 每 Sheet 明细");
  lines.push("");
  lines.push("| 文件 | 品类 | 工厂 | Sheet | 状态 | Header Row | Model Column | Price Column | valid | skipped | new product | new offer | updated | dup | 跳过原因 Top |");
  lines.push("|---|---|---|---|---|---:|---|---|---:|---:|---:|---:|---:|---:|---|");
  for (const sheet of sheetResults) {
    lines.push(
      `| ${escapeMd(sheet.resolvedRelativePath)} | ${sheet.category} | ${escapeMd(sheet.factory)} | ${escapeMd(sheet.sheetName)} | ${sheet.status} | ${sheet.headerRow ?? "-"} | ${escapeMd(sheet.modelColumn)} | ${escapeMd(formatPriceColumnForReport(sheet.priceColumn))} | ${sheet.validRows} | ${sheet.skippedRows} | ${sheet.newProducts} | ${sheet.newOffers} | ${sheet.updatedOffers} | ${sheet.duplicateOffers} | ${escapeMd(formatReasonCounts(sheet.skippedReasons))} |`,
    );
  }
  lines.push("");

  lines.push("## 检测失败 / 风险项");
  lines.push("");
  lines.push("| 文件 | 品类 | 工厂 | Sheet | 问题 |");
  lines.push("|---|---|---|---|---|");
  const issueRows = sheetResults.filter((sheet) => sheet.status !== "ok");
  if (issueRows.length === 0) {
    lines.push("| - | - | - | - | 无 |");
  } else {
    for (const sheet of issueRows) {
      lines.push(`| ${escapeMd(sheet.resolvedRelativePath)} | ${sheet.category} | ${escapeMd(sheet.factory)} | ${escapeMd(sheet.sheetName)} | ${escapeMd(sheet.error ?? sheet.status)} |`);
    }
  }
  lines.push("");

  lines.push("## 路径修正");
  lines.push("");
  lines.push("| CSV/计划路径 | 实际读取路径 | 说明 |");
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

  lines.push("## Skip 文件");
  lines.push("");
  lines.push("| 文件 | 工厂 | 理由 |");
  lines.push("|---|---|---|");
  for (const item of plan.skipEntries) {
    lines.push(`| ${escapeMd(item.relativePath)} | ${escapeMd(item.factory)} | ${escapeMd(item.reason)} |`);
  }
  lines.push("");

  lines.push("## 说明");
  lines.push("");
  lines.push("- 本报告仅 dry-run：没有调用 Prisma create/update/delete，没有写入 files/products/supplier_offers/price_history。");
  lines.push("- 混合文件使用严格 sheet 白名单；非混合文件读取文件内全部 sheet，再由列检测决定是否可导入。");
  lines.push("- `updated offers` 表示同 product + factory 已存在但价格不同；真正 apply 时会走价格版本追踪逻辑。");
  lines.push("");

  return lines.join("\n");
}

function emptySheetResult(
  entry: SplitPlanEntry,
  resolvedRelativePath: string,
  sheetName: string,
  status: SheetDryRunResult["status"],
  error: string | null,
): SheetDryRunResult {
  return {
    relativePath: entry.relativePath,
    resolvedRelativePath,
    category: entry.category,
    factory: entry.factory,
    sheetName,
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
    modelSamples: [],
    priceSamples: [],
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

async function resolveDiskPath(relativePath: string): Promise<{ relativePath: string; note: string | null }> {
  if (existsSync(path.join(ROOT, relativePath))) {
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

function isNonPriceHeader(header: string): boolean {
  const text = normalizeText(header);
  if (!text) return false;
  if (/^(no\.?|序号|序\s*号|item\s*no\.?|sn|s\/n|编号)$/i.test(text)) return true;
  if (/^(功率|w数|watt(age)?|power|电流|current|电压|voltage|尺寸|size|规格|spec|长度|length|直径|diameter|数量|qty|quantity|pcs|重量|weight|净重|毛重|体积|cbm|箱数|包装数|光通量|lumen|色温|cct|显指|cri|光效|pf|频率|hz)$/i.test(text)) {
    return true;
  }
  if (/^(产品名称|品名|product\s*name|名称|品类|类别|category|type|系列|series|颜色|color|材质|material|灯头|base|角度|angle|认证|cert)$/i.test(text)) {
    return true;
  }
  if (/序号|产品名称|品名|产品规格|规格|功率|w数|watt|电流|current|电压|voltage|尺寸|size|长度|length|直径|diameter|数量|qty|quantity|pcs|光通量|lumen|色温|cct|显指|cri|光效|pf/i.test(text)) {
    return true;
  }
  return false;
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

function uniqueSamples(values: string[]): string[] {
  return Array.from(new Set(values.map(normalizeText).filter(Boolean))).slice(0, 5);
}

function isDescriptionHeader(header: string): boolean {
  return /description|details|spec|power|watt|voltage|cct|lumen|flux|material|warranty|base|beam|pf|cri|参数|描述|功率|电压|色温|光通|材质|质保|底座|灯头|工作模式|功能|配置|驱动|显指|光效|尺寸|规格/i.test(
    normalizeText(header),
  );
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

function normalizeSheetKey(value: string): string {
  return normalizeText(value).toLowerCase();
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

function formatReasonCounts(reasons: Map<string, number>): string {
  const rows = Array.from(reasons.entries()).sort((a, b) => b[1] - a[1]);
  return rows.length > 0 ? rows.slice(0, 3).map(([reason, count]) => `${reason}: ${count}`).join("; ") : "-";
}

function summarizeByCategory(sheetResults: SheetDryRunResult[]) {
  const summary = new Map<
    SplitCategory,
    {
      sheets: number;
      validRows: number;
      skippedRows: number;
      newProducts: number;
      newOffers: number;
      updatedOffers: number;
      duplicateOffers: number;
    }
  >();
  for (const sheet of sheetResults) {
    const row = summary.get(sheet.category) ?? {
      sheets: 0,
      validRows: 0,
      skippedRows: 0,
      newProducts: 0,
      newOffers: 0,
      updatedOffers: 0,
      duplicateOffers: 0,
    };
    row.sheets += 1;
    row.validRows += sheet.validRows;
    row.skippedRows += sheet.skippedRows;
    row.newProducts += sheet.newProducts;
    row.newOffers += sheet.newOffers;
    row.updatedOffers += sheet.updatedOffers;
    row.duplicateOffers += sheet.duplicateOffers;
    summary.set(sheet.category, row);
  }
  return summary;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function escapeMd(value: unknown): string {
  return normalizeCsvPath(value).replaceAll("|", "\\|");
}

function readArg(name: string): string | null {
  const equalPrefix = `${name}=`;
  const equalArg = process.argv.find((arg) => arg.startsWith(equalPrefix));
  if (equalArg) {
    return equalArg.slice(equalPrefix.length) || null;
  }
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return null;
  }
  return process.argv[index + 1] ?? null;
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
