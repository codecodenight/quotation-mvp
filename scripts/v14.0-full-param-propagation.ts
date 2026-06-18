import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

import { CATEGORY_CORE_PARAMS, escapeMd, INSERT_BATCH_SIZE, loadAccessoryProductIds, productParamKey } from "./v11-shared";

const prisma = new PrismaClient();

const APPLY_MODE = process.argv.includes("--apply");
const REPORT_PATH = path.join("docs", "v14.0-full-param-propagation-report.md");
const BACKUP_PATH = path.join("prisma", "dev.db.bak-v14.0");
const CORE_PARAM_KEYS = ["voltage", "cct", "cri", "pf", "ip", "material", "driver_type", "beam_angle", "base"] as const;

const V13_9_BASELINE = {
  scopedProducts: 10244,
  completeProducts: 5621,
  completionRate: 0.549,
};

type CoreParamKey = (typeof CORE_PARAM_KEYS)[number];

type ProductRow = {
  id: string;
  productName: string;
  modelNo: string | null;
  category: string | null;
  remark: string | null;
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
  sourceField: "remark_extraction_v14" | "file_propagation_v14" | "factory_category_propagation_v14";
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
};

type PropagationGroup = {
  productIds: string[];
  valueCounts: Map<string, { count: number; rawValue: string; normalizedValue: string; unit: string | null }>;
};

type RemarkExtraction = {
  rawValue: string;
  normalizedValue: string;
  unit: string | null;
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
  const partCStats = createPartStats();
  const partASamples: Array<{ product: ProductRow; param: NewParam; remarkSnippet: string }> = [];

  const productsById = new Map(products.map((product) => [product.id, product]));

  for (const product of products) {
    if (accessoryIds.has(product.id)) continue;
    const coreParams = getCoreParams(product);
    if (coreParams.length === 0) continue;
    const remark = product.remark?.trim() ?? "";
    if (remark.length < 5) continue;
    for (const paramKey of CORE_PARAM_KEYS) {
      if (!coreParams.includes(paramKey)) continue;
      if (existingParamKeys.has(productParamKey(product.id, paramKey))) continue;
      const extracted = extractFromRemark(paramKey, remark);
      if (!extracted) continue;
      const newParam = addNewParam({
        existingParamKeys,
        paramRows,
        newParams,
        productId: product.id,
        paramKey,
        rawValue: extracted.rawValue,
        normalizedValue: extracted.normalizedValue,
        unit: extracted.unit,
        sourceField: "remark_extraction_v14",
      });
      if (!newParam) continue;
      increment(partAStats, paramKey);
      if (partASamples.filter((sample) => sample.param.paramKey === paramKey).length < 5) {
        partASamples.push({ product, param: newParam, remarkSnippet: snippetAround(remark, extracted.rawValue) });
      }
    }
  }

  propagateByFile({ products, paramRows, firstOfferByProduct, accessoryIds, existingParamKeys, newParams, stats: partBStats });
  propagateByFactoryCategory({ products, paramRows, firstOfferByProduct, accessoryIds, existingParamKeys, newParams, stats: partCStats });

  if (APPLY_MODE) await insertNewParams(newParams);

  const afterCounts = await loadCounts();
  const beforeCoverage = calculateCoverage(products, initialParams, accessoryIds);
  const afterCoverage = calculateCoverage(products, [...initialParams, ...newParams], accessoryIds);

  await mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await writeFile(
    REPORT_PATH,
    buildReport({
      mode: APPLY_MODE ? "apply" : "dry-run",
      beforeCounts,
      afterCounts,
      productsById,
      beforeCoverage,
      afterCoverage,
      partAStats,
      partBStats,
      partCStats,
      partASamples,
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
        partC: partCStats.total,
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
    select: { id: true, productName: true, modelNo: true, category: true, remark: true },
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

function extractFromRemark(paramKey: CoreParamKey, remark: string): RemarkExtraction | null {
  switch (paramKey) {
    case "voltage":
      return extractVoltage(remark);
    case "cct":
      return extractCct(remark);
    case "cri":
      return extractCri(remark);
    case "pf":
      return extractPf(remark);
    case "ip":
      return extractIp(remark);
    case "material":
      return extractMaterial(remark);
    case "driver_type":
      return extractDriverType(remark);
    case "beam_angle":
      return extractBeamAngle(remark);
    case "base":
      return extractBase(remark);
  }
}

function extractVoltage(text: string): RemarkExtraction | null {
  const patterns = [
    /(?:voltage|电压|输入电压)[:\s：/]*(?:AC|DC)?\s*(\d{1,3}\s*[-–～~]\s*\d{1,3})\s*V?/i,
    /(?:voltage|电压)[:\s：/]*(?:AC|DC)?\s*(\d{1,3})\s*V/i,
    /\b(?:AC|DC)\s*(\d{1,3}\s*[-–～~]\s*\d{1,3})\s*V/i,
    /\b(?:AC|DC)\s*(\d{1,3})\s*V\b/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match?.[1]) continue;
    const normalized = match[1].replace(/\s+/g, "").replace(/[–～~]/g, "-");
    const first = Number.parseInt(normalized, 10);
    if (!Number.isFinite(first) || first < 5 || first > 480) continue;
    return { rawValue: match[0], normalizedValue: normalized, unit: "V" };
  }
  const frequencyMatch = text.match(/\b(\d{2,3}\s*[-–～~]\s*\d{2,3})\s*V\s*\/\s*50\s*Hz\b/i);
  if (frequencyMatch?.[1]) {
    return { rawValue: frequencyMatch[0], normalizedValue: frequencyMatch[1].replace(/\s+/g, "").replace(/[–～~]/g, "-"), unit: "V" };
  }
  return null;
}

function extractCct(text: string): RemarkExtraction | null {
  const match = text.match(/(?:CCT|C\.C\.T|色温|color\s*temp)[:\s：/]*(\d{4,5})\s*K/i);
  if (!match?.[1]) return null;
  const value = Number.parseInt(match[1], 10);
  if (!Number.isFinite(value) || value < 1800 || value > 10000) return null;
  return { rawValue: match[0], normalizedValue: String(value), unit: "K" };
}

function extractCri(text: string): RemarkExtraction | null {
  const patterns = [/\bRA\s*[>≥]?\s*(\d{2,3})/i, /\bCRI\s*[:\s：>≥]*(\d{2,3})/i, /显[色指][指数]*\s*[:\s：>≥]*(\d{2,3})/];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match?.[1]) continue;
    const value = Number.parseInt(match[1], 10);
    if (!Number.isFinite(value) || value < 60 || value > 100) continue;
    return { rawValue: match[0], normalizedValue: normalizeCri(value), unit: null };
  }
  return null;
}

function normalizeCri(value: number): string {
  if (value >= 95) return ">95";
  if (value >= 90) return ">90";
  return ">80";
}

function extractPf(text: string): RemarkExtraction | null {
  const patterns = [/\bPF\s*[:\s：>≥＞]*[DF]?\s*(0\.\d+)/i, /功率因[素数]\s*[:\s：>≥＞]*[DF]?\s*(0\.\d+)/];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match?.[1]) continue;
    const value = Number.parseFloat(match[1]);
    if (!Number.isFinite(value) || value < 0.1 || value > 1) continue;
    return { rawValue: match[0], normalizedValue: value >= 0.9 ? ">0.9" : ">0.5", unit: null };
  }
  return null;
}

