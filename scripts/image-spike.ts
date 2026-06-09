/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs") as typeof import("node:fs");
const { execFileSync } = require("node:child_process") as typeof import("node:child_process");
const path = require("node:path") as typeof import("node:path");
const XLSX = require("xlsx") as typeof import("xlsx");

type TestFile = {
  label: string;
  category: string;
  path: string;
};

type Relationship = {
  id: string;
  type: string;
  target: string;
};

type ImageInfo = {
  entry: string;
  bytes: number;
  format: string;
  width: number | null;
  height: number | null;
};

type DrawingAnchor = {
  embedRid: string | null;
  fromColZeroBased: number | null;
  fromRowZeroBased: number | null;
  fromColOneBased: number | null;
  fromRowOneBased: number | null;
  toColOneBased: number | null;
  toRowOneBased: number | null;
};

type SheetImageAnchor = DrawingAnchor & {
  sheetName: string;
  sheetXml: string;
  drawing: string;
  media: string | null;
};

type LooseWorkbook = import("xlsx").WorkBook & {
  cfb?: {
    FullPaths?: string[];
  };
};

const TEST_FILES: TestFile[] = [
  {
    label: "xlsx-bulb-typical",
    category: "球泡",
    path: "/Volumes/My Passport/AI 报价/发客户报价单汇总/球泡/LED Bulbs - Wellux  Price 202305.xlsx",
  },
  {
    label: "xls-triproof-legacy",
    category: "三防灯",
    path: "/Volumes/My Passport/AI 报价/发客户报价单汇总/三防灯/Waterproof Lighting Fixture - Wellux 202305.xls",
  },
  {
    label: "xlsx-solar-irregular",
    category: "太阳能",
    path: "/Volumes/My Passport/AI 报价/发客户报价单汇总/太阳能/核价 Welfull Wellux - Quotation- LED Solar Floodlight & Streetlight 20240516.xlsx",
  },
];

function main() {
  const results = TEST_FILES.map(analyzeWorkbook);
  console.log(JSON.stringify(results, null, 2));
}

function analyzeWorkbook(file: TestFile) {
  const stat = fs.statSync(file.path);
  const extension = path.extname(file.path).toLowerCase();
  const sheetJs = analyzeSheetJs(file.path);
  const packageResult = extension === ".xlsx" ? analyzeXlsxPackage(file.path, sheetJs.sheetNames) : null;
  const xlsResult = extension === ".xls" ? analyzeXlsWithSheetJs(file.path) : null;

  return {
    ...file,
    extension,
    sizeBytes: stat.size,
    sheetJs,
    package: packageResult,
    xls: xlsResult,
  };
}

function analyzeSheetJs(filePath: string) {
  const workbook = XLSX.readFile(filePath, {
    cellDates: false,
    cellNF: false,
    cellStyles: true,
    bookFiles: true,
  }) as LooseWorkbook;
  return {
    version: XLSX.version,
    sheetNames: workbook.SheetNames as string[],
    sheets: (workbook.SheetNames as string[]).map((sheetName: string) => {
      const sheet = workbook.Sheets[sheetName] as Record<string, unknown>;
      const range = sheet["!ref"] ?? null;
      const imageValue = sheet["!images"];
      const imageKeys = Object.keys(sheet).filter((key) => key.toLowerCase().includes("image"));
      return {
        sheetName,
        range,
        hasBangImages: Array.isArray(imageValue),
        bangImagesCount: Array.isArray(imageValue) ? imageValue.length : null,
        imageRelatedKeys: imageKeys,
      };
    }),
    workbookKeys: Object.keys(workbook).filter((key) => key.toLowerCase().includes("image") || key === "files" || key === "cfb"),
    cfbPathsSample: workbook.cfb?.FullPaths?.slice(0, 40) ?? null,
  };
}

