import { randomUUID } from "node:crypto";
import { readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const APPLY_MODE = process.argv.includes("--apply");
const REPORT_PATH = path.join(
  process.cwd(),
  "docs",
  "v20.1-offer-dedup-cleanup-report.md",
);
const BACKUP_DIR = path.join(process.cwd(), "backups");

const JUNK_KEYWORD_PATTERN =
  /MOQ|warranty|Packing|payment|working days|T\/T|minimum|lead time/i;

type DuplicateGroupRow = {
  product_id: string;
  factory_name: string;
  cnt: number | bigint;
};

type PriceHistoryRow = {
  id: string;
  supplierOfferId: string;
  oldPrice: unknown;
  newPrice: unknown;
  oldSourceFileId: string | null;
  newSourceFileId: string | null;
};

type JunkProductCandidate = {
  id: string;
  productName: string;
  modelNo: string;
  category: string | null;
  reasons: string[];
  offerIds: string[];
  offerCount: number;
  paramCount: number;
  priceHistoryCount: number;
};

type JunkProductSkip = {
  id: string;
  productName: string;
  modelNo: string;
  category: string | null;
  reasons: string[];
  skipReasons: string[];
};

type OfferForDedupe = {
  id: string;
  productId: string;
  factoryName: string;
  purchasePrice: unknown;
  currency: string;
  ctnQty: string | null;
  ctnSize: string | null;
  ctnLength: string | null;
  ctnWidth: string | null;
  ctnHeight: string | null;
  moq: string | null;
  leadTime: string | null;
  priceUpdatedAt: Date | null;
  createdAt: Date;
  sourceFileId: string | null;
  product: {
    productName: string;
    modelNo: string;
    category: string | null;
  };
  _count: {
    quoteItems: number;
    priceHistory: number;
  };
};

type DedupeGroupPlan = {
  productId: string;
  productName: string;
  modelNo: string;
  category: string | null;
  factoryName: string;
  totalOffers: number;
  keepOfferId: string;
  keepPrice: string;
  deleteOfferIds: string[];
  skippedOfferIds: string[];
  skippedReasons: string[];
  historyRows: PriceHistoryRow[];
  mergeData: Partial<{
    ctnQty: string;
    ctnSize: string;
    ctnLength: string;
    ctnWidth: string;
    ctnHeight: string;
    moq: string;
    leadTime: string;
  }>;
};

type DbCounts = {
  products: number;
  supplierOffers: number;
  productParams: number;
  priceHistory: number;
  quoteItems: number;
  customerQuoteRows: number;
  duplicateOfferGroups: number;
};

function countValue(value: number | bigint): number {
  return typeof value === "bigint" ? Number(value) : value;
}

function priceToNumber(value: unknown): number {
  if (value == null) return 0;
  const numeric = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(numeric) ? numeric : 0;
}

function priceToString(value: unknown): string {
  const numeric = priceToNumber(value);
  return Number.isFinite(numeric) ? numeric.toFixed(4).replace(/\.?0+$/, "") : String(value);
}

function isBlank(value: string | null | undefined): boolean {
  return value == null || value.trim() === "";
}

function ctnCompletenessScore(offer: OfferForDedupe): number {
  return [offer.ctnLength, offer.ctnWidth, offer.ctnHeight, offer.ctnQty].filter(
    (value) => !isBlank(value),
  ).length;
}

function sortOffersForRetention(offers: OfferForDedupe[]): OfferForDedupe[] {
  return [...offers].sort((a, b) => {
    const priceDelta =
      Number(priceToNumber(b.purchasePrice) > 0) -
      Number(priceToNumber(a.purchasePrice) > 0);
    if (priceDelta !== 0) return priceDelta;

    const ctnDelta = ctnCompletenessScore(b) - ctnCompletenessScore(a);
    if (ctnDelta !== 0) return ctnDelta;

    const updatedDelta =
      Number(Boolean(b.priceUpdatedAt)) - Number(Boolean(a.priceUpdatedAt));
    if (updatedDelta !== 0) return updatedDelta;

    return b.createdAt.getTime() - a.createdAt.getTime();
  });
}

function buildMergeData(keep: OfferForDedupe, losingOffers: OfferForDedupe[]) {
  const fields = [
    "ctnQty",
    "ctnSize",
    "ctnLength",
    "ctnWidth",
    "ctnHeight",
    "moq",
    "leadTime",
  ] as const;
  const mergeData: DedupeGroupPlan["mergeData"] = {};

  for (const field of fields) {
    if (!isBlank(keep[field])) continue;
    const value = losingOffers.find((offer) => !isBlank(offer[field]))?.[field];
    if (!isBlank(value)) {
      mergeData[field] = value as string;
    }
  }

  return mergeData;
}

async function findLatestBackup(): Promise<string | null> {
  try {
    const entries = await readdir(BACKUP_DIR);
    const backups = entries
      .filter((entry) => /^dev-before-v20\.1-\d{8}-\d{6}\.sqlite$/.test(entry))
      .sort();
    const latest = backups.at(-1);
    return latest ? path.join("backups", latest) : null;
  } catch {
    return null;
  }
}

async function loadDuplicateGroupRows(): Promise<DuplicateGroupRow[]> {
  return prisma.$queryRawUnsafe<DuplicateGroupRow[]>(`
    SELECT product_id, factory_name, COUNT(*) AS cnt
    FROM supplier_offers
    GROUP BY product_id, factory_name
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC, product_id, factory_name
  `);
}

async function countRawTable(tableName: string): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<{ cnt: number | bigint }[]>(
    `SELECT COUNT(*) AS cnt FROM ${tableName}`,
  );
  return countValue(rows[0]?.cnt ?? 0);
}

