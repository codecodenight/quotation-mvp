import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const REPORT_PATH = path.join("docs", "v10.9-name-extract-report.md");
const INSERT_BATCH_SIZE = 500;
const APPLY_MODE = process.argv.includes("--apply");

type ProductRow = {
  id: string;
  modelNo: string | null;
  productName: string;
  category: string | null;
};

type ExistingParamCount = {
  param_key: string;
  cnt: bigint | number;
};

type ExtractedParam = {
  paramKey:
    | "ip"
    | "cri"
    | "cct"
    | "lumens"
    | "beam_angle"
    | "voltage"
    | "driver_type"
    | "material"
    | "luminous_efficacy";
  rawValue: string;
  normalizedValue: string;
  unit: string | null;
  sourceField: "product_name" | "model_no";
  sourceText: string;
};

type PlannedParam = ExtractedParam & {
  id: string;
  productId: string;
  modelNo: string | null;
  productName: string;
  category: string;
};

type CategoryStats = {
  category: string;
  productIds: Set<string>;
  newParams: number;
  paramKeys: Map<string, number>;
};

type ParamStats = {
  paramKey: string;
  newRecords: number;
  productIds: Set<string>;
  beforeTotal: number;
  afterTotal: number;
};

type SkipStats = {
  existing: number;
  exclusion: number;
};

