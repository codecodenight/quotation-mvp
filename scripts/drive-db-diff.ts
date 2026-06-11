import { existsSync } from "node:fs";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DRIVE_ROOT = "/Volumes/My Passport/AI 报价";
const REPORT_PATH = "docs/drive-db-diff-report.md";
const DETAILS_CSV_PATH = "docs/drive-db-diff-details.csv";

const TRACKED_EXTENSIONS: Record<string, "excel" | "pdf" | "image" | "archive" | "unsupported-excel"> = {
  ".xls": "excel",
  ".xlsx": "excel",
  ".csv": "excel",
  ".pdf": "pdf",
  ".jpg": "image",
  ".jpeg": "image",
  ".png": "image",
  ".webp": "image",
  ".gif": "image",
  ".bmp": "image",
  ".zip": "archive",
  ".rar": "archive",
  ".7z": "archive",
  ".xlsm": "unsupported-excel",
  ".xlsb": "unsupported-excel",
};

const EXISTING_SCANNER_TYPES = new Set(["excel", "pdf", "image", "archive"]);
const MTIME_TOLERANCE_MS = 2000;

type DiskFile = {
  absolutePath: string;
  relativeFromDrive: string;
  fileName: string;
  extension: string;
  fileType: string;
  fileSize: bigint;
  modifiedAtMs: number;
  modifiedAtIso: string;
  topDir: string;
};

type DbFile = {
  id: string;
  fileName: string;
  fileType: string;
  fileSize: bigint;
  volumeName: string;
  relativePath: string;
  absolutePathSnapshot: string;
  modifiedAt: Date;
  scannedAt: Date;
  supplierOfferCount: number;
  rawProductCount: number;
  oldPriceHistoryCount: number;
  newPriceHistoryCount: number;
};

type DiffRow = {
  status: string;
  severity: "high" | "medium" | "low" | "info";
  fileName: string;
  dbId?: string;
  dbPath?: string;
  diskPath?: string;
  dbSize?: string;
  diskSize?: string;
  dbModifiedAt?: string;
  diskModifiedAt?: string;
  supplierOffers?: number;
  rawProducts?: number;
  note: string;
};

async function main() {
  const started = Date.now();
  const diskFiles = await scanDrive(DRIVE_ROOT);
  const dbFiles = await loadDbFiles();
  const diff = compareFiles(diskFiles, dbFiles);

  await mkdir("docs", { recursive: true });
  await writeFile(REPORT_PATH, buildMarkdownReport({ diskFiles, dbFiles, diff, elapsedMs: Date.now() - started }), "utf8");
  await writeFile(DETAILS_CSV_PATH, buildCsv(diff.rows), "utf8");

  console.log(
    JSON.stringify(
      {
        diskFiles: diskFiles.length,
        dbFiles: dbFiles.length,
        exactOk: diff.exactOk.length,
        changedSamePath: diff.changedSamePath.length,
        dbPathMissingButMatched: diff.dbPathMissingButMatched.length,
        dbMissingNoMatch: diff.dbMissingNoMatch.length,
        diskNewNoMatch: diff.diskNewNoMatch.length,
        reportPath: REPORT_PATH,
        detailsCsvPath: DETAILS_CSV_PATH,
      },
      null,
      2,
    ),
  );
}

