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
  extractCoreModel,
  findParamColumns,
  firstNumber,
  HEADER_SCAN_ROWS,
  INSERT_BATCH_SIZE,
  isBlankRow,
  isUsefulParamValue,
  matchProduct,
  normalizeForLooseMatch,
  normalizeParamValue,
  productParamKey,
  resolvePhysicalPath,
} from "./v11-shared";

const prisma = new PrismaClient();

const REPORT_PATH = path.join("docs", "v11.1-reverse-match-report.md");
const BACKUP_PATH = path.join("prisma", "dev.db.bak-v11.1");
const APPLY_MODE = process.argv.includes("--apply");

type TargetProduct = {
  productId: string;
  modelNo: string | null;
  productName: string;
  category: string | null;
  remark: string | null;
  sourceFileId: string;
  purchasePrice: number;
  factoryName: string;
  fileName: string;
  relativePath: string;
};

type TargetProductRow = {
  product_id: string;
  model_no: string | null;
  product_name: string;
  category: string | null;
  remark: string | null;
  source_file_id: string;
  purchase_price: unknown;
  factory_name: string;
  file_name: string;
  relative_path: string;
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
  matchStrategy: string;
  confidence: "high" | "medium";
  header: string;
  paramKey: string;
  rawValue: string;
  normalizedValue: string | null;
  unit: string | null;
};

type MatchSummary = {
  product: TargetProduct;
  matched: boolean;
  strategy: string;
  confidence: "high" | "medium" | null;
  fileName: string;
  sheetName: string | null;
  paramKeys: string[];
};

type FileResult = {
  fileId: string;
  fileName: string;
  relativePath: string;
  targetProducts: number;
  skippedProducts: number;
  scannedSheets: number;
  highMatches: number;
  mediumMatches: number;
  failedMatches: number;
  existingParamsSkipped: number;
  plannedParams: number;
  readError: string | null;
};

type ParamStats = {
  paramKey: string;
  newRecords: number;
  productIds: Set<string>;
};

type CategoryStats = {
  category: string;
  targetProducts: number;
  highMatches: number;
  mediumMatches: number;
  failedMatches: number;
  newParams: number;
};

