/* eslint-disable @typescript-eslint/no-require-imports */
{
const fs = require("node:fs/promises") as typeof import("node:fs/promises");
const XLSX = require("xlsx") as typeof import("xlsx");
const { PrismaClient } = require("@prisma/client") as typeof import("@prisma/client");

const prisma = new PrismaClient();
const reportPath = "docs/v2.3-product-identifier-cleanup-plan.md";
const numericIdentifierValues = Array.from({ length: 500 }, (_, index) => String(index + 1));

type ProductWithOffers = Awaited<ReturnType<typeof loadIdentifierIssueProducts>>[number];

type ProposalStatus = "ready-to-apply" | "needs-human-review";

type ProductUpdateProposal = {
  productId: string;
  status: ProposalStatus;
  category: string;
  currentModelNo: string;
  proposedModelNo: string;
  currentProductName: string;
  proposedProductName: string;
  currentSize: string;
  proposedSize: string;
  currentRemark: string;
  proposedRemark: string;
  reason: string;
  evidence: string;
};

type OfferUpdateProposal = {
  offerId: string;
  status: ProposalStatus;
  productId: string;
  action: string;
  currentProductName: string;
  targetProductName: string;
  price: string;
  proposedMoq?: string;
  proposedCtnQty?: string;
  proposedCtnLength?: string;
  proposedCtnWidth?: string;
  proposedCtnHeight?: string;
  reason: string;
};

type NewProductProposal = {
  status: ProposalStatus;
  category: string;
  proposedModelNo: string;
  proposedProductName: string;
  proposedMaterial: string;
  proposedSize: string;
  proposedRemark: string;
  sourceOfferPrice: string;
  reason: string;
};

async function main() {
  const products = await loadIdentifierIssueProducts();
  const productProposals = buildProductUpdateProposals(products);
  const offerProposals = buildOfferUpdateProposals(products);
  const newProductProposals = buildNewProductProposals(products);

  await fs.writeFile(reportPath, renderReport({ productProposals, offerProposals, newProductProposals }), "utf8");

  console.log(
    JSON.stringify(
      {
        productsReviewed: products.length,
        productProposals: productProposals.length,
        readyProductUpdates: productProposals.filter((proposal) => proposal.status === "ready-to-apply").length,
        reviewProductUpdates: productProposals.filter((proposal) => proposal.status === "needs-human-review").length,
        offerProposals: offerProposals.length,
        newProductProposals: newProductProposals.length,
        report: reportPath,
      },
      null,
      2,
    ),
  );
}

async function loadIdentifierIssueProducts() {
  return prisma.product.findMany({
    where: {
      OR: [
        { modelNo: null },
        { modelNo: "" },
        { modelNo: { startsWith: "壁灯-" } },
        { modelNo: { in: numericIdentifierValues } },
        { productName: { in: numericIdentifierValues } },
      ],
    },
    include: {
      supplierOffers: {
        include: { sourceFile: true },
        orderBy: [{ purchasePrice: "asc" }],
      },
    },
    orderBy: [{ category: "asc" }, { modelNo: "asc" }],
  });
}

function buildProductUpdateProposals(products: ProductWithOffers[]): ProductUpdateProposal[] {
  return products.map((product) => {
    if (product.category === "皮线灯") {
      return buildPixiandengProductProposal(product);
    }
    if (product.category === "地插灯/太阳能壁灯") {
      return buildXinyijinSolarProductProposal(product);
    }
    return buildWallLightProductProposal(product);
  });
}

function buildPixiandengProductProposal(product: ProductWithOffers): ProductUpdateProposal {
  const sourceByName: Record<string, { modelNo: string; remark: string }> = {
    "皮线灯-单色": {
      modelNo: "RD-F-05-AY",
      remark: "50珠皮线灯 灯珠距离：10厘米 亮灯颜色：红/黄/蓝/绿/单彩/双彩 USB供电 不带APP 不同步 带记忆",
    },
    "皮线灯-双彩": {
      modelNo: "RD-DF-05-AY",
      remark: "50珠皮线灯 灯珠距离：10厘米 亮灯颜色：双色/双彩 USB供电 不带APP 不同步 带记忆",
    },
  };
  const source = sourceByName[product.productName] ?? {
    modelNo: product.modelNo ?? "",
    remark: product.remark ?? "",
  };

  return {
    productId: product.id,
    status: "ready-to-apply",
    category: product.category ?? "",
    currentModelNo: product.modelNo ?? "",
    proposedModelNo: source.modelNo,
    currentProductName: product.productName,
    proposedProductName: product.productName,
    currentSize: product.size ?? "",
    proposedSize: product.size ?? "",
    currentRemark: product.remark ?? "",
    proposedRemark: source.remark,
    reason: "来源表有真实“型号”列，可以直接补回 model_no。",
    evidence: "2026.4.28 皮线灯报价单.xls / sheet 合金线 / 名称 + 型号列。",
  };
}

function buildXinyijinSolarProductProposal(product: ProductWithOffers): ProductUpdateProposal {
  const offer = product.supplierOffers[0];
  const sourcePath = offer?.sourceFile?.absolutePathSnapshot;
  const sourceRow = sourcePath ? findXinyijinSolarSourceRow(sourcePath, offer.purchasePrice.toString()) : null;
  const description = sourceRow?.description ?? stripDescriptionPrefix(product.remark ?? "");
  const lumen = extractLumen(description);
  const modelNo = lumen ? `XYJ-SWL-${lumen}` : `XYJ-SWL-${product.modelNo}`;
  const productName = lumen ? `Solar Wall Light ${lumen}` : `Solar Wall Light ${product.modelNo}`;

  return {
    productId: product.id,
    status: "ready-to-apply",
    category: product.category ?? "",
    currentModelNo: product.modelNo ?? "",
    proposedModelNo: modelNo,
    currentProductName: product.productName,
    proposedProductName: productName,
    currentSize: product.size ?? "",
    proposedSize: "",
    currentRemark: product.remark ?? "",
    proposedRemark: description,
    reason: "来源表“货号”是 1/2/3/4/5，不适合发客户；描述中有流明等可读标识。当前 size 是包装 L 列误入，建议清空。",
    evidence: sourceRow
      ? `NEW太阳能报价单2024 0719.xls / sheet 壁灯系列 / row ${sourceRow.rowIndex} / 含税 ${sourceRow.price}`
      : "未能按价格定位源表行，使用现有 Product Details 生成候选。",
  };
}

function buildWallLightProductProposal(product: ProductWithOffers): ProductUpdateProposal {
  const sourcePath = product.supplierOffers[0]?.sourceFile?.absolutePathSnapshot;
  const sourceRowIndex = readTrailingNumber(product.modelNo ?? product.productName);
  const sourceRow = sourcePath && sourceRowIndex ? readWallLightSourceRow(sourcePath, sourceRowIndex) : null;
  const wattage = sourceRow?.wattage ?? readSpecPart(product.modelNo ?? "", 1);
  const material = sourceRow?.material ?? readSpecPart(product.modelNo ?? "", 3);
  const dimension = sourceRow?.dimension ?? product.size ?? "";
  const proposedModel = ["Wall Light", wattage, material, normalizeDimensionForModel(dimension)].filter(Boolean).join(" ");

  return {
    productId: product.id,
    status: "needs-human-review",
    category: product.category ?? "",
    currentModelNo: product.modelNo ?? "",
    proposedModelNo: proposedModel,
    currentProductName: product.productName,
    proposedProductName: proposedModel,
    currentSize: product.size ?? "",
    proposedSize: dimension,
    currentRemark: product.remark ?? "",
    proposedRemark: buildWallLightRemark(sourceRow, material),
    reason: "来源表“型号”列为空，图片可能承载了真实款式差异。可生成客户可读 Model Name，但不应无确认批量覆盖。",
    evidence: sourceRow
      ? `稣赐-壁灯广交会款询价单 20230406.xls / sheet 第1页 / row ${sourceRow.rowIndex} / 瓦数 ${sourceRow.wattage}`
      : "未能可靠定位源表行，保留人工确认。",
  };
}

function buildOfferUpdateProposals(products: ProductWithOffers[]): OfferUpdateProposal[] {
  const proposals: OfferUpdateProposal[] = [];
  for (const product of products) {
    if (product.category === "地插灯/太阳能壁灯") {
      const offer = product.supplierOffers[0];
      const sourcePath = offer?.sourceFile?.absolutePathSnapshot;
      const sourceRow = sourcePath ? findXinyijinSolarSourceRow(sourcePath, offer.purchasePrice.toString()) : null;
      if (offer && sourceRow) {
        proposals.push({
          offerId: offer.id,
          status: "ready-to-apply",
          productId: product.id,
          action: "fill-solar-offer-packaging",
          currentProductName: product.productName,
          targetProductName: product.productName,
          price: offer.purchasePrice.toString(),
          proposedMoq: "3000",
          proposedCtnQty: sourceRow.ctnQty,
          proposedCtnLength: sourceRow.ctnLength,
          proposedCtnWidth: sourceRow.ctnWidth,
          proposedCtnHeight: sourceRow.ctnHeight,
          reason: "来源表有 MOQ3K、Carton Size L/W/H、箱规数量，可补齐报价单 CTN 字段。",
        });
      }
    }

    if (product.productName === "皮线灯-单色") {
      const wrongOffer = product.supplierOffers.find((offer) => offer.purchasePrice.toString() === "7.9");
      if (wrongOffer) {
        proposals.push({
          offerId: wrongOffer.id,
          status: "ready-to-apply",
          productId: product.id,
          action: "move-offer-to-new-product",
          currentProductName: product.productName,
          targetProductName: "皮线灯-幻彩",
          price: wrongOffer.purchasePrice.toString(),
          reason: "来源表 row 5 是“皮线灯-幻彩 / RD-D-05-AY”，当前被并到“皮线灯-单色”下面。",
        });
      }
    }
  }
  return proposals;
}

function buildNewProductProposals(products: ProductWithOffers[]): NewProductProposal[] {
  const singleColor = products.find((product) => product.productName === "皮线灯-单色");
  const hasWrongOffer = singleColor?.supplierOffers.some((offer) => offer.purchasePrice.toString() === "7.9") ?? false;
  if (!hasWrongOffer) {
    return [];
  }

  return [
    {
      status: "ready-to-apply",
      category: "皮线灯",
      proposedModelNo: "RD-D-05-AY",
      proposedProductName: "皮线灯-幻彩",
      proposedMaterial: "铜线+LED",
      proposedSize: "5m/50珠",
      proposedRemark: "5米 50珠 USB按钮可以切换27种模式 APP带DIY功能可调1600万种颜色，3种声控方式，166种色光跳动模式，定时功能 配24键遥控器",
      sourceOfferPrice: "7.9",
      reason: "修复错误关联报价前，需要先补建真实产品。",
    },
  ];
}

function findXinyijinSolarSourceRow(sourcePath: string, price: string) {
  const rows = readSheetRows(sourcePath, "壁灯系列 ");
  const targetPrice = Number(price);
  for (const [index, row] of rows.entries()) {
    const sourcePrice = parsePrice(row[4]);
    if (sourcePrice !== null && Math.abs(sourcePrice - targetPrice) < 0.001) {
      return {
        rowIndex: index + 1,
        price: String(row[4] ?? ""),
        description: String(row[2] ?? "").trim(),
        ctnLength: String(row[8] ?? "").trim(),
        ctnWidth: String(row[9] ?? "").trim(),
        ctnHeight: String(row[10] ?? "").trim(),
        ctnQty: parseCtnQty(String(row[11] ?? "")),
      };
    }
  }
  return null;
}

function readWallLightSourceRow(sourcePath: string, rowIndex: number) {
  const rows = readSheetRows(sourcePath, "第1页");
  const row = rows[rowIndex - 1];
  if (!row) {
    return null;
  }
  return {
    rowIndex,
    wattage: String(row[2] ?? "").trim(),
    material: String(row[3] ?? "").trim(),
    housing: String(row[4] ?? "").trim(),
    dimension: String(row[5] ?? "").trim(),
    driver: String(row[6] ?? "").trim(),
    grounding: String(row[7] ?? "").trim(),
    cri: String(row[9] ?? "").trim(),
    moq: String(row[11] ?? "").trim(),
    price: String(row[12] ?? "").trim(),
  };
}

function readSheetRows(sourcePath: string, sheetName: string): string[][] {
  const workbook = XLSX.readFile(sourcePath, { cellDates: false });
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    return [];
  }
  return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" }) as string[][];
}

