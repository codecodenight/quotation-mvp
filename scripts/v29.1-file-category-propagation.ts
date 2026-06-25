import "dotenv/config";

import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { PrismaClient } from "@prisma/client";

import { backupDatabase, chunks, formatInteger, formatPercent, INSERT_BATCH_SIZE, md } from "./v25-watts-shared";

const REPORT_PATH = path.join("docs", "v29.1-file-category-propagation-report.md");
const SOURCE_FIELD = "v29.1_file_propagation";

type Mode = "dry-run" | "apply";
type ParamKey = "beam_angle" | "material" | "ip" | "driver_type" | "pf";

const TARGET_PARAMS: ParamKey[] = ["beam_angle", "material", "ip", "driver_type", "pf"];

type UniformCombo = {
  source_file_id: string;
  file_name: string;
  category: string;
  uniform_val: string;
  raw_val: string;
  sample_count: number | bigint;
};

type MissingProduct = {
  product_id: string;
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
  paramKey: ParamKey;
  rawValue: string;
  normalizedValue: string;
  unit: string | null;
  fileName: string;
  sourceFileId: string;
  sampleCount: number;
};

type Coverage = {
  totalProducts: number;
  productParams: number;
  byParam: Map<ParamKey, number>;
};

type ParamStat = {
  uniformCombos: number;
  propagatedProducts: Set<string>;
  plannedCount: number;
};

type SkippedConflict = {
  productId: string;
  productName: string;
  category: string;
  paramKey: ParamKey;
  values: string[];
};

type Summary = {
  mode: Mode;
  backupPath: string | null;
  plannedParams: PlannedParam[];
  inserted: number;
  before: Coverage;
  after: Coverage;
  paramStats: Map<ParamKey, ParamStat>;
  categoryMatrix: Map<string, Map<ParamKey, number>>;
  skippedInvalid: number;
  skippedConflicts: SkippedConflict[];
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
          planned: summary.plannedParams.length,
          inserted: summary.inserted,
          skippedInvalid: summary.skippedInvalid,
          skippedConflicts: summary.skippedConflicts.length,
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
  console.log("V29.1 load uniform file-category combos");
  const before = await loadCoverage(prisma);
  const paramStats = new Map<ParamKey, ParamStat>();
  const categoryMatrix = new Map<string, Map<ParamKey, number>>();
  const candidateMap = new Map<string, PlannedParam[]>();
  let skippedInvalid = 0;

  for (const paramKey of TARGET_PARAMS) {
    const combos = await loadUniformCombos(prisma, paramKey);
    getParamStat(paramStats, paramKey).uniformCombos = combos.length;
    for (const combo of combos) {
      const normalized = validateValue(paramKey, combo.uniform_val);
      if (!normalized) {
        skippedInvalid += 1;
        continue;
      }
      const missingProducts = await loadMissingProducts(prisma, paramKey, combo);
      for (const product of missingProducts) {
        const planned: PlannedParam = {
          id: randomUUID(),
          productId: product.product_id,
          productName: product.product_name,
          modelNo: product.model_no,
          category: product.category,
          paramKey,
          rawValue: normalizeRawValue(paramKey, combo.raw_val || normalized),
          normalizedValue: normalized,
          unit: unitForParam(paramKey),
          fileName: combo.file_name,
          sourceFileId: combo.source_file_id,
          sampleCount: Number(combo.sample_count),
        };
        const key = `${product.product_id}\u0000${paramKey}`;
        const values = candidateMap.get(key) ?? [];
        values.push(planned);
        candidateMap.set(key, values);
      }
    }
  }

  const plannedParams: PlannedParam[] = [];
  const skippedConflicts: SkippedConflict[] = [];
  for (const candidates of candidateMap.values()) {
    const distinctValues = [...new Set(candidates.map((candidate) => candidate.normalizedValue))];
    if (distinctValues.length > 1) {
      const first = candidates[0];
      skippedConflicts.push({
        productId: first.productId,
        productName: first.productName,
        category: first.category,
        paramKey: first.paramKey,
        values: distinctValues,
      });
      continue;
    }
    const chosen = candidates.sort((left, right) => right.sampleCount - left.sampleCount || left.fileName.localeCompare(right.fileName))[0];
    plannedParams.push(chosen);
    const stat = getParamStat(paramStats, chosen.paramKey);
    stat.plannedCount += 1;
    stat.propagatedProducts.add(chosen.productId);
    const categoryRow = categoryMatrix.get(chosen.category) ?? new Map<ParamKey, number>();
    categoryRow.set(chosen.paramKey, (categoryRow.get(chosen.paramKey) ?? 0) + 1);
    categoryMatrix.set(chosen.category, categoryRow);
  }

  plannedParams.sort((left, right) => left.paramKey.localeCompare(right.paramKey) || left.category.localeCompare(right.category) || left.productName.localeCompare(right.productName));
  const backupPath = mode === "apply" ? await backupDatabase("v29.1") : null;
  const inserted = mode === "apply" ? await insertParams(prisma, plannedParams) : 0;
  const after = mode === "apply" ? await loadCoverage(prisma) : projectCoverage(before, plannedParams);
  return { mode, backupPath, plannedParams, inserted, before, after, paramStats, categoryMatrix, skippedInvalid, skippedConflicts };
}

