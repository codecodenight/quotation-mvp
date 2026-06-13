import { execFile } from "node:child_process";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DB_PATH = "prisma/dev.db";
const BACKUP_DIR = "backups";
const REPORT_PATH = "docs/v2.19d-cleanup-report.md";

const TARGET_GROUPS = [
  {
    category: "灯带",
    factoryName: "尼奥",
    expectedCount: 3,
    productNames: ["6", "7", "8"],
  },
  {
    category: "面板灯",
    factoryName: "瑞鑫",
    expectedCount: 22,
    productNames: [
      "➕ 0.15",
      "➕0.2",
      "➕0.3",
      "➕0.4",
      "➕0.45",
      "➕0.5",
      "➕0.7",
      "➕0.8",
      "➕0.9",
      "➕1",
      "➕1.2",
      "➕1.3",
      "➕1.6",
      "➕1.8",
      "➕16",
      "➕2.1",
      "➕2.5",
      "➕2.6",
      "➕3.5",
      "➕4.2",
      "➕4.5",
      "➕5.1",
    ],
  },
  {
    category: "工作灯",
    factoryName: "启阳",
    expectedCount: 16,
    productNames: [
      "1000PCS",
      "20W（SMD）",
      "3.7V 4400MAH Li battery",
      "3.7V 8800MAH Li battery",
      "7.4V 6600MAH Li battery",
      "7.4V1100MAH Li battery",
      "￥48.50",
      "￥49.20",
      "￥50.10",
      "￥59.46",
      "￥60.86",
      "￥61.90",
      "￥75.80",
      "￥77.90",
      "￥80.00",
      "COB",
    ],
  },
] as const;

type Mode = "dry-run" | "apply";

type GroupStats = {
  idx: number | null;
  category: string;
  factory_name: string;
  product_count: number | null;
  offer_count: number | null;
  product_param_count: number | null;
  price_history_count: number | null;
  quote_item_count: number | null;
};

type CleanupCounts = {
  target_products: number | null;
  target_group_offers: number | null;
  target_all_offers: number | null;
  extra_attached_offers: number | null;
  target_product_params: number | null;
  target_price_history: number | null;
  target_quote_items: number | null;
};

type GlobalStats = {
  products: number | null;
  supplier_offers: number | null;
  product_params: number | null;
  price_history: number | null;
  quote_items: number | null;
};

type ProductSample = {
  group_index: number | null;
  category: string;
  factory_name: string;
  product_name: string;
  model_no: string | null;
  purchase_price: string | number | null;
  all_offer_count: number | null;
};

type Snapshot = {
  groups: GroupStats[];
  counts: CleanupCounts;
  globalStats: GlobalStats;
  samples: ProductSample[];
};

type ApplyReport = {
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
  return args.includes("--apply") ? "apply" : "dry-run";
}

function assertSafeToApply(snapshot: Snapshot) {
  const targetProducts = toNumber(snapshot.counts.target_products);
  const quoteItems = toNumber(snapshot.counts.target_quote_items);

  if (quoteItems !== 0) {
    throw new Error(`Unsafe cleanup: quote_items references found (${quoteItems})`);
  }
  if (targetProducts < 39 || targetProducts > 43) {
    throw new Error(`Unsafe cleanup: target product count out of range (${targetProducts})`);
  }

  for (const group of TARGET_GROUPS) {
    const stats = snapshot.groups.find((item) => item.category === group.category && item.factory_name === group.factoryName);
    const productCount = toNumber(stats?.product_count);
    if (productCount !== group.expectedCount) {
      throw new Error(
        `Unsafe cleanup: ${group.category}/${group.factoryName} expected ${group.expectedCount} products, got ${productCount}`,
      );
    }
  }
}

