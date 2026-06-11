import { existsSync } from "node:fs";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { PrismaClient } from "@prisma/client";
import * as XLSX from "xlsx";

const prisma = new PrismaClient();

const ROOT = "/Volumes/My Passport/AI 报价/各家工厂最新报价汇总";
const REPORT_PATH = "docs/v2.13a-source-inventory.md";
const CSV_PATH = "docs/v2.13a-import-candidates.csv";
const MAX_PARSE_BYTES = 100 * 1024 * 1024;
const SHEET_SCAN_ROWS = 120;
const SUPPORTED_EXTENSIONS = new Set([".xls", ".xlsx"]);

type Classification = "likely-importable" | "enrichment-only" | "needs-review" | "likely-skip";
type ImportStatus = "已导入" | "已扫描未导入" | "未知";

type DbFileIndex = {
  byAbsolutePath: Map<string, DbFileRecord>;
  byName: Map<string, DbFileRecord[]>;
  byNameSize: Map<string, DbFileRecord[]>;
};

type DbFileRecord = {
  id: string;
  fileName: string;
  fileSize: bigint;
  absolutePathSnapshot: string;
  supplierOfferCount: number;
};

type DiskFile = {
  absolutePath: string;
  relativePath: string;
  fileName: string;
  extension: string;
  size: number;
  modifiedAtMs: number;
  modifiedDate: string;
};

type CategoryContext = {
  major: string;
  pathCategory: string;
  category: string;
  factory: string;
  isNewCategory: boolean;
  categoryNote: string | null;
};

type ColumnSignal = {
  index: number;
  letter: string;
  header: string;
  count: number;
  samples: string[];
};

type SheetAnalysis = {
  name: string;
  rowCount: number;
  colCount: number;
  headerRows: number[];
  priceColumns: ColumnSignal[];
  rmbPriceColumns: ColumnSignal[];
  usdPriceColumns: ColumnSignal[];
  modelColumns: ColumnSignal[];
  enrichmentColumns: ColumnSignal[];
};

type InventoryRow = DiskFile & {
  major: string;
  pathCategory: string;
  category: string;
  factory: string;
  isNewCategory: boolean;
  categoryNote: string | null;
  importStatus: ImportStatus;
  dbOfferRefs: number;
  sheetCount: number;
  sheets: SheetAnalysis[];
  hasHeader: boolean;
  hasPrice: boolean;
  hasRmbPrice: boolean;
  hasUsdPrice: boolean;
  hasModel: boolean;
  hasEnrichment: boolean;
  estimatedProducts: number;
  classification: Classification;
  reason: string;
  readError: string | null;
  versionGroupKey: string;
  versionGroupName: string;
  versionCount: number;
  latestInGroup: string | null;
  isLatestVersion: boolean;
};

type SummaryRow = {
  major: string;
  category: string;
  excel: number;
  imported: number;
  importable: number;
  enrichment: number;
  review: number;
  skip: number;
  pdf: number;
  errors: number;
};

async function main() {
  const started = Date.now();
  if (!existsSync(ROOT)) {
    throw new Error(`硬盘目录不可访问：${ROOT}`);
  }

  const dbIndex = await loadDbIndex();
  const { excelFiles, pdfCounts } = await scanDisk(ROOT);

  console.log(`Found ${excelFiles.length} Excel files under source root.`);

  const rows: InventoryRow[] = [];
  for (const [index, file] of excelFiles.entries()) {
    if ((index + 1) % 50 === 0 || index === 0) {
      console.log(`Scanning ${index + 1}/${excelFiles.length}: ${file.relativePath}`);
    }
    rows.push(await inspectFile(file, dbIndex));
  }

  applyVersionGrouping(rows);

  const summaries = buildSummaries(rows, pdfCounts);
  await mkdir("docs", { recursive: true });
  await writeFile(REPORT_PATH, buildMarkdownReport(rows, summaries, pdfCounts, Date.now() - started), "utf8");
  await writeFile(CSV_PATH, buildCandidateCsv(rows), "utf8");

  console.log(
    JSON.stringify(
      {
        excelFiles: rows.length,
        likelyImportable: rows.filter((row) => row.classification === "likely-importable").length,
        enrichmentOnly: rows.filter((row) => row.classification === "enrichment-only").length,
        needsReview: rows.filter((row) => row.classification === "needs-review").length,
        likelySkip: rows.filter((row) => row.classification === "likely-skip").length,
        readErrors: rows.filter((row) => row.readError).length,
        reportPath: REPORT_PATH,
        csvPath: CSV_PATH,
      },
      null,
      2,
    ),
  );
}

