import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

import { PrismaClient } from "@prisma/client";
import * as XLSX from "xlsx";

const prisma = new PrismaClient();

const REPORT_PATH = path.join("docs", "v10.1-backfill-report.md");
const BACKUP_PATH = path.join("prisma", "dev.db.bak-v10.1");
const HEADER_SCAN_ROWS = 10;
const MIN_HEADER_CELLS = 5;
const INSERT_BATCH_SIZE = 500;
const APPLY_MODE = process.argv.includes("--apply");

type LinkedProduct = {
  productId: string;
  modelNo: string | null;
  productName: string;
  category: string | null;
};

type SourceFile = {
  id: string;
  fileName: string;
  relativePath: string;
  products: LinkedProduct[];
};

type LinkedProductRow = {
  file_id: string;
  file_name: string;
  relative_path: string;
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
  normalizedHeader: string;
  paramKey: string;
};

type ExistingParamRow = {
  productId: string;
  paramKey: string;
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
  header: string;
  paramKey: string;
  rawValue: string;
  normalizedValue: string | null;
  unit: string | null;
};

type FileResult = {
  fileId: string;
  fileName: string;
  relativePath: string;
  productCount: number;
  sheetCount: number;
  scannedRows: number;
  emptyModelRows: number;
  matchedRows: number;
  failedRows: number;
  existingParamsSkipped: number;
  plannedParams: number;
  insertedParams: number;
  skippedSheets: SkippedSheet[];
  readError: string | null;
};

type SkippedSheet = {
  fileName: string;
  sheetName: string;
  reason: string;
};

type MatchFailure = {
  fileName: string;
  sheetName: string;
  rowNumber: number;
  excelModel: string;
  reason: string;
};

type Summary = {
  mode: "dry-run" | "apply";
  files: number;
  skippedFiles: number;
  sheets: number;
  skippedSheets: number;
  scannedRows: number;
  emptyModelRows: number;
  matchedRows: number;
  failedRows: number;
  plannedParams: number;
  existingParamsSkipped: number;
  insertedParams: number;
  productParamsBefore: number;
  productParamsAfter: number;
};

type ParamStats = {
  paramKey: string;
  newRecords: number;
  productIds: Set<string>;
};

type CategoryStats = {
  category: string;
  matchedRows: number;
  newParams: number;
};

type NormalizedParamValue = {
  normalizedValue: string | null;
  unit: string | null;
};

const MODEL_HEADER_PATTERNS = [/item\s*no/i, /model/i, /型号/i, /product\s*no/i, /编号/i, /款号/i];

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
  /g\.?\s*w/i,
  /n\.?\s*w/i,
  /毛重/i,
  /净重/i,
  /箱规/i,
  /外箱/i,
  /内盒/i,
  /装箱/i,
];

const PARAM_EXCLUSION_PATTERNS = [/power\s*cord/i, /线材规格/i];

