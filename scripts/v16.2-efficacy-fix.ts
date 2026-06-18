import { randomUUID } from "node:crypto";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { PrismaClient } from "@prisma/client";
import * as XLSX from "xlsx";

const prisma = new PrismaClient();

const APPLY_MODE = process.argv.includes("--apply");
const DB_PATH = path.join("prisma", "dev.db");
const BACKUP_PATH = path.join("prisma", "dev.db.bak-v16.2");
const REPORT_PATH = path.join("docs", "v16.2-efficacy-fix-report.md");
const HIGHBAY_FILE_PATH = path.join("data", "source-archive", "Highbay", "核价LED Highbay - Wellux - 20230506 - 副本.xls");

type DbCounts = {
  productParams: number;
  lumens: number;
  luminousEfficacy: number;
};

type MisclassifiedRow = {
  id: string;
  product_id: string;
  raw_value: string;
  normalized_value: string | null;
  source_field: string;
  confidence: string;
  category: string | null;
  product_name: string;
  model_no: string | null;
};

type ExistingEfficacyRow = {
  id: string;
  productId: string;
  rawValue: string;
  normalizedValue: string | null;
};

type PartAAction =
  | {
      kind: "reclassify";
      lumens: MisclassifiedRow;
      correctValue: string;
    }
  | {
      kind: "fix_wrong_efficacy";
      lumens: MisclassifiedRow;
      existing: ExistingEfficacyRow;
      correctValue: string;
    }
  | {
      kind: "delete_redundant_lumens";
      lumens: MisclassifiedRow;
      correctValue: string;
      existingValues: string[];
    };

type HighbayProductRow = {
  product_id: string;
  product_name: string;
  model_no: string | null;
  category: string | null;
  factory_name: string;
};

type SheetScan = {
  sheetName: string;
  headerValues: string[];
  allValues: string[];
  matchedProducts: string[];
  plannedInserts: PartBInsert[];
};

type PartBInsert = {
  productId: string;
  productName: string;
  sheetName: string;
  value: string;
  rawValue: string;
  action: "insert" | "already_exists" | "duplicate_in_plan";
};

type CoverageRow = {
  category: string;
  totalProducts: number;
  productsWithEfficacy: number;
};

type RunResult = {
  mode: "dry-run" | "apply";
  generatedAt: string;
  beforeCounts: DbCounts;
  afterCounts: DbCounts;
  partA: {
    actions: PartAAction[];
    reclassifyCount: number;
    fixWrongCount: number;
    deleteRedundantCount: number;
    affectedProductIds: Set<string>;
  };
  partB: {
    products: HighbayProductRow[];
    sheetScans: SheetScan[];
    inserts: PartBInsert[];
    insertedCount: number;
  };
  coverage: CoverageRow[];
};

async function main() {
  const beforeCounts = await loadDbCounts();
  const partAActions = await buildPartAPlan();
  const partB = await buildPartBPlan();

  let insertedCount = 0;
  if (APPLY_MODE) {
    await copyFile(DB_PATH, BACKUP_PATH);
    await applyPartA(partAActions);
    insertedCount = await applyPartB(partB.inserts);
  }

  const afterCounts = APPLY_MODE ? await loadDbCounts() : predictAfterCounts(beforeCounts, partAActions, partB.inserts);
  const affectedProductIds = new Set(partAActions.map((action) => action.lumens.product_id));
  const insertedProductIds = partB.inserts.filter((insert) => insert.action === "insert").map((insert) => insert.productId);
  const coverage = await loadEfficacyCoverage(APPLY_MODE ? [] : [...affectedProductIds, ...insertedProductIds]);

  const result: RunResult = {
    mode: APPLY_MODE ? "apply" : "dry-run",
    generatedAt: new Date().toISOString(),
    beforeCounts,
    afterCounts,
    partA: {
      actions: partAActions,
      reclassifyCount: partAActions.filter((action) => action.kind === "reclassify").length,
      fixWrongCount: partAActions.filter((action) => action.kind === "fix_wrong_efficacy").length,
      deleteRedundantCount: partAActions.filter((action) => action.kind === "delete_redundant_lumens").length,
      affectedProductIds,
    },
    partB: {
      ...partB,
      insertedCount: APPLY_MODE ? insertedCount : partB.inserts.filter((insert) => insert.action === "insert").length,
    },
    coverage,
  };

  await writeReport(result);
}

