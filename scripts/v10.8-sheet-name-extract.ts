import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { PrismaClient } from "@prisma/client";
import * as XLSX from "xlsx";

const prisma = new PrismaClient();

const REPORT_PATH = path.join("docs", "v10.8-sheet-name-report.md");
const HEADER_SCAN_ROWS = 10;
const MIN_HEADER_CELLS = 3;
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
  fileName: string;
  sheetName: string;
  paramKey: string;
  rawValue: string;
  normalizedValue: string;
  unit: string | null;
};

type SheetSample = {
  fileName: string;
  sheetName: string;
  params: string;
  productCount: number;
};

type FileResult = {
  fileName: string;
  relativePath: string;
  sheetCount: number;
  parsedSheets: number;
  matchedProducts: number;
  plannedParams: number;
  existingParamsSkipped: number;
  readError: string | null;
};

type ParamStats = {
  paramKey: string;
  newRecords: number;
  productIds: Set<string>;
};

type CategoryStats = {
  category: string;
  parsedSheets: Set<string>;
  productIds: Set<string>;
  newParams: number;
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

async function main() {
  const productParamsBefore = await prisma.productParam.count();
  const sourceFiles = await loadSourceFiles();
  const allProductIds = [...new Set(sourceFiles.flatMap((file) => file.products.map((product) => product.productId)))];
  const existingParamKeys = await loadExistingParamKeys(allProductIds);
  const plannedParams: PlannedParam[] = [];
  const fileResults: FileResult[] = [];
  const samples: SheetSample[] = [];

  for (const [index, file] of sourceFiles.entries()) {
    if (index === 0 || (index + 1) % 50 === 0 || index + 1 === sourceFiles.length) {
      console.log(`Sheet-name scan ${index + 1}/${sourceFiles.length}: ${file.relativePath}`);
    }
    fileResults.push(scanFile(file, existingParamKeys, plannedParams, samples));
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
      samples,
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
        parsedSheets: fileResults.reduce((sum, file) => sum + file.parsedSheets, 0),
        matchedProducts: fileResults.reduce((sum, file) => sum + file.matchedProducts, 0),
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
  const rows = await prisma.$queryRaw<LinkedProductRow[]>`
    SELECT DISTINCT
      f.id AS file_id,
      f.file_name AS file_name,
      f.relative_path AS relative_path,
      p.id AS product_id,
      p.model_no AS model_no,
      p.product_name AS product_name,
      p.category AS category
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

function scanFile(
  file: SourceFile,
  existingParamKeys: Set<string>,
  plannedParams: PlannedParam[],
  samples: SheetSample[],
): FileResult {
  const result: FileResult = {
    fileName: file.fileName,
    relativePath: file.relativePath,
    sheetCount: 0,
    parsedSheets: 0,
    matchedProducts: 0,
    plannedParams: 0,
    existingParamsSkipped: 0,
    readError: null,
  };

  const physicalPath = resolvePhysicalPath(file.relativePath);
  if (!existsSync(physicalPath)) {
    result.readError = "file missing";
    return result;
  }

  try {
    const workbook = XLSX.readFile(physicalPath, { cellDates: false });
    result.sheetCount = workbook.SheetNames.length;
    for (const sheetName of workbook.SheetNames) {
      if (shouldSkipSheet(sheetName)) continue;
      const sheetParams = parseSheetName(sheetName);
      if (sheetParams.length === 0) continue;

      const sheet = workbook.Sheets[sheetName];
      if (!sheet?.["!ref"]) continue;
      const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: false });
      let sheetProducts = findSheetProducts(rows, file.products);
      if (sheetProducts.length === 0 && workbook.SheetNames.length === 1) sheetProducts = file.products;
      if (sheetProducts.length === 0) continue;

      result.parsedSheets += 1;
      result.matchedProducts += sheetProducts.length;
      if (samples.length < 50) {
        samples.push({
          fileName: file.fileName,
          sheetName,
          params: sheetParams.map((param) => `${param.paramKey}=${param.normalizedValue}${param.unit ?? ""}`).join(", "),
          productCount: sheetProducts.length,
        });
      }

      for (const product of sheetProducts) {
        for (const param of sheetParams) {
          const key = productParamKey(product.productId, param.paramKey);
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
            fileName: file.fileName,
            sheetName,
            paramKey: param.paramKey,
            rawValue: param.rawValue,
            normalizedValue: param.normalizedValue,
            unit: param.unit,
          });
          existingParamKeys.add(key);
          result.plannedParams += 1;
        }
      }
    }
  } catch (error) {
    result.readError = error instanceof Error ? error.message : String(error);
  }

  return result;
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
    if (v1 >= 12 && v2 <= 480) {
      addParam({ paramKey: "voltage", rawValue: `${v1}-${v2}V`, normalizedValue: `${v1}-${v2}`, unit: "V" });
    }
  }

  const ipMatch = text.match(/IP\s*(\d{2})/i);
  if (ipMatch) addParam({ paramKey: "ip", rawValue: `IP${ipMatch[1]}`, normalizedValue: ipMatch[1], unit: null });

  const cctRangeMatch = text.match(/(\d{4})\s*[-~–]\s*(\d{4})\s*K/i);
  if (cctRangeMatch) {
    const k1 = Number.parseInt(cctRangeMatch[1], 10);
    const k2 = Number.parseInt(cctRangeMatch[2], 10);
    if (k1 >= 1800 && k2 <= 10000) {
      addParam({ paramKey: "cct", rawValue: `${k1}-${k2}K`, normalizedValue: `${k1}-${k2}`, unit: "K" });
    }
  } else {
    const cctSingleMatch = text.match(/(\d{4})\s*K/i);
    if (cctSingleMatch) {
      const k = Number.parseInt(cctSingleMatch[1], 10);
      if (k >= 1800 && k <= 10000) addParam({ paramKey: "cct", rawValue: `${k}K`, normalizedValue: String(k), unit: "K" });
    }
  }

  return params;
}

function shouldSkipSheet(sheetName: string): boolean {
  return /汇总|目录|index|summary|封面|说明|template/i.test(sheetName);
}

function findSheetProducts(rows: unknown[][], products: LinkedProduct[]): LinkedProduct[] {
  const header = detectHeaderRow(rows.slice(0, HEADER_SCAN_ROWS));
  if (!header) return [];
  const modelColumn = findModelColumn(header.values);
  if (modelColumn == null) return [];

  const matched = new Map<string, LinkedProduct>();
  for (const row of rows.slice(header.rowIndex + 1)) {
    if (isBlankRow(row)) continue;
    const modelValue = cellToString(row[modelColumn]);
    if (!modelValue) continue;
    const product = matchProduct(modelValue, products);
    if (product) matched.set(product.productId, product);
  }
  return [...matched.values()];
}

function detectHeaderRow(rows: unknown[][]): HeaderInfo | null {
  let best: { rowIndex: number; values: unknown[]; nonEmptyCount: number } | null = null;
  for (const [rowIndex, row] of rows.entries()) {
    const nonEmptyCount = row.filter((cell) => cellToString(cell)).length;
    if (nonEmptyCount < MIN_HEADER_CELLS) continue;
    if (!best || nonEmptyCount > best.nonEmptyCount) best = { rowIndex, values: row, nonEmptyCount };
  }
  return best ? { rowIndex: best.rowIndex, values: best.values } : null;
}

function findModelColumn(headerValues: unknown[]): number | null {
  for (const [index, value] of headerValues.entries()) {
    const header = cellToString(value);
    if (!header) continue;
    if (MODEL_HEADER_PATTERNS.some((pattern) => pattern.test(header))) return index;
  }
  return null;
}

function matchProduct(excelModelValue: string, products: LinkedProduct[]): LinkedProduct | null {
  const normalizedExcel = normalizeForMatch(excelModelValue);
  if (!normalizedExcel) return null;

  const exact = chooseUnique(
    products.filter((product) => normalizeForMatch(product.modelNo ?? "") === normalizedExcel),
    normalizedExcel,
  );
  if (exact) return exact;

  return chooseUnique(
    products.filter((product) => {
      const model = normalizeForMatch(product.modelNo ?? "");
      const name = normalizeForMatch(product.productName);
      return (
        (model.length >= 2 && (normalizedExcel.includes(model) || model.includes(normalizedExcel))) ||
        (name.length >= 2 && (normalizedExcel.includes(name) || name.includes(normalizedExcel)))
      );
    }),
    normalizedExcel,
  );
}

function chooseUnique(products: LinkedProduct[], excelValue: string): LinkedProduct | null {
  if (products.length === 0) return null;
  const scored = products
    .map((product) => ({
      product,
      score: Math.max(commonScore(excelValue, normalizeForMatch(product.modelNo ?? "")), commonScore(excelValue, normalizeForMatch(product.productName))),
    }))
    .sort((a, b) => b.score - a.score || a.product.productId.localeCompare(b.product.productId));
  return scored.length === 1 || scored[0].score > scored[1].score ? scored[0].product : null;
}

function commonScore(left: string, right: string): number {
  if (!left || !right) return 0;
  if (left === right) return right.length + 1000;
  if (left.includes(right)) return right.length;
  if (right.includes(left)) return left.length;
  return 0;
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
        sourceField: "sheet_name",
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
  samples: SheetSample[];
  insertedParams: number;
  productParamsBefore: number;
  productParamsAfter: number;
}): string {
  const { mode, fileResults, plannedParams, samples, insertedParams, productParamsBefore, productParamsAfter } = input;
  const paramStats = buildParamStats(plannedParams);
  const categoryStats = buildCategoryStats(plannedParams);

  return `# V10.8 Sheet 名称参数提取报告

模式: ${mode}
时间: ${new Date().toISOString()}

## 汇总

| 指标 | 数值 |
|---|---:|
| 扫描文件数 | ${fileResults.length.toLocaleString()} |
| 含可解析 sheet 名称的文件 | ${fileResults.filter((file) => file.parsedSheets > 0).length.toLocaleString()} |
| 可解析 sheet 数 | ${fileResults.reduce((sum, file) => sum + file.parsedSheets, 0).toLocaleString()} |
| 匹配产品数 | ${fileResults.reduce((sum, file) => sum + file.matchedProducts, 0).toLocaleString()} |
| 新增参数 | ${plannedParams.length.toLocaleString()} |
| 跳过（已存在） | ${fileResults.reduce((sum, file) => sum + file.existingParamsSkipped, 0).toLocaleString()} |
| 实际插入 | ${insertedParams.toLocaleString()} |
| product_params 变化 | ${productParamsBefore.toLocaleString()} → ${productParamsAfter.toLocaleString()} |

## 按 param_key 统计

| param_key | 新增记录 | 覆盖产品数 |
|---|---:|---:|
${paramStats.map((stat) => `| ${escapeMd(stat.paramKey)} | ${stat.newRecords.toLocaleString()} | ${stat.productIds.size.toLocaleString()} |`).join("\n")}

## 按品类统计

| 品类 | 可解析 sheet 数 | 匹配产品 | 新增参数 |
|---|---:|---:|---:|
${categoryStats
  .map((stat) => `| ${escapeMd(stat.category)} | ${stat.parsedSheets.size.toLocaleString()} | ${stat.productIds.size.toLocaleString()} | ${stat.newParams.toLocaleString()} |`)
  .join("\n")}

## sheet 名称采样（前 50 条）

| 文件名 | Sheet 名称 | 提取 param_key | 受益产品数 |
|---|---|---|---:|
${samples
  .map((sample) => `| ${escapeMd(sample.fileName)} | ${escapeMd(sample.sheetName)} | ${escapeMd(sample.params)} | ${sample.productCount.toLocaleString()} |`)
  .join("\n")}

## 读取失败文件

| 文件名 | 原因 |
|---|---|
${fileResults
  .filter((file) => file.readError)
  .map((file) => `| ${escapeMd(file.fileName)} | ${escapeMd(file.readError ?? "")} |`)
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
  for (const param of plannedParams) {
    const stat = byCategory.get(param.category) ?? {
      category: param.category,
      parsedSheets: new Set<string>(),
      productIds: new Set<string>(),
      newParams: 0,
    };
    stat.newParams += 1;
    stat.productIds.add(param.productId);
    stat.parsedSheets.add(`${param.fileName}\u0000${param.sheetName}`);
    byCategory.set(param.category, stat);
  }
  return [...byCategory.values()].sort((a, b) => b.newParams - a.newParams || a.category.localeCompare(b.category));
}

function resolvePhysicalPath(relativePath: string): string {
  return path.isAbsolute(relativePath) ? relativePath : path.join(process.cwd(), relativePath);
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

function cellToString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value).trim();
  return String(value).trim();
}

function productParamKey(productId: string, paramKey: string): string {
  return `${productId}\u0000${paramKey}`;
}

function escapeMd(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ").trim();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
