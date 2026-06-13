import { execFile } from "node:child_process";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);

const DB_PATH = "prisma/dev.db";
const BACKUP_DIR = "backups";
const REPORT_PATH = "docs/v2.19a-cleanup-report.md";
const TARGET_CATEGORY = "净化灯";
const TARGET_FACTORY_PATTERN = "瑞雪%";

type Mode = "dry-run" | "apply";

type CleanupCounts = {
  target_products: number | null;
  target_deletable_products: number | null;
  target_offers: number | null;
  target_product_params: number | null;
  target_price_history: number | null;
  target_quote_items: number | null;
  target_with_images: number | null;
  retained_ruxue_products: number | null;
  other_factory_products: number | null;
};
type CleanupSampleRow = {
  product_name: string;
  model_no: string | null;
  purchase_price: string | number | null;
  image_path?: string | null;
};
type CategoryStats = {
  product_count: number | null;
  offer_count: number | null;
  image_count: number | null;
  param_product_count: number | null;
  size_count: number | null;
  ctn_offer_count: number | null;
};
type GlobalStats = {
  products: number | null;
  supplier_offers: number | null;
  product_params: number | null;
  price_history: number | null;
};
type Snapshot = {
  counts: CleanupCounts;
  categoryStats: CategoryStats;
  globalStats: GlobalStats;
  targetSamples: CleanupSampleRow[];
  retainedSamples: CleanupSampleRow[];
};
type ApplyReportData = {
  generatedAt: Date;
  backupPath: string;
  before: Snapshot;
  after: Snapshot;
};

async function main() {
  const mode = parseMode(process.argv.slice(2));
  if (mode === "apply") {
    await applyCleanup();
    return;
  }

  const snapshot = await loadSnapshot();
  printDryRun(snapshot);
}

export function parseMode(args: string[]): Mode {
  if (args.includes("--apply")) {
    return "apply";
  }
  return "dry-run";
}

export function assertSafeToApply(input: {
  targetProducts: number;
  quoteItems: number;
  targetProductsWithImages: number;
}) {
  if (input.quoteItems !== 0) {
    throw new Error(`Unsafe cleanup: quote_items references found (${input.quoteItems})`);
  }
  if (input.targetProducts < 1350 || input.targetProducts > 1370) {
    throw new Error(`Unsafe cleanup: target product count out of range (${input.targetProducts})`);
  }
  if (input.targetProductsWithImages !== 0) {
    throw new Error(`Unsafe cleanup: target products with image_path found (${input.targetProductsWithImages})`);
  }
}

async function applyCleanup() {
  const before = await loadSnapshot();
  assertSafeToApply({
    targetProducts: toNumber(before.counts.target_products),
    quoteItems: toNumber(before.counts.target_quote_items),
    targetProductsWithImages: toNumber(before.counts.target_with_images),
  });

  await mkdir(BACKUP_DIR, { recursive: true });
  const backupPath = `${BACKUP_DIR}/dev-before-v2.19a-step1-${timestampForFile()}.sqlite`;
  await copyFile(DB_PATH, backupPath);

  await execSql(buildCleanupTransactionSql());

  const after = await loadSnapshot();
  if (toNumber(after.counts.target_products) !== 0 || toNumber(after.counts.target_offers) !== 0) {
    throw new Error(
      `Cleanup verification failed: remaining targets products=${toNumber(after.counts.target_products)}, offers=${toNumber(
        after.counts.target_offers,
      )}`,
    );
  }

  await writeFile(
    REPORT_PATH,
    buildApplyReport({
      generatedAt: new Date(),
      backupPath,
      before,
      after,
    }),
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        mode: "apply",
        backupPath,
        reportPath: REPORT_PATH,
        deletedProducts: toNumber(before.globalStats.products) - toNumber(after.globalStats.products),
        deletedOffers: toNumber(before.globalStats.supplier_offers) - toNumber(after.globalStats.supplier_offers),
        remainingTargetProducts: toNumber(after.counts.target_products),
        remainingTargetOffers: toNumber(after.counts.target_offers),
      },
      null,
      2,
    ),
  );
}

