import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

import { CATEGORY_CORE_PARAMS, escapeMd, INSERT_BATCH_SIZE, loadAccessoryProductIds, productParamKey } from "./v11-shared";

const prisma = new PrismaClient();
const require = createRequire(import.meta.url);

const REPORT_PATH = path.join("docs", "v16.0-deepseek-round2-report.md");
const BACKUP_PATH = path.join("prisma", "dev.db.bak-v16.0");
const CACHE_DIR = path.join("data", "deepseek-cache-v16");
const MODEL = "deepseek-v4-flash";
const BATCH_SIZE = 30;
const API_SLEEP_MS = 500;
const MAX_RETRIES = 3;
const V15_BASELINE = {
  scopedProducts: 10244,
  completeProducts: 9516,
  completionRate: 0.929,
};

const AI_INFERABLE_PARAMS = ["voltage", "cct", "cri", "pf", "ip", "driver_type", "material", "beam_angle", "base"] as const;

type AiParamKey = (typeof AI_INFERABLE_PARAMS)[number];
type Mode = "dry-run" | "infer" | "apply";

type ProductRow = {
  id: string;
  productName: string;
  modelNo: string | null;
  category: string | null;
  remark: string | null;
  size: string | null;
  material: string | null;
};

type ExistingParamRow = {
  productId: string;
  paramKey: string;
  rawValue: string;
  normalizedValue: string | null;
  unit: string | null;
  sourceField: string;
};

type ProductWithContext = {
  id: string;
  category: string;
  modelNo: string | null;
  productName: string;
  remark: string | null;
  size: string | null;
  material: string | null;
  existingParams: Record<string, string>;
  missingParams: AiParamKey[];
};

type PromptProduct = {
  id: string;
  model: string | null;
  name: string;
  remark: string;
  existing: Record<string, string>;
  missing: AiParamKey[];
};

type AiResponseItem = {
  id?: unknown;
  params?: unknown;
};

type ParsedAiItem = {
  id: string;
  params: Partial<Record<AiParamKey, string | null>>;
};

type CachedBatch = {
  category: string;
  batchIndex: number;
  cacheFile: string;
  timestamp: string;
  model: string;
  products: PromptProduct[];
  response: ParsedAiItem[];
};

type PlannedBatch = {
  category: string;
  batchIndex: number;
  cachePath: string;
  products: ProductWithContext[];
};

type DeepSeekClient = {
  chat: {
    completions: {
      create: (args: {
        model: string;
        temperature: number;
        messages: Array<{ role: "user"; content: string }>;
      }) => Promise<{ choices: Array<{ message?: { content?: string | null } }> }>;
    };
  };
};

type Counts = {
  products: number;
  productParams: number;
};

type GapStats = {
  productsInScope: number;
  productsWithMissingAiParams: number;
  productsWithTextData: number;
  totalMissingAiParams: number;
  plannedBatches: number;
  missingByCategory: Map<string, number>;
  productWithMissingByCategory: Map<string, number>;
  productWithTextByCategory: Map<string, number>;
  batchesByCategory: Map<string, number>;
  missingByParam: Map<AiParamKey, number>;
};

type InferStats = {
  plannedBatches: number;
  cachedBatches: number;
  attemptedBatches: number;
  successfulBatches: number;
  failedBatches: number;
  responseItems: number;
  returnedParamItems: number;
  failures: string[];
};

type ApplyStats = {
  cacheFiles: number;
  responseItems: number;
  validByParam: Map<AiParamKey, number>;
  skippedExistingByParam: Map<AiParamKey, number>;
  invalidByParam: Map<AiParamKey, number>;
  insertedByParam: Map<AiParamKey, number>;
  skippedMissingProduct: number;
  skippedNotRequested: number;
  invalidSamples: string[];
  validParams: number;
  skippedExisting: number;
  invalidParams: number;
  insertedParams: number;
};

type CoverageResult = {
  scopedProducts: number;
  completeProducts: number;
  completionRate: number;
};

