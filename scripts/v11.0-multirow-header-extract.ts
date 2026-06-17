import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { PrismaClient } from "@prisma/client";
import * as XLSX from "xlsx";

const prisma = new PrismaClient();

const REPORT_PATH = path.join("docs", "v11.0-multirow-header-report.md");
const BACKUP_PATH = path.join("prisma", "dev.db.bak-v11.0");
const HEADER_SCAN_ROWS = 10;
const MIN_HEADER_CELLS = 3;
const INSERT_BATCH_SIZE = 500;
const APPLY_MODE = process.argv.includes("--apply");

type SourceFile = {
  id: string;
  fileName: string;
  relativePath: string;
  category: string | null;
};

type SourceFileRow = {
  id: string;
  file_name: string;
  relative_path: string;
};

type LinkedProduct = {
  productId: string;
  modelNo: string | null;
  productName: string;
  category: string | null;
};

type ProductRow = {
  id: string;
  model_no: string | null;
  product_name: string;
  category: string | null;
};

type HeaderInfo = {
  mainRow: number;
  subRow: number | null;
  mergedValues: unknown[];
};

type ParamColumn = {
  index: number;
  header: string;
  normalizedHeader: string;
  paramKey: string;
};

type SheetParam = {
  paramKey: string;
  rawValue: string;
  normalizedValue: string;
  unit: string | null;
};

type PlannedParam = {
  id: string;
  productId: string;
  productModel: string;
  productName: string;
  category: string;
  sourceFileId: string;
  fileName: string;
  sheetName: string;
  rowNumber: number;
  groupLabel: string;
  sizeValue: string;
  header: string;
  paramKey: string;
  rawValue: string;
  normalizedValue: string | null;
  unit: string | null;
  sourceField: "excel_multirow" | "sheet_name";
};

type FileResult = {
  fileId: string;
  fileName: string;
  relativePath: string;
  category: string | null;
  sheetCount: number;
  multirowSheets: number;
  matchedRows: number;
  unmatchedRows: number;
  existingParamsSkipped: number;
  plannedParams: number;
  dataColumnParams: number;
  sheetNameParams: number;
  readError: string | null;
};

type UnmatchedSample = {
  fileName: string;
  sheetName: string;
  groupLabel: string;
  sizeValue: string;
  reason: string;
};

type MatchSample = {
  fileName: string;
  sheetName: string;
  groupLabel: string;
  sizeValue: string;
  productName: string;
  paramKeys: string;
};

type ParamStats = {
  paramKey: string;
  newRecords: number;
  productIds: Set<string>;
};

type CategoryStats = {
  category: string;
  sheetKeys: Set<string>;
  matchedRows: number;
  newParams: number;
};