async function applyCleanup() {
  const before = await loadSnapshot();
  assertSafeToApply(before);

  await mkdir(BACKUP_DIR, { recursive: true });
  const backupPath = `${BACKUP_DIR}/dev-before-v2.19d-${timestampForFile()}.sqlite`;
  await copyFile(DB_PATH, backupPath);

  await execSql(buildCleanupTransactionSql());

  const after = await loadSnapshot();
  if (toNumber(after.counts.target_products) !== 0 || toNumber(after.counts.target_all_offers) !== 0) {
    throw new Error(
      `Cleanup verification failed: remaining target products=${toNumber(
        after.counts.target_products,
      )}, offers=${toNumber(after.counts.target_all_offers)}`,
    );
  }
  if (toNumber(after.counts.target_quote_items) !== 0) {
    throw new Error(`Cleanup verification failed: remaining quote_items references=${toNumber(after.counts.target_quote_items)}`);
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
        deletedParams: toNumber(before.globalStats.product_params) - toNumber(after.globalStats.product_params),
        deletedPriceHistory: toNumber(before.globalStats.price_history) - toNumber(after.globalStats.price_history),
        remainingTargetProducts: toNumber(after.counts.target_products),
        remainingTargetOffers: toNumber(after.counts.target_all_offers),
        quoteItemsBefore: toNumber(before.globalStats.quote_items),
        quoteItemsAfter: toNumber(after.globalStats.quote_items),
      },
      null,
      2,
    ),
  );
}

async function loadSnapshot(): Promise<Snapshot> {
  const [groups, countsRows, globalRows, samples] = await Promise.all([
    queryRows<GroupStats>(buildGroupStatsSql()),
    queryRows<CleanupCounts>(buildCountsSql()),
    queryRows<GlobalStats>(`
      SELECT
        (SELECT COUNT(*) FROM products) as products,
        (SELECT COUNT(*) FROM supplier_offers) as supplier_offers,
        (SELECT COUNT(*) FROM product_params) as product_params,
        (SELECT COUNT(*) FROM price_history) as price_history,
        (SELECT COUNT(*) FROM quote_items) as quote_items
    `),
    queryRows<ProductSample>(buildSamplesSql()),
  ]);

  return {
    groups,
    counts: countsRows[0] ?? emptyCleanupCounts(),
    globalStats: globalRows[0] ?? emptyGlobalStats(),
    samples,
  };
}

function buildGroupStatsSql(): string {
  return `
    WITH
    target_rows(idx, category, factory_name, product_name) AS (${targetRowsValuesSql()}),
    target_group_headers AS (
      SELECT DISTINCT idx, category, factory_name
      FROM target_rows
    ),
    target_products AS (${targetProductsSql()}),
    target_all_offers AS (${targetAllOffersSql()})
    SELECT
      tgh.idx,
      tgh.category,
      tgh.factory_name,
      COUNT(DISTINCT tp.id) as product_count,
      COUNT(DISTINCT tao.id) as offer_count,
      COUNT(DISTINCT pp.id) as product_param_count,
      COUNT(DISTINCT ph.id) as price_history_count,
      COUNT(DISTINCT qi.id) as quote_item_count
    FROM target_group_headers tgh
    LEFT JOIN target_products tp ON tp.idx = tgh.idx
    LEFT JOIN target_all_offers tao ON tao.product_id = tp.id
    LEFT JOIN product_params pp ON pp.product_id = tp.id
    LEFT JOIN price_history ph ON ph.supplier_offer_id = tao.id
    LEFT JOIN quote_items qi ON qi.product_id = tp.id OR qi.supplier_offer_id = tao.id
    GROUP BY tgh.idx, tgh.category, tgh.factory_name
    ORDER BY tgh.idx
  `;
}

function buildCountsSql(): string {
  return `
    WITH
    target_rows(idx, category, factory_name, product_name) AS (${targetRowsValuesSql()}),
    target_products AS (${targetProductsSql()}),
    target_group_offers AS (${targetGroupOffersSql()}),
    target_all_offers AS (${targetAllOffersSql()})
    SELECT
      (SELECT COUNT(*) FROM target_products) as target_products,
      (SELECT COUNT(*) FROM target_group_offers) as target_group_offers,
      (SELECT COUNT(*) FROM target_all_offers) as target_all_offers,
      (
        SELECT COUNT(*)
        FROM target_all_offers
        WHERE id NOT IN (SELECT id FROM target_group_offers)
      ) as extra_attached_offers,
      (
        SELECT COUNT(*)
        FROM product_params pp
        WHERE pp.product_id IN (SELECT id FROM target_products)
      ) as target_product_params,
      (
        SELECT COUNT(*)
        FROM price_history ph
        WHERE ph.supplier_offer_id IN (SELECT id FROM target_all_offers)
      ) as target_price_history,
      (
        SELECT COUNT(*)
        FROM quote_items qi
        WHERE qi.supplier_offer_id IN (SELECT id FROM target_all_offers)
           OR qi.product_id IN (SELECT id FROM target_products)
      ) as target_quote_items
  `;
}