async function loadDbCounts(): Promise<DbCounts> {
  const [productParams, lumens, luminousEfficacy] = await Promise.all([
    prisma.productParam.count(),
    prisma.productParam.count({ where: { paramKey: "lumens" } }),
    prisma.productParam.count({ where: { paramKey: "luminous_efficacy" } }),
  ]);
  return { productParams, lumens, luminousEfficacy };
}

async function buildPartAPlan(): Promise<PartAAction[]> {
  const misclassified = await prisma.$queryRawUnsafe<MisclassifiedRow[]>(`
    SELECT
      pp.id,
      pp.product_id,
      pp.raw_value,
      pp.normalized_value,
      pp.source_field,
      pp.confidence,
      p.category,
      p.product_name,
      p.model_no
    FROM product_params pp
    JOIN products p ON p.id = pp.product_id
    WHERE pp.param_key = 'lumens'
      AND UPPER(pp.raw_value) LIKE '%LM/W%'
    ORDER BY p.category, p.product_name, pp.raw_value
  `);

  if (misclassified.length === 0) return [];

  const existing = await prisma.productParam.findMany({
    where: {
      productId: { in: [...new Set(misclassified.map((row) => row.product_id))] },
      paramKey: "luminous_efficacy",
    },
    select: { id: true, productId: true, rawValue: true, normalizedValue: true },
    orderBy: { createdAt: "asc" },
  });
  const existingByProduct = groupBy(existing, (row) => row.productId);

  return misclassified.map((lumens): PartAAction => {
    const correctValue = extractEfficacy(lumens.raw_value);
    const existingRows = existingByProduct.get(lumens.product_id) ?? [];
    if (existingRows.length === 0) {
      return { kind: "reclassify", lumens, correctValue };
    }

    const wrong = existingRows.find((row) => isWrongEfficacy(row.normalizedValue));
    if (wrong) {
      return { kind: "fix_wrong_efficacy", lumens, existing: wrong, correctValue };
    }

    return {
      kind: "delete_redundant_lumens",
      lumens,
      correctValue,
      existingValues: existingRows.map((row) => row.normalizedValue ?? row.rawValue),
    };
  });
}

async function applyPartA(actions: PartAAction[]) {
  for (const action of actions) {
    if (action.kind === "reclassify") {
      await prisma.productParam.update({
        where: { id: action.lumens.id },
        data: {
          paramKey: "luminous_efficacy",
          rawValue: action.lumens.raw_value,
          normalizedValue: action.correctValue,
          unit: "lm/W",
        },
      });
      continue;
    }

    if (action.kind === "fix_wrong_efficacy") {
      await prisma.productParam.update({
        where: { id: action.existing.id },
        data: {
          rawValue: action.lumens.raw_value,
          normalizedValue: action.correctValue,
          unit: "lm/W",
        },
      });
      await prisma.productParam.delete({ where: { id: action.lumens.id } });
      continue;
    }

    await prisma.productParam.delete({ where: { id: action.lumens.id } });
  }
}