async function main() {
  const productParamsBefore = await prisma.productParam.count();
  const products = await prisma.product.findMany({
    select: { id: true, modelNo: true, productName: true, category: true },
    orderBy: [{ category: "asc" }, { modelNo: "asc" }, { productName: "asc" }],
  });
  const existingParams = await prisma.productParam.findMany({
    select: { productId: true, paramKey: true },
  });
  const existingTotalsBefore = await loadExistingTotals();
  const existingSet = new Set(existingParams.map((param) => productParamKey(param.productId, param.paramKey)));
  const skipStats: SkipStats = { existing: 0, exclusion: 0 };
  const plannedParams: PlannedParam[] = [];
  const productsWithExtractable = new Set<string>();

  for (const product of products) {
    const params = mergeNameAndModelParams(product);
    if (params.length > 0) productsWithExtractable.add(product.id);

    for (const param of params) {
      const key = productParamKey(product.id, param.paramKey);
      if (existingSet.has(key)) {
        skipStats.existing += 1;
        continue;
      }
      if (shouldSkipExtraction(param)) {
        skipStats.exclusion += 1;
        continue;
      }

      plannedParams.push({
        ...param,
        id: randomUUID(),
        productId: product.id,
        modelNo: product.modelNo,
        productName: product.productName,
        category: product.category ?? "(未分类)",
      });
      existingSet.add(key);
    }
  }

  const insertedParams = APPLY_MODE ? await insertParams(plannedParams) : 0;
  const productParamsAfter = await prisma.productParam.count();
  const existingTotalsAfter = APPLY_MODE ? await loadExistingTotals() : addPlannedTotals(existingTotalsBefore, plannedParams);

  await mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await writeFile(
    REPORT_PATH,
    buildReport({
      mode: APPLY_MODE ? "apply" : "dry-run",
      products,
      productsWithExtractable,
      plannedParams,
      insertedParams,
      productParamsBefore,
      productParamsAfter,
      skipStats,
      totalsBefore: existingTotalsBefore,
      totalsAfter: existingTotalsAfter,
    }),
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        mode: APPLY_MODE ? "apply" : "dry-run",
        reportPath: REPORT_PATH,
        products: products.length,
        productsWithExtractable: productsWithExtractable.size,
        plannedParams: plannedParams.length,
        skippedExisting: skipStats.existing,
        skippedByExclusion: skipStats.exclusion,
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

function mergeNameAndModelParams(product: ProductRow): ExtractedParam[] {
  const nameParams = extractParamsFromText(product.productName, "product_name");
  const modelParams = product.modelNo ? extractParamsFromText(product.modelNo, "model_no") : [];
  const merged = [...nameParams];
  const seen = new Set(nameParams.map((param) => param.paramKey));

  for (const param of modelParams) {
    if (seen.has(param.paramKey)) continue;
    seen.add(param.paramKey);
    merged.push(param);
  }

  return merged;
}

function extractParamsFromText(text: string, sourceField: "product_name" | "model_no"): ExtractedParam[] {
  const sourceText = text.normalize("NFC").replace(/\s+/g, " ").trim();
  if (!sourceText) return [];

  const params: ExtractedParam[] = [];
  const seen = new Set<string>();
  const addParam = (param: Omit<ExtractedParam, "sourceField" | "sourceText">) => {
    if (seen.has(param.paramKey)) return;
    seen.add(param.paramKey);
    params.push({ ...param, sourceField, sourceText });
  };

  const ipMatch = sourceText.match(/IP\s*(\d{2})\b/i);
  if (ipMatch) {
    addParam({
      paramKey: "ip",
      rawValue: `IP${ipMatch[1]}`,
      normalizedValue: ipMatch[1],
      unit: null,
    });
  }

  const cri = extractCri(sourceText);
  if (cri) addParam(cri);

  const cct = extractCct(sourceText);
  if (cct) addParam(cct);

  const lumens = extractLumens(sourceText);
  if (lumens) addParam(lumens);

  const beamAngle = extractBeamAngle(sourceText);
  if (beamAngle) addParam(beamAngle);

  const voltage = extractVoltage(sourceText);
  if (voltage) addParam(voltage);

  const driverType = extractDriverType(sourceText);
  if (driverType) addParam(driverType);

  const material = extractMaterial(sourceText);
  if (material) addParam(material);

  const efficacy = extractLuminousEfficacy(sourceText);
  if (efficacy) addParam(efficacy);

  return params;
}

function extractCri(text: string): Omit<ExtractedParam, "sourceField" | "sourceText"> | null {
  const patterns = [/\bRA\s*[>≥＞]?\s*(\d{2,3})\b/i, /\bCRI\s*[>≥＞]?\s*(\d{2,3})\b/i, /显指\s*[>≥＞]?\s*(\d{2,3})\b/, /显色指数\s*[>≥＞]?\s*(\d{2,3})\b/];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const value = Number.parseInt(match[1], 10);
    if (value < 60 || value > 100) continue;
    return {
      paramKey: "cri",
      rawValue: match[0].trim(),
      normalizedValue: String(value),
      unit: null,
    };
  }
  return null;
}

function extractCct(text: string): Omit<ExtractedParam, "sourceField" | "sourceText"> | null {
  const labeled = text.match(/(?:color\s*temperature|色温|cct)\s*[：:]?\s*((?:\d{4}\s*K?\s*[-~–/+]?\s*){1,4})/i);
  const labeledValues = labeled ? extractKelvinValues(labeled[1]) : [];
  if (labeled && labeledValues.length > 0) {
    return cctParam(labeled[0].trim(), labeledValues);
  }

  const rangeMatch = text.match(/(\d{4})\s*K?\s*[-~–]\s*(\d{4})\s*K\b/i);
  if (rangeMatch) {
    const values = [Number.parseInt(rangeMatch[1], 10), Number.parseInt(rangeMatch[2], 10)].filter(isValidKelvin);
    if (values.length === 2) return cctParam(rangeMatch[0].trim(), values);
  }

  const slashMatch = text.match(/(\d{4}\s*K(?:\s*[/+]\s*\d{4}\s*K?){1,3})/i);
  if (slashMatch) {
    const values = extractKelvinValues(slashMatch[0]);
    if (values.length > 0) return cctParam(slashMatch[0].trim(), values);
  }

  const singleMatch = text.match(/\b(\d{4})\s*K\b/i);
  if (singleMatch) {
    const value = Number.parseInt(singleMatch[1], 10);
    if (isValidKelvin(value)) return cctParam(singleMatch[0].trim(), [value]);
  }

  return null;
}

function extractLumens(text: string): Omit<ExtractedParam, "sourceField" | "sourceText"> | null {
  const patterns = [/Luminous\s*flux\s*[：:]?\s*(\d{2,6})\s*lm/i, /光通量\s*[：:]?\s*(\d{2,6})\s*(?:lm|流明)?/i, /(?<![/\w])(\d{2,6})\s*LM\b(?!\s*\/\s*W)/i, /(\d{2,6})\s*流明/];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const value = Number.parseInt(match[1], 10);
    if (value < 50 || value > 100000) continue;
    return {
      paramKey: "lumens",
      rawValue: match[0].trim(),
      normalizedValue: String(value),
      unit: "lm",
    };
  }
  return null;
}