async function loadDbIndex(): Promise<DbFileIndex> {
  const files = await prisma.file.findMany({
    where: { volumeName: "My Passport" },
    include: {
      _count: {
        select: { supplierOffers: true },
      },
    },
  });

  const records = files.map((file): DbFileRecord => ({
    id: file.id,
    fileName: normalizeText(file.fileName),
    fileSize: BigInt(file.fileSize),
    absolutePathSnapshot: normalizeText(file.absolutePathSnapshot),
    supplierOfferCount: file._count.supplierOffers,
  }));

  return {
    byAbsolutePath: new Map(records.map((record) => [record.absolutePathSnapshot, record])),
    byName: groupBy(records, (record) => record.fileName),
    byNameSize: groupBy(records, (record) => nameSizeKey(record.fileName, record.fileSize)),
  };
}

async function scanDisk(root: string): Promise<{ excelFiles: DiskFile[]; pdfCounts: Map<string, number> }> {
  const excelFiles: DiskFile[] = [];
  const pdfCounts = new Map<string, number>();
  await walk(root);

  return {
    excelFiles: excelFiles.sort((a, b) => a.relativePath.localeCompare(b.relativePath, "zh-Hans-CN")),
    pdfCounts,
  };

  async function walk(currentPath: string) {
    const entries = await readdir(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const rawName = entry.name;
      const name = normalizeText(rawName);
      if (name.startsWith(".") || name.startsWith("~$")) {
        continue;
      }

      const absolutePath = path.join(currentPath, rawName);
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
      if (extension === ".pdf") {
        const relativePath = portableRelative(root, absolutePath);
        const context = inferCategoryContext(relativePath, name, []);
        increment(pdfCounts, summaryKey(context.major, context.category));
        continue;
      }
      if (!SUPPORTED_EXTENSIONS.has(extension)) {
        continue;
      }

      let fileStat: Awaited<ReturnType<typeof stat>>;
      try {
        fileStat = await stat(absolutePath);
      } catch (error) {
        console.warn(`Skip unreadable file during scan: ${portableRelative(root, absolutePath)} (${String(error)})`);
        continue;
      }
      excelFiles.push({
        absolutePath,
        relativePath: portableRelative(root, absolutePath),
        fileName: name,
        extension,
        size: fileStat.size,
        modifiedAtMs: fileStat.mtimeMs,
        modifiedDate: formatDate(new Date(fileStat.mtimeMs)),
      });
    }
  }
}

async function inspectFile(file: DiskFile, dbIndex: DbFileIndex): Promise<InventoryRow> {
  const dbMatch = findDbMatch(file, dbIndex);
  const importStatus: ImportStatus =
    dbMatch && dbMatch.supplierOfferCount > 0 ? "已导入" : dbMatch ? "已扫描未导入" : "未知";
  const dbOfferRefs = dbMatch?.supplierOfferCount ?? 0;

  let sheets: SheetAnalysis[] = [];
  let readError: string | null = null;

  if (file.size > MAX_PARSE_BYTES) {
    readError = `文件超过 100MB，跳过 SheetJS 深读（${formatBytes(file.size)}）`;
  } else {
    try {
      const workbook = XLSX.readFile(file.absolutePath, {
        cellDates: false,
        sheetRows: SHEET_SCAN_ROWS,
        WTF: false,
      });
      sheets = workbook.SheetNames.map((sheetName) => analyzeSheet(sheetName, workbook.Sheets[sheetName], file.fileName));
    } catch (error) {
      readError = error instanceof Error ? error.message : String(error);
    }
  }

  const context = inferCategoryContext(
    file.relativePath,
    file.fileName,
    sheets.map((sheet) => sheet.name),
  );
  const flags = aggregateFlags(file.fileName, sheets, readError);
  const baseClassification = classify({ file, importStatus, dbOfferRefs, sheets, flags, readError });

  return {
    ...file,
    ...context,
    importStatus,
    dbOfferRefs,
    sheetCount: sheets.length,
    sheets,
    ...flags,
    classification: baseClassification.classification,
    reason: appendCategoryReason(baseClassification.reason, context),
    readError,
    versionGroupKey: buildVersionGroupKey(context, file),
    versionGroupName: buildVersionGroupName(file.fileName),
    versionCount: 1,
    latestInGroup: null,
    isLatestVersion: true,
  };
}

