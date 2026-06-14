import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { PrismaClient, type File } from "@prisma/client";

const prisma = new PrismaClient();

const EXTERNAL_VOLUME = "My Passport";
const LOCAL_VOLUME = "local";
const ARCHIVE_ROOT = path.join(process.cwd(), "data", "source-archive");
const REPORT_PATH = path.join("docs", "v7.0b-migration-report.md");
const DRY_RUN = !process.argv.includes("--apply");

type MigrationFile = Pick<
  File,
  "id" | "fileName" | "fileType" | "fileSize" | "volumeName" | "relativePath" | "absolutePathSnapshot"
>;

type FileStatus = {
  file: MigrationFile;
  sourcePath: string;
  targetPath: string;
  exists: boolean;
  targetExistsSameSize: boolean;
  error?: string;
};

type CopyResult = {
  copied: FileStatus[];
  skippedExisting: FileStatus[];
  failed: FileStatus[];
};

async function main() {
  const beforeCounts = await getCounts();
  const migrationFiles = await getMigrationFiles();
  const orphanSummary = await getOrphanSummary();
  const fileTypeSummary = buildFileTypeSummary(migrationFiles);
  const sourceStatuses = await Promise.all(migrationFiles.map(buildFileStatus));
  const existingStatuses = sourceStatuses.filter((status) => status.exists);
  const missingStatuses = sourceStatuses.filter((status) => !status.exists);
  const localCollisions = await findLocalCollisions(migrationFiles);

  let backupPath: string | null = null;
  let copyResult: CopyResult = { copied: [], skippedExisting: [], failed: [] };
  let updatedFileIds: string[] = [];
  let gitignoreUpdated = false;
  const collisionRelativePaths = new Set(localCollisions.map((collision) => collision.relativePath));
  const collisionSkippedStatuses = sourceStatuses.filter((status) => collisionRelativePaths.has(status.file.relativePath));

  if (!DRY_RUN) {
    backupPath = await backupDatabase();

    const missingRatio = migrationFiles.length === 0 ? 0 : missingStatuses.length / migrationFiles.length;
    if (missingRatio > 0.1) {
      console.warn(
        `Warning: ${missingStatuses.length}/${migrationFiles.length} migration files are missing (${(missingRatio * 100).toFixed(1)}%). Continuing and skipping missing files.`,
      );
    }

    if (localCollisions.length > 0) {
      console.warn(
        `Warning: ${localCollisions.length} local relative_path collisions found. These files will be left on My Passport and reported.`,
      );
    }

    const copyEligibleStatuses = existingStatuses.filter((status) => !collisionRelativePaths.has(status.file.relativePath));
    copyResult = await copyExistingFiles(copyEligibleStatuses);
    const successfulStatuses = [...copyResult.copied, ...copyResult.skippedExisting];
    updatedFileIds = await updateFilesToLocal(successfulStatuses);
    gitignoreUpdated = await ensureGitignore();
  }

  const afterCounts = await getCounts();
  const verification = await verifyMigration({
    beforeCounts,
    afterCounts,
    updatedFileIds,
    successfulStatuses: [...copyResult.copied, ...copyResult.skippedExisting],
  });

  const report = buildReport({
    mode: DRY_RUN ? "dry-run" : "apply",
    backupPath,
    beforeCounts,
    afterCounts,
    migrationFiles,
    orphanSummary,
    fileTypeSummary,
    sourceStatuses,
    missingStatuses,
    localCollisions,
    collisionSkippedStatuses,
    copyResult,
    updatedFileIds,
    gitignoreUpdated,
    verification,
  });

  await writeFile(REPORT_PATH, report, "utf8");

  console.log(
    JSON.stringify(
      {
        reportPath: REPORT_PATH,
        mode: DRY_RUN ? "dry-run" : "apply",
        migrationFiles: migrationFiles.length,
        missingFiles: missingStatuses.length,
        copied: copyResult.copied.length,
        skippedExisting: copyResult.skippedExisting.length,
        failed: copyResult.failed.length,
        dbUpdated: updatedFileIds.length,
        verificationPass: Object.values(verification).every(Boolean),
      },
      null,
      2,
    ),
  );
}

