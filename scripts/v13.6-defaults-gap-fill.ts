import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

import { escapeMd, INSERT_BATCH_SIZE, productParamKey } from "./v11-shared";

const prisma = new PrismaClient();

const APPLY_MODE = process.argv.includes("--apply");
const REPORT_PATH = path.join("docs", "v13.6-defaults-gap-fill-report.md");
const BACKUP_PATH = path.join("prisma", "dev.db.bak-v13.6");

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

const TARGETS: TargetConfig[] = [
  {
    paramKey: "pf",
    categories: new Set(["面板灯", "三防灯", "防潮灯", "投光灯", "路灯", "筒灯", "吸顶灯", "净化灯", "轨道灯", "灯管", "球泡", "灯丝灯", "Highbay"]),
    normalize: normalizePf,
  },
  {
    paramKey: "driver_type",
    categories: new Set(["筒灯", "面板灯", "吸顶灯", "净化灯", "防潮灯", "壁灯", "镜前灯"]),
    normalize: normalizeDriverType,
  },
  {
    paramKey: "material",
    categories: new Set(["面板灯", "壁灯", "太阳能", "太阳能壁灯", "庭院灯", "投光灯", "充电灯"]),
    normalize: normalizeMaterial,
  },
];

const MIN_SAMPLE = 10;
const MIN_RATIO = 0.9;

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

type TargetConfig = {
  paramKey: "pf" | "driver_type" | "material";
  categories: Set<string>;
  normalize: (value: string) => string | null;
};

type PlannedParam = {
  id: string;
  productId: string;
  modelNo: string | null;
  productName: string;
  category: string;
  factoryName: string;
  paramKey: TargetConfig["paramKey"];
  rawValue: string;
  normalizedValue: string;
  unit: null;
  sourceField: "factory_category_default";
  confidence: "low";
  evidence: string;
};

type GroupRule = {
  paramKey: TargetConfig["paramKey"];
  category: string;
  factoryName: string;
  dominantValue: string;
  sampleCount: number;
  dominantCount: number;
  ratio: number;
  planned: number;
};

