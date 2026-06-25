import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";

import * as XLSX from "xlsx";

type PrismaClientInstance = import("@prisma/client").PrismaClient;

type Mode = "dry-run" | "apply";
type DbCount = number | bigint | null;

type HeaderParam = {
  pattern: RegExp;
  paramKey: string;
  unit: string | null;
};

type HeaderMapping = {
  paramKey: string;
  unit: string | null;
};

type CleanedValue = {
  rawValue: string;
  normalizedValue: string;
  unit: string | null;
};

type SourceFile = {
  id: string;
  fileName: string;
  relativePath: string;
  absolutePathSnapshot: string;
  products: LinkedProduct[];
};

type LinkedProduct = {
  productId: string;
  modelNo: string | null;
  productName: string;
  category: string | null;
};

type SourceFileRow = {
  file_id: string;
  file_name: string;
  relative_path: string;
  absolute_path_snapshot: string;
  product_id: string;
  model_no: string | null;
  product_name: string;
  category: string | null;
};

type HeaderInfo = {
  rowIndex: number;
  values: unknown[];
};

type ParamColumn = {
  index: number;
  header: string;
  paramKey: string;
  unit: string | null;
};

type PlannedParam = {
  id: string;
  productId: string;
  category: string;
  paramKey: string;
  rawValue: string;
  normalizedValue: string;
  unit: string | null;
  sourceFileId: string;
  fileName: string;
  sheetName: string;
  rowNumber: number;
  header: string;
};

type FileResult = {
  fileId: string;
  fileName: string;
  path: string;
  sheetCount: number;
  readable: boolean;
  inaccessible: boolean;
  readError: string | null;
  sheetsWithHeader: number;
  sheetsWithoutHeader: number;
  productsTotal: number;
  productsMatched: Set<string>;
  productsUnmatched: Set<string>;
  matchedRows: number;
  plannedParams: number;
  existingParamsSkipped: number;
};

type CoverageSnapshot = {
  globalParamCoverage: Map<string, number>;
  categoryCoverage: Map<string, Map<string, number>>;
  categoryTotals: Map<string, number>;
  productParams: number;
};

type RunSummary = {
  mode: Mode;
  backupPath: string;
  fileResults: FileResult[];
  plannedParams: PlannedParam[];
  insertedParams: number;
  before: CoverageSnapshot;
  after: CoverageSnapshot;
};

const HEADER_SCAN_ROWS = 12;
const MIN_HEADER_CELLS = 3;
const INSERT_BATCH_SIZE = 500;
const REPORT_PATH = path.join("docs", "v23.0-excel-reextract-params-report.md");
const DB_PATH = path.join("prisma", "dev.db");
const BACKUP_DIR = "backups";
const SOURCE_FIELD = "v23.0_excel_reextract";

const HEADER_TO_PARAM: HeaderParam[] = [
  { pattern: /^(?:watt|power|功率|实际功率|额定功率|w数)/i, paramKey: "watts", unit: "W" },
  { pattern: /^(?:cct|色温|color\s*temp|kelvin)/i, paramKey: "cct", unit: "K" },
  { pattern: /^(?:cri|显色|ra)/i, paramKey: "cri", unit: null },
  { pattern: /^(?:pf|功率因[数素]|power\s*factor)/i, paramKey: "pf", unit: null },
  { pattern: /^(?:voltage|电压|input\s*voltage|工作电压)/i, paramKey: "voltage", unit: "V" },
  { pattern: /^(?:ip\s*(?:grade|rating|等级|防护)?|防护等级|protection)/i, paramKey: "ip", unit: null },
  { pattern: /^(?:material|材[质料]|外壳材[质料]|body\s*material|housing)/i, paramKey: "material", unit: null },
  { pattern: /^(?:beam\s*angle|发光角度?|光束角|照射角度|ba[ea]m)/i, paramKey: "beam_angle", unit: "°" },
  { pattern: /^(?:lumino(?:us|s)\s*(?:efficacy|flux)|光效|lm\s*\/\s*w|efficacy)/i, paramKey: "luminous_efficacy", unit: "lm/W" },
  { pattern: /^(?:base|灯头|灯座|lamp\s*base|cap\s*type)/i, paramKey: "base", unit: null },
  { pattern: /^(?:lumen|光通量|luminous\s*flux|总光通)/i, paramKey: "lumens", unit: "lm" },
  { pattern: /^(?:led\s*(?:chip|type|model)|芯片|灯珠型号|smd\s*type)/i, paramKey: "led_type", unit: null },
  { pattern: /^(?:cut[\s-]*out|开孔|嵌入孔)/i, paramKey: "cutout_mm", unit: "mm" },
  { pattern: /^(?:driver|驱动|电源|power\s*supply)/i, paramKey: "driver_type", unit: null },
  { pattern: /^(?:sensor|感应|雷达|pir|motion)/i, paramKey: "sensor", unit: null },
  { pattern: /^(?:size|尺寸|dimension|外形尺寸|产品尺寸)/i, paramKey: "size_display", unit: "mm" },
];

