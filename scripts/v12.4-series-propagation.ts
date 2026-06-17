import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

import { escapeMd, INSERT_BATCH_SIZE, productParamKey } from "./v11-shared";

const prisma = new PrismaClient();

const APPLY_MODE = process.argv.includes("--apply");
const BACKUP_PATH = path.join("prisma", "dev.db.bak-v12.4");
const REPORT_PATH = path.join("docs", "v12.4-series-propagation-report.md");
const PROPAGATABLE_PARAMS = ["voltage", "cct", "cri", "pf", "driver_type", "material"] as const;

type PropagatableParam = (typeof PROPAGATABLE_PARAMS)[number];
type DbCount = bigint | number | null;

type BasicCounts = {
  products: number;
  productParams: number;
};

type ProductRow = {
  product_id: string;
  product_name: string;
  model_no: string | null;
  category: string;
  factory_name: string | null;
};

type ExistingParamRow = {
  product_id: string;
  param_key: string;
  raw_value: string;
  normalized_value: string | null;
  unit: string | null;
};

type SeriesProduct = ProductRow & {
  seriesPrefix: string;
};

type SeriesGroup = {
  factoryName: string;
  category: string;
  seriesPrefix: string;
  products: SeriesProduct[];
};

type PlannedParam = {
  id: string;
  productId: string;
  productModel: string;
  productName: string;
  factoryName: string;
  category: string;
  seriesPrefix: string;
  paramKey: PropagatableParam;
  rawValue: string;
  normalizedValue: string;
  unit: string | null;
};

type PropagationSample = {
  factoryName: string;
  category: string;
  seriesPrefix: string;
  paramKey: PropagatableParam;
  value: string;
  groupProducts: number;
  ratio: number;
  benefitedProducts: number;
};

type CoverageRow = {
  paramKey: string;
  before: number;
  after: number;
  totalProducts: number;
};

type SeriesStats = {
  validModelProducts: number;
  prefixProducts: number;
  seriesGroups: number;
};

async function main() {
  if (!existsSync(BACKUP_PATH)) {
    throw new Error(`Missing DB backup: ${BACKUP_PATH}`);
  }

  const beforeCounts = await loadBasicCounts();
  const coverageBefore = await loadCoverage(PROPAGATABLE_PARAMS);
  const products = await loadProductsWithFactory();
  const existingParams = await loadExistingParams();
  const existingParamKeys = buildExistingParamKeys(existingParams);
  const paramsByProduct = buildParamsByProduct(existingParams);
  const { stats, groups } = buildSeriesGroups(products);
  const { plannedParams, samples } = planSeriesPropagation(groups, paramsByProduct, existingParamKeys);
  const inserted = await insertPlannedParams(plannedParams);
  const afterCounts = await loadBasicCounts();
  const coverageAfter = await loadCoverage(PROPAGATABLE_PARAMS);
  const coverageRows = buildCoverageRows(coverageBefore, coverageAfter, afterCounts.products);

  await mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await writeFile(
    REPORT_PATH,
    buildReport({
      beforeCounts,
      afterCounts,
      stats,
      plannedParams,
      samples,
      inserted,
      coverageRows,
    }),
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        mode: APPLY_MODE ? "apply" : "dry-run",
        reportPath: REPORT_PATH,
        validModelProducts: stats.validModelProducts,
        prefixProducts: stats.prefixProducts,
        seriesGroups: stats.seriesGroups,
        plannedParams: plannedParams.length,
        inserted,
        productParamsBefore: beforeCounts.productParams,
        productParamsAfter: afterCounts.productParams,
      },
      null,
      2,
    ),
  );
}

async function loadBasicCounts(): Promise<BasicCounts> {
  const rows = await prisma.$queryRawUnsafe<Array<{ products: DbCount; product_params: DbCount }>>(`
    SELECT
      (SELECT COUNT(*) FROM products) as products,
      (SELECT COUNT(*) FROM product_params) as product_params
  `);
  return {
    products: toNumber(rows[0]?.products),
    productParams: toNumber(rows[0]?.product_params),
  };
}

