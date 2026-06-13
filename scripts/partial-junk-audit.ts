import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);

const DB_PATH = "prisma/dev.db";
const REPORT_PATH = "docs/v2.19d-partial-junk-audit.md";

const TARGET_GROUPS = [
  { category: "灯带", factoryName: "尼奥" },
  { category: "面板灯", factoryName: "瑞鑫" },
  { category: "工作灯", factoryName: "启阳" },
] as const;

type Classification = "junk" | "suspect" | "keep";

type ProductRow = {
  id: string;
  product_name: string;
  model_no: string | null;
  category: string;
  factory_name: string;
  purchase_price: string | number | null;
  image_path: string | null;
  remark: string | null;
  size: string | null;
  param_count: number | null;
  quote_item_count: number | null;
  total_offer_count: number | null;
};

type ClassifiedProduct = ProductRow & {
  classification: Classification;
  reasons: string[];
};

type GroupReport = {
  index: number;
  category: string;
  factoryName: string;
  products: ClassifiedProduct[];
  junk: ClassifiedProduct[];
  suspect: ClassifiedProduct[];
  keep: ClassifiedProduct[];
  referenced: ClassifiedProduct[];
};

type SummaryRow = {
  index: number;
  category: string;
  factoryName: string;
  productCount: number;
  junkCount: number;
  suspectCount: number;
  keepCount: number;
};

async function main() {
  const groups = await Promise.all(
    TARGET_GROUPS.map(async (target, index) => {
      const products = (await loadProducts(target.category, target.factoryName)).map(classifyProduct);
      return buildGroupReport(index + 1, target.category, target.factoryName, products);
    }),
  );

  const markdown = buildMarkdown(groups);
  await writeFile(REPORT_PATH, markdown, "utf8");

  const total = summarizeTotals(groups);
  console.log(
    JSON.stringify(
      {
        reportPath: REPORT_PATH,
        products: total.productCount,
        junk: total.junkCount,
        suspect: total.suspectCount,
        keep: total.keepCount,
      },
      null,
      2,
    ),
  );
}

async function loadProducts(category: string, factoryName: string): Promise<ProductRow[]> {
  return queryRows<ProductRow>(`
    SELECT
      p.id,
      p.product_name,
      p.model_no,
      p.category,
      ${sqlString(factoryName)} as factory_name,
      MIN(so.purchase_price) as purchase_price,
      p.image_path,
      p.remark,
      p.size,
      (SELECT COUNT(*) FROM product_params pp WHERE pp.product_id = p.id) as param_count,
      (SELECT COUNT(*) FROM quote_items qi WHERE qi.product_id = p.id) as quote_item_count,
      (SELECT COUNT(*) FROM supplier_offers so2 WHERE so2.product_id = p.id) as total_offer_count
    FROM products p
    JOIN supplier_offers so ON so.product_id = p.id
    WHERE p.category = ${sqlString(category)}
      AND so.factory_name = ${sqlString(factoryName)}
    GROUP BY p.id
    ORDER BY p.product_name
  `);
}

export function classifyProduct(product: ProductRow): ClassifiedProduct {
  const junkReasons = getJunkReasons(product);
  if (junkReasons.length > 0) {
    return {
      ...product,
      classification: "junk",
      reasons: junkReasons,
    };
  }

  const suspectReasons = getSuspectReasons(product);
  if (suspectReasons.length > 0) {
    return {
      ...product,
      classification: "suspect",
      reasons: suspectReasons,
    };
  }

  return {
    ...product,
    classification: "keep",
    reasons: [],
  };
}

function getJunkReasons(product: ProductRow): string[] {
  const name = normalizeText(product.product_name);
  const reasons: string[] = [];

  if (!/[a-zA-Z\u4e00-\u9fff]/.test(name)) {
    reasons.push("不含中文或英文字母");
  }
  if (/^[¥￥]/.test(name)) {
    reasons.push("价格文本当产品名");
  }
  if (/^另[:：]/.test(name)) {
    reasons.push("备注行当产品名");
  }
  if (/^(内盒|外箱)/.test(name)) {
    reasons.push("包装备注当产品名");
  }
  if (/^\d+PCS$/i.test(name)) {
    reasons.push("MOQ 当产品名");
  }
  if (/^\d+W（.*）$/.test(name)) {
    reasons.push("功率规格当产品名");
  }
  if (/V.*MAH.*battery/i.test(name)) {
    reasons.push("电池配件非成品");
  }

  return reasons;
}

function getSuspectReasons(product: ProductRow): string[] {
  const name = normalizeText(product.product_name);
  const modelNo = normalizeText(product.model_no ?? "");
  const price = parsePrice(product.purchase_price);
  const reasons: string[] = [];

  if (price == null || price === 0) {
    reasons.push("价格为 0 或空");
  }
  if (
    name === modelNo &&
    !hasText(product.image_path) &&
    toNumber(product.param_count) === 0
  ) {
    reasons.push("name=model 且无图片/参数");
  }
  if (price != null && product.category === "灯带" && price > 5000) {
    reasons.push("灯带价格异常高");
  }
  if (price != null && (product.category === "面板灯" || product.category === "工作灯") && price > 2000) {
    reasons.push(`${product.category} 价格异常高`);
  }

  return reasons;
}

