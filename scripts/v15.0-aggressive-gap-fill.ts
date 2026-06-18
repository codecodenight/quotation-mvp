import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

import { CATEGORY_CORE_PARAMS, escapeMd, INSERT_BATCH_SIZE, loadAccessoryProductIds, productParamKey } from "./v11-shared";

const prisma = new PrismaClient();

const APPLY_MODE = process.argv.includes("--apply");
const REPORT_PATH = path.join("docs", "v15.0-aggressive-gap-fill-report.md");
const BACKUP_PATH = path.join("prisma", "dev.db.bak-v15.0");
const CORE_PARAM_KEYS = ["voltage", "cct", "cri", "pf", "ip", "material", "driver_type", "beam_angle", "base"] as const;

const V14_BASELINE = {
  scopedProducts: 10244,
  completeProducts: 6201,
  completionRate: 0.605,
};

type CoreParamKey = (typeof CORE_PARAM_KEYS)[number];

type ProductRow = {
  id: string;
  productName: string;
  modelNo: string | null;
  category: string | null;
};

type ParamRow = {
  productId: string;
  paramKey: string;
  rawValue: string;
  normalizedValue: string | null;
  unit: string | null;
};

type FirstOfferRow = {
  productId: string;
  sourceFileId: string | null;
  factoryName: string | null;
};

type NewParam = {
  productId: string;
  paramKey: CoreParamKey;
  rawValue: string;
  normalizedValue: string;
  unit: string | null;
  sourceField: "category_default_v15" | "factory_category_propagation_v15";
  confidence: "low";
};

type PartStats = {
  total: number;
  byParam: Map<string, number>;
};

type CoverageResult = {
  scopedProducts: number;
  completeProducts: number;
  completionRate: number;
  byCategory: Map<string, { total: number; complete: number }>;
  byParam: Map<string, { covered: number; required: number }>;
  missingCounts: Map<number, number>;
  missingCctByCategory: Map<string, number>;
};

type ValueCount = {
  count: number;
  rawValue: string;
  normalizedValue: string;
  unit: string | null;
};

type PropagationGroup = {
  productIds: string[];
  valueCounts: Map<string, ValueCount>;
};

type CategoryDefaultDetail = {
  category: string;
  paramKey: CoreParamKey;
  normalizedValue: string;
  added: number;
};

async function main() {
  const beforeCounts = await loadCounts();
  const [products, initialParams, accessoryIds, firstOffers] = await Promise.all([loadProducts(), loadParams(), loadAccessoryProductIds(prisma), loadFirstOffers()]);
  const firstOfferByProduct = new Map(firstOffers.map((row) => [row.productId, row]));
  const existingParamKeys = new Set(initialParams.map((param) => productParamKey(param.productId, param.paramKey)));
  const paramRows: ParamRow[] = [...initialParams];
  const newParams: NewParam[] = [];
  const partAStats = createPartStats();
  const partBStats = createPartStats();
  const partADetails: CategoryDefaultDetail[] = [];

  const beforeCoverage = calculateCoverage(products, initialParams, accessoryIds);

  applyCategoryDefaults({
    products,
    paramRows,
    accessoryIds,
    existingParamKeys,
    newParams,
    stats: partAStats,
    details: partADetails,
  });

  propagateByFactoryCategory({
    products,
    paramRows,
    firstOfferByProduct,
    accessoryIds,
    existingParamKeys,
    newParams,
    stats: partBStats,
  });

  if (APPLY_MODE) await insertNewParams(newParams);

  const afterCounts = await loadCounts();
  const afterCoverage = calculateCoverage(products, [...initialParams, ...newParams], accessoryIds);

  await mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await writeFile(
    REPORT_PATH,
    buildReport({
      mode: APPLY_MODE ? "apply" : "dry-run",
      beforeCounts,
      afterCounts,
      beforeCoverage,
      afterCoverage,
      partAStats,
      partBStats,
      partADetails,
      totalNewParams: newParams.length,
    }),
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        mode: APPLY_MODE ? "apply" : "dry-run",
        reportPath: REPORT_PATH,
        newParams: newParams.length,
        partA: partAStats.total,
        partB: partBStats.total,
        scopedProductsAfter: afterCoverage.scopedProducts,
        completeProductsAfter: afterCoverage.completeProducts,
        completionRateAfter: formatPercent(afterCoverage.completionRate),
      },
      null,
      2,
    ),
  );
}

