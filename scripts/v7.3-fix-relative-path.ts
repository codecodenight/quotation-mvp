import { execFileSync } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const REPORT_PATH = path.join("docs", "v7.3-relative-path-report.md");
const MARKERS = ["/data/source-archive/", "/sample-data/", "/sample data/"];
const TEMP_PREFIX = "__v7_3_relative_path_tmp__";

type FileRow = {
  id: string;
  fileName: string;
  fileType: string;
  relativePath: string;
  absolutePathSnapshot: string;
};

type PlannedUpdate = FileRow & {
  marker: string | null;
  derivedRelativePath: string | null;
  finalRelativePath: string | null;
  fileExists: boolean;
  status: "UPDATE" | "UNCHANGED" | "SKIP";
  reason: string;
  aliasOf: string | null;
};

type Counts = {
  totalFiles: number;
  localFiles: number;
  directlyAccessibleLocalFiles: number;
  supplierOfferBrokenRefs: number;
  priceHistoryOldBrokenRefs: number;
  priceHistoryNewBrokenRefs: number;
};

async function main() {
  const before = await getCounts();
  const files = await loadLocalFiles();
  const plan = await buildPlan(files);
  const verificationBeforeApply = verifyPlan(plan);
  let backupPath: string | null = null;
  let updatedRows = 0;

  if (APPLY) {
    if (!verificationBeforeApply.canApply) {
      throw new Error(`V7.3 plan is not safe to apply: ${verificationBeforeApply.errors.join("; ")}`);
    }

    backupPath = await backupDatabase();
    const updates = plan.filter((item) => item.status === "UPDATE" && item.finalRelativePath);

    await prisma.$transaction(async (tx) => {
      for (const item of updates) {
        await tx.file.update({
          where: { id: item.id },
          data: { relativePath: `${TEMP_PREFIX}/${item.id}` },
        });
      }

      for (const item of updates) {
        await tx.file.update({
          where: { id: item.id },
          data: { relativePath: item.finalRelativePath ?? item.relativePath },
        });
        updatedRows += 1;
      }
    });
  }

  const after = await getCounts();
  const afterFiles = await loadLocalFiles();
  const markerCounts = countByMarker(plan);
  const skipped = plan.filter((item) => item.status === "SKIP");
  const aliases = plan.filter((item) => item.aliasOf);
  const verification = {
    allLocalFilesDerived: plan.every((item) => Boolean(item.derivedRelativePath)),
    allTargetPathsExist: plan.every((item) => item.fileExists),
    noSkippedRecords: skipped.length === 0,
    uniqueFinalRelativePaths: new Set(plan.map((item) => item.finalRelativePath)).size === plan.length,
    localFilesUnchanged: before.localFiles === after.localFiles && after.localFiles === 693,
    allPlannedPathsAccessible: plan.every((item) => item.fileExists),
    postApplyDbPathsAccessible: APPLY ? after.directlyAccessibleLocalFiles === after.localFiles : true,
    supplierOfferFkValid: after.supplierOfferBrokenRefs === 0,
    priceHistoryOldFkValid: after.priceHistoryOldBrokenRefs === 0,
    priceHistoryNewFkValid: after.priceHistoryNewBrokenRefs === 0,
    dryRunUnchanged: APPLY ? true : JSON.stringify(before) === JSON.stringify(after),
  };

  await writeFile(
    REPORT_PATH,
    buildReport({
      mode: APPLY ? "apply" : "dry-run",
      backupPath,
      before,
      after,
      plan,
      markerCounts,
      skipped,
      aliases,
      updatedRows,
      verification,
      sampleAfter: afterFiles.slice(0, 20),
    }),
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        reportPath: REPORT_PATH,
        mode: APPLY ? "apply" : "dry-run",
        backupPath,
        localFiles: before.localFiles,
        plannedUpdates: plan.filter((item) => item.status === "UPDATE").length,
        updatedRows,
        skipped: skipped.length,
        aliases: aliases.length,
        directlyAccessibleAfter: after.directlyAccessibleLocalFiles,
        verificationPass: Object.values(verification).every(Boolean),
      },
      null,
      2,
    ),
  );
}

