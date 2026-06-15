import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const REPORT_PATH = path.join("docs", "v7.1-drive-cleanup-report.md");

const EXTERNAL_VOLUME = "My Passport";
const COLLISION_FILE_ID = "07dec2c3-d664-4d47-bd65-6bb4126ddfd1";
const LOCAL_FILE_ID = "591cc262-bda4-4598-b12f-89148a773ee8";

type Counts = {
  files: number;
  supplierOffers: number;
  priceHistory: number;
  myPassportFiles: number;
  localFiles: number;
};

type Verification = {
  noMyPassportFiles: boolean;
  supplierOfferFkValid: boolean;
  priceHistoryOldFkValid: boolean;
  priceHistoryNewFkValid: boolean;
  supplierOffersUnchanged: boolean;
  priceHistoryUnchanged: boolean;
  filesCountMatchesDeletion: boolean;
  localPathsDoNotPointToVolumes: boolean;
  productImagesNotExternal: boolean;
};

async function main() {
  const beforeCounts = await getCounts();
  const beforeDbSignature = JSON.stringify(beforeCounts);
  const collisionInfo = await getCollisionInfo();
  const orphanDeletePlan = await getMyPassportDeletePlan();
  const expectedDeletePlan = await buildExpectedDeletePlan(orphanDeletePlan, collisionInfo);
  const deletionByKind = summarizeDeletionByKind(expectedDeletePlan);
  let backupPath: string | null = null;
  let updatedOfferCount = collisionInfo.offerRefs;
  let deletedFileCount = expectedDeletePlan.length;

  if (APPLY) {
    backupPath = await backupDatabase();
    await assertCollisionIsSafe(collisionInfo);

    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        UPDATE supplier_offers
        SET source_file_id = ${LOCAL_FILE_ID}
        WHERE source_file_id = ${COLLISION_FILE_ID}
      `;

      await tx.$executeRaw`
        DELETE FROM files
        WHERE volume_name = ${EXTERNAL_VOLUME}
          AND id NOT IN (SELECT DISTINCT source_file_id FROM supplier_offers WHERE source_file_id IS NOT NULL)
          AND id NOT IN (SELECT DISTINCT old_source_file_id FROM price_history WHERE old_source_file_id IS NOT NULL)
          AND id NOT IN (SELECT DISTINCT new_source_file_id FROM price_history WHERE new_source_file_id IS NOT NULL)
          AND id NOT IN (SELECT DISTINCT source_file_id FROM raw_products WHERE source_file_id IS NOT NULL)
      `;
    });

    const afterCollisionInfo = await getCollisionInfo();
    updatedOfferCount = collisionInfo.offerRefs - afterCollisionInfo.offerRefs;
    deletedFileCount = beforeCounts.files - (await getCounts()).files;
  }

  const afterCounts = await getCounts();
  const verification = await verifyCleanup(beforeCounts, afterCounts, deletedFileCount);
  const dryRunUnchanged = APPLY ? true : beforeDbSignature === JSON.stringify(afterCounts);

  await writeFile(
    REPORT_PATH,
    buildReport({
      mode: APPLY ? "apply" : "dry-run",
      backupPath,
      beforeCounts,
      afterCounts,
      collisionInfo,
      updatedOfferCount,
      orphanDeletePlan: expectedDeletePlan,
      deletionByKind,
      deletedFileCount,
      verification,
      dryRunUnchanged,
    }),
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        reportPath: REPORT_PATH,
        mode: APPLY ? "apply" : "dry-run",
        backupPath,
        collisionOfferRefs: collisionInfo.offerRefs,
        updatedOfferCount,
        plannedDeleteFiles: expectedDeletePlan.length,
        deletedFileCount,
        beforeMyPassportFiles: beforeCounts.myPassportFiles,
        afterMyPassportFiles: afterCounts.myPassportFiles,
        verificationPass: Object.values(verification).every(Boolean),
        dryRunUnchanged,
      },
      null,
      2,
    ),
  );
}

async function getCounts(): Promise<Counts> {
  const [files] = await prisma.$queryRaw<Array<{ cnt: number | bigint }>>`SELECT COUNT(*) AS cnt FROM files`;
  const [supplierOffers] =
    await prisma.$queryRaw<Array<{ cnt: number | bigint }>>`SELECT COUNT(*) AS cnt FROM supplier_offers`;
  const [priceHistory] =
    await prisma.$queryRaw<Array<{ cnt: number | bigint }>>`SELECT COUNT(*) AS cnt FROM price_history`;
  const [myPassportFiles] = await prisma.$queryRaw<Array<{ cnt: number | bigint }>>`
    SELECT COUNT(*) AS cnt
    FROM files
    WHERE volume_name = ${EXTERNAL_VOLUME}
  `;
  const [localFiles] = await prisma.$queryRaw<Array<{ cnt: number | bigint }>>`
    SELECT COUNT(*) AS cnt
    FROM files
    WHERE volume_name = 'local'
  `;

  return {
    files: toNumber(files.cnt),
    supplierOffers: toNumber(supplierOffers.cnt),
    priceHistory: toNumber(priceHistory.cnt),
    myPassportFiles: toNumber(myPassportFiles.cnt),
    localFiles: toNumber(localFiles.cnt),
  };
}

async function getCollisionInfo() {
  const [row] = await prisma.$queryRaw<
    Array<{
      collision_exists: number | bigint;
      local_exists: number | bigint;
      collision_size: number | bigint | null;
      local_size: number | bigint | null;
      offer_refs: number | bigint;
      ph_old_refs: number | bigint;
      ph_new_refs: number | bigint;
      raw_refs: number | bigint;
    }>
  >`
    SELECT
      (SELECT COUNT(*) FROM files WHERE id = ${COLLISION_FILE_ID}) AS collision_exists,
      (SELECT COUNT(*) FROM files WHERE id = ${LOCAL_FILE_ID}) AS local_exists,
      (SELECT file_size FROM files WHERE id = ${COLLISION_FILE_ID}) AS collision_size,
      (SELECT file_size FROM files WHERE id = ${LOCAL_FILE_ID}) AS local_size,
      (SELECT COUNT(*) FROM supplier_offers WHERE source_file_id = ${COLLISION_FILE_ID}) AS offer_refs,
      (SELECT COUNT(*) FROM price_history WHERE old_source_file_id = ${COLLISION_FILE_ID}) AS ph_old_refs,
      (SELECT COUNT(*) FROM price_history WHERE new_source_file_id = ${COLLISION_FILE_ID}) AS ph_new_refs,
      (SELECT COUNT(*) FROM raw_products WHERE source_file_id = ${COLLISION_FILE_ID}) AS raw_refs
  `;

  return {
    collisionExists: toNumber(row.collision_exists),
    localExists: toNumber(row.local_exists),
    collisionSize: toNumber(row.collision_size),
    localSize: toNumber(row.local_size),
    offerRefs: toNumber(row.offer_refs),
    priceHistoryOldRefs: toNumber(row.ph_old_refs),
    priceHistoryNewRefs: toNumber(row.ph_new_refs),
    rawProductRefs: toNumber(row.raw_refs),
  };
}

async function getMyPassportDeletePlan() {
  return prisma.$queryRaw<
    FileDeletePlanRow[]
  >`
    SELECT id, file_name, file_type, file_size, relative_path
    FROM files
    WHERE volume_name = ${EXTERNAL_VOLUME}
      AND id NOT IN (SELECT DISTINCT source_file_id FROM supplier_offers WHERE source_file_id IS NOT NULL)
      AND id NOT IN (SELECT DISTINCT old_source_file_id FROM price_history WHERE old_source_file_id IS NOT NULL)
      AND id NOT IN (SELECT DISTINCT new_source_file_id FROM price_history WHERE new_source_file_id IS NOT NULL)
      AND id NOT IN (SELECT DISTINCT source_file_id FROM raw_products WHERE source_file_id IS NOT NULL)
    ORDER BY file_type, relative_path
  `;
}

type FileDeletePlanRow = {
  id: string;
  file_name: string;
  file_type: string;
  file_size: number | bigint;
  relative_path: string;
};

async function buildExpectedDeletePlan(
  orphanDeletePlan: FileDeletePlanRow[],
  collisionInfo: Awaited<ReturnType<typeof getCollisionInfo>>,
) {
  if (
    collisionInfo.collisionExists !== 1 ||
    collisionInfo.offerRefs <= 0 ||
    collisionInfo.priceHistoryOldRefs !== 0 ||
    collisionInfo.priceHistoryNewRefs !== 0 ||
    collisionInfo.rawProductRefs !== 0 ||
    orphanDeletePlan.some((file) => file.id === COLLISION_FILE_ID)
  ) {
    return orphanDeletePlan;
  }

  const [collisionFile] = await prisma.$queryRaw<FileDeletePlanRow[]>`
    SELECT id, file_name, file_type, file_size, relative_path
    FROM files
    WHERE id = ${COLLISION_FILE_ID}
      AND volume_name = ${EXTERNAL_VOLUME}
  `;

  return collisionFile ? [...orphanDeletePlan, collisionFile] : orphanDeletePlan;
}

function summarizeDeletionByKind(
  files: Array<{ file_name: string; file_type: string; file_size: number | bigint }>,
) {
  const summary = new Map<string, { count: number; bytes: number }>();

  for (const file of files) {
    const kind = classifyFileKind(file.file_name, file.file_type);
    const current = summary.get(kind) ?? { count: 0, bytes: 0 };
    current.count += 1;
    current.bytes += toNumber(file.file_size);
    summary.set(kind, current);
  }

  return Array.from(summary.entries())
    .map(([kind, values]) => ({ kind, ...values }))
    .sort((a, b) => a.kind.localeCompare(b.kind));
}

function classifyFileKind(fileName: string, fileType: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".xlsx")) return "xlsx";
  if (lower.endsWith(".xls")) return "xls";
  if (lower.endsWith(".pdf")) return "pdf";
  return fileType || "other";
}

async function assertCollisionIsSafe(collisionInfo: Awaited<ReturnType<typeof getCollisionInfo>>) {
  const errors: string[] = [];
  if (collisionInfo.collisionExists !== 1) {
    errors.push(`collision file count expected 1, got ${collisionInfo.collisionExists}`);
  }
  if (collisionInfo.localExists !== 1) {
    errors.push(`local replacement file count expected 1, got ${collisionInfo.localExists}`);
  }
  if (collisionInfo.collisionSize !== collisionInfo.localSize) {
    errors.push(`file size mismatch: ${collisionInfo.collisionSize} != ${collisionInfo.localSize}`);
  }
  if (collisionInfo.priceHistoryOldRefs !== 0 || collisionInfo.priceHistoryNewRefs !== 0) {
    errors.push(
      `price_history unexpectedly references collision file: old=${collisionInfo.priceHistoryOldRefs}, new=${collisionInfo.priceHistoryNewRefs}`,
    );
  }
  if (collisionInfo.rawProductRefs !== 0) {
    errors.push(`raw_products unexpectedly references collision file: ${collisionInfo.rawProductRefs}`);
  }

  if (errors.length > 0) {
    throw new Error(errors.join("; "));
  }
}

async function verifyCleanup(beforeCounts: Counts, afterCounts: Counts, deletedFileCount: number): Promise<Verification> {
  const [brokenSupplierOffers] = await prisma.$queryRaw<Array<{ cnt: number | bigint }>>`
    SELECT COUNT(*) AS cnt
    FROM supplier_offers so
    LEFT JOIN files f ON f.id = so.source_file_id
    WHERE so.source_file_id IS NOT NULL AND f.id IS NULL
  `;
  const [brokenPriceHistoryOld] = await prisma.$queryRaw<Array<{ cnt: number | bigint }>>`
    SELECT COUNT(*) AS cnt
    FROM price_history ph
    LEFT JOIN files f ON f.id = ph.old_source_file_id
    WHERE ph.old_source_file_id IS NOT NULL AND f.id IS NULL
  `;
  const [brokenPriceHistoryNew] = await prisma.$queryRaw<Array<{ cnt: number | bigint }>>`
    SELECT COUNT(*) AS cnt
    FROM price_history ph
    LEFT JOIN files f ON f.id = ph.new_source_file_id
    WHERE ph.new_source_file_id IS NOT NULL AND f.id IS NULL
  `;
  const [localVolumesPaths] = await prisma.$queryRaw<Array<{ cnt: number | bigint }>>`
    SELECT COUNT(*) AS cnt
    FROM files
    WHERE volume_name = 'local'
      AND absolute_path_snapshot LIKE '/Volumes/%'
  `;
  const [externalImages] = await prisma.$queryRaw<Array<{ cnt: number | bigint }>>`
    SELECT COUNT(*) AS cnt
    FROM products
    WHERE image_path LIKE '/Volumes/%'
       OR image_path LIKE '%My Passport%'
  `;

  return {
    noMyPassportFiles: afterCounts.myPassportFiles === 0,
    supplierOfferFkValid: toNumber(brokenSupplierOffers.cnt) === 0,
    priceHistoryOldFkValid: toNumber(brokenPriceHistoryOld.cnt) === 0,
    priceHistoryNewFkValid: toNumber(brokenPriceHistoryNew.cnt) === 0,
    supplierOffersUnchanged: beforeCounts.supplierOffers === afterCounts.supplierOffers,
    priceHistoryUnchanged: beforeCounts.priceHistory === afterCounts.priceHistory,
    filesCountMatchesDeletion: beforeCounts.files - deletedFileCount === afterCounts.files,
    localPathsDoNotPointToVolumes: toNumber(localVolumesPaths.cnt) === 0,
    productImagesNotExternal: toNumber(externalImages.cnt) === 0,
  };
}

async function backupDatabase(): Promise<string> {
  await mkdir("backups", { recursive: true });
  const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const backupPath = path.join("backups", `dev-before-v7.1-${timestamp}.sqlite`);
  execFileSync("cp", ["prisma/dev.db", backupPath]);
  return backupPath;
}

function buildReport(input: {
  mode: "dry-run" | "apply";
  backupPath: string | null;
  beforeCounts: Counts;
  afterCounts: Counts;
  collisionInfo: Awaited<ReturnType<typeof getCollisionInfo>>;
  updatedOfferCount: number;
  orphanDeletePlan: Awaited<ReturnType<typeof buildExpectedDeletePlan>>;
  deletionByKind: Array<{ kind: string; count: number; bytes: number }>;
  deletedFileCount: number;
  verification: Verification;
  dryRunUnchanged: boolean;
}) {
  const verificationRows = Object.entries(input.verification)
    .map(([key, pass]) => `| ${key} | ${pass ? "PASS" : "FAIL"} |`)
    .join("\n");

  return `# V7.1 — 彻底清除移动硬盘依赖报告

Generated: ${new Date().toISOString()}

Mode: **${input.mode}**

Backup: ${input.backupPath ? `\`${input.backupPath}\`` : "(dry-run, none)"}

## 1. 碰撞文件处理

| Item | Count / Value |
|---|---:|
| Collision file ID | \`${COLLISION_FILE_ID}\` |
| Local replacement file ID | \`${LOCAL_FILE_ID}\` |
| Collision file exists | ${input.collisionInfo.collisionExists} |
| Local replacement exists | ${input.collisionInfo.localExists} |
| Collision file size | ${input.collisionInfo.collisionSize.toLocaleString()} |
| Local replacement size | ${input.collisionInfo.localSize.toLocaleString()} |
| supplier_offers originally referencing collision file | ${input.collisionInfo.offerRefs.toLocaleString()} |
| supplier_offers migrated to local file | ${input.updatedOfferCount.toLocaleString()} |
| price_history old refs to collision | ${input.collisionInfo.priceHistoryOldRefs.toLocaleString()} |
| price_history new refs to collision | ${input.collisionInfo.priceHistoryNewRefs.toLocaleString()} |
| raw_products refs to collision | ${input.collisionInfo.rawProductRefs.toLocaleString()} |

## 2. My Passport 孤儿记录删除计划 / 结果

| Metric | Count |
|---|---:|
| My Passport file records planned for deletion after collision migration | ${input.orphanDeletePlan.length.toLocaleString()} |
| File records actually deleted | ${input.deletedFileCount.toLocaleString()} |

### 删除记录按文件类型

| Kind | Files | Size |
|---|---:|---:|
${input.deletionByKind.map((row) => `| ${escapeMd(row.kind)} | ${row.count.toLocaleString()} | ${formatBytes(row.bytes)} |`).join("\n")}

## 3. files 表 before / after

| Metric | Before | After |
|---|---:|---:|
| files total | ${input.beforeCounts.files.toLocaleString()} | ${input.afterCounts.files.toLocaleString()} |
| My Passport files | ${input.beforeCounts.myPassportFiles.toLocaleString()} | ${input.afterCounts.myPassportFiles.toLocaleString()} |
| local files | ${input.beforeCounts.localFiles.toLocaleString()} | ${input.afterCounts.localFiles.toLocaleString()} |
| supplier_offers | ${input.beforeCounts.supplierOffers.toLocaleString()} | ${input.afterCounts.supplierOffers.toLocaleString()} |
| price_history | ${input.beforeCounts.priceHistory.toLocaleString()} | ${input.afterCounts.priceHistory.toLocaleString()} |

## 4. 验证结果

| Check | Result |
|---|---|
${verificationRows}
| dry-run unchanged | ${input.dryRunUnchanged ? "PASS" : "FAIL"} |

## 5. 结论

${input.mode === "apply" && Object.values(input.verification).every(Boolean) ? "DB 层面已清除移动硬盘依赖：files 表没有 My Passport 记录，报价源文件引用和价格历史引用都保持完整。" : "当前为 dry-run 或仍有验证项未通过。"}

Note: 本任务只清理数据库运行依赖，不删除、不移动、不修改移动硬盘上的源文件，也不删除本地 \`data/source-archive/\` 归档。
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