async function main() {
  if (!existsSync(BACKUP_PATH)) {
    throw new Error(`Missing DB backup: ${BACKUP_PATH}`);
  }

  const productParamsBefore = await prisma.productParam.count();
  const targetProducts = await loadTargetProducts();
  const existingParamKeys = await loadExistingParamKeys([...new Set(targetProducts.map((product) => product.productId))]);
  const productsByFile = groupBy(targetProducts, (product) => product.sourceFileId);
  const plannedParams: PlannedParam[] = [];
  const fileResults: FileResult[] = [];
  const matchSummaries: MatchSummary[] = [];

  let fileIndex = 0;
  for (const [fileId, products] of productsByFile.entries()) {
    fileIndex += 1;
    if (fileIndex === 1 || fileIndex % 50 === 0 || fileIndex === productsByFile.size) {
      console.log(`V11.1 reverse scan ${fileIndex}/${productsByFile.size}: ${products[0]?.relativePath ?? fileId}`);
    }
    fileResults.push(scanFile(fileId, products, existingParamKeys, plannedParams, matchSummaries));
  }

  const insertedParams = APPLY_MODE ? await insertParams(plannedParams) : 0;
  const productParamsAfter = await prisma.productParam.count();
  await mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await writeFile(
    REPORT_PATH,
    buildReport({
      mode: APPLY_MODE ? "apply" : "dry-run",
      targetProducts,
      fileResults,
      plannedParams,
      matchSummaries,
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
        targetProducts: targetProducts.length,
        scannedFiles: fileResults.length,
        highMatches: fileResults.reduce((sum, file) => sum + file.highMatches, 0),
        mediumMatches: fileResults.reduce((sum, file) => sum + file.mediumMatches, 0),
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

async function loadTargetProducts(): Promise<TargetProduct[]> {
  const rows = await prisma.$queryRaw<TargetProductRow[]>`
    SELECT
      p.id AS product_id,
      p.model_no,
      p.product_name,
      p.category,
      p.remark,
      so.source_file_id,
      so.purchase_price,
      so.factory_name,
      f.file_name,
      f.relative_path
    FROM products p
    JOIN supplier_offers so ON so.product_id = p.id AND so.source_file_id IS NOT NULL
    JOIN files f ON f.id = so.source_file_id AND f.file_type = 'excel'
    WHERE NOT EXISTS (
      SELECT 1 FROM product_params pp
      WHERE pp.product_id = p.id
        AND pp.source_field IN ('excel_column', 'excel_multirow')
    )
    GROUP BY p.id, so.source_file_id
    ORDER BY f.relative_path, p.model_no, p.product_name
  `;

  return rows
    .map((row) => ({
      productId: row.product_id,
      modelNo: row.model_no,
      productName: row.product_name,
      category: row.category,
      remark: row.remark,
      sourceFileId: row.source_file_id,
      purchasePrice: Number(row.purchase_price),
      factoryName: row.factory_name,
      fileName: row.file_name,
      relativePath: row.relative_path,
    }))
    .filter((product) => !shouldSkipTarget(product));
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
  fileId: string,
  products: TargetProduct[],
  existingParamKeys: Set<string>,
  plannedParams: PlannedParam[],
  matchSummaries: MatchSummary[],
): FileResult {
  const first = products[0];
  const result: FileResult = {
    fileId,
    fileName: first?.fileName ?? "",
    relativePath: first?.relativePath ?? "",
    targetProducts: products.length,
    skippedProducts: 0,
    scannedSheets: 0,
    highMatches: 0,
    mediumMatches: 0,
    failedMatches: 0,
    existingParamsSkipped: 0,
    plannedParams: 0,
    readError: null,
  };
  if (!first) return result;

  const physicalPath = resolvePhysicalPath(first.relativePath);
  if (!existsSync(physicalPath)) {
    result.readError = "file missing";
    return result;
  }

  try {
    const workbook = XLSX.readFile(physicalPath, { cellDates: false });
    const unmatched = new Set(products.map((product) => product.productId));

    for (const sheetName of workbook.SheetNames) {
      if (unmatched.size === 0) break;
      const sheet = workbook.Sheets[sheetName];
      if (!sheet?.["!ref"]) continue;
      const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: false });
      const header = detectBestHeader(rows);
      const paramColumns = findParamColumns(header.headerValues, header.modelColIndex);
      if (paramColumns.length === 0) continue;
      result.scannedSheets += 1;
      const dataRows = rows.slice(header.dataStartRow);

      for (const product of products) {
        if (!unmatched.has(product.productId)) continue;
        const match = findProductRow(product, dataRows, header.modelColIndex);
        if (!match) continue;

        const row = dataRows[match.rowIndex] ?? [];
        const rowNumber = header.dataStartRow + match.rowIndex + 1;
        const before = plannedParams.length;
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
            sourceFileId: product.sourceFileId,
            fileName: product.fileName,
            sheetName,
            rowNumber,
            matchStrategy: match.strategy,
            confidence: match.confidence,
            header: column.header,
            paramKey: column.paramKey,
            rawValue,
            normalizedValue: normalized.normalizedValue,
            unit: normalized.unit,
          });
          existingParamKeys.add(key);
        }

        const added = plannedParams.length - before;
        if (added > 0 || match.confidence === "high") {
          unmatched.delete(product.productId);
          if (match.confidence === "high") result.highMatches += 1;
          else result.mediumMatches += 1;
          result.plannedParams += added;
          matchSummaries.push({
            product,
            matched: true,
            strategy: match.strategy,
            confidence: match.confidence,
            fileName: product.fileName,
            sheetName,
            paramKeys: [...new Set(plannedParams.slice(before).map((param) => param.paramKey))],
          });
        }
      }
    }

    for (const product of products) {
      if (!unmatched.has(product.productId)) continue;
      result.failedMatches += 1;
      matchSummaries.push({
        product,
        matched: false,
        strategy: "not matched",
        confidence: null,
        fileName: product.fileName,
        sheetName: null,
        paramKeys: [],
      });
    }
  } catch (error) {
    result.readError = error instanceof Error ? error.message : String(error);
  }

  return result;
}

