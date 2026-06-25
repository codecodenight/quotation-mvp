import "dotenv/config";

import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { PrismaClient } from "@prisma/client";

import {
  EXTENDED_INDIRECT_WATTS_HEADER_PATTERNS,
  analyzeFiles,
  auditProduct,
  backupDatabase,
  chunks,
  formatInteger,
  formatPercent,
  groupProductsBySourceFile,
  INSERT_BATCH_SIZE,
  loadMissingProducts,
  md,
  type ProductAudit,
} from "./v25-watts-shared";

const REPORT_PATH = path.join("docs", "v25.3-indirect-watts-extraction-report.md");
const SOURCE_FIELD = "v25.3_indirect_watts";

type Mode = "dry-run" | "apply";

type PlannedParam = {
  id: string;
  productId: string;
  category: string;
  productName: string;
  modelNo: string | null;
  rawValue: string;
  normalizedValue: string;
  unit: "W";
  confidence: "high" | "medium";
  pattern: "direct" | "multiply" | "range";
  header: string;
  sourceFile: string;
  sheetName: string | null;
};

type Coverage = {
  totalProducts: number;
  wattsCovered: number;
  productParams: number;
};

type HeaderStat = {
  header: string;
  files: Set<string>;
  extractable: number;
};

type Summary = {
  mode: Mode;
  backupPath: string | null;
  scannedProducts: number;
  plannedParams: PlannedParam[];
  inserted: number;
  before: Coverage;
  after: Coverage;
};

async function main() {
  const mode: Mode = process.argv.includes("--apply") ? "apply" : "dry-run";
  if (process.argv.includes("--dry-run") && process.argv.includes("--apply")) {
    throw new Error("Use either --dry-run or --apply, not both.");
  }

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
          scannedProducts: summary.scannedProducts,
          planned: summary.plannedParams.length,
          inserted: summary.inserted,
          patternCounts: countByPattern(summary.plannedParams),
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
  const before = await loadCoverage(prisma);
  const { missingWithSource } = await loadMissingProducts(prisma);
  const files = groupProductsBySourceFile(missingWithSource);
  const analysisByFile = analyzeFiles(files, "V25.3 indirect watts scan", {
    includeDirect: false,
    indirectPatterns: EXTENDED_INDIRECT_WATTS_HEADER_PATTERNS,
  });
  const audits = missingWithSource.map((product) => auditProduct(product, analysisByFile, "extended"));
  const recoverableAudits = audits.filter((audit) => audit.bucket === "RECOVERABLE" && audit.extracted);

  const existingWatts = await loadExistingWattsProductIds(prisma, recoverableAudits.map((audit) => audit.product.productId));
  const plannedParams = recoverableAudits
    .filter((audit) => !existingWatts.has(audit.product.productId) && audit.extracted)
    .map((audit) => toPlannedParam(audit));

  const backupPath = mode === "apply" ? await backupDatabase("v25.3") : null;
  const inserted = mode === "apply" ? await insertParams(prisma, plannedParams) : 0;
  const after = mode === "apply" ? await loadCoverage(prisma) : projectCoverage(before, plannedParams.length);
  return { mode, backupPath, scannedProducts: missingWithSource.length, plannedParams, inserted, before, after };
}

function toPlannedParam(audit: ProductAudit): PlannedParam {
  if (!audit.extracted) throw new Error(`Missing extracted watts for ${audit.product.productId}`);
  return {
    id: randomUUID(),
    productId: audit.product.productId,
    category: audit.product.category,
    productName: audit.product.productName,
    modelNo: audit.product.modelNo,
    rawValue: audit.extracted.rawValue,
    normalizedValue: audit.extracted.normalizedValue,
    unit: "W",
    confidence: audit.extracted.confidence,
    pattern: audit.extracted.pattern,
    header: audit.extracted.header,
    sourceFile: audit.sourceFile,
    sheetName: audit.sheetName,
  };
}

async function loadExistingWattsProductIds(prisma: PrismaClient, productIds: string[]): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const chunk of chunks(productIds, 900)) {
    const rows = await prisma.productParam.findMany({
      where: { productId: { in: chunk }, paramKey: "watts" },
      select: { productId: true },
    });
    for (const row of rows) ids.add(row.productId);
  }
  return ids;
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
        unit: param.unit,
        sourceField: SOURCE_FIELD,
        confidence: param.confidence,
      })),
    });
    inserted += result.count;
  }
  return inserted;
}

async function loadCoverage(prisma: PrismaClient): Promise<Coverage> {
  const [totalProducts, productParams, wattsRows] = await Promise.all([
    prisma.product.count(),
    prisma.productParam.count(),
    prisma.productParam.findMany({ where: { paramKey: "watts" }, distinct: ["productId"], select: { productId: true } }),
  ]);
  return { totalProducts, productParams, wattsCovered: wattsRows.length };
}

