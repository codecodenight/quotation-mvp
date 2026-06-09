import { existsSync, readFileSync } from "node:fs";
import { access, writeFile } from "node:fs/promises";
import path from "node:path";

import { PrismaClient } from "@prisma/client";
import * as XLSX from "xlsx";

import { readSheetRows, type SheetRows } from "../src/lib/excel-import.ts";
import {
  buildImageBackfillReportCopy,
  findProductsNearImage,
  normalizeMatchKey,
  type ImageBackfillCandidate,
} from "../src/lib/image-backfill.ts";
import { extractImagesFromExcel, storeExtractedImage, type ExtractedImage } from "../src/lib/image-extractor.ts";
import { resolveStoredFilePath } from "../src/lib/file-paths.ts";

const prisma = new PrismaClient();
const mode = process.argv.includes("--apply") ? "apply" : "dry-run";
const reportPath = readArg("--report") ?? (mode === "dry-run" ? "docs/image-backfill-dryrun.md" : "docs/image-backfill-result.md");
const fileLimit = readNumberArg("--limit");

type SourceFile = {
  id: string;
  fileName: string;
  volumeName: string;
  relativePath: string;
  absolutePathSnapshot: string;
};

type ProductCandidate = ImageBackfillCandidate & {
  productName: string;
  category: string | null;
};

type SourceFileGroup = {
  file: SourceFile;
  candidates: ProductCandidate[];
};

type ImageAssignment = {
  productId: string;
  modelNo: string;
  anchorRow: number;
  matchedRowIndex: number;
  distance: number;
  matchedCell: string;
};

type FileBackfillResult = {
  sourceFileId: string;
  fileName: string;
  extension: string;
  volumeName: string;
  targetProducts: number;
  candidateProducts: number;
  unusableModelProducts: number;
  fileReadable: boolean;
  extractedImages: number;
  matchedImages: number;
  unmatchedImages: number;
  matchedProducts: number;
  alreadyImageSkipped: number;
  duplicateProductSkipped: number;
  storedImages: number;
  updatedProducts: number;
  failedImageStores: number;
  sheetReadFailures: number;
  error: string | null;
  sampleAssignments: ImageAssignment[];
  sheetImageCounts: Record<string, number>;
};

type BackfillSummary = {
  mode: "dry-run" | "apply";
  startedAt: string;
  finishedAt: string;
  totalProducts: number;
  productsWithImageBefore: number;
  productsWithoutImageBefore: number;
  sourceFiles: number;
  readableFiles: number;
  missingFiles: number;
  targetProducts: number;
  candidateProducts: number;
  unusableModelProducts: number;
  extractedImages: number;
  matchedImages: number;
  unmatchedImages: number;
  matchedProducts: number;
  alreadyImageSkipped: number;
  duplicateProductSkipped: number;
  storedImages: number;
  updatedProducts: number;
  failedImageStores: number;
  sheetReadFailures: number;
  erroredFiles: number;
  productsWithImageAfter: number | null;
  productsWithoutImageAfter: number | null;
};

type BackfillRunResult = {
  summary: BackfillSummary;
  files: FileBackfillResult[];
};

async function main() {
  const startedAt = new Date();
  const groups = await loadSourceFileGroups();
  const beforeCounts = await countProductImages();
  const results: FileBackfillResult[] = [];
  const globalAssignedProductIds = new Set<string>();

  for (const [index, group] of groups.entries()) {
    const result = await processSourceFile(group, globalAssignedProductIds);
    results.push(result);
    console.log(
      `[${index + 1}/${groups.length}] ${group.file.fileName}: images=${result.extractedImages}, matchedProducts=${result.matchedProducts}, error=${result.error ?? "-"}`,
    );
  }

  const afterCounts = mode === "apply" ? await countProductImages() : { withImage: null, withoutImage: null };
  const runResult: BackfillRunResult = {
    summary: buildSummary({
      mode,
      startedAt,
      finishedAt: new Date(),
      groups,
      beforeCounts,
      afterCounts,
      results,
    }),
    files: results,
  };

  await writeFile(reportPath, buildMarkdownReport(runResult), "utf8");
  console.log(JSON.stringify({ mode, reportPath, summary: runResult.summary }, null, 2));
}

