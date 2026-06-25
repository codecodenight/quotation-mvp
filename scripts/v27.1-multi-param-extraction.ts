import "dotenv/config";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { Prisma, PrismaClient } from "@prisma/client";

import { backupDatabase, chunks, formatInteger, formatPercent, INSERT_BATCH_SIZE, md } from "./v25-watts-shared";
import {
  analyzeSourceFile,
  cellToString,
  findExactMatchRow,
  loadSourceProducts,
  unitForParam,
  V27_0_REPORT_PATH,
  type SourceFileProducts,
  type SourceProduct,
} from "./v27.0-full-param-audit";

const REPORT_PATH = path.join("docs", "v27.1-multi-param-extraction-report.md");
const SOURCE_FIELD = "v27.1_multi_param";

type Mode = "dry-run" | "apply";

type Validator = (raw: string, category: string) => string | null;

const PARAM_VALIDATORS: Record<string, Validator> = {
  pf: (raw) => {
    const gt = raw.match(/[>≥]\s*([\d.]+)/);
    if (gt) return `>${gt[1]}`;
    const m = raw.match(/([\d.]+)/);
    if (!m) return null;
    const v = parseFloat(m[1]);
    if (v >= 0.3 && v <= 1.0) return m[1];
    return null;
  },

  ip: (raw) => {
    const m = raw.match(/IP\s*(\d{2})/i);
    if (m) return `IP${m[1]}`;
    const n = raw.match(/^(\d{2})$/);
    if (n && ["20", "44", "54", "55", "65", "66", "67", "68"].includes(n[1])) return `IP${n[1]}`;
    return null;
  },

  material: (raw) => {
    const s = raw.trim();
    if (s.length < 2) return null;
    if (/^\d+(\.\d+)?$/.test(s)) return null;
    return s;
  },

  beam_angle: (raw) => {
    const m = raw.match(/(\d+(?:\.\d+)?)\s*[°度]?/);
    if (!m) return null;
    const v = parseFloat(m[1]);
    if (v >= 1 && v <= 360) return m[1];
    return null;
  },

  lumens: (raw) => {
    if (/lm\s*\/?\s*w/i.test(raw)) return null;
    const m = raw.match(/([\d,]+(?:\.\d+)?)\s*(?:lm)?/i);
    if (!m) return null;
    const v = parseFloat(m[1].replace(/,/g, ""));
    if (v > 0 && v < 100000) return String(v);
    return null;
  },

  luminous_efficacy: (raw) => {
    const m = raw.match(/([\d.]+)\s*(?:lm\s*\/?\s*w)?/i);
    if (!m) return null;
    const v = parseFloat(m[1]);
    if (v >= 10 && v <= 300) return m[1];
    return null;
  },

  driver_type: (raw) => {
    const s = raw.trim();
    if (s.length < 2) return null;
    if (/^\d+(\.\d+)?$/.test(s)) return null;
    return s;
  },

  cri: (raw) => {
    const gt = raw.match(/[>≥]\s*(\d+)/);
    if (gt) return `>${gt[1]}`;
    const m = raw.match(/(\d+)/);
    if (!m) return null;
    const v = parseInt(m[1], 10);
    if (v >= 60 && v <= 100) return m[1];
    return null;
  },

  cct: (raw) => {
    const s = raw.trim();
    if (s.length < 2) return null;
    return s;
  },

  voltage: (raw) => {
    const s = raw.trim();
    if (s.length < 2) return null;
    return s;
  },

  size_display: (raw) => {
    const s = raw.trim();
    if (s.length < 3) return null;
    return s;
  },

  certification: (raw) => {
    const s = raw.trim();
    if (s.length < 2) return null;
    return s;
  },

  led_type: (raw) => {
    const s = raw.trim();
    if (s.length < 2) return null;
    if (/^\d+(\.\d+)?$/.test(s)) return null;
    return s;
  },

  base: (raw) => {
    const s = raw.trim();
    if (s.length < 2) return null;
    return s;
  },

  led_count: (raw) => {
    const m = raw.match(/(\d+)/);
    if (!m) return null;
    const v = parseInt(m[1], 10);
    if (v > 0 && v < 10000) return m[1];
    return null;
  },
};

const TARGET_PARAM_KEYS = Object.keys(PARAM_VALIDATORS);

