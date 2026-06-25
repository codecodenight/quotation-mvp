import "dotenv/config";

import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { PrismaClient } from "@prisma/client";

import { backupDatabase, chunks, formatInteger, formatPercent, INSERT_BATCH_SIZE, md } from "./v25-watts-shared";

const REPORT_PATH = path.join("docs", "v28.1-efficacy-calculation-report.md");
const SOURCE_FIELD = "v28.1_calculated";

type Mode = "dry-run" | "apply";

type TargetRow = {
  id: string;
  product_name: string;
  model_no: string | null;
  category: string | null;
  watts_val: string | null;
  lumens_val: string | null;
};

type PlannedParam = {
  id: string;
  productId: string;
  productName: string;
  modelNo: string | null;
  category: string;
  watts: number;
  lumens: number;
  efficacy: number;
};

type Anomaly = {
  category: string;
  productName: string;
  modelNo: string | null;
  watts: string | null;
  lumens: string | null;
  efficacy: number | null;
  reason: string;
};

type Coverage = {
  totalProducts: number;
  luminousEfficacyCovered: number;
  productParams: number;
};

type Summary = {
  mode: Mode;
  backupPath: string | null;
  targetRows: TargetRow[];
  plannedParams: PlannedParam[];
  anomalies: Anomaly[];
  inserted: number;
  before: Coverage;
  after: Coverage;
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
          targetProducts: summary.targetRows.length,
          calculated: summary.plannedParams.length,
          anomalies: summary.anomalies.length,
          inserted: summary.inserted,
          productParamsBefore: summary.before.productParams,
          productParamsAfter: summary.after.productParams,
          luminousEfficacyBefore: summary.before.luminousEfficacyCovered,
          luminousEfficacyAfter: summary.after.luminousEfficacyCovered,
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
  console.log("V28.1 load target products");
  const before = await loadCoverage(prisma);
  const targetRows = await loadTargetRows(prisma);
  const plannedParams: PlannedParam[] = [];
  const anomalies: Anomaly[] = [];

  for (const row of targetRows) {
    const watts = parsePositiveNumber(row.watts_val);
    const lumens = parsePositiveNumber(row.lumens_val);
    if (watts == null || lumens == null) {
      anomalies.push({
        category: cleanCategory(row.category),
        productName: row.product_name,
        modelNo: row.model_no,
        watts: row.watts_val,
        lumens: row.lumens_val,
        efficacy: null,
        reason: "watts/lumens normalized_value 不是正数",
      });
      continue;
    }
    const efficacy = lumens / watts;
    if (efficacy < 10 || efficacy > 300) {
      anomalies.push({
        category: cleanCategory(row.category),
        productName: row.product_name,
        modelNo: row.model_no,
        watts: row.watts_val,
        lumens: row.lumens_val,
        efficacy,
        reason: "计算值超出 10-300 lm/W",
      });
      continue;
    }
    plannedParams.push({
      id: randomUUID(),
      productId: row.id,
      productName: row.product_name,
      modelNo: row.model_no,
      category: cleanCategory(row.category),
      watts,
      lumens,
      efficacy: Math.round(efficacy),
    });
  }

  const backupPath = mode === "apply" ? await backupDatabase("v28.1") : null;
  const inserted = mode === "apply" ? await insertParams(prisma, plannedParams) : 0;
  const after = mode === "apply" ? await loadCoverage(prisma) : projectCoverage(before, plannedParams.length);
  return { mode, backupPath, targetRows, plannedParams, anomalies, inserted, before, after };
}

async function loadTargetRows(prisma: PrismaClient): Promise<TargetRow[]> {
  return prisma.$queryRaw<TargetRow[]>`
    SELECT p.id,
           p.product_name,
           p.model_no,
           p.category,
           w.normalized_value AS watts_val,
           l.normalized_value AS lumens_val
    FROM products p
    INNER JOIN product_params w
      ON w.product_id = p.id
     AND w.param_key = 'watts'
    INNER JOIN product_params l
      ON l.product_id = p.id
     AND l.param_key = 'lumens'
    LEFT JOIN product_params e
      ON e.product_id = p.id
     AND e.param_key = 'luminous_efficacy'
    WHERE e.id IS NULL
      AND CAST(w.normalized_value AS REAL) > 0
      AND CAST(l.normalized_value AS REAL) > 0
    ORDER BY p.category, p.product_name
  `;
}

async function insertParams(prisma: PrismaClient, plannedParams: PlannedParam[]): Promise<number> {
  let inserted = 0;
  for (const chunk of chunks(plannedParams, INSERT_BATCH_SIZE)) {
    const result = await prisma.productParam.createMany({
      data: chunk.map((param) => ({
        id: param.id,
        productId: param.productId,
        paramKey: "luminous_efficacy",
        rawValue: `${param.efficacy} lm/W`,
        normalizedValue: String(param.efficacy),
        unit: "lm/W",
        sourceField: SOURCE_FIELD,
        confidence: "high",
      })),
    });
    inserted += result.count;
  }
  return inserted;
}