async function main() {
  const mode = parseMode();
  ensureBackupExists();
  await mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await mkdir(CACHE_DIR, { recursive: true });

  console.log(`[V16.0] mode=${mode}; loading counts`);
  const before = await loadCounts();
  console.log("[V16.0] building inference plan");
  const { productsWithMissing, gapStats, accessoryIds, allProducts, initialParams } = await buildInferencePlan();
  console.log(
    `[V16.0] planned products=${gapStats.productsWithMissingAiParams}; missing params=${gapStats.totalMissingAiParams}; batches=${gapStats.plannedBatches}`,
  );
  const batches = buildPlannedBatches(productsWithMissing);

  let inferStats: InferStats | null = null;
  let applyStats: ApplyStats | null = null;
  let coverageAfter: CoverageResult = calculateCoverage(allProducts, initialParams, accessoryIds);

  if (mode === "infer") {
    loadEnvLocal();
    inferStats = await runInfer(batches);
  }

  if (mode === "apply") {
    applyStats = await runApply(productsWithMissing);
    const paramsAfter = await loadExistingParams();
    coverageAfter = calculateCoverage(allProducts, paramsAfter, accessoryIds);
  }

  const after = await loadCounts();
  await writeFile(
    REPORT_PATH,
    buildReport({
      mode,
      before,
      after,
      gapStats,
      inferStats,
      applyStats,
      coverageAfter,
    }),
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        mode,
        reportPath: REPORT_PATH,
        productsWithMissingAiParams: gapStats.productsWithMissingAiParams,
        totalMissingAiParams: gapStats.totalMissingAiParams,
        plannedBatches: gapStats.plannedBatches,
        inferStats,
        applyStats,
        completeProductsAfter: coverageAfter.completeProducts,
        completionRateAfter: formatPercent(coverageAfter.completionRate),
      },
      null,
      2,
    ),
  );
}

function parseMode(): Mode {
  const wantsInfer = process.argv.includes("--infer");
  const wantsApply = process.argv.includes("--apply");
  if (wantsInfer && wantsApply) throw new Error("Use only one mode at a time: --infer or --apply.");
  if (wantsInfer) return "infer";
  if (wantsApply) return "apply";
  return "dry-run";
}

function ensureBackupExists(): void {
  if (!existsSync(BACKUP_PATH)) throw new Error(`Missing DB backup: ${BACKUP_PATH}`);
}

async function loadCounts(): Promise<Counts> {
  const [products, productParams] = await Promise.all([prisma.product.count(), prisma.productParam.count()]);
  return { products, productParams };
}

async function buildInferencePlan(): Promise<{
  productsWithMissing: ProductWithContext[];
  gapStats: GapStats;
  accessoryIds: Set<string>;
  allProducts: ProductRow[];
  initialParams: ExistingParamRow[];
}> {
  const [allProducts, existingParams, accessoryIds] = await Promise.all([loadProducts(), loadExistingParams(), loadAccessoryProductIds(prisma)]);
  const existingParamKeys = buildExistingParamKeys(existingParams);
  const paramsByProduct = buildParamsByProduct(existingParams);
  const productsWithMissing: ProductWithContext[] = [];
  const missingByCategory = new Map<string, number>();
  const productWithMissingByCategory = new Map<string, number>();
  const productWithTextByCategory = new Map<string, number>();
  const missingByParam = new Map<AiParamKey, number>();
  let totalMissingAiParams = 0;
  let productsInScope = 0;
  let productsWithTextData = 0;

  for (const product of allProducts) {
    if (accessoryIds.has(product.id)) continue;
    const category = product.category?.trim();
    if (!category || !CATEGORY_CORE_PARAMS[category]) continue;
    productsInScope += 1;
    const missingParams = (CATEGORY_CORE_PARAMS[category] ?? [])
      .filter(isAiInferableParam)
      .filter((paramKey) => !existingParamKeys.has(productParamKey(product.id, paramKey)));
    if (missingParams.length === 0) continue;

    totalMissingAiParams += missingParams.length;
    missingByCategory.set(category, (missingByCategory.get(category) ?? 0) + missingParams.length);
    productWithMissingByCategory.set(category, (productWithMissingByCategory.get(category) ?? 0) + 1);
    for (const paramKey of missingParams) missingByParam.set(paramKey, (missingByParam.get(paramKey) ?? 0) + 1);

    const contextProduct: ProductWithContext = {
      id: product.id,
      category,
      modelNo: cleanPromptText(product.modelNo, 120),
      productName: cleanPromptText(product.productName, 220) ?? "",
      remark: cleanPromptText(product.remark, 500),
      size: cleanPromptText(product.size, 80),
      material: cleanPromptText(product.material, 80),
      existingParams: paramsByProduct.get(product.id) ?? {},
      missingParams,
    };
    productsWithMissing.push(contextProduct);
    if (hasTextData(contextProduct)) {
      productsWithTextData += 1;
      productWithTextByCategory.set(category, (productWithTextByCategory.get(category) ?? 0) + 1);
    }
  }

  const batches = buildPlannedBatches(productsWithMissing);
  const batchesByCategory = new Map<string, number>();
  for (const batch of batches) batchesByCategory.set(batch.category, (batchesByCategory.get(batch.category) ?? 0) + 1);

  return {
    productsWithMissing,
    accessoryIds,
    allProducts,
    initialParams: existingParams,
    gapStats: {
      productsInScope,
      productsWithMissingAiParams: productsWithMissing.length,
      productsWithTextData,
      totalMissingAiParams,
      plannedBatches: batches.length,
      missingByCategory,
      productWithMissingByCategory,
      productWithTextByCategory,
      batchesByCategory,
      missingByParam,
    },
  };
}