async function scanDrive(root: string): Promise<DiskFile[]> {
  if (!existsSync(root)) {
    throw new Error(`Drive root is not accessible: ${root}`);
  }

  const files: DiskFile[] = [];
  await walk(root);
  return files.sort((a, b) => a.absolutePath.localeCompare(b.absolutePath, "zh-Hans-CN"));

  async function walk(currentPath: string) {
    const entries = await readdir(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const name = entry.name.normalize("NFC");
      if (name.startsWith(".")) {
        continue;
      }

      const absolutePath = path.join(currentPath, name);
      if (entry.isSymbolicLink()) {
        continue;
      }
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }

      const extension = path.extname(name).toLowerCase();
      const fileType = TRACKED_EXTENSIONS[extension];
      if (!fileType) {
        continue;
      }

      const fileStat = await stat(absolutePath);
      const relativeFromDrive = portableRelative(root, absolutePath);
      files.push({
        absolutePath,
        relativeFromDrive,
        fileName: name,
        extension,
        fileType,
        fileSize: BigInt(fileStat.size),
        modifiedAtMs: fileStat.mtimeMs,
        modifiedAtIso: new Date(fileStat.mtimeMs).toISOString(),
        topDir: relativeFromDrive.split("/")[0] ?? "(root)",
      });
    }
  }
}

async function loadDbFiles(): Promise<DbFile[]> {
  const dbFiles = await prisma.file.findMany({
    where: { volumeName: "My Passport" },
    orderBy: [{ absolutePathSnapshot: "asc" }],
    include: {
      _count: {
        select: {
          supplierOffers: true,
          rawProducts: true,
          oldPriceHistories: true,
          newPriceHistories: true,
        },
      },
    },
  });

  return dbFiles.map((file) => ({
    id: file.id,
    fileName: file.fileName.normalize("NFC"),
    fileType: file.fileType,
    fileSize: BigInt(file.fileSize),
    volumeName: file.volumeName,
    relativePath: file.relativePath.normalize("NFC"),
    absolutePathSnapshot: file.absolutePathSnapshot.normalize("NFC"),
    modifiedAt: file.modifiedAt,
    scannedAt: file.scannedAt,
    supplierOfferCount: file._count.supplierOffers,
    rawProductCount: file._count.rawProducts,
    oldPriceHistoryCount: file._count.oldPriceHistories,
    newPriceHistoryCount: file._count.newPriceHistories,
  }));
}

function compareFiles(diskFiles: DiskFile[], dbFiles: DbFile[]) {
  const diskByAbs = new Map(diskFiles.map((file) => [file.absolutePath, file]));
  const diskByNameSize = groupBy(diskFiles, (file) => nameSizeKey(file.fileName, file.fileSize));
  const diskByName = groupBy(diskFiles, (file) => file.fileName);
  const dbByAbs = new Map(dbFiles.map((file) => [file.absolutePathSnapshot, file]));
  const dbByNameSize = groupBy(dbFiles, (file) => nameSizeKey(file.fileName, file.fileSize));
  const dbByName = groupBy(dbFiles, (file) => file.fileName);

  const exactOk: Array<{ db: DbFile; disk: DiskFile }> = [];
  const changedSamePath: Array<{ db: DbFile; disk: DiskFile }> = [];
  const dbPathMissingButMatched: Array<{ db: DbFile; candidates: DiskFile[]; matchType: string }> = [];
  const dbMissingNoMatch: DbFile[] = [];
  const diskNewNoMatch: DiskFile[] = [];
  const diskNameOnlyMatch: Array<{ disk: DiskFile; candidates: DbFile[] }> = [];
  const diskMovedFromDb: Array<{ disk: DiskFile; candidates: DbFile[] }> = [];
  const rows: DiffRow[] = [];

  for (const db of dbFiles) {
    const disk = diskByAbs.get(db.absolutePathSnapshot);
    if (disk) {
      if (sameSize(db.fileSize, disk.fileSize) && sameMtime(db.modifiedAt, disk.modifiedAtMs)) {
        exactOk.push({ db, disk });
      } else {
        changedSamePath.push({ db, disk });
        rows.push(rowForChangedSamePath(db, disk));
      }
      continue;
    }

    const sameNameSize = diskByNameSize.get(nameSizeKey(db.fileName, db.fileSize)) ?? [];
    if (sameNameSize.length > 0) {
      dbPathMissingButMatched.push({ db, candidates: sameNameSize, matchType: "same file name + size" });
      rows.push(rowForMoved(db, sameNameSize, "same file name + size"));
      continue;
    }

    const sameName = diskByName.get(db.fileName) ?? [];
    if (sameName.length > 0) {
      dbPathMissingButMatched.push({ db, candidates: sameName, matchType: "same file name only" });
      rows.push(rowForMoved(db, sameName, "same file name only; size may differ"));
      continue;
    }

    dbMissingNoMatch.push(db);
    rows.push(rowForMissingDb(db));
  }

  for (const disk of diskFiles) {
    if (dbByAbs.has(disk.absolutePath)) {
      continue;
    }

    const sameNameSize = dbByNameSize.get(nameSizeKey(disk.fileName, disk.fileSize)) ?? [];
    if (sameNameSize.length > 0) {
      diskMovedFromDb.push({ disk, candidates: sameNameSize });
      continue;
    }

    const sameName = dbByName.get(disk.fileName) ?? [];
    if (sameName.length > 0) {
      diskNameOnlyMatch.push({ disk, candidates: sameName });
      continue;
    }

    diskNewNoMatch.push(disk);
    rows.push(rowForNewDisk(disk));
  }

  return {
    exactOk,
    changedSamePath,
    dbPathMissingButMatched,
    dbMissingNoMatch,
    diskNewNoMatch,
    diskNameOnlyMatch,
    diskMovedFromDb,
    rows: rows.sort(compareRows),
  };
}