const HEADER_TO_PARAM: Record<string, string> = {
  power: "watts",
  watt: "watts",
  watts: "watts",
  wattage: "watts",
  "actual watt": "watts",
  "actual power": "watts",
  "real power": "watts",
  "rated wattage": "watts",
  "rated power": "watts",
  功率: "watts",
  实际功率: "watts",
  额定功率: "watts",
  瓦数: "watts",
  w: "watts",
  cct: "cct",
  色温: "cct",
  可选色温: "cct",
  cri: "cri",
  ra: "cri",
  显指: "cri",
  pf: "pf",
  "power factor": "pf",
  功率因数: "pf",
  功率因素: "pf",
  pf值: "pf",
  "lm/w": "luminous_efficacy",
  efficiency: "luminous_efficacy",
  光效: "luminous_efficacy",
  整灯光效: "luminous_efficacy",
  裸灯光效: "luminous_efficacy",
  "luminous flux": "luminous_efficacy",
  lumens: "lumens",
  lumen: "lumens",
  光通量: "lumens",
  "beam angle": "beam_angle",
  光束角: "beam_angle",
  ip: "ip",
  "ip class": "ip",
  "ip grade": "ip",
  "ip rate": "ip",
  防护等级: "ip",
  防水等级: "ip",
  voltage: "voltage",
  "input voltage": "voltage",
  input: "voltage",
  电压: "voltage",
  material: "material",
  材质: "material",
  size: "size_display",
  dimension: "size_display",
  尺寸: "size_display",
  产品尺寸: "size_display",
  面环规格: "size_display",
  "product size": "size_display",
  "body size": "size_display",
  规格: "size_display",
  "led type": "led_type",
  "chip type": "led_type",
  chip: "led_type",
  base: "base",
  灯头: "base",
  warranty: "warranty",
  质保: "warranty",
  guarantee: "warranty",
  certificate: "certification",
  认证: "certification",
  shape: "shape",
  形状: "shape",
  "cut size": "cutout_mm",
  "hole size": "cutout_mm",
  开孔: "cutout_mm",
  "led qty": "led_count",
  "led no": "led_count",
  "chips qty": "led_count",
  "led quantity": "led_count",
  灯珠数: "led_count",
  灯珠颗数: "led_count",
  driver: "driver_type",
  "driver brand": "driver_brand",
  驱动: "driver_type",
  flicker: "flicker",
  flickery: "flicker",
  频闪: "flicker",
  sdcm: "sdcm",
  色容差: "sdcm",
  spd: "spd",
  surge: "spd",
  "ambient temperature": "ambient_temp",
  环境温度: "ambient_temp",
  height: "height_mm",
  高度: "height_mm",
  "maximum linkable power": "max_linkable_power",
  accessories: "accessories",
  note: "note",
  remark: "note",
  备注: "note",
};