function extractBeamAngle(text: string): Omit<ExtractedParam, "sourceField" | "sourceText"> | null {
  const patterns = [/[Bb](?:a|ea)m(?:\s*angle)?[^0-9]{0,8}(\d{1,3})\s*[°º]/, /光束角[^0-9]{0,8}(\d{1,3})\s*(?:[°º]|度)?/, /\b(\d{1,3})\s*[°º]/, /(\d{1,3})\s*度(?!电)/];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const value = Number.parseInt(match[1], 10);
    if (value < 10 || value > 360) continue;
    return {
      paramKey: "beam_angle",
      rawValue: match[0].trim(),
      normalizedValue: String(value),
      unit: "°",
    };
  }
  return null;
}

function extractVoltage(text: string): Omit<ExtractedParam, "sourceField" | "sourceText"> | null {
  const patterns = [
    /\b(?:AC|Input[：:]?\s*AC?)\s*(\d{2,3})\s*[-~–]\s*(\d{2,3})\s*V/i,
    /\b(\d{2,3})\s*[-~–]\s*(\d{2,3})\s*V\b/i,
    /\bAC\s*(\d{3})\s*V\b/i,
    /\bDC\s*(\d{2,3})\s*V\b/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    if (isBatteryContext(text, match.index ?? 0, match[0].length)) continue;

    if (match[2]) {
      const v1 = Number.parseInt(match[1], 10);
      const v2 = Number.parseInt(match[2], 10);
      if (v1 < 12 || v2 > 480 || v1 > v2) continue;
      return {
        paramKey: "voltage",
        rawValue: match[0].trim(),
        normalizedValue: `${v1}-${v2}`,
        unit: "V",
      };
    }

    const value = Number.parseInt(match[1], 10);
    if (value < 12 || value > 480) continue;
    return {
      paramKey: "voltage",
      rawValue: match[0].trim(),
      normalizedValue: String(value),
      unit: "V",
    };
  }
  return null;
}

function extractDriverType(text: string): Omit<ExtractedParam, "sourceField" | "sourceText"> | null {
  if (/\bDOB\b/i.test(text)) return { paramKey: "driver_type", rawValue: "DOB", normalizedValue: "DOB", unit: null };
  if (/非隔离/.test(text)) return { paramKey: "driver_type", rawValue: "非隔离", normalizedValue: "非隔离", unit: null };
  if (/隔离/.test(text) && !/非隔离/.test(text)) return { paramKey: "driver_type", rawValue: "隔离", normalizedValue: "隔离", unit: null };
  if (/恒流\s*IC/i.test(text)) return { paramKey: "driver_type", rawValue: "恒流IC", normalizedValue: "恒流IC", unit: null };
  if (/恒流/.test(text)) return { paramKey: "driver_type", rawValue: "恒流", normalizedValue: "恒流", unit: null };
  return null;
}

function extractMaterial(text: string): Omit<ExtractedParam, "sourceField" | "sourceText"> | null {
  const materialKv = text.match(/Material\s*[：:]\s*([^\n,;，；]{2,40}?)(?=\s+(?:Color|Panel|Solar|Battery|LED|Luminous|Protection|Induction|Charging|Warranty|Lighting|Waterproof|Diffuser|Switch|Fit|With|Lamp|Size|Power)|$)/i);
  if (materialKv) {
    const value = materialKv[1].trim();
    if (value) return { paramKey: "material", rawValue: value, normalizedValue: value, unit: null };
  }

  const patterns: [RegExp, string][] = [
    [/\bPC\s*\+\s*ABS\b/i, "PC+ABS"],
    [/\bABS\s*\+\s*PC\b/i, "ABS+PC"],
    [/\bABS\b/i, "ABS"],
    [/\bPC\b/i, "PC"],
    [/压铸铝/, "压铸铝"],
    [/铝[材合]?/, "铝"],
    [/\bAluminum\b/i, "Aluminum"],
    [/\bstainless\s+steel\b/i, "Stainless Steel"],
  ];
  for (const [pattern, normalized] of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    return {
      paramKey: "material",
      rawValue: match[0].trim(),
      normalizedValue: normalized,
      unit: null,
    };
  }
  return null;
}

