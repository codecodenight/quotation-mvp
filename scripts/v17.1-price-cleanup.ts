import { randomUUID } from "node:crypto";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const APPLY_MODE = process.argv.includes("--apply");
const DB_PATH = path.join("prisma", "dev.db");
const BACKUP_PATH = path.join("prisma", "dev.db.bak-v17.1");
const REPORT_PATH = path.join("docs", "v17.1-price-cleanup-report.md");

const JUNK_PRODUCT_NAMES = new Set(["LED chip", "Dimension", "Dimension 2wire", "CCT", "LiFePO4 Battery", "LED Chip"]);
const MODE_LABELS = {
  "1": "LED chip price=2835",
  "2": "列名当产品名",
  "3": "MOQ/产能数据当产品",
  "4": "美莱德型号=价格",
  "5": "雄企编码=价格",
} as const;

type ModeId = keyof typeof MODE_LABELS;

type OfferRow = {
  id: string;
  productId: string;
  factoryName: string;
  purchasePrice: { toString(): string };
  currency: string;
  product: {
    id: string;
    productName: string;
    modelNo: string | null;
    category: string | null;
  };
};

type ProductRow = {
  id: string;
  productName: string;
  modelNo: string | null;
  category: string | null;
  supplierOffers: Array<{
    id: string;
    factoryName: string;
    purchasePrice: { toString(): string };
    currency: string;
  }>;
};

type ClassifiedOffer = {
  offer: OfferRow;
  mode: ModeId;
  deleteProductIfEmpty: boolean;
};

type ClassifiedProduct = {
  product: ProductRow;
  mode: ModeId;
};

type Plan = {
  mode: "dry-run" | "apply";
  generatedAt: string;
  beforeCounts: DbCounts;
  afterCounts?: DbCounts;
  classifiedOffers: ClassifiedOffer[];
  classifiedProducts: ClassifiedProduct[];
  offerIdsToDelete: Set<string>;
  productIdsToDelete: Set<string>;
  skippedOffers: SkipItem[];
  skippedProducts: SkipItem[];
  priceHistoryToDelete: number;
  accessoryTargets: AccessoryTarget[];
  accessoryInserted: number;
  unhandledHighPriceGroups: UnhandledGroup[];
};

type SkipItem = {
  id: string;
  mode: ModeId;
  label: string;
  reason: string;
};

type AccessoryTarget = {
  productId: string;
  productName: string;
  action: "insert" | "already_exists";
};

type UnhandledGroup = {
  factoryName: string;
  minPrice: number;
  maxPrice: number;
  offerCount: number;
  reason: string;
};

type DbCounts = {
  products: number;
  supplierOffers: number;
  productParams: number;
  priceHistory: number;
};

async function main() {
  const beforeCounts = await loadDbCounts();
  const classifiedOffers = await classifyOfferPatterns();
  const classifiedProducts = await classifyProductPatterns();
  const { offerIdsToDelete, productIdsToDelete, skippedOffers, skippedProducts } = await buildSafeDeletePlan(
    classifiedOffers,
    classifiedProducts,
  );
  const priceHistoryToDelete = await prisma.priceHistory.count({ where: { supplierOfferId: { in: [...offerIdsToDelete] } } });
  const accessoryTargets = await loadAccessoryTargets();
  const unhandledHighPriceGroups = await loadUnhandledHighPriceGroups(offerIdsToDelete);

  let accessoryInserted = 0;
  let afterCounts: DbCounts | undefined;
  if (APPLY_MODE) {
    await copyFile(DB_PATH, BACKUP_PATH);
    await applyPlan(offerIdsToDelete, productIdsToDelete);
    accessoryInserted = await insertAccessoryParams(accessoryTargets);
    afterCounts = await loadDbCounts();
  }

  const plan: Plan = {
    mode: APPLY_MODE ? "apply" : "dry-run",
    generatedAt: new Date().toISOString(),
    beforeCounts,
    afterCounts,
    classifiedOffers,
    classifiedProducts,
    offerIdsToDelete,
    productIdsToDelete,
    skippedOffers,
    skippedProducts,
    priceHistoryToDelete,
    accessoryTargets,
    accessoryInserted,
    unhandledHighPriceGroups,
  };

  await mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await writeFile(REPORT_PATH, buildReport(plan), "utf8");

  console.log(
    JSON.stringify(
      {
        mode: plan.mode,
        reportPath: REPORT_PATH,
        backupPath: APPLY_MODE ? BACKUP_PATH : null,
        offerDelete: offerIdsToDelete.size,
        productDelete: productIdsToDelete.size,
        skippedOffers: skippedOffers.length,
        skippedProducts: skippedProducts.length,
        accessoryInsert: accessoryInserted,
        before: beforeCounts,
        after: afterCounts,
      },
      null,
      2,
    ),
  );
}