function projectCoverage(before: Coverage, plannedCount: number): Coverage {
  return {
    totalProducts: before.totalProducts,
    productParams: before.productParams,
    wattsCovered: before.wattsCovered + plannedCount,
  };
}

function buildReport(summary: Summary): string {
  const patternCounts = countByPattern(summary.plannedParams);
  const categoryRows = buildCategoryRows(summary.plannedParams);
  const headerStats = buildHeaderStats(summary.plannedParams);

  return `# V25.3 间接列 Watts 提取报告

模式: ${summary.mode}

## 备份
路径: ${summary.backupPath ?? "dry-run 未创建备份"}

## 统计
- 扫描产品数: ${formatInteger(summary.scannedProducts)}
- 新增 watts: ${formatInteger(summary.plannedParams.length)}
- 来自直接模式: ${formatInteger(patternCounts.direct)}
- 来自乘法模式: ${formatInteger(patternCounts.multiply)}
- 来自范围模式: ${formatInteger(patternCounts.range)}
- 写入成功: ${formatInteger(summary.inserted)}

## 按品类

| 品类 | 提取数 | 主要来源列 |
|------|--------|-----------|
${categoryRows.join("\n")}

## 间接列头统计

| 列头原文 | 匹配文件数 | 可提取 watts 数 |
|---------|-----------|---------------|
${[...headerStats.values()]
  .sort((left, right) => right.extractable - left.extractable || left.header.localeCompare(right.header))
  .map((stat) => `| ${md(stat.header)} | ${formatInteger(stat.files.size)} | ${formatInteger(stat.extractable)} |`)
  .join("\n")}

## 写入样本（前 30 条）

| 品类 | product_name | model_no | 列头 | raw_value | normalized_value | confidence |
|------|-------------|----------|------|-----------|------------------|------------|
${summary.plannedParams
  .slice(0, 30)
  .map((param) => `| ${md(param.category)} | ${md(param.productName)} | ${md(param.modelNo ?? "-")} | ${md(param.header)} | ${md(param.rawValue)} | ${md(param.normalizedValue)} | ${param.confidence} |`)
  .join("\n")}

## product_params / watts 覆盖率变化
- product_params: ${formatInteger(summary.before.productParams)} → ${formatInteger(summary.after.productParams)}
- watts: ${formatInteger(summary.before.wattsCovered)}/${formatInteger(summary.before.totalProducts)} (${formatPercent(summary.before.wattsCovered, summary.before.totalProducts)}) → ${formatInteger(summary.after.wattsCovered)}/${formatInteger(summary.after.totalProducts)} (${formatPercent(summary.after.wattsCovered, summary.after.totalProducts)})

## 说明
- 只 INSERT 新的 product_params 行，不 UPDATE / DELETE。
- source_field = ${SOURCE_FIELD}
- direct/multiply 为 high confidence，range 为 medium confidence。
`;
}

function buildCategoryRows(plannedParams: PlannedParam[]): string[] {
  const rows = new Map<string, { count: number; headers: Map<string, number> }>();
  for (const param of plannedParams) {
    const row = rows.get(param.category) ?? { count: 0, headers: new Map<string, number>() };
    row.count += 1;
    row.headers.set(param.header, (row.headers.get(param.header) ?? 0) + 1);
    rows.set(param.category, row);
  }
  return [...rows.entries()]
    .sort((left, right) => right[1].count - left[1].count || left[0].localeCompare(right[0]))
    .map(([category, row]) => {
      const headers = [...row.headers.entries()]
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .slice(0, 3)
        .map(([header, count]) => `${header}(${count})`)
        .join(", ");
      return `| ${md(category)} | ${formatInteger(row.count)} | ${md(headers)} |`;
    });
}

function buildHeaderStats(plannedParams: PlannedParam[]): Map<string, HeaderStat> {
  const stats = new Map<string, HeaderStat>();
  for (const param of plannedParams) {
    const stat = stats.get(param.header) ?? { header: param.header, files: new Set<string>(), extractable: 0 };
    stat.files.add(param.sourceFile);
    stat.extractable += 1;
    stats.set(param.header, stat);
  }
  return stats;
}

function countByPattern(plannedParams: PlannedParam[]): Record<"direct" | "multiply" | "range", number> {
  return {
    direct: plannedParams.filter((param) => param.pattern === "direct").length,
    multiply: plannedParams.filter((param) => param.pattern === "multiply").length,
    range: plannedParams.filter((param) => param.pattern === "range").length,
  };
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