async function loadSourceFileGroups(): Promise<SourceFileGroup[]> {
  const targetSourceRows = await prisma.supplierOffer.findMany({
    where: {
      sourceFileId: { not: null },
      product: { imagePath: null },
    },
    distinct: ["sourceFileId"],
    select: { sourceFileId: true },
  });
  const sourceFileIds = targetSourceRows
    .map((row) => row.sourceFileId)
    .filter((sourceFileId): sourceFileId is string => Boolean(sourceFileId));

  if (sourceFileIds.length === 0) {
    return [];
  }

  const offerRows = await prisma.supplierOffer.findMany({
    where: { sourceFileId: { in: sourceFileIds } },
    select: {
      sourceFileId: true,
      sourceFile: {
        select: {
          id: true,
          fileName: true,
          volumeName: true,
          relativePath: true,
          absolutePathSnapshot: true,
        },
      },
      product: {
        select: {
          id: true,
          productName: true,
          category: true,
          modelNo: true,
          imagePath: true,
        },
      },
    },
  });

  const groups = new Map<string, SourceFileGroup>();
  const seenProductByFile = new Set<string>();

  for (const offer of offerRows) {
    if (!offer.sourceFileId || !offer.sourceFile) {
      continue;
    }
    const group =
      groups.get(offer.sourceFileId) ??
      ({
        file: offer.sourceFile,
        candidates: [],
      } satisfies SourceFileGroup);
    groups.set(offer.sourceFileId, group);

    const productKey = `${offer.sourceFileId}:${offer.product.id}`;
    if (seenProductByFile.has(productKey)) {
      continue;
    }
    seenProductByFile.add(productKey);
    group.candidates.push({
      productId: offer.product.id,
      productName: offer.product.productName,
      category: offer.product.category,
      modelNo: offer.product.modelNo,
      imagePath: offer.product.imagePath,
    });
  }

  const sorted = Array.from(groups.values()).sort((a, b) => targetProductCount(b) - targetProductCount(a));
  return fileLimit === null ? sorted : sorted.slice(0, fileLimit);
}

async function processSourceFile(
  group: SourceFileGroup,
  globalAssignedProductIds: Set<string>,
): Promise<FileBackfillResult> {
  const result = emptyFileResult(group);
  let filePath: string;
  try {
    filePath = await resolveStoredFilePath(group.file);
    await access(filePath);
    result.fileReadable = true;
  } catch (error) {
    result.error = `文件不可读: ${errorMessage(error)}`;
    return result;
  }

  let images: ExtractedImage[];
  try {
    images = await extractImagesFromExcel(filePath);
  } catch (error) {
    result.error = `图片提取失败: ${errorMessage(error)}`;
    return result;
  }

  result.extractedImages = images.length;
  result.sheetImageCounts = countImagesBySheet(images);

  if (images.length === 0) {
    return result;
  }

  const rowsBySheet = await readRowsForImageSheets(filePath, images, result);
  const assignedProductIds = new Set<string>();

  for (const image of images) {
    const rows = rowsBySheet.get(image.sheetName);
    if (!rows) {
      result.unmatchedImages += 1;
      continue;
    }

    const matches = findProductsNearImage({
      anchorRow: image.anchorRow,
      rows,
      candidates: group.candidates,
    });

    if (matches.length === 0) {
      result.unmatchedImages += 1;
      continue;
    }

    const newMatches = matches.filter(
      (match) =>
        !match.hasExistingImage &&
        !assignedProductIds.has(match.productId) &&
        !globalAssignedProductIds.has(match.productId),
    );
    const alreadySkipped = matches.length - newMatches.length;
    result.alreadyImageSkipped += matches.filter((match) => match.hasExistingImage).length;
    result.duplicateProductSkipped += alreadySkipped - matches.filter((match) => match.hasExistingImage).length;

    if (newMatches.length === 0) {
      continue;
    }

    result.matchedImages += 1;
    result.matchedProducts += newMatches.length;
    for (const match of newMatches) {
      assignedProductIds.add(match.productId);
      globalAssignedProductIds.add(match.productId);
      if (result.sampleAssignments.length < 12) {
        result.sampleAssignments.push({
          productId: match.productId,
          modelNo: match.modelNo,
          anchorRow: image.anchorRow,
          matchedRowIndex: match.matchedRowIndex,
          distance: Math.abs(match.matchedRowIndex - image.anchorRow),
          matchedCell: match.matchedCell,
        });
      }
    }

    if (mode === "apply") {
      await storeAndAttachImage({ group, image, matches: newMatches, result });
    }
  }

  return result;
}

