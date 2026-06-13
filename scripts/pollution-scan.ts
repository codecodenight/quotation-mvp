import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);

const DB_PATH = "prisma/dev.db";
const REPORT_PATH = "docs/v2.19b-pollution-scan.md";
const MIN_GROUP_PRODUCTS = 5;

type BaseGroupRow = {
  category: string;
  factory_name: string;
  product_count: number | null;
  offer_count: number | null;
  hollow_count: number | null;
  numeric_name_count: number | null;
  name_eq_model_count: number | null;
};

type ParamCoverageRow = {
  category: string;
  factory_name: string;
  product_count: number | null;
  with_params_count: number | null;
};

type PriceConcentrationRow = {
  category: string;
  factory_name: string;
  total_offers: number | null;
  top3_count: number | null;
  top3_prices: string | null;
};

type RoundThousandRow = {
  category: string;
  factory_name: string;
  offer_count: number | null;
  round_thousand_count: number | null;
};

type QuoteReferenceRow = {
  category: string;
  factory_name: string;
  quote_item_count: number | null;
};

type OverallStatsRow = {
  product_count: number | null;
  offer_count: number | null;
  category_count: number | null;
};

type CategorySummaryRow = {
  category: string;
  factory_count: number | null;
  product_count: number | null;
};

type ProductSampleRow = {
  product_name: string;
  model_no: string | null;
  purchase_price: string | number | null;
};

type GroupStats = {
  category: string;
  factoryName: string;
  productCount: number;
  offerCount: number;
  hollowCount: number;
  numericNameCount: number;
  nameEqModelCount: number;
  withParamsCount: number;
  totalOffers: number;
  top3Count: number;
  top3Prices: string;
  roundThousandCount: number;
  quoteItemCount: number;
  score: number;
  severity: "red" | "yellow" | "normal";
  samples: ProductSampleRow[];
};

type CategorySummary = {
  category: string;
  factoryCount: number;
  productCount: number;
  redCount: number;
  yellowCount: number;
};

async function main() {
  const report = await buildPollutionReport();
  await writeFile(REPORT_PATH, report.markdown, "utf8");
  console.log(
    JSON.stringify(
      {
        reportPath: REPORT_PATH,
        products: report.overall.productCount,
        offers: report.overall.offerCount,
        categories: report.overall.categoryCount,
        groups: report.totalGroups,
        red: report.redGroups.length,
        yellow: report.yellowGroups.length,
      },
      null,
      2,
    ),
  );
}