async function loadProductsWithFactory(): Promise<ProductRow[]> {
  return prisma.$queryRawUnsafe<ProductRow[]>(`
    SELECT
      p.id as product_id,
      p.product_name,
      p.model_no,
      COALESCE(NULLIF(TRIM(p.category), ''), '未分类') as category,
      (
        SELECT so.factory_name
        FROM supplier_offers so
        WHERE so.product_id = p.id
          AND so.factory_name IS NOT NULL
          AND TRIM(so.factory_name) != ''
        ORDER BY so.created_at ASC, so.id ASC
        LIMIT 1
      ) as factory_name
    FROM products p
  `);
}

async function loadExistingParams(): Promise<ExistingParamRow[]> {
  return prisma.$queryRawUnsafe<ExistingParamRow[]>(`
    SELECT product_id, param_key, raw_value, normalized_value, unit
    FROM product_params
    WHERE param_key IN ('voltage', 'cct', 'cri', 'pf', 'driver_type', 'material')
      AND normalized_value IS NOT NULL
      AND TRIM(normalized_value) != ''
  `);
}

async function loadCoverage(paramKeys: readonly string[]): Promise<Map<string, number>> {
  const placeholders = paramKeys.map(() => "?").join(", ");
  const rows = await prisma.$queryRawUnsafe<Array<{ param_key: string; product_count: DbCount }>>(
    `
      SELECT param_key, COUNT(DISTINCT product_id) as product_count
      FROM product_params
      WHERE param_key IN (${placeholders})
      GROUP BY param_key
    `,
    ...paramKeys,
  );
  return new Map(rows.map((row) => [row.param_key, toNumber(row.product_count)]));
}

function extractSeriesPrefix(modelNo: string): string | null {
  if (!modelNo || modelNo.length < 3) {
    return null;
  }

  const original = modelNo.trim();
  if (original.length < 3) {
    return null;
  }

  let prefix = original;
  prefix = prefix.replace(/[-\s]\d+[Ww]$/i, "");
  prefix = prefix.replace(/[-\s]\d{2,}$/, "");
  prefix = prefix.trim();

  if (prefix.length < 3 || prefix === original) {
    return null;
  }

  return prefix;
}

function buildSeriesGroups(products: ProductRow[]): { stats: SeriesStats; groups: SeriesGroup[] } {
  let validModelProducts = 0;
  let prefixProducts = 0;
  const grouped = new Map<string, SeriesGroup>();

  for (const product of products) {
    const modelNo = product.model_no?.trim();
    if (!modelNo || modelNo.length < 3) {
      continue;
    }
    validModelProducts += 1;

    const seriesPrefix = extractSeriesPrefix(modelNo);
    const factoryName = product.factory_name?.trim();
    if (!seriesPrefix || !factoryName) {
      continue;
    }
    prefixProducts += 1;

    const key = `${factoryName}\u0000${product.category}\u0000${seriesPrefix}`;
    const group = grouped.get(key) ?? { factoryName, category: product.category, seriesPrefix, products: [] };
    group.products.push({ ...product, factory_name: factoryName, seriesPrefix });
    grouped.set(key, group);
  }

  const groups = Array.from(grouped.values()).filter((group) => group.products.length >= 3);
  return {
    stats: {
      validModelProducts,
      prefixProducts,
      seriesGroups: groups.length,
    },
    groups,
  };
}

function buildExistingParamKeys(rows: ExistingParamRow[]): Set<string> {
  const keys = new Set<string>();
  for (const row of rows) {
    keys.add(productParamKey(row.product_id, row.param_key));
  }
  return keys;
}

function buildParamsByProduct(rows: ExistingParamRow[]): Map<string, Map<string, ExistingParamRow[]>> {
  const byProduct = new Map<string, Map<string, ExistingParamRow[]>>();
  for (const row of rows) {
    const productMap = byProduct.get(row.product_id) ?? new Map<string, ExistingParamRow[]>();
    const params = productMap.get(row.param_key) ?? [];
    params.push(row);
    productMap.set(row.param_key, params);
    byProduct.set(row.product_id, productMap);
  }
  return byProduct;
}

