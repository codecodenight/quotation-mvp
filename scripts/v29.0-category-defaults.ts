import "dotenv/config";

import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { PrismaClient } from "@prisma/client";

import { backupDatabase, chunks, formatInteger, formatPercent, INSERT_BATCH_SIZE, md } from "./v25-watts-shared";

const REPORT_PATH = path.join("docs", "v29.0-category-defaults-report.md");
const SOURCE_FIELD = "v29.0_category_default";

type Mode = "dry-run" | "apply";

type CategoryDefault = {
  category: string;
  paramKey: "beam_angle" | "ip";
  defaultValue: string;
  rawValue: string;
  unit: string | null;
};

type ProductRow = {
  id: string;
  product_name: string;
  model_no: string | null;
  category: string;
};

type PlannedParam = {
  id: string;
  productId: string;
  productName: string;
  modelNo: string | null;
  category: string;
  paramKey: CategoryDefault["paramKey"];
  rawValue: string;
  normalizedValue: string;
  unit: string | null;
};

type Coverage = {
  totalProducts: number;
  productParams: number;
  byParam: Map<string, number>;
};

type Summary = {
  mode: Mode;
  backupPath: string | null;
  dimmableDeleteCandidates: number;
  dimmableDeleted: number;
  plannedParams: PlannedParam[];
  inserted: number;
  before: Coverage;
  after: Coverage;
};

const CATEGORY_DEFAULTS: CategoryDefault[] = [
  { category: "灯丝灯", paramKey: "beam_angle", defaultValue: "360", rawValue: "360°", unit: "°" },
  { category: "三防灯", paramKey: "beam_angle", defaultValue: "120", rawValue: "120°", unit: "°" },
  { category: "防潮灯", paramKey: "beam_angle", defaultValue: "120", rawValue: "120°", unit: "°" },
  { category: "应急灯", paramKey: "beam_angle", defaultValue: "180", rawValue: "180°", unit: "°" },
  { category: "Highbay", paramKey: "beam_angle", defaultValue: "90", rawValue: "90°", unit: "°" },
  { category: "面板灯", paramKey: "ip", defaultValue: "IP20", rawValue: "IP20", unit: null },
  { category: "磁吸灯", paramKey: "ip", defaultValue: "IP20", rawValue: "IP20", unit: null },
  { category: "镜前灯", paramKey: "ip", defaultValue: "IP44", rawValue: "IP44", unit: null },
  { category: "Highbay", paramKey: "ip", defaultValue: "IP65", rawValue: "IP65", unit: null },
];

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
          dimmableDeleteCandidates: summary.dimmableDeleteCandidates,
          dimmableDeleted: summary.dimmableDeleted,
          planned: summary.plannedParams.length,
          inserted: summary.inserted,
          productParamsBefore: summary.before.productParams,
          productParamsAfter: summary.after.productParams,
          byParam: Object.fromEntries(countByParam(summary.plannedParams)),
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
  console.log("V29.0 load defaults targets");
  const before = await loadCoverage(prisma);
  const dimmableDeleteCandidates = await countBadDimmable(prisma);
  const plannedParams: PlannedParam[] = [];

  for (const config of CATEGORY_DEFAULTS) {
    const products = await loadMissingProducts(prisma, config);
    for (const product of products) {
      plannedParams.push({
        id: randomUUID(),
        productId: product.id,
        productName: product.product_name,
        modelNo: product.model_no,
        category: product.category,
        paramKey: config.paramKey,
        rawValue: config.rawValue,
        normalizedValue: config.defaultValue,
        unit: config.unit,
      });
    }
  }

  const backupPath = mode === "apply" ? await backupDatabase("v29.0") : null;
  let dimmableDeleted = 0;
  let inserted = 0;
  if (mode === "apply") {
    dimmableDeleted = await deleteBadDimmable(prisma);
    inserted = await insertParams(prisma, plannedParams);
  }
  const after = mode === "apply" ? await loadCoverage(prisma) : projectCoverage(before, plannedParams.length, dimmableDeleteCandidates, plannedParams);
  return { mode, backupPath, dimmableDeleteCandidates, dimmableDeleted, plannedParams, inserted, before, after };
}

async function countBadDimmable(prisma: PrismaClient): Promise<number> {
  return prisma.productParam.count({
    where: { sourceField: "v28.2_excel_extraction", paramKey: "dimmable", rawValue: "加2.2元" },
  });
}

async function deleteBadDimmable(prisma: PrismaClient): Promise<number> {
  const result = await prisma.productParam.deleteMany({
    where: { sourceField: "v28.2_excel_extraction", paramKey: "dimmable", rawValue: "加2.2元" },
  });
  return result.count;
}

async function loadMissingProducts(prisma: PrismaClient, config: CategoryDefault): Promise<ProductRow[]> {
  return prisma.$queryRaw<ProductRow[]>`
    SELECT p.id, p.product_name, p.model_no, p.category
    FROM products p
    WHERE p.category = ${config.category}
      AND NOT EXISTS (
        SELECT 1
        FROM product_params AS pp INDEXED BY product_params_product_id_idx
        WHERE pp.product_id = p.id
          AND pp.param_key = ${config.paramKey}
      )
    ORDER BY p.product_name
  `;
}