async function loadCustomerQuoteProductRefs(): Promise<Map<string, number>> {
  const rows = await prisma.$queryRawUnsafe<
    { product_id: string; cnt: number | bigint }[]
  >(`
    SELECT matched_product_id AS product_id, COUNT(*) AS cnt
    FROM customer_quote_rows
    WHERE matched_product_id IS NOT NULL
    GROUP BY matched_product_id
  `);

  return new Map(rows.map((row) => [row.product_id, countValue(row.cnt)]));
}

async function loadCounts(): Promise<DbCounts> {
  const duplicateGroups = await loadDuplicateGroupRows();
  const [
    products,
    supplierOffers,
    productParams,
    priceHistory,
    quoteItems,
    customerQuoteRows,
  ] = await Promise.all([
    prisma.product.count(),
    prisma.supplierOffer.count(),
    prisma.productParam.count(),
    prisma.priceHistory.count(),
    prisma.quoteItem.count(),
    countRawTable("customer_quote_rows"),
  ]);

  return {
    products,
    supplierOffers,
    productParams,
    priceHistory,
    quoteItems,
    customerQuoteRows,
    duplicateOfferGroups: duplicateGroups.length,
  };
}

async function buildJunkProductPlan() {
  const customerQuoteRefs = await loadCustomerQuoteProductRefs();
  const products = await prisma.product.findMany({
    select: {
      id: true,
      productName: true,
      modelNo: true,
      category: true,
      imagePath: true,
      supplierOffers: {
        select: {
          id: true,
          purchasePrice: true,
        },
      },
      _count: {
        select: {
          quoteItems: true,
          params: true,
        },
      },
    },
  });

  const candidates: JunkProductCandidate[] = [];
  const skips: JunkProductSkip[] = [];

  for (const product of products) {
    const modelNo = product.modelNo ?? "";
    const reasons: string[] = [];

    if (modelNo.trim().length > 50) {
      reasons.push("model_no length > 50");
    }
    if (
      product.supplierOffers.length > 0 &&
      product.supplierOffers.every((offer) => priceToNumber(offer.purchasePrice) === 0)
    ) {
      reasons.push("all supplier offers have purchase_price = 0");
    }
    if (JUNK_KEYWORD_PATTERN.test(modelNo)) {
      reasons.push("model_no contains non-product/import instruction keyword");
    }

    if (reasons.length === 0) continue;

    const skipReasons: string[] = [];
    if (product._count.quoteItems > 0) {
      skipReasons.push(`${product._count.quoteItems} quote_items reference(s)`);
    }
    const customerQuoteRowCount = customerQuoteRefs.get(product.id) ?? 0;
    if (customerQuoteRowCount > 0) {
      skipReasons.push(`${customerQuoteRowCount} customer_quote_rows match(es)`);
    }
    if (!isBlank(product.imagePath)) {
      skipReasons.push("image_path is present");
    }

    if (skipReasons.length > 0) {
      skips.push({
        id: product.id,
        productName: product.productName,
        modelNo,
        category: product.category,
        reasons,
        skipReasons,
      });
      continue;
    }

    const offerIds = product.supplierOffers.map((offer) => offer.id);
    const priceHistoryCount =
      offerIds.length > 0
        ? await prisma.priceHistory.count({
            where: { supplierOfferId: { in: offerIds } },
          })
        : 0;

    candidates.push({
      id: product.id,
      productName: product.productName,
      modelNo,
      category: product.category,
      reasons,
      offerIds,
      offerCount: offerIds.length,
      paramCount: product._count.params,
      priceHistoryCount,
    });
  }

  return { candidates, skips };
}

