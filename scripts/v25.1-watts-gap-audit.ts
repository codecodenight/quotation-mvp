import "dotenv/config";

import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { PrismaClient } from "@prisma/client";
import * as XLSX from "xlsx";

const REPORT_PATH = path.join("docs", "v25.1-watts-gap-audit-report.md");
const HEADER_SCAN_ROWS = 10;
const MIN_HEADER_CELLS = 3;
const SAMPLE_LIMIT = 50;

type Bucket = "RECOVERABLE" | "NO_WATTS_IN_SOURCE" | "UNMATCHABLE";
type MatchMethod = "exact" | "loose" | "file_no_watts_column";

type MissingProduct = {
  productId: string;
  productName: string;
  modelNo: string | null;
  category: string;
  sources: ProductSource[];
};

type MissingProductRow = {
  id: string;
  product_name: string;
  model_no: string | null;
  category: string | null;
};

type ProductSource = {
  sourceFileId: string;
  factoryName: string;
  purchasePrice: string;
  fileName: string;
  absolutePathSnapshot: string;
};

type SourceFile = {
  id: string;
  fileName: string;
  absolutePathSnapshot: string;
  products: MissingProduct[];
};

type HeaderInfo = {
  rowIndex: number;
  values: unknown[];
};

type WattsColumn = {
  index: number;
  header: string;
  kind: "direct" | "indirect";
};

type SheetAnalysis = {
  sheetName: string;
  rows: unknown[][];
  headerRowIndex: number | null;
  headerPreview: string;
  modelColumns: number[];
  wattsColumns: WattsColumn[];
};

type FileAnalysis = {
  fileId: string;
  fileName: string;
  absolutePathSnapshot: string;
  readable: boolean;
  readError: string | null;
  sheetsAnalyzed: number;
  hasWattsColumn: boolean;
  wattsColumnHeaders: string[];
  headerPreviews: string[];
  sheets: SheetAnalysis[];
};

type RowMatch = {
  sheetName: string;
  rowIndex: number;
  row: unknown[];
  wattsColumns: WattsColumn[];
  method: Exclude<MatchMethod, "file_no_watts_column">;
};

type ProductAudit = {
  product: MissingProduct;
  bucket: Bucket;
  sourceFile: string;
  sheetName: string | null;
  matchMethod: MatchMethod | null;
  extractedValue: string | null;
  failureReason: string;
};

type Summary = {
  missingWithSource: MissingProduct[];
  missingWithoutSourceCount: number;
  fileAnalyses: FileAnalysis[];
  audits: ProductAudit[];
};

const DIRECT_WATTS_HEADER_PATTERNS = [
  /^(?:watt|watts|wattage|power|actual\s*power|rated\s*power|rated\s*wattage|功率|实际功率|实测功率|额定功率|瓦数|w)$/i,
  /(?:^|[^a-z])w(?:$|[^a-z])/i,
];

const INDIRECT_WATTS_HEADER_PATTERNS = [
  /光源/i,
  /^lamp$/i,
  /lamp\s*(?:type|source)?/i,
  /规格/i,
  /\bspec(?:ification)?s?\b/i,
  /描述/i,
  /description/i,
];