async function loadSnapshot(): Promise<Snapshot> {
  const [countsRows, categoryStatsRows, globalStatsRows, targetSamples, retainedSamples] = await Promise.all([
    queryRows<CleanupCounts>(buildCountsSql()),
    queryRows<CategoryStats>(buildCategoryStatsSql()),
    queryRows<GlobalStats>(`
      SELECT
        (SELECT COUNT(*) FROM products) as products,
        (SELECT COUNT(*) FROM supplier_offers) as supplier_offers,
        (SELECT COUNT(*) FROM product_params) as product_params,
        (SELECT COUNT(*) FROM price_history) as price_history
    `),
    queryRows<CleanupSampleRow>(buildTargetSamplesSql()),
    queryRows<CleanupSampleRow>(buildRetainedSamplesSql()),
  ]);

  return {
    counts: countsRows[0] ?? emptyCleanupCounts(),
    categoryStats: categoryStatsRows[0] ?? emptyCategoryStats(),
    globalStats: globalStatsRows[0] ?? emptyGlobalStats(),
    targetSamples,
    retainedSamples,
  };
}

function buildCountsSql(): string {
  return `
    WITH
    target_products AS (${targetProductsSql()}),
    target_offers AS (${targetOffersSql()}),
    ruxue_products AS (${ruxueProductsSql()}),
    other_factory_products AS (
      SELECT p.id
      FROM products p
      WHERE p.category = ${sqlString(TARGET_CATEGORY)}
        AND p.id NOT IN (SELECT id FROM ruxue_products)
    )
    SELECT
      (SELECT COUNT(*) FROM target_products) as target_products,
      (
        SELECT COUNT(*)
        FROM target_products tp
        WHERE NOT EXISTS (
          SELECT 1
          FROM supplier_offers so
          WHERE so.product_id = tp.id
            AND so.id NOT IN (SELECT id FROM target_offers)
        )
      ) as target_deletable_products,
      (SELECT COUNT(*) FROM target_offers) as target_offers,
      (
        SELECT COUNT(*)
        FROM product_params pp
        WHERE pp.product_id IN (SELECT id FROM target_products)
      ) as target_product_params,
      (
        SELECT COUNT(*)
        FROM price_history ph
        WHERE ph.supplier_offer_id IN (SELECT id FROM target_offers)
      ) as target_price_history,
      (
        SELECT COUNT(*)
        FROM quote_items qi
        WHERE qi.supplier_offer_id IN (SELECT id FROM target_offers)
           OR qi.product_id IN (SELECT id FROM target_products)
      ) as target_quote_items,
      (
        SELECT COUNT(*)
        FROM target_products tp
        JOIN products p ON p.id = tp.id
        WHERE p.image_path IS NOT NULL
          AND TRIM(p.image_path) != ''
      ) as target_with_images,
      (
        SELECT COUNT(*)
        FROM ruxue_products rp
        JOIN products p ON p.id = rp.id
        WHERE p.image_path IS NOT NULL
          AND TRIM(p.image_path) != ''
      ) as retained_ruxue_products,
      (SELECT COUNT(*) FROM other_factory_products) as other_factory_products
  `;
}

function buildCategoryStatsSql(): string {
  return `
    WITH
    target_products AS (
      SELECT id, image_path, size
      FROM products
      WHERE category = ${sqlString(TARGET_CATEGORY)}
    ),
    size_products AS (
      SELECT DISTINCT product_id
      FROM product_params
      WHERE param_key IN ('size_display', 'length_mm', 'width_mm', 'height_mm')
        AND normalized_value IS NOT NULL
        AND TRIM(normalized_value) != ''
    )
    SELECT
      (SELECT COUNT(*) FROM target_products) as product_count,
      (SELECT COUNT(*) FROM supplier_offers so JOIN target_products tp ON so.product_id = tp.id) as offer_count,
      (SELECT COUNT(*) FROM target_products WHERE image_path IS NOT NULL AND TRIM(image_path) != '') as image_count,
      (SELECT COUNT(DISTINCT pp.product_id) FROM product_params pp JOIN target_products tp ON pp.product_id = tp.id) as param_product_count,
      (
        SELECT COUNT(*)
        FROM target_products tp
        LEFT JOIN size_products sp ON sp.product_id = tp.id
        WHERE (tp.size IS NOT NULL AND TRIM(tp.size) != '')
           OR sp.product_id IS NOT NULL
      ) as size_count,
      (
        SELECT COUNT(*)
        FROM supplier_offers so
        JOIN target_products tp ON so.product_id = tp.id
        WHERE so.ctn_qty IS NOT NULL AND TRIM(so.ctn_qty) != ''
      ) as ctn_offer_count
  `;
}