type NormalizedParamValue = {
  normalizedValue: string | null;
  unit: string | null;
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

const BUSINESS_PATTERNS = [
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
  /color\s*box/i,
  /彩盒/i,
  /g\.?\s*w/i,
  /n\.?\s*w/i,
  /毛重/i,
  /净重/i,
  /箱规/i,
  /外箱/i,
  /内盒/i,
  /装箱/i,
];

const PARAM_EXCLUSION_PATTERNS = [/power\s*cord/i, /power\s*supply/i, /power\s*solution/i, /线材规格/i, /电源/i];

const HEADER_TO_PARAM: Record<string, string> = {
  power: "watts",
  watt: "watts",
  watts: "watts",
  wattage: "watts",
  "actual watt": "watts",
  "actual power": "watts",
  "actual test power": "watts",
  "real power": "watts",
  "rated wattage": "watts",
  "rated power": "watts",
  功率: "watts",
  实际功率: "watts",
  实测功率: "watts",
  额定功率: "watts",
  瓦数: "watts",
  w: "watts",
  cct: "cct",
  色温: "cct",
  "color temperature": "cct",
  cri: "cri",
  ra: "cri",
  显指: "cri",
  显值: "cri",
  显色指数: "cri",
  pf: "pf",
  "power factor": "pf",
  功率因数: "pf",
  功率因素: "pf",
  pf值: "pf",
  "lm/w": "luminous_efficacy",
  efficiency: "luminous_efficacy",
  "lumen efficiency": "luminous_efficacy",
  "light efficiency": "luminous_efficacy",
  "luminous efficiency": "luminous_efficacy",
  光效: "luminous_efficacy",
  "luminous flux": "lumens",
  lumens: "lumens",
  lumen: "lumens",
  光通量: "lumens",
  "beam angle": "beam_angle",
  angle: "beam_angle",
  光束角: "beam_angle",
  发光角度: "beam_angle",
  ip: "ip",
  防护等级: "ip",
  防水等级: "ip",
  "input voltage": "voltage",
  input: "voltage",
  电压: "voltage",
  "output voltage": "note",
  "output current": "note",
  输出电压: "note",
  输出电流: "note",
  material: "material",
  材料: "material",
  材质: "material",
  size: "size_display",
  dimension: "size_display",
  "out size": "size_display",
  "outside size": "size_display",
  尺寸: "size_display",
  产品尺寸: "size_display",
  产品规格: "size_display",
  成品尺寸: "size_display",
  灯体尺寸: "size_display",
  灯具尺寸: "size_display",
  整灯尺寸: "size_display",
  外形尺寸: "size_display",
  面板尺寸: "size_display",
  面环规格: "size_display",
  "product size": "size_display",
  "body size": "size_display",
  规格: "size_display",
  "cut size": "cutout_mm",
  "hole size": "cutout_mm",
  开孔: "cutout_mm",
  "led number": "led_count",
  "led qty": "led_count",
  "led no": "led_count",
  "chips qty": "led_count",
  "led quantity": "led_count",
  led数量: "led_count",
  灯珠数量: "led_count",
  灯珠数: "led_count",
  灯珠颗数: "led_count",
  driver: "driver_type",
  驱动方案: "driver_type",
  驱动类型: "driver_type",
  驱动: "driver_type",
  height: "height_mm",
  高度: "height_mm",
  note: "note",
  remark: "note",
  备注: "note",
};

async function main() {
  if (!existsSync(BACKUP_PATH)) {
    throw new Error(`Missing DB backup: ${BACKUP_PATH}. Run cp prisma/dev.db prisma/dev.db.bak-v11.0 first.`);
  }

  const productParamsBefore = await prisma.productParam.count();
  const sourceFiles = await loadSourceFiles();
  const productsByCategory = await loadProductsByCategory();
  const allProductIds = [...new Set([...productsByCategory.values()].flat().map((product) => product.productId))];
  const existingParamKeys = await loadExistingParamKeys(allProductIds);
  const plannedParams: PlannedParam[] = [];
  const fileResults: FileResult[] = [];
  const matchSamples: MatchSample[] = [];
  const unmatchedSamples: UnmatchedSample[] = [];

  for (const [index, file] of sourceFiles.entries()) {
    if (index === 0 || (index + 1) % 50 === 0 || index + 1 === sourceFiles.length) {
      console.log(`Multirow scan ${index + 1}/${sourceFiles.length}: ${file.relativePath}`);
    }
    fileResults.push(scanFile(file, productsByCategory, existingParamKeys, plannedParams, matchSamples, unmatchedSamples));
  }

  const insertedParams = APPLY_MODE ? await insertParams(plannedParams) : 0;
  const productParamsAfter = await prisma.productParam.count();
  await mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await writeFile(
    REPORT_PATH,
    buildReport({
      mode: APPLY_MODE ? "apply" : "dry-run",
      fileResults,
      plannedParams,
      matchSamples,
      unmatchedSamples,
      insertedParams,
      productParamsBefore,
      productParamsAfter,
    }),
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        mode: APPLY_MODE ? "apply" : "dry-run",
        reportPath: REPORT_PATH,
        files: fileResults.length,
        multirowFiles: fileResults.filter((file) => file.multirowSheets > 0).length,
        multirowSheets: fileResults.reduce((sum, file) => sum + file.multirowSheets, 0),
        matchedRows: fileResults.reduce((sum, file) => sum + file.matchedRows, 0),
        plannedParams: plannedParams.length,
        insertedParams,
        productParamsBefore,
        productParamsAfter,
      },
      null,
      2,
    ),
  );

  await prisma.$disconnect();
}

async function loadSourceFiles(): Promise<SourceFile[]> {
  const files = await prisma.$queryRaw<SourceFileRow[]>`
    SELECT id, file_name, relative_path
    FROM files
    WHERE file_type = 'excel'
    ORDER BY relative_path ASC, file_name ASC
  `;
  return files.map((file) => ({
    id: file.id,
    fileName: file.file_name,
    relativePath: file.relative_path,
    category: inferCategoryFromFile(file.relative_path, file.file_name),
  }));
}

async function loadProductsByCategory(): Promise<Map<string, LinkedProduct[]>> {
  const products = await prisma.$queryRaw<ProductRow[]>`
    SELECT id, model_no, product_name, category
    FROM products
    ORDER BY category ASC, model_no ASC, product_name ASC
  `;
  const productsByCategory = new Map<string, LinkedProduct[]>();
  for (const product of products) {
    const category = product.category ?? "";
    const list = productsByCategory.get(category) ?? [];
    list.push({
      productId: product.id,
      modelNo: product.model_no,
      productName: product.product_name,
      category: product.category,
    });
    productsByCategory.set(category, list);
  }
  return productsByCategory;
}