function analyzeSheet(sheetName: string, worksheet: XLSX.WorkSheet | undefined, fileName: string): SheetAnalysis {
  if (!worksheet) {
    return emptySheet(sheetName);
  }

  const matrix = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
    header: 1,
    raw: false,
    defval: "",
    blankrows: false,
  });
  const rows = matrix.map((row) => row.map((cell) => normalizeCell(cell)));
  const rowCount = rows.length;
  const colCount = Math.max(0, ...rows.map((row) => row.length));
  if (rowCount === 0 || colCount === 0) {
    return emptySheet(sheetName);
  }

  const headerRows = findHeaderRows(rows);
  const headerRowIndex = headerRows[0] ? headerRows[0] - 1 : findBestHeaderIndex(rows);
  const headers = buildHeaders(rows, headerRowIndex, colCount);
  const threshold = rowCount < 30 ? 3 : 5;
  const filePriceHint = priceHintFromText(fileName);

  const priceColumns: ColumnSignal[] = [];
  const rmbPriceColumns: ColumnSignal[] = [];
  const usdPriceColumns: ColumnSignal[] = [];
  const modelColumns: ColumnSignal[] = [];
  const enrichmentColumns: ColumnSignal[] = [];

  for (let index = 0; index < colCount; index += 1) {
    const values = rows.map((row) => row[index] ?? "").slice(headerRowIndex + 1);
    const nonEmptyValues = values.filter((value) => value !== "");
    const header = headers[index] ?? "";
    const priceSamples = uniqueSamples(nonEmptyValues.filter((value) => parsePositivePrice(value) !== null));
    const modelSamples = uniqueSamples(nonEmptyValues.filter(isLikelyModelValue));
    const enrichmentSamples = uniqueSamples(nonEmptyValues.filter(hasEnrichmentText));

    const priceCount = priceSamples.length
      ? nonEmptyValues.filter((value) => parsePositivePrice(value) !== null).length
      : 0;
    const modelCount = modelSamples.length ? nonEmptyValues.filter(isLikelyModelValue).length : 0;
    const enrichmentCount = enrichmentSamples.length
      ? nonEmptyValues.filter((value) => hasEnrichmentText(value)).length
      : 0;

    if (priceCount >= threshold) {
      const signal = columnSignal(index, header, priceCount, priceSamples);
      priceColumns.push(signal);
      if (isUsdPriceHeader(header) || filePriceHint === "usd") {
        usdPriceColumns.push(signal);
      }
      if (isRmbPriceHeader(header) || (filePriceHint === "rmb" && !isUsdPriceHeader(header))) {
        rmbPriceColumns.push(signal);
      }
    }
    if (modelCount >= threshold) {
      modelColumns.push(columnSignal(index, header, modelCount, modelSamples));
    }
    if (isEnrichmentHeader(header) || enrichmentCount >= threshold) {
      enrichmentColumns.push(columnSignal(index, header, Math.max(enrichmentCount, 1), enrichmentSamples));
    }
  }

  return {
    name: sheetName,
    rowCount,
    colCount,
    headerRows,
    priceColumns,
    rmbPriceColumns,
    usdPriceColumns,
    modelColumns,
    enrichmentColumns,
  };
}

function emptySheet(name: string): SheetAnalysis {
  return {
    name,
    rowCount: 0,
    colCount: 0,
    headerRows: [],
    priceColumns: [],
    rmbPriceColumns: [],
    usdPriceColumns: [],
    modelColumns: [],
    enrichmentColumns: [],
  };
}

function aggregateFlags(fileName: string, sheets: SheetAnalysis[], readError: string | null) {
  const textHint = priceHintFromText(fileName);
  const hasHeader = sheets.some((sheet) => sheet.headerRows.length > 0);
  const hasPrice = sheets.some((sheet) => sheet.priceColumns.length > 0);
  const hasUsdPrice = sheets.some((sheet) => sheet.usdPriceColumns.length > 0) || textHint === "usd";
  const hasRmbPrice = sheets.some((sheet) => sheet.rmbPriceColumns.length > 0) || (hasPrice && textHint === "rmb");
  const hasModel = sheets.some((sheet) => sheet.modelColumns.length > 0);
  const hasEnrichment =
    sheets.some((sheet) => sheet.enrichmentColumns.length > 0) || /图片|photo|image|规格|参数|画册|catalog/i.test(fileName);
  const estimatedProducts = readError
    ? 0
    : Math.max(
        0,
        ...sheets.flatMap((sheet) => [
          ...sheet.modelColumns.map((column) => column.count),
          ...sheet.priceColumns.map((column) => column.count),
          Math.max(0, sheet.rowCount - (sheet.headerRows[0] ?? 1)),
        ]),
      );

  return {
    hasHeader,
    hasPrice,
    hasRmbPrice,
    hasUsdPrice,
    hasModel,
    hasEnrichment,
    estimatedProducts,
  };
}

