import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

import { escapeMd } from "./v11-shared";

const prisma = new PrismaClient();

const REPORT_PATH = path.join("docs", "v11.2-junk-cleanup-report.md");
const BACKUP_PATH = path.join("prisma", "dev.db.bak-v11.2");
const APPLY_MODE = process.argv.includes("--apply");

type ProductRecord = {
  id: string;
  modelNo: string | null;
  productName: string;
  category: string | null;
  imagePath: string | null;
  offerCount: number;
  paramCount: number;
};

type CustomerQuoteCount = {
  cnt: bigint | number;
};

type JunkCandidate = {
  product: ProductRecord;
  junkType: string;
  safe: boolean;
  skipReason: string | null;
  offerIds: string[];
  quoteItems: number;
  customerQuoteRows: number;
};

type DeleteResult = {
  products: number;
  supplierOffers: number;
  productParams: number;
  priceHistory: number;
};

async function main() {
  if (!existsSync(BACKUP_PATH)) {
    throw new Error(`Missing DB backup: ${BACKUP_PATH}`);
  }

  const beforeProducts = await prisma.product.count();
  const beforeOffers = await prisma.supplierOffer.count();
  const beforeParams = await prisma.productParam.count();
  const beforePriceHistory = await prisma.priceHistory.count();
  const beforeCategoryCounts = await loadCategoryCounts();
  const products = await loadProducts();
  const candidates: JunkCandidate[] = [];

  for (const product of products) {
    const junkType = classifyJunk(product);
    if (!junkType) continue;
    candidates.push(await buildCandidate(product, junkType));
  }

  const safeCandidates = candidates.filter((candidate) => candidate.safe);
  const deleteResult = APPLY_MODE ? await deleteCandidates(safeCandidates) : { products: 0, supplierOffers: 0, productParams: 0, priceHistory: 0 };
  const afterProducts = await prisma.product.count();
  const afterOffers = await prisma.supplierOffer.count();
  const afterParams = await prisma.productParam.count();
  const afterPriceHistory = await prisma.priceHistory.count();
  const afterCategoryCounts = await loadCategoryCounts();

  await mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await writeFile(
    REPORT_PATH,
    buildReport({
      mode: APPLY_MODE ? "apply" : "dry-run",
      products,
      candidates,
      deleteResult,
      beforeProducts,
      afterProducts,
      beforeOffers,
      afterOffers,
      beforeParams,
      afterParams,
      beforePriceHistory,
      afterPriceHistory,
      beforeCategoryCounts,
      afterCategoryCounts,
    }),
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        mode: APPLY_MODE ? "apply" : "dry-run",
        reportPath: REPORT_PATH,
        scannedProducts: products.length,
        detectedJunk: candidates.length,
        safeToDelete: safeCandidates.length,
        deletedProducts: deleteResult.products,
        deletedOffers: deleteResult.supplierOffers,
        deletedParams: deleteResult.productParams,
        deletedPriceHistory: deleteResult.priceHistory,
        beforeProducts,
        afterProducts,
      },
      null,
      2,
    ),
  );

  await prisma.$disconnect();
}

async function loadProducts(): Promise<ProductRecord[]> {
  const products = await prisma.product.findMany({
    select: {
      id: true,
      modelNo: true,
      productName: true,
      category: true,
      imagePath: true,
      _count: { select: { supplierOffers: true, params: true } },
    },
    orderBy: [{ category: "asc" }, { modelNo: "asc" }, { productName: "asc" }],
  });
  return products.map((product) => ({
    id: product.id,
    modelNo: product.modelNo,
    productName: product.productName,
    category: product.category,
    imagePath: product.imagePath,
    offerCount: product._count.supplierOffers,
    paramCount: product._count.params,
  }));
}

async function buildCandidate(product: ProductRecord, junkType: string): Promise<JunkCandidate> {
  const quoteItems = await prisma.quoteItem.count({ where: { productId: product.id } });
  const cqr = await prisma.$queryRaw<CustomerQuoteCount[]>`
    SELECT COUNT(*) AS cnt FROM customer_quote_rows WHERE matched_product_id = ${product.id}
  `;
  const customerQuoteRows = Number(cqr[0]?.cnt ?? 0);
  const offers = await prisma.supplierOffer.findMany({ where: { productId: product.id }, select: { id: true } });
  const offerIds = offers.map((offer) => offer.id);
  const skipReasons: string[] = [];
  if (quoteItems > 0) skipReasons.push(`${quoteItems} quote_items`);
  if (customerQuoteRows > 0) skipReasons.push(`${customerQuoteRows} customer_quote_rows`);
  if (product.imagePath) skipReasons.push("has image");

  return {
    product,
    junkType,
    safe: skipReasons.length === 0,
    skipReason: skipReasons.length > 0 ? skipReasons.join("; ") : null,
    offerIds,
    quoteItems,
    customerQuoteRows,
  };
}