async function loadExistingParamKeys(productIds: string[]): Promise<Set<string>> {
  const existing = new Set<string>();
  for (let index = 0; index < productIds.length; index += 900) {
    const chunk = productIds.slice(index, index + 900);
    const rows = await prisma.productParam.findMany({
      where: { productId: { in: chunk } },
      select: { productId: true, paramKey: true },
    });
    for (const row of rows) existing.add(productParamKey(row.productId, row.paramKey));
  }
  return existing;
}

function scanFile(
  file: SourceFile,
  productsByCategory: Map<string, LinkedProduct[]>,
  existingParamKeys: Set<string>,
  plannedParams: PlannedParam[],
  matchSamples: MatchSample[],
  unmatchedSamples: UnmatchedSample[],
): FileResult {
  const result: FileResult = {
    fileId: file.id,
    fileName: file.fileName,
    relativePath: file.relativePath,
    category: file.category,
    sheetCount: 0,
    multirowSheets: 0,
    matchedRows: 0,
    unmatchedRows: 0,
    existingParamsSkipped: 0,
    plannedParams: 0,
    dataColumnParams: 0,
    sheetNameParams: 0,
    readError: null,
  };
  const candidates = file.category ? (productsByCategory.get(file.category) ?? []) : [];
  if (file.category === "灯管" || isTubeSource(file)) return result;
  if (candidates.length === 0) return result;

  const physicalPath = resolvePhysicalPath(file.relativePath);
  if (!existsSync(physicalPath)) {
    result.readError = "file missing";
    return result;
  }

  try {
    const workbook = XLSX.readFile(physicalPath, { cellDates: false });
    result.sheetCount = workbook.SheetNames.length;
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet?.["!ref"]) continue;
      const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: false });
      if (detectStandardHeader(rows)) continue;

      const multiHeader = detectMultiRowHeader(rows);
      if (!multiHeader) continue;
      const modelColumnIndex = findModelColumn(multiHeader.mergedValues);
      if (modelColumnIndex == null) continue;
      const paramColumns = findParamColumns(multiHeader.mergedValues, modelColumnIndex);
      const sheetParams = parseSheetName(sheetName);
      if (paramColumns.length === 0 && sheetParams.length === 0) continue;

      const dataStartRow = (multiHeader.subRow ?? multiHeader.mainRow) + 1;
      const dataRows = rows.slice(dataStartRow);
      const groupColumnIndex = findGroupLabelColumn(dataRows);
      const groupLabels = groupColumnIndex != null ? fillDownGroupLabel(dataRows, groupColumnIndex) : new Map<number, string>();
      let sheetMatchedRows = 0;

      for (const [rowOffset, row] of dataRows.entries()) {
        if (isBlankRow(row)) continue;
        const sizeValue = cellToString(row[modelColumnIndex]);
        if (!sizeValue) continue;
        const groupLabel = groupLabels.get(rowOffset) ?? "";
        const product = matchProductByShapeAndSize(groupLabel, sizeValue, candidates);
        if (!product) {
          result.unmatchedRows += 1;
          if (unmatchedSamples.length < 30) {
            unmatchedSamples.push({ fileName: file.fileName, sheetName, groupLabel, sizeValue, reason: "no shape+size product match" });
          }
          continue;
        }

        const beforeCount = plannedParams.length;
        const rowNumber = dataStartRow + rowOffset + 1;
        for (const column of paramColumns) {
          const rawValue = cellToString(row[column.index]);
          if (!isUsefulParamValue(rawValue)) continue;
          const key = productParamKey(product.productId, column.paramKey);
          if (existingParamKeys.has(key)) {
            result.existingParamsSkipped += 1;
            continue;
          }
          const normalized = normalizeParamValue(column.paramKey, rawValue);
          plannedParams.push({
            id: randomUUID(),
            productId: product.productId,
            productModel: product.modelNo ?? "",
            productName: product.productName,
            category: product.category ?? "(未分类)",
            sourceFileId: file.id,
            fileName: file.fileName,
            sheetName,
            rowNumber,
            groupLabel,
            sizeValue,
            header: column.header,
            paramKey: column.paramKey,
            rawValue,
            normalizedValue: normalized.normalizedValue,
            unit: normalized.unit,
            sourceField: "excel_multirow",
          });
          existingParamKeys.add(key);
          result.dataColumnParams += 1;
        }

        for (const sheetParam of sheetParams) {
          const key = productParamKey(product.productId, sheetParam.paramKey);
          if (existingParamKeys.has(key)) {
            result.existingParamsSkipped += 1;
            continue;
          }
          plannedParams.push({
            id: randomUUID(),
            productId: product.productId,
            productModel: product.modelNo ?? "",
            productName: product.productName,
            category: product.category ?? "(未分类)",
            sourceFileId: file.id,
            fileName: file.fileName,
            sheetName,
            rowNumber,
            groupLabel,
            sizeValue,
            header: "sheet_name",
            paramKey: sheetParam.paramKey,
            rawValue: sheetParam.rawValue,
            normalizedValue: sheetParam.normalizedValue,
            unit: sheetParam.unit,
            sourceField: "sheet_name",
          });
          existingParamKeys.add(key);
          result.sheetNameParams += 1;
        }

        const added = plannedParams.length - beforeCount;
        if (added > 0) {
          result.matchedRows += 1;
          sheetMatchedRows += 1;
          result.plannedParams += added;
          if (matchSamples.length < 50) {
            const rowParamKeys = plannedParams.slice(beforeCount).map((param) => param.paramKey);
            matchSamples.push({
              fileName: file.fileName,
              sheetName,
              groupLabel,
              sizeValue,
              productName: product.productName,
              paramKeys: [...new Set(rowParamKeys)].join(", "),
            });
          }
        }
      }

      if (sheetMatchedRows > 0) result.multirowSheets += 1;
    }
  } catch (error) {
    result.readError = error instanceof Error ? error.message : String(error);
  }

  return result;
}