function classify(input: {
  file: DiskFile;
  importStatus: ImportStatus;
  dbOfferRefs: number;
  sheets: SheetAnalysis[];
  flags: ReturnType<typeof aggregateFlags>;
  readError: string | null;
}): { classification: Classification; reason: string } {
  const { file, importStatus, dbOfferRefs, sheets, flags, readError } = input;
  const fileText = file.fileName.toLowerCase();

  if (importStatus === "已导入") {
    return { classification: "likely-skip", reason: `已导入（关联 supplier_offers: ${dbOfferRefs}）` };
  }
  if (readError) {
    return { classification: "needs-review", reason: `SheetJS 读取失败或跳过：${readError}` };
  }
  if (sheets.length === 0 || sheets.every((sheet) => sheet.rowCount <= 1)) {
    return { classification: "likely-skip", reason: "空文件或没有可读 sheet 数据" };
  }
  if (isCatalogLike(fileText) && !flags.hasPrice && !flags.hasModel) {
    return { classification: "likely-skip", reason: "像目录/说明书/画册，且未发现可导入价格或型号列" };
  }
  if (flags.hasRmbPrice && flags.hasModel && flags.hasHeader) {
    return {
      classification: "likely-importable",
      reason: "发现疑似表头、型号列和 RMB/人民币/含税/核价价格列",
    };
  }
  if (flags.hasUsdPrice && flags.hasModel) {
    return { classification: "enrichment-only", reason: "发现 USD/FOB 客户价，不作为工厂采购价导入，可用于补规格/图片" };
  }
  if (!flags.hasRmbPrice && flags.hasEnrichment && flags.hasModel) {
    return { classification: "enrichment-only", reason: "无可靠 RMB 价，但有型号和规格/参数/图片信号" };
  }
  if (flags.hasPrice || flags.hasModel || flags.hasHeader) {
    return { classification: "needs-review", reason: "有价格/型号/表头迹象，但 RMB 价格语义或结构不够明确" };
  }
  if (flags.hasEnrichment) {
    return { classification: "enrichment-only", reason: "未发现价格/型号列，但文件名或表头含规格/图片/参数信号" };
  }

  return { classification: "likely-skip", reason: "未发现有效价格、型号或规格信号" };
}

function applyVersionGrouping(rows: InventoryRow[]) {
  const groups = groupBy(
    rows.filter((row) => row.versionGroupName.length >= 6),
    (row) => row.versionGroupKey,
  );

  for (const group of groups.values()) {
    if (group.length < 2) {
      continue;
    }
    const latest = group.slice().sort((a, b) => b.modifiedAtMs - a.modifiedAtMs)[0];
    for (const row of group) {
      row.versionCount = group.length;
      row.latestInGroup = latest.relativePath;
      row.isLatestVersion = row.relativePath === latest.relativePath;
      if (!row.isLatestVersion && row.importStatus !== "已导入") {
        row.classification = "likely-skip";
        row.reason = `旧版本重复；同组最新文件为 ${latest.fileName}`;
      }
    }
  }
}

function inferCategoryContext(relativePath: string, fileName: string, sheetNames: string[]): CategoryContext {
  const parts = relativePath.split("/").map(normalizeText);
  const major = parts[0] ?? "(root)";
  const pathCategory = parts[1] ?? "(root)";
  const searchText = normalizeText([relativePath, fileName, ...sheetNames].join(" "));
  let category = pathCategory;
  let factory = parts[2] ?? pathCategory;
  let categoryNote: string | null = null;

  if (major === "灯带") {
    category = inferLightStripCategory(searchText);
    factory = parts[1] ?? "";
  } else if (major === "光源") {
    category = inferLightSourceCategory(pathCategory, searchText);
    factory = parts[2] ?? pathCategory;
  } else if (major === "室内照明") {
    category = inferIndoorCategory(pathCategory, searchText);
    factory = parts[2] ?? pathCategory;
  } else if (major === "户外照明 工业照明") {
    if (pathCategory === "户外工厂") {
      category = inferOutdoorMixedCategory(searchText);
      factory = parts[2] ?? pathCategory;
      if (category === "户外工厂-未判定") {
        categoryNote = "户外工厂混合目录，文件名/sheet 名未能明确判断品类";
      }
    } else {
      category = inferOutdoorCategory(pathCategory, searchText);
      factory = parts[2] ?? pathCategory;
    }
  }

  const isNewCategory = new Set(["风扇灯", "工作灯", "G4G9", "铝型材", "T5", "支架", "LED模组"]).has(category);

  return {
    major,
    pathCategory,
    category,
    factory: factory || "(未识别)",
    isNewCategory,
    categoryNote,
  };
}

function inferLightStripCategory(text: string): string {
  if (/皮线灯/.test(text)) return "皮线灯";
  if (/连接器|connector/i.test(text)) return "灯带连接器";
  if (/控制器|controller/i.test(text)) return "灯带控制器";
  if (/太阳能|solar/i.test(text)) return "太阳能灯带";
  return "灯带";
}