async function main() {
  if (!existsSync(BACKUP_PATH)) {
    throw new Error(`Missing DB backup: ${BACKUP_PATH}. Run cp prisma/dev.db prisma/dev.db.bak-v10.1 first.`);
  }

  const productParamsBefore = await prisma.productParam.count();
  const sourceFiles = await loadSourceFiles();
  const allProductIds = [...new Set(sourceFiles.flatMap((file) => file.products.map((product) => product.productId)))];
  const existingParamKeys = await loadExistingParamKeys(allProductIds);

  const plannedParams: PlannedParam[] = [];
  const matchFailures: MatchFailure[] = [];
  const fileResults: FileResult[] = [];

  for (const [index, file] of sourceFiles.entries()) {
    if (index === 0 || (index + 1) % 50 === 0 || index + 1 === sourceFiles.length) {
      console.log(`Scanning ${index + 1}/${sourceFiles.length}: ${file.relativePath}`);
    }

    fileResults.push(scanFile(file, existingParamKeys, plannedParams, matchFailures));
  }

  const insertedParams = APPLY_MODE ? await insertParams(plannedParams) : 0;
  const productParamsAfter = await prisma.productParam.count();
  const summary = buildSummary({
    mode: APPLY_MODE ? "apply" : "dry-run",
    fileResults,
    productParamsBefore,
    productParamsAfter,
    insertedParams,
  });

  await mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await writeFile(
    REPORT_PATH,
    buildReport({
      summary,
      fileResults,
      plannedParams,
      matchFailures,
    }),
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        mode: summary.mode,
        reportPath: REPORT_PATH,
        sourceFiles: summary.files,
        scannedRows: summary.scannedRows,
        matchedRows: summary.matchedRows,
        matchRate: summary.scannedRows > 0 ? `${Math.round((summary.matchedRows / summary.scannedRows) * 1000) / 10}%` : "0%",
        plannedParams: summary.plannedParams,
        existingParamsSkipped: summary.existingParamsSkipped,
        insertedParams: summary.insertedParams,
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
  const rows = await prisma.$queryRaw<LinkedProductRow[]>`
    SELECT DISTINCT
      f.id AS file_id,
      f.file_name,
      f.relative_path,
      p.id AS product_id,
      p.model_no,
      p.product_name,
      p.category
    FROM supplier_offers so
    JOIN files f ON f.id = so.source_file_id
    JOIN products p ON p.id = so.product_id
    WHERE so.source_file_id IS NOT NULL
      AND f.file_type = 'excel'
    ORDER BY f.relative_path, p.model_no, p.product_name
  `;

  const filesById = new Map<string, SourceFile>();
  for (const row of rows) {
    const file =
      filesById.get(row.file_id) ??
      ({
        id: row.file_id,
        fileName: row.file_name,
        relativePath: row.relative_path,
        products: [],
      } satisfies SourceFile);

    file.products.push({
      productId: row.product_id,
      modelNo: row.model_no,
      productName: row.product_name,
      category: row.category,
    });
    filesById.set(row.file_id, file);
  }

  return [...filesById.values()];
}

async function loadExistingParamKeys(productIds: string[]): Promise<Set<string>> {
  const existing = new Set<string>();

  for (let index = 0; index < productIds.length; index += 900) {
    const chunk = productIds.slice(index, index + 900);
    const rows = await prisma.productParam.findMany({
      where: { productId: { in: chunk } },
      select: { productId: true, paramKey: true },
    });

    for (const row of rows satisfies ExistingParamRow[]) {
      existing.add(productParamKey(row.productId, row.paramKey));
    }
  }

  return existing;
}

function scanFile(
  file: SourceFile,
  existingParamKeys: Set<string>,
  plannedParams: PlannedParam[],
  matchFailures: MatchFailure[],
): FileResult {
  const physicalPath = resolvePhysicalPath(file.relativePath);
  const result: FileResult = {
    fileId: file.id,
    fileName: file.fileName,
    relativePath: file.relativePath,
    productCount: file.products.length,
    sheetCount: 0,
    scannedRows: 0,
    emptyModelRows: 0,
    matchedRows: 0,
    failedRows: 0,
    existingParamsSkipped: 0,
    plannedParams: 0,
    insertedParams: 0,
    skippedSheets: [],
    readError: null,
  };

  if (!existsSync(physicalPath)) {
    result.readError = "file missing";
    return result;
  }

  try {
    const workbook = XLSX.readFile(physicalPath, { cellDates: false });
    result.sheetCount = workbook.SheetNames.length;

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const range = sheet?.["!ref"] ? XLSX.utils.decode_range(sheet["!ref"]) : null;
      if (!sheet || !range) {
        result.skippedSheets.push({ fileName: file.fileName, sheetName, reason: "empty sheet" });
        continue;
      }

      const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
        header: 1,
        defval: "",
        raw: false,
      });
      const header = detectHeaderRow(rows.slice(0, HEADER_SCAN_ROWS));
      if (!header) {
        result.skippedSheets.push({ fileName: file.fileName, sheetName, reason: "no header row with >= 5 cells" });
        continue;
      }

      const modelColumnIndex = findModelColumn(header.values);
      if (modelColumnIndex == null) {
        result.skippedSheets.push({ fileName: file.fileName, sheetName, reason: "no model column" });
        continue;
      }

      const paramColumns = findParamColumns(header.values, modelColumnIndex);
      if (paramColumns.length === 0) {
        result.skippedSheets.push({ fileName: file.fileName, sheetName, reason: "no mapped param columns" });
        continue;
      }

      const sheetStart = {
        scannedRows: result.scannedRows,
        emptyModelRows: result.emptyModelRows,
        matchedRows: result.matchedRows,
        failedRows: result.failedRows,
        existingParamsSkipped: result.existingParamsSkipped,
        plannedParams: result.plannedParams,
        plannedParamLength: plannedParams.length,
        failureLength: matchFailures.length,
      };
      const dataRows = rows.slice(header.rowIndex + 1);
      for (const [offset, row] of dataRows.entries()) {
        if (isBlankRow(row)) continue;

        const rowNumber = header.rowIndex + 2 + offset;
        const excelModel = cellToString(row[modelColumnIndex]);
        if (!excelModel) {
          result.emptyModelRows += 1;
          continue;
        }

        result.scannedRows += 1;
        const matched = matchProduct(excelModel, file.products);
        if (!matched.product) {
          result.failedRows += 1;
          pushFailure(matchFailures, file.fileName, sheetName, rowNumber, excelModel, matched.reason);
          continue;
        }

        result.matchedRows += 1;
        const beforeRowParamCount = plannedParams.length;

        for (const column of paramColumns) {
          const rawValue = cellToString(row[column.index]);
          if (!isUsefulParamValue(rawValue)) continue;

          const key = productParamKey(matched.product.productId, column.paramKey);
          if (existingParamKeys.has(key)) {
            result.existingParamsSkipped += 1;
            continue;
          }

          const normalized = normalizeParamValue(column.paramKey, rawValue);
          plannedParams.push({
            id: randomUUID(),
            productId: matched.product.productId,
            productModel: matched.product.modelNo ?? "",
            productName: matched.product.productName,
            category: matched.product.category ?? "(未分类)",
            sourceFileId: file.id,
            fileName: file.fileName,
            sheetName,
            rowNumber,
            header: column.header,
            paramKey: column.paramKey,
            rawValue,
            normalizedValue: normalized.normalizedValue,
            unit: normalized.unit,
          });
          existingParamKeys.add(key);
        }

        result.plannedParams += plannedParams.length - beforeRowParamCount;
      }

      if (result.matchedRows === sheetStart.matchedRows) {
        result.scannedRows = sheetStart.scannedRows;
        result.emptyModelRows = sheetStart.emptyModelRows;
        result.failedRows = sheetStart.failedRows;
        result.existingParamsSkipped = sheetStart.existingParamsSkipped;
        result.plannedParams = sheetStart.plannedParams;
        plannedParams.splice(sheetStart.plannedParamLength);
        matchFailures.splice(sheetStart.failureLength);
        result.skippedSheets.push({ fileName: file.fileName, sheetName, reason: "no product matches in sheet" });
      }
    }
  } catch (error) {
    result.readError = error instanceof Error ? error.message : String(error);
  }

  return result;
}