function buildTargetSamplesSql(): string {
  return `
    WITH target_products AS (${targetProductsSql()})
    SELECT p.product_name, p.model_no, MIN(so.purchase_price) as purchase_price
    FROM products p
    JOIN target_products tp ON tp.id = p.id
    JOIN supplier_offers so ON so.product_id = p.id
      AND so.factory_name LIKE ${sqlString(TARGET_FACTORY_PATTERN)}
    GROUP BY p.id, p.product_name, p.model_no
    ORDER BY p.product_name
    LIMIT 10
  `;
}

function buildRetainedSamplesSql(): string {
  return `
    WITH ruxue_products AS (${ruxueProductsSql()})
    SELECT p.product_name, p.model_no, MIN(so.purchase_price) as purchase_price, p.image_path
    FROM products p
    JOIN ruxue_products rp ON rp.id = p.id
    JOIN supplier_offers so ON so.product_id = p.id
      AND so.factory_name LIKE ${sqlString(TARGET_FACTORY_PATTERN)}
    WHERE p.image_path IS NOT NULL
      AND TRIM(p.image_path) != ''
    GROUP BY p.id, p.product_name, p.model_no, p.image_path
    ORDER BY p.product_name
  `;
}

function buildCleanupTransactionSql(): string {
  return `
    BEGIN IMMEDIATE;

    CREATE TEMP TABLE ruixue_target_products(id TEXT PRIMARY KEY);
    INSERT INTO ruixue_target_products(id)
    ${targetProductsSql()};

    CREATE TEMP TABLE ruixue_target_offers(id TEXT PRIMARY KEY);
    INSERT INTO ruixue_target_offers(id)
    ${targetOffersFromTempSql()};

    DELETE FROM product_params
    WHERE product_id IN (SELECT id FROM ruixue_target_products);

    DELETE FROM price_history
    WHERE supplier_offer_id IN (SELECT id FROM ruixue_target_offers);

    DELETE FROM supplier_offers
    WHERE id IN (SELECT id FROM ruixue_target_offers);

    DELETE FROM products
    WHERE id IN (SELECT id FROM ruixue_target_products)
      AND NOT EXISTS (
        SELECT 1
        FROM supplier_offers so
        WHERE so.product_id = products.id
      );

    DROP TABLE ruixue_target_offers;
    DROP TABLE ruixue_target_products;

    COMMIT;
  `;
}

function targetProductsSql(): string {
  return `
    SELECT DISTINCT p.id
    FROM products p
    JOIN supplier_offers so ON so.product_id = p.id
    WHERE p.category = ${sqlString(TARGET_CATEGORY)}
      AND so.factory_name LIKE ${sqlString(TARGET_FACTORY_PATTERN)}
      AND (p.image_path IS NULL OR TRIM(p.image_path) = '')
  `;
}

function targetOffersSql(): string {
  return `
    SELECT so.id
    FROM supplier_offers so
    WHERE so.product_id IN (SELECT id FROM target_products)
      AND so.factory_name LIKE ${sqlString(TARGET_FACTORY_PATTERN)}
  `;
}

function targetOffersFromTempSql(): string {
  return `
    SELECT so.id
    FROM supplier_offers so
    WHERE so.product_id IN (SELECT id FROM ruixue_target_products)
      AND so.factory_name LIKE ${sqlString(TARGET_FACTORY_PATTERN)}
  `;
}

function ruxueProductsSql(): string {
  return `
    SELECT DISTINCT p.id
    FROM products p
    JOIN supplier_offers so ON so.product_id = p.id
    WHERE p.category = ${sqlString(TARGET_CATEGORY)}
      AND so.factory_name LIKE ${sqlString(TARGET_FACTORY_PATTERN)}
  `;
}

