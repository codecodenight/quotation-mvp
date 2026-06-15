import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const REPORT_PATH = path.join("docs", "v5.4-fix-report.md");

type PlannedUpdate = {
  label: string;
  before: string;
  after: string | null;
  affected: number;
};

type QuoteFileRow = {
  id: number;
  customer_name: string | null;
};

const FIXES: Array<{ label: string; before: string; after: string | null }> = [
  { label: "Restore HTF code", before: "Htf", after: "HTF" },
  { label: "Restore AFT code", before: "Aft", after: "AFT" },
  { label: "Restore AFRATAB code", before: "Afratab", after: "AFRATAB" },
  { label: "Restore HACHIZAI code", before: "Hachizai", after: "HACHIZAI" },
  { label: "Restore DENI code", before: "Deni", after: "DENI" },
  { label: "Clear descriptive pseudo-customer", before: "想要全系列销售的客户", after: null },
];

async function main() {
  const beforeTotal = await countQuoteFiles();
  const beforeRows = await loadQuoteFiles();
  const plannedUpdates = await buildPlannedUpdates();
  let backupPath: string | null = null;

  if (APPLY) {
    backupPath = await backupDatabase();
    await prisma.$transaction(async (tx) => {
      for (const update of plannedUpdates) {
        await tx.$executeRaw`
          UPDATE customer_quote_files
          SET customer_name = ${update.after}
          WHERE customer_name = ${update.before}
        `;
      }
    });
  }

  const afterTotal = await countQuoteFiles();
  const customerList = APPLY ? await getCustomerList() : buildVirtualCustomerList(beforeRows);
  const forbiddenRemaining = APPLY ? await getForbiddenRemaining() : buildVirtualForbiddenRemaining(beforeRows);
  await writeFile(
    REPORT_PATH,
    buildReport({
      mode: APPLY ? "apply" : "dry-run",
      backupPath,
      beforeTotal,
      afterTotal,
      plannedUpdates,
      customerList,
      forbiddenRemaining,
    }),
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        reportPath: REPORT_PATH,
        mode: APPLY ? "apply" : "dry-run",
        backupPath,
        beforeTotal,
        afterTotal,
        totalAffected: plannedUpdates.reduce((sum, update) => sum + update.affected, 0),
        forbiddenRemaining,
      },
      null,
      2,
    ),
  );
}

async function loadQuoteFiles(): Promise<QuoteFileRow[]> {
  return prisma.$queryRaw<QuoteFileRow[]>`
    SELECT id, customer_name
    FROM customer_quote_files
    ORDER BY id
  `;
}

async function buildPlannedUpdates(): Promise<PlannedUpdate[]> {
  const updates: PlannedUpdate[] = [];

  for (const fix of FIXES) {
    const [row] = await prisma.$queryRaw<Array<{ cnt: number | bigint }>>`
      SELECT COUNT(*) AS cnt
      FROM customer_quote_files
      WHERE customer_name = ${fix.before}
    `;

    updates.push({
      label: fix.label,
      before: fix.before,
      after: fix.after,
      affected: toNumber(row.cnt),
    });
  }

  return updates;
}

async function countQuoteFiles(): Promise<number> {
  const [row] = await prisma.$queryRaw<Array<{ cnt: number | bigint }>>`
    SELECT COUNT(*) AS cnt
    FROM customer_quote_files
  `;
  return toNumber(row.cnt);
}

async function getCustomerList(): Promise<Array<{ name: string; count: number }>> {
  const rows = await prisma.$queryRaw<Array<{ customer_name: string; count: number | bigint }>>`
    SELECT customer_name, COUNT(*) AS count
    FROM customer_quote_files
    WHERE customer_name IS NOT NULL AND TRIM(customer_name) <> ''
    GROUP BY customer_name
    ORDER BY customer_name COLLATE NOCASE
  `;

  return rows.map((row) => ({
    name: row.customer_name,
    count: toNumber(row.count),
  }));
}