async function readRowsForImageSheets(
  filePath: string,
  images: ExtractedImage[],
  result: FileBackfillResult,
): Promise<Map<string, SheetRows>> {
  const rowsBySheet = new Map<string, SheetRows>();
  const imageSheetNames = Array.from(new Set(images.map((image) => image.sheetName)));
  const workbookSheetNames = readWorkbookSheetNames(filePath);

  for (const imageSheetName of imageSheetNames) {
    const sheetName = workbookSheetNames.find((candidate) => candidate.trim() === imageSheetName.trim()) ?? imageSheetName;
    try {
      rowsBySheet.set(imageSheetName, readSheetRows(filePath, sheetName));
    } catch {
      result.sheetReadFailures += 1;
    }
  }

  return rowsBySheet;
}

async function storeAndAttachImage({
  group,
  image,
  matches,
  result,
}: {
  group: SourceFileGroup;
  image: ExtractedImage;
  matches: Array<{ productId: string }>;
  result: FileBackfillResult;
}) {
  try {
    const stored = await storeExtractedImage({
      image,
      sourceFileId: group.file.id,
      sheetName: image.sheetName,
    });
    result.storedImages += 1;

    for (const match of matches) {
      const update = await prisma.product.updateMany({
        where: { id: match.productId, imagePath: null },
        data: { imagePath: stored.thumbnailPath },
      });
      result.updatedProducts += update.count;
    }
  } catch {
    result.failedImageStores += 1;
  }
}

function emptyFileResult(group: SourceFileGroup): FileBackfillResult {
  return {
    sourceFileId: group.file.id,
    fileName: group.file.fileName,
    extension: path.extname(group.file.fileName).toLowerCase(),
    volumeName: group.file.volumeName,
    targetProducts: targetProductCount(group),
    candidateProducts: group.candidates.length,
    unusableModelProducts: group.candidates.filter((candidate) => !isUsableModel(candidate.modelNo)).length,
    fileReadable: false,
    extractedImages: 0,
    matchedImages: 0,
    unmatchedImages: 0,
    matchedProducts: 0,
    alreadyImageSkipped: 0,
    duplicateProductSkipped: 0,
    storedImages: 0,
    updatedProducts: 0,
    failedImageStores: 0,
    sheetReadFailures: 0,
    error: null,
    sampleAssignments: [],
    sheetImageCounts: {},
  };
}

function buildSummary({
  mode: runMode,
  startedAt,
  finishedAt,
  groups,
  beforeCounts,
  afterCounts,
  results,
}: {
  mode: "dry-run" | "apply";
  startedAt: Date;
  finishedAt: Date;
  groups: SourceFileGroup[];
  beforeCounts: { total: number; withImage: number; withoutImage: number };
  afterCounts: { withImage: number | null; withoutImage: number | null };
  results: FileBackfillResult[];
}): BackfillSummary {
  return {
    mode: runMode,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    totalProducts: beforeCounts.total,
    productsWithImageBefore: beforeCounts.withImage,
    productsWithoutImageBefore: beforeCounts.withoutImage,
    sourceFiles: groups.length,
    readableFiles: results.filter((result) => result.fileReadable).length,
    missingFiles: results.filter((result) => !result.fileReadable).length,
    targetProducts: sum(results, "targetProducts"),
    candidateProducts: sum(results, "candidateProducts"),
    unusableModelProducts: sum(results, "unusableModelProducts"),
    extractedImages: sum(results, "extractedImages"),
    matchedImages: sum(results, "matchedImages"),
    unmatchedImages: sum(results, "unmatchedImages"),
    matchedProducts: sum(results, "matchedProducts"),
    alreadyImageSkipped: sum(results, "alreadyImageSkipped"),
    duplicateProductSkipped: sum(results, "duplicateProductSkipped"),
    storedImages: sum(results, "storedImages"),
    updatedProducts: sum(results, "updatedProducts"),
    failedImageStores: sum(results, "failedImageStores"),
    sheetReadFailures: sum(results, "sheetReadFailures"),
    erroredFiles: results.filter((result) => result.error).length,
    productsWithImageAfter: afterCounts.withImage,
    productsWithoutImageAfter: afterCounts.withoutImage,
  };
}