function buildGroupReport(
  index: number,
  category: string,
  factoryName: string,
  products: ClassifiedProduct[],
): GroupReport {
  return {
    index,
    category,
    factoryName,
    products,
    junk: products.filter((product) => product.classification === "junk"),
    suspect: products.filter((product) => product.classification === "suspect"),
    keep: products.filter((product) => product.classification === "keep"),
    referenced: products.filter((product) => toNumber(product.quote_item_count) > 0),
  };
}

function buildMarkdown(groups: GroupReport[]): string {
  const totals = summarizeTotals(groups);

  return [
    "# V2.19D 部分垃圾逐条审计报告",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## 总结",
    "",
    "| 组 | 品类 | 工厂 | 产品数 | junk | suspect | keep |",
    "|---|---|---|---:|---:|---:|---:|",
    ...groups.map(
      (group) =>
        `| ${group.index} | ${escapeMarkdown(group.category)} | ${escapeMarkdown(group.factoryName)} | ${formatInteger(
          group.products.length,
        )} | ${formatInteger(group.junk.length)} | ${formatInteger(group.suspect.length)} | ${formatInteger(group.keep.length)} |`,
    ),
    `| 合计 |  |  | ${formatInteger(totals.productCount)} | ${formatInteger(totals.junkCount)} | ${formatInteger(
      totals.suspectCount,
    )} | ${formatInteger(totals.keepCount)} |`,
    "",
    ...groups.flatMap((group) => renderGroup(group)),
    "## quote_items 引用检查",
    "",
    "| 组 | 有引用的产品数 | 详情 |",
    "|---|---:|---|",
    ...groups.map((group) => {
      const details =
        group.referenced.length === 0
          ? "-"
          : group.referenced
              .map((product) => `${product.product_name} (${toNumber(product.quote_item_count)})`)
              .join("<br>");
      return `| ${escapeMarkdown(`${group.category} — ${group.factoryName}`)} | ${formatInteger(group.referenced.length)} | ${escapeMarkdown(
        details,
      )} |`;
    }),
    "",
  ].join("\n");
}

function renderGroup(group: GroupReport): string[] {
  return [
    `## 组 ${group.index}: ${group.category} — ${group.factoryName}`,
    "",
    `### junk（${group.junk.length}）`,
    "",
    "| product_name | model_no | price | 原因 |",
    "|---|---|---:|---|",
    ...renderJunkRows(group.junk),
    "",
    `### suspect（${group.suspect.length}）`,
    "",
    "| product_name | model_no | price | image | params | 原因 |",
    "|---|---|---:|---|---:|---|",
    ...renderSuspectRows(group.suspect),
    "",
    `### keep（${group.keep.length}）`,
    "",
    "| product_name | model_no | price | image | params | offers |",
    "|---|---|---:|---|---:|---:|",
    ...renderKeepRows(group.keep),
    "",
    "---",
    "",
  ];
}

function renderJunkRows(products: ClassifiedProduct[]): string[] {
  if (products.length === 0) {
    return ["| - | - | - | - |"];
  }
  return products.map(
    (product) =>
      `| ${escapeMarkdown(product.product_name)} | ${escapeMarkdown(product.model_no ?? "-")} | ${formatPrice(
        product.purchase_price,
      )} | ${escapeMarkdown(product.reasons.join("; "))} |`,
  );
}

function renderSuspectRows(products: ClassifiedProduct[]): string[] {
  if (products.length === 0) {
    return ["| - | - | - | - | - | - |"];
  }
  return products.map(
    (product) =>
      `| ${escapeMarkdown(product.product_name)} | ${escapeMarkdown(product.model_no ?? "-")} | ${formatPrice(
        product.purchase_price,
      )} | ${formatYesNo(hasText(product.image_path))} | ${formatInteger(toNumber(product.param_count))} | ${escapeMarkdown(
        product.reasons.join("; "),
      )} |`,
  );
}

function renderKeepRows(products: ClassifiedProduct[]): string[] {
  if (products.length === 0) {
    return ["| - | - | - | - | - | - |"];
  }
  return products.map(
    (product) =>
      `| ${escapeMarkdown(product.product_name)} | ${escapeMarkdown(product.model_no ?? "-")} | ${formatPrice(
        product.purchase_price,
      )} | ${formatYesNo(hasText(product.image_path))} | ${formatInteger(toNumber(product.param_count))} | ${formatInteger(
        toNumber(product.total_offer_count),
      )} |`,
  );
}

function summarizeTotals(groups: GroupReport[]): SummaryRow {
  return groups.reduce(
    (acc, group) => ({
      index: 0,
      category: "",
      factoryName: "",
      productCount: acc.productCount + group.products.length,
      junkCount: acc.junkCount + group.junk.length,
      suspectCount: acc.suspectCount + group.suspect.length,
      keepCount: acc.keepCount + group.keep.length,
    }),
    {
      index: 0,
      category: "",
      factoryName: "",
      productCount: 0,
      junkCount: 0,
      suspectCount: 0,
      keepCount: 0,
    },
  );
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

function normalizeText(value: string): string {
  return value.trim().normalize("NFC");
}

function hasText(value: string | null | undefined): boolean {
  return value != null && value.trim() !== "";
}

function parsePrice(value: string | number | null): number | null {
  if (value == null) {
    return null;
  }
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toNumber(value: number | null | undefined): number {
  return value ?? 0;
}

function formatPrice(value: string | number | null): string {
  if (value == null) {
    return "-";
  }
  return String(value);
}

function formatInteger(value: number): string {
  return value.toLocaleString("en-US");
}

function formatYesNo(value: boolean): string {
  return value ? "Y" : "N";
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
