import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

import { CATEGORY_CORE_PARAMS, escapeMd, INSERT_BATCH_SIZE, loadAccessoryProductIds } from "./v11-shared";

const prisma = new PrismaClient();

const APPLY_MODE = process.argv.includes("--apply");
const REPORT_PATH = path.join("docs", "v13.9-accessory-cleanup-report.md");
const BACKUP_PATH = path.join("prisma", "dev.db.bak-v13.9");

const V13_8_BASELINE = {
  scopedProducts: 10276,
  completeProducts: 5624,
  completionRate: 0.547,
};

const EXACT_ACCESSORY_NAMES = [
  "plug",
  "connector",
  "controller",
  "driver",
  "led driver",
  "middle connector",
  "end caps",
  "power cord",
];

const PREFIX_PATTERNS = [
  /^plug\s*[-–—]/i,
  /^plug\s+for\b/i,
  /^power input plug/i,
  /^2 ends plug/i,
  /^end caps/i,
  /^connector wire/i,
  /^middle connector/i,
];

const CONNECTOR_CONTAINS_CATEGORIES = new Set(["灯带", "磁吸灯", "线条灯", "地埋灯/地插灯"]);
const PLUG_CONTAINS_CATEGORIES = new Set(["磁吸灯", "线条灯"]);
const PACKAGE_ROW_CATEGORIES = new Set(["灯带", "面板灯"]);
const EXCLUDE_IDS: string[] = [];

type ProductRow = {
  id: string;
  modelNo: string | null;
  productName: string;
  category: string | null;
  remark: string | null;
};

type Candidate = {
  product: ProductRow;
  rule: RuleId;
  ruleLabel: string;
};

type RuleId = "1" | "2" | "3" | "4";

type CoverageResult = {
  scopedProducts: number;
  completeProducts: number;
  completionRate: number;
};

