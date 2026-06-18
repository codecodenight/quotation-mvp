import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

import { CATEGORY_CORE_PARAMS, escapeMd } from "./v11-shared";

const prisma = new PrismaClient();

const REPORT_PATH = path.join("docs", "v13.8-core-param-refactor-report.md");

const OLD_GLOBAL = {
  scopedProducts: 10276,
  completeProducts: 5272,
  completionRate: 0.513,
  products: 10284,
  productParams: 88591,
};

const OLD_AFFECTED_CORE_PARAMS: Record<string, string[]> = {
  太阳能壁灯: ["cct", "ip", "material"],
  太阳能: ["cct", "ip", "material"],
  充电灯: ["cct", "ip", "material"],
  皮线灯: ["voltage", "ip"],
};

const REMOVED_PARAMS = [
  { category: "太阳能壁灯", paramKey: "material", reason: "供应商不提供，无业务选型价值" },
  { category: "太阳能", paramKey: "material", reason: "同上" },
  { category: "充电灯", paramKey: "material", reason: "电池灯具，材质非采购决策因素" },
  { category: "皮线灯", paramKey: "ip", reason: "装饰灯串，IP 非标准规格参数" },
];

type ProductRow = {
  id: string;
  category: string | null;
};

type CoverageResult = {
  scopedProducts: number;
  completeProducts: number;
  completionRate: number;
  categoryRows: CategoryCoverageRow[];
  paramRows: ParamCoverageRow[];
};

type CategoryCoverageRow = {
  category: string;
  productCount: number;
  completeProducts: number;
  completionRate: number;
};

type ParamCoverageRow = {
  paramKey: string;
  coveredProducts: number;
  requiredProducts: number;
  coverageRate: number;
};

async function main() {
  const [products, params, productCount, paramCount] = await Promise.all([
    prisma.product.findMany({ select: { id: true, category: true } }),
    prisma.productParam.findMany({
      where: { normalizedValue: { not: null } },
      select: { productId: true, paramKey: true, normalizedValue: true },
    }),
    prisma.product.count(),
    prisma.productParam.count(),
  ]);

  const paramKeysByProduct = new Map<string, Set<string>>();
  for (const param of params) {
    if (!param.normalizedValue?.trim()) continue;
    const keys = paramKeysByProduct.get(param.productId) ?? new Set<string>();
    keys.add(param.paramKey);
    paramKeysByProduct.set(param.productId, keys);
  }

  const current = calculateCoverage(products, paramKeysByProduct, CATEGORY_CORE_PARAMS);
  const oldAffected = calculateCoverage(products, paramKeysByProduct, OLD_AFFECTED_CORE_PARAMS);
  const newAffected = calculateCoverage(products, paramKeysByProduct, pickCoreParams(Object.keys(OLD_AFFECTED_CORE_PARAMS)));

  await mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await writeFile(
    REPORT_PATH,
    buildReport({
      current,
      oldAffected,
      newAffected,
      productCount,
      paramCount,
    }),
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        reportPath: REPORT_PATH,
        scopedProducts: current.scopedProducts,
        completeProducts: current.completeProducts,
        completionRate: formatPercent(current.completionRate),
        productParams: paramCount,
      },
      null,
      2,
    ),
  );
}