async function countProductImages(): Promise<{ total: number; withImage: number; withoutImage: number }> {
  const [total, withImage, withoutImage] = await Promise.all([
    prisma.product.count(),
    prisma.product.count({ where: { imagePath: { not: null } } }),
    prisma.product.count({ where: { imagePath: null } }),
  ]);
  return { total, withImage, withoutImage };
}

function buildMarkdownReport(result: BackfillRunResult): string {
  const lines: string[] = [];
  const { summary } = result;
  const copy = buildImageBackfillReportCopy(summary.mode);

  lines.push(`# ${copy.title}`);
  lines.push("");
  lines.push(`Generated: ${summary.finishedAt}`);
  lines.push("");
  lines.push("## Scope");
  lines.push("");
  lines.push(`- Mode: ${summary.mode}`);
  lines.push("- Source Excel files: read-only");
  lines.push(`- ${copy.writeSummary}`);
  lines.push("- Matching rule: image anchor row +/- 3 rows by default; short model numbers require exact cell match.");
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push("| Metric | Count |");
  lines.push("|---|---:|");
  lines.push(`| Total products | ${summary.totalProducts} |`);
  lines.push(`| Products with image before | ${summary.productsWithImageBefore} |`);
  lines.push(`| Products without image before | ${summary.productsWithoutImageBefore} |`);
  lines.push(`| Source files scanned | ${summary.sourceFiles} |`);
  lines.push(`| Readable files | ${summary.readableFiles} |`);
  lines.push(`| Missing/unreadable files | ${summary.missingFiles} |`);
  lines.push(`| Target no-image product links | ${summary.targetProducts} |`);
  lines.push(`| Candidate products in those files | ${summary.candidateProducts} |`);
  lines.push(`| Products with unusable model_no | ${summary.unusableModelProducts} |`);
  lines.push(`| Extracted images | ${summary.extractedImages} |`);
  lines.push(`| Images matched to products | ${summary.matchedImages} |`);
  lines.push(`| Images not matched | ${summary.unmatchedImages} |`);
  lines.push(`| Products that would receive images | ${summary.matchedProducts} |`);
  lines.push(`| Existing-image matches skipped | ${summary.alreadyImageSkipped} |`);
  lines.push(`| Duplicate product matches skipped | ${summary.duplicateProductSkipped} |`);
  lines.push(`| Stored thumbnail images | ${summary.storedImages} |`);
  lines.push(`| Updated products | ${summary.updatedProducts} |`);
  lines.push(`| Failed image stores | ${summary.failedImageStores} |`);
  lines.push(`| Sheet read failures | ${summary.sheetReadFailures} |`);
  lines.push(`| File errors | ${summary.erroredFiles} |`);
  if (summary.productsWithImageAfter !== null && summary.productsWithoutImageAfter !== null) {
    lines.push(`| Products with image after | ${summary.productsWithImageAfter} |`);
    lines.push(`| Products without image after | ${summary.productsWithoutImageAfter} |`);
  }
  lines.push("");
  lines.push("## File Results");
  lines.push("");
  lines.push("| File | Ext | Target products | Images | Matched products | Unmatched images | Skipped existing | Error |");
  lines.push("|---|---|---:|---:|---:|---:|---:|---|");
  result.files.forEach((file) => {
    lines.push(
      `| ${md(file.fileName)} | ${md(file.extension)} | ${file.targetProducts} | ${file.extractedImages} | ${file.matchedProducts} | ${file.unmatchedImages} | ${file.alreadyImageSkipped + file.duplicateProductSkipped} | ${md(file.error ?? "-")} |`,
    );
  });
  lines.push("");
  lines.push("## Top Match Samples");
  lines.push("");
  const filesWithSamples = result.files.filter((file) => file.sampleAssignments.length > 0).slice(0, 20);
  if (filesWithSamples.length === 0) {
    lines.push("- No matches found.");
  } else {
    lines.push("| File | model_no | Anchor row | Matched row | Distance | Matched cell | product_id |");
    lines.push("|---|---|---:|---:|---:|---|---|");
    for (const file of filesWithSamples) {
      for (const assignment of file.sampleAssignments.slice(0, 3)) {
        lines.push(
          `| ${md(file.fileName)} | ${md(assignment.modelNo)} | ${assignment.anchorRow + 1} | ${assignment.matchedRowIndex + 1} | ${assignment.distance} | ${md(assignment.matchedCell)} | ${assignment.productId} |`,
        );
      }
    }
  }
  lines.push("");
  lines.push("## Files With Extracted Images But No Matches");
  lines.push("");
  const noMatchFiles = result.files.filter((file) => file.extractedImages > 0 && file.matchedProducts === 0);
  if (noMatchFiles.length === 0) {
    lines.push("- None.");
  } else {
    lines.push("| File | Images | Target products | Note |");
    lines.push("|---|---:|---:|---|");
    noMatchFiles.forEach((file) => {
      lines.push(`| ${md(file.fileName)} | ${file.extractedImages} | ${file.targetProducts} | 需要检查行锚点与 model_no 距离 |`);
    });
  }
  lines.push("");
  lines.push("## Sheet Image Counts For Top Files");
  lines.push("");
  result.files
    .filter((file) => file.extractedImages > 0)
    .slice(0, 20)
    .forEach((file) => {
      const sheetCounts = Object.entries(file.sheetImageCounts)
        .map(([sheetName, count]) => `${sheetName}: ${count}`)
        .join("; ");
      lines.push(`- ${file.fileName}: ${sheetCounts || "-"}`);
    });
  lines.push("");
  lines.push("## Decision");
  lines.push("");
  lines.push(copy.decision);

  return `${lines.join("\n")}\n`;
}