async function main() {
  const beforeCounts = await loadCounts();
  const products = await prisma.product.findMany({
    select: { id: true, modelNo: true, productName: true, category: true, remark: true },
  });
  const params = await prisma.productParam.findMany({
    where: { normalizedValue: { not: null } },
    select: { productId: true, paramKey: true, normalizedValue: true },
  });
  const existingAccessoryIds = await loadAccessoryProductIds(prisma);
  const existingRoleProductIds = await loadExistingProductRoleIds();
  const candidates = findCandidates(products, existingRoleProductIds);

  const inserted = APPLY_MODE ? await insertAccessoryParams(candidates) : 0;
  const afterCounts = await loadCounts();
  const effectiveAccessoryIds = new Set([...existingAccessoryIds, ...candidates.map((candidate) => candidate.product.id)]);
  const beforeCoverage = calculateCoverage(products, params, existingAccessoryIds);
  const afterCoverage = calculateCoverage(products, params, effectiveAccessoryIds);

  await mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await writeFile(
    REPORT_PATH,
    buildReport({
      mode: APPLY_MODE ? "apply" : "dry-run",
      candidates,
      inserted,
      beforeCounts,
      afterCounts,
      beforeCoverage,
      afterCoverage,
      existingAccessoryCount: existingAccessoryIds.size,
      effectiveAccessoryCount: effectiveAccessoryIds.size,
    }),
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        mode: APPLY_MODE ? "apply" : "dry-run",
        reportPath: REPORT_PATH,
        candidates: candidates.length,
        inserted,
        scopedProductsAfter: afterCoverage.scopedProducts,
        completeProductsAfter: afterCoverage.completeProducts,
        completionRateAfter: formatPercent(afterCoverage.completionRate),
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

async function loadExistingProductRoleIds(): Promise<Set<string>> {
  const rows = await prisma.productParam.findMany({
    where: { paramKey: "product_role" },
    select: { productId: true },
  });
  return new Set(rows.map((row) => row.productId));
}

function findCandidates(products: ProductRow[], existingRoleProductIds: Set<string>): Candidate[] {
  const candidates: Candidate[] = [];
  const excludedIds = new Set(EXCLUDE_IDS);
  for (const product of products) {
    if (excludedIds.has(product.id) || existingRoleProductIds.has(product.id)) continue;
    const rule = matchAccessoryRule(product);
    if (!rule) continue;
    candidates.push({ product, ...rule });
  }
  return candidates.sort((left, right) => Number(left.rule) - Number(right.rule) || (left.product.category ?? "").localeCompare(right.product.category ?? ""));
}

function matchAccessoryRule(product: ProductRow): Pick<Candidate, "rule" | "ruleLabel"> | null {
  const productName = product.productName.trim();
  const modelNo = product.modelNo?.trim() ?? "";
  const lowerName = productName.toLowerCase();
  const lowerModel = modelNo.toLowerCase();
  const category = product.category ?? "";
  const remark = product.remark ?? "";

  if (isPlugInProduct(lowerName) || isPlugInProduct(lowerModel)) return null;

  if (EXACT_ACCESSORY_NAMES.includes(lowerName) || EXACT_ACCESSORY_NAMES.includes(lowerModel)) {
    return { rule: "1", ruleLabel: "1: 关键词精确" };
  }

  if (PREFIX_PATTERNS.some((pattern) => pattern.test(productName))) {
    return { rule: "2", ruleLabel: "2: 前缀/包含" };
  }
  if (CONNECTOR_CONTAINS_CATEGORIES.has(category) && lowerName.includes("connector") && productName.length < 60) {
    return { rule: "2", ruleLabel: "2: 前缀/包含" };
  }
  if (PLUG_CONTAINS_CATEGORIES.has(category) && lowerName.includes("plug") && productName.length < 40) {
    return { rule: "2", ruleLabel: "2: 前缀/包含" };
  }

  if (category === "地埋灯/地插灯" && lowerName.includes("remote controller")) {
    return { rule: "3", ruleLabel: "3: Remote controller" };
  }

  if (isHeaderLikeProduct(product) && isPlaceholderRemark(remark)) {
    return { rule: "4", ruleLabel: "4: 标题/包装行" };
  }
  if (/^\d+pcs$/i.test(modelNo) && PACKAGE_ROW_CATEGORIES.has(category)) {
    return { rule: "4", ruleLabel: "4: 标题/包装行" };
  }
  if (modelNo === "43*75M" && category === "面板灯") {
    return { rule: "4", ruleLabel: "4: 标题/包装行" };
  }

  return null;
}

function isPlugInProduct(value: string): boolean {
  return /\bplug[\s-]?in\b/i.test(value);
}

function isHeaderLikeProduct(product: ProductRow): boolean {
  const normalizedValues = [product.productName, product.modelNo ?? ""].map((value) => value.trim().toLowerCase()).filter(Boolean);
  const headerLikeValues = new Set([
    "product no",
    "product no.",
    "product number",
    "model",
    "model no",
    "model no.",
    "item no",
    "item no.",
    "watt",
    "watt (±5%)",
    "watts",
    "material",
    "cct",
    "voltage",
  ]);
  return normalizedValues.some((value) => headerLikeValues.has(value));
}

function isPlaceholderRemark(remark: string): boolean {
  const patterns = [
    /Voltage:\s*Voltage/i,
    /Watt:\s*Watt/i,
    /Material:\s*Material/i,
    /CCT:\s*CCT/i,
    /Spec\.?:\s*Spec/i,
    /Warranty:\s*Warranty/i,
    /Beam\s*Angle:\s*Beam\s*Angle/i,
  ];
  return patterns.filter((pattern) => pattern.test(remark)).length >= 2;
}

async function insertAccessoryParams(candidates: Candidate[]): Promise<number> {
  let inserted = 0;
  for (let index = 0; index < candidates.length; index += INSERT_BATCH_SIZE) {
    const chunk = candidates.slice(index, index + INSERT_BATCH_SIZE);
    const result = await prisma.productParam.createMany({
      data: chunk.map((candidate) => ({
        id: randomUUID(),
        productId: candidate.product.id,
        paramKey: "product_role",
        rawValue: "accessory",
        normalizedValue: "accessory",
        unit: null,
        sourceField: "rule_classification",
        confidence: "high",
      })),
    });
    inserted += result.count;
  }
  return inserted;
}

function calculateCoverage(products: ProductRow[], params: Array<{ productId: string; paramKey: string; normalizedValue: string | null }>, accessoryIds: Set<string>): CoverageResult {
  const paramKeysByProduct = new Map<string, Set<string>>();
  for (const param of params) {
    if (!param.normalizedValue?.trim()) continue;
    const keys = paramKeysByProduct.get(param.productId) ?? new Set<string>();
    keys.add(param.paramKey);
    paramKeysByProduct.set(param.productId, keys);
  }

  let scopedProducts = 0;
  let completeProducts = 0;
  for (const product of products) {
    if (accessoryIds.has(product.id)) continue;
    const category = product.category?.trim();
    if (!category) continue;
    const coreParams = CATEGORY_CORE_PARAMS[category];
    if (!coreParams) continue;
    scopedProducts += 1;
    const keys = paramKeysByProduct.get(product.id) ?? new Set<string>();
    if (coreParams.every((paramKey) => keys.has(paramKey))) completeProducts += 1;
  }
  return {
    scopedProducts,
    completeProducts,
    completionRate: scopedProducts > 0 ? completeProducts / scopedProducts : 0,
  };
}

function buildReport(input: {
  mode: "dry-run" | "apply";
  candidates: Candidate[];
  inserted: number;
  beforeCounts: { products: number; productParams: number };
  afterCounts: { products: number; productParams: number };
  beforeCoverage: CoverageResult;
  afterCoverage: CoverageResult;
  existingAccessoryCount: number;
  effectiveAccessoryCount: number;
}): string {
  const byRule = new Map<string, number>();
  for (const candidate of input.candidates) byRule.set(candidate.ruleLabel, (byRule.get(candidate.ruleLabel) ?? 0) + 1);
  const ruleRows = ["1: 关键词精确", "2: 前缀/包含", "3: Remote controller", "4: 标题/包装行"].map((rule) => `| ${rule} | ${byRule.get(rule) ?? 0} |`).join("\n");

  return `# V13.9 配件标记报告

模式: ${input.mode}
时间: ${new Date().toISOString()}
备份: ${BACKUP_PATH}

## 匹配结果

| 规则 | 匹配数 |
|---|---:|
${ruleRows}
| 合计 | ${input.candidates.length} |
| 实际新增 product_role | ${input.inserted} |

## 标记明细

| category | model | product_name | 规则 |
|---|---|---|---|
${input.candidates.map((candidate) => `| ${escapeMd(candidate.product.category ?? "-")} | ${escapeMd(candidate.product.modelNo ?? "-")} | ${escapeMd(candidate.product.productName)} | ${candidate.ruleLabel} |`).join("\n") || "| - | - | - | - |"}

## 覆盖率变化

| 指标 | V13.8 | V13.9(排除配件) |
|---|---:|---:|
| 核心参数覆盖范围产品 | ${V13_8_BASELINE.scopedProducts} | ${input.afterCoverage.scopedProducts} |
| 全部完成产品 | ${V13_8_BASELINE.completeProducts} | ${input.afterCoverage.completeProducts} |
| 全局完成率 | ${formatPercent(V13_8_BASELINE.completionRate)} | ${formatPercent(input.afterCoverage.completionRate)} |
| 标记为配件 | ${input.existingAccessoryCount} | ${input.effectiveAccessoryCount} |

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
