import { access, writeFile } from "node:fs/promises";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

import { resolveStoredFilePath } from "../src/lib/file-paths";

const prisma = new PrismaClient();
const REPORT_PATH = path.join("docs", "v7.2-path-check-report.md");

type FileRow = {
  id: string;
  fileName: string;
  fileType: string;
  volumeName: string;
  relativePath: string;
  absolutePathSnapshot: string;
};

type FileCheck = FileRow & {
  cwdRelativePath: string;
  projectRelativeSnapshotPath: string | null;
  resolvedPath: string;
  directAccessible: boolean;
  projectRelativeSnapshotAccessible: boolean;
  snapshotAccessible: boolean;
  resolvedAccessible: boolean;
  mode: "direct" | "project-relative-snapshot" | "absolute-snapshot" | "missing";
};

type ImageCheck = {
  productId: string;
  modelNo: string | null;
  imagePath: string;
  absolutePath: string;
  accessible: boolean;
};

async function main() {
  const [files, imageRows] = await Promise.all([loadLocalFiles(), loadProductImages()]);
  const fileChecks = await checkFiles(files);
  const imageChecks = await checkImages(imageRows);

  await writeFile(REPORT_PATH, buildReport(fileChecks, imageChecks), "utf8");

  const missingFiles = fileChecks.filter((check) => !check.resolvedAccessible);
  const missingImages = imageChecks.filter((check) => !check.accessible);

  console.log(
    JSON.stringify(
      {
        reportPath: REPORT_PATH,
        localFiles: fileChecks.length,
        directAccessible: fileChecks.filter((check) => check.mode === "direct").length,
        projectRelativeSnapshotAccessible: fileChecks.filter((check) => check.mode === "project-relative-snapshot").length,
        absoluteSnapshotOnlyAccessible: fileChecks.filter((check) => check.mode === "absolute-snapshot").length,
        missingFiles: missingFiles.length,
        productImages: imageChecks.length,
        accessibleImages: imageChecks.length - missingImages.length,
        missingImages: missingImages.length,
      },
      null,
      2,
    ),
  );

  if (missingFiles.length > 0 || missingImages.length > 0) {
    process.exitCode = 1;
  }
}

async function loadLocalFiles(): Promise<FileRow[]> {
  const files = await prisma.file.findMany({
    where: { volumeName: "local" },
    select: {
      id: true,
      fileName: true,
      fileType: true,
      volumeName: true,
      relativePath: true,
      absolutePathSnapshot: true,
    },
    orderBy: [{ fileType: "asc" }, { relativePath: "asc" }],
  });

  return files;
}

async function loadProductImages(): Promise<Array<{ id: string; modelNo: string | null; imagePath: string | null }>> {
  return prisma.product.findMany({
    where: { imagePath: { not: null } },
    select: { id: true, modelNo: true, imagePath: true },
    orderBy: [{ category: "asc" }, { modelNo: "asc" }],
  });
}

async function checkFiles(files: FileRow[]): Promise<FileCheck[]> {
  const checks: FileCheck[] = [];

  for (const file of files) {
    const cwdRelativePath = path.join(process.cwd(), file.relativePath);
    const projectRelativeSnapshotPath = buildProjectRelativeSnapshotPath(file.absolutePathSnapshot);
    const [directAccessible, projectRelativeSnapshotAccessible, snapshotAccessible, resolvedPath] = await Promise.all([
      pathExists(cwdRelativePath),
      projectRelativeSnapshotPath ? pathExists(projectRelativeSnapshotPath) : Promise.resolve(false),
      pathExists(file.absolutePathSnapshot),
      resolveStoredFilePath(file),
    ]);
    const resolvedAccessible = await pathExists(resolvedPath);
    const mode = directAccessible
      ? "direct"
      : projectRelativeSnapshotAccessible
        ? "project-relative-snapshot"
        : snapshotAccessible
          ? "absolute-snapshot"
          : "missing";

    checks.push({
      ...file,
      cwdRelativePath,
      projectRelativeSnapshotPath,
      resolvedPath,
      directAccessible,
      projectRelativeSnapshotAccessible,
      snapshotAccessible,
      resolvedAccessible,
      mode,
    });
  }

  return checks;
}

function buildProjectRelativeSnapshotPath(absolutePathSnapshot: string): string | null {
  const normalizedSnapshot = absolutePathSnapshot.replace(/\\/g, "/");
  const localMarkers = ["/data/source-archive/", "/sample-data/", "/sample data/"];

  for (const marker of localMarkers) {
    const markerIndex = normalizedSnapshot.indexOf(marker);
    if (markerIndex >= 0) {
      return path.join(process.cwd(), normalizedSnapshot.slice(markerIndex + 1));
    }
  }

  return null;
}