async function loadProducts(): Promise<ProductRow[]> {
  const categories = Object.keys(CATEGORY_CORE_PARAMS);
  return prisma.product.findMany({
    where: { category: { in: categories } },
    select: { id: true, productName: true, modelNo: true, category: true, remark: true, size: true, material: true },
    orderBy: [{ category: "asc" }, { productName: "asc" }, { id: "asc" }],
  });
}

async function loadExistingParams(): Promise<ExistingParamRow[]> {
  return prisma.productParam.findMany({
    select: {
      productId: true,
      paramKey: true,
      rawValue: true,
      normalizedValue: true,
      unit: true,
      sourceField: true,
    },
  });
}

function buildExistingParamKeys(rows: ExistingParamRow[]): Set<string> {
  const keys = new Set<string>();
  for (const row of rows) {
    if (!hasUsefulValue(row)) continue;
    keys.add(productParamKey(row.productId, row.paramKey));
  }
  return keys;
}

function buildParamsByProduct(rows: ExistingParamRow[]): Map<string, Record<string, string>> {
  const map = new Map<string, Record<string, string>>();
  for (const row of rows) {
    if (!hasUsefulValue(row)) continue;
    const productParams = map.get(row.productId) ?? {};
    if (Object.keys(productParams).length >= 24 || productParams[row.paramKey]) {
      map.set(row.productId, productParams);
      continue;
    }
    productParams[row.paramKey] = cleanPromptText(row.normalizedValue ?? row.rawValue, 100) ?? "";
    map.set(row.productId, productParams);
  }
  return map;
}

function buildPlannedBatches(products: ProductWithContext[]): PlannedBatch[] {
  const byCategory = new Map<string, ProductWithContext[]>();
  for (const product of products) {
    const categoryProducts = byCategory.get(product.category) ?? [];
    categoryProducts.push(product);
    byCategory.set(product.category, categoryProducts);
  }

  const batches: PlannedBatch[] = [];
  for (const [category, categoryProducts] of [...byCategory.entries()].sort(([left], [right]) => left.localeCompare(right, "zh-Hans-CN"))) {
    for (let index = 0; index < categoryProducts.length; index += BATCH_SIZE) {
      const batchIndex = Math.floor(index / BATCH_SIZE) + 1;
      batches.push({
        category,
        batchIndex,
        cachePath: path.join(CACHE_DIR, `${safeCategoryFileName(category)}-batch-${batchIndex}.json`),
        products: categoryProducts.slice(index, index + BATCH_SIZE),
      });
    }
  }
  return batches;
}

async function runInfer(batches: PlannedBatch[]): Promise<InferStats> {
  const client = createDeepSeekClient();
  const stats: InferStats = {
    plannedBatches: batches.length,
    cachedBatches: 0,
    attemptedBatches: 0,
    successfulBatches: 0,
    failedBatches: 0,
    responseItems: 0,
    returnedParamItems: 0,
    failures: [],
  };

  for (const [index, batch] of batches.entries()) {
    if (existsSync(batch.cachePath)) {
      stats.cachedBatches += 1;
      const cached = JSON.parse(await readFile(batch.cachePath, "utf8")) as CachedBatch;
      stats.responseItems += cached.response?.length ?? 0;
      stats.returnedParamItems += countReturnedParams(cached.response ?? []);
      continue;
    }

    stats.attemptedBatches += 1;
    if (stats.attemptedBatches % 10 === 1 || index === batches.length - 1) {
      console.log(`DeepSeek V16 batch ${index + 1}/${batches.length}: ${batch.category} #${batch.batchIndex}`);
    }

    try {
      const response = await callDeepSeekWithRetry(client, batch);
      stats.successfulBatches += 1;
      stats.responseItems += response.length;
      stats.returnedParamItems += countReturnedParams(response);
      await writeCacheFile(batch, response);
    } catch (error) {
      stats.failedBatches += 1;
      stats.failures.push(`${batch.category} batch ${batch.batchIndex}: ${errorMessage(error)}`);
    }

    await sleep(API_SLEEP_MS);
  }

  return stats;
}

