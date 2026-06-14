import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const SOURCE_PRODUCT_ID = "b900170d-8a08-4ade-b76e-e82318d37555";
const REPORT_PATH = "docs/v6.0-48w-split-report.md";
const EXPECTED_AFTER = {
  products: 10039,
  offers: 11084,
  params: 37433,
};

type Mode = "dry-run" | "apply";

type SplitTarget = {
  factoryName: string;
  targetCategory: string;
  note?: string;
};

type CountSnapshot = {
  products: number;
  offers: number;
  params: number;
  priceHistory: number;
  quoteItems: number;
  customerQuoteRowsForSourceProduct: number;
  quoteItemsForSourceProductOrOffers: number;
};

type SourceOfferRow = {
  id: string;
  factory_name: string;
  purchase_price: number | string;
  currency: string;
  source_file_id: string | null;
  source_file_name: string | null;
  source_relative_path: string | null;
};

type ProductOfferCheckRow = {
  product_id: string;
  model_no: string | null;
  category: string | null;
  offer_count: number | bigint;
  factories: string;
};

type ReportData = {
  mode: Mode;
  generatedAt: string;
  backupPath: string | null;
  beforeCounts: CountSnapshot;
  afterCounts: CountSnapshot;
  sourceProduct: {
    id: string;
    productName: string;
    modelNo: string | null;
    category: string | null;
  };
  sourceOffersBefore: SourceOfferRow[];
  keepFactories: string[];
  splitTargets: SplitTarget[];
  plannedNewProductIds: Record<string, string>;
  postChecks: {
    sourceProductOffers: ProductOfferCheckRow[];
    newProductOffers: ProductOfferCheckRow[];
    priceHistoryCountUnchanged: boolean;
    productCountExpected: boolean;
    offerCountExpected: boolean;
    paramCountExpected: boolean;
  } | null;
  notes: string[];
};

const KEEP_FACTORIES = [
  "一群狼",
  "凯益德 面板灯报价20230510",
  "景上 单价不含税 含税+10个点",
  "瑞鑫",
];

const SPLIT_TARGETS: SplitTarget[] = [
  { factoryName: "中山呈明", targetCategory: "吸顶灯" },
  { factoryName: "合力", targetCategory: "球泡" },
  {
    factoryName: "鑫盟泰",
    targetCategory: "灯管",
    note: "源文件名为 T8玻璃灯管系列价格表，按灯管处理。",
  },
  { factoryName: "宏硕", targetCategory: "净化灯" },
  { factoryName: "普照", targetCategory: "三防灯" },
  { factoryName: "锐晶", targetCategory: "线条灯" },
  { factoryName: "鹏荣202410", targetCategory: "磁吸灯" },
];

