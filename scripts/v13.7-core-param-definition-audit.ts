import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

import { escapeMd } from "./v11-shared";

const prisma = new PrismaClient();

const REPORT_PATH = path.join("docs", "v13.7-core-param-definition-audit.md");
const LOW_COVERAGE_THRESHOLD = 0.3;

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

type ProductRow = {
  id: string;
  modelNo: string | null;
  productName: string;
  category: string | null;
  remark: string | null;
  size: string | null;
};

type SourceRow = {
  product_id: string;
  relative_path: string | null;
};

type CoverageRow = {
  category: string;
  paramKey: string;
  totalProducts: number;
  coveredProducts: number;
  coverageRate: number;
  missingProducts: number;
  judgment: RiskLevel;
  reason: string;
};

type SimulationRow = {
  category: string;
  paramKey: string;
  currentComplete: number;
  simulatedComplete: number;
  addedComplete: number;
  globalUplift: number;
  judgment: RiskLevel;
  reason: string;
};

type SampleRow = {
  category: string;
  paramKey: string;
  model: string;
  productName: string;
  remarkSample: string;
  sourceFile: string;
};

type RiskLevel = "safe-to-remove?" | "needs-user-decision" | "keep-required" | "data-gap-not-definition-gap";

async function main() {
  const [products, params, sourceRows] = await Promise.all([
    prisma.product.findMany({
      select: { id: true, modelNo: true, productName: true, category: true, remark: true, size: true },
    }),
    prisma.productParam.findMany({
      where: { normalizedValue: { not: null } },
      select: { productId: true, paramKey: true, normalizedValue: true },
    }),
    loadSourceRows(),
  ]);

  const paramKeysByProduct = new Map<string, Set<string>>();
  for (const param of params) {
    if (!param.normalizedValue?.trim()) continue;
    const keys = paramKeysByProduct.get(param.productId) ?? new Set<string>();
    keys.add(param.paramKey);
    paramKeysByProduct.set(param.productId, keys);
  }
  const sourceByProduct = new Map(sourceRows.map((row) => [row.product_id, row.relative_path ?? "-"]));
  const productsByCategory = groupProductsByCategory(products);
  const scopedProducts = Array.from(productsByCategory.entries())
    .filter(([category]) => CATEGORY_CORE_PARAMS[category])
    .flatMap(([, items]) => items);
  const productMissing = new Map<string, string[]>();
  let currentComplete = 0;

  for (const product of scopedProducts) {
    const coreParams = CATEGORY_CORE_PARAMS[product.category ?? ""] ?? [];
    const keys = paramKeysByProduct.get(product.id) ?? new Set<string>();
    const missing = coreParams.filter((paramKey) => !keys.has(paramKey));
    productMissing.set(product.id, missing);
    if (missing.length === 0) currentComplete += 1;
  }

  const coverageRows = buildCoverageRows(productsByCategory, paramKeysByProduct);
  const lowCoverageRows = coverageRows
    .filter((row) => row.coverageRate < LOW_COVERAGE_THRESHOLD)
    .sort((left, right) => left.coverageRate - right.coverageRate || right.missingProducts - left.missingProducts);
  const simulationRows = buildSimulationRows(productsByCategory, productMissing, currentComplete, scopedProducts.length);
  const sampleRows = buildSampleRows(lowCoverageRows, productsByCategory, paramKeysByProduct, sourceByProduct);

  await mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await writeFile(
    REPORT_PATH,
    buildReport({
      scopedProducts: scopedProducts.length,
      currentComplete,
      completionRate: scopedProducts.length > 0 ? currentComplete / scopedProducts.length : 0,
      lowCoverageRows,
      simulationRows,
      sampleRows,
    }),
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        mode: "read-only",
        reportPath: REPORT_PATH,
        scopedProducts: scopedProducts.length,
        completeProducts: currentComplete,
        completionRate: formatPercent(scopedProducts.length > 0 ? currentComplete / scopedProducts.length : 0),
        lowCoverageItems: lowCoverageRows.length,
      },
      null,
      2,
    ),
  );
}

async function loadSourceRows(): Promise<SourceRow[]> {
  return prisma.$queryRaw<SourceRow[]>`
    SELECT product_id, relative_path
    FROM (
      SELECT
        so.product_id,
        f.relative_path,
        ROW_NUMBER() OVER (PARTITION BY so.product_id ORDER BY so.created_at ASC) as rn
      FROM supplier_offers so
      LEFT JOIN files f ON f.id = so.source_file_id
    )
    WHERE rn = 1
  `;
}

function groupProductsByCategory(products: ProductRow[]): Map<string, ProductRow[]> {
  const groups = new Map<string, ProductRow[]>();
  for (const product of products) {
    const category = product.category?.trim();
    if (!category) continue;
    const items = groups.get(category) ?? [];
    items.push(product);
    groups.set(category, items);
  }
  return groups;
}

