import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

import { parsePriceValue, readSheetRows, type SheetRows } from "../src/lib/excel-import.ts";
import { extractImagesFromExcel, storeExtractedImage, type ExtractedImage } from "../src/lib/image-extractor.ts";

const prisma = new PrismaClient();

const ROOT = "/Volumes/My Passport/AI 报价/各家工厂最新报价汇总";
const AUDIT_REPORT = "docs/v2.7-import-audit.md";
const BATCH_SIZE = 15;
const mode = process.argv.includes("--apply") ? "apply" : "dry-run";
const runStartedAt = new Date();
const priceUpdatedAtIso = runStartedAt.toISOString();

type ImportEntry = {
  candidateNo: number;
  fileName: string;
  pathIncludes?: string;
  sheetName: string;
  sheetLabel?: string;
  category: string;
  factoryName: string;
  headerRowIndex: number;
  modelColumn: string;
  priceColumn: string;
};

type ImportRow = {
  sourceFileId: string;
  filePath: string;
  sheetName: string;
  category: string;
  modelNo: string;
  productName: string;
  size: string | null;
  remark: string | null;
  factoryName: string;
  purchasePrice: string;
  currency: string;
  moq: string | null;
  ctnQty: string | null;
  ctnLength: string | null;
  ctnWidth: string | null;
  ctnHeight: string | null;
  sourceRowIndex: number;
};

type BuiltEntry = {
  entry: ImportEntry;
  filePath: string;
  sourceFileId: string;
  actualSheetName: string;
  rows: ImportRow[];
  skippedRows: Array<{ rowNumber: number; reason: string }>;
  mapping: DetectedMapping;
};

type DetectedMapping = {
  modelColumnIndex: number;
  priceColumnIndex: number;
  descriptionColumns: number[];
  sizeColumn: number | null;
  moqColumn: number | null;
  ctnQtyColumn: number | null;
  ctnSizeColumn: number | null;
  ctnLengthColumn: number | null;
  ctnWidthColumn: number | null;
  ctnHeightColumn: number | null;
};

type ApplyEntryResult = {
  candidateNo: number;
  fileName: string;
  sheetName: string;
  validRows: number;
  skippedRows: number;
  newProducts: number;
  reusedProducts: number;
  newOffers: number;
  duplicateOffers: number;
  importedImages: number;
  failedImages: number;
  error: string | null;
};