async function main() {
  const mode: Mode = process.argv.includes("--apply") ? "apply" : "dry-run";
  const generatedAt = new Date();
  const beforeCounts = await getCountSnapshot();
  const sourceProduct = await prisma.product.findUnique({
    where: { id: SOURCE_PRODUCT_ID },
    select: {
      id: true,
      productName: true,
      modelNo: true,
      category: true,
    },
  });
  if (!sourceProduct) {
    throw new Error(`Source product not found: ${SOURCE_PRODUCT_ID}`);
  }

  const sourceOffersBefore = await getSourceOffers();
  validatePreflight(sourceOffersBefore, beforeCounts);

  const plannedNewProductIds = Object.fromEntries(SPLIT_TARGETS.map((target) => [target.factoryName, randomUUID()]));
  let backupPath: string | null = null;
  let postChecks: ReportData["postChecks"] = null;
  const notes = [
    "景上 单价不含税 含税+10个点：源路径在净化灯目录，但文件名为双色新款面板灯价格；本次按 V2.19G 判断保留在面板灯 48W。",
    "product_params 留在原面板灯 48W 产品，不复制到新产品。",
    "price_history 通过 supplier_offer_id 关联，不需要手动迁移。",
    "customer_quote_rows 不触碰。",
  ];

  if (mode === "apply") {
    backupPath = await backupDatabase(generatedAt);
    await applySplit(plannedNewProductIds);
    const afterCounts = await getCountSnapshot();
    postChecks = await getPostChecks(plannedNewProductIds, beforeCounts, afterCounts);

    const report = buildReport({
      mode,
      generatedAt: generatedAt.toISOString(),
      backupPath,
      beforeCounts,
      afterCounts,
      sourceProduct,
      sourceOffersBefore,
      keepFactories: KEEP_FACTORIES,
      splitTargets: SPLIT_TARGETS,
      plannedNewProductIds,
      postChecks,
      notes,
    });
    await writeFile(REPORT_PATH, report, "utf8");
    console.log(
      JSON.stringify(
        {
          mode,
          reportPath: REPORT_PATH,
          backupPath,
          productsBefore: beforeCounts.products,
          productsAfter: afterCounts.products,
          offersBefore: beforeCounts.offers,
          offersAfter: afterCounts.offers,
          paramsBefore: beforeCounts.params,
          paramsAfter: afterCounts.params,
          newProducts: Object.keys(plannedNewProductIds).length,
        },
        null,
        2,
      ),
    );
    return;
  }

  const report = buildReport({
    mode,
    generatedAt: generatedAt.toISOString(),
    backupPath,
    beforeCounts,
    afterCounts: beforeCounts,
    sourceProduct,
    sourceOffersBefore,
    keepFactories: KEEP_FACTORIES,
    splitTargets: SPLIT_TARGETS,
    plannedNewProductIds,
    postChecks,
    notes,
  });
  await writeFile(REPORT_PATH, report, "utf8");
  console.log(
    JSON.stringify(
      {
        mode,
        reportPath: REPORT_PATH,
        sourceOfferCount: sourceOffersBefore.length,
        plannedNewProducts: Object.keys(plannedNewProductIds).length,
        plannedMovedOffers: SPLIT_TARGETS.length,
      },
      null,
      2,
    ),
  );
}

async function backupDatabase(generatedAt: Date): Promise<string> {
  await mkdir("backups", { recursive: true });
  const timestamp = formatTimestamp(generatedAt);
  const backupPath = path.join("backups", `dev-before-v6.0-${timestamp}.sqlite`);
  await copyFile("prisma/dev.db", backupPath);
  return backupPath;
}

function formatTimestamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "");
}

async function getSourceOffers(): Promise<SourceOfferRow[]> {
  return prisma.$queryRaw<SourceOfferRow[]>`
    SELECT
      so.id,
      so.factory_name,
      so.purchase_price,
      so.currency,
      so.source_file_id,
      f.file_name AS source_file_name,
      f.relative_path AS source_relative_path
    FROM supplier_offers so
    LEFT JOIN files f ON f.id = so.source_file_id
    WHERE so.product_id = ${SOURCE_PRODUCT_ID}
    ORDER BY so.factory_name
  `;
}

function validatePreflight(sourceOffers: SourceOfferRow[], beforeCounts: CountSnapshot) {
  if (sourceOffers.length !== 11) {
    throw new Error(`Expected source product to have 11 offers before split, got ${sourceOffers.length}.`);
  }
  if (beforeCounts.customerQuoteRowsForSourceProduct !== 0) {
    throw new Error(
      `Expected source product to have 0 customer_quote_rows refs, got ${beforeCounts.customerQuoteRowsForSourceProduct}.`,
    );
  }
  if (beforeCounts.quoteItemsForSourceProductOrOffers !== 0) {
    throw new Error(
      `Expected source product/offers to have 0 quote_items refs, got ${beforeCounts.quoteItemsForSourceProductOrOffers}.`,
    );
  }

  const factories = new Set(sourceOffers.map((offer) => offer.factory_name));
  for (const factoryName of [...KEEP_FACTORIES, ...SPLIT_TARGETS.map((target) => target.factoryName)]) {
    if (!factories.has(factoryName)) {
      throw new Error(`Expected factory offer missing before split: ${factoryName}`);
    }
  }
}

