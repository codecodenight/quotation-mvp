import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

import { escapeMd, INSERT_BATCH_SIZE, productParamKey } from "./v11-shared";

const prisma = new PrismaClient();

const APPLY_MODE = process.argv.includes("--apply");
const REPORT_PATH = path.join("docs", "v13.3-remark-extraction-report.md");
const BACKUP_PATH = path.join("prisma", "dev.db.bak-v13.3");

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

const CCT_KEYWORDS: Record<string, string> = {
  中性白: "4000",
  暖白: "3000",
  暖光: "3000",
  冷白: "6500",
  正白: "4000",
};

const CCT_RANGE_KEYWORDS: Record<string, string> = {
  三色变光: "3000-6500",
  双色变光: "3000-6500",
  可调色温: "3000-6500",
  三色: "3000-6500",
  双色: "3000-6500",
};

type DbCount = bigint | number | null;
type CctMode = "explicit_k" | "keyword" | "3cct";

type ProductRow = {
  id: string;
  modelNo: string | null;
  productName: string;
  category: string | null;
  remark: string | null;
};

type PlannedParam = {
  id: string;
  productId: string;
  modelNo: string | null;
  productName: string;
  category: string;
  paramKey: "cct" | "voltage";
  rawValue: string;
  normalizedValue: string;
  unit: "K" | "V";
  sourceField: "remark_extraction" | "keyword_extraction";
  confidence: "medium" | "low";
  sourceText: string;
};

type CctModeStats = {
  mode: CctMode;
  label: string;
  scanned: number;
  matched: number;
  skippedExisting: number;
  skippedExcluded: number;
  planned: number;
};

type VoltageStats = {
  scanned: number;
  matched: number;
  skippedExisting: number;
  skippedExcluded: number;
  planned: number;
};

type CoverageSnapshot = {
  productParams: number;
  completeProducts: number;
  scopedProducts: number;
  cct: { coveredProducts: number; requiredProducts: number };
  voltage: { coveredProducts: number; requiredProducts: number };
};

type Counts = {
  products: number;
  productParams: number;
};

async function main() {
  const beforeCounts = await loadCounts();
  const beforeCoverage = await buildCoverageSnapshot();
  const products = await prisma.product.findMany({
    select: { id: true, modelNo: true, productName: true, category: true, remark: true },
    orderBy: [{ category: "asc" }, { modelNo: "asc" }, { productName: "asc" }],
  });
  const existingParamKeys = await loadExistingParamKeys();
  const plannedParams: PlannedParam[] = [];

  const cctResult = planCctExtraction(products, existingParamKeys, plannedParams);
  const voltageResult = planVoltageExtraction(products, existingParamKeys, plannedParams);

  const insertedParams = APPLY_MODE ? await insertParams(plannedParams) : 0;
  const afterCounts = await loadCounts();
  const afterCoverage = await buildCoverageSnapshot();

  await mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await writeFile(
    REPORT_PATH,
    buildReport({
      mode: APPLY_MODE ? "apply" : "dry-run",
      beforeCounts,
      afterCounts,
      beforeCoverage,
      afterCoverage,
      insertedParams,
      cctStats: cctResult.modeStats,
      cctByCategory: cctResult.byCategory,
      cctSamples: cctResult.samples,
      voltageStats: voltageResult.stats,
      voltageSamples: voltageResult.samples,
    }),
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        mode: APPLY_MODE ? "apply" : "dry-run",
        reportPath: REPORT_PATH,
        plannedParams: plannedParams.length,
        insertedParams,
        cctPlanned: cctResult.modeStats.reduce((sum, row) => sum + row.planned, 0),
        voltagePlanned: voltageResult.stats.planned,
        productParamsBefore: beforeCounts.productParams,
        productParamsAfter: afterCounts.productParams,
      },
      null,
      2,
    ),
  );
}