async function loadProducts(): Promise<ProductRow[]> {
  return prisma.product.findMany({
    select: { id: true, productName: true, modelNo: true, category: true },
  });
}

async function loadParams(): Promise<ParamRow[]> {
  return prisma.productParam.findMany({
    select: { productId: true, paramKey: true, rawValue: true, normalizedValue: true, unit: true },
  });
}

async function loadCounts(): Promise<{ products: number; productParams: number }> {
  const [products, productParams] = await Promise.all([prisma.product.count(), prisma.productParam.count()]);
  return { products, productParams };
}

async function loadFirstOffers(): Promise<FirstOfferRow[]> {
  return prisma.$queryRaw<FirstOfferRow[]>`
    SELECT productId, sourceFileId, factoryName
    FROM (
      SELECT
        product_id AS productId,
        source_file_id AS sourceFileId,
        factory_name AS factoryName,
        ROW_NUMBER() OVER (PARTITION BY product_id ORDER BY created_at ASC, id ASC) AS rowNumber
      FROM supplier_offers
    )
    WHERE rowNumber = 1
  `;
}

function createPartStats(): PartStats {
  return { total: 0, byParam: new Map() };
}

function increment(stats: PartStats, paramKey: string): void {
  stats.total += 1;
  stats.byParam.set(paramKey, (stats.byParam.get(paramKey) ?? 0) + 1);
}

function getCoreParams(product: ProductRow): CoreParamKey[] {
  const category = product.category?.trim();
  if (!category) return [];
  return (CATEGORY_CORE_PARAMS[category] ?? []).filter((paramKey): paramKey is CoreParamKey => CORE_PARAM_KEYS.includes(paramKey as CoreParamKey));
}

function applyCategoryDefaults(input: {
  products: ProductRow[];
  paramRows: ParamRow[];
  accessoryIds: Set<string>;
  existingParamKeys: Set<string>;
  newParams: NewParam[];
  stats: PartStats;
  details: CategoryDefaultDetail[];
}): void {
  const productsByCategory = new Map<string, ProductRow[]>();
  for (const product of input.products) {
    if (input.accessoryIds.has(product.id)) continue;
    const category = product.category?.trim();
    if (!category || !CATEGORY_CORE_PARAMS[category]) continue;
    const list = productsByCategory.get(category) ?? [];
    list.push(product);
    productsByCategory.set(category, list);
  }

  for (const [category, categoryProducts] of productsByCategory.entries()) {
    const coreParams = (CATEGORY_CORE_PARAMS[category] ?? []).filter((paramKey): paramKey is CoreParamKey => CORE_PARAM_KEYS.includes(paramKey as CoreParamKey));
    for (const paramKey of coreParams) {
      const valueCounts = countParamValues(categoryProducts.map((product) => product.id), input.paramRows, paramKey);
      const dominant = getDominantValue(valueCounts);
      if (!dominant || dominant.count < 3) continue;
      const knownSamples = [...valueCounts.values()].reduce((sum, item) => sum + item.count, 0);
      if (knownSamples === 0 || dominant.count / knownSamples < 0.6) continue;

      let added = 0;
      for (const product of categoryProducts) {
        const newParam = addNewParam({
          existingParamKeys: input.existingParamKeys,
          paramRows: input.paramRows,
          newParams: input.newParams,
          productId: product.id,
          paramKey,
          rawValue: dominant.rawValue,
          normalizedValue: dominant.normalizedValue,
          unit: dominant.unit,
          sourceField: "category_default_v15",
        });
        if (!newParam) continue;
        added += 1;
        increment(input.stats, paramKey);
      }
      if (added > 0) input.details.push({ category, paramKey, normalizedValue: dominant.normalizedValue, added });
    }
  }
}