async function buildPartBPlan(): Promise<{ products: HighbayProductRow[]; sheetScans: SheetScan[]; inserts: PartBInsert[] }> {
  const products = await prisma.$queryRawUnsafe<HighbayProductRow[]>(
    `
      SELECT DISTINCT
        p.id AS product_id,
        p.product_name,
        p.model_no,
        p.category,
        so.factory_name
      FROM products p
      JOIN supplier_offers so ON so.product_id = p.id
      JOIN files f ON f.id = so.source_file_id
      WHERE f.relative_path = ?
      ORDER BY p.product_name
    `,
    HIGHBAY_FILE_PATH.replaceAll(path.sep, "/"),
  );

  const existingParams = await prisma.productParam.findMany({
    where: { productId: { in: products.map((product) => product.product_id) }, paramKey: "luminous_efficacy" },
    select: { productId: true, normalizedValue: true },
  });
  const existingValues = new Set(existingParams.map((param) => efficacyInsertKey(param.productId, param.normalizedValue ?? "")));
  const plannedValues = new Set<string>();
  const inserts: PartBInsert[] = [];
  const sheetScans: SheetScan[] = [];

  const workbook = XLSX.readFile(HIGHBAY_FILE_PATH);
  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false, defval: "" }) as unknown[][];
    const headerValues = extractSheetEfficacyValues(rows.slice(0, 8));
    const allValues = extractSheetEfficacyValues(rows);
    const matchedProducts = products.filter((product) => sheetContainsProduct(rows, product)).map((product) => product.product_name);
    const valuesForSheet = headerValues.length > 0 ? headerValues : allValues;
    const plannedInserts: PartBInsert[] = [];

    for (const product of products) {
      if (!matchedProducts.includes(product.product_name)) continue;
      for (const value of valuesForSheet) {
        const key = efficacyInsertKey(product.product_id, value);
        const item: PartBInsert = {
          productId: product.product_id,
          productName: product.product_name,
          sheetName,
          value,
          rawValue: `FOB USD ${value}lm/w`,
          action: existingValues.has(key) ? "already_exists" : plannedValues.has(key) ? "duplicate_in_plan" : "insert",
        };
        if (item.action === "insert") plannedValues.add(key);
        inserts.push(item);
        plannedInserts.push(item);
      }
    }

    sheetScans.push({ sheetName, headerValues, allValues, matchedProducts, plannedInserts });
  }

  return { products, sheetScans, inserts };
}

async function applyPartB(inserts: PartBInsert[]): Promise<number> {
  const rows = inserts.filter((insert) => insert.action === "insert");
  if (rows.length === 0) return 0;
  const result = await prisma.productParam.createMany({
    data: rows.map((insert) => ({
      id: randomUUID(),
      productId: insert.productId,
      paramKey: "luminous_efficacy",
      rawValue: insert.rawValue,
      normalizedValue: insert.value,
      unit: "lm/W",
      sourceField: "column_header_value",
      confidence: "medium",
    })),
  });
  return result.count;
}

function predictAfterCounts(before: DbCounts, actions: PartAAction[], inserts: PartBInsert[]): DbCounts {
  const reclassifyCount = actions.filter((action) => action.kind === "reclassify").length;
  const deleteCount = actions.filter((action) => action.kind !== "reclassify").length;
  const insertCount = inserts.filter((insert) => insert.action === "insert").length;
  return {
    productParams: before.productParams - deleteCount + insertCount,
    lumens: before.lumens - actions.length,
    luminousEfficacy: before.luminousEfficacy + reclassifyCount + insertCount,
  };
}

async function loadEfficacyCoverage(extraProductIds: string[]): Promise<CoverageRow[]> {
  const products = await prisma.product.findMany({
    select: { id: true, category: true },
  });
  const productIdsWithEfficacy = new Set(
    (
      await prisma.productParam.findMany({
        where: { paramKey: "luminous_efficacy" },
        select: { productId: true },
      })
    ).map((row) => row.productId),
  );
  for (const productId of extraProductIds) productIdsWithEfficacy.add(productId);

  const grouped = new Map<string, CoverageRow>();
  for (const product of products) {
    const category = product.category ?? "(未分类)";
    const row = grouped.get(category) ?? { category, totalProducts: 0, productsWithEfficacy: 0 };
    row.totalProducts += 1;
    if (productIdsWithEfficacy.has(product.id)) row.productsWithEfficacy += 1;
    grouped.set(category, row);
  }

  return [...grouped.values()]
    .filter((row) => row.productsWithEfficacy > 0 || ["Highbay", "路灯", "筒灯", "轨道灯", "工作灯", "投光灯"].includes(row.category))
    .sort((left, right) => right.productsWithEfficacy - left.productsWithEfficacy || left.category.localeCompare(right.category));
}

