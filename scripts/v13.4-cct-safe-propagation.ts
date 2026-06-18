import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

import { escapeMd, INSERT_BATCH_SIZE, productParamKey } from "./v11-shared";

const prisma = new PrismaClient();

const APPLY_MODE = process.argv.includes("--apply");
const REPORT_PATH = path.join("docs", "v13.4-cct-safe-propagation-report.md");
const BACKUP_PATH = path.join("prisma", "dev.db.bak-v13.4");

const CATEGORY_CORE_PARAMS: Record<string, string[]> = {
  筒灯: ["voltage", "cct", "cri", "pf", "driver_type"],
  面板灯: ["voltage", "cct", "cri", "pf", "driver_type", "material"],
  磁吸灯: ["voltage", "cct", "cri"],
  吸顶灯: ["voltage", "cct", "cri", "pf", "driver_type"],
  灯丝灯: ["voltage", "cct", "cri", "pf", "base"],
  风扇灯: ["voltage", "cct", "cri"],
  球泡: ["voltage", "cct", "cri", "pf", "base"],
  壁灯: ["voltage", "cct", "cri", "driver_type", "material"],
  净化灯: ["voltage", "cct", "cri", "pf", "driver_type"],
  橱柜灯: ["voltage", "cct", "cri"],
  镜前灯: ["voltage", "cct", "cri", "driver_type"],
  轨道灯: ["voltage", "cct", "cri", "pf", "beam_angle"],
  防潮灯: ["voltage", "cct", "cri", "ip", "pf", "driver_type"],
  台灯: ["voltage", "cct", "cri"],
  G4G9: ["voltage", "cct", "cri", "base"],
  灯管: ["voltage", "cct", "cri", "pf"],
  线条灯: ["voltage", "cct", "cri", "ip"],
  投光灯: ["voltage", "cct", "cri", "ip", "pf", "beam_angle", "material"],
  三防灯: ["voltage", "cct", "cri", "ip", "pf"],
  太阳能壁灯: ["cct", "ip", "material"],
  太阳能: ["cct", "ip", "material"],
  路灯: ["voltage", "cct", "cri", "ip", "pf", "beam_angle"],
  "地埋灯/地插灯": ["voltage", "cct", "cri", "ip", "beam_angle"],
  工作灯: ["voltage", "cct", "cri", "ip"],
  庭院灯: ["voltage", "cct", "ip", "material"],
  Highbay: ["voltage", "cct", "cri", "ip", "pf", "beam_angle"],
  充电灯: ["cct", "ip", "material"],
  应急灯: ["voltage", "cct"],
  灯带: ["voltage", "cct", "cri", "ip"],
  皮线灯: ["voltage", "ip"],
};

type DbCount = bigint | number | null;

type ProductRow = {
  id: string;
  modelNo: string | null;
  productName: string;
  category: string | null;
};

type FirstOfferRow = {
  product_id: string;
  factory_name: string;
};

type ExistingParam = {
  productId: string;
  paramKey: string;
  normalizedValue: string | null;
};

type GroupRule = {
  category: string;
  factoryName: string;
  dominantValue: string;
  sampleCount: number;
  dominantCount: number;
  ratio: number;
  planned: number;
};

type PlannedParam = {
  id: string;
  productId: string;
  modelNo: string | null;
  productName: string;
  category: string;
  factoryName: string;
  rawValue: string;
  normalizedValue: string;
  unit: "K";
  sourceField: "factory_category_default";
  confidence: "low";
  evidence: string;
};

type Coverage = {
  productParams: number;
  cct: { coveredProducts: number; requiredProducts: number };
  completeProducts: number;
  scopedProducts: number;
};

async function main() {
  const beforeCounts = await loadCounts();
  const beforeCoverage = await buildCoverage();
  const products = await prisma.product.findMany({
    select: { id: true, modelNo: true, productName: true, category: true },
  });
  const firstOffers = await loadFirstOffers();
  const existingParams = await prisma.productParam.findMany({
    where: { normalizedValue: { not: null } },
    select: { productId: true, paramKey: true, normalizedValue: true },
  });

  const result = planCctPropagation(products, firstOffers, existingParams);
  const inserted = APPLY_MODE ? await insertParams(result.plannedParams) : 0;
  const afterCounts = await loadCounts();
  const afterCoverage = await buildCoverage();

  await mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await writeFile(
    REPORT_PATH,
    buildReport({
      mode: APPLY_MODE ? "apply" : "dry-run",
      beforeCounts,
      afterCounts,
      beforeCoverage,
      afterCoverage,
      inserted,
      ...result,
    }),
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        mode: APPLY_MODE ? "apply" : "dry-run",
        reportPath: REPORT_PATH,
        missingCctProducts: result.missingCctProducts,
        plannedParams: result.plannedParams.length,
        insertedParams: inserted,
        productParamsBefore: beforeCounts.productParams,
        productParamsAfter: afterCounts.productParams,
      },
      null,
      2,
    ),
  );
}