function analyzeXlsxPackage(filePath: string, sheetNames: string[]) {
  const entries = unzipList(filePath);
  const mediaEntries = entries.filter((entry) => /^xl\/media\/[^/]+\.[A-Za-z0-9]+$/.test(entry));
  const drawingEntries = entries.filter((entry) => entry.startsWith("xl/drawings/") && entry.endsWith(".xml"));
  const worksheetRelEntries = entries.filter((entry) => entry.startsWith("xl/worksheets/_rels/") && entry.endsWith(".rels"));
  const imageInfos = mediaEntries.map((entry) => {
    const bytes = unzipBuffer(filePath, entry);
    return {
      entry,
      bytes: bytes.length,
      ...detectImageInfo(bytes, entry),
    };
  });
  const anchors: SheetImageAnchor[] = [];

  for (let sheetIndex = 1; sheetIndex <= sheetNames.length; sheetIndex += 1) {
    const relPath = `xl/worksheets/_rels/sheet${sheetIndex}.xml.rels`;
    if (!worksheetRelEntries.includes(relPath)) {
      continue;
    }
    const sheetRels = readZipText(filePath, relPath);
    const drawingTargets = parseRelationships(sheetRels).filter((rel) => rel.type.includes("/drawing"));
    for (const drawingRel of drawingTargets) {
      const drawingPath = normalizeZipPath(`xl/worksheets/${drawingRel.target}`);
      const drawingRelsPath = drawingPath.replace("xl/drawings/", "xl/drawings/_rels/") + ".rels";
      if (!entries.includes(drawingPath) || !entries.includes(drawingRelsPath)) {
        continue;
      }
      const drawingXml = readZipText(filePath, drawingPath);
      const drawingRels = parseRelationships(readZipText(filePath, drawingRelsPath));
      const mediaByRid = new Map(
        drawingRels
          .filter((rel) => rel.type.includes("/image"))
          .map((rel) => [rel.id, normalizeZipPath(`xl/drawings/${rel.target}`)]),
      );
      anchors.push(
        ...parseDrawingAnchors(drawingXml).map((anchor) => ({
          sheetName: sheetNames[sheetIndex - 1],
          sheetXml: `sheet${sheetIndex}.xml`,
          drawing: drawingPath,
          media: anchor.embedRid ? mediaByRid.get(anchor.embedRid) ?? null : null,
          ...anchor,
        })),
      );
    }
  }

  const anchorsBySheet = groupCount(anchors, (anchor) => anchor.sheetName);
  const rowsBySheet: Record<string, number[]> = {};
  for (const anchor of anchors) {
    if (anchor.fromRowOneBased !== null) {
      rowsBySheet[anchor.sheetName] ??= [];
      rowsBySheet[anchor.sheetName].push(anchor.fromRowOneBased);
    }
  }

  return {
    isZipReadable: true,
    mediaCount: mediaEntries.length,
    mediaTypes: groupCount(imageInfos, (image) => image.format ?? "unknown"),
    imageInfos,
    drawingEntries,
    worksheetRelEntries,
    anchorCount: anchors.length,
    anchorsBySheet,
    anchorRowSummary: Object.fromEntries(
      Object.entries(rowsBySheet).map(([sheetName, rows]) => [
        sheetName,
        {
          minRow: Math.min(...rows),
          maxRow: Math.max(...rows),
          distinctRows: new Set(rows).size,
          sampleRows: Array.from(new Set(rows)).slice(0, 20),
        },
      ]),
    ),
    anchorSamples: anchors.slice(0, 20),
  };
}

