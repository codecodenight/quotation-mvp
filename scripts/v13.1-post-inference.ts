import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

import { CATEGORY_CORE_PARAMS, escapeMd, INSERT_BATCH_SIZE, productParamKey } from "./v11-shared";

const prisma = new PrismaClient();

const APPLY_MODE = process.argv.includes("--apply");
const REPORT_PATH = path.join("docs", "v13.1-post-inference-report.md");
const BACKUP_PATH = path.join("prisma", "dev.db.bak-v13.1");

const DEFERRED_DEFAULTS = [
  { category: "轨道灯", paramKey: "cri", value: "80", rawValue: "CRI≥80", unit: null },
  { category: "轨道灯", paramKey: "pf", value: "0.5", rawValue: "PF≥0.5", unit: null },
  { category: "应急灯", paramKey: "pf", value: "0.5", rawValue: "PF≥0.5", unit: null },
] as const;

type DbCount = bigint | number | null;

type ProductContext = {
  product_id: string;
  model_no: string | null;
  product_name: string;
  category: string | null;
  factory_name: string | null;
};

type AiParamRow = {
  id: string;
  productId: string;
  paramKey: string;
  rawValue: string;
  normalizedValue: string | null;
};

type ReferenceDistributionRow = {
  category: string | null;
  factory_name: string | null;
  param_key: string;
  normalized_value: string;
  product_count: DbCount;
};

type EfficacyCandidateRow = {
  product_id: string;
  model_no: string | null;
  product_name: string;
  category: string | null;
  watts: string | null;
  lumens: string | null;
};

type PlannedParam = {
  id: string;
  productId: string;
  modelNo: string | null;
  productName: string;
  category: string;
  paramKey: string;
  rawValue: string;
  normalizedValue: string;
  unit: string | null;
  sourceField: "derived_efficacy" | "category_default";
  confidence: "medium" | "low";
};

type OutlierSample = {
  category: string;
  modelNo: string;
  paramKey: string;
  aiValue: string;
  dominantValue: string;
};

type ConsistencyStats = {
  totalDeepseek: number;
  withReference: number;
  consistent: number;
  outliers: number;
  outlierSamples: OutlierSample[];
};

type EfficacyStats = {
  productsWithWattsLumens: number;
  existingEfficacy: number;
  derivable: number;
  filtered: number;
  planned: PlannedParam[];
  samples: Array<{
    category: string;
    modelNo: string;
    watts: string;
    lumens: string;
    efficacy: number;
  }>;
};

type DeferredDefaultStats = {
  category: string;
  paramKey: string;
  samples: number;
  dominantValue: string;
  dominantRatio: number;
  status: string;
  planned: number;
};

type CoverageCategoryRow = {
  category: string;
  totalProducts: number;
  completeProducts: number;
  coreParamCount: number;
  paramBreakdown: Record<string, number>;
};

type CoverageParamRow = {
  paramKey: string;
  coveredProducts: number;
  requiredProducts: number;
};

type CoverageAudit = {
  totalProducts: number;
  productParams: number;
  completeProducts: number;
  scopedProducts: number;
  categoryRows: CoverageCategoryRow[];
  paramRows: CoverageParamRow[];
};