async function loadCounts(): Promise<Counts> {
  const [products, productParams] = await Promise.all([prisma.product.count(), prisma.productParam.count()]);
  return { products, productParams };
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

function planCctExtraction(
  products: ProductRow[],
  existingParamKeys: Set<string>,
  plannedParams: PlannedParam[],
): {
  modeStats: CctModeStats[];
  byCategory: Map<string, number>;
  samples: PlannedParam[];
} {
  const modeStats: CctModeStats[] = [
    { mode: "explicit_k", label: "显式 K 值", scanned: 0, matched: 0, skippedExisting: 0, skippedExcluded: 0, planned: 0 },
    { mode: "keyword", label: "中文色温关键词", scanned: 0, matched: 0, skippedExisting: 0, skippedExcluded: 0, planned: 0 },
    { mode: "3cct", label: "3CCT / 开关CCT", scanned: 0, matched: 0, skippedExisting: 0, skippedExcluded: 0, planned: 0 },
  ];
  const byCategory = new Map<string, number>();
  const samples: PlannedParam[] = [];

  for (const product of products) {
    const productKey = productParamKey(product.id, "cct");
    const hasExisting = existingParamKeys.has(productKey);
    const remark = normalizeText(product.remark ?? "");
    const nameAndRemark = normalizeText(`${product.productName}\n${product.remark ?? ""}`);
    let plannedForProduct = false;

    for (const modeStat of modeStats) {
      const sourceText = modeStat.mode === "keyword" ? nameAndRemark : remark;
      if (!sourceText) continue;
      modeStat.scanned += 1;

      const extraction =
        modeStat.mode === "explicit_k"
          ? extractExplicitCct(sourceText)
          : modeStat.mode === "keyword"
            ? extractKeywordCct(sourceText)
            : extractThreeCct(sourceText);

      if (extraction.excluded) {
        modeStat.skippedExcluded += 1;
        continue;
      }
      if (!extraction.value) continue;

      modeStat.matched += 1;
      if (hasExisting || plannedForProduct) {
        if (hasExisting) modeStat.skippedExisting += 1;
        continue;
      }

      const planned = buildParam({
        product,
        paramKey: "cct",
        rawValue: extraction.rawValue,
        normalizedValue: extraction.value,
        unit: "K",
        sourceField: modeStat.mode === "explicit_k" ? "remark_extraction" : "keyword_extraction",
        confidence: modeStat.mode === "explicit_k" ? "medium" : "low",
        sourceText: extraction.sourceText,
      });
      plannedParams.push(planned);
      existingParamKeys.add(productKey);
      plannedForProduct = true;
      modeStat.planned += 1;
      byCategory.set(planned.category, (byCategory.get(planned.category) ?? 0) + 1);
      if (samples.length < 20) samples.push(planned);
      break;
    }
  }

  return { modeStats, byCategory, samples };
}

function planVoltageExtraction(
  products: ProductRow[],
  existingParamKeys: Set<string>,
  plannedParams: PlannedParam[],
): {
  stats: VoltageStats;
  samples: PlannedParam[];
} {
  const stats: VoltageStats = { scanned: 0, matched: 0, skippedExisting: 0, skippedExcluded: 0, planned: 0 };
  const samples: PlannedParam[] = [];

  for (const product of products) {
    const remark = normalizeText(product.remark ?? "");
    if (!remark) continue;
    stats.scanned += 1;

    const extraction = extractVoltage(remark);
    if (extraction.excluded) {
      stats.skippedExcluded += 1;
      continue;
    }
    if (!extraction.value) continue;
    stats.matched += 1;

    const productKey = productParamKey(product.id, "voltage");
    if (existingParamKeys.has(productKey)) {
      stats.skippedExisting += 1;
      continue;
    }

    const planned = buildParam({
      product,
      paramKey: "voltage",
      rawValue: `${extraction.value}V`,
      normalizedValue: extraction.value,
      unit: "V",
      sourceField: "remark_extraction",
      confidence: "medium",
      sourceText: extraction.sourceText,
    });
    plannedParams.push(planned);
    existingParamKeys.add(productKey);
    stats.planned += 1;
    if (samples.length < 10) samples.push(planned);
  }

  return { stats, samples };
}

function extractExplicitCct(text: string): { value: string | null; rawValue: string; sourceText: string; excluded: boolean } {
  const excluded = hasCctExclusion(text);
  const values: number[] = [];
  const rawMatches: string[] = [];
  const regex = /(\d{4})(?:\s*[-/]\s*(\d{4}))?\s*K/gi;

  for (const match of text.matchAll(regex)) {
    const index = match.index ?? 0;
    const prefix = text.slice(Math.max(0, index - 3), index);
    if (/±\s*$/.test(prefix)) continue;
    const first = Number.parseInt(match[1], 10);
    const second = match[2] ? Number.parseInt(match[2], 10) : null;
    for (const value of [first, second].filter((candidate): candidate is number => candidate != null)) {
      if (value < 1800 || value > 10000) continue;
      values.push(value);
    }
    if (values.length > 0) rawMatches.push(match[0].trim());
  }

  if (values.length === 0) return { value: null, rawValue: "", sourceText: "", excluded };
  const min = Math.min(...values);
  const max = Math.max(...values);
  const normalized = min === max ? String(min) : `${min}-${max}`;
  return {
    value: normalized,
    rawValue: min === max ? `${min}K` : `${min}-${max}K`,
    sourceText: rawMatches.join(" / "),
    excluded: false,
  };
}

function extractKeywordCct(text: string): { value: string | null; rawValue: string; sourceText: string; excluded: boolean } {
  const excluded = hasCctExclusion(text);
  if (excluded) return { value: null, rawValue: "", sourceText: "", excluded: true };

  for (const [keyword, value] of Object.entries(CCT_RANGE_KEYWORDS)) {
    if (text.includes(keyword)) {
      return { value, rawValue: keyword, sourceText: snippetAround(text, keyword), excluded: false };
    }
  }

  if (/白光.{0,8}(?:暖光|暖白|中性光|中性白)|(?:暖光|暖白|中性光|中性白).{0,8}白光/.test(text)) {
    return { value: "3000-6500", rawValue: "白光/暖光", sourceText: "白光/暖光", excluded: false };
  }

  const matchedValues = new Set<string>();
  const matchedKeywords: string[] = [];
  for (const [keyword, value] of Object.entries(CCT_KEYWORDS)) {
    if (!text.includes(keyword)) continue;
    matchedValues.add(value);
    matchedKeywords.push(keyword);
  }

  if (matchedValues.size === 0) return { value: null, rawValue: "", sourceText: "", excluded: false };
  const values = Array.from(matchedValues).map((value) => Number.parseInt(value, 10));
  const min = Math.min(...values);
  const max = Math.max(...values);
  return {
    value: min === max ? String(min) : `${min}-${max}`,
    rawValue: matchedKeywords.join("/"),
    sourceText: matchedKeywords.map((keyword) => snippetAround(text, keyword)).join(" / "),
    excluded: false,
  };
}

function extractThreeCct(text: string): { value: string | null; rawValue: string; sourceText: string; excluded: boolean } {
  const excluded = hasCctExclusion(text);
  if (excluded) return { value: null, rawValue: "", sourceText: "", excluded: true };
  const match = text.match(/\b3\s*CCT\b/i) ?? text.match(/开关\s*CCT/i);
  if (!match) return { value: null, rawValue: "", sourceText: "", excluded: false };
  return { value: "3000-6500", rawValue: match[0], sourceText: snippetAround(text, match[0]), excluded: false };
}

function hasCctExclusion(text: string): boolean {
  return /(?:色温|color\s*temperature)\s*[:：]?\s*(?:单色|\/|定制|可选|custom|optional|single)(?:\s|$|[,，;；])/i.test(text);
}

function extractVoltage(text: string): { value: string | null; sourceText: string; excluded: boolean } {
  const labeled =
    text.match(
      /(?:input\s*)?(?:voltage|电压|输入电压|工作电压)(?:\s*\([^)]*\))?\s*[:：]?\s*(?:AC|DC)?\s*(\d{1,3})(?:\s*V?\s*[-~–]\s*(\d{1,3}))?\s*V(?:AC)?/i,
    ) ?? null;
  if (labeled) return normalizeVoltageMatch(labeled[1], labeled[2], labeled[0]);

  const prefixed = text.match(/(?<![\d.])(?:AC|DC)\s*(\d{1,3})(?:\s*V?\s*[-~–]\s*(\d{1,3}))?\s*V(?:AC)?\b/i);
  if (prefixed) return normalizeVoltageMatch(prefixed[1], prefixed[2], prefixed[0]);

  const bareRegex = /(?<![\d.])(\d{1,3})(?:\s*V?\s*[-~–]\s*(\d{1,3}))?\s*V(?:AC)?\b/gi;
  for (const match of text.matchAll(bareRegex)) {
    const index = match.index ?? 0;
    const context = text.slice(Math.max(0, index - 32), Math.min(text.length, index + match[0].length + 32));
    if (/solar\s*panel|panel|battery|batteries|电池|太阳能板|光伏板|LED|灯珠|lamp\s*bead|lithium|mah/i.test(context)) {
      continue;
    }
    return normalizeVoltageMatch(match[1], match[2], match[0]);
  }

  return { value: null, sourceText: "", excluded: false };
}