function buildMarkdownReport(input: {
  diskFiles: DiskFile[];
  dbFiles: DbFile[];
  diff: ReturnType<typeof compareFiles>;
  elapsedMs: number;
}) {
  const importedDbFiles = input.dbFiles.filter(isImportedDbFile);
  const importedRiskRows = input.diff.rows.filter((row) => (row.supplierOffers ?? 0) > 0 || (row.rawProducts ?? 0) > 0);
  const scannerSupportedDiskFiles = input.diskFiles.filter((file) => EXISTING_SCANNER_TYPES.has(file.fileType));
  const unsupportedExcel = input.diskFiles.filter((file) => file.fileType === "unsupported-excel");

  const lines: string[] = [];
  lines.push("# Drive vs Database Diff Report");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Drive root: \`${DRIVE_ROOT}\``);
  lines.push("");
  lines.push("## Executive Summary");
  lines.push("");
  lines.push("| Metric | Count |");
  lines.push("|---|---:|");
  lines.push(`| Disk tracked files (.xls/.xlsx/.csv/PDF/images/archives + .xlsm/.xlsb noted) | ${input.diskFiles.length} |`);
  lines.push(`| Disk files supported by current scanner | ${scannerSupportedDiskFiles.length} |`);
  lines.push(`| Disk unsupported Excel-like files (.xlsm/.xlsb) | ${unsupportedExcel.length} |`);
  lines.push(`| DB files on My Passport | ${input.dbFiles.length} |`);
  lines.push(`| DB files referenced by imports | ${importedDbFiles.length} |`);
  lines.push(`| Exact path + metadata still match | ${input.diff.exactOk.length} |`);
  lines.push(`| Same path but size/mtime changed | ${input.diff.changedSamePath.length} |`);
  lines.push(`| DB path missing but matched elsewhere on disk | ${input.diff.dbPathMissingButMatched.length} |`);
  lines.push(`| DB file missing with no disk match | ${input.diff.dbMissingNoMatch.length} |`);
  lines.push(`| Disk files not known to DB by path/name/size | ${input.diff.diskNewNoMatch.length} |`);
  lines.push(`| Imported-source risk rows | ${importedRiskRows.length} |`);
  lines.push(`| Scan elapsed | ${(input.elapsedMs / 1000).toFixed(1)}s |`);
  lines.push("");
  lines.push("Interpretation: this report is read-only. No database rows and no source files were modified.");
  lines.push("");

  lines.push("## Excel-Focused Summary");
  lines.push("");
  lines.push("| Metric | Count |");
  lines.push("|---|---:|");
  lines.push(`| Disk Excel files supported by scanner | ${input.diskFiles.filter((file) => file.fileType === "excel").length} |`);
  lines.push(`| DB Excel records on My Passport | ${input.dbFiles.filter((file) => file.fileType === "excel").length} |`);
  lines.push(`| New disk Excel files unknown to DB | ${input.diff.diskNewNoMatch.filter((file) => file.fileType === "excel").length} |`);
  lines.push(`| DB Excel files missing with no disk match | ${input.diff.dbMissingNoMatch.filter((file) => file.fileType === "excel").length} |`);
  lines.push(
    `| Imported DB Excel files missing with no disk match | ${
      input.diff.dbMissingNoMatch.filter((file) => file.fileType === "excel" && isImportedDbFile(file)).length
    } |`,
  );
  lines.push(`| DB Excel paths missing but candidate exists | ${
    input.diff.dbPathMissingButMatched.filter(({ db }) => db.fileType === "excel").length
  } |`);
  lines.push("");
  lines.push("Hidden files and unsupported extensions are intentionally excluded to match the app scanner behavior.");
  lines.push("");

  lines.push("## Disk Inventory By Top Folder");
  lines.push("");
  lines.push("| Top folder | Total | Excel | PDF | Image | Archive | Unsupported Excel |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|");
  for (const row of summarizeDiskByTopFolder(input.diskFiles)) {
    lines.push(`| ${md(row.topDir)} | ${row.total} | ${row.excel} | ${row.pdf} | ${row.image} | ${row.archive} | ${row.unsupportedExcel} |`);
  }
  lines.push("");

  lines.push("## Highest Priority: Imported Source Files With Path/Content Risk");
  lines.push("");
  if (importedRiskRows.length === 0) {
    lines.push("No imported source files are currently missing or changed according to this comparison.");
  } else {
    lines.push("| Status | File | DB refs | DB path | Disk path / note |");
    lines.push("|---|---|---:|---|---|");
    for (const row of importedRiskRows.slice(0, 80)) {
      const refs = (row.supplierOffers ?? 0) + (row.rawProducts ?? 0);
      lines.push(`| ${row.status} | ${md(row.fileName)} | ${refs} | ${md(row.dbPath ?? "")} | ${md(row.diskPath ?? row.note)} |`);
    }
    if (importedRiskRows.length > 80) {
      lines.push(`| ... | ... | ... | ... | ${importedRiskRows.length - 80} more in CSV |`);
    }
  }
  lines.push("");

  lines.push("## Same Path But File Changed");
  lines.push("");
  appendDiffTable(lines, input.diff.changedSamePath.map(({ db, disk }) => rowForChangedSamePath(db, disk)), 80);
  lines.push("");

  lines.push("## DB Paths Missing But A Candidate Exists On Disk");
  lines.push("");
  appendDiffTable(lines, input.diff.dbPathMissingButMatched.map(({ db, candidates, matchType }) => rowForMoved(db, candidates, matchType)), 120);
  lines.push("");

  lines.push("## DB Files Missing With No Match On Disk");
  lines.push("");
  appendDiffTable(lines, input.diff.dbMissingNoMatch.map(rowForMissingDb), 120);
  lines.push("");

  lines.push("## New Disk Files Unknown To DB");
  lines.push("");
  lines.push("This list is intentionally summarized. Full details are in `docs/drive-db-diff-details.csv`.");
  lines.push("");
  lines.push("| Top folder | Unknown files |");
  lines.push("|---|---:|");
  for (const [topDir, count] of countBy(input.diff.diskNewNoMatch, (file) => file.topDir).sort((a, b) => b[1] - a[1])) {
    lines.push(`| ${md(topDir)} | ${count} |`);
  }
  lines.push("");
  lines.push("### New Unknown Files — Most Recently Modified");
  lines.push("");
  lines.push("| File | Type | Size | Modified | Path |");
  lines.push("|---|---|---:|---|---|");
  for (const file of [...input.diff.diskNewNoMatch].sort((a, b) => b.modifiedAtMs - a.modifiedAtMs).slice(0, 120)) {
    lines.push(`| ${md(file.fileName)} | ${file.fileType} | ${file.fileSize.toString()} | ${file.modifiedAtIso} | ${md(file.relativeFromDrive)} |`);
  }
  lines.push("");

  lines.push("## Unsupported Excel-like Files");
  lines.push("");
  if (unsupportedExcel.length === 0) {
    lines.push("None found.");
  } else {
    lines.push("These are on disk but current scanner/importer does not treat them as supported Excel files.");
    lines.push("");
    lines.push("| File | Extension | Path |");
    lines.push("|---|---|---|");
    for (const file of unsupportedExcel.slice(0, 80)) {
      lines.push(`| ${md(file.fileName)} | ${file.extension} | ${md(file.relativeFromDrive)} |`);
    }
    if (unsupportedExcel.length > 80) {
      lines.push(`| ... | ... | ${unsupportedExcel.length - 80} more in CSV |`);
    }
  }
  lines.push("");

  lines.push("## Suggested Next Step");
  lines.push("");
  lines.push("1. Do not import yet. First reconcile `files` table metadata with the hard drive truth for moved/missing files.");
  lines.push("2. For imported-source risk rows, prefer updating DB file paths/metadata to the current hard-drive file if a strong candidate exists.");
  lines.push("3. For DB files missing with no match and no import references, mark as stale scan records rather than treating them as source data.");
  lines.push("4. After file metadata is reconciled, run V2.13A source inventory on the priority folders, then V2.14 import planning.");
  lines.push("");

  return lines.join("\n");
}

