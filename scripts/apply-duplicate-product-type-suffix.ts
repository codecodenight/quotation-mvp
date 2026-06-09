/* eslint-disable @typescript-eslint/no-require-imports */
{
const fs = require("node:fs/promises") as typeof import("node:fs/promises");
const { PrismaClient } = require("@prisma/client") as typeof import("@prisma/client");

const prisma = new PrismaClient();
const reportPath = "docs/v2.4-duplicate-product-type-suffix-report.md";

const updates = [
  {
    id: "b5f0338f-3995-4be5-934b-1988e1a4387f",
    modelNo: "Wall Light 10W SMD ABS 135x90x105mm Type A",
  },
  {
    id: "90916361-7bff-4904-b9b0-a617466c21f9",
    modelNo: "Wall Light 10W SMD ABS 135x90x105mm Type B",
  },
  {
    id: "7852ba27-1cfc-470f-a690-597d0b9c155d",
    modelNo: "Wall Light 10W SMD 铝 110x90x130mm Type A",
  },
  {
    id: "1c8f58f3-f6aa-4a73-9cd1-8ef3a48900b0",
    modelNo: "Wall Light 10W SMD 铝 110x90x130mm Type B",
  },
  {
    id: "57f005b2-58ab-47e3-bd6e-d51aaecd4bbe",
    modelNo: "Wall Light 12W SMD ABS 170x170x100mm Type A",
  },
  {
    id: "673f40ac-0ddf-4641-8240-db17ade8218e",
    modelNo: "Wall Light 12W SMD ABS 170x170x100mm Type B",
  },
  {
    id: "1457a68b-ed8c-4ea4-ace2-315ea9536478",
    modelNo: "Wall Light 12W SMD 铝 160x160x100 Type A",
  },
  {
    id: "24daeeb2-65a4-4fcb-906e-cdcff93bb661",
    modelNo: "Wall Light 12W SMD 铝 160x160x100 Type B",
  },
  {
    id: "ed1843d1-228c-40a5-8bb2-79c50109bdbd",
    modelNo: "Wall Light 5W SMD ABS 135x90x70 Type A",
  },
  {
    id: "97b3d707-5db2-42b2-8cca-9f77816f5194",
    modelNo: "Wall Light 5W SMD ABS 135x90x70 Type B",
  },
  {
    id: "eb7525f2-a531-4511-ab8d-7678c0d1e999",
    modelNo: "Wall Light 5W SMD 铝 100x100x80mm Type A",
  },
  {
    id: "4636cbf5-9e7c-4994-8052-cb75aed14568",
    modelNo: "Wall Light 5W SMD 铝 100x100x80mm Type B",
  },
];

type AppliedUpdate = {
  id: string;
  oldModelNo: string;
  newModelNo: string;
  price: string;
};

async function main() {
  const applied: AppliedUpdate[] = [];

  const result = await prisma.$transaction(async (tx) => {
    for (const update of updates) {
      const product = await tx.product.findUnique({
        where: { id: update.id },
        include: { supplierOffers: true },
      });
      if (!product) {
        throw new Error(`未找到产品 ${update.id}`);
      }
      if (product.category !== "壁灯") {
        throw new Error(`${product.id} 不是壁灯产品，停止执行`);
      }

      await tx.product.update({
        where: { id: product.id },
        data: {
          modelNo: update.modelNo,
          productName: update.modelNo,
        },
      });

      applied.push({
        id: product.id,
        oldModelNo: product.modelNo ?? "",
        newModelNo: update.modelNo,
        price: product.supplierOffers.map((offer) => `${offer.purchasePrice.toString()} ${offer.currency}`).join(", "),
      });
    }

    return { productsUpdated: applied.length };
  });

  await fs.writeFile(reportPath, renderReport(applied), "utf8");
  console.log(JSON.stringify({ ...result, report: reportPath }, null, 2));
}

function renderReport(rows: AppliedUpdate[]): string {
  const lines = [
    "# V2.4 Duplicate Product Type Suffix Report",
    "",
    `Generated at: ${new Date().toISOString()}`,
    "",
    `- Products updated: ${rows.length}`,
    "- Only product_name and model_no were changed.",
    "- Supplier offers, prices, source files, size, material, and remark were not changed.",
    "",
    "| # | Price | Before model_no | After model_no | Product id |",
    "|---:|---:|---|---|---|",
  ];

  rows.forEach((row, index) => {
    lines.push(`| ${index + 1} | ${md(row.price)} | ${md(row.oldModelNo)} | ${md(row.newModelNo)} | ${row.id} |`);
  });

  return lines.join("\n");
}

function md(value: string): string {
  return value.replace(/\r?\n/g, " ").replace(/\s+/g, " ").replaceAll("|", "\\|").slice(0, 180);
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