const TARGET_PARAM_KEYS = [...new Set(HEADER_TO_PARAM.map((header) => header.paramKey))];
const MODEL_HEADER_PATTERN = /^(?:model|型号|产品型号|product\s*no|item\s*no|编号|款号|品号)/i;
const BUSINESS_HEADER_PATTERN = /price|价格|报价|含税|不含税|fob|rmb|cny|usd|moq|起订|图片|picture|photo|序号|备注|remark/i;

export function mapHeaderToParam(header: string): HeaderMapping | null {
  const normalized = normalizeHeader(header);
  if (!normalized || BUSINESS_HEADER_PATTERN.test(normalized)) return null;
  for (const mapping of HEADER_TO_PARAM) {
    if (mapping.pattern.test(normalized)) return { paramKey: mapping.paramKey, unit: mapping.unit };
  }
  return null;
}

export function findModelColumnIndex(headers: unknown[]): number | null {
  for (const [index, value] of headers.entries()) {
    const header = normalizeHeader(cellToString(value));
    if (header && MODEL_HEADER_PATTERN.test(header)) return index;
  }
  return null;
}

export function normalizeIdentity(value: string): string {
  return value
    .normalize("NFC")
    .toLowerCase()
    .replace(/[\s\-_/\\().,，。]+/g, "");
}

export function matchesProductIdentity(modelNo: string | null, productName: string, excelValue: string): boolean {
  const normalizedExcel = normalizeIdentity(excelValue);
  if (!normalizedExcel) return false;
  const normalizedModel = normalizeIdentity(modelNo ?? "");
  if (normalizedModel && normalizedModel === normalizedExcel) return true;
  const normalizedName = normalizeIdentity(productName);
  return Boolean(
    normalizedName &&
      (normalizedName === normalizedExcel ||
        (normalizedExcel.length >= 4 && normalizedName.includes(normalizedExcel)) ||
        (normalizedName.length >= 4 && normalizedExcel.includes(normalizedName))),
  );
}