function renderReport({
  productProposals,
  offerProposals,
  newProductProposals,
}: {
  productProposals: ProductUpdateProposal[];
  offerProposals: OfferUpdateProposal[];
  newProductProposals: NewProductProposal[];
}): string {
  const readyProducts = productProposals.filter((proposal) => proposal.status === "ready-to-apply");
  const reviewProducts = productProposals.filter((proposal) => proposal.status === "needs-human-review");
  const lines = [
    "# V2.3 Product Identifier Cleanup Plan",
    "",
    `Generated at: ${new Date().toISOString()}`,
    "",
    "No database rows were changed.",
    "",
    "## Summary",
    "",
    `- Products reviewed: ${productProposals.length}`,
    `- Ready-to-apply product updates: ${readyProducts.length}`,
    `- Needs human review: ${reviewProducts.length}`,
    `- Offer fixes proposed: ${offerProposals.length}`,
    `- New products proposed: ${newProductProposals.length}`,
    "",
    "## Recommended Order",
    "",
    "1. Apply ready-to-apply fixes: 5 欣益进太阳能产品 + 2 皮线灯真实型号 + 1 皮线灯错挂报价拆分。",
    "2. Review 27 稣赐壁灯: 源表没有真实型号，图片可能区分款式；建议你确认生成的客户可读 Model Name 是否可接受。",
    "",
    "## Ready-To-Apply Product Updates",
    "",
    "| Category | Current model_no | Proposed model_no | Proposed product_name | Size change | Reason | Evidence |",
    "|---|---|---|---|---|---|---|",
  ];

  for (const proposal of readyProducts) {
    lines.push(
      [
        md(proposal.category),
        md(proposal.currentModelNo || "-"),
        md(proposal.proposedModelNo),
        md(proposal.proposedProductName),
        md(`${proposal.currentSize || "-"} → ${proposal.proposedSize || "-"}`),
        md(proposal.reason),
        md(proposal.evidence),
      ].join(" | ").replace(/^/, "| ") + " |",
    );
  }

  lines.push("", "## Offer Fixes", "");
  lines.push("| Action | Current product | Target product | Price | MOQ | CTN Qty | L | W | H | Reason |");
  lines.push("|---|---|---|---:|---|---|---|---|---|---|");
  for (const proposal of offerProposals) {
    lines.push(
      [
        md(proposal.action),
        md(proposal.currentProductName),
        md(proposal.targetProductName),
        md(proposal.price),
        md(proposal.proposedMoq ?? "-"),
        md(proposal.proposedCtnQty ?? "-"),
        md(proposal.proposedCtnLength ?? "-"),
        md(proposal.proposedCtnWidth ?? "-"),
        md(proposal.proposedCtnHeight ?? "-"),
        md(proposal.reason),
      ].join(" | ").replace(/^/, "| ") + " |",
    );
  }

  lines.push("", "## New Products Needed", "");
  lines.push("| Proposed model_no | Product name | Size | Source offer price | Reason |");
  lines.push("|---|---|---|---:|---|");
  for (const proposal of newProductProposals) {
    lines.push(
      [
        md(proposal.proposedModelNo),
        md(proposal.proposedProductName),
        md(proposal.proposedSize),
        md(proposal.sourceOfferPrice),
        md(proposal.reason),
      ].join(" | ").replace(/^/, "| ") + " |",
    );
  }

  lines.push("", "## Needs Human Review — 稣赐壁灯", "");
  lines.push("| Current model_no | Proposed customer-readable Model Name | Proposed details | Evidence |");
  lines.push("|---|---|---|---|");
  for (const proposal of reviewProducts) {
    lines.push(
      [
        md(proposal.currentModelNo),
        md(proposal.proposedModelNo),
        md(proposal.proposedRemark),
        md(proposal.evidence),
      ].join(" | ").replace(/^/, "| ") + " |",
    );
  }

  return lines.join("\n");
}

