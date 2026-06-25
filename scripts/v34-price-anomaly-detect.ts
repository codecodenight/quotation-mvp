import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";

import { calculateCategoryIqrStats, getIqrOutlierFlag, type CategoryIqrStats } from "../src/lib/price-anomaly-iqr";

type OfferRow = {
  id: string;
  factory_name: string;
  category: string | null;
  model_no: string | null;
  product_name: string;
  purchase_price: number;
  currency: string;
};

type FlagCount = {
  price_flag: string | null;
  count: number;
};

type FlaggedRow = OfferRow & {
  price_flag: string;
};

const DB_PATH = path.join("prisma", "dev.db");
const BACKUP_DB_PATH = path.join("prisma", "dev.db.bak-v36");
const REPORT_PATH = path.join("docs", "v36-price-anomaly-fix-report.md");
const PRICE_FLAGS = ["suspicious_low", "suspicious_high", "outlier_low", "outlier_high"] as const;
const OUTLIER_FLAGS = ["outlier_low", "outlier_high"] as const;
const LINEAR_LIGHT_CATEGORY = "线条灯";

function main() {
  const beforeDbPath = existsSync(BACKUP_DB_PATH) ? BACKUP_DB_PATH : DB_PATH;
  const beforeCounts = getFlagCounts(beforeDbPath);
  const beforeLinearLightOutlierHigh = getCategoryFlagCount(LINEAR_LIGHT_CATEGORY, "outlier_high", beforeDbPath);

  clearExistingOutlierFlags();
  applyAbsoluteThresholds();

  const offers = queryJson<OfferRow>(`
    SELECT so.id,
           so.factory_name,
           p.category,
           p.model_no,
           p.product_name,
           CAST(so.purchase_price AS REAL) AS purchase_price,
           so.currency
    FROM supplier_offers so
    JOIN products p ON p.id = so.product_id
    WHERE CAST(so.purchase_price AS REAL) > 0
  `);
  const categoryStats = calculateCategoryIqrStats(
    offers.map((offer) => ({ category: categoryKey(offer.category), price: offer.purchase_price })),
  );
  applyOutlierFlags(offers, categoryStats);

  const counts = getFlagCounts();
  const totalFlagged = counts.reduce((sum, row) => sum + row.count, 0);
  const totalOffers = Number(queryScalar("SELECT COUNT(*) FROM supplier_offers"));
  const flaggedRows = queryJson<FlaggedRow>(`
    SELECT so.id,
           so.factory_name,
           p.category,
           p.model_no,
           p.product_name,
           CAST(so.purchase_price AS REAL) AS purchase_price,
           so.currency,
           so.price_flag
    FROM supplier_offers so
    JOIN products p ON p.id = so.product_id
    WHERE so.price_flag IS NOT NULL
  `);
  const afterLinearLightOutlierHigh = getCategoryFlagCount(LINEAR_LIGHT_CATEGORY, "outlier_high");
  const extremeSamples = getExtremeSamples(flaggedRows, categoryStats);

  writeReport({
    beforeCounts,
    beforeLinearLightOutlierHigh,
    counts,
    afterLinearLightOutlierHigh,
    totalFlagged,
    totalOffers,
    categoryStats,
    extremeSamples,
  });

  for (const flag of PRICE_FLAGS) {
    const count = counts.find((row) => row.price_flag === flag)?.count ?? 0;
    console.log(`${flag}: ${count}`);
  }
  console.log(`total flagged: ${totalFlagged}`);
  console.log(`total offers: ${totalOffers}`);
  console.log(`report: ${REPORT_PATH}`);
}

function clearExistingOutlierFlags() {
  runSql(`
    UPDATE supplier_offers
    SET price_flag = NULL
    WHERE price_flag IN (${OUTLIER_FLAGS.map(sqlString).join(", ")});
  `);
}

function applyAbsoluteThresholds() {
  runSql(`
    UPDATE supplier_offers
    SET price_flag = 'suspicious_low'
    WHERE price_flag IS NULL
      AND CAST(purchase_price AS REAL) < 0.5;

    UPDATE supplier_offers
    SET price_flag = 'suspicious_high'
    WHERE price_flag IS NULL
      AND CAST(purchase_price AS REAL) > 1000;
  `);
}

function applyOutlierFlags(offers: OfferRow[], categoryStats: Map<string, CategoryIqrStats>) {
  const lowIds: string[] = [];
  const highIds: string[] = [];
  const alreadyFlagged = new Set(
    queryJson<{ id: string }>("SELECT id FROM supplier_offers WHERE price_flag IS NOT NULL").map((row) => row.id),
  );

  for (const offer of offers) {
    if (alreadyFlagged.has(offer.id)) continue;
    const stats = categoryStats.get(categoryKey(offer.category));
    if (!stats) continue;
    const flag = getIqrOutlierFlag(offer.purchase_price, stats);
    if (flag === "outlier_low") {
      lowIds.push(offer.id);
    } else if (flag === "outlier_high") {
      highIds.push(offer.id);
    }
  }

  updateFlagForIds(lowIds, "outlier_low");
  updateFlagForIds(highIds, "outlier_high");
}

function updateFlagForIds(ids: string[], flag: (typeof PRICE_FLAGS)[number]) {
  for (let index = 0; index < ids.length; index += 400) {
    const chunk = ids.slice(index, index + 400);
    if (chunk.length === 0) continue;
    runSql(`
      UPDATE supplier_offers
      SET price_flag = ${sqlString(flag)}
      WHERE id IN (${chunk.map(sqlString).join(", ")});
    `);
  }
}

