import { readFile, writeFile } from "node:fs/promises";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DETAILS_CSV_PATH = "docs/drive-db-diff-details.csv";
const REPORT_PATH = "docs/stale-files-cleanup-report.md";

type CsvRow = Record<string, string>;

async function main() {
  const csvRows = parseCsv(await readFile(DETAILS_CSV_PATH, "utf8"));
  const staleRows = csvRows.filter((row) => row.status === "db-file-missing-no-match");
  const candidateRows = csvRows.filter((row) => row.status === "db-path-missing-candidate-on-disk");
  const staleIds = unique(staleRows.map((row) => row.dbId).filter(Boolean));

  const before = await readCounts(staleIds);
  assertPreconditions({ staleRows, candidateRows, staleIds, before });

  const result = await prisma.$transaction(async (tx) => {
    const supplierOfferUpdate = await tx.supplierOffer.updateMany({
      where: { sourceFileId: { in: staleIds } },
      data: { sourceFileId: null },
    });

    await tx.priceHistory.updateMany({
      where: { oldSourceFileId: { in: staleIds } },
      data: { oldSourceFileId: null },
    });
    await tx.priceHistory.updateMany({
      where: { newSourceFileId: { in: staleIds } },
      data: { newSourceFileId: null },
    });

    const filesDelete = await tx.file.deleteMany({
      where: { id: { in: staleIds } },
    });

    return {
      supplierOfferSourceCleared: supplierOfferUpdate.count,
      filesDeleted: filesDelete.count,
    };
  });

  const after = await readCounts(staleIds);
  const reportAppendix = buildApplyAppendix({ before, after, result, candidateRows, staleIds });
  await writeFile(REPORT_PATH, `${await readFile(REPORT_PATH, "utf8")}\n${reportAppendix}`, "utf8");

  console.log(JSON.stringify({ before, result, after }, null, 2));
}

function assertPreconditions(input: {
  staleRows: CsvRow[];
  candidateRows: CsvRow[];
  staleIds: string[];
  before: Awaited<ReturnType<typeof readCounts>>;
}) {
  if (input.staleRows.length !== 258) {
    throw new Error(`Expected 258 stale rows, got ${input.staleRows.length}`);
  }
  if (input.staleIds.length !== 258) {
    throw new Error(`Expected 258 unique stale IDs, got ${input.staleIds.length}`);
  }
  if (input.candidateRows.length !== 3) {
    throw new Error(`Expected 3 excluded candidate rows, got ${input.candidateRows.length}`);
  }
  if (input.before.staleFilesFound !== 258) {
    throw new Error(`Expected 258 stale file rows in DB, got ${input.before.staleFilesFound}`);
  }
  if (input.before.rawProductRefsToStale !== 0) {
    throw new Error(`raw_products references stale files; refusing apply: ${input.before.rawProductRefsToStale}`);
  }
  if (input.before.oldPriceHistoryRefsToStale !== 0 || input.before.newPriceHistoryRefsToStale !== 0) {
    throw new Error(
      `price_history references stale files; refusing apply: old=${input.before.oldPriceHistoryRefsToStale}, new=${input.before.newPriceHistoryRefsToStale}`,
    );
  }
}

async function readCounts(staleIds: string[]) {
  const [
    filesTotal,
    filesMyPassport,
    staleFilesFound,
    supplierOffers,
    supplierOffersWithSource,
    supplierOfferRefsToStale,
    rawProducts,
    rawProductRefsToStale,
    products,
    productParams,
    priceHistory,
    oldPriceHistoryRefsToStale,
    newPriceHistoryRefsToStale,
    danglingSupplierOffers,
    danglingRawProducts,
  ] = await Promise.all([
    prisma.file.count(),
    prisma.file.count({ where: { volumeName: "My Passport" } }),
    prisma.file.count({ where: { id: { in: staleIds } } }),
    prisma.supplierOffer.count(),
    prisma.supplierOffer.count({ where: { sourceFileId: { not: null } } }),
    prisma.supplierOffer.count({ where: { sourceFileId: { in: staleIds } } }),
    prisma.rawProduct.count(),
    prisma.rawProduct.count({ where: { sourceFileId: { in: staleIds } } }),
    prisma.product.count(),
    prisma.productParam.count(),
    prisma.priceHistory.count(),
    prisma.priceHistory.count({ where: { oldSourceFileId: { in: staleIds } } }),
    prisma.priceHistory.count({ where: { newSourceFileId: { in: staleIds } } }),
    prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) AS count
      FROM supplier_offers so
      WHERE so.source_file_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM files f WHERE f.id = so.source_file_id)
    `.then((rows) => Number(rows[0]?.count ?? 0)),
    prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) AS count
      FROM raw_products rp
      WHERE NOT EXISTS (SELECT 1 FROM files f WHERE f.id = rp.source_file_id)
    `.then((rows) => Number(rows[0]?.count ?? 0)),
  ]);

  return {
    filesTotal,
    filesMyPassport,
    staleFilesFound,
    supplierOffers,
    supplierOffersWithSource,
    supplierOfferRefsToStale,
    rawProducts,
    rawProductRefsToStale,
    products,
    productParams,
    priceHistory,
    oldPriceHistoryRefsToStale,
    newPriceHistoryRefsToStale,
    danglingSupplierOffers,
    danglingRawProducts,
  };
}