function isTubeSource(file: SourceFile): boolean {
  return /灯管|tube/i.test(`${file.relativePath} ${file.fileName}`);
}

function detectStandardHeader(rows: unknown[][]): boolean {
  let bestRow: unknown[] | null = null;
  let bestCount = 0;
  for (let index = 0; index < Math.min(rows.length, HEADER_SCAN_ROWS); index += 1) {
    const row = rows[index] ?? [];
    const count = row.filter((cell) => cellToString(cell)).length;
    if (count >= MIN_HEADER_CELLS && count > bestCount) {
      bestRow = row;
      bestCount = count;
    }
  }
  if (!bestRow) return false;
  return bestRow.some((cell) => isModelHeader(cellToString(cell)));
}

function detectMultiRowHeader(rows: unknown[][]): HeaderInfo | null {
  for (let index = 0; index < Math.min(rows.length, HEADER_SCAN_ROWS); index += 1) {
    const row = rows[index] ?? [];
    if (!row.some((cell) => isModelHeader(cellToString(cell)))) continue;

    const nextRow = rows[index + 1] ?? null;
    if (nextRow) {
      const maxLength = Math.max(row.length, nextRow.length);
      const mainNulls = Array.from({ length: maxLength }, (_, col) => !cellToString(row[col])).filter(Boolean).length;
      const nextNonEmpty = nextRow.filter((cell) => cellToString(cell)).length;
      if (mainNulls >= 3 && nextNonEmpty >= 3) {
        return {
          mainRow: index,
          subRow: index + 1,
          mergedValues: mergeHeaderRows(row, nextRow, maxLength),
        };
      }
    }

    return { mainRow: index, subRow: null, mergedValues: [...row] };
  }
  return null;
}

function mergeHeaderRows(mainRow: unknown[], subRow: unknown[], maxLength: number): unknown[] {
  return Array.from({ length: maxLength }, (_, index) => {
    const main = cellToString(mainRow[index]);
    const sub = cellToString(subRow[index]);
    if (!main) return sub || "";
    if (!sub) return main;
    if (isBusinessHeader(main) || isModelHeader(main)) return main;
    if (isBroadGroupHeader(main)) return `${main} ${sub}`.trim();
    return main;
  });
}

function isModelHeader(value: string): boolean {
  const normalized = normalizeHeader(value);
  return Boolean(normalized && MODEL_HEADER_PATTERNS.some((pattern) => pattern.test(normalized)));
}

function isBroadGroupHeader(value: string): boolean {
  return /参数|parameter|面环|灯板|驱动|driver|尺寸|size|规格/i.test(value);
}

function isBusinessHeader(value: string): boolean {
  const normalized = normalizeHeader(value);
  return BUSINESS_PATTERNS.some((pattern) => pattern.test(normalized));
}

function findModelColumn(headerValues: unknown[]): number | null {
  for (const [index, value] of headerValues.entries()) {
    if (isModelHeader(cellToString(value))) return index;
  }
  return null;
}

