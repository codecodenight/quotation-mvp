import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";

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
const REPORT_PATH = path.join("docs", "v34-price-anomaly-report.md");
const PRICE_FLAGS = ["suspicious_low", "suspicious_high", "outlier_low", "outlier_high"] as const;

function main() {
  clearExistingFlags();
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
  const medians = calculateCategoryMedians(offers);
  applyOutlierFlags(offers, medians);

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
  const extremeSamples = getExtremeSamples(flaggedRows, medians);

  writeReport({
    counts,
    totalFlagged,
    totalOffers,
    medians,
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

function clearExistingFlags() {
  runSql(`
    UPDATE supplier_offers
    SET price_flag = NULL
    WHERE price_flag IN (${PRICE_FLAGS.map(sqlString).join(", ")});
  `);
}

function applyAbsoluteThresholds() {
  runSql(`
    UPDATE supplier_offers
    SET price_flag = 'suspicious_low'
    WHERE CAST(purchase_price AS REAL) < 0.5;

    UPDATE supplier_offers
    SET price_flag = 'suspicious_high'
    WHERE price_flag IS NULL
      AND CAST(purchase_price AS REAL) > 1000;
  `);
}

function applyOutlierFlags(offers: OfferRow[], medians: Map<string, number>) {
  const lowIds: string[] = [];
  const highIds: string[] = [];
  const alreadyFlagged = new Set(
    queryJson<{ id: string }>("SELECT id FROM supplier_offers WHERE price_flag IS NOT NULL").map((row) => row.id),
  );

  for (const offer of offers) {
    if (alreadyFlagged.has(offer.id)) continue;
    const median = medians.get(categoryKey(offer.category));
    if (!median || median <= 0) continue;
    if (offer.purchase_price < median / 10) {
      lowIds.push(offer.id);
    } else if (offer.purchase_price > median * 10) {
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

function calculateCategoryMedians(offers: OfferRow[]): Map<string, number> {
  const groups = new Map<string, number[]>();
  for (const offer of offers) {
    const key = categoryKey(offer.category);
    const values = groups.get(key) ?? [];
    values.push(offer.purchase_price);
    groups.set(key, values);
  }

  const medians = new Map<string, number>();
  for (const [category, prices] of groups.entries()) {
    prices.sort((left, right) => left - right);
    const middle = Math.floor(prices.length / 2);
    const median = prices.length % 2 === 0 ? (prices[middle - 1] + prices[middle]) / 2 : prices[middle];
    medians.set(category, median);
  }
  return medians;
}

function getFlagCounts(): FlagCount[] {
  const rows = queryJson<FlagCount>(`
    SELECT price_flag, COUNT(*) AS count
    FROM supplier_offers
    WHERE price_flag IS NOT NULL
    GROUP BY price_flag
    ORDER BY price_flag
  `);
  return rows.map((row) => ({ price_flag: row.price_flag, count: Number(row.count) }));
}

function getExtremeSamples(flaggedRows: FlaggedRow[], medians: Map<string, number>): FlaggedRow[] {
  return [...flaggedRows]
    .sort((left, right) => anomalyScore(right, medians) - anomalyScore(left, medians))
    .slice(0, 20);
}

function anomalyScore(row: FlaggedRow, medians: Map<string, number>): number {
  const median = medians.get(categoryKey(row.category));
  if (!median || median <= 0 || row.purchase_price <= 0) return 0;
  return row.purchase_price >= median ? row.purchase_price / median : median / row.purchase_price;
}

function writeReport(input: {
  counts: FlagCount[];
  totalFlagged: number;
  totalOffers: number;
  medians: Map<string, number>;
  extremeSamples: FlaggedRow[];
}) {
  const countRows = PRICE_FLAGS.map((flag) => {
    const count = input.counts.find((row) => row.price_flag === flag)?.count ?? 0;
    return `| ${flag} | ${formatInteger(count)} |`;
  }).join("\n");
  const medianRows = [...input.medians.entries()]
    .sort(([left], [right]) => left.localeCompare(right, "zh-Hans-CN"))
    .map(([category, median]) => `| ${escapeMd(category)} | ${formatMoney(median)} |`)
    .join("\n");
  const sampleRows = input.extremeSamples
    .map((row) => {
      const median = input.medians.get(categoryKey(row.category));
      return `| ${escapeMd(row.factory_name)} | ${escapeMd(row.category ?? "未分类")} | ${escapeMd(row.model_no ?? "-")} | ${escapeMd(row.product_name)} | ${formatMoney(row.purchase_price)} ${escapeMd(row.currency)} | ${escapeMd(row.price_flag)} | ${median ? formatMoney(median) : "-"} | ${formatMoney(anomalyScore(row, input.medians))}x |`;
    })
    .join("\n");

  writeFileSync(
    REPORT_PATH,
    `# V34 价格异常检测报告

## 汇总

| 指标 | 数量 |
| --- | ---: |
| total offers | ${formatInteger(input.totalOffers)} |
| total flagged | ${formatInteger(input.totalFlagged)} |

## Flag 数量

| price_flag | 数量 |
| --- | ---: |
${countRows}

## 品类中位数价格

| 品类 | median purchase_price |
| --- | ---: |
${medianRows}

## 最极端异常价格样本 Top 20

| 工厂 | 品类 | model_no | product_name | price | flag | category median | score |
| --- | --- | --- | --- | ---: | --- | ---: | ---: |
${sampleRows}
`,
  );
}

function queryJson<T>(sql: string): T[] {
  const output = execFileSync("sqlite3", ["-json", DB_PATH, sql], { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 }).trim();
  return output ? (JSON.parse(output) as T[]) : [];
}

function queryScalar(sql: string): string {
  return execFileSync("sqlite3", [DB_PATH, sql], { encoding: "utf8", maxBuffer: 1024 * 1024 }).trim();
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
