/* eslint-disable @typescript-eslint/no-require-imports */
{
const fs = require("node:fs/promises") as typeof import("node:fs/promises");
const { PrismaClient } = require("@prisma/client") as typeof import("@prisma/client");

const prisma = new PrismaClient();
const reportPath = "docs/v2.3-product-identifier-audit.md";

type ProductRow = {
  id: string;
  category: string | null;
  modelNo: string | null;
  productName: string;
  remark: string | null;
  size: string | null;
};

type IdentifierIssue = "missing-model-no" | "numeric-model-no" | "temporary-wall-model";

type AuditRow = ProductRow & {
  issues: IdentifierIssue[];
  suggestedLabel: string;
};

const issueLabels: Record<IdentifierIssue, string> = {
  "missing-model-no": "缺款号",
  "numeric-model-no": "纯数字款号",
  "temporary-wall-model": "壁灯临时款号",
};

async function main() {
  const products = await prisma.product.findMany({
    select: {
      id: true,
      category: true,
      modelNo: true,
      productName: true,
      remark: true,
      size: true,
    },
    orderBy: [{ category: "asc" }, { modelNo: "asc" }],
  });
  const auditRows = products.map(buildAuditRow).filter((row) => row.issues.length > 0);

  await fs.writeFile(reportPath, renderReport(auditRows), "utf8");
  console.log(
    JSON.stringify(
      {
        candidates: auditRows.length,
        report: reportPath,
        issueCounts: countIssues(auditRows),
      },
      null,
      2,
    ),
  );
}

function buildAuditRow(product: ProductRow): AuditRow {
  const issues: IdentifierIssue[] = [];
  const modelNo = product.modelNo?.trim() ?? "";

  if (!modelNo) {
    issues.push("missing-model-no");
  }
  if (/^\d+$/.test(modelNo)) {
    issues.push("numeric-model-no");
  }
  if (modelNo.startsWith("壁灯-")) {
    issues.push("temporary-wall-model");
  }

  return {
    ...product,
    issues,
    suggestedLabel: buildSuggestedLabel(product),
  };
}

function buildSuggestedLabel(product: ProductRow): string {
  const remark = cleanupLabelSource(product.remark);
  if (remark) {
    return remark;
  }
  const size = cleanupLabelSource(product.size);
  if (size && product.category) {
    return `${product.category} / ${size}`;
  }
  return cleanupLabelSource(product.productName) || "-";
}

function cleanupLabelSource(value: string | null): string {
  if (!value) return "";
  return value
    .replace(/^Description产品描述[:：]?\s*/i, "")
    .replace(/^Product details[:：]?\s*/i, "")
    .replace(/^型号\s*specifications\s*and\s*models[:：]?\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function countIssues(rows: AuditRow[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const issue of Object.keys(issueLabels) as IdentifierIssue[]) {
    counts[issueLabels[issue]] = rows.filter((row) => row.issues.includes(issue)).length;
  }
  return counts;
}

function renderReport(rows: AuditRow[]): string {
  const lines = [
    "# V2.3 Product Identifier Audit",
    "",
    `Generated at: ${new Date().toISOString()}`,
    "",
    "## Summary",
    "",
    `- Candidates: ${rows.length}`,
    "",
    "## Issue Counts",
    "",
    "| Issue | Count |",
    "|---|---:|",
  ];

  for (const [issue, count] of Object.entries(countIssues(rows))) {
    lines.push(`| ${md(issue)} | ${count} |`);
  }

  lines.push("", "## By Category", "", "| Category | Count |", "|---|---:|");
  const categoryCounts = new Map<string, number>();
  for (const row of rows) {
    const category = row.category ?? "(none)";
    categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
  }
  for (const [category, count] of Array.from(categoryCounts.entries()).sort((a, b) => b[1] - a[1])) {
    lines.push(`| ${md(category)} | ${count} |`);
  }

  lines.push("", "## Candidates", "");
  lines.push("| # | category | model_no | product_name | issues | suggested readable label | size |");
  lines.push("|---:|---|---|---|---|---|---|");
  rows.forEach((row, index) => {
    lines.push(
      [
        `| ${index + 1}`,
        md(row.category ?? "-"),
        md(row.modelNo ?? ""),
        md(row.productName),
        md(row.issues.map((issue) => issueLabels[issue]).join(", ")),
        md(row.suggestedLabel),
        md(row.size ?? ""),
      ].join(" | ") + " |",
    );
  });

  lines.push("", "No database rows were changed.");
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