function findParamColumns(headerValues: unknown[], modelColumnIndex: number): ParamColumn[] {
  const columns: ParamColumn[] = [];
  const seenParamKeys = new Set<string>();
  for (const [index, value] of headerValues.entries()) {
    if (index === modelColumnIndex) continue;
    const header = cellToString(value);
    const normalizedHeader = normalizeHeader(header);
    if (!normalizedHeader) continue;
    if (BUSINESS_PATTERNS.some((pattern) => pattern.test(normalizedHeader))) continue;
    const paramKey = matchParamKey(normalizedHeader);
    if (!paramKey) continue;
    if (seenParamKeys.has(paramKey)) continue;
    seenParamKeys.add(paramKey);
    columns.push({ index, header, normalizedHeader, paramKey });
  }
  return columns;
}

function findGroupLabelColumn(dataRows: unknown[][]): number | null {
  const shapeKeywords = /圆形|方形|round|square|暗装|明装|slim|surface|recessed/i;
  const sampleSize = Math.min(dataRows.length, 30);
  if (sampleSize === 0) return null;

  for (let column = 0; column < Math.min(3, dataRows[0]?.length ?? 0); column += 1) {
    let nonEmpty = 0;
    let hasShape = false;
    for (let rowIndex = 0; rowIndex < sampleSize; rowIndex += 1) {
      const value = cellToString(dataRows[rowIndex]?.[column]);
      if (!value) continue;
      nonEmpty += 1;
      if (shapeKeywords.test(value)) hasShape = true;
    }
    if (nonEmpty / sampleSize < 0.5 && hasShape) return column;
  }
  return null;
}

function fillDownGroupLabel(dataRows: unknown[][], groupColIndex: number): Map<number, string> {
  const labels = new Map<number, string>();
  let currentLabel = "";
  for (const [index, row] of dataRows.entries()) {
    const value = cellToString(row[groupColIndex]);
    if (value) currentLabel = value;
    if (currentLabel) labels.set(index, currentLabel);
  }
  return labels;
}

function matchProductByShapeAndSize(groupLabel: string, sizeValue: string, candidates: LinkedProduct[]): LinkedProduct | null {
  const sizeVariants = extractSizeVariants(sizeValue);
  if (sizeVariants.length === 0) return null;
  const shapeVariants = extractShapeVariants(groupLabel);
  const installVariants = extractInstallVariants(groupLabel);

  const sizeShapeMatches =
    shapeVariants.length > 0
      ? candidates.filter((product) => productMatches(product, sizeVariants) && productMatches(product, shapeVariants))
      : [];
  if (sizeShapeMatches.length === 1) return sizeShapeMatches[0];

  const installShapeMatches =
    installVariants.length > 0 && shapeVariants.length > 0
      ? candidates.filter((product) => productMatches(product, sizeVariants) && productMatches(product, shapeVariants) && productMatches(product, installVariants))
      : [];
  if (installShapeMatches.length === 1) return installShapeMatches[0];
  if (installShapeMatches.length > 1) return sortProducts(installShapeMatches)[0];

  if (sizeShapeMatches.length > 1) return sortProducts(sizeShapeMatches)[0];

  const sizeOnlyMatches = candidates.filter((product) => productMatches(product, sizeVariants));
  if (sizeOnlyMatches.length === 1) return sizeOnlyMatches[0];
  if (sizeOnlyMatches.length > 1) return sortProducts(sizeOnlyMatches)[0];

  return null;
}

function productMatches(product: LinkedProduct, variants: string[]): boolean {
  const haystack = normalizeForMatch(`${product.modelNo ?? ""} ${product.productName}`);
  return variants.some((variant) => haystack.includes(normalizeForMatch(variant)));
}

function sortProducts(products: LinkedProduct[]): LinkedProduct[] {
  return [...products].sort((left, right) => {
    const leftLength = `${left.modelNo ?? ""} ${left.productName}`.length;
    const rightLength = `${right.modelNo ?? ""} ${right.productName}`.length;
    return leftLength - rightLength || left.productId.localeCompare(right.productId);
  });
}

function extractShapeVariants(label: string): string[] {
  if (/圆形|round/i.test(label)) return ["圆形", "round"];
  if (/方形|square/i.test(label)) return ["方形", "square"];
  return [];
}

function extractInstallVariants(label: string): string[] {
  if (/暗装|slim|recessed/i.test(label)) return ["暗装", "slim", "recessed"];
  if (/明装|surface/i.test(label)) return ["明装", "surface"];
  return [];
}