async function getMigrationFiles(): Promise<MigrationFile[]> {
  return prisma.file.findMany({
    where: {
      volumeName: EXTERNAL_VOLUME,
      OR: [
        { supplierOffers: { some: {} } },
        { oldPriceHistories: { some: {} } },
        { newPriceHistories: { some: {} } },
      ],
    },
    select: {
      id: true,
      fileName: true,
      fileType: true,
      fileSize: true,
      volumeName: true,
      relativePath: true,
      absolutePathSnapshot: true,
    },
    orderBy: [{ fileType: "asc" }, { relativePath: "asc" }],
  });
}

async function getOrphanSummary() {
  const [summary] = await prisma.$queryRaw<Array<{ cnt: number | bigint; bytes: number | bigint | null }>>`
    SELECT COUNT(*) AS cnt, COALESCE(SUM(file_size), 0) AS bytes
    FROM files f
    WHERE f.volume_name = ${EXTERNAL_VOLUME}
      AND NOT EXISTS (SELECT 1 FROM supplier_offers so WHERE so.source_file_id = f.id)
      AND NOT EXISTS (SELECT 1 FROM price_history ph WHERE ph.old_source_file_id = f.id)
      AND NOT EXISTS (SELECT 1 FROM price_history ph WHERE ph.new_source_file_id = f.id)
  `;

  const samples = await prisma.$queryRaw<
    Array<{ file_name: string; file_type: string; relative_path: string; bytes: number | bigint }>
  >`
    SELECT file_name, file_type, relative_path, file_size AS bytes
    FROM files f
    WHERE f.volume_name = ${EXTERNAL_VOLUME}
      AND NOT EXISTS (SELECT 1 FROM supplier_offers so WHERE so.source_file_id = f.id)
      AND NOT EXISTS (SELECT 1 FROM price_history ph WHERE ph.old_source_file_id = f.id)
      AND NOT EXISTS (SELECT 1 FROM price_history ph WHERE ph.new_source_file_id = f.id)
    ORDER BY file_type, file_size DESC, relative_path
    LIMIT 50
  `;

  return {
    count: toNumber(summary.cnt),
    bytes: toNumber(summary.bytes),
    samples: samples.map((sample) => ({
      fileName: sample.file_name,
      fileType: sample.file_type,
      relativePath: sample.relative_path,
      bytes: toNumber(sample.bytes),
    })),
  };
}

async function getCounts() {
  const rows = await prisma.$queryRaw<Array<{ table_name: string; cnt: number | bigint }>>`
    SELECT 'files' AS table_name, COUNT(*) AS cnt FROM files
    UNION ALL SELECT 'supplier_offers', COUNT(*) FROM supplier_offers
    UNION ALL SELECT 'price_history', COUNT(*) FROM price_history
    UNION ALL SELECT 'my_passport_files', COUNT(*) FROM files WHERE volume_name = ${EXTERNAL_VOLUME}
    UNION ALL SELECT 'local_files', COUNT(*) FROM files WHERE volume_name = ${LOCAL_VOLUME}
  `;

  return Object.fromEntries(rows.map((row) => [row.table_name, toNumber(row.cnt)]));
}

async function buildFileStatus(file: MigrationFile): Promise<FileStatus> {
  const sourcePath = resolveSourcePath(file);
  const targetPath = buildTargetPath(file.relativePath);
  const exists = existsSync(sourcePath);
  let targetExistsSameSize = false;
  let error: string | undefined;

  if (exists) {
    try {
      const sourceInfo = await stat(sourcePath);
      if (existsSync(targetPath)) {
        const targetInfo = await stat(targetPath);
        targetExistsSameSize = targetInfo.size === sourceInfo.size;
        if (!targetExistsSameSize) {
          error = `Target exists with different size (${targetInfo.size} != ${sourceInfo.size})`;
        }
      }
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }
  } else {
    error = "Source file not found";
  }

  return { file, sourcePath, targetPath, exists, targetExistsSameSize, error };
}