export function cleanParamValue(paramKey: string, value: unknown, defaultUnit: string | null): CleanedValue | null {
  const rawValue = cellToString(value);
  if (!isUsefulCellValue(rawValue)) return null;
  const compact = rawValue.replace(/\s+/g, " ").trim();

  switch (paramKey) {
    case "watts": {
      const match = compact.match(/(\d+(?:\.\d+)?)/);
      return match ? { rawValue: compact, normalizedValue: match[1], unit: "W" } : null;
    }
    case "cct": {
      const range = compact.match(/(\d{4})\s*[-~–—]\s*(\d{4})\s*K?/i);
      if (range) return { rawValue: compact, normalizedValue: `${range[1]}-${range[2]}`, unit: "K" };
      const single = compact.match(/(\d{4})\s*K?/i);
      return single ? { rawValue: compact, normalizedValue: single[1], unit: "K" } : null;
    }
    case "ip": {
      const match = compact.match(/IP\s*(\d{2})|(\d{2})/i);
      const valuePart = match?.[1] ?? match?.[2];
      return valuePart ? { rawValue: compact, normalizedValue: valuePart, unit: null } : null;
    }
    case "cri": {
      const match = compact.match(/(?:Ra|CRI)?\s*[>≥＞]?\s*(\d{2,3})/i);
      return match ? { rawValue: compact, normalizedValue: match[1], unit: null } : null;
    }
    case "pf": {
      const match = compact.match(/(\d+(?:\.\d+)?)/);
      return match ? { rawValue: compact, normalizedValue: match[1], unit: null } : null;
    }
    case "beam_angle": {
      const match = compact.match(/(\d+(?:\.\d+)?)/);
      return match ? { rawValue: compact, normalizedValue: match[1], unit: "°" } : null;
    }
    case "luminous_efficacy": {
      const match = compact.match(/(\d+(?:\.\d+)?)/);
      return match ? { rawValue: compact, normalizedValue: match[1], unit: "lm/W" } : null;
    }
    case "lumens": {
      const match = compact.match(/(\d+(?:\.\d+)?)/);
      return match ? { rawValue: compact, normalizedValue: match[1], unit: "lm" } : null;
    }
    case "cutout_mm": {
      const cleaned = normalizeSizeLikeValue(compact);
      return cleaned ? { rawValue: compact, normalizedValue: cleaned, unit: "mm" } : null;
    }
    case "size_display": {
      const cleaned = normalizeSizeLikeValue(compact);
      return cleaned ? { rawValue: compact, normalizedValue: cleaned, unit: defaultUnit } : null;
    }
    default:
      return { rawValue: compact, normalizedValue: compact, unit: defaultUnit };
  }
}