function classifyJunk(product: ProductRecord): string | null {
  const name = (product.productName ?? "").trim();
  const model = (product.modelNo ?? "").trim();
  const text = name || model;

  if (/^[US$￥¥€£]?\s*[\d,.]+\s*[元]?\s*$/i.test(text)) return "price";
  if (/^US?\$\s*[\d,.]+/i.test(text)) return "price";
  if (/^￥\s*[\d,.]+/.test(text)) return "price";
  if (/^\d+\s*(?:pcs|sets?|pieces?|套|条|个|台|只|米|卷|箱|盒)\s*$/i.test(text)) return "quantity";
  if (/^\d+\/\d+$/.test(text) && text.length <= 5) return "quantity";
  if (/^\d+(?:\.\d+)?\s*[*×x]\s*\d+(?:\.\d+)?(?:\s*[*×x]\s*\d+(?:\.\d+)?)?\s*(?:cm|mm|CM|MM)?\s*$/i.test(text)) {
    return "dimension";
  }
  if (/^[NG]\.?\s*W\.?\s*[:：]/i.test(text)) return "weight";
  if (/^MOQ\b/i.test(text)) return "moq";
  if (/规格少于.*不接单/.test(text)) return "moq";
  if (/^单一规格MOQ/i.test(text)) return "moq";
  if (/^\d+[：:、]\s*(?:含|无|配件|包装|外箱|产品标贴|尼龙|棕色)/.test(text)) return "spec_note";
  if (/^包装方式/.test(text)) return "spec_note";
  if (/^换\d+.*不锈钢.*元\/套/.test(text)) return "pricing_note";
  if (/^SMD\s*\d{4}\s+\d+D$/i.test(text)) return "led_spec";
  if (/^Polycrystal\s/i.test(text)) return "solar_spec";
  if (/^\d+\s*[*×]\s*(?:cool|warm|white|LED)\s/i.test(text)) return "led_spec";
  if (text.length > 50 && /(?:安排进仓|提供包材|不干胶|灯座.*接线.*膨胀管)/.test(text)) return "contract_note";
  if (/^全部产品过/.test(text)) return "declaration";
  if (/^产品图片$/.test(text)) return "label";
  return null;
}

async function deleteCandidates(candidates: JunkCandidate[]): Promise<DeleteResult> {
  const result: DeleteResult = { products: 0, supplierOffers: 0, productParams: 0, priceHistory: 0 };
  for (const candidate of candidates) {
    await prisma.$transaction(async (tx) => {
      const priceHistory = await tx.priceHistory.deleteMany({ where: { supplierOfferId: { in: candidate.offerIds } } });
      const supplierOffers = await tx.supplierOffer.deleteMany({ where: { productId: candidate.product.id } });
      const productParams = await tx.productParam.deleteMany({ where: { productId: candidate.product.id } });
      await tx.product.delete({ where: { id: candidate.product.id } });
      result.products += 1;
      result.supplierOffers += supplierOffers.count;
      result.productParams += productParams.count;
      result.priceHistory += priceHistory.count;
    });
  }
  return result;
}

async function loadCategoryCounts(): Promise<Map<string, number>> {
  const rows = await prisma.product.groupBy({ by: ["category"], _count: { _all: true } });
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.category ?? "(未分类)", row._count._all);
  return counts;
}