function planSeriesPropagation(
  groups: SeriesGroup[],
  paramsByProduct: Map<string, Map<string, ExistingParamRow[]>>,
  existingParamKeys: Set<string>,
): { plannedParams: PlannedParam[]; samples: PropagationSample[] } {
  const plannedParams: PlannedParam[] = [];
  const samples: PropagationSample[] = [];

  for (const group of groups) {
    for (const paramKey of PROPAGATABLE_PARAMS) {
      const existingValues = group.products.flatMap((product) => paramsByProduct.get(product.product_id)?.get(paramKey) ?? []);
      const distribution = countValues(existingValues);
      const dominant = getDominantValue(distribution);
      if (!dominant) {
        continue;
      }

      const totalWithParam = sumCounts(distribution);
      if (dominant.count < 2 || dominant.count / totalWithParam < 0.7) {
        continue;
      }

      const missingProducts = group.products.filter((product) => !existingParamKeys.has(productParamKey(product.product_id, paramKey)));
      if (missingProducts.length === 0) {
        continue;
      }

      const representative = existingValues.find((param) => param.normalized_value?.trim() === dominant.value);
      const rawValue = representative?.raw_value ?? dominant.value;
      const unit = representative?.unit ?? null;

      for (const product of missingProducts) {
        plannedParams.push({
          id: randomUUID(),
          productId: product.product_id,
          productModel: product.model_no ?? "",
          productName: product.product_name,
          factoryName: group.factoryName,
          category: group.category,
          seriesPrefix: group.seriesPrefix,
          paramKey,
          rawValue,
          normalizedValue: dominant.value,
          unit,
        });
        existingParamKeys.add(productParamKey(product.product_id, paramKey));
      }

      samples.push({
        factoryName: group.factoryName,
        category: group.category,
        seriesPrefix: group.seriesPrefix,
        paramKey,
        value: dominant.value,
        groupProducts: group.products.length,
        ratio: dominant.count / totalWithParam,
        benefitedProducts: missingProducts.length,
      });
    }
  }

  return { plannedParams, samples };
}

function countValues(rows: ExistingParamRow[]): Map<string, number> {
  const distribution = new Map<string, number>();
  const seenProductValue = new Set<string>();
  for (const row of rows) {
    const value = row.normalized_value?.trim();
    if (!value) {
      continue;
    }

    const key = `${row.product_id}\u0000${row.param_key}\u0000${value}`;
    if (seenProductValue.has(key)) {
      continue;
    }
    seenProductValue.add(key);
    distribution.set(value, (distribution.get(value) ?? 0) + 1);
  }
  return distribution;
}

function getDominantValue(distribution: Map<string, number>): { value: string; count: number } | null {
  let result: { value: string; count: number } | null = null;
  for (const [value, count] of distribution) {
    if (!result || count > result.count || (count === result.count && value.localeCompare(result.value) < 0)) {
      result = { value, count };
    }
  }
  return result;
}

function sumCounts(distribution: Map<string, number>): number {
  return Array.from(distribution.values()).reduce((sum, count) => sum + count, 0);
}

async function insertPlannedParams(plannedParams: PlannedParam[]): Promise<number> {
  if (!APPLY_MODE || plannedParams.length === 0) {
    return 0;
  }

  let inserted = 0;
  for (let index = 0; index < plannedParams.length; index += INSERT_BATCH_SIZE) {
    const batch = plannedParams.slice(index, index + INSERT_BATCH_SIZE);
    const result = await prisma.productParam.createMany({
      data: batch.map((param) => ({
        id: param.id,
        productId: param.productId,
        paramKey: param.paramKey,
        rawValue: param.rawValue,
        normalizedValue: param.normalizedValue,
        unit: param.unit,
        sourceField: "series_propagation",
        confidence: "low",
      })),
    });
    inserted += result.count;
  }
  return inserted;
}

function buildCoverageRows(before: Map<string, number>, after: Map<string, number>, totalProducts: number): CoverageRow[] {
  return PROPAGATABLE_PARAMS.map((paramKey) => ({
    paramKey,
    before: before.get(paramKey) ?? 0,
    after: after.get(paramKey) ?? 0,
    totalProducts,
  }));
}

function groupSamplesByParam(samples: PropagationSample[], plannedParams: PlannedParam[]): Map<string, { groups: number; params: number; products: Set<string> }> {
  const grouped = new Map<string, { groups: number; params: number; products: Set<string> }>();
  for (const sample of samples) {
    const existing = grouped.get(sample.paramKey) ?? { groups: 0, params: 0, products: new Set<string>() };
    existing.groups += 1;
    grouped.set(sample.paramKey, existing);
  }
  for (const param of plannedParams) {
    const existing = grouped.get(param.paramKey) ?? { groups: 0, params: 0, products: new Set<string>() };
    existing.params += 1;
    existing.products.add(param.productId);
    grouped.set(param.paramKey, existing);
  }
  return grouped;
}