function appendDiffTable(lines: string[], rows: DiffRow[], limit: number) {
  if (rows.length === 0) {
    lines.push("None.");
    return;
  }
  lines.push("| Status | Severity | File | DB refs | DB path | Disk path / note |");
  lines.push("|---|---|---|---:|---|---|");
  for (const row of rows.slice(0, limit)) {
    const refs = (row.supplierOffers ?? 0) + (row.rawProducts ?? 0);
    lines.push(`| ${row.status} | ${row.severity} | ${md(row.fileName)} | ${refs} | ${md(row.dbPath ?? "")} | ${md(row.diskPath ?? row.note)} |`);
  }
  if (rows.length > limit) {
    lines.push(`| ... | ... | ... | ... | ... | ${rows.length - limit} more in CSV |`);
  }
}

function rowForChangedSamePath(db: DbFile, disk: DiskFile): DiffRow {
  return {
    status: "same-path-changed",
    severity: isImportedDbFile(db) ? "high" : "medium",
    fileName: db.fileName,
    dbId: db.id,
    dbPath: db.absolutePathSnapshot,
    diskPath: disk.absolutePath,
    dbSize: db.fileSize.toString(),
    diskSize: disk.fileSize.toString(),
    dbModifiedAt: db.modifiedAt.toISOString(),
    diskModifiedAt: disk.modifiedAtIso,
    supplierOffers: db.supplierOfferCount,
    rawProducts: db.rawProductCount,
    note: "Same path exists, but file size and/or modified time differs from DB metadata.",
  };
}