async function main() {
  const beforeCounts = await loadCounts();
  const productContexts = await loadProductContexts();
  const existingParamKeys = await loadExistingParamKeys();

  const consistencyStats = await validateAiConsistency(productContexts);
  const efficacyStats = await planLuminousEfficacy();
  const deferredDefaultStats = await planDeferredDefaults(existingParamKeys);

  const plannedParams = [...efficacyStats.planned, ...deferredDefaultStats.plannedParams];
  const insertedParams = APPLY_MODE ? await insertParams(plannedParams) : 0;
  const afterCounts = await loadCounts();
  const coverageAudit = await buildCoverageAudit();

  await mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await writeFile(
    REPORT_PATH,
    buildReport({
      mode: APPLY_MODE ? "apply" : "dry-run",
      beforeCounts,
      afterCounts,
      insertedParams,
      consistencyStats,
      efficacyStats,
      deferredDefaultStats: deferredDefaultStats.rows,
      coverageAudit,
    }),
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        mode: APPLY_MODE ? "apply" : "dry-run",
        reportPath: REPORT_PATH,
        deepseekRecords: consistencyStats.totalDeepseek,
        aiOutliers: consistencyStats.outliers,
        derivedEfficacy: efficacyStats.planned.length,
        deferredDefaults: deferredDefaultStats.plannedParams.length,
        insertedParams,
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

async function loadProductContexts(): Promise<Map<string, ProductContext>> {
  const rows = await prisma.$queryRaw<ProductContext[]>`
    SELECT
      p.id as product_id,
      p.model_no,
      p.product_name,
      p.category,
      (
        SELECT so.factory_name
        FROM supplier_offers so
        WHERE so.product_id = p.id
        ORDER BY so.created_at ASC
        LIMIT 1
      ) as factory_name
    FROM products p
  `;
  return new Map(rows.map((row) => [row.product_id, row]));
}

async function loadExistingParamKeys(): Promise<Set<string>> {
  const rows = await prisma.productParam.findMany({
    where: { normalizedValue: { not: null } },
    select: { productId: true, paramKey: true, normalizedValue: true },
  });
  return new Set(
    rows
      .filter((row) => row.normalizedValue && row.normalizedValue.trim())
      .map((row) => productParamKey(row.productId, row.paramKey)),
  );
}

async function validateAiConsistency(productContexts: Map<string, ProductContext>): Promise<ConsistencyStats> {
  const [aiParams, referenceRows] = await Promise.all([
    prisma.productParam.findMany({
      where: { sourceField: "deepseek_inference" },
      select: { id: true, productId: true, paramKey: true, rawValue: true, normalizedValue: true },
    }),
    prisma.$queryRaw<ReferenceDistributionRow[]>`
      SELECT
        p.category,
        so.factory_name,
        pp.param_key,
        pp.normalized_value,
        COUNT(DISTINCT pp.product_id) as product_count
      FROM product_params pp
      JOIN products p ON p.id = pp.product_id
      JOIN supplier_offers so ON so.product_id = p.id
      WHERE pp.source_field != 'deepseek_inference'
        AND pp.normalized_value IS NOT NULL
        AND TRIM(pp.normalized_value) != ''
        AND p.category IS NOT NULL
      GROUP BY p.category, so.factory_name, pp.param_key, pp.normalized_value
    `,
  ]);

  const referenceByGroup = new Map<string, Array<{ value: string; count: number }>>();
  for (const row of referenceRows) {
    if (!row.category || !row.factory_name || !row.normalized_value) continue;
    const key = groupKey(row.category, row.factory_name, row.param_key);
    const bucket = referenceByGroup.get(key) ?? [];
    bucket.push({ value: row.normalized_value, count: toNumber(row.product_count) });
    referenceByGroup.set(key, bucket);
  }

  let withReference = 0;
  let consistent = 0;
  let outliers = 0;
  const outlierSamples: OutlierSample[] = [];

  for (const aiParam of aiParams) {
    const aiValue = aiParam.normalizedValue?.trim();
    if (!aiValue) continue;
    const context = productContexts.get(aiParam.productId);
    if (!context?.category || !context.factory_name) continue;

    const references = referenceByGroup.get(groupKey(context.category, context.factory_name, aiParam.paramKey)) ?? [];
    if (references.length === 0) continue;
    withReference += 1;

    if (references.some((reference) => normalizeComparable(reference.value) === normalizeComparable(aiValue))) {
      consistent += 1;
      continue;
    }

    outliers += 1;
    if (outlierSamples.length < 30) {
      const dominant = references.sort((left, right) => right.count - left.count)[0];
      outlierSamples.push({
        category: context.category,
        modelNo: context.model_no ?? context.product_name,
        paramKey: aiParam.paramKey,
        aiValue,
        dominantValue: dominant?.value ?? "",
      });
    }
  }

  return {
    totalDeepseek: aiParams.length,
    withReference,
    consistent,
    outliers,
    outlierSamples,
  };
}

async function planLuminousEfficacy(): Promise<EfficacyStats> {
  const rows = await prisma.$queryRaw<EfficacyCandidateRow[]>`
    SELECT
      p.id as product_id,
      p.model_no,
      p.product_name,
      p.category,
      watts.normalized_value as watts,
      lumens.normalized_value as lumens
    FROM products p
    JOIN product_params watts
      ON watts.product_id = p.id
      AND watts.param_key = 'watts'
      AND watts.normalized_value IS NOT NULL
      AND TRIM(watts.normalized_value) != ''
    JOIN product_params lumens
      ON lumens.product_id = p.id
      AND lumens.param_key = 'lumens'
      AND lumens.normalized_value IS NOT NULL
      AND TRIM(lumens.normalized_value) != ''
  `;

  const productIdsWithEfficacy = new Set(
    (
      await prisma.productParam.findMany({
        where: {
          paramKey: "luminous_efficacy",
          normalizedValue: { not: null },
        },
        select: { productId: true, normalizedValue: true },
      })
    )
      .filter((row) => row.normalizedValue && row.normalizedValue.trim())
      .map((row) => row.productId),
  );

  const planned: PlannedParam[] = [];
  const samples: EfficacyStats["samples"] = [];
  let filtered = 0;

  for (const row of rows) {
    if (productIdsWithEfficacy.has(row.product_id)) continue;
    const watts = parseNumberOrRangeMidpoint(row.watts);
    const lumens = parseNumberOrRangeMidpoint(row.lumens);
    if (watts == null || lumens == null || watts <= 0) {
      filtered += 1;
      continue;
    }

    const efficacy = Math.round(lumens / watts);
    if (efficacy < 30 || efficacy > 250) {
      filtered += 1;
      continue;
    }

    planned.push({
      id: randomUUID(),
      productId: row.product_id,
      modelNo: row.model_no,
      productName: row.product_name,
      category: row.category ?? "(未分类)",
      paramKey: "luminous_efficacy",
      rawValue: `${efficacy} lm/W`,
      normalizedValue: String(efficacy),
      unit: "lm/W",
      sourceField: "derived_efficacy",
      confidence: "medium",
    });

    if (samples.length < 20) {
      samples.push({
        category: row.category ?? "(未分类)",
        modelNo: row.model_no ?? row.product_name,
        watts: row.watts ?? "",
        lumens: row.lumens ?? "",
        efficacy,
      });
    }
  }

  return {
    productsWithWattsLumens: rows.length,
    existingEfficacy: rows.filter((row) => productIdsWithEfficacy.has(row.product_id)).length,
    derivable: planned.length,
    filtered,
    planned,
    samples,
  };
}

async function planDeferredDefaults(
  existingParamKeys: Set<string>,
): Promise<{ rows: DeferredDefaultStats[]; plannedParams: PlannedParam[] }> {
  const rows: DeferredDefaultStats[] = [];
  const plannedParams: PlannedParam[] = [];

  for (const defaultRule of DEFERRED_DEFAULTS) {
    const distribution = await prisma.$queryRaw<Array<{ normalized_value: string; product_count: DbCount }>>`
      SELECT
        pp.normalized_value,
        COUNT(DISTINCT pp.product_id) as product_count
      FROM product_params pp
      JOIN products p ON p.id = pp.product_id
      WHERE p.category = ${defaultRule.category}
        AND pp.param_key = ${defaultRule.paramKey}
        AND pp.normalized_value IS NOT NULL
        AND TRIM(pp.normalized_value) != ''
      GROUP BY pp.normalized_value
      ORDER BY COUNT(DISTINCT pp.product_id) DESC
    `;

    const samples = distribution.reduce((sum, row) => sum + toNumber(row.product_count), 0);
    const dominant = distribution[0];
    const dominantValue = dominant?.normalized_value ?? "";
    const dominantRatio = samples > 0 && dominant ? toNumber(dominant.product_count) / samples : 0;
    let status = "跳过";
    let planned = 0;

    if (samples < 10) {
      status = "跳过：样本不足";
    } else if (dominantRatio < 0.85) {
      status = "跳过：主导值不足 85%";
    } else if (normalizeComparable(dominantValue) !== normalizeComparable(defaultRule.value)) {
      status = "跳过：主导值不是目标默认";
    } else {
      const missingProducts = await prisma.product.findMany({
        where: {
          category: defaultRule.category,
          params: {
            none: {
              paramKey: defaultRule.paramKey,
              normalizedValue: { not: null },
            },
          },
        },
        select: { id: true, modelNo: true, productName: true, category: true },
      });

      for (const product of missingProducts) {
        const key = productParamKey(product.id, defaultRule.paramKey);
        if (existingParamKeys.has(key)) continue;
        plannedParams.push({
          id: randomUUID(),
          productId: product.id,
          modelNo: product.modelNo,
          productName: product.productName,
          category: product.category ?? "(未分类)",
          paramKey: defaultRule.paramKey,
          rawValue: defaultRule.rawValue,
          normalizedValue: defaultRule.value,
          unit: defaultRule.unit,
          sourceField: "category_default",
          confidence: "low",
        });
        existingParamKeys.add(key);
        planned += 1;
      }
      status = "可传播";
    }

    rows.push({
      category: defaultRule.category,
      paramKey: defaultRule.paramKey,
      samples,
      dominantValue,
      dominantRatio,
      status,
      planned,
    });
  }

  return { rows, plannedParams };
}

async function buildCoverageAudit(): Promise<CoverageAudit> {
  const [totalProducts, productParams] = await Promise.all([prisma.product.count(), prisma.productParam.count()]);
  const categoryRows: CoverageCategoryRow[] = [];
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
    const complete = toNumber(counts[0]?.complete_products);
    completeProducts += complete;
    scopedProducts += total;

    const paramBreakdown = Object.fromEntries(coreParams.map((paramKey) => [paramKey, 0]));
    for (const row of breakdownRows) {
      paramBreakdown[row.param_key] = toNumber(row.product_count);
    }

    for (const paramKey of coreParams) {
      const totalForParam = paramTotals.get(paramKey) ?? { coveredProducts: 0, requiredProducts: 0 };
      totalForParam.coveredProducts += paramBreakdown[paramKey] ?? 0;
      totalForParam.requiredProducts += total;
      paramTotals.set(paramKey, totalForParam);
    }

    categoryRows.push({
      category,
      totalProducts: total,
      completeProducts: complete,
      coreParamCount: coreParams.length,
      paramBreakdown,
    });
  }

  categoryRows.sort((left, right) => {
    const leftRate = left.totalProducts > 0 ? left.completeProducts / left.totalProducts : 0;
    const rightRate = right.totalProducts > 0 ? right.completeProducts / right.totalProducts : 0;
    return rightRate - leftRate || right.totalProducts - left.totalProducts || left.category.localeCompare(right.category);
  });

  const paramRows = Array.from(paramTotals.entries())
    .map(([paramKey, counts]) => ({ paramKey, ...counts }))
    .sort((left, right) => right.requiredProducts - left.requiredProducts || left.paramKey.localeCompare(right.paramKey));

  return {
    totalProducts,
    productParams,
    completeProducts,
    scopedProducts,
    categoryRows,
    paramRows,
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

function buildReport(input: {
  mode: "dry-run" | "apply";
  beforeCounts: { products: number; productParams: number };
  afterCounts: { products: number; productParams: number };
  insertedParams: number;
  consistencyStats: ConsistencyStats;
  efficacyStats: EfficacyStats;
  deferredDefaultStats: DeferredDefaultStats[];
  coverageAudit: CoverageAudit;
}): string {
  const outlierRatio =
    input.consistencyStats.withReference > 0 ? input.consistencyStats.outliers / input.consistencyStats.withReference : 0;
  const completionRate =
    input.coverageAudit.scopedProducts > 0 ? input.coverageAudit.completeProducts / input.coverageAudit.scopedProducts : 0;

  return `# V13.1 AI 推断后处理报告

模式: ${input.mode}
时间: ${new Date().toISOString()}
备份: ${BACKUP_PATH}

## Part A — AI 推断一致性校验

同组参考数据口径：同 factory + category + param_key，且排除 source_field=deepseek_inference 的已有参数。

| 指标 | 数值 |
|---|---:|
| deepseek_inference 总记录 | ${input.consistencyStats.totalDeepseek} |
| 有同组参考数据 | ${input.consistencyStats.withReference} |
| 与同组一致 | ${input.consistencyStats.consistent} |
| 异常值 (outlier) | ${input.consistencyStats.outliers} |
| 异常比例 | ${formatPercent(outlierRatio)} |

### 异常值采样（前 30 条）

| category | product model | param_key | AI 值 | 同组主导值 |
|---|---|---|---|---|
${input.consistencyStats.outlierSamples
  .map(
    (row) =>
      `| ${escapeMd(row.category)} | ${escapeMd(row.modelNo)} | ${escapeMd(row.paramKey)} | ${escapeMd(row.aiValue)} | ${escapeMd(row.dominantValue)} |`,
  )
  .join("\n") || "| - | - | - | - | - |"}

## Part B — 派生 luminous_efficacy

| 指标 | 数值 |
|---|---:|
| 有 watts+lumens 的产品 | ${input.efficacyStats.productsWithWattsLumens} |
| 已有 efficacy | ${input.efficacyStats.existingEfficacy} |
| 可派生 | ${input.efficacyStats.derivable} |
| 过滤（异常范围） | ${input.efficacyStats.filtered} |
| 实际新增 | ${input.mode === "apply" ? input.efficacyStats.derivable : 0} |

### 采样（前 20 条）

| category | model | watts | lumens | efficacy (lm/W) |
|---|---|---:|---:|---:|
${input.efficacyStats.samples
  .map(
    (row) =>
      `| ${escapeMd(row.category)} | ${escapeMd(row.modelNo)} | ${escapeMd(row.watts)} | ${escapeMd(row.lumens)} | ${row.efficacy} |`,
  )
  .join("\n") || "| - | - | - | - | - |"}

## Part C — 品类缺口兜底

| category | param_key | 当前样本 | 主导值占比 | 状态 | 新增 |
|---|---|---:|---:|---|---:|
${input.deferredDefaultStats
  .map(
    (row) =>
      `| ${escapeMd(row.category)} | ${escapeMd(row.paramKey)} | ${row.samples} | ${formatPercent(row.dominantRatio)} (${escapeMd(
        row.dominantValue,
      )}) | ${escapeMd(row.status)} | ${row.planned} |`,
  )
  .join("\n")}

## Part D — 最终覆盖率矩阵

### 品类核心参数完成率

| 品类 | 总产品 | 全部完成 | 完成率 | 核心参数数 |
|---|---:|---:|---:|---:|
${input.coverageAudit.categoryRows
  .map((row) => {
    const rate = row.totalProducts > 0 ? row.completeProducts / row.totalProducts : 0;
    return `| ${escapeMd(row.category)} | ${row.totalProducts} | ${row.completeProducts} | ${formatPercent(rate)} | ${row.coreParamCount} |`;
  })
  .join("\n")}

### 逐参数覆盖率

| param_key | 覆盖产品 | 需覆盖产品 | 覆盖率 |
|---|---:|---:|---:|
${input.coverageAudit.paramRows
  .map((row) => {
    const rate = row.requiredProducts > 0 ? row.coveredProducts / row.requiredProducts : 0;
    return `| ${escapeMd(row.paramKey)} | ${row.coveredProducts} | ${row.requiredProducts} | ${formatPercent(rate)} |`;
  })
  .join("\n")}

### 全局汇总

| 指标 | 数值 |
|---|---:|
| 总产品 | ${input.coverageAudit.totalProducts} |
| product_params | ${input.coverageAudit.productParams} |
| 核心参数覆盖范围产品 | ${input.coverageAudit.scopedProducts} |
| 核心参数全部完成产品 | ${input.coverageAudit.completeProducts} |
| 全局完成率 | ${formatPercent(completionRate)} |

## 汇总

| 指标 | 数值 |
|---|---:|
| Part B 新增 | ${input.mode === "apply" ? input.efficacyStats.derivable : 0} |
| Part C 新增 | ${input.mode === "apply" ? input.deferredDefaultStats.reduce((sum, row) => sum + row.planned, 0) : 0} |
| 本次写入 | ${input.insertedParams} |
| product_params 变化 | ${input.beforeCounts.productParams} → ${input.afterCounts.productParams} |
`;
}

function parseNumberOrRangeMidpoint(value: string | null | undefined): number | null {
  if (!value) return null;
  const numbers = value.replace(/,/g, "").match(/\d+(?:\.\d+)?/g);
  if (!numbers || numbers.length === 0) return null;
  const first = Number.parseFloat(numbers[0]);
  const last = Number.parseFloat(numbers[numbers.length - 1]);
  if (!Number.isFinite(first) || !Number.isFinite(last)) return null;
  return numbers.length >= 2 ? (first + last) / 2 : first;
}

function groupKey(category: string, factoryName: string, paramKey: string): string {
  return `${category}\u0000${factoryName}\u0000${paramKey}`;
}

function normalizeComparable(value: string): string {
  return value.normalize("NFC").trim().toLowerCase().replace(/\s+/g, "");
}

function toNumber(value: DbCount): number {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return value;
  return 0;
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