function detectHeaderRow(rows: unknown[][]): HeaderInfo | null {
  let best: { rowIndex: number; values: unknown[]; nonEmptyCount: number } | null = null;

  for (const [rowIndex, row] of rows.entries()) {
    const nonEmptyCount = row.filter((cell) => cellToString(cell)).length;
    if (nonEmptyCount < MIN_HEADER_CELLS) continue;
    if (!best || nonEmptyCount > best.nonEmptyCount) {
      best = { rowIndex, values: row, nonEmptyCount };
    }
  }

  return best ? { rowIndex: best.rowIndex, values: best.values } : null;
}

function findModelColumn(headerValues: unknown[]): number | null {
  for (const [index, value] of headerValues.entries()) {
    const normalized = normalizeHeader(cellToString(value));
    if (!normalized) continue;
    if (MODEL_HEADER_PATTERNS.some((pattern) => pattern.test(normalized))) return index;
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

function matchProduct(
  excelModelValue: string,
  products: LinkedProduct[],
): { product: LinkedProduct | null; reason: string } {
  const normalizedExcel = normalizeForMatch(excelModelValue);
  if (!normalizedExcel) return { product: null, reason: "empty normalized model" };

  const exactModelMatches = products.filter((product) => normalizeForMatch(product.modelNo ?? "") === normalizedExcel);
  const exactModel = chooseLongestUnique(exactModelMatches, normalizedExcel);
  if (exactModel.product) return exactModel;
  if (exactModel.reason) return exactModel;

  const containModelMatches = products.filter((product) => {
    const normalizedModel = normalizeForMatch(product.modelNo ?? "");
    return normalizedModel.length >= 2 && (normalizedExcel.includes(normalizedModel) || normalizedModel.includes(normalizedExcel));
  });
  const containModel = chooseLongestUnique(containModelMatches, normalizedExcel);
  if (containModel.product) return containModel;
  if (containModel.reason) return containModel;

  const nameMatches = products.filter((product) => {
    const normalizedName = normalizeForMatch(product.productName);
    return normalizedName.length >= 2 && (normalizedExcel.includes(normalizedName) || normalizedName.includes(normalizedExcel));
  });
  const nameMatch = chooseLongestUnique(nameMatches, normalizedExcel);
  if (nameMatch.product) return nameMatch;
  if (nameMatch.reason) return nameMatch;

  return { product: null, reason: "no product match" };
}

function chooseLongestUnique(products: LinkedProduct[], excelValue: string): { product: LinkedProduct | null; reason: string } {
  if (products.length === 0) return { product: null, reason: "" };

  const scored = products
    .map((product) => {
      const modelScore = commonMatchScore(excelValue, normalizeForMatch(product.modelNo ?? ""));
      const nameScore = commonMatchScore(excelValue, normalizeForMatch(product.productName));
      return { product, score: Math.max(modelScore, nameScore) };
    })
    .sort((a, b) => b.score - a.score || a.product.productId.localeCompare(b.product.productId));

  if (scored.length === 1 || scored[0].score > scored[1].score) {
    return { product: scored[0].product, reason: "" };
  }

  return { product: null, reason: "multiple product matches with same score" };
}

function commonMatchScore(left: string, right: string): number {
  if (!left || !right) return 0;
  if (left === right) return right.length + 1000;
  if (left.includes(right)) return right.length;
  if (right.includes(left)) return left.length;
  return 0;
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
    default:
      return { normalizedValue: value, unit: defaultUnitForParam(paramKey) };
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
  const match = value.replace(/,/g, "").match(/\d+(?:\.\d+)?(?:\s*[-~]\s*\d+(?:\.\d+)?)?/);
  return match?.[0]?.replace(/\s+/g, "") ?? value;
}

function defaultUnitForParam(paramKey: string): string | null {
  switch (paramKey) {
    case "height_mm":
    case "cutout_mm":
      return "mm";
    default:
      return null;
  }
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
        sourceField: "excel_column",
        confidence: "high",
      })),
    });
    inserted += result.count;
  }

  return inserted;
}