function getFlagCounts(dbPath = DB_PATH): FlagCount[] {
  const rows = queryJson<FlagCount>(`
    SELECT price_flag, COUNT(*) AS count
    FROM supplier_offers
    WHERE price_flag IS NOT NULL
    GROUP BY price_flag
    ORDER BY price_flag
  `, dbPath);
  return rows.map((row) => ({ price_flag: row.price_flag, count: Number(row.count) }));
}

function getCategoryFlagCount(category: string, flag: (typeof PRICE_FLAGS)[number], dbPath = DB_PATH): number {
  return Number(
    queryScalar(
      `
        SELECT COUNT(*)
        FROM supplier_offers so
        JOIN products p ON p.id = so.product_id
        WHERE p.category = ${sqlString(category)}
          AND so.price_flag = ${sqlString(flag)}
      `,
      dbPath,
    ),
  );
}

function getExtremeSamples(flaggedRows: FlaggedRow[], categoryStats: Map<string, CategoryIqrStats>): FlaggedRow[] {
  return [...flaggedRows]
    .sort((left, right) => anomalyScore(right, categoryStats) - anomalyScore(left, categoryStats))
    .slice(0, 20);
}

function anomalyScore(row: FlaggedRow, categoryStats: Map<string, CategoryIqrStats>): number {
  const stats = categoryStats.get(categoryKey(row.category));
  if (!stats || row.purchase_price <= 0) return 0;
  if (row.purchase_price > stats.upperBound && stats.upperBound > 0) {
    return row.purchase_price / stats.upperBound;
  }
  if (row.purchase_price < stats.lowerBound && stats.lowerBound > 0) {
    return stats.lowerBound / row.purchase_price;
  }
  return 0;
}

function writeReport(input: {
  beforeCounts: FlagCount[];
  beforeLinearLightOutlierHigh: number;
  counts: FlagCount[];
  afterLinearLightOutlierHigh: number;
  totalFlagged: number;
  totalOffers: number;
  categoryStats: Map<string, CategoryIqrStats>;
  extremeSamples: FlaggedRow[];
}) {
  const beforeCountRows = PRICE_FLAGS.map((flag) => {
    const count = input.beforeCounts.find((row) => row.price_flag === flag)?.count ?? 0;
    return `| ${flag} | ${formatInteger(count)} |`;
  }).join("\n");
  const afterCountRows = PRICE_FLAGS.map((flag) => {
    const count = input.counts.find((row) => row.price_flag === flag)?.count ?? 0;
    return `| ${flag} | ${formatInteger(count)} |`;
  }).join("\n");
  const statRows = [...input.categoryStats.values()]
    .sort((left, right) => left.category.localeCompare(right.category, "zh-Hans-CN"))
    .map(
      (stats) =>
        `| ${escapeMd(stats.category)} | ${formatInteger(stats.count)} | ${formatMoney(stats.q1)} | ${formatMoney(stats.q3)} | ${formatMoney(stats.iqr)} | ${formatMoney(stats.lowerBound)} | ${formatMoney(stats.upperBound)} |`,
    )
    .join("\n");
  const sampleRows = input.extremeSamples
    .map((row) => {
      const stats = input.categoryStats.get(categoryKey(row.category));
      return `| ${escapeMd(row.factory_name)} | ${escapeMd(row.category ?? "未分类")} | ${escapeMd(row.model_no ?? "-")} | ${escapeMd(row.product_name)} | ${formatMoney(row.purchase_price)} ${escapeMd(row.currency)} | ${escapeMd(row.price_flag)} | ${stats ? formatMoney(stats.lowerBound) : "-"} | ${stats ? formatMoney(stats.upperBound) : "-"} | ${formatMoney(anomalyScore(row, input.categoryStats))}x |`;
    })
    .join("\n");

  writeFileSync(
    REPORT_PATH,
    `# V36 价格异常检测修复报告

## 汇总

| 指标 | 数量 |
| --- | ---: |
| total offers | ${formatInteger(input.totalOffers)} |
| total flagged | ${formatInteger(input.totalFlagged)} |

## 修复前 Flag 数量

| price_flag | 数量 |
| --- | ---: |
${beforeCountRows}

## 修复后 Flag 数量

| price_flag | 数量 |
| --- | ---: |
${afterCountRows}

## 线条灯 outlier_high 变化

| 指标 | 数量 |
| --- | ---: |
| before | ${formatInteger(input.beforeLinearLightOutlierHigh)} |
| after | ${formatInteger(input.afterLinearLightOutlierHigh)} |
| delta | ${formatInteger(input.afterLinearLightOutlierHigh - input.beforeLinearLightOutlierHigh)} |

## 品类 IQR 阈值

| 品类 | 样本数 | Q1 | Q3 | IQR | 下界 | 上界 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
${statRows}

## 最极端异常价格样本 Top 20

| 工厂 | 品类 | model_no | product_name | price | flag | IQR lower | IQR upper | score |
| --- | --- | --- | --- | ---: | --- | ---: | ---: | ---: |
${sampleRows}
`,
  );
}

function queryJson<T>(sql: string, dbPath = DB_PATH): T[] {
  const output = execFileSync("sqlite3", ["-json", dbPath, sql], { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 }).trim();
  return output ? (JSON.parse(output) as T[]) : [];
}

function queryScalar(sql: string, dbPath = DB_PATH): string {
  return execFileSync("sqlite3", [dbPath, sql], { encoding: "utf8", maxBuffer: 1024 * 1024 }).trim();
}

function runSql(sql: string) {
  execFileSync("sqlite3", [DB_PATH, sql], { stdio: "pipe" });
}

function categoryKey(category: string | null): string {
  return category?.trim() || "未分类";
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function formatInteger(value: number): string {
  return value.toLocaleString("en-US");
}

function formatMoney(value: number): string {
  return value.toFixed(2);
}

function escapeMd(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

main();