function buildSamplesSql(): string {
  return `
    WITH
    target_rows(idx, category, factory_name, product_name) AS (${targetRowsValuesSql()}),
    target_products AS (${targetProductsSql()}),
    target_group_offers AS (${targetGroupOffersSql()}),
    target_all_offers AS (${targetAllOffersSql()})
    SELECT
      tp.idx as group_index,
      p.category,
      tp.factory_name,
      p.product_name,
      p.model_no,
      so.purchase_price,
      (
        SELECT COUNT(*)
        FROM target_all_offers tao
        WHERE tao.product_id = p.id
      ) as all_offer_count
    FROM target_products tp
    JOIN products p ON p.id = tp.id
    LEFT JOIN supplier_offers so ON so.product_id = p.id AND so.id IN (SELECT id FROM target_group_offers)
    ORDER BY tp.idx, p.product_name
  `;
}

function buildCleanupTransactionSql(): string {
  return `
    BEGIN IMMEDIATE;

    CREATE TEMP TABLE junk_v219d_target_products(id TEXT PRIMARY KEY);
    INSERT INTO junk_v219d_target_products(id)
    WITH
    target_rows(idx, category, factory_name, product_name) AS (${targetRowsValuesSql()})
    SELECT DISTINCT id FROM (${targetProductsSql()});

    CREATE TEMP TABLE junk_v219d_target_offers(id TEXT PRIMARY KEY);
    INSERT INTO junk_v219d_target_offers(id)
    SELECT DISTINCT so.id
    FROM supplier_offers so
    WHERE so.product_id IN (SELECT id FROM junk_v219d_target_products);

    DELETE FROM product_params
    WHERE product_id IN (SELECT id FROM junk_v219d_target_products);

    DELETE FROM price_history
    WHERE supplier_offer_id IN (SELECT id FROM junk_v219d_target_offers);

    DELETE FROM supplier_offers
    WHERE id IN (SELECT id FROM junk_v219d_target_offers);

    DELETE FROM products
    WHERE id IN (SELECT id FROM junk_v219d_target_products)
      AND NOT EXISTS (
        SELECT 1
        FROM supplier_offers so
        WHERE so.product_id = products.id
      );

    DROP TABLE junk_v219d_target_offers;
    DROP TABLE junk_v219d_target_products;

    COMMIT;
  `;
}

function targetProductsSql(): string {
  return `
    SELECT DISTINCT p.id, tr.idx, tr.category, tr.factory_name, tr.product_name
    FROM target_rows tr
    JOIN products p ON p.category = tr.category AND p.product_name = tr.product_name
    JOIN supplier_offers so ON so.product_id = p.id AND so.factory_name = tr.factory_name
  `;
}

function targetGroupOffersSql(): string {
  return `
    SELECT DISTINCT so.id, so.product_id
    FROM target_products tp
    JOIN supplier_offers so ON so.product_id = tp.id AND so.factory_name = tp.factory_name
  `;
}

function targetAllOffersSql(): string {
  return `
    SELECT DISTINCT so.id, so.product_id
    FROM supplier_offers so
    WHERE so.product_id IN (SELECT id FROM target_products)
  `;
}

function targetRowsValuesSql(): string {
  return TARGET_GROUPS.flatMap((group, groupIndex) =>
    group.productNames.map(
      (productName) =>
        `SELECT ${groupIndex + 1}, ${sqlString(group.category)}, ${sqlString(group.factoryName)}, ${sqlString(productName)}`,
    ),
  ).join("\nUNION ALL\n");
}