function propagateByFactoryCategory(input: {
  products: ProductRow[];
  paramRows: ParamRow[];
  firstOfferByProduct: Map<string, FirstOfferRow>;
  accessoryIds: Set<string>;
  existingParamKeys: Set<string>;
  newParams: NewParam[];
  stats: PartStats;
}): void {
  const productsById = new Map(input.products.map((product) => [product.id, product]));
  for (const paramKey of CORE_PARAM_KEYS) {
    const groups = new Map<string, PropagationGroup>();
    for (const product of input.products) {
      if (input.accessoryIds.has(product.id) || !getCoreParams(product).includes(paramKey)) continue;
      const category = product.category?.trim();
      const factoryName = input.firstOfferByProduct.get(product.id)?.factoryName?.trim();
      if (!category || !factoryName) continue;
      const groupKey = `${factoryName}\u0000${category}`;
      const group = groups.get(groupKey) ?? createPropagationGroup();
      group.productIds.push(product.id);
      groups.set(groupKey, group);
    }
    addValuesToGroups(groups, input.paramRows, paramKey);
    for (const group of groups.values()) {
      const dominant = getDominantValue(group.valueCounts);
      const knownSamples = [...group.valueCounts.values()].reduce((sum, item) => sum + item.count, 0);
      if (!dominant || dominant.count < 3 || knownSamples === 0 || dominant.count / knownSamples < 0.3) continue;
      for (const productId of group.productIds) {
        const product = productsById.get(productId);
        if (!product || !getCoreParams(product).includes(paramKey)) continue;
        const newParam = addNewParam({
          existingParamKeys: input.existingParamKeys,
          paramRows: input.paramRows,
          newParams: input.newParams,
          productId,
          paramKey,
          rawValue: dominant.rawValue,
          normalizedValue: dominant.normalizedValue,
          unit: dominant.unit,
          sourceField: "factory_category_propagation_v15",
        });
        if (newParam) increment(input.stats, paramKey);
      }
    }
  }
}

function countParamValues(productIds: string[], paramRows: ParamRow[], paramKey: CoreParamKey): Map<string, ValueCount> {
  const productIdSet = new Set(productIds);
  const counts = new Map<string, ValueCount>();
  for (const param of paramRows) {
    if (param.paramKey !== paramKey || !param.normalizedValue?.trim() || !productIdSet.has(param.productId)) continue;
    const current = counts.get(param.normalizedValue) ?? {
      count: 0,
      rawValue: param.rawValue,
      normalizedValue: param.normalizedValue,
      unit: param.unit,
    };
    current.count += 1;
    counts.set(param.normalizedValue, current);
  }
  return counts;
}

function addValuesToGroups(groups: Map<string, PropagationGroup>, paramRows: ParamRow[], paramKey: CoreParamKey): void {
  const groupByProduct = new Map<string, PropagationGroup[]>();
  for (const group of groups.values()) {
    for (const productId of group.productIds) {
      const list = groupByProduct.get(productId) ?? [];
      list.push(group);
      groupByProduct.set(productId, list);
    }
  }

  for (const param of paramRows) {
    if (param.paramKey !== paramKey || !param.normalizedValue?.trim()) continue;
    const productGroups = groupByProduct.get(param.productId);
    if (!productGroups) continue;
    for (const group of productGroups) {
      const current = group.valueCounts.get(param.normalizedValue) ?? {
        count: 0,
        rawValue: param.rawValue,
        normalizedValue: param.normalizedValue,
        unit: param.unit,
      };
      current.count += 1;
      group.valueCounts.set(param.normalizedValue, current);
    }
  }
}

function createPropagationGroup(): PropagationGroup {
  return { productIds: [], valueCounts: new Map() };
}

function getDominantValue(valueCounts: Map<string, ValueCount>): ValueCount | null {
  return [...valueCounts.values()].sort((left, right) => right.count - left.count || left.normalizedValue.localeCompare(right.normalizedValue))[0] ?? null;
}

