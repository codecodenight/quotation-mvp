import { existsSync, readFileSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { PrismaClient } from "@prisma/client";
import OpenAI from "openai";

import { escapeMd, INSERT_BATCH_SIZE, productParamKey } from "./v11-shared";

const prisma = new PrismaClient();

const REPORT_PATH = path.join("docs", "v13.0-deepseek-params-report.md");
const BACKUP_PATH = path.join("prisma", "dev.db.bak-v13.0");
const CACHE_DIR = path.join("data", "deepseek-cache");
const MODEL = "deepseek-v4-flash";
const BATCH_SIZE = 30;
const API_SLEEP_MS = 500;
const MAX_RETRIES = 3;

const DIRTY_VOLTAGE_VALUES = [
  "Aluminum",
  "double ended",
  "Single End",
  "Voltage\n（V）",
  "黑+黑",
  "白+白",
  "Connect power up",
  "Voltage",
];

const CATEGORY_REQUIRED_PARAMS: Record<string, readonly string[]> = {
  筒灯: ["watts", "voltage", "cct", "cri", "pf", "driver_type", "size_display"],
  面板灯: ["watts", "voltage", "cct", "cri", "pf", "driver_type", "size_display", "material"],
  磁吸灯: ["watts", "voltage", "cct", "cri", "size_display"],
  吸顶灯: ["watts", "voltage", "cct", "cri", "pf", "driver_type", "size_display"],
  灯丝灯: ["watts", "voltage", "cct", "cri", "pf", "base"],
  风扇灯: ["watts", "voltage", "cct", "cri", "size_display"],
  球泡: ["watts", "voltage", "cct", "cri", "pf", "base"],
  壁灯: ["watts", "voltage", "cct", "cri", "driver_type", "material"],
  净化灯: ["watts", "voltage", "cct", "cri", "pf", "driver_type", "size_display"],
  橱柜灯: ["watts", "voltage", "cct", "cri", "size_display"],
  镜前灯: ["watts", "voltage", "cct", "cri", "driver_type"],
  轨道灯: ["watts", "voltage", "cct", "cri", "pf", "beam_angle"],
  防潮灯: ["watts", "voltage", "cct", "cri", "ip", "pf", "driver_type"],
  台灯: ["watts", "voltage", "cct", "cri"],
  G4G9: ["watts", "voltage", "cct", "cri", "base"],
  灯管: ["watts", "voltage", "cct", "cri", "pf", "size_display"],
  线条灯: ["watts", "voltage", "cct", "cri", "ip", "size_display"],
  投光灯: ["watts", "voltage", "cct", "cri", "ip", "pf", "beam_angle", "material"],
  三防灯: ["watts", "voltage", "cct", "cri", "ip", "pf", "size_display"],
  太阳能壁灯: ["watts", "cct", "ip", "material"],
  太阳能: ["watts", "cct", "ip", "material"],
  路灯: ["watts", "voltage", "cct", "cri", "ip", "pf", "beam_angle"],
  "地埋灯/地插灯": ["watts", "voltage", "cct", "cri", "ip", "beam_angle"],
  工作灯: ["watts", "voltage", "cct", "cri", "ip"],
  庭院灯: ["watts", "voltage", "cct", "ip", "material"],
  Highbay: ["watts", "voltage", "cct", "cri", "ip", "pf", "beam_angle", "luminous_efficacy"],
  充电灯: ["watts", "cct", "ip", "material"],
  应急灯: ["watts", "voltage", "cct"],
  灯带: ["watts", "voltage", "cct", "cri", "ip"],
  皮线灯: ["watts", "voltage", "ip"],
};

const AI_INFERABLE_PARAMS = [
  "voltage",
  "cct",
  "cri",
  "pf",
  "driver_type",
  "material",
  "beam_angle",
  "base",
] as const;

type AiParamKey = (typeof AI_INFERABLE_PARAMS)[number];
type Mode = "dry-run" | "infer" | "apply";
type DbCount = bigint | number | null;

type ProductRow = {
  product_id: string;
  product_name: string;
  model_no: string | null;
  category: string;
  remark: string | null;
  size: string | null;
  material: string | null;
};

type ExistingParamRow = {
  product_id: string;
  param_key: string;
  raw_value: string;
  normalized_value: string | null;
  unit: string | null;
};

type ProductWithContext = {
  id: string;
  category: string;
  model_no: string | null;
  product_name: string;
  existingParams: Record<string, string>;
  missingParams: AiParamKey[];
};

type PromptProduct = {
  id: string;
  model: string | null;
  name: string;
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

type Counts = {
  products: number;
  productParams: number;
  dirtyVoltage: number;
};

type GapStats = {
  productsInScope: number;
  productsWithMissingAiParams: number;
  totalMissingAiParams: number;
  plannedBatches: number;
  missingByCategory: Map<string, number>;
  productCountByCategory: Map<string, number>;
  productWithMissingByCategory: Map<string, number>;
  missingByParam: Map<AiParamKey, number>;
};

type InferStats = {
  plannedBatches: number;
  cachedBatches: number;
  attemptedBatches: number;
  successfulBatches: number;
  failedBatches: number;
  responseItems: number;
  failures: string[];
};

type ApplyStats = {
  cacheFiles: number;
  responseItems: number;
  dirtyVoltageDeleted: number;
  validParams: number;
  insertedParams: number;
  skippedExisting: number;
  skippedMissingProduct: number;
  skippedNotRequested: number;
  invalidParams: number;
  invalidSamples: string[];
  insertedByParam: Map<string, number>;
  insertedByCategory: Map<string, number>;
};

async function main() {
  const mode = parseMode();
  ensureBackupExists();
  await mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await mkdir(CACHE_DIR, { recursive: true });

  console.log(`[V13.0] mode=${mode}; loading counts`);
  const before = await loadCounts();
  console.log("[V13.0] building inference plan");
  const { productsWithMissing, gapStats } = await buildInferencePlan();
  console.log(
    `[V13.0] planned products=${gapStats.productsWithMissingAiParams}; missing params=${gapStats.totalMissingAiParams}; batches=${gapStats.plannedBatches}`,
  );
  const batches = buildPlannedBatches(productsWithMissing);

  let inferStats: InferStats | null = null;
  let applyStats: ApplyStats | null = null;

  if (mode === "infer") {
    loadEnvLocal();
    inferStats = await runInfer(batches);
  }

  if (mode === "apply") {
    applyStats = await runApply(productsWithMissing);
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
    }),
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        mode,
        reportPath: REPORT_PATH,
        productsInScope: gapStats.productsInScope,
        productsWithMissingAiParams: gapStats.productsWithMissingAiParams,
        totalMissingAiParams: gapStats.totalMissingAiParams,
        plannedBatches: gapStats.plannedBatches,
        inferStats,
        applyStats,
        productParamsBefore: before.productParams,
        productParamsAfter: after.productParams,
      },
      null,
      2,
    ),
  );
}