function buildReport(input: {
  beforeCounts: BasicCounts;
  afterCounts: BasicCounts;
  stats: SeriesStats;
  plannedParams: PlannedParam[];
  inserted: number;
  samples: PropagationSample[];
  coverageRows: CoverageRow[];
}): string {
  const grouped = groupSamplesByParam(input.samples, input.plannedParams);
  const lines: string[] = [];
  lines.push("# V12.4 同系列参数传播报告");
  lines.push("");
  lines.push(`模式: ${APPLY_MODE ? "apply" : "dry-run"}`);
  lines.push(`时间: ${new Date().toISOString()}`);
  lines.push(`备份: ${BACKUP_PATH}`);
  lines.push("");
  lines.push("## 系列分组统计");
  lines.push("");
  lines.push("| 指标 | 数值 |");
  lines.push("|---|---:|");
  lines.push(`| 有效 model_no 产品 | ${input.stats.validModelProducts.toLocaleString()} |`);
  lines.push(`| 提取到系列前缀 | ${input.stats.prefixProducts.toLocaleString()} |`);
  lines.push(`| 系列组数（≥3 产品） | ${input.stats.seriesGroups.toLocaleString()} |`);
  lines.push("");
  lines.push("## 传播结果");
  lines.push("");
  lines.push("| param_key | 触发系列组 | 新增 params | 受益产品 |");
  lines.push("|---|---:|---:|---:|");
  for (const paramKey of PROPAGATABLE_PARAMS) {
    const row = grouped.get(paramKey) ?? { groups: 0, params: 0, products: new Set<string>() };
    lines.push(`| ${paramKey} | ${row.groups.toLocaleString()} | ${row.params.toLocaleString()} | ${row.products.size.toLocaleString()} |`);
  }
  lines.push("");
  lines.push("### 采样（前 50 条）");
  lines.push("");
  lines.push("| factory | category | series_prefix | param_key | value | 系列产品数 | 已有占比 | 受益产品 |");
  lines.push("|---|---|---|---|---|---:|---:|---:|");
  for (const sample of input.samples.slice(0, 50)) {
    lines.push(
      `| ${escapeMd(sample.factoryName)} | ${escapeMd(sample.category)} | ${escapeMd(sample.seriesPrefix)} | ${sample.paramKey} | ${escapeMd(
        sample.value,
      )} | ${sample.groupProducts.toLocaleString()} | ${formatPercent(sample.ratio)} | ${sample.benefitedProducts.toLocaleString()} |`,
    );
  }
  if (input.samples.length === 0) {
    lines.push("| - | - | - | - | - | 0 | 0% | 0 |");
  }
  lines.push("");
  lines.push("## 覆盖率变化");
  lines.push("");
  lines.push("| param_key | 之前 | 之后 | 变化 | 覆盖率 |");
  lines.push("|---|---:|---:|---:|---:|");
  for (const row of input.coverageRows) {
    lines.push(
      `| ${row.paramKey} | ${row.before.toLocaleString()} | ${row.after.toLocaleString()} | ${(row.after - row.before).toLocaleString()} | ${formatPercent(
        row.totalProducts > 0 ? row.after / row.totalProducts : 0,
      )} |`,
    );
  }
  lines.push("");
  lines.push("## 汇总");
  lines.push("");
  lines.push("| 指标 | 数值 |");
  lines.push("|---|---:|");
  lines.push(`| 新增 params | ${(APPLY_MODE ? input.inserted : input.plannedParams.length).toLocaleString()} |`);
  lines.push(`| product_params 变化 | ${input.beforeCounts.productParams.toLocaleString()} → ${input.afterCounts.productParams.toLocaleString()} |`);
  lines.push("");
  lines.push("## 说明");
  lines.push("");
  lines.push("- 系列前缀按尾部瓦数或尾部纯数字段截断。无法提取前缀的型号跳过。");
  lines.push("- 传播阈值：系列内已有该参数产品中主导值占比 >= 70%，且至少 2 个产品有该值。");
  lines.push("- 不覆盖已有参数，不删除产品/参数，不修改源 Excel 文件。");
  lines.push("");
  return lines.join("\n");
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function toNumber(value: DbCount): number {
  if (typeof value === "bigint") {
    return Number(value);
  }
  return value ?? 0;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