function rowForMoved(db: DbFile, candidates: DiskFile[], matchType: string): DiffRow {
  return {
    status: "db-path-missing-candidate-on-disk",
    severity: isImportedDbFile(db) ? "high" : "medium",
    fileName: db.fileName,
    dbId: db.id,
    dbPath: db.absolutePathSnapshot,
    diskPath: candidates.map((file) => file.absolutePath).slice(0, 3).join(" ; "),
    dbSize: db.fileSize.toString(),
    diskSize: candidates[0]?.fileSize.toString(),
    dbModifiedAt: db.modifiedAt.toISOString(),
    diskModifiedAt: candidates[0]?.modifiedAtIso,
    supplierOffers: db.supplierOfferCount,
    rawProducts: db.rawProductCount,
    note: `${matchType}; ${candidates.length} candidate(s).`,
  };
}

function rowForMissingDb(db: DbFile): DiffRow {
  return {
    status: "db-file-missing-no-match",
    severity: isImportedDbFile(db) ? "high" : "low",
    fileName: db.fileName,
    dbId: db.id,
    dbPath: db.absolutePathSnapshot,
    dbSize: db.fileSize.toString(),
    dbModifiedAt: db.modifiedAt.toISOString(),
    supplierOffers: db.supplierOfferCount,
    rawProducts: db.rawProductCount,
    note: "DB file path is missing and no same filename/size candidate was found on disk.",
  };
}