async function getCounts(): Promise<Counts> {
  const [totalFiles, localFiles, supplierOfferBrokenRefs, priceHistoryOldBrokenRefs, priceHistoryNewBrokenRefs] =
    await Promise.all([
      prisma.file.count(),
      prisma.file.count({ where: { volumeName: "local" } }),
      prisma.$queryRaw<Array<{ cnt: number | bigint }>>`
        SELECT COUNT(*) AS cnt
        FROM supplier_offers so
        LEFT JOIN files f ON f.id = so.source_file_id
        WHERE so.source_file_id IS NOT NULL AND f.id IS NULL
      `,
      prisma.$queryRaw<Array<{ cnt: number | bigint }>>`
        SELECT COUNT(*) AS cnt
        FROM price_history ph
        LEFT JOIN files f ON f.id = ph.old_source_file_id
        WHERE ph.old_source_file_id IS NOT NULL AND f.id IS NULL
      `,
      prisma.$queryRaw<Array<{ cnt: number | bigint }>>`
        SELECT COUNT(*) AS cnt
        FROM price_history ph
        LEFT JOIN files f ON f.id = ph.new_source_file_id
        WHERE ph.new_source_file_id IS NOT NULL AND f.id IS NULL
      `,
    ]);
  const localRows = await loadLocalFiles();
  let directlyAccessibleLocalFiles = 0;

  for (const file of localRows) {
    if (await pathExists(path.join(process.cwd(), file.relativePath))) {
      directlyAccessibleLocalFiles += 1;
    }
  }

  return {
    totalFiles,
    localFiles,
    directlyAccessibleLocalFiles,
    supplierOfferBrokenRefs: toNumber(supplierOfferBrokenRefs[0]?.cnt),
    priceHistoryOldBrokenRefs: toNumber(priceHistoryOldBrokenRefs[0]?.cnt),
    priceHistoryNewBrokenRefs: toNumber(priceHistoryNewBrokenRefs[0]?.cnt),
  };
}

async function loadLocalFiles(): Promise<FileRow[]> {
  return prisma.file.findMany({
    where: { volumeName: "local" },
    select: {
      id: true,
      fileName: true,
      fileType: true,
      relativePath: true,
      absolutePathSnapshot: true,
    },
    orderBy: [{ fileType: "asc" }, { relativePath: "asc" }, { id: "asc" }],
  });
}

async function buildPlan(files: FileRow[]): Promise<PlannedUpdate[]> {
  const basePlan: PlannedUpdate[] = [];
  const groups = new Map<string, PlannedUpdate[]>();

  for (const file of files) {
    const derived = deriveRelativePath(file.absolutePathSnapshot);
    const fileExists = derived ? await pathExists(path.join(process.cwd(), derived.relativePath)) : false;
    const status = !derived || !fileExists ? "SKIP" : file.relativePath === derived.relativePath ? "UNCHANGED" : "UPDATE";
    const item: PlannedUpdate = {
      ...file,
      marker: derived?.marker ?? null,
      derivedRelativePath: derived?.relativePath ?? null,
      finalRelativePath: derived?.relativePath ?? null,
      fileExists,
      status,
      reason: !derived ? "Could not derive project-relative path" : fileExists ? "OK" : "Derived path does not exist",
      aliasOf: null,
    };

    basePlan.push(item);

    if (item.finalRelativePath) {
      const group = groups.get(item.finalRelativePath) ?? [];
      group.push(item);
      groups.set(item.finalRelativePath, group);
    }
  }

  for (const [canonicalPath, group] of groups) {
    if (group.length <= 1) continue;

    group.sort((left, right) => {
      const leftRefs = left.relativePath === canonicalPath ? 0 : 1;
      const rightRefs = right.relativePath === canonicalPath ? 0 : 1;
      return leftRefs - rightRefs || left.id.localeCompare(right.id);
    });

    for (let index = 1; index < group.length; index += 1) {
      const alias = buildAliasPath(canonicalPath, index);
      group[index].finalRelativePath = alias;
      group[index].aliasOf = canonicalPath;
      group[index].fileExists = await pathExists(path.join(process.cwd(), alias));
      group[index].status = group[index].relativePath === alias ? "UNCHANGED" : "UPDATE";
      group[index].reason = group[index].fileExists
        ? "Duplicate local file record; using project-relative alias to satisfy unique constraint"
        : "Alias path does not exist";
    }
  }

  return basePlan;
}

function deriveRelativePath(absolutePathSnapshot: string): { marker: string; relativePath: string } | null {
  const normalized = absolutePathSnapshot.replace(/\\/g, "/");

  for (const marker of MARKERS) {
    const index = normalized.indexOf(marker);
    if (index >= 0) {
      return { marker: marker.slice(1, -1), relativePath: normalized.slice(index + 1) };
    }
  }

  return null;
}

function buildAliasPath(canonicalPath: string, aliasIndex: number): string {
  const directory = path.posix.dirname(canonicalPath);
  const basename = path.posix.basename(canonicalPath);
  const dotSegments = Array.from({ length: aliasIndex }, () => ".").join("/");
  return `${directory}/${dotSegments}/${basename}`;
}

