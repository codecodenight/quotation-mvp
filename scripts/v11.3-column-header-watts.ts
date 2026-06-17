import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { PrismaClient } from "@prisma/client";
import * as XLSX from "xlsx";

import {
  cellToString,
  detectBestHeader,
  escapeMd,
  INSERT_BATCH_SIZE,
  isBlankRow,
  matchProduct,
  normalizeForMatch,
  productParamKey,
  resolvePhysicalPath,
} from "./v11-shared";

const prisma = new PrismaClient();

const REPORT_PATH = path.join("docs", "v11.3-column-header-watts-report.md");
const BACKUP_PATH = path.join("prisma", "dev.db.bak-v11.3");
const APPLY_MODE = process.argv.includes("--apply");

type LinkedProductRow = {
  file_id: string;
  file_name: string;
  relative_path: string;
  product_id: string;
  model_no: string | null;
  product_name: string;
  category: string | null;
};

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

type ValueHeader = {
  colIndex: number;
  rawHeader: string;
  paramKey: string;
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
  rowNumber: number;
  header: string;
  paramKey: string;
  rawValue: string;
  normalizedValue: string | null;
  unit: string | null;
};

type FileResult = {
  fileName: string;
  relativePath: string;
  sheets: number;
  valueHeaderSheets: number;
  matchedRows: number;
  existingParamsSkipped: number;
  plannedParams: number;
  multiWattsConflicts: number;
  readError: string | null;
};

type HeaderStats = {
  rawHeader: string;
  paramKey: string;
  normalizedValue: string;
  fileKeys: Set<string>;
  matchedRows: number;
};

type MatchSample = {
  fileName: string;
  sheetName: string;
  productName: string;
  header: string;
  paramKey: string;
  value: string;
};

