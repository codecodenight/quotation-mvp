import AdmZip from "adm-zip";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { parseStringPromise } from "xml2js";

type XmlNode = Record<string, unknown>;

type WorkbookSheet = {
  sheetName: string;
  sheetPath: string;
};

type Relationship = {
  id: string;
  type: string;
  target: string;
};

export type ExtractedImage = {
  sheetName: string;
  anchorRow: number;
  anchorCol: number;
  mediaName: string;
  imageBuffer: Buffer;
  mimeType: string;
};

export type StoredExtractedImage = {
  originalPath: string;
  thumbnailPath: string;
  usedThumbnail: boolean;
};

const execFileAsync = promisify(execFile);
const IMAGE_OUTPUT_ROOT = path.join("data", "images");

export async function extractImagesFromExcel(filePath: string, targetSheetName?: string): Promise<ExtractedImage[]> {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".xlsx") {
    return extractImagesFromXlsx(filePath, targetSheetName);
  }
  if (extension === ".xls") {
    return extractImagesFromXls(filePath, targetSheetName);
  }

  return [];
}

export async function storeExtractedImage({
  image,
  sourceFileId,
  sheetName,
  rootDir = process.cwd(),
}: {
  image: ExtractedImage;
  sourceFileId: string;
  sheetName: string;
  rootDir?: string;
}): Promise<StoredExtractedImage> {
  const mediaExtension = normalizeImageExtension(path.extname(image.mediaName));
  const mediaBaseName = sanitizePathPart(path.basename(image.mediaName, path.extname(image.mediaName)));
  const sheetPart = sanitizePathPart(sheetName);
  const fingerprint = createHash("sha1").update(image.imageBuffer).digest("hex").slice(0, 12);
  const outputDir = path.join(rootDir, IMAGE_OUTPUT_ROOT, "source", sanitizePathPart(sourceFileId), sheetPart);
  const originalRelativePath = path.join(
    IMAGE_OUTPUT_ROOT,
    "source",
    sanitizePathPart(sourceFileId),
    sheetPart,
    `${mediaBaseName}-${fingerprint}-original.${mediaExtension}`,
  );
  const thumbnailRelativePath = path.join(
    IMAGE_OUTPUT_ROOT,
    "source",
    sanitizePathPart(sourceFileId),
    sheetPart,
    `${mediaBaseName}-${fingerprint}-thumb.jpg`,
  );
  const originalPath = path.join(rootDir, originalRelativePath);
  const thumbnailPath = path.join(rootDir, thumbnailRelativePath);

  await mkdir(outputDir, { recursive: true });
  await writeFile(originalPath, image.imageBuffer);

  try {
    const sharp = (await import("sharp")).default;
    await sharp(image.imageBuffer)
    await generateThumbnail(image.imageBuffer, thumbnailPath);

    return {
      originalPath: toStoredPath(originalRelativePath),
      thumbnailPath: toStoredPath(thumbnailRelativePath),
      usedThumbnail: true,
    };
  } catch {
    return {
      originalPath: toStoredPath(originalRelativePath),
      thumbnailPath: toStoredPath(originalRelativePath),
      usedThumbnail: false,
    };
  }
}

