import { readFile, writeFile } from "node:fs/promises";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DETAILS_CSV_PATH = "docs/drive-db-diff-details.csv";
const REPORT_PATH = "docs/stale-files-cleanup-report.md";
const BACKUP_PATH = process.env.STALE_FILES_BACKUP_PATH ?? "backups/dev-before-stale-files-cleanup-20260611-195255.sqlite";

type CsvRow = Record<string, string>;

type StaleFile = {
  id: string;
  fileName: string;
  fileType: string;
  absolutePathSnapshot: string;
  relativePath: string;
  supplierOfferCount: number;
  rawProductCount: number;
  oldPriceHistoryCount: number;
  newPriceHistoryCount: number;
  categories: Map<string, number>;
  rawStatuses: Map<string, number>;
};

async function main() {
  const csvRows = parseCsv(await readFile(DETAILS_CSV_PATH, "utf8"));
  const staleRows = csvRows.filter((row) => row.status === "db-file-missing-no-match");
  const candidateRows = csvRows.filter((row) => row.status === "db-path-missing-candidate-on-disk");
  const staleIds = unique(staleRows.map((row) => row.dbId).filter(Boolean));

  const baseline = await getBaseline();
  const staleFiles = await loadStaleFiles(staleIds);
  const missingIds = staleIds.filter((id) => !staleFiles.some((file) => file.id === id));
  const refs = await loadReferences(staleIds);
  const enrichedFiles = staleFiles.map((file) => ({
    ...file,
    supplierOfferCount: refs.supplierOfferCounts.get(file.id) ?? 0,
    rawProductCount: refs.rawProductCounts.get(file.id) ?? 0,
    oldPriceHistoryCount: refs.oldPriceHistoryCounts.get(file.id) ?? 0,
    newPriceHistoryCount: refs.newPriceHistoryCounts.get(file.id) ?? 0,
    categories: refs.categoriesByFile.get(file.id) ?? new Map<string, number>(),
    rawStatuses: refs.rawStatusesByFile.get(file.id) ?? new Map<string, number>(),
  }));

  const report = buildReport({
    generatedAt: new Date(),
    backupPath: BACKUP_PATH,
    baseline,
    staleRows,
    candidateRows,
    staleIds,
    missingIds,
    staleFiles: enrichedFiles,
  });

  await writeFile(REPORT_PATH, report, "utf8");
  console.log(
    JSON.stringify(
      {
        reportPath: REPORT_PATH,
        backupPath: BACKUP_PATH,
        staleRows: staleRows.length,
        candidateRows: candidateRows.length,
        staleIds: staleIds.length,
        dbFilesFound: staleFiles.length,
        supplierOfferRefs: sum(enrichedFiles.map((file) => file.supplierOfferCount)),
        rawProductRefs: sum(enrichedFiles.map((file) => file.rawProductCount)),
        oldPriceHistoryRefs: sum(enrichedFiles.map((file) => file.oldPriceHistoryCount)),
        newPriceHistoryRefs: sum(enrichedFiles.map((file) => file.newPriceHistoryCount)),
      },
      null,
      2,
    ),
  );
}

async function getBaseline() {
  const [
    totalFiles,
    myPassportFiles,
    supplierOffers,
    offersWithSourceFile,
    rawProducts,
    products,
    productParams,
    priceHistory,
  ] = await Promise.all([
    prisma.file.count(),
    prisma.file.count({ where: { volumeName: "My Passport" } }),
    prisma.supplierOffer.count(),
    prisma.supplierOffer.count({ where: { sourceFileId: { not: null } } }),
    prisma.rawProduct.count(),
    prisma.product.count(),
    prisma.productParam.count(),
    prisma.priceHistory.count(),
  ]);

  return {
    totalFiles,
    myPassportFiles,
    supplierOffers,
    offersWithSourceFile,
    rawProducts,
    products,
    productParams,
    priceHistory,
  };
}

async function loadStaleFiles(staleIds: string[]) {
  const files = await prisma.file.findMany({
    where: { id: { in: staleIds } },
    orderBy: [{ fileName: "asc" }],
    select: {
      id: true,
      fileName: true,
      fileType: true,
      relativePath: true,
      absolutePathSnapshot: true,
    },
  });

  return files.map((file) => ({
    ...file,
    supplierOfferCount: 0,
    rawProductCount: 0,
    oldPriceHistoryCount: 0,
    newPriceHistoryCount: 0,
    categories: new Map<string, number>(),
    rawStatuses: new Map<string, number>(),
  }));
}

