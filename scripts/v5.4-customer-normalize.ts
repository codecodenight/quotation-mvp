import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const REPORT_PATH = path.join("docs", "v5.4-customer-normalize-report.md");
const APPLY = process.argv.includes("--apply");

type QuoteFileRow = {
  id: number;
  file_name: string;
  customer_name: string | null;
};

type PlannedChange = {
  id: number;
  fileName: string;
  before: string | null;
  after: string;
  reason: "case-normalization" | "filename-extraction";
};

async function main() {
  const beforeStats = await getStats();
  const rows = await loadQuoteFiles();
  const changes = planChanges(rows);
  let backupPath: string | null = null;

  if (APPLY) {
    backupPath = await backupDatabase();
    await prisma.$transaction(async (tx) => {
      for (const change of changes) {
        await tx.$executeRaw`
          UPDATE customer_quote_files
          SET customer_name = ${change.after}
          WHERE id = ${change.id}
        `;
      }
    });
  }

  const afterStats = APPLY ? await getStats() : applyVirtualStats(beforeStats.total, rows, changes);
  const finalCustomerList = APPLY ? await getCustomerList() : buildVirtualCustomerList(rows, changes);
  const report = buildReport({
    mode: APPLY ? "apply" : "dry-run",
    backupPath,
    beforeStats,
    afterStats,
    changes,
    finalCustomerList,
    totalRowsAfter: await getCustomerQuoteFileCount(),
  });

  await writeFile(REPORT_PATH, report, "utf8");

  console.log(
    JSON.stringify(
      {
        reportPath: REPORT_PATH,
        mode: APPLY ? "apply" : "dry-run",
        plannedChanges: changes.length,
        caseNormalizations: changes.filter((change) => change.reason === "case-normalization").length,
        filenameExtractions: changes.filter((change) => change.reason === "filename-extraction").length,
        beforeNamed: beforeStats.named,
        afterNamed: afterStats.named,
        backupPath,
      },
      null,
      2,
    ),
  );
}

async function loadQuoteFiles(): Promise<QuoteFileRow[]> {
  return prisma.$queryRaw<QuoteFileRow[]>`
    SELECT id, file_name, customer_name
    FROM customer_quote_files
    ORDER BY id
  `;
}

async function getStats() {
  const [row] = await prisma.$queryRaw<Array<{ total: number | bigint; named: number | bigint }>>`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN customer_name IS NOT NULL AND TRIM(customer_name) <> '' THEN 1 ELSE 0 END) AS named
    FROM customer_quote_files
  `;

  return {
    total: toNumber(row.total),
    named: toNumber(row.named),
  };
}

async function getCustomerList() {
  const rows = await prisma.$queryRaw<Array<{ customer_name: string; count: number | bigint }>>`
    SELECT customer_name, COUNT(*) AS count
    FROM customer_quote_files
    WHERE customer_name IS NOT NULL AND TRIM(customer_name) <> ''
    GROUP BY customer_name
    ORDER BY customer_name COLLATE NOCASE
  `;

  return rows.map((row) => ({ name: row.customer_name, count: toNumber(row.count) }));
}

async function getCustomerQuoteFileCount(): Promise<number> {
  const [row] = await prisma.$queryRaw<Array<{ cnt: number | bigint }>>`
    SELECT COUNT(*) AS cnt
    FROM customer_quote_files
  `;
  return toNumber(row.cnt);
}

function planChanges(rows: QuoteFileRow[]): PlannedChange[] {
  const changes: PlannedChange[] = [];

  for (const row of rows) {
    const current = normalizeBlank(row.customer_name);
    if (current) {
      const normalized = normalizeCustomerCase(current);
      if (normalized !== current) {
        changes.push({
          id: row.id,
          fileName: row.file_name,
          before: row.customer_name,
          after: normalized,
          reason: "case-normalization",
        });
      }
      continue;
    }

    const extracted = extractCustomerFromFileName(row.file_name);
    if (extracted) {
      changes.push({
        id: row.id,
        fileName: row.file_name,
        before: row.customer_name,
        after: extracted,
        reason: "filename-extraction",
      });
    }
  }

  return dedupeChanges(changes);
}