async function loadUniformCombos(prisma: PrismaClient, paramKey: ParamKey): Promise<UniformCombo[]> {
  return prisma.$queryRaw<UniformCombo[]>`
    SELECT so.source_file_id,
           f.file_name,
           p.category,
           MIN(pp.normalized_value) AS uniform_val,
           MIN(pp.raw_value) AS raw_val,
           COUNT(DISTINCT p.id) AS sample_count
    FROM supplier_offers so
    JOIN files f
      ON f.id = so.source_file_id
    JOIN products p
      ON p.id = so.product_id
    JOIN product_params pp
      ON pp.product_id = p.id
    WHERE so.source_file_id IS NOT NULL
      AND p.category IS NOT NULL
      AND pp.param_key = ${paramKey}
      AND pp.normalized_value IS NOT NULL
      AND trim(pp.normalized_value) <> ''
    GROUP BY so.source_file_id, p.category
    HAVING COUNT(DISTINCT pp.normalized_value) = 1
       AND COUNT(DISTINCT p.id) >= 3
    ORDER BY f.file_name, p.category
  `;
}

async function loadMissingProducts(prisma: PrismaClient, paramKey: ParamKey, combo: UniformCombo): Promise<MissingProduct[]> {
  return prisma.$queryRaw<MissingProduct[]>`
    SELECT DISTINCT p.id AS product_id,
           p.product_name,
           p.model_no,
           p.category
    FROM supplier_offers so
    JOIN products p
      ON p.id = so.product_id
    WHERE so.source_file_id = ${combo.source_file_id}
      AND p.category = ${combo.category}
      AND NOT EXISTS (
        SELECT 1
        FROM product_params AS pp INDEXED BY product_params_product_id_idx
        WHERE pp.product_id = p.id
          AND pp.param_key = ${paramKey}
      )
    ORDER BY p.product_name
  `;
}

function validateValue(paramKey: ParamKey, raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (paramKey === "beam_angle") {
    const match = value.match(/(\d+(?:\.\d+)?)/);
    if (!match) return null;
    const number = Number(match[1]);
    if (number >= 1 && number <= 360) return formatNumber(number);
    return null;
  }
  if (paramKey === "ip") {
    const match = value.match(/^IP\s*(\d{2})$/i);
    return match ? `IP${match[1]}` : null;
  }
  if (paramKey === "material" || paramKey === "driver_type") {
    if (value.length < 2 || value.length > 50) return null;
    if (/^\d+(?:\.\d+)?$/.test(value)) return null;
    return value;
  }
  if (paramKey === "pf") {
    const match = value.match(/(\d+(?:\.\d+)?)/);
    if (!match) return null;
    const number = Number(match[1]);
    if (number >= 0.3 && number <= 1.0) return match[1];
    return null;
  }
  return null;
}

function normalizeRawValue(paramKey: ParamKey, value: string): string {
  if (paramKey === "beam_angle") return `${validateValue(paramKey, value) ?? value}°`;
  return validateValue(paramKey, value) ?? value;
}

function unitForParam(paramKey: ParamKey): string | null {
  if (paramKey === "beam_angle") return "°";
  return null;
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
  const rows = await prisma.$queryRaw<Array<{ param_key: ParamKey; covered: number | bigint }>>`
    SELECT param_key, COUNT(DISTINCT product_id) AS covered
    FROM product_params
    WHERE param_key IN ('beam_angle', 'material', 'ip', 'driver_type', 'pf')
    GROUP BY param_key
  `;
  const byParam = new Map<ParamKey, number>(TARGET_PARAMS.map((paramKey) => [paramKey, 0]));
  for (const row of rows) byParam.set(row.param_key, Number(row.covered));
  const [totalProducts, productParams] = await Promise.all([prisma.product.count(), prisma.productParam.count()]);
  return { totalProducts, productParams, byParam };
}

function projectCoverage(before: Coverage, plannedParams: PlannedParam[]): Coverage {
  const byParam = new Map(before.byParam);
  for (const [paramKey, count] of countByParam(plannedParams)) byParam.set(paramKey, (byParam.get(paramKey) ?? 0) + count);
  return { totalProducts: before.totalProducts, productParams: before.productParams + plannedParams.length, byParam };
}

function getParamStat(map: Map<ParamKey, ParamStat>, paramKey: ParamKey): ParamStat {
  const stat = map.get(paramKey) ?? { uniformCombos: 0, propagatedProducts: new Set<string>(), plannedCount: 0 };
  map.set(paramKey, stat);
  return stat;
}

