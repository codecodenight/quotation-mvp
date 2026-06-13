import { copyFile, mkdir, writeFile } from "node:fs/promises";

import { Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const AUDIT_REPORT_PATH = "docs/v2.25-puzhao-audit.md";
const FIX_REPORT_PATH = "docs/v2.25-puzhao-fix-result.md";
const DB_PATH = "prisma/dev.db";
const BACKUP_DIR = "backups";

type Mode = "audit" | "fix";

type OfferRow = {
  product_id: string;
  product_name: string;
  model_no: string | null;
  category: string | null;
  image_path: string | null;
  remark: string | null;
  size: string | null;
  offer_id: string;
  factory_name: string;
  purchase_price: unknown;
  currency: string;
  moq: string | null;
  ctn_qty: string | null;
  price_updated_at: Date | string | null;
  file_name: string | null;
  relative_path: string | null;
};

type QuoteItemRow = {
  item_id: string;
  quote_id: string;
  product_id: string;
  supplier_offer_id: string | null;
  product_name: string;
  model_no: string | null;
  quote_purchase_price: unknown;
  quote_date: Date | string;
};

type ParamRow = {
  product_id: string;
  model_no: string | null;
  param_key: string;
  normalized_value: string | null;
  unit: string | null;
};

type FileRow = {
  id: string;
  file_name: string;
  relative_path: string;
  file_type: string;
};

type CountRow = {
  product_id: string;
  count: bigint | number;
};

type PriceHistoryCountRow = {
  supplier_offer_id: string;
  count: bigint | number;
};

type CategoryCounts = {
  triProofProducts: number;
  puzhaoTriProofOffers: number;
  pzHpBAnomalyOffers: number;
};

type AuditTarget = OfferRow & {
  priceNumber: number;
  match: OfferRow | null;
  action: "duplicate-delete" | "needs-price-correction" | "skip-has-image" | "skip-has-other-offers";
  reason: string;
};

type AuditData = {
  generatedAt: Date;
  offerRows: OfferRow[];
  targets: AuditTarget[];
  quoteItems: QuoteItemRow[];
  params: ParamRow[];
  sourceFiles: FileRow[];
  productOfferCounts: Map<string, number>;
  priceHistoryCounts: Map<string, number>;
  categoryCounts: CategoryCounts;
};

type FixData = {
  generatedAt: Date;
  backupPath: string;
  before: AuditData;
  after: AuditData;
  deletedProducts: number;
  deletedOffers: number;
  deletedParams: number;
  deletedPriceHistory: number;
  deletedQuoteItems: number;
  deletedProductRows: AuditTarget[];
};

async function main() {
  const mode = parseMode(process.argv.slice(2));

  try {
    if (mode === "audit") {
      const data = await loadAuditData();
      await writeFile(AUDIT_REPORT_PATH, buildAuditReport(data), "utf8");
      printAuditSummary(data);
      return;
    }

    const data = await runFix();
    await writeFile(FIX_REPORT_PATH, buildFixReport(data), "utf8");
    printFixSummary(data);
  } finally {
    await prisma.$disconnect();
  }
}

function parseMode(args: string[]): Mode {
  const audit = args.includes("--audit");
  const fix = args.includes("--fix");

  if (audit && fix) {
    throw new Error("Use only one mode: --audit or --fix.");
  }
  if (fix) return "fix";
  return "audit";
}

async function loadAuditData(): Promise<AuditData> {
  const [offerRows, quoteItems, params, sourceFiles, categoryCountsRows] = await Promise.all([
    prisma.$queryRaw<OfferRow[]>`
      SELECT p.id AS product_id,
             p.product_name,
             p.model_no,
             p.category,
             p.image_path,
             p.remark,
             p.size,
             so.id AS offer_id,
             so.factory_name,
             so.purchase_price,
             so.currency,
             so.moq,
             so.ctn_qty,
             so.price_updated_at,
             f.file_name,
             f.relative_path
      FROM products p
      JOIN supplier_offers so ON so.product_id = p.id
      LEFT JOIN files f ON so.source_file_id = f.id
      WHERE p.category = '三防灯'
        AND so.factory_name = '普照'
        AND p.model_no LIKE 'PZ-HP-B%'
      ORDER BY p.model_no, so.purchase_price
    `,
    prisma.$queryRaw<QuoteItemRow[]>`
      SELECT qi.id AS item_id,
             qi.quote_id,
             qi.product_id,
             qi.supplier_offer_id,
             p.product_name,
             p.model_no,
             qi.purchase_price AS quote_purchase_price,
             q.created_at AS quote_date
      FROM quote_items qi
      JOIN quotes q ON qi.quote_id = q.id
      JOIN supplier_offers so ON qi.supplier_offer_id = so.id
      JOIN products p ON so.product_id = p.id
      WHERE p.category = '三防灯'
        AND so.factory_name = '普照'
        AND p.model_no LIKE 'PZ-HP-B%'
      ORDER BY q.created_at DESC, p.model_no
    `,
    prisma.$queryRaw<ParamRow[]>`
      SELECT pp.product_id,
             p.model_no,
             pp.param_key,
             pp.normalized_value,
             pp.unit
      FROM product_params pp
      JOIN products p ON pp.product_id = p.id
      WHERE p.category = '三防灯'
        AND p.model_no LIKE 'PZ-HP-B%'
      ORDER BY p.model_no, pp.param_key
    `,
    prisma.$queryRaw<FileRow[]>`
      SELECT id, file_name, relative_path, file_type
      FROM files
      WHERE relative_path LIKE '%汇孚广交会%双色管%'
         OR file_name LIKE '%双色管报价表25.10%'
      ORDER BY relative_path
    `,
    prisma.$queryRaw<
      Array<{
        tri_proof_products: bigint | number;
        puzhao_tri_proof_offers: bigint | number;
        pz_hp_b_anomaly_offers: bigint | number;
      }>
    >`
      SELECT
        (SELECT COUNT(*) FROM products WHERE category = '三防灯') AS tri_proof_products,
        (
          SELECT COUNT(*)
          FROM supplier_offers so
          JOIN products p ON p.id = so.product_id
          WHERE p.category = '三防灯' AND so.factory_name = '普照'
        ) AS puzhao_tri_proof_offers,
        (
          SELECT COUNT(*)
          FROM supplier_offers so
          JOIN products p ON p.id = so.product_id
          WHERE p.category = '三防灯'
            AND so.factory_name = '普照'
            AND (p.model_no LIKE 'PZ-HP-B1-%' OR p.model_no LIKE 'PZ-HP-B2-%')
            AND CAST(so.purchase_price AS REAL) <= 5
        ) AS pz_hp_b_anomaly_offers
    `,
  ]);

  const productIds = [...new Set(offerRows.map((row) => row.product_id))];
  const offerIds = offerRows.map((row) => row.offer_id);

  const [productOfferCounts, priceHistoryCounts] = await Promise.all([
    loadProductOfferCounts(productIds),
    loadPriceHistoryCounts(offerIds),
  ]);

  const data: AuditData = {
    generatedAt: new Date(),
    offerRows,
    targets: [],
    quoteItems,
    params,
    sourceFiles,
    productOfferCounts,
    priceHistoryCounts,
    categoryCounts: {
      triProofProducts: toNumber(categoryCountsRows[0]?.tri_proof_products),
      puzhaoTriProofOffers: toNumber(categoryCountsRows[0]?.puzhao_tri_proof_offers),
      pzHpBAnomalyOffers: toNumber(categoryCountsRows[0]?.pz_hp_b_anomaly_offers),
    },
  };
  data.targets = buildTargets(data);

  return data;
}

async function loadProductOfferCounts(productIds: string[]): Promise<Map<string, number>> {
  if (productIds.length === 0) return new Map();
  const rows = await prisma.$queryRaw<CountRow[]>`
    SELECT product_id, COUNT(*) AS count
    FROM supplier_offers
    WHERE product_id IN (${Prisma.join(productIds)})
    GROUP BY product_id
  `;
  return new Map(rows.map((row) => [row.product_id, toNumber(row.count)]));
}

async function loadPriceHistoryCounts(offerIds: string[]): Promise<Map<string, number>> {
  if (offerIds.length === 0) return new Map();
  const rows = await prisma.$queryRaw<PriceHistoryCountRow[]>`
    SELECT supplier_offer_id, COUNT(*) AS count
    FROM price_history
    WHERE supplier_offer_id IN (${Prisma.join(offerIds)})
    GROUP BY supplier_offer_id
  `;
  return new Map(rows.map((row) => [row.supplier_offer_id, toNumber(row.count)]));
}

function buildTargets(data: AuditData): AuditTarget[] {
  return data.offerRows
    .filter((row) => isAnomalyCandidate(row))
    .map((row) => {
      const match = findV224Match(row, data.offerRows);
      const totalOffers = data.productOfferCounts.get(row.product_id) ?? 0;
      const hasImage = Boolean(row.image_path?.trim());

      if (hasImage) {
        return {
          ...row,
          priceNumber: priceToNumber(row.purchase_price),
          match,
          action: "skip-has-image",
          reason: "旧产品有 image_path，按安全规则不自动删除",
        };
      }

      if (totalOffers > 1) {
        return {
          ...row,
          priceNumber: priceToNumber(row.purchase_price),
          match,
          action: "skip-has-other-offers",
          reason: `旧产品还有其他 offer（${totalOffers} 条），不自动删产品`,
        };
      }

      if (!match) {
        return {
          ...row,
          priceNumber: priceToNumber(row.purchase_price),
          match,
          action: "needs-price-correction",
          reason: "没有找到 V2.24 对应正确价格产品，不能按重复删除",
        };
      }

      return {
        ...row,
        priceNumber: priceToNumber(row.purchase_price),
        match,
        action: "duplicate-delete",
        reason: "旧产品是低价重复记录，已有 V2.24 正确价格产品",
      };
    });
}

function isAnomalyCandidate(row: OfferRow): boolean {
  const modelNo = row.model_no ?? "";
  return /^PZ-HP-B[12]-/.test(modelNo) && priceToNumber(row.purchase_price) <= 5;
}

function findV224Match(target: OfferRow, rows: OfferRow[]): OfferRow | null {
  const prefix = toV224ModelPrefix(target.model_no ?? "");
  if (!prefix) return null;

  return (
    rows.find((row) => {
      const modelNo = row.model_no ?? "";
      return (
        row.product_id !== target.product_id &&
        row.factory_name === target.factory_name &&
        priceToNumber(row.purchase_price) > 5 &&
        (modelNo === prefix || modelNo.startsWith(`${prefix} `))
      );
    }) ?? null
  );
}

function toV224ModelPrefix(modelNo: string): string | null {
  if (/^PZ-HP-B1-/.test(modelNo)) {
    return modelNo.replace(/^PZ-HP-B1-/, "PZ-HP-B-");
  }
  if (/^PZ-HP-B2-/.test(modelNo)) {
    return modelNo;
  }
  return null;
}

async function runFix(): Promise<FixData> {
  const before = await loadAuditData();
  assertSafeToFix(before);

  await mkdir(BACKUP_DIR, { recursive: true });
  const backupPath = `${BACKUP_DIR}/dev-before-v2.25-${timestampForFile()}.sqlite`;
  await copyFile(DB_PATH, backupPath);

  const targetOfferIds = before.targets.map((row) => row.offer_id);
  const targetProductIds = before.targets.map((row) => row.product_id);

  const result = await prisma.$transaction(async (tx) => {
    const quoteItems = await tx.quoteItem.deleteMany({
      where: { supplierOfferId: { in: targetOfferIds } },
    });
    const priceHistory = await tx.priceHistory.deleteMany({
      where: { supplierOfferId: { in: targetOfferIds } },
    });
    const params = await tx.productParam.deleteMany({
      where: { productId: { in: targetProductIds } },
    });
    const offers = await tx.supplierOffer.deleteMany({
      where: { id: { in: targetOfferIds } },
    });
    const remainingOffers = await tx.supplierOffer.findMany({
      where: { productId: { in: targetProductIds } },
      select: { productId: true },
    });
    const productsWithOffers = new Set(remainingOffers.map((offer) => offer.productId));
    const productIdsToDelete = targetProductIds.filter((productId) => !productsWithOffers.has(productId));
    const products = await tx.product.deleteMany({
      where: { id: { in: productIdsToDelete } },
    });

    return {
      quoteItems: quoteItems.count,
      priceHistory: priceHistory.count,
      params: params.count,
      offers: offers.count,
      products: products.count,
    };
  });

  const after = await loadAuditData();
  assertFixResult(before, after, result);

  return {
    generatedAt: new Date(),
    backupPath,
    before,
    after,
    deletedProducts: result.products,
    deletedOffers: result.offers,
    deletedParams: result.params,
    deletedPriceHistory: result.priceHistory,
    deletedQuoteItems: result.quoteItems,
    deletedProductRows: before.targets,
  };
}

function assertSafeToFix(data: AuditData) {
  const unsafeTargets = data.targets.filter((row) => row.action !== "duplicate-delete");
  if (data.targets.length !== 6) {
    throw new Error(`Expected exactly 6 anomaly targets, found ${data.targets.length}. Run --audit first.`);
  }
  if (unsafeTargets.length > 0) {
    throw new Error(`Unsafe targets found: ${unsafeTargets.map((row) => `${row.model_no}:${row.action}`).join(", ")}`);
  }
  if (data.quoteItems.length > 0) {
    throw new Error(`Quote items reference target PZ-HP-B offers (${data.quoteItems.length}); review before deleting.`);
  }
}

function assertFixResult(before: AuditData, after: AuditData, result: { products: number; offers: number; params: number }) {
  if (result.products !== 6) {
    throw new Error(`Expected 6 products deleted, got ${result.products}.`);
  }
  if (result.offers !== 6) {
    throw new Error(`Expected 6 offers deleted, got ${result.offers}.`);
  }
  if (after.categoryCounts.pzHpBAnomalyOffers !== 0) {
    throw new Error(`Expected 0 remaining anomaly offers, got ${after.categoryCounts.pzHpBAnomalyOffers}.`);
  }
  if (after.targets.length !== 0) {
    throw new Error(`Expected 0 remaining targets, got ${after.targets.length}.`);
  }
  if (before.params.length - after.params.length !== result.params) {
    throw new Error("Param deletion count does not match before/after param rows.");
  }
}

function buildAuditReport(data: AuditData): string {
  const duplicateTargets = data.targets.filter((row) => row.action === "duplicate-delete");
  const targetParamIds = new Set(data.targets.map((row) => row.product_id));
  const targetParamCount = data.params.filter((row) => targetParamIds.has(row.product_id)).length;
  const targetPriceHistoryCount = sum(data.targets.map((row) => data.priceHistoryCounts.get(row.offer_id) ?? 0));

  return [
    "# V2.25 — 普照三防灯价格异常审计",
    "",
    `Generated: ${data.generatedAt.toISOString()}`,
    "",
    "## 异常 Offer 列表",
    "",
    "| Product ID | Model | Price | Source File | V2.24 Match | Match Price | Action | Reason |",
    "|---|---|---:|---|---|---:|---|---|",
    ...data.targets.map(
      (row) =>
        `| ${row.product_id} | ${escapeMd(row.model_no)} | ${formatPrice(row.purchase_price)} | ${escapeMd(
          row.relative_path,
        )} | ${escapeMd(row.match?.model_no)} | ${row.match ? formatPrice(row.match.purchase_price) : "-"} | ${row.action} | ${escapeMd(
          row.reason,
        )} |`,
    ),
    "",
    "## 全部 PZ-HP-B 对照",
    "",
    "| Model | Price | Factory | Source | Product ID | Offer ID |",
    "|---|---:|---|---|---|---|",
    ...data.offerRows.map(
      (row) =>
        `| ${escapeMd(row.model_no)} | ${formatPrice(row.purchase_price)} | ${escapeMd(row.factory_name)} | ${escapeMd(
          row.relative_path,
        )} | ${row.product_id} | ${row.offer_id} |`,
    ),
    "",
    "## Quote Items 引用检查",
    "",
    data.quoteItems.length === 0
      ? "无 quote_items 引用这些 PZ-HP-B 普照 offers。"
      : [
          `有 ${data.quoteItems.length} 条 quote_items 引用：`,
          "",
          "| Quote Item | Quote ID | Product | Model | Snapshot Purchase Price | Quote Date |",
          "|---|---|---|---|---:|---|",
          ...data.quoteItems.map(
            (row) =>
              `| ${row.item_id} | ${row.quote_id} | ${escapeMd(row.product_name)} | ${escapeMd(row.model_no)} | ${formatPrice(
                row.quote_purchase_price,
              )} | ${formatDate(row.quote_date)} |`,
          ),
        ].join("\n"),
    "",
    "## Product Params 检查",
    "",
    `PZ-HP-B 相关 params 总数：${data.params.length}`,
    "",
    "| Model | Param Count | Params |",
    "|---|---:|---|",
    ...groupParamsByModel(data.params).map(
      (row) => `| ${escapeMd(row.modelNo)} | ${row.count} | ${escapeMd(row.params.join(", "))} |`,
    ),
    "",
    "## 源 Excel 文件检查",
    "",
    data.sourceFiles.length === 0
      ? "未在 files 表中找到 2025-10 双色管源文件记录。"
      : [
          "| File ID | File Name | Type | Relative Path |",
          "|---|---|---|---|",
          ...data.sourceFiles.map(
            (row) => `| ${row.id} | ${escapeMd(row.file_name)} | ${escapeMd(row.file_type)} | ${escapeMd(row.relative_path)} |`,
          ),
        ].join("\n"),
    "",
    "## 建议操作",
    "",
    `- 删除异常产品：${duplicateTargets.length}`,
    `- 删除异常 offer：${duplicateTargets.length}`,
    `- 删除关联 params：${targetParamCount}`,
    `- 删除关联 price_history：${targetPriceHistoryCount}`,
    `- 删除 quote_items：${data.quoteItems.length}`,
    "",
    "## 安全检查",
    "",
    "| Check | Result |",
    "|---|---|",
    `| 目标异常 offer 数 | ${data.targets.length} |`,
    `| duplicate-delete 数 | ${duplicateTargets.length} |`,
    `| 非 duplicate-delete 数 | ${data.targets.length - duplicateTargets.length} |`,
    `| quote_items 引用 | ${data.quoteItems.length} |`,
    `| 三防灯 products | ${data.categoryCounts.triProofProducts} |`,
    `| 三防灯 / 普照 offers | ${data.categoryCounts.puzhaoTriProofOffers} |`,
    `| PZ-HP-B1/B2 price<=5 offers | ${data.categoryCounts.pzHpBAnomalyOffers} |`,
    "",
  ].join("\n");
}

function buildFixReport(data: FixData): string {
  return [
    "# V2.25 — 普照三防灯价格修正结果",
    "",
    `Generated: ${data.generatedAt.toISOString()}`,
    `DB Backup: ${data.backupPath}`,
    "",
    "## 操作摘要",
    "",
    "| 操作 | 数量 |",
    "|---|---:|",
    `| Products deleted | ${data.deletedProducts} |`,
    `| Offers deleted | ${data.deletedOffers} |`,
    `| Params deleted | ${data.deletedParams} |`,
    `| Price history deleted | ${data.deletedPriceHistory} |`,
    `| Quote items deleted | ${data.deletedQuoteItems} |`,
    "",
    "## 删除明细",
    "",
    "| Product ID | Model | Deleted Offer ID | Old Price | Matched Correct Model | Correct Price | Source File |",
    "|---|---|---|---:|---|---:|---|",
    ...data.deletedProductRows.map(
      (row) =>
        `| ${row.product_id} | ${escapeMd(row.model_no)} | ${row.offer_id} | ${formatPrice(row.purchase_price)} | ${escapeMd(
          row.match?.model_no,
        )} | ${row.match ? formatPrice(row.match.purchase_price) : "-"} | ${escapeMd(row.relative_path)} |`,
    ),
    "",
    "## 验证",
    "",
    "| Metric | Before | After |",
    "|---|---:|---:|",
    `| 三防灯 products | ${data.before.categoryCounts.triProofProducts} | ${data.after.categoryCounts.triProofProducts} |`,
    `| 三防灯 普照 offers | ${data.before.categoryCounts.puzhaoTriProofOffers} | ${data.after.categoryCounts.puzhaoTriProofOffers} |`,
    `| PZ-HP-B1/B2 price<=5 offers | ${data.before.categoryCounts.pzHpBAnomalyOffers} | ${data.after.categoryCounts.pzHpBAnomalyOffers} |`,
    "",
    "## 修正后 PZ-HP-B 记录",
    "",
    "| Model | Price | Source |",
    "|---|---:|---|",
    ...data.after.offerRows.map(
      (row) => `| ${escapeMd(row.model_no)} | ${formatPrice(row.purchase_price)} | ${escapeMd(row.relative_path)} |`,
    ),
    "",
  ].join("\n");
}

function groupParamsByModel(params: ParamRow[]): Array<{ modelNo: string | null; count: number; params: string[] }> {
  const grouped = new Map<string, { modelNo: string | null; params: string[] }>();
  for (const param of params) {
    const key = param.model_no ?? "(no model)";
    const existing = grouped.get(key) ?? { modelNo: param.model_no, params: [] };
    existing.params.push(`${param.param_key}=${param.normalized_value ?? "-"}${param.unit ? ` ${param.unit}` : ""}`);
    grouped.set(key, existing);
  }
  return [...grouped.values()].map((row) => ({
    modelNo: row.modelNo,
    count: row.params.length,
    params: row.params,
  }));
}

function printAuditSummary(data: AuditData) {
  console.log(
    JSON.stringify(
      {
        mode: "audit",
        reportPath: AUDIT_REPORT_PATH,
        pzHpBRows: data.offerRows.length,
        anomalyTargets: data.targets.length,
        duplicateDelete: data.targets.filter((row) => row.action === "duplicate-delete").length,
        quoteItems: data.quoteItems.length,
        params: data.params.length,
      },
      null,
      2,
    ),
  );
}

function printFixSummary(data: FixData) {
  console.log(
    JSON.stringify(
      {
        mode: "fix",
        reportPath: FIX_REPORT_PATH,
        backupPath: data.backupPath,
        deletedProducts: data.deletedProducts,
        deletedOffers: data.deletedOffers,
        deletedParams: data.deletedParams,
        deletedPriceHistory: data.deletedPriceHistory,
        deletedQuoteItems: data.deletedQuoteItems,
        remainingAnomalyOffers: data.after.categoryCounts.pzHpBAnomalyOffers,
      },
      null,
      2,
    ),
  );
}

function priceToNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") return Number(value);
  if (value && typeof value === "object" && "toString" in value) {
    return Number(value.toString());
  }
  return Number.NaN;
}

function formatPrice(value: unknown): string {
  const number = priceToNumber(value);
  return Number.isFinite(number) ? number.toFixed(2).replace(/\.00$/, "") : "-";
}

function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "-";
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function escapeMd(value: string | null | undefined): string {
  if (!value) return "-";
  return value.replace(/\|/g, "\\|").replace(/\n/g, "<br>");
}

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") return Number(value);
  if (value && typeof value === "object" && "toString" in value) {
    return Number(value.toString());
  }
  return 0;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function timestampForFile(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