function extractEfficacy(raw: string): string {
  const match = raw.match(/(\d+(?:\s*[-–]\s*\d+)?)\s*[Ll][Mm]\s*\/\s*[Ww]/);
  if (!match) return raw.trim();
  return match[1].replace(/\s+/g, "").replace("–", "-");
}

function extractAllEfficacyValues(raw: string): string[] {
  const values = new Set<string>();
  const regex = /(\d+(?:\s*[-–]\s*\d+)?)\s*[Ll][Mm]\s*\/\s*[Ww]/g;
  for (const match of raw.matchAll(regex)) {
    values.add(match[1].replace(/\s+/g, "").replace("–", "-"));
  }
  return [...values];
}

function extractSheetEfficacyValues(rows: unknown[][]): string[] {
  const values = new Set<string>();
  for (const row of rows) {
    for (const cell of row) {
      const text = cellToString(cell);
      for (const value of extractAllEfficacyValues(text)) values.add(value);
    }
  }
  return [...values].sort(compareEfficacyValues);
}

function isWrongEfficacy(value: string | null): boolean {
  if (!value) return true;
  const num = Number.parseFloat(value);
  return !Number.isNaN(num) && num < 50;
}

function sheetContainsProduct(rows: unknown[][], product: HighbayProductRow): boolean {
  const needles = [product.model_no, product.product_name].filter(Boolean) as string[];
  return rows.some((row) => {
    const text = row.map(cellToString).join(" ").toUpperCase();
    return needles.some((needle) => modelBoundaryMatch(text, needle.toUpperCase()));
  });
}