const entries: ImportEntry[] = [
  entry(2, "汇孚集团南美球泡订单询价 2023.9.20.xlsx", "Sheet1", "球泡", "佛山凯徽", 1, "B", "Q"),
  entry(5, "灯丝泡价格 2024.4.14.xlsx", "1", "灯丝灯", "合力", 3, "B", "J"),
  entry(6, "ERP T5 TUBE PRICE-2024.3.21.xlsx", "欧州ERP 灯管", "灯管", "合力", 2, "A", "I"),
  entry(8, "100-265V橄榄灯 2026.5.07 .xls", "防潮灯", "防潮灯", "合力", 5, "A", "J"),
  entry(9, "炬星应急灯管报价单（欧标汇孚林总).xls", "应急灯管", "应急灯", "炬星", 3, "B", "M"),
  entry(11, "核价Emergency Charging Tube - Wellux - 20230310.xlsx", "Sheet1", "应急灯", "名威", 4, "A", "Z"),
  entry(15, "优泽价格产品系列 2023.10.xlsx", "玻璃灯杯", "球泡", "优泽", 2, "B", "G"),
  entry(15, "优泽价格产品系列 2023.10.xlsx", "PAR", "球泡", "优泽", 2, "B", "I"),
  entry(15, "优泽价格产品系列 2023.10.xlsx", "AR111", "球泡", "优泽", 3, "D", "M"),
  entry(15, "优泽价格产品系列 2023.10.xlsx", "R灯", "球泡", "优泽", 5, "C", "L"),
  entry(19, "菱形庭院灯报价含税-202309.xls", "1", "庭院灯", "艾轩", 5, "A", "J"),
  entry(22, "二代五星庭院灯AX-FB-TYD garden light20240316.xls", "1", "庭院灯", "艾轩", 5, "A", "J"),
  { ...entry(23, "云霄庭院灯报价.xlsx", "Sheet1", "庭院灯", "艾轩", 5, "A", "J"), pathIncludes: "202410" },
  entry(25, "汇孚新品庭院小品报价单 2024年10月12日.xls", "1", "庭院灯", "中千", 1, "C", "J"),
  entry(33, "AG-Solar-F-MP floodlight quotation-RMB.xls", "1", "投光灯", "奥光", 8, "C", "M"),
  entry(36, "太阳能系列S3 S5.xlsx", "Solar wall light-S3&S5&S6", "太阳能壁灯", "博登", 3, "A", "O"),
  entry(39, "To 精友 汇孚价格更新20221018.xls", "sheet1", "太阳能壁灯", "精友", 1, "B", "T"),
  entry(41, "羽成太阳能洗墙灯报价表.xlsx", "太阳能洗墙灯", "太阳能壁灯", "羽成", 7, "C", "F"),
  entry(43, "东莞弘磊照明科技有限公司报价表--杭州汇孚.xls", "5-7", "地埋灯/地插灯", "东莞弘磊", 13, "C", "J"),
  entry(45, "Judeng hotselling products RMB 20250214.xlsx", "Outdoor lights", "地埋灯/地插灯", "古镇巨登", 5, "B", "G"),
  entry(47, "盛辉-VIP2210.xlsx", "Sheet1", "地埋灯/地插灯", "盛辉", 1, "A", "V"),
  entry(49, "新概念20221021 汇孚询价(1)(1) 更新价格.xls", "Inground lamp", "地埋灯/地插灯", "新概念", 3, "B", "U"),
  entry(51, "20 size Magic lighting fixture 核价.xlsx", "Magnetic track light", "磁吸灯", "汇盈聚", 3, "B", "I"),
  entry(52, "SI LI汇盈聚（V20）-35-20-16-15-20MINI磁吸报价2023-01-01.xlsx", "35系列灯具", "磁吸灯", "汇盈聚", 9, "C", "J"),
  entry(52, "SI LI汇盈聚（V20）-35-20-16-15-20MINI磁吸报价2023-01-01.xlsx", "20系列灯具", "磁吸灯", "汇盈聚", 9, "C", "J"),
  { ...entry(52, "SI LI汇盈聚（V20）-35-20-16-15-20MINI磁吸报价2023-01-01.xlsx", "20MINI系列灯具 ", "磁吸灯", "汇盈聚", 13, "C", "J"), sheetLabel: "20MINI系列灯具" },
  { ...entry(52, "SI LI汇盈聚（V20）-35-20-16-15-20MINI磁吸报价2023-01-01.xlsx", "16系列灯具  ", "磁吸灯", "汇盈聚", 13, "C", "J"), sheetLabel: "16系列灯具" },
  entry(52, "SI LI汇盈聚（V20）-35-20-16-15-20MINI磁吸报价2023-01-01.xlsx", "电源配件", "磁吸灯", "汇盈聚", 12, "C", "K"),
  { ...entry(57, "核价Magnetic Track System Round Shape - Wellux 20241126.xlsx", "Final Selection ", "磁吸灯", "汇盈聚", 5, "C", "M"), sheetLabel: "Final Selection" },
  entry(58, "中山开启轨道系列报价2021.5.13.xlsx", "Sheet1", "磁吸灯", "中山开启", 6, "D", "O"),
  entry(62, "户外GU10系列--报价单 光极.xlsx", "GU10", "筒灯", "光极", 3, "A", "E"),
  entry(63, "支架面环&模组光源--报价表 光极.xls", "样本册", "筒灯", "光极", 2, "B", "I"),
  { ...entry(64, "2023年5月灯杯支架和灯杯报价.xlsx", "Sheet1", "筒灯", "力音", 11, "B", "D"), sheetLabel: "Sheet1 / 灯杯报价段" },
  entry(65, "360度旋转拆叠轨道灯.xlsx", "Sheet1", "轨道灯", "欧诺", 4, "C", "O"),
  entry(66, "太阳能壁灯2025(X）+(1).xlsx", "太阳能壁灯", "太阳能壁灯", "弘跃", 5, "A", "L"),
  entry(67, "T8 灯管款办公照明报价 2022.3.29 名威.xls", "办公照明", "线条灯", "名威", 8, "A", "K"),
  entry(68, "欣柯技21年6月最新报价-应急球泡.xlsx", "Sheet1", "应急灯", "欣柯技", 2, "C", "D"),
];

function entry(
  candidateNo: number,
  fileName: string,
  sheetName: string,
  category: string,
  factoryName: string,
  headerRowIndex: number,
  modelColumn: string,
  priceColumn: string,
): ImportEntry {
  return { candidateNo, fileName, sheetName, category, factoryName, headerRowIndex, modelColumn, priceColumn };
}