type PlannedParam = {
  id: string;
  productId: string;
  productName: string;
  modelNo: string | null;
  category: string;
  paramKey: string;
  rawValue: string;
  normalizedValue: string;
  unit: string | null;
  fileName: string;
  sheetName: string;
  header: string;
  rowNumber: number;
};

type Coverage = {
  sourceProducts: number;
  byParam: Map<string, number>;
  productParams: number;
};

type ValidationStat = {
  attempts: number;
  passed: number;
  rejected: number;
  rejectedSamples: string[];
};

type FileStat = {
  fileName: string;
  involvedProducts: Set<string>;
  matchedProducts: Set<string>;
  plannedCount: number;
  byParam: Map<string, number>;
};

type Summary = {
  mode: Mode;
  backupPath: string | null;
  before: Coverage;
  after: Coverage;
  plannedParams: PlannedParam[];
  inserted: number;
  categoryMatrix: Map<string, Map<string, number>>;
  fileStats: Map<string, FileStat>;
  validationStats: Map<string, ValidationStat>;
  skippedNoValidator: Map<string, number>;
  auditReportBytes: number;
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
          auditReportBytes: summary.auditReportBytes,
          planned: summary.plannedParams.length,
          inserted: summary.inserted,
          productParamsBefore: summary.before.productParams,
          productParamsAfter: summary.after.productParams,
          byParam: Object.fromEntries(countPlannedByParam(summary.plannedParams)),
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
  const auditReport = await readFile(V27_0_REPORT_PATH, "utf8");
  if (!auditReport.includes("# V27.0 全参数源文件列审计报告")) {
    throw new Error(`V27.0 report exists but does not look valid: ${V27_0_REPORT_PATH}`);
  }

  console.log("V27.1 load source products");
  const { products, files } = await loadSourceProducts(prisma);
  const before = await loadCoverage(prisma, products);
  const plannedByProductParam = new Set<string>();
  const plannedParams: PlannedParam[] = [];
  const categoryMatrix = new Map<string, Map<string, number>>();
  const fileStats = new Map<string, FileStat>();
  const validationStats = new Map<string, ValidationStat>();
  const skippedNoValidator = new Map<string, number>();

  for (const [index, file] of files.entries()) {
    if (index === 0 || (index + 1) % 25 === 0 || index + 1 === files.length) {
      console.log(`V27.1 multi-param extraction ${index + 1}/${files.length}: ${file.fileName}`);
    }
    scanFile(file, plannedByProductParam, plannedParams, categoryMatrix, fileStats, validationStats, skippedNoValidator);
  }

  const backupPath = mode === "apply" ? await backupDatabase("v27.1") : null;
  const inserted = mode === "apply" ? await insertParams(prisma, plannedParams) : 0;
  const after = mode === "apply" ? await loadCoverage(prisma, products) : projectCoverage(before, plannedParams);
  return { mode, backupPath, before, after, plannedParams, inserted, categoryMatrix, fileStats, validationStats, skippedNoValidator, auditReportBytes: auditReport.length };
}