function findProductRow(
  product: TargetProduct,
  dataRows: unknown[][],
  modelColIndex: number | null,
): { rowIndex: number; strategy: string; confidence: "high" | "medium" } | null {
  if (modelColIndex != null && product.modelNo) {
    const model = normalizeForLooseMatch(product.modelNo);
    const exactIndex = dataRows.findIndex((row) => normalizeForLooseMatch(cellToString(row[modelColIndex])) === model);
    if (exactIndex >= 0) return { rowIndex: exactIndex, strategy: "策略1: 精确 model_no", confidence: "high" };

    const partial = findUniqueRow(dataRows, (row) => {
      const cell = normalizeForLooseMatch(cellToString(row[modelColIndex]));
      return cell.length >= 3 && (model.includes(cell) || cell.includes(model));
    });
    if (partial != null) return { rowIndex: partial, strategy: "策略2: model_no 互包含", confidence: "high" };

    const core = product.modelNo ? extractCoreModel(product.modelNo) : null;
    if (core) {
      const coreNorm = normalizeForLooseMatch(core);
      const coreMatch = findUniqueRow(dataRows, (row) => {
        const cell = normalizeForLooseMatch(cellToString(row[modelColIndex]));
        return cell.length >= 3 && (coreNorm.includes(cell) || cell.includes(coreNorm));
      });
      if (coreMatch != null) return { rowIndex: coreMatch, strategy: "策略3: 核心 model 片段", confidence: "medium" };
    }
  }

  if (product.productName.length >= 4) {
    const name = normalizeForLooseMatch(product.productName);
    const nameMatch = findUniqueRow(dataRows, (row) =>
      row.some((cell) => {
        const cellNorm = normalizeForLooseMatch(cellToString(cell));
        return cellNorm.length >= 4 && cellNorm === name;
      }),
    );
    if (nameMatch != null) return { rowIndex: nameMatch, strategy: "策略4: product_name 精确", confidence: "medium" };
  }

  const loose = matchProduct(product.productName, [{ productId: product.productId, modelNo: product.modelNo, productName: product.productName, category: product.category }]);
  if (loose) {
    const nameBits = normalizeForLooseMatch(`${product.modelNo ?? ""}${product.productName}`);
    const rowMatch = findUniqueRow(dataRows, (row) => normalizeForLooseMatch(row.map(cellToString).join(" ")).includes(nameBits));
    if (rowMatch != null) return { rowIndex: rowMatch, strategy: "策略4b: row text contains product", confidence: "medium" };
  }

  return null;
}

function findUniqueRow(rows: unknown[][], predicate: (row: unknown[]) => boolean): number | null {
  const matches: number[] = [];
  for (const [index, row] of rows.entries()) {
    if (isBlankRow(row)) continue;
    if (predicate(row)) matches.push(index);
    if (matches.length > 1) return null;
  }
  return matches.length === 1 ? matches[0] : null;
}

function shouldSkipTarget(product: TargetProduct): boolean {
  if (product.category === "灯管") return true;
  if (/伟润.*铝材套件/i.test(`${product.fileName} ${product.relativePath}`)) return true;
  return isLikelyJunk(product);
}

