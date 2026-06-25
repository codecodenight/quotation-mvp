import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

type PrismaClientInstance = import("@prisma/client").PrismaClient;

type ParamKey = "watts" | "cct" | "voltage" | "ip" | "cri" | "beam_angle" | "base" | "material";
type Mode = "dry-run" | "apply";
type DbCount = bigint | number | null;

type Extraction = {
  rawValue: string;
  normalizedValue: string;
  unit: string | null;
};

type CoverageCombo = {
  category: string;
  paramKey: ParamKey;
  totalProducts: number;
  beforeCovered: number;
};

type MissingProductRow = {
  product_id: string;
  product_name: string;
  category: string | null;
  remark: string | null;
};

type PlannedParam = {
  id: string;
  productId: string;
  category: string;
  paramKey: ParamKey;
  rawValue: string;
  normalizedValue: string;
  unit: string | null;
  sourceField: string;
  confidence: "medium";
};

type ComboStats = CoverageCombo & {
  checkedProducts: number;
  plannedBackfill: number;
  afterCovered: number;
  unableToExtract: number;
};

type RunSummary = {
  mode: Mode;
  backupPath: string;
  checkedProducts: number;
  plannedBackfill: number;
  insertedParams: number;
  unableToExtract: number;
  productParamsBefore: number;
  productParamsAfter: number;
  comboStats: ComboStats[];
};

const TARGET_PARAM_KEYS: ParamKey[] = ["watts", "cct", "voltage", "ip", "cri", "beam_angle", "base", "material"];
const REPORT_PATH = path.join("docs", "v22.1-param-backfill-report.md");
const DB_PATH = path.join("prisma", "dev.db");
const BACKUP_DIR = "backups";
const INSERT_BATCH_SIZE = 500;
const SOURCE_FIELD = "v22.1_product_name_remark_backfill";

export function extractParamFromText(paramKey: ParamKey, text: string): Extraction | null {
  switch (paramKey) {
    case "watts":
      return extractWithPatterns(text, [{ regex: /(\d+(?:\.\d+)?)\s*[Ww]\b/, unit: "W" }]);
    case "cct":
      return extractWithPatterns(text, [
        { regex: /(\d{4})\s*[Kk]/, unit: "K" },
        { regex: /\b(2700|3000|4000|5000|6000|6500)\b/, unit: "K" },
      ]);
    case "voltage":
      return extractWithPatterns(text, [
        { regex: /AC\s*(\d{2,3}(?:-\d{2,3})?)\s*[Vv]/i, unit: "V" },
        { regex: /(\d{2,3}(?:-\d{2,3})?)\s*[Vv]\b/, unit: "V" },
      ]);
    case "ip":
      return extractWithPatterns(text, [{ regex: /IP\s*(\d{2})/i, unit: null }]);
    case "cri":
      return extractWithPatterns(text, [
        { regex: /Ra\s*(\d{2,3})/i, unit: null },
        { regex: /CRI\s*(\d{2,3})/i, unit: null },
      ]);
    case "beam_angle":
      return extractWithPatterns(text, [
        { regex: /(\d+)\s*°/, unit: "°" },
        { regex: /(\d+)\s*degree/i, unit: "°" },
      ]);
    case "base": {
      const match = /(E27|E14|E26|B22|GU10|GU5\.3|MR16|G9|G4)/i.exec(text);
      if (!match) return null;
      return { rawValue: match[0], normalizedValue: match[1].toUpperCase(), unit: null };
    }
    case "material": {
      const match = /(aluminum|aluminium|plastic|iron|glass|acrylic|\bPC\b|\bABS\b|steel|stainless)/i.exec(text);
      if (!match) return null;
      const rawValue = match[0];
      const normalizedValue = rawValue.toUpperCase() === "PC" || rawValue.toUpperCase() === "ABS" ? rawValue.toUpperCase() : rawValue.toLowerCase();
      return { rawValue, normalizedValue, unit: null };
    }
  }
}