async function loadCounts(): Promise<{ products: number; productParams: number }> {
  const [products, productParams] = await Promise.all([prisma.product.count(), prisma.productParam.count()]);
  return { products, productParams };
}

async function loadFirstOffers(): Promise<Map<string, string>> {
  const rows = await prisma.$queryRaw<FirstOfferRow[]>`
    SELECT product_id, factory_name
    FROM (
      SELECT product_id, factory_name, ROW_NUMBER() OVER (PARTITION BY product_id ORDER BY created_at ASC) as rn
      FROM supplier_offers
      WHERE factory_name IS NOT NULL AND TRIM(factory_name) != ''
    )
    WHERE rn = 1
  `;
  return new Map(rows.map((row) => [row.product_id, row.factory_name]));
}

function planCctPropagation(
  products: ProductRow[],
  firstOffers: Map<string, string>,
  existingParams: ExistingParam[],
): {
  missingCctProducts: number;
  withReferenceDistribution: number;
  fillableProducts: number;
  skippedSampleInsufficient: number;
  skippedDominantInsufficient: number;
  skippedInvalidValue: number;
  plannedParams: PlannedParam[];
  rules: GroupRule[];
  byCategory: Map<string, number>;
  samples: PlannedParam[];
} {
  const existingCctByProduct = new Map<string, string>();
  const existingParamKeys = new Set<string>();
  for (const param of existingParams) {
    if (!param.normalizedValue?.trim()) continue;
    existingParamKeys.add(productParamKey(param.productId, param.paramKey));
    if (param.paramKey === "cct") existingCctByProduct.set(param.productId, param.normalizedValue.trim());
  }

  const productsById = new Map(products.map((product) => [product.id, product]));
  const distribution = new Map<string, Map<string, Set<string>>>();
  for (const [productId, cct] of existingCctByProduct.entries()) {
    const product = productsById.get(productId);
    const factoryName = firstOffers.get(productId);
    const normalized = normalizeCct(cct);
    if (!product?.category || !factoryName || !normalized) continue;
    const group = groupKey(product.category, factoryName);
    const values = distribution.get(group) ?? new Map<string, Set<string>>();
    const productIds = values.get(normalized) ?? new Set<string>();
    productIds.add(productId);
    values.set(normalized, productIds);
    distribution.set(group, values);
  }

  let missingCctProducts = 0;
  let withReferenceDistribution = 0;
  let skippedSampleInsufficient = 0;
  let skippedDominantInsufficient = 0;
  let skippedInvalidValue = 0;
  const plannedParams: PlannedParam[] = [];
  const rulesByGroup = new Map<string, GroupRule>();
  const byCategory = new Map<string, number>();
  const samples: PlannedParam[] = [];

  for (const product of products) {
    if (!product.category || existingCctByProduct.has(product.id)) continue;
    missingCctProducts += 1;
    const factoryName = firstOffers.get(product.id);
    if (!factoryName) continue;

    const values = distribution.get(groupKey(product.category, factoryName));
    if (!values || values.size === 0) continue;
    withReferenceDistribution += 1;

    const dominant = getDominant(values);
    if (dominant.sampleCount < 10) {
      skippedSampleInsufficient += 1;
      continue;
    }
    if (dominant.ratio < 0.9) {
      skippedDominantInsufficient += 1;
      continue;
    }
    if (!isValidCct(dominant.value)) {
      skippedInvalidValue += 1;
      continue;
    }
    if (existingParamKeys.has(productParamKey(product.id, "cct"))) continue;

    const planned: PlannedParam = {
      id: randomUUID(),
      productId: product.id,
      modelNo: product.modelNo,
      productName: product.productName,
      category: product.category,
      factoryName,
      rawValue: `${dominant.value}K`,
      normalizedValue: dominant.value,
      unit: "K",
      sourceField: "factory_category_default",
      confidence: "low",
      evidence: `${dominant.dominantCount}/${dominant.sampleCount} (${formatPercent(dominant.ratio)})`,
    };
    plannedParams.push(planned);
    existingParamKeys.add(productParamKey(product.id, "cct"));
    byCategory.set(product.category, (byCategory.get(product.category) ?? 0) + 1);
    if (samples.length < 30) samples.push(planned);

    const key = groupKey(product.category, factoryName);
    const rule =
      rulesByGroup.get(key) ??
      {
        category: product.category,
        factoryName,
        dominantValue: dominant.value,
        sampleCount: dominant.sampleCount,
        dominantCount: dominant.dominantCount,
        ratio: dominant.ratio,
        planned: 0,
      };
    rule.planned += 1;
    rulesByGroup.set(key, rule);
  }

  return {
    missingCctProducts,
    withReferenceDistribution,
    fillableProducts: plannedParams.length,
    skippedSampleInsufficient,
    skippedDominantInsufficient,
    skippedInvalidValue,
    plannedParams,
    rules: Array.from(rulesByGroup.values()).sort((left, right) => right.planned - left.planned || left.category.localeCompare(right.category)),
    byCategory,
    samples,
  };
}