type ConflictSample = {
  fileName: string;
  productName: string;
  powerHeaders: string;
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

async function main() {
  if (!existsSync(BACKUP_PATH)) {
    throw new Error(`Missing DB backup: ${BACKUP_PATH}`);
  }

  const productParamsBefore = await prisma.productParam.count();
  const sourceFiles = await loadSourceFiles();
  const allProductIds = [...new Set(sourceFiles.flatMap((file) => file.products.map((product) => product.productId)))];
  const existingParamKeys = await loadExistingParamKeys(allProductIds);
  const plannedParams: PlannedParam[] = [];
  const fileResults: FileResult[] = [];
  const headerStats = new Map<string, HeaderStats>();
  const matchSamples: MatchSample[] = [];
  const conflictSamples: ConflictSample[] = [];

  for (const [index, file] of sourceFiles.entries()) {
    if (index === 0 || (index + 1) % 50 === 0 || index + 1 === sourceFiles.length) {
      console.log(`V11.3 value-header scan ${index + 1}/${sourceFiles.length}: ${file.relativePath}`);
    }
    fileResults.push(scanFile(file, existingParamKeys, plannedParams, headerStats, matchSamples, conflictSamples));
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
      headerStats,
      matchSamples,
      conflictSamples,
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
        files: sourceFiles.length,
        valueHeaderFiles: fileResults.filter((file) => file.valueHeaderSheets > 0).length,
        valueHeaderSheets: fileResults.reduce((sum, file) => sum + file.valueHeaderSheets, 0),
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

  const files = new Map<string, SourceFile>();
  for (const row of rows) {
    const file = files.get(row.file_id) ?? { id: row.file_id, fileName: row.file_name, relativePath: row.relative_path, products: [] };
    file.products.push({
      productId: row.product_id,
      modelNo: row.model_no,
      productName: row.product_name,
      category: row.category,
    });
    files.set(row.file_id, file);
  }
  return [...files.values()];
}

async function loadExistingParamKeys(productIds: string[]): Promise<Set<string>> {
  const existing = new Set<string>();
  for (let index = 0; index < productIds.length; index += 900) {
    const chunk = productIds.slice(index, index + 900);
    const rows = await prisma.productParam.findMany({ where: { productId: { in: chunk } }, select: { productId: true, paramKey: true } });
    for (const row of rows) existing.add(productParamKey(row.productId, row.paramKey));
  }
  return existing;
}

function scanFile(
  file: SourceFile,
  existingParamKeys: Set<string>,
  plannedParams: PlannedParam[],
  headerStats: Map<string, HeaderStats>,
  matchSamples: MatchSample[],
  conflictSamples: ConflictSample[],
): FileResult {
  const result: FileResult = {
    fileName: file.fileName,
    relativePath: file.relativePath,
    sheets: 0,
    valueHeaderSheets: 0,
    matchedRows: 0,
    existingParamsSkipped: 0,
    plannedParams: 0,
    multiWattsConflicts: 0,
    readError: null,
  };

  const physicalPath = resolvePhysicalPath(file.relativePath);
  if (!existsSync(physicalPath)) {
    result.readError = "file missing";
    return result;
  }

  try {
    const workbook = XLSX.readFile(physicalPath, { cellDates: false });
    result.sheets = workbook.SheetNames.length;
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet?.["!ref"]) continue;
      const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: false });
      const header = detectBestHeader(rows);
      if (header.modelColIndex == null) continue;
      const valueHeaders = detectValueHeaders(header.headerValues);
      if (valueHeaders.length < 2) continue;
      result.valueHeaderSheets += 1;

      const dataRows = rows.slice(header.dataStartRow);
      for (const [offset, row] of dataRows.entries()) {
        if (isBlankRow(row)) continue;
        const excelModel = cellToString(row[header.modelColIndex]);
        if (!excelModel) continue;
        const product = matchProduct(excelModel, file.products);
        if (!product) continue;

        const activeHeaders = valueHeaders.filter((valueHeader) => hasDataInColumn(row, valueHeader.colIndex));
        if (activeHeaders.length === 0) continue;
        const activeWatts = activeHeaders.filter((valueHeader) => valueHeader.paramKey === "watts");
        if (activeWatts.length > 1) {
          result.multiWattsConflicts += 1;
          if (conflictSamples.length < 50) {
            conflictSamples.push({
              fileName: file.fileName,
              productName: product.productName,
              powerHeaders: activeWatts.map((headerValue) => headerValue.rawHeader).join(", "),
            });
          }
        }

        let addedForRow = 0;
        for (const valueHeader of activeHeaders) {
          if (valueHeader.paramKey === "watts" && activeWatts.length > 1) continue;
          const key = productParamKey(product.productId, valueHeader.paramKey);
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
            rowNumber: header.dataStartRow + offset + 1,
            header: valueHeader.rawHeader,
            paramKey: valueHeader.paramKey,
            rawValue: valueHeader.rawHeader,
            normalizedValue: valueHeader.normalizedValue,
            unit: valueHeader.unit,
          });
          existingParamKeys.add(key);
          addedForRow += 1;
          addHeaderStat(headerStats, valueHeader, file.id, `${sheetName}\u0000${offset}`);
          if (matchSamples.length < 50) {
            matchSamples.push({
              fileName: file.fileName,
              sheetName,
              productName: product.productName,
              header: valueHeader.rawHeader,
              paramKey: valueHeader.paramKey,
              value: `${valueHeader.normalizedValue}${valueHeader.unit ?? ""}`,
            });
          }
        }
        if (addedForRow > 0) {
          result.matchedRows += 1;
          result.plannedParams += addedForRow;
        }
      }
    }
  } catch (error) {
    result.readError = error instanceof Error ? error.message : String(error);
  }

  return result;
}