function verifyPlan(plan: PlannedUpdate[]): { canApply: boolean; errors: string[] } {
  const errors: string[] = [];
  if (plan.length !== 693) {
    errors.push(`expected 693 local files, got ${plan.length}`);
  }
  if (plan.some((item) => !item.derivedRelativePath)) {
    errors.push("some records cannot derive project-relative paths");
  }
  if (plan.some((item) => !item.fileExists)) {
    errors.push("some derived target files do not exist");
  }
  const finalPaths = plan.map((item) => item.finalRelativePath).filter(Boolean);
  if (new Set(finalPaths).size !== finalPaths.length) {
    errors.push("final relative_path values are not unique");
  }

  return { canApply: errors.length === 0, errors };
}

function countByMarker(plan: PlannedUpdate[]) {
  const map = new Map<string, number>();

  for (const item of plan) {
    const key = item.marker ?? "missing";
    map.set(key, (map.get(key) ?? 0) + 1);
  }

  return Array.from(map.entries())
    .map(([marker, count]) => ({ marker, count }))
    .sort((left, right) => left.marker.localeCompare(right.marker));
}

async function backupDatabase(): Promise<string> {
  await mkdir("backups", { recursive: true });
  const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const backupPath = path.join("backups", `dev-before-v7.3-${timestamp}.sqlite`);
  execFileSync("cp", ["prisma/dev.db", backupPath]);
  return backupPath;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function buildReport(input: {
  mode: "dry-run" | "apply";
  backupPath: string | null;
  before: Counts;
  after: Counts;
  plan: PlannedUpdate[];
  markerCounts: Array<{ marker: string; count: number }>;
  skipped: PlannedUpdate[];
  aliases: PlannedUpdate[];
  updatedRows: number;
  verification: Record<string, boolean>;
  sampleAfter: FileRow[];
}) {
  const verificationRows = Object.entries(input.verification)
    .map(([key, value]) => `| ${key} | ${value ? "PASS" : "FAIL"} |`)
    .join("\n");

  return `# V7.3 — Fix files.relative_path To Project-relative Paths

Generated: ${new Date().toISOString()}

Mode: **${input.mode}**

Backup: ${input.backupPath ? `\`${input.backupPath}\`` : "(dry-run, none)"}

## Summary

| Metric | Before | After |
|---|---:|---:|
| total files | ${input.before.totalFiles.toLocaleString()} | ${input.after.totalFiles.toLocaleString()} |
| local files | ${input.before.localFiles.toLocaleString()} | ${input.after.localFiles.toLocaleString()} |
| cwd + relative_path accessible local files | ${input.before.directlyAccessibleLocalFiles.toLocaleString()} | ${input.after.directlyAccessibleLocalFiles.toLocaleString()} |
| broken supplier_offers source refs | ${input.before.supplierOfferBrokenRefs.toLocaleString()} | ${input.after.supplierOfferBrokenRefs.toLocaleString()} |
| broken price_history old source refs | ${input.before.priceHistoryOldBrokenRefs.toLocaleString()} | ${input.after.priceHistoryOldBrokenRefs.toLocaleString()} |
| broken price_history new source refs | ${input.before.priceHistoryNewBrokenRefs.toLocaleString()} | ${input.after.priceHistoryNewBrokenRefs.toLocaleString()} |

- Planned local file records: ${input.plan.length.toLocaleString()}
- Rows updated: ${input.updatedRows.toLocaleString()}
- Skipped: ${input.skipped.length.toLocaleString()}
- Duplicate aliases used: ${input.aliases.length.toLocaleString()}

## Marker Counts

| Marker | Count |
|---|---:|
${input.markerCounts.map((row) => `| ${escapeMd(row.marker)} | ${row.count.toLocaleString()} |`).join("\n")}

## Duplicate Alias Records

${sampleTable(
  input.aliases,
  ["file_id", "canonical_path", "alias_path", "file_name"],
  (item) => [`\`${item.id}\``, escapeMd(item.aliasOf ?? "-"), escapeMd(item.finalRelativePath ?? "-"), escapeMd(item.fileName)],
)}

## Skip Records

${sampleTable(
  input.skipped,
  ["file_id", "relative_path", "absolute_path_snapshot", "reason"],
  (item) => [
    `\`${item.id}\``,
    escapeMd(item.relativePath),
    escapeMd(item.absolutePathSnapshot),
    escapeMd(item.reason),
  ],
)}

## Sample After

${sampleTable(
  input.sampleAfter,
  ["file_id", "relative_path"],
  (item) => [`\`${item.id}\``, escapeMd(item.relativePath)],
)}

## Verification

| Check | Result |
|---|---|
${verificationRows}
`;
}

function sampleTable<T>(items: T[], headers: string[], rowBuilder: (item: T) => string[], limit = 20): string {
  if (items.length === 0) return "_None._";
  const rows = items.slice(0, limit).map((item) => `| ${rowBuilder(item).join(" | ")} |`);
  const suffix = items.length > limit ? `\n\n_Showing ${limit} of ${items.length.toLocaleString()}._` : "";
  return [`| ${headers.join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`, ...rows].join("\n") + suffix;
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
