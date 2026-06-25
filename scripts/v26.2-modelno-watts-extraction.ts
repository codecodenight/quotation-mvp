import "dotenv/config";

import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { PrismaClient } from "@prisma/client";

import { backupDatabase, chunks, formatInteger, formatPercent, INSERT_BATCH_SIZE, md } from "./v25-watts-shared";

const REPORT_PATH = path.join("docs", "v26.2-modelno-watts-extraction-report.md");
const SOURCE_FIELD = "v26.2_name_embedded_watts";

type Mode = "dry-run" | "apply";
type SourceField = "product_name" | "model_no" | "remark";

type ProductRow = {
  id: string;
  product_name: string;
  model_no: string | null;
  remark: string | null;
  category: string | null;
};

type ExtractResult = {
  watts: number;
  pattern: "multiply" | "direct_unique" | "direct_repeated";
};

type PlannedParam = {
  id: string;
  productId: string;
  category: string;
  productName: string;
  modelNo: string | null;
  sourceField: SourceField;
  pattern: ExtractResult["pattern"];
  watts: number;
  rawValue: string;
  normalizedValue: string;
};

type RejectedSample = {
  category: string;
  productName: string;
  modelNo: string | null;
  watts: number;
  range: [number, number];
  reason: string;
};

type Coverage = {
  totalProducts: number;
  wattsCovered: number;
  productParams: number;
};

type Summary = {
  mode: Mode;
  backupPath: string | null;
  targetProducts: ProductRow[];
  plannedParams: PlannedParam[];
  rejectedRange: RejectedSample[];
  ambiguousCount: number;
  noMatchCount: number;
  inserted: number;
  before: Coverage;
  after: Coverage;
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
          targetProducts: summary.targetProducts.length,
          extracted: summary.plannedParams.length,
          rejectedRange: summary.rejectedRange.length,
          ambiguous: summary.ambiguousCount,
          noMatch: summary.noMatchCount,
          inserted: summary.inserted,
          productParamsBefore: summary.before.productParams,
          productParamsAfter: summary.after.productParams,
          wattsBefore: summary.before.wattsCovered,
          wattsAfter: summary.after.wattsCovered,
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
  console.log("V26.2 load coverage");
  const before = await loadCoverage(prisma);
  console.log("V26.2 load target products");
  const targetProducts = await loadTargetProducts(prisma);
  console.log(`V26.2 extract from ${targetProducts.length} products`);
  const rejectedRange: RejectedSample[] = [];
  let ambiguousCount = 0;
  let noMatchCount = 0;
  const plannedParams: PlannedParam[] = [];

  for (const product of targetProducts) {
    const result = planProduct(product, rejectedRange);
    if (result === "ambiguous") ambiguousCount += 1;
    else if (result === "no_match") noMatchCount += 1;
    else plannedParams.push(result);
  }

  const backupPath = mode === "apply" ? await backupDatabase("v26.2") : null;
  const inserted = mode === "apply" ? await insertParams(prisma, plannedParams) : 0;
  const after = mode === "apply" ? await loadCoverage(prisma) : projectCoverage(before, plannedParams.length);
  return { mode, backupPath, targetProducts, plannedParams, rejectedRange, ambiguousCount, noMatchCount, inserted, before, after };
}

function planProduct(product: ProductRow, rejectedRange: RejectedSample[]): PlannedParam | "ambiguous" | "no_match" {
  const fields: Array<[SourceField, string | null]> = [
    ["product_name", product.product_name],
    ["model_no", product.model_no],
    ...(cleanCategory(product.category) === "太阳能壁灯" ? [] : ([["remark", product.remark]] as Array<[SourceField, string | null]>)),
  ];

  let sawAmbiguous = false;
  for (const [field, value] of fields) {
    const extracted = extractWattsFromText(value ?? "");
    if (extracted === "ambiguous") {
      sawAmbiguous = true;
      continue;
    }
    if (!extracted) continue;
    const category = cleanCategory(product.category);
    const range = CATEGORY_WATTS_RANGE[category] ?? [0.5, 1000];
    if (extracted.watts < range[0] || extracted.watts > range[1]) {
      if (rejectedRange.length < 200) {
        rejectedRange.push({ category, productName: product.product_name, modelNo: product.model_no, watts: extracted.watts, range, reason: "品类范围外" });
      }
      continue;
    }
    return {
      id: randomUUID(),
      productId: product.id,
      category,
      productName: product.product_name,
      modelNo: product.model_no,
      sourceField: field,
      pattern: extracted.pattern,
      watts: extracted.watts,
      rawValue: `${formatWatts(extracted.watts)}W`,
      normalizedValue: formatWatts(extracted.watts),
    };
  }
  return sawAmbiguous ? "ambiguous" : "no_match";
}