async function buildDedupePlan(excludedProductIds: Set<string>) {
  const groupRows = (await loadDuplicateGroupRows()).filter(
    (row) => !excludedProductIds.has(row.product_id),
  );

  const productIds = [...new Set(groupRows.map((row) => row.product_id))];
  if (productIds.length === 0) {
    return { groupRows, plans: [] as DedupeGroupPlan[] };
  }

  const offers = (await prisma.supplierOffer.findMany({
    where: { productId: { in: productIds } },
    select: {
      id: true,
      productId: true,
      factoryName: true,
      purchasePrice: true,
      currency: true,
      ctnQty: true,
      ctnSize: true,
      ctnLength: true,
      ctnWidth: true,
      ctnHeight: true,
      moq: true,
      leadTime: true,
      priceUpdatedAt: true,
      createdAt: true,
      sourceFileId: true,
      product: {
        select: {
          productName: true,
          modelNo: true,
          category: true,
        },
      },
      _count: {
        select: {
          quoteItems: true,
          priceHistory: true,
        },
      },
    },
  })) as OfferForDedupe[];

  const groupKeySet = new Set(
    groupRows.map((row) => `${row.product_id}|||${row.factory_name}`),
  );
  const offerGroups = new Map<string, OfferForDedupe[]>();

  for (const offer of offers) {
    const key = `${offer.productId}|||${offer.factoryName}`;
    if (!groupKeySet.has(key)) continue;
    const list = offerGroups.get(key) ?? [];
    list.push(offer);
    offerGroups.set(key, list);
  }

  const plans: DedupeGroupPlan[] = [];
  for (const groupOffers of offerGroups.values()) {
    if (groupOffers.length <= 1) continue;
    const sorted = sortOffersForRetention(groupOffers);
    const keep = sorted[0];
    const losingOffers = sorted.slice(1);
    const deletableLosingOffers = losingOffers.filter(
      (offer) => offer._count.quoteItems === 0,
    );
    const skippedLosingOffers = losingOffers.filter(
      (offer) => offer._count.quoteItems > 0,
    );

    const historyRows: PriceHistoryRow[] = [];
    for (const loser of deletableLosingOffers) {
      const oldPrice = priceToNumber(loser.purchasePrice);
      const newPrice = priceToNumber(keep.purchasePrice);
      if (oldPrice > 0 && oldPrice !== newPrice) {
        historyRows.push({
          id: randomUUID(),
          supplierOfferId: keep.id,
          oldPrice: loser.purchasePrice,
          newPrice: keep.purchasePrice,
          oldSourceFileId: loser.sourceFileId,
          newSourceFileId: keep.sourceFileId,
        });
      }
    }

    plans.push({
      productId: keep.productId,
      productName: keep.product.productName,
      modelNo: keep.product.modelNo,
      category: keep.product.category,
      factoryName: keep.factoryName,
      totalOffers: groupOffers.length,
      keepOfferId: keep.id,
      keepPrice: priceToString(keep.purchasePrice),
      deleteOfferIds: deletableLosingOffers.map((offer) => offer.id),
      skippedOfferIds: skippedLosingOffers.map((offer) => offer.id),
      skippedReasons: skippedLosingOffers.map(
        (offer) => `${offer.id}: ${offer._count.quoteItems} quote_items reference(s)`,
      ),
      historyRows,
      mergeData: buildMergeData(keep, deletableLosingOffers),
    });
  }

  return { groupRows, plans };
}

async function applyJunkProductPlan(candidates: JunkProductCandidate[]) {
  const productIds = candidates.map((candidate) => candidate.id);
  const offerIds = candidates.flatMap((candidate) => candidate.offerIds);

  if (offerIds.length > 0) {
    await prisma.priceHistory.deleteMany({
      where: { supplierOfferId: { in: offerIds } },
    });
    await prisma.supplierOffer.deleteMany({
      where: { id: { in: offerIds } },
    });
  }

  if (productIds.length > 0) {
    await prisma.productParam.deleteMany({
      where: { productId: { in: productIds } },
    });
    await prisma.product.deleteMany({
      where: { id: { in: productIds } },
    });
  }
}