async function applySplit(plannedNewProductIds: Record<string, string>) {
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    for (const target of SPLIT_TARGETS) {
      const productId = plannedNewProductIds[target.factoryName];
      await tx.product.create({
        data: {
          id: productId,
          productName: "48W",
          modelNo: "48W",
          category: target.targetCategory,
          imagePath: null,
          createdAt: now,
          updatedAt: now,
        },
      });
      await tx.supplierOffer.updateMany({
        where: {
          productId: SOURCE_PRODUCT_ID,
          factoryName: target.factoryName,
        },
        data: {
          productId,
        },
      });
      const migratedOfferCount = await tx.supplierOffer.count({
        where: {
          productId,
          factoryName: target.factoryName,
        },
      });
      if (migratedOfferCount !== 1) {
        throw new Error(`Expected to migrate exactly 1 offer for ${target.factoryName}, got ${migratedOfferCount}.`);
      }
    }
  });
}

async function getCountSnapshot(): Promise<CountSnapshot> {
  const sourceOfferIds = (await getSourceOfferIds()).map((row) => row.id);
  const [products, offers, params, priceHistory, quoteItems, customerQuoteRowsForSourceProduct, quoteItemsForSourceProductOrOffers] =
    await Promise.all([
    prisma.product.count(),
    prisma.supplierOffer.count(),
    prisma.productParam.count(),
    prisma.priceHistory.count(),
    prisma.quoteItem.count(),
    countCustomerQuoteRowsForSourceProduct(),
    countQuoteItemsForSourceProductOrOffers(sourceOfferIds),
  ]);

  return {
    products,
    offers,
    params,
    priceHistory,
    quoteItems,
    customerQuoteRowsForSourceProduct,
    quoteItemsForSourceProductOrOffers,
  };
}

async function countCustomerQuoteRowsForSourceProduct(): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ count: number | bigint }>>`
    SELECT COUNT(*) AS count
    FROM customer_quote_rows
    WHERE matched_product_id = ${SOURCE_PRODUCT_ID}
  `;
  return Number(rows[0]?.count ?? 0);
}

async function countQuoteItemsForSourceProductOrOffers(sourceOfferIds: string[]): Promise<number> {
  if (sourceOfferIds.length === 0) {
    const rows = await prisma.$queryRaw<Array<{ count: number | bigint }>>`
      SELECT COUNT(*) AS count
      FROM quote_items
      WHERE product_id = ${SOURCE_PRODUCT_ID}
    `;
    return Number(rows[0]?.count ?? 0);
  }

  const placeholders = sourceOfferIds.map(() => "?").join(", ");
  const rows = await prisma.$queryRawUnsafe<Array<{ count: number | bigint }>>(
    `SELECT COUNT(*) AS count
     FROM quote_items
     WHERE product_id = ?
        OR supplier_offer_id IN (${placeholders})`,
    SOURCE_PRODUCT_ID,
    ...sourceOfferIds,
  );
  return Number(rows[0]?.count ?? 0);
}

async function getSourceOfferIds(): Promise<Array<{ id: string }>> {
  return prisma.supplierOffer.findMany({
    where: { productId: SOURCE_PRODUCT_ID },
    select: { id: true },
  });
}

async function getPostChecks(
  plannedNewProductIds: Record<string, string>,
  beforeCounts: CountSnapshot,
  afterCounts: CountSnapshot,
): Promise<NonNullable<ReportData["postChecks"]>> {
  const newProductIds = Object.values(plannedNewProductIds);
  const [sourceProductOffers, newProductOffers] = await Promise.all([
    getProductOfferChecks([SOURCE_PRODUCT_ID]),
    getProductOfferChecks(newProductIds),
  ]);

  return {
    sourceProductOffers,
    newProductOffers,
    priceHistoryCountUnchanged: beforeCounts.priceHistory === afterCounts.priceHistory,
    productCountExpected: afterCounts.products === EXPECTED_AFTER.products,
    offerCountExpected: afterCounts.offers === EXPECTED_AFTER.offers,
    paramCountExpected: afterCounts.params === EXPECTED_AFTER.params,
  };
}

async function getProductOfferChecks(productIds: string[]): Promise<ProductOfferCheckRow[]> {
  if (productIds.length === 0) {
    return [];
  }
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: {
      id: true,
      modelNo: true,
      category: true,
      supplierOffers: {
        select: { factoryName: true },
        orderBy: { factoryName: "asc" },
      },
    },
    orderBy: [{ category: "asc" }, { id: "asc" }],
  });

  return products.map((product) => ({
    product_id: product.id,
    model_no: product.modelNo,
    category: product.category,
    offer_count: product.supplierOffers.length,
    factories: product.supplierOffers.map((offer) => offer.factoryName).join(", "),
  }));
}

