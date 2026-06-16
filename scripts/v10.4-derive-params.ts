import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const REPORT_PATH = path.join("docs", "v10.4-derive-report.md");
const INSERT_BATCH_SIZE = 500;
const APPLY_MODE = process.argv.includes("--apply");
const WATTS_REGEX = /(?<![A-Za-z0-9])(\d+(?:\.\d+)?)\s*W(?![A-Za-z0-9])/gi;
const WATTS_FORBIDDEN_CONTEXT = /最大功率|总功率|max power|total power|连接最大|可连接/i;

type ProductRow = {
  id: string;
  modelNo: string | null;
  productName: string;
  category: string | null;
};

type ParamRow = {
  productId: string;
  paramKey: string;
  rawValue: string;
  normalizedValue: string | null;
  unit: string | null;
};

type PlannedParam = {
  id: string;
  productId: string;
  modelNo: string | null;
  productName: string;
  category: string;
  paramKey: "watts" | "luminous_efficacy";
  rawValue: string;
  normalizedValue: string;
  unit: string;
  sourceField: "product_name" | "model_no" | "derived";
  confidence: "medium";
  sampleDetail: string;
};

type CategoryStats = {
  category: string;
  watts: number;
  efficacy: number;
};

async function main() {
  const productParamsBefore = await prisma.productParam.count();
  const products = await prisma.product.findMany({
    select: { id: true, modelNo: true, productName: true, category: true },
    orderBy: [{ category: "asc" }, { modelNo: "asc" }, { productName: "asc" }],
  });
  const params = await prisma.productParam.findMany({
    where: { paramKey: { in: ["watts", "lumens", "luminous_efficacy"] } },
    select: {
      productId: true,
      paramKey: true,
      rawValue: true,
      normalizedValue: true,
      unit: true,
    },
  });

  const productsById = new Map(products.map((product) => [product.id, product]));
  const paramKeys = new Set(params.map((param) => productParamKey(param.productId, param.paramKey)));
  const plannedParams: PlannedParam[] = [];

  const productsMissingWatts = products.filter((product) => !paramKeys.has(productParamKey(product.id, "watts")));
  for (const product of productsMissingWatts) {
    const derived = deriveWatts(product);
    if (!derived) continue;
    plannedParams.push({
      id: randomUUID(),
      productId: product.id,
      modelNo: product.modelNo,
      productName: product.productName,
      category: product.category ?? "(未分类)",
      paramKey: "watts",
      rawValue: derived.rawValue,
      normalizedValue: derived.normalizedValue,
      unit: "W",
      sourceField: derived.sourceField,
      confidence: "medium",
      sampleDetail: derived.rawValue,
    });
    paramKeys.add(productParamKey(product.id, "watts"));
  }

  const wattsByProduct = firstParamByProduct(params.filter((param) => param.paramKey === "watts"));
  const lumensByProduct = firstParamByProduct(params.filter((param) => param.paramKey === "lumens"));
  const productIdsWithEfficacy = new Set(params.filter((param) => param.paramKey === "luminous_efficacy").map((param) => param.productId));
  for (const param of plannedParams) {
    if (param.paramKey !== "watts" || wattsByProduct.has(param.productId)) continue;
    wattsByProduct.set(param.productId, {
      productId: param.productId,
      paramKey: "watts",
      rawValue: param.rawValue,
      normalizedValue: param.normalizedValue,
      unit: param.unit,
    });
  }

  const efficacyCandidateProductIds = new Set([...wattsByProduct.keys()].filter((productId) => lumensByProduct.has(productId)));
  for (const productId of efficacyCandidateProductIds) {
    if (productIdsWithEfficacy.has(productId)) continue;
    const product = productsById.get(productId);
    const watts = parseSingleNumber(wattsByProduct.get(productId)?.normalizedValue);
    const lumens = parseSingleNumber(lumensByProduct.get(productId)?.normalizedValue);
    if (!product || watts == null || lumens == null || watts <= 0) continue;

    const efficacy = lumens / watts;
    if (efficacy < 10 || efficacy > 300) continue;

    plannedParams.push({
      id: randomUUID(),
      productId,
      modelNo: product.modelNo,
      productName: product.productName,
      category: product.category ?? "(未分类)",
      paramKey: "luminous_efficacy",
      rawValue: `${lumens}lm/${watts}W`,
      normalizedValue: Math.round(efficacy).toString(),
      unit: "lm/W",
      sourceField: "derived",
      confidence: "medium",
      sampleDetail: `${lumens} / ${watts} = ${Math.round(efficacy)} lm/W`,
    });
    productIdsWithEfficacy.add(productId);
  }

  const insertedParams = APPLY_MODE ? await insertParams(plannedParams) : 0;
  const productParamsAfter = await prisma.productParam.count();
  await mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await writeFile(
    REPORT_PATH,
    buildReport({
      mode: APPLY_MODE ? "apply" : "dry-run",
      productsMissingWatts: productsMissingWatts.length,
      efficacyCandidates: efficacyCandidateProductIds.size,
      plannedParams,
      insertedParams,
      productParamsBefore,
      productParamsAfter,
    }),
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        mode: APPLY_MODE ? "apply" : "dry-run",
        reportPath: REPORT_PATH,
        productsMissingWatts: productsMissingWatts.length,
        extractedWatts: plannedParams.filter((param) => param.paramKey === "watts").length,
        efficacyCandidates: efficacyCandidateProductIds.size,
        derivedEfficacy: plannedParams.filter((param) => param.paramKey === "luminous_efficacy").length,
        plannedParams: plannedParams.length,
        insertedParams,
        productParamsBefore,
        productParamsAfter,
      },
      null,
      2,
    ),
  );

  await prisma.$disconnect();
}