function inferLightSourceCategory(pathCategory: string, text: string): string {
  if (pathCategory === "灯丝灯") return "灯丝灯";
  if (pathCategory === "G4G9") return "G4G9";
  if (pathCategory === "LED模组") return "LED模组";
  if (/应急/.test(text)) return "应急灯";
  if (/灯管|tube|t8|t5/i.test(text)) return "灯管";
  if (/灯丝|filament/i.test(text)) return "灯丝灯";
  if (/球泡|bulb|a泡|b泡|c泡|g45|g95/i.test(text)) return "球泡";
  return pathCategory;
}

function inferIndoorCategory(pathCategory: string, text: string): string {
  if (pathCategory === "大面板" || pathCategory === "小面板灯") return "面板灯";
  if (pathCategory === "线条灯办公灯") return "线条灯";
  if (/面板|panel/i.test(text)) return "面板灯";
  if (/线条|办公灯|linear|batten/i.test(text)) return "线条灯";
  return pathCategory;
}

function inferOutdoorCategory(pathCategory: string, text: string): string {
  if (pathCategory === "LED 地埋灯地插灯") return "地埋灯/地插灯";
  if (pathCategory === "太阳能壁灯草坪灯地插灯") {
    if (/壁灯|wall/i.test(text)) return "太阳能壁灯";
    if (/草坪|lawn/i.test(text)) return "草坪灯";
    if (/地插|地埋|spike|inground/i.test(text)) return "地插灯/太阳能壁灯";
    return "太阳能";
  }
  return pathCategory;
}

function inferOutdoorMixedCategory(text: string): string {
  if (/庭院灯|garden/i.test(text)) return "庭院灯";
  if (/投光灯|flood/i.test(text)) return "投光灯";
  if (/路灯|street/i.test(text)) return "路灯";
  if (/工矿灯|high\s*bay|highbay/i.test(text)) return "Highbay";
  if (/太阳能|solar/i.test(text)) return "太阳能";
  if (/壁灯|wall/i.test(text)) return "市电壁灯";
  return "户外工厂-未判定";
}

function findDbMatch(file: DiskFile, dbIndex: DbFileIndex): DbFileRecord | null {
  const absoluteMatch = dbIndex.byAbsolutePath.get(normalizeText(file.absolutePath));
  if (absoluteMatch) return absoluteMatch;

  const exactNameSizeMatches = dbIndex.byNameSize.get(nameSizeKey(file.fileName, BigInt(file.size))) ?? [];
  if (exactNameSizeMatches.length === 1) {
    return exactNameSizeMatches[0];
  }

  const exactNameMatches = dbIndex.byName.get(file.fileName) ?? [];
  const importedNameMatch = exactNameMatches.find((match) => match.supplierOfferCount > 0);
  return importedNameMatch ?? exactNameMatches[0] ?? null;
}

function findHeaderRows(rows: string[][]): number[] {
  return rows
    .slice(0, 10)
    .map((row, index) => ({ row, number: index + 1 }))
    .filter(({ row }) => {
      const text = row.join(" ");
      const nonEmpty = row.filter((cell) => cell !== "").length;
      return nonEmpty >= 2 && /型号|款号|model|item|code|品名|产品|规格|spec|单价|price|价格|报价|rmb|人民币|含税|工厂/i.test(text);
    })
    .map(({ number }) => number);
}

function findBestHeaderIndex(rows: string[][]): number {
  const candidate = rows.slice(0, 10).findIndex((row) => row.filter((cell) => cell !== "").length >= 2);
  return candidate >= 0 ? candidate : 0;
}

function buildHeaders(rows: string[][], headerRowIndex: number, colCount: number): string[] {
  const headers: string[] = [];
  const headerRow = rows[headerRowIndex] ?? [];
  const previousRow = headerRowIndex > 0 ? rows[headerRowIndex - 1] ?? [] : [];
  for (let index = 0; index < colCount; index += 1) {
    headers.push(normalizeText(headerRow[index] || previousRow[index] || ""));
  }
  return headers;
}

function parsePositivePrice(value: string): number | null {
  const text = normalizeText(value);
  if (!text) return null;
  const currencyMatch = text.match(/[¥￥$]\s*([\d,]+(?:\.\d+)?)/);
  const numberMatch = currencyMatch ?? text.match(/([\d,]+(?:\.\d+)?)/);
  if (!numberMatch) return null;
  const parsed = Number(numberMatch[1].replace(/,/g, ""));
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 10_000_000) return null;
  if (/^\d{4}$/.test(numberMatch[1]) && parsed >= 1900 && parsed <= 2100) return null;
  return parsed;
}

