/**
 * V46: 数据补全批处理
 *
 * 1. 安全自动补全（同产品 offer 互补）：一个产品的某条 offer 缺 CTN 数据、
 *    同产品另一条 offer 有，则复制过去（同产品装箱规格一致的业务假设）。
 * 2. 从已绑定的历史客户报价行回填 CTN：customer_quote_rows.ctn_qty/ctn_size
 *    有值且 matched_product_id 指向的产品所有 offer 都缺 CTN 时回填。
 * 3. 输出缺口报告：缺图片产品按源文件分组、缺 CTN 的 offer 按文件分组，
 *    写入 docs/v46-data-gap-report.md，方便后续手工或按文件批量处理。
 *
 * 运行：
 *   npx tsx scripts/v46-data-gap-fill.ts           # 只生成报告（dry-run）
 *   npx tsx scripts/v46-data-gap-fill.ts --apply   # 报告 + 执行自动补全
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { prisma } from "../src/lib/prisma";

const APPLY = process.argv.includes("--apply");
const REPORT_PATH = join(__dirname, "..", "docs", "v46-data-gap-report.md");

type CtnPatch = {
  offerId: string;
  productLabel: string;
  factoryName: string;
  source: "sibling-offer" | "customer-history";
  ctnQty: string | null;
  ctnSize: string | null;
  ctnLength: string | null;
  ctnWidth: string | null;
  ctnHeight: string | null;
};

function hasCtn(offer: {
  ctnQty: string | null;
  ctnSize: string | null;
  ctnLength: string | null;
  ctnWidth: string | null;
  ctnHeight: string | null;
}): boolean {
  return Boolean(offer.ctnQty || offer.ctnSize || (offer.ctnLength && offer.ctnWidth && offer.ctnHeight));
}

async function main() {
  const products = await prisma.product.findMany({
    select: {
      id: true,
      modelNo: true,
      productName: true,
      category: true,
      imagePath: true,
      supplierOffers: {
        select: {
          id: true,
          factoryName: true,
          ctnQty: true,
          ctnSize: true,
          ctnLength: true,
          ctnWidth: true,
          ctnHeight: true,
          sourceFile: { select: { fileName: true } },
        },
      },
    },
  });

  // ---- Pass 1: 同产品 offer 互补 ----
  const patches: CtnPatch[] = [];
  for (const product of products) {
    const donor = product.supplierOffers.find(hasCtn);
    if (!donor) {
      continue;
    }
    for (const offer of product.supplierOffers) {
      if (offer.id === donor.id || hasCtn(offer)) {
        continue;
      }
      patches.push({
        offerId: offer.id,
        productLabel: product.modelNo || product.productName,
        factoryName: offer.factoryName,
        source: "sibling-offer",
        ctnQty: donor.ctnQty,
        ctnSize: donor.ctnSize,
        ctnLength: donor.ctnLength,
        ctnWidth: donor.ctnWidth,
        ctnHeight: donor.ctnHeight,
      });
    }
  }

  // ---- Pass 2: 从已绑定历史报价行回填 ----
  const historyRows = await prisma.customerQuoteRow.findMany({
    where: {
      matchedProductId: { not: null },
      OR: [{ ctnQty: { not: null } }, { ctnSize: { not: null } }],
    },
    select: { matchedProductId: true, ctnQty: true, ctnSize: true },
  });
  const historyByProduct = new Map<string, { ctnQty: string | null; ctnSize: string | null }>();
  for (const row of historyRows) {
    if (row.matchedProductId && !historyByProduct.has(row.matchedProductId)) {
      historyByProduct.set(row.matchedProductId, { ctnQty: row.ctnQty, ctnSize: row.ctnSize });
    }
  }
  const patchedOfferIds = new Set(patches.map((patch) => patch.offerId));
  for (const product of products) {
    const history = historyByProduct.get(product.id);
    if (!history || product.supplierOffers.some(hasCtn)) {
      continue;
    }
    for (const offer of product.supplierOffers) {
      if (patchedOfferIds.has(offer.id)) {
        continue;
      }
      patches.push({
        offerId: offer.id,
        productLabel: product.modelNo || product.productName,
        factoryName: offer.factoryName,
        source: "customer-history",
        ctnQty: history.ctnQty,
        ctnSize: history.ctnSize,
        ctnLength: null,
        ctnWidth: null,
        ctnHeight: null,
      });
    }
  }

  // ---- Apply ----
  if (APPLY && patches.length > 0) {
    let applied = 0;
    for (const patch of patches) {
      await prisma.supplierOffer.update({
        where: { id: patch.offerId },
        data: {
          ctnQty: patch.ctnQty,
          ctnSize: patch.ctnSize,
          ctnLength: patch.ctnLength,
          ctnWidth: patch.ctnWidth,
          ctnHeight: patch.ctnHeight,
        },
      });
      applied += 1;
    }
    console.log(`已应用 ${applied} 条 CTN 补全`);
  }

  // ---- Report ----
  const missingImageProducts = products.filter((product) => !product.imagePath);
  const missingImageByFile = groupCount(
    missingImageProducts.map((product) => product.supplierOffers[0]?.sourceFile?.fileName ?? "（无源文件）"),
  );

  const offersMissingCtnAfter = products.flatMap((product) =>
    product.supplierOffers
      .filter((offer) => !hasCtn(offer) && !patchedOfferIds.has(offer.id) && !patches.some((patch) => patch.offerId === offer.id))
      .map((offer) => offer.sourceFile?.fileName ?? "（无源文件）"),
  );
  const missingCtnByFile = groupCount(offersMissingCtnAfter);

  const totalOffers = products.reduce((sum, product) => sum + product.supplierOffers.length, 0);
  const report = [
    `# V46 数据缺口报告`,
    ``,
    `生成时间：${new Date().toISOString().slice(0, 16).replace("T", " ")}${APPLY ? "（已执行补全）" : "（dry-run，未写入）"}`,
    ``,
    `## 概览`,
    ``,
    `- 产品总数：${products.length}，缺图片：${missingImageProducts.length}（${((missingImageProducts.length / products.length) * 100).toFixed(1)}%）`,
    `- Offer 总数：${totalOffers}，可自动补全 CTN：${patches.length} 条（同产品互补 ${patches.filter((patch) => patch.source === "sibling-offer").length}，历史报价回填 ${patches.filter((patch) => patch.source === "customer-history").length}）`,
    `- 补全后仍缺 CTN：${offersMissingCtnAfter.length} 条`,
    ``,
    `## 缺图片产品（按源文件 Top 30）`,
    ``,
    `| 源文件 | 缺图产品数 |`,
    `| --- | ---: |`,
    ...topEntries(missingImageByFile, 30).map(([file, count]) => `| ${file} | ${count} |`),
    ``,
    `## 补全后仍缺 CTN 的 Offer（按源文件 Top 30）`,
    ``,
    `| 源文件 | 缺 CTN Offer 数 |`,
    `| --- | ---: |`,
    ...topEntries(missingCtnByFile, 30).map(([file, count]) => `| ${file} | ${count} |`),
    ``,
    `## 待应用补全明细（前 50 条）`,
    ``,
    `| 产品 | 工厂 | 来源 | CTN Qty | CTN 尺寸 |`,
    `| --- | --- | --- | --- | --- |`,
    ...patches
      .slice(0, 50)
      .map(
        (patch) =>
          `| ${patch.productLabel} | ${patch.factoryName} | ${patch.source === "sibling-offer" ? "同产品互补" : "历史报价"} | ${patch.ctnQty ?? "-"} | ${patch.ctnSize ?? ([patch.ctnLength, patch.ctnWidth, patch.ctnHeight].filter(Boolean).join("*") || "-")} |`,
      ),
    ``,
  ].join("\n");

  writeFileSync(REPORT_PATH, report, "utf8");
  console.log(`报告已写入 docs/v46-data-gap-report.md`);
  console.log(
    `缺图片 ${missingImageProducts.length}/${products.length}，可补 CTN ${patches.length} 条，补后仍缺 ${offersMissingCtnAfter.length} 条${APPLY ? "" : "（加 --apply 执行补全）"}`,
  );
}

function groupCount(items: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    counts.set(item, (counts.get(item) ?? 0) + 1);
  }
  return counts;
}

function topEntries(counts: Map<string, number>, limit: number): Array<[string, number]> {
  return [...counts.entries()].sort((left, right) => right[1] - left[1]).slice(0, limit);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