function deriveWatts(product: ProductRow): { rawValue: string; normalizedValue: string; sourceField: "product_name" | "model_no" } | null {
  return deriveWattsFromText(product.productName, "product_name") ?? deriveWattsFromText(product.modelNo ?? "", "model_no");
}

function deriveWattsFromText(
  text: string,
  sourceField: "product_name" | "model_no",
): { rawValue: string; normalizedValue: string; sourceField: "product_name" | "model_no" } | null {
  if (!text) return null;
  WATTS_REGEX.lastIndex = 0;

  for (const match of text.matchAll(WATTS_REGEX)) {
    const rawValue = match[0].trim();
    const normalizedValue = match[1];
    const index = match.index ?? 0;
    const context = text.slice(Math.max(0, index - 24), Math.min(text.length, index + rawValue.length + 24));
    if (WATTS_FORBIDDEN_CONTEXT.test(context)) continue;
    return { rawValue, normalizedValue, sourceField };
  }

  return null;
}

function firstParamByProduct(params: ParamRow[]): Map<string, ParamRow> {
  const byProduct = new Map<string, ParamRow>();
  for (const param of params) {
    if (byProduct.has(param.productId)) continue;
    byProduct.set(param.productId, param);
  }
  return byProduct;
}

function parseSingleNumber(value: string | null | undefined): number | null {
  if (!value) return null;
  const trimmed = value.replace(/,/g, "").trim();
  if (/\d\s*[-~–—]\s*\d/.test(trimmed)) return null;
  const match = trimmed.match(/^\d+(?:\.\d+)?$/) ?? trimmed.match(/\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number.parseFloat(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
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
  productsMissingWatts: number;
  efficacyCandidates: number;
  plannedParams: PlannedParam[];
  insertedParams: number;
  productParamsBefore: number;
  productParamsAfter: number;
}): string {
  const wattsParams = input.plannedParams.filter((param) => param.paramKey === "watts");
  const efficacyParams = input.plannedParams.filter((param) => param.paramKey === "luminous_efficacy");
  const categoryStats = buildCategoryStats(input.plannedParams);

  return `# V10.4 派生参数补全报告

模式: ${input.mode}
时间: ${new Date().toISOString()}

## 汇总

| 指标 | 数值 |
|---|---:|
| 无 watts 产品数 | ${input.productsMissingWatts.toLocaleString()} |
| 从 product_name 提取 watts | ${wattsParams.filter((param) => param.sourceField === "product_name").length.toLocaleString()} |
| 从 model_no 提取 watts | ${wattsParams.filter((param) => param.sourceField === "model_no").length.toLocaleString()} |
| 可派生 efficacy 的产品数 | ${input.efficacyCandidates.toLocaleString()} |
| 派生 luminous_efficacy | ${efficacyParams.length.toLocaleString()} |
| 总新增参数 | ${input.plannedParams.length.toLocaleString()} |
| 实际插入 | ${input.insertedParams.toLocaleString()} |
| product_params 变化 | ${input.productParamsBefore.toLocaleString()} → ${input.productParamsAfter.toLocaleString()} |

## 按品类统计

| 品类 | 新增 watts | 新增 efficacy |
|---|---:|---:|
${categoryStats.map((stat) => `| ${escapeMd(stat.category)} | ${stat.watts.toLocaleString()} | ${stat.efficacy.toLocaleString()} |`).join("\n")}

## watts 提取采样（前 50 条）

| 产品型号 | 品类 | product_name | 提取值 |
|---|---|---|---|
${wattsParams
  .slice(0, 50)
  .map((param) => `| ${escapeMd(param.modelNo ?? "-")} | ${escapeMd(param.category)} | ${escapeMd(param.productName)} | ${escapeMd(param.normalizedValue)} W |`)
  .join("\n")}

## efficacy 派生采样（前 50 条）

| 产品型号 | 品类 | lumens / watts | 派生光效 |
|---|---|---|---|
${efficacyParams
  .slice(0, 50)
  .map((param) => `| ${escapeMd(param.modelNo ?? "-")} | ${escapeMd(param.category)} | ${escapeMd(param.rawValue)} | ${escapeMd(param.normalizedValue)} lm/W |`)
  .join("\n")}
`;
}

function buildCategoryStats(plannedParams: PlannedParam[]): CategoryStats[] {
  const byCategory = new Map<string, CategoryStats>();

  for (const param of plannedParams) {
    const stat = byCategory.get(param.category) ?? { category: param.category, watts: 0, efficacy: 0 };
    if (param.paramKey === "watts") stat.watts += 1;
    if (param.paramKey === "luminous_efficacy") stat.efficacy += 1;
    byCategory.set(param.category, stat);
  }

  return [...byCategory.values()].sort((a, b) => b.watts + b.efficacy - (a.watts + a.efficacy) || a.category.localeCompare(b.category));
}

function productParamKey(productId: string, paramKey: string): string {
  return `${productId}\u0000${paramKey}`;
}

function escapeMd(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ").trim();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