function detectValueHeaders(headerValues: unknown[]): ValueHeader[] {
  const results: ValueHeader[] = [];
  for (const [index, value] of headerValues.entries()) {
    const raw = cellToString(value);
    if (!raw) continue;

    const wattsMatch = raw.match(/^(\d+(?:\.\d+)?)\s*[Ww](?:\s*±\s*\d+%)?$/);
    if (wattsMatch) {
      results.push({ colIndex: index, rawHeader: raw, paramKey: "watts", normalizedValue: wattsMatch[1], unit: "W" });
      continue;
    }

    const efficacyMatch = raw.match(/^(\d+(?:\.\d+)?)\s*(?:lm\/[Ww]|LM\/W)(?:\s*±\s*\d+%)?$/i);
    if (efficacyMatch) {
      results.push({ colIndex: index, rawHeader: raw, paramKey: "luminous_efficacy", normalizedValue: efficacyMatch[1], unit: "lm/W" });
      continue;
    }

    const criMatch = raw.match(/^(?:Ra\s*)?[>≥]\s*(\d{2})$/i);
    if (criMatch && Number(criMatch[1]) >= 60 && Number(criMatch[1]) <= 99) {
      results.push({ colIndex: index, rawHeader: raw, paramKey: "cri", normalizedValue: criMatch[1], unit: null });
      continue;
    }

    const pfMatch = raw.match(/^(?:PF\s*)?[>≥]\s*(0\.\d+)$/i);
    if (pfMatch) {
      results.push({ colIndex: index, rawHeader: raw, paramKey: "pf", normalizedValue: pfMatch[1], unit: null });
      continue;
    }

    const ipMatch = raw.match(/^IP\s*(\d{2})$/i);
    if (ipMatch) {
      results.push({ colIndex: index, rawHeader: raw, paramKey: "ip", normalizedValue: ipMatch[1], unit: null });
      continue;
    }

    const voltageMatch = raw.match(/^(?:AC\s*)?(\d+)\s*(?:[-~–]\s*(\d+)\s*)?V$/i);
    if (voltageMatch) {
      const normalized = voltageMatch[2] ? `${voltageMatch[1]}-${voltageMatch[2]}` : voltageMatch[1];
      results.push({ colIndex: index, rawHeader: raw, paramKey: "voltage", normalizedValue: normalized, unit: "V" });
      continue;
    }

    const cctMatch = raw.match(/^(\d{4})\s*(?:[-~–]\s*(\d{4})\s*)?[Kk]$/);
    if (cctMatch) {
      const first = Number(cctMatch[1]);
      const second = cctMatch[2] ? Number(cctMatch[2]) : null;
      if (first >= 1800 && first <= 10000 && (second == null || (second >= 1800 && second <= 10000))) {
        const normalized = cctMatch[2] ? `${cctMatch[1]}-${cctMatch[2]}` : cctMatch[1];
        results.push({ colIndex: index, rawHeader: raw, paramKey: "cct", normalizedValue: normalized, unit: "K" });
      }
    }
  }
  return results;
}

function hasDataInColumn(row: unknown[], colIndex: number): boolean {
  const value = cellToString(row[colIndex]);
  if (!value) return false;
  return !["-", "/", "\\", "n/a", "na", "无"].includes(normalizeForMatch(value));
}