function printDryRun(snapshot: Snapshot) {
  console.log("=== V2.19D: 部分垃圾删除 (DRY RUN) ===");
  console.log("");
  console.log("逐组统计：");
  snapshot.groups.forEach((group) => {
    const expected = TARGET_GROUPS.find((target) => target.category === group.category && target.factoryName === group.factory_name)?.expectedCount;
    const productCount = toNumber(group.product_count);
    console.log(
      `  ${toNumber(group.idx)}. ${group.category} — ${group.factory_name}: ${formatInteger(productCount)} products / ${formatInteger(
        toNumber(group.offer_count),
      )} offers ${expected === productCount ? "✓" : `(expected ${expected ?? "-"})`}`,
    );
  });
  console.log("");
  console.log("合计：");
  console.log(`  产品（将删除）: ${formatInteger(toNumber(snapshot.counts.target_products))}`);
  console.log(`  目标组 Offer（命中）: ${formatInteger(toNumber(snapshot.counts.target_group_offers))}`);
  console.log(`  产品全部 Offer（将删除）: ${formatInteger(toNumber(snapshot.counts.target_all_offers))}`);
  console.log(`  额外关联 Offer（随目标产品删除）: ${formatInteger(toNumber(snapshot.counts.extra_attached_offers))}`);
  console.log(`  product_params（将删除）: ${formatInteger(toNumber(snapshot.counts.target_product_params))}`);
  console.log(`  price_history（将删除）: ${formatInteger(toNumber(snapshot.counts.target_price_history))}`);
  console.log("");
  console.log("安全检查：");
  console.log(
    `${toNumber(snapshot.counts.target_quote_items) === 0 ? "  ✅" : "  ❌"} quote_items 引用: ${formatInteger(
      toNumber(snapshot.counts.target_quote_items),
    )}`,
  );
  console.log(
    `${toNumber(snapshot.counts.target_products) >= 39 && toNumber(snapshot.counts.target_products) <= 43 ? "  ✅" : "  ❌"} 总数在 39-43 范围内`,
  );
  for (const group of TARGET_GROUPS) {
    const stats = snapshot.groups.find((item) => item.category === group.category && item.factory_name === group.factoryName);
    const productCount = toNumber(stats?.product_count);
    console.log(
      `${productCount === group.expectedCount ? "  ✅" : "  ❌"} ${group.category}/${group.factoryName}: ${formatInteger(
        productCount,
      )}/${formatInteger(group.expectedCount)}`,
    );
  }
  console.log("");
  console.log("产品命中清单：");
  for (const sample of snapshot.samples) {
    console.log(
      `  ${sample.group_index}. ${sample.category} / ${sample.factory_name} / ${sample.product_name} | price=${
        sample.purchase_price ?? "-"
      } | allOffers=${formatInteger(toNumber(sample.all_offer_count))}`,
    );
  }
}

