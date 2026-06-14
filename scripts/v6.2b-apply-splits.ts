import { copyFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

import { Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const REPORT_PATH = path.join("docs", "v6.2b-apply-report.md");
const BACKUP_PATH = path.join("prisma", "dev.db.bak-v6.2b");
const UNKNOWN_CATEGORY = "无法推断";
const UNCERTAIN_TUBE_BULB = "球泡灯管(不确定)";
const EXPECTED_AUTO_SAFE_OFFERS = 302;
const REQUIRED_18W_PRODUCT_ID = "f5b0f347-0541-42a1-9bd1-e0e93f58336c";

const EXCLUDED_PRODUCT_IDS = new Set([
  "011c8254-4be9-492f-972f-585685479e45",
  "114ab7a9-860e-49ad-9f2b-2b8ea428b3f0",
  "307f98cb-4714-4a07-adb3-8f67bd8ae6aa",
]);

type CollisionProductRow = {
  product_id: string;
  model_no: string | null;
  product_name: string;
  category: string | null;
  offer_count: number | bigint;
  factories: string | null;
};

type CollisionOfferRow = {
  product_id: string;
  model_no: string | null;
  product_name: string;
  category: string | null;
  offer_id: string;
  factory_name: string;
  purchase_price: number | string;
  currency: string;
  source_file_id: string | null;
  relative_path: string | null;
  file_name: string | null;
};

type ProductReferenceRow = {
  product_id: string;
  customer_quote_rows: number | bigint;
  quote_items: number | bigint;
};

type MappingRule = {
  category: string;
  keywords: RegExp[];
};

type CategoryMatch = {
  category: string;
  segmentIndex: number;
  keyword: string;
  segment: string;
};

type SegmentCategoryHit = {
  category: string;
  segment: string;
  keyword: string;
};

type ConflictCheck = {
  hasConflict: boolean;
  categories: string[];
  hits: SegmentCategoryHit[];
  reason: string;
};

type InferredOffer = CollisionOfferRow & {
  inferredCategory: string;
  inferenceReason: string;
  conflict: ConflictCheck;
  planStatus: "auto-safe" | "review-needed" | "skip";
  planReason: string;
};

type CollisionGroup = {
  productId: string;
  modelNo: string;
  productName: string;
  category: string;
  offerCount: number;
  factories: string[];
  offers: InferredOffer[];
  status: "normal" | "suspected_cross_category" | "unable_to_judge";
  mismatchCount: number;
  unknownLikeCount: number;
  refs: {
    customerQuoteRows: number;
    quoteItems: number;
  };
};

type SplitTarget = {
  key: string;
  modelNo: string;
  targetCategory: string;
  sourceProductId: string;
  newProductId: string;
  offers: InferredOffer[];
};

type CountSnapshot = Record<
  "products" | "supplier_offers" | "product_params" | "price_history" | "quote_items" | "customer_quote_rows",
  number
>;

type NewProductSummary = {
  id: string;
  modelNo: string;
  category: string;
  offerCount: number;
  factories: string[];
  minPrice: number | null;
  maxPrice: number | null;
};

type EmptyShellProduct = {
  productId: string;
  modelNo: string;
  category: string;
};

type ExcludedProductCheck = {
  productId: string;
  modelNo: string;
  category: string | null;
  beforeOffers: number;
  afterOffers: number;
  unchanged: boolean;
};

type VerificationResult = {
  name: string;
  passed: boolean;
  detail: string;
};

type ApplyResult = {
  generatedAt: string;
  backupPath: string;
  beforeCounts: CountSnapshot;
  afterCounts: CountSnapshot;
  excludedChecks: ExcludedProductCheck[];
  splitTargets: SplitTarget[];
  newProducts: NewProductSummary[];
  emptyShells: EmptyShellProduct[];
  productRefs: Array<{
    productId: string;
    modelNo: string;
    category: string;
    customerQuoteRows: number;
    quoteItems: number;
    migratedAutoSafeOffers: number;
  }>;
  eighteenWOfferCount: number;
  verification: VerificationResult[];
  notes: string[];
};

const CATEGORY_RULES: MappingRule[] = [
  { category: "面板灯", keywords: [/大面板/i, /小面板/i, /面板/i] },
  { category: "投光灯", keywords: [/投光/i] },
  { category: "线条灯", keywords: [/线条/i, /办公灯/i] },
  { category: "吸顶灯", keywords: [/吸顶/i] },
  { category: "筒灯", keywords: [/筒灯/i] },
  { category: "三防灯", keywords: [/三防/i] },
  { category: "磁吸灯", keywords: [/磁吸/i] },
  { category: "净化灯", keywords: [/净化/i] },
  { category: "镜前灯", keywords: [/镜前/i] },
  { category: "防潮灯", keywords: [/防潮/i] },
  { category: "壁灯", keywords: [/市电壁灯/i, /壁灯/i] },
  { category: "橱柜灯", keywords: [/橱柜/i] },
  { category: "灯丝灯", keywords: [/灯丝/i] },
  { category: "轨道灯", keywords: [/轨道/i] },
  { category: "太阳能壁灯", keywords: [/太阳能/i, /solar/i] },
  { category: "庭院灯", keywords: [/庭院/i] },
  { category: "应急灯", keywords: [/应急/i] },
  { category: "地埋灯", keywords: [/地埋/i] },
  { category: "台灯", keywords: [/台灯/i] },
  { category: "皮线灯", keywords: [/皮线/i] },
  { category: "路灯", keywords: [/路灯/i] },
  { category: "Highbay", keywords: [/highbay/i, /工矿/i] },
  { category: "风扇灯", keywords: [/风扇/i] },
  { category: "工作灯", keywords: [/工作灯/i] },
  { category: "充电灯", keywords: [/充电/i] },
  { category: "灯带", keywords: [/灯带/i] },
  { category: "G4G9", keywords: [/g4/i, /g9/i, /gu10/i] },
];

async function main() {
  const generatedAt = new Date().toISOString();
  const beforeCounts = await getDbCounts();
  const plan = await buildPlan();
  const autoSafeOfferCount = sum(plan.splitTargets.map((target) => target.offers.length));

  if (autoSafeOfferCount !== EXPECTED_AUTO_SAFE_OFFERS) {
    await writeFile(REPORT_PATH, buildPreflightFailureReport(generatedAt, plan, autoSafeOfferCount), "utf8");
    throw new Error(
      `Expected ${EXPECTED_AUTO_SAFE_OFFERS} auto-safe offers after exclusions, got ${autoSafeOfferCount}. See ${REPORT_PATH}.`,
    );
  }

  await copyFile("prisma/dev.db", BACKUP_PATH);
  const excludedBefore = await getExcludedProductChecks();

  await prisma.$transaction(async (tx) => {
    const now = new Date();
    for (const target of plan.splitTargets) {
      await tx.product.create({
        data: {
          id: target.newProductId,
          productName: `${target.modelNo} (${target.targetCategory})`,
          modelNo: target.modelNo,
          category: target.targetCategory,
          createdAt: now,
          updatedAt: now,
        },
      });

      await tx.supplierOffer.updateMany({
        where: { id: { in: target.offers.map((offer) => offer.offer_id) } },
        data: { productId: target.newProductId },
      });
    }
  });

  const afterCounts = await getDbCounts();
  const newProducts = await getNewProductSummaries(plan.splitTargets.map((target) => target.newProductId));
  const emptyShells = await getEmptyShellProducts(plan.sourceProductIds);
  const excludedAfter = await getExcludedProductChecks();
  const excludedChecks = mergeExcludedChecks(excludedBefore, excludedAfter);
  const eighteenWOfferCount = await prisma.supplierOffer.count({ where: { productId: REQUIRED_18W_PRODUCT_ID } });
  const verification = buildVerification({
    beforeCounts,
    afterCounts,
    splitTargets: plan.splitTargets,
    newProducts,
    excludedChecks,
    eighteenWOfferCount,
  });
  const productRefs = buildReferencedProductRows(plan.groups);
  const notes = buildNotes();

  const report = buildReport({
    generatedAt,
    backupPath: BACKUP_PATH,
    beforeCounts,
    afterCounts,
    excludedChecks,
    splitTargets: plan.splitTargets,
    newProducts,
    emptyShells,
    productRefs,
    eighteenWOfferCount,
    verification,
    notes,
  });

  await writeFile(REPORT_PATH, report, "utf8");

  const failed = verification.filter((check) => !check.passed);
  console.log(
    JSON.stringify(
      {
        reportPath: REPORT_PATH,
        backupPath: BACKUP_PATH,
        newProducts: plan.splitTargets.length,
        migratedOffers: autoSafeOfferCount,
        emptyShells: emptyShells.length,
        beforeCounts,
        afterCounts,
        failedChecks: failed,
      },
      null,
      2,
    ),
  );

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

async function buildPlan() {
  const collisionProducts = await getCollisionProducts();
  const collisionOffers = await getCollisionOffers();
  const refs = await getProductReferences();
  const groups = buildGroups(collisionProducts, collisionOffers, refs).filter(
    (group) => group.status === "suspected_cross_category" && !EXCLUDED_PRODUCT_IDS.has(group.productId),
  );
  const splitTargets = buildSplitTargets(groups);
  const sourceProductIds = Array.from(new Set(splitTargets.flatMap((target) => target.offers.map((offer) => offer.product_id))));
  return { groups, splitTargets, sourceProductIds };
}

async function getCollisionProducts(): Promise<CollisionProductRow[]> {
  return prisma.$queryRaw<CollisionProductRow[]>`
    SELECT
      p.id AS product_id,
      p.model_no,
      p.product_name,
      p.category,
      COUNT(so.id) AS offer_count,
      GROUP_CONCAT(DISTINCT so.factory_name) AS factories
    FROM products p
    JOIN supplier_offers so ON so.product_id = p.id
    WHERE p.model_no IS NOT NULL
      AND TRIM(p.model_no) <> ''
    GROUP BY p.id, p.model_no, p.product_name, p.category
    HAVING COUNT(so.id) >= 3
    ORDER BY COUNT(so.id) DESC, p.model_no, p.category, p.product_name
  `;
}

async function getCollisionOffers(): Promise<CollisionOfferRow[]> {
  return prisma.$queryRaw<CollisionOfferRow[]>`
    WITH collision_products AS (
      SELECT p.id
      FROM products p
      JOIN supplier_offers so ON so.product_id = p.id
      WHERE p.model_no IS NOT NULL
        AND TRIM(p.model_no) <> ''
      GROUP BY p.id
      HAVING COUNT(so.id) >= 3
    )
    SELECT
      p.id AS product_id,
      p.model_no,
      p.product_name,
      p.category,
      so.id AS offer_id,
      so.factory_name,
      CAST(so.purchase_price AS TEXT) AS purchase_price,
      so.currency,
      so.source_file_id,
      f.relative_path,
      f.file_name
    FROM supplier_offers so
    JOIN products p ON p.id = so.product_id
    JOIN collision_products cp ON cp.id = p.id
    LEFT JOIN files f ON f.id = so.source_file_id
    ORDER BY p.model_no, p.category, so.factory_name, so.id
  `;
}

async function getProductReferences(): Promise<Map<string, { customerQuoteRows: number; quoteItems: number }>> {
  const rows = await prisma.$queryRaw<ProductReferenceRow[]>`
    SELECT
      p.id AS product_id,
      COALESCE(cqr.refs, 0) AS customer_quote_rows,
      COALESCE(qi.refs, 0) AS quote_items
    FROM products p
    LEFT JOIN (
      SELECT matched_product_id, COUNT(*) AS refs
      FROM customer_quote_rows
      WHERE matched_product_id IS NOT NULL
      GROUP BY matched_product_id
    ) cqr ON cqr.matched_product_id = p.id
    LEFT JOIN (
      SELECT product_id, COUNT(*) AS refs
      FROM quote_items
      GROUP BY product_id
    ) qi ON qi.product_id = p.id
  `;

  return new Map(
    rows.map((row) => [
      row.product_id,
      {
        customerQuoteRows: toNumber(row.customer_quote_rows),
        quoteItems: toNumber(row.quote_items),
      },
    ]),
  );
}

async function getDbCounts(): Promise<CountSnapshot> {
  const rows = await prisma.$queryRaw<{ table_name: keyof CountSnapshot; cnt: number | bigint }[]>`
    SELECT 'products' AS table_name, COUNT(*) AS cnt FROM products
    UNION ALL SELECT 'supplier_offers', COUNT(*) FROM supplier_offers
    UNION ALL SELECT 'product_params', COUNT(*) FROM product_params
    UNION ALL SELECT 'price_history', COUNT(*) FROM price_history
    UNION ALL SELECT 'quote_items', COUNT(*) FROM quote_items
    UNION ALL SELECT 'customer_quote_rows', COUNT(*) FROM customer_quote_rows
  `;

  return Object.fromEntries(rows.map((row) => [row.table_name, toNumber(row.cnt)])) as CountSnapshot;
}

function buildGroups(
  products: CollisionProductRow[],
  offers: CollisionOfferRow[],
  refs: Map<string, { customerQuoteRows: number; quoteItems: number }>,
): CollisionGroup[] {
  const offersByProduct = new Map<string, InferredOffer[]>();

  for (const offer of offers) {
    const inferred = inferCategory(offer.relative_path, offer.file_name);
    const conflict = checkCategoryConflict(offer.relative_path, offer.file_name);
    const currentCategory = offer.category ?? "(无品类)";
    const plan = classifyOffer(inferred.category, currentCategory, conflict);
    const enriched: InferredOffer = {
      ...offer,
      inferredCategory: inferred.category,
      inferenceReason: inferred.reason,
      conflict,
      planStatus: plan.status,
      planReason: plan.reason,
    };
    const existing = offersByProduct.get(offer.product_id) ?? [];
    existing.push(enriched);
    offersByProduct.set(offer.product_id, existing);
  }

  return products.map((product) => {
    const productOffers = offersByProduct.get(product.product_id) ?? [];
    const category = product.category ?? "(无品类)";
    const unknownLikeCount = productOffers.filter((offer) => isUnknownLike(offer.inferredCategory)).length;
    const mismatchCount = productOffers.filter(
      (offer) => !isUnknownLike(offer.inferredCategory) && offer.inferredCategory !== category,
    ).length;

    let status: CollisionGroup["status"] = "normal";
    if (unknownLikeCount > productOffers.length / 2) {
      status = "unable_to_judge";
    } else if (mismatchCount > 0) {
      status = "suspected_cross_category";
    }

    return {
      productId: product.product_id,
      modelNo: product.model_no ?? "(no model)",
      productName: product.product_name,
      category,
      offerCount: toNumber(product.offer_count),
      factories: splitFactories(product.factories),
      offers: productOffers,
      status,
      mismatchCount,
      unknownLikeCount,
      refs: refs.get(product.product_id) ?? { customerQuoteRows: 0, quoteItems: 0 },
    };
  });
}

function classifyOffer(
  inferredCategory: string,
  productCategory: string,
  conflict: ConflictCheck,
): { status: InferredOffer["planStatus"]; reason: string } {
  if (inferredCategory === UNKNOWN_CATEGORY) {
    return { status: "skip", reason: "无法推断来源品类" };
  }
  if (inferredCategory === productCategory) {
    return { status: "skip", reason: "推断品类已等于当前产品品类" };
  }
  if (inferredCategory === UNCERTAIN_TUBE_BULB) {
    return { status: "review-needed", reason: "球泡灯管合并目录无法区分" };
  }
  if (conflict.hasConflict) {
    return { status: "review-needed", reason: `路径/文件名命中多个品类：${conflict.categories.join(", ")}` };
  }
  return { status: "auto-safe", reason: "明确跨品类且无路径关键词冲突" };
}

function buildSplitTargets(groups: CollisionGroup[]): SplitTarget[] {
  const targets = new Map<string, SplitTarget>();

  for (const group of groups) {
    for (const offer of group.offers) {
      if (offer.planStatus !== "auto-safe") {
        continue;
      }
      const key = targetKey(group.modelNo, offer.inferredCategory);
      const target =
        targets.get(key) ??
        ({
          key,
          modelNo: group.modelNo,
          targetCategory: offer.inferredCategory,
          sourceProductId: group.productId,
          newProductId: randomUUID(),
          offers: [],
        } satisfies SplitTarget);
      target.offers.push(offer);
      targets.set(key, target);
    }
  }

  return Array.from(targets.values()).sort(
    (a, b) => a.modelNo.localeCompare(b.modelNo) || a.targetCategory.localeCompare(b.targetCategory),
  );
}

async function getNewProductSummaries(productIds: string[]): Promise<NewProductSummary[]> {
  if (productIds.length === 0) {
    return [];
  }
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      model_no: string | null;
      category: string | null;
      offer_count: number | bigint;
      factories: string | null;
      min_price: number | string | null;
      max_price: number | string | null;
    }>
  >`
    SELECT
      p.id,
      p.model_no,
      p.category,
      COUNT(so.id) AS offer_count,
      GROUP_CONCAT(DISTINCT so.factory_name) AS factories,
      MIN(CAST(so.purchase_price AS REAL)) AS min_price,
      MAX(CAST(so.purchase_price AS REAL)) AS max_price
    FROM products p
    LEFT JOIN supplier_offers so ON so.product_id = p.id
    WHERE p.id IN (${Prisma.join(productIds)})
    GROUP BY p.id, p.model_no, p.category
    ORDER BY p.model_no, p.category
  `;

  return rows.map((row) => ({
    id: row.id,
    modelNo: row.model_no ?? "",
    category: row.category ?? "",
    offerCount: toNumber(row.offer_count),
    factories: splitFactories(row.factories),
    minPrice: toNullableNumber(row.min_price),
    maxPrice: toNullableNumber(row.max_price),
  }));
}

async function getEmptyShellProducts(sourceProductIds: string[]): Promise<EmptyShellProduct[]> {
  if (sourceProductIds.length === 0) {
    return [];
  }
  const rows = await prisma.$queryRaw<Array<{ id: string; model_no: string | null; category: string | null; offer_count: number | bigint }>>`
    SELECT p.id, p.model_no, p.category, COUNT(so.id) AS offer_count
    FROM products p
    LEFT JOIN supplier_offers so ON so.product_id = p.id
    WHERE p.id IN (${Prisma.join(sourceProductIds)})
    GROUP BY p.id, p.model_no, p.category
    HAVING COUNT(so.id) = 0
    ORDER BY p.model_no, p.category
  `;

  return rows.map((row) => ({
    productId: row.id,
    modelNo: row.model_no ?? "",
    category: row.category ?? "",
  }));
}

async function getExcludedProductChecks(): Promise<ExcludedProductCheck[]> {
  const productIds = Array.from(EXCLUDED_PRODUCT_IDS);
  const rows = await prisma.$queryRaw<Array<{ id: string; model_no: string | null; category: string | null; offer_count: number | bigint }>>`
    SELECT p.id, p.model_no, p.category, COUNT(so.id) AS offer_count
    FROM products p
    LEFT JOIN supplier_offers so ON so.product_id = p.id
    WHERE p.id IN (${Prisma.join(productIds)})
    GROUP BY p.id, p.model_no, p.category
    ORDER BY p.model_no, p.category
  `;

  return rows.map((row) => ({
    productId: row.id,
    modelNo: row.model_no ?? "",
    category: row.category,
    beforeOffers: toNumber(row.offer_count),
    afterOffers: toNumber(row.offer_count),
    unchanged: true,
  }));
}

function mergeExcludedChecks(before: ExcludedProductCheck[], after: ExcludedProductCheck[]): ExcludedProductCheck[] {
  const afterById = new Map(after.map((row) => [row.productId, row]));
  return before.map((row) => {
    const finalRow = afterById.get(row.productId);
    return {
      ...row,
      afterOffers: finalRow?.afterOffers ?? 0,
      unchanged: row.beforeOffers === (finalRow?.afterOffers ?? 0),
    };
  });
}

function buildVerification(input: {
  beforeCounts: CountSnapshot;
  afterCounts: CountSnapshot;
  splitTargets: SplitTarget[];
  newProducts: NewProductSummary[];
  excludedChecks: ExcludedProductCheck[];
  eighteenWOfferCount: number;
}): VerificationResult[] {
  const migratedOfferCount = sum(input.splitTargets.map((target) => target.offers.length));
  const expectedProducts = input.beforeCounts.products + input.splitTargets.length;
  const newProductsById = new Map(input.newProducts.map((product) => [product.id, product]));
  const newProductCategoriesOk = input.splitTargets.every((target) => {
    const product = newProductsById.get(target.newProductId);
    return product && product.category === target.targetCategory && product.offerCount >= 1;
  });

  return [
    {
      name: "产品总数 = before + 新建数",
      passed: input.afterCounts.products === expectedProducts,
      detail: `${input.beforeCounts.products} + ${input.splitTargets.length} = ${expectedProducts}; actual ${input.afterCounts.products}`,
    },
    {
      name: "supplier_offers 总数不变",
      passed: input.afterCounts.supplier_offers === input.beforeCounts.supplier_offers,
      detail: `${input.beforeCounts.supplier_offers} -> ${input.afterCounts.supplier_offers}; migrated ${migratedOfferCount}`,
    },
    {
      name: "product_params 总数不变",
      passed: input.afterCounts.product_params === input.beforeCounts.product_params,
      detail: `${input.beforeCounts.product_params} -> ${input.afterCounts.product_params}`,
    },
    {
      name: "price_history 总数不变",
      passed: input.afterCounts.price_history === input.beforeCounts.price_history,
      detail: `${input.beforeCounts.price_history} -> ${input.afterCounts.price_history}`,
    },
    {
      name: "quote_items 总数不变",
      passed: input.afterCounts.quote_items === input.beforeCounts.quote_items,
      detail: `${input.beforeCounts.quote_items} -> ${input.afterCounts.quote_items}`,
    },
    {
      name: "customer_quote_rows 总数不变",
      passed: input.afterCounts.customer_quote_rows === input.beforeCounts.customer_quote_rows,
      detail: `${input.beforeCounts.customer_quote_rows} -> ${input.afterCounts.customer_quote_rows}`,
    },
    {
      name: "每个新产品至少 1 个 offer 且 category 正确",
      passed: newProductCategoriesOk,
      detail: `${input.newProducts.filter((product) => product.offerCount >= 1).length}/${input.splitTargets.length} new products have offers`,
    },
    {
      name: "排除列表产品 offer 数不变",
      passed: input.excludedChecks.every((check) => check.unchanged) && input.excludedChecks.length === EXCLUDED_PRODUCT_IDS.size,
      detail: input.excludedChecks
        .map((check) => `${check.modelNo}: ${check.beforeOffers}->${check.afterOffers}`)
        .join(", "),
    },
    {
      name: "18W 灯管产品仍保留 >= 7 个 offer",
      passed: input.eighteenWOfferCount >= 7,
      detail: `product ${REQUIRED_18W_PRODUCT_ID}: ${input.eighteenWOfferCount} offers`,
    },
  ];
}

function buildReferencedProductRows(groups: CollisionGroup[]) {
  return groups
    .filter((group) => group.refs.customerQuoteRows > 0 || group.refs.quoteItems > 0)
    .map((group) => ({
      productId: group.productId,
      modelNo: group.modelNo,
      category: group.category,
      customerQuoteRows: group.refs.customerQuoteRows,
      quoteItems: group.refs.quoteItems,
      migratedAutoSafeOffers: group.offers.filter((offer) => offer.planStatus === "auto-safe").length,
    }));
}

function buildNotes(): string[] {
  return [
    "本项目当前 products 表没有 min_price / max_price / avg_price 字段，因此价格统计以报告查询展示，不写回 products。",
    "当前 product_params 表没有 supplier_offer_id 字段，无法按迁移 offer 精准搬迁参数；为避免误移仍属于原产品的参数，本轮 product_params 保持不动。",
    "当前 price_history 表只通过 supplier_offer_id 关联 supplier_offers，没有 product_id 字段；offer 迁移后历史价格仍可通过 supplier_offer_id 追溯，无需更新。",
    "products 表没有 unit 字段；新建产品只写 id / product_name / model_no / category / timestamps。",
    "review-needed 与 skip offer 未处理；三个 SL-* 排除产品未迁移。",
  ];
}

function buildReport(data: ApplyResult): string {
  const migratedOfferCount = sum(data.splitTargets.map((target) => target.offers.length));
  const lines: string[] = [];
  lines.push("# V6.2B — auto-safe 跨品类碰撞拆分执行报告");
  lines.push("");
  lines.push(`Generated: ${data.generatedAt}`);
  lines.push("");
  lines.push("## 总览");
  lines.push("");
  lines.push(`- 备份路径：${escapeMd(data.backupPath)}`);
  lines.push(`- 新建产品数：${data.splitTargets.length}`);
  lines.push(`- 迁移 offer 数：${migratedOfferCount}`);
  lines.push(`- 排除产品数：${EXCLUDED_PRODUCT_IDS.size}`);
  lines.push(`- 空壳原产品数：${data.emptyShells.length}`);
  lines.push("");
  lines.push("| Table | Before | After | Delta |");
  lines.push("|---|---:|---:|---:|");
  for (const key of Object.keys(data.beforeCounts).sort() as Array<keyof CountSnapshot>) {
    const before = data.beforeCounts[key];
    const after = data.afterCounts[key];
    lines.push(`| ${escapeMd(key)} | ${before} | ${after} | ${formatDelta(after - before)} |`);
  }
  lines.push("");
  lines.push("## 后验证");
  lines.push("");
  lines.push("| Check | Result | Detail |");
  lines.push("|---|---|---|");
  for (const check of data.verification) {
    lines.push(`| ${escapeMd(check.name)} | ${check.passed ? "PASS" : "FAIL"} | ${escapeMd(check.detail)} |`);
  }
  lines.push("");
  lines.push("## 新建产品表");
  lines.push("");
  lines.push("| id | model_no | category | offer_count | factories | min_price | max_price |");
  lines.push("|---|---|---|---:|---|---:|---:|");
  for (const product of data.newProducts) {
    lines.push(
      `| ${product.id} | ${escapeMd(product.modelNo)} | ${escapeMd(product.category)} | ${product.offerCount} | ${escapeMd(
        product.factories.join(", "),
      )} | ${formatNullableNumber(product.minPrice)} | ${formatNullableNumber(product.maxPrice)} |`,
    );
  }
  lines.push("");
  lines.push("## 空壳原产品表");
  lines.push("");
  if (data.emptyShells.length === 0) {
    lines.push("无。");
  } else {
    lines.push("| product_id | model_no | 原 category |");
    lines.push("|---|---|---|");
    for (const product of data.emptyShells) {
      lines.push(`| ${product.productId} | ${escapeMd(product.modelNo)} | ${escapeMd(product.category)} |`);
    }
  }
  lines.push("");
  lines.push("## 排除产品确认");
  lines.push("");
  lines.push("| product_id | model_no | category | before offers | after offers | unchanged |");
  lines.push("|---|---|---|---:|---:|---|");
  for (const check of data.excludedChecks) {
    lines.push(
      `| ${check.productId} | ${escapeMd(check.modelNo)} | ${escapeMd(check.category ?? "")} | ${check.beforeOffers} | ${
        check.afterOffers
      } | ${check.unchanged ? "YES" : "NO"} |`,
    );
  }
  lines.push("");
  lines.push("## FK 引用产品状态");
  lines.push("");
  if (data.productRefs.length === 0) {
    lines.push("无 FK 引用产品参与本轮 auto-safe 迁移。");
  } else {
    lines.push("| product_id | model_no | category | customer_quote_rows | quote_items | migrated auto-safe offers |");
    lines.push("|---|---|---|---:|---:|---:|");
    for (const row of data.productRefs) {
      lines.push(
        `| ${row.productId} | ${escapeMd(row.modelNo)} | ${escapeMd(row.category)} | ${row.customerQuoteRows} | ${row.quoteItems} | ${row.migratedAutoSafeOffers} |`,
      );
    }
  }
  lines.push("");
  lines.push(`- 18W 灯管产品 \`${REQUIRED_18W_PRODUCT_ID}\` 当前 offer 数：${data.eighteenWOfferCount}`);
  lines.push("");
  lines.push("## Notes");
  lines.push("");
  for (const note of data.notes) {
    lines.push(`- ${note}`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function buildPreflightFailureReport(generatedAt: string, plan: { groups: CollisionGroup[]; splitTargets: SplitTarget[] }, actual: number): string {
  const lines: string[] = [];
  lines.push("# V6.2B — preflight failed");
  lines.push("");
  lines.push(`Generated: ${generatedAt}`);
  lines.push("");
  lines.push(`Expected auto-safe offers after exclusions: ${EXPECTED_AUTO_SAFE_OFFERS}`);
  lines.push(`Actual auto-safe offers after exclusions: ${actual}`);
  lines.push("");
  lines.push("| model_no | source category | target category | offer_count | factories |");
  lines.push("|---|---|---|---:|---|");
  for (const target of plan.splitTargets) {
    const sourceCategory = target.offers[0]?.category ?? "";
    lines.push(
      `| ${escapeMd(target.modelNo)} | ${escapeMd(sourceCategory)} | ${escapeMd(target.targetCategory)} | ${
        target.offers.length
      } | ${escapeMd(unique(target.offers.map((offer) => offer.factory_name)).join(", "))} |`,
    );
  }
  return `${lines.join("\n")}\n`;
}

function inferCategory(relativePath: string | null, fileName: string | null): { category: string; reason: string } {
  const pathText = normalizeForMatch(relativePath ?? "");
  const nameText = normalizeForMatch(fileName ?? "");
  const combinedPath = pathText ? pathText : nameText;

  if (!combinedPath && !nameText) {
    return { category: UNKNOWN_CATEGORY, reason: "无 source_file_id 或文件路径" };
  }

  if (hasTubeBulbCombinedPath(pathText)) {
    if (/(灯管|t5|t8)/i.test(nameText)) {
      return { category: "灯管", reason: "光源/球泡灯管 + file_name 命中 灯管/T5/T8" };
    }
    if (/(球泡|bulb)/i.test(nameText)) {
      return { category: "球泡", reason: "光源/球泡灯管 + file_name 命中 球泡/bulb" };
    }
    return { category: UNCERTAIN_TUBE_BULB, reason: "光源/球泡灯管 目录，但 file_name 未区分球泡/灯管" };
  }

  const segments = buildSegments(relativePath, fileName);
  let bestMatch: CategoryMatch | null = null;

  segments.forEach((segment, segmentIndex) => {
    const normalizedSegment = normalizeForMatch(segment);
    CATEGORY_RULES.forEach((rule) => {
      for (const keyword of rule.keywords) {
        if (keyword.test(normalizedSegment)) {
          if (!bestMatch || segmentIndex > bestMatch.segmentIndex) {
            bestMatch = {
              category: rule.category,
              segmentIndex,
              keyword: keyword.source,
              segment,
            };
          }
          break;
        }
      }
    });
  });

  const match = bestMatch as CategoryMatch | null;
  if (match) {
    return {
      category: match.category,
      reason: `segment "${match.segment}" 命中 /${match.keyword}/`,
    };
  }

  return { category: UNKNOWN_CATEGORY, reason: "路径段和文件名未命中品类关键词" };
}

function checkCategoryConflict(relativePath: string | null, fileName: string | null): ConflictCheck {
  const hits: SegmentCategoryHit[] = [];
  const segments = buildSegments(relativePath, fileName);
  const pathText = normalizeForMatch(relativePath ?? "");
  const nameText = normalizeForMatch(fileName ?? "");

  for (const segment of segments) {
    const normalizedSegment = normalizeForMatch(segment);
    for (const rule of CATEGORY_RULES) {
      for (const keyword of rule.keywords) {
        if (keyword.test(normalizedSegment)) {
          hits.push({ category: rule.category, segment, keyword: keyword.source });
          break;
        }
      }
    }
  }

  if (hasTubeBulbCombinedPath(pathText)) {
    if (/(灯管|t5|t8)/i.test(nameText)) {
      hits.push({ category: "灯管", segment: fileName ?? "", keyword: "灯管|t5|t8" });
    }
    if (/(球泡|bulb)/i.test(nameText)) {
      hits.push({ category: "球泡", segment: fileName ?? "", keyword: "球泡|bulb" });
    }
  }

  const categories = Array.from(new Set(hits.map((hit) => hit.category))).sort();
  return {
    hasConflict: categories.length > 1,
    categories,
    hits,
    reason:
      categories.length > 1
        ? hits.map((hit) => `${hit.category}:${hit.segment}`).join(" / ")
        : categories.length === 1
          ? `单一品类命中：${categories[0]}`
          : "无品类关键词命中",
  };
}

function hasTubeBulbCombinedPath(relativePath: string): boolean {
  const normalizedPath = normalizeForMatch(relativePath);
  return normalizedPath.includes("光源/球泡灯管") || normalizedPath.includes("光源\\球泡灯管");
}

function buildSegments(relativePath: string | null, fileName: string | null): string[] {
  const pathSegments = (relativePath ?? "")
    .split(/[\\/]+/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  const fileSegment = (fileName ?? "").trim();

  if (fileSegment && pathSegments[pathSegments.length - 1] !== fileSegment) {
    pathSegments.push(fileSegment);
  }

  return pathSegments;
}

function normalizeForMatch(value: string): string {
  return value.normalize("NFC").trim().toLowerCase();
}

function isUnknownLike(category: string): boolean {
  return category === UNKNOWN_CATEGORY || category === UNCERTAIN_TUBE_BULB;
}

function splitFactories(value: string | null): string[] {
  return (value ?? "")
    .split(",")
    .map((factory) => factory.trim())
    .filter(Boolean);
}

function targetKey(modelNo: string, category: string): string {
  return `${modelNo.normalize("NFC").trim()}|||${category.normalize("NFC").trim()}`;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values)).sort();
}

function sum(values: number[]): number {
  return values.reduce((acc, value) => acc + value, 0);
}

function toNumber(value: number | bigint | null | undefined): number {
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (typeof value === "number") {
    return value;
  }
  return 0;
}

function toNullableNumber(value: number | string | null): number | null {
  if (value === null) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatNullableNumber(value: number | null): string {
  if (value === null) {
    return "-";
  }
  return value.toLocaleString("en-US", { maximumFractionDigits: 4, minimumFractionDigits: 0 });
}

function formatDelta(value: number): string {
  if (value > 0) {
    return `+${value}`;
  }
  return String(value);
}

function escapeMd(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/\n/g, " ")
    .replace(/\r/g, " ")
    .trim();
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