function countByParam(plannedParams: PlannedParam[]): Map<ParamKey, number> {
  const counts = new Map<ParamKey, number>();
  for (const param of plannedParams) counts.set(param.paramKey, (counts.get(param.paramKey) ?? 0) + 1);
  return new Map([...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])));
}

function buildReport(summary: Summary): string {
  return `# V29.1 同文件同品类参数传播报告

模式: ${summary.mode}

## 备份
路径: ${summary.backupPath ?? "dry-run 未创建备份"}

## 统计

| param_key | uniform 组合数 | 传播到产品数 | 新增 product_params |
|-----------|-------------|------------|-------------------|
${TARGET_PARAMS.map((paramKey) => {
  const stat = summary.paramStats.get(paramKey) ?? { uniformCombos: 0, propagatedProducts: new Set<string>(), plannedCount: 0 };
  return `| ${paramKey} | ${formatInteger(stat.uniformCombos)} | ${formatInteger(stat.propagatedProducts.size)} | ${formatInteger(stat.plannedCount)} |`;
}).join("\n")}

## 按品类 top 20

| 品类 | beam_angle | material | ip | driver_type | pf | 总计 |
|------|-----------|---------|-----|-----------|-----|------|
${buildCategoryRows(summary.categoryMatrix)}

## 写入样本（每个 param_key 前 5 条）

${TARGET_PARAMS.map((paramKey) => buildSampleSection(paramKey, summary.plannedParams.filter((param) => param.paramKey === paramKey).slice(0, 5))).join("\n\n")}

## 覆盖率变化

| param_key | 之前 | 新增 | 之后 |
|-----------|------|------|------|
${TARGET_PARAMS.map((paramKey) => {
  const before = summary.before.byParam.get(paramKey) ?? 0;
  const after = summary.after.byParam.get(paramKey) ?? before;
  const added = after - before;
  return `| ${paramKey} | ${formatInteger(before)}/${formatInteger(summary.before.totalProducts)} (${formatPercent(before, summary.before.totalProducts)}) | +${formatInteger(added)} | ${formatInteger(after)}/${formatInteger(summary.after.totalProducts)} (${formatPercent(after, summary.after.totalProducts)}) |`;
}).join("\n")}

## 跳过
- uniform 值校验失败组合: ${formatInteger(summary.skippedInvalid)}
- 同一产品多文件传播值冲突: ${formatInteger(summary.skippedConflicts.length)}

## 冲突样本（前 20）

| 品类 | product_name | param_key | values |
|------|-------------|-----------|--------|
${summary.skippedConflicts
  .slice(0, 20)
  .map((row) => `| ${md(row.category)} | ${md(row.productName)} | ${md(row.paramKey)} | ${md(row.values.join(" / "))} |`)
  .join("\n")}

## product_params 总量变化
- product_params: ${formatInteger(summary.before.productParams)} → ${formatInteger(summary.after.productParams)}
- 新增 product_params: +${formatInteger(summary.after.productParams - summary.before.productParams)}

## 说明
- 只 INSERT 新 product_params，不 UPDATE / DELETE。
- uniform 组合要求同文件、同品类、同参数 normalized_value 100% 一致，且至少 3 个已知产品样本。
- 同一产品如果从多个文件得到不同传播值，跳过不写。
- source_field = ${SOURCE_FIELD}
- confidence = medium
`;
}

function buildCategoryRows(categoryMatrix: Map<string, Map<ParamKey, number>>): string {
  return [...categoryMatrix.entries()]
    .sort((left, right) => sumMap(right[1]) - sumMap(left[1]) || left[0].localeCompare(right[0]))
    .slice(0, 20)
    .map(([category, values]) => {
      const total = sumMap(values);
      return `| ${md(category)} | ${formatInteger(values.get("beam_angle") ?? 0)} | ${formatInteger(values.get("material") ?? 0)} | ${formatInteger(values.get("ip") ?? 0)} | ${formatInteger(values.get("driver_type") ?? 0)} | ${formatInteger(values.get("pf") ?? 0)} | ${formatInteger(total)} |`;
    })
    .join("\n");
}

function buildSampleSection(paramKey: ParamKey, samples: PlannedParam[]): string {
  return `### ${paramKey}

| 文件名 | 品类 | uniform 值 | 被填 product_name | model_no | 样本数 |
|--------|------|------------|-------------------|----------|--------|
${samples.map((param) => `| ${md(param.fileName)} | ${md(param.category)} | ${md(param.normalizedValue)} | ${md(param.productName)} | ${md(param.modelNo ?? "-")} | ${formatInteger(param.sampleCount)} |`).join("\n")}`;
}

function sumMap(values: Map<ParamKey, number>): number {
  let total = 0;
  for (const value of values.values()) total += value;
  return total;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)));
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