function extractIp(text: string): RemarkExtraction | null {
  const patterns = [/\bIP\s*(\d{2})\b/i, /防水[等级]*\s*[:\s：]*IP\s*(\d{2})/];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match?.[1]) continue;
    const value = Number.parseInt(match[1], 10);
    if (!Number.isFinite(value) || value < 20 || value > 69) continue;
    return { rawValue: match[0], normalizedValue: `IP${value}`, unit: null };
  }
  return null;
}

function extractMaterial(text: string): RemarkExtraction | null {
  const match = text.match(/(?:material|材[质料]|材料)[:\s：/]*([^\n,;]{3,40})/i);
  if (!match?.[1]) return null;
  const value = match[1].trim().replace(/\s+/g, " ");
  if (/^[-/\s]*$|^material$/i.test(value)) return null;
  return { rawValue: match[0], normalizedValue: value, unit: null };
}

function extractDriverType(text: string): RemarkExtraction | null {
  const nonIsolated = text.match(/(?:driver|驱动|电源驱动)[:\s：/]*(?:No-isolated|non[-\s]?isolated|非隔离)/i);
  if (nonIsolated) return { rawValue: nonIsolated[0], normalizedValue: "non-isolated", unit: null };
  const isolated = text.match(/(?:driver|驱动|电源驱动)[:\s：/]*(?:isolated|隔离)/i);
  if (isolated) return { rawValue: isolated[0], normalizedValue: "isolated", unit: null };
  return null;
}

