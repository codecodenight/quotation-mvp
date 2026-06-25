import "dotenv/config";

import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { Prisma, PrismaClient } from "@prisma/client";

import { backupDatabase, chunks, formatInteger, formatPercent, INSERT_BATCH_SIZE, md } from "./v25-watts-shared";
import { analyzeSourceFile, cellToString, findExactMatchRow, loadSourceProducts, type SourceFileProducts } from "./v27.0-full-param-audit";

const REPORT_PATH = path.join("docs", "v28.2-cleanup-and-warranty-report.md");
const SOURCE_FIELD = "v28.2_excel_extraction";

const PART_A_CLEANUP_BACKUP_PATH = "backups/dev-before-v28.2-cleanup-20260623-154148.sqlite";
const PART_A_MATERIAL_DELETED = 19;
const PART_A_SIZE_DELETED = 33;

type Mode = "dry-run" | "apply";
type ParamKey = "warranty" | "dimmable";

type PlannedParam = {
  id: string;
  productId: string;
  productName: string;
  modelNo: string | null;
  category: string;
  paramKey: ParamKey;
  rawValue: string;
  normalizedValue: string;
  fileName: string;
  sheetName: string;
  header: string;
  rowNumber: number;
};

type Coverage = {
  sourceProducts: number;
  productParams: number;
  byParam: Map<ParamKey, number>;
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
  byParam: Map<ParamKey, number>;
};

type Summary = {
  mode: Mode;
  partBBackupPath: string | null;
  filesScanned: number;
  before: Coverage;
  after: Coverage;
  plannedParams: PlannedParam[];
  inserted: number;
  validationStats: Map<ParamKey, ValidationStat>;
  fileStats: Map<string, FileStat>;
};

const TARGET_PARAM_KEYS: ParamKey[] = ["warranty", "dimmable"];

const PARAM_VALIDATORS: Record<ParamKey, (raw: string) => string | null> = {
  warranty: (raw) => {
    const match = raw.match(/(\d+)\s*(?:years?|年)?/i);
    if (!match) return null;
    const value = parseInt(match[1], 10);
    if (value >= 1 && value <= 10) return String(value);
    return null;
  },
  dimmable: (raw) => {
    const value = raw.trim().toLowerCase();
    if (/^(?:yes|y|√|是|可调光?|dimmable)$/i.test(value)) return "yes";
    if (/^(?:no|n|×|否|不可调光?|non-dim)$/i.test(value)) return "no";
    if (/triac|0-10v|dali|pwm/i.test(value)) return value;
    if (value.length >= 1 && value.length <= 30) return value;
    return null;
  },
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
          partACleanupBackupPath: PART_A_CLEANUP_BACKUP_PATH,
          partBBackupPath: summary.partBBackupPath,
          filesScanned: summary.filesScanned,
          planned: summary.plannedParams.length,
          inserted: summary.inserted,
          warrantyAdded: summary.plannedParams.filter((param) => param.paramKey === "warranty").length,
          dimmableAdded: summary.plannedParams.filter((param) => param.paramKey === "dimmable").length,
          productParamsBefore: summary.before.productParams,
          productParamsAfter: summary.after.productParams,
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
  console.log("V28.2 load source products");
  const { products, files } = await loadSourceProducts(prisma);
  const before = await loadCoverage(prisma, products.length);
  const plannedByProductParam = new Set<string>();
  const plannedParams: PlannedParam[] = [];
  const validationStats = new Map<ParamKey, ValidationStat>();
  const fileStats = new Map<string, FileStat>();

  for (const [index, file] of files.entries()) {
    if (index === 0 || (index + 1) % 25 === 0 || index + 1 === files.length) {
      console.log(`V28.2 warranty/dimmable extraction ${index + 1}/${files.length}: ${file.fileName}`);
    }
    scanFile(file, plannedByProductParam, plannedParams, validationStats, fileStats);
  }

  const partBBackupPath = mode === "apply" ? await backupDatabase("v28.2") : null;
  const inserted = mode === "apply" ? await insertParams(prisma, plannedParams) : 0;
  const after = mode === "apply" ? await loadCoverage(prisma, products.length) : projectCoverage(before, plannedParams);
  return { mode, partBBackupPath, filesScanned: files.length, before, after, plannedParams, inserted, validationStats, fileStats };
}