function buildApplyReport(data: ApplyReport): string {
  const beforeByGroup = new Map(data.before.groups.map((group) => [groupKey(group.category, group.factory_name), group]));
  const afterByGroup = new Map(data.after.groups.map((group) => [groupKey(group.category, group.factory_name), group]));
  const totals = {
    products: toNumber(data.before.globalStats.products) - toNumber(data.after.globalStats.products),
    offers: toNumber(data.before.globalStats.supplier_offers) - toNumber(data.after.globalStats.supplier_offers),
    params: toNumber(data.before.globalStats.product_params) - toNumber(data.after.globalStats.product_params),
    priceHistory: toNumber(data.before.globalStats.price_history) - toNumber(data.after.globalStats.price_history),
  };

  return [
    "# V2.19D 部分垃圾删除报告",
    "",
    `Generated: ${data.generatedAt.toISOString()}`,
    `Backup: ${data.backupPath}`,
    "",
    "## 删除统计",
    "",
    "口径：产品按 `product_name + category + factory_name` 精确匹配；Offer/Price History 统计为这些目标产品挂载的全部记录，不只限于匹配工厂。",
    "",
    "| 组 | 品类 | 工厂 | 产品 | Offer | Params | Price History |",
    "|---|---|---|---:|---:|---:|---:|",
    ...TARGET_GROUPS.map((target, index) => {
      const before = beforeByGroup.get(groupKey(target.category, target.factoryName)) ?? emptyGroupStats(index + 1, target.category, target.factoryName);
      const after = afterByGroup.get(groupKey(target.category, target.factoryName)) ?? emptyGroupStats(index + 1, target.category, target.factoryName);
      return `| ${index + 1} | ${escapeMarkdown(target.category)} | ${escapeMarkdown(target.factoryName)} | ${formatInteger(
        toNumber(before.product_count) - toNumber(after.product_count),
      )} | ${formatInteger(toNumber(before.offer_count) - toNumber(after.offer_count))} | ${formatInteger(
        toNumber(before.product_param_count) - toNumber(after.product_param_count),
      )} | ${formatInteger(toNumber(before.price_history_count) - toNumber(after.price_history_count))} |`;
    }),
    `| 合计 |  |  | ${formatInteger(totals.products)} | ${formatInteger(totals.offers)} | ${formatInteger(
      totals.params,
    )} | ${formatInteger(totals.priceHistory)} |`,
    "",
    "## 全局数据变化",
    "",
    "| 指标 | 删前 | 删后 |",
    "|---|---:|---:|",
    renderCountRow("总产品", data.before.globalStats.products, data.after.globalStats.products),
    renderCountRow("总 Offer", data.before.globalStats.supplier_offers, data.after.globalStats.supplier_offers),
    renderCountRow("总参数", data.before.globalStats.product_params, data.after.globalStats.product_params),
    renderCountRow("价格历史", data.before.globalStats.price_history, data.after.globalStats.price_history),
    renderCountRow("quote_items", data.before.globalStats.quote_items, data.after.globalStats.quote_items),
    "",
    "## 验证",
    "",
    `- 剩余目标产品: ${formatInteger(toNumber(data.after.counts.target_products))}`,
    `- 剩余目标组 Offer: ${formatInteger(toNumber(data.after.counts.target_group_offers))}`,
    `- 剩余目标产品全部 Offer: ${formatInteger(toNumber(data.after.counts.target_all_offers))}`,
    `- quote_items 引用: ${formatInteger(toNumber(data.after.counts.target_quote_items))}`,
    `- 删除前 quote_items: ${formatInteger(toNumber(data.before.globalStats.quote_items))}`,
    `- 删除后 quote_items: ${formatInteger(toNumber(data.after.globalStats.quote_items))}`,
    "",
    "## 删除产品采样",
    "",
    "| 组 | 品类 | 工厂 | product_name | model_no | 价格 | 目标产品全部 offers |",
    "|---:|---|---|---|---|---:|---:|",
    ...data.before.samples.map(
      (sample) =>
        `| ${toNumber(sample.group_index)} | ${escapeMarkdown(sample.category)} | ${escapeMarkdown(sample.factory_name)} | ${escapeMarkdown(
          sample.product_name,
        )} | ${escapeMarkdown(sample.model_no ?? "-")} | ${sample.purchase_price ?? "-"} | ${formatInteger(
          toNumber(sample.all_offer_count),
        )} |`,
    ),
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
    target_group_offers: 0,
    target_all_offers: 0,
    extra_attached_offers: 0,
    target_product_params: 0,
    target_price_history: 0,
    target_quote_items: 0,
  };
}

function emptyGlobalStats(): GlobalStats {
  return {
    products: 0,
    supplier_offers: 0,
    product_params: 0,
    price_history: 0,
    quote_items: 0,
  };
}

function emptyGroupStats(idx: number, category: string, factoryName: string): GroupStats {
  return {
    idx,
    category,
    factory_name: factoryName,
    product_count: 0,
    offer_count: 0,
    product_param_count: 0,
    price_history_count: 0,
    quote_item_count: 0,
  };
}

function renderCountRow(label: string, before: number | null, after: number | null): string {
  return `| ${label} | ${formatInteger(toNumber(before))} | ${formatInteger(toNumber(after))} |`;
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function groupKey(category: string, factoryName: string): string {
  return `${category}\u0000${factoryName}`;
}

function toNumber(value: number | null | undefined): number {
  return value ?? 0;
}

function formatInteger(value: number): string {
  return value.toLocaleString("en-US");
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