function scanFile(
  file: SourceFileProducts,
  plannedByProductParam: Set<string>,
  plannedParams: PlannedParam[],
  categoryMatrix: Map<string, Map<string, number>>,
  fileStats: Map<string, FileStat>,
  validationStats: Map<string, ValidationStat>,
  skippedNoValidator: Map<string, number>,
) {
  const analysis = analyzeSourceFile(file);
  if (!analysis.readable) return;
  const fileStat = getFileStat(fileStats, file.fileName);
  for (const product of file.products) fileStat.involvedProducts.add(product.productId);

  for (const sheet of analysis.sheets) {
    const columns = sheet.paramColumns.filter((column) => {
      if (column.paramKey === "watts") return false;
      if (PARAM_VALIDATORS[column.paramKey]) return true;
      skippedNoValidator.set(column.paramKey, (skippedNoValidator.get(column.paramKey) ?? 0) + 1);
      return false;
    });
    if (columns.length === 0) continue;

    for (const product of file.products) {
      const match = findExactMatchRow(product, sheet);
      if (match.status !== "matched") continue;
      fileStat.matchedProducts.add(product.productId);
      const row = sheet.rows[match.rowIndex] ?? [];

      for (const column of columns) {
        if (product.existingParams.has(column.paramKey)) continue;
        const plannedKey = `${product.productId}\u0000${column.paramKey}`;
        if (plannedByProductParam.has(plannedKey)) continue;
        const raw = cellToString(row[column.index]);
        if (!raw) continue;
        const stat = getValidationStat(validationStats, column.paramKey);
        stat.attempts += 1;
        const normalized = PARAM_VALIDATORS[column.paramKey]?.(raw, product.category) ?? null;
        if (!normalized) {
          stat.rejected += 1;
          if (stat.rejectedSamples.length < 5) stat.rejectedSamples.push(`${raw} (${file.fileName} / ${sheet.sheetName})`);
          continue;
        }
        stat.passed += 1;
        const planned: PlannedParam = {
          id: randomUUID(),
          productId: product.productId,
          productName: product.productName,
          modelNo: product.modelNo,
          category: product.category,
          paramKey: column.paramKey,
          rawValue: raw,
          normalizedValue: normalized,
          unit: unitForParam(column.paramKey),
          fileName: file.fileName,
          sheetName: sheet.sheetName,
          header: column.header,
          rowNumber: match.rowIndex + 1,
        };
        plannedParams.push(planned);
        plannedByProductParam.add(plannedKey);
        fileStat.plannedCount += 1;
        fileStat.byParam.set(column.paramKey, (fileStat.byParam.get(column.paramKey) ?? 0) + 1);
        const categoryRow = categoryMatrix.get(product.category) ?? new Map<string, number>();
        categoryRow.set(column.paramKey, (categoryRow.get(column.paramKey) ?? 0) + 1);
        categoryMatrix.set(product.category, categoryRow);
      }
    }
  }
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

async function loadCoverage(prisma: PrismaClient, products: SourceProduct[]): Promise<Coverage> {
  const rows = await prisma.$queryRaw<Array<{ param_key: string; covered: number | bigint }>>`
    SELECT pp.param_key, COUNT(DISTINCT pp.product_id) AS covered
    FROM product_params pp
    JOIN supplier_offers so
      ON so.product_id = pp.product_id
     AND so.source_file_id IS NOT NULL
    WHERE pp.param_key IN (${Prisma.join(TARGET_PARAM_KEYS)})
    GROUP BY pp.param_key
  `;
  const productParams = await prisma.productParam.count();
  const byParam = new Map<string, number>();
  for (const paramKey of TARGET_PARAM_KEYS) byParam.set(paramKey, 0);
  for (const row of rows) byParam.set(row.param_key, Number(row.covered));
  return { sourceProducts: products.length, byParam, productParams };
}

function projectCoverage(before: Coverage, plannedParams: PlannedParam[]): Coverage {
  const byParam = new Map(before.byParam);
  for (const [paramKey, count] of countPlannedByParam(plannedParams)) byParam.set(paramKey, (byParam.get(paramKey) ?? 0) + count);
  return { sourceProducts: before.sourceProducts, byParam, productParams: before.productParams + plannedParams.length };
}

function countPlannedByParam(plannedParams: PlannedParam[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const param of plannedParams) counts.set(param.paramKey, (counts.get(param.paramKey) ?? 0) + 1);
  return new Map([...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])));
}

function getValidationStat(map: Map<string, ValidationStat>, paramKey: string): ValidationStat {
  const value = map.get(paramKey) ?? { attempts: 0, passed: 0, rejected: 0, rejectedSamples: [] };
  map.set(paramKey, value);
  return value;
}

function getFileStat(map: Map<string, FileStat>, fileName: string): FileStat {
  const value = map.get(fileName) ?? { fileName, involvedProducts: new Set<string>(), matchedProducts: new Set<string>(), plannedCount: 0, byParam: new Map<string, number>() };
  map.set(fileName, value);
  return value;
}