async function applyDedupePlan(plans: DedupeGroupPlan[]) {
  const historyRows = plans.flatMap((plan) => plan.historyRows);
  const deleteOfferIds = plans.flatMap((plan) => plan.deleteOfferIds);

  if (historyRows.length > 0) {
    await prisma.priceHistory.createMany({
      data: historyRows.map((row) => ({
        id: row.id,
        supplierOfferId: row.supplierOfferId,
        oldPrice: row.oldPrice as never,
        newPrice: row.newPrice as never,
        oldSourceFileId: row.oldSourceFileId,
        newSourceFileId: row.newSourceFileId,
      })),
    });
  }

  for (const plan of plans) {
    if (Object.keys(plan.mergeData).length === 0) continue;
    await prisma.supplierOffer.update({
      where: { id: plan.keepOfferId },
      data: plan.mergeData,
    });
  }

  if (deleteOfferIds.length > 0) {
    await prisma.priceHistory.deleteMany({
      where: { supplierOfferId: { in: deleteOfferIds } },
    });
    await prisma.supplierOffer.deleteMany({
      where: { id: { in: deleteOfferIds } },
    });
  }
}

function table(rows: string[][]): string {
  if (rows.length === 0) return "";
  const header = rows[0];
  const separator = header.map(() => "---");
  return [header, separator, ...rows.slice(1)]
    .map((row) => `| ${row.join(" | ")} |`)
    .join("\n");
}

function sampleRows<T>(rows: T[], limit: number): T[] {
  return rows.slice(0, limit);
}

function formatCounts(counts: DbCounts): string {
  return table([
    ["Metric", "Count"],
    ["products", String(counts.products)],
    ["supplier_offers", String(counts.supplierOffers)],
    ["product_params", String(counts.productParams)],
    ["price_history", String(counts.priceHistory)],
    ["quote_items", String(counts.quoteItems)],
    ["customer_quote_rows", String(counts.customerQuoteRows)],
    ["duplicate offer groups", String(counts.duplicateOfferGroups)],
  ]);
}