function scanFile(
  file: SourceFileProducts,
  plannedByProductParam: Set<string>,
  plannedParams: PlannedParam[],
  validationStats: Map<ParamKey, ValidationStat>,
  fileStats: Map<string, FileStat>,
) {
  const analysis = analyzeSourceFile(file);
  if (!analysis.readable) return;
  const fileStat = getFileStat(fileStats, file.fileName);
  for (const product of file.products) fileStat.involvedProducts.add(product.productId);

  for (const sheet of analysis.sheets) {
    const columns = sheet.paramColumns.filter((column): column is typeof column & { paramKey: ParamKey } =>
      TARGET_PARAM_KEYS.includes(column.paramKey as ParamKey),
    );
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
        const normalized = PARAM_VALIDATORS[column.paramKey](raw);
        if (!normalized) {
          stat.rejected += 1;
          if (stat.rejectedSamples.length < 5) stat.rejectedSamples.push(`${raw} (${file.fileName} / ${sheet.sheetName})`);
          continue;
        }
        stat.passed += 1;
        plannedByProductParam.add(plannedKey);
        plannedParams.push({
          id: randomUUID(),
          productId: product.productId,
          productName: product.productName,
          modelNo: product.modelNo,
          category: product.category,
          paramKey: column.paramKey,
          rawValue: raw,
          normalizedValue: normalized,
          fileName: file.fileName,
          sheetName: sheet.sheetName,
          header: column.header,
          rowNumber: match.rowIndex + 1,
        });
        fileStat.plannedCount += 1;
        fileStat.byParam.set(column.paramKey, (fileStat.byParam.get(column.paramKey) ?? 0) + 1);
      }
    }
  }
}

async function loadCoverage(prisma: PrismaClient, sourceProducts: number): Promise<Coverage> {
  const rows = await prisma.$queryRaw<Array<{ param_key: ParamKey; covered: number | bigint }>>`
    SELECT pp.param_key, COUNT(DISTINCT pp.product_id) AS covered
    FROM product_params pp
    JOIN supplier_offers so
      ON so.product_id = pp.product_id
     AND so.source_file_id IS NOT NULL
    WHERE pp.param_key IN (${Prisma.join(TARGET_PARAM_KEYS)})
    GROUP BY pp.param_key
  `;
  const byParam = new Map<ParamKey, number>(TARGET_PARAM_KEYS.map((paramKey) => [paramKey, 0]));
  for (const row of rows) byParam.set(row.param_key, Number(row.covered));
  const productParams = await prisma.productParam.count();
  return { sourceProducts, productParams, byParam };
}

function projectCoverage(before: Coverage, plannedParams: PlannedParam[]): Coverage {
  const byParam = new Map(before.byParam);
  for (const param of plannedParams) byParam.set(param.paramKey, (byParam.get(param.paramKey) ?? 0) + 1);
  return { sourceProducts: before.sourceProducts, productParams: before.productParams + plannedParams.length, byParam };
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
        unit: null,
        sourceField: SOURCE_FIELD,
        confidence: "high",
      })),
    });
    inserted += result.count;
  }
  return inserted;
}

function getValidationStat(map: Map<ParamKey, ValidationStat>, paramKey: ParamKey): ValidationStat {
  const stat = map.get(paramKey) ?? { attempts: 0, passed: 0, rejected: 0, rejectedSamples: [] };
  map.set(paramKey, stat);
  return stat;
}

function getFileStat(map: Map<string, FileStat>, fileName: string): FileStat {
  const stat = map.get(fileName) ?? { fileName, involvedProducts: new Set<string>(), matchedProducts: new Set<string>(), plannedCount: 0, byParam: new Map<ParamKey, number>() };
  map.set(fileName, stat);
  return stat;
}

