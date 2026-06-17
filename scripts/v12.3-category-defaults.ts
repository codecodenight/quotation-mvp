import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

import { escapeMd, INSERT_BATCH_SIZE, productParamKey } from "./v11-shared";

const prisma = new PrismaClient();

const APPLY_MODE = process.argv.includes("--apply");
const BACKUP_PATH = path.join("prisma", "dev.db.bak-v12.3");
const REPORT_PATH = path.join("docs", "v12.3-category-defaults-report.md");

const FACTORY_CATEGORY_PARAM_KEYS = ["voltage", "cri", "pf", "driver_type", "cct"] as const;
const COVERAGE_KEYS = ["voltage", "cri", "pf", "driver_type", "cct"] as const;

const CATEGORY_DEFAULTS: CategoryDefault[] = [
  { category: "线条灯", paramKey: "cri", value: "80", unit: null, rawValue: "CRI≥80" },
  { category: "筒灯", paramKey: "cri", value: "80", unit: null, rawValue: "CRI≥80" },
  { category: "磁吸灯", paramKey: "cri", value: "90", unit: null, rawValue: "CRI≥90" },
  { category: "灯丝灯", paramKey: "cri", value: "80", unit: null, rawValue: "CRI≥80" },
  { category: "太阳能壁灯", paramKey: "cri", value: "80", unit: null, rawValue: "CRI≥80" },
  { category: "风扇灯", paramKey: "cri", value: "80", unit: null, rawValue: "CRI≥80" },
  { category: "吸顶灯", paramKey: "cri", value: "80", unit: null, rawValue: "CRI≥80" },
  { category: "三防灯", paramKey: "cri", value: "80", unit: null, rawValue: "CRI≥80" },
  { category: "太阳能", paramKey: "cri", value: "80", unit: null, rawValue: "CRI≥80" },
  { category: "路灯", paramKey: "cri", value: "80", unit: null, rawValue: "CRI≥80" },
  { category: "轨道灯", paramKey: "cri", value: "80", unit: null, rawValue: "CRI≥80" },
  { category: "地埋灯/地插灯", paramKey: "cri", value: "80", unit: null, rawValue: "CRI≥80" },
  { category: "筒灯", paramKey: "pf", value: "0.5", unit: null, rawValue: "PF≥0.5" },
  { category: "灯丝灯", paramKey: "pf", value: "0.5", unit: null, rawValue: "PF≥0.5" },
  { category: "太阳能壁灯", paramKey: "pf", value: "0.5", unit: null, rawValue: "PF≥0.5" },
  { category: "投光灯", paramKey: "pf", value: "0.9", unit: null, rawValue: "PF≥0.9" },
  { category: "灯带", paramKey: "pf", value: "0.5", unit: null, rawValue: "PF≥0.5" },
  { category: "太阳能", paramKey: "pf", value: "0.9", unit: null, rawValue: "PF≥0.9" },
  { category: "路灯", paramKey: "pf", value: "0.9", unit: null, rawValue: "PF≥0.9" },
  { category: "轨道灯", paramKey: "pf", value: "0.5", unit: null, rawValue: "PF≥0.5" },
  { category: "应急灯", paramKey: "pf", value: "0.5", unit: null, rawValue: "PF≥0.5" },
  { category: "灯管", paramKey: "pf", value: "0.5", unit: null, rawValue: "PF≥0.5" },
  { category: "地埋灯/地插灯", paramKey: "pf", value: "0.5", unit: null, rawValue: "PF≥0.5" },
  { category: "净化灯", paramKey: "pf", value: "0.5", unit: null, rawValue: "PF≥0.5" },
  { category: "灯丝灯", paramKey: "driver_type", value: "LC", unit: null, rawValue: "LC" },
  { category: "壁灯", paramKey: "driver_type", value: "非隔离", unit: null, rawValue: "非隔离" },
  { category: "镜前灯", paramKey: "driver_type", value: "隔离", unit: null, rawValue: "隔离" },
  { category: "灯丝灯", paramKey: "voltage", value: "220-240", unit: "V", rawValue: "220-240V" },
  { category: "轨道灯", paramKey: "voltage", value: "220-240", unit: "V", rawValue: "220-240V" },
  { category: "风扇灯", paramKey: "voltage", value: "110-265", unit: "V", rawValue: "110-265V" },
];