function extractLuminousEfficacy(text: string): Omit<ExtractedParam, "sourceField" | "sourceText"> | null {
  const match = text.match(/(\d+(?:\.\d+)?)\s*(?:[-~–]\s*\d+(?:\.\d+)?)?\s*LM\s*\/\s*W/i);
  if (!match) return null;
  const value = Number.parseFloat(match[1]);
  if (value < 10 || value > 300) return null;
  return {
    paramKey: "luminous_efficacy",
    rawValue: match[0].trim(),
    normalizedValue: String(value),
    unit: "lm/W",
  };
}

function shouldSkipExtraction(param: ExtractedParam): boolean {
  if (param.paramKey === "voltage" && isBatteryContext(param.sourceText, param.sourceText.indexOf(param.rawValue), param.rawValue.length)) {
    return true;
  }
  if (param.paramKey === "beam_angle" && /度电/.test(param.rawValue)) return true;
  return false;
}

function extractKelvinValues(text: string): number[] {
  return [...text.matchAll(/(\d{4})\s*K?/gi)]
    .map((match) => Number.parseInt(match[1], 10))
    .filter(isValidKelvin)
    .filter((value, index, values) => values.indexOf(value) === index);
}

function cctParam(rawValue: string, values: number[]): Omit<ExtractedParam, "sourceField" | "sourceText"> {
  const sorted = [...values].sort((left, right) => left - right);
  const normalizedValue = sorted.length === 1 ? String(sorted[0]) : sorted.join("/");
  return {
    paramKey: "cct",
    rawValue,
    normalizedValue,
    unit: "K",
  };
}

function isValidKelvin(value: number): boolean {
  return Number.isFinite(value) && value >= 1800 && value <= 10000;
}

function isBatteryContext(text: string, index: number, length: number): boolean {
  if (index < 0) return false;
  const context = text.slice(Math.max(0, index - 40), index + length + 40);
  return /battery|电池|充电|NI-MH|lithium|LiFePO4|18650|14500|锂电/i.test(context);
}

async function loadExistingTotals(): Promise<Map<string, number>> {
  const rows = await prisma.$queryRaw<ExistingParamCount[]>`
    SELECT param_key, COUNT(*) AS cnt
    FROM product_params
    GROUP BY param_key
  `;
  return new Map(rows.map((row) => [row.param_key, Number(row.cnt)]));
}

function addPlannedTotals(totalsBefore: Map<string, number>, plannedParams: PlannedParam[]): Map<string, number> {
  const totalsAfter = new Map(totalsBefore);
  for (const param of plannedParams) {
    totalsAfter.set(param.paramKey, (totalsAfter.get(param.paramKey) ?? 0) + 1);
  }
  return totalsAfter;
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
        confidence: "medium",
      })),
    });
    inserted += result.count;
  }
  return inserted;
}