async function buildPollutionReport() {
  const overallRows = await queryRows<OverallStatsRow>(`
    SELECT
      COUNT(*) as product_count,
      (SELECT COUNT(*) FROM supplier_offers) as offer_count,
      COUNT(DISTINCT COALESCE(category, '未分类')) as category_count
    FROM products
  `);

  const baseRows = await queryRows<BaseGroupRow>(`
    SELECT
      COALESCE(p.category, '未分类') as category,
      COALESCE(so.factory_name, '未填写工厂') as factory_name,
      COUNT(DISTINCT p.id) as product_count,
      COUNT(DISTINCT so.id) as offer_count,
      COUNT(DISTINCT CASE
        WHEN (p.remark IS NULL OR TRIM(p.remark) = '')
         AND (p.size IS NULL OR TRIM(p.size) = '')
         AND (p.image_path IS NULL OR TRIM(p.image_path) = '')
         AND NOT EXISTS (SELECT 1 FROM product_params pp WHERE pp.product_id = p.id)
        THEN p.id END) as hollow_count,
      COUNT(DISTINCT CASE
        WHEN p.product_name NOT GLOB '*[a-zA-Z]*'
         AND p.product_name NOT GLOB '*[一-鿿]*'
        THEN p.id END) as numeric_name_count,
      COUNT(DISTINCT CASE
        WHEN p.product_name = p.model_no THEN p.id END) as name_eq_model_count
    FROM products p
    JOIN supplier_offers so ON so.product_id = p.id
    GROUP BY p.category, so.factory_name
  `);

  const paramRows = await queryRows<ParamCoverageRow>(`
    SELECT
      COALESCE(p.category, '未分类') as category,
      COALESCE(so.factory_name, '未填写工厂') as factory_name,
      COUNT(DISTINCT p.id) as product_count,
      COUNT(DISTINCT pp.product_id) as with_params_count
    FROM products p
    JOIN supplier_offers so ON so.product_id = p.id
    LEFT JOIN product_params pp ON pp.product_id = p.id
    GROUP BY p.category, so.factory_name
  `);

  const priceRows = await queryRows<PriceConcentrationRow>(`
    WITH price_ranked AS (
      SELECT
        COALESCE(p.category, '未分类') as category,
        COALESCE(so.factory_name, '未填写工厂') as factory_name,
        CAST(so.purchase_price AS INTEGER) as price_int,
        COUNT(*) as cnt,
        ROW_NUMBER() OVER (
          PARTITION BY p.category, so.factory_name
          ORDER BY COUNT(*) DESC
        ) as rn
      FROM supplier_offers so
      JOIN products p ON so.product_id = p.id
      GROUP BY p.category, so.factory_name, price_int
    )
    SELECT
      category,
      factory_name,
      SUM(cnt) as total_offers,
      SUM(CASE WHEN rn <= 3 THEN cnt ELSE 0 END) as top3_count,
      GROUP_CONCAT(CASE WHEN rn <= 3 THEN price_int || ':' || cnt END, ', ') as top3_prices
    FROM price_ranked
    GROUP BY category, factory_name
  `);

  const roundRows = await queryRows<RoundThousandRow>(`
    SELECT
      COALESCE(p.category, '未分类') as category,
      COALESCE(so.factory_name, '未填写工厂') as factory_name,
      COUNT(*) as offer_count,
      SUM(CASE
        WHEN CAST(so.purchase_price AS INTEGER) IN (1000,2000,3000,5000,10000) THEN 1 ELSE 0
      END) as round_thousand_count
    FROM supplier_offers so
    JOIN products p ON so.product_id = p.id
    GROUP BY p.category, so.factory_name
  `);

  const quoteRows = await queryRows<QuoteReferenceRow>(`
    SELECT
      COALESCE(p.category, '未分类') as category,
      COALESCE(so.factory_name, '未填写工厂') as factory_name,
      COUNT(DISTINCT qi.id) as quote_item_count
    FROM products p
    JOIN supplier_offers so ON so.product_id = p.id
    LEFT JOIN quote_items qi ON qi.product_id = p.id AND qi.supplier_offer_id = so.id
    GROUP BY p.category, so.factory_name
  `);

  const categoryRows = await queryRows<CategorySummaryRow>(`
    SELECT
      COALESCE(p.category, '未分类') as category,
      COUNT(DISTINCT so.factory_name) as factory_count,
      COUNT(DISTINCT p.id) as product_count
    FROM products p
    LEFT JOIN supplier_offers so ON so.product_id = p.id
    GROUP BY p.category
    ORDER BY product_count DESC, category ASC
  `);

  const groups = mergeGroups(baseRows, paramRows, priceRows, roundRows, quoteRows)
    .filter((group) => group.productCount >= MIN_GROUP_PRODUCTS)
    .map((group) => {
      const score = computePollutionScore(group);
      const severity = classifySeverity(score, hasPrimaryPollutionSignal(group));
      return { ...group, score, severity };
    })
    .sort((a, b) => b.score - a.score || b.productCount - a.productCount || a.category.localeCompare(b.category));

  const flaggedGroups = groups.filter((group) => group.severity !== "normal");
  for (const group of flaggedGroups) {
    group.samples = await loadSamples(group.category, group.factoryName);
  }

  const redGroups = flaggedGroups.filter((group) => group.severity === "red");
  const yellowGroups = flaggedGroups.filter((group) => group.severity === "yellow");
  const categorySummary = buildCategorySummary(categoryRows, redGroups, yellowGroups);
  const overall = {
    productCount: toNumber(overallRows[0]?.product_count),
    offerCount: toNumber(overallRows[0]?.offer_count),
    categoryCount: toNumber(overallRows[0]?.category_count),
  };

  return {
    overall,
    totalGroups: groups.length,
    redGroups,
    yellowGroups,
    markdown: buildMarkdown({
      generatedAt: new Date(),
      overall,
      totalGroups: groups.length,
      redGroups,
      yellowGroups,
      categorySummary,
    }),
  };
}

function mergeGroups(
  baseRows: BaseGroupRow[],
  paramRows: ParamCoverageRow[],
  priceRows: PriceConcentrationRow[],
  roundRows: RoundThousandRow[],
  quoteRows: QuoteReferenceRow[],
): GroupStats[] {
  const groups = new Map<string, GroupStats>();

  for (const row of baseRows) {
    groups.set(groupKey(row.category, row.factory_name), {
      category: row.category,
      factoryName: row.factory_name,
      productCount: toNumber(row.product_count),
      offerCount: toNumber(row.offer_count),
      hollowCount: toNumber(row.hollow_count),
      numericNameCount: toNumber(row.numeric_name_count),
      nameEqModelCount: toNumber(row.name_eq_model_count),
      withParamsCount: 0,
      totalOffers: toNumber(row.offer_count),
      top3Count: 0,
      top3Prices: "",
      roundThousandCount: 0,
      quoteItemCount: 0,
      score: 0,
      severity: "normal",
      samples: [],
    });
  }

  for (const row of paramRows) {
    const group = groups.get(groupKey(row.category, row.factory_name));
    if (group) {
      group.withParamsCount = toNumber(row.with_params_count);
    }
  }

  for (const row of priceRows) {
    const group = groups.get(groupKey(row.category, row.factory_name));
    if (group) {
      group.totalOffers = toNumber(row.total_offers);
      group.top3Count = toNumber(row.top3_count);
      group.top3Prices = row.top3_prices ?? "";
    }
  }

  for (const row of roundRows) {
    const group = groups.get(groupKey(row.category, row.factory_name));
    if (group) {
      group.roundThousandCount = toNumber(row.round_thousand_count);
    }
  }

  for (const row of quoteRows) {
    const group = groups.get(groupKey(row.category, row.factory_name));
    if (group) {
      group.quoteItemCount = toNumber(row.quote_item_count);
    }
  }

  return [...groups.values()];
}