type FactoryCategoryParamKey = (typeof FACTORY_CATEGORY_PARAM_KEYS)[number];
type CoverageKey = (typeof COVERAGE_KEYS)[number];

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
  source_field: string;
};

type PlannedParam = {
  id: string;
  productId: string;
  productModel: string;
  productName: string;
  category: string;
  factoryName: string | null;
  paramKey: string;
  rawValue: string;
  normalizedValue: string;
  unit: string | null;
  sourceField: "factory_category_propagation" | "category_default";
  confidence: "low";
};

type PartAGroupSample = {
  factoryName: string;
  category: string;
  paramKey: string;
  value: string;
  groupProducts: number;
  ratio: number;
  benefitedProducts: number;
};

type PartAResult = {
  plannedParams: PlannedParam[];
  inserted: number;
  samples: PartAGroupSample[];
};

type CategoryDefault = {
  category: string;
  paramKey: "voltage" | "cri" | "pf" | "driver_type";
  value: string;
  unit: string | null;
  rawValue: string;
};

type DefaultValidation = {
  defaultValue: CategoryDefault;
  sampleCount: number;
  dominantCount: number;
  ratio: number;
  status: "通过" | "跳过";
  reason: string;
  missingProducts: ProductRow[];
  plannedParams: PlannedParam[];
};

type PartBResult = {
  validations: DefaultValidation[];
  plannedParams: PlannedParam[];
  inserted: number;
};

type CoverageRow = {
  paramKey: string;
  before: number;
  after: number;
  totalProducts: number;
};