function buildReport(summary: Summary): string {
  const warrantyPlanned = summary.plannedParams.filter((param) => param.paramKey === "warranty");
  const dimmablePlanned = summary.plannedParams.filter((param) => param.paramKey === "dimmable");
  return `# V28.2 清理 + warranty/dimmable 提取报告

模式: ${summary.mode}

## Part A: 清理
- cleanup 备份: ${PART_A_CLEANUP_BACKUP_PATH}
- material 删除数: ${formatInteger(PART_A_MATERIAL_DELETED)}（预期 19）
- size_display 删除数: ${formatInteger(PART_A_SIZE_DELETED)}（预期 33）

## Part B: warranty + dimmable 提取
- Part B 备份: ${summary.partBBackupPath ?? "dry-run 未创建备份"}
- 扫描文件数: ${formatInteger(summary.filesScanned)}
- warranty 新增: ${formatInteger(warrantyPlanned.length)}
- dimmable 新增: ${formatInteger(dimmablePlanned.length)}
- 写入成功: ${formatInteger(summary.inserted)}

## 覆盖率变化

| param_key | 提取前覆盖 | 新增 | 提取后覆盖 |
|-----------|-----------|------|-----------|
${TARGET_PARAM_KEYS.map((paramKey) => {
  const before = summary.before.byParam.get(paramKey) ?? 0;
  const after = summary.after.byParam.get(paramKey) ?? before;
  return `| ${paramKey} | ${formatInteger(before)}/${formatInteger(summary.before.sourceProducts)} (${formatPercent(before, summary.before.sourceProducts)}) | +${formatInteger(after - before)} | ${formatInteger(after)}/${formatInteger(summary.after.sourceProducts)} (${formatPercent(after, summary.after.sourceProducts)}) |`;
}).join("\n")}

## 按文件 top 20

| 文件名 | 涉及产品数 | 匹配成功 | 新提取参数总数 | 按 param_key 分 |
|--------|-----------|---------|-------------|---------------|
${[...summary.fileStats.values()]
  .filter((stat) => stat.plannedCount > 0)
  .sort((left, right) => right.plannedCount - left.plannedCount || left.fileName.localeCompare(right.fileName))
  .slice(0, 20)
  .map((stat) => `| ${md(stat.fileName)} | ${formatInteger(stat.involvedProducts.size)} | ${formatInteger(stat.matchedProducts.size)} | ${formatInteger(stat.plannedCount)} | ${md(formatParamCounts(stat.byParam))} |`)
  .join("\n")}

## 值验证统计

| param_key | 总尝试 | 验证通过 | 验证拦截 | 拦截率 | 拦截样本 |
|-----------|--------|---------|---------|--------|----------|
${TARGET_PARAM_KEYS.map((paramKey) => {
  const stat = summary.validationStats.get(paramKey) ?? { attempts: 0, passed: 0, rejected: 0, rejectedSamples: [] };
  return `| ${paramKey} | ${formatInteger(stat.attempts)} | ${formatInteger(stat.passed)} | ${formatInteger(stat.rejected)} | ${formatPercent(stat.rejected, stat.attempts)} | ${md(stat.rejectedSamples.join(" / ") || "-")} |`;
}).join("\n")}

## warranty 写入样本（前 10）

| 品类 | product_name | model_no | raw | normalized | 文件 | sheet |
|------|-------------|---------|-----|------------|------|-------|
${warrantyPlanned.slice(0, 10).map((param) => sampleRow(param)).join("\n")}

## dimmable 写入样本

| 品类 | product_name | model_no | raw | normalized | 文件 | sheet |
|------|-------------|---------|-----|------------|------|-------|
${dimmablePlanned.slice(0, 20).map((param) => sampleRow(param)).join("\n")}

## product_params 总量变化
- product_params: ${formatInteger(summary.before.productParams)} → ${formatInteger(summary.after.productParams)}
- 净变化: ${summary.after.productParams - summary.before.productParams >= 0 ? "+" : ""}${formatInteger(summary.after.productParams - summary.before.productParams)}

## 说明
- Part A 只 DELETE 指定 V28.0 坏数据。
- Part B 只 INSERT 新 product_params，不 UPDATE / DELETE 已有参数。
- Part B 只使用 model_no 精确匹配，不使用 normalized/loose match。
- source_field = ${SOURCE_FIELD}
- confidence = high
`;
}

function sampleRow(param: PlannedParam): string {
  return `| ${md(param.category)} | ${md(param.productName)} | ${md(param.modelNo ?? "-")} | ${md(param.rawValue)} | ${md(param.normalizedValue)} | ${md(param.fileName)} | ${md(param.sheetName)} |`;
}

function formatParamCounts(counts: Map<ParamKey, number>): string {
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([key, value]) => `${key}: ${value}`)
    .join(", ");
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