function parseMode(): Mode {
  const wantsInfer = process.argv.includes("--infer");
  const wantsApply = process.argv.includes("--apply");
  if (wantsInfer && wantsApply) {
    throw new Error("Use only one mode at a time: --infer or --apply.");
  }
  if (wantsInfer) return "infer";
  if (wantsApply) return "apply";
  return "dry-run";
}

function ensureBackupExists() {
  if (!existsSync(BACKUP_PATH)) {
    throw new Error(`Missing DB backup: ${BACKUP_PATH}`);
  }
}

async function loadCounts(): Promise<Counts> {
  const rows = await prisma.$queryRawUnsafe<Array<{ products: DbCount; product_params: DbCount; dirty_voltage: DbCount }>>(
    `
      SELECT
        (SELECT COUNT(*) FROM products) as products,
        (SELECT COUNT(*) FROM product_params) as product_params,
        (
          SELECT COUNT(*)
          FROM product_params
          WHERE param_key = 'voltage'
            AND normalized_value IN (${DIRTY_VOLTAGE_VALUES.map(() => "?").join(", ")})
        ) as dirty_voltage
    `,
    ...DIRTY_VOLTAGE_VALUES,
  );
  return {
    products: toNumber(rows[0]?.products),
    productParams: toNumber(rows[0]?.product_params),
    dirtyVoltage: toNumber(rows[0]?.dirty_voltage),
  };
}

