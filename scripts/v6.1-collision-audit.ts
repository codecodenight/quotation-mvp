import { writeFile } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const REPORT_PATH = path.join("docs", "v6.1-collision-audit.md");

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

type NullSourceOfferRow = {
  product_id: string;
  model_no: string | null;
  product_name: string;
  category: string | null;
  offer_id: string;
  factory_name: string;
  purchase_price: number | string;
  currency: string;
  quote_item_refs: number | bigint | null;
};

type InferredOffer = CollisionOfferRow & {
  inferredCategory: string;
  inferenceReason: string;
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
  const collisionProducts = await getCollisionProducts();
  const collisionOffers = await getCollisionOffers();
  const nullSourceOffers = await getNullSourceCollisionOffers();
  const totalNullSourceOffers = await getTotalNullSourceOfferCount();

  const groups = buildGroups(collisionProducts, collisionOffers);
  const statusCounts = countStatuses(groups);
  const mappingStats = buildMappingStats(groups);
  const nullSourceSummary = buildNullSourceSummary(nullSourceOffers);

  const report = buildReport({
    groups,
    statusCounts,
    mappingStats,
    totalNullSourceOffers,
    nullSourceOffers,
    nullSourceSummary,
  });

  await writeFile(REPORT_PATH, report, "utf8");

  console.log(
    JSON.stringify(
      {
        reportPath: REPORT_PATH,
        collisionGroups: groups.length,
        normal: statusCounts.normal,
        suspectedCrossCategory: statusCounts.suspected_cross_category,
        unableToJudge: statusCounts.unable_to_judge,
        totalNullSourceOffers,
        nullSourceOffersInCollisionGroups: nullSourceOffers.length,
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

async function getTotalNullSourceOfferCount(): Promise<number> {
  const rows = await prisma.$queryRaw<{ cnt: number | bigint }[]>`
    SELECT COUNT(*) AS cnt
    FROM supplier_offers
    WHERE source_file_id IS NULL
  `;

  return toNumber(rows[0]?.cnt);
}

async function getNullSourceCollisionOffers(): Promise<NullSourceOfferRow[]> {
  return prisma.$queryRaw<NullSourceOfferRow[]>`
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
      COALESCE(qi.refs, 0) AS quote_item_refs
    FROM supplier_offers so
    JOIN products p ON p.id = so.product_id
    JOIN collision_products cp ON cp.id = p.id
    LEFT JOIN (
      SELECT supplier_offer_id, COUNT(*) AS refs
      FROM quote_items
      WHERE supplier_offer_id IS NOT NULL
      GROUP BY supplier_offer_id
    ) qi ON qi.supplier_offer_id = so.id
    WHERE so.source_file_id IS NULL
    ORDER BY p.model_no, p.category, so.factory_name
  `;
}

function buildGroups(products: CollisionProductRow[], offers: CollisionOfferRow[]): CollisionGroup[] {
  const offersByProduct = new Map<string, InferredOffer[]>();

  for (const offer of offers) {
    const inferred = inferCategory(offer.relative_path, offer.file_name);
    const enriched: InferredOffer = {
      ...offer,
      inferredCategory: inferred.category,
      inferenceReason: inferred.reason,
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
    };
  });
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

function buildMappingStats(groups: CollisionGroup[]) {
  let inferred = 0;
  let unknown = 0;
  let uncertainTubeBulb = 0;
  const byCategory = new Map<string, number>();

  for (const group of groups) {
    for (const offer of group.offers) {
      if (offer.inferredCategory === UNKNOWN_CATEGORY) {
        unknown += 1;
      } else if (offer.inferredCategory === UNCERTAIN_TUBE_BULB) {
        uncertainTubeBulb += 1;
      } else {
        inferred += 1;
      }

      byCategory.set(offer.inferredCategory, (byCategory.get(offer.inferredCategory) ?? 0) + 1);
    }
  }

  return {
    inferred,
    unknown,
    uncertainTubeBulb,
    total: inferred + unknown + uncertainTubeBulb,
    byCategory: Array.from(byCategory.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
  };
}

function buildNullSourceSummary(rows: NullSourceOfferRow[]) {
  const groups = new Map<
    string,
    {
      modelNo: string;
      category: string;
      count: number;
      factories: Set<string>;
      minPrice: number | null;
      maxPrice: number | null;
      currencies: Set<string>;
      quoteItemRefs: number;
    }
  >();

  for (const row of rows) {
    const modelNo = row.model_no ?? "(no model)";
    const category = row.category ?? "(无品类)";
    const key = `${modelNo}|||${category}`;
    const price = Number(row.purchase_price);
    const existing =
      groups.get(key) ??
      ({
        modelNo,
        category,
        count: 0,
        factories: new Set<string>(),
        minPrice: null,
        maxPrice: null,
        currencies: new Set<string>(),
        quoteItemRefs: 0,
      } satisfies ReturnType<typeof buildNullSourceSummary>[number] & { factories: Set<string>; currencies: Set<string> });

    existing.count += 1;
    existing.factories.add(row.factory_name);
    existing.currencies.add(row.currency);
    existing.quoteItemRefs += toNumber(row.quote_item_refs);

    if (Number.isFinite(price)) {
      existing.minPrice = existing.minPrice == null ? price : Math.min(existing.minPrice, price);
      existing.maxPrice = existing.maxPrice == null ? price : Math.max(existing.maxPrice, price);
    }

    groups.set(key, existing);
  }

  return Array.from(groups.values()).sort((a, b) => b.count - a.count || a.modelNo.localeCompare(b.modelNo));
}

function countStatuses(groups: CollisionGroup[]) {
  return groups.reduce(
    (acc, group) => {
      acc[group.status] += 1;
      return acc;
    },
    {
      normal: 0,
      suspected_cross_category: 0,
      unable_to_judge: 0,
    },
  );
}

function buildReport(input: {
  groups: CollisionGroup[];
  statusCounts: ReturnType<typeof countStatuses>;
  mappingStats: ReturnType<typeof buildMappingStats>;
  totalNullSourceOffers: number;
  nullSourceOffers: NullSourceOfferRow[];
  nullSourceSummary: ReturnType<typeof buildNullSourceSummary>;
}): string {
  const suspectedGroups = input.groups.filter((group) => group.status === "suspected_cross_category");
  const normalGroups = input.groups.filter((group) => group.status === "normal");
  const unableGroups = input.groups.filter((group) => group.status === "unable_to_judge");

  const lines: string[] = [];
  lines.push("# V6.1 — 跨品类碰撞只读审计");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("## 总览");
  lines.push("");
  lines.push(`- 碰撞组总数（product 有 >=3 个 supplier_offers）：${input.groups.length}`);
  lines.push(`- 正常：${input.statusCounts.normal}`);
  lines.push(`- 疑似跨品类：${input.statusCounts.suspected_cross_category}`);
  lines.push(`- 无法判断：${input.statusCounts.unable_to_judge}`);
  lines.push(`- 审计 offer 总数：${input.mappingStats.total}`);
  lines.push("");
  lines.push("| Status | Groups |");
  lines.push("|---|---:|");
  lines.push(`| 正常 | ${input.statusCounts.normal} |`);
  lines.push(`| 疑似跨品类 | ${input.statusCounts.suspected_cross_category} |`);
  lines.push(`| 无法判断 | ${input.statusCounts.unable_to_judge} |`);
  lines.push("");
  lines.push("## 疑似跨品类详情");
  lines.push("");
  if (suspectedGroups.length === 0) {
    lines.push("无。");
  } else {
    for (const group of suspectedGroups) {
      lines.push(
        `### ${escapeMd(group.modelNo)} / ${escapeMd(group.category)} / ${group.offerCount} offers / product ${group.productId}`,
      );
      lines.push("");
      lines.push("| factory | inferred_category | product.category | price | source | reason |");
      lines.push("|---|---|---|---:|---|---|");
      for (const offer of group.offers) {
        const mismatch =
          !isUnknownLike(offer.inferredCategory) && offer.inferredCategory !== group.category ? " ⚠️" : "";
        lines.push(
          `| ${escapeMd(offer.factory_name)} | ${escapeMd(offer.inferredCategory)}${mismatch} | ${escapeMd(
            group.category,
          )} | ${formatPrice(offer.purchase_price)} ${escapeMd(offer.currency)} | ${escapeMd(
            offer.relative_path ?? offer.file_name ?? "-",
          )} | ${escapeMd(offer.inferenceReason)} |`,
        );
      }
      lines.push("");
    }
  }

  lines.push("## 无法判断组");
  lines.push("");
  if (unableGroups.length === 0) {
    lines.push("无。");
  } else {
    lines.push("| model_no | category | product_id | offer_count | 无法推断/不确定 | factories |");
    lines.push("|---|---|---|---:|---:|---|");
    for (const group of unableGroups) {
      lines.push(
        `| ${escapeMd(group.modelNo)} | ${escapeMd(group.category)} | ${group.productId} | ${group.offerCount} | ${
          group.unknownLikeCount
        } | ${escapeMd(group.factories.join(", "))} |`,
      );
    }
  }

  lines.push("");
  lines.push("## 正常组摘要");
  lines.push("");
  if (normalGroups.length === 0) {
    lines.push("无。");
  } else {
    lines.push("| model_no | category | product_id | offer_count | factories |");
    lines.push("|---|---|---|---:|---|");
    for (const group of normalGroups) {
      lines.push(
        `| ${escapeMd(group.modelNo)} | ${escapeMd(group.category)} | ${group.productId} | ${group.offerCount} | ${escapeMd(
          group.factories.join(", "),
        )} |`,
      );
    }
  }

  lines.push("");
  lines.push("## NULL source_file_id 专项");
  lines.push("");
  const nullSourceQuoteRefs = input.nullSourceOffers.reduce((sum, row) => sum + toNumber(row.quote_item_refs), 0);
  lines.push(`- supplier_offers.source_file_id IS NULL 总数：${input.totalNullSourceOffers}`);
  lines.push(`- 落在碰撞组里的 NULL source offer：${input.nullSourceOffers.length}`);
  lines.push(`- 碰撞组 NULL source quote_items 引用数：${nullSourceQuoteRefs}`);
  lines.push("");
  if (input.nullSourceSummary.length === 0) {
    lines.push("无 NULL source offer 落在碰撞组。");
  } else {
    lines.push("| model_no | product.category | offer_count | factories | price range | currencies | quote_items refs |");
    lines.push("|---|---|---:|---|---|---|---:|");
    for (const row of input.nullSourceSummary) {
      lines.push(
        `| ${escapeMd(row.modelNo)} | ${escapeMd(row.category)} | ${row.count} | ${escapeMd(
          Array.from(row.factories).join(", "),
        )} | ${formatNullablePrice(row.minPrice)}-${formatNullablePrice(row.maxPrice)} | ${escapeMd(
          Array.from(row.currencies).join(", "),
        )} | ${row.quoteItemRefs} |`,
      );
    }
  }

  lines.push("");
  lines.push("### NULL source 明细");
  lines.push("");
  if (input.nullSourceOffers.length === 0) {
    lines.push("无。");
  } else {
    lines.push("| model_no | category | product_id | offer_id | factory | price | quote_items refs |");
    lines.push("|---|---|---|---|---|---:|---:|");
    for (const row of input.nullSourceOffers) {
      lines.push(
        `| ${escapeMd(row.model_no ?? "(no model)")} | ${escapeMd(row.category ?? "(无品类)")} | ${
          row.product_id
        } | ${row.offer_id} | ${escapeMd(row.factory_name)} | ${formatPrice(row.purchase_price)} ${escapeMd(
          row.currency,
        )} | ${toNumber(row.quote_item_refs)} |`,
      );
    }
  }

  lines.push("");
  lines.push("## 品类映射命中统计");
  lines.push("");
  lines.push(`- 成功推断：${input.mappingStats.inferred}`);
  lines.push(`- 无法推断：${input.mappingStats.unknown}`);
  lines.push(`- 球泡灯管(不确定)：${input.mappingStats.uncertainTubeBulb}`);
  lines.push("");
  lines.push("| inferred_category | offer_count |");
  lines.push("|---|---:|");
  for (const [category, count] of input.mappingStats.byCategory) {
    lines.push(`| ${escapeMd(category)} | ${count} |`);
  }

  lines.push("");
  lines.push("## Notes");
  lines.push("");
  lines.push("- 本脚本只使用 SELECT 查询，没有数据库写入。");
  lines.push("- `球泡灯管(不确定)` 在分类时按无法判断类信号处理，不直接计为跨品类冲突。");
  lines.push("- 路径多关键词命中时取最深层路径段；例如目录为净化灯但文件名为面板灯时，文件名优先。");

  return `${lines.join("\n")}\n`;
}

function splitFactories(value: string | null): string[] {
  return (value ?? "")
    .split(",")
    .map((factory) => factory.trim())
    .filter(Boolean);
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

function formatNullablePrice(value: number | null): string {
  if (value == null) {
    return "-";
  }
  return formatPrice(value);
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
