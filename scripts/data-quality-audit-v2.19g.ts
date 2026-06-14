import { writeFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const REPORT_PATH = "docs/v2.19g-data-quality-audit.md";

const NEON_MODELS = ["LST-110/220V-NW-2835-180", "LST-110/220V-NW-COB-240免驱", "LST-110/220V-NW-COB-288免驱"];
const RUIXIN_MODELS = ["36/40W", "PP0.7", "PP0.8", "PP1.0"];
const OUNUO_MODELS = ["圆形", "方形"];

type StatusLabel = "待人工补价" | "保留" | "不处理" | "需拆分";

type AuditItem = {
  status: StatusLabel;
};

type ProductParamRow = {
  param_key: string;
  raw_value: string;
  normalized_value: string | null;
  unit: string | null;
  confidence: string;
};

type GenericOfferRow = {
  product_id: string;
  model_no: string | null;
  product_name: string;
  category: string | null;
  remark: string | null;
  image_path: string | null;
  offer_id: string;
  factory_name: string;
  purchase_price: number | string;
  currency: string;
  moq: string | null;
  ctn_qty: string | null;
  file_name: string | null;
  relative_path: string | null;
};

type NeonRow = GenericOfferRow & {
  param_count: number | bigint;
  quote_refs: number | bigint;
};

type NeonReportRow = AuditItem &
  NeonRow & {
    has_image: boolean;
    other_offers: Array<{
      factory_name: string;
      purchase_price: number;
      currency: string;
      relative_path: string | null;
      looks_normal: boolean;
    }>;
    reason: string;
  };

type RuixinReportRow = AuditItem &
  GenericOfferRow & {
    has_image: boolean;
    quote_refs: number;
    total_offers: number;
    params: ProductParamRow[];
    reason: string;
  };

type OunuoReportRow = AuditItem &
  GenericOfferRow & {
    has_image: boolean;
    quote_refs: number;
    total_offers: number;
    param_count: number;
    reason: string;
  };

type QuoteItemRow = {
  id: string;
  quote_id: string;
  purchase_price: number | string;
  purchase_currency: string;
  created_at: string;
};

type CollisionOfferRow = GenericOfferRow & {
  has_image: boolean;
  inferred_category: string;
  split_action: "keep-on-48w-panel" | "move-to-category" | "manual-review";
  target_product_hint: string;
  quote_refs: number;
};

type GenericCollisionRow = {
  model_no: string | null;
  category: string | null;
  factory_count: number | bigint;
  offer_count: number | bigint;
};

type ReportData = {
  generatedAt: string;
  beforeCounts: CountSnapshot;
  afterCounts: CountSnapshot;
  neonRows: NeonReportRow[];
  ruixinRows: RuixinReportRow[];
  ounuoRows: OunuoReportRow[];
  collision48w: {
    productIds: string[];
    offers: CollisionOfferRow[];
    quoteItems: QuoteItemRow[];
  };
  genericCollisions: GenericCollisionRow[];
};

type CountSnapshot = {
  products: number;
  offers: number;
  params: number;
  quoteItems: number;
  priceHistory: number;
};

async function main() {
  const beforeCounts = await getCountSnapshot();
  const [neonRows, ruixinRows, ounuoRows, collision48w, genericCollisions] = await Promise.all([
    auditNeonRows(),
    auditRuixinRows(),
    auditOunuoRows(),
    audit48wCollision(),
    auditGenericCollisions(),
  ]);
  const afterCounts = await getCountSnapshot();

  const report: ReportData = {
    generatedAt: new Date().toISOString(),
    beforeCounts,
    afterCounts,
    neonRows,
    ruixinRows,
    ounuoRows,
    collision48w,
    genericCollisions,
  };

  await writeFile(REPORT_PATH, buildMarkdown(report), "utf8");
  console.log(
    JSON.stringify(
      {
        reportPath: REPORT_PATH,
        readOnly: countsEqual(beforeCounts, afterCounts),
        parts: {
          neon: neonRows.length,
          ruixin: ruixinRows.length,
          ounuo: ounuoRows.length,
          offers48w: collision48w.offers.length,
          genericCollisions: genericCollisions.length,
        },
      },
      null,
      2,
    ),
  );
}

async function getCountSnapshot(): Promise<CountSnapshot> {
  const [products, offers, params, quoteItems, priceHistory] = await Promise.all([
    prisma.product.count(),
    prisma.supplierOffer.count(),
    prisma.productParam.count(),
    prisma.quoteItem.count(),
    prisma.priceHistory.count(),
  ]);
  return { products, offers, params, quoteItems, priceHistory };
}

function countsEqual(left: CountSnapshot, right: CountSnapshot): boolean {
  return (
    left.products === right.products &&
    left.offers === right.offers &&
    left.params === right.params &&
    left.quoteItems === right.quoteItems &&
    left.priceHistory === right.priceHistory
  );
}

async function auditNeonRows(): Promise<NeonReportRow[]> {
  const rows = await prisma.$queryRaw<NeonRow[]>`
    SELECT
      p.id AS product_id,
      p.model_no,
      p.product_name,
      p.category,
      p.remark,
      p.image_path,
      so.id AS offer_id,
      so.factory_name,
      so.purchase_price,
      so.currency,
      so.moq,
      so.ctn_qty,
      f.file_name,
      f.relative_path,
      (SELECT COUNT(*) FROM product_params pp WHERE pp.product_id = p.id) AS param_count,
      (SELECT COUNT(*) FROM quote_items qi WHERE qi.product_id = p.id OR qi.supplier_offer_id = so.id) AS quote_refs
    FROM products p
    JOIN supplier_offers so ON so.product_id = p.id
    LEFT JOIN files f ON f.id = so.source_file_id
    WHERE p.category = '灯带'
      AND so.factory_name = '尼奥'
      AND p.model_no IN ('LST-110/220V-NW-2835-180', 'LST-110/220V-NW-COB-240免驱', 'LST-110/220V-NW-COB-288免驱')
    ORDER BY p.model_no
  `;

  const reportRows: NeonReportRow[] = [];
  for (const row of rows) {
    const otherOffers = await prisma.$queryRaw<
      Array<{
        factory_name: string;
        purchase_price: number | string;
        currency: string;
        relative_path: string | null;
      }>
    >`
      SELECT so.factory_name, so.purchase_price, so.currency, f.relative_path
      FROM supplier_offers so
      LEFT JOIN files f ON f.id = so.source_file_id
      WHERE so.product_id = ${row.product_id}
        AND so.id <> ${row.offer_id}
      ORDER BY so.purchase_price
    `;

    const normalizedOtherOffers = otherOffers.map((offer) => ({
      factory_name: offer.factory_name,
      purchase_price: toNumber(offer.purchase_price),
      currency: offer.currency,
      relative_path: offer.relative_path,
      looks_normal: isReasonableStripPrice(toNumber(offer.purchase_price)),
    }));

    reportRows.push({
      ...row,
      has_image: row.image_path != null,
      other_offers: normalizedOtherOffers,
      status: "待人工补价",
      reason:
        normalizedOtherOffers.length > 0
          ? "产品本身是真产品，尼奥 offer 价格仍是芯片/灯珠数；同产品有其他报价可参考，但不能自动替代尼奥工厂价。"
          : "产品本身是真产品，尼奥 offer 价格仍是芯片/灯珠数；源 Excel 无独立价格列，需要人工补价。",
    });
  }

  return reportRows;
}

async function auditRuixinRows(): Promise<RuixinReportRow[]> {
  const rows = await prisma.$queryRaw<GenericOfferRow[]>`
    SELECT
      p.id AS product_id,
      p.model_no,
      p.product_name,
      p.category,
      p.remark,
      p.image_path,
      so.id AS offer_id,
      so.factory_name,
      so.purchase_price,
      so.currency,
      so.moq,
      so.ctn_qty,
      f.file_name,
      f.relative_path
    FROM products p
    JOIN supplier_offers so ON so.product_id = p.id
    LEFT JOIN files f ON f.id = so.source_file_id
    WHERE p.category = '面板灯'
      AND so.factory_name = '瑞鑫'
      AND p.model_no IN ('36/40W', 'PP0.7', 'PP0.8', 'PP1.0')
    ORDER BY p.model_no
  `;

  const out: RuixinReportRow[] = [];
  for (const row of rows) {
    const [params, quoteRefs, totalOffers] = await Promise.all([
      loadParams(row.product_id),
      countQuoteRefs(row.product_id, row.offer_id),
      prisma.supplierOffer.count({ where: { productId: row.product_id } }),
    ]);
    const hasMeaningfulParams = params.some((param) => ["watts", "size_display", "length_mm", "width_mm", "pf"].includes(param.param_key));
    const isImageBacked = row.image_path != null;

    let status: StatusLabel = "保留";
    let reason = "任务明确要求 audit-only。";
    if (row.model_no === "36/40W") {
      status = "保留";
      reason = isImageBacked
        ? "有产品图片，且不是 V2.19F 确认删除对象；价格可能是功率当价，但无安全源价，先保留并避免自动删除。"
        : "无图片但不在确认删除清单，先保留。";
    } else if (hasMeaningfulParams) {
      status = "保留";
      reason = "有实质参数（功率/尺寸/PF 等），更像材料或板材规格变体，保留。";
    } else {
      status = "不处理";
      reason = "参数不足，但不是当前高优先污染源；后续可统一清理。";
    }

    out.push({
      ...row,
      has_image: isImageBacked,
      quote_refs: quoteRefs,
      total_offers: totalOffers,
      params,
      status,
      reason,
    });
  }
  return out;
}

async function auditOunuoRows(): Promise<OunuoReportRow[]> {
  const rows = await prisma.$queryRaw<GenericOfferRow[]>`
    SELECT
      p.id AS product_id,
      p.model_no,
      p.product_name,
      p.category,
      p.remark,
      p.image_path,
      so.id AS offer_id,
      so.factory_name,
      so.purchase_price,
      so.currency,
      so.moq,
      so.ctn_qty,
      f.file_name,
      f.relative_path
    FROM products p
    JOIN supplier_offers so ON so.product_id = p.id
    LEFT JOIN files f ON f.id = so.source_file_id
    WHERE p.category = '面板灯'
      AND p.model_no IN ('圆形', '方形')
      AND so.factory_name LIKE '%欧诺%'
    ORDER BY p.model_no, so.factory_name
  `;

  const out: OunuoReportRow[] = [];
  for (const row of rows) {
    const [quoteRefs, totalOffers, paramCount] = await Promise.all([
      countQuoteRefs(row.product_id, row.offer_id),
      prisma.supplierOffer.count({ where: { productId: row.product_id } }),
      prisma.productParam.count({ where: { productId: row.product_id } }),
    ]);

    out.push({
      ...row,
      has_image: row.image_path != null,
      quote_refs: quoteRefs,
      total_offers: totalOffers,
      param_count: paramCount,
      status: "保留",
      reason: "圆形/方形是弱款号，但 V2.19F 已确认源表中为真实产品行且价格列是 RMB 单价；不自动删除。",
    });
  }
  return out;
}

async function audit48wCollision(): Promise<ReportData["collision48w"]> {
  const offers = await prisma.$queryRaw<GenericOfferRow[]>`
    SELECT
      p.id AS product_id,
      p.model_no,
      p.product_name,
      p.category,
      p.remark,
      p.image_path,
      so.id AS offer_id,
      so.factory_name,
      so.purchase_price,
      so.currency,
      so.moq,
      so.ctn_qty,
      f.file_name,
      f.relative_path
    FROM products p
    JOIN supplier_offers so ON so.product_id = p.id
    LEFT JOIN files f ON so.source_file_id = f.id
    WHERE p.model_no = '48W'
      AND p.category = '面板灯'
    ORDER BY so.factory_name
  `;

  const quoteItems = await prisma.$queryRaw<QuoteItemRow[]>`
    SELECT qi.id, qi.quote_id, qi.purchase_price, qi.purchase_currency, q.created_at
    FROM quote_items qi
    JOIN quotes q ON qi.quote_id = q.id
    WHERE qi.product_id IN (
      SELECT id FROM products WHERE model_no = '48W' AND category = '面板灯'
    )
    ORDER BY q.created_at DESC
  `;

  const enrichedOffers: CollisionOfferRow[] = [];
  for (const offer of offers) {
    const inferredCategory = inferSourceCategory(offer.relative_path, offer.file_name);
    const quoteRefs = await countQuoteRefs(offer.product_id, offer.offer_id);
    const splitAction = determine48wAction(inferredCategory, offer.relative_path, offer.file_name);
    enrichedOffers.push({
      ...offer,
      has_image: offer.image_path != null,
      inferred_category: inferredCategory,
      split_action: splitAction,
      target_product_hint: buildTargetProductHint(inferredCategory, offer),
      quote_refs: quoteRefs,
    });
  }

  return {
    productIds: Array.from(new Set(offers.map((offer) => offer.product_id))),
    offers: enrichedOffers,
    quoteItems,
  };
}

async function auditGenericCollisions(): Promise<GenericCollisionRow[]> {
  return prisma.$queryRaw<GenericCollisionRow[]>`
    SELECT
      p.model_no,
      p.category,
      COUNT(DISTINCT so.factory_name) AS factory_count,
      COUNT(so.id) AS offer_count
    FROM products p
    JOIN supplier_offers so ON so.product_id = p.id
    WHERE p.model_no GLOB '[0-9]*W'
      AND p.model_no NOT GLOB '*[a-zA-Z]*W'
      AND p.model_no NOT GLOB '*-*'
    GROUP BY p.model_no, p.category
    HAVING factory_count >= 3
    ORDER BY factory_count DESC, p.model_no
  `;
}

async function loadParams(productId: string): Promise<ProductParamRow[]> {
  return prisma.$queryRaw<ProductParamRow[]>`
    SELECT param_key, raw_value, normalized_value, unit, confidence
    FROM product_params
    WHERE product_id = ${productId}
    ORDER BY param_key
  `;
}

async function countQuoteRefs(productId: string, offerId: string): Promise<number> {
  return prisma.quoteItem.count({
    where: {
      OR: [{ productId }, { supplierOfferId: offerId }],
    },
  });
}

function isReasonableStripPrice(price: number): boolean {
  return price >= 0.5 && price <= 50;
}

function inferSourceCategory(relativePath: string | null, fileName: string | null): string {
  const text = `${relativePath ?? ""}/${fileName ?? ""}`.normalize("NFC").toLowerCase();
  if (text.includes("磁吸")) return "磁吸灯";
  if (text.includes("三防")) return "三防灯";
  if (text.includes("净化")) return "净化灯";
  if (text.includes("吸顶")) return "吸顶灯";
  if (text.includes("球泡")) return "球泡";
  if (text.includes("灯管") || text.includes("t8") || text.includes("t5")) return "灯管";
  if (text.includes("线条") || text.includes("办公灯")) return "线条灯";
  if (text.includes("大面板") || text.includes("小面板") || text.includes("面板灯") || text.includes("panel")) return "面板灯";
  if (text.includes("筒灯")) return "筒灯";
  if (text.includes("投光")) return "投光灯";
  if (text.includes("路灯")) return "路灯";
  return "未知";
}

function determine48wAction(
  inferredCategory: string,
  relativePath: string | null,
  fileName: string | null,
): CollisionOfferRow["split_action"] {
  if (inferredCategory === "面板灯") return "keep-on-48w-panel";
  const text = `${relativePath ?? ""}/${fileName ?? ""}`;
  if (text.includes("双色新款面板灯")) return "keep-on-48w-panel";
  if (inferredCategory === "未知") return "manual-review";
  return "move-to-category";
}

function buildTargetProductHint(inferredCategory: string, offer: GenericOfferRow): string {
  const action = determine48wAction(inferredCategory, offer.relative_path, offer.file_name);
  if (action === "keep-on-48w-panel") return "保留在当前面板灯 48W 产品";
  if (action === "manual-review") return "来源品类不明，需人工看源文件";
  return `新建/匹配 ${inferredCategory} 品类的独立 48W 产品，并迁移该 offer`;
}

function buildMarkdown(report: ReportData): string {
  const lines: string[] = [];
  lines.push("# V2.19G — 数据质量遗留收口审计");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push("Mode: read-only audit (no DB changes)");
  lines.push("");
  lines.push("## 总结");
  lines.push("");
  lines.push("| Part | 异常项 | 待人工补价 | 保留 | 不处理 | 需拆分 |");
  lines.push("|---|---:|---:|---:|---:|---:|");
  appendSummaryRow(lines, "Part A 尼奥灯带无源价格", report.neonRows);
  appendSummaryRow(lines, "Part B 瑞鑫 audit-only", report.ruixinRows);
  appendSummaryRow(lines, "Part C 欧诺 audit-only", report.ounuoRows);
  appendSummaryRow(lines, "Part D 48W 碰撞", report.collision48w.offers.map((offer) => ({ status: offer.split_action === "move-to-category" ? "需拆分" : "保留" })));
  lines.push("");
  lines.push("### Read-only Check");
  lines.push("");
  lines.push("| Metric | Before | After | Changed |");
  lines.push("|---|---:|---:|---|");
  for (const key of Object.keys(report.beforeCounts) as Array<keyof CountSnapshot>) {
    lines.push(`| ${key} | ${report.beforeCounts[key]} | ${report.afterCounts[key]} | ${report.beforeCounts[key] === report.afterCounts[key] ? "No" : "YES"} |`);
  }
  lines.push("");

  buildNeonSection(lines, report.neonRows);
  buildRuixinSection(lines, report.ruixinRows);
  buildOunuoSection(lines, report.ounuoRows);
  buildCollisionSection(lines, report.collision48w, report.genericCollisions);
  buildRecommendations(lines, report);

  return lines.join("\n");
}

function appendSummaryRow(lines: string[], label: string, items: AuditItem[]) {
  lines.push(
    `| ${label} | ${items.length} | ${countByStatus(items, "待人工补价")} | ${countByStatus(items, "保留")} | ${countByStatus(items, "不处理")} | ${countByStatus(items, "需拆分")} |`,
  );
}

function countByStatus(items: AuditItem[], status: StatusLabel): number {
  return items.filter((item) => item.status === status).length;
}

function buildNeonSection(lines: string[], rows: NeonReportRow[]) {
  lines.push("## Part A: 尼奥灯带无源价格");
  lines.push("");
  lines.push("| model_no | 当前价格 | 图片 | params | quote refs | 其他报价参考 | 结论 | 理由 |");
  lines.push("|---|---:|---|---:|---:|---|---|---|");
  for (const row of rows) {
    const otherOffers =
      row.other_offers.length > 0
        ? row.other_offers
            .map((offer) => `${offer.factory_name} ${formatPrice(offer.purchase_price)} ${offer.currency}${offer.looks_normal ? "" : " ⚠️"}`)
            .join("<br>")
        : "-";
    lines.push(
      `| ${md(row.model_no ?? "-")} | ${formatPrice(row.purchase_price)} ${md(row.currency)} | ${row.has_image ? "Y" : "N"} | ${toNumber(row.param_count)} | ${toNumber(row.quote_refs)} | ${md(otherOffers)} | ${row.status} | ${md(row.reason)} |`,
    );
  }
  lines.push("");
}

function buildRuixinSection(lines: string[], rows: RuixinReportRow[]) {
  lines.push("## Part B: 瑞鑫面板灯 audit-only");
  lines.push("");
  lines.push("| model_no | 当前价格 | 图片 | offers | quote refs | params 摘要 | 结论 | 理由 |");
  lines.push("|---|---:|---|---:|---:|---|---|---|");
  for (const row of rows) {
    lines.push(
      `| ${md(row.model_no ?? "-")} | ${formatPrice(row.purchase_price)} ${md(row.currency)} | ${row.has_image ? "Y" : "N"} | ${row.total_offers} | ${row.quote_refs} | ${md(formatParams(row.params))} | ${row.status} | ${md(row.reason)} |`,
    );
  }
  lines.push("");
}

function buildOunuoSection(lines: string[], rows: OunuoReportRow[]) {
  lines.push("## Part C: 欧诺面板灯 audit-only");
  lines.push("");
  lines.push("| model_no | 当前价格 | 币种 | 图片 | params | offers | quote refs | source | 结论 | 理由 |");
  lines.push("|---|---:|---|---|---:|---:|---:|---|---|---|");
  for (const row of rows) {
    lines.push(
      `| ${md(row.model_no ?? "-")} | ${formatPrice(row.purchase_price)} | ${md(row.currency)} | ${row.has_image ? "Y" : "N"} | ${row.param_count} | ${row.total_offers} | ${row.quote_refs} | ${md(row.file_name ?? "-")} | ${row.status} | ${md(row.reason)} |`,
    );
  }
  lines.push("");
}

function buildCollisionSection(lines: string[], collision48w: ReportData["collision48w"], genericRows: GenericCollisionRow[]) {
  lines.push("## Part D: 48W model_no 碰撞");
  lines.push("");
  lines.push(`48W product ids: ${collision48w.productIds.map(md).join(", ") || "-"}`);
  lines.push("");
  lines.push("### 48W 全部 Offer");
  lines.push("");
  lines.push("| factory | price | currency | source | inferred category | quote refs | action | target |");
  lines.push("|---|---:|---|---|---|---:|---|---|");
  for (const offer of collision48w.offers) {
    lines.push(
      `| ${md(offer.factory_name)} | ${formatPrice(offer.purchase_price)} | ${md(offer.currency)} | ${md(offer.relative_path ?? offer.file_name ?? "-")} | ${md(offer.inferred_category)} | ${offer.quote_refs} | ${md(offer.split_action)} | ${md(offer.target_product_hint)} |`,
    );
  }
  lines.push("");
  lines.push("### 来源品类分析");
  lines.push("");
  const grouped = groupBy(collision48w.offers, (offer) => offer.inferred_category);
  for (const [category, offers] of grouped.entries()) {
    lines.push(`- ${category}: ${offers.length} offers (${offers.map((offer) => offer.factory_name).join(", ")})`);
  }
  lines.push("");
  lines.push("### 拆分方案");
  lines.push("");
  const moveOffers = collision48w.offers.filter((offer) => offer.split_action === "move-to-category");
  if (moveOffers.length === 0) {
    lines.push("- 当前没有自动判定需拆分的 48W offer。");
  } else {
    for (const offer of moveOffers) {
      lines.push(
        `- ${offer.factory_name}: ${offer.relative_path ?? offer.file_name ?? "-"} → ${offer.target_product_hint}。当前价格 ${formatPrice(offer.purchase_price)} ${offer.currency}。`,
      );
    }
  }
  const reviewOffers = collision48w.offers.filter((offer) => offer.split_action === "manual-review");
  if (reviewOffers.length > 0) {
    lines.push("");
    lines.push("Manual review:");
    for (const offer of reviewOffers) {
      lines.push(`- ${offer.factory_name}: ${offer.relative_path ?? offer.file_name ?? "-"}。`);
    }
  }
  lines.push("");
  lines.push("### Quote Items 引用");
  lines.push("");
  if (collision48w.quoteItems.length === 0) {
    lines.push("- 48W 当前没有 quote_items 引用。拆分时没有历史报价外键阻碍。");
  } else {
    lines.push("| quote_item | quote | purchase price | currency | quote created |");
    lines.push("|---|---|---:|---|---|");
    for (const item of collision48w.quoteItems) {
      lines.push(`| ${md(item.id)} | ${md(item.quote_id)} | ${formatPrice(item.purchase_price)} | ${md(item.purchase_currency)} | ${md(item.created_at)} |`);
    }
  }
  lines.push("");
  lines.push("### 其他通用 model_no 碰撞");
  lines.push("");
  lines.push("| model_no | category | factory_count | offer_count |");
  lines.push("|---|---|---:|---:|");
  for (const row of genericRows) {
    lines.push(`| ${md(row.model_no ?? "-")} | ${md(row.category ?? "-")} | ${toNumber(row.factory_count)} | ${toNumber(row.offer_count)} |`);
  }
  lines.push("");
}

function buildRecommendations(lines: string[], report: ReportData) {
  lines.push("## 行动建议");
  lines.push("");
  lines.push("1. 先做 48W 拆分任务。该问题会直接影响报价选 offer，且当前无 quote_items 引用，处理窗口好。");
  lines.push("2. 尼奥 3 条保持待人工补价：只补尼奥 offer 的工厂价，不用其他工厂报价覆盖。");
  lines.push("3. 瑞鑫 PP 系列和 36/40W 暂保留；后续如做产品去重，再统一处理弱款号。");
  lines.push("4. 欧诺圆形/方形暂保留；如果要客户展示更友好，再做款号重命名，不动价格。");
  lines.push(
    `5. 其他通用纯瓦数 model_no 碰撞共 ${report.genericCollisions.length} 组，建议只在真实报价命中或数据质量仪表盘暴露时逐组拆，不做一次性大清洗。`,
  );
  lines.push("");
}

function formatParams(params: ProductParamRow[]): string {
  if (params.length === 0) return "-";
  return params
    .slice(0, 8)
    .map((param) => `${param.param_key}=${param.normalized_value ?? param.raw_value}${param.unit ?? ""}`)
    .join("; ");
}

function formatPrice(value: number | string | bigint | null | undefined): string {
  if (value == null) return "-";
  const numberValue = toNumber(value);
  if (!Number.isFinite(numberValue)) return String(value);
  return Number.isInteger(numberValue) ? String(numberValue) : numberValue.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function toNumber(value: number | string | bigint | null | undefined): number {
  if (value == null) return 0;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return value;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function md(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const group = out.get(key) ?? [];
    group.push(item);
    out.set(key, group);
  }
  return out;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