async function loadDbCounts(): Promise<DbCounts> {
  const [products, supplierOffers, productParams, priceHistory] = await Promise.all([
    prisma.product.count(),
    prisma.supplierOffer.count(),
    prisma.productParam.count(),
    prisma.priceHistory.count(),
  ]);
  return { products, supplierOffers, productParams, priceHistory };
}

async function classifyOfferPatterns(): Promise<ClassifiedOffer[]> {
  const highPriceOffers = await prisma.supplierOffer.findMany({
    where: {
      currency: "RMB",
      purchasePrice: { gt: 500 },
    },
    include: {
      product: {
        select: { id: true, productName: true, modelNo: true, category: true },
      },
    },
  });

  const classified: ClassifiedOffer[] = [];
  for (const offer of highPriceOffers) {
    const price = toPrice(offer.purchasePrice);
    if (price === 2835) {
      classified.push({ offer, mode: "1", deleteProductIfEmpty: false });
      continue;
    }
    if (offer.factoryName === "美莱德" && isMeilaideModelPrice(offer.product.modelNo, price)) {
      classified.push({ offer, mode: "4", deleteProductIfEmpty: true });
      continue;
    }
    if (offer.factoryName === "雄企" && isXiongqiModelPrice(offer.product.modelNo, price)) {
      classified.push({ offer, mode: "5", deleteProductIfEmpty: false });
    }
  }
  return uniqueClassifiedOffers(classified);
}

async function classifyProductPatterns(): Promise<ClassifiedProduct[]> {
  const [columnNameProducts, moqProducts] = await Promise.all([
    prisma.product.findMany({
      where: { productName: { in: [...JUNK_PRODUCT_NAMES] } },
      include: { supplierOffers: { select: { id: true, factoryName: true, purchasePrice: true, currency: true } } },
    }),
    prisma.product.findMany({
      where: {
        OR: [
          { productName: { contains: "pieces" } },
          { productName: { contains: "pcs" } },
          { productName: { contains: "sets" } },
          { productName: { contains: "pcs/" } },
        ],
      },
      include: { supplierOffers: { select: { id: true, factoryName: true, purchasePrice: true, currency: true } } },
    }),
  ]);

  const byProductId = new Map<string, ClassifiedProduct>();
  for (const product of columnNameProducts) {
    byProductId.set(product.id, { product, mode: "2" });
  }
  for (const product of moqProducts) {
    if (byProductId.has(product.id)) continue;
    if (!looksLikeMoqProduct(product.productName)) continue;
    byProductId.set(product.id, { product, mode: "3" });
  }
  return [...byProductId.values()];
}