function normalizeBlank(value: string | null): string | null {
  const normalized = String(value ?? "").normalize("NFC").trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeCustomerCase(value: string): string {
  const trimmed = value.normalize("NFC").trim();
  if (!/[A-Za-z]/.test(trimmed)) {
    return trimmed;
  }

  const letters = trimmed.replace(/[^A-Za-z]/g, "");
  if (letters.length > 0 && letters === letters.toUpperCase()) {
    return trimmed
      .toLowerCase()
      .replace(/\b[a-z]/g, (letter) => letter.toUpperCase())
      .replace(/\b(Usa|Uk|Uae|Led)\b/g, (token) => token.toUpperCase());
  }

  return trimmed;
}

function extractCustomerFromFileName(fileName: string): string | null {
  const normalized = fileName.normalize("NFC");
  const chineseMatch = normalized.match(/给\s*([^\\/\-_\s]+?)\s*客户/i);
  if (chineseMatch?.[1]) {
    return `${chineseMatch[1].trim()}客户`;
  }

  const toMatch = normalized.match(/\bto\s+(.+?)\s*-/i);
  if (toMatch?.[1]) {
    const customer = toMatch[1].replace(/\s+/g, " ").trim();
    return customer ? normalizeCustomerCase(customer) : null;
  }

  return null;
}

function dedupeChanges(changes: PlannedChange[]): PlannedChange[] {
  const seen = new Set<number>();
  const deduped: PlannedChange[] = [];

  for (const change of changes) {
    if (seen.has(change.id)) {
      continue;
    }
    seen.add(change.id);
    deduped.push(change);
  }

  return deduped;
}

function applyVirtualStats(total: number, rows: QuoteFileRow[], changes: PlannedChange[]) {
  const changedById = new Map(changes.map((change) => [change.id, change.after]));
  const named = rows.filter((row) => {
    const value = changedById.get(row.id) ?? row.customer_name;
    return normalizeBlank(value) != null;
  }).length;

  return { total, named };
}

function buildVirtualCustomerList(rows: QuoteFileRow[], changes: PlannedChange[]) {
  const changedById = new Map(changes.map((change) => [change.id, change.after]));
  const counts = new Map<string, number>();

  for (const row of rows) {
    const value = normalizeBlank(changedById.get(row.id) ?? row.customer_name);
    if (!value) {
      continue;
    }
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN", { sensitivity: "base" }));
}

async function backupDatabase(): Promise<string> {
  await mkdir("backups", { recursive: true });
  const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const backupPath = path.join("backups", `dev-before-v5.4-${timestamp}.sqlite`);
  execFileSync("cp", ["prisma/dev.db", backupPath]);
  return backupPath;
}

function buildReport(input: {
  mode: "dry-run" | "apply";
  backupPath: string | null;
  beforeStats: { total: number; named: number };
  afterStats: { total: number; named: number };
  changes: PlannedChange[];
  finalCustomerList: Array<{ name: string; count: number }>;
  totalRowsAfter: number;
}) {
  const caseChanges = input.changes.filter((change) => change.reason === "case-normalization");
  const filenameChanges = input.changes.filter((change) => change.reason === "filename-extraction");

  return `# V5.4 — 客户名规范化报告

Generated: ${new Date().toISOString()}

Mode: **${input.mode}**

Backup: ${input.backupPath ? `\`${input.backupPath}\`` : "(dry-run, none)"}

## 覆盖率

| Metric | Before | After |
|---|---:|---:|
| customer_quote_files total | ${input.beforeStats.total.toLocaleString()} | ${input.totalRowsAfter.toLocaleString()} |
| with customer_name | ${input.beforeStats.named.toLocaleString()} (${formatPercent(input.beforeStats.named, input.beforeStats.total)}) | ${input.afterStats.named.toLocaleString()} (${formatPercent(input.afterStats.named, input.afterStats.total)}) |
| planned / applied changes | - | ${input.changes.length.toLocaleString()} |

## 大小写合并

| ID | Before | After | File |
|---:|---|---|---|
${caseChanges.map((change) => `| ${change.id} | ${escapeMd(change.before ?? "")} | ${escapeMd(change.after)} | ${escapeMd(change.fileName)} |`).join("\n") || "| - | - | - | - |"}

## 从文件名提取

| ID | Extracted Customer | File |
|---:|---|---|
${filenameChanges.map((change) => `| ${change.id} | ${escapeMd(change.after)} | ${escapeMd(change.fileName)} |`).join("\n") || "| - | - | - |"}

## 最终客户名列表

| Customer | Records |
|---|---:|
${input.finalCustomerList.map((row) => `| ${escapeMd(row.name)} | ${row.count.toLocaleString()} |`).join("\n")}

## Verification

- customer_quote_files total unchanged: ${input.beforeStats.total === input.totalRowsAfter ? "PASS" : "FAIL"}
- Only customer_name planned for update: PASS
`;
}

function formatPercent(value: number, total: number): string {
  if (total <= 0) {
    return "0%";
  }
  return `${Math.round((value / total) * 1000) / 10}%`;
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