async function loadCoverage(prisma: PrismaClient): Promise<Coverage> {
  const [row] = await prisma.$queryRaw<Array<{ total_products: number | bigint; product_params: number | bigint; covered: number | bigint }>>`
    SELECT
      (SELECT COUNT(*) FROM products) AS total_products,
      (SELECT COUNT(*) FROM product_params) AS product_params,
      (SELECT COUNT(DISTINCT product_id) FROM product_params WHERE param_key = 'luminous_efficacy') AS covered
  `;
  return {
    totalProducts: Number(row?.total_products ?? 0),
    productParams: Number(row?.product_params ?? 0),
    luminousEfficacyCovered: Number(row?.covered ?? 0),
  };
}

function projectCoverage(before: Coverage, plannedCount: number): Coverage {
  return {
    totalProducts: before.totalProducts,
    productParams: before.productParams + plannedCount,
    luminousEfficacyCovered: before.luminousEfficacyCovered + plannedCount,
  };
}

function parsePositiveNumber(value: string | null): number | null {
  if (!value) return null;
  const trimmed = value.trim().replace(/,/g, "");
  if (!/^\d+(?:\.\d+)?$/.test(trimmed)) return null;
  const number = Number(trimmed);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function buildReport(summary: Summary): string {
  return `# V28.1 Luminous Efficacy 计算报告

模式: ${summary.mode}

## 备份
路径: ${summary.backupPath ?? "dry-run 未创建备份"}

## 统计
- 目标产品数: ${formatInteger(summary.targetRows.length)}
- 计算成功: ${formatInteger(summary.plannedParams.length)}
- 跳过（异常值）: ${formatInteger(summary.anomalies.length)}
- 写入成功: ${formatInteger(summary.inserted)}

## 按品类

| 品类 | 计算数 | 均值 lm/W | 范围 |
|------|--------|----------|------|
${buildCategoryRows(summary.plannedParams)}

## 异常值样本（前 10 条）

| 品类 | product_name | model_no | watts | lumens | 计算值 | 原因 |
|------|-------------|---------|-------|--------|--------|------|
${summary.anomalies
  .slice(0, 10)
  .map((row) => `| ${md(row.category)} | ${md(row.productName)} | ${md(row.modelNo ?? "-")} | ${md(row.watts ?? "-")} | ${md(row.lumens ?? "-")} | ${md(row.efficacy == null ? "-" : row.efficacy.toFixed(1))} | ${md(row.reason)} |`)
  .join("\n")}

## 写入样本（前 20 条）

| 品类 | product_name | model_no | watts | lumens | efficacy |
|------|-------------|---------|-------|--------|----------|
${summary.plannedParams
  .slice(0, 20)
  .map((param) => `| ${md(param.category)} | ${md(param.productName)} | ${md(param.modelNo ?? "-")} | ${md(param.watts)} | ${md(param.lumens)} | ${md(param.efficacy)} |`)
  .join("\n")}

## luminous_efficacy 覆盖率变化
- luminous_efficacy: ${formatInteger(summary.before.luminousEfficacyCovered)}/${formatInteger(summary.before.totalProducts)} (${formatPercent(summary.before.luminousEfficacyCovered, summary.before.totalProducts)}) → ${formatInteger(summary.after.luminousEfficacyCovered)}/${formatInteger(summary.after.totalProducts)} (${formatPercent(summary.after.luminousEfficacyCovered, summary.after.totalProducts)})
- product_params: ${formatInteger(summary.before.productParams)} → ${formatInteger(summary.after.productParams)}
- 新增 product_params: +${formatInteger(summary.after.productParams - summary.before.productParams)}

## 说明
- 只 INSERT 新 product_params，不 UPDATE / DELETE。
- source_field = ${SOURCE_FIELD}
- confidence = high
- efficacy = lumens / watts，且只写入 10-300 lm/W 范围内的结果。
`;
}

function buildCategoryRows(plannedParams: PlannedParam[]): string {
  const rows = new Map<string, number[]>();
  for (const param of plannedParams) {
    const values = rows.get(param.category) ?? [];
    values.push(param.efficacy);
    rows.set(param.category, values);
  }
  return [...rows.entries()]
    .sort((left, right) => right[1].length - left[1].length || left[0].localeCompare(right[0]))
    .map(([category, values]) => {
      const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
      return `| ${md(category)} | ${formatInteger(values.length)} | ${Math.round(avg)} | ${Math.min(...values)}-${Math.max(...values)} |`;
    })
    .join("\n");
}

function cleanCategory(value: string | null): string {
  const trimmed = value?.trim();
  return trimmed || "(未分类)";
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