function calculateCoverage(products: ProductRow[], paramKeysByProduct: Map<string, Set<string>>, coreParamsByCategory: Record<string, string[]>): CoverageResult {
  const categoryRows: CategoryCoverageRow[] = [];
  const paramTotals = new Map<string, { coveredProducts: number; requiredProducts: number }>();
  let scopedProducts = 0;
  let completeProducts = 0;

  for (const [category, coreParams] of Object.entries(coreParamsByCategory)) {
    const categoryProducts = products.filter((product) => product.category === category);
    if (categoryProducts.length === 0) continue;
    scopedProducts += categoryProducts.length;
    let categoryComplete = 0;
    for (const product of categoryProducts) {
      const keys = paramKeysByProduct.get(product.id) ?? new Set<string>();
      const complete = coreParams.every((paramKey) => keys.has(paramKey));
      if (complete) {
        completeProducts += 1;
        categoryComplete += 1;
      }
      for (const paramKey of coreParams) {
        const item = paramTotals.get(paramKey) ?? { coveredProducts: 0, requiredProducts: 0 };
        item.requiredProducts += 1;
        if (keys.has(paramKey)) item.coveredProducts += 1;
        paramTotals.set(paramKey, item);
      }
    }
    categoryRows.push({
      category,
      productCount: categoryProducts.length,
      completeProducts: categoryComplete,
      completionRate: categoryProducts.length > 0 ? categoryComplete / categoryProducts.length : 0,
    });
  }

  const paramRows = Array.from(paramTotals.entries())
    .map(([paramKey, item]) => ({
      paramKey,
      coveredProducts: item.coveredProducts,
      requiredProducts: item.requiredProducts,
      coverageRate: item.requiredProducts > 0 ? item.coveredProducts / item.requiredProducts : 0,
    }))
    .sort((left, right) => left.paramKey.localeCompare(right.paramKey));

  return {
    scopedProducts,
    completeProducts,
    completionRate: scopedProducts > 0 ? completeProducts / scopedProducts : 0,
    categoryRows: categoryRows.sort((left, right) => right.productCount - left.productCount || left.category.localeCompare(right.category)),
    paramRows,
  };
}

function pickCoreParams(categories: string[]): Record<string, string[]> {
  return Object.fromEntries(categories.map((category) => [category, CATEGORY_CORE_PARAMS[category] ?? []]));
}

function buildReport(input: {
  current: CoverageResult;
  oldAffected: CoverageResult;
  newAffected: CoverageResult;
  productCount: number;
  paramCount: number;
}): string {
  const oldAffectedByCategory = new Map(input.oldAffected.categoryRows.map((row) => [row.category, row]));
  const newAffectedRows = input.newAffected.categoryRows;
  return `# V13.8 核心参数定义调整报告

时间: ${new Date().toISOString()}

## 定义变更

| 品类 | 移除参数 | 理由 |
|---|---|---|
${REMOVED_PARAMS.map((item) => `| ${escapeMd(item.category)} | ${item.paramKey} | ${escapeMd(item.reason)} |`).join("\n")}

## 集中化

| 文件 | 操作 |
|---|---|
| scripts/v11-shared.ts | 新增 CATEGORY_CORE_PARAMS 导出 |
| scripts/v13.1-post-inference.ts | 删除本地副本，改为 import |
| scripts/v13.2-rule-based-gap-fill.ts | 删除本地副本，改为 import |
| scripts/v13.3-remark-extraction.ts | 删除本地副本，改为 import |
| scripts/v13.4-cct-safe-propagation.ts | 删除本地副本，改为 import |
| scripts/v13.5-ip-gap-fill-round2.ts | 删除本地副本，改为 import |
| scripts/v13.6-defaults-gap-fill.ts | 删除本地副本，改为 import |
| scripts/v13.7-core-param-definition-audit.ts | 删除本地副本，改为 import |

## 覆盖率变化

| 指标 | 调整前(V13.6) | 调整后 |
|---|---:|---:|
| 核心参数覆盖范围产品 | ${OLD_GLOBAL.scopedProducts} | ${input.current.scopedProducts} |
| 全部完成产品 | ${OLD_GLOBAL.completeProducts} | ${input.current.completeProducts} |
| 全局完成率 | ${formatPercent(OLD_GLOBAL.completionRate)} | ${formatPercent(input.current.completionRate)} |

### 逐品类变化（仅受影响品类）

| 品类 | 旧完成 | 新完成 | 变化 |
|---|---:|---:|---:|
${newAffectedRows.map((row) => {
  const oldRow = oldAffectedByCategory.get(row.category);
  const oldComplete = oldRow?.completeProducts ?? 0;
  return `| ${escapeMd(row.category)} | ${oldComplete} | ${row.completeProducts} | ${row.completeProducts - oldComplete} |`;
}).join("\n")}

### 逐参数覆盖率

| param_key | 覆盖 | 需覆盖 | 覆盖率 |
|---|---:|---:|---:|
${input.current.paramRows.map((row) => `| ${row.paramKey} | ${row.coveredProducts} | ${row.requiredProducts} | ${formatPercent(row.coverageRate)} |`).join("\n")}

## DB 计数

| 表 | 数量 | 变化 |
|---|---:|---:|
| products | ${input.productCount} | 0 |
| product_params | ${input.paramCount} | 0 |
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