function addNewParam(input: {
  existingParamKeys: Set<string>;
  paramRows: ParamRow[];
  newParams: NewParam[];
  productId: string;
  paramKey: CoreParamKey;
  rawValue: string;
  normalizedValue: string;
  unit: string | null;
  sourceField: NewParam["sourceField"];
}): NewParam | null {
  const key = productParamKey(input.productId, input.paramKey);
  if (input.existingParamKeys.has(key)) return null;
  const normalizedValue = input.normalizedValue.trim();
  if (!normalizedValue) return null;
  const newParam: NewParam = {
    productId: input.productId,
    paramKey: input.paramKey,
    rawValue: input.rawValue.trim(),
    normalizedValue,
    unit: input.unit,
    sourceField: input.sourceField,
    confidence: "low",
  };
  input.existingParamKeys.add(key);
  input.paramRows.push({
    productId: newParam.productId,
    paramKey: newParam.paramKey,
    rawValue: newParam.rawValue,
    normalizedValue: newParam.normalizedValue,
    unit: newParam.unit,
  });
  input.newParams.push(newParam);
  return newParam;
}

async function insertNewParams(newParams: NewParam[]): Promise<void> {
  for (let index = 0; index < newParams.length; index += INSERT_BATCH_SIZE) {
    const chunk = newParams.slice(index, index + INSERT_BATCH_SIZE);
    await prisma.productParam.createMany({
      data: chunk.map((param) => ({
        id: randomUUID(),
        productId: param.productId,
        paramKey: param.paramKey,
        rawValue: param.rawValue,
        normalizedValue: param.normalizedValue,
        unit: param.unit,
        sourceField: param.sourceField,
        confidence: param.confidence,
      })),
    });
  }
}

function calculateCoverage(products: ProductRow[], params: ParamRow[], accessoryIds: Set<string>): CoverageResult {
  const paramKeysByProduct = new Map<string, Set<string>>();
  for (const param of params) {
    if (!param.normalizedValue?.trim()) continue;
    const keys = paramKeysByProduct.get(param.productId) ?? new Set<string>();
    keys.add(param.paramKey);
    paramKeysByProduct.set(param.productId, keys);
  }

  let scopedProducts = 0;
  let completeProducts = 0;
  const byCategory = new Map<string, { total: number; complete: number }>();
  const byParam = new Map<string, { covered: number; required: number }>();
  const missingCounts = new Map<number, number>();
  const missingCctByCategory = new Map<string, number>();

  for (const product of products) {
    if (accessoryIds.has(product.id)) continue;
    const coreParams = getCoreParams(product);
    const category = product.category?.trim();
    if (!category || coreParams.length === 0) continue;
    scopedProducts += 1;
    const keys = paramKeysByProduct.get(product.id) ?? new Set<string>();
    const categoryStats = byCategory.get(category) ?? { total: 0, complete: 0 };
    categoryStats.total += 1;
    const missingParams = coreParams.filter((paramKey) => !keys.has(paramKey));
    if (missingParams.length === 0) {
      completeProducts += 1;
      categoryStats.complete += 1;
    }
    byCategory.set(category, categoryStats);
    if (missingParams.length > 0) {
      const bucket = missingParams.length >= 3 ? 3 : missingParams.length;
      missingCounts.set(bucket, (missingCounts.get(bucket) ?? 0) + 1);
      if (missingParams.includes("cct")) missingCctByCategory.set(category, (missingCctByCategory.get(category) ?? 0) + 1);
    }
    for (const paramKey of coreParams) {
      const paramStats = byParam.get(paramKey) ?? { covered: 0, required: 0 };
      paramStats.required += 1;
      if (keys.has(paramKey)) paramStats.covered += 1;
      byParam.set(paramKey, paramStats);
    }
  }

  return {
    scopedProducts,
    completeProducts,
    completionRate: scopedProducts > 0 ? completeProducts / scopedProducts : 0,
    byCategory,
    byParam,
    missingCounts,
    missingCctByCategory,
  };
}

