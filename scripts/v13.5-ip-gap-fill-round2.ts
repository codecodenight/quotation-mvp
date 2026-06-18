import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

import { escapeMd, INSERT_BATCH_SIZE, productParamKey } from "./v11-shared";

const prisma = new PrismaClient();

const APPLY_MODE = process.argv.includes("--apply");
const REPORT_PATH = path.join("docs", "v13.5-ip-gap-fill-round2-report.md");
const BACKUP_PATH = path.join("prisma", "dev.db.bak-v13.5");

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

const OUTDOOR_FACTORY_CATEGORIES = ["三防灯", "防潮灯", "投光灯", "路灯", "工作灯", "庭院灯", "Highbay"];
const OUTDOOR_ALLOWED_IP = new Set(["20", "44", "54", "65", "66", "67"]);
const STRIP_ALLOWED_IP = new Set(["20", "44", "65"]);

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
  rawValue: string | null;
};

type PartKey = "A" | "B" | "C" | "D";

type PlannedParam = {
  id: string;
  productId: string;
  modelNo: string | null;
  productName: string;
  category: string;
  factoryName: string | null;
  part: PartKey;
  rawValue: string;
  normalizedValue: string;
  unit: null;
  sourceField: "category_default" | "factory_category_default";
  confidence: "low";
  evidence: string;
};

type GroupRule = {
  part: PartKey;
  category: string;
  factoryName: string;
  dominantValue: string;
  sampleCount: number;
  dominantCount: number;
  ratio: number;
  planned: number;
};

type PropagationConfig = {
  part: PartKey;
  categories: Set<string>;
  minSample: number;
  minRatio: number;
  allowed: Set<string>;
};

type Coverage = {
  productParams: number;
  ip: { coveredProducts: number; requiredProducts: number };
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
    select: { productId: true, paramKey: true, normalizedValue: true, rawValue: true },
  });

  const result = planIpFill(products, firstOffers, existingParams);
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