async function buildCoverage(): Promise<Coverage> {
  const productParams = await prisma.productParam.count();
  const paramTotals = new Map<string, { coveredProducts: number; requiredProducts: number }>();
  let completeProducts = 0;
  let scopedProducts = 0;

  for (const [category, coreParams] of Object.entries(CATEGORY_CORE_PARAMS)) {
    const placeholders = coreParams.map(() => "?").join(", ");
    const [counts, breakdownRows] = await Promise.all([
      prisma.$queryRawUnsafe<Array<{ total_products: DbCount; complete_products: DbCount }>>(
        `
          SELECT
            COUNT(*) as total_products,
            SUM(CASE WHEN core_param_count = ? THEN 1 ELSE 0 END) as complete_products
          FROM (
            SELECT
              p.id,
              (
                SELECT COUNT(DISTINCT pp.param_key)
                FROM product_params pp
                WHERE pp.product_id = p.id
                  AND pp.param_key IN (${placeholders})
                  AND pp.normalized_value IS NOT NULL
                  AND TRIM(pp.normalized_value) != ''
              ) as core_param_count
            FROM products p
            WHERE COALESCE(NULLIF(TRIM(p.category), ''), '未分类') = ?
          ) scoped_products
        `,
        coreParams.length,
        ...coreParams,
        category,
      ),
      prisma.$queryRawUnsafe<Array<{ param_key: string; product_count: DbCount }>>(
        `
          SELECT
            pp.param_key,
            COUNT(DISTINCT pp.product_id) as product_count
          FROM product_params pp
          JOIN products p ON p.id = pp.product_id
          WHERE COALESCE(NULLIF(TRIM(p.category), ''), '未分类') = ?
            AND pp.param_key IN (${placeholders})
            AND pp.normalized_value IS NOT NULL
            AND TRIM(pp.normalized_value) != ''
          GROUP BY pp.param_key
        `,
        category,
        ...coreParams,
      ),
    ]);
    const total = toNumber(counts[0]?.total_products);
    if (total <= 0) continue;
    scopedProducts += total;
    completeProducts += toNumber(counts[0]?.complete_products);
    const breakdown = Object.fromEntries(coreParams.map((paramKey) => [paramKey, 0]));
    for (const row of breakdownRows) breakdown[row.param_key] = toNumber(row.product_count);
    for (const paramKey of coreParams) {
      const item = paramTotals.get(paramKey) ?? { coveredProducts: 0, requiredProducts: 0 };
      item.coveredProducts += breakdown[paramKey] ?? 0;
      item.requiredProducts += total;
      paramTotals.set(paramKey, item);
    }
  }

  return {
    productParams,
    cct: paramTotals.get("cct") ?? { coveredProducts: 0, requiredProducts: 0 },
    completeProducts,
    scopedProducts,
  };
}