const MODEL_HEADER_PATTERNS = [
  /item\s*no/i,
  /model/i,
  /型号/i,
  /产品型号/i,
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

const BUSINESS_HEADER_PATTERNS = [
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
  /图片/i,
  /picture/i,
  /photo/i,
  /备注/i,
  /remark/i,
];

async function main() {
  if (process.argv.includes("--apply")) {
    throw new Error("V25.1 is read-only and does not accept --apply.");
  }

  const prisma = new PrismaClient();
  try {
    const summary = await run(prisma);
    await mkdir(path.dirname(REPORT_PATH), { recursive: true });
    await writeFile(REPORT_PATH, buildReport(summary), "utf8");

    const counts = countBuckets(summary.audits);
    console.log(
      JSON.stringify(
        {
          mode: "read-only",
          reportPath: REPORT_PATH,
          missingWattsWithSource: summary.missingWithSource.length,
          missingWattsWithoutSource: summary.missingWithoutSourceCount,
          sourceFiles: summary.fileAnalyses.length,
          filesWithWattsColumn: summary.fileAnalyses.filter((file) => file.hasWattsColumn).length,
          filesWithoutWattsColumn: summary.fileAnalyses.filter((file) => file.readable && !file.hasWattsColumn).length,
          buckets: counts,
          recoverableByMatchMethod: countRecoverableByMethod(summary.audits),
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

async function run(prisma: PrismaClient): Promise<Summary> {
  const { missingWithSource, missingWithoutSourceCount } = await loadMissingProducts(prisma);
  const files = groupProductsBySourceFile(missingWithSource);
  const fileAnalyses: FileAnalysis[] = [];
  const analysisByFile = new Map<string, FileAnalysis>();

  for (const [index, file] of files.entries()) {
    if (index === 0 || (index + 1) % 25 === 0 || index + 1 === files.length) {
      console.log(`V25.1 watts gap audit ${index + 1}/${files.length}: ${file.fileName}`);
    }
    const analysis = analyzeFile(file);
    fileAnalyses.push(analysis);
    analysisByFile.set(file.id, analysis);
  }

  const audits = missingWithSource.map((product) => auditProduct(product, analysisByFile));
  return { missingWithSource, missingWithoutSourceCount, fileAnalyses, audits };
}

async function loadMissingProducts(prisma: PrismaClient): Promise<{ missingWithSource: MissingProduct[]; missingWithoutSourceCount: number }> {
  const missingProductRows = await prisma.$queryRaw<MissingProductRow[]>`
    SELECT p.id,
           p.product_name,
           p.model_no,
           p.category
    FROM products p
    LEFT JOIN product_params pp
      ON pp.product_id = p.id
     AND pp.param_key = 'watts'
    WHERE pp.id IS NULL
    ORDER BY p.category, p.product_name
  `;
  const missingById = new Map(
    missingProductRows.map((row) => [
      row.id,
      {
        productId: row.id,
        productName: row.product_name,
        modelNo: row.model_no,
        category: cleanCategory(row.category),
        sources: [],
      } satisfies MissingProduct,
    ]),
  );
  const products = new Map<string, MissingProduct>();
  const seenSources = new Set<string>();

  for (const chunk of chunks([...missingById.keys()], 900)) {
    const offerRows = await prisma.supplierOffer.findMany({
      where: { productId: { in: chunk }, sourceFileId: { not: null } },
      select: {
        productId: true,
        sourceFileId: true,
        factoryName: true,
        purchasePrice: true,
        sourceFile: { select: { fileName: true, absolutePathSnapshot: true } },
      },
      orderBy: [{ sourceFileId: "asc" }, { factoryName: "asc" }],
    });

    for (const row of offerRows) {
      if (!row.sourceFileId || !row.sourceFile) continue;
      const product = products.get(row.productId) ?? missingById.get(row.productId);
      if (!product) continue;
      const sourceKey = `${row.productId}\u0000${row.sourceFileId}\u0000${row.factoryName}\u0000${row.purchasePrice.toString()}`;
      if (!seenSources.has(sourceKey)) {
        product.sources.push({
          sourceFileId: row.sourceFileId,
          factoryName: row.factoryName,
          purchasePrice: row.purchasePrice.toString(),
          fileName: row.sourceFile.fileName,
          absolutePathSnapshot: row.sourceFile.absolutePathSnapshot,
        });
        seenSources.add(sourceKey);
      }
      products.set(row.productId, product);
    }
  }

  return {
    missingWithSource: [...products.values()],
    missingWithoutSourceCount: missingProductRows.length - products.size,
  };
}

function groupProductsBySourceFile(products: MissingProduct[]): SourceFile[] {
  const files = new Map<string, SourceFile>();
  const productSeenByFile = new Set<string>();
  for (const product of products) {
    for (const source of product.sources) {
      const file =
        files.get(source.sourceFileId) ??
        ({
          id: source.sourceFileId,
          fileName: source.fileName,
          absolutePathSnapshot: source.absolutePathSnapshot,
          products: [],
        } satisfies SourceFile);
      const key = `${source.sourceFileId}\u0000${product.productId}`;
      if (!productSeenByFile.has(key)) {
        file.products.push(product);
        productSeenByFile.add(key);
      }
      files.set(source.sourceFileId, file);
    }
  }
  return [...files.values()].sort((left, right) => left.fileName.localeCompare(right.fileName));
}

function analyzeFile(file: SourceFile): FileAnalysis {
  const analysis: FileAnalysis = {
    fileId: file.id,
    fileName: file.fileName,
    absolutePathSnapshot: file.absolutePathSnapshot,
    readable: false,
    readError: null,
    sheetsAnalyzed: 0,
    hasWattsColumn: false,
    wattsColumnHeaders: [],
    headerPreviews: [],
    sheets: [],
  };

  if (!existsSync(file.absolutePathSnapshot)) {
    analysis.readError = "source path missing";
    return analysis;
  }

  try {
    const workbook = XLSX.readFile(file.absolutePathSnapshot, { cellDates: false });
    analysis.readable = true;

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet?.["!ref"]) continue;
      const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: false });
      if (rows.length === 0) continue;

      const header = detectHeaderRow(rows);
      const headerValues = header?.values ?? [];
      const wattsColumns = findWattsColumns(headerValues);
      const modelColumns = findModelColumns(headerValues);
      const headerPreview = headerValues.map((cell) => cellToString(cell)).filter(Boolean).slice(0, 12).join(" / ");

      analysis.sheetsAnalyzed += 1;
      if (headerPreview) analysis.headerPreviews.push(headerPreview);
      for (const column of wattsColumns) analysis.wattsColumnHeaders.push(column.header);
      analysis.sheets.push({
        sheetName,
        rows,
        headerRowIndex: header?.rowIndex ?? null,
        headerPreview,
        modelColumns,
        wattsColumns,
      });
    }
    analysis.wattsColumnHeaders = [...new Set(analysis.wattsColumnHeaders)].sort((left, right) => left.localeCompare(right));
    analysis.hasWattsColumn = analysis.wattsColumnHeaders.length > 0;
    analysis.headerPreviews = [...new Set(analysis.headerPreviews)].slice(0, 3);
  } catch (error) {
    analysis.readError = error instanceof Error ? error.message : String(error);
  }

  return analysis;
}

function detectHeaderRow(rows: unknown[][]): HeaderInfo | null {
  let fallback: HeaderInfo | null = null;
  for (let rowIndex = 0; rowIndex < Math.min(rows.length, HEADER_SCAN_ROWS); rowIndex += 1) {
    const values = rows[rowIndex] ?? [];
    const nonEmptyCount = values.filter((cell) => cellToString(cell)).length;
    if (nonEmptyCount < MIN_HEADER_CELLS) continue;
    if (!fallback) fallback = { rowIndex, values };
    if (values.some((cell) => isModelHeader(cellToString(cell)) || isWattsHeader(cellToString(cell)))) {
      return { rowIndex, values };
    }
  }
  return fallback;
}

function findWattsColumns(headerValues: unknown[]): WattsColumn[] {
  const columns: WattsColumn[] = [];
  for (const [index, value] of headerValues.entries()) {
    const header = cellToString(value);
    const normalized = normalizeHeader(header);
    if (!normalized || isBusinessHeader(normalized)) continue;
    if (DIRECT_WATTS_HEADER_PATTERNS.some((pattern) => pattern.test(normalized))) {
      columns.push({ index, header, kind: "direct" });
      continue;
    }
    if (INDIRECT_WATTS_HEADER_PATTERNS.some((pattern) => pattern.test(normalized))) {
      columns.push({ index, header, kind: "indirect" });
    }
  }
  return columns;
}

function findModelColumns(headerValues: unknown[]): number[] {
  const direct: number[] = [];
  for (const [index, value] of headerValues.entries()) {
    if (isModelHeader(cellToString(value))) direct.push(index);
  }
  if (direct.length > 0) return direct;

  const fallback: number[] = [];
  for (const [index, value] of headerValues.entries()) {
    const normalized = normalizeHeader(cellToString(value));
    if (!normalized || isBusinessHeader(normalized) || isWattsHeader(normalized)) continue;
    fallback.push(index);
    if (fallback.length >= 4) break;
  }
  return fallback;
}

function auditProduct(product: MissingProduct, analysisByFile: Map<string, FileAnalysis>): ProductAudit {
  const analyses = product.sources.map((source) => analysisByFile.get(source.sourceFileId)).filter((analysis): analysis is FileAnalysis => Boolean(analysis));
  const readableAnalyses = analyses.filter((analysis) => analysis.readable);
  if (readableAnalyses.length === 0) {
    return buildAudit(product, "UNMATCHABLE", firstSourceFileName(product), null, null, null, "source file unreadable or missing");
  }

  const noWattsFiles = readableAnalyses.filter((analysis) => !analysis.hasWattsColumn);
  const recoverableMatches: Array<{ analysis: FileAnalysis; match: RowMatch; extracted: string }> = [];
  const matchedNoValue: Array<{ analysis: FileAnalysis; match: RowMatch }> = [];
  let ambiguousMatches = 0;

  for (const analysis of readableAnalyses.filter((item) => item.hasWattsColumn)) {
    const match = matchProductInFile(product, analysis);
    if (match.status === "ambiguous") {
      ambiguousMatches += 1;
      continue;
    }
    if (match.status !== "matched") continue;

    const extracted = extractWattsFromRow(match.match.row, match.match.wattsColumns);
    if (extracted) recoverableMatches.push({ analysis, match: match.match, extracted });
    else matchedNoValue.push({ analysis, match: match.match });
  }

  const exactRecoverable = recoverableMatches.find((item) => item.match.method === "exact");
  const chosenRecoverable = exactRecoverable ?? recoverableMatches[0];
  if (chosenRecoverable) {
    return buildAudit(
      product,
      "RECOVERABLE",
      chosenRecoverable.analysis.fileName,
      chosenRecoverable.match.sheetName,
      chosenRecoverable.match.method,
      chosenRecoverable.extracted,
      "",
    );
  }

  if (matchedNoValue.length > 0) {
    const chosen = matchedNoValue[0];
    return buildAudit(product, "NO_WATTS_IN_SOURCE", chosen.analysis.fileName, chosen.match.sheetName, chosen.match.method, null, "matched source row has no watts value");
  }

  if (noWattsFiles.length > 0) {
    return buildAudit(product, "NO_WATTS_IN_SOURCE", noWattsFiles[0].fileName, null, "file_no_watts_column", null, "source file has no recognizable watts column");
  }

  return buildAudit(
    product,
    "UNMATCHABLE",
    firstSourceFileName(product),
    null,
    null,
    null,
    ambiguousMatches > 0 ? "ambiguous row matches in source file" : "no matching source row found",
  );
}

function matchProductInFile(product: MissingProduct, analysis: FileAnalysis): { status: "matched"; match: RowMatch } | { status: "ambiguous" | "unmatched" } {
  const exactMatches: RowMatch[] = [];
  const looseMatches: RowMatch[] = [];

  for (const sheet of analysis.sheets) {
    if (sheet.headerRowIndex == null || sheet.modelColumns.length === 0 || sheet.wattsColumns.length === 0) continue;
    for (let rowIndex = sheet.headerRowIndex + 1; rowIndex < sheet.rows.length; rowIndex += 1) {
      const row = sheet.rows[rowIndex] ?? [];
      if (isBlankRow(row)) continue;
      const identityCells = sheet.modelColumns.map((columnIndex) => cellToString(row[columnIndex])).filter(Boolean);
      if (identityCells.length === 0) continue;
      if (identityCells.some((cell) => isExactProductMatch(product, cell))) {
        exactMatches.push({ sheetName: sheet.sheetName, rowIndex, row, wattsColumns: sheet.wattsColumns, method: "exact" });
        continue;
      }
      if (identityCells.some((cell) => isLooseProductMatch(product, cell))) {
        looseMatches.push({ sheetName: sheet.sheetName, rowIndex, row, wattsColumns: sheet.wattsColumns, method: "loose" });
      }
    }
  }

  const exact = chooseUniqueRowMatch(exactMatches);
  if (exact.status === "matched") return exact;
  if (exact.status === "ambiguous") return exact;
  return chooseUniqueRowMatch(looseMatches);
}

function chooseUniqueRowMatch(matches: RowMatch[]): { status: "matched"; match: RowMatch } | { status: "ambiguous" | "unmatched" } {
  if (matches.length === 0) return { status: "unmatched" };
  const unique = new Map<string, RowMatch>();
  for (const match of matches) unique.set(`${match.sheetName}\u0000${match.rowIndex}`, match);
  if (unique.size === 1) return { status: "matched", match: [...unique.values()][0] };
  return { status: "ambiguous" };
}

function extractWattsFromRow(row: unknown[], columns: WattsColumn[]): string | null {
  for (const column of columns) {
    const raw = cellToString(row[column.index]);
    if (!raw) continue;
    const extracted = column.kind === "direct" ? extractDirectWatts(raw) : extractIndirectWatts(raw);
    if (extracted) return extracted;
  }
  return null;
}

function extractDirectWatts(value: string): string | null {
  const indirect = extractIndirectWatts(value);
  if (indirect) return indirect;
  const number = value.replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  if (!number) return null;
  return `${number[0]}W`;
}

function extractIndirectWatts(value: string): string | null {
  const multiplier = value.match(/(\d+(?:\.\d+)?)\s*[*xX×]\s*(\d+(?:\.\d+)?)\s*[Ww]\b/);
  if (multiplier) return `${multiplier[1]}*${multiplier[2]}W`;
  const match = value.match(/(\d+(?:\.\d+)?)\s*[Ww]\b/);
  return match ? `${match[1]}W` : null;
}

function buildAudit(
  product: MissingProduct,
  bucket: Bucket,
  sourceFile: string,
  sheetName: string | null,
  matchMethod: MatchMethod | null,
  extractedValue: string | null,
  failureReason: string,
): ProductAudit {
  return { product, bucket, sourceFile, sheetName, matchMethod, extractedValue, failureReason };
}

function buildReport(summary: Summary): string {
  const bucketCounts = countBuckets(summary.audits);
  const categoryRows = buildCategoryRows(summary.audits);
  const recoverableSamples = summary.audits.filter((audit) => audit.bucket === "RECOVERABLE").slice(0, SAMPLE_LIMIT);
  const noWattsFiles = buildNoWattsFileRows(summary.audits, summary.fileAnalyses);
  const unmatchableSamples = summary.audits.filter((audit) => audit.bucket === "UNMATCHABLE").slice(0, SAMPLE_LIMIT);
  const recoverableByMethod = countRecoverableByMethod(summary.audits);
  const readableFiles = summary.fileAnalyses.filter((file) => file.readable);
  const filesWithWattsColumn = readableFiles.filter((file) => file.hasWattsColumn);
  const filesWithoutWattsColumn = readableFiles.filter((file) => !file.hasWattsColumn);

  return `# V25.1 Watts 缺口回源审计报告

时间: ${new Date().toISOString()}
模式: read-only

## 总览
- 缺 watts 产品总数: ${formatInteger(summary.missingWithSource.length)}（有 source_file_id）
- 无 source_file_id 的缺 watts 产品: ${formatInteger(summary.missingWithoutSourceCount)}
- 源文件总数: ${formatInteger(summary.fileAnalyses.length)}
- 可读取源文件: ${formatInteger(readableFiles.length)}
- 有 watts 列的文件: ${formatInteger(filesWithWattsColumn.length)}
- 无 watts 列的文件: ${formatInteger(filesWithoutWattsColumn.length)}

## 三桶分类

| 桶 | 产品数 | 占比 |
|----|--------|------|
| RECOVERABLE | ${formatInteger(bucketCounts.RECOVERABLE)} | ${formatPercent(bucketCounts.RECOVERABLE, summary.missingWithSource.length)} |
| NO_WATTS_IN_SOURCE | ${formatInteger(bucketCounts.NO_WATTS_IN_SOURCE)} | ${formatPercent(bucketCounts.NO_WATTS_IN_SOURCE, summary.missingWithSource.length)} |
| UNMATCHABLE | ${formatInteger(bucketCounts.UNMATCHABLE)} | ${formatPercent(bucketCounts.UNMATCHABLE, summary.missingWithSource.length)} |

## 按品类拆分

| 品类 | 总缺 | RECOVERABLE | NO_WATTS | UNMATCHABLE |
|------|------|-------------|----------|-------------|
${categoryRows.join("\n")}

## RECOVERABLE 明细（前 50 个样本）

| 品类 | product_name | model_no | 源文件 | sheet | 匹配方式 | 提取值 |
|------|-------------|----------|--------|-------|---------|--------|
${recoverableSamples
  .map(
    (audit) =>
      `| ${md(audit.product.category)} | ${md(audit.product.productName)} | ${md(audit.product.modelNo ?? "-")} | ${md(audit.sourceFile)} | ${md(audit.sheetName ?? "-")} | ${md(audit.matchMethod ?? "-")} | ${md(audit.extractedValue ?? "-")} |`,
  )
  .join("\n")}

## NO_WATTS_IN_SOURCE 文件列表

| 文件名 | 缺 watts 产品数 | 品类 | 表头预览 |
|--------|-----------------|------|---------|
${noWattsFiles
  .slice(0, 100)
  .map((row) => `| ${md(row.fileName)} | ${formatInteger(row.count)} | ${md(row.categories.join(", "))} | ${md(row.headerPreview || "-")} |`)
  .join("\n")}

## UNMATCHABLE 样本（前 50 个）

| 品类 | product_name | model_no | 源文件 | 匹配失败原因 |
|------|-------------|----------|--------|-------------|
${unmatchableSamples
  .map(
    (audit) =>
      `| ${md(audit.product.category)} | ${md(audit.product.productName)} | ${md(audit.product.modelNo ?? "-")} | ${md(audit.sourceFile)} | ${md(audit.failureReason)} |`,
  )
  .join("\n")}

## 宽松匹配 vs 精确匹配统计

| 匹配方式 | RECOVERABLE 数 |
|---------|---------------|
| 精确匹配 | ${formatInteger(recoverableByMethod.exact)} |
| 宽松匹配 | ${formatInteger(recoverableByMethod.loose)} |

## 文件读取问题

| 文件名 | 路径 | 原因 |
|--------|------|------|
${summary.fileAnalyses
  .filter((file) => file.readError)
  .slice(0, 50)
  .map((file) => `| ${md(file.fileName)} | ${md(file.absolutePathSnapshot)} | ${md(file.readError ?? "-")} |`)
  .join("\n")}

## 结论与建议
${buildRecommendation(bucketCounts, summary.missingWithSource.length)}

## 说明
- 本报告只读数据库和源 Excel 文件，只写本 Markdown 报告。
- RECOVERABLE 表示同一 source_file_id 内能定位到唯一 Excel 行，且该行可提取 watts。
- NO_WATTS_IN_SOURCE 包含两种情况：源文件没有可识别 watts 列，或匹配到源行但该行 watts 为空。
- UNMATCHABLE 表示源文件存在 watts 列但无法唯一定位产品行，或源文件不可读。
- 读取库: xlsx ${XLSX.version}
`;
}

function buildCategoryRows(audits: ProductAudit[]): string[] {
  const rows = new Map<string, Record<Bucket, number> & { total: number }>();
  for (const audit of audits) {
    const row = rows.get(audit.product.category) ?? { total: 0, RECOVERABLE: 0, NO_WATTS_IN_SOURCE: 0, UNMATCHABLE: 0 };
    row.total += 1;
    row[audit.bucket] += 1;
    rows.set(audit.product.category, row);
  }
  return [...rows.entries()]
    .sort((left, right) => right[1].total - left[1].total || left[0].localeCompare(right[0]))
    .map(
      ([category, row]) =>
        `| ${md(category)} | ${formatInteger(row.total)} | ${formatInteger(row.RECOVERABLE)} | ${formatInteger(row.NO_WATTS_IN_SOURCE)} | ${formatInteger(row.UNMATCHABLE)} |`,
    );
}

function buildNoWattsFileRows(audits: ProductAudit[], fileAnalyses: FileAnalysis[]) {
  const fileMap = new Map(fileAnalyses.map((file) => [file.fileName, file]));
  const rows = new Map<string, { fileName: string; count: number; categories: Set<string>; headerPreview: string }>();
  for (const audit of audits) {
    if (audit.bucket !== "NO_WATTS_IN_SOURCE") continue;
    const row = rows.get(audit.sourceFile) ?? {
      fileName: audit.sourceFile,
      count: 0,
      categories: new Set<string>(),
      headerPreview: fileMap.get(audit.sourceFile)?.headerPreviews[0] ?? "",
    };
    row.count += 1;
    row.categories.add(audit.product.category);
    rows.set(audit.sourceFile, row);
  }
  return [...rows.values()]
    .map((row) => ({ ...row, categories: [...row.categories].sort((left, right) => left.localeCompare(right)) }))
    .sort((left, right) => right.count - left.count || left.fileName.localeCompare(right.fileName));
}

function buildRecommendation(counts: Record<Bucket, number>, total: number): string {
  const recoverablePct = total === 0 ? 0 : counts.RECOVERABLE / total;
  const noWattsPct = total === 0 ? 0 : counts.NO_WATTS_IN_SOURCE / total;
  if (counts.RECOVERABLE >= 300 || recoverablePct >= 0.1) {
    return [
      `- RECOVERABLE 为 ${formatInteger(counts.RECOVERABLE)}（${formatPercent(counts.RECOVERABLE, total)}），规模足够进入下一步只读复核 + apply 脚本设计。`,
      "- 下一步应优先处理 RECOVERABLE：保留唯一行匹配证据、提取值、源文件/sheet/行号，再单独做写入方案。",
      `- NO_WATTS_IN_SOURCE 为 ${formatInteger(counts.NO_WATTS_IN_SOURCE)}，这部分不应继续做泛化匹配，除非补充新的源数据。`,
    ].join("\n");
  }
  if (noWattsPct >= 0.6) {
    return [
      `- NO_WATTS_IN_SOURCE 占 ${formatPercent(counts.NO_WATTS_IN_SOURCE, total)}，主要缺口来自源文件本身没有功率字段。`,
      "- 下一步不建议继续全局模糊匹配，应按品类挑 RECOVERABLE 样本少量验证，剩余进入人工补数或新源文件补导。",
    ].join("\n");
  }
  return [
    `- RECOVERABLE 为 ${formatInteger(counts.RECOVERABLE)}，规模偏小。`,
    "- 下一步建议先审查 UNMATCHABLE 样本，判断是否需要更强的同文件匹配规则，而不是直接写 product_params。",
  ].join("\n");
}

function countBuckets(audits: ProductAudit[]): Record<Bucket, number> {
  return {
    RECOVERABLE: audits.filter((audit) => audit.bucket === "RECOVERABLE").length,
    NO_WATTS_IN_SOURCE: audits.filter((audit) => audit.bucket === "NO_WATTS_IN_SOURCE").length,
    UNMATCHABLE: audits.filter((audit) => audit.bucket === "UNMATCHABLE").length,
  };
}

function countRecoverableByMethod(audits: ProductAudit[]): Record<"exact" | "loose", number> {
  return {
    exact: audits.filter((audit) => audit.bucket === "RECOVERABLE" && audit.matchMethod === "exact").length,
    loose: audits.filter((audit) => audit.bucket === "RECOVERABLE" && audit.matchMethod === "loose").length,
  };
}

function isExactProductMatch(product: MissingProduct, excelValue: string): boolean {
  const excel = normalizeExact(excelValue);
  if (!excel) return false;
  return productIdentityValues(product, "exact").some((identity) => identity === excel);
}

function isLooseProductMatch(product: MissingProduct, excelValue: string): boolean {
  const excel = normalizeLoose(excelValue);
  if (!isUsefulLooseIdentity(excel)) return false;
  return productIdentityValues(product, "loose").some((identity) => isUsefulLooseIdentity(identity) && (excel.includes(identity) || identity.includes(excel)));
}

function productIdentityValues(product: MissingProduct, mode: "exact" | "loose"): string[] {
  const rawValues = [product.modelNo ?? "", product.productName, stripColorSuffix(product.productName)];
  const normalized = rawValues.map((value) => (mode === "exact" ? normalizeExact(value) : normalizeLoose(value))).filter(Boolean);
  return [...new Set(normalized)];
}

function isUsefulLooseIdentity(value: string): boolean {
  if (value.length < 4) return false;
  if (/^\d+(?:\.\d+)?$/.test(value)) return false;
  if (/^\d+(?:\.\d+)?w$/i.test(value)) return false;
  const generic = new Set(["led", "light", "lamp", "product", "quotation", "型号", "产品", "规格", "功率"]);
  return !generic.has(value);
}

function stripColorSuffix(value: string): string {
  return value.replace(/(?:白|黑|灰|银|金|哑白|哑黑|white|black|grey|gray|silver|gold)$/i, "").trim();
}

function normalizeExact(value: string): string {
  return value.normalize("NFC").toLowerCase().replace(/\s+/g, "").trim();
}

function normalizeLoose(value: string): string {
  return normalizeExact(value).replace(/[\-_/\\–—()（）.,，:：+]+/g, "");
}

function normalizeHeader(value: string): string {
  return value
    .normalize("NFC")
    .replace(/[\r\n]+/g, " ")
    .replace(/[（(][^）)]*[）)]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isModelHeader(value: string): boolean {
  const normalized = normalizeHeader(value);
  return Boolean(normalized && MODEL_HEADER_PATTERNS.some((pattern) => pattern.test(normalized)));
}

function isWattsHeader(value: string): boolean {
  const normalized = normalizeHeader(value);
  return Boolean(normalized && [...DIRECT_WATTS_HEADER_PATTERNS, ...INDIRECT_WATTS_HEADER_PATTERNS].some((pattern) => pattern.test(normalized)));
}

function isBusinessHeader(value: string): boolean {
  const normalized = normalizeHeader(value);
  return BUSINESS_HEADER_PATTERNS.some((pattern) => pattern.test(normalized));
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

function cleanCategory(value: string | null): string {
  const trimmed = value?.trim();
  return trimmed || "(未分类)";
}

function firstSourceFileName(product: MissingProduct): string {
  return product.sources[0]?.fileName ?? "-";
}

function formatInteger(value: number): string {
  return value.toLocaleString("en-US");
}

function formatPercent(numerator: number, denominator: number): string {
  if (denominator <= 0) return "0%";
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

function md(value: string | number | null | undefined): string {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size));
  return out;
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