async function main() {
  const mode: Mode = process.argv.includes("--apply") ? "apply" : "dry-run";
  const backupPath = await backupDatabase();
  if (!process.env.DATABASE_URL) process.env.DATABASE_URL = "file:./dev.db";

  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    const summary = await run(prisma, mode, backupPath);
    await mkdir(path.dirname(REPORT_PATH), { recursive: true });
    await writeFile(REPORT_PATH, buildReport(summary), "utf8");

    const totalFiles = summary.fileResults.length;
    const readableFiles = summary.fileResults.filter((file) => file.readable).length;
    const matchedProducts = uniqueMatchedProducts(summary.fileResults).size;
    console.log(
      JSON.stringify(
        {
          mode,
          reportPath: REPORT_PATH,
          backupPath,
          totalFiles,
          readableFiles,
          plannedParams: summary.plannedParams.length,
          insertedParams: summary.insertedParams,
          matchedProducts,
          productParamsBefore: summary.before.productParams,
          productParamsAfter: summary.after.productParams,
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

async function run(prisma: PrismaClientInstance, mode: Mode, backupPath: string): Promise<RunSummary> {
  const sourceFiles = await loadSourceFiles(prisma);
  const allProductIds = [...new Set(sourceFiles.flatMap((file) => file.products.map((product) => product.productId)))];
  const [existingParamKeys, before] = await Promise.all([loadExistingParamKeys(prisma, allProductIds), loadCoverageSnapshot(prisma)]);
  const plannedParams: PlannedParam[] = [];
  const fileResults: FileResult[] = [];

  for (const [index, file] of sourceFiles.entries()) {
    const result = scanFile(file, existingParamKeys, plannedParams);
    fileResults.push(result);
    console.log(
      `V23 ${index + 1}/${sourceFiles.length}: ${file.relativePath} | sheets=${result.sheetCount} matched=${result.productsMatched.size} planned=${result.plannedParams} error=${result.readError ?? "-"}`,
    );
  }

  const insertedParams = mode === "apply" ? await insertParams(prisma, plannedParams) : 0;
  const after = mode === "apply" ? await loadCoverageSnapshot(prisma) : projectAfterCoverage(before, plannedParams);

  return { mode, backupPath, fileResults, plannedParams, insertedParams, before, after };
}

async function loadSourceFiles(prisma: PrismaClientInstance): Promise<SourceFile[]> {
  const rows = await prisma.$queryRaw<SourceFileRow[]>`
    SELECT DISTINCT
      f.id AS file_id,
      f.file_name,
      f.relative_path,
      f.absolute_path_snapshot,
      p.id AS product_id,
      p.model_no,
      p.product_name,
      p.category
    FROM supplier_offers so
    JOIN files f ON f.id = so.source_file_id
    JOIN products p ON p.id = so.product_id
    WHERE so.source_file_id IS NOT NULL
      AND f.file_type = 'excel'
      AND f.relative_path LIKE 'data/source-archive/%'
    ORDER BY f.relative_path ASC, p.model_no ASC, p.product_name ASC
  `;

  const byFile = new Map<string, SourceFile>();
  for (const row of rows) {
    const file =
      byFile.get(row.file_id) ??
      ({
        id: row.file_id,
        fileName: row.file_name,
        relativePath: row.relative_path,
        absolutePathSnapshot: row.absolute_path_snapshot,
        products: [],
      } satisfies SourceFile);
    file.products.push({
      productId: row.product_id,
      modelNo: row.model_no,
      productName: row.product_name,
      category: row.category,
    });
    byFile.set(row.file_id, file);
  }
  return [...byFile.values()];
}

async function loadExistingParamKeys(prisma: PrismaClientInstance, productIds: string[]): Promise<Set<string>> {
  const keys = new Set<string>();
  for (let index = 0; index < productIds.length; index += 900) {
    const chunk = productIds.slice(index, index + 900);
    const rows = await prisma.productParam.findMany({
      where: { productId: { in: chunk } },
      select: { productId: true, paramKey: true },
    });
    for (const row of rows) keys.add(productParamKey(row.productId, row.paramKey));
  }
  return keys;
}

function scanFile(file: SourceFile, existingParamKeys: Set<string>, plannedParams: PlannedParam[]): FileResult {
  const result: FileResult = {
    fileId: file.id,
    fileName: file.fileName,
    path: file.absolutePathSnapshot,
    sheetCount: 0,
    readable: false,
    inaccessible: false,
    readError: null,
    sheetsWithHeader: 0,
    sheetsWithoutHeader: 0,
    productsTotal: new Set(file.products.map((product) => product.productId)).size,
    productsMatched: new Set<string>(),
    productsUnmatched: new Set(file.products.map((product) => product.productId)),
    matchedRows: 0,
    plannedParams: 0,
    existingParamsSkipped: 0,
  };

  const physicalPath = file.absolutePathSnapshot;
  if (!existsSync(physicalPath)) {
    result.inaccessible = true;
    result.readError = "path missing";
    return result;
  }

  try {
    const workbook = XLSX.readFile(physicalPath, { cellDates: false });
    result.readable = true;
    result.sheetCount = workbook.SheetNames.length;

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet?.["!ref"]) continue;
      const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: false });
      const header = detectHeaderRow(rows);
      if (!header) {
        result.sheetsWithoutHeader += 1;
        continue;
      }

      const modelColumnIndex = findModelColumnIndex(header.values);
      if (modelColumnIndex == null) {
        result.sheetsWithoutHeader += 1;
        continue;
      }

      const paramColumns = findParamColumns(header.values, modelColumnIndex);
      if (paramColumns.length === 0) {
        result.sheetsWithoutHeader += 1;
        continue;
      }

      result.sheetsWithHeader += 1;
      const sheetMatchedProducts = new Set<string>();
      for (let rowIndex = header.rowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
        const row = rows[rowIndex] ?? [];
        if (isBlankRow(row)) continue;
        const excelIdentity = cellToString(row[modelColumnIndex]);
        if (!excelIdentity) continue;
        const product = matchProduct(excelIdentity, file.products);
        if (!product) continue;

        sheetMatchedProducts.add(product.productId);
        result.productsMatched.add(product.productId);
        result.productsUnmatched.delete(product.productId);

        let rowAddedOrSkipped = false;
        for (const column of paramColumns) {
          const rawCell = row[column.index];
          const cleaned = cleanParamValue(column.paramKey, rawCell, column.unit);
          if (!cleaned) continue;
          const key = productParamKey(product.productId, column.paramKey);
          rowAddedOrSkipped = true;
          if (existingParamKeys.has(key)) {
            result.existingParamsSkipped += 1;
            continue;
          }

          plannedParams.push({
            id: randomUUID(),
            productId: product.productId,
            category: product.category ?? "(未分类)",
            paramKey: column.paramKey,
            rawValue: cleaned.rawValue,
            normalizedValue: cleaned.normalizedValue,
            unit: cleaned.unit,
            sourceFileId: file.id,
            fileName: file.fileName,
            sheetName,
            rowNumber: rowIndex + 1,
            header: column.header,
          });
          existingParamKeys.add(key);
          result.plannedParams += 1;
        }
        if (rowAddedOrSkipped) result.matchedRows += 1;
      }
    }
  } catch (error) {
    result.readError = error instanceof Error ? error.message : String(error);
  }

  return result;
}