async function buildInferencePlan(): Promise<{ productsWithMissing: ProductWithContext[]; gapStats: GapStats }> {
  const products = await loadProducts();
  const existingParams = await loadExistingParams();
  const existingParamKeys = buildExistingParamKeys(existingParams);
  const paramsByProduct = buildParamsByProduct(existingParams);

  const productsWithMissing: ProductWithContext[] = [];
  const productCountByCategory = new Map<string, number>();
  const productWithMissingByCategory = new Map<string, number>();
  const missingByCategory = new Map<string, number>();
  const missingByParam = new Map<AiParamKey, number>();
  let totalMissingAiParams = 0;

  for (const product of products) {
    productCountByCategory.set(product.category, (productCountByCategory.get(product.category) ?? 0) + 1);
    const required = CATEGORY_REQUIRED_PARAMS[product.category] ?? [];
    const missingParams = required.filter(isAiInferableParam).filter((paramKey) => {
      return !existingParamKeys.has(productParamKey(product.product_id, paramKey));
    });

    if (missingParams.length === 0) {
      continue;
    }

    totalMissingAiParams += missingParams.length;
    missingByCategory.set(product.category, (missingByCategory.get(product.category) ?? 0) + missingParams.length);
    productWithMissingByCategory.set(product.category, (productWithMissingByCategory.get(product.category) ?? 0) + 1);
    for (const paramKey of missingParams) {
      missingByParam.set(paramKey, (missingByParam.get(paramKey) ?? 0) + 1);
    }

    productsWithMissing.push({
      id: product.product_id,
      category: product.category,
      model_no: cleanPromptText(product.model_no, 120),
      product_name: cleanPromptText(product.product_name, 220) ?? "",
      existingParams: paramsByProduct.get(product.product_id) ?? {},
      missingParams,
    });
  }

  const plannedBatches = buildPlannedBatches(productsWithMissing).length;
  return {
    productsWithMissing,
    gapStats: {
      productsInScope: products.length,
      productsWithMissingAiParams: productsWithMissing.length,
      totalMissingAiParams,
      plannedBatches,
      missingByCategory,
      productCountByCategory,
      productWithMissingByCategory,
      missingByParam,
    },
  };
}

async function loadProducts(): Promise<ProductRow[]> {
  const categories = Object.keys(CATEGORY_REQUIRED_PARAMS);
  const placeholders = categories.map(() => "?").join(", ");
  return prisma.$queryRawUnsafe<ProductRow[]>(
    `
      SELECT
        p.id as product_id,
        p.product_name,
        p.model_no,
        COALESCE(NULLIF(TRIM(p.category), ''), '未分类') as category,
        p.remark,
        p.size,
        p.material
      FROM products p
      WHERE COALESCE(NULLIF(TRIM(p.category), ''), '未分类') IN (${placeholders})
      ORDER BY category ASC, product_name ASC, id ASC
    `,
    ...categories,
  );
}

async function loadExistingParams(): Promise<ExistingParamRow[]> {
  return prisma.$queryRawUnsafe<ExistingParamRow[]>(`
    SELECT product_id, param_key, raw_value, normalized_value, unit
    FROM product_params
    WHERE raw_value IS NOT NULL
      AND TRIM(raw_value) != ''
  `);
}

function buildExistingParamKeys(rows: ExistingParamRow[]): Set<string> {
  const keys = new Set<string>();
  for (const row of rows) {
    if (isDirtyVoltage(row)) {
      continue;
    }
    if (!hasUsefulValue(row)) {
      continue;
    }
    keys.add(productParamKey(row.product_id, row.param_key));
  }
  return keys;
}

function buildParamsByProduct(rows: ExistingParamRow[]): Map<string, Record<string, string>> {
  const map = new Map<string, Record<string, string>>();
  for (const row of rows) {
    if (isDirtyVoltage(row) || !hasUsefulValue(row)) {
      continue;
    }
    const productParams = map.get(row.product_id) ?? {};
    if (Object.keys(productParams).length >= 16 || productParams[row.param_key]) {
      map.set(row.product_id, productParams);
      continue;
    }
    productParams[row.param_key] = cleanPromptText(row.normalized_value ?? row.raw_value, 80) ?? "";
    map.set(row.product_id, productParams);
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
  for (const [category, categoryProducts] of Array.from(byCategory.entries()).sort(([left], [right]) =>
    left.localeCompare(right, "zh-Hans-CN"),
  )) {
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
    failures: [],
  };

  for (const [index, batch] of batches.entries()) {
    if (existsSync(batch.cachePath)) {
      stats.cachedBatches += 1;
      continue;
    }

    stats.attemptedBatches += 1;
    if (stats.attemptedBatches % 10 === 1 || index === batches.length - 1) {
      console.log(`DeepSeek batch ${index + 1}/${batches.length}: ${batch.category} #${batch.batchIndex}`);
    }

    try {
      const response = await callDeepSeekWithRetry(client, batch);
      stats.successfulBatches += 1;
      stats.responseItems += response.length;
      await writeCacheFile(batch, response);
    } catch (error) {
      stats.failedBatches += 1;
      stats.failures.push(`${batch.category} batch ${batch.batchIndex}: ${errorMessage(error)}`);
    }

    await sleep(API_SLEEP_MS);
  }

  return stats;
}

function createDeepSeekClient(): OpenAI {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("DeepSeek API Key 未配置。请在 .env.local 里设置 DEEPSEEK_API_KEY。");
  }
  return new OpenAI({
    apiKey,
    baseURL: "https://api.deepseek.com/v1",
    timeout: 60_000,
  });
}