function buildApplyAppendix(input: {
  before: Awaited<ReturnType<typeof readCounts>>;
  after: Awaited<ReturnType<typeof readCounts>>;
  result: { supplierOfferSourceCleared: number; filesDeleted: number };
  candidateRows: CsvRow[];
  staleIds: string[];
}) {
  const lines: string[] = [];
  lines.push("");
  lines.push("## Apply Result");
  lines.push("");
  lines.push(`Applied: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("| Operation | Count |");
  lines.push("|---|---:|");
  lines.push(`| stale IDs processed | ${input.staleIds.length} |`);
  lines.push(`| supplier_offers.source_file_id cleared | ${input.result.supplierOfferSourceCleared} |`);
  lines.push(`| files deleted | ${input.result.filesDeleted} |`);
  lines.push(`| candidate-on-disk rows left untouched | ${input.candidateRows.length} |`);
  lines.push("");
  lines.push("### Before / After Verification");
  lines.push("");
  lines.push("| Check | Before | After | Expected |");
  lines.push("|---|---:|---:|---:|");
  lines.push(`| files total | ${input.before.filesTotal} | ${input.after.filesTotal} | 489 |`);
  lines.push(`| files on My Passport | ${input.before.filesMyPassport} | ${input.after.filesMyPassport} | 477 |`);
  lines.push(`| stale files still in DB | ${input.before.staleFilesFound} | ${input.after.staleFilesFound} | 0 |`);
  lines.push(`| supplier_offers | ${input.before.supplierOffers} | ${input.after.supplierOffers} | 2230 |`);
  lines.push(`| supplier_offers with source_file_id | ${input.before.supplierOffersWithSource} | ${input.after.supplierOffersWithSource} | 2029 |`);
  lines.push(`| supplier_offers refs to stale files | ${input.before.supplierOfferRefsToStale} | ${input.after.supplierOfferRefsToStale} | 0 |`);
  lines.push(`| raw_products | ${input.before.rawProducts} | ${input.after.rawProducts} | 35 |`);
  lines.push(`| raw_products refs to stale files | ${input.before.rawProductRefsToStale} | ${input.after.rawProductRefsToStale} | 0 |`);
  lines.push(`| products | ${input.before.products} | ${input.after.products} | 2140 |`);
  lines.push(`| product_params | ${input.before.productParams} | ${input.after.productParams} | 2755 |`);
  lines.push(`| price_history | ${input.before.priceHistory} | ${input.after.priceHistory} | 0 |`);
  lines.push(`| dangling supplier_offers source refs | ${input.before.danglingSupplierOffers} | ${input.after.danglingSupplierOffers} | 0 |`);
  lines.push(`| dangling raw_products source refs | ${input.before.danglingRawProducts} | ${input.after.danglingRawProducts} | 0 |`);
  lines.push("");
  return lines.join("\n");
}

function parseCsv(text: string): CsvRow[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }

  if (cell || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  const [header, ...dataRows] = rows;
  if (!header) {
    return [];
  }
  return dataRows
    .filter((dataRow) => dataRow.some((value) => value.length > 0))
    .map((dataRow) => Object.fromEntries(header.map((key, index) => [key, dataRow[index] ?? ""])));
}

function unique(values: string[]) {
  return Array.from(new Set(values));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
