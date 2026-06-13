import { writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);
const REPORT_PATH = "docs/v2.19a-ruixue-audit.md";
const DB_PATH = "prisma/dev.db";
const TARGET_CATEGORY = "净化灯";
const TARGET_FACTORY_PATTERN = "瑞雪%";

type CountRow = { count: bigint | number | null };
type BasicStatsRow = {
  product_count: bigint | number | null;
  offer_count: bigint | number | null;
  product_with_image_count: bigint | number | null;
  has_remark: bigint | number | null;
  has_size: bigint | number | null;
};
type SourceFileRow = {
  file_id: string | null;
  file_name: string | null;
  relative_path: string | null;
  offer_count: bigint | number | null;
};
type SampleRow = {
  product_name: string;
  model_no: string | null;
  purchase_price: string | number | { toString(): string };
};
type QuoteItemRow = {
  quote_id: string;
  customer_name: string;
  product_name: string;
  model_no: string | null;
  offer_id: string;
};
type ImagePathRow = {
  product_id: string;
  product_name: string;
  model_no: string | null;
  image_path: string | null;
};
type PriceDistributionRow = {
  price: string | number | null;
  cnt: bigint | number | null;
};
type RemainingStatsRow = {
  product_count: bigint | number | null;
  offer_count: bigint | number | null;
  image_count: bigint | number | null;
  param_product_count: bigint | number | null;
  size_count: bigint | number | null;
  ctn_offer_count: bigint | number | null;
};

type AuditData = {
  generatedAt: Date;
  basicStats: BasicStatsRow;
  sourceFiles: SourceFileRow[];
  sampleRows: SampleRow[];
  quoteItemCount: number;
  quoteItemRows: QuoteItemRow[];
  productParamCount: number;
  priceHistoryCount: number;
  imageRows: ImagePathRow[];
  priceDistribution: PriceDistributionRow[];
  purificationBefore: RemainingStatsRow;
  purificationAfter: RemainingStatsRow;
};

async function main() {
  const data = await loadAuditData();
  await writeFile(REPORT_PATH, buildMarkdownReport(data), "utf8");
  console.log(
    JSON.stringify(
      {
        reportPath: REPORT_PATH,
        products: toNumber(data.basicStats.product_count),
        offers: toNumber(data.basicStats.offer_count),
        quoteItems: data.quoteItemCount,
        productParams: data.productParamCount,
        priceHistory: data.priceHistoryCount,
        imagePaths: data.imageRows.length,
      },
      null,
      2,
    ),
  );
}