function isLikelyModelValue(value: string): boolean {
  const text = normalizeText(value);
  if (text.length < 2 || text.length > 80) return false;
  if (/单价|price|报价|含税|不含税|金额|合计/i.test(text)) return false;
  if (/^[\d,.]+$/.test(text)) return false;
  return /[A-Za-z]/.test(text) && /\d/.test(text);
}

function hasEnrichmentText(value: string): boolean {
  return /ctn|carton|装箱|箱规|尺寸|size|材质|material|功率|power|watt|瓦|流明|lumen|cct|色温|ip\d{2}|防水|参数|spec|photo|image|图片|认证|warranty|质保/i.test(
    normalizeText(value),
  );
}

function isRmbPriceHeader(header: string): boolean {
  const text = normalizeText(header);
  return /rmb|人民币|含税|不含税|单价|价格|报价|出厂|工厂价|成本|采购|cny|元/i.test(text) && !isUsdPriceHeader(text);
}

function isUsdPriceHeader(header: string): boolean {
  return /usd|fob|美金|美元|us\$|\$/i.test(normalizeText(header));
}

function isEnrichmentHeader(header: string): boolean {
  return hasEnrichmentText(header);
}

function priceHintFromText(text: string): "rmb" | "usd" | "unknown" {
  if (/fob|usd|美金|美元/i.test(text)) return "usd";
  if (/核价|rmb|人民币|含税|不含税|cny|采购价|工厂价/i.test(text)) return "rmb";
  return "unknown";
}

function isCatalogLike(text: string): boolean {
  return /知识|样册|说明书|画册|catalog|目录|认证|证书|manual|datasheet/i.test(text);
}

function columnSignal(index: number, header: string, count: number, samples: string[]): ColumnSignal {
  return {
    index,
    letter: columnLetter(index),
    header,
    count,
    samples: samples.slice(0, 3),
  };
}

function uniqueSamples(values: string[]): string[] {
  return Array.from(new Set(values.map(normalizeText).filter(Boolean))).slice(0, 5);
}

function buildSummaries(rows: InventoryRow[], pdfCounts: Map<string, number>): SummaryRow[] {
  const grouped = groupBy(rows, (row) => summaryKey(row.major, row.category));
  const summaries: SummaryRow[] = [];

  for (const [key, group] of grouped.entries()) {
    const [major, category] = key.split("||");
    summaries.push({
      major,
      category,
      excel: group.length,
      imported: group.filter((row) => row.importStatus === "已导入").length,
      importable: group.filter((row) => row.classification === "likely-importable").length,
      enrichment: group.filter((row) => row.classification === "enrichment-only").length,
      review: group.filter((row) => row.classification === "needs-review").length,
      skip: group.filter((row) => row.classification === "likely-skip").length,
      pdf: pdfCounts.get(key) ?? 0,
      errors: group.filter((row) => row.readError).length,
    });
  }

  for (const [key, pdf] of pdfCounts.entries()) {
    if (!grouped.has(key)) {
      const [major, category] = key.split("||");
      summaries.push({ major, category, excel: 0, imported: 0, importable: 0, enrichment: 0, review: 0, skip: 0, pdf, errors: 0 });
    }
  }

  return summaries.sort((a, b) => a.major.localeCompare(b.major, "zh-Hans-CN") || a.category.localeCompare(b.category, "zh-Hans-CN"));
}