async function loadReferences(staleIds: string[]) {
  const [supplierOffers, rawProducts, oldPriceHistories, newPriceHistories] = await Promise.all([
    prisma.supplierOffer.findMany({
      where: { sourceFileId: { in: staleIds } },
      select: {
        sourceFileId: true,
        product: { select: { category: true } },
      },
    }),
    prisma.rawProduct.findMany({
      where: { sourceFileId: { in: staleIds } },
      select: {
        sourceFileId: true,
        rawStatus: true,
      },
    }),
    prisma.priceHistory.findMany({
      where: { oldSourceFileId: { in: staleIds } },
      select: { oldSourceFileId: true },
    }),
    prisma.priceHistory.findMany({
      where: { newSourceFileId: { in: staleIds } },
      select: { newSourceFileId: true },
    }),
  ]);

  const supplierOfferCounts = new Map<string, number>();
  const categoriesByFile = new Map<string, Map<string, number>>();
  for (const offer of supplierOffers) {
    if (!offer.sourceFileId) continue;
    increment(supplierOfferCounts, offer.sourceFileId);
    const categories = categoriesByFile.get(offer.sourceFileId) ?? new Map<string, number>();
    increment(categories, offer.product.category ?? "(uncategorized)");
    categoriesByFile.set(offer.sourceFileId, categories);
  }

  const rawProductCounts = new Map<string, number>();
  const rawStatusesByFile = new Map<string, Map<string, number>>();
  for (const raw of rawProducts) {
    increment(rawProductCounts, raw.sourceFileId);
    const statuses = rawStatusesByFile.get(raw.sourceFileId) ?? new Map<string, number>();
    increment(statuses, raw.rawStatus);
    rawStatusesByFile.set(raw.sourceFileId, statuses);
  }

  const oldPriceHistoryCounts = new Map<string, number>();
  for (const history of oldPriceHistories) {
    if (history.oldSourceFileId) increment(oldPriceHistoryCounts, history.oldSourceFileId);
  }

  const newPriceHistoryCounts = new Map<string, number>();
  for (const history of newPriceHistories) {
    if (history.newSourceFileId) increment(newPriceHistoryCounts, history.newSourceFileId);
  }

  return {
    supplierOfferCounts,
    rawProductCounts,
    oldPriceHistoryCounts,
    newPriceHistoryCounts,
    categoriesByFile,
    rawStatusesByFile,
  };
}