function modelBoundaryMatch(text: string, model: string): boolean {
  if (!model) return false;
  const escaped = model.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(^|[^A-Z0-9])${escaped}($|[^A-Z0-9])`, "i");
  return regex.test(text);
}

function cellToString(value: unknown): string {
  if (value == null) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function efficacyInsertKey(productId: string, value: string): string {
  return `${productId}::${value.trim().toLowerCase()}`;
}

function compareEfficacyValues(left: string, right: string): number {
  return Number.parseFloat(left) - Number.parseFloat(right) || left.localeCompare(right);
}

function groupBy<T, K>(rows: T[], keyFn: (row: T) => K): Map<K, T[]> {
  const grouped = new Map<K, T[]>();
  for (const row of rows) {
    const key = keyFn(row);
    const existing = grouped.get(key) ?? [];
    existing.push(row);
    grouped.set(key, existing);
  }
  return grouped;
}

async function writeReport(result: RunResult) {
  await mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await writeFile(REPORT_PATH, renderReport(result), "utf8");
}

function renderReport(result: RunResult): string {
  const lines: string[] = [];
  lines.push("# V16.2 光效数据修复报告");
  lines.push("");
  lines.push(`模式: ${result.mode}`);
  lines.push(`时间: ${result.generatedAt}`);
  lines.push(`备份: ${BACKUP_PATH}`);
  lines.push("");

  lines.push("## Part A: lumens → luminous_efficacy 修正");
  lines.push("");
  lines.push("| 操作 | 记录数 |");
  lines.push("|---|---:|");
  lines.push(`| reclassify（无 efficacy → 改 key） | ${result.partA.reclassifyCount.toLocaleString()} |`);
  lines.push(`| 修正错误 efficacy（< 50 lm/W） | ${result.partA.fixWrongCount.toLocaleString()} |`);
  lines.push(`| 删除冗余 lumens（已有正确 efficacy） | ${result.partA.deleteRedundantCount.toLocaleString()} |`);
  lines.push(`| 合计影响产品 | ${result.partA.affectedProductIds.size.toLocaleString()} |`);
  lines.push("");
  lines.push("### Part A 明细（前 80 条）");
  lines.push("");
  lines.push("| action | category | product | raw_value | correct | existing |");
  lines.push("|---|---|---|---|---|---|");
  for (const action of result.partA.actions.slice(0, 80)) {
    const existing =
      action.kind === "fix_wrong_efficacy"
        ? action.existing.normalizedValue ?? action.existing.rawValue
        : action.kind === "delete_redundant_lumens"
          ? action.existingValues.join(", ")
          : "-";
    lines.push(
      `| ${action.kind} | ${escapeMd(action.lumens.category ?? "")} | ${escapeMd(
        action.lumens.model_no ?? action.lumens.product_name,
      )} | ${escapeMd(action.lumens.raw_value)} | ${escapeMd(action.correctValue)} | ${escapeMd(existing)} |`,
    );
  }
  lines.push("");

  lines.push("### 修正后各品类 luminous_efficacy 覆盖");
  lines.push("");
  lines.push("| 品类 | 产品总数 | 有 efficacy | 覆盖率 |");
  lines.push("|---|---:|---:|---:|");
  for (const row of result.coverage) {
    lines.push(
      `| ${escapeMd(row.category)} | ${row.totalProducts.toLocaleString()} | ${row.productsWithEfficacy.toLocaleString()} | ${formatPercent(
        row.productsWithEfficacy,
        row.totalProducts,
      )} |`,
    );
  }
  lines.push("");

  lines.push("## Part B: Wellux Highbay 列头提取");
  lines.push("");
  lines.push(`文件: \`${HIGHBAY_FILE_PATH}\``);
  lines.push("");
  lines.push("| Sheet | 检测到 lm/W | 匹配产品 | 插入记录 |");
  lines.push("|---|---|---:|---:|");
  for (const scan of result.partB.sheetScans) {
    const inserted = scan.plannedInserts.filter((insert) => insert.action === "insert").length;
    lines.push(
      `| ${escapeMd(scan.sheetName)} | ${escapeMd(scan.headerValues.join(", ") || scan.allValues.join(", ") || "-")} | ${scan.matchedProducts.length.toLocaleString()} | ${inserted.toLocaleString()} |`,
    );
  }
  lines.push("");
  lines.push("### 提取详情");
  lines.push("");
  lines.push("| product_id | product_name | 来源 sheet | 值 | action |");
  lines.push("|---|---|---|---|---|");
  for (const insert of result.partB.inserts) {
    lines.push(
      `| ${insert.productId} | ${escapeMd(insert.productName)} | ${escapeMd(insert.sheetName)} | ${escapeMd(insert.value)} | ${insert.action} |`,
    );
  }
  lines.push("");

  lines.push("## DB 计数");
  lines.push("");
  lines.push("| 表 | 执行前 | 执行后 | 变化 |");
  lines.push("|---|---:|---:|---:|");
  lines.push(
    `| product_params | ${result.beforeCounts.productParams.toLocaleString()} | ${result.afterCounts.productParams.toLocaleString()} | ${(
      result.afterCounts.productParams - result.beforeCounts.productParams
    ).toLocaleString()} |`,
  );
  lines.push(
    `| — luminous_efficacy | ${result.beforeCounts.luminousEfficacy.toLocaleString()} | ${result.afterCounts.luminousEfficacy.toLocaleString()} | ${(
      result.afterCounts.luminousEfficacy - result.beforeCounts.luminousEfficacy
    ).toLocaleString()} |`,
  );
  lines.push(
    `| — lumens | ${result.beforeCounts.lumens.toLocaleString()} | ${result.afterCounts.lumens.toLocaleString()} | ${(
      result.afterCounts.lumens - result.beforeCounts.lumens
    ).toLocaleString()} |`,
  );
  lines.push("");

  return `${lines.join("\n")}\n`;
}

function formatPercent(value: number, total: number): string {
  if (total === 0) return "0.0%";
  return `${((value / total) * 100).toFixed(1)}%`;
}

function escapeMd(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, "<br>");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