function planIpFill(
  products: ProductRow[],
  firstOffers: Map<string, string>,
  existingParams: ExistingParam[],
): {
  plannedParams: PlannedParam[];
  rules: GroupRule[];
  byPart: Map<PartKey, number>;
  skipReasons: Map<string, number>;
  samples: PlannedParam[];
} {
  const existingParamKeys = new Set<string>();
  const existingIpByProduct = new Map<string, string>();
  for (const param of existingParams) {
    const normalized = param.normalizedValue?.trim();
    if (!normalized) continue;
    existingParamKeys.add(productParamKey(param.productId, param.paramKey));
    if (param.paramKey === "ip") {
      const ip = normalizeIp(normalized) ?? normalizeIp(param.rawValue ?? "");
      if (ip) existingIpByProduct.set(param.productId, ip);
    }
  }

  const productsById = new Map(products.map((product) => [product.id, product]));
  const distribution = new Map<string, Map<string, Set<string>>>();
  for (const [productId, ip] of existingIpByProduct.entries()) {
    const product = productsById.get(productId);
    const factoryName = firstOffers.get(productId);
    if (!product?.category || !factoryName) continue;
    const group = groupKey(product.category, factoryName);
    const values = distribution.get(group) ?? new Map<string, Set<string>>();
    const productIds = values.get(ip) ?? new Set<string>();
    productIds.add(productId);
    values.set(ip, productIds);
    distribution.set(group, values);
  }

  const plannedParams: PlannedParam[] = [];
  const byPart = new Map<PartKey, number>();
  const skipReasons = new Map<string, number>();
  const samples: PlannedParam[] = [];
  const rulesByGroup = new Map<string, GroupRule>();

  for (const product of products) {
    if (!product.category || existingIpByProduct.has(product.id)) continue;
    if (product.category !== "太阳能壁灯") continue;
    addPlanned({
      plannedParams,
      byPart,
      samples,
      existingParamKeys,
      product,
      part: "A",
      factoryName: firstOffers.get(product.id) ?? null,
      normalizedValue: "65",
      sourceField: "category_default",
      evidence: "太阳能壁灯 category default",
    });
  }

  const configs: PropagationConfig[] = [
    { part: "B", categories: new Set(["灯带"]), minSample: 10, minRatio: 0.9, allowed: STRIP_ALLOWED_IP },
    { part: "C", categories: new Set(OUTDOOR_FACTORY_CATEGORIES), minSample: 10, minRatio: 0.9, allowed: OUTDOOR_ALLOWED_IP },
    { part: "D", categories: new Set(["皮线灯"]), minSample: 10, minRatio: 0.95, allowed: OUTDOOR_ALLOWED_IP },
  ];

  for (const config of configs) {
    for (const product of products) {
      if (!product.category || !config.categories.has(product.category) || existingIpByProduct.has(product.id)) continue;
      if (existingParamKeys.has(productParamKey(product.id, "ip"))) continue;
      const factoryName = firstOffers.get(product.id);
      if (!factoryName) {
        increment(skipReasons, `${config.part}:无工厂`);
        continue;
      }
      const values = distribution.get(groupKey(product.category, factoryName));
      if (!values || values.size === 0) {
        increment(skipReasons, `${config.part}:无参考分布`);
        continue;
      }
      const dominant = getDominant(values);
      if (dominant.sampleCount < config.minSample) {
        increment(skipReasons, `${config.part}:样本不足`);
        continue;
      }
      if (dominant.ratio < config.minRatio) {
        increment(skipReasons, `${config.part}:主导占比不足`);
        continue;
      }
      if (!config.allowed.has(dominant.value)) {
        increment(skipReasons, `${config.part}:IP 值不在允许范围`);
        continue;
      }

      const planned = addPlanned({
        plannedParams,
        byPart,
        samples,
        existingParamKeys,
        product,
        part: config.part,
        factoryName,
        normalizedValue: dominant.value,
        sourceField: "factory_category_default",
        evidence: `${dominant.dominantCount}/${dominant.sampleCount} (${formatPercent(dominant.ratio)})`,
      });
      if (!planned) continue;

      const ruleKey = `${config.part}\u0000${product.category}\u0000${factoryName}`;
      const rule =
        rulesByGroup.get(ruleKey) ??
        {
          part: config.part,
          category: product.category,
          factoryName,
          dominantValue: dominant.value,
          sampleCount: dominant.sampleCount,
          dominantCount: dominant.dominantCount,
          ratio: dominant.ratio,
          planned: 0,
        };
      rule.planned += 1;
      rulesByGroup.set(ruleKey, rule);
    }
  }

  return {
    plannedParams,
    byPart,
    skipReasons,
    samples,
    rules: Array.from(rulesByGroup.values()).sort((left, right) => right.planned - left.planned || left.category.localeCompare(right.category)),
  };
}

function addPlanned(input: {
  plannedParams: PlannedParam[];
  byPart: Map<PartKey, number>;
  samples: PlannedParam[];
  existingParamKeys: Set<string>;
  product: ProductRow;
  part: PartKey;
  factoryName: string | null;
  normalizedValue: string;
  sourceField: "category_default" | "factory_category_default";
  evidence: string;
}): PlannedParam | null {
  if (!input.product.category) return null;
  const key = productParamKey(input.product.id, "ip");
  if (input.existingParamKeys.has(key)) return null;

  const planned: PlannedParam = {
    id: randomUUID(),
    productId: input.product.id,
    modelNo: input.product.modelNo,
    productName: input.product.productName,
    category: input.product.category,
    factoryName: input.factoryName,
    part: input.part,
    rawValue: `IP${input.normalizedValue}`,
    normalizedValue: input.normalizedValue,
    unit: null,
    sourceField: input.sourceField,
    confidence: "low",
    evidence: input.evidence,
  };
  input.plannedParams.push(planned);
  input.existingParamKeys.add(key);
  input.byPart.set(input.part, (input.byPart.get(input.part) ?? 0) + 1);
  if (input.samples.length < 30) input.samples.push(planned);
  return planned;
}