function clean(value: unknown): string {
  return String(value ?? "")
    .normalize("NFC")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactKey(value: string): string {
  return clean(value).replace(/\s+/g, "").toLowerCase();
}

function colIndex(letter: string): number {
  let n = 0;
  for (const char of clean(letter).toUpperCase()) {
    if (char < "A" || char > "Z") continue;
    n = n * 26 + char.charCodeAt(0) - 64;
  }
  if (n < 1) {
    throw new Error(`Invalid column letter: ${letter}`);
  }
  return n - 1;
}

function cellAt(row: string[], columnIndex: number | null): string | null {
  if (columnIndex === null || columnIndex === undefined) return null;
  const value = clean(row[columnIndex]);
  return value || null;
}

function headerAt(rows: SheetRows, headerRowIndex: number, columnIndex: number | null): string {
  if (columnIndex === null || columnIndex === undefined) return "";
  return clean(rows[headerRowIndex - 1]?.[columnIndex]);
}

function isEmptyRow(row: string[]): boolean {
  return row.every((cell) => clean(cell) === "");
}

function isPhotoHeader(header: string): boolean {
  return /photo|picture|image|图片|照片|图\s*片|产品图片/i.test(clean(header));
}

function isNoHeader(header: string): boolean {
  return /^(no\.?|序号|序\s*号)$/i.test(clean(header));
}

function cleanIntegerText(value: string | null): string | null {
  const text = clean(value);
  if (!text) return null;
  const match = text.match(/^[\d,]+/);
  return match ? match[0].replace(/,/g, "") : null;
}

function cleanDimensionText(value: string | null): string | null {
  const match = clean(value).replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  return match ? match[0] : null;
}

function parseCtnSize(value: string | null): { length: string | null; width: string | null; height: string | null } {
  const raw = clean(value);
  if (!raw) return { length: null, width: null, height: null };
  const parts = raw.replace(/\s*(cm|厘米|mm)\s*$/i, "").split(/\s*[×xX*]\s*/).map(cleanDimensionText);
  if (parts.length !== 3 || parts.some((part) => !part)) {
    return { length: null, width: null, height: null };
  }
  return { length: parts[0], width: parts[1], height: parts[2] };
}

function buildColumns(rows: SheetRows, headerRowIndex: number): Array<{ index: number; header: string }> {
  const header = rows[headerRowIndex - 1] ?? [];
  const maxColumns = Math.max(...rows.map((row) => row.length), header.length, 0);
  return Array.from({ length: maxColumns }, (_, index) => ({ index, header: clean(header[index]) }));
}

function findColumn(columns: Array<{ index: number; header: string }>, tests: RegExp[]): number | null {
  for (const test of tests) {
    const found = columns.find((column) => test.test(column.header));
    if (found) return found.index;
  }
  return null;
}

function findAllColumns(columns: Array<{ index: number; header: string }>, tests: RegExp[]): number[] {
  return columns.filter((column) => tests.some((test) => test.test(column.header))).map((column) => column.index);
}

function detectOptionalMapping(rows: SheetRows, entryItem: ImportEntry): DetectedMapping {
  const columns = buildColumns(rows, entryItem.headerRowIndex);
  const modelColumnIndex = colIndex(entryItem.modelColumn);
  const priceColumnIndex = colIndex(entryItem.priceColumn);
  const excluded = new Set([modelColumnIndex, priceColumnIndex]);
  const rawDescriptionColumns = findAllColumns(columns, [
    /description/i,
    /details/i,
    /spec/i,
    /power|watt/i,
    /voltage/i,
    /cct/i,
    /lumen|flux/i,
    /material/i,
    /warranty/i,
    /base/i,
    /beam/i,
    /pf/i,
    /cri/i,
    /参数/,
    /描述/,
    /功率/,
    /电压/,
    /色温/,
    /光通/,
    /材质/,
    /质保/,
    /底座/,
    /灯头/,
    /工作模式/,
    /功能/,
    /配置/,
    /驱动/,
    /显指/,
    /光效/,
  ]);

  const descriptionColumns = [...new Set(rawDescriptionColumns)]
    .filter((columnIndex) => {
      const header = headerAt(rows, entryItem.headerRowIndex, columnIndex);
      return header && !excluded.has(columnIndex) && !isPhotoHeader(header) && !isNoHeader(header);
    })
    .slice(0, 12);

  return {
    modelColumnIndex,
    priceColumnIndex,
    descriptionColumns,
    sizeColumn: findColumn(columns, [/^size$/i, /dimension/i, /product size/i, /尺寸/, /规格/]),
    moqColumn: findColumn(columns, [/moq/i, /起订/, /最小起订/]),
    ctnQtyColumn: findColumn(columns, [/ctn.*qty/i, /qty.*ctn/i, /pcs.*ctn/i, /装箱/, /每箱/, /外箱.*数量/, /case pack/i]),
    ctnSizeColumn: findColumn(columns, [/carton.*size/i, /ctn.*size/i, /outer.*box/i, /箱规/, /外箱.*尺寸/, /包装.*尺寸/, /纸箱.*尺寸/]),
    ctnLengthColumn: findColumn(columns, [/^l$/i, /^length$/i, /ctn l/i, /carton.*l/i, /^长$/, /长度/]),
    ctnWidthColumn: findColumn(columns, [/^w$/i, /^width$/i, /ctn w/i, /carton.*w/i, /^宽$/, /宽度/]),
    ctnHeightColumn: findColumn(columns, [/^h$/i, /^height$/i, /ctn h/i, /carton.*h/i, /^高$/, /高度/]),
  };
}

function mergeDescription(row: string[], rows: SheetRows, headerRowIndex: number, columns: number[]): string | null {
  const parts: string[] = [];
  for (const columnIndex of columns) {
    const value = cellAt(row, columnIndex);
    if (!value) continue;
    const label = headerAt(rows, headerRowIndex, columnIndex) || `列 ${columnIndex + 1}`;
    parts.push(`${label}: ${value}`);
  }
  return parts.length > 0 ? parts.join("\n") : null;
}

function readCtnDimensions(row: string[], mapping: DetectedMapping) {
  const direct = {
    length: cleanDimensionText(cellAt(row, mapping.ctnLengthColumn)),
    width: cleanDimensionText(cellAt(row, mapping.ctnWidthColumn)),
    height: cleanDimensionText(cellAt(row, mapping.ctnHeightColumn)),
  };
  if (direct.length && direct.width && direct.height) return direct;
  return parseCtnSize(cellAt(row, mapping.ctnSizeColumn));
}

async function walkExcel(root: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(dir: string) {
    const dirents = await fs.readdir(dir, { withFileTypes: true });
    for (const dirent of dirents) {
      if (dirent.name.startsWith(".")) continue;
      const fullPath = path.join(dir, dirent.name).normalize("NFC");
      if (dirent.isDirectory()) {
        await walk(fullPath);
      } else if (dirent.isFile() && /\.(xlsx|xls)$/i.test(dirent.name) && !dirent.name.startsWith("._")) {
        files.push(fullPath);
      }
    }
  }
  await walk(root);
  return files;
}

let excelFileCache: string[] | null = null;

async function locateFile(entryItem: ImportEntry): Promise<string> {
  excelFileCache ??= await walkExcel(ROOT);
  const target = compactKey(entryItem.fileName);
  const matches = excelFileCache
    .filter((filePath) => compactKey(path.basename(filePath)) === target)
    .filter((filePath) => !entryItem.pathIncludes || filePath.includes(entryItem.pathIncludes));
  if (matches.length === 0) {
    throw new Error(`找不到文件: ${entryItem.fileName}`);
  }
  if (matches.length > 1) {
    throw new Error(`文件名重复，无法安全导入: ${entryItem.fileName}`);
  }
  return matches[0];
}

async function ensureFileRecord(filePath: string, entryItem: ImportEntry) {
  const existingByPath = await prisma.file.findFirst({ where: { absolutePathSnapshot: filePath } });
  if (existingByPath) return existingByPath;

  const stat = await fs.stat(filePath);
  const relativePath = path.relative(ROOT, filePath).normalize("NFC");
  const data = {
    fileName: path.basename(filePath).normalize("NFC"),
    fileType: "excel",
    fileSize: BigInt(stat.size),
    folderName: entryItem.category,
    factoryGuess: entryItem.factoryName,
    volumeName: "My Passport",
    relativePath,
    absolutePathSnapshot: filePath,
    modifiedAt: stat.mtime,
  };

  const existingByRelative = await prisma.file.findUnique({
    where: { volumeName_relativePath: { volumeName: data.volumeName, relativePath: data.relativePath } },
  });
  if (existingByRelative) return existingByRelative;

  return prisma.file.create({ data });
}

async function buildEntry(entryItem: ImportEntry, options: { persistFileRecord?: boolean } = {}): Promise<BuiltEntry> {
  const filePath = await locateFile(entryItem);
  const file = options.persistFileRecord === false ? { id: `dry-run:${entryItem.candidateNo}:${entryItem.sheetName}` } : await ensureFileRecord(filePath, entryItem);
  const rows = readSheetRows(filePath, entryItem.sheetName);
  const mapping = detectOptionalMapping(rows, entryItem);
  const importRows: ImportRow[] = [];
  const skippedRows: Array<{ rowNumber: number; reason: string }> = [];

  for (let rowIndex = entryItem.headerRowIndex; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    const rowNumber = rowIndex + 1;
    if (isEmptyRow(row)) continue;

    const modelNo = cellAt(row, mapping.modelColumnIndex);
    const purchasePrice = parsePriceValue(cellAt(row, mapping.priceColumnIndex));

    if (!modelNo) {
      skippedRows.push({ rowNumber, reason: "缺少产品款号" });
      continue;
    }
    if (!purchasePrice) {
      skippedRows.push({ rowNumber, reason: "价格列非有效数字" });
      continue;
    }

    const ctnDimensions = readCtnDimensions(row, mapping);
    importRows.push({
      sourceFileId: file.id,
      filePath,
      sheetName: entryItem.sheetName,
      category: entryItem.category,
      modelNo,
      productName: modelNo,
      size: cellAt(row, mapping.sizeColumn),
      remark: mergeDescription(row, rows, entryItem.headerRowIndex, mapping.descriptionColumns),
      factoryName: entryItem.factoryName,
      purchasePrice,
      currency: "RMB",
      moq: cellAt(row, mapping.moqColumn),
      ctnQty: cleanIntegerText(cellAt(row, mapping.ctnQtyColumn)),
      ctnLength: ctnDimensions.length,
      ctnWidth: ctnDimensions.width,
      ctnHeight: ctnDimensions.height,
      sourceRowIndex: rowNumber - 1,
    });
  }

  return {
    entry: entryItem,
    filePath,
    sourceFileId: file.id,
    actualSheetName: entryItem.sheetName,
    rows: importRows,
    skippedRows,
    mapping,
  };
}

async function importBuiltEntry(built: BuiltEntry): Promise<ApplyEntryResult> {
  const result: ApplyEntryResult = {
    candidateNo: built.entry.candidateNo,
    fileName: built.entry.fileName,
    sheetName: built.entry.sheetLabel ?? built.entry.sheetName,
    validRows: built.rows.length,
    skippedRows: built.skippedRows.length,
    newProducts: 0,
    reusedProducts: 0,
    newOffers: 0,
    duplicateOffers: 0,
    importedImages: 0,
    failedImages: 0,
    error: null,
  };
  const productIdByModelNo = new Map<string, string>();
  const seenOfferKeys = new Set<string>();

  await prisma.$transaction(async (tx) => {
    for (const row of built.rows) {
      let productId = productIdByModelNo.get(row.modelNo);
      if (!productId) {
        const existingProduct = await tx.product.findFirst({
          where: { modelNo: row.modelNo },
          orderBy: [{ createdAt: "asc" }],
        });

        if (existingProduct) {
          productId = existingProduct.id;
          result.reusedProducts += 1;
        } else {
          const createdProduct = await tx.product.create({
            data: {
              productName: row.productName,
              category: row.category,
              modelNo: row.modelNo,
              material: null,
              size: row.size,
              imagePath: null,
              remark: row.remark,
            },
          });
          productId = createdProduct.id;
          result.newProducts += 1;
        }
        productIdByModelNo.set(row.modelNo, productId);
      }

      const offerKey = `${productId}::${row.factoryName}`;
      if (seenOfferKeys.has(offerKey)) {
        result.duplicateOffers += 1;
        continue;
      }
      seenOfferKeys.add(offerKey);

      const existingOffer = await tx.supplierOffer.findFirst({
        where: { productId, factoryName: row.factoryName },
        select: { id: true },
      });
      if (existingOffer) {
        result.duplicateOffers += 1;
        continue;
      }

      await tx.$executeRaw`
        INSERT INTO supplier_offers (
          id,
          product_id,
          factory_name,
          purchase_price,
          currency,
          moq,
          ctn_qty,
          ctn_length,
          ctn_width,
          ctn_height,
          lead_time,
          source_file_id,
          remark,
          price_updated_at
        )
        VALUES (
          ${randomUUID()},
          ${productId},
          ${row.factoryName},
          ${row.purchasePrice},
          ${row.currency},
          ${row.moq},
          ${row.ctnQty},
          ${row.ctnLength},
          ${row.ctnWidth},
          ${row.ctnHeight},
          ${null},
          ${row.sourceFileId},
          ${null},
          ${priceUpdatedAtIso}
        )
      `;
      result.newOffers += 1;
    }
  });

  const imageResult = await attachImages(built, productIdByModelNo);
  result.importedImages = imageResult.importedImages;
  result.failedImages = imageResult.failedImages;

  return result;
}

async function attachImages(
  built: BuiltEntry,
  productIdByModelNo: Map<string, string>,
): Promise<{ importedImages: number; failedImages: number }> {
  const products = uniqueRowsByModelNo(built.rows)
    .map((row) => {
      const productId = productIdByModelNo.get(row.modelNo);
      return productId ? { ...row, productId } : null;
    })
    .filter((row): row is ImportRow & { productId: string } => Boolean(row));
  if (products.length === 0) {
    return { importedImages: 0, failedImages: 0 };
  }

  let extractedImages: ExtractedImage[];
  try {
    extractedImages = await extractImagesFromExcel(built.filePath, built.actualSheetName);
  } catch {
    return { importedImages: 0, failedImages: 1 };
  }
  if (extractedImages.length === 0) {
    return { importedImages: 0, failedImages: 0 };
  }

  const imageByRow = new Map<number, ExtractedImage>();
  for (const image of extractedImages) {
    if (!imageByRow.has(image.anchorRow)) {
      imageByRow.set(image.anchorRow, image);
    }
  }

  const existingProducts = await prisma.product.findMany({
    where: { id: { in: products.map((product) => product.productId) } },
    select: { id: true, imagePath: true },
  });
  const existingImageByProductId = new Map(existingProducts.map((product) => [product.id, product.imagePath]));
  let importedImages = 0;
  let failedImages = 0;

  for (const product of products) {
    if (existingImageByProductId.get(product.productId)) {
      continue;
    }
    const image = imageByRow.get(product.sourceRowIndex);
    if (!image) {
      continue;
    }
    try {
      const storedImage = await storeExtractedImage({
        image,
        sourceFileId: built.sourceFileId,
        sheetName: built.actualSheetName,
      });
      await prisma.product.update({
        where: { id: product.productId },
        data: { imagePath: storedImage.thumbnailPath },
      });
      existingImageByProductId.set(product.productId, storedImage.thumbnailPath);
      importedImages += 1;
    } catch {
      failedImages += 1;
    }
  }

  return { importedImages, failedImages };
}

function uniqueRowsByModelNo(rows: ImportRow[]): ImportRow[] {
  const seen = new Set<string>();
  const out: ImportRow[] = [];
  for (const row of rows) {
    if (seen.has(row.modelNo)) continue;
    seen.add(row.modelNo);
    out.push(row);
  }
  return out;
}

function addResults(target: ApplyEntryResult, source: ApplyEntryResult) {
  target.validRows += source.validRows;
  target.skippedRows += source.skippedRows;
  target.newProducts += source.newProducts;
  target.reusedProducts += source.reusedProducts;
  target.newOffers += source.newOffers;
  target.duplicateOffers += source.duplicateOffers;
  target.importedImages += source.importedImages;
  target.failedImages += source.failedImages;
}

function emptyBatchResult(label: string): ApplyEntryResult {
  return {
    candidateNo: 0,
    fileName: label,
    sheetName: "",
    validRows: 0,
    skippedRows: 0,
    newProducts: 0,
    reusedProducts: 0,
    newOffers: 0,
    duplicateOffers: 0,
    importedImages: 0,
    failedImages: 0,
    error: null,
  };
}

async function countTables() {
  const [products, supplierOffers, files] = await Promise.all([
    prisma.product.count(),
    prisma.supplierOffer.count(),
    prisma.file.count(),
  ]);
  return { products, supplierOffers, files };
}

async function runApply() {
  const backupPath = "backups/dev-before-v2.7-20260609.sqlite";
  if (!existsSync(backupPath)) {
    throw new Error(`Required backup missing: ${backupPath}`);
  }

  const beforeCounts = await countTables();
  const beforeCategories = await productCategories();
  const allResults: ApplyEntryResult[] = [];
  const batchResults: ApplyEntryResult[] = [];

  for (let start = 0; start < entries.length; start += BATCH_SIZE) {
    const batch = entries.slice(start, start + BATCH_SIZE);
    const batchSummary = emptyBatchResult(`Batch ${batchResults.length + 1}`);

    for (const entryItem of batch) {
      try {
        const built = await buildEntry(entryItem);
        const result = await importBuiltEntry(built);
        allResults.push(result);
        addResults(batchSummary, result);
      } catch (error) {
        const failed: ApplyEntryResult = {
          candidateNo: entryItem.candidateNo,
          fileName: entryItem.fileName,
          sheetName: entryItem.sheetLabel ?? entryItem.sheetName,
          validRows: 0,
          skippedRows: 0,
          newProducts: 0,
          reusedProducts: 0,
          newOffers: 0,
          duplicateOffers: 0,
          importedImages: 0,
          failedImages: 0,
          error: error instanceof Error ? error.message : String(error),
        };
        allResults.push(failed);
        batchSummary.error = [batchSummary.error, failed.error].filter(Boolean).join("; ") || null;
      }
    }

    batchResults.push(batchSummary);
    console.log(
      JSON.stringify(
        {
          batch: batchResults.length,
          entries: batch.length,
          newProducts: batchSummary.newProducts,
          newOffers: batchSummary.newOffers,
          duplicateOffers: batchSummary.duplicateOffers,
          importedImages: batchSummary.importedImages,
          failedImages: batchSummary.failedImages,
          errors: batchSummary.error || null,
        },
        null,
        2,
      ),
    );
  }

  const afterCounts = await countTables();
  const afterCategories = await productCategories();
  const audit = await buildAudit({
    beforeCounts,
    afterCounts,
    beforeCategories,
    afterCategories,
    entryResults: allResults,
    batchResults,
  });
  await fs.writeFile(AUDIT_REPORT, audit, "utf8");

  console.log(
    JSON.stringify(
      {
        mode,
        entries: entries.length,
        beforeCounts,
        afterCounts,
        report: AUDIT_REPORT,
      },
      null,
      2,
    ),
  );
}

async function productCategories(): Promise<Set<string>> {
  const rows = await prisma.product.findMany({
    distinct: ["category"],
    select: { category: true },
  });
  return new Set(rows.map((row) => row.category).filter((value): value is string => Boolean(value)));
}

async function buildAudit({
  beforeCounts,
  afterCounts,
  beforeCategories,
  afterCategories,
  entryResults,
  batchResults,
}: {
  beforeCounts: { products: number; supplierOffers: number; files: number };
  afterCounts: { products: number; supplierOffers: number; files: number };
  beforeCategories: Set<string>;
  afterCategories: Set<string>;
  entryResults: ApplyEntryResult[];
  batchResults: ApplyEntryResult[];
}): Promise<string> {
  const newCategories = [...afterCategories].filter((category) => !beforeCategories.has(category)).sort();
  const byCategory = await prisma.product.groupBy({
    by: ["category"],
    _count: { _all: true },
    orderBy: { _count: { category: "desc" } },
  });
  const importedOfferStats = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN ctn_qty IS NOT NULL AND ctn_qty != '' THEN 1 ELSE 0 END) as has_ctn_qty,
      SUM(CASE WHEN ctn_length IS NOT NULL AND ctn_length != '' AND ctn_width IS NOT NULL AND ctn_width != '' AND ctn_height IS NOT NULL AND ctn_height != '' THEN 1 ELSE 0 END) as has_lwh,
      SUM(CASE WHEN price_updated_at IS NOT NULL THEN 1 ELSE 0 END) as has_price_timestamp
    FROM supplier_offers
    WHERE price_updated_at = ${priceUpdatedAtIso}
  `;
  const priceAnomalies = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT so.id, p.model_no, p.category, so.factory_name, so.purchase_price, so.currency
    FROM supplier_offers so
    JOIN products p ON p.id = so.product_id
    WHERE so.price_updated_at = ${priceUpdatedAtIso}
      AND (so.purchase_price <= 0 OR so.purchase_price > 10000)
    ORDER BY so.purchase_price DESC
    LIMIT 50
  `;
  const newProducts = await prisma.product.findMany({
    where: { createdAt: { gte: runStartedAt } },
    select: { id: true, modelNo: true, productName: true, category: true },
    orderBy: { createdAt: "asc" },
  });
  const modelAnomalies = newProducts.filter((product) => {
    const modelNo = clean(product.modelNo);
    return !modelNo || /^\d+$/.test(modelNo) || modelNo.length < 3;
  });
  const duplicateModelRows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT model_no, COUNT(*) as cnt
    FROM products
    WHERE model_no IS NOT NULL AND TRIM(model_no) != ''
    GROUP BY model_no
    HAVING cnt > 1
    ORDER BY cnt DESC, model_no
    LIMIT 50
  `;
  const duplicateOfferRows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT p.model_no, so.factory_name, COUNT(*) as cnt
    FROM supplier_offers so
    JOIN products p ON p.id = so.product_id
    GROUP BY p.model_no, so.factory_name
    HAVING cnt > 1
    ORDER BY cnt DESC, p.model_no
    LIMIT 50
  `;

  const totals = entryResults.reduce((acc, result) => {
    addResults(acc, result);
    return acc;
  }, emptyBatchResult("total"));
  const errorRows = entryResults.filter((result) => result.error);
  const imageSuccess = entryResults.reduce((sum, result) => sum + result.importedImages, 0);
  const imageFailed = entryResults.reduce((sum, result) => sum + result.failedImages, 0);
  const importedOfferStatsRow = importedOfferStats[0] ?? {};

  const lines: string[] = [];
  lines.push("# V2.7 Import Audit");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("## Scope");
  lines.push("");
  lines.push("- Source: `/Volumes/My Passport/AI 报价/各家工厂最新报价汇总`");
  lines.push("- Import path: 核价导入 style, direct to `products` + `supplier_offers`");
  lines.push("- Source Excel files: read-only; no move/delete/rename/write");
  lines.push("- Applied entries: 37 planned sheet/section entries");
  lines.push("");
  lines.push("## Backup");
  lines.push("");
  lines.push("- Confirmed before apply: `backups/dev-before-v2.7-20260609.sqlite`");
  lines.push("");
  lines.push("## Apply Summary");
  lines.push("");
  lines.push("| Metric | Before | After | Delta |");
  lines.push("|---|---:|---:|---:|");
  lines.push(`| Products | ${beforeCounts.products} | ${afterCounts.products} | ${afterCounts.products - beforeCounts.products} |`);
  lines.push(`| Supplier offers | ${beforeCounts.supplierOffers} | ${afterCounts.supplierOffers} | ${afterCounts.supplierOffers - beforeCounts.supplierOffers} |`);
  lines.push(`| Files | ${beforeCounts.files} | ${afterCounts.files} | ${afterCounts.files - beforeCounts.files} |`);
  lines.push("");
  lines.push("| Import metric | Count |");
  lines.push("|---|---:|");
  lines.push(`| Valid rows read | ${totals.validRows} |`);
  lines.push(`| Skipped rows | ${totals.skippedRows} |`);
  lines.push(`| New products created | ${totals.newProducts} |`);
  lines.push(`| Existing products reused | ${totals.reusedProducts} |`);
  lines.push(`| New supplier offers created | ${totals.newOffers} |`);
  lines.push(`| Duplicate offers skipped | ${totals.duplicateOffers} |`);
  lines.push(`| Failed entries | ${errorRows.length} |`);
  lines.push("");
  lines.push("## Batch Results");
  lines.push("");
  lines.push("| Batch | New products | New offers | Duplicate offers | Images | Image failures | Errors |");
  lines.push("|---:|---:|---:|---:|---:|---:|---|");
  batchResults.forEach((result, index) => {
    lines.push(`| ${index + 1} | ${result.newProducts} | ${result.newOffers} | ${result.duplicateOffers} | ${result.importedImages} | ${result.failedImages} | ${md(result.error ?? "-")} |`);
  });
  lines.push("");
  lines.push("## Entry Results");
  lines.push("");
  lines.push("| # | File | Sheet | Valid | Skipped | New products | New offers | Duplicates | Images | Error |");
  lines.push("|---:|---|---|---:|---:|---:|---:|---:|---:|---|");
  entryResults.forEach((result) => {
    lines.push(`| ${result.candidateNo} | ${md(result.fileName)} | ${md(result.sheetName)} | ${result.validRows} | ${result.skippedRows} | ${result.newProducts} | ${result.newOffers} | ${result.duplicateOffers} | ${result.importedImages} | ${md(result.error ?? "-")} |`);
  });
  lines.push("");
  lines.push("## New Categories");
  lines.push("");
  lines.push(newCategories.length > 0 ? newCategories.map((category) => `- ${category}`).join("\n") : "- None");
  lines.push("");
  lines.push("## Product Count By Category");
  lines.push("");
  lines.push("| Category | Products |");
  lines.push("|---|---:|");
  for (const row of byCategory) {
    lines.push(`| ${md(row.category ?? "(null)")} | ${Number(row._count._all)} |`);
  }
  lines.push("");
  lines.push("## Imported Offer Coverage");
  lines.push("");
  lines.push(`- Imported offers: ${Number(importedOfferStatsRow.total ?? 0)}`);
  lines.push(`- CTN Qty coverage: ${Number(importedOfferStatsRow.has_ctn_qty ?? 0)}`);
  lines.push(`- L/W/H coverage: ${Number(importedOfferStatsRow.has_lwh ?? 0)}`);
  lines.push(`- Price timestamp coverage: ${Number(importedOfferStatsRow.has_price_timestamp ?? 0)}`);
  lines.push("");
  lines.push("## Price Anomalies");
  lines.push("");
  if (priceAnomalies.length === 0) {
    lines.push("- None among V2.7 imported offers.");
  } else {
    lines.push("| Model | Category | Factory | Purchase price | Currency |");
    lines.push("|---|---|---|---:|---|");
    for (const row of priceAnomalies) {
      lines.push(`| ${md(row.model_no)} | ${md(row.category)} | ${md(row.factory_name)} | ${String(row.purchase_price)} | ${md(row.currency)} |`);
    }
  }
  lines.push("");
  lines.push("## Model Anomalies");
  lines.push("");
  if (modelAnomalies.length === 0) {
    lines.push("- None among V2.7 newly created products.");
  } else {
    lines.push("| Model | Product name | Category | Reason |");
    lines.push("|---|---|---|---|");
    for (const product of modelAnomalies.slice(0, 50)) {
      const modelNo = clean(product.modelNo);
      const reasons = [
        !modelNo ? "empty" : null,
        /^\d+$/.test(modelNo) ? "pure numeric" : null,
        modelNo && modelNo.length < 3 ? "too short" : null,
      ].filter(Boolean).join(", ");
      lines.push(`| ${md(product.modelNo ?? "")} | ${md(product.productName)} | ${md(product.category ?? "")} | ${md(reasons)} |`);
    }
  }
  lines.push("");
  lines.push("## Duplicate Checks");
  lines.push("");
  lines.push("### Duplicate product model_no");
  lines.push("");
  if (duplicateModelRows.length === 0) {
    lines.push("- None in full product table.");
  } else {
    lines.push("| model_no | count |");
    lines.push("|---|---:|");
    for (const row of duplicateModelRows) {
      lines.push(`| ${md(row.model_no)} | ${Number(row.cnt)} |`);
    }
  }
  lines.push("");
  lines.push("### Duplicate model_no + factory_name offers");
  lines.push("");
  if (duplicateOfferRows.length === 0) {
    lines.push("- None in full supplier_offers table.");
  } else {
    lines.push("| model_no | factory | count |");
    lines.push("|---|---|---:|");
    for (const row of duplicateOfferRows) {
      lines.push(`| ${md(row.model_no)} | ${md(row.factory_name)} | ${Number(row.cnt)} |`);
    }
  }
  lines.push("");
  lines.push("## Image Extraction");
  lines.push("");
  lines.push(`- Imported images: ${imageSuccess}`);
  lines.push(`- Failed image extractions/stores: ${imageFailed}`);
  lines.push("- Image extraction failures do not block data import.");
  lines.push("");
  lines.push("## Errors");
  lines.push("");
  if (errorRows.length === 0) {
    lines.push("- None. All planned entries completed.");
  } else {
    lines.push("| # | File | Sheet | Error |");
    lines.push("|---:|---|---|---|");
    for (const row of errorRows) {
      lines.push(`| ${row.candidateNo} | ${md(row.fileName)} | ${md(row.sheetName)} | ${md(row.error ?? "")} |`);
    }
  }
  lines.push("");
  lines.push("## Decision");
  lines.push("");
  lines.push(errorRows.length === 0 ? "V2.7 Step 3 apply and Step 4 audit completed." : "V2.7 apply completed with skipped failed entries. Review errors above.");

  return lines.join("\n");
}

function md(value: unknown): string {
  return clean(value).replaceAll("|", "\\|");
}

async function runDryRun() {
  const beforeCounts = await countTables();
  let validRows = 0;
  let skippedRows = 0;
  for (const entryItem of entries) {
    let built: BuiltEntry;
    try {
      built = await buildEntry(entryItem, { persistFileRecord: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`#${entryItem.candidateNo} ${entryItem.fileName} / ${entryItem.sheetName}: ${message}`);
    }
    validRows += built.rows.length;
    skippedRows += built.skippedRows.length;
  }
  console.log(JSON.stringify({ mode, entries: entries.length, validRows, skippedRows, beforeCounts }, null, 2));
}

async function main() {
  if (mode === "apply") {
    await runApply();
  } else {
    await runDryRun();
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
