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
  chunks,
  formatInteger,
  formatPercent,
  groupProductsBySourceFile,
  INSERT_BATCH_SIZE,
  loadMissingProducts,
  md,
  type ProductAudit,
} from "./v25-watts-shared";

const REPORT_PATH = path.join("docs", "v25.2-recoverable-watts-write-report.md");
const SOURCE_FIELD = "v25.2_recoverable_watts";

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
  sourceFile: string;
  sheetName: string | null;
};

type Coverage = {
  totalProducts: number;
  wattsCovered: number;
  productParams: number;
};

type Summary = {
  mode: Mode;
  backupPath: string | null;
  recoverableAudits: ProductAudit[];
  plannedParams: PlannedParam[];
  skippedExisting: number;
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
          auditRecoverable: summary.recoverableAudits.length,
          writable: summary.plannedParams.length,
          skippedExisting: summary.skippedExisting,
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
  const before = await loadCoverage(prisma);
  const { missingWithSource } = await loadMissingProducts(prisma);
  const files = groupProductsBySourceFile(missingWithSource);
  const analysisByFile = analyzeFiles(files, "V25.2 recoverable scan");
  const audits = missingWithSource.map((product) => auditProduct(product, analysisByFile, "base"));
  const recoverableAudits = audits.filter((audit) => audit.bucket === "RECOVERABLE" && audit.extracted);

  const existingWatts = await loadExistingWattsProductIds(prisma, recoverableAudits.map((audit) => audit.product.productId));
  const plannedParams = recoverableAudits
    .filter((audit) => !existingWatts.has(audit.product.productId) && audit.extracted)
    .map((audit) => ({
      id: randomUUID(),
      productId: audit.product.productId,
      category: audit.product.category,
      productName: audit.product.productName,
      modelNo: audit.product.modelNo,
      rawValue: audit.extracted!.rawValue,
      normalizedValue: audit.extracted!.normalizedValue,
      unit: "W" as const,
      sourceFile: audit.sourceFile,
      sheetName: audit.sheetName,
    }));
  const skippedExisting = recoverableAudits.length - plannedParams.length;

  const backupPath = mode === "apply" ? await backupDatabase("v25.2") : null;
  const inserted = mode === "apply" ? await insertParams(prisma, plannedParams) : 0;
  const after = mode === "apply" ? await loadCoverage(prisma) : projectCoverage(before, plannedParams.length);
  return { mode, backupPath, recoverableAudits, plannedParams, skippedExisting, inserted, before, after };
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
        confidence: "high",
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
  const byCategory = countByCategory(summary.plannedParams);
  return `# V25.2 RECOVERABLE Watts 写入报告

模式: ${summary.mode}

## 备份
路径: ${summary.backupPath ?? "dry-run 未创建备份"}

## 统计
- 审计 RECOVERABLE 数: ${formatInteger(summary.recoverableAudits.length)}
- 实际可写入: ${formatInteger(summary.plannedParams.length)}（排除已有 watts 的）
- 跳过（已有 watts）: ${formatInteger(summary.skippedExisting)}
- 写入成功: ${formatInteger(summary.inserted)}

## 按品类

| 品类 | 写入数 |
|------|--------|
${[...byCategory.entries()]
  .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
  .map(([category, count]) => `| ${md(category)} | ${formatInteger(count)} |`)
  .join("\n")}

## 写入样本（前 20 条）

| 品类 | product_name | raw_value | normalized_value |
|------|-------------|-----------|-----------------|
${summary.plannedParams
  .slice(0, 20)
  .map((param) => `| ${md(param.category)} | ${md(param.productName)} | ${md(param.rawValue)} | ${md(param.normalizedValue)} |`)
  .join("\n")}

## product_params 总数变化
${formatInteger(summary.before.productParams)} → ${formatInteger(summary.after.productParams)}

## watts 覆盖率变化
before: ${formatInteger(summary.before.wattsCovered)}/${formatInteger(summary.before.totalProducts)} (${formatPercent(summary.before.wattsCovered, summary.before.totalProducts)}) → after: ${formatInteger(summary.after.wattsCovered)}/${formatInteger(summary.after.totalProducts)} (${formatPercent(summary.after.wattsCovered, summary.after.totalProducts)})

## 说明
- 只 INSERT 新的 product_params 行，不 UPDATE / DELETE。
- source_field = ${SOURCE_FIELD}
- confidence = high
`;
}

function countByCategory(plannedParams: PlannedParam[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const param of plannedParams) counts.set(param.category, (counts.get(param.category) ?? 0) + 1);
  return counts;
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