async function writeReport(input: {
  backupPath: string | null;
  beforeCounts: DbCounts;
  afterCounts: DbCounts | null;
  junkCandidates: JunkProductCandidate[];
  junkSkips: JunkProductSkip[];
  dedupePlans: DedupeGroupPlan[];
  mode: "dry-run" | "apply";
}) {
  const deletedProductCount = input.junkCandidates.length;
  const deletedOfferCountA = input.junkCandidates.reduce(
    (sum, candidate) => sum + candidate.offerCount,
    0,
  );
  const deletedPriceHistoryCountA = input.junkCandidates.reduce(
    (sum, candidate) => sum + candidate.priceHistoryCount,
    0,
  );
  const deletedParamCountA = input.junkCandidates.reduce(
    (sum, candidate) => sum + candidate.paramCount,
    0,
  );

  const dedupeDeletedOffers = input.dedupePlans.reduce(
    (sum, plan) => sum + plan.deleteOfferIds.length,
    0,
  );
  const dedupeSkippedOffers = input.dedupePlans.reduce(
    (sum, plan) => sum + plan.skippedOfferIds.length,
    0,
  );
  const dedupeHistoryRows = input.dedupePlans.reduce(
    (sum, plan) => sum + plan.historyRows.length,
    0,
  );
  const dedupeMergedGroups = input.dedupePlans.filter(
    (plan) => Object.keys(plan.mergeData).length > 0,
  ).length;

  const duplicatePlansWithDeletes = input.dedupePlans.filter(
    (plan) => plan.deleteOfferIds.length > 0,
  );

  const content = `# V20.1 Offer Dedup Cleanup Report

Generated: ${new Date().toISOString()}

Mode: **${input.mode}**

Backup: \`${input.backupPath ?? "not found"}\`

## Before Counts

${formatCounts(input.beforeCounts)}

## Part A — Junk Product Cleanup

Rules:
- model_no length > 50
- all supplier offers have purchase_price = 0
- model_no contains MOQ / warranty / Packing / payment / working days / T/T / minimum / lead time

Safety skips:
- quote_items references
- customer_quote_rows matches
- image_path present

Planned/applied deletion:
- Products: ${deletedProductCount}
- Supplier offers: ${deletedOfferCountA}
- Product params: ${deletedParamCountA}
- Price history rows: ${deletedPriceHistoryCountA}
- Skipped products: ${input.junkSkips.length}

### Deleted Product Sample

${
  input.junkCandidates.length === 0
    ? "None."
    : table([
        ["product_id", "model_no", "category", "offers", "reason"],
        ...sampleRows(input.junkCandidates, 20).map((candidate) => [
          candidate.id,
          candidate.modelNo.replaceAll("|", "\\|").slice(0, 120),
          candidate.category ?? "-",
          String(candidate.offerCount),
          candidate.reasons.join("; "),
        ]),
      ])
}

### Skipped Product Sample

${
  input.junkSkips.length === 0
    ? "None."
    : table([
        ["product_id", "model_no", "category", "reason", "skip reason"],
        ...sampleRows(input.junkSkips, 20).map((candidate) => [
          candidate.id,
          candidate.modelNo.replaceAll("|", "\\|").slice(0, 100),
          candidate.category ?? "-",
          candidate.reasons.join("; "),
          candidate.skipReasons.join("; "),
        ]),
      ])
}

## Part B — Duplicate Supplier Offer Dedup

Duplicate groups processed: ${input.dedupePlans.length}

Planned/applied changes:
- Duplicate groups with deleted offers: ${duplicatePlansWithDeletes.length}
- Supplier offers deleted: ${dedupeDeletedOffers}
- Price history rows created for differing deleted prices: ${dedupeHistoryRows}
- Kept offers enriched from losing offers: ${dedupeMergedGroups}
- Offers skipped because quote_items reference them: ${dedupeSkippedOffers}

### Duplicate Group Sample

${
  duplicatePlansWithDeletes.length === 0
    ? "None."
    : table([
        [
          "model_no",
          "category",
          "factory",
          "total",
          "keep_offer_id",
          "keep_price",
          "delete_count",
          "history_rows",
          "merge_fields",
        ],
        ...sampleRows(duplicatePlansWithDeletes, 30).map((plan) => [
          plan.modelNo.replaceAll("|", "\\|").slice(0, 80),
          plan.category ?? "-",
          plan.factoryName.replaceAll("|", "\\|"),
          String(plan.totalOffers),
          plan.keepOfferId,
          plan.keepPrice,
          String(plan.deleteOfferIds.length),
          String(plan.historyRows.length),
          Object.keys(plan.mergeData).join(", ") || "-",
        ]),
      ])
}

### Quote Item Skips

${
  input.dedupePlans.some((plan) => plan.skippedOfferIds.length > 0)
    ? table([
        ["model_no", "factory", "skipped_offer_ids", "reason"],
        ...input.dedupePlans
          .filter((plan) => plan.skippedOfferIds.length > 0)
          .slice(0, 50)
          .map((plan) => [
            plan.modelNo.replaceAll("|", "\\|").slice(0, 80),
            plan.factoryName.replaceAll("|", "\\|"),
            plan.skippedOfferIds.join(", "),
            plan.skippedReasons.join("; "),
          ]),
      ])
    : "None."
}

## After Counts

${
  input.afterCounts
    ? formatCounts(input.afterCounts)
    : "Dry-run only. Re-run with `--apply` to update database and final counts."
}

## Verification

- \`npx tsc --noEmit --pretty false\`: pending
- \`npx vitest run\`: pending

## Notes

- Existing source Excel/PDF files were not modified.
- Existing quoted line items were not deleted.
- Duplicate offer groups with referenced losing offers are left as residual groups and reported above.
`;

  await writeFile(REPORT_PATH, content, "utf8");
}

async function main() {
  const backupPath = await findLatestBackup();
  const beforeCounts = await loadCounts();
  const junkPlan = await buildJunkProductPlan();
  const junkProductIds = new Set(junkPlan.candidates.map((candidate) => candidate.id));
  const dedupePlan = await buildDedupePlan(junkProductIds);

  if (APPLY_MODE) {
    await applyJunkProductPlan(junkPlan.candidates);
    await applyDedupePlan(dedupePlan.plans);
  }

  const afterCounts = APPLY_MODE ? await loadCounts() : null;
  await writeReport({
    backupPath,
    beforeCounts,
    afterCounts,
    junkCandidates: junkPlan.candidates,
    junkSkips: junkPlan.skips,
    dedupePlans: dedupePlan.plans,
    mode: APPLY_MODE ? "apply" : "dry-run",
  });

  console.log(
    JSON.stringify(
      {
        mode: APPLY_MODE ? "apply" : "dry-run",
        report: REPORT_PATH,
        backup: backupPath,
        junkProducts: junkPlan.candidates.length,
        junkSkips: junkPlan.skips.length,
        duplicateGroups: dedupePlan.plans.length,
        duplicateOffersToDelete: dedupePlan.plans.reduce(
          (sum, plan) => sum + plan.deleteOfferIds.length,
          0,
        ),
        duplicateOfferSkips: dedupePlan.plans.reduce(
          (sum, plan) => sum + plan.skippedOfferIds.length,
          0,
        ),
        beforeCounts,
        afterCounts,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