function buildReport(input: {
  mode: "dry-run" | "apply";
  beforeCounts: { products: number; productParams: number };
  afterCounts: { products: number; productParams: number };
  beforeCoverage: CoverageResult;
  afterCoverage: CoverageResult;
  partAStats: PartStats;
  partBStats: PartStats;
  partADetails: CategoryDefaultDetail[];
  totalNewParams: number;
}): string {
  const categoryRows = [...input.afterCoverage.byCategory.entries()]
    .map(([category, after]) => {
      const before = input.beforeCoverage.byCategory.get(category) ?? { total: after.total, complete: 0 };
      return { category, total: after.total, beforeComplete: before.complete, afterComplete: after.complete, rate: after.total > 0 ? after.complete / after.total : 0 };
    })
    .sort((left, right) => right.total - left.total || left.category.localeCompare(right.category));
  const partADetailRows = [...input.partADetails].sort((left, right) => right.added - left.added || left.category.localeCompare(right.category)).slice(0, 30);
  const missingCctRows = [...input.afterCoverage.missingCctByCategory.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));

  return `# V15.0 激进补全报告

模式: ${input.mode}
时间: ${new Date().toISOString()}
备份: ${BACKUP_PATH}

## 汇总

| 方法 | 新增记录数 |
|---|---:|
| A: 品类默认值 60% | ${input.partAStats.total} |
| B: 工厂+品类 30% | ${input.partBStats.total} |
| 合计 | ${input.totalNewParams} |

## Part A 明细

| param_key | 新增 |
|---|---:|
${CORE_PARAM_KEYS.map((paramKey) => `| ${paramKey} | ${input.partAStats.byParam.get(paramKey) ?? 0} |`).join("\n")}

### Part A 品类×参数明细（前 30 行，按新增数降序）

| category | param_key | 默认值 | 新增数 |
|---|---|---|---:|
${partADetailRows.map((row) => `| ${escapeMd(row.category)} | ${row.paramKey} | ${escapeMd(row.normalizedValue)} | ${row.added} |`).join("\n") || "| - | - | - | - |"}

## Part B 明细

| param_key | 新增 |
|---|---:|
${CORE_PARAM_KEYS.map((paramKey) => `| ${paramKey} | ${input.partBStats.byParam.get(paramKey) ?? 0} |`).join("\n")}

## 覆盖率变化

| 指标 | V14.0 | V15.0 |
|---|---:|---:|
| 核心参数覆盖范围产品 | ${V14_BASELINE.scopedProducts} | ${input.afterCoverage.scopedProducts} |
| 全部完成产品 | ${V14_BASELINE.completeProducts} | ${input.afterCoverage.completeProducts} |
| 全局完成率 | ${formatPercent(V14_BASELINE.completionRate)} | ${formatPercent(input.afterCoverage.completionRate)} |

### 逐品类完成率

| 品类 | 产品数 | V14.0完成 | V15.0完成 | 完成率 |
|---|---:|---:|---:|---:|
${categoryRows.map((row) => `| ${escapeMd(row.category)} | ${row.total} | ${row.beforeComplete} | ${row.afterComplete} | ${formatPercent(row.rate)} |`).join("\n")}

### 逐参数覆盖率

| param_key | 覆盖 | 需覆盖 | 覆盖率 |
|---|---:|---:|---:|
${[...input.afterCoverage.byParam.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([paramKey, stats]) => `| ${paramKey} | ${stats.covered} | ${stats.required} | ${formatPercent(stats.required > 0 ? stats.covered / stats.required : 0)} |`).join("\n")}

### 仍未完成的产品分析

| 缺失参数数 | 产品数 |
|---:|---:|
| 1 | ${input.afterCoverage.missingCounts.get(1) ?? 0} |
| 2 | ${input.afterCoverage.missingCounts.get(2) ?? 0} |
| 3+ | ${input.afterCoverage.missingCounts.get(3) ?? 0} |

#### 仍缺 CCT 的产品（按品类）

| 品类 | 仍缺 CCT |
|---|---:|
${missingCctRows.map(([category, count]) => `| ${escapeMd(category)} | ${count} |`).join("\n") || "| - | 0 |"}

## DB 计数

| 表 | 执行前 | 执行后 | 变化 |
|---|---:|---:|---:|
| products | ${input.beforeCounts.products} | ${input.afterCounts.products} | ${input.afterCounts.products - input.beforeCounts.products} |
| product_params | ${input.beforeCounts.productParams} | ${input.afterCounts.productParams} | ${input.afterCounts.productParams - input.beforeCounts.productParams} |
`;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