function detectHeaderRow(rows: unknown[][]): HeaderInfo | null {
  for (let rowIndex = 0; rowIndex < Math.min(rows.length, HEADER_SCAN_ROWS); rowIndex += 1) {
    const values = rows[rowIndex] ?? [];
    const nonEmptyCount = values.filter((cell) => cellToString(cell)).length;
    if (nonEmptyCount < MIN_HEADER_CELLS) continue;
    const hasKnownHeader = values.some((cell) => findModelColumnIndex([cell]) === 0 || mapHeaderToParam(cellToString(cell)));
    if (!hasKnownHeader) continue;
    return { rowIndex, values };
  }
  return null;
}

function findParamColumns(headers: unknown[], modelColumnIndex: number): ParamColumn[] {
  const columns: ParamColumn[] = [];
  const seenByParam = new Set<string>();
  for (const [index, headerValue] of headers.entries()) {
    if (index === modelColumnIndex) continue;
    const header = cellToString(headerValue);
    const mapped = mapHeaderToParam(header);
    if (!mapped) continue;
    const dedupeKey = `${index}\u0000${mapped.paramKey}`;
    if (seenByParam.has(dedupeKey)) continue;
    seenByParam.add(dedupeKey);
    columns.push({ index, header, paramKey: mapped.paramKey, unit: mapped.unit });
  }
  return columns;
}

function matchProduct(excelIdentity: string, products: LinkedProduct[]): LinkedProduct | null {
  const exact = products.filter((product) => matchesProductIdentity(product.modelNo, product.productName, excelIdentity));
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return chooseBestMatch(exact, excelIdentity);

  const normalizedExcel = normalizeIdentity(excelIdentity);
  if (normalizedExcel.length < 4) return null;
  const containMatches = products.filter((product) => {
    const model = normalizeIdentity(product.modelNo ?? "");
    const name = normalizeIdentity(product.productName);
    return (model.length >= 4 && (model.includes(normalizedExcel) || normalizedExcel.includes(model))) || (name.length >= 4 && name.includes(normalizedExcel));
  });
  if (containMatches.length === 1) return containMatches[0];
  if (containMatches.length > 1) return chooseBestMatch(containMatches, excelIdentity);
  return null;
}

function chooseBestMatch(products: LinkedProduct[], excelIdentity: string): LinkedProduct | null {
  const normalizedExcel = normalizeIdentity(excelIdentity);
  const scored = products
    .map((product) => {
      const model = normalizeIdentity(product.modelNo ?? "");
      const name = normalizeIdentity(product.productName);
      const score = Math.max(identityScore(normalizedExcel, model), identityScore(normalizedExcel, name));
      return { product, score };
    })
    .sort((left, right) => right.score - left.score || left.product.productId.localeCompare(right.product.productId));
  if (scored.length === 0 || scored[0].score <= 0) return null;
  if (scored.length === 1 || scored[0].score > scored[1].score) return scored[0].product;
  return null;
}