function buildReport(input: {
  mode: "dry-run" | "apply";
  products: ProductRecord[];
  candidates: JunkCandidate[];
  deleteResult: DeleteResult;
  beforeProducts: number;
  afterProducts: number;
  beforeOffers: number;
  afterOffers: number;
  beforeParams: number;
  afterParams: number;
  beforePriceHistory: number;
  afterPriceHistory: number;
  beforeCategoryCounts: Map<string, number>;
  afterCategoryCounts: Map<string, number>;
}): string {
  const safe = input.candidates.filter((candidate) => candidate.safe);
  const skippedQuoteItems = input.candidates.filter((candidate) => candidate.quoteItems > 0).length;
  const skippedCqr = input.candidates.filter((candidate) => candidate.customerQuoteRows > 0).length;
  const skippedImages = input.candidates.filter((candidate) => candidate.product.imagePath).length;
  const typeStats = buildTypeStats(input.candidates);
  const categoryStats = buildCategoryStats(safe, input.beforeCategoryCounts, input.afterCategoryCounts);

  return `# V11.2 垃圾产品清理报告

模式: ${input.mode}
时间: ${new Date().toISOString()}
备份: ${BACKUP_PATH}

## 汇总

| 指标 | 数值 |
|---|---:|
| 扫描产品数 | ${input.products.length.toLocaleString()} |
| 检测到垃圾 | ${input.candidates.length.toLocaleString()} |
| 通过安全检查 | ${safe.length.toLocaleString()} |
| 跳过（有 quote_items） | ${skippedQuoteItems.toLocaleString()} |
| 跳过（有 customer_quote_rows） | ${skippedCqr.toLocaleString()} |
| 跳过（有图片） | ${skippedImages.toLocaleString()} |
| 实际删除产品 | ${input.deleteResult.products.toLocaleString()} |
| 删除 supplier_offers | ${input.deleteResult.supplierOffers.toLocaleString()} |
| 删除 product_params | ${input.deleteResult.productParams.toLocaleString()} |
| 删除 price_history | ${input.deleteResult.priceHistory.toLocaleString()} |
| 产品总数变化 | ${input.beforeProducts.toLocaleString()} → ${input.afterProducts.toLocaleString()} |
| supplier_offers 变化 | ${input.beforeOffers.toLocaleString()} → ${input.afterOffers.toLocaleString()} |
| product_params 变化 | ${input.beforeParams.toLocaleString()} → ${input.afterParams.toLocaleString()} |
| price_history 变化 | ${input.beforePriceHistory.toLocaleString()} → ${input.afterPriceHistory.toLocaleString()} |

## 按垃圾类型统计

| 类型 | 检测数 | 安全删除 | 跳过 |
|---|---:|---:|---:|
${typeStats
  .map((stat) => `| ${escapeMd(stat.type)} | ${stat.detected.toLocaleString()} | ${stat.safe.toLocaleString()} | ${stat.skipped.toLocaleString()} |`)
  .join("\n")}

## 按品类统计

| 品类 | 删除产品 | 删除前总数 | 删除后总数 |
|---|---:|---:|---:|
${categoryStats
  .map((stat) => `| ${escapeMd(stat.category)} | ${stat.deleted.toLocaleString()} | ${stat.before.toLocaleString()} | ${stat.after.toLocaleString()} |`)
  .join("\n")}

## 删除采样（前 50 条）

| 品类 | model_no | product_name | 垃圾类型 | 关联 offers |
|---|---|---|---|---:|
${safe
  .slice(0, 50)
  .map(
    (candidate) =>
      `| ${escapeMd(candidate.product.category ?? "(未分类)")} | ${escapeMd(candidate.product.modelNo ?? "")} | ${escapeMd(candidate.product.productName)} | ${escapeMd(candidate.junkType)} | ${candidate.offerIds.length.toLocaleString()} |`,
  )
  .join("\n")}

## 跳过采样（有 FK 引用 / 图片）

| 品类 | model_no | product_name | 跳过原因 |
|---|---|---|---|
${input.candidates
  .filter((candidate) => !candidate.safe)
  .slice(0, 50)
  .map(
    (candidate) =>
      `| ${escapeMd(candidate.product.category ?? "(未分类)")} | ${escapeMd(candidate.product.modelNo ?? "")} | ${escapeMd(candidate.product.productName)} | ${escapeMd(candidate.skipReason ?? "")} |`,
  )
  .join("\n")}
`;
}

function buildTypeStats(candidates: JunkCandidate[]): Array<{ type: string; detected: number; safe: number; skipped: number }> {
  const stats = new Map<string, { type: string; detected: number; safe: number; skipped: number }>();
  for (const candidate of candidates) {
    const stat = stats.get(candidate.junkType) ?? { type: candidate.junkType, detected: 0, safe: 0, skipped: 0 };
    stat.detected += 1;
    if (candidate.safe) stat.safe += 1;
    else stat.skipped += 1;
    stats.set(candidate.junkType, stat);
  }
  return [...stats.values()].sort((left, right) => right.detected - left.detected || left.type.localeCompare(right.type));
}

function buildCategoryStats(
  safeCandidates: JunkCandidate[],
  beforeCategoryCounts: Map<string, number>,
  afterCategoryCounts: Map<string, number>,
): Array<{ category: string; deleted: number; before: number; after: number }> {
  const deleted = new Map<string, number>();
  for (const candidate of safeCandidates) {
    const category = candidate.product.category ?? "(未分类)";
    deleted.set(category, (deleted.get(category) ?? 0) + 1);
  }
  return [...deleted.entries()]
    .map(([category, count]) => ({
      category,
      deleted: count,
      before: beforeCategoryCounts.get(category) ?? 0,
      after: afterCategoryCounts.get(category) ?? beforeCategoryCounts.get(category) ?? 0,
    }))
    .sort((left, right) => right.deleted - left.deleted || left.category.localeCompare(right.category));
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