function normalizeVoltageMatch(firstValue: string, secondValue: string | undefined, sourceText: string): { value: string | null; sourceText: string; excluded: boolean } {
  const normalized = secondValue ? `${firstValue}-${secondValue}` : firstValue;
  const values = normalized.split("-").map((value) => Number.parseInt(value, 10));
  if (values.some((value) => !Number.isFinite(value) || value > 500 || value <= 0)) {
    return { value: null, sourceText, excluded: true };
  }
  return { value: normalized, sourceText, excluded: false };
}

async function buildCoverageSnapshot(): Promise<CoverageSnapshot> {
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
      const totalForParam = paramTotals.get(paramKey) ?? { coveredProducts: 0, requiredProducts: 0 };
      totalForParam.coveredProducts += breakdown[paramKey] ?? 0;
      totalForParam.requiredProducts += total;
      paramTotals.set(paramKey, totalForParam);
    }
  }

  return {
    productParams,
    completeProducts,
    scopedProducts,
    cct: paramTotals.get("cct") ?? { coveredProducts: 0, requiredProducts: 0 },
    voltage: paramTotals.get("voltage") ?? { coveredProducts: 0, requiredProducts: 0 },
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
  beforeCounts: Counts;
  afterCounts: Counts;
  beforeCoverage: CoverageSnapshot;
  afterCoverage: CoverageSnapshot;
  insertedParams: number;
  cctStats: CctModeStats[];
  cctByCategory: Map<string, number>;
  cctSamples: PlannedParam[];
  voltageStats: VoltageStats;
  voltageSamples: PlannedParam[];
}): string {
  return `# V13.3 Remark 提取报告

模式: ${input.mode}
时间: ${new Date().toISOString()}
备份: ${BACKUP_PATH}

## Part A — CCT 提取

| 模式 | 扫描产品 | 匹配 | 跳过(已有) | 跳过(排除) | 新增 |
|---|---:|---:|---:|---:|---:|
${input.cctStats
  .map((row) => `| ${escapeMd(row.label)} | ${row.scanned} | ${row.matched} | ${row.skippedExisting} | ${row.skippedExcluded} | ${row.planned} |`)
  .join("\n")}

### 按品类统计

| 品类 | 新增 CCT |
|---|---:|
${Array.from(input.cctByCategory.entries())
  .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
  .map(([category, count]) => `| ${escapeMd(category)} | ${count} |`)
  .join("\n") || "| - | 0 |"}

### 采样（前 20 条）

| category | model | 来源文本 | 提取值 |
|---|---|---|---|
${input.cctSamples
  .map((row) => `| ${escapeMd(row.category)} | ${escapeMd(row.modelNo ?? row.productName)} | ${escapeMd(row.sourceText)} | ${escapeMd(row.normalizedValue)} |`)
  .join("\n") || "| - | - | - | - |"}

## Part B — Voltage 提取

| 指标 | 数量 |
|---|---:|
| 扫描产品 | ${input.voltageStats.scanned} |
| 匹配 | ${input.voltageStats.matched} |
| 跳过(已有) | ${input.voltageStats.skippedExisting} |
| 跳过(排除) | ${input.voltageStats.skippedExcluded} |
| 新增 | ${input.voltageStats.planned} |

### 采样（前 10 条）

| category | model | 来源文本 | 提取值 |
|---|---|---|---|
${input.voltageSamples
  .map((row) => `| ${escapeMd(row.category)} | ${escapeMd(row.modelNo ?? row.productName)} | ${escapeMd(row.sourceText)} | ${escapeMd(row.normalizedValue)} |`)
  .join("\n") || "| - | - | - | - |"}

## 覆盖率变化

| 指标 | 变化前 | 变化后 |
|---|---:|---:|
| CCT 覆盖率(需覆盖) | ${formatRatio(input.beforeCoverage.cct.coveredProducts, input.beforeCoverage.cct.requiredProducts)} | ${formatRatio(input.afterCoverage.cct.coveredProducts, input.afterCoverage.cct.requiredProducts)} |
| Voltage 覆盖率(需覆盖) | ${formatRatio(input.beforeCoverage.voltage.coveredProducts, input.beforeCoverage.voltage.requiredProducts)} | ${formatRatio(input.afterCoverage.voltage.coveredProducts, input.afterCoverage.voltage.requiredProducts)} |
| product_params | ${input.beforeCoverage.productParams} | ${input.afterCoverage.productParams} |
| 核心参数全部完成产品 | ${input.beforeCoverage.completeProducts} | ${input.afterCoverage.completeProducts} |
| 全局完成率 | ${formatRatio(input.beforeCoverage.completeProducts, input.beforeCoverage.scopedProducts)} | ${formatRatio(input.afterCoverage.completeProducts, input.afterCoverage.scopedProducts)} |

## DB 计数

| 表 | 执行前 | 执行后 | 变化 |
|---|---:|---:|---:|
| products | ${input.beforeCounts.products} | ${input.afterCounts.products} | ${input.afterCounts.products - input.beforeCounts.products} |
| product_params | ${input.beforeCounts.productParams} | ${input.afterCounts.productParams} | ${input.afterCounts.productParams - input.beforeCounts.productParams} |
| 本次写入 | ${input.insertedParams} | ${input.insertedParams} | - |
`;
}

function buildParam(input: {
  product: ProductRow;
  paramKey: "cct" | "voltage";
  rawValue: string;
  normalizedValue: string;
  unit: "K" | "V";
  sourceField: "remark_extraction" | "keyword_extraction";
  confidence: "medium" | "low";
  sourceText: string;
}): PlannedParam {
  return {
    id: randomUUID(),
    productId: input.product.id,
    modelNo: input.product.modelNo,
    productName: input.product.productName,
    category: input.product.category ?? "(未分类)",
    paramKey: input.paramKey,
    rawValue: input.rawValue,
    normalizedValue: input.normalizedValue,
    unit: input.unit,
    sourceField: input.sourceField,
    confidence: input.confidence,
    sourceText: input.sourceText,
  };
}

function normalizeText(text: string): string {
  return text.normalize("NFC").replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
}

function snippetAround(text: string, target: string): string {
  const index = text.indexOf(target);
  if (index < 0) return target;
  return text.slice(Math.max(0, index - 40), Math.min(text.length, index + target.length + 40)).trim();
}

function toNumber(value: DbCount): number {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return value;
  return 0;
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