function identityScore(left: string, right: string): number {
  if (!left || !right) return 0;
  if (left === right) return right.length + 1000;
  if (left.includes(right)) return right.length;
  if (right.includes(left)) return left.length;
  return 0;
}

async function insertParams(prisma: PrismaClientInstance, plannedParams: PlannedParam[]): Promise<number> {
  let inserted = 0;
  for (let index = 0; index < plannedParams.length; index += INSERT_BATCH_SIZE) {
    const chunk = plannedParams.slice(index, index + INSERT_BATCH_SIZE);
    const result = await prisma.productParam.createMany({
      data: chunk.map((param) => ({
        id: param.id,
        productId: param.productId,
        paramKey: param.paramKey,
        rawValue: param.rawValue,
        normalizedValue: param.normalizedValue,
        unit: param.unit,
        sourceField: SOURCE_FIELD,
        confidence: "high",
      })),
    });
    inserted += result.count;
  }
  return inserted;
}

async function loadCoverageSnapshot(prisma: PrismaClientInstance): Promise<CoverageSnapshot> {
  const targetParamSql = TARGET_PARAM_KEYS.map((paramKey) => `'${paramKey.replaceAll("'", "''")}'`).join(", ");
  const [productParams, globalRows, categoryRows, categoryTotals] = await Promise.all([
    prisma.productParam.count(),
    prisma.$queryRawUnsafe<Array<{ param_key: string; product_count: DbCount }>>(
      `
      SELECT param_key, COUNT(DISTINCT product_id) AS product_count
      FROM product_params
      WHERE param_key IN (${targetParamSql})
      GROUP BY param_key
    `,
    ),
    prisma.$queryRawUnsafe<Array<{ category: string; param_key: string; product_count: DbCount }>>(
      `
      SELECT COALESCE(NULLIF(TRIM(p.category), ''), '未分类') AS category, pp.param_key, COUNT(DISTINCT pp.product_id) AS product_count
      FROM products p
      JOIN product_params pp ON pp.product_id = p.id
      WHERE pp.param_key IN (${targetParamSql})
      GROUP BY COALESCE(NULLIF(TRIM(p.category), ''), '未分类'), pp.param_key
    `,
    ),
    prisma.$queryRaw<Array<{ category: string; product_count: DbCount }>>`
      SELECT COALESCE(NULLIF(TRIM(category), ''), '未分类') AS category, COUNT(*) AS product_count
      FROM products
      GROUP BY COALESCE(NULLIF(TRIM(category), ''), '未分类')
    `,
  ]);

  const globalParamCoverage = new Map<string, number>();
  for (const row of globalRows) globalParamCoverage.set(row.param_key, toNumber(row.product_count));

  const byCategory = new Map<string, Map<string, number>>();
  for (const row of categoryRows) {
    const categoryMap = byCategory.get(row.category) ?? new Map<string, number>();
    categoryMap.set(row.param_key, toNumber(row.product_count));
    byCategory.set(row.category, categoryMap);
  }

  return {
    globalParamCoverage,
    categoryCoverage: byCategory,
    categoryTotals: new Map(categoryTotals.map((row) => [row.category, toNumber(row.product_count)])),
    productParams,
  };
}

function projectAfterCoverage(before: CoverageSnapshot, plannedParams: PlannedParam[]): CoverageSnapshot {
  const afterGlobal = new Map(before.globalParamCoverage);
  const afterCategory = new Map<string, Map<string, number>>();
  for (const [category, params] of before.categoryCoverage.entries()) afterCategory.set(category, new Map(params));

  const plannedByProductParam = new Set<string>();
  for (const param of plannedParams) {
    const key = productParamKey(param.productId, param.paramKey);
    if (plannedByProductParam.has(key)) continue;
    plannedByProductParam.add(key);
    afterGlobal.set(param.paramKey, (afterGlobal.get(param.paramKey) ?? 0) + 1);
    const categoryMap = afterCategory.get(param.category) ?? new Map<string, number>();
    categoryMap.set(param.paramKey, (categoryMap.get(param.paramKey) ?? 0) + 1);
    afterCategory.set(param.category, categoryMap);
  }

  return {
    globalParamCoverage: afterGlobal,
    categoryCoverage: afterCategory,
    categoryTotals: new Map(before.categoryTotals),
    productParams: before.productParams + plannedParams.length,
  };
}

