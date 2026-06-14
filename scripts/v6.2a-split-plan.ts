import { writeFile } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const REPORT_PATH = path.join("docs", "v6.2a-split-plan.md");
const UNKNOWN_CATEGORY = "无法推断";
const UNCERTAIN_TUBE_BULB = "球泡灯管(不确定)";

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

type ExistingProductRow = {
  id: string;
  model_no: string | null;
  category: string | null;
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
  existingProductId: string | null;
  offers: InferredOffer[];
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
  const beforeCounts = await getDbCounts();
  const collisionProducts = await getCollisionProducts();
  const collisionOffers = await getCollisionOffers();
  const refs = await getProductReferences();
  const existingProducts = await getExistingProducts();

  const groups = buildGroups(collisionProducts, collisionOffers, refs);
  const suspectedGroups = groups.filter((group) => group.status === "suspected_cross_category");
  const splitTargets = buildSplitTargets(suspectedGroups, existingProducts);
  const afterCounts = await getDbCounts();

  const report = buildReport({
    beforeCounts,
    afterCounts,
    groups: suspectedGroups,
    splitTargets,
  });

  await writeFile(REPORT_PATH, report, "utf8");

  const offerCounts = countOfferStatuses(suspectedGroups);
  const targetStats = countSplitTargets(splitTargets);

  console.log(
    JSON.stringify(
      {
        reportPath: REPORT_PATH,
        suspectedGroups: suspectedGroups.length,
        suspectedOffers: sum(suspectedGroups.map((group) => group.offerCount)),
        autoSafeOffers: offerCounts.autoSafe,
        reviewNeededOffers: offerCounts.reviewNeeded,
        skipOffers: offerCounts.skip,
        splitTargets: splitTargets.length,
        targetProductsToCreate: targetStats.newTargets,
        existingTargetProducts: targetStats.existingTargets,
        dbUnchanged: JSON.stringify(beforeCounts) === JSON.stringify(afterCounts),
      },
      null,
      2,
    ),
  );
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

async function getExistingProducts(): Promise<Map<string, ExistingProductRow[]>> {
  const rows = await prisma.$queryRaw<ExistingProductRow[]>`
    SELECT id, model_no, category
    FROM products
    WHERE model_no IS NOT NULL
      AND TRIM(model_no) <> ''
  `;

  const byKey = new Map<string, ExistingProductRow[]>();
  for (const row of rows) {
    const key = targetKey(row.model_no ?? "", row.category ?? "(无品类)");
    const existing = byKey.get(key) ?? [];
    existing.push(row);
    byKey.set(key, existing);
  }
  return byKey;
}

async function getDbCounts() {
  const rows = await prisma.$queryRaw<{ table_name: string; cnt: number | bigint }[]>`
    SELECT 'products' AS table_name, COUNT(*) AS cnt FROM products
    UNION ALL SELECT 'supplier_offers', COUNT(*) FROM supplier_offers
    UNION ALL SELECT 'product_params', COUNT(*) FROM product_params
    UNION ALL SELECT 'price_history', COUNT(*) FROM price_history
    UNION ALL SELECT 'quote_items', COUNT(*) FROM quote_items
    UNION ALL SELECT 'customer_quote_rows', COUNT(*) FROM customer_quote_rows
  `;

  return Object.fromEntries(rows.map((row) => [row.table_name, toNumber(row.cnt)]));
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

function buildSplitTargets(
  groups: CollisionGroup[],
  existingProducts: Map<string, ExistingProductRow[]>,
): SplitTarget[] {
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
          existingProductId: findExistingTargetProduct(existingProducts, key, group.productId),
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

function findExistingTargetProduct(
  existingProducts: Map<string, ExistingProductRow[]>,
  key: string,
  sourceProductId: string,
): string | null {
  const candidates = existingProducts.get(key) ?? [];
  return candidates.find((candidate) => candidate.id !== sourceProductId)?.id ?? null;
}

function buildReport(input: {
  beforeCounts: Record<string, number>;
  afterCounts: Record<string, number>;
  groups: CollisionGroup[];
  splitTargets: SplitTarget[];
}): string {
  const offerCounts = countOfferStatuses(input.groups);
  const targetStats = countSplitTargets(input.splitTargets);
  const autoSafeByProduct = buildAutoSafeByProduct(input.groups);
  const reviewNeededOffers = input.groups.flatMap((group) =>
    group.offers
      .filter((offer) => offer.planStatus === "review-needed")
      .map((offer) => ({ group, offer })),
  );
  const skipSummary = buildSkipSummary(input.groups);
  const referencedGroups = input.groups.filter((group) => group.refs.customerQuoteRows > 0 || group.refs.quoteItems > 0);
  const dbUnchanged = JSON.stringify(input.beforeCounts) === JSON.stringify(input.afterCounts);

  const lines: string[] = [];
  lines.push("# V6.2A — 跨品类碰撞批量拆分计划（只读）");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("## 总览");
  lines.push("");
  lines.push(`- 疑似跨品类碰撞组：${input.groups.length}`);
  lines.push(`- 涉及 offer：${sum(input.groups.map((group) => group.offerCount))}`);
  lines.push(`- auto-safe offers：${offerCounts.autoSafe}`);
  lines.push(`- review-needed offers：${offerCounts.reviewNeeded}`);
  lines.push(`- skip offers：${offerCounts.skip}`);
  lines.push(`- auto-safe target buckets（model_no + inferred_category）：${input.splitTargets.length}`);
  lines.push(`- 预计新建产品：${targetStats.newTargets}`);
  lines.push(`- 可复用已有目标产品：${targetStats.existingTargets}`);
  lines.push(`- 预计迁移 offer：${offerCounts.autoSafe}`);
  lines.push(`- 有 customer_quote_rows 或 quote_items 引用的产品：${referencedGroups.length}`);
  lines.push(`- DB unchanged after script: ${dbUnchanged ? "YES" : "NO"}`);
  lines.push("");
  lines.push("| Metric | Before | After |");
  lines.push("|---|---:|---:|");
  for (const key of Object.keys(input.beforeCounts).sort()) {
    lines.push(`| ${escapeMd(key)} | ${input.beforeCounts[key]} | ${input.afterCounts[key] ?? "-"} |`);
  }
  lines.push("");

  lines.push("## auto-safe 拆分计划表");
  lines.push("");
  if (autoSafeByProduct.length === 0) {
    lines.push("无 auto-safe offer。");
  } else {
    for (const item of autoSafeByProduct) {
      const remaining = item.group.offerCount - item.offers.length;
      lines.push(
        `### ${escapeMd(item.group.modelNo)} / 当前 ${escapeMd(item.group.category)} / product ${
          item.group.productId
        }`,
      );
      lines.push("");
      lines.push(`- auto-safe 迁移 offer：${item.offers.length}`);
      lines.push(`- 当前产品迁移后剩余 offer：${remaining}`);
      lines.push(`- customer_quote_rows refs：${item.group.refs.customerQuoteRows}`);
      lines.push(`- quote_items refs：${item.group.refs.quoteItems}`);
      lines.push("");
      lines.push("| factory | inferred_category | target product | price | source path |");
      lines.push("|---|---|---|---:|---|");
      for (const offer of item.offers) {
        const target = input.splitTargets.find((candidate) => candidate.key === targetKey(item.group.modelNo, offer.inferredCategory));
        lines.push(
          `| ${escapeMd(offer.factory_name)} | ${escapeMd(offer.inferredCategory)} | ${formatTargetProduct(
            target,
          )} | ${formatPrice(offer.purchase_price)} ${escapeMd(offer.currency)} | ${escapeMd(
            offer.relative_path ?? offer.file_name ?? "-",
          )} |`,
        );
      }
      lines.push("");
    }
  }

  lines.push("## auto-safe target buckets");
  lines.push("");
  if (input.splitTargets.length === 0) {
    lines.push("无。");
  } else {
    lines.push("| model_no | target_category | target product | offer_count | factories |");
    lines.push("|---|---|---|---:|---|");
    for (const target of input.splitTargets) {
      lines.push(
        `| ${escapeMd(target.modelNo)} | ${escapeMd(target.targetCategory)} | ${formatTargetProduct(target)} | ${
          target.offers.length
        } | ${escapeMd(unique(target.offers.map((offer) => offer.factory_name)).join(", "))} |`,
      );
    }
  }

  lines.push("");
  lines.push("## review-needed 详情表");
  lines.push("");
  if (reviewNeededOffers.length === 0) {
    lines.push("无。");
  } else {
    lines.push("| model_no | product.category | factory | inferred_category | conflict reason | price | source path |");
    lines.push("|---|---|---|---|---|---:|---|");
    for (const { group, offer } of reviewNeededOffers) {
      lines.push(
        `| ${escapeMd(group.modelNo)} | ${escapeMd(group.category)} | ${escapeMd(offer.factory_name)} | ${escapeMd(
          offer.inferredCategory,
        )} | ${escapeMd(offer.planReason)}; ${escapeMd(offer.conflict.reason)} | ${formatPrice(
          offer.purchase_price,
        )} ${escapeMd(offer.currency)} | ${escapeMd(offer.relative_path ?? offer.file_name ?? "-")} |`,
      );
    }
  }

  lines.push("");
  lines.push("## skip 摘要");
  lines.push("");
  if (skipSummary.length === 0) {
    lines.push("无。");
  } else {
    lines.push("| model_no | product.category | reason | offer_count | factories |");
    lines.push("|---|---|---|---:|---|");
    for (const row of skipSummary) {
      lines.push(
        `| ${escapeMd(row.modelNo)} | ${escapeMd(row.category)} | ${escapeMd(row.reason)} | ${row.count} | ${escapeMd(
          Array.from(row.factories).join(", "),
        )} |`,
      );
    }
  }

  lines.push("");
  lines.push("## 外键引用警告");
  lines.push("");
  if (referencedGroups.length === 0) {
    lines.push("无 customer_quote_rows 或 quote_items 引用这些疑似跨品类产品。");
  } else {
    lines.push("| model_no | product.category | product_id | customer_quote_rows | quote_items | auto-safe offers |");
    lines.push("|---|---|---|---:|---:|---:|");
    for (const group of referencedGroups) {
      lines.push(
        `| ${escapeMd(group.modelNo)} | ${escapeMd(group.category)} | ${group.productId} | ${
          group.refs.customerQuoteRows
        } | ${group.refs.quoteItems} | ${group.offers.filter((offer) => offer.planStatus === "auto-safe").length} |`,
      );
    }
  }

  lines.push("");
  lines.push("## Notes");
  lines.push("");
  lines.push("- 本脚本只读数据库；报告中的 DB before/after 计数一致用于验证没有写库。");
  lines.push("- `auto-safe` 仍是规则判断，不等于已经执行拆分；真正迁移需后续 V6.2B。");
  lines.push("- 目录和文件名命中不同品类的 offer 全部进入 `review-needed`，例如净化灯目录下的面板灯文件。");
  lines.push("- 目标产品已存在时，报告标为 `reuse:<product_id>`，后续 apply 应优先复用，避免重复建产品。");

  return `${lines.join("\n")}\n`;
}

function buildAutoSafeByProduct(groups: CollisionGroup[]) {
  return groups
    .map((group) => ({
      group,
      offers: group.offers.filter((offer) => offer.planStatus === "auto-safe"),
    }))
    .filter((item) => item.offers.length > 0)
    .sort((a, b) => b.offers.length - a.offers.length || a.group.modelNo.localeCompare(b.group.modelNo));
}

function buildSkipSummary(groups: CollisionGroup[]) {
  const rows = new Map<
    string,
    { modelNo: string; category: string; reason: string; count: number; factories: Set<string> }
  >();

  for (const group of groups) {
    for (const offer of group.offers.filter((candidate) => candidate.planStatus === "skip")) {
      const key = `${group.modelNo}|||${group.category}|||${offer.planReason}`;
      const existing =
        rows.get(key) ?? ({ modelNo: group.modelNo, category: group.category, reason: offer.planReason, count: 0, factories: new Set() });
      existing.count += 1;
      existing.factories.add(offer.factory_name);
      rows.set(key, existing);
    }
  }

  return Array.from(rows.values()).sort((a, b) => b.count - a.count || a.modelNo.localeCompare(b.modelNo));
}

function countOfferStatuses(groups: CollisionGroup[]) {
  const counts = { autoSafe: 0, reviewNeeded: 0, skip: 0 };
  for (const group of groups) {
    for (const offer of group.offers) {
      if (offer.planStatus === "auto-safe") {
        counts.autoSafe += 1;
      } else if (offer.planStatus === "review-needed") {
        counts.reviewNeeded += 1;
      } else {
        counts.skip += 1;
      }
    }
  }
  return counts;
}

function countSplitTargets(targets: SplitTarget[]) {
  return targets.reduce(
    (acc, target) => {
      if (target.existingProductId) {
        acc.existingTargets += 1;
      } else {
        acc.newTargets += 1;
      }
      return acc;
    },
    { existingTargets: 0, newTargets: 0 },
  );
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

function formatTargetProduct(target: SplitTarget | undefined): string {
  if (!target) {
    return "-";
  }
  return target.existingProductId ? `reuse:${target.existingProductId}` : "new";
}

function formatPrice(value: number | string): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return String(value);
  }
  return parsed.toLocaleString("en-US", {
    maximumFractionDigits: 4,
    minimumFractionDigits: 0,
  });
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