function addHeaderStat(stats: Map<string, HeaderStats>, valueHeader: ValueHeader, fileId: string, rowKey: string) {
  const key = `${valueHeader.paramKey}\u0000${valueHeader.normalizedValue}\u0000${valueHeader.rawHeader}`;
  const stat = stats.get(key) ?? {
    rawHeader: valueHeader.rawHeader,
    paramKey: valueHeader.paramKey,
    normalizedValue: valueHeader.normalizedValue,
    fileKeys: new Set<string>(),
    matchedRows: 0,
  };
  stat.fileKeys.add(fileId);
  stat.matchedRows += rowKey ? 1 : 0;
  stats.set(key, stat);
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
        sourceField: "column_header_value",
        confidence: "high",
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
  headerStats: Map<string, HeaderStats>;
  matchSamples: MatchSample[];
  conflictSamples: ConflictSample[];
  insertedParams: number;
  productParamsBefore: number;
  productParamsAfter: number;
}): string {
  const paramStats = buildParamStats(input.plannedParams);
  const categoryStats = buildCategoryStats(input.plannedParams);
  const valueHeaderFiles = input.fileResults.filter((file) => file.valueHeaderSheets > 0).length;
  const valueHeaderSheets = input.fileResults.reduce((sum, file) => sum + file.valueHeaderSheets, 0);
  const matchedRows = input.fileResults.reduce((sum, file) => sum + file.matchedRows, 0);
  const existingSkipped = input.fileResults.reduce((sum, file) => sum + file.existingParamsSkipped, 0);
  const conflicts = input.fileResults.reduce((sum, file) => sum + file.multiWattsConflicts, 0);

  return `# V11.3 列头即数值模式参数提取报告

模式: ${input.mode}
时间: ${new Date().toISOString()}
备份: ${BACKUP_PATH}

## 汇总

| 指标 | 数值 |
|---|---:|
| 扫描文件数 | ${input.fileResults.length.toLocaleString()} |
| 含数值列头的文件 | ${valueHeaderFiles.toLocaleString()} |
| 含数值列头的 sheet | ${valueHeaderSheets.toLocaleString()} |
| 匹配产品行数 | ${matchedRows.toLocaleString()} |
| 新增参数 | ${input.plannedParams.length.toLocaleString()} |
| 跳过（已存在） | ${existingSkipped.toLocaleString()} |
| 跳过（多功率冲突） | ${conflicts.toLocaleString()} |
| 实际插入 | ${input.insertedParams.toLocaleString()} |
| product_params 变化 | ${input.productParamsBefore.toLocaleString()} → ${input.productParamsAfter.toLocaleString()} |

## 按 param_key 统计

| param_key | 新增记录 | 覆盖产品数 |
|---|---:|---:|
${paramStats.map((stat) => `| ${escapeMd(stat.paramKey)} | ${stat.newRecords.toLocaleString()} | ${stat.productIds.size.toLocaleString()} |`).join("\n")}

## 检测到的数值列头

| 列头原文 | 解析为 param_key | 归一化值 | 出现文件数 | 匹配产品行数 |
|---|---|---|---:|---:|
${[...input.headerStats.values()]
  .sort((left, right) => right.matchedRows - left.matchedRows || left.rawHeader.localeCompare(right.rawHeader))
  .slice(0, 100)
  .map((stat) => `| ${escapeMd(stat.rawHeader)} | ${escapeMd(stat.paramKey)} | ${escapeMd(stat.normalizedValue)} | ${stat.fileKeys.size.toLocaleString()} | ${stat.matchedRows.toLocaleString()} |`)
  .join("\n")}

## 按品类统计

| 品类 | 含数值列头 sheet | 匹配行 | 新增参数 |
|---|---:|---:|---:|
${categoryStats
  .map((stat) => `| ${escapeMd(stat.category)} | ${stat.sheetKeys.size.toLocaleString()} | ${stat.matchedRows.toLocaleString()} | ${stat.newParams.toLocaleString()} |`)
  .join("\n")}

## 匹配采样（前 50 条）

| 文件名 | Sheet | 产品 | 列头 | param_key | 值 |
|---|---|---|---|---|---|
${input.matchSamples
  .slice(0, 50)
  .map((sample) => `| ${escapeMd(sample.fileName)} | ${escapeMd(sample.sheetName)} | ${escapeMd(sample.productName)} | ${escapeMd(sample.header)} | ${escapeMd(sample.paramKey)} | ${escapeMd(sample.value)} |`)
  .join("\n")}

## 多功率冲突采样

| 文件名 | 产品 | 有数据的功率列 |
|---|---|---|
${input.conflictSamples
  .slice(0, 50)
  .map((sample) => `| ${escapeMd(sample.fileName)} | ${escapeMd(sample.productName)} | ${escapeMd(sample.powerHeaders)} |`)
  .join("\n")}

## 读取失败文件

| 文件名 | 原因 |
|---|---|
${input.fileResults
  .filter((file) => file.readError)
  .map((file) => `| ${escapeMd(file.fileName)} | ${escapeMd(file.readError ?? "")} |`)
  .join("\n")}
`;
}

function buildParamStats(plannedParams: PlannedParam[]): ParamStats[] {
  const stats = new Map<string, ParamStats>();
  for (const param of plannedParams) {
    const stat = stats.get(param.paramKey) ?? { paramKey: param.paramKey, newRecords: 0, productIds: new Set<string>() };
    stat.newRecords += 1;
    stat.productIds.add(param.productId);
    stats.set(param.paramKey, stat);
  }
  return [...stats.values()].sort((left, right) => right.newRecords - left.newRecords || left.paramKey.localeCompare(right.paramKey));
}

function buildCategoryStats(plannedParams: PlannedParam[]): CategoryStats[] {
  const stats = new Map<string, CategoryStats>();
  const rowKeys = new Map<string, Set<string>>();
  for (const param of plannedParams) {
    const stat = stats.get(param.category) ?? { category: param.category, sheetKeys: new Set<string>(), matchedRows: 0, newParams: 0 };
    stat.sheetKeys.add(`${param.fileName}\u0000${param.sheetName}`);
    stat.newParams += 1;
    stats.set(param.category, stat);
    const rows = rowKeys.get(param.category) ?? new Set<string>();
    rows.add(`${param.fileName}\u0000${param.sheetName}\u0000${param.rowNumber}\u0000${param.productId}`);
    rowKeys.set(param.category, rows);
  }
  for (const [category, rows] of rowKeys.entries()) {
    const stat = stats.get(category);
    if (stat) stat.matchedRows = rows.size;
  }
  return [...stats.values()].sort((left, right) => right.newParams - left.newParams || left.category.localeCompare(right.category));
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