function buildCoverageRows(productsByCategory: Map<string, ProductRow[]>, paramKeysByProduct: Map<string, Set<string>>): CoverageRow[] {
  const rows: CoverageRow[] = [];
  for (const [category, coreParams] of Object.entries(CATEGORY_CORE_PARAMS)) {
    const products = productsByCategory.get(category) ?? [];
    if (products.length === 0) continue;
    for (const paramKey of coreParams) {
      const coveredProducts = products.filter((product) => paramKeysByProduct.get(product.id)?.has(paramKey)).length;
      const coverageRate = coveredProducts / products.length;
      const judgment = judgeRequirement(category, paramKey, coverageRate, products.length - coveredProducts, 0);
      rows.push({
        category,
        paramKey,
        totalProducts: products.length,
        coveredProducts,
        coverageRate,
        missingProducts: products.length - coveredProducts,
        judgment: judgment.level,
        reason: judgment.reason,
      });
    }
  }
  return rows;
}

function buildSimulationRows(
  productsByCategory: Map<string, ProductRow[]>,
  productMissing: Map<string, string[]>,
  currentComplete: number,
  scopedProductCount: number,
): SimulationRow[] {
  const rows: SimulationRow[] = [];
  for (const [category, coreParams] of Object.entries(CATEGORY_CORE_PARAMS)) {
    const products = productsByCategory.get(category) ?? [];
    if (products.length === 0) continue;
    for (const paramKey of coreParams) {
      const addedComplete = products.filter((product) => {
        const missing = productMissing.get(product.id) ?? [];
        return missing.length === 1 && missing[0] === paramKey;
      }).length;
      const simulatedComplete = currentComplete + addedComplete;
      const judgment = judgeRequirement(category, paramKey, 1, 0, addedComplete);
      rows.push({
        category,
        paramKey,
        currentComplete,
        simulatedComplete,
        addedComplete,
        globalUplift: scopedProductCount > 0 ? addedComplete / scopedProductCount : 0,
        judgment: judgment.level,
        reason: judgment.reason,
      });
    }
  }
  return rows.sort((left, right) => right.addedComplete - left.addedComplete || left.category.localeCompare(right.category));
}

function buildSampleRows(
  lowCoverageRows: CoverageRow[],
  productsByCategory: Map<string, ProductRow[]>,
  paramKeysByProduct: Map<string, Set<string>>,
  sourceByProduct: Map<string, string>,
): SampleRow[] {
  const samples: SampleRow[] = [];
  for (const row of lowCoverageRows) {
    const products = productsByCategory.get(row.category) ?? [];
    const missingProducts = products.filter((product) => !paramKeysByProduct.get(product.id)?.has(row.paramKey)).slice(0, 20);
    for (const product of missingProducts) {
      samples.push({
        category: row.category,
        paramKey: row.paramKey,
        model: product.modelNo ?? "-",
        productName: product.productName,
        remarkSample: sampleText(product.remark ?? product.size ?? ""),
        sourceFile: sourceByProduct.get(product.id) ?? "-",
      });
    }
  }
  return samples;
}