async function main() {
  if (!existsSync(BACKUP_PATH)) {
    throw new Error(`Missing DB backup: ${BACKUP_PATH}`);
  }

  const beforeCounts = await loadBasicCounts();
  const coverageBefore = await loadCoverage(COVERAGE_KEYS);
  const products = await loadProductsWithFactory();
  const existingParams = await loadExistingParams();
  const existingParamKeys = buildExistingParamKeys(existingParams);
  const paramsByProduct = buildParamsByProduct(existingParams);

  const partA = await runPartA(products, paramsByProduct, existingParamKeys);
  addPlannedKeys(existingParamKeys, partA.plannedParams);

  const partB = await runPartB(products, paramsByProduct, existingParamKeys);

  const afterCounts = await loadBasicCounts();
  const coverageAfter = await loadCoverage(COVERAGE_KEYS);
  const coverageRows = buildCoverageRows(coverageBefore, coverageAfter, afterCounts.products);

  await mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await writeFile(REPORT_PATH, buildReport({ beforeCounts, afterCounts, partA, partB, coverageRows }), "utf8");

  console.log(
    JSON.stringify(
      {
        mode: APPLY_MODE ? "apply" : "dry-run",
        reportPath: REPORT_PATH,
        partAPlanned: partA.plannedParams.length,
        partAInserted: partA.inserted,
        partBPlanned: partB.plannedParams.length,
        partBInserted: partB.inserted,
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
    SELECT product_id, param_key, raw_value, normalized_value, unit, source_field
    FROM product_params
    WHERE normalized_value IS NOT NULL
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

async function runPartA(
  products: ProductRow[],
  paramsByProduct: Map<string, Map<string, ExistingParamRow[]>>,
  existingParamKeys: Set<string>,
): Promise<PartAResult> {
  const groupedProducts = groupProductsByFactoryCategory(products);
  const plannedParams: PlannedParam[] = [];
  const samples: PartAGroupSample[] = [];

  for (const group of groupedProducts.values()) {
    if (group.products.length < 5) {
      continue;
    }

    for (const paramKey of FACTORY_CATEGORY_PARAM_KEYS) {
      const withParam = group.products
        .map((product) => ({
          product,
          params: paramsByProduct.get(product.product_id)?.get(paramKey) ?? [],
        }))
        .filter((entry) => entry.params.length > 0);

      if (withParam.length === 0) {
        continue;
      }

      const distribution = countValues(withParam.flatMap((entry) => entry.params));
      const dominant = getDominantValue(distribution);
      const groupRatio = dominant ? dominant.count / group.products.length : 0;
      if (!dominant || dominant.count < 5 || groupRatio < 0.6) {
        continue;
      }

      const missingProducts = group.products.filter((product) => !existingParamKeys.has(productParamKey(product.product_id, paramKey)));
      if (missingProducts.length === 0) {
        continue;
      }

      const representative = withParam
        .flatMap((entry) => entry.params)
        .find((param) => param.normalized_value === dominant.value);
      const unit = representative?.unit ?? null;
      const rawValue = representative?.raw_value ?? dominant.value;

      for (const product of missingProducts) {
        plannedParams.push({
          id: randomUUID(),
          productId: product.product_id,
          productModel: product.model_no ?? "",
          productName: product.product_name,
          category: product.category,
          factoryName: product.factory_name,
          paramKey,
          rawValue,
          normalizedValue: dominant.value,
          unit,
          sourceField: "factory_category_propagation",
          confidence: "low",
        });
      }

      samples.push({
        factoryName: group.factoryName,
        category: group.category,
        paramKey,
        value: dominant.value,
        groupProducts: group.products.length,
        ratio: groupRatio,
        benefitedProducts: missingProducts.length,
      });
    }
  }

  return {
    plannedParams,
    inserted: await insertPlannedParams(plannedParams),
    samples,
  };
}

function groupProductsByFactoryCategory(products: ProductRow[]): Map<string, { factoryName: string; category: string; products: ProductRow[] }> {
  const grouped = new Map<string, { factoryName: string; category: string; products: ProductRow[] }>();
  for (const product of products) {
    const factoryName = product.factory_name?.trim();
    if (!factoryName) {
      continue;
    }

    const key = `${factoryName}\u0000${product.category}`;
    const group = grouped.get(key) ?? { factoryName, category: product.category, products: [] };
    group.products.push(product);
    grouped.set(key, group);
  }
  return grouped;
}

async function runPartB(
  products: ProductRow[],
  paramsByProduct: Map<string, Map<string, ExistingParamRow[]>>,
  existingParamKeys: Set<string>,
): Promise<PartBResult> {
  const productsByCategory = groupProductsByCategory(products);
  const plannedParams: PlannedParam[] = [];
  const validations: DefaultValidation[] = [];

  for (const defaultValue of CATEGORY_DEFAULTS) {
    const categoryProducts = productsByCategory.get(defaultValue.category) ?? [];
    const distribution = countValues(
      categoryProducts.flatMap((product) => paramsByProduct.get(product.product_id)?.get(defaultValue.paramKey) ?? []),
    );
    const sampleCount = sumCounts(distribution);
    const dominantCount = distribution.get(defaultValue.value) ?? 0;
    const ratio = sampleCount > 0 ? dominantCount / sampleCount : 0;
    const missingProducts = categoryProducts.filter(
      (product) => !existingParamKeys.has(productParamKey(product.product_id, defaultValue.paramKey)),
    );

    const validation: DefaultValidation = {
      defaultValue,
      sampleCount,
      dominantCount,
      ratio,
      status: sampleCount >= 10 && ratio >= 0.85 ? "通过" : "跳过",
      reason: sampleCount < 10 ? "样本数 < 10" : ratio < 0.85 ? "主导值占比 < 85%" : "通过",
      missingProducts,
      plannedParams: [],
    };

    if (validation.status === "通过") {
      for (const product of missingProducts) {
        validation.plannedParams.push({
          id: randomUUID(),
          productId: product.product_id,
          productModel: product.model_no ?? "",
          productName: product.product_name,
          category: product.category,
          factoryName: product.factory_name,
          paramKey: defaultValue.paramKey,
          rawValue: defaultValue.rawValue,
          normalizedValue: defaultValue.value,
          unit: defaultValue.unit,
          sourceField: "category_default",
          confidence: "low",
        });
      }
      plannedParams.push(...validation.plannedParams);
    }

    validations.push(validation);
  }

  return {
    validations,
    plannedParams,
    inserted: await insertPlannedParams(plannedParams),
  };
}

function groupProductsByCategory(products: ProductRow[]): Map<string, ProductRow[]> {
  const grouped = new Map<string, ProductRow[]>();
  for (const product of products) {
    const rows = grouped.get(product.category) ?? [];
    rows.push(product);
    grouped.set(product.category, rows);
  }
  return grouped;
}

function countValues(rows: ExistingParamRow[]): Map<string, number> {
  const distribution = new Map<string, number>();
  const seenProductValue = new Set<string>();
  for (const row of rows) {
    const value = row.normalized_value?.trim();
    if (!value) {
      continue;
    }

    const dedupeKey = `${row.product_id}\u0000${row.param_key}\u0000${value}`;
    if (seenProductValue.has(dedupeKey)) {
      continue;
    }
    seenProductValue.add(dedupeKey);
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
        sourceField: param.sourceField,
        confidence: param.confidence,
      })),
    });
    inserted += result.count;
  }
  return inserted;
}