async function buildSafeDeletePlan(
  classifiedOffers: ClassifiedOffer[],
  classifiedProducts: ClassifiedProduct[],
): Promise<Pick<Plan, "offerIdsToDelete" | "productIdsToDelete" | "skippedOffers" | "skippedProducts">> {
  const offerIdsToDelete = new Set<string>();
  const productIdsToDelete = new Set<string>();
  const skippedOffers: SkipItem[] = [];
  const skippedProducts: SkipItem[] = [];

  const offerModes = new Map<string, ModeId>();
  for (const item of classifiedOffers) {
    offerModes.set(item.offer.id, item.mode);
    offerIdsToDelete.add(item.offer.id);
  }

  for (const item of classifiedProducts) {
    const productRefs = await loadProductReferenceCount(item.product.id);
    if (productRefs > 0) {
      skippedProducts.push({
        id: item.product.id,
        mode: item.mode,
        label: item.product.productName,
        reason: `product has ${productRefs} quote/customer refs`,
      });
      for (const offer of item.product.supplierOffers) {
        offerModes.set(offer.id, item.mode);
        offerIdsToDelete.add(offer.id);
      }
      continue;
    }
    productIdsToDelete.add(item.product.id);
    for (const offer of item.product.supplierOffers) {
      offerModes.set(offer.id, item.mode);
      offerIdsToDelete.add(offer.id);
    }
  }

  for (const item of classifiedOffers.filter((item) => item.deleteProductIfEmpty)) {
    if (productIdsToDelete.has(item.offer.productId)) continue;
    const remainingOfferCount = await prisma.supplierOffer.count({
      where: { productId: item.offer.productId, id: { notIn: [...offerIdsToDelete] } },
    });
    if (remainingOfferCount === 0) {
      const productRefs = await loadProductReferenceCount(item.offer.productId);
      if (productRefs === 0) {
        productIdsToDelete.add(item.offer.productId);
      } else {
        skippedProducts.push({
          id: item.offer.productId,
          mode: item.mode,
          label: item.offer.product.productName,
          reason: `empty shell product has ${productRefs} quote/customer refs`,
        });
      }
    }
  }

  for (const offerId of [...offerIdsToDelete]) {
    const quoteItemCount = await prisma.quoteItem.count({ where: { supplierOfferId: offerId } });
    if (quoteItemCount > 0) {
      offerIdsToDelete.delete(offerId);
      const mode = offerModes.get(offerId) ?? "1";
      skippedOffers.push({
        id: offerId,
        mode,
        label: MODE_LABELS[mode],
        reason: `offer has ${quoteItemCount} quote_items refs`,
      });
    }
  }

  for (const productId of [...productIdsToDelete]) {
    const remainingOfferCount = await prisma.supplierOffer.count({
      where: { productId, id: { notIn: [...offerIdsToDelete] } },
    });
    if (remainingOfferCount > 0) {
      productIdsToDelete.delete(productId);
      skippedProducts.push({
        id: productId,
        mode: "2",
        label: "not empty after offer FK skips",
        reason: `${remainingOfferCount} offer(s) remain`,
      });
    }
  }

  return { offerIdsToDelete, productIdsToDelete, skippedOffers, skippedProducts };
}

async function loadProductReferenceCount(productId: string): Promise<number> {
  const [quoteItems, customerRows] = await Promise.all([
    prisma.quoteItem.count({ where: { productId } }),
    countCustomerQuoteRows(productId),
  ]);
  return quoteItems + customerRows;
}

async function countCustomerQuoteRows(productId: string): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ count: bigint | number }>>`
    SELECT COUNT(*) AS count
    FROM customer_quote_rows
    WHERE matched_product_id = ${productId}
  `;
  return Number(rows[0]?.count ?? 0);
}

async function loadAccessoryTargets(): Promise<AccessoryTarget[]> {
  const products = await prisma.product.findMany({
    where: {
      category: "路灯",
      OR: [{ productName: { contains: "含头总长度" } }, { productName: { contains: "1分" } }],
    },
    select: {
      id: true,
      productName: true,
      params: {
        where: { paramKey: "product_role", normalizedValue: "accessory" },
        select: { id: true },
      },
    },
    orderBy: { productName: "asc" },
  });
  return products.map((product) => ({
    productId: product.id,
    productName: product.productName,
    action: product.params.length > 0 ? "already_exists" : "insert",
  }));
}

