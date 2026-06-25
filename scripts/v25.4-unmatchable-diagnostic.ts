import "dotenv/config";

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { PrismaClient } from "@prisma/client";

import {
  analyzeFiles,
  auditProduct,
  extractWattsFromRow,
  formatInteger,
  groupProductsBySourceFile,
  loadMissingProducts,
  matchProductInFile,
  md,
  type FileAnalysis,
  type MissingProduct,
  type ProductAudit,
  type RowMatch,
} from "./v25-watts-shared";

const REPORT_PATH = path.join("docs", "v25.4-unmatchable-diagnostic-report.md");

type FailureType = "ambiguous" | "no_match";

type Diagnostic = {
  audit: ProductAudit;
  failureType: FailureType;
  matches: RowMatch[];
  modelSamples: string[];
};

type FileStat = {
  fileName: string;
  categories: Set<string>;
  total: number;
  ambiguous: number;
  noMatch: number;
  hasWattsColumn: boolean;
};

type Summary = {
  diagnostics: Diagnostic[];
};

async function main() {
  if (process.argv.includes("--apply")) {
    throw new Error("V25.4 is read-only and does not accept --apply.");
  }

  const prisma = new PrismaClient();
  try {
    const summary = await run(prisma);
    await mkdir(path.dirname(REPORT_PATH), { recursive: true });
    await writeFile(REPORT_PATH, buildReport(summary), "utf8");
    const ambiguous = summary.diagnostics.filter((diagnostic) => diagnostic.failureType === "ambiguous").length;
    const noMatch = summary.diagnostics.length - ambiguous;
    console.log(
      JSON.stringify(
        {
          mode: "read-only",
          reportPath: REPORT_PATH,
          unmatchable: summary.diagnostics.length,
          ambiguous,
          noMatch,
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
  const { missingWithSource } = await loadMissingProducts(prisma);
  const files = groupProductsBySourceFile(missingWithSource);
  const analysisByFile = analyzeFiles(files, "V25.4 unmatchable diagnostic");
  const diagnostics: Diagnostic[] = [];

  for (const product of missingWithSource) {
    const audit = auditProduct(product, analysisByFile, "base");
    if (audit.bucket !== "UNMATCHABLE") continue;
    diagnostics.push(buildDiagnostic(product, audit, analysisByFile));
  }

  return { diagnostics };
}

function buildDiagnostic(product: MissingProduct, audit: ProductAudit, analysisByFile: Map<string, FileAnalysis>): Diagnostic {
  const readableAnalyses = product.sources.map((source) => analysisByFile.get(source.sourceFileId)).filter((analysis): analysis is FileAnalysis => Boolean(analysis?.readable));
  const matchingAnalyses = readableAnalyses.filter((analysis) => analysis.hasWattsColumn);
  const noMatchSamples: string[] = [];

  for (const analysis of matchingAnalyses) {
    const match = matchProductInFile(product, analysis);
    if (match.status === "ambiguous") {
      return { audit, failureType: "ambiguous", matches: match.matches, modelSamples: collectModelSamples(analysis) };
    }
    noMatchSamples.push(...collectModelSamples(analysis));
  }

  return { audit, failureType: "no_match", matches: [], modelSamples: [...new Set(noMatchSamples)].slice(0, 8) };
}

function buildReport(summary: Summary): string {
  const ambiguous = summary.diagnostics.filter((diagnostic) => diagnostic.failureType === "ambiguous");
  const noMatch = summary.diagnostics.filter((diagnostic) => diagnostic.failureType === "no_match");
  const fileStats = buildFileStats(summary.diagnostics);
  const highYield = fileStats.filter((stat) => stat.ambiguous >= 10 && stat.hasWattsColumn);

  return `# V25.4 UNMATCHABLE 诊断报告

## 总览
- UNMATCHABLE 产品数: ${formatInteger(summary.diagnostics.length)}
- ambiguous: ${formatInteger(ambiguous.length)}
- no_match: ${formatInteger(noMatch.length)}

## 按文件统计

| 文件名 | 品类 | 总 UNMATCHABLE | ambiguous | no_match | 该文件有 watts 列 |
|--------|------|----------------|-----------|----------|-----------------|
${fileStats
  .map(
    (stat) =>
      `| ${md(stat.fileName)} | ${md([...stat.categories].sort((left, right) => left.localeCompare(right)).join(", "))} | ${formatInteger(stat.total)} | ${formatInteger(stat.ambiguous)} | ${formatInteger(stat.noMatch)} | ${stat.hasWattsColumn ? "Y" : "N"} |`,
  )
  .join("\n")}

## ambiguous 详细样本（前 30 条）

| 品类 | model_no | 源文件 | 匹配行数 | 行号 | 各行 watts 值 |
|------|----------|--------|---------|------|-------------|
${ambiguous
  .slice(0, 30)
  .map((diagnostic) => {
    const rows = diagnostic.matches.map((match) => `${match.sheetName}#${match.rowIndex + 1}`).join(", ");
    const watts = diagnostic.matches.map((match) => formatMatchWatts(match)).join("; ");
    return `| ${md(diagnostic.audit.product.category)} | ${md(diagnostic.audit.product.modelNo ?? "-")} | ${md(diagnostic.audit.sourceFile)} | ${formatInteger(diagnostic.matches.length)} | ${md(rows)} | ${md(watts)} |`;
  })
  .join("\n")}

## no_match 详细样本（前 30 条）

| 品类 | model_no | product_name | 源文件 | 文件型号列样本 |
|------|----------|-------------|--------|-------------|
${noMatch
  .slice(0, 30)
  .map(
    (diagnostic) =>
      `| ${md(diagnostic.audit.product.category)} | ${md(diagnostic.audit.product.modelNo ?? "-")} | ${md(diagnostic.audit.product.productName)} | ${md(diagnostic.audit.sourceFile)} | ${md(diagnostic.modelSamples.join(" / ") || "-")} |`,
  )
  .join("\n")}

## 可操作建议

### 高收益文件（ambiguous ≥ 10 且有 watts 列的文件）
${highYield.length === 0 ? "- 暂无 ambiguous ≥ 10 的高收益文件。" : highYield.map((stat) => `- ${stat.fileName}: ambiguous ${stat.ambiguous}，建议考虑加入 purchase_price 或 sheet/category 作为消歧维度。`).join("\n")}

### no_match 模式分析
${buildNoMatchPatternNotes(noMatch)}

## 说明
- 本报告只读数据库和源 Excel 文件。
- ambiguous 表示同一 source_file_id 内匹配到多个候选行，脚本无法安全确定唯一来源。
- no_match 表示源文件有 watts 列，但产品 model_no/product_name 无法匹配到源表型号列。
`;
}

function buildFileStats(diagnostics: Diagnostic[]): FileStat[] {
  const stats = new Map<string, FileStat>();
  for (const diagnostic of diagnostics) {
    const fileName = diagnostic.audit.sourceFile;
    const stat =
      stats.get(fileName) ??
      ({
        fileName,
        categories: new Set<string>(),
        total: 0,
        ambiguous: 0,
        noMatch: 0,
        hasWattsColumn: true,
      } satisfies FileStat);
    stat.total += 1;
    stat.categories.add(diagnostic.audit.product.category);
    if (diagnostic.failureType === "ambiguous") stat.ambiguous += 1;
    else stat.noMatch += 1;
    stats.set(fileName, stat);
  }
  return [...stats.values()].sort((left, right) => right.total - left.total || left.fileName.localeCompare(right.fileName));
}

function collectModelSamples(analysis: FileAnalysis): string[] {
  return [...new Set(analysis.sheets.flatMap((sheet) => sheet.modelSamples))].slice(0, 8);
}

function formatMatchWatts(match: RowMatch): string {
  const extracted = extractWattsFromRow(match.row, match.wattsColumns, "base");
  const identity = match.identityValues.join(" / ");
  return `${match.sheetName}#${match.rowIndex + 1} ${identity}: ${extracted?.displayValue ?? "-"}`;
}

function buildNoMatchPatternNotes(noMatch: Diagnostic[]): string {
  const longText = noMatch.filter((diagnostic) => (diagnostic.audit.product.modelNo ?? "").length > 40).length;
  const pureSpec = noMatch.filter((diagnostic) => /电压|材质|包装|尺寸|配置|光源/.test(diagnostic.audit.product.modelNo ?? diagnostic.audit.product.productName)).length;
  const numericLike = noMatch.filter((diagnostic) => /^[\d.*×xX/-]+$/.test(diagnostic.audit.product.modelNo ?? "")).length;
  return [
    `- 长文本 model_no/product_name 样式: ${formatInteger(longText)}，通常需要人工确认源行。`,
    `- DB 标识像规格/包装/配置文本: ${formatInteger(pureSpec)}，建议先清洗产品标识再匹配。`,
    `- 纯数字/尺寸/电池规格样式: ${formatInteger(numericLike)}，容易与多行规格碰撞，不建议裸模糊匹配。`,
  ].join("\n");
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
