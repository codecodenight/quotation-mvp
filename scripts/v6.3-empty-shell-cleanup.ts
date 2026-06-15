import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const REPORT_PATH = path.join("docs", "v6.3-empty-shell-report.md");

const TARGET_PRODUCT_IDS = [
  "8e15ff84-8568-446e-8122-6f5c35eb0ce2",
  "092637af-0e1b-48de-b2ec-5edd587bc91a",
  "dceee231-9c2e-4891-9024-0daa5323bf30",
  "4b4e1369-038b-4e50-a2e2-220f1e76ffc5",
];

type ProductCheck = {
  id: string;
  modelNo: string | null;
  category: string | null;
  exists: boolean;
  supplierOffers: number;
  quoteItems: number;
  customerQuoteRows: number;
  priceHistory: number;
  params: number;
  status: "DELETE" | "SKIP" | "MISSING";
  reason: string;
};

type Counts = {
  products: number;
  productParams: number;
  supplierOffers: number;
};

async function main() {
  const before = await getCounts();
  const checks = await buildChecks();
  let backupPath: string | null = null;
  let deletedProducts = 0;
  let deletedParams = 0;

  if (APPLY) {
    backupPath = await backupDatabase();
    const safeIds = checks.filter((check) => check.status === "DELETE").map((check) => check.id);

    if (safeIds.length > 0) {
      await prisma.$transaction(async (tx) => {
        const deletedParamRows = await tx.productParam.deleteMany({ where: { productId: { in: safeIds } } });
        const deletedProductRows = await tx.product.deleteMany({ where: { id: { in: safeIds } } });
        deletedParams = deletedParamRows.count;
        deletedProducts = deletedProductRows.count;
      });
    }
  }

  const after = await getCounts();
  const remainingTargets = await prisma.product.count({ where: { id: { in: TARGET_PRODUCT_IDS } } });
  const verification = {
    targetProductsRemoved: remainingTargets === checks.filter((check) => check.status !== "DELETE").length,
    productsExpected: APPLY ? after.products === before.products - deletedProducts : after.products === before.products,
    supplierOffersUnchanged: after.supplierOffers === before.supplierOffers,
    dryRunUnchanged: APPLY ? true : JSON.stringify(before) === JSON.stringify(after),
  };

  await writeFile(
    REPORT_PATH,
    buildReport({
      mode: APPLY ? "apply" : "dry-run",
      backupPath,
      checks,
      before,
      after,
      deletedProducts,
      deletedParams,
      verification,
    }),
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        reportPath: REPORT_PATH,
        mode: APPLY ? "apply" : "dry-run",
        backupPath,
        deletedProducts,
        deletedParams,
        verificationPass: Object.values(verification).every(Boolean),
      },
      null,
      2,
    ),
  );
}

async function getCounts(): Promise<Counts> {
  const [products, productParams, supplierOffers] = await Promise.all([
    prisma.product.count(),
    prisma.productParam.count(),
    prisma.supplierOffer.count(),
  ]);

  return { products, productParams, supplierOffers };
}

async function buildChecks(): Promise<ProductCheck[]> {
  const checks: ProductCheck[] = [];

  for (const id of TARGET_PRODUCT_IDS) {
    const product = await prisma.product.findUnique({
      where: { id },
      select: { id: true, modelNo: true, category: true },
    });

    if (!product) {
      checks.push({
        id,
        modelNo: null,
        category: null,
        exists: false,
        supplierOffers: 0,
        quoteItems: 0,
        customerQuoteRows: 0,
        priceHistory: 0,
        params: 0,
        status: "MISSING",
        reason: "Product already absent",
      });
      continue;
    }

    const [supplierOffers, quoteItems, customerQuoteRows, params, priceHistoryRows] = await Promise.all([
      prisma.supplierOffer.count({ where: { productId: id } }),
      prisma.quoteItem.count({ where: { productId: id } }),
      prisma.$queryRaw<Array<{ cnt: number | bigint }>>`
        SELECT COUNT(*) AS cnt
        FROM customer_quote_rows
        WHERE matched_product_id = ${id}
      `,
      prisma.productParam.count({ where: { productId: id } }),
      prisma.$queryRaw<Array<{ cnt: number | bigint }>>`
        SELECT COUNT(*) AS cnt
        FROM price_history ph
        JOIN supplier_offers so ON so.id = ph.supplier_offer_id
        WHERE so.product_id = ${id}
      `,
    ]);

    const customerQuoteRowCount = toNumber(customerQuoteRows[0]?.cnt);
    const priceHistory = toNumber(priceHistoryRows[0]?.cnt);
    const safe = supplierOffers === 0 && quoteItems === 0 && customerQuoteRowCount === 0 && priceHistory === 0;

    checks.push({
      id,
      modelNo: product.modelNo,
      category: product.category,
      exists: true,
      supplierOffers,
      quoteItems,
      customerQuoteRows: customerQuoteRowCount,
      priceHistory,
      params,
      status: safe ? "DELETE" : "SKIP",
      reason: safe ? "No references" : "Has references",
    });
  }

  return checks;
}

async function backupDatabase(): Promise<string> {
  await mkdir("backups", { recursive: true });
  const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const backupPath = path.join("backups", `dev-before-v6.3-${timestamp}.sqlite`);
  execFileSync("cp", ["prisma/dev.db", backupPath]);
  return backupPath;
}

function buildReport(input: {
  mode: "dry-run" | "apply";
  backupPath: string | null;
  checks: ProductCheck[];
  before: Counts;
  after: Counts;
  deletedProducts: number;
  deletedParams: number;
  verification: Record<string, boolean>;
}) {
  const rows = input.checks
    .map(
      (check) =>
        `| \`${check.id}\` | ${escapeMd(check.modelNo ?? "-")} | ${escapeMd(check.category ?? "-")} | ${check.supplierOffers} | ${check.quoteItems} | ${check.customerQuoteRows} | ${check.priceHistory} | ${check.params} | ${check.status} | ${escapeMd(check.reason)} |`,
    )
    .join("\n");

  const verificationRows = Object.entries(input.verification)
    .map(([name, pass]) => `| ${name} | ${pass ? "PASS" : "FAIL"} |`)
    .join("\n");

  return `# V6.3 — Empty Shell Product Cleanup

Generated: ${new Date().toISOString()}

Mode: **${input.mode}**

Backup: ${input.backupPath ? `\`${input.backupPath}\`` : "(dry-run, none)"}

## Target Checks

| product_id | model_no | category | offers | quote_items | customer_quote_rows | price_history | params | status | reason |
|---|---|---|---:|---:|---:|---:|---:|---|---|
${rows}

## Counts

| Metric | Before | After |
|---|---:|---:|
| products | ${input.before.products.toLocaleString()} | ${input.after.products.toLocaleString()} |
| product_params | ${input.before.productParams.toLocaleString()} | ${input.after.productParams.toLocaleString()} |
| supplier_offers | ${input.before.supplierOffers.toLocaleString()} | ${input.after.supplierOffers.toLocaleString()} |

## Deleted

- Products deleted: ${input.deletedProducts}
- Product params deleted: ${input.deletedParams}

## Verification

| Check | Result |
|---|---|
${verificationRows}
`;
}

function toNumber(value: number | bigint | null | undefined): number {
  if (value == null) return 0;
  return typeof value === "bigint" ? Number(value) : Number(value);
}

function escapeMd(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