async function insertAccessoryParams(targets: AccessoryTarget[]): Promise<number> {
  const insertTargets = targets.filter((target) => target.action === "insert");
  if (insertTargets.length === 0) return 0;
  const result = await prisma.productParam.createMany({
    data: insertTargets.map((target) => ({
      id: randomUUID(),
      productId: target.productId,
      paramKey: "product_role",
      rawValue: "accessory",
      normalizedValue: "accessory",
      unit: null,
      sourceField: "manual_v17.1",
      confidence: "high",
    })),
  });
  return result.count;
}

async function applyPlan(offerIdsToDelete: Set<string>, productIdsToDelete: Set<string>) {
  const offerIds = [...offerIdsToDelete];
  const productIds = [...productIdsToDelete];
  await prisma.$transaction(async (tx) => {
    if (offerIds.length > 0) {
      await tx.priceHistory.deleteMany({ where: { supplierOfferId: { in: offerIds } } });
      await tx.supplierOffer.deleteMany({ where: { id: { in: offerIds } } });
    }
    if (productIds.length > 0) {
      await tx.productParam.deleteMany({ where: { productId: { in: productIds } } });
      await tx.product.deleteMany({ where: { id: { in: productIds } } });
    }
  });
}

async function loadUnhandledHighPriceGroups(deletingOfferIds: Set<string>): Promise<UnhandledGroup[]> {
  const highPriceOffers = await prisma.supplierOffer.findMany({
    where: {
      currency: "RMB",
      purchasePrice: { gt: 500 },
      id: { notIn: [...deletingOfferIds] },
    },
    select: {
      factoryName: true,
      purchasePrice: true,
    },
  });
  const groups = new Map<string, { prices: number[]; count: number }>();
  for (const offer of highPriceOffers) {
    const group = groups.get(offer.factoryName) ?? { prices: [], count: 0 };
    group.prices.push(toPrice(offer.purchasePrice));
    group.count += 1;
    groups.set(offer.factoryName, group);
  }
  return [...groups.entries()]
    .map(([factoryName, group]) => ({
      factoryName,
      minPrice: Math.min(...group.prices),
      maxPrice: Math.max(...group.prices),
      offerCount: group.count,
      reason: "可能合理高价或需人工确认，本次不处理",
    }))
    .sort((left, right) => right.offerCount - left.offerCount || left.factoryName.localeCompare(right.factoryName));
}

function isMeilaideModelPrice(modelNo: string | null, price: number): boolean {
  const match = modelNo?.match(/JJL-C(\d+)/i);
  return Boolean(match && Number(match[1]) === Math.trunc(price));
}

function isXiongqiModelPrice(modelNo: string | null, price: number): boolean {
  if (!modelNo || /^QJ6870/i.test(modelNo)) return false;
  const match = modelNo.match(/^LL(\d+)/i);
  return Boolean(match && Number(match[1]) === Math.trunc(price));
}

function looksLikeMoqProduct(productName: string): boolean {
  const normalized = productName.trim().toLowerCase();
  const compact = normalized.replace(/\s+/g, "");
  return (
    /^\d+(pcs|pieces|sets)$/i.test(compact) ||
    /^(?:\d+[,/])+\d+(pcs|pieces|sets)$/i.test(compact) ||
    /^\d+\/pcs$/i.test(compact) ||
    /^外箱尺寸[:：]/i.test(normalized) ||
    /^[\d.×x*]+cm\/\d+pcs$/i.test(compact)
  );
}

function uniqueClassifiedOffers(items: ClassifiedOffer[]): ClassifiedOffer[] {
  const byId = new Map<string, ClassifiedOffer>();
  for (const item of items) byId.set(item.offer.id, item);
  return [...byId.values()];
}

