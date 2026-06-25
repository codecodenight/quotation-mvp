import "dotenv/config";

import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { PrismaClient } from "@prisma/client";

import {
  analyzeFiles,
  auditProduct,
  backupDatabase,
  cellToString,
  chunks,
  extractWattsFromRow,
  formatInteger,
  formatPercent,
  groupProductsBySourceFile,
  INSERT_BATCH_SIZE,
  loadMissingProducts,
  md,
  type FileAnalysis,
  type MissingProduct,
  type RowMatch,
  type WattsExtraction,
} from "./v25-watts-shared";

const REPORT_PATH = path.join("docs", "v26.0-magnetic-track-matching-report.md");
const SOURCE_FIELD = "v26.0_magnetic_matching";

type Mode = "dry-run" | "apply";

type MatchStatus = "matched" | "no_match" | "ambiguous" | "no_watts";

type PlannedParam = {
  id: string;
  productId: string;
  category: string;
  productName: string;
  modelNo: string | null;
  rawValue: string;
  normalizedValue: string;
  sourceFile: string;
  sheetName: string;
  rowNumber: number;
};

type TargetResult = {
  product: MissingProduct;
  sourceFile: string;
  status: MatchStatus;
  match: RowMatch | null;
  extracted: WattsExtraction | null;
};

type FileStat = {
  fileName: string;
  target: number;
  matched: number;
  withWatts: number;
  noMatch: number;
  ambiguous: number;
};

type Coverage = {
  totalProducts: number;
  wattsCovered: number;
  productParams: number;
};

type Summary = {
  mode: Mode;
  backupPath: string | null;
  diagnostics: DiagnosticRow[];
  targetResults: TargetResult[];
  plannedParams: PlannedParam[];
  inserted: number;
  before: Coverage;
  after: Coverage;
};

type DiagnosticRow = {
  fileName: string;
  excelSamples: string[];
  dbSamples: string[];
  pattern: string;
};

