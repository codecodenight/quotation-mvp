import "dotenv/config";

import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { PrismaClient } from "@prisma/client";

import { backupDatabase, chunks, formatInteger, formatPercent, INSERT_BATCH_SIZE, md } from "./v25-watts-shared";

const REPORT_PATH = path.join("docs", "v28.0-remark-extraction-report.md");
const SOURCE_FIELD = "v28.0_remark_extraction";

type Mode = "dry-run" | "apply";

type ExtractorResult = {
  paramKey: string;
  rawValue: string;
  normalizedValue: string;
  unit: string | null;
};

type ProductRow = {
  id: string;
  product_name: string;
  model_no: string | null;
  category: string | null;
  remark: string;
};

type ExistingParamRow = {
  product_id: string;
  param_key: string;
};

type PlannedParam = ExtractorResult & {
  id: string;
  productId: string;
  productName: string;
  modelNo: string | null;
  category: string;
};

type Coverage = {
  totalProducts: number;
  productParams: number;
  byParam: Map<string, number>;
};

type CategoryStat = {
  scanned: number;
  extractedProducts: Set<string>;
  plannedCount: number;
  byParam: Map<string, number>;
};

type Summary = {
  mode: Mode;
  backupPath: string | null;
  products: ProductRow[];
  plannedParams: PlannedParam[];
  inserted: number;
  skippedExisting: number;
  rejectedWatts: RejectedWattsSample[];
  before: Coverage;
  after: Coverage;
  categoryStats: Map<string, CategoryStat>;
};

type RejectedWattsSample = {
  category: string;
  productName: string;
  modelNo: string | null;
  watts: number;
  range: [number, number];
  reason: string;
};

const CATEGORY_WATTS_RANGE: Record<string, [number, number]> = {
  筒灯: [1, 100],
  面板灯: [3, 200],
  线条灯: [5, 200],
  磁吸灯: [3, 50],
  太阳能壁灯: [1, 50],
  灯带: [1, 200],
  皮线灯: [1, 50],
  三防灯: [10, 120],
  轨道灯: [5, 60],
  吸顶灯: [10, 200],
  投光灯: [10, 1000],
  球泡: [3, 50],
  灯丝灯: [1, 20],
  灯管: [5, 60],
  壁灯: [3, 30],
  风扇灯: [20, 300],
  净化灯: [10, 80],
  路灯: [20, 500],
  Highbay: [50, 600],
  防潮灯: [6, 60],
  应急灯: [3, 50],
  橱柜灯: [1, 30],
  镜前灯: [5, 30],
  台灯: [3, 30],
  "地埋灯/地插灯": [1, 50],
  工作灯: [3, 100],
  庭院灯: [5, 200],
  太阳能: [5, 500],
  G4G9: [1, 10],
};