async function main() {
  const mode = process.argv.includes("--apply") ? "apply" : "dry-run";
  const backupPath = await backupDatabase();

  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = "file:./dev.db";
  }
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();

  try {
    const summary = await runBackfill(prisma, mode, backupPath);
    await mkdir(path.dirname(REPORT_PATH), { recursive: true });
    await writeFile(REPORT_PATH, buildReport(summary), "utf8");
    console.log(
      JSON.stringify(
        {
          mode,
          backupPath,
          reportPath: REPORT_PATH,
          checkedProducts: summary.checkedProducts,
          plannedBackfill: summary.plannedBackfill,
          insertedParams: summary.insertedParams,
          unableToExtract: summary.unableToExtract,
          productParamsBefore: summary.productParamsBefore,
          productParamsAfter: summary.productParamsAfter,
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

async function runBackfill(prisma: PrismaClientInstance, mode: Mode, backupPath: string): Promise<RunSummary> {
  const productParamsBefore = await prisma.productParam.count();
  const coverageCombos = await loadLowCoverageCombos(prisma);
  const plannedParams: PlannedParam[] = [];
  const comboStats: ComboStats[] = [];
  let checkedProducts = 0;
  let unableToExtract = 0;
  const plannedKeys = new Set<string>();

  for (const combo of coverageCombos) {
    const missingProducts = await loadMissingProducts(prisma, combo.category, combo.paramKey);
    let plannedBackfill = 0;
    let comboUnableToExtract = 0;
    checkedProducts += missingProducts.length;

    for (const product of missingProducts) {
      const dedupeKey = productParamKey(product.product_id, combo.paramKey);
      if (plannedKeys.has(dedupeKey)) continue;

      const text = [product.product_name, product.remark].filter(Boolean).join(" ");
      const extracted = extractParamFromText(combo.paramKey, text);
      if (!extracted) {
        comboUnableToExtract += 1;
        continue;
      }

      plannedParams.push({
        id: randomUUID(),
        productId: product.product_id,
        category: combo.category,
        paramKey: combo.paramKey,
        rawValue: extracted.rawValue,
        normalizedValue: extracted.normalizedValue,
        unit: extracted.unit,
        sourceField: SOURCE_FIELD,
        confidence: "medium",
      });
      plannedKeys.add(dedupeKey);
      plannedBackfill += 1;
    }

    unableToExtract += comboUnableToExtract;
    comboStats.push({
      ...combo,
      checkedProducts: missingProducts.length,
      plannedBackfill,
      afterCovered: combo.beforeCovered + plannedBackfill,
      unableToExtract: comboUnableToExtract,
    });
  }

  const insertedParams = mode === "apply" ? await insertParams(prisma, plannedParams) : 0;
  const productParamsAfter = await prisma.productParam.count();

  if (mode === "apply") {
    const afterCoverage = await loadCoverageForCombos(prisma, comboStats);
    for (const combo of comboStats) {
      combo.afterCovered = afterCoverage.get(comboKey(combo.category, combo.paramKey)) ?? combo.afterCovered;
    }
  }

  return {
    mode,
    backupPath,
    checkedProducts,
    plannedBackfill: plannedParams.length,
    insertedParams,
    unableToExtract,
    productParamsBefore,
    productParamsAfter,
    comboStats,
  };
}

async function backupDatabase(): Promise<string> {
  if (!existsSync(DB_PATH)) {
    throw new Error(`Database not found: ${DB_PATH}`);
  }
  await mkdir(BACKUP_DIR, { recursive: true });
  const backupPath = path.join(BACKUP_DIR, `dev-before-v22.1-${timestampForFile()}.sqlite`);
  const tempPath = `${backupPath}.tmp`;
  await rm(tempPath, { force: true });
  await copyFile(DB_PATH, tempPath);
  await rename(tempPath, backupPath);
  return backupPath;
}

async function loadLowCoverageCombos(prisma: PrismaClientInstance): Promise<CoverageCombo[]> {
  const valuesSql = TARGET_PARAM_KEYS.map((paramKey, index) => `('${paramKey}', ${index + 1})`).join(", ");
  const rows = await prisma.$queryRawUnsafe<
    Array<{
      category: string;
      param_key: ParamKey;
      total_products: DbCount;
      covered_products: DbCount;
      priority: DbCount;
    }>
  >(
    `
      WITH target_params(param_key, priority) AS (VALUES ${valuesSql}),
      categories AS (
        SELECT
          COALESCE(NULLIF(TRIM(category), ''), '未分类') AS category,
          COUNT(*) AS total_products
        FROM products
        GROUP BY COALESCE(NULLIF(TRIM(category), ''), '未分类')
      ),
      param_counts AS (
        SELECT
          COALESCE(NULLIF(TRIM(p.category), ''), '未分类') AS category,
          pp.param_key,
          COUNT(DISTINCT p.id) AS covered_products
        FROM products p
        JOIN product_params pp
          ON pp.product_id = p.id
        WHERE pp.param_key IN (${TARGET_PARAM_KEYS.map((paramKey) => `'${paramKey}'`).join(", ")})
        GROUP BY COALESCE(NULLIF(TRIM(p.category), ''), '未分类'), pp.param_key
      )
      SELECT
        c.category,
        tp.param_key,
        c.total_products,
        COALESCE(pc.covered_products, 0) AS covered_products,
        tp.priority
      FROM categories c
      CROSS JOIN target_params tp
      LEFT JOIN param_counts pc
        ON pc.category = c.category
        AND pc.param_key = tp.param_key
      WHERE CAST(COALESCE(pc.covered_products, 0) AS REAL) / c.total_products < 0.8
      ORDER BY tp.priority ASC, c.total_products DESC, c.category ASC
    `,
  );

  return rows.map((row) => ({
    category: row.category,
    paramKey: row.param_key,
    totalProducts: toNumber(row.total_products),
    beforeCovered: toNumber(row.covered_products),
  }));
}

async function loadMissingProducts(prisma: PrismaClientInstance, category: string, paramKey: ParamKey): Promise<MissingProductRow[]> {
  return prisma.$queryRawUnsafe<MissingProductRow[]>(
    `
      SELECT
        p.id AS product_id,
        p.product_name,
        p.category,
        p.remark
      FROM products p
      WHERE COALESCE(NULLIF(TRIM(p.category), ''), '未分类') = ?
        AND NOT EXISTS (
          SELECT 1
          FROM product_params pp
          WHERE pp.product_id = p.id
            AND pp.param_key = ?
        )
      ORDER BY p.product_name ASC, p.id ASC
    `,
    category,
    paramKey,
  );
}

async function loadCoverageForCombos(prisma: PrismaClientInstance, combos: ComboStats[]): Promise<Map<string, number>> {
  const coverage = new Map<string, number>();
  for (const combo of combos) {
    const rows = await prisma.$queryRawUnsafe<Array<{ covered_products: DbCount }>>(
      `
        SELECT COUNT(DISTINCT pp.product_id) AS covered_products
        FROM products p
        JOIN product_params pp ON pp.product_id = p.id
        WHERE COALESCE(NULLIF(TRIM(p.category), ''), '未分类') = ?
          AND pp.param_key = ?
      `,
      combo.category,
      combo.paramKey,
    );
    coverage.set(comboKey(combo.category, combo.paramKey), toNumber(rows[0]?.covered_products));
  }
  return coverage;
}

async function insertParams(prisma: PrismaClientInstance, plannedParams: PlannedParam[]): Promise<number> {
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

function extractWithPatterns(text: string, patterns: Array<{ regex: RegExp; unit: string | null }>): Extraction | null {
  for (const pattern of patterns) {
    const match = pattern.regex.exec(text);
    if (!match) continue;
    return {
      rawValue: match[0],
      normalizedValue: match[1],
      unit: pattern.unit,
    };
  }
  return null;
}

function buildReport(summary: RunSummary): string {
  const tableRows = summary.comboStats
    .map((row) => {
      const before = `${formatInteger(row.beforeCovered)}/${formatInteger(row.totalProducts)}`;
      const after = `${formatInteger(row.afterCovered)}/${formatInteger(row.totalProducts)}`;
      return `| ${escapeMd(row.category)} | ${row.paramKey} | ${before} | +${formatInteger(row.plannedBackfill)} | ${after} | ${formatPercent(row.beforeCovered, row.totalProducts)}→${formatPercent(row.afterCovered, row.totalProducts)} |`;
    })
    .join("\n");

  return `# V22.1 参数回填报告

模式: ${summary.mode}
时间: ${new Date().toISOString()}

## 备份
路径: ${summary.backupPath}

## 回填统计

| 品类 | param_key | 之前覆盖 | 回填数 | 之后覆盖 | 覆盖率变化 |
|------|-----------|----------|--------|----------|------------|
${tableRows}

## 总计
- 检查产品参数缺口: ${formatInteger(summary.checkedProducts)}
- 回填成功: ${formatInteger(summary.mode === "apply" ? summary.insertedParams : summary.plannedBackfill)} 条 product_params
- 无法提取: ${formatInteger(summary.unableToExtract)} 个产品参数缺口（产品名/备注中没有匹配模式）

## 回填后数据
- product_params 总数: ${formatInteger(summary.productParamsBefore)} → ${formatInteger(summary.productParamsAfter)}

## 说明
- 只对覆盖率 < 80% 的 品类×param_key 组合执行。
- 只插入缺失的 product_id + param_key 组合，不 UPDATE 或 DELETE 既有数据。
- 提取文本来源为 products.product_name + products.remark。
- 当前 product_params 表没有 display_order 字段；本次按现有 schema 写入 source_field=${SOURCE_FIELD}, confidence=medium。

## tsc / vitest
- tsc 不需要（纯数据操作）
- vitest 不需要（纯数据操作）
`;
}

function timestampForFile(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function productParamKey(productId: string, paramKey: ParamKey): string {
  return `${productId}\u0000${paramKey}`;
}

function comboKey(category: string, paramKey: ParamKey): string {
  return `${category}\u0000${paramKey}`;
}

function toNumber(value: DbCount | undefined): number {
  if (typeof value === "bigint") return Number(value);
  return value ?? 0;
}

function formatPercent(numerator: number, denominator: number): string {
  if (denominator === 0) return "0%";
  return `${Math.round((numerator / denominator) * 100)}%`;
}

function formatInteger(value: number): string {
  return value.toLocaleString("en-US");
}

function escapeMd(value: string): string {
  return value.replaceAll("|", "\\|");
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