async function callDeepSeekWithRetry(client: OpenAI, batch: PlannedBatch): Promise<ParsedAiItem[]> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const completion = await client.chat.completions.create({
        model: MODEL,
        temperature: 0.1,
        messages: [{ role: "user", content: buildPrompt(batch.category, batch.products) }],
      });
      const content = completion.choices[0]?.message?.content ?? "";
      return parseAiResponse(content);
    } catch (error) {
      lastError = error;
      if (attempt < MAX_RETRIES) {
        await sleep(attempt === 1 ? 1_000 : 3_000);
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function buildPrompt(category: string, products: ProductWithContext[]): string {
  return `你是照明行业规格参数专家。下面是 ${products.length} 个"${category}"产品，每个产品有型号、名称和已有参数。
请为每个产品推断缺失的参数值。

规则：
1. 只填你有把握的值。不确定就写 null。
2. voltage 格式：纯数字或范围，如 "220-240"、"100-240"、"48"、"12"。不带 V/AC 前缀。
3. cct 格式：纯数字或范围，如 "3000"、"6500"、"3000-6500"、"2700-6500"。不带 K 后缀。
4. cri 格式：纯数字，如 "80"、"90"。
5. pf 格式：小数，如 "0.5"、"0.9"。
6. driver_type 格式：中文，如 "隔离"、"非隔离"、"DOB"、"LC"、"恒流IC"。
7. material 格式：中文材料名，如 "铝+PC"、"铝压铸"、"玻璃"、"ABS"。
8. beam_angle 格式：纯数字（度），如 "120"、"60"、"15-60"。
9. base 格式：标准灯头型号，如 "E27"、"E14"、"GU10"、"G4"、"G9"。

${category} 品类背景：${getCategoryContext(category)}

产品列表（JSON）：
${JSON.stringify(
  products.map<PromptProduct>((product) => ({
    id: product.id,
    model: product.model_no,
    name: product.product_name,
    existing: product.existingParams,
    missing: product.missingParams,
  })),
  null,
  2,
)}

请返回 JSON 数组，格式：
[
  { "id": "产品ID", "params": { "cct": "3000-6500", "driver_type": "非隔离" } },
  ...
]
只返回 JSON，不要解释。`;
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
    太阳能壁灯: "太阳能供电壁灯。无需市电 voltage。CCT 多为 6500 冷白。材料 ABS/PC。",
    太阳能: "太阳能灯（路灯/庭院灯等）。无需市电 voltage。CCT 多为 6500。材料 ABS/铝。",
    路灯: "道路照明。宽压 85-265V 或 100-240V。CRI 80，PF 0.9。光束角 60°-150°。",
    "地埋灯/地插灯": "地面嵌入式。12V 或 220-240V。CRI 80。窄光束角 15-60°。",
    工作灯: "便携/临时照明。220-240V 或充电式。CRI 80。",
    庭院灯: "庭院/花园装饰灯。220-240V 或太阳能。材料铝/不锈钢。",
    Highbay: "工矿灯/高棚灯。宽压 100-277V 或 85-265V。CRI 80，PF 0.95+。光束角 60°/90°/120°。",
    充电灯: "充电式便携灯。无需市电 voltage。材料 ABS/PC。",
    应急灯: "应急照明。220-240V（带电池）。CRI 要求低。",
    灯带: "LED 灯条。12V 或 24V DC 为主。CRI 80。",
    皮线灯: "装饰类灯串。220V 或 24V。",
  };
  return contexts[category] ?? "照明灯具。";
}

function parseAiResponse(content: string): ParsedAiItem[] {
  const text = content.trim();
  const parsed = parseJson(text) ?? parseJson(extractJsonArray(text));
  if (!Array.isArray(parsed)) {
    throw new Error("DeepSeek response is not a JSON array.");
  }

  const items: ParsedAiItem[] = [];
  for (const item of parsed as AiResponseItem[]) {
    if (!item || typeof item !== "object" || typeof item.id !== "string" || !item.params || typeof item.params !== "object") {
      continue;
    }
    const params: Partial<Record<AiParamKey, string | null>> = {};
    for (const [key, value] of Object.entries(item.params as Record<string, unknown>)) {
      if (!isAiInferableParam(key)) {
        continue;
      }
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

async function writeCacheFile(batch: PlannedBatch, response: ParsedAiItem[]) {
  const cached: CachedBatch = {
    category: batch.category,
    batchIndex: batch.batchIndex,
    cacheFile: path.basename(batch.cachePath),
    timestamp: new Date().toISOString(),
    model: MODEL,
    products: batch.products.map((product) => ({
      id: product.id,
      model: product.model_no,
      name: product.product_name,
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
    dirtyVoltageDeleted: 0,
    validParams: 0,
    insertedParams: 0,
    skippedExisting: 0,
    skippedMissingProduct: 0,
    skippedNotRequested: 0,
    invalidParams: 0,
    invalidSamples: [],
    insertedByParam: new Map(),
    insertedByCategory: new Map(),
  };

  stats.dirtyVoltageDeleted = await deleteDirtyVoltageRows();
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
        if (!isAiInferableParam(paramKey)) {
          continue;
        }
        if (!product.missingParams.includes(paramKey)) {
          stats.skippedNotRequested += 1;
          continue;
        }
        const existingKey = productParamKey(item.id, paramKey);
        if (existingParamKeys.has(existingKey)) {
          stats.skippedExisting += 1;
          continue;
        }

        const normalizedValue = normalizeAiValue(paramKey, rawValue);
        if (!normalizedValue || !VALIDATORS[paramKey](normalizedValue)) {
          stats.invalidParams += 1;
          if (stats.invalidSamples.length < 30) {
            stats.invalidSamples.push(`${product.category} ${product.model_no ?? product.product_name} ${paramKey}: ${String(rawValue ?? "")}`);
          }
          continue;
        }

        stats.validParams += 1;
        existingParamKeys.add(existingKey);
        plannedRows.push({
          productId: item.id,
          paramKey,
          rawValue: formatRawValue(paramKey, normalizedValue),
          normalizedValue,
          unit: unitForParam(paramKey),
          sourceField: "deepseek_inference",
          confidence: "inferred",
        });
        stats.insertedByParam.set(paramKey, (stats.insertedByParam.get(paramKey) ?? 0) + 1);
        stats.insertedByCategory.set(product.category, (stats.insertedByCategory.get(product.category) ?? 0) + 1);
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
  const rows = await loadExistingParams();
  return buildExistingParamKeys(rows);
}

async function deleteDirtyVoltageRows(): Promise<number> {
  const result = await prisma.productParam.deleteMany({
    where: {
      paramKey: "voltage",
      normalizedValue: { in: DIRTY_VOLTAGE_VALUES },
    },
  });
  return result.count;
}

async function loadCacheFiles(): Promise<CachedBatch[]> {
  const names = (await readdir(CACHE_DIR)).filter((name) => name.endsWith(".json")).sort();
  const caches: CachedBatch[] = [];
  for (const name of names) {
    const fullPath = path.join(CACHE_DIR, name);
    const parsed = JSON.parse(await readFile(fullPath, "utf8")) as CachedBatch;
    if (Array.isArray(parsed.response)) {
      caches.push(parsed);
    }
  }
  return caches;
}

const VALIDATORS: Record<AiParamKey, (value: string) => boolean> = {
  voltage: (value) => /^\d{1,3}(-\d{1,3})?$/.test(value) && !["0", "1", "2"].includes(value),
  cct: (value) => /^\d{4}(-\d{4})?$/.test(value),
  cri: (value) => /^\d{2,3}$/.test(value) && Number(value) >= 60 && Number(value) <= 100,
  pf: (value) => /^0\.\d+$/.test(value) && Number(value) >= 0.3 && Number(value) <= 1.0,
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
  if (!raw || /^null$/i.test(raw) || /^n\/a$/i.test(raw) || raw === "-") {
    return null;
  }

  switch (paramKey) {
    case "voltage": {
      const numbers = raw.match(/\d{1,3}/g);
      if (!numbers?.length) return null;
      if (numbers.length >= 2) return `${numbers[0]}-${numbers[1]}`;
      return numbers[0];
    }
    case "cct": {
      const numbers = raw.match(/\d{4}/g);
      if (!numbers?.length) return null;
      if (numbers.length >= 2) return `${numbers[0]}-${numbers[numbers.length - 1]}`;
      return numbers[0];
    }
    case "cri": {
      const match = raw.match(/\d{2,3}/);
      return match?.[0] ?? null;
    }
    case "pf": {
      const match = raw.match(/(?:0\.\d+|1\.0)/);
      return match?.[0] ?? null;
    }
    case "beam_angle": {
      const numbers = raw.match(/\d{1,3}/g);
      if (!numbers?.length) return null;
      if (numbers.length >= 2) return `${numbers[0]}-${numbers[1]}`;
      return numbers[0];
    }
    case "base": {
      const match = raw.match(/\b(?:E(?:14|27|40)|B22|GU10|GX53|G[459]|MR16)\b/i);
      return (match?.[0] ?? raw.replace(/\s+/g, "")).toUpperCase();
    }
    case "driver_type":
    case "material":
      return raw.replace(/^[-:：]+|[-:：]+$/g, "").trim();
    default:
      return raw;
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

function isAiInferableParam(paramKey: string): paramKey is AiParamKey {
  return (AI_INFERABLE_PARAMS as readonly string[]).includes(paramKey);
}

function isDirtyVoltage(row: ExistingParamRow): boolean {
  return row.param_key === "voltage" && row.normalized_value != null && DIRTY_VOLTAGE_VALUES.includes(row.normalized_value);
}

function hasUsefulValue(row: ExistingParamRow): boolean {
  return Boolean((row.normalized_value ?? row.raw_value ?? "").trim());
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

function loadEnvLocal() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!existsSync(envPath)) {
    return;
  }
  const content = readFileSync(envPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const key = match[1];
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
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
}): string {
  const lines: string[] = [];
  lines.push("# V13.0 DeepSeek AI 参数推断报告");
  lines.push("");
  lines.push(`模式: ${input.mode}`);
  lines.push(`时间: ${new Date().toISOString()}`);
  lines.push(`备份: ${BACKUP_PATH}`);
  lines.push(`缓存目录: ${CACHE_DIR}`);
  lines.push("");

  lines.push("## Part 0 — 脏 voltage 清理");
  lines.push("");
  lines.push("| 项 | 数量 |");
  lines.push("|---|---:|");
  lines.push(`| 执行前 dirty voltage | ${input.before.dirtyVoltage} |`);
  lines.push(`| 执行后 dirty voltage | ${input.after.dirtyVoltage} |`);
  lines.push(`| 本次删除 | ${input.applyStats?.dirtyVoltageDeleted ?? 0} |`);
  lines.push("");

  lines.push("## Part 1 — 缺口统计");
  lines.push("");
  lines.push("| 指标 | 数量 |");
  lines.push("|---|---:|");
  lines.push(`| 范围内产品 | ${input.gapStats.productsInScope} |`);
  lines.push(`| 有 AI 可推断必要参数缺口的产品 | ${input.gapStats.productsWithMissingAiParams} |`);
  lines.push(`| AI 可推断缺口总数 | ${input.gapStats.totalMissingAiParams} |`);
  lines.push(`| 计划批次（30/批） | ${input.gapStats.plannedBatches} |`);
  lines.push("");

  lines.push("### 缺口按参数");
  lines.push("");
  lines.push("| 参数 | 缺口数 |");
  lines.push("|---|---:|");
  for (const [paramKey, count] of sortMap(input.gapStats.missingByParam)) {
    lines.push(`| ${escapeMd(paramKey)} | ${count} |`);
  }
  lines.push("");

  lines.push("### 缺口按品类");
  lines.push("");
  lines.push("| 品类 | 产品数 | 缺口产品 | 缺口参数数 |");
  lines.push("|---|---:|---:|---:|");
  for (const [category, missingCount] of sortMap(input.gapStats.missingByCategory, "desc")) {
    lines.push(
      `| ${escapeMd(category)} | ${input.gapStats.productCountByCategory.get(category) ?? 0} | ${
        input.gapStats.productWithMissingByCategory.get(category) ?? 0
      } | ${missingCount} |`,
    );
  }
  lines.push("");

  if (input.inferStats) {
    lines.push("## Part 2 — DeepSeek 推断");
    lines.push("");
    lines.push("| 指标 | 数量 |");
    lines.push("|---|---:|");
    lines.push(`| 计划批次 | ${input.inferStats.plannedBatches} |`);
    lines.push(`| 已有缓存跳过 | ${input.inferStats.cachedBatches} |`);
    lines.push(`| 本次请求批次 | ${input.inferStats.attemptedBatches} |`);
    lines.push(`| 成功批次 | ${input.inferStats.successfulBatches} |`);
    lines.push(`| 失败批次 | ${input.inferStats.failedBatches} |`);
    lines.push(`| 返回产品项 | ${input.inferStats.responseItems} |`);
    if (input.inferStats.failures.length) {
      lines.push("");
      lines.push("### 失败批次");
      lines.push("");
      for (const failure of input.inferStats.failures.slice(0, 100)) {
        lines.push(`- ${escapeMd(failure)}`);
      }
    }
    lines.push("");
  }

  if (input.applyStats) {
    lines.push("## Part 3 — 验证 + 写入");
    lines.push("");
    lines.push("| 指标 | 数量 |");
    lines.push("|---|---:|");
    lines.push(`| 缓存文件 | ${input.applyStats.cacheFiles} |`);
    lines.push(`| 响应产品项 | ${input.applyStats.responseItems} |`);
    lines.push(`| 验证通过参数 | ${input.applyStats.validParams} |`);
    lines.push(`| 插入参数 | ${input.applyStats.insertedParams} |`);
    lines.push(`| 跳过：已有参数 | ${input.applyStats.skippedExisting} |`);
    lines.push(`| 跳过：产品不在缺口清单 | ${input.applyStats.skippedMissingProduct} |`);
    lines.push(`| 跳过：非本次请求参数 | ${input.applyStats.skippedNotRequested} |`);
    lines.push(`| 验证失败参数 | ${input.applyStats.invalidParams} |`);
    lines.push("");

    lines.push("### 插入按参数");
    lines.push("");
    lines.push("| 参数 | 插入数 |");
    lines.push("|---|---:|");
    for (const [paramKey, count] of sortMap(input.applyStats.insertedByParam, "desc")) {
      lines.push(`| ${escapeMd(paramKey)} | ${count} |`);
    }
    lines.push("");

    lines.push("### 插入按品类");
    lines.push("");
    lines.push("| 品类 | 插入数 |");
    lines.push("|---|---:|");
    for (const [category, count] of sortMap(input.applyStats.insertedByCategory, "desc")) {
      lines.push(`| ${escapeMd(category)} | ${count} |`);
    }
    lines.push("");

    if (input.applyStats.invalidSamples.length) {
      lines.push("### 验证失败样本");
      lines.push("");
      for (const sample of input.applyStats.invalidSamples) {
        lines.push(`- ${escapeMd(sample)}`);
      }
      lines.push("");
    }
  }

  lines.push("## DB 计数");
  lines.push("");
  lines.push("| 表 | 执行前 | 执行后 | 变化 |");
  lines.push("|---|---:|---:|---:|");
  lines.push(`| products | ${input.before.products} | ${input.after.products} | ${input.after.products - input.before.products} |`);
  lines.push(
    `| product_params | ${input.before.productParams} | ${input.after.productParams} | ${
      input.after.productParams - input.before.productParams
    } |`,
  );
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function sortMap<T extends string>(map: Map<T, number>, direction: "asc" | "desc" = "asc"): Array<[T, number]> {
  return Array.from(map.entries()).sort((left, right) => {
    if (left[1] !== right[1]) {
      return direction === "desc" ? right[1] - left[1] : left[1] - right[1];
    }
    return left[0].localeCompare(right[0], "zh-Hans-CN");
  });
}

function toNumber(value: DbCount): number {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return value;
  return 0;
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