async function backupDatabase(): Promise<string> {
  if (!existsSync(DB_PATH)) throw new Error(`Database not found: ${DB_PATH}`);
  await mkdir(BACKUP_DIR, { recursive: true });
  const backupPath = path.join(BACKUP_DIR, `dev-before-v23.0-${timestampForFile()}.sqlite`);
  const tempPath = `${backupPath}.tmp`;
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await rm(tempPath, { force: true });
      await copyFile(DB_PATH, tempPath);
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

function buildReport(summary: RunSummary): string {
  const totalFiles = summary.fileResults.length;
  const readable = summary.fileResults.filter((file) => file.readable).length;
  const inaccessible = summary.fileResults.filter((file) => file.inaccessible).length;
  const withHeader = summary.fileResults.filter((file) => file.sheetsWithHeader > 0).length;
  const noHeader = summary.fileResults.filter((file) => file.readable && file.sheetsWithHeader === 0).length;
  const allProductIds = new Set<string>();
  for (const file of summary.fileResults) {
    for (const product of file.productsMatched) allProductIds.add(product);
    for (const product of file.productsUnmatched) allProductIds.add(product);
  }
  const matchedProductIds = uniqueMatchedProducts(summary.fileResults);
  const unmatchedProductIds = new Set<string>();
  for (const file of summary.fileResults) for (const product of file.productsUnmatched) if (!matchedProductIds.has(product)) unmatchedProductIds.add(product);
  const paramStats = buildParamStats(summary.plannedParams);
  const categoryRows = buildCategoryCoverageRows(summary);
  const missingFiles = summary.fileResults.filter((file) => file.inaccessible || file.readError);

  return `# V23.0 Excel 列头重提取报告

模式: ${summary.mode}
时间: ${new Date().toISOString()}

## 备份
路径: ${summary.backupPath}

## 文件处理统计
- 总文件数: ${formatInteger(totalFiles)}
- 可读取: ${formatInteger(readable)}
- 不可访问: ${formatInteger(inaccessible)}
- 有表头匹配: ${formatInteger(withHeader)}
- 无可识别表头: ${formatInteger(noHeader)}

### 不可访问 / 读取失败文件

| 文件 | 路径 | 原因 |
|------|------|------|
${missingFiles
  .slice(0, 80)
  .map((file) => `| ${escapeMd(file.fileName)} | ${escapeMd(file.path)} | ${escapeMd(file.readError ?? "不可访问")} |`)
  .join("\n")}

## 产品匹配统计
- 总产品数: ${formatInteger(allProductIds.size)}
- 匹配成功: ${formatInteger(matchedProductIds.size)}
- 匹配失败: ${formatInteger(unmatchedProductIds.size)}
- 匹配到的 Excel 数据行: ${formatInteger(summary.fileResults.reduce((sum, file) => sum + file.matchedRows, 0))}
- 跳过已有参数: ${formatInteger(summary.fileResults.reduce((sum, file) => sum + file.existingParamsSkipped, 0))}

## 参数提取统计

| param_key | 新增数 | 之前总覆盖 | 之后总覆盖 |
|-----------|--------|-----------|-----------|
${paramStats
  .map((stat) => {
    const before = summary.before.globalParamCoverage.get(stat.paramKey) ?? 0;
    const after = summary.after.globalParamCoverage.get(stat.paramKey) ?? before;
    return `| ${stat.paramKey} | +${formatInteger(stat.count)} | ${formatInteger(before)} | ${formatInteger(after)} |`;
  })
  .join("\n")}

## 按品类覆盖率变化

| 品类 | watts 变化 | cct 变化 | cri 变化 | pf 变化 | voltage 变化 | ip 变化 | material 变化 | size_display 变化 | beam_angle 变化 | luminous_efficacy 变化 | base 变化 | lumens 变化 | led_type 变化 | cutout_mm 变化 | driver_type 变化 | sensor 变化 |
|------|-----------|---------|---------|---------|--------------|---------|---------------|-------------------|-----------------|------------------------|----------|-----------|---------------|----------------|------------------|-------------|
${categoryRows.join("\n")}

## 总计
- product_params: ${formatInteger(summary.before.productParams)} → ${formatInteger(summary.after.productParams)}
- 提取成功: ${formatInteger(summary.mode === "apply" ? summary.insertedParams : summary.plannedParams.length)} 条

## 说明
- 只 INSERT 新的 product_params 行，不 UPDATE / DELETE。
- source_field = ${SOURCE_FIELD}
- confidence = high
- 读取库: xlsx ${XLSX.version}
`;
}

function buildParamStats(plannedParams: PlannedParam[]): Array<{ paramKey: string; count: number }> {
  const counts = new Map<string, number>();
  for (const param of plannedParams) counts.set(param.paramKey, (counts.get(param.paramKey) ?? 0) + 1);
  return [...counts.entries()].map(([paramKey, count]) => ({ paramKey, count })).sort((left, right) => right.count - left.count || left.paramKey.localeCompare(right.paramKey));
}

function buildCategoryCoverageRows(summary: RunSummary): string[] {
  const categories = [...new Set(summary.plannedParams.map((param) => param.category))].sort((left, right) => left.localeCompare(right));
  return categories.map((category) => {
    const total = summary.before.categoryTotals.get(category) ?? summary.after.categoryTotals.get(category) ?? 0;
    const cells = TARGET_PARAM_KEYS.map((paramKey) => {
      const before = summary.before.categoryCoverage.get(category)?.get(paramKey) ?? 0;
      const after = summary.after.categoryCoverage.get(category)?.get(paramKey) ?? before;
      if (before === after) return formatPercent(before, total);
      return `${formatPercent(before, total)}→${formatPercent(after, total)}`;
    });
    return `| ${escapeMd(category)} | ${cells.join(" | ")} |`;
  });
}

function uniqueMatchedProducts(fileResults: FileResult[]): Set<string> {
  const ids = new Set<string>();
  for (const file of fileResults) for (const id of file.productsMatched) ids.add(id);
  return ids;
}

function normalizeHeader(header: string): string {
  return header.normalize("NFC").replace(/\s+/g, " ").trim();
}

function normalizeSizeLikeValue(value: string): string | null {
  const withoutUnit = value
    .replace(/mm|毫米|cm|厘米/gi, "")
    .replace(/[xX*＊×]/g, "×")
    .replace(/\s*×\s*/g, "×")
    .trim();
  if (!/\d/.test(withoutUnit)) return null;
  return withoutUnit;
}

function isBlankRow(row: unknown[]): boolean {
  return row.every((cell) => !cellToString(cell));
}

function isUsefulCellValue(value: string): boolean {
  const normalized = value.trim();
  if (!normalized) return false;
  return !["-", "/", "\\", "n/a", "na", "null", "无", "--", "—"].includes(normalized.toLowerCase());
}

function cellToString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value).trim();
  return String(value).trim();
}

function productParamKey(productId: string, paramKey: string): string {
  return `${productId}\u0000${paramKey}`;
}

function timestampForFile(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function toNumber(value: DbCount | undefined): number {
  if (typeof value === "bigint") return Number(value);
  return value ?? 0;
}

function formatInteger(value: number): string {
  return value.toLocaleString("en-US");
}

function formatPercent(numerator: number, denominator: number): string {
  if (denominator <= 0) return "0%";
  return `${Math.round((numerator / denominator) * 100)}%`;
}

function escapeMd(value: string): string {
  return value.replaceAll("|", "\\|").replace(/\r?\n/g, " ").trim();
}

function isCliEntry(): boolean {
  const entry = process.argv[1];
  return Boolean(entry && pathToFileURL(path.resolve(entry)).href === import.meta.url);
}

if (isCliEntry()) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