async function insertParams(plannedParams: PlannedParam[]): Promise<number> {
  let inserted = 0;
  for (let index = 0; index < plannedParams.length; index += INSERT_BATCH_SIZE) {
    const chunk = plannedParams.slice(index, index + INSERT_BATCH_SIZE);
    const result = await prisma.productParam.createMany({
      data: chunk.map((param) => ({
        id: param.id,
        productId: param.productId,
        paramKey: "cct",
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

function buildReport(input: {
  mode: "dry-run" | "apply";
  beforeCounts: { products: number; productParams: number };
  afterCounts: { products: number; productParams: number };
  beforeCoverage: Coverage;
  afterCoverage: Coverage;
  inserted: number;
  missingCctProducts: number;
  withReferenceDistribution: number;
  fillableProducts: number;
  skippedSampleInsufficient: number;
  skippedDominantInsufficient: number;
  skippedInvalidValue: number;
  rules: GroupRule[];
  byCategory: Map<string, number>;
  samples: PlannedParam[];
}): string {
  return `# V13.4 CCT 安全传播报告

模式: ${input.mode}
时间: ${new Date().toISOString()}
备份: ${BACKUP_PATH}

## 汇总

| 指标 | 数量 |
|---|---:|
| 缺 CCT 产品 | ${input.missingCctProducts} |
| 有工厂+品类参考分布 | ${input.withReferenceDistribution} |
| 达到阈值可填充 | ${input.fillableProducts} |
| 跳过：样本不足 | ${input.skippedSampleInsufficient} |
| 跳过：主导占比不足 | ${input.skippedDominantInsufficient} |
| 跳过：值不合法 | ${input.skippedInvalidValue} |
| 实际新增 | ${input.inserted} |

## 填充规则明细

| category | factory | 主导 CCT | 样本数 | 占比 | 新增 |
|---|---|---:|---:|---:|---:|
${input.rules.map((rule) => `| ${escapeMd(rule.category)} | ${escapeMd(rule.factoryName)} | ${escapeMd(rule.dominantValue)} | ${rule.sampleCount} | ${formatPercent(rule.ratio)} | ${rule.planned} |`).join("\n") || "| - | - | - | 0 | 0.0% | 0 |"}

## 按品类新增

| category | 新增 CCT |
|---|---:|
${Array.from(input.byCategory.entries()).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).map(([category, count]) => `| ${escapeMd(category)} | ${count} |`).join("\n") || "| - | 0 |"}

## 采样（前 30 条）

| category | factory | model | 填充值 | 依据 |
|---|---|---|---|---|
${input.samples.map((sample) => `| ${escapeMd(sample.category)} | ${escapeMd(sample.factoryName)} | ${escapeMd(sample.modelNo ?? sample.productName)} | ${escapeMd(sample.normalizedValue)} | ${escapeMd(sample.evidence)} |`).join("\n") || "| - | - | - | - | - |"}

## 覆盖率变化

| 指标 | 变化前 | 变化后 |
|---|---:|---:|
| CCT 覆盖率(需覆盖) | ${formatRatio(input.beforeCoverage.cct.coveredProducts, input.beforeCoverage.cct.requiredProducts)} | ${formatRatio(input.afterCoverage.cct.coveredProducts, input.afterCoverage.cct.requiredProducts)} |
| 核心参数全部完成产品 | ${input.beforeCoverage.completeProducts} | ${input.afterCoverage.completeProducts} |
| 全局完成率 | ${formatRatio(input.beforeCoverage.completeProducts, input.beforeCoverage.scopedProducts)} | ${formatRatio(input.afterCoverage.completeProducts, input.afterCoverage.scopedProducts)} |
| product_params | ${input.beforeCounts.productParams} | ${input.afterCounts.productParams} |

## DB 计数

| 表 | 执行前 | 执行后 | 变化 |
|---|---:|---:|---:|
| products | ${input.beforeCounts.products} | ${input.afterCounts.products} | ${input.afterCounts.products - input.beforeCounts.products} |
| product_params | ${input.beforeCounts.productParams} | ${input.afterCounts.productParams} | ${input.afterCounts.productParams - input.beforeCounts.productParams} |
`;
}

function getDominant(values: Map<string, Set<string>>): { value: string; sampleCount: number; dominantCount: number; ratio: number } {
  let sampleCount = 0;
  let dominantValue = "";
  let dominantCount = 0;
  for (const [value, productIds] of values.entries()) {
    sampleCount += productIds.size;
    if (productIds.size > dominantCount) {
      dominantValue = value;
      dominantCount = productIds.size;
    }
  }
  return { value: dominantValue, sampleCount, dominantCount, ratio: sampleCount > 0 ? dominantCount / sampleCount : 0 };
}

function normalizeCct(value: string): string | null {
  const numbers = value.match(/\d{4}/g)?.map((item) => Number.parseInt(item, 10)).filter((item) => item >= 1800 && item <= 10000) ?? [];
  if (numbers.length === 0) return null;
  const min = Math.min(...numbers);
  const max = Math.max(...numbers);
  return min === max ? String(min) : `${min}-${max}`;
}

function isValidCct(value: string): boolean {
  return normalizeCct(value) === value;
}

function groupKey(category: string, factoryName: string): string {
  return `${category}\u0000${factoryName}`;
}

function toNumber(value: DbCount): number {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return value;
  return 0;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatRatio(numerator: number, denominator: number): string {
  if (denominator <= 0) return "0.0%";
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