function extractWattsFromText(text: string): ExtractResult | "ambiguous" | null {
  if (!text.trim()) return null;
  const multiply = text.match(/(\d+(?:\.\d+)?)\s*[*×xX]\s*(\d+(?:\.\d+)?)\s*[Ww]\b/);
  if (multiply) return { watts: Number(multiply[1]) * Number(multiply[2]), pattern: "multiply" };

  const directAll = [...text.matchAll(/(\d{1,4}(?:\.\d+)?)\s*[Ww](?![a-zA-Z])/g)]
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value));
  if (directAll.length === 0) return null;
  if (directAll.length === 1) return { watts: directAll[0], pattern: "direct_unique" };
  const unique = [...new Set(directAll)];
  if (unique.length === 1) return { watts: unique[0], pattern: "direct_repeated" };
  return "ambiguous";
}

async function loadTargetProducts(prisma: PrismaClient): Promise<ProductRow[]> {
  return prisma.$queryRaw<ProductRow[]>`
    SELECT p.id,
           p.product_name,
           p.model_no,
           p.remark,
           p.category
    FROM products p
    WHERE NOT EXISTS (
      SELECT 1
      FROM product_params AS pp INDEXED BY product_params_product_id_idx
      WHERE pp.product_id = p.id
        AND pp.param_key = 'watts'
    )
    ORDER BY p.category, p.product_name
  `;
}

async function insertParams(prisma: PrismaClient, plannedParams: PlannedParam[]): Promise<number> {
  let inserted = 0;
  for (const chunk of chunks(plannedParams, INSERT_BATCH_SIZE)) {
    const result = await prisma.productParam.createMany({
      data: chunk.map((param) => ({
        id: param.id,
        productId: param.productId,
        paramKey: "watts",
        rawValue: param.rawValue,
        normalizedValue: param.normalizedValue,
        unit: "W",
        sourceField: SOURCE_FIELD,
        confidence: "medium",
      })),
    });
    inserted += result.count;
  }
  return inserted;
}

async function loadCoverage(prisma: PrismaClient): Promise<Coverage> {
  const [row] = await prisma.$queryRaw<Array<{ total_products: number | bigint; product_params: number | bigint; watts_covered: number | bigint }>>`
    SELECT
      (SELECT COUNT(*) FROM products) AS total_products,
      (SELECT COUNT(*) FROM product_params) AS product_params,
      (SELECT COUNT(DISTINCT product_id) FROM product_params WHERE param_key = 'watts') AS watts_covered
  `;
  return {
    totalProducts: Number(row?.total_products ?? 0),
    productParams: Number(row?.product_params ?? 0),
    wattsCovered: Number(row?.watts_covered ?? 0),
  };
}