async function extractImagesFromXls(filePath: string, targetSheetName?: string): Promise<ExtractedImage[]> {
  const sofficePath = findSofficePath();
  if (!sofficePath) {
    return [];
  }

  const tempDir = path.join(tmpdir(), `quotation-image-xls-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await mkdir(tempDir, { recursive: true });

  try {
    await execFileAsync(sofficePath, ["--headless", "--convert-to", "xlsx", filePath, "--outdir", tempDir], {
      timeout: 120_000,
      maxBuffer: 1024 * 1024 * 10,
    });
    const convertedPath = path.join(tempDir, `${path.basename(filePath, path.extname(filePath))}.xlsx`);
    if (!existsSync(convertedPath)) {
      return [];
    }
    return await extractImagesFromXlsx(convertedPath, targetSheetName);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function generateThumbnail(imageBuffer: Buffer, outputPath: string, maxWidth = 300): Promise<void> {
  const sharp = (await import("sharp")).default;
  await sharp(imageBuffer)
    .resize({ width: maxWidth, withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toFile(outputPath);
}

export async function extractImagesFromXlsx(filePath: string, targetSheetName?: string): Promise<ExtractedImage[]> {
  const zip = new AdmZip(filePath);
  const entries = new Set(zip.getEntries().map((entry) => normalizeZipPath(entry.entryName)));
  const sheets = await readWorkbookSheets(zip);
  const images: ExtractedImage[] = [];
  const normalizedTargetSheetName = targetSheetName?.trim();

  for (const sheet of sheets) {
    const normalizedSheetName = sheet.sheetName.trim();
    if (normalizedTargetSheetName && normalizedSheetName !== normalizedTargetSheetName) {
      continue;
    }

    const sheetRelsPath = worksheetRelsPath(sheet.sheetPath);
    if (!entries.has(sheetRelsPath)) {
      continue;
    }

    const sheetRels = await parseRelationships(readZipText(zip, sheetRelsPath));
    const drawingRels = sheetRels.filter((relationship) => relationship.type.includes("/drawing"));
    for (const drawingRel of drawingRels) {
      const drawingPath = resolveZipTarget(path.posix.dirname(sheet.sheetPath), drawingRel.target);
      const drawingRelsPath = drawingRelationshipsPath(drawingPath);
      if (!entries.has(drawingPath) || !entries.has(drawingRelsPath)) {
        continue;
      }

      const imageRels = await parseRelationships(readZipText(zip, drawingRelsPath));
      const mediaByRid = new Map(
        imageRels
          .filter((relationship) => relationship.type.includes("/image"))
          .map((relationship) => [relationship.id, resolveZipTarget(path.posix.dirname(drawingPath), relationship.target)]),
      );
      const drawingXml = await parseXml(readZipText(zip, drawingPath));
      const anchors = parseDrawingAnchors(drawingXml);

      for (const anchor of anchors) {
        if (!anchor.embedRid) {
          continue;
        }
        const mediaName = mediaByRid.get(anchor.embedRid);
        if (!mediaName || !entries.has(mediaName)) {
          continue;
        }
        const mediaEntry = zip.getEntry(mediaName);
        if (!mediaEntry) {
          continue;
        }

        images.push({
          sheetName: normalizedSheetName,
          anchorRow: anchor.anchorRow,
          anchorCol: anchor.anchorCol,
          mediaName,
          imageBuffer: mediaEntry.getData(),
          mimeType: mimeTypeForPath(mediaName),
        });
      }
    }
  }

  return images;
}

async function readWorkbookSheets(zip: AdmZip): Promise<WorkbookSheet[]> {
  const workbookXml = await parseXml(readZipText(zip, "xl/workbook.xml"));
  const workbookRelationships = await parseRelationships(readZipText(zip, "xl/_rels/workbook.xml.rels"));
  const sheetNodes = asArray(getChild(getChild(workbookXml, "sheets"), "sheet"));
  const relationshipById = new Map(workbookRelationships.map((relationship) => [relationship.id, relationship]));
  const sheets: WorkbookSheet[] = [];

  for (const sheetNode of sheetNodes) {
    if (!isXmlNode(sheetNode)) {
      continue;
    }
    const attrs = getAttrs(sheetNode);
    const sheetName = stringAttr(attrs, "name");
    const relationshipId = stringAttr(attrs, "r:id") ?? stringAttr(attrs, "id");
    const relationship = relationshipId ? relationshipById.get(relationshipId) : null;
    if (!sheetName || !relationship) {
      continue;
    }
    sheets.push({
      sheetName,
      sheetPath: resolveZipTarget("xl", relationship.target),
    });
  }

  return sheets;
}

async function parseRelationships(xml: string): Promise<Relationship[]> {
  const parsed = await parseXml(xml);
  const relationshipNodes = asArray(getChild(parsed, "Relationship"));
  return relationshipNodes
    .filter(isXmlNode)
    .map((node) => {
      const attrs = getAttrs(node);
      return {
        id: stringAttr(attrs, "Id") ?? "",
        type: stringAttr(attrs, "Type") ?? "",
        target: stringAttr(attrs, "Target") ?? "",
      };
    })
    .filter((relationship) => relationship.id && relationship.target);
}

function parseDrawingAnchors(drawingXml: XmlNode): Array<{ embedRid: string | null; anchorRow: number; anchorCol: number }> {
  const anchors = [
    ...asArray(getChild(drawingXml, "twoCellAnchor")),
    ...asArray(getChild(drawingXml, "oneCellAnchor")),
  ];

  return anchors.filter(isXmlNode).flatMap((anchor) => {
    const from = getChild(anchor, "from");
    if (!isXmlNode(from)) {
      return [];
    }
    const row = readXmlInt(from, "row");
    const col = readXmlInt(from, "col");
    if (row === null || col === null) {
      return [];
    }

    return [
      {
        embedRid: findEmbedRid(anchor),
        anchorRow: row,
        anchorCol: col,
      },
    ];
  });
}

function findSofficePath(): string | null {
  const candidates = [
    process.env.LIBREOFFICE_BIN,
    "/opt/homebrew/bin/soffice",
    "/usr/local/bin/soffice",
    "/Applications/LibreOffice.app/Contents/MacOS/soffice",
  ].filter((candidate): candidate is string => Boolean(candidate));
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function worksheetRelsPath(sheetPath: string): string {
  return `${path.posix.dirname(sheetPath)}/_rels/${path.posix.basename(sheetPath)}.rels`;
}

function drawingRelationshipsPath(drawingPath: string): string {
  return `${path.posix.dirname(drawingPath)}/_rels/${path.posix.basename(drawingPath)}.rels`;
}

function resolveZipTarget(basePath: string, target: string): string {
  if (target.startsWith("/")) {
    return normalizeZipPath(target.slice(1));
  }
  return normalizeZipPath(path.posix.normalize(path.posix.join(basePath, target)));
}

function normalizeZipPath(value: string): string {
  return value.replace(/^\/+/, "").replace(/\\/g, "/");
}

function readZipText(zip: AdmZip, entryName: string): string {
  const entry = zip.getEntry(entryName);
  if (!entry) {
    throw new Error(`Excel package entry not found: ${entryName}`);
  }
  return entry.getData().toString("utf8");
}

async function parseXml(xml: string): Promise<XmlNode> {
  const parsed = await parseStringPromise(xml, {
    explicitArray: false,
    explicitRoot: false,
    trim: true,
  });
  return isXmlNode(parsed) ? parsed : {};
}

function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function getChild(node: unknown, localName: string): unknown {
  if (!isXmlNode(node)) {
    return undefined;
  }
  const exact = node[localName];
  if (exact !== undefined) {
    return exact;
  }
  const key = Object.keys(node).find((candidate) => candidate.endsWith(`:${localName}`));
  return key ? node[key] : undefined;
}

function getAttrs(node: XmlNode): Record<string, unknown> {
  const attrs = node.$;
  return isXmlNode(attrs) ? attrs : {};
}

function stringAttr(attrs: Record<string, unknown>, key: string): string | null {
  const value = attrs[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readXmlInt(node: XmlNode, localName: string): number | null {
  const child = getChild(node, localName);
  const raw = Array.isArray(child) ? child[0] : child;
  if (typeof raw !== "string" && typeof raw !== "number") {
    return null;
  }
  const parsed = Number(raw);
  return Number.isInteger(parsed) ? parsed : null;
}

function findEmbedRid(node: unknown): string | null {
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findEmbedRid(item);
      if (found) {
        return found;
      }
    }
    return null;
  }
  if (!isXmlNode(node)) {
    return null;
  }

  const attrs = getAttrs(node);
  const embed = stringAttr(attrs, "r:embed") ?? stringAttr(attrs, "embed");
  if (embed) {
    return embed;
  }

  for (const value of Object.values(node)) {
    const found = findEmbedRid(value);
    if (found) {
      return found;
    }
  }
  return null;
}

function isXmlNode(value: unknown): value is XmlNode {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mimeTypeForPath(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") {
    return "image/jpeg";
  }
  if (extension === ".png") {
    return "image/png";
  }
  if (extension === ".webp") {
    return "image/webp";
  }
  if (extension === ".gif") {
    return "image/gif";
  }
  return "application/octet-stream";
}

function normalizeImageExtension(extension: string): string {
  const cleaned = extension.replace(/^\./, "").toLowerCase();
  if (cleaned === "jpeg" || cleaned === "jpg") {
    return "jpg";
  }
  return cleaned || "bin";
}

function sanitizePathPart(value: string): string {
  const normalized = value.normalize("NFC").replace(/[^\p{L}\p{N}._-]+/gu, "-");
  return normalized.replace(/^-+|-+$/g, "").slice(0, 80) || "image";
}

function toStoredPath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}
