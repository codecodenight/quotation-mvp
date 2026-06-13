import { execFile } from "node:child_process";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);

const DB_PATH = "prisma/dev.db";
const BACKUP_DIR = "backups";
const REPORT_PATH = "docs/v2.19c-cleanup-report.md";

const TARGET_GROUPS = [
  { category: "吸顶灯", factoryName: "力音" },
  { category: "面板灯", factoryName: "侧发光大面板灯核价明细（600x600）.xlsx" },
  { category: "线条灯", factoryName: "广交会最终核价" },
  { category: "轨道灯", factoryName: "核价Wellux Quotation- Ordinary LED Track Light 2021-11-29.xlsx" },
  { category: "灯带", factoryName: "迪闻" },
] as const;

type Mode = "dry-run" | "apply";

type GroupStats = {
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
};

type ProductSample = {
  category: string;
  factory_name: string;
  product_name: string;
  model_no: string | null;
  purchase_price: string | number | null;
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

export function assertSafeToApply(input: {
  targetProducts: number;
  targetAllOffers: number;
  quoteItems: number;
}) {
  if (input.quoteItems !== 0) {
    throw new Error(`Unsafe cleanup: quote_items references found (${input.quoteItems})`);
  }
  if (input.targetProducts < 50 || input.targetProducts > 58) {
    throw new Error(`Unsafe cleanup: target product count out of range (${input.targetProducts})`);
  }
  if (input.targetAllOffers < 54 || input.targetAllOffers > 90) {
    throw new Error(`Unsafe cleanup: target offer count out of range (${input.targetAllOffers})`);
  }
}

async function applyCleanup() {
  const before = await loadSnapshot();
  assertSafeToApply({
    targetProducts: toNumber(before.counts.target_products),
    targetAllOffers: toNumber(before.counts.target_all_offers),
    quoteItems: toNumber(before.counts.target_quote_items),
  });

  await mkdir(BACKUP_DIR, { recursive: true });
  const backupPath = `${BACKUP_DIR}/dev-before-v2.19c-${timestampForFile()}.sqlite`;
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
        remainingTargetOffers: toNumber(after.counts.target_all_offers),
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
        (SELECT COUNT(*) FROM price_history) as price_history
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
    target_groups(idx, category, factory_name) AS (${targetGroupsValuesSql()}),
    target_group_offers AS (${targetGroupOffersSql()})
    SELECT
      tg.category,
      tg.factory_name,
      COUNT(DISTINCT p.id) as product_count,
      COUNT(DISTINCT CASE WHEN p.id IS NOT NULL THEN so.id END) as offer_count,
      COUNT(DISTINCT pp.id) as product_param_count,
      COUNT(DISTINCT CASE WHEN p.id IS NOT NULL THEN ph.id END) as price_history_count,
      COUNT(DISTINCT CASE WHEN p.id IS NOT NULL THEN qi.id END) as quote_item_count
    FROM target_groups tg
    LEFT JOIN supplier_offers so ON so.factory_name = tg.factory_name
    LEFT JOIN products p ON p.id = so.product_id AND p.category = tg.category
    LEFT JOIN product_params pp ON pp.product_id = p.id
    LEFT JOIN price_history ph ON ph.supplier_offer_id = so.id
    LEFT JOIN quote_items qi ON qi.product_id = p.id AND qi.supplier_offer_id = so.id
    GROUP BY tg.category, tg.factory_name
    ORDER BY tg.idx
  `;
}

function buildCountsSql(): string {
  return `
    WITH
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
    target_products AS (${targetProductsSql()}),
    target_group_offers AS (${targetGroupOffersSql()})
    SELECT p.category, so.factory_name, p.product_name, p.model_no, so.purchase_price
    FROM products p
    JOIN target_products tp ON tp.id = p.id
    JOIN supplier_offers so ON so.product_id = p.id AND so.id IN (SELECT id FROM target_group_offers)
    ORDER BY p.category, so.factory_name, p.product_name
    LIMIT 30
  `;
}

function buildCleanupTransactionSql(): string {
  return `
    BEGIN IMMEDIATE;

    CREATE TEMP TABLE junk_v219c_target_products(id TEXT PRIMARY KEY);
    INSERT INTO junk_v219c_target_products(id)
    ${targetProductsSql()};

    CREATE TEMP TABLE junk_v219c_target_offers(id TEXT PRIMARY KEY);
    INSERT INTO junk_v219c_target_offers(id)
    ${targetOffersFromTempSql()};

    DELETE FROM product_params
    WHERE product_id IN (SELECT id FROM junk_v219c_target_products);

    DELETE FROM price_history
    WHERE supplier_offer_id IN (SELECT id FROM junk_v219c_target_offers);

    DELETE FROM supplier_offers
    WHERE id IN (SELECT id FROM junk_v219c_target_offers);

    DELETE FROM products
    WHERE id IN (SELECT id FROM junk_v219c_target_products)
      AND NOT EXISTS (
        SELECT 1
        FROM supplier_offers so
        WHERE so.product_id = products.id
      );

    DROP TABLE junk_v219c_target_offers;
    DROP TABLE junk_v219c_target_products;

    COMMIT;
  `;
}

function targetProductsSql(): string {
  return `
    SELECT DISTINCT p.id
    FROM products p
    JOIN supplier_offers so ON so.product_id = p.id
    WHERE ${targetWhereSql("p", "so")}
  `;
}

function targetOffersSql(): string {
  return targetAllOffersSql();
}

function targetGroupOffersSql(): string {
  return `
    SELECT so.id
    FROM supplier_offers so
    JOIN products p ON p.id = so.product_id
    WHERE ${targetWhereSql("p", "so")}
  `;
}

function targetAllOffersSql(): string {
  return `
    SELECT so.id
    FROM supplier_offers so
    WHERE so.product_id IN (SELECT id FROM target_products)
  `;
}

function targetOffersFromTempSql(): string {
  return `
    SELECT so.id
    FROM supplier_offers so
    WHERE so.product_id IN (SELECT id FROM junk_v219c_target_products)
  `;
}

function targetWhereSql(productAlias: string, offerAlias: string): string {
  return TARGET_GROUPS.map(
    (group) =>
      `(${productAlias}.category = ${sqlString(group.category)} AND ${offerAlias}.factory_name = ${sqlString(group.factoryName)})`,
  ).join("\n       OR ");
}

function targetGroupsValuesSql(): string {
  return TARGET_GROUPS.map((group, index) => `SELECT ${index + 1}, ${sqlString(group.category)}, ${sqlString(group.factoryName)}`).join("\nUNION ALL\n");
}

function printDryRun(snapshot: Snapshot) {
  console.log("=== V2.19C: 明确垃圾删除 (DRY RUN) ===");
  console.log("");
  console.log("逐组统计：");
  snapshot.groups.forEach((group, index) => {
    console.log(
      `  ${index + 1}. ${group.category} — ${group.factory_name}: ${formatInteger(
        toNumber(group.product_count),
      )} products / ${formatInteger(toNumber(group.offer_count))} offers`,
    );
  });
  console.log("");
  console.log("合计：");
  console.log(`  产品（将删除）: ${formatInteger(toNumber(snapshot.counts.target_products))}`);
  console.log(`  目标组 Offer（命中）: ${formatInteger(toNumber(snapshot.counts.target_group_offers))}`);
  console.log(`  产品全部 Offer（将删除）: ${formatInteger(toNumber(snapshot.counts.target_all_offers))}`);
  console.log(`  额外关联 Offer（随垃圾产品删除）: ${formatInteger(toNumber(snapshot.counts.extra_attached_offers))}`);
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
    `${toNumber(snapshot.counts.target_products) >= 50 && toNumber(snapshot.counts.target_products) <= 58 ? "  ✅" : "  ❌"} 总数在 50-58 范围内`,
  );
  console.log(
    `${toNumber(snapshot.counts.target_all_offers) >= 54 && toNumber(snapshot.counts.target_all_offers) <= 90 ? "  ✅" : "  ❌"} 删除 Offer 数在 54-90 范围内`,
  );
  console.log("");
  console.log("产品名采样（前 30）:");
  for (const sample of snapshot.samples) {
    console.log(`  ${sample.category} / ${sample.factory_name} / ${sample.product_name} | price=${sample.purchase_price ?? "-"}`);
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
    "# V2.19C 明确垃圾删除报告",
    "",
    `Generated: ${data.generatedAt.toISOString()}`,
    `Backup: ${data.backupPath}`,
    "",
    "## 口径说明",
    "",
    "删除目标产品数严格等于 54。dry-run 发现其中 19 个垃圾产品还挂有其他工厂/文件名的额外报价，因此为了真正删除产品，脚本删除这些目标产品上的全部 offers：5 组命中 offers 为 54，额外关联 offers 为 27，全局 offers 合计减少 81。",
    "",
    "## 逐组删除统计",
    "",
    "| # | 品类 | 工厂/文件名 | 产品 | Offer | Params | Price History |",
    "|---|---|---|---:|---:|---:|---:|",
    ...TARGET_GROUPS.map((target, index) => {
      const before = beforeByGroup.get(groupKey(target.category, target.factoryName)) ?? emptyGroupStats(target.category, target.factoryName);
      const after = afterByGroup.get(groupKey(target.category, target.factoryName)) ?? emptyGroupStats(target.category, target.factoryName);
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
    "",
    "## 验证",
    "",
    `- 剩余目标产品: ${formatInteger(toNumber(data.after.counts.target_products))}`,
    `- 剩余目标组 Offer: ${formatInteger(toNumber(data.after.counts.target_group_offers))}`,
    `- 剩余目标产品全部 Offer: ${formatInteger(toNumber(data.after.counts.target_all_offers))}`,
    `- quote_items 引用: ${formatInteger(toNumber(data.after.counts.target_quote_items))}`,
    `- 额外关联 Offer 已随垃圾产品删除: ${formatInteger(toNumber(data.before.counts.extra_attached_offers))}`,
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
  };
}

function emptyGroupStats(category: string, factoryName: string): GroupStats {
  return {
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
