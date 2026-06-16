import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { PrismaClient } from "@prisma/client";
import * as XLSX from "xlsx";

const prisma = new PrismaClient();

const REPORT_PATH = path.join("docs", "v10.6-header-extract-report.md");
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

type HeaderParam = {
  columnIndex: number;
  header: string;
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
  header: string;
  paramKey: string;
  rawValue: string;
  normalizedValue: string;
  unit: string | null;
};

type SheetSample = {
  fileName: string;
  sheetName: string;
  header: string;
  paramKey: string;
  value: string;
  matchedProduct: string;
};

type FileResult = {
  fileName: string;
  relativePath: string;
  sheetCount: number;
  sheetsWithHeaderParams: number;
  headerParamColumns: number;
  matchedRows: number;
  plannedParams: number;
  existingParamsSkipped: number;
  readError: string | null;
};

type CategoryStats = {
  category: string;
  sheets: Set<string>;
  matchedRows: number;
  newParams: number;
};

type ParamStats = {
  paramKey: string;
  newRecords: number;
  productIds: Set<string>;
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
      console.log(`Header scan ${index + 1}/${sourceFiles.length}: ${file.relativePath}`);
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
        filesWithHeaderParams: fileResults.filter((file) => file.headerParamColumns > 0).length,
        sheetsWithHeaderParams: fileResults.reduce((sum, file) => sum + file.sheetsWithHeaderParams, 0),
        headerParamColumns: fileResults.reduce((sum, file) => sum + file.headerParamColumns, 0),
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
    sheetsWithHeaderParams: 0,
    headerParamColumns: 0,
    matchedRows: 0,
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
      const sheet = workbook.Sheets[sheetName];
      if (!sheet?.["!ref"]) continue;
      const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: false });
      const header = detectHeaderRow(rows.slice(0, HEADER_SCAN_ROWS));
      if (!header) continue;

      const modelColumn = findModelColumn(header.values);
      if (modelColumn == null) continue;

      const headerParams = detectHeaderParams(header.values).filter((param) => param.columnIndex !== modelColumn);
      if (headerParams.length === 0) continue;

      result.sheetsWithHeaderParams += 1;
      result.headerParamColumns += headerParams.length;

      for (const row of rows.slice(header.rowIndex + 1)) {
        if (isBlankRow(row)) continue;
        const excelModel = cellToString(row[modelColumn]);
        if (!excelModel) continue;
        const product = matchProduct(excelModel, file.products);
        if (!product) continue;

        let rowMatched = false;
        for (const param of headerParams) {
          const cellValue = cellToString(row[param.columnIndex]);
          if (!isUsefulCell(cellValue)) continue;

          rowMatched = true;
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
            header: param.header,
            paramKey: param.paramKey,
            rawValue: param.rawValue,
            normalizedValue: param.normalizedValue,
            unit: param.unit,
          });
          existingParamKeys.add(key);
          result.plannedParams += 1;
          if (samples.length < 100) {
            samples.push({
              fileName: file.fileName,
              sheetName,
              header: param.header,
              paramKey: param.paramKey,
              value: `${param.normalizedValue}${param.unit ? ` ${param.unit}` : ""}`,
              matchedProduct: product.modelNo ?? product.productName,
            });
          }
        }
        if (rowMatched) result.matchedRows += 1;
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

function detectHeaderParams(headers: unknown[]): HeaderParam[] {
  const result: HeaderParam[] = [];
  for (const [columnIndex, value] of headers.entries()) {
    const header = cellToString(value);
    if (!header) continue;
    const parsed = parseHeaderAsParam(header);
    if (!parsed) continue;
    result.push({ columnIndex, header, ...parsed });
  }
  return result;
}

function parseHeaderAsParam(header: string): Omit<HeaderParam, "columnIndex" | "header"> | null {
  const text = header.normalize("NFC").trim();
  if (!text || text.length > 45) return null;

  const efficacyMatch = text.match(/^(\d+(?:\.\d+)?)\s*lm\s*\/\s*w/i);
  if (efficacyMatch) {
    return {
      paramKey: "luminous_efficacy",
      rawValue: text,
      normalizedValue: efficacyMatch[1],
      unit: "lm/W",
    };
  }

  const wattsMatch = text.match(/^(\d+(?:\.\d+)?)\s*W\b/i);
  if (wattsMatch && !isBusinessHeader(text)) {
    return { paramKey: "watts", rawValue: text, normalizedValue: wattsMatch[1], unit: "W" };
  }

  if (isBusinessHeader(text)) return null;

  const voltageMatch = text.match(/^(\d+)\s*[-~–]\s*(\d+)\s*V$/i);
  if (voltageMatch) {
    return {
      paramKey: "voltage",
      rawValue: text,
      normalizedValue: `${voltageMatch[1]}-${voltageMatch[2]}`,
      unit: "V",
    };
  }

  const cctMatch = text.match(/^(\d+)\s*[-~–]\s*(\d+)\s*K$/i);
  if (cctMatch) {
    const n1 = Number.parseInt(cctMatch[1], 10);
    const n2 = Number.parseInt(cctMatch[2], 10);
    if (n1 >= 1800 && n2 <= 10000) {
      return { paramKey: "cct", rawValue: text, normalizedValue: `${n1}-${n2}`, unit: "K" };
    }
  }

  const ipMatch = text.match(/^IP\s*(\d{2})$/i);
  if (ipMatch) return { paramKey: "ip", rawValue: text, normalizedValue: ipMatch[1], unit: null };

  const criPfMatch = text.match(/^[>≥＞]\s*(\d+(?:\.\d+)?)$/);
  if (criPfMatch) {
    const value = Number.parseFloat(criPfMatch[1]);
    if (value >= 60 && value <= 100) {
      return { paramKey: "cri", rawValue: text, normalizedValue: String(value), unit: null };
    }
    if (value > 0 && value <= 1) {
      return { paramKey: "pf", rawValue: text, normalizedValue: String(value), unit: null };
    }
  }

  return null;
}