async function main() {
  const mode: Mode = process.argv.includes("--apply") ? "apply" : "dry-run";
  if (process.argv.includes("--dry-run") && process.argv.includes("--apply")) throw new Error("Use either --dry-run or --apply, not both.");

  const prisma = new PrismaClient();
  try {
    const summary = await run(prisma, mode);
    await mkdir(path.dirname(REPORT_PATH), { recursive: true });
    await writeFile(REPORT_PATH, buildReport(summary), "utf8");
    console.log(
      JSON.stringify(
        {
          mode,
          reportPath: REPORT_PATH,
          backupPath: summary.backupPath,
          scannedProducts: summary.products.length,
          extractedProducts: new Set(summary.plannedParams.map((param) => param.productId)).size,
          planned: summary.plannedParams.length,
          inserted: summary.inserted,
          skippedExisting: summary.skippedExisting,
          rejectedWatts: summary.rejectedWatts.length,
          productParamsBefore: summary.before.productParams,
          productParamsAfter: summary.after.productParams,
          byParam: Object.fromEntries(countByParam(summary.plannedParams)),
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

async function run(prisma: PrismaClient, mode: Mode): Promise<Summary> {
  console.log("V28.0 load remark products");
  const products = await loadRemarkProducts(prisma);
  const before = await loadCoverage(prisma);
  const existing = await loadExistingParamKeys(prisma, products.map((product) => product.id));
  const categoryStats = new Map<string, CategoryStat>();
  const plannedParams: PlannedParam[] = [];
  const plannedKeys = new Set<string>();
  const rejectedWatts: RejectedWattsSample[] = [];
  let skippedExisting = 0;

  for (const product of products) {
    const category = cleanCategory(product.category);
    const categoryStat = getCategoryStat(categoryStats, category);
    categoryStat.scanned += 1;
    const extracted = dedupeExtracted(extractParamsFromRemark(product.remark));
    for (const result of extracted) {
      const existingKey = `${product.id}\u0000${result.paramKey}`;
      if (existing.has(existingKey)) {
        skippedExisting += 1;
        continue;
      }
      if (plannedKeys.has(existingKey)) continue;
      if (result.paramKey === "watts" && !isValidWatts(result, product, rejectedWatts)) continue;
      const planned: PlannedParam = {
        id: randomUUID(),
        productId: product.id,
        productName: product.product_name,
        modelNo: product.model_no,
        category,
        ...result,
      };
      plannedParams.push(planned);
      plannedKeys.add(existingKey);
      categoryStat.extractedProducts.add(product.id);
      categoryStat.plannedCount += 1;
      categoryStat.byParam.set(result.paramKey, (categoryStat.byParam.get(result.paramKey) ?? 0) + 1);
    }
  }

  const backupPath = mode === "apply" ? await backupDatabase("v28.0") : null;
  const inserted = mode === "apply" ? await insertParams(prisma, plannedParams) : 0;
  const after = mode === "apply" ? await loadCoverage(prisma) : projectCoverage(before, plannedParams);
  return { mode, backupPath, products, plannedParams, inserted, skippedExisting, rejectedWatts, before, after, categoryStats };
}

function extractParamsFromRemark(remark: string): ExtractorResult[] {
  const results: ExtractorResult[] = [];
  const normalizedRemark = remark.normalize("NFC");

  const ipMatch = normalizedRemark.match(/(?:protection|防[水护]等级|waterproof\s*rate|IP)\s*[:：]?\s*IP\s*(\d{2})/i) || normalizedRemark.match(/\bIP\s*(\d{2})\b/i);
  if (ipMatch) results.push({ paramKey: "ip", rawValue: `IP${ipMatch[1]}`, normalizedValue: `IP${ipMatch[1]}`, unit: null });

  const materialMatch = normalizedRemark.match(
    /(?:material|材质)\s*[:：]\s*([^\n,;，；]{2,50}?)(?=\s+(?:Panel|Solar|Battery|LED|Luminous|Lumens|Color|Protection|Induction|Charging|Warranty|Lighting|Waterproof|工作|质保|防水|灯头|描述)|$)/i,
  );
  if (materialMatch) {
    const value = cleanMaterialValue(materialMatch[1]);
    if (value) results.push({ paramKey: "material", rawValue: value, normalizedValue: value, unit: null });
  }

  const lumensMatch = normalizedRemark.match(/(?:luminous\s*flux|lumens?|流明|光通量)\s*[:：]\s*(\d+(?:\.\d+)?)\s*lm(?!\s*\/?\s*w)/i);
  if (lumensMatch) results.push({ paramKey: "lumens", rawValue: `${lumensMatch[1]}lm`, normalizedValue: lumensMatch[1], unit: "lm" });

  const wattsMatch = findExplicitLampWatts(normalizedRemark);
  if (wattsMatch) results.push({ paramKey: "watts", rawValue: `${wattsMatch}W`, normalizedValue: wattsMatch, unit: "W" });

  const criMatch = normalizedRemark.match(/(?:CRI|Ra)\s*[:：>]?\s*(\d{2,3})/i);
  if (criMatch) {
    const value = parseInt(criMatch[1], 10);
    if (value >= 60 && value <= 100) results.push({ paramKey: "cri", rawValue: `Ra${value}`, normalizedValue: String(value), unit: null });
  }

  const cctMatch = normalizedRemark.match(/(?:color\s*temp(?:erature)?|色温|CCT)\s*[:：]\s*(\d{4,5})\s*K/i);
  if (cctMatch) results.push({ paramKey: "cct", rawValue: `${cctMatch[1]}K`, normalizedValue: cctMatch[1], unit: "K" });

  const baseMatch = normalizedRemark.match(/(?:base|灯头(?:类型)?)\s*[:：]\s*(E\d+|GU\d+|G\d+|B\d+|MR\d+)/i);
  if (baseMatch) {
    const value = baseMatch[1].toUpperCase();
    results.push({ paramKey: "base", rawValue: value, normalizedValue: value, unit: null });
  }

  const ledCountMatch = normalizedRemark.match(/LED\s*[:：]\s*(?:(\d+)\s*\*\s*)?(\d+)\s*PCS/i);
  if (ledCountMatch) {
    const count = ledCountMatch[1] ? String(parseInt(ledCountMatch[1], 10) * parseInt(ledCountMatch[2], 10)) : ledCountMatch[2];
    results.push({ paramKey: "led_count", rawValue: `${count}pcs`, normalizedValue: count, unit: null });
  }

  const warrantyMatch = normalizedRemark.match(/(?:warranty|质保|保修)\s*[:：]\s*(\d+)\s*(?:years?|年)/i);
  if (warrantyMatch) results.push({ paramKey: "warranty", rawValue: `${warrantyMatch[1]}年`, normalizedValue: warrantyMatch[1], unit: null });

  const beamMatch = normalizedRemark.match(/(?:beam\s*angle|角度|发光角|光束角)\s*[:：]\s*(\d+)\s*[°度]/i);
  if (beamMatch) {
    const value = parseInt(beamMatch[1], 10);
    if (value >= 1 && value <= 360) results.push({ paramKey: "beam_angle", rawValue: `${value}°`, normalizedValue: String(value), unit: "°" });
  }

  const sizeMatch = normalizedRemark.match(/(?:product\s*size|产品尺寸|尺寸|外形尺寸)\s*[（(]?\s*(?:mm)?\s*[）)]?\s*[:：]\s*([^\n,;，；]{3,40})/i);
  if (sizeMatch) {
    const value = cleanSizeValue(sizeMatch[1]);
    if (value) results.push({ paramKey: "size_display", rawValue: value, normalizedValue: value, unit: null });
  }

  const voltageMatch = normalizedRemark.match(/(?:voltage|input\s*voltage|电压|工作电压)\s*[:：]\s*([^\n,;，；]{2,30})/i);
  if (voltageMatch) {
    const value = cleanTextValue(voltageMatch[1]);
    if (value) results.push({ paramKey: "voltage", rawValue: value, normalizedValue: value, unit: "V" });
  }

  return results;
}

function findExplicitLampWatts(remark: string): string | null {
  const matches = [...remark.matchAll(/((?:solar\s*)?panel\s*)?(watts?|功率|power)\s*[:：]\s*(\d+(?:\.\d+)?)\s*w/gi)];
  for (const match of matches) {
    const full = match[0].toLowerCase();
    const before = remark.slice(Math.max(0, (match.index ?? 0) - 20), match.index ?? 0).toLowerCase();
    if (match[1] || /panel|光伏板|太阳能板/.test(full) || /panel|光伏板|太阳能板/.test(before)) continue;
    return match[3];
  }
  return null;
}

function isValidWatts(result: ExtractorResult, product: ProductRow, rejectedWatts: RejectedWattsSample[]): boolean {
  const watts = Number(result.normalizedValue);
  const category = cleanCategory(product.category);
  const range = CATEGORY_WATTS_RANGE[category] ?? [0.5, 1000];
  if (!Number.isFinite(watts) || watts < range[0] || watts > range[1]) {
    if (rejectedWatts.length < 200) {
      rejectedWatts.push({ category, productName: product.product_name, modelNo: product.model_no, watts, range, reason: "品类范围外或非数字" });
    }
    return false;
  }
  return true;
}

function dedupeExtracted(items: ExtractorResult[]): ExtractorResult[] {
  const byKey = new Map<string, ExtractorResult>();
  for (const item of items) {
    if (!byKey.has(item.paramKey)) byKey.set(item.paramKey, item);
  }
  return [...byKey.values()];
}

async function loadRemarkProducts(prisma: PrismaClient): Promise<ProductRow[]> {
  return prisma.$queryRaw<ProductRow[]>`
    SELECT id, product_name, model_no, category, remark
    FROM products
    WHERE remark IS NOT NULL
      AND trim(remark) <> ''
    ORDER BY category, product_name
  `;
}

async function loadExistingParamKeys(prisma: PrismaClient, productIds: string[]): Promise<Set<string>> {
  const keys = new Set<string>();
  for (const chunk of chunks(productIds, 900)) {
    const rows = await prisma.productParam.findMany({
      where: { productId: { in: chunk } },
      select: { productId: true, paramKey: true },
    });
    for (const row of rows) keys.add(`${row.productId}\u0000${row.paramKey}`);
  }
  return keys;
}

async function insertParams(prisma: PrismaClient, plannedParams: PlannedParam[]): Promise<number> {
  let inserted = 0;
  for (const chunk of chunks(plannedParams, INSERT_BATCH_SIZE)) {
    const result = await prisma.productParam.createMany({
      data: chunk.map((param) => ({
        id: param.id,
        productId: param.productId,
        paramKey: param.paramKey,
        rawValue: param.rawValue,
        normalizedValue: param.normalizedValue,
        unit: param.unit,
        sourceField: SOURCE_FIELD,
        confidence: "high",
      })),
    });
    inserted += result.count;
  }
  return inserted;
}

async function loadCoverage(prisma: PrismaClient): Promise<Coverage> {
  const rows = await prisma.$queryRaw<Array<{ param_key: string; covered: number | bigint }>>`
    SELECT param_key, COUNT(DISTINCT product_id) AS covered
    FROM product_params
    GROUP BY param_key
  `;
  const productParams = await prisma.productParam.count();
  return { totalProducts: await prisma.product.count(), productParams, byParam: new Map(rows.map((row) => [row.param_key, Number(row.covered)])) };
}

function projectCoverage(before: Coverage, plannedParams: PlannedParam[]): Coverage {
  const byParam = new Map(before.byParam);
  for (const [paramKey, count] of countByParam(plannedParams)) byParam.set(paramKey, (byParam.get(paramKey) ?? 0) + count);
  return { totalProducts: before.totalProducts, productParams: before.productParams + plannedParams.length, byParam };
}

function countByParam(plannedParams: PlannedParam[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const param of plannedParams) counts.set(param.paramKey, (counts.get(param.paramKey) ?? 0) + 1);
  return new Map([...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])));
}

function getCategoryStat(map: Map<string, CategoryStat>, category: string): CategoryStat {
  const stat = map.get(category) ?? { scanned: 0, extractedProducts: new Set<string>(), plannedCount: 0, byParam: new Map<string, number>() };
  map.set(category, stat);
  return stat;
}

function buildReport(summary: Summary): string {
  const byParam = countByParam(summary.plannedParams);
  const extractedProducts = new Set(summary.plannedParams.map((param) => param.productId)).size;
  return `# V28.0 Remark 结构化数据提取报告

模式: ${summary.mode}

## 备份
路径: ${summary.backupPath ?? "dry-run 未创建备份"}

## 统计
- 扫描产品数（有 remark）: ${formatInteger(summary.products.length)}
- 提取到参数的产品数: ${formatInteger(extractedProducts)}
- 新增 product_params 总数: ${formatInteger(summary.plannedParams.length)}
- 跳过（已有参数）: ${formatInteger(summary.skippedExisting)}
- 跳过 watts（品类范围外）: ${formatInteger(summary.rejectedWatts.length)}
- 写入成功: ${formatInteger(summary.inserted)}

## 按 param_key

| param_key | 新增数 | 提取前覆盖 | 提取后覆盖 | 增量 |
|-----------|--------|-----------|-----------|------|
${[...new Set([...summary.before.byParam.keys(), ...byParam.keys()])]
  .filter((paramKey) => byParam.has(paramKey))
  .sort((left, right) => (byParam.get(right) ?? 0) - (byParam.get(left) ?? 0) || left.localeCompare(right))
  .map((paramKey) => {
    const before = summary.before.byParam.get(paramKey) ?? 0;
    const after = summary.after.byParam.get(paramKey) ?? before;
    const added = byParam.get(paramKey) ?? 0;
    return `| ${md(paramKey)} | ${formatInteger(added)} | ${formatInteger(before)}/${formatInteger(summary.before.totalProducts)} (${formatPercent(before, summary.before.totalProducts)}) | ${formatInteger(after)}/${formatInteger(summary.after.totalProducts)} (${formatPercent(after, summary.after.totalProducts)}) | +${formatInteger(after - before)} |`;
  })
  .join("\n")}

## 按品类（前 20）

| 品类 | 扫描数 | 提取产品数 | 新增参数数 | 主要 param_keys |
|------|--------|-----------|-----------|---------------|
${[...summary.categoryStats.entries()]
  .filter(([, stat]) => stat.plannedCount > 0)
  .sort((left, right) => right[1].plannedCount - left[1].plannedCount || left[0].localeCompare(right[0]))
  .slice(0, 20)
  .map(([category, stat]) => `| ${md(category)} | ${formatInteger(stat.scanned)} | ${formatInteger(stat.extractedProducts.size)} | ${formatInteger(stat.plannedCount)} | ${md(formatParamCounts(stat.byParam))} |`)
  .join("\n")}

## 写入样本（每个 param_key 前 5 条）

${[...byParam.keys()].map((paramKey) => buildSampleSection(paramKey, summary.plannedParams.filter((param) => param.paramKey === paramKey).slice(0, 5))).join("\n\n")}

## watts 拦截样本（前 20 条）

| 品类 | product_name | model_no | 提取值 | 合理区间 | 原因 |
|------|-------------|---------|--------|---------|------|
${summary.rejectedWatts
  .slice(0, 20)
  .map((row) => `| ${md(row.category)} | ${md(row.productName)} | ${md(row.modelNo ?? "-")} | ${md(row.watts)} | ${row.range[0]}-${row.range[1]}W | ${md(row.reason)} |`)
  .join("\n")}

## product_params 总量变化
- product_params: ${formatInteger(summary.before.productParams)} → ${formatInteger(summary.after.productParams)}
- 新增 product_params: +${formatInteger(summary.after.productParams - summary.before.productParams)}

## 说明
- 只 INSERT 新 product_params，不 UPDATE / DELETE。
- source_field = ${SOURCE_FIELD}
- confidence = high
- 太阳能产品的 Panel / Solar panel 功率不作为 watts 提取。
`;
}

function buildSampleSection(paramKey: string, samples: PlannedParam[]): string {
  return `### ${paramKey}

| 品类 | product_name | model_no | raw | normalized |
|------|-------------|---------|-----|------------|
${samples.map((param) => `| ${md(param.category)} | ${md(param.productName)} | ${md(param.modelNo ?? "-")} | ${md(param.rawValue)} | ${md(param.normalizedValue)} |`).join("\n")}`;
}

function formatParamCounts(counts: Map<string, number>): string {
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([key, value]) => `${key}: ${value}`)
    .join(", ");
}

function cleanTextValue(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function cleanMaterialValue(value: string): string {
  const cleaned = cleanTextValue(value)
    .split(/\s+(?:Panel|Solar|Battery|Batteries|LED|Luminous|Lumens|Color|Protection|Induction|Charging|Warranty|Lighting|Waterproof)\b/i)[0]
    .split(/(?:防护等级|防水等级|质保|灯头类型|电压)[:：]/)[0]
    .trim();
  if (cleaned.length < 2) return "";
  if (/^\d+(?:\.\d+)?$/.test(cleaned)) return "";
  return cleaned;
}

function cleanSizeValue(value: string): string {
  const cleaned = cleanTextValue(value)
    .split(/(?:外包装尺寸|包装尺寸|外箱尺寸|净重|毛重|外壳颜色|颜色)[:：]?/)[0]
    .replace(/\s+\d+\.$/, "")
    .trim();
  if (!/\d/.test(cleaned)) return "";
  if (!/(?:\d\s*[*xX×]\s*\d|\d+\s*(?:mm|cm)\b)/i.test(cleaned)) return "";
  if (/^(?:成品)?尺寸\s*(?:mm|cm)?$/i.test(cleaned)) return "";
  return cleaned;
}

function cleanCategory(value: string | null): string {
  const trimmed = value?.trim();
  return trimmed || "(未分类)";
}

function isCliEntry(): boolean {
  const entry = process.argv[1];
  return Boolean(entry && pathToFileURL(path.resolve(entry)).href === import.meta.url);
}

if (isCliEntry()) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