function buildMarkdownReport(rows: InventoryRow[], summaries: SummaryRow[], pdfCounts: Map<string, number>, elapsedMs: number): string {
  const importCandidates = rows
    .filter((row) => row.classification === "likely-importable")
    .sort(sortByCategoryThenPath);
  const enrichmentCandidates = rows
    .filter((row) => row.classification === "enrichment-only")
    .sort(sortByCategoryThenPath);
  const reviewCandidates = rows
    .filter((row) => row.classification === "needs-review")
    .sort(sortByCategoryThenPath);
  const groupedByCategory = groupBy(rows.sort(sortByCategoryThenPath), (row) => summaryKey(row.major, row.category));

  const lines: string[] = [
    "# V2.13A — 源文件盘点报告",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Root: \`${ROOT}\``,
    "",
    "## 总览",
    "",
    "| 大类 | 品类 | Excel 文件 | 已导入 | likely-importable | enrichment-only | needs-review | likely-skip | PDF | 读取失败 |",
    "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...summaries.map(
      (row) =>
        `| ${escapeMd(row.major)} | ${escapeMd(row.category)} | ${row.excel} | ${row.imported} | ${row.importable} | ${row.enrichment} | ${row.review} | ${row.skip} | ${row.pdf} | ${row.errors} |`,
    ),
    "",
    "## V2.14 导入候选清单",
    "",
    "| 序号 | 文件 | 品类 | 工厂 | 分类 | 理由 | 预估产品数 |",
    "|---:|---|---|---|---|---|---:|",
    ...importCandidates.map(
      (row, index) =>
        `| ${index + 1} | ${escapeMd(row.relativePath)} | ${escapeMd(row.category)} | ${escapeMd(row.factory)} | ${row.classification} | ${escapeMd(row.reason)} | ${row.estimatedProducts} |`,
    ),
    "",
    "## 补充数据候选清单（enrichment-only）",
    "",
    "| 序号 | 文件 | 品类 | 工厂 | 可补内容 |",
    "|---:|---|---|---|---|",
    ...enrichmentCandidates.map(
      (row, index) =>
        `| ${index + 1} | ${escapeMd(row.relativePath)} | ${escapeMd(row.category)} | ${escapeMd(row.factory)} | ${escapeMd(enrichmentSummary(row))} |`,
    ),
    "",
    "## 人工复核候选清单（needs-review）",
    "",
    "| 序号 | 文件 | 品类 | 工厂 | 原因 | 预估产品数 |",
    "|---:|---|---|---|---|---:|",
    ...reviewCandidates.map(
      (row, index) =>
        `| ${index + 1} | ${escapeMd(row.relativePath)} | ${escapeMd(row.category)} | ${escapeMd(row.factory)} | ${escapeMd(row.reason)} | ${row.estimatedProducts} |`,
    ),
    "",
    "## 品类详情",
    "",
  ];

  for (const [key, group] of groupedByCategory.entries()) {
    const [major, category] = key.split("||");
    const factories = Array.from(new Set(group.map((row) => row.factory))).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
    const versionGroups = Array.from(
      groupBy(
        group.filter((row) => row.versionCount > 1),
        (row) => `${row.factory}||${row.versionGroupName}`,
      ).entries(),
    );

    lines.push(`### ${escapeMd(category)}`, "");
    lines.push(`- 大类：${major}`);
    lines.push(`- Excel 文件数：${group.length}`);
    lines.push(`- PDF 文件数：${pdfCounts.get(key) ?? 0}`);
    lines.push(`- 工厂：${factories.slice(0, 20).join(", ")}${factories.length > 20 ? ` 等 ${factories.length} 个` : ""}`);
    lines.push(`- 已导入：${group.filter((row) => row.importStatus === "已导入").length}`);
    lines.push(`- 可导入候选：${group.filter((row) => row.classification === "likely-importable").length}`);
    if (group.some((row) => row.isNewCategory)) {
      lines.push("- 标记：**全新品类**");
    }
    lines.push("");

    if (versionGroups.length > 0) {
      lines.push("#### 多版本分组", "");
      lines.push("| 工厂 | 文件组 | 版本数 | 建议版本（最新） |");
      lines.push("|---|---|---:|---|");
      for (const [, versionGroup] of versionGroups.slice(0, 25)) {
        const representative = versionGroup[0];
        const latest = versionGroup.find((row) => row.isLatestVersion);
        lines.push(
          `| ${escapeMd(representative.factory)} | ${escapeMd(representative.versionGroupName)} | ${versionGroup.length} | ${escapeMd(latest?.fileName ?? "-")} |`,
        );
      }
      if (versionGroups.length > 25) {
        lines.push(`| ... | ... | ... | 另有 ${versionGroups.length - 25} 组，见文件清单 |`);
      }
      lines.push("");
    }

    lines.push("#### 文件清单", "");
    lines.push("| 文件名 | 工厂 | 大小 | 修改日期 | Sheets | 有价格列 | 有型号列 | 导入状态 | 分类 | 备注 |");
    lines.push("|---|---|---:|---|---:|---|---|---|---|---|");
    for (const row of group) {
      lines.push(
        `| ${escapeMd(row.fileName)} | ${escapeMd(row.factory)} | ${formatBytes(row.size)} | ${row.modifiedDate} | ${row.sheetCount} | ${row.hasRmbPrice ? "RMB" : row.hasUsdPrice ? "USD/FOB" : row.hasPrice ? "有" : "否"} | ${row.hasModel ? "是" : "否"} | ${row.importStatus} | ${row.classification} | ${escapeMd(shortNote(row))} |`,
      );
    }
    lines.push("");
  }

  lines.push("## 扫描统计", "");
  lines.push(`- Excel 文件数：${rows.length}`);
  lines.push(`- PDF 文件数：${Array.from(pdfCounts.values()).reduce((sum, value) => sum + value, 0)}`);
  lines.push(`- likely-importable：${importCandidates.length}`);
  lines.push(`- enrichment-only：${enrichmentCandidates.length}`);
  lines.push(`- needs-review：${reviewCandidates.length}`);
  lines.push(`- likely-skip：${rows.filter((row) => row.classification === "likely-skip").length}`);
  lines.push(`- 读取失败 / 深读跳过：${rows.filter((row) => row.readError).length}`);
  lines.push(`- 总耗时：${(elapsedMs / 1000).toFixed(1)}s`);
  lines.push("");

  return `${lines.join("\n")}\n`;
}