function addPlannedKeys(existingParamKeys: Set<string>, plannedParams: PlannedParam[]) {
  for (const param of plannedParams) {
    existingParamKeys.add(productParamKey(param.productId, param.paramKey));
  }
}

function buildCoverageRows(before: Map<string, number>, after: Map<string, number>, totalProducts: number): CoverageRow[] {
  return COVERAGE_KEYS.map((paramKey) => ({
    paramKey,
    before: before.get(paramKey) ?? 0,
    after: after.get(paramKey) ?? 0,
    totalProducts,
  }));
}

function buildReport(input: {
  beforeCounts: BasicCounts;
  afterCounts: BasicCounts;
  partA: PartAResult;
  partB: PartBResult;
  coverageRows: CoverageRow[];
}): string {
  const lines: string[] = [];
  lines.push("# V12.3 工厂+品类传播 + 品类默认值报告");
  lines.push("");
  lines.push(`模式: ${APPLY_MODE ? "apply" : "dry-run"}`);
  lines.push(`时间: ${new Date().toISOString()}`);
  lines.push(`备份: ${BACKUP_PATH}`);
  lines.push("");
  lines.push("## Part A — 工厂+品类传播");
  lines.push("");
  lines.push("| param_key | 传播组数 | 新增 params |");
  lines.push("|---|---:|---:|");
  for (const [paramKey, summary] of groupPartAByParam(input.partA.samples, input.partA.plannedParams)) {
    lines.push(`| ${paramKey} | ${summary.groups.toLocaleString()} | ${summary.params.toLocaleString()} |`);
  }
  if (input.partA.plannedParams.length === 0) {
    lines.push("| - | 0 | 0 |");
  }
  lines.push("");
  lines.push("### Part A 采样（前 30 条）");
  lines.push("");
  lines.push("| factory | category | param_key | value | 组内产品 | 已有占比 | 受益产品 |");
  lines.push("|---|---|---|---|---:|---:|---:|");
  for (const sample of input.partA.samples.slice(0, 30)) {
    lines.push(
      `| ${escapeMd(sample.factoryName)} | ${escapeMd(sample.category)} | ${sample.paramKey} | ${escapeMd(sample.value)} | ${sample.groupProducts.toLocaleString()} | ${formatPercent(
        sample.ratio,
      )} | ${sample.benefitedProducts.toLocaleString()} |`,
    );
  }
  if (input.partA.samples.length === 0) {
    lines.push("| - | - | - | - | 0 | 0% | 0 |");
  }
  lines.push("");
  lines.push("## Part B — 品类默认值");
  lines.push("");
  lines.push("### 验证结果");
  lines.push("");
  lines.push("| category | param_key | value | 样本数 | 占比 | 状态 |");
  lines.push("|---|---|---|---:|---:|---|");
  for (const validation of input.partB.validations) {
    lines.push(
      `| ${escapeMd(validation.defaultValue.category)} | ${validation.defaultValue.paramKey} | ${escapeMd(
        validation.defaultValue.value,
      )} | ${validation.sampleCount.toLocaleString()} | ${formatPercent(validation.ratio)} | ${validation.status}${
        validation.status === "跳过" ? `: ${validation.reason}` : ""
      } |`,
    );
  }
  lines.push("");
  lines.push("### 按品类×参数插入明细");
  lines.push("");
  lines.push("| category | param_key | value | 缺口产品 | 实际新增 |");
  lines.push("|---|---|---|---:|---:|");
  for (const validation of input.partB.validations.filter((validation) => validation.status === "通过")) {
    lines.push(
      `| ${escapeMd(validation.defaultValue.category)} | ${validation.defaultValue.paramKey} | ${escapeMd(
        validation.defaultValue.value,
      )} | ${validation.missingProducts.length.toLocaleString()} | ${validation.plannedParams.length.toLocaleString()} |`,
    );
  }
  lines.push("");
  lines.push("### Part B 采样（前 50 条）");
  lines.push("");
  lines.push("| category | param_key | value | product model_no | product_name |");
  lines.push("|---|---|---|---|---|");
  for (const sample of input.partB.plannedParams.slice(0, 50)) {
    lines.push(
      `| ${escapeMd(sample.category)} | ${sample.paramKey} | ${escapeMd(sample.normalizedValue)} | ${escapeMd(
        sample.productModel || "-",
      )} | ${escapeMd(sample.productName)} |`,
    );
  }
  if (input.partB.plannedParams.length === 0) {
    lines.push("| - | - | - | - | - |");
  }
  lines.push("");
  lines.push("## 汇总");
  lines.push("");
  lines.push("| 指标 | 数值 |");
  lines.push("|---|---:|");
  lines.push(`| Part A 新增 | ${(APPLY_MODE ? input.partA.inserted : input.partA.plannedParams.length).toLocaleString()} |`);
  lines.push(`| Part B 新增 | ${(APPLY_MODE ? input.partB.inserted : input.partB.plannedParams.length).toLocaleString()} |`);
  lines.push(`| product_params 变化 | ${input.beforeCounts.productParams.toLocaleString()} → ${input.afterCounts.productParams.toLocaleString()} |`);
  lines.push("");
  lines.push("## 覆盖率变化（COUNT DISTINCT product_id）");
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
  lines.push("## 说明");
  lines.push("");
  lines.push("- Part A 使用同一 factory_name + category 的主导值，阈值为整组产品中 60% 且至少 5 个产品。");
  lines.push("- Part B 每条默认值都在运行时验证样本数 >= 10 且主导值占比 >= 85%，不满足则跳过。");
  lines.push("- 本脚本不覆盖已有参数，不删除产品/参数/offers，不修改源 Excel 文件。");
  lines.push("");
  return lines.join("\n");
}

function groupPartAByParam(samples: PartAGroupSample[], plannedParams: PlannedParam[]): Map<string, { groups: number; params: number }> {
  const grouped = new Map<string, { groups: number; params: number }>();
  for (const sample of samples) {
    const existing = grouped.get(sample.paramKey) ?? { groups: 0, params: 0 };
    existing.groups += 1;
    grouped.set(sample.paramKey, existing);
  }
  for (const param of plannedParams) {
    const existing = grouped.get(param.paramKey) ?? { groups: 0, params: 0 };
    existing.params += 1;
    grouped.set(param.paramKey, existing);
  }
  return grouped;
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