function buildReport(input: {
  generatedAt: Date;
  backupPath: string;
  baseline: Awaited<ReturnType<typeof getBaseline>>;
  staleRows: CsvRow[];
  candidateRows: CsvRow[];
  staleIds: string[];
  missingIds: string[];
  staleFiles: StaleFile[];
}) {
  const supplierFiles = input.staleFiles.filter((file) => file.supplierOfferCount > 0);
  const rawFiles = input.staleFiles.filter((file) => file.rawProductCount > 0);
  const priceHistoryFiles = input.staleFiles.filter((file) => file.oldPriceHistoryCount > 0 || file.newPriceHistoryCount > 0);
  const unreferencedFiles = input.staleFiles.filter(
    (file) =>
      file.supplierOfferCount === 0 &&
      file.rawProductCount === 0 &&
      file.oldPriceHistoryCount === 0 &&
      file.newPriceHistoryCount === 0,
  );
  const supplierOfferRefs = sum(supplierFiles.map((file) => file.supplierOfferCount));
  const rawProductRefs = sum(rawFiles.map((file) => file.rawProductCount));
  const oldPriceHistoryRefs = sum(priceHistoryFiles.map((file) => file.oldPriceHistoryCount));
  const newPriceHistoryRefs = sum(priceHistoryFiles.map((file) => file.newPriceHistoryCount));
  const totalPriceHistoryRefs = oldPriceHistoryRefs + newPriceHistoryRefs;
  const expectedFilesAfter = input.baseline.totalFiles - input.staleIds.length;
  const expectedMyPassportAfter = input.baseline.myPassportFiles - input.staleIds.length;
  const expectedOffersWithSourceAfter = input.baseline.offersWithSourceFile - supplierOfferRefs;

  const lines: string[] = [];
  lines.push("# Stale Files Cleanup Dry-Run Report");
  lines.push("");
  lines.push(`Generated: ${input.generatedAt.toISOString()}`);
  lines.push(`Backup: \`${input.backupPath}\``);
  lines.push("");
  lines.push("## Scope");
  lines.push("");
  lines.push("- Source list: `docs/drive-db-diff-details.csv`");
  lines.push("- Included: `status = db-file-missing-no-match` only");
  lines.push("- Excluded: `status = db-path-missing-candidate-on-disk`");
  lines.push("- Dry-run only: no database rows were updated or deleted.");
  lines.push("");

  lines.push("## Step 0 — Baseline");
  lines.push("");
  lines.push("| Metric | Count |");
  lines.push("|---|---:|");
  lines.push(`| files total | ${input.baseline.totalFiles} |`);
  lines.push(`| files on My Passport | ${input.baseline.myPassportFiles} |`);
  lines.push(`| supplier_offers | ${input.baseline.supplierOffers} |`);
  lines.push(`| supplier_offers with source_file_id | ${input.baseline.offersWithSourceFile} |`);
  lines.push(`| raw_products | ${input.baseline.rawProducts} |`);
  lines.push(`| products | ${input.baseline.products} |`);
  lines.push(`| product_params | ${input.baseline.productParams} |`);
  lines.push(`| price_history | ${input.baseline.priceHistory} |`);
  lines.push("");

  lines.push("## Step 1 — Stale File Identification");
  lines.push("");
  lines.push("| Check | Count |");
  lines.push("|---|---:|");
  lines.push(`| CSV rows with db-file-missing-no-match | ${input.staleRows.length} |`);
  lines.push(`| Unique stale file IDs from CSV | ${input.staleIds.length} |`);
  lines.push(`| Stale file IDs found in DB | ${input.staleFiles.length} |`);
  lines.push(`| Stale file IDs missing from DB | ${input.missingIds.length} |`);
  lines.push(`| Candidate-on-disk rows excluded | ${input.candidateRows.length} |`);
  lines.push("");
  if (input.missingIds.length > 0) {
    lines.push("Missing IDs from DB:");
    for (const id of input.missingIds) {
      lines.push(`- ${id}`);
    }
    lines.push("");
  }

  lines.push("## Step 2 — Reference Summary");
  lines.push("");
  lines.push("| Reference | Files | Rows |");
  lines.push("|---|---:|---:|");
  lines.push(`| supplier_offers.source_file_id | ${supplierFiles.length} | ${supplierOfferRefs} |`);
  lines.push(`| raw_products.source_file_id | ${rawFiles.length} | ${rawProductRefs} |`);
  lines.push(`| price_history.old_source_file_id | ${priceHistoryFiles.filter((file) => file.oldPriceHistoryCount > 0).length} | ${oldPriceHistoryRefs} |`);
  lines.push(`| price_history.new_source_file_id | ${priceHistoryFiles.filter((file) => file.newPriceHistoryCount > 0).length} | ${newPriceHistoryRefs} |`);
  lines.push(`| no references | ${unreferencedFiles.length} | ${unreferencedFiles.length} files |`);
  lines.push("");

  lines.push("## 3.1 Operation Plan");
  lines.push("");
  lines.push("| Operation | Records | Notes |");
  lines.push("|---|---:|---|");
  lines.push(`| raw_products.source_file_id needs handling | ${rawProductRefs} | FK is required/Restrict; must choose handling before deleting files. |`);
  lines.push(`| supplier_offers.source_file_id -> NULL | ${supplierOfferRefs} | Preserve offers and products; clear stale source link. |`);
  lines.push(`| price_history old/new source refs -> NULL | ${totalPriceHistoryRefs} | No rows currently affected if 0. |`);
  lines.push(`| files records delete | ${input.staleIds.length} | Delete stale records after references are handled. |`);
  lines.push(`| not processed (candidate-on-disk) | ${input.candidateRows.length} | Generic names / ambiguous candidates; leave untouched. |`);
  lines.push("");

  lines.push("## 3.2 Affected supplier_offers");
  lines.push("");
  if (supplierFiles.length === 0) {
    lines.push("None.");
  } else {
    lines.push("| File | Offers | Categories | DB Path |");
    lines.push("|---|---:|---|---|");
    for (const file of supplierFiles.sort((a, b) => b.supplierOfferCount - a.supplierOfferCount)) {
      lines.push(
        `| ${md(file.fileName)} | ${file.supplierOfferCount} | ${md(formatCountMap(file.categories))} | ${md(file.absolutePathSnapshot)} |`,
      );
    }
  }
  lines.push("");

  lines.push("## 3.3 raw_products Handling");
  lines.push("");
  if (rawFiles.length === 0) {
    lines.push("No `raw_products` reference the 258 stale files. No raw_products handling is required before deleting these file records.");
  } else {
    lines.push(`Found ${rawFiles.length} file(s) with ${rawProductRefs} raw_products rows.`);
    lines.push("");
    lines.push("| File | Raw rows | Raw statuses | DB Path |");
    lines.push("|---|---:|---|---|");
    for (const file of rawFiles.sort((a, b) => b.rawProductCount - a.rawProductCount)) {
      lines.push(
        `| ${md(file.fileName)} | ${file.rawProductCount} | ${md(formatCountMap(file.rawStatuses))} | ${md(file.absolutePathSnapshot)} |`,
      );
    }
    lines.push("");
    lines.push("Recommended options for user confirmation:");
    lines.push("- Option A: create/reuse a placeholder file record like `[stale-source]` and point raw_products there.");
    lines.push("- Option B: delete those raw_products if they are only intermediate import rows.");
  }
  lines.push("");

  lines.push("## 3.4 price_history Handling");
  lines.push("");
  if (priceHistoryFiles.length === 0) {
    lines.push("No `price_history` rows reference the 258 stale files.");
  } else {
    lines.push("| File | old refs | new refs | DB Path |");
    lines.push("|---|---:|---:|---|");
    for (const file of priceHistoryFiles) {
      lines.push(`| ${md(file.fileName)} | ${file.oldPriceHistoryCount} | ${file.newPriceHistoryCount} | ${md(file.absolutePathSnapshot)} |`);
    }
  }
  lines.push("");

  lines.push("## 3.5 Verification Expectations For Apply");
  lines.push("");
  lines.push("| Check | Before | After expected |");
  lines.push("|---|---:|---:|");
  lines.push(`| files (My Passport) | ${input.baseline.myPassportFiles} | ${expectedMyPassportAfter} |`);
  lines.push(`| files (total) | ${input.baseline.totalFiles} | ${expectedFilesAfter} |`);
  lines.push(`| supplier_offers | ${input.baseline.supplierOffers} | ${input.baseline.supplierOffers} |`);
  lines.push(`| products | ${input.baseline.products} | ${input.baseline.products} |`);
  lines.push(`| offers with source_file_id | ${input.baseline.offersWithSourceFile} | ${expectedOffersWithSourceAfter} |`);
  lines.push(`| raw_products | ${input.baseline.rawProducts} | ${input.baseline.rawProducts} if no raw rows affected; otherwise depends on chosen option |`);
  lines.push(`| product_params | ${input.baseline.productParams} | ${input.baseline.productParams} |`);
  lines.push(`| price_history | ${input.baseline.priceHistory} | ${input.baseline.priceHistory} |`);
  lines.push("");

  lines.push("## Full stale file type summary");
  lines.push("");
  lines.push("| File type | Count |");
  lines.push("|---|---:|");
  for (const [fileType, count] of countBy(input.staleFiles, (file) => file.fileType)) {
    lines.push(`| ${fileType} | ${count} |`);
  }
  lines.push("");

  lines.push("## Stop Point");
  lines.push("");
  lines.push("STOP. Review this dry-run report before applying cleanup.");
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
    .map((dataRow) =>
      Object.fromEntries(header.map((key, index) => [key, dataRow[index] ?? ""])),
    );
}

function unique(values: string[]) {
  return Array.from(new Set(values));
}

function increment(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function countBy<T>(items: T[], keyFn: (item: T) => string) {
  const counts = new Map<string, number>();
  for (const item of items) {
    increment(counts, keyFn(item));
  }
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function formatCountMap(map: Map<string, number>) {
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key, count]) => `${key}: ${count}`)
    .join("; ");
}

function md(value: string) {
  return value.replace(/\|/g, "\\|").replace(/\n/g, "<br>");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