function buildReport(summary: Summary): string {
  return `# V27.1 全参数批量提取报告

模式: ${summary.mode}

## 备份
路径: ${summary.backupPath ?? "dry-run 未创建备份"}

## 输入
- V27.0 报告: ${V27_0_REPORT_PATH}
- V27.0 报告大小: ${formatInteger(summary.auditReportBytes)} bytes
- source_field = ${SOURCE_FIELD}
- confidence = high
- watts: 跳过，不提取

## 统计总览

| param_key | 提取前覆盖 | 新提取 | 提取后覆盖 | 增量 |
|-----------|-----------|--------|-----------|------|
${TARGET_PARAM_KEYS.map((paramKey) => {
  const before = summary.before.byParam.get(paramKey) ?? 0;
  const after = summary.after.byParam.get(paramKey) ?? before;
  const added = after - before;
  return `| ${md(paramKey)} | ${formatInteger(before)}/${formatInteger(summary.before.sourceProducts)} (${formatPercent(before, summary.before.sourceProducts)}) | ${formatInteger(added)} | ${formatInteger(after)}/${formatInteger(summary.after.sourceProducts)} (${formatPercent(after, summary.after.sourceProducts)}) | +${formatInteger(added)} |`;
}).join("\n")}

## 按品类 × param_key 矩阵

| 品类 | ${TARGET_PARAM_KEYS.join(" | ")} |
|------|${TARGET_PARAM_KEYS.map(() => "------").join("|")}|
${buildCategoryRows(summary.categoryMatrix)}

## 按文件 top 20（新提取数最多的文件）

| 文件名 | 涉及产品数 | 匹配成功 | 新提取参数总数 | 按 param_key 分 |
|--------|-----------|---------|-------------|---------------|
${[...summary.fileStats.values()]
  .filter((stat) => stat.plannedCount > 0)
  .sort((left, right) => right.plannedCount - left.plannedCount || left.fileName.localeCompare(right.fileName))
  .slice(0, 20)
  .map((stat) => `| ${md(stat.fileName)} | ${formatInteger(stat.involvedProducts.size)} | ${formatInteger(stat.matchedProducts.size)} | ${formatInteger(stat.plannedCount)} | ${md(formatParamCounts(stat.byParam))} |`)
  .join("\n")}

## 值验证拦截统计

| param_key | 总尝试 | 验证通过 | 验证拦截 | 拦截率 | 拦截样本(前5) |
|-----------|--------|---------|---------|--------|-------------|
${TARGET_PARAM_KEYS.map((paramKey) => {
  const stat = summary.validationStats.get(paramKey) ?? { attempts: 0, passed: 0, rejected: 0, rejectedSamples: [] };
  return `| ${md(paramKey)} | ${formatInteger(stat.attempts)} | ${formatInteger(stat.passed)} | ${formatInteger(stat.rejected)} | ${formatPercent(stat.rejected, stat.attempts)} | ${md(stat.rejectedSamples.join(" / ") || "-")} |`;
}).join("\n")}

## 无验证器跳过的列

| param_key | 列出现次数 |
|-----------|-----------|
${[...summary.skippedNoValidator.entries()].sort((left, right) => right[1] - left[1]).map(([paramKey, count]) => `| ${md(paramKey)} | ${formatInteger(count)} |`).join("\n")}

## 写入样本（每个 param_key 前 5 条）

${TARGET_PARAM_KEYS.map((paramKey) => buildSampleSection(paramKey, summary.plannedParams.filter((param) => param.paramKey === paramKey).slice(0, 5))).join("\n\n")}

## product_params 覆盖率变化
- product_params: ${formatInteger(summary.before.productParams)} → ${formatInteger(summary.after.productParams)}
- 新增 product_params: +${formatInteger(summary.after.productParams - summary.before.productParams)}
- 写入成功: ${formatInteger(summary.inserted)}

## 说明
- 只 INSERT 新 product_params，不 UPDATE / DELETE。
- 只使用 model_no 精确匹配，不使用 normalized/loose match。
- 所有写入值均通过对应 PARAM_VALIDATORS。
`;
}

function buildCategoryRows(categoryMatrix: Map<string, Map<string, number>>): string {
  return [...categoryMatrix.entries()]
    .sort((left, right) => sumMap(right[1]) - sumMap(left[1]) || left[0].localeCompare(right[0]))
    .map(([category, values]) => `| ${md(category)} | ${TARGET_PARAM_KEYS.map((key) => `+${formatInteger(values.get(key) ?? 0)}`).join(" | ")} |`)
    .join("\n");
}

function buildSampleSection(paramKey: string, samples: PlannedParam[]): string {
  return `### ${paramKey}

| 品类 | product_name | model_no | raw | normalized | 文件 | sheet | 列头 |
|------|-------------|---------|-----|------------|------|-------|------|
${samples.map((param) => `| ${md(param.category)} | ${md(param.productName)} | ${md(param.modelNo ?? "-")} | ${md(param.rawValue)} | ${md(param.normalizedValue)} | ${md(param.fileName)} | ${md(param.sheetName)} | ${md(param.header)} |`).join("\n")}`;
}

function formatParamCounts(counts: Map<string, number>): string {
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([key, value]) => `${key}: ${value}`)
    .join(", ");
}

function sumMap(values: Map<string, number>): number {
  let sum = 0;
  for (const value of values.values()) sum += value;
  return sum;
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