function parsePrice(value: unknown): number | null {
  const cleaned = String(value ?? "")
    .replace(/^\s*[¥￥$]\s*/, "")
    .replace(/,/g, "")
    .trim();
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseCtnQty(value: string): string {
  const match = value.match(/\/\s*([\d,]+)\s*PCS/i);
  return match?.[1]?.replace(/,/g, "") ?? "";
}

function extractLumen(description: string): string {
  const matches = Array.from(description.matchAll(/(\d+(?:\.\d+)?)\s*LM/gi));
  const lastMatch = matches.at(-1);
  return lastMatch ? `${lastMatch[1]}LM` : "";
}

function stripDescriptionPrefix(value: string): string {
  return value.replace(/^Description产品描述[:：]\s*/i, "").trim();
}

function readTrailingNumber(value: string): number | null {
  const match = value.match(/-(\d+)$/);
  return match ? Number.parseInt(match[1], 10) : null;
}

function readSpecPart(value: string, partIndex: number): string {
  const parts = value.split("-");
  return parts[partIndex] ?? "";
}

function normalizeDimensionForModel(value: string): string {
  return value.replace(/[×*]/g, "x").replace(/\s+/g, "");
}

function buildWallLightRemark(
  sourceRow: ReturnType<typeof readWallLightSourceRow>,
  fallbackMaterial: string,
): string {
  if (!sourceRow) {
    return fallbackMaterial ? `Material: ${fallbackMaterial}` : "";
  }
  return [
    sourceRow.wattage ? `Wattage: ${sourceRow.wattage}` : "",
    sourceRow.material ? `Material: ${sourceRow.material}` : "",
    sourceRow.housing ? `Housing: ${sourceRow.housing}` : "",
    sourceRow.driver ? `Driver: ${sourceRow.driver}` : "",
    sourceRow.grounding ? `Grounding: ${sourceRow.grounding}` : "",
    sourceRow.cri ? `CRI: ${sourceRow.cri}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function md(value: string): string {
  return value.replace(/\r?\n/g, "<br>").replaceAll("|", "\\|").slice(0, 240);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
}