function toPrice(value: { toString(): string } | number | string): number {
  return Number(value.toString());
}

function buildReport(plan: Plan): string {
  const modeRows = (Object.keys(MODE_LABELS) as ModeId[])
    .map((mode) => {
      const offerDeletes = [...plan.offerIdsToDelete].filter((offerId) => {
        const offerMatch = plan.classifiedOffers.find((item) => item.offer.id === offerId && item.mode === mode);
        const productMatch = plan.classifiedProducts.some((item) => item.mode === mode && item.product.supplierOffers.some((offer) => offer.id === offerId));
        return offerMatch || productMatch;
      }).length;
      const productDeletes = [...plan.productIdsToDelete].filter((productId) => {
        const productMatch = plan.classifiedProducts.some((item) => item.mode === mode && item.product.id === productId);
        const offerMatch = plan.classifiedOffers.some((item) => item.mode === mode && item.offer.productId === productId && item.deleteProductIfEmpty);
        return productMatch || offerMatch;
      }).length;
      const skipped = plan.skippedOffers.filter((item) => item.mode === mode).length + plan.skippedProducts.filter((item) => item.mode === mode).length;
      return `| ${mode} | ${MODE_LABELS[mode]} | ${offerDeletes} | ${productDeletes} | ${skipped} |`;
    })
    .join("\n");
  const before = plan.beforeCounts;
  const after = plan.afterCounts ?? before;
  return `# V17.1 价格误检清洗报告

模式: ${plan.mode}
时间: ${plan.generatedAt}
备份: ${BACKUP_PATH}

## Part A: 价格误检

| 模式 | 描述 | offer 删除 | 产品删除 | 跳过(有FK) |
|---|---|---:|---:|---:|
${modeRows}
| 合计 | | ${plan.offerIdsToDelete.size} | ${plan.productIdsToDelete.size} | ${plan.skippedOffers.length + plan.skippedProducts.length} |

- 计划/实际删除 price_history: ${plan.priceHistoryToDelete}

### 跳过明细（有 FK 或仍有 offer）

| 类型 | 模式 | id | 原因 |
|---|---|---|---|
${[...plan.skippedOffers.map((item) => `| offer | ${item.mode} | ${escapeMd(item.id)} | ${escapeMd(item.reason)} |`), ...plan.skippedProducts.map((item) => `| product | ${item.mode} | ${escapeMd(item.id)} | ${escapeMd(item.reason)} |`)].join("\n") || "| - | - | - | - |"}

### 未处理（需人工确认）

| 工厂 | 价格范围 | offer 数 | 原因 |
|---|---|---:|---|
${plan.unhandledHighPriceGroups.map((group) => `| ${escapeMd(group.factoryName)} | ${formatPrice(group.minPrice)}-${formatPrice(group.maxPrice)} | ${group.offerCount} | ${group.reason} |`).join("\n") || "| - | - | 0 | - |"}

## Part B: 路灯线缆配件

| product_id | product_name | 操作 |
|---|---|---|
${plan.accessoryTargets.map((target) => `| ${target.productId} | ${escapeMd(target.productName)} | ${target.action === "insert" ? (plan.mode === "apply" ? "inserted" : "would insert") : "already_exists"} |`).join("\n") || "| - | - | - |"}

## DB 计数

| 表 | 执行前 | 执行后 | 变化 |
|---|---:|---:|---:|
| products | ${before.products} | ${after.products} | ${after.products - before.products} |
| supplier_offers | ${before.supplierOffers} | ${after.supplierOffers} | ${after.supplierOffers - before.supplierOffers} |
| product_params | ${before.productParams} | ${after.productParams} | ${after.productParams - before.productParams} |
| price_history | ${before.priceHistory} | ${after.priceHistory} | ${after.priceHistory - before.priceHistory} |
`;
}

function formatPrice(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : "-";
}

function escapeMd(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