function printDryRun(snapshot: Snapshot) {
  const counts = snapshot.counts;

  console.log("=== V2.19A Step 1: 瑞雪净化灯垃圾删除 (DRY RUN) ===");
  console.log("");
  console.log("目标范围：");
  console.log(`  产品（将删除）: ${formatInteger(toNumber(counts.target_products))}`);
  console.log(`  Offer（将删除）: ${formatInteger(toNumber(counts.target_offers))}`);
  console.log(`  product_params（将删除）: ${formatInteger(toNumber(counts.target_product_params))}`);
  console.log(`  price_history（将删除）: ${formatInteger(toNumber(counts.target_price_history))}`);
  console.log("");
  console.log("保留范围：");
  console.log(`  瑞雪净化灯正常产品（有图片）: ${formatInteger(toNumber(counts.retained_ruxue_products))}`);
  console.log(`  净化灯其他工厂产品: ${formatInteger(toNumber(counts.other_factory_products))}`);
  console.log("");
  console.log("安全检查：");
  console.log(`${toNumber(counts.target_quote_items) === 0 ? "  ✅" : "  ❌"} quote_items 引用: ${formatInteger(toNumber(counts.target_quote_items))}`);
  console.log(
    `${toNumber(counts.target_with_images) === 0 ? "  ✅" : "  ❌"} 目标产品带图片: ${formatInteger(
      toNumber(counts.target_with_images),
    )}`,
  );
  console.log("");
  console.log("产品名采样（将删除前 10）:");
  for (const row of snapshot.targetSamples) {
    console.log(`  ${row.product_name} | price=${row.purchase_price ?? "-"}`);
  }
  console.log("");
  console.log("产品名采样（保留的瑞雪产品）:");
  for (const row of snapshot.retainedSamples) {
    console.log(`  ${row.product_name} | price=${row.purchase_price ?? "-"}`);
  }
}

function buildApplyReport(data: ApplyReportData): string {
  const before = data.before;
  const after = data.after;
  const deletedProducts = toNumber(before.globalStats.products) - toNumber(after.globalStats.products);
  const deletedOffers = toNumber(before.globalStats.supplier_offers) - toNumber(after.globalStats.supplier_offers);
  const deletedParams = toNumber(before.globalStats.product_params) - toNumber(after.globalStats.product_params);
  const deletedPriceHistory = toNumber(before.globalStats.price_history) - toNumber(after.globalStats.price_history);

  return [
    "# V2.19A Step 1 瑞雪净化灯垃圾删除报告",
    "",
    `Generated: ${data.generatedAt.toISOString()}`,
    `Backup: ${data.backupPath}`,
    "",
    "## 口径说明",
    "",
    "dry-run 发现 `product_name NOT GLOB '*[a-zA-Z]*'` 只能命中 852 条，会漏掉 `1000pom/1000eco` 等 516 条明显垃圾编码。最终删除口径改为：瑞雪净化灯中 `image_path` 为空的产品；保留 6 个有图片的真实 T8 产品。",
    "",
    "## 删除统计",
    "",
    "| 表 | 删除数 |",
    "|---|---:|",
    `| products | ${formatInteger(deletedProducts)} |`,
    `| supplier_offers | ${formatInteger(deletedOffers)} |`,
    `| product_params | ${formatInteger(deletedParams)} |`,
    `| price_history | ${formatInteger(deletedPriceHistory)} |`,
    "",
    "## 净化灯覆盖率变化",
    "",
    "| 指标 | 删前 | 删后 |",
    "|---|---:|---:|",
    renderCountRow("产品数", before.categoryStats.product_count, after.categoryStats.product_count),
    renderCoverageRow(
      "图片覆盖",
      before.categoryStats.image_count,
      before.categoryStats.product_count,
      after.categoryStats.image_count,
      after.categoryStats.product_count,
    ),
    renderCoverageRow(
      "参数覆盖",
      before.categoryStats.param_product_count,
      before.categoryStats.product_count,
      after.categoryStats.param_product_count,
      after.categoryStats.product_count,
    ),
    renderCoverageRow(
      "Size 覆盖",
      before.categoryStats.size_count,
      before.categoryStats.product_count,
      after.categoryStats.size_count,
      after.categoryStats.product_count,
    ),
    renderCoverageRow(
      "CTN 覆盖",
      before.categoryStats.ctn_offer_count,
      before.categoryStats.offer_count,
      after.categoryStats.ctn_offer_count,
      after.categoryStats.offer_count,
    ),
    "",
    "## 全局数据变化",
    "",
    "| 指标 | 删前 | 删后 |",
    "|---|---:|---:|",
    renderCountRow("总产品", before.globalStats.products, after.globalStats.products),
    renderCountRow("总 Offer", before.globalStats.supplier_offers, after.globalStats.supplier_offers),
    renderCountRow("总参数", before.globalStats.product_params, after.globalStats.product_params),
    renderCountRow("价格历史", before.globalStats.price_history, after.globalStats.price_history),
    "",
    "## 保留的瑞雪净化灯产品",
    "",
    "| product_name | model_no | image_path |",
    "|---|---|---|",
    ...after.retainedSamples.map(
      (row) =>
        `| ${escapeMarkdown(row.product_name)} | ${escapeMarkdown(row.model_no ?? "-")} | ${escapeMarkdown(row.image_path ?? "-")} |`,
    ),
    "",
    "## 验证",
    "",
    `- 剩余目标产品: ${formatInteger(toNumber(after.counts.target_products))}`,
    `- 剩余目标 Offer: ${formatInteger(toNumber(after.counts.target_offers))}`,
    `- quote_items 引用: ${formatInteger(toNumber(after.counts.target_quote_items))}`,
    `- 瑞雪正常产品保留: ${formatInteger(toNumber(after.counts.retained_ruxue_products))}`,
    "",
  ].join("\n");
}