async function checkImages(
  rows: Array<{ id: string; modelNo: string | null; imagePath: string | null }>,
): Promise<ImageCheck[]> {
  const checks: ImageCheck[] = [];

  for (const row of rows) {
    if (!row.imagePath) continue;
    const absolutePath = path.join(process.cwd(), row.imagePath);
    checks.push({
      productId: row.id,
      modelNo: row.modelNo,
      imagePath: row.imagePath,
      absolutePath,
      accessible: await pathExists(absolutePath),
    });
  }

  return checks;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function buildReport(fileChecks: FileCheck[], imageChecks: ImageCheck[]) {
  const direct = fileChecks.filter((check) => check.mode === "direct");
  const projectRelativeSnapshot = fileChecks.filter((check) => check.mode === "project-relative-snapshot");
  const absoluteSnapshot = fileChecks.filter((check) => check.mode === "absolute-snapshot");
  const missing = fileChecks.filter((check) => check.mode === "missing" || !check.resolvedAccessible);
  const missingImages = imageChecks.filter((check) => !check.accessible);
  const nonPortable = absoluteSnapshot.filter((check) => check.snapshotAccessible);
  const byType = summarizeByType(fileChecks);

  return `# V7.2 — Local Path Portability Check

Generated: ${new Date().toISOString()}

## Summary

| Metric | Count |
|---|---:|
| local file records | ${fileChecks.length.toLocaleString()} |
| accessible via cwd + relative_path | ${direct.length.toLocaleString()} |
| accessible via project-relative snapshot path | ${projectRelativeSnapshot.length.toLocaleString()} |
| accessible only via absolute_path_snapshot fallback | ${absoluteSnapshot.length.toLocaleString()} |
| missing after resolver | ${missing.length.toLocaleString()} |
| product image paths | ${imageChecks.length.toLocaleString()} |
| accessible product images | ${(imageChecks.length - missingImages.length).toLocaleString()} |
| missing product images | ${missingImages.length.toLocaleString()} |

## Files By Type

| File type | Total | Direct | Project-relative snapshot | Absolute snapshot | Missing |
|---|---:|---:|---:|---:|---:|
${byType
  .map(
    (row) =>
      `| ${escapeMd(row.fileType)} | ${row.total.toLocaleString()} | ${row.direct.toLocaleString()} | ${row.projectRelativeSnapshot.toLocaleString()} | ${row.absoluteSnapshot.toLocaleString()} | ${row.missing.toLocaleString()} |`,
  )
  .join("\n")}

## Non-portable Relative Paths

These records are accessible only because the exact \`absolute_path_snapshot\` still exists. V7.2 reports them without rewriting DB paths.

- Count: ${nonPortable.length.toLocaleString()}

${sampleTable(
  nonPortable,
  ["file_id", "file_name", "relative_path", "absolute_path_snapshot"],
  (check) => [
    `\`${check.id}\``,
    escapeMd(check.fileName),
    escapeMd(check.relativePath),
    escapeMd(check.absolutePathSnapshot),
  ],
)}

## Missing Files

${sampleTable(
  missing,
  ["file_id", "file_name", "relative_path", "absolute_path_snapshot"],
  (check) => [
    `\`${check.id}\``,
    escapeMd(check.fileName),
    escapeMd(check.relativePath),
    escapeMd(check.absolutePathSnapshot),
  ],
)}

## Missing Product Images

${sampleTable(
  missingImages,
  ["product_id", "model_no", "image_path"],
  (check) => [`\`${check.productId}\``, escapeMd(check.modelNo ?? "-"), escapeMd(check.imagePath)],
)}

## Verdict

${missing.length === 0 && missingImages.length === 0 ? "PASS: all local file records and product images are accessible without the external drive." : "FAIL: some local records or product images are missing."}
`;
}

function summarizeByType(fileChecks: FileCheck[]) {
  const map = new Map<
    string,
    { fileType: string; total: number; direct: number; projectRelativeSnapshot: number; absoluteSnapshot: number; missing: number }
  >();

  for (const check of fileChecks) {
    const row = map.get(check.fileType) ?? {
      fileType: check.fileType,
      total: 0,
      direct: 0,
      projectRelativeSnapshot: 0,
      absoluteSnapshot: 0,
      missing: 0,
    };
    row.total += 1;
    if (check.mode === "direct") row.direct += 1;
    if (check.mode === "project-relative-snapshot") row.projectRelativeSnapshot += 1;
    if (check.mode === "absolute-snapshot") row.absoluteSnapshot += 1;
    if (check.mode === "missing" || !check.resolvedAccessible) row.missing += 1;
    map.set(check.fileType, row);
  }

  return Array.from(map.values()).sort((left, right) => left.fileType.localeCompare(right.fileType));
}

function sampleTable<T>(items: T[], headers: string[], rowBuilder: (item: T) => string[], limit = 20): string {
  if (items.length === 0) {
    return "_None._";
  }

  const headerLine = `| ${headers.join(" |")} |`;
  const divider = `| ${headers.map(() => "---").join(" | ")} |`;
  const rows = items.slice(0, limit).map((item) => `| ${rowBuilder(item).join(" | ")} |`);
  const suffix = items.length > limit ? `\n\n_Showing ${limit} of ${items.length.toLocaleString()}._` : "";
  return [headerLine, divider, ...rows].join("\n") + suffix;
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