function extractSizeVariants(value: string): string[] {
  const variants = new Set<string>();
  const inchMatch = value.match(/(\d+(?:\.\d+)?)\s*(?:寸|inch|inches|")/i);
  if (inchMatch) {
    variants.add(`${inchMatch[1]}寸`);
    variants.add(`${inchMatch[1]}inch`);
    variants.add(`${inchMatch[1]}"`);
  }
  const numeric = value.match(/^\s*(\d+(?:\.\d+)?)\s*$/);
  if (numeric) variants.add(`${numeric[1]}寸`);
  const compact = value.trim();
  if (compact.length >= 2 && compact.length <= 24) variants.add(compact);
  return [...variants];
}

function parseSheetName(sheetName: string): SheetParam[] {
  const params: SheetParam[] = [];
  const seen = new Set<string>();
  const text = sheetName.normalize("NFC").trim();

  const addParam = (param: SheetParam) => {
    if (seen.has(param.paramKey)) return;
    seen.add(param.paramKey);
    params.push(param);
  };

  if (/非隔离/.test(text)) {
    addParam({ paramKey: "driver_type", rawValue: text, normalizedValue: "非隔离", unit: null });
  } else if (/隔离/.test(text) && !/非隔离/.test(text)) {
    addParam({ paramKey: "driver_type", rawValue: text, normalizedValue: "隔离", unit: null });
  }
  if (/\bDOB\b/i.test(text)) addParam({ paramKey: "driver_type", rawValue: text, normalizedValue: "DOB", unit: null });

  const voltageMatch = text.match(/[（(]?\s*(\d+)\s*V?\s*[-~–]\s*(\d+)\s*V\s*[）)]?/i);
  if (voltageMatch) {
    const v1 = Number.parseInt(voltageMatch[1], 10);
    const v2 = Number.parseInt(voltageMatch[2], 10);
    if (v1 >= 12 && v2 <= 480) addParam({ paramKey: "voltage", rawValue: `${v1}-${v2}V`, normalizedValue: `${v1}-${v2}`, unit: "V" });
  }

  const ipMatch = text.match(/IP\s*(\d{2})/i);
  if (ipMatch) addParam({ paramKey: "ip", rawValue: `IP${ipMatch[1]}`, normalizedValue: ipMatch[1], unit: null });

  return params;
}

function normalizeParamValue(paramKey: string, rawValue: string): NormalizedParamValue {
  const value = rawValue.trim();
  switch (paramKey) {
    case "watts":
      return normalizeNumberWithUnit(value, "W");
    case "luminous_efficacy":
      return normalizeNumberWithUnit(value, "lm/W");
    case "lumens":
      return normalizeNumberWithUnit(value, "lm");
    case "cct":
      return normalizeRangeNumberWithUnit(value, "K");
    case "cri":
    case "pf":
      return { normalizedValue: firstNumber(value), unit: null };
    case "ip": {
      const match = value.match(/ip\s*([0-9]{2})/i) ?? value.match(/\b([0-9]{2})\b/);
      return { normalizedValue: match?.[1] ?? value, unit: null };
    }
    case "beam_angle":
      return normalizeNumberWithUnit(value, "°");
    case "voltage":
      return { normalizedValue: normalizeVoltage(value), unit: "V" };
    case "led_count":
      return { normalizedValue: firstNumber(value), unit: null };
    case "cutout_mm":
      return { normalizedValue: value.replace(/[φΦ]/g, "").trim(), unit: "mm" };
    case "height_mm":
      return { normalizedValue: firstNumber(value), unit: "mm" };
    default:
      return { normalizedValue: value, unit: null };
  }
}

function normalizeNumberWithUnit(value: string, unit: string): NormalizedParamValue {
  return { normalizedValue: firstNumber(value), unit };
}

function normalizeRangeNumberWithUnit(value: string, unit: string): NormalizedParamValue {
  const numbers = value.match(/\d+(?:\.\d+)?/g);
  if (!numbers || numbers.length === 0) return { normalizedValue: value, unit };
  if (numbers.length >= 2) return { normalizedValue: `${numbers[0]}-${numbers[numbers.length - 1]}`, unit };
  return { normalizedValue: numbers[0], unit };
}

function firstNumber(value: string): string | null {
  const match = value.replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  return match?.[0] ?? null;
}

function normalizeVoltage(value: string): string {
  const match = value.replace(/,/g, "").match(/\d+(?:\.\d+)?(?:\s*[-~–]\s*\d+(?:\.\d+)?)?/);
  return match?.[0]?.replace(/\s+/g, "").replace(/–/g, "-") ?? value;
}

async function insertParams(plannedParams: PlannedParam[]): Promise<number> {
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
        sourceField: param.sourceField,
        confidence: "medium",
      })),
    });
    inserted += result.count;
  }
  return inserted;
}