async function main() {
  const mode: Mode = process.argv.includes("--apply") ? "apply" : "dry-run";
  if (process.argv.includes("--dry-run") && process.argv.includes("--apply")) throw new Error("Use either --dry-run or --apply, not both.");

  const prisma = new PrismaClient();
  try {
    const summary = await run(prisma, mode);
    await mkdir(path.dirname(REPORT_PATH), { recursive: true });
    await writeFile(REPORT_PATH, buildReport(summary), "utf8");
    console.log(
      JSON.stringify(
        {
          mode,
          reportPath: REPORT_PATH,
          backupPath: summary.backupPath,
          targetProducts: summary.targetResults.length,
          normalizedMatched: summary.targetResults.filter((row) => row.status !== "no_match").length,
          withWatts: summary.plannedParams.length,
          inserted: summary.inserted,
          productParamsBefore: summary.before.productParams,
          productParamsAfter: summary.after.productParams,
          wattsBefore: summary.before.wattsCovered,
          wattsAfter: summary.after.wattsCovered,
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

async function run(prisma: PrismaClient, mode: Mode): Promise<Summary> {
  console.log("V26.0 load coverage");
  const before = await loadCoverage(prisma);
  console.log("V26.0 load missing products");
  const { missingWithSource } = await loadMissingProducts(prisma);
  const magneticProducts = missingWithSource.filter((product) => product.category === "磁吸灯");
  const files = groupProductsBySourceFile(magneticProducts);
  console.log(`V26.0 analyze ${files.length} magnetic source files`);
  const analysisByFile = analyzeFiles(files, "V26.0 magnetic scan");
  console.log("V26.0 classify strict unmatchable targets");
  const targets = magneticProducts.filter((product) => {
    const audit = auditProduct(product, analysisByFile, "base");
    return audit.bucket === "UNMATCHABLE" && audit.failureReason === "no matching source row found";
  });
  console.log(`V26.0 normalized matching ${targets.length} targets`);
  const targetResults = targets.map((product) => matchMagneticProduct(product, analysisByFile));
  const plannedParams = targetResults
    .filter((result) => result.status === "matched" && result.extracted && result.match)
    .map((result) => ({
      id: randomUUID(),
      productId: result.product.productId,
      category: result.product.category,
      productName: result.product.productName,
      modelNo: result.product.modelNo,
      rawValue: result.extracted!.rawValue,
      normalizedValue: result.extracted!.normalizedValue,
      sourceFile: result.sourceFile,
      sheetName: result.match!.sheetName,
      rowNumber: result.match!.rowIndex + 1,
    }));

  const backupPath = mode === "apply" ? await backupDatabase("v26.0") : null;
  const inserted = mode === "apply" ? await insertParams(prisma, plannedParams) : 0;
  const after = mode === "apply" ? await loadCoverage(prisma) : projectCoverage(before, plannedParams.length);
  return { mode, backupPath, diagnostics: buildDiagnostics(files, analysisByFile), targetResults, plannedParams, inserted, before, after };
}

function matchMagneticProduct(product: MissingProduct, analysisByFile: Map<string, FileAnalysis>): TargetResult {
  const productKeys = identityKeys(product).map(normalizeMagnetic).filter(isUsefulKey);
  const matches: Array<{ analysis: FileAnalysis; match: RowMatch }> = [];

  for (const source of product.sources) {
    const analysis = analysisByFile.get(source.sourceFileId);
    if (!analysis?.readable || !analysis.hasWattsColumn) continue;
    for (const sheet of analysis.sheets) {
      if (sheet.headerRowIndex == null || sheet.modelColumns.length === 0 || sheet.wattsColumns.length === 0) continue;
      for (let rowIndex = sheet.headerRowIndex + 1; rowIndex < sheet.rows.length; rowIndex += 1) {
        const row = sheet.rows[rowIndex] ?? [];
        const identityValues = sheet.modelColumns.map((columnIndex) => cellToString(row[columnIndex])).filter(Boolean);
        if (identityValues.length === 0) continue;
        const rowValues = row.map((cell) => cellToString(cell)).filter(Boolean);
        const excelKeys = [...new Set([...identityValues, ...rowValues].map(normalizeMagnetic).filter(isUsefulKey))];
        if (excelKeys.some((excelKey) => productKeys.includes(excelKey))) {
          matches.push({
            analysis,
            match: { sheetName: sheet.sheetName, rowIndex, row, identityValues, wattsColumns: sheet.wattsColumns, method: "loose" },
          });
        }
      }
    }
  }

  const unique = dedupeMatches(matches);
  if (unique.length === 0) return { product, sourceFile: firstSourceFile(product), status: "no_match", match: null, extracted: null };
  if (unique.length > 1) return { product, sourceFile: unique[0].analysis.fileName, status: "ambiguous", match: unique[0].match, extracted: null };
  const only = unique[0];
  const extracted = extractWattsFromRow(only.match.row, only.match.wattsColumns, "extended");
  if (!extracted) return { product, sourceFile: only.analysis.fileName, status: "no_watts", match: only.match, extracted: null };
  return { product, sourceFile: only.analysis.fileName, status: "matched", match: only.match, extracted };
}

async function insertParams(prisma: PrismaClient, plannedParams: PlannedParam[]): Promise<number> {
  let inserted = 0;
  for (const chunk of chunks(plannedParams, INSERT_BATCH_SIZE)) {
    const result = await prisma.productParam.createMany({
      data: chunk.map((param) => ({
        id: param.id,
        productId: param.productId,
        paramKey: "watts",
        rawValue: param.rawValue,
        normalizedValue: param.normalizedValue,
        unit: "W",
        sourceField: SOURCE_FIELD,
        confidence: "high",
      })),
    });
    inserted += result.count;
  }
  return inserted;
}

async function loadCoverage(prisma: PrismaClient): Promise<Coverage> {
  const [row] = await prisma.$queryRaw<Array<{ total_products: number | bigint; product_params: number | bigint; watts_covered: number | bigint }>>`
    SELECT
      (SELECT COUNT(*) FROM products) AS total_products,
      (SELECT COUNT(*) FROM product_params) AS product_params,
      (SELECT COUNT(DISTINCT product_id) FROM product_params WHERE param_key = 'watts') AS watts_covered
  `;
  return {
    totalProducts: Number(row?.total_products ?? 0),
    productParams: Number(row?.product_params ?? 0),
    wattsCovered: Number(row?.watts_covered ?? 0),
  };
}

function buildReport(summary: Summary): string {
  const matched = summary.targetResults.filter((result) => result.status !== "no_match").length;
  const withWatts = summary.targetResults.filter((result) => result.status === "matched").length;
  const noMatch = summary.targetResults.filter((result) => result.status === "no_match").length;
  const ambiguous = summary.targetResults.filter((result) => result.status === "ambiguous").length;
  const fileStats = buildFileStats(summary.targetResults);
  return `# V26.0 磁吸灯匹配修复报告

模式: ${summary.mode}

## 备份
路径: ${summary.backupPath ?? "dry-run 未创建备份"}

## 诊断：命名差异分析

| 文件 | Excel 样本 | DB model_no 样本 | 差异模式 |
|------|-----------|-----------------|---------|
${summary.diagnostics
  .map((row) => `| ${md(row.fileName)} | ${md(row.excelSamples.join(" / "))} | ${md(row.dbSamples.join(" / "))} | ${md(row.pattern)} |`)
  .join("\n")}

## 匹配结果
- 目标产品数: ${formatInteger(summary.targetResults.length)}
- 标准化后匹配成功: ${formatInteger(matched)}
- 有 watts 值: ${formatInteger(withWatts)}
- 仍然 no_match: ${formatInteger(noMatch)}
- ambiguous (标准化后): ${formatInteger(ambiguous)}
- 写入成功: ${formatInteger(summary.inserted)}

## 按文件

| 文件名 | 目标数 | 匹配成功 | 有 watts | 仍 no_match |
|--------|--------|---------|---------|------------|
${fileStats
  .map((stat) => `| ${md(stat.fileName)} | ${formatInteger(stat.target)} | ${formatInteger(stat.matched)} | ${formatInteger(stat.withWatts)} | ${formatInteger(stat.noMatch)} |`)
  .join("\n")}

## 写入样本（前 20 条）

| 品类 | product_name | model_no | 源文件 | raw_value | normalized_value |
|------|-------------|----------|--------|-----------|------------------|
${summary.plannedParams
  .slice(0, 20)
  .map((param) => `| ${md(param.category)} | ${md(param.productName)} | ${md(param.modelNo ?? "-")} | ${md(param.sourceFile)} | ${md(param.rawValue)} | ${md(param.normalizedValue)} |`)
  .join("\n")}

## product_params / watts 覆盖率变化
- product_params: ${formatInteger(summary.before.productParams)} → ${formatInteger(summary.after.productParams)}
- watts: ${formatInteger(summary.before.wattsCovered)}/${formatInteger(summary.before.totalProducts)} (${formatPercent(summary.before.wattsCovered, summary.before.totalProducts)}) → ${formatInteger(summary.after.wattsCovered)}/${formatInteger(summary.after.totalProducts)} (${formatPercent(summary.after.wattsCovered, summary.after.totalProducts)})

## 说明
- 只 INSERT 新的 product_params 行，不 UPDATE / DELETE。
- 不跨 source_file_id 匹配。
- source_field = ${SOURCE_FIELD}
`;
}

function buildDiagnostics(files: ReturnType<typeof groupProductsBySourceFile>, analysisByFile: Map<string, FileAnalysis>): DiagnosticRow[] {
  return files.slice(0, 40).map((file) => {
    const analysis = analysisByFile.get(file.id);
    const excelSamples = [...new Set(analysis?.sheets.flatMap((sheet) => sheet.modelSamples) ?? [])].slice(0, 10);
    const dbSamples = file.products.map((product) => product.modelNo ?? product.productName).filter(Boolean).slice(0, 10);
    return {
      fileName: file.fileName,
      excelSamples,
      dbSamples,
      pattern: inferDifferencePattern(excelSamples, dbSamples),
    };
  });
}

function buildFileStats(results: TargetResult[]): FileStat[] {
  const stats = new Map<string, FileStat>();
  for (const result of results) {
    const stat = stats.get(result.sourceFile) ?? { fileName: result.sourceFile, target: 0, matched: 0, withWatts: 0, noMatch: 0, ambiguous: 0 };
    stat.target += 1;
    if (result.status !== "no_match") stat.matched += 1;
    if (result.status === "matched") stat.withWatts += 1;
    if (result.status === "no_match") stat.noMatch += 1;
    if (result.status === "ambiguous") stat.ambiguous += 1;
    stats.set(result.sourceFile, stat);
  }
  return [...stats.values()].sort((left, right) => right.target - left.target || left.fileName.localeCompare(right.fileName));
}

function identityKeys(product: MissingProduct): string[] {
  return [...new Set([product.modelNo ?? "", product.productName].filter(Boolean))];
}

function normalizeMagnetic(raw: string): string {
  return raw
    .normalize("NFC")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/^(?:SILI|SI\s*LI)[-_]*/i, "")
    .replace(/[-/_.\\()（）,，:：]/g, "");
}

function isUsefulKey(value: string): boolean {
  return value.length >= 3 && !/^\d+$/.test(value);
}

function dedupeMatches(matches: Array<{ analysis: FileAnalysis; match: RowMatch }>): Array<{ analysis: FileAnalysis; match: RowMatch }> {
  const map = new Map<string, { analysis: FileAnalysis; match: RowMatch }>();
  for (const item of matches) map.set(`${item.analysis.fileId}\u0000${item.match.sheetName}\u0000${item.match.rowIndex}`, item);
  return [...map.values()];
}

function firstSourceFile(product: MissingProduct): string {
  return product.sources[0]?.fileName ?? "-";
}

function inferDifferencePattern(excelSamples: string[], dbSamples: string[]): string {
  const excel = excelSamples[0] ?? "";
  const db = dbSamples[0] ?? "";
  const patterns: string[] = [];
  if (/\s/.test(excel) || /\s/.test(db)) patterns.push("空格差异");
  if (/[-/_.]/.test(excel) || /[-/_.]/.test(db)) patterns.push("分隔符差异");
  if (/SI\s*LI|SILI/i.test(excel) || /SI\s*LI|SILI/i.test(db)) patterns.push("SI LI 前缀差异");
  if (normalizeMagnetic(excel) === normalizeMagnetic(db) && excel && db) patterns.push("标准化后相同");
  return patterns.join(" + ") || "需人工查看样本";
}

function projectCoverage(before: Coverage, plannedCount: number): Coverage {
  return { totalProducts: before.totalProducts, productParams: before.productParams, wattsCovered: before.wattsCovered + plannedCount };
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