function analyzeXlsWithSheetJs(filePath: string) {
  try {
    const workbook = XLSX.readFile(filePath, { bookFiles: true, cellStyles: true }) as LooseWorkbook;
    const cfbPaths: string[] = workbook.cfb?.FullPaths ?? [];
    const binaryLike = cfbPaths.filter((entry: string) => /MBD|BLIP|PIC|PICT|JPEG|PNG|ObjInfo|CONTENTS/i.test(entry));
    return {
      sheetJsCfbAvailable: Boolean(workbook.cfb),
      cfbPathCount: cfbPaths.length,
      cfbPathSample: cfbPaths.slice(0, 80),
      binaryLikePaths: binaryLike.slice(0, 80),
      conclusion: binaryLike.length > 0
        ? "SheetJS exposes CFB paths but not image anchors or decoded image bytes."
        : "No obvious decoded image streams exposed by SheetJS.",
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function unzipList(filePath: string): string[] {
  return execFileSync("unzip", ["-Z", "-1", filePath], { encoding: "utf8", maxBuffer: 1024 * 1024 * 20 })
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function unzipBuffer(filePath: string, entry: string): Buffer {
  return execFileSync("unzip", ["-p", filePath, entry], { encoding: "buffer", maxBuffer: 1024 * 1024 * 100 });
}

function readZipText(filePath: string, entry: string): string {
  return unzipBuffer(filePath, entry).toString("utf8");
}

function parseRelationships(xml: string): Relationship[] {
  const relationships: Relationship[] = [];
  const relationshipPattern = /<Relationship\b([^>]*)\/>/g;
  let match;
  while ((match = relationshipPattern.exec(xml))) {
    const attrs = parseXmlAttributes(match[1]);
    relationships.push({
      id: attrs.Id,
      type: attrs.Type ?? "",
      target: attrs.Target ?? "",
    });
  }
  return relationships;
}

function parseDrawingAnchors(xml: string): DrawingAnchor[] {
  const anchors: DrawingAnchor[] = [];
  const anchorPattern = /<xdr:(?:twoCellAnchor|oneCellAnchor)\b[\s\S]*?<\/xdr:(?:twoCellAnchor|oneCellAnchor)>/g;
  let anchorMatch;
  while ((anchorMatch = anchorPattern.exec(xml))) {
    const block = anchorMatch[0];
    const embedRid = block.match(/<a:blip\b[^>]*r:embed="([^"]+)"/)?.[1] ?? null;
    const from = block.match(/<xdr:from>([\s\S]*?)<\/xdr:from>/)?.[1] ?? "";
    const to = block.match(/<xdr:to>([\s\S]*?)<\/xdr:to>/)?.[1] ?? "";
    const fromColZeroBased = readXmlInt(from, "col");
    const fromRowZeroBased = readXmlInt(from, "row");
    const toColZeroBased = readXmlInt(to, "col");
    const toRowZeroBased = readXmlInt(to, "row");
    anchors.push({
      embedRid,
      fromColZeroBased,
      fromRowZeroBased,
      fromColOneBased: fromColZeroBased === null ? null : fromColZeroBased + 1,
      fromRowOneBased: fromRowZeroBased === null ? null : fromRowZeroBased + 1,
      toColOneBased: toColZeroBased === null ? null : toColZeroBased + 1,
      toRowOneBased: toRowZeroBased === null ? null : toRowZeroBased + 1,
    });
  }
  return anchors;
}

function parseXmlAttributes(attrText: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrPattern = /([A-Za-z_:][\w:.-]*)="([^"]*)"/g;
  let match;
  while ((match = attrPattern.exec(attrText))) {
    attrs[match[1]] = match[2];
  }
  return attrs;
}

function readXmlInt(xml: string, tagName: string): number | null {
  const match = xml.match(new RegExp(`<xdr:${tagName}>(\\d+)<\\/xdr:${tagName}>`));
  return match ? Number(match[1]) : null;
}

function normalizeZipPath(zipPath: string): string {
  const parts: string[] = [];
  for (const part of zipPath.split("/")) {
    if (!part || part === ".") {
      continue;
    }
    if (part === "..") {
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.join("/");
}

function detectImageInfo(bytes: Buffer, entry: string): Omit<ImageInfo, "entry" | "bytes"> {
  if (bytes.length >= 24 && bytes.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return {
      format: "png",
      width: bytes.readUInt32BE(16),
      height: bytes.readUInt32BE(20),
    };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = bytes[offset + 1];
      const length = bytes.readUInt16BE(offset + 2);
      if (marker >= 0xc0 && marker <= 0xc3) {
        return {
          format: "jpeg",
          width: bytes.readUInt16BE(offset + 7),
          height: bytes.readUInt16BE(offset + 5),
        };
      }
      offset += 2 + length;
    }
    return { format: "jpeg", width: null, height: null };
  }
  return { format: path.extname(entry).slice(1).toLowerCase() || "unknown", width: null, height: null };
}

function groupCount<T>(items: T[], getKey: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const key = getKey(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

main();