async function getForbiddenRemaining(): Promise<Array<{ customerName: string; count: number }>> {
  const forbidden = FIXES.map((fix) => fix.before);
  const placeholders = forbidden.map(() => "?").join(", ");
  const rows = await prisma.$queryRawUnsafe<Array<{ customer_name: string; count: number | bigint }>>(
    `SELECT customer_name, COUNT(*) AS count
     FROM customer_quote_files
     WHERE customer_name IN (${placeholders})
     GROUP BY customer_name
     ORDER BY customer_name`,
    ...forbidden,
  );

  return rows.map((row) => ({
    customerName: row.customer_name,
    count: toNumber(row.count),
  }));
}

function buildVirtualCustomerList(rows: QuoteFileRow[]): Array<{ name: string; count: number }> {
  const counts = new Map<string, number>();

  for (const row of rows) {
    const nextName = applyFix(row.customer_name);
    if (!nextName) {
      continue;
    }
    counts.set(nextName, (counts.get(nextName) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN", { sensitivity: "base" }));
}

function buildVirtualForbiddenRemaining(rows: QuoteFileRow[]): Array<{ customerName: string; count: number }> {
  const forbidden = new Set(FIXES.map((fix) => fix.before));
  const counts = new Map<string, number>();

  for (const row of rows) {
    const nextName = applyFix(row.customer_name);
    if (nextName && forbidden.has(nextName)) {
      counts.set(nextName, (counts.get(nextName) ?? 0) + 1);
    }
  }

  return Array.from(counts.entries()).map(([customerName, count]) => ({ customerName, count }));
}

function applyFix(customerName: string | null): string | null {
  const fix = FIXES.find((entry) => entry.before === customerName);
  return fix ? fix.after : customerName;
}

async function backupDatabase(): Promise<string> {
  await mkdir("backups", { recursive: true });
  const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const backupPath = path.join("backups", `dev-before-v5.4-fix-${timestamp}.sqlite`);
  execFileSync("cp", ["prisma/dev.db", backupPath]);
  return backupPath;
}

function buildReport(input: {
  mode: "dry-run" | "apply";
  backupPath: string | null;
  beforeTotal: number;
  afterTotal: number;
  plannedUpdates: PlannedUpdate[];
  customerList: Array<{ name: string; count: number }>;
  forbiddenRemaining: Array<{ customerName: string; count: number }>;
}) {
  return `# V5.4-fix — 客户名大小写修正报告

Generated: ${new Date().toISOString()}

Mode: **${input.mode}**

Backup: ${input.backupPath ? `\`${input.backupPath}\`` : "(dry-run, none)"}

## UPDATE 影响行数

| Change | Before | After | Rows |
|---|---|---|---:|
${input.plannedUpdates
  .map(
    (update) =>
      `| ${escapeMd(update.label)} | ${escapeMd(update.before)} | ${escapeMd(update.after ?? "NULL")} | ${update.affected.toLocaleString()} |`,
  )
  .join("\n")}

Total affected rows: ${input.plannedUpdates.reduce((sum, update) => sum + update.affected, 0).toLocaleString()}

## 修正后的客户名列表

| Customer | Records |
|---|---:|
${input.customerList.map((row) => `| ${escapeMd(row.name)} | ${row.count.toLocaleString()} |`).join("\n")}

## 禁止值残留检查

| Forbidden Value | Remaining |
|---|---:|
${input.forbiddenRemaining.map((row) => `| ${escapeMd(row.customerName)} | ${row.count.toLocaleString()} |`).join("\n") || "| - | 0 |"}

## Verification

- customer_quote_files total unchanged: ${input.beforeTotal === input.afterTotal ? "PASS" : "FAIL"} (${input.beforeTotal} → ${input.afterTotal})
- No forbidden customer names remain: ${input.forbiddenRemaining.length === 0 ? "PASS" : "FAIL"}
- Only customer_name planned for update: PASS
`;
}

function toNumber(value: number | bigint | null | undefined): number {
  if (value == null) {
    return 0;
  }
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