function buildReport(input: {
  scopedProducts: number;
  currentComplete: number;
  completionRate: number;
  lowCoverageRows: CoverageRow[];
  simulationRows: SimulationRow[];
  sampleRows: SampleRow[];
}): string {
  const safeRows = input.simulationRows.filter((row) => row.judgment === "safe-to-remove?" && row.addedComplete > 0);
  const decisionRows = input.simulationRows.filter((row) => row.judgment === "needs-user-decision" && (row.addedComplete > 0 || input.lowCoverageRows.some((low) => low.category === row.category && low.paramKey === row.paramKey)));
  const dataGapRows = input.lowCoverageRows.filter((row) => row.judgment === "data-gap-not-definition-gap" || row.judgment === "keep-required");
  const sampleSections = groupSamples(input.sampleRows)
    .map(
      ([key, rows]) => `### ${escapeMd(key.replace("\u0000", " / "))}

| model | product_name | remark sample | source file |
|---|---|---|---|
${rows.map((row) => `| ${escapeMd(row.model)} | ${escapeMd(row.productName)} | ${escapeMd(row.remarkSample)} | ${escapeMd(row.sourceFile)} |`).join("\n")}
`,
    )
    .join("\n");

  return `# V13.7 核心参数定义审计

模式: read-only
时间: ${new Date().toISOString()}

## 当前全局完成率

| 指标 | 数值 |
|---|---:|
| 核心参数覆盖范围产品 | ${input.scopedProducts} |
| 全部完成产品 | ${input.currentComplete} |
| 完成率 | ${formatPercent(input.completionRate)} |

## 低覆盖参数清单

| category | param_key | 产品数 | 覆盖数 | 覆盖率 | 缺口 | 初步判断 |
|---|---|---:|---:|---:|---:|---|
${input.lowCoverageRows.map((row) => `| ${escapeMd(row.category)} | ${row.paramKey} | ${row.totalProducts} | ${row.coveredProducts} | ${formatPercent(row.coverageRate)} | ${row.missingProducts} | ${row.judgment}: ${escapeMd(row.reason)} |`).join("\n") || "| - | - | 0 | 0 | 0.0% | 0 | - |"}

## 移除单项要求的模拟影响

| category | param_key | 当前完成产品 | 模拟完成产品 | 新增完成 | 全局完成率提升 | 建议 |
|---|---|---:|---:|---:|---:|---|
${input.simulationRows.slice(0, 80).map((row) => `| ${escapeMd(row.category)} | ${row.paramKey} | ${row.currentComplete} | ${row.simulatedComplete} | ${row.addedComplete} | ${formatPercent(row.globalUplift)} | ${row.judgment} |`).join("\n")}

## 建议清单

### safe-to-remove?

| category | param_key | 理由 | 影响 |
|---|---|---|---|
${safeRows.map((row) => `| ${escapeMd(row.category)} | ${row.paramKey} | ${escapeMd(row.reason)} | +${row.addedComplete} 完成产品 / ${formatPercent(row.globalUplift)} |`).join("\n") || "| - | - | 暂无可直接自动移除的要求 | - |"}

### needs-user-decision

| category | param_key | 需要用户判断的问题 | 影响 |
|---|---|---|---|
${decisionRows.slice(0, 40).map((row) => `| ${escapeMd(row.category)} | ${row.paramKey} | ${escapeMd(row.reason)} | +${row.addedComplete} 完成产品 / ${formatPercent(row.globalUplift)} |`).join("\n") || "| - | - | 暂无 | - |"}

### data-gap-not-definition-gap

| category | param_key | 下一步补数据建议 |
|---|---|---|
${dataGapRows.map((row) => `| ${escapeMd(row.category)} | ${row.paramKey} | ${escapeMd(row.reason)} |`).join("\n") || "| - | - | 暂无 |"}

## 缺失样本附录

${sampleSections || "无低覆盖参数样本。"}
`;
}

function judgeRequirement(category: string, paramKey: string, coverageRate: number, missingProducts: number, addedComplete: number): { level: RiskLevel; reason: string } {
  if (["voltage", "cct", "cri", "base"].includes(paramKey)) {
    return {
      level: missingProducts > 0 && coverageRate < LOW_COVERAGE_THRESHOLD ? "data-gap-not-definition-gap" : "keep-required",
      reason: "客户报价规格的基础信息，建议继续补数据，不建议从核心参数移除。",
    };
  }
  if (paramKey === "ip") {
    if (["线条灯", "皮线灯"].includes(category)) {
      return { level: "needs-user-decision", reason: "该品类可能同时有室内/户外版本，IP 是否作为核心参数需要按业务口径确认。" };
    }
    return { level: "data-gap-not-definition-gap", reason: "户外/防护类产品 IP 对报价和选型有实际意义，建议继续补数据。" };
  }
  if (paramKey === "material") {
    if (["太阳能", "太阳能壁灯", "庭院灯", "充电灯"].includes(category)) {
      return { level: "safe-to-remove?", reason: "材料对这些小太阳能/户外小品可能是可选描述，不一定适合作为核心完成率门槛。" };
    }
    return { level: "needs-user-decision", reason: "material 对客户展示有价值，但不同品类是否必须完整需要用户确认。" };
  }
  if (paramKey === "driver_type") {
    return { level: "needs-user-decision", reason: "driver_type 对采购判断有价值，但客户报价是否必须展示、是否应计入核心完成率需要确认。" };
  }
  if (paramKey === "pf") {
    if (["灯丝灯", "球泡", "灯管"].includes(category) && addedComplete > 0) {
      return { level: "needs-user-decision", reason: "PF 对电气合规有意义，但是否作为所有光源类产品的核心完成门槛需要确认。" };
    }
    return { level: "data-gap-not-definition-gap", reason: "PF 对市电产品有实际意义，建议继续保留并补齐。" };
  }
  if (paramKey === "beam_angle") {
    return { level: "needs-user-decision", reason: "beam_angle 对投光/轨道/工矿/路灯有选型价值，但不是所有报价场景都必须。" };
  }
  return { level: "needs-user-decision", reason: "需要用户按真实报价场景确认是否继续作为核心参数。" };
}

function groupSamples(samples: SampleRow[]): Array<[string, SampleRow[]]> {
  const groups = new Map<string, SampleRow[]>();
  for (const sample of samples) {
    const key = `${sample.category}\u0000${sample.paramKey}`;
    const rows = groups.get(key) ?? [];
    rows.push(sample);
    groups.set(key, rows);
  }
  return Array.from(groups.entries());
}

function sampleText(value: string): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return "-";
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
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