function buildReport(input: {
  mode: "dry-run" | "apply";
  products: ProductRow[];
  productsWithExtractable: Set<string>;
  plannedParams: PlannedParam[];
  insertedParams: number;
  productParamsBefore: number;
  productParamsAfter: number;
  skipStats: SkipStats;
  totalsBefore: Map<string, number>;
  totalsAfter: Map<string, number>;
}): string {
  const paramStats = buildParamStats(input.plannedParams, input.totalsBefore, input.totalsAfter);
  const categoryStats = buildCategoryStats(input.plannedParams);
  const samples = input.plannedParams.slice(0, 50);

  return `# V10.9 product_name 深度参数提取报告

模式: ${input.mode}
时间: ${new Date().toISOString()}

## 汇总

| 指标 | 数值 |
|---|---:|
| 扫描产品数 | ${input.products.length.toLocaleString()} |
| 含可提取参数的产品 | ${input.productsWithExtractable.size.toLocaleString()} |
| 新增参数 | ${input.plannedParams.length.toLocaleString()} |
| 跳过（已存在） | ${input.skipStats.existing.toLocaleString()} |
| 跳过（排除规则） | ${input.skipStats.exclusion.toLocaleString()} |
| 实际插入 | ${input.insertedParams.toLocaleString()} |
| product_params 变化 | ${input.productParamsBefore.toLocaleString()} → ${input.productParamsAfter.toLocaleString()} |

## 按 param_key 统计

| param_key | 新增记录 | 覆盖产品数 | 已有总数 → 新总数 |
|---|---:|---:|---:|
${paramStats
  .map((stat) => `| ${escapeMd(stat.paramKey)} | ${stat.newRecords.toLocaleString()} | ${stat.productIds.size.toLocaleString()} | ${stat.beforeTotal.toLocaleString()} → ${stat.afterTotal.toLocaleString()} |`)
  .join("\n")}

## 按品类统计

| 品类 | 含可提取参数产品 | 新增参数 | 主要提取项 |
|---|---:|---:|---|
${categoryStats
  .map((stat) => `| ${escapeMd(stat.category)} | ${stat.productIds.size.toLocaleString()} | ${stat.newParams.toLocaleString()} | ${escapeMd(formatTopParamKeys(stat.paramKeys))} |`)
  .join("\n")}

## 采样（前 50 条）

| 产品名 | param_key | 提取值 | source |
|---|---|---|---|
${samples
  .map((param) => `| ${escapeMd(param.productName)} | ${escapeMd(param.paramKey)} | ${escapeMd(formatParamValue(param))} | ${escapeMd(param.sourceField)} |`)
  .join("\n")}
`;
}

function buildParamStats(plannedParams: PlannedParam[], totalsBefore: Map<string, number>, totalsAfter: Map<string, number>): ParamStats[] {
  const byParam = new Map<string, ParamStats>();
  for (const param of plannedParams) {
    const stat = byParam.get(param.paramKey) ?? {
      paramKey: param.paramKey,
      newRecords: 0,
      productIds: new Set<string>(),
      beforeTotal: totalsBefore.get(param.paramKey) ?? 0,
      afterTotal: totalsAfter.get(param.paramKey) ?? 0,
    };
    stat.newRecords += 1;
    stat.productIds.add(param.productId);
    byParam.set(param.paramKey, stat);
  }
  return [...byParam.values()].sort((left, right) => right.newRecords - left.newRecords || left.paramKey.localeCompare(right.paramKey));
}

function buildCategoryStats(plannedParams: PlannedParam[]): CategoryStats[] {
  const byCategory = new Map<string, CategoryStats>();
  for (const param of plannedParams) {
    const stat = byCategory.get(param.category) ?? {
      category: param.category,
      productIds: new Set<string>(),
      newParams: 0,
      paramKeys: new Map<string, number>(),
    };
    stat.productIds.add(param.productId);
    stat.newParams += 1;
    stat.paramKeys.set(param.paramKey, (stat.paramKeys.get(param.paramKey) ?? 0) + 1);
    byCategory.set(param.category, stat);
  }
  return [...byCategory.values()].sort((left, right) => right.newParams - left.newParams || left.category.localeCompare(right.category));
}

function formatTopParamKeys(paramKeys: Map<string, number>): string {
  return [...paramKeys.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 5)
    .map(([key, count]) => `${key} ${count}`)
    .join(", ");
}

function formatParamValue(param: PlannedParam): string {
  return `${param.rawValue} → ${param.normalizedValue}${param.unit ?? ""}`;
}

function productParamKey(productId: string, paramKey: string): string {
  return `${productId}\0${paramKey}`;
}

function escapeMd(value: string | number | null | undefined): string {
  return String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\n/g, " ")
    .trim();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