function createDeepSeekClient(): DeepSeekClient {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) throw new Error("DeepSeek API Key 未配置。请在 .env.local 里设置 DEEPSEEK_API_KEY。");
  const OpenAI = require("openai").default as new (options: { apiKey: string; baseURL: string; timeout: number }) => DeepSeekClient;
  return new OpenAI({ apiKey, baseURL: "https://api.deepseek.com/v1", timeout: 60_000 });
}

async function callDeepSeekWithRetry(client: DeepSeekClient, batch: PlannedBatch): Promise<ParsedAiItem[]> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const completion = await client.chat.completions.create({
        model: MODEL,
        temperature: 0.1,
        messages: [{ role: "user", content: buildPrompt(batch.category, batch.products) }],
      });
      return parseAiResponse(completion.choices[0]?.message?.content ?? "");
    } catch (error) {
      lastError = error;
      if (attempt < MAX_RETRIES) await sleep(attempt === 1 ? 1_000 : 3_000);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function buildPrompt(category: string, products: ProductWithContext[]): string {
  return `你是照明行业规格参数专家。下面是 ${products.length} 个"${category}"产品，每个产品有型号、名称、备注和已有参数。
这些产品之前未能通过规则和统计方法获取以下参数，请根据产品型号、名称、备注、已有参数和行业常识推断。

规则：
1. 只填你有把握的值。不确定就写 null。
2. voltage 格式：纯数字或范围，如 "220-240"、"100-240"、"48"、"12"。不带 V/AC 前缀。
3. cct 格式：纯数字或范围，如 "3000"、"6500"、"3000-6500"、"2700-6500"。不带 K 后缀。
4. cri 格式：纯数字，如 "80"、"90"。
5. pf 格式：小数，如 "0.5"、"0.9"。
6. ip 格式：两位数字，如 "20"、"44"、"54"、"65"、"67"、"68"。
7. driver_type 格式：中文，如 "隔离"、"非隔离"、"DOB"、"LC"、"恒流IC"。
8. material 格式：中文材料名，如 "铝+PC"、"铝压铸"、"玻璃"、"ABS"。
9. beam_angle 格式：纯数字（度），如 "120"、"60"、"15-60"。
10. base 格式：标准灯头型号，如 "E27"、"E14"、"GU10"、"G4"、"G9"。

${category} 品类背景：${getCategoryContext(category)}

产品列表（JSON）：
${JSON.stringify(
  products.map<PromptProduct>((product) => ({
    id: product.id,
    model: product.modelNo,
    name: product.productName,
    remark: product.remark ?? "",
    existing: product.existingParams,
    missing: product.missingParams,
  })),
  null,
  2,
)}

请返回 JSON 数组，每个元素格式：
{"id": "产品ID", "params": {"param_key": "value_or_null"}}
只返回 JSON，不要其他文字。`;
}

function getCategoryContext(category: string): string {
  const contexts: Record<string, string> = {
    筒灯: "嵌入式天花灯，常用于商业/家用。宽压 100-240V 或窄压 220-240V，CRI 通常 80，PF 0.5。驱动有隔离/非隔离/Lifud 等品牌驱动。",
    面板灯: "方形/圆形平板灯，侧发光或直下式。宽压 165-265V 或 85-265V 为主。CRI 70-80，PF 0.5-0.9，驱动非隔离/DOB/恒流IC。材料常为铝+PMMA/PS。",
    磁吸灯: "磁吸轨道灯系统，多为 48V 或 24V 低压 DC。CRI 90 为主。",
    吸顶灯: "表面安装天花灯，家用为主。宽压 165-265V，CRI 80，PF 0.5。驱动非隔离为主。",
    灯丝灯: "仿传统灯泡形态，LED 灯丝。220-240V，CRI 80，PF 0.5，驱动 LC。灯头 E27/E14 为主。",
    风扇灯: "风扇+灯一体。宽压 110-265V，CRI 80。",
    球泡: "LED 球泡灯。宽压 100-240V 或窄压 220-240V。CRI 80，PF 0.5。灯头 E27/E14/B22。",
    壁灯: "壁面安装装饰灯。220-240V 或 100-240V。CRI 80。驱动非隔离为主。材料铝/铁/亚克力。",
    净化灯: "洁净室用平板灯。宽压 165-265V，CRI 70-80，PF 0.5。驱动非隔离/DOB。",
    橱柜灯: "橱柜/衣柜内小型灯。12V 或 220-240V。CRI 80。",
    镜前灯: "浴室镜子上方照明。220-240V，CRI 80。驱动隔离为主。",
    轨道灯: "导轨射灯，商业照明。220-240V，CRI 80-90，PF 0.5。窄光束角 15-60°。",
    防潮灯: "防水等级 IP65+，浴室/户外通道。220-240V，CRI 80，PF 0.5-0.9。驱动隔离为主。",
    台灯: "桌面台灯。220-240V 或 USB 5V。CRI 80-90。",
    G4G9: "G4/G9 灯珠替换光源。220-240V 或 12V。CRI 80。灯头 G4/G9。",
    灯管: "T5/T8 灯管。220-240V，CRI 80，PF 0.5。",
    线条灯: "长条形铝槽灯，嵌入/吊装/明装。220-240V 或 170-265V，CRI 80。",
    投光灯: "泛光灯/射灯，户外照明。宽压 85-265V 或 220-240V。CRI 70-80，PF 0.9。材料铝压铸。光束角 120°为主。",
    三防灯: "防水防尘防腐。220-240V 或 170-265V。CRI 80，PF 0.5-0.9。",
    太阳能壁灯: "太阳能供电壁灯。无需市电 voltage。CCT 多为 6500 冷白。",
    太阳能: "太阳能灯（路灯/庭院灯等）。无需市电 voltage。CCT 多为 6500。",
    路灯: "道路照明。宽压 85-265V 或 100-240V。CRI 80，PF 0.9。光束角 60°-150°。",
    "地埋灯/地插灯": "地面嵌入式。12V 或 220-240V。CRI 80。窄光束角 15-60°。",
    工作灯: "便携/临时照明。220-240V 或充电式。CRI 80。",
    庭院灯: "庭院/花园装饰灯。220-240V 或太阳能。材料铝/不锈钢。",
    Highbay: "工矿灯/高棚灯。宽压 100-277V 或 85-265V。CRI 80，PF 0.95+。光束角 60°/90°/120°。",
    充电灯: "充电式便携灯。无需市电 voltage。CCT 多为冷白，IP 通常 44-65。",
    应急灯: "应急照明。220-240V（带电池）。CRI 要求低。",
    灯带: "LED 灯条。12V 或 24V DC 为主。CRI 80。",
    皮线灯: "装饰类灯串。220V 或 24V。",
  };
  return contexts[category] ?? "照明灯具。";
}

function parseAiResponse(content: string): ParsedAiItem[] {
  const text = content.trim();
  const parsed = parseJson(text) ?? parseJson(extractJsonArray(text));
  if (!Array.isArray(parsed)) throw new Error("DeepSeek response is not a JSON array.");
  const items: ParsedAiItem[] = [];
  for (const item of parsed as AiResponseItem[]) {
    if (!item || typeof item !== "object" || typeof item.id !== "string" || !item.params || typeof item.params !== "object") continue;
    const params: Partial<Record<AiParamKey, string | null>> = {};
    for (const [key, value] of Object.entries(item.params as Record<string, unknown>)) {
      if (!isAiInferableParam(key)) continue;
      params[key] = typeof value === "string" ? value : value == null ? null : String(value);
    }
    items.push({ id: item.id, params });
  }
  return items;
}

function parseJson(text: string | null): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function extractJsonArray(text: string): string | null {
  const match = text.match(/\[[\s\S]*\]/);
  return match?.[0] ?? null;
}

async function writeCacheFile(batch: PlannedBatch, response: ParsedAiItem[]): Promise<void> {
  const cached: CachedBatch = {
    category: batch.category,
    batchIndex: batch.batchIndex,
    cacheFile: path.basename(batch.cachePath),
    timestamp: new Date().toISOString(),
    model: MODEL,
    products: batch.products.map((product) => ({
      id: product.id,
      model: product.modelNo,
      name: product.productName,
      remark: product.remark ?? "",
      existing: product.existingParams,
      missing: product.missingParams,
    })),
    response,
  };
  await writeFile(batch.cachePath, `${JSON.stringify(cached, null, 2)}\n`, "utf8");
}

async function runApply(productsWithMissing: ProductWithContext[]): Promise<ApplyStats> {
  const missingByProduct = new Map(productsWithMissing.map((product) => [product.id, product]));
  const existingParamKeys = await loadCurrentParamKeys();
  const stats: ApplyStats = {
    cacheFiles: 0,
    responseItems: 0,
    validByParam: new Map(),
    skippedExistingByParam: new Map(),
    invalidByParam: new Map(),
    insertedByParam: new Map(),
    skippedMissingProduct: 0,
    skippedNotRequested: 0,
    invalidSamples: [],
    validParams: 0,
    skippedExisting: 0,
    invalidParams: 0,
    insertedParams: 0,
  };
  const plannedRows = [];

  for (const cache of await loadCacheFiles()) {
    stats.cacheFiles += 1;
    stats.responseItems += cache.response.length;
    for (const item of cache.response) {
      const product = missingByProduct.get(item.id);
      if (!product) {
        stats.skippedMissingProduct += 1;
        continue;
      }
      for (const [paramKey, rawValue] of Object.entries(item.params)) {
        if (!isAiInferableParam(paramKey)) continue;
        if (!product.missingParams.includes(paramKey)) {
          stats.skippedNotRequested += 1;
          continue;
        }
        const existingKey = productParamKey(item.id, paramKey);
        if (existingParamKeys.has(existingKey)) {
          stats.skippedExisting += 1;
          increment(stats.skippedExistingByParam, paramKey);
          continue;
        }
        const normalizedValue = normalizeAiValue(paramKey, rawValue);
        if (!normalizedValue || !VALIDATORS[paramKey](normalizedValue)) {
          stats.invalidParams += 1;
          increment(stats.invalidByParam, paramKey);
          if (stats.invalidSamples.length < 30) {
            stats.invalidSamples.push(`${product.category} ${product.modelNo ?? product.productName} ${paramKey}: ${String(rawValue ?? "")}`);
          }
          continue;
        }
        stats.validParams += 1;
        increment(stats.validByParam, paramKey);
        existingParamKeys.add(existingKey);
        plannedRows.push({
          id: randomUUID(),
          productId: item.id,
          paramKey,
          rawValue: formatRawValue(paramKey, normalizedValue),
          normalizedValue,
          unit: unitForParam(paramKey),
          sourceField: "deepseek_inference_v16",
          confidence: "low",
        });
        increment(stats.insertedByParam, paramKey);
      }
    }
  }

  for (let index = 0; index < plannedRows.length; index += INSERT_BATCH_SIZE) {
    const rows = plannedRows.slice(index, index + INSERT_BATCH_SIZE);
    const result = await prisma.productParam.createMany({ data: rows });
    stats.insertedParams += result.count;
  }
  return stats;
}

async function loadCurrentParamKeys(): Promise<Set<string>> {
  return buildExistingParamKeys(await loadExistingParams());
}

async function loadCacheFiles(): Promise<CachedBatch[]> {
  const names = (await readdir(CACHE_DIR)).filter((name) => name.endsWith(".json")).sort();
  const caches: CachedBatch[] = [];
  for (const name of names) {
    const fullPath = path.join(CACHE_DIR, name);
    const parsed = JSON.parse(await readFile(fullPath, "utf8")) as CachedBatch;
    if (Array.isArray(parsed.response)) caches.push(parsed);
  }
  return caches;
}

const VALIDATORS: Record<AiParamKey, (value: string) => boolean> = {
  voltage: (value) => /^\d{1,3}(-\d{1,3})?$/.test(value) && !["0", "1", "2"].includes(value),
  cct: (value) => /^\d{4}(-\d{4})?$/.test(value),
  cri: (value) => /^\d{2,3}$/.test(value) && Number(value) >= 60 && Number(value) <= 100,
  pf: (value) => /^0\.\d+$/.test(value) && Number(value) >= 0.3 && Number(value) <= 1.0,
  ip: (value) => /^\d{2}$/.test(value) && Number(value) >= 20 && Number(value) <= 69,
  driver_type: (value) => value.length >= 1 && value.length <= 30,
  material: (value) => value.length >= 1 && value.length <= 50,
  beam_angle: (value) => /^\d{1,3}(-\d{1,3})?$/.test(value) && Number(value.split("-")[0]) >= 5 && Number(value.split("-")[0]) <= 360,
  base: (value) => /^[A-Za-z]\d/.test(value) && value.length <= 10,
};

function normalizeAiValue(paramKey: AiParamKey, value: string | null | undefined): string | null {
  const raw = String(value ?? "")
    .normalize("NFC")
    .replace(/[～~–—]/g, "-")
    .replace(/[：:]\s*/g, ":")
    .replace(/\s+/g, " ")
    .trim();
  if (!raw || /^null$/i.test(raw) || /^n\/a$/i.test(raw) || raw === "-") return null;
  switch (paramKey) {
    case "voltage": {
      const numbers = raw.match(/\d{1,3}/g);
      if (!numbers?.length) return null;
      return numbers.length >= 2 ? `${numbers[0]}-${numbers[1]}` : numbers[0];
    }
    case "cct": {
      const numbers = raw.match(/\d{4}/g);
      if (!numbers?.length) return null;
      return numbers.length >= 2 ? `${numbers[0]}-${numbers[numbers.length - 1]}` : numbers[0];
    }
    case "cri": {
      const match = raw.match(/\d{2,3}/);
      return match?.[0] ?? null;
    }
    case "pf": {
      const match = raw.match(/(?:0\.\d+|1\.0)/);
      return match?.[0] ?? null;
    }
    case "ip": {
      const match = raw.match(/(?:IP\s*)?(\d{2})/i);
      return match?.[1] ?? null;
    }
    case "beam_angle": {
      const numbers = raw.match(/\d{1,3}/g);
      if (!numbers?.length) return null;
      return numbers.length >= 2 ? `${numbers[0]}-${numbers[1]}` : numbers[0];
    }
    case "base": {
      const match = raw.match(/\b(?:E(?:14|27|40)|B22|GU10|GX53|G[459]|MR16)\b/i);
      return (match?.[0] ?? raw.replace(/\s+/g, "")).toUpperCase();
    }
    case "driver_type":
    case "material":
      return raw.replace(/^[-:：]+|[-:：]+$/g, "").trim();
  }
}

function formatRawValue(paramKey: AiParamKey, normalizedValue: string): string {
  switch (paramKey) {
    case "voltage":
      return `AC${normalizedValue}V`;
    case "cct":
      return `${normalizedValue}K`;
    case "cri":
      return `CRI ${normalizedValue}`;
    case "pf":
      return `PF ${normalizedValue}`;
    case "ip":
      return `IP${normalizedValue}`;
    case "beam_angle":
      return `${normalizedValue}°`;
    case "base":
    case "driver_type":
    case "material":
      return normalizedValue;
  }
}

function unitForParam(paramKey: AiParamKey): string | null {
  switch (paramKey) {
    case "voltage":
      return "V";
    case "cct":
      return "K";
    case "beam_angle":
      return "°";
    default:
      return null;
  }
}

function calculateCoverage(products: ProductRow[], params: ExistingParamRow[], accessoryIds: Set<string>): CoverageResult {
  const paramKeysByProduct = new Map<string, Set<string>>();
  for (const param of params) {
    if (!hasUsefulValue(param)) continue;
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

function isAiInferableParam(paramKey: string): paramKey is AiParamKey {
  return (AI_INFERABLE_PARAMS as readonly string[]).includes(paramKey);
}

function hasUsefulValue(row: ExistingParamRow): boolean {
  const value = (row.normalizedValue ?? row.rawValue ?? "").trim();
  return Boolean(value);
}

function hasTextData(product: ProductWithContext): boolean {
  return Boolean(product.productName || product.modelNo || product.remark || product.size || product.material || Object.keys(product.existingParams).length > 0);
}

function cleanPromptText(value: string | null | undefined, maxLength: number): string | null {
  const cleaned = String(value ?? "")
    .normalize("NFC")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 1)}…` : cleaned;
}

function safeCategoryFileName(category: string): string {
  return category.normalize("NFC").replace(/[\\/:*?"<>|\s]+/g, "_");
}

function loadEnvLocal(): void {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const key = match[1];
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[key] ??= value;
  }
}

function buildReport(input: {
  mode: Mode;
  before: Counts;
  after: Counts;
  gapStats: GapStats;
  inferStats: InferStats | null;
  applyStats: ApplyStats | null;
  coverageAfter: CoverageResult;
}): string {
  const lines: string[] = [];
  lines.push("# V16.0 DeepSeek 二轮推理报告", "");
  lines.push(`模式: ${input.mode}`);
  lines.push(`时间: ${new Date().toISOString()}`);
  lines.push(`备份: ${BACKUP_PATH}`);
  lines.push(`缓存目录: ${CACHE_DIR}`, "");

  lines.push("## 缺口分析", "");
  lines.push("| 品类 | 缺失产品数 | 有文本数据 | 批次数 |");
  lines.push("|---|---:|---:|---:|");
  for (const [category, count] of sortMap(input.gapStats.productWithMissingByCategory, "desc")) {
    lines.push(`| ${escapeMd(category)} | ${count} | ${input.gapStats.productWithTextByCategory.get(category) ?? 0} | ${input.gapStats.batchesByCategory.get(category) ?? 0} |`);
  }
  lines.push("");

  lines.push("### 缺口按参数", "");
  lines.push("| param_key | 缺口 |");
  lines.push("|---|---:|");
  for (const [paramKey, count] of sortMap(input.gapStats.missingByParam, "desc")) lines.push(`| ${paramKey} | ${count} |`);
  lines.push("");

  if (input.inferStats || input.applyStats) {
    const infer = input.inferStats;
    lines.push("## 推理统计（仅 infer/apply 模式）", "");
    lines.push("| 指标 | 数量 |");
    lines.push("|---|---:|");
    lines.push(`| 总批次 | ${infer?.plannedBatches ?? input.gapStats.plannedBatches} |`);
    lines.push(`| 已缓存 | ${infer?.cachedBatches ?? 0} |`);
    lines.push(`| API 调用 | ${infer?.attemptedBatches ?? 0} |`);
    lines.push(`| 成功 | ${infer?.successfulBatches ?? 0} |`);
    lines.push(`| 失败 | ${infer?.failedBatches ?? 0} |`);
    lines.push(`| 返回参数项 | ${infer?.returnedParamItems ?? input.applyStats?.validParams ?? 0} |`);
    if (infer?.failures.length) {
      lines.push("");
      lines.push("### 失败批次", "");
      for (const failure of infer.failures.slice(0, 100)) lines.push(`- ${escapeMd(failure)}`);
    }
    lines.push("");
  }

  if (input.applyStats) {
    lines.push("## 写入统计（仅 apply 模式）", "");
    lines.push("| param_key | 有效 | 已有跳过 | 无效跳过 | 写入 |");
    lines.push("|---|---:|---:|---:|---:|");
    for (const paramKey of AI_INFERABLE_PARAMS) {
      lines.push(
        `| ${paramKey} | ${input.applyStats.validByParam.get(paramKey) ?? 0} | ${input.applyStats.skippedExistingByParam.get(paramKey) ?? 0} | ${input.applyStats.invalidByParam.get(paramKey) ?? 0} | ${input.applyStats.insertedByParam.get(paramKey) ?? 0} |`,
      );
    }
    lines.push("");
    lines.push("| 指标 | 数量 |");
    lines.push("|---|---:|");
    lines.push(`| 缓存文件 | ${input.applyStats.cacheFiles} |`);
    lines.push(`| 响应产品项 | ${input.applyStats.responseItems} |`);
    lines.push(`| 插入参数 | ${input.applyStats.insertedParams} |`);
    lines.push(`| 跳过：产品不在缺口清单 | ${input.applyStats.skippedMissingProduct} |`);
    lines.push(`| 跳过：非本次请求参数 | ${input.applyStats.skippedNotRequested} |`);
    if (input.applyStats.invalidSamples.length) {
      lines.push("");
      lines.push("### 无效样本", "");
      for (const sample of input.applyStats.invalidSamples) lines.push(`- ${escapeMd(sample)}`);
    }
    lines.push("");
  }

  lines.push("## 覆盖率变化", "");
  lines.push("| 指标 | V15.0 | V16.0 |");
  lines.push("|---|---:|---:|");
  lines.push(`| 核心参数覆盖范围产品 | ${V15_BASELINE.scopedProducts} | ${input.coverageAfter.scopedProducts} |`);
  lines.push(`| 全部完成产品 | ${V15_BASELINE.completeProducts} | ${input.coverageAfter.completeProducts} |`);
  lines.push(`| 全局完成率 | ${formatPercent(V15_BASELINE.completionRate)} | ${formatPercent(input.coverageAfter.completionRate)} |`);
  lines.push("");

  lines.push("## DB 计数", "");
  lines.push("| 表 | 执行前 | 执行后 | 变化 |");
  lines.push("|---|---:|---:|---:|");
  lines.push(`| products | ${input.before.products} | ${input.after.products} | ${input.after.products - input.before.products} |`);
  lines.push(`| product_params | ${input.before.productParams} | ${input.after.productParams} | ${input.after.productParams - input.before.productParams} |`);
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function countReturnedParams(items: ParsedAiItem[]): number {
  return items.reduce((sum, item) => sum + Object.values(item.params).filter((value) => value != null && String(value).trim()).length, 0);
}

function increment<T extends string>(map: Map<T, number>, key: T): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function sortMap<T extends string>(map: Map<T, number>, direction: "asc" | "desc" = "asc"): Array<[T, number]> {
  return [...map.entries()].sort((left, right) => {
    if (left[1] !== right[1]) return direction === "desc" ? right[1] - left[1] : left[1] - right[1];
    return left[0].localeCompare(right[0], "zh-Hans-CN");
  });
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