type Coverage = {
  productParams: number;
  params: Map<string, { coveredProducts: number; requiredProducts: number }>;
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

  const result = planDefaults(products, firstOffers, existingParams);
  const insertedByParam = APPLY_MODE ? await insertParams(result.plannedParams) : new Map<TargetConfig["paramKey"], number>();
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
      insertedByParam,
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
        insertedParams: sumMap(insertedByParam),
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

function planDefaults(
  products: ProductRow[],
  firstOffers: Map<string, string>,
  existingParams: ExistingParam[],
): {
  gapsByParam: Map<TargetConfig["paramKey"], number>;
  plannedByParam: Map<TargetConfig["paramKey"], number>;
  plannedParams: PlannedParam[];
  rules: GroupRule[];
  skipReasons: Map<string, number>;
  materialSamples: Map<string, PlannedParam[]>;
  samples: PlannedParam[];
} {
  const existingParamKeys = new Set<string>();
  const normalizedByProductParam = new Map<string, string>();
  const targetByKey = new Map(TARGETS.map((target) => [target.paramKey, target]));

  for (const param of existingParams) {
    const raw = param.normalizedValue?.trim() || param.rawValue?.trim();
    if (!raw) continue;
    existingParamKeys.add(productParamKey(param.productId, param.paramKey));
    const target = targetByKey.get(param.paramKey as TargetConfig["paramKey"]);
    if (!target) continue;
    const normalized = target.normalize(raw);
    if (!normalized) continue;
    const key = productParamKey(param.productId, param.paramKey);
    if (!normalizedByProductParam.has(key)) normalizedByProductParam.set(key, normalized);
  }

  const productsById = new Map(products.map((product) => [product.id, product]));
  const distributionByParam = new Map<string, Map<string, Set<string>>>();
  for (const [key, normalized] of normalizedByProductParam.entries()) {
    const [productId, paramKey] = key.split("\u0000") as [string, TargetConfig["paramKey"]];
    const product = productsById.get(productId);
    const factoryName = firstOffers.get(productId);
    if (!product?.category || !factoryName) continue;
    const group = `${paramKey}\u0000${product.category}\u0000${factoryName}`;
    const values = distributionByParam.get(group) ?? new Map<string, Set<string>>();
    const productIds = values.get(normalized) ?? new Set<string>();
    productIds.add(productId);
    values.set(normalized, productIds);
    distributionByParam.set(group, values);
  }

  const gapsByParam = new Map<TargetConfig["paramKey"], number>();
  const plannedByParam = new Map<TargetConfig["paramKey"], number>();
  const plannedParams: PlannedParam[] = [];
  const skipReasons = new Map<string, number>();
  const rulesByGroup = new Map<string, GroupRule>();
  const materialSamples = new Map<string, PlannedParam[]>();
  const samples: PlannedParam[] = [];

  for (const target of TARGETS) {
    for (const product of products) {
      if (!product.category || !target.categories.has(product.category)) continue;
      const paramKey = productParamKey(product.id, target.paramKey);
      if (existingParamKeys.has(paramKey)) continue;
      gapsByParam.set(target.paramKey, (gapsByParam.get(target.paramKey) ?? 0) + 1);
      if (target.paramKey === "material" && isLikelyMetaProduct(product)) {
        increment(skipReasons, `${target.paramKey}:疑似非产品行`);
        continue;
      }

      const factoryName = firstOffers.get(product.id);
      if (!factoryName) {
        increment(skipReasons, `${target.paramKey}:无工厂`);
        continue;
      }
      const values = distributionByParam.get(`${target.paramKey}\u0000${product.category}\u0000${factoryName}`);
      if (!values || values.size === 0) {
        increment(skipReasons, `${target.paramKey}:无参考分布`);
        continue;
      }
      const dominant = getDominant(values);
      if (dominant.sampleCount < MIN_SAMPLE) {
        increment(skipReasons, `${target.paramKey}:样本不足`);
        continue;
      }
      if (dominant.ratio < MIN_RATIO) {
        increment(skipReasons, `${target.paramKey}:主导占比不足`);
        continue;
      }
      if (!target.normalize(dominant.value)) {
        increment(skipReasons, `${target.paramKey}:值不合法`);
        continue;
      }

      const planned: PlannedParam = {
        id: randomUUID(),
        productId: product.id,
        modelNo: product.modelNo,
        productName: product.productName,
        category: product.category,
        factoryName,
        paramKey: target.paramKey,
        rawValue: dominant.value,
        normalizedValue: dominant.value,
        unit: null,
        sourceField: "factory_category_default",
        confidence: "low",
        evidence: `${dominant.dominantCount}/${dominant.sampleCount} (${formatPercent(dominant.ratio)})`,
      };
      plannedParams.push(planned);
      existingParamKeys.add(paramKey);
      plannedByParam.set(target.paramKey, (plannedByParam.get(target.paramKey) ?? 0) + 1);
      if (samples.length < 30) samples.push(planned);

      const ruleKey = `${target.paramKey}\u0000${product.category}\u0000${factoryName}`;
      const rule =
        rulesByGroup.get(ruleKey) ??
        {
          paramKey: target.paramKey,
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

      if (target.paramKey === "material") {
        const sampleKey = `${product.category}\u0000${factoryName}\u0000${dominant.value}`;
        const materialItems = materialSamples.get(sampleKey) ?? [];
        if (materialItems.length < 5) materialItems.push(planned);
        materialSamples.set(sampleKey, materialItems);
      }
    }
  }

  return {
    gapsByParam,
    plannedByParam,
    plannedParams,
    skipReasons,
    materialSamples,
    samples,
    rules: Array.from(rulesByGroup.values()).sort((left, right) => right.planned - left.planned || left.paramKey.localeCompare(right.paramKey)),
  };
}

async function insertParams(plannedParams: PlannedParam[]): Promise<Map<TargetConfig["paramKey"], number>> {
  const insertedByParam = new Map<TargetConfig["paramKey"], number>();
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
    for (const param of chunk) insertedByParam.set(param.paramKey, (insertedByParam.get(param.paramKey) ?? 0) + 1);
    if (result.count !== chunk.length) {
      console.warn(`Expected ${chunk.length} inserts, got ${result.count}`);
    }
  }
  return insertedByParam;
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

  return { productParams, params: paramTotals, completeProducts, scopedProducts };
}

function buildReport(input: {
  mode: "dry-run" | "apply";
  beforeCounts: { products: number; productParams: number };
  afterCounts: { products: number; productParams: number };
  beforeCoverage: Coverage;
  afterCoverage: Coverage;
  insertedByParam: Map<TargetConfig["paramKey"], number>;
  gapsByParam: Map<TargetConfig["paramKey"], number>;
  plannedByParam: Map<TargetConfig["paramKey"], number>;
  plannedParams: PlannedParam[];
  rules: GroupRule[];
  skipReasons: Map<string, number>;
  materialSamples: Map<string, PlannedParam[]>;
  samples: PlannedParam[];
}): string {
  const targetKeys = TARGETS.map((target) => target.paramKey);
  return `# V13.6 PF / driver_type / material 默认值补全报告

模式: ${input.mode}
时间: ${new Date().toISOString()}
备份: ${BACKUP_PATH}

## 汇总

| 参数 | 缺口 | 可填充 | 实际新增 |
|---|---:|---:|---:|
${targetKeys.map((paramKey) => `| ${paramKey} | ${input.gapsByParam.get(paramKey) ?? 0} | ${input.plannedByParam.get(paramKey) ?? 0} | ${input.insertedByParam.get(paramKey) ?? 0} |`).join("\n")}
| 合计 | ${sumMap(input.gapsByParam)} | ${input.plannedParams.length} | ${sumMap(input.insertedByParam)} |

## 规则明细

| param | category | factory | 主导值 | 样本数 | 占比 | 新增 |
|---|---|---|---|---:|---:|---:|
${input.rules.map((rule) => `| ${rule.paramKey} | ${escapeMd(rule.category)} | ${escapeMd(rule.factoryName)} | ${escapeMd(rule.dominantValue)} | ${rule.sampleCount} | ${formatPercent(rule.ratio)} | ${rule.planned} |`).join("\n") || "| - | - | - | - | 0 | 0.0% | 0 |"}

## Material 样本复查

| category | factory | material | 新增 | 示例产品 |
|---|---|---|---:|---|
${Array.from(input.materialSamples.entries()).map(([key, items]) => {
  const [category, factoryName, material] = key.split("\u0000");
  const added = input.rules.find((rule) => rule.paramKey === "material" && rule.category === category && rule.factoryName === factoryName && rule.dominantValue === material)?.planned ?? items.length;
  return `| ${escapeMd(category)} | ${escapeMd(factoryName)} | ${escapeMd(material)} | ${added} | ${escapeMd(items.map((item) => item.modelNo ?? item.productName).join("; "))} |`;
}).join("\n") || "| - | - | - | 0 | - |"}

## 跳过原因

| param | reason | count |
|---|---|---:|
${Array.from(input.skipReasons.entries()).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).map(([reason, count]) => {
  const [paramKey, reasonText] = reason.split(":");
  return `| ${escapeMd(paramKey)} | ${escapeMd(reasonText)} | ${count} |`;
}).join("\n") || "| - | - | 0 |"}

## 采样（前 30 条）

| param | category | factory | model | value | 依据 |
|---|---|---|---|---|---|
${input.samples.map((sample) => `| ${sample.paramKey} | ${escapeMd(sample.category)} | ${escapeMd(sample.factoryName)} | ${escapeMd(sample.modelNo ?? sample.productName)} | ${escapeMd(sample.normalizedValue)} | ${escapeMd(sample.evidence)} |`).join("\n") || "| - | - | - | - | - | - |"}

## 覆盖率变化

| 指标 | 变化前 | 变化后 |
|---|---:|---:|
| PF 覆盖率(需覆盖) | ${coverageLine(input.beforeCoverage, "pf")} | ${coverageLine(input.afterCoverage, "pf")} |
| driver_type 覆盖率(需覆盖) | ${coverageLine(input.beforeCoverage, "driver_type")} | ${coverageLine(input.afterCoverage, "driver_type")} |
| material 覆盖率(需覆盖) | ${coverageLine(input.beforeCoverage, "material")} | ${coverageLine(input.afterCoverage, "material")} |
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

function normalizePf(value: string): string | null {
  const text = value.toLowerCase().replace(/\s+/g, "");
  if (/(?:≥|>=)?0\.95|95%/.test(text)) return "0.95";
  if (/(?:≥|>=)?0\.9(?!\d)|90%/.test(text)) return "0.9";
  if (/(?:≥|>=)?0\.6(?!\d)|60%/.test(text)) return "0.6";
  if (/(?:≥|>=)?0\.5(?!\d)|50%/.test(text)) return "0.5";
  return null;
}

function normalizeDriverType(value: string): string | null {
  const text = value.trim();
  const upper = text.toUpperCase();
  if (upper.includes("DOB")) return "DOB";
  if (text.includes("非隔离")) return "非隔离";
  if (text.includes("隔离")) return "隔离";
  if (/\bIC\b/i.test(text)) return "IC";
  if (text.includes("恒流")) return "恒流";
  return null;
}

function normalizeMaterial(value: string): string | null {
  const text = value.replace(/\s+/g, " ").trim();
  if (!text || text.length > 80) return null;
  if (/[¥￥$€]|\b(?:rmb|usd|fob|price|unit\s*price|moq|ctn|carton|pcs)\b/i.test(text)) return null;
  if (/(?:单价|价格|含税|不含税|起订|装箱|箱规|外箱|彩盒|功率|瓦数|色温|电压|尺寸|规格|光通量|光效)/.test(text)) return null;
  if (/\d+(?:\.\d+)?\s*(?:w|v|k|mm|cm|lm|pcs|只|个|套|箱)/i.test(text)) return null;
  return text;
}

function isLikelyMetaProduct(product: ProductRow): boolean {
  const text = `${product.modelNo ?? ""} ${product.productName ?? ""}`.toLowerCase();
  if (!text.trim()) return true;
  return /chip\s*type|smd\s*2835|payment|t\/t|deposit|balance|loading|customized\s*packag|packing|instruction\s*manual|color\s*box|battery|back-?up|charge|discharge|moq|lower\s*quantity|solar\s*panel|monocrystalline|防护等级|付款|条款|包装|报价有效|validity|lead\s*time|delivery/.test(text);
}

function coverageLine(coverage: Coverage, paramKey: string): string {
  const item = coverage.params.get(paramKey) ?? { coveredProducts: 0, requiredProducts: 0 };
  return formatRatio(item.coveredProducts, item.requiredProducts);
}

function groupKey(category: string, factoryName: string): string {
  return `${category}\u0000${factoryName}`;
}

function increment(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function sumMap(map: Map<string, number>): number {
  return Array.from(map.values()).reduce((sum, value) => sum + value, 0);
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