function isLikelyJunk(product: TargetProduct): boolean {
  const name = product.productName.trim();
  if (/^US?\$[\d.]+$/i.test(name)) return true;
  if (/^\d+(?:pcs|sets?|pieces?|套|条)$/i.test(name)) return true;
  if (/^[NG]\.?\s*W\.?/i.test(name)) return true;
  if (/^\d+(?:\.\d+)?[*×x]\d+(?:\.\d+)?[*×x]\d+(?:\.\d+)?\s*cm$/i.test(name)) return true;
  if (/^包装方式|^外箱|^产品标贴/i.test(name)) return true;
  if (/^\d+'\s*(?:standard|high cube)?\s*dry$/i.test(name)) return true;
  if (/\b(?:standard dry|high cube dry|container)\b/i.test(name)) return true;
  return false;
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
        sourceField: "reverse_match",
        confidence: param.confidence,
      })),
    });
    inserted += result.count;
  }
  return inserted;
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }
  return groups;
}

function buildReport(input: {
  mode: "dry-run" | "apply";
  targetProducts: TargetProduct[];
  fileResults: FileResult[];
  plannedParams: PlannedParam[];
  matchSummaries: MatchSummary[];
  insertedParams: number;
  productParamsBefore: number;
  productParamsAfter: number;
}): string {
  const targetByCategory = countTargetByCategory(input.targetProducts);
  const paramStats = buildParamStats(input.plannedParams);
  const categoryStats = buildCategoryStats(input.plannedParams, input.matchSummaries, targetByCategory);
  const strategyStats = buildStrategyStats(input.matchSummaries);
  const highMatches = input.fileResults.reduce((sum, file) => sum + file.highMatches, 0);
  const mediumMatches = input.fileResults.reduce((sum, file) => sum + file.mediumMatches, 0);
  const failedMatches = input.fileResults.reduce((sum, file) => sum + file.failedMatches, 0);
  const skipped = input.fileResults.reduce((sum, file) => sum + file.skippedProducts, 0);
  const existingSkipped = input.fileResults.reduce((sum, file) => sum + file.existingParamsSkipped, 0);

  return `# V11.1 反向匹配回填报告

模式: ${input.mode}
时间: ${new Date().toISOString()}
备份: ${BACKUP_PATH}

## 汇总

| 指标 | 数值 |
|---|---:|
| 目标产品数（从未被正向回填匹配） | ${input.targetProducts.length.toLocaleString()} |
| 跳过（铝材套件/灯管/垃圾） | ${skipped.toLocaleString()} |
| 扫描文件数 | ${input.fileResults.length.toLocaleString()} |
| 匹配成功 - high confidence | ${highMatches.toLocaleString()} |
| 匹配成功 - medium confidence | ${mediumMatches.toLocaleString()} |
| 匹配失败 | ${failedMatches.toLocaleString()} |
| 新增参数 | ${input.plannedParams.length.toLocaleString()} |
| 跳过（已存在） | ${existingSkipped.toLocaleString()} |
| 实际插入 | ${input.insertedParams.toLocaleString()} |
| product_params 变化 | ${input.productParamsBefore.toLocaleString()} → ${input.productParamsAfter.toLocaleString()} |

## 按品类统计

| 品类 | 目标产品 | high匹配 | medium匹配 | 失败 | 新增参数 |
|---|---:|---:|---:|---:|---:|
${categoryStats
  .map(
    (stat) =>
      `| ${escapeMd(stat.category)} | ${stat.targetProducts.toLocaleString()} | ${stat.highMatches.toLocaleString()} | ${stat.mediumMatches.toLocaleString()} | ${stat.failedMatches.toLocaleString()} | ${stat.newParams.toLocaleString()} |`,
  )
  .join("\n")}

## 按匹配策略统计

| 策略 | 匹配数 | 占比 |
|---|---:|---:|
${strategyStats
  .map((stat) => `| ${escapeMd(stat.strategy)} | ${stat.count.toLocaleString()} | ${formatPercent(stat.count / Math.max(1, highMatches + mediumMatches))} |`)
  .join("\n")}

## 按 param_key 统计

| param_key | 新增记录 | 覆盖产品数 |
|---|---:|---:|
${paramStats.map((stat) => `| ${escapeMd(stat.paramKey)} | ${stat.newRecords.toLocaleString()} | ${stat.productIds.size.toLocaleString()} |`).join("\n")}

## 匹配采样（前 50 条）

| 品类 | model_no | 匹配策略 | confidence | 文件名 | 提取 param_key |
|---|---|---|---|---|---|
${input.matchSummaries
  .filter((summary) => summary.matched)
  .slice(0, 50)
  .map(
    (summary) =>
      `| ${escapeMd(summary.product.category ?? "(未分类)")} | ${escapeMd(summary.product.modelNo ?? "")} | ${escapeMd(summary.strategy)} | ${summary.confidence ?? "-"} | ${escapeMd(summary.fileName)} | ${escapeMd(summary.paramKeys.join(", ") || "-")} |`,
  )
  .join("\n")}

## 未匹配采样（前 30 条）

| 品类 | model_no | product_name(前50字) | 文件名 | 尝试的策略 |
|---|---|---|---|---|
${input.matchSummaries
  .filter((summary) => !summary.matched)
  .slice(0, 30)
  .map(
    (summary) =>
      `| ${escapeMd(summary.product.category ?? "(未分类)")} | ${escapeMd(summary.product.modelNo ?? "")} | ${escapeMd(summary.product.productName.slice(0, 50))} | ${escapeMd(summary.fileName)} | exact / partial / core / name |`,
  )
  .join("\n")}

## 读取失败文件

| 文件名 | 路径 | 原因 |
|---|---|---|
${input.fileResults
  .filter((file) => file.readError)
  .map((file) => `| ${escapeMd(file.fileName)} | ${escapeMd(file.relativePath)} | ${escapeMd(file.readError ?? "")} |`)
  .join("\n")}
`;
}