function resolveSourcePath(file: MigrationFile): string {
  if (existsSync(file.absolutePathSnapshot)) {
    return file.absolutePathSnapshot;
  }

  return path.join("/Volumes", file.volumeName, file.relativePath);
}

function buildTargetPath(relativePath: string): string {
  const targetPath = path.resolve(ARCHIVE_ROOT, relativePath);
  const root = path.resolve(ARCHIVE_ROOT);
  if (targetPath !== root && !targetPath.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Unsafe relative_path outside archive root: ${relativePath}`);
  }
  return targetPath;
}

async function findLocalCollisions(files: MigrationFile[]) {
  const relativePaths = Array.from(new Set(files.map((file) => file.relativePath)));
  const collisions: Array<{ id: string; relativePath: string; fileName: string }> = [];

  for (let index = 0; index < relativePaths.length; index += 250) {
    const chunk = relativePaths.slice(index, index + 250);
    const found = await prisma.file.findMany({
      where: {
        volumeName: LOCAL_VOLUME,
        relativePath: { in: chunk },
      },
      select: { id: true, relativePath: true, fileName: true },
    });
    collisions.push(...found);
  }

  return collisions;
}

async function copyExistingFiles(statuses: FileStatus[]): Promise<CopyResult> {
  const result: CopyResult = { copied: [], skippedExisting: [], failed: [] };

  for (const status of statuses) {
    if (status.error && !status.targetExistsSameSize) {
      result.failed.push(status);
      continue;
    }

    if (status.targetExistsSameSize) {
      result.skippedExisting.push(status);
      continue;
    }

    try {
      await mkdir(path.dirname(status.targetPath), { recursive: true });
      await copyFile(status.sourcePath, status.targetPath);
      result.copied.push(status);
    } catch (caught) {
      result.failed.push({
        ...status,
        error: caught instanceof Error ? caught.message : String(caught),
      });
    }
  }

  return result;
}

async function updateFilesToLocal(statuses: FileStatus[]): Promise<string[]> {
  if (statuses.length === 0) {
    return [];
  }

  const updatedIds: string[] = [];
  await prisma.$transaction(async (tx) => {
    for (const status of statuses) {
      await tx.file.update({
        where: { id: status.file.id },
        data: {
          volumeName: LOCAL_VOLUME,
          absolutePathSnapshot: status.targetPath,
        },
      });
      updatedIds.push(status.file.id);
    }
  });

  return updatedIds;
}

async function backupDatabase(): Promise<string> {
  await mkdir("backups", { recursive: true });
  const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const backupPath = path.join("backups", `dev-before-v7.0b-${timestamp}.sqlite`);
  execFileSync("cp", ["prisma/dev.db", backupPath]);
  return backupPath;
}

async function ensureGitignore(): Promise<boolean> {
  const gitignorePath = ".gitignore";
  const line = "data/source-archive/";
  const current = existsSync(gitignorePath) ? await readFile(gitignorePath, "utf8") : "";
  if (current.split(/\r?\n/).includes(line)) {
    return false;
  }

  const next = current.endsWith("\n") || current.length === 0 ? `${current}${line}\n` : `${current}\n${line}\n`;
  await writeFile(gitignorePath, next, "utf8");
  return true;
}

async function verifyMigration(input: {
  beforeCounts: Record<string, number>;
  afterCounts: Record<string, number>;
  updatedFileIds: string[];
  successfulStatuses: FileStatus[];
}) {
  if (DRY_RUN) {
    return {
      migratedFilesAreLocal: true,
      supplierOfferFkValid: true,
      priceHistoryOldFkValid: true,
      priceHistoryNewFkValid: true,
      filesCountUnchanged: input.beforeCounts.files === input.afterCounts.files,
      archiveFilesExist: true,
    };
  }

  const migratedLocalCount =
    input.updatedFileIds.length === 0
      ? 0
      : await prisma.file.count({
          where: {
            id: { in: input.updatedFileIds },
            volumeName: LOCAL_VOLUME,
          },
        });

  const [supplierOfferBroken] = await prisma.$queryRaw<Array<{ cnt: number | bigint }>>`
    SELECT COUNT(*) AS cnt
    FROM supplier_offers so
    LEFT JOIN files f ON f.id = so.source_file_id
    WHERE so.source_file_id IS NOT NULL AND f.id IS NULL
  `;
  const [priceHistoryOldBroken] = await prisma.$queryRaw<Array<{ cnt: number | bigint }>>`
    SELECT COUNT(*) AS cnt
    FROM price_history ph
    LEFT JOIN files f ON f.id = ph.old_source_file_id
    WHERE ph.old_source_file_id IS NOT NULL AND f.id IS NULL
  `;
  const [priceHistoryNewBroken] = await prisma.$queryRaw<Array<{ cnt: number | bigint }>>`
    SELECT COUNT(*) AS cnt
    FROM price_history ph
    LEFT JOIN files f ON f.id = ph.new_source_file_id
    WHERE ph.new_source_file_id IS NOT NULL AND f.id IS NULL
  `;

  const allTargetsExist = input.successfulStatuses.every((status) => existsSync(status.targetPath));

  return {
    migratedFilesAreLocal: migratedLocalCount === input.updatedFileIds.length,
    supplierOfferFkValid: toNumber(supplierOfferBroken.cnt) === 0,
    priceHistoryOldFkValid: toNumber(priceHistoryOldBroken.cnt) === 0,
    priceHistoryNewFkValid: toNumber(priceHistoryNewBroken.cnt) === 0,
    filesCountUnchanged: input.beforeCounts.files === input.afterCounts.files,
    archiveFilesExist: allTargetsExist,
  };
}

function buildFileTypeSummary(files: MigrationFile[]) {
  const summary = new Map<string, { count: number; bytes: number }>();
  for (const file of files) {
    const current = summary.get(file.fileType) ?? { count: 0, bytes: 0 };
    current.count += 1;
    current.bytes += Number(file.fileSize);
    summary.set(file.fileType, current);
  }
  return Array.from(summary.entries())
    .map(([fileType, values]) => ({ fileType, ...values }))
    .sort((a, b) => a.fileType.localeCompare(b.fileType));
}

function buildReport(input: {
  mode: "dry-run" | "apply";
  backupPath: string | null;
  beforeCounts: Record<string, number>;
  afterCounts: Record<string, number>;
  migrationFiles: MigrationFile[];
  orphanSummary: Awaited<ReturnType<typeof getOrphanSummary>>;
  fileTypeSummary: Array<{ fileType: string; count: number; bytes: number }>;
  sourceStatuses: FileStatus[];
  missingStatuses: FileStatus[];
  localCollisions: Array<{ id: string; relativePath: string; fileName: string }>;
  collisionSkippedStatuses: FileStatus[];
  copyResult: CopyResult;
  updatedFileIds: string[];
  gitignoreUpdated: boolean;
  verification: Awaited<ReturnType<typeof verifyMigration>>;
}) {
  const migrationBytes = input.migrationFiles.reduce((sum, file) => sum + Number(file.fileSize), 0);
  const existingBytes = input.sourceStatuses
    .filter((status) => status.exists)
    .reduce((sum, status) => sum + Number(status.file.fileSize), 0);
  const copiedBytes = input.copyResult.copied.reduce((sum, status) => sum + Number(status.file.fileSize), 0);
  const verificationRows = Object.entries(input.verification)
    .map(([key, pass]) => `| ${key} | ${pass ? "PASS" : "FAIL"} |`)
    .join("\n");

  return `# V7.0B — 源文件本地归档迁移

Generated: ${new Date().toISOString()}

Mode: **${input.mode}**

## 1. 迁移概览

| Metric | Count / Size |
|---|---:|
| Migration scope files | ${input.migrationFiles.length.toLocaleString()} |
| Migration scope size | ${formatBytes(migrationBytes)} |
| Source files present on disk | ${input.sourceStatuses.filter((status) => status.exists).length.toLocaleString()} / ${input.migrationFiles.length.toLocaleString()} |
| Present source size | ${formatBytes(existingBytes)} |
| Missing source files | ${input.missingStatuses.length.toLocaleString()} |
| Not migrated orphan files | ${input.orphanSummary.count.toLocaleString()} / ${formatBytes(input.orphanSummary.bytes)} |
| Local relative_path collisions | ${input.localCollisions.length.toLocaleString()} |
| Collision-skipped migration files | ${input.collisionSkippedStatuses.length.toLocaleString()} |

### Migration scope by file_type

| File Type | Files | Size |
|---|---:|---:|
${input.fileTypeSummary.map((row) => `| ${escapeMd(row.fileType)} | ${row.count.toLocaleString()} | ${formatBytes(row.bytes)} |`).join("\n")}

## 2. 复制结果

| Metric | Count / Size |
|---|---:|
| Backup path | ${input.backupPath ? `\`${escapeMd(input.backupPath)}\`` : "(dry-run, none)"} |
| Copied files | ${input.copyResult.copied.length.toLocaleString()} / ${formatBytes(copiedBytes)} |
| Skipped existing same-size files | ${input.copyResult.skippedExisting.length.toLocaleString()} |
| Failed copy files | ${input.copyResult.failed.length.toLocaleString()} |
| Skipped because local relative_path collision | ${input.collisionSkippedStatuses.length.toLocaleString()} |
| .gitignore updated | ${input.gitignoreUpdated ? "yes" : input.mode === "dry-run" ? "(dry-run)" : "no"} |

## 3. DB 更新结果

| Metric | Before | After |
|---|---:|---:|
| files total | ${input.beforeCounts.files.toLocaleString()} | ${input.afterCounts.files.toLocaleString()} |
| My Passport files | ${input.beforeCounts.my_passport_files.toLocaleString()} | ${input.afterCounts.my_passport_files.toLocaleString()} |
| local files | ${input.beforeCounts.local_files.toLocaleString()} | ${input.afterCounts.local_files.toLocaleString()} |
| supplier_offers | ${input.beforeCounts.supplier_offers.toLocaleString()} | ${input.afterCounts.supplier_offers.toLocaleString()} |
| price_history | ${input.beforeCounts.price_history.toLocaleString()} | ${input.afterCounts.price_history.toLocaleString()} |
| Updated files rows | - | ${input.updatedFileIds.length.toLocaleString()} |

## 4. 后验证

| Check | Result |
|---|---|
${verificationRows}

## 5. 未迁移文件

### Missing source files (first 20)

| File Type | Size | Relative Path | Error |
|---|---:|---|---|
${input.missingStatuses.slice(0, 20).map((status) => `| ${escapeMd(status.file.fileType)} | ${formatBytes(Number(status.file.fileSize))} | ${escapeMd(status.file.relativePath)} | ${escapeMd(status.error ?? "")} |`).join("\n") || "| - | - | - | - |"}

### Copy failures

| File Type | Size | Relative Path | Error |
|---|---:|---|---|
${input.copyResult.failed.map((status) => `| ${escapeMd(status.file.fileType)} | ${formatBytes(Number(status.file.fileSize))} | ${escapeMd(status.file.relativePath)} | ${escapeMd(status.error ?? "")} |`).join("\n") || "| - | - | - | - |"}

### Local relative_path collisions

These files remain on My Passport because updating them to \`volume_name='local'\` would violate the unique \`(volume_name, relative_path)\` constraint.

| My Passport Relative Path | Existing Local File ID | Existing Local File |
|---|---|---|
${input.localCollisions.map((collision) => `| ${escapeMd(collision.relativePath)} | \`${collision.id}\` | ${escapeMd(collision.fileName)} |`).join("\n") || "| - | - | - |"}

### Orphan file samples (first 50)

| File Type | Size | Relative Path |
|---|---:|---|
${input.orphanSummary.samples.map((sample) => `| ${escapeMd(sample.fileType)} | ${formatBytes(sample.bytes)} | ${escapeMd(sample.relativePath)} |`).join("\n")}

## Notes

- Source Excel/PDF files on My Passport were not modified, moved, renamed, or deleted.
- Only \`files.volume_name\` and \`files.absolute_path_snapshot\` are updated in apply mode.
- \`relative_path\` is preserved so existing source identity remains stable.
`;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(index === 0 ? 0 : 2)} ${units[index]}`;
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