function buildReport(data: ReportData): string {
  const movedTargets = data.splitTargets
    .map(
      (target) =>
        `| ${target.factoryName} | ${target.targetCategory} | ${data.plannedNewProductIds[target.factoryName]} | ${
          target.note ?? ""
        } |`,
    )
    .join("\n");

  return `# V6.0 — 48W model_no 碰撞拆分报告

Generated: ${data.generatedAt}
Mode: ${data.mode}
Backup: ${data.backupPath ?? "-"}

## 前置检查

- Source product: ${data.sourceProduct.id}
- model_no: ${data.sourceProduct.modelNo ?? "-"}
- product_name: ${data.sourceProduct.productName}
- category: ${data.sourceProduct.category ?? "-"}
- source offers before split: ${data.sourceOffersBefore.length}
- customer_quote_rows matched to source product: ${data.beforeCounts.customerQuoteRowsForSourceProduct}
- quote_items referencing source product/offers: ${data.beforeCounts.quoteItemsForSourceProductOrOffers}

## 全局计数

| Metric | Before | After | Expected After |
|---|---:|---:|---:|
| products | ${data.beforeCounts.products} | ${data.afterCounts.products} | ${EXPECTED_AFTER.products} |
| supplier_offers | ${data.beforeCounts.offers} | ${data.afterCounts.offers} | ${EXPECTED_AFTER.offers} |
| product_params | ${data.beforeCounts.params} | ${data.afterCounts.params} | ${EXPECTED_AFTER.params} |
| price_history | ${data.beforeCounts.priceHistory} | ${data.afterCounts.priceHistory} | ${data.beforeCounts.priceHistory} |
| quote_items | ${data.beforeCounts.quoteItems} | ${data.afterCounts.quoteItems} | ${data.beforeCounts.quoteItems} |

## 11 个原始 Offer

| factory | price | currency | source_file_id | source |
|---|---:|---|---|---|
${data.sourceOffersBefore
  .map(
    (offer) =>
      `| ${offer.factory_name} | ${formatNumber(offer.purchase_price)} | ${offer.currency} | ${
        offer.source_file_id ?? "-"
      } | ${offer.source_relative_path ?? offer.source_file_name ?? "-"} |`,
  )
  .join("\n")}

## 保留在原面板灯 48W 的 Offer

${data.keepFactories.map((factory) => `- ${factory}`).join("\n")}

## 迁移计划

| factory | target category | new product id | note |
|---|---|---|---|
${movedTargets}

## 后置审计

${
  data.postChecks
    ? `### 原产品剩余 Offer

| product_id | model_no | category | offer_count | factories |
|---|---|---|---:|---|
${data.postChecks.sourceProductOffers.map(formatProductOfferCheckRow).join("\n")}

### 新产品 Offer

| product_id | model_no | category | offer_count | factories |
|---|---|---|---:|---|
${data.postChecks.newProductOffers.map(formatProductOfferCheckRow).join("\n")}

### 检查结果

- price_history count unchanged: ${formatBool(data.postChecks.priceHistoryCountUnchanged)}
- product count expected (${EXPECTED_AFTER.products}): ${formatBool(data.postChecks.productCountExpected)}
- offer count expected (${EXPECTED_AFTER.offers}): ${formatBool(data.postChecks.offerCountExpected)}
- param count expected (${EXPECTED_AFTER.params}): ${formatBool(data.postChecks.paramCountExpected)}
`
    : "Dry-run only. No database writes were performed."
}

## Notes

${data.notes.map((note) => `- ${note}`).join("\n")}
`;
}

function formatProductOfferCheckRow(row: ProductOfferCheckRow): string {
  return `| ${row.product_id} | ${row.model_no ?? "-"} | ${row.category ?? "-"} | ${Number(row.offer_count)} | ${
    row.factories ?? "-"
  } |`;
}

function formatNumber(value: number | string): string {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? String(numberValue) : String(value);
}

function formatBool(value: boolean): string {
  return value ? "YES" : "NO";
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