function countTargetByCategory(products: TargetProduct[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const product of products) {
    const category = product.category ?? "(未分类)";
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  return counts;
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

function buildCategoryStats(plannedParams: PlannedParam[], summaries: MatchSummary[], targetCounts: Map<string, number>): CategoryStats[] {
  const stats = new Map<string, CategoryStats>();
  for (const [category, count] of targetCounts.entries()) {
    stats.set(category, { category, targetProducts: count, highMatches: 0, mediumMatches: 0, failedMatches: 0, newParams: 0 });
  }
  for (const summary of summaries) {
    const category = summary.product.category ?? "(未分类)";
    const stat = stats.get(category) ?? { category, targetProducts: 0, highMatches: 0, mediumMatches: 0, failedMatches: 0, newParams: 0 };
    if (!summary.matched) stat.failedMatches += 1;
    else if (summary.confidence === "high") stat.highMatches += 1;
    else stat.mediumMatches += 1;
    stats.set(category, stat);
  }
  for (const param of plannedParams) {
    const stat = stats.get(param.category) ?? { category: param.category, targetProducts: 0, highMatches: 0, mediumMatches: 0, failedMatches: 0, newParams: 0 };
    stat.newParams += 1;
    stats.set(param.category, stat);
  }
  return [...stats.values()].sort((left, right) => right.newParams - left.newParams || right.targetProducts - left.targetProducts);
}

function buildStrategyStats(summaries: MatchSummary[]): Array<{ strategy: string; count: number }> {
  const counts = new Map<string, number>();
  for (const summary of summaries) {
    if (!summary.matched) continue;
    counts.set(summary.strategy, (counts.get(summary.strategy) ?? 0) + 1);
  }
  return [...counts.entries()].map(([strategy, count]) => ({ strategy, count })).sort((left, right) => right.count - left.count || left.strategy.localeCompare(right.strategy));
}

function formatPercent(value: number): string {
  return `${Math.round(value * 1000) / 10}%`;
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