export function computePollutionScore(group: Pick<GroupStats, "productCount" | "hollowCount" | "numericNameCount" | "nameEqModelCount" | "withParamsCount" | "top3Count" | "totalOffers" | "roundThousandCount" | "offerCount" | "quoteItemCount">): number {
  let score = 0;
  const hollowRate = rate(group.hollowCount, group.productCount);
  const numericNameRate = rate(group.numericNameCount, group.productCount);
  const nameEqModelRate = rate(group.nameEqModelCount, group.productCount);
  const noParamsRate = 1 - rate(group.withParamsCount, group.productCount);
  const top3Concentration = rate(group.top3Count, group.totalOffers);
  const roundThousandRate = rate(group.roundThousandCount, group.offerCount);

  if (hollowRate > 0.8) score += 30;
  else if (hollowRate > 0.5) score += 15;

  if (numericNameRate > 0.5) score += 25;
  else if (numericNameRate > 0.2) score += 10;

  if (nameEqModelRate > 0.8) score += 15;
  if (top3Concentration > 0.8 && group.totalOffers > 10) score += 15;
  if (roundThousandRate > 0.5) score += 15;
  if (noParamsRate > 0.9) score += 10;
  if (group.quoteItemCount === 0) score += 5;

  return score;
}

function hasPrimaryPollutionSignal(group: GroupStats): boolean {
  return (
    rate(group.hollowCount, group.productCount) > 0.5 ||
    rate(group.numericNameCount, group.productCount) > 0.2 ||
    (rate(group.top3Count, group.totalOffers) > 0.8 && group.totalOffers > 10) ||
    rate(group.roundThousandCount, group.offerCount) > 0.5
  );
}

function classifySeverity(score: number, hasPrimarySignal: boolean): GroupStats["severity"] {
  if (!hasPrimarySignal) {
    return "normal";
  }
  if (score >= 50) {
    return "red";
  }
  if (score >= 30) {
    return "yellow";
  }
  return "normal";
}

async function loadSamples(category: string, factoryName: string): Promise<ProductSampleRow[]> {
  return queryRows<ProductSampleRow>(`
    SELECT p.product_name, p.model_no, so.purchase_price
    FROM products p
    JOIN supplier_offers so ON so.product_id = p.id
    WHERE COALESCE(p.category, '未分类') = ${sqlString(category)}
      AND COALESCE(so.factory_name, '未填写工厂') = ${sqlString(factoryName)}
    ORDER BY p.product_name
    LIMIT 5
  `);
}

function buildCategorySummary(
  categoryRows: CategorySummaryRow[],
  redGroups: GroupStats[],
  yellowGroups: GroupStats[],
): CategorySummary[] {
  const redByCategory = countByCategory(redGroups);
  const yellowByCategory = countByCategory(yellowGroups);

  return categoryRows.map((row) => ({
    category: row.category,
    factoryCount: toNumber(row.factory_count),
    productCount: toNumber(row.product_count),
    redCount: redByCategory.get(row.category) ?? 0,
    yellowCount: yellowByCategory.get(row.category) ?? 0,
  }));
}

function countByCategory(groups: GroupStats[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const group of groups) {
    result.set(group.category, (result.get(group.category) ?? 0) + 1);
  }
  return result;
}