function buildReport(summary: Summary): string {
  const bySource = countBySource(summary.plannedParams);
  return `# V26.2 Product Name 嵌入式 Watts 提取报告

模式: ${summary.mode}

## 备份
路径: ${summary.backupPath ?? "dry-run 未创建备份"}

## 统计
- 目标产品数（缺 watts）: ${formatInteger(summary.targetProducts.length)}
- 提取成功: ${formatInteger(summary.plannedParams.length)} (${formatPercent(summary.plannedParams.length, summary.targetProducts.length)})
- 来自 product_name: ${formatInteger(bySource.product_name ?? 0)}
- 来自 model_no: ${formatInteger(bySource.model_no ?? 0)}
- 来自 remark: ${formatInteger(bySource.remark ?? 0)}
- 跳过（品类范围外）: ${formatInteger(summary.rejectedRange.length)}
- 跳过（ambiguous 多值）: ${formatInteger(summary.ambiguousCount)}
- 无匹配: ${formatInteger(summary.noMatchCount)}
- 写入成功: ${formatInteger(summary.inserted)}

## 按品类

| 品类 | 目标数 | 提取成功 | 提取率 | watts 均值 | watts 范围 |
|------|--------|---------|--------|-----------|-----------|
${buildCategoryRows(summary.targetProducts, summary.plannedParams).join("\n")}

## 被品类校验拦截的样本（前 20 条）

| 品类 | product_name | model_no | 提取值 | 合理区间 | 判定 |
|------|-------------|---------|--------|---------|------|
${summary.rejectedRange
  .slice(0, 20)
  .map((row) => `| ${md(row.category)} | ${md(row.productName)} | ${md(row.modelNo ?? "-")} | ${md(row.watts)} | ${row.range[0]}-${row.range[1]}W | ${md(row.reason)} |`)
  .join("\n")}

## 写入样本（前 30 条）

| 品类 | product_name | model_no | 源字段 | 提取模式 | watts |
|------|-------------|---------|--------|---------|-------|
${summary.plannedParams
  .slice(0, 30)
  .map((param) => `| ${md(param.category)} | ${md(param.productName)} | ${md(param.modelNo ?? "-")} | ${param.sourceField} | ${param.pattern} | ${md(param.normalizedValue)} |`)
  .join("\n")}

## product_params / watts 覆盖率变化
- product_params: ${formatInteger(summary.before.productParams)} → ${formatInteger(summary.after.productParams)}
- watts: ${formatInteger(summary.before.wattsCovered)}/${formatInteger(summary.before.totalProducts)} (${formatPercent(summary.before.wattsCovered, summary.before.totalProducts)}) → ${formatInteger(summary.after.wattsCovered)}/${formatInteger(summary.after.totalProducts)} (${formatPercent(summary.after.wattsCovered, summary.after.totalProducts)})

## 说明
- 只 INSERT 新的 product_params 行，不 UPDATE / DELETE。
- source_field = ${SOURCE_FIELD}
- confidence = medium
- 太阳能壁灯不从 remark 提取，避免把太阳能板功率误写成灯具功率。
`;
}

function buildCategoryRows(products: ProductRow[], plannedParams: PlannedParam[]): string[] {
  const targetCounts = new Map<string, number>();
  for (const product of products) {
    const category = cleanCategory(product.category);
    targetCounts.set(category, (targetCounts.get(category) ?? 0) + 1);
  }
  const rows = new Map<string, { values: number[] }>();
  for (const param of plannedParams) {
    const row = rows.get(param.category) ?? { values: [] };
    row.values.push(param.watts);
    rows.set(param.category, row);
  }
  return [...targetCounts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([category, target]) => {
      const values = rows.get(category)?.values ?? [];
      const avg = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
      const range = values.length ? `${formatWatts(Math.min(...values))}-${formatWatts(Math.max(...values))}` : "-";
      return `| ${md(category)} | ${formatInteger(target)} | ${formatInteger(values.length)} | ${formatPercent(values.length, target)} | ${values.length ? formatWatts(avg) : "-"} | ${md(range)} |`;
    });
}

function countBySource(plannedParams: PlannedParam[]): Partial<Record<SourceField, number>> {
  const counts: Partial<Record<SourceField, number>> = {};
  for (const param of plannedParams) counts[param.sourceField] = (counts[param.sourceField] ?? 0) + 1;
  return counts;
}

function cleanCategory(value: string | null): string {
  const trimmed = value?.trim();
  return trimmed || "(未分类)";
}

function projectCoverage(before: Coverage, plannedCount: number): Coverage {
  return { totalProducts: before.totalProducts, productParams: before.productParams, wattsCovered: before.wattsCovered + plannedCount };
}

function formatWatts(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)));
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