function buildReport(input: {
  mode: "dry-run" | "apply";
  fileResults: FileResult[];
  plannedParams: PlannedParam[];
  matchSamples: MatchSample[];
  unmatchedSamples: UnmatchedSample[];
  insertedParams: number;
  productParamsBefore: number;
  productParamsAfter: number;
}): string {
  const paramStats = buildParamStats(input.plannedParams);
  const categoryStats = buildCategoryStats(input.plannedParams);
  const multirowFiles = input.fileResults.filter((file) => file.multirowSheets > 0).length;
  const multirowSheets = input.fileResults.reduce((sum, file) => sum + file.multirowSheets, 0);
  const matchedRows = input.fileResults.reduce((sum, file) => sum + file.matchedRows, 0);
  const existingSkipped = input.fileResults.reduce((sum, file) => sum + file.existingParamsSkipped, 0);
  const dataColumnParams = input.fileResults.reduce((sum, file) => sum + file.dataColumnParams, 0);
  const sheetNameParams = input.fileResults.reduce((sum, file) => sum + file.sheetNameParams, 0);

  return `# V11.0 多行表头文件参数提取报告

模式: ${input.mode}
时间: ${new Date().toISOString()}
备份: ${BACKUP_PATH}

## 汇总

| 指标 | 数值 |
|---|---:|
| 扫描文件数 | ${input.fileResults.length.toLocaleString()} |
| 含多行表头的文件 | ${multirowFiles.toLocaleString()} |
| 含多行表头的 sheet | ${multirowSheets.toLocaleString()} |
| 匹配产品行数 | ${matchedRows.toLocaleString()} |
| 新增参数 | ${input.plannedParams.length.toLocaleString()} |
| 跳过（已存在） | ${existingSkipped.toLocaleString()} |
| 实际插入 | ${input.insertedParams.toLocaleString()} |
| product_params 变化 | ${input.productParamsBefore.toLocaleString()} → ${input.productParamsAfter.toLocaleString()} |

## 按 param_key 统计

| param_key | 新增记录 | 覆盖产品数 |
|---|---:|---:|
${paramStats.map((stat) => `| ${escapeMd(stat.paramKey)} | ${stat.newRecords.toLocaleString()} | ${stat.productIds.size.toLocaleString()} |`).join("\n")}

## 按品类统计

| 品类 | 多行表头 sheet 数 | 匹配行 | 新增参数 |
|---|---:|---:|---:|
${categoryStats
  .map((stat) => `| ${escapeMd(stat.category)} | ${stat.sheetKeys.size.toLocaleString()} | ${stat.matchedRows.toLocaleString()} | ${stat.newParams.toLocaleString()} |`)
  .join("\n")}

## 按改进来源

| 来源 | 新增参数 |
|---|---:|
| 多行表头参数列 | ${dataColumnParams.toLocaleString()} |
| Sheet 名称参数 | ${sheetNameParams.toLocaleString()} |

## 匹配采样（前 50 条）

| 文件名 | Sheet | 组标签 | 尺寸 | 匹配产品 | 提取 param_key |
|---|---|---|---|---|---|
${input.matchSamples
  .map((sample) => `| ${escapeMd(sample.fileName)} | ${escapeMd(sample.sheetName)} | ${escapeMd(sample.groupLabel)} | ${escapeMd(sample.sizeValue)} | ${escapeMd(sample.productName)} | ${escapeMd(sample.paramKeys)} |`)
  .join("\n")}

## 未匹配采样（前 30 条）

| 文件名 | Sheet | 组标签 | 尺寸值 | 原因 |
|---|---|---|---|---|
${input.unmatchedSamples
  .map((sample) => `| ${escapeMd(sample.fileName)} | ${escapeMd(sample.sheetName)} | ${escapeMd(sample.groupLabel)} | ${escapeMd(sample.sizeValue)} | ${escapeMd(sample.reason)} |`)
  .join("\n")}
`;
}

function buildParamStats(plannedParams: PlannedParam[]): ParamStats[] {
  const byParam = new Map<string, ParamStats>();
  for (const param of plannedParams) {
    const stat = byParam.get(param.paramKey) ?? { paramKey: param.paramKey, newRecords: 0, productIds: new Set<string>() };
    stat.newRecords += 1;
    stat.productIds.add(param.productId);
    byParam.set(param.paramKey, stat);
  }
  return [...byParam.values()].sort((left, right) => right.newRecords - left.newRecords || left.paramKey.localeCompare(right.paramKey));
}