function buildMarkdown(input: {
  generatedAt: Date;
  overall: { productCount: number; offerCount: number; categoryCount: number };
  totalGroups: number;
  redGroups: GroupStats[];
  yellowGroups: GroupStats[];
  categorySummary: CategorySummary[];
}): string {
  const normalGroups = input.totalGroups - input.redGroups.length - input.yellowGroups.length;

  return [
    "# V2.19B 全品类污染扫描报告",
    "",
    `Generated: ${input.generatedAt.toISOString()}`,
    `扫描范围: ${formatInteger(input.overall.productCount)} 产品 / ${formatInteger(input.overall.offerCount)} offers / ${formatInteger(
      input.overall.categoryCount,
    )} 品类`,
    "",
    "## 总结",
    "",
    `- 扫描组合数: ${formatInteger(input.totalGroups)}（category × factory，≥${MIN_GROUP_PRODUCTS} 产品）`,
    `- 🔴 高度疑似: ${formatInteger(input.redGroups.length)} 组`,
    `- 🟡 需审查: ${formatInteger(input.yellowGroups.length)} 组`,
    `- 正常或弱信号: ${formatInteger(normalGroups)} 组`,
    "",
    "说明：评分按任务定义计算；为减少误报，进入报告还需要至少一个强污染信号（空壳率/数字编码名率/价格集中度/整千价格率）。单独的 `name=model`、无报价引用、缺参数不会进入报告。",
    "",
    "## 🔴 高度疑似污染",
    "",
    input.redGroups.length > 0 ? renderDetailedGroups(input.redGroups) : "无",
    "",
    "## 🟡 需人工审查",
    "",
    input.yellowGroups.length > 0 ? renderDetailedGroups(input.yellowGroups) : "无",
    "",
    "## 附录：按品类汇总",
    "",
    "| 品类 | 工厂数 | 产品总数 | 🔴 | 🟡 | 占比 |",
    "|---|---:|---:|---:|---:|---:|",
    ...input.categorySummary.map((row) => {
      const flagged = row.redCount + row.yellowCount;
      return `| ${escapeMarkdown(row.category)} | ${formatInteger(row.factoryCount)} | ${formatInteger(row.productCount)} | ${formatInteger(
        row.redCount,
      )} | ${formatInteger(row.yellowCount)} | ${formatPercent(flagged, row.factoryCount)} |`;
    }),
    "",
  ].join("\n");
}

function renderDetailedGroups(groups: GroupStats[]): string {
  return groups.map((group, index) => renderDetailedGroup(group, index + 1)).join("\n\n---\n\n");
}

function renderDetailedGroup(group: GroupStats, rank: number): string {
  return [
    `### ${rank}. ${group.category} — ${group.factoryName}（score: ${group.score}）`,
    "",
    "| 指标 | 值 |",
    "|---|---|",
    `| 产品数 | ${formatInteger(group.productCount)} |`,
    `| Offer 数 | ${formatInteger(group.offerCount)} |`,
    `| 空壳率 | ${formatPercent(group.hollowCount, group.productCount)} (${formatInteger(group.hollowCount)} / ${formatInteger(
      group.productCount,
    )}) |`,
    `| 数字编码名率 | ${formatPercent(group.numericNameCount, group.productCount)} (${formatInteger(group.numericNameCount)} / ${formatInteger(
      group.productCount,
    )}) |`,
    `| name=model 率 | ${formatPercent(group.nameEqModelCount, group.productCount)} (${formatInteger(group.nameEqModelCount)} / ${formatInteger(
      group.productCount,
    )}) |`,
    `| 参数覆盖 | ${formatPercent(group.withParamsCount, group.productCount)} (${formatInteger(group.withParamsCount)} / ${formatInteger(
      group.productCount,
    )}) |`,
    `| 前 3 价格集中度 | ${formatPercent(group.top3Count, group.totalOffers)} (${formatInteger(group.top3Count)} / ${formatInteger(
      group.totalOffers,
    )}; ${escapeMarkdown(group.top3Prices || "-")}) |`,
    `| 整千价格率 | ${formatPercent(group.roundThousandCount, group.offerCount)} (${formatInteger(group.roundThousandCount)} / ${formatInteger(
      group.offerCount,
    )}) |`,
    `| quote_items 引用 | ${formatInteger(group.quoteItemCount)} |`,
    "",
    "产品名采样（前 5）:",
    "",
    "| product_name | model_no | purchase_price |",
    "|---|---|---:|",
    ...group.samples.map(
      (sample) =>
        `| ${escapeMarkdown(sample.product_name)} | ${escapeMarkdown(sample.model_no ?? "-")} | ${escapeMarkdown(
          String(sample.purchase_price ?? "-"),
        )} |`,
    ),
  ].join("\n");
}

async function queryRows<T>(sql: string): Promise<T[]> {
  const { stdout } = await execFileAsync("sqlite3", ["-json", DB_PATH, sql], {
    maxBuffer: 50 * 1024 * 1024,
  });
  const trimmed = stdout.trim();
  if (!trimmed) {
    return [];
  }
  return JSON.parse(trimmed) as T[];
}

function groupKey(category: string, factoryName: string): string {
  return `${category}\u0000${factoryName}`;
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function toNumber(value: number | null | undefined): number {
  return value ?? 0;
}

function rate(numerator: number, denominator: number): number {
  if (denominator <= 0) {
    return 0;
  }
  return numerator / denominator;
}

function formatInteger(value: number): string {
  return value.toLocaleString("en-US");
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
