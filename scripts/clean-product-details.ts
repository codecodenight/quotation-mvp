/* eslint-disable @typescript-eslint/no-require-imports */
{
const fs = require("node:fs/promises") as typeof import("node:fs/promises");
const { PrismaClient } = require("@prisma/client") as typeof import("@prisma/client");

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");
const reportPath = "docs/v2.2-product-details-cleanup-report.md";

type ProductDetailsIssue = "special-character" | "dirty-pattern" | "too-short" | "empty-with-size";

type ProductRow = {
  id: string;
  modelNo: string | null;
  productName: string;
  remark: string | null;
  size: string | null;
};

type Candidate = ProductRow & {
  issues: ProductDetailsIssue[];
  cleanedRemark: string | null;
  changed: boolean;
};

const issueLabels: Record<ProductDetailsIssue, string> = {
  "special-character": "特殊字符",
  "dirty-pattern": "明确乱码模式",
  "too-short": "Product Details 过短",
  "empty-with-size": "remark 空但 size 有值",
};

async function main() {
  const rows = await prisma.product.findMany({
    where: {
      OR: [
        { remark: { contains: "¢" } },
        { remark: { contains: "©" } },
        { remark: { contains: "®" } },
        { remark: { contains: "â" } },
        { remark: { contains: "Ã" } },
        { remark: { contains: "Â" } },
        { remark: "" },
        { remark: null },
      ],
    },
    select: {
      id: true,
      modelNo: true,
      productName: true,
      remark: true,
      size: true,
    },
    orderBy: [{ updatedAt: "desc" }],
    take: 2000,
  });

  const candidates = rows
    .map(buildCandidate)
    .filter((candidate) => candidate.issues.length > 0);

  if (apply) {
    for (const candidate of candidates.filter((item) => item.changed)) {
      await prisma.product.update({
        where: { id: candidate.id },
        data: { remark: candidate.cleanedRemark },
      });
    }
  }

  await fs.writeFile(reportPath, renderReport(candidates), "utf8");
  console.log(
    JSON.stringify(
      {
        mode: apply ? "apply" : "report",
        candidates: candidates.length,
        changed: candidates.filter((candidate) => candidate.changed).length,
        report: reportPath,
      },
      null,
      2,
    ),
  );
}

function buildCandidate(row: ProductRow): Candidate {
  const issues = classifyProductDetailsIssue(row);
  const cleanedRemark = cleanProductDetailsText(row.remark, row.size);
  return {
    ...row,
    issues,
    cleanedRemark,
    changed: normalizeNullable(row.remark) !== normalizeNullable(cleanedRemark),
  };
}

function classifyProductDetailsIssue(candidate: Pick<ProductRow, "remark" | "size">): ProductDetailsIssue[] {
  const remark = candidate.remark ?? "";
  const issues: ProductDetailsIssue[] = [];

  if (/[¢©®âÃ]/i.test(remark)) {
    issues.push("special-character");
  }
  if (/[¢Â]/.test(remark)) {
    issues.push("dirty-pattern");
  }
  if (remark.length > 0 && remark.length < 5) {
    issues.push("too-short");
  }
  if (remark.trim().length === 0 && candidate.size?.trim()) {
    issues.push("empty-with-size");
  }

  return issues;
}

function cleanProductDetailsText(remark: string | null, size?: string | null): string | null {
  const raw = remark ?? "";
  if (raw.trim().length === 0) {
    return size?.trim() || null;
  }

  return raw
    .replace(/Â+/g, "")
    .replace(/¢(?=\d)/g, "φ")
    .trim();
}

function renderReport(candidates: Candidate[]): string {
  const changed = candidates.filter((candidate) => candidate.changed);
  const lines = [
    "# V2.2 Product Details Cleanup Report",
    "",
    `Mode: ${apply ? "apply" : "report-only"}`,
    `Generated at: ${new Date().toISOString()}`,
    "",
    "## Summary",
    "",
    `- Candidates: ${candidates.length}`,
    `- Would change / changed: ${changed.length}`,
    "",
    "## Issue Counts",
    "",
    "| Issue | Count |",
    "|---|---:|",
  ];

  for (const issue of Object.keys(issueLabels) as ProductDetailsIssue[]) {
    lines.push(`| ${issueLabels[issue]} | ${candidates.filter((candidate) => candidate.issues.includes(issue)).length} |`);
  }

  lines.push("", "## Candidates", "");
  lines.push("| # | model_no | product_name | issues | current remark | cleaned remark | changed |");
  lines.push("|---:|---|---|---|---|---|---|");

  candidates.slice(0, 300).forEach((candidate, index) => {
    lines.push(
      [
        `| ${index + 1}`,
        md(candidate.modelNo ?? "-"),
        md(candidate.productName),
        md(candidate.issues.map((issue) => issueLabels[issue]).join(", ")),
        md(candidate.remark ?? ""),
        md(candidate.cleanedRemark ?? ""),
        candidate.changed ? "yes" : "no",
      ].join(" | ") + " |",
    );
  });

  if (candidates.length > 300) {
    lines.push("", `Only first 300 candidates are listed. Total candidates: ${candidates.length}.`);
  }

  if (!apply) {
    lines.push("", "No database rows were changed. Run with `--apply` only after review.");
  }

  return lines.join("\n");
}

function normalizeNullable(value: string | null): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
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