function buildCategoryStats(plannedParams: PlannedParam[]): CategoryStats[] {
  const byCategory = new Map<string, CategoryStats>();
  const rowKeysByCategory = new Map<string, Set<string>>();
  for (const param of plannedParams) {
    const stat = byCategory.get(param.category) ?? {
      category: param.category,
      sheetKeys: new Set<string>(),
      matchedRows: 0,
      newParams: 0,
    };
    stat.sheetKeys.add(`${param.sourceFileId}\u0000${param.sheetName}`);
    stat.newParams += 1;
    byCategory.set(param.category, stat);

    const rowKeys = rowKeysByCategory.get(param.category) ?? new Set<string>();
    rowKeys.add(`${param.sourceFileId}\u0000${param.sheetName}\u0000${param.rowNumber}\u0000${param.productId}`);
    rowKeysByCategory.set(param.category, rowKeys);
  }
  for (const [category, rowKeys] of rowKeysByCategory.entries()) {
    const stat = byCategory.get(category);
    if (stat) stat.matchedRows = rowKeys.size;
  }
  return [...byCategory.values()].sort((left, right) => right.newParams - left.newParams || left.category.localeCompare(right.category));
}

function normalizeHeader(input: string): string {
  return input
    .normalize("NFC")
    .replace(/[\r\n]+/g, " ")
    .replace(/[（(][^）)]*[）)]/g, " ")
    .replace(/±\s*\d+(?:\.\d+)?\s*(?:%|mm|cm)?/gi, " ")
    .replace(/\b(usd|rmb|cny|pcs|pc|mm|cm)\b$/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function matchParamKey(normalizedHeader: string): string | null {
  if (PARAM_EXCLUSION_PATTERNS.some((pattern) => pattern.test(normalizedHeader))) return null;
  if (HEADER_TO_PARAM[normalizedHeader]) return HEADER_TO_PARAM[normalizedHeader];
  const entries = Object.entries(HEADER_TO_PARAM).sort(([left], [right]) => right.length - left.length);
  for (const [label, paramKey] of entries) {
    if (label.length <= 2) {
      if (normalizedHeader === label) return paramKey;
      continue;
    }
    if (containsHeaderLabel(normalizedHeader, label)) return paramKey;
  }
  return null;
}

function inferCategoryFromFile(filePath: string, fileName: string): string | null {
  const combined = `${filePath} ${fileName}`.normalize("NFC");
  const categoryKeywords: Array<[string, string]> = [
    ["太阳能壁灯", "太阳能壁灯"],
    ["太阳能草坪灯", "太阳能"],
    ["太阳能庭院灯", "太阳能"],
    ["太阳能", "太阳能"],
    ["LED橱柜灯", "橱柜灯"],
    ["橱柜灯", "橱柜灯"],
    ["市电壁灯", "壁灯"],
    ["壁灯", "壁灯"],
    ["面板灯", "面板灯"],
    ["筒灯", "筒灯"],
    ["投光灯", "投光灯"],
    ["泛光灯", "投光灯"],
    ["线条灯", "线条灯"],
    ["办公灯", "线条灯"],
    ["三防灯", "三防灯"],
    ["灯丝灯", "灯丝灯"],
    ["灯带", "灯带"],
    ["轨道灯", "轨道灯"],
    ["磁吸灯", "磁吸灯"],
    ["净化灯", "净化灯"],
    ["天花灯", "天花灯"],
    ["工矿灯", "Highbay"],
    ["Highbay", "Highbay"],
    ["球泡", "球泡"],
    ["蜡烛灯", "灯丝灯"],
    ["灯管", "灯管"],
    ["皮线灯", "皮线灯"],
    ["路灯", "路灯"],
    ["庭院灯", "庭院灯"],
    ["工作灯", "工作灯"],
    ["风扇灯", "风扇灯"],
    ["G4G9", "G4G9"],
  ];
  for (const [keyword, category] of categoryKeywords) {
    if (combined.includes(keyword)) return category;
  }
  return null;
}

function containsHeaderLabel(normalizedHeader: string, label: string): boolean {
  if (/^[a-z0-9 ]+$/i.test(label)) {
    const escaped = escapeRegExp(label).replace(/\\ /g, "\\s+");
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(normalizedHeader);
  }
  return normalizedHeader.includes(label);
}

function resolvePhysicalPath(relativePath: string): string {
  if (path.isAbsolute(relativePath)) return relativePath;
  return path.join(process.cwd(), relativePath);
}

function normalizeForMatch(text: string): string {
  return text.normalize("NFC").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

function isBlankRow(row: unknown[]): boolean {
  return row.every((cell) => !cellToString(cell));
}

function isUsefulParamValue(value: string): boolean {
  const normalized = value.trim();
  if (!normalized) return false;
  if (["-", "/", "\\", "n/a", "na", "null", "无"].includes(normalized.toLowerCase())) return false;
  return true;
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

function escapeMd(value: string | number | null | undefined): string {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ").trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