async function insertParams(plannedParams: PlannedParam[]): Promise<number> {
  let inserted = 0;
  for (let index = 0; index < plannedParams.length; index += INSERT_BATCH_SIZE) {
    const chunk = plannedParams.slice(index, index + INSERT_BATCH_SIZE);
    const result = await prisma.productParam.createMany({
      data: chunk.map((param) => ({
        id: param.id,
        productId: param.productId,
        paramKey: "ip",
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
    ip: paramTotals.get("ip") ?? { coveredProducts: 0, requiredProducts: 0 },
    completeProducts,
    scopedProducts,
  };
}

function buildReport(input: {
  mode: "dry-run" | "apply";
  beforeCounts: { products: number; productParams: number };
  afterCounts: { products: number; productParams: number };
  beforeCoverage: Coverage;
  afterCoverage: Coverage;
  inserted: number;
  plannedParams: PlannedParam[];
  rules: GroupRule[];
  byPart: Map<PartKey, number>;
  skipReasons: Map<string, number>;
  samples: PlannedParam[];
}): string {
  return `# V13.5 IP 二轮规则补全报告

模式: ${input.mode}
时间: ${new Date().toISOString()}
备份: ${BACKUP_PATH}

## 汇总

| Part | 规则 | 新增 |
|---|---|---:|
| A | 太阳能壁灯 IP65 默认 | ${input.byPart.get("A") ?? 0} |
| B | 灯带工厂传播 | ${input.byPart.get("B") ?? 0} |
| C | 户外/工业品类工厂传播 | ${input.byPart.get("C") ?? 0} |
| D | 皮线灯严格工厂传播 | ${input.byPart.get("D") ?? 0} |
| 合计 | - | ${input.plannedParams.length} |
| 实际新增 | - | ${input.inserted} |

## 规则明细

| part | category | factory | 主导 IP | 样本数 | 占比 | 新增 |
|---|---|---|---:|---:|---:|---:|
${input.rules.map((rule) => `| ${rule.part} | ${escapeMd(rule.category)} | ${escapeMd(rule.factoryName)} | IP${rule.dominantValue} | ${rule.sampleCount} | ${formatPercent(rule.ratio)} | ${rule.planned} |`).join("\n") || "| - | - | - | - | 0 | 0.0% | 0 |"}

## 跳过原因

| reason | count |
|---|---:|
${Array.from(input.skipReasons.entries()).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).map(([reason, count]) => `| ${escapeMd(reason)} | ${count} |`).join("\n") || "| - | 0 |"}

## 采样（前 30 条）

| part | category | factory | model | IP | 依据 |
|---|---|---|---|---|---|
${input.samples.map((sample) => `| ${sample.part} | ${escapeMd(sample.category)} | ${escapeMd(sample.factoryName ?? "-")} | ${escapeMd(sample.modelNo ?? sample.productName)} | IP${sample.normalizedValue} | ${escapeMd(sample.evidence)} |`).join("\n") || "| - | - | - | - | - | - |"}

## 覆盖率变化

| 指标 | 变化前 | 变化后 |
|---|---:|---:|
| IP 覆盖率(需覆盖) | ${formatRatio(input.beforeCoverage.ip.coveredProducts, input.beforeCoverage.ip.requiredProducts)} | ${formatRatio(input.afterCoverage.ip.coveredProducts, input.afterCoverage.ip.requiredProducts)} |
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

function normalizeIp(value: string): string | null {
  const match = value.match(/(?:^|[^0-9])(?:ip\s*)?(20|44|54|65|66|67)(?:[^0-9]|$)/i);
  return match?.[1] ?? null;
}

function groupKey(category: string, factoryName: string): string {
  return `${category}\u0000${factoryName}`;
}

function increment(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
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