function isBusinessHeader(header: string): boolean {
  return /含税|不含税|价格|报价|price|rmb|cny|出厂|成本|单价|moq|装箱|外箱|carton|packing|package|图片|photo|picture|序号|no\./i.test(
    header,
  );
}

function matchProduct(excelModelValue: string, products: LinkedProduct[]): LinkedProduct | null {
  const normalizedExcel = normalizeForMatch(excelModelValue);
  if (!normalizedExcel) return null;

  const exactModelMatches = products.filter((product) => normalizeForMatch(product.modelNo ?? "") === normalizedExcel);
  const exact = chooseUniqueByScore(exactModelMatches, normalizedExcel);
  if (exact) return exact;

  const containMatches = products.filter((product) => {
    const model = normalizeForMatch(product.modelNo ?? "");
    const name = normalizeForMatch(product.productName);
    return (
      (model.length >= 2 && (normalizedExcel.includes(model) || model.includes(normalizedExcel))) ||
      (name.length >= 2 && (normalizedExcel.includes(name) || name.includes(normalizedExcel)))
    );
  });
  return chooseUniqueByScore(containMatches, normalizedExcel);
}

function chooseUniqueByScore(products: LinkedProduct[], excelValue: string): LinkedProduct | null {
  if (products.length === 0) return null;
  const scored = products
    .map((product) => ({
      product,
      score: Math.max(commonScore(excelValue, normalizeForMatch(product.modelNo ?? "")), commonScore(excelValue, normalizeForMatch(product.productName))),
    }))
    .sort((a, b) => b.score - a.score || a.product.productId.localeCompare(b.product.productId));
  if (scored.length === 1 || scored[0].score > scored[1].score) return scored[0].product;
  return null;
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
        sourceField: "excel_header",
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

  return `# V10.6 列头参数值提取报告

模式: ${mode}
时间: ${new Date().toISOString()}

## 汇总

| 指标 | 数值 |
|---|---:|
| 扫描文件数 | ${fileResults.length.toLocaleString()} |
| 含列头参数的文件 | ${fileResults.filter((file) => file.headerParamColumns > 0).length.toLocaleString()} |
| 含列头参数的 Sheet | ${fileResults.reduce((sum, file) => sum + file.sheetsWithHeaderParams, 0).toLocaleString()} |
| 检测到的列头参数列 | ${fileResults.reduce((sum, file) => sum + file.headerParamColumns, 0).toLocaleString()} |
| 匹配产品行数 | ${fileResults.reduce((sum, file) => sum + file.matchedRows, 0).toLocaleString()} |
| 新增参数 | ${plannedParams.length.toLocaleString()} |
| 跳过（已存在） | ${fileResults.reduce((sum, file) => sum + file.existingParamsSkipped, 0).toLocaleString()} |
| 实际插入 | ${insertedParams.toLocaleString()} |
| product_params 变化 | ${productParamsBefore.toLocaleString()} → ${productParamsAfter.toLocaleString()} |

## 按 param_key 统计

| param_key | 新增记录数 | 覆盖新产品数 |
|---|---:|---:|
${paramStats.map((stat) => `| ${escapeMd(stat.paramKey)} | ${stat.newRecords.toLocaleString()} | ${stat.productIds.size.toLocaleString()} |`).join("\n")}

## 按品类统计

| 品类 | 含列头参数 Sheet 数 | 匹配行 | 新增参数 |
|---|---:|---:|---:|
${categoryStats
  .map((stat) => `| ${escapeMd(stat.category)} | ${stat.sheets.size.toLocaleString()} | ${stat.matchedRows.toLocaleString()} | ${stat.newParams.toLocaleString()} |`)
  .join("\n")}

## 列头参数采样（前 100 条）

| 文件名 | Sheet | 列头 | param_key | 值 | 匹配产品 |
|---|---|---|---|---|---|
${samples
  .map(
    (sample) =>
      `| ${escapeMd(sample.fileName)} | ${escapeMd(sample.sheetName)} | ${escapeMd(sample.header)} | ${escapeMd(sample.paramKey)} | ${escapeMd(sample.value)} | ${escapeMd(sample.matchedProduct)} |`,
  )
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
    const stat = byCategory.get(param.category) ?? { category: param.category, sheets: new Set<string>(), matchedRows: 0, newParams: 0 };
    stat.newParams += 1;
    stat.sheets.add(`${param.fileName}\u0000${param.sheetName}`);
    stat.matchedRows += 1;
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

function isUsefulCell(value: string): boolean {
  const normalized = value.trim();
  if (!normalized) return false;
  return !["-", "/", "\\", "n/a", "na", "null", "无"].includes(normalized.toLowerCase());
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