function buildCandidateCsv(rows: InventoryRow[]): string {
  const candidates = rows
    .filter((row) => row.classification !== "likely-skip")
    .sort(sortByCategoryThenPath);
  const header = ["path", "category", "factory", "classification", "reason", "estimated_products"];
  return [
    header.join(","),
    ...candidates.map((row) =>
      [
        row.relativePath,
        row.category,
        row.factory,
        row.classification,
        row.reason,
        String(row.estimatedProducts),
      ]
        .map(csvEscape)
        .join(","),
    ),
  ].join("\n");
}

function enrichmentSummary(row: InventoryRow): string {
  const parts: string[] = [];
  if (row.hasUsdPrice) parts.push("USD/FOB 客户价");
  if (row.hasEnrichment) parts.push("规格/参数/图片信号");
  if (row.hasModel) parts.push("型号列");
  if (!parts.length) parts.push(row.reason);
  return parts.join("；");
}

function shortNote(row: InventoryRow): string {
  const pieces = [row.reason];
  if (row.readError && !row.reason.includes(row.readError)) pieces.push(`读取问题：${row.readError}`);
  if (row.versionCount > 1 && row.latestInGroup) {
    pieces.push(row.isLatestVersion ? `同组 ${row.versionCount} 个版本，当前为最新` : `同组 ${row.versionCount} 个版本，最新：${path.basename(row.latestInGroup)}`);
  }
  if (row.categoryNote && !row.reason.includes(row.categoryNote)) pieces.push(row.categoryNote);
  if (row.isNewCategory && !row.reason.includes("全新品类")) pieces.push("全新品类");
  return pieces.join("；");
}

function appendCategoryReason(reason: string, context: CategoryContext): string {
  const additions: string[] = [];
  if (context.isNewCategory) additions.push("全新品类");
  if (context.categoryNote) additions.push(context.categoryNote);
  return additions.length ? `${reason}；${additions.join("；")}` : reason;
}

function buildVersionGroupKey(context: CategoryContext, file: DiskFile): string {
  const parentDir = path.dirname(file.relativePath);
  return [context.major, context.category, context.factory, parentDir, buildVersionGroupName(file.fileName)].join("||");
}

function buildVersionGroupName(fileName: string): string {
  return normalizeText(path.basename(fileName, path.extname(fileName)))
    .toLowerCase()
    .replace(/20\d{2}[年./_\-\s]*\d{0,2}[月./_\-\s]*\d{0,2}日?/g, "")
    .replace(/\d{4}[./_-]\d{1,2}[./_-]\d{1,2}/g, "")
    .replace(/\b\d{8}\b/g, "")
    .replace(/\(\d+\)|（\d+）|\[\d+\]|【\d+】/g, "")
    .replace(/副本|copy|更新|最新版|最终版|final|核价|报价单|报价|价格|price|quotation|quote/gi, "")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

function sortByCategoryThenPath(a: InventoryRow, b: InventoryRow): number {
  return (
    a.major.localeCompare(b.major, "zh-Hans-CN") ||
    a.category.localeCompare(b.category, "zh-Hans-CN") ||
    a.factory.localeCompare(b.factory, "zh-Hans-CN") ||
    a.relativePath.localeCompare(b.relativePath, "zh-Hans-CN")
  );
}

function groupBy<T>(values: T[], keyFn: (value: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const value of values) {
    const key = keyFn(value);
    const group = groups.get(key);
    if (group) {
      group.push(value);
    } else {
      groups.set(key, [value]);
    }
  }
  return groups;
}

function increment(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function summaryKey(major: string, category: string): string {
  return `${major}||${category}`;
}

function nameSizeKey(fileName: string, fileSize: bigint): string {
  return `${normalizeText(fileName)}||${fileSize.toString()}`;
}

function portableRelative(root: string, absolutePath: string): string {
  return path.relative(root, absolutePath).split(path.sep).join("/").normalize("NFC");
}

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFC")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCell(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return normalizeText(value);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function columnLetter(index: number): string {
  let value = index + 1;
  let result = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function escapeMd(value: unknown): string {
  return normalizeText(value).replace(/\|/g, "\\|");
}

function csvEscape(value: string): string {
  const escaped = value.replace(/"/g, '""');
  return /[",\n]/.test(escaped) ? `"${escaped}"` : escaped;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