function readWorkbookSheetNames(filePath: string): string[] {
  const workbook = XLSX.read(readFileSync(filePath), { type: "buffer", bookSheets: true });
  return workbook.SheetNames;
}

function countImagesBySheet(images: ExtractedImage[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const image of images) {
    counts[image.sheetName] = (counts[image.sheetName] ?? 0) + 1;
  }
  return counts;
}

function targetProductCount(group: SourceFileGroup): number {
  return group.candidates.filter((candidate) => !candidate.imagePath).length;
}

function isUsableModel(modelNo: string | null): boolean {
  const modelKey = normalizeMatchKey(modelNo ?? "");
  return modelKey.length >= 2 && !/^\d+$/.test(modelKey);
}

function sum<K extends keyof FileBackfillResult>(rows: FileBackfillResult[], key: K): number {
  return rows.reduce((total, row) => total + Number(row[key] ?? 0), 0);
}

function readArg(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index < 0) {
    return null;
  }
  return process.argv[index + 1] ?? null;
}

function readNumberArg(name: string): number | null {
  const raw = readArg(name);
  if (raw === null) {
    return null;
  }
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function md(value: unknown): string {
  return String(value ?? "")
    .replaceAll("|", "\\|")
    .replace(/\r?\n/g, " ")
    .trim();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

if (mode === "apply" && !process.argv.includes("--yes")) {
  console.error("Apply mode requires --yes. Use dry-run first.");
  process.exitCode = 1;
} else if (mode === "apply" && !existsSync("prisma/dev.db")) {
  console.error("Database not found: prisma/dev.db");
  process.exitCode = 1;
} else {
  main()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
