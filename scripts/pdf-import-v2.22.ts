import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { copyFile } from "node:fs/promises";
import path from "node:path";

import { PrismaClient } from "@prisma/client";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

import { PDF_IMPORT_PROFILES, type PdfImportProfile } from "./pdf-import-profiles";
import { upsertSupplierOffer, type SupplierOfferUpsertClient } from "../src/lib/supplier-offer-upsert";

type Mode = "dry-run" | "apply";

type TextItem = {
  page: number;
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

type TableRow = {
  page: number;
  y: number;
  cells: TextItem[];
  values: string[];
};

type ImportRecord = {
  profileId: string;
  rowIndex: number;
  productName: string;
  modelNo: string;
  category: string;
  factoryName: string;
  purchasePrice: number;
  currency: "RMB";
  moq: string | null;
  size: string | null;
  material: string | null;
  remark: string | null;
  sourceFilePath: string;
  rawValues: string[];
};

type SkippedRow = {
  rowIndex: number;
  reason: string;
  rawValues: string[];
};

type ColumnMapping = {
  field: string;
  headerText: string;
  columnIndex: number;
};

type ParsedProfile = {
  profile: PdfImportProfile;
  fileExists: boolean;
  fileSizeKb: number;
  totalPages: number;
  analyzedPages: number;
  rowsParsed: number;
  columnMappings: ColumnMapping[];
  records: ImportRecord[];
  skippedRows: SkippedRow[];
  error: string | null;
};

type RecordPlanStatus = "new product" | "new offer" | "price update" | "unchanged";

type RecordPlan = ImportRecord & {
  status: RecordPlanStatus;
  existingProductId: string | null;
  existingOfferId: string | null;
  oldPrice: number | null;
};

type ProfileRunResult = ParsedProfile & {
  sourceFileId: string | null;
  plannedRecords: RecordPlan[];
  existingProducts: number;
  newProducts: number;
  newOffers: number;
  updatedOffers: number;
  unchangedOffers: number;
  priceHistory: number;
  priceRange: string;
  warning: string | null;
};

type Counts = {
  products: number;
  supplierOffers: number;
  priceHistory: number;
};

const prisma = new PrismaClient();
const ROOT = "/Volumes/My Passport/AI 报价/各家工厂最新报价汇总";
const VOLUME_NAME = "My Passport";
const BACKUP_DIR = "backups";
const DRY_RUN_REPORT_PATH = "docs/v2.22-pdf-import-dryrun.md";
const APPLY_REPORT_PATH = "docs/v2.22-pdf-import-result.md";
const PRICE_MIN = 0.01;
const PRICE_MAX = 50_000;
const runStartedAt = new Date();

function normalizeText(value: string): string {
  return value.normalize("NFC").replace(/\s+/g, " ").trim();
}

function escapeMd(value: string | null | undefined): string {
  if (!value) return "-";
  return value.replace(/\|/g, "\\|").replace(/\n/g, "<br>");
}

function parseArgs(): { mode: Mode; profileId: string | null } {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const dryRun = args.includes("--dry-run");
  const profileFlag = args.find((arg) => arg.startsWith("--profile="));
  const profileIndex = args.indexOf("--profile");
  const profileId = profileFlag?.split("=")[1] ?? (profileIndex >= 0 ? args[profileIndex + 1] : null);

  if (apply && dryRun) {
    throw new Error("Use either --dry-run or --apply, not both.");
  }

  return { mode: apply ? "apply" : "dry-run", profileId };
}

async function extractPdfRows(profile: PdfImportProfile): Promise<{
  rows: TableRow[];
  totalPages: number;
  analyzedPages: number;
  fileSizeKb: number;
}> {
  const absolutePath = path.join(ROOT, profile.relativePath);
  const fileSizeKb = Math.round((statSync(absolutePath).size / 1024) * 10) / 10;
  const pdfBytes = new Uint8Array(readFileSync(absolutePath));
  const task = getDocument({
    data: pdfBytes,
    disableWorker: true,
    useSystemFonts: true,
    stopAtErrors: false,
  });
  const pdf = await task.promise;
  const totalPages = pdf.numPages;
  const pages = profile.pages ?? Array.from({ length: Math.min(totalPages, 20) }, (_, index) => index + 1);
  const items: TextItem[] = [];

  for (const pageNumber of pages) {
    if (pageNumber < 1 || pageNumber > totalPages) continue;
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();

    for (const rawItem of content.items) {
      const item = rawItem as {
        str?: string;
        transform?: number[];
        width?: number;
        height?: number;
      };
      const value = normalizeText(item.str ?? "");
      if (!value || !item.transform) continue;

      items.push({
        page: pageNumber,
        str: value,
        x: Number(item.transform[4] ?? 0),
        y: Number(item.transform[5] ?? 0),
        width: Number(item.width ?? 0),
        height: Number(item.height ?? 0),
      });
    }
  }

  await task.destroy();

  return {
    rows: groupRows(items, profile.yTolerance ?? 2),
    totalPages,
    analyzedPages: pages.length,
    fileSizeKb,
  };
}

function groupRows(items: TextItem[], tolerance: number): TableRow[] {
  const rowsByPage = new Map<number, TextItem[]>();
  for (const item of items) {
    const pageItems = rowsByPage.get(item.page) ?? [];
    pageItems.push(item);
    rowsByPage.set(item.page, pageItems);
  }

  const rows: TableRow[] = [];
  for (const [page, pageItems] of [...rowsByPage.entries()].sort((a, b) => a[0] - b[0])) {
    const buckets: TextItem[][] = [];

    for (const item of [...pageItems].sort((a, b) => b.y - a.y)) {
      const bucket = buckets.find((existing) => Math.abs(existing[0].y - item.y) <= tolerance);
      if (bucket) {
        bucket.push(item);
      } else {
        buckets.push([item]);
      }
    }

    for (const bucket of buckets) {
      const cells = bucket
        .filter((item) => normalizeText(item.str))
        .sort((a, b) => a.x - b.x);
      if (cells.length === 0) continue;
      rows.push({
        page,
        y: cells.reduce((sum, item) => sum + item.y, 0) / cells.length,
        cells,
        values: cells.map((item) => normalizeText(item.str)),
      });
    }
  }

  return rows;
}

function parseProfileRows(profile: PdfImportProfile, rows: TableRow[]): {
  records: ImportRecord[];
  skippedRows: SkippedRow[];
  columnMappings: ColumnMapping[];
} {
  switch (profile.parser) {
    case "puya-g4g9":
      return parsePuyaG4G9(profile, rows);
    case "puzhao-fangchao":
      return parsePuzhaoFangchao(profile, rows);
    case "puzhao-sanfang":
      return parsePuzhaoSanfang(profile, rows);
    case "jielaite-fan":
      return parseJielaiteFan(profile, rows);
  }
}

function parsePuyaG4G9(profile: PdfImportProfile, rows: TableRow[]): ReturnType<typeof parseProfileRows> {
  const records: ImportRecord[] = [];
  const skippedRows: SkippedRow[] = [];
  const columnMappings = [
    { field: "modelNo", headerText: "型号", columnIndex: 4 },
    { field: "purchasePrice", headerText: "含税裸灯报价 / 裸灯含税报价", columnIndex: 11 },
    { field: "wattage", headerText: "功率（W）", columnIndex: 6 },
    { field: "size", headerText: "尺寸", columnIndex: 3 },
    { field: "remark", headerText: "产品类型 + 色温 + 光通量", columnIndex: 2 },
  ];

  rows.forEach((row, index) => {
    const modelCellIndex = row.values.findIndex((value) => isLikelyModelNo(value));
    if (modelCellIndex < 0) {
      if (isPotentialDataRow(row.values)) skippedRows.push(skip(index, "缺少产品型号", row.values));
      return;
    }

    const modelNo = cleanModelNo(row.values[modelCellIndex]);
    if (!modelNo || !isValidModelNo(modelNo)) {
      skippedRows.push(skip(index, "产品型号无效", row.values));
      return;
    }

    const sameRowPrice = parsePrice(row.values[row.values.length - 1]);
    const nextRow = rows[index + 1]?.values ?? [];
    const nextRowPrice = nextRow.length === 1 ? parsePrice(nextRow[0]) : null;
    const price = sameRowPrice ?? nextRowPrice;
    if (!isValidPrice(price)) {
      skippedRows.push(skip(index, "价格无效", row.values));
      return;
    }

    const size = findSizeNearModel(row.values, modelCellIndex);
    const wattage = findWattage(row.values.slice(modelCellIndex + 1));
    const remarkParts = [
      findProductType(row.values, modelCellIndex),
      wattage ? `Power: ${wattage}` : null,
      findCct(row.values),
      findLumens(row.values),
    ].filter((value): value is string => Boolean(value));

    records.push(makeRecord(profile, index, modelNo, price, {
      size,
      remark: remarkParts.join("\n") || null,
      rawValues: nextRowPrice ? [...row.values, `price:${nextRowPrice}`] : row.values,
    }));
  });

  return { records: disambiguateDuplicateModels(dedupeRecords(records)), skippedRows, columnMappings };
}

function parsePuzhaoFangchao(profile: PdfImportProfile, rows: TableRow[]): ReturnType<typeof parseProfileRows> {
  const records: ImportRecord[] = [];
  const skippedRows: SkippedRow[] = [];
  const columnMappings = [
    { field: "modelNo", headerText: "产品型号", columnIndex: 1 },
    { field: "material", headerText: "材质", columnIndex: 2 },
    { field: "purchasePrice", headerText: "含税出厂", columnIndex: 3 },
    { field: "size", headerText: "产品尺寸", columnIndex: 4 },
    { field: "ctnQty", headerText: "装箱", columnIndex: 5 },
    { field: "remark", headerText: "详细参数", columnIndex: 7 },
  ];

  rows.forEach((row, index) => {
    const modelNo = cleanModelNo(row.values[0]);
    if (!modelNo) return;
    if (!isValidModelNo(modelNo)) {
      skippedRows.push(skip(index, "产品型号无效", row.values));
      return;
    }

    const price = parsePrice(row.values[2]);
    if (!isValidPrice(price)) {
      skippedRows.push(skip(index, "价格无效", row.values));
      return;
    }

    const previousSpecs = rows[index - 1]?.values ?? [];
    const tailSpecs = row.values.slice(6).filter(Boolean);
    const remark = [...previousSpecs, ...tailSpecs].filter((value) => !isLikelyModelNo(value)).join("\n") || null;

    records.push(makeRecord(profile, index, modelNo, price, {
      material: row.values[1] ?? null,
      size: row.values[3] ?? null,
      moq: null,
      remark,
      ctnQty: row.values[4] ?? null,
      rawValues: row.values,
    }));
  });

  return { records, skippedRows, columnMappings };
}

function parsePuzhaoSanfang(profile: PdfImportProfile, rows: TableRow[]): ReturnType<typeof parseProfileRows> {
  const records: ImportRecord[] = [];
  const skippedRows: SkippedRow[] = [];
  const columnMappings = [
    { field: "modelNo", headerText: "产品型号", columnIndex: 1 },
    { field: "wattage", headerText: "功率", columnIndex: 2 },
    { field: "purchasePrice", headerText: "含税单价", columnIndex: 3 },
    { field: "size", headerText: "灯体尺寸", columnIndex: 5 },
    { field: "remark", headerText: "备注", columnIndex: 7 },
  ];

  const groups = groupModelBlocks(rows, (row) => Boolean(cleanModelNo(row.values[0])?.startsWith("PZ-")));
  for (const group of groups) {
    const main = group.rows[0];
    const modelBase = cleanModelNo(main.values[0]);
    const wattage = main.values[1] ?? null;
    const modelNo = [modelBase, wattage].filter(Boolean).join(" ");
    const price = parsePrice(main.values[2]);

    if (!modelBase || !isValidModelNo(modelNo)) {
      skippedRows.push(skip(group.startIndex, "产品型号无效", main.values));
      continue;
    }
    if (!isValidPrice(price)) {
      skippedRows.push(skip(group.startIndex, "价格无效", main.values));
      continue;
    }

    const extraLines = group.rows
      .slice(1)
      .flatMap((row) => row.values)
      .filter((value) => !/^\d+[：:]/.test(value));
    const remarkParts = [
      wattage ? `Power: ${wattage}` : null,
      ...main.values.slice(6),
      ...extraLines,
    ].filter((value): value is string => Boolean(value));

    records.push(makeRecord(profile, group.startIndex, modelNo, price, {
      size: findDimensionValue(main.values.slice(3)),
      remark: remarkParts.join("\n") || null,
      rawValues: group.rows.flatMap((row) => row.values),
    }));
  }

  return { records: disambiguateDuplicateModels(dedupeRecords(records)), skippedRows, columnMappings };
}

function parseJielaiteFan(profile: PdfImportProfile, rows: TableRow[]): ReturnType<typeof parseProfileRows> {
  const records: ImportRecord[] = [];
  const skippedRows: SkippedRow[] = [];
  const columnMappings = [
    { field: "modelNo", headerText: "产品型号 / Model", columnIndex: 2 },
    { field: "wattage", headerText: "功率 / Power", columnIndex: 3 },
    { field: "moq", headerText: "起订量 / MOQ", columnIndex: 8 },
    { field: "purchasePrice", headerText: "含税单价 / PRICE", columnIndex: 9 },
  ];

  const groups = groupModelBlocks(rows, (row) => row.values.some((value) => /^JLT-/i.test(value)));
  for (const group of groups) {
    const allValues = group.rows.flatMap((row) => row.values);
    const modelBase = allValues.map(cleanModelNo).find((value): value is string => Boolean(value?.startsWith("JLT-"))) ?? null;
    const size = allValues.find((value) => /[（(]?\d+\s*寸[）)]?/.test(value)) ?? null;
    const modelNo = modelBase && size ? `${modelBase} ${size.replace(/[（）()]/g, "")}` : modelBase;
    const price = findCurrencyPrice(allValues);
    const moq = allValues.find((value) => /\d+\s*PCS/i.test(value)) ?? null;
    const wattage = findWattage(allValues);

    if (!modelNo || !isValidModelNo(modelNo)) {
      skippedRows.push(skip(group.startIndex, "产品型号无效", allValues));
      continue;
    }
    if (!isValidPrice(price)) {
      skippedRows.push(skip(group.startIndex, "价格无效", allValues));
      continue;
    }

    const remarkParts = allValues.filter((value) => {
      if (value === modelNo) return false;
      if (parsePrice(value) != null) return false;
      if (moq && value === moq) return false;
      return !/^(Picture|Model|Power|Voltage|Function|Disposition|Attachment|MOQ|PRICE|产品图片|产品型号|功率|电压|功能|其他配置参数|配件|起订量|含税单价)$/i.test(value);
    });

    records.push(makeRecord(profile, group.startIndex, modelNo, price, {
      moq,
      size,
      remark: [wattage ? `Power: ${wattage}` : null, ...remarkParts].filter(Boolean).join("\n") || null,
      rawValues: allValues,
    }));
  }

  return { records: disambiguateDuplicateModels(dedupeRecords(records)), skippedRows, columnMappings };
}

function groupModelBlocks(rows: TableRow[], isStartRow: (row: TableRow) => boolean): Array<{ startIndex: number; rows: TableRow[] }> {
  const groups: Array<{ startIndex: number; rows: TableRow[] }> = [];
  let current: { startIndex: number; rows: TableRow[] } | null = null;

  rows.forEach((row, index) => {
    if (isStartRow(row)) {
      if (current) groups.push(current);
      current = { startIndex: index, rows: [row] };
      return;
    }

    if (current && !isHeaderOrFooter(row.values)) {
      current.rows.push(row);
    }
  });

  if (current) groups.push(current);
  return groups;
}

function makeRecord(
  profile: PdfImportProfile,
  rowIndex: number,
  modelNo: string,
  purchasePrice: number,
  extras: {
    moq?: string | null;
    size?: string | null;
    material?: string | null;
    remark?: string | null;
    ctnQty?: string | null;
    rawValues: string[];
  },
): ImportRecord {
  const productName = profile.productNameRule === "category-factory-model"
    ? `${profile.category} ${profile.factoryName} ${modelNo}`
    : modelNo;

  return {
    profileId: profile.id,
    rowIndex,
    productName,
    modelNo,
    category: profile.category,
    factoryName: profile.factoryName,
    purchasePrice,
    currency: profile.currency,
    moq: cleanNullable(extras.moq),
    size: cleanNullable(extras.size),
    material: cleanNullable(extras.material),
    remark: cleanNullable(extras.remark),
    sourceFilePath: profile.relativePath,
    rawValues: extras.rawValues,
  };
}

function dedupeRecords(records: ImportRecord[]): ImportRecord[] {
  const seen = new Set<string>();
  const result: ImportRecord[] = [];
  for (const record of records) {
    const key = `${record.category}::${record.factoryName}::${record.modelNo}::${record.purchasePrice}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(record);
  }
  return result;
}

function disambiguateDuplicateModels(records: ImportRecord[]): ImportRecord[] {
  const counts = new Map<string, number>();
  for (const record of records) {
    const key = `${record.category}::${record.factoryName}::${record.modelNo}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const seen = new Map<string, number>();
  return records.map((record) => {
    const key = `${record.category}::${record.factoryName}::${record.modelNo}`;
    const total = counts.get(key) ?? 0;
    if (total <= 1) return record;

    const index = (seen.get(key) ?? 0) + 1;
    seen.set(key, index);
    const suffix = record.size ? `${record.size} Option ${index}` : `Option ${index}`;
    const modelNo = `${record.modelNo} ${suffix}`;
    return {
      ...record,
      modelNo,
      productName: modelNo,
    };
  });
}

function skip(rowIndex: number, reason: string, rawValues: string[]): SkippedRow {
  return { rowIndex, reason, rawValues };
}

function cleanNullable(value: string | null | undefined): string | null {
  const cleaned = normalizeText(value ?? "");
  return cleaned || null;
}

function cleanModelNo(value: string | null | undefined): string | null {
  const text = normalizeText(value ?? "");
  if (!text) return null;
  const knownMatch = text.match(/(?:PY|PZ|JLT)-[A-Za-z0-9./+()±\-\s]+/i);
  const model = knownMatch?.[0] ?? text;
  return model.replace(/^无频闪/i, "").replace(/[，,;；:：]+$/g, "").trim() || null;
}

function isLikelyModelNo(value: string): boolean {
  return Boolean(cleanModelNo(value)?.match(/^(PY|PZ|JLT)-/i));
}

function isValidModelNo(value: string | null): value is string {
  if (!value) return false;
  if (/^\d+$/.test(value)) return false;
  return /[A-Za-z]/.test(value) && value.length >= 3;
}

function parsePrice(value: string | null | undefined): number | null {
  const text = normalizeText(value ?? "");
  if (!text) return null;
  const currencyMatch = text.match(/[¥￥]\s*(\d{1,5}(?:,\d{3})*(?:\.\d{1,2})?)/);
  const numeric = currencyMatch?.[1] ?? text.match(/^\d{1,5}(?:,\d{3})*(?:\.\d{1,2})?$/)?.[0] ?? null;
  if (!numeric) return null;
  const price = Number.parseFloat(numeric.replace(/,/g, ""));
  return Number.isFinite(price) ? price : null;
}

function findCurrencyPrice(values: string[]): number | null {
  for (const value of values) {
    const price = parseCurrencyPrice(value);
    if (isValidPrice(price)) return price;
  }

  for (let index = 0; index < values.length - 1; index += 1) {
    if (!/[¥￥]/.test(values[index])) continue;
    const nextPrice = parsePrice(values[index + 1]);
    if (isValidPrice(nextPrice) && nextPrice >= 20) return nextPrice;
  }

  return null;
}

function parseCurrencyPrice(value: string | null | undefined): number | null {
  const text = normalizeText(value ?? "");
  const match = text.match(/[¥￥]\s*(\d{1,5}(?:,\d{3})*(?:\.\d{1,2})?)/);
  if (!match) return null;
  const price = Number.parseFloat(match[1].replace(/,/g, ""));
  return Number.isFinite(price) ? price : null;
}

function isValidPrice(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= PRICE_MIN && value <= PRICE_MAX;
}

function isPotentialDataRow(values: string[]): boolean {
  return values.some((value) => /[A-Za-z]{2,}-/.test(value)) || values.some((value) => parsePrice(value) != null);
}

function isHeaderOrFooter(values: string[]): boolean {
  const text = values.join(" ");
  return /^(Picture|产品图片|备注|江西普照|JLT Intelligent|此报价|序|图片)/i.test(text) || /^\d+[：:]/.test(text);
}

function findSizeNearModel(values: string[], modelCellIndex: number): string | null {
  const before = values.slice(Math.max(0, modelCellIndex - 3), modelCellIndex).reverse();
  return before.find((value) => /[ФØ]?\d+(?:\.\d+)?\s*[*×]\s*\d+|[ФØ]\d+/.test(value)) ?? null;
}

function findDimensionValue(values: string[]): string | null {
  return values.find((value) => /\d+(?:\.\d+)?\s*[*×]\s*\d+/.test(value)) ?? null;
}

function findWattage(values: string[]): string | null {
  return values.find((value) => /\d+(?:\.\d+)?\s*W/i.test(value)) ?? null;
}

function findCct(values: string[]): string | null {
  const value = values.find((item) => /\d{4}\s*-\s*\d{4}|\d{4}K/i.test(item));
  return value ? `CCT: ${value}` : null;
}

function findLumens(values: string[]): string | null {
  const value = values.find((item) => /\d+\s*(?:lm|LM)|\d+\s*LM\/W/i.test(item));
  return value ? `Lumens: ${value}` : null;
}

function findProductType(values: string[], modelCellIndex: number): string | null {
  const before = values.slice(0, modelCellIndex);
  return before.find((value) => /G9|R7S/i.test(value)) ?? null;
}

async function parseProfile(profile: PdfImportProfile): Promise<ParsedProfile> {
  const absolutePath = path.join(ROOT, profile.relativePath);
  const fileExists = existsSync(absolutePath);
  const fileSizeKb = fileExists ? Math.round((statSync(absolutePath).size / 1024) * 10) / 10 : 0;

  if (!fileExists) {
    return {
      profile,
      fileExists,
      fileSizeKb,
      totalPages: 0,
      analyzedPages: 0,
      rowsParsed: 0,
      columnMappings: [],
      records: [],
      skippedRows: [skip(0, "PDF 文件不存在", [profile.relativePath])],
      error: "PDF 文件不存在",
    };
  }

  try {
    const extracted = await extractPdfRows(profile);
    const parsed = parseProfileRows(profile, extracted.rows);
    return {
      profile,
      fileExists,
      fileSizeKb: extracted.fileSizeKb,
      totalPages: extracted.totalPages,
      analyzedPages: extracted.analyzedPages,
      rowsParsed: extracted.rows.length,
      columnMappings: parsed.columnMappings,
      records: parsed.records,
      skippedRows: parsed.skippedRows,
      error: null,
    };
  } catch (error) {
    return {
      profile,
      fileExists,
      fileSizeKb,
      totalPages: 0,
      analyzedPages: 0,
      rowsParsed: 0,
      columnMappings: [],
      records: [],
      skippedRows: [skip(0, "解析失败", [error instanceof Error ? error.message : String(error)])],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function loadSourceFileId(profile: PdfImportProfile): Promise<string | null> {
  const file = await prisma.file.findFirst({
    where: {
      volumeName: VOLUME_NAME,
      relativePath: profile.relativePath,
    },
    select: { id: true },
  });
  return file?.id ?? null;
}

async function buildProfilePlan(parsed: ParsedProfile): Promise<ProfileRunResult> {
  const sourceFileId = await loadSourceFileId(parsed.profile);
  const plannedRecords: RecordPlan[] = [];
  let existingProducts = 0;
  let newProducts = 0;
  let newOffers = 0;
  let updatedOffers = 0;
  let unchangedOffers = 0;

  for (const record of parsed.records) {
    const existingProduct = await prisma.product.findFirst({
      where: {
        modelNo: record.modelNo,
        category: record.category,
      },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });

    if (!existingProduct) {
      newProducts += 1;
      newOffers += 1;
      plannedRecords.push({
        ...record,
        status: "new product",
        existingProductId: null,
        existingOfferId: null,
        oldPrice: null,
      });
      continue;
    }

    existingProducts += 1;
    const existingOffer = await prisma.supplierOffer.findFirst({
      where: {
        productId: existingProduct.id,
        factoryName: record.factoryName,
      },
      orderBy: [{ priceUpdatedAt: "desc" }, { createdAt: "desc" }],
      select: { id: true, purchasePrice: true },
    });

    if (!existingOffer) {
      newOffers += 1;
      plannedRecords.push({
        ...record,
        status: "new offer",
        existingProductId: existingProduct.id,
        existingOfferId: null,
        oldPrice: null,
      });
      continue;
    }

    const oldPrice = Number(existingOffer.purchasePrice.toString());
    if (Math.abs(oldPrice - record.purchasePrice) < 0.000001) {
      unchangedOffers += 1;
      plannedRecords.push({
        ...record,
        status: "unchanged",
        existingProductId: existingProduct.id,
        existingOfferId: existingOffer.id,
        oldPrice,
      });
    } else {
      updatedOffers += 1;
      plannedRecords.push({
        ...record,
        status: "price update",
        existingProductId: existingProduct.id,
        existingOfferId: existingOffer.id,
        oldPrice,
      });
    }
  }

  return {
    ...parsed,
    sourceFileId,
    plannedRecords,
    existingProducts,
    newProducts,
    newOffers,
    updatedOffers,
    unchangedOffers,
    priceHistory: updatedOffers,
    priceRange: formatPriceRange(parsed.records),
    warning: buildWarning(parsed, sourceFileId),
  };
}

function buildWarning(parsed: ParsedProfile, sourceFileId: string | null): string | null {
  if (parsed.error) return parsed.error;
  if (!sourceFileId) return "files 表缺少该 PDF 记录，apply 会跳过";
  if (parsed.records.length === 0) return "0 条有效记录，apply 会跳过";
  if (parsed.records.length > 300) return "解析行数异常偏高，请人工复核";
  return null;
}

function formatPriceRange(records: ImportRecord[]): string {
  const prices = records.map((record) => record.purchasePrice);
  if (prices.length === 0) return "-";
  return `${Math.min(...prices).toFixed(2)}-${Math.max(...prices).toFixed(2)}`;
}

async function applyProfiles(results: ProfileRunResult[]): Promise<{ backupPath: string; applied: ProfileRunResult[] }> {
  const backupPath = await backupDatabase();
  const applied: ProfileRunResult[] = [];

  for (const result of results) {
    if (!result.sourceFileId || result.records.length === 0) {
      applied.push(result);
      continue;
    }

    let newProducts = 0;
    let existingProducts = 0;
    let newOffers = 0;
    let updatedOffers = 0;
    let unchangedOffers = 0;
    let priceHistory = 0;
    const productCache = new Map<string, string>();

    await prisma.$transaction(async (tx) => {
      for (const record of result.records) {
        const productKey = `${record.category}::${record.modelNo}`;
        let productId = productCache.get(productKey);
        if (!productId) {
          const existingProduct = await tx.product.findFirst({
            where: {
              modelNo: record.modelNo,
              category: record.category,
            },
            orderBy: { createdAt: "asc" },
            select: { id: true },
          });

          if (existingProduct) {
            productId = existingProduct.id;
            existingProducts += 1;
          } else {
            const created = await tx.product.create({
              data: {
                productName: record.productName,
                category: record.category,
                modelNo: record.modelNo,
                material: record.material,
                size: record.size,
                imagePath: null,
                remark: record.remark,
              },
              select: { id: true },
            });
            productId = created.id;
            newProducts += 1;
          }
          productCache.set(productKey, productId);
        } else {
          existingProducts += 1;
        }

        const upsert = await upsertSupplierOffer(
          tx as unknown as SupplierOfferUpsertClient,
          {
            productId,
            factoryName: record.factoryName,
            purchasePrice: record.purchasePrice.toFixed(2),
            currency: record.currency,
            moq: record.moq,
            ctnQty: null,
            ctnLength: null,
            ctnWidth: null,
            ctnHeight: null,
            sourceFileId: result.sourceFileId,
            remark: null,
          },
          runStartedAt,
        );

        if (upsert.status === "created") {
          newOffers += 1;
        } else if (upsert.status === "updated") {
          if (upsert.priceChanged) {
            updatedOffers += 1;
            priceHistory += 1;
          }
        } else {
          unchangedOffers += 1;
        }
      }
    });

    applied.push({
      ...result,
      existingProducts,
      newProducts,
      newOffers,
      updatedOffers,
      unchangedOffers,
      priceHistory,
    });
  }

  return { backupPath, applied };
}

async function backupDatabase(): Promise<string> {
  mkdirSync(BACKUP_DIR, { recursive: true });
  const timestamp = timestampForFile();
  const backupPath = path.join(BACKUP_DIR, `dev-before-v2.22-pdf-${timestamp}.sqlite`);
  await copyFile("prisma/dev.db", backupPath);
  return backupPath;
}

function timestampForFile(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

async function getCounts(): Promise<Counts> {
  const [products, supplierOffers, priceHistory] = await Promise.all([
    prisma.product.count(),
    prisma.supplierOffer.count(),
    prisma.priceHistory.count(),
  ]);
  return { products, supplierOffers, priceHistory };
}

function writeDryRunReport(results: ProfileRunResult[], beforeCounts: Counts): void {
  const lines = buildReport({
    title: "V2.22 — PDF 报价导入 Dry-Run 报告",
    mode: "dry-run",
    results,
    beforeCounts,
    afterCounts: beforeCounts,
    backupPath: null,
  });
  writeFileSync(DRY_RUN_REPORT_PATH, lines.join("\n"), "utf8");
}

function writeApplyReport(results: ProfileRunResult[], beforeCounts: Counts, afterCounts: Counts, backupPath: string): void {
  const lines = buildReport({
    title: "V2.22 — PDF 报价导入结果",
    mode: "apply",
    results,
    beforeCounts,
    afterCounts,
    backupPath,
  });
  writeFileSync(APPLY_REPORT_PATH, lines.join("\n"), "utf8");
}

function buildReport({
  title,
  mode,
  results,
  beforeCounts,
  afterCounts,
  backupPath,
}: {
  title: string;
  mode: Mode;
  results: ProfileRunResult[];
  beforeCounts: Counts;
  afterCounts: Counts;
  backupPath: string | null;
}): string[] {
  const totalRecords = sum(results.map((result) => result.records.length));
  const lines = [
    `# ${title}`,
    "",
    `Generated: ${new Date().toISOString()}`,
    `Mode: ${mode}`,
    `Profiles: ${results.length}`,
    `Total records: ${totalRecords}`,
    ...(backupPath ? [`DB Backup: ${backupPath}`] : []),
    "",
    "## Summary",
    "",
    "| Profile | Category | Factory | PDF Pages | Rows Parsed | Valid Records | Price Range | Existing Products | New Products | New Offers | Price Updates | Unchanged | Warning |",
    "|---|---|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---|",
    ...results.map((result) =>
      `| ${escapeMd(result.profile.id)} | ${escapeMd(result.profile.category)} | ${escapeMd(result.profile.factoryName)} | ${result.totalPages} | ${result.rowsParsed} | ${result.records.length} | ${result.priceRange} | ${result.existingProducts} | ${result.newProducts} | ${result.newOffers} | ${result.updatedOffers} | ${result.unchangedOffers} | ${escapeMd(result.warning)} |`
    ),
    "",
    "## DB Counts",
    "",
    "| Metric | Before | After | Delta |",
    "|---|---:|---:|---:|",
    `| products | ${beforeCounts.products} | ${afterCounts.products} | ${afterCounts.products - beforeCounts.products} |`,
    `| supplier_offers | ${beforeCounts.supplierOffers} | ${afterCounts.supplierOffers} | ${afterCounts.supplierOffers - beforeCounts.supplierOffers} |`,
    `| price_history | ${beforeCounts.priceHistory} | ${afterCounts.priceHistory} | ${afterCounts.priceHistory - beforeCounts.priceHistory} |`,
    "",
    "## Totals",
    "",
    "| Metric | Count |",
    "|---|---:|",
    `| Products created | ${sum(results.map((result) => result.newProducts))} |`,
    `| Products existing | ${sum(results.map((result) => result.existingProducts))} |`,
    `| Offers created | ${sum(results.map((result) => result.newOffers))} |`,
    `| Offers updated | ${sum(results.map((result) => result.updatedOffers))} |`,
    `| Offers unchanged | ${sum(results.map((result) => result.unchangedOffers))} |`,
    `| Price history records | ${sum(results.map((result) => result.priceHistory))} |`,
    `| Rows skipped | ${sum(results.map((result) => result.skippedRows.length))} |`,
    "",
  ];

  for (const result of results) {
    lines.push(
      `## ${result.profile.id} — ${result.profile.category} / ${result.profile.factoryName}`,
      "",
      `Source file id: ${result.sourceFileId ?? "missing"}`,
      "",
      "### Column Mapping",
      "",
      "| Field | Header Text | Column Index |",
      "|---|---|---:|",
      ...result.columnMappings.map((mapping) => `| ${mapping.field} | ${escapeMd(mapping.headerText)} | ${mapping.columnIndex} |`),
      "",
      "### Parsed Records",
      "",
      "| # | Model | Price | MOQ | Size | Status | Old Price | Remark |",
      "|---:|---|---:|---|---|---|---:|---|",
      ...result.plannedRecords.map((record, index) =>
        `| ${index + 1} | ${escapeMd(record.modelNo)} | ${record.purchasePrice.toFixed(2)} | ${escapeMd(record.moq)} | ${escapeMd(record.size)} | ${record.status} | ${record.oldPrice == null ? "-" : record.oldPrice.toFixed(2)} | ${escapeMd(record.remark)} |`
      ),
      "",
      "### Skipped Rows",
      "",
      result.skippedRows.length
        ? "| # | Reason | Raw Values |\n|---:|---|---|\n" +
            result.skippedRows
              .slice(0, 30)
              .map((row) => `| ${row.rowIndex} | ${escapeMd(row.reason)} | ${escapeMd(row.rawValues.join(" / "))} |`)
              .join("\n")
        : "_No skipped rows._",
      "",
      "---",
      ""
    );
  }

  return lines;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

async function main(): Promise<void> {
  const { mode, profileId } = parseArgs();
  if (!existsSync(ROOT)) {
    throw new Error(`Drive root not mounted: ${ROOT}`);
  }

  mkdirSync("docs", { recursive: true });
  const selectedProfiles = profileId
    ? PDF_IMPORT_PROFILES.filter((profile) => profile.id === profileId)
    : PDF_IMPORT_PROFILES;
  if (selectedProfiles.length === 0) {
    throw new Error(`No profile matched: ${profileId}`);
  }

  const beforeCounts = await getCounts();
  const parsedResults: ProfileRunResult[] = [];
  for (const profile of selectedProfiles) {
    console.log(`Parsing ${profile.id}: ${profile.relativePath}`);
    parsedResults.push(await buildProfilePlan(await parseProfile(profile)));
  }

  writeDryRunReport(parsedResults, beforeCounts);

  if (mode === "dry-run") {
    console.log({
      mode,
      profiles: parsedResults.length,
      records: sum(parsedResults.map((result) => result.records.length)),
      reportPath: DRY_RUN_REPORT_PATH,
    });
    return;
  }

  const { backupPath, applied } = await applyProfiles(parsedResults);
  const afterCounts = await getCounts();
  writeApplyReport(applied, beforeCounts, afterCounts, backupPath);
  console.log({
    mode,
    profiles: applied.length,
    records: sum(applied.map((result) => result.records.length)),
    backupPath,
    dryRunReportPath: DRY_RUN_REPORT_PATH,
    applyReportPath: APPLY_REPORT_PATH,
    beforeCounts,
    afterCounts,
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