function buildSummary(input: {
  mode: "dry-run" | "apply";
  fileResults: FileResult[];
  productParamsBefore: number;
  productParamsAfter: number;
  insertedParams: number;
}): Summary {
  const { mode, fileResults, productParamsBefore, productParamsAfter, insertedParams } = input;
  return {
    mode,
    files: fileResults.length,
    skippedFiles: fileResults.filter((file) => file.readError).length,
    sheets: fileResults.reduce((sum, file) => sum + file.sheetCount, 0),
    skippedSheets: fileResults.reduce((sum, file) => sum + file.skippedSheets.length, 0),
    scannedRows: fileResults.reduce((sum, file) => sum + file.scannedRows, 0),
    emptyModelRows: fileResults.reduce((sum, file) => sum + file.emptyModelRows, 0),
    matchedRows: fileResults.reduce((sum, file) => sum + file.matchedRows, 0),
    failedRows: fileResults.reduce((sum, file) => sum + file.failedRows, 0),
    plannedParams: fileResults.reduce((sum, file) => sum + file.plannedParams, 0),
    existingParamsSkipped: fileResults.reduce((sum, file) => sum + file.existingParamsSkipped, 0),
    insertedParams,
    productParamsBefore,
    productParamsAfter,
  };
}

function buildReport(input: {
  summary: Summary;
  fileResults: FileResult[];
  plannedParams: PlannedParam[];
  matchFailures: MatchFailure[];
}): string {
  const { summary, fileResults, plannedParams, matchFailures } = input;
  const paramStats = buildParamStats(plannedParams);
  const categoryStats = buildCategoryStats(plannedParams);
  const skippedSheets = fileResults.flatMap((file) => file.skippedSheets);

  return `# V10.1 参数回填报告

模式: ${summary.mode}
时间: ${new Date().toISOString()}
备份: ${BACKUP_PATH}

## 汇总

| 指标 | 数值 |
|---|---:|
| 扫描文件数 | ${summary.files.toLocaleString()} |
| 跳过文件（读取失败） | ${summary.skippedFiles.toLocaleString()} |
| 扫描 Sheet 数 | ${summary.sheets.toLocaleString()} |
| 跳过 Sheet | ${summary.skippedSheets.toLocaleString()} |
| 扫描数据行 | ${summary.scannedRows.toLocaleString()} |
| 跳过空型号行 | ${summary.emptyModelRows.toLocaleString()} |
| 匹配成功行 | ${summary.matchedRows.toLocaleString()} |
| 匹配失败行 | ${summary.failedRows.toLocaleString()} |
| 匹配率 | ${formatPercent(summary.scannedRows > 0 ? summary.matchedRows / summary.scannedRows : 0)} |
| 待插入新参数 | ${summary.plannedParams.toLocaleString()} |
| 跳过（已存在） | ${summary.existingParamsSkipped.toLocaleString()} |
| 实际插入 | ${summary.insertedParams.toLocaleString()} |
| product_params 变化 | ${summary.productParamsBefore.toLocaleString()} → ${summary.productParamsAfter.toLocaleString()} |

## 按 param_key 统计

| param_key | 新增记录数 | 覆盖新产品数 |
|---|---:|---:|
${paramStats
  .map((stat) => `| ${escapeMd(stat.paramKey)} | ${stat.newRecords.toLocaleString()} | ${stat.productIds.size.toLocaleString()} |`)
  .join("\n")}

## 按品类统计

| 品类 | 匹配行数 | 新增参数数 |
|---|---:|---:|
${categoryStats
  .map((stat) => `| ${escapeMd(stat.category)} | ${stat.matchedRows.toLocaleString()} | ${stat.newParams.toLocaleString()} |`)
  .join("\n")}

## 匹配失败采样（前 50 行）

| 文件名 | Sheet | 行号 | Excel 型号值 | 跳过原因 |
|---|---|---:|---|---|
${matchFailures
  .slice(0, 50)
  .map(
    (failure) =>
      `| ${escapeMd(failure.fileName)} | ${escapeMd(failure.sheetName)} | ${failure.rowNumber} | ${escapeMd(failure.excelModel)} | ${escapeMd(failure.reason)} |`,
  )
  .join("\n")}

## 跳过文件 / Sheet 列表

| 文件名 | Sheet | 原因 |
|---|---|---|
${skippedSheets
  .map((sheet) => `| ${escapeMd(sheet.fileName)} | ${escapeMd(sheet.sheetName)} | ${escapeMd(sheet.reason)} |`)
  .join("\n")}

## 新参数采样（前 100 条）

| 产品 | 品类 | param_key | 原始值 | 归一化 | 来源文件 | Sheet | 行号 |
|---|---|---|---|---|---|---|---:|
${plannedParams
  .slice(0, 100)
  .map(
    (param) =>
      `| ${escapeMd(param.productModel || param.productName)} | ${escapeMd(param.category)} | ${escapeMd(param.paramKey)} | ${escapeMd(param.rawValue)} | ${escapeMd(param.normalizedValue ?? "-")} ${param.unit ?? ""} | ${escapeMd(param.fileName)} | ${escapeMd(param.sheetName)} | ${param.rowNumber} |`,
  )
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

  return [...byParam.values()].sort((a, b) => b.newRecords - a.newRecords || a.paramKey.localeCompare(b.paramKey));
}

function buildCategoryStats(plannedParams: PlannedParam[]): CategoryStats[] {
  const byCategory = new Map<string, CategoryStats>();
  const rowKeysByCategory = new Map<string, Set<string>>();

  for (const param of plannedParams) {
    const stat = byCategory.get(param.category) ?? { category: param.category, matchedRows: 0, newParams: 0 };
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

  return [...byCategory.values()].sort((a, b) => b.newParams - a.newParams || b.matchedRows - a.matchedRows);
}

function normalizeHeader(input: string): string {
  return input
    .normalize("NFC")
    .replace(/[\r\n]+/g, " ")
    .replace(/[（(][^）)]*[）)]/g, " ")
    .replace(/±\s*\d+\s*%/gi, " ")
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
    if (label.length <= 2) continue;
    if (containsHeaderLabel(normalizedHeader, label)) return paramKey;
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
  return text
    .normalize("NFC")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
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

function pushFailure(
  failures: MatchFailure[],
  fileName: string,
  sheetName: string,
  rowNumber: number,
  excelModel: string,
  reason: string,
) {
  if (failures.length >= 1000) return;
  failures.push({ fileName, sheetName, rowNumber, excelModel, reason });
}

function productParamKey(productId: string, paramKey: string): string {
  return `${productId}\u0000${paramKey}`;
}

function formatPercent(value: number): string {
  return `${Math.round(value * 1000) / 10}%`;
}

function escapeMd(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ").trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