function extractBeamAngle(text: string): RemarkExtraction | null {
  const match = text.match(/(?:beam\s*angle|发光角度|光束角)[:\s：]*(\d{2,3})\s*°?/i);
  if (!match?.[1]) return null;
  const value = Number.parseInt(match[1], 10);
  if (!Number.isFinite(value) || value < 5 || value > 180) return null;
  return { rawValue: match[0], normalizedValue: String(value), unit: "°" };
}

function extractBase(text: string): RemarkExtraction | null {
  const match = text.match(/(?:base|lamp\s*base|灯头[类型]*)[:\s：]*([EGe][UuCc]?\d{1,2})/i);
  if (!match?.[1]) return null;
  return { rawValue: match[0], normalizedValue: match[1].toUpperCase(), unit: null };
}

function propagateByFile(input: {
  products: ProductRow[];
  paramRows: ParamRow[];
  firstOfferByProduct: Map<string, FirstOfferRow>;
  accessoryIds: Set<string>;
  existingParamKeys: Set<string>;
  newParams: NewParam[];
  stats: PartStats;
}): void {
  for (const paramKey of CORE_PARAM_KEYS) {
    const groups = new Map<string, PropagationGroup>();
    for (const product of input.products) {
      if (input.accessoryIds.has(product.id) || !getCoreParams(product).includes(paramKey)) continue;
      const sourceFileId = input.firstOfferByProduct.get(product.id)?.sourceFileId;
      if (!sourceFileId) continue;
      const group = groups.get(sourceFileId) ?? createPropagationGroup();
      group.productIds.push(product.id);
      groups.set(sourceFileId, group);
    }
    addValuesToGroups(groups, input.paramRows, paramKey);
    propagateFromGroups({
      groups,
      productsById: new Map(input.products.map((product) => [product.id, product])),
      paramKey,
      threshold: 0.7,
      minSamples: 3,
      sourceField: "file_propagation_v14",
      existingParamKeys: input.existingParamKeys,
      paramRows: input.paramRows,
      newParams: input.newParams,
      stats: input.stats,
    });
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
    propagateFromGroups({
      groups,
      productsById: new Map(input.products.map((product) => [product.id, product])),
      paramKey,
      threshold: 0.5,
      minSamples: 5,
      sourceField: "factory_category_propagation_v14",
      existingParamKeys: input.existingParamKeys,
      paramRows: input.paramRows,
      newParams: input.newParams,
      stats: input.stats,
    });
  }
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

function propagateFromGroups(input: {
  groups: Map<string, PropagationGroup>;
  productsById: Map<string, ProductRow>;
  paramKey: CoreParamKey;
  threshold: number;
  minSamples: number;
  sourceField: NewParam["sourceField"];
  existingParamKeys: Set<string>;
  paramRows: ParamRow[];
  newParams: NewParam[];
  stats: PartStats;
}): void {
  for (const group of input.groups.values()) {
    const dominant = getDominantValue(group);
    if (!dominant || dominant.count < input.minSamples || dominant.count / group.productIds.length < input.threshold) continue;
    for (const productId of group.productIds) {
      const product = input.productsById.get(productId);
      if (!product || !getCoreParams(product).includes(input.paramKey)) continue;
      const newParam = addNewParam({
        existingParamKeys: input.existingParamKeys,
        paramRows: input.paramRows,
        newParams: input.newParams,
        productId,
        paramKey: input.paramKey,
        rawValue: dominant.rawValue,
        normalizedValue: dominant.normalizedValue,
        unit: dominant.unit,
        sourceField: input.sourceField,
      });
      if (newParam) increment(input.stats, input.paramKey);
    }
  }
}

function getDominantValue(group: PropagationGroup): { count: number; rawValue: string; normalizedValue: string; unit: string | null } | null {
  return [...group.valueCounts.values()].sort((left, right) => right.count - left.count || left.normalizedValue.localeCompare(right.normalizedValue))[0] ?? null;
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

  for (const product of products) {
    if (accessoryIds.has(product.id)) continue;
    const coreParams = getCoreParams(product);
    const category = product.category?.trim();
    if (!category || coreParams.length === 0) continue;
    scopedProducts += 1;
    const keys = paramKeysByProduct.get(product.id) ?? new Set<string>();
    const categoryStats = byCategory.get(category) ?? { total: 0, complete: 0 };
    categoryStats.total += 1;
    const complete = coreParams.every((paramKey) => keys.has(paramKey));
    if (complete) {
      completeProducts += 1;
      categoryStats.complete += 1;
    }
    byCategory.set(category, categoryStats);
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
  };
}

function buildReport(input: {
  mode: "dry-run" | "apply";
  beforeCounts: { products: number; productParams: number };
  afterCounts: { products: number; productParams: number };
  productsById: Map<string, ProductRow>;
  beforeCoverage: CoverageResult;
  afterCoverage: CoverageResult;
  partAStats: PartStats;
  partBStats: PartStats;
  partCStats: PartStats;
  partASamples: Array<{ product: ProductRow; param: NewParam; remarkSnippet: string }>;
  totalNewParams: number;
}): string {
  const changedCategoryRows = [...input.afterCoverage.byCategory.entries()]
    .map(([category, after]) => {
      const before = input.beforeCoverage.byCategory.get(category) ?? { total: after.total, complete: 0 };
      return { category, total: after.total, beforeComplete: before.complete, afterComplete: after.complete, delta: after.complete - before.complete };
    })
    .filter((row) => row.delta !== 0)
    .sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta) || left.category.localeCompare(right.category));

  return `# V14.0 全参数补全报告

模式: ${input.mode}
时间: ${new Date().toISOString()}
备份: ${BACKUP_PATH}

## 汇总

| 方法 | 新增记录数 |
|---|---:|
| A: Remark 多参数提取 | ${input.partAStats.total} |
| B: 文件级传播 70% | ${input.partBStats.total} |
| C: 工厂+品类传播 50% | ${input.partCStats.total} |
| 合计 | ${input.totalNewParams} |

## Part A 明细

| param_key | 新增 |
|---|---:|
${CORE_PARAM_KEYS.map((paramKey) => `| ${paramKey} | ${input.partAStats.byParam.get(paramKey) ?? 0} |`).join("\n")}

### Part A 样本（每参数最多 5 条）

| category | product_name | param_key | raw_value | normalized_value | remark 片段 |
|---|---|---|---|---|---|
${input.partASamples.map((sample) => `| ${escapeMd(sample.product.category ?? "-")} | ${escapeMd(sample.product.productName)} | ${sample.param.paramKey} | ${escapeMd(sample.param.rawValue)} | ${escapeMd(sample.param.normalizedValue)} | ${escapeMd(sample.remarkSnippet)} |`).join("\n") || "| - | - | - | - | - | - |"}

## Part B 明细

| param_key | 新增 |
|---|---:|
${CORE_PARAM_KEYS.map((paramKey) => `| ${paramKey} | ${input.partBStats.byParam.get(paramKey) ?? 0} |`).join("\n")}

## Part C 明细

| param_key | 新增 |
|---|---:|
${CORE_PARAM_KEYS.map((paramKey) => `| ${paramKey} | ${input.partCStats.byParam.get(paramKey) ?? 0} |`).join("\n")}

## 覆盖率变化

| 指标 | V13.9 | V14.0 |
|---|---:|---:|
| 核心参数覆盖范围产品 | ${V13_9_BASELINE.scopedProducts} | ${input.afterCoverage.scopedProducts} |
| 全部完成产品 | ${V13_9_BASELINE.completeProducts} | ${input.afterCoverage.completeProducts} |
| 全局完成率 | ${formatPercent(V13_9_BASELINE.completionRate)} | ${formatPercent(input.afterCoverage.completionRate)} |

### 逐品类完成率（仅变化品类）

| 品类 | 产品数 | V13.9完成 | V14.0完成 | 变化 |
|---|---:|---:|---:|---:|
${changedCategoryRows.map((row) => `| ${escapeMd(row.category)} | ${row.total} | ${row.beforeComplete} | ${row.afterComplete} | ${formatDelta(row.delta)} |`).join("\n") || "| - | - | - | - | - |"}

### 逐参数覆盖率

| param_key | 覆盖 | 需覆盖 | 覆盖率 |
|---|---:|---:|---:|
${[...input.afterCoverage.byParam.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([paramKey, stats]) => `| ${paramKey} | ${stats.covered} | ${stats.required} | ${formatPercent(stats.required > 0 ? stats.covered / stats.required : 0)} |`).join("\n")}

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

function formatDelta(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function snippetAround(text: string, needle: string): string {
  const normalizedText = text.replace(/\s+/g, " ");
  const index = normalizedText.toLowerCase().indexOf(needle.toLowerCase().replace(/\s+/g, " "));
  if (index < 0) return normalizedText.slice(0, 120);
  return normalizedText.slice(Math.max(0, index - 40), index + needle.length + 60);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