async function queryRows<T>(sql: string): Promise<T[]> {
  const { stdout } = await execFileAsync("sqlite3", ["-json", DB_PATH, sql], {
    maxBuffer: 20 * 1024 * 1024,
  });
  const trimmed = stdout.trim();
  if (!trimmed) {
    return [];
  }
  return JSON.parse(trimmed) as T[];
}

async function execSql(sql: string) {
  await execFileAsync("sqlite3", [DB_PATH, sql], {
    maxBuffer: 20 * 1024 * 1024,
  });
}

function emptyCleanupCounts(): CleanupCounts {
  return {
    target_products: 0,
    target_deletable_products: 0,
    target_offers: 0,
    target_product_params: 0,
    target_price_history: 0,
    target_quote_items: 0,
    target_with_images: 0,
    retained_ruxue_products: 0,
    other_factory_products: 0,
  };
}

function emptyCategoryStats(): CategoryStats {
  return {
    product_count: 0,
    offer_count: 0,
    image_count: 0,
    param_product_count: 0,
    size_count: 0,
    ctn_offer_count: 0,
  };
}

function emptyGlobalStats(): GlobalStats {
  return {
    products: 0,
    supplier_offers: 0,
    product_params: 0,
    price_history: 0,
  };
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function toNumber(value: number | null | undefined): number {
  return value ?? 0;
}

function formatInteger(value: number): string {
  return value.toLocaleString("en-US");
}

function renderCountRow(label: string, before: number | null, after: number | null): string {
  return `| ${label} | ${formatInteger(toNumber(before))} | ${formatInteger(toNumber(after))} |`;
}

function renderCoverageRow(
  label: string,
  beforeNumerator: number | null,
  beforeDenominator: number | null,
  afterNumerator: number | null,
  afterDenominator: number | null,
): string {
  const beforeNum = toNumber(beforeNumerator);
  const beforeDen = toNumber(beforeDenominator);
  const afterNum = toNumber(afterNumerator);
  const afterDen = toNumber(afterDenominator);
  return `| ${label} | ${formatPercent(beforeNum, beforeDen)} (${formatInteger(beforeNum)} / ${formatInteger(
    beforeDen,
  )}) | ${formatPercent(afterNum, afterDen)} (${formatInteger(afterNum)} / ${formatInteger(afterDen)}) |`;
}

function formatPercent(numerator: number, denominator: number): string {
  if (denominator <= 0) {
    return "0%";
  }
  return `${((numerator / denominator) * 100).toFixed(0)}%`;
}

function escapeMarkdown(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function timestampForFile(): string {
  const date = new Date();
  const pad = (value: number) => value.toString().padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