function rowForNewDisk(disk: DiskFile): DiffRow {
  return {
    status: "disk-new-unknown-to-db",
    severity: disk.fileType === "excel" ? "info" : "low",
    fileName: disk.fileName,
    diskPath: disk.absolutePath,
    diskSize: disk.fileSize.toString(),
    diskModifiedAt: disk.modifiedAtIso,
    note: "File exists on hard drive but has no DB path/name/size match.",
  };
}

function summarizeDiskByTopFolder(files: DiskFile[]) {
  const groups = new Map<
    string,
    { topDir: string; total: number; excel: number; pdf: number; image: number; archive: number; unsupportedExcel: number }
  >();
  for (const file of files) {
    const group =
      groups.get(file.topDir) ??
      { topDir: file.topDir, total: 0, excel: 0, pdf: 0, image: 0, archive: 0, unsupportedExcel: 0 };
    group.total += 1;
    if (file.fileType === "excel") group.excel += 1;
    if (file.fileType === "pdf") group.pdf += 1;
    if (file.fileType === "image") group.image += 1;
    if (file.fileType === "archive") group.archive += 1;
    if (file.fileType === "unsupported-excel") group.unsupportedExcel += 1;
    groups.set(file.topDir, group);
  }
  return Array.from(groups.values()).sort((a, b) => b.total - a.total);
}

function buildCsv(rows: DiffRow[]) {
  const header = [
    "status",
    "severity",
    "fileName",
    "dbId",
    "dbPath",
    "diskPath",
    "dbSize",
    "diskSize",
    "dbModifiedAt",
    "diskModifiedAt",
    "supplierOffers",
    "rawProducts",
    "note",
  ];
  return [header.join(","), ...rows.map((row) => header.map((key) => csvCell(row[key as keyof DiffRow] ?? "")).join(","))].join("\n");
}

function isImportedDbFile(file: DbFile) {
  return file.supplierOfferCount > 0 || file.rawProductCount > 0 || file.oldPriceHistoryCount > 0 || file.newPriceHistoryCount > 0;
}

function sameSize(left: bigint, right: bigint) {
  return left === right;
}

function sameMtime(dbDate: Date, diskMs: number) {
  return Math.abs(dbDate.getTime() - diskMs) <= MTIME_TOLERANCE_MS;
}

function nameSizeKey(fileName: string, fileSize: bigint) {
  return `${fileName.normalize("NFC")}\u0000${fileSize.toString()}`;
}

function groupBy<T>(items: T[], keyFn: (item: T) => string) {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  return groups;
}

function countBy<T>(items: T[], keyFn: (item: T) => string) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = keyFn(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries());
}

function compareRows(a: DiffRow, b: DiffRow) {
  const severityRank = { high: 0, medium: 1, low: 2, info: 3 };
  return severityRank[a.severity] - severityRank[b.severity] || a.status.localeCompare(b.status) || a.fileName.localeCompare(b.fileName);
}

function portableRelative(root: string, absolutePath: string) {
  return path.relative(root, absolutePath).split(path.sep).join("/").normalize("NFC");
}

function md(value: string) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\n/g, "<br>");
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