async function insertParams(prisma: PrismaClient, plannedParams: PlannedParam[]): Promise<number> {
  let inserted = 0;
  for (const chunk of chunks(plannedParams, INSERT_BATCH_SIZE)) {
    const result = await prisma.productParam.createMany({
      data: chunk.map((param) => ({
        id: param.id,
        productId: param.productId,
        paramKey: param.paramKey,
        rawValue: param.rawValue,
        normalizedValue: param.normalizedValue,
        unit: param.unit,
        sourceField: SOURCE_FIELD,
        confidence: "medium",
      })),
    });
    inserted += result.count;
  }
  return inserted;
}

async function loadCoverage(prisma: PrismaClient): Promise<Coverage> {
  const rows = await prisma.$queryRaw<Array<{ param_key: string; covered: number | bigint }>>`
    SELECT param_key, COUNT(DISTINCT product_id) AS covered
    FROM product_params
    WHERE param_key IN ('beam_angle', 'ip', 'dimmable')
    GROUP BY param_key
  `;
  const byParam = new Map<string, number>(rows.map((row) => [row.param_key, Number(row.covered)]));
  const [totalProducts, productParams] = await Promise.all([prisma.product.count(), prisma.productParam.count()]);
  return { totalProducts, productParams, byParam };
}

function projectCoverage(before: Coverage, insertedCount: number, deletedCount: number, plannedParams: PlannedParam[]): Coverage {
  const byParam = new Map(before.byParam);
  for (const [paramKey, count] of countByParam(plannedParams)) byParam.set(paramKey, (byParam.get(paramKey) ?? 0) + count);
  byParam.set("dimmable", Math.max(0, (byParam.get("dimmable") ?? 0) - deletedCount));
  return { totalProducts: before.totalProducts, productParams: before.productParams - deletedCount + insertedCount, byParam };
}

function countByParam(plannedParams: PlannedParam[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const param of plannedParams) counts.set(param.paramKey, (counts.get(param.paramKey) ?? 0) + 1);
  return new Map([...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])));
}

function countByCategoryParam(plannedParams: PlannedParam[]): Map<string, Map<string, number>> {
  const rows = new Map<string, Map<string, number>>();
  for (const param of plannedParams) {
    const key = `${param.category}\u0000${param.paramKey}\u0000${param.rawValue}`;
    const row = rows.get(key) ?? new Map<string, number>();
    row.set("count", (row.get("count") ?? 0) + 1);
    rows.set(key, row);
  }
  return rows;
}

function buildReport(summary: Summary): string {
  const byCategoryParam = countByCategoryParam(summary.plannedParams);
  const byParam = countByParam(summary.plannedParams);
  return `# V29.0 品类默认值推理报告

模式: ${summary.mode}

## 备份
路径: ${summary.backupPath ?? "dry-run 未创建备份"}

## 清理
- dimmable 删除: ${formatInteger(summary.mode === "apply" ? summary.dimmableDeleted : summary.dimmableDeleteCandidates)}（dry-run 计划 / apply 实际）

## 按品类 × 参数

| 品类 | param_key | 默认值 | 新增数 |
|------|-----------|--------|--------|
${[...byCategoryParam.entries()]
  .map(([key, value]) => {
    const [category, paramKey, rawValue] = key.split("\u0000");
    return `| ${md(category)} | ${md(paramKey)} | ${md(rawValue)} | ${formatInteger(value.get("count") ?? 0)} |`;
  })
  .join("\n")}

## 覆盖率变化

| param_key | 之前 | 新增 | 之后 |
|-----------|------|------|------|
${["beam_angle", "ip", "dimmable"]
  .map((paramKey) => {
    const before = summary.before.byParam.get(paramKey) ?? 0;
    const after = summary.after.byParam.get(paramKey) ?? before;
    const added = byParam.get(paramKey) ?? 0;
    const deleted = paramKey === "dimmable" ? (summary.mode === "apply" ? summary.dimmableDeleted : summary.dimmableDeleteCandidates) : 0;
    const delta = added - deleted;
    return `| ${md(paramKey)} | ${formatInteger(before)}/${formatInteger(summary.before.totalProducts)} (${formatPercent(before, summary.before.totalProducts)}) | ${delta >= 0 ? "+" : ""}${formatInteger(delta)} | ${formatInteger(after)}/${formatInteger(summary.after.totalProducts)} (${formatPercent(after, summary.after.totalProducts)}) |`;
  })
  .join("\n")}

## 写入样本（前 30）

| 品类 | product_name | model_no | param_key | raw | normalized |
|------|-------------|---------|-----------|-----|------------|
${summary.plannedParams
  .slice(0, 30)
  .map((param) => `| ${md(param.category)} | ${md(param.productName)} | ${md(param.modelNo ?? "-")} | ${md(param.paramKey)} | ${md(param.rawValue)} | ${md(param.normalizedValue)} |`)
  .join("\n")}

## product_params 总量变化
- product_params: ${formatInteger(summary.before.productParams)} → ${formatInteger(summary.after.productParams)}
- 净变化: ${summary.after.productParams - summary.before.productParams >= 0 ? "+" : ""}${formatInteger(summary.after.productParams - summary.before.productParams)}

## 说明
- 只 INSERT 品类默认值参数；只 DELETE 指定 v28.2 坏 dimmable。
- source_field = ${SOURCE_FIELD}
- confidence = medium
`;
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