export async function loadAuditData(): Promise<AuditData> {
  const category = sqlString(TARGET_CATEGORY);
  const factoryPattern = sqlString(TARGET_FACTORY_PATTERN);

  const basicStatsRows = await queryRows<BasicStatsRow>(`
      SELECT
        COUNT(DISTINCT p.id) as product_count,
        COUNT(DISTINCT so.id) as offer_count,
        COUNT(DISTINCT CASE WHEN p.image_path IS NOT NULL AND TRIM(p.image_path) != '' THEN p.id END) as product_with_image_count,
        COUNT(DISTINCT CASE WHEN p.remark IS NOT NULL AND TRIM(p.remark) != '' THEN p.id END) as has_remark,
        COUNT(DISTINCT CASE WHEN p.size IS NOT NULL AND TRIM(p.size) != '' THEN p.id END) as has_size
      FROM products p
      JOIN supplier_offers so ON so.product_id = p.id
      WHERE p.category = ${category}
        AND so.factory_name LIKE ${factoryPattern}
    `);

  const sourceFiles = await queryRows<SourceFileRow>(`
      SELECT
        f.id as file_id,
        f.file_name,
        f.relative_path,
        COUNT(so.id) as offer_count
      FROM supplier_offers so
      JOIN products p ON so.product_id = p.id
      LEFT JOIN files f ON so.source_file_id = f.id
      WHERE p.category = ${category}
        AND so.factory_name LIKE ${factoryPattern}
      GROUP BY f.id, f.file_name, f.relative_path
      ORDER BY offer_count DESC, f.file_name ASC
    `);

  const sampleRows = await queryRows<SampleRow>(`
      SELECT p.product_name, p.model_no, so.purchase_price
      FROM products p
      JOIN supplier_offers so ON so.product_id = p.id
      WHERE p.category = ${category}
        AND so.factory_name LIKE ${factoryPattern}
      ORDER BY p.product_name
      LIMIT 20
    `);

  const quoteItemCountRows = await queryRows<CountRow>(`
      SELECT COUNT(DISTINCT qi.id) as count
      FROM quote_items qi
      JOIN supplier_offers so ON qi.supplier_offer_id = so.id
      JOIN products p ON qi.product_id = p.id
      WHERE p.category = ${category}
        AND so.factory_name LIKE ${factoryPattern}
    `);

  const quoteItemRows = await queryRows<QuoteItemRow>(`
      SELECT qi.quote_id, q.customer_name, p.product_name, p.model_no, so.id as offer_id
      FROM quote_items qi
      JOIN quotes q ON qi.quote_id = q.id
      JOIN supplier_offers so ON qi.supplier_offer_id = so.id
      JOIN products p ON qi.product_id = p.id
      WHERE p.category = ${category}
        AND so.factory_name LIKE ${factoryPattern}
      ORDER BY q.created_at DESC, p.product_name ASC
    `);

  const productParamCountRows = await queryRows<CountRow>(`
      SELECT COUNT(DISTINCT pp.id) as count
      FROM product_params pp
      JOIN products p ON pp.product_id = p.id
      JOIN supplier_offers so ON so.product_id = p.id
      WHERE p.category = ${category}
        AND so.factory_name LIKE ${factoryPattern}
    `);

  const priceHistoryCountRows = await queryRows<CountRow>(`
      SELECT COUNT(DISTINCT ph.id) as count
      FROM price_history ph
      JOIN supplier_offers so ON ph.supplier_offer_id = so.id
      JOIN products p ON so.product_id = p.id
      WHERE p.category = ${category}
        AND so.factory_name LIKE ${factoryPattern}
    `);

  const imageRows = await queryRows<ImagePathRow>(`
      SELECT DISTINCT p.id as product_id, p.product_name, p.model_no, p.image_path
      FROM products p
      JOIN supplier_offers so ON so.product_id = p.id
      WHERE p.category = ${category}
        AND so.factory_name LIKE ${factoryPattern}
        AND p.image_path IS NOT NULL
        AND TRIM(p.image_path) != ''
      ORDER BY p.product_name
    `);

  const priceDistribution = await queryRows<PriceDistributionRow>(`
      SELECT CAST(so.purchase_price AS INTEGER) as price, COUNT(*) as cnt
      FROM supplier_offers so
      JOIN products p ON so.product_id = p.id
      WHERE p.category = ${category}
        AND so.factory_name LIKE ${factoryPattern}
      GROUP BY CAST(so.purchase_price AS INTEGER)
      ORDER BY cnt DESC, price ASC
      LIMIT 10
    `);

  const purificationBeforeRows = await queryRows<RemainingStatsRow>(`
      WITH target_products AS (
        SELECT id, image_path, size
        FROM products
        WHERE category = ${category}
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
    `);

  const purificationAfterRows = await queryRows<RemainingStatsRow>(`
      WITH suspect_products AS (
        SELECT DISTINCT bad_p.id
        FROM products bad_p
        JOIN supplier_offers bad_so ON bad_so.product_id = bad_p.id
        WHERE bad_p.category = ${category}
          AND bad_so.factory_name LIKE ${factoryPattern}
      ),
      target_products AS (
        SELECT id, image_path, size
        FROM products
        WHERE category = ${category}
          AND id NOT IN (SELECT id FROM suspect_products)
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
    `);

  return {
    generatedAt: new Date(),
    basicStats: basicStatsRows[0] ?? emptyBasicStats(),
    sourceFiles,
    sampleRows,
    quoteItemCount: toNumber(quoteItemCountRows[0]?.count),
    quoteItemRows,
    productParamCount: toNumber(productParamCountRows[0]?.count),
    priceHistoryCount: toNumber(priceHistoryCountRows[0]?.count),
    imageRows,
    priceDistribution,
    purificationBefore: purificationBeforeRows[0] ?? emptyRemainingStats(),
    purificationAfter: purificationAfterRows[0] ?? emptyRemainingStats(),
  };
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

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function buildMarkdownReport(data: AuditData): string {
  const productCount = toNumber(data.basicStats.product_count);
  const offerCount = toNumber(data.basicStats.offer_count);
  const imageCount = toNumber(data.basicStats.product_with_image_count);
  const hasRemark = toNumber(data.basicStats.has_remark);
  const hasSize = toNumber(data.basicStats.has_size);
  const sourceFileLabel =
    data.sourceFiles.length > 0
      ? data.sourceFiles
          .map((file) => `${file.relative_path ?? file.file_name ?? "source_file_id NULL"} (${toNumber(file.offer_count)} offers)`)
          .join("<br>")
      : "未找到 source_file_id";
  const deleteSafety = data.quoteItemCount === 0 ? "安全删除候选" : "有报价引用，不能直接删除";

  return [
    "# V2.19A 瑞雪净化灯污染审计报告",
    "",
    `Generated: ${data.generatedAt.toISOString()}`,
    "",
    "## 范围",
    "",
    "- 工厂: 瑞雪*",
    "- 品类: 净化灯",
    `- 源文件: ${sourceFileLabel}`,
    "",
    "## 1. 基本统计",
    "",
    "| 指标 | 数量 |",
    "|---|---:|",
    `| 产品 | ${formatInteger(productCount)} |`,
    `| Offer | ${formatInteger(offerCount)} |`,
    `| 有图片产品 | ${formatInteger(imageCount)} |`,
    `| 有 remark 产品 | ${formatInteger(hasRemark)} |`,
    `| 有 size 产品 | ${formatInteger(hasSize)} |`,
    "",
    "## 2. 关联检查",
    "",
    "| 关联表 | 记录数 | 安全删除？ |",
    "|---|---:|---|",
    `| quote_items | ${formatInteger(data.quoteItemCount)} | ${data.quoteItemCount === 0 ? "✅" : "❌ 有引用，不能直接删"} |`,
    `| product_params | ${formatInteger(data.productParamCount)} | ${data.quoteItemCount === 0 ? "✅ 可随产品级联/先删" : "⚠️ 需保留被引用产品"} |`,
    `| price_history | ${formatInteger(data.priceHistoryCount)} | ${data.quoteItemCount === 0 ? "✅ 可随 offer 级联/先删" : "⚠️ 需保留被引用 offer"} |`,
    "",
    renderQuoteItemSection(data.quoteItemRows),
    "",
    "## 3. 产品名采样（前 20）",
    "",
    "| product_name | model_no | purchase_price |",
    "|---|---|---:|",
    ...data.sampleRows.map(
      (row) =>
        `| ${escapeMarkdown(row.product_name)} | ${escapeMarkdown(row.model_no ?? "-")} | ${formatPrice(row.purchase_price)} |`,
    ),
    "",
    "## 4. 价格分布",
    "",
    "| 价格 (RMB) | 数量 |",
    "|---:|---:|",
    ...data.priceDistribution.map(
      (row) => `| ${formatPrice(row.price ?? "-")} | ${formatInteger(toNumber(row.cnt))} |`,
    ),
    "",
    "## 5. 图片路径",
    "",
    renderImagePathSection(data.imageRows),
    "",
    "## 6. 删除后预估",
    "",
    "| 指标 | 删前 | 删后 | 变化 |",
    "|---|---:|---:|---:|",
    renderCountChange("净化灯产品数", data.purificationBefore.product_count, data.purificationAfter.product_count),
    renderCountChange("净化灯 Offer 数", data.purificationBefore.offer_count, data.purificationAfter.offer_count),
    renderCoverageChange(
      "图片覆盖",
      data.purificationBefore.image_count,
      data.purificationBefore.product_count,
      data.purificationAfter.image_count,
      data.purificationAfter.product_count,
    ),
    renderCoverageChange(
      "参数覆盖",
      data.purificationBefore.param_product_count,
      data.purificationBefore.product_count,
      data.purificationAfter.param_product_count,
      data.purificationAfter.product_count,
    ),
    renderCoverageChange(
      "Size 覆盖",
      data.purificationBefore.size_count,
      data.purificationBefore.product_count,
      data.purificationAfter.size_count,
      data.purificationAfter.product_count,
    ),
    renderCoverageChange(
      "CTN 覆盖",
      data.purificationBefore.ctn_offer_count,
      data.purificationBefore.offer_count,
      data.purificationAfter.ctn_offer_count,
      data.purificationAfter.offer_count,
    ),
    "",
    "## 7. 结论",
    "",
    `- 结论: ${deleteSafety}`,
    `- 命中范围: ${formatInteger(productCount)} products / ${formatInteger(offerCount)} offers`,
    `- quote_items 引用: ${formatInteger(data.quoteItemCount)}`,
    `- 关联 product_params: ${formatInteger(data.productParamCount)}`,
    `- 关联 price_history: ${formatInteger(data.priceHistoryCount)}`,
    `- 图片路径记录: ${formatInteger(data.imageRows.length)}`,
    "",
    data.quoteItemCount === 0
      ? "建议下一步：备份 DB 后执行删除方案；删除 products/offers 前明确处理 product_params、price_history 和 image_path 引用。源 Excel 文件不动。"
      : "建议下一步：先人工审查 quote_items 引用，不能直接删除被历史报价引用的 offer/product。",
    "",
  ].join("\n");
}

function renderQuoteItemSection(rows: QuoteItemRow[]): string {
  if (rows.length === 0) {
    return "quote_items 明细：无";
  }

  return [
    "quote_items 明细：",
    "",
    "| quote_id | customer | product_name | model_no | offer_id |",
    "|---|---|---|---|---|",
    ...rows.map(
      (row) =>
        `| ${row.quote_id} | ${escapeMarkdown(row.customer_name)} | ${escapeMarkdown(row.product_name)} | ${escapeMarkdown(
          row.model_no ?? "-",
        )} | ${row.offer_id} |`,
    ),
  ].join("\n");
}

function renderImagePathSection(rows: ImagePathRow[]): string {
  if (rows.length === 0) {
    return "无";
  }

  return [
    `共 ${formatInteger(rows.length)} 条有 image_path：`,
    "",
    "| product_id | product_name | model_no | image_path |",
    "|---|---|---|---|",
    ...rows.map(
      (row) =>
        `| ${row.product_id} | ${escapeMarkdown(row.product_name)} | ${escapeMarkdown(row.model_no ?? "-")} | ${escapeMarkdown(
          row.image_path ?? "-",
        )} |`,
    ),
  ].join("\n");
}

function renderCountChange(label: string, beforeValue: bigint | number | null, afterValue: bigint | number | null): string {
  const before = toNumber(beforeValue);
  const after = toNumber(afterValue);
  return `| ${label} | ${formatInteger(before)} | ${formatInteger(after)} | ${formatSignedInteger(after - before)} |`;
}

function renderCoverageChange(
  label: string,
  beforeNumerator: bigint | number | null,
  beforeDenominator: bigint | number | null,
  afterNumerator: bigint | number | null,
  afterDenominator: bigint | number | null,
): string {
  const beforeNum = toNumber(beforeNumerator);
  const beforeDen = toNumber(beforeDenominator);
  const afterNum = toNumber(afterNumerator);
  const afterDen = toNumber(afterDenominator);
  const beforeRate = rate(beforeNum, beforeDen);
  const afterRate = rate(afterNum, afterDen);
  return `| ${label} | ${formatPercent(beforeRate)} (${formatInteger(beforeNum)} / ${formatInteger(beforeDen)}) | ${formatPercent(
    afterRate,
  )} (${formatInteger(afterNum)} / ${formatInteger(afterDen)}) | ${formatSignedPercent(afterRate - beforeRate)} |`;
}

function emptyBasicStats(): BasicStatsRow {
  return {
    product_count: 0,
    offer_count: 0,
    product_with_image_count: 0,
    has_remark: 0,
    has_size: 0,
  };
}

function emptyRemainingStats(): RemainingStatsRow {
  return {
    product_count: 0,
    offer_count: 0,
    image_count: 0,
    param_product_count: 0,
    size_count: 0,
    ctn_offer_count: 0,
  };
}

function toNumber(value: bigint | number | null | undefined): number {
  if (typeof value === "bigint") {
    return Number(value);
  }
  return value ?? 0;
}

function rate(numerator: number, denominator: number): number {
  if (denominator <= 0) {
    return 0;
  }
  return numerator / denominator;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}

function formatSignedPercent(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatPercent(value)}`;
}

function formatInteger(value: number): string {
  return value.toLocaleString("en-US");
}

function formatSignedInteger(value: number): string {
  return `${value > 0 ? "+" : ""}${formatInteger(value)}`;
}

function formatPrice(value: string | number | { toString(): string }): string {
  return value.toString();
}

function escapeMarkdown(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
