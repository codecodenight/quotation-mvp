import "dotenv/config";

import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { PrismaClient } from "@prisma/client";
import * as XLSX from "xlsx";

import { formatInteger, formatPercent, md } from "./v25-watts-shared";

export const V27_0_REPORT_PATH = path.join("docs", "v27.0-full-param-audit-report.md");

const HEADER_SCAN_ROWS = 10;
const MIN_HEADER_CELLS = 3;
const SAMPLE_LIMIT = 10;
const UNRECOGNIZED_MIN_COUNT = 5;

export type HeaderParamKind = "direct" | "indirect";

export type HeaderParamRule = {
  param_key: string;
  patterns: RegExp[];
  kind: HeaderParamKind;
};

export const HEADER_TO_PARAM: HeaderParamRule[] = [
  {
    param_key: "watts",
    patterns: [
      /^(?:watt|watts|wattage|power|actual\s*power|rated\s*power|功率|实际功率|实测功率|额定功率|瓦数)$/i,
      /(?:^|[\s(])(\d+)?w(?:$|[\s)])/i,
    ],
    kind: "direct",
  },
  { param_key: "pf", patterns: [/^(?:PF|P\.F\.|power\s*factor|功率因[数素])$/i, /\bPF\b/i], kind: "direct" },
  { param_key: "ip", patterns: [/^(?:IP|IP\s*(?:rating|grade|等级)|防[水护]等级|protection)$/i, /\bIP\s*\d{2}/i], kind: "direct" },
  { param_key: "material", patterns: [/^(?:material|材质|材料|外壳材[质料]|housing|body\s*material|灯体材[质料]|壳体)$/i], kind: "direct" },
  { param_key: "beam_angle", patterns: [/^(?:beam\s*angle|发光角[度]?|光束角|角度|照射角)$/i, /angle/i], kind: "direct" },
  { param_key: "lumens", patterns: [/^(?:lumens?|lm|光通量|流明|luminous\s*flux|total\s*flux)$/i, /\blm\b/i], kind: "direct" },
  { param_key: "luminous_efficacy", patterns: [/^(?:efficacy|光效|光源效率|luminous\s*efficacy|lm\/w)$/i, /lm\s*\/\s*w/i], kind: "direct" },
  { param_key: "driver_type", patterns: [/^(?:driver|驱动|电源|power\s*supply|driver\s*type|电源方案|驱动类型)$/i], kind: "direct" },
  { param_key: "cri", patterns: [/^(?:CRI|Ra|显色指数|显色|color\s*rendering)$/i], kind: "direct" },
  { param_key: "cct", patterns: [/^(?:CCT|色温|color\s*temp(?:erature)?|kelvin)$/i], kind: "direct" },
  { param_key: "voltage", patterns: [/^(?:voltage|input\s*voltage|电压|输入电压|工作电压)$/i], kind: "direct" },
  { param_key: "size_display", patterns: [/^(?:size|尺寸|外形尺寸|dimension|产品尺寸|灯体尺寸|整灯尺寸)$/i], kind: "direct" },
  { param_key: "certification", patterns: [/^(?:cert|certification|认证|certificate)$/i], kind: "direct" },
  { param_key: "led_type", patterns: [/^(?:led\s*type|LED\s*(?:chip|芯片)|灯珠|光源类型|chip\s*type|LED\s*source)$/i], kind: "direct" },
  { param_key: "base", patterns: [/^(?:base|灯头|灯口|cap|lamp\s*base|接口)$/i], kind: "direct" },
  { param_key: "led_count", patterns: [/^(?:led\s*(?:qty|count|数量|颗数)|灯珠数[量]?|LED\s*Qty)$/i], kind: "direct" },
  { param_key: "warranty", patterns: [/^(?:warranty|质保|保修|guarantee)$/i], kind: "direct" },
  { param_key: "dimmable", patterns: [/^(?:dim(?:mable)?|调光|可调光)$/i], kind: "direct" },
];

export const PARAM_KEYS = HEADER_TO_PARAM.map((rule) => rule.param_key);

const MODEL_HEADER_PATTERNS = [
  /item\s*no/i,
  /model/i,
  /型号/i,
  /产品型号/i,
  /product\s*no/i,
  /编号/i,
  /款号/i,
  /^item$/i,
  /^product\s*name$/i,
  /^产品名称$/i,
  /^品名$/i,
  /^名称$/i,
  /^specifications?$/i,
  /^description$/i,
];

const BUSINESS_HEADER_PATTERNS = [
  /price/i,
  /fob/i,
  /unit\s*price/i,
  /单价/i,
  /价格/i,
  /含税/i,
  /不含税/i,
  /moq/i,
  /起订/i,
  /ctn/i,
  /carton/i,
  /package/i,
  /packing/i,
  /图片/i,
  /picture/i,
  /photo/i,
  /备注/i,
  /remark/i,
];

type HeaderInfo = {
  rowIndex: number;
  values: unknown[];
};

export type ProductSourceInfo = {
  sourceFileId: string;
  fileName: string;
  absolutePathSnapshot: string;
};

export type SourceProduct = {
  productId: string;
  productName: string;
  modelNo: string | null;
  category: string;
  existingParams: Set<string>;
  sources: ProductSourceInfo[];
};

export type SourceFileProducts = {
  id: string;
  fileName: string;
  absolutePathSnapshot: string;
  products: SourceProduct[];
};

export type ParamColumn = {
  index: number;
  header: string;
  paramKey: string;
  kind: HeaderParamKind;
  samples: string[];
};

export type SheetParamAnalysis = {
  fileId: string;
  fileName: string;
  sheetName: string;
  rows: unknown[][];
  headerRowIndex: number | null;
  headerPreview: string;
  modelColumns: number[];
  paramColumns: ParamColumn[];
  unrecognizedHeaders: Array<{ header: string; samples: string[] }>;
  rowIndexByModel: Map<string, number[]>;
};

export type FileParamAnalysis = {
  fileId: string;
  fileName: string;
  absolutePathSnapshot: string;
  readable: boolean;
  readError: string | null;
  sheets: SheetParamAnalysis[];
};

export type ParamDetail = {
  paramKey: string;
  fileName: string;
  sheetName: string;
  header: string;
  samples: string[];
  involvedProducts: number;
  missingProducts: number;
  extractable: number;
  matchedNoValue: number;
  unmatched: number;
  ambiguous: number;
};

export type UnrecognizedHeaderStat = {
  header: string;
  count: number;
  samples: string[];
  suggestedParamKey: string;
};

export type CoverageRow = {
  paramKey: string;
  appearingFiles: number;
  appearingSheets: number;
  involvedProducts: number;
  currentCovered: number;
  sourceProducts: number;
  missingProducts: number;
  auditCeiling: number;
  incremental: number;
};

export type FullParamAuditSummary = {
  sourceProductCount: number;
  sourceFileCount: number;
  readableFileCount: number;
  unreadableFiles: FileParamAnalysis[];
  analyses: FileParamAnalysis[];
  details: ParamDetail[];
  coverageRows: CoverageRow[];
  unrecognizedHeaders: UnrecognizedHeaderStat[];
};

type SourceProductRow = {
  product_id: string;
  product_name: string;
  model_no: string | null;
  category: string | null;
  source_file_id: string;
  file_name: string;
  absolute_path_snapshot: string;
};

type ExistingParamRow = {
  product_id: string;
  param_key: string;
};

async function main() {
  if (process.argv.includes("--apply")) throw new Error("V27.0 is read-only and does not accept --apply.");
  const prisma = new PrismaClient();
  try {
    const summary = await runFullParamAudit(prisma);
    await mkdir(path.dirname(V27_0_REPORT_PATH), { recursive: true });
    await writeFile(V27_0_REPORT_PATH, buildFullParamAuditReport(summary), "utf8");
    console.log(
      JSON.stringify(
        {
          mode: "read-only",
          reportPath: V27_0_REPORT_PATH,
          sourceProducts: summary.sourceProductCount,
          sourceFiles: summary.sourceFileCount,
          readableFiles: summary.readableFileCount,
          unreadableFiles: summary.unreadableFiles.length,
          topExtractable: summary.coverageRows
            .filter((row) => row.incremental > 0)
            .slice(0, 10)
            .map((row) => ({ paramKey: row.paramKey, incremental: row.incremental, auditCeiling: row.auditCeiling })),
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

export async function runFullParamAudit(prisma: PrismaClient): Promise<FullParamAuditSummary> {
  const { products, files } = await loadSourceProducts(prisma);
  const analyses: FileParamAnalysis[] = [];
  const details: ParamDetail[] = [];
  const unrecognized = new Map<string, { count: number; samples: Set<string> }>();
  const summarySets = new Map<string, { files: Set<string>; sheets: Set<string>; involved: Set<string>; missing: Set<string>; extractable: Set<string> }>();

  for (const key of PARAM_KEYS) {
    summarySets.set(key, { files: new Set(), sheets: new Set(), involved: new Set(), missing: new Set(), extractable: new Set() });
  }

  for (const [index, file] of files.entries()) {
    if (index === 0 || (index + 1) % 25 === 0 || index + 1 === files.length) {
      console.log(`V27.0 full param audit ${index + 1}/${files.length}: ${file.fileName}`);
    }
    const analysis = analyzeSourceFile(file);
    analyses.push(analysis);
    for (const sheet of analysis.sheets) {
      collectUnrecognizedHeaders(unrecognized, sheet.unrecognizedHeaders);
      const sheetDetails = buildSheetDetails(file.products, sheet);
      details.push(...sheetDetails);
      for (const detail of sheetDetails) {
        const sets = summarySets.get(detail.paramKey);
        if (!sets) continue;
        sets.files.add(analysis.fileId);
        sets.sheets.add(`${analysis.fileId}\u0000${detail.sheetName}`);
      }
      collectSheetSummarySets(file, sheet, summarySets);
    }
  }

  const coverageRows = buildCoverageRows(products, summarySets);
  return {
    sourceProductCount: products.length,
    sourceFileCount: files.length,
    readableFileCount: analyses.filter((analysis) => analysis.readable).length,
    unreadableFiles: analyses.filter((analysis) => !analysis.readable),
    analyses,
    details,
    coverageRows,
    unrecognizedHeaders: buildUnrecognizedHeaderStats(unrecognized),
  };
}

export async function loadSourceProducts(prisma: PrismaClient): Promise<{ products: SourceProduct[]; files: SourceFileProducts[] }> {
  const productRows = await prisma.$queryRaw<SourceProductRow[]>`
    SELECT p.id AS product_id,
           p.product_name,
           p.model_no,
           p.category,
           so.source_file_id,
           f.file_name,
           f.absolute_path_snapshot
    FROM products p
    JOIN supplier_offers so
      ON so.product_id = p.id
    JOIN files f
      ON f.id = so.source_file_id
    WHERE so.source_file_id IS NOT NULL
    ORDER BY f.file_name, p.category, p.product_name
  `;

  const products = new Map<string, SourceProduct>();
  const files = new Map<string, SourceFileProducts>();
  const seenProductFile = new Set<string>();
  for (const row of productRows) {
    const product =
      products.get(row.product_id) ??
      ({
        productId: row.product_id,
        productName: row.product_name,
        modelNo: row.model_no,
        category: cleanCategory(row.category),
        existingParams: new Set<string>(),
        sources: [],
      } satisfies SourceProduct);
    const productFileKey = `${row.product_id}\u0000${row.source_file_id}`;
    if (!seenProductFile.has(productFileKey)) {
      product.sources.push({ sourceFileId: row.source_file_id, fileName: row.file_name, absolutePathSnapshot: row.absolute_path_snapshot });
      seenProductFile.add(productFileKey);
    }
    products.set(row.product_id, product);
  }

  const existingRows = await prisma.$queryRaw<ExistingParamRow[]>`
    SELECT DISTINCT pp.product_id, pp.param_key
    FROM product_params pp
    JOIN supplier_offers so
      ON so.product_id = pp.product_id
     AND so.source_file_id IS NOT NULL
  `;
  for (const row of existingRows) products.get(row.product_id)?.existingParams.add(row.param_key);

  for (const product of products.values()) {
    for (const source of product.sources) {
      const file =
        files.get(source.sourceFileId) ??
        ({
          id: source.sourceFileId,
          fileName: source.fileName,
          absolutePathSnapshot: source.absolutePathSnapshot,
          products: [],
        } satisfies SourceFileProducts);
      file.products.push(product);
      files.set(source.sourceFileId, file);
    }
  }

  return {
    products: [...products.values()],
    files: [...files.values()].sort((left, right) => left.fileName.localeCompare(right.fileName)),
  };
}

export function analyzeSourceFile(file: SourceFileProducts): FileParamAnalysis {
  const analysis: FileParamAnalysis = {
    fileId: file.id,
    fileName: file.fileName,
    absolutePathSnapshot: file.absolutePathSnapshot,
    readable: false,
    readError: null,
    sheets: [],
  };
  if (!existsSync(file.absolutePathSnapshot)) {
    analysis.readError = "source path missing";
    return analysis;
  }

  try {
    const workbook = XLSX.readFile(file.absolutePathSnapshot, { cellDates: false });
    analysis.readable = true;
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet?.["!ref"]) continue;
      const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: false });
      if (rows.length === 0) continue;
      const header = detectHeaderRow(rows);
      const headerValues = header?.values ?? [];
      const paramColumns = findParamColumns(headerValues).map((column) => ({ ...column, samples: collectColumnSamples(rows, header?.rowIndex ?? null, column.index) }));
      const modelColumns = findModelColumns(headerValues);
      const headerPreview = headerValues.map((cell) => cellToString(cell)).filter(Boolean).slice(0, 14).join(" / ");
      analysis.sheets.push({
        fileId: file.id,
        fileName: file.fileName,
        sheetName,
        rows,
        headerRowIndex: header?.rowIndex ?? null,
        headerPreview,
        modelColumns,
        paramColumns,
        unrecognizedHeaders: collectUnrecognizedInHeader(headerValues, rows, header?.rowIndex ?? null),
        rowIndexByModel: buildRowIndexByModel(rows, header?.rowIndex ?? null, modelColumns),
      });
    }
  } catch (error) {
    analysis.readError = error instanceof Error ? error.message : String(error);
  }
  return analysis;
}

function buildSheetDetails(products: SourceProduct[], sheet: SheetParamAnalysis): ParamDetail[] {
  const out: ParamDetail[] = [];
  for (const column of sheet.paramColumns) {
    const missingProducts = products.filter((product) => !product.existingParams.has(column.paramKey));
    let extractable = 0;
    let matchedNoValue = 0;
    let unmatched = 0;
    let ambiguous = 0;
    for (const product of missingProducts) {
      const match = findExactMatchRow(product, sheet);
      if (match.status === "unmatched") {
        unmatched += 1;
        continue;
      }
      if (match.status === "ambiguous") {
        ambiguous += 1;
        continue;
      }
      const raw = cellToString(sheet.rows[match.rowIndex]?.[column.index]);
      if (raw) extractable += 1;
      else matchedNoValue += 1;
    }
    out.push({
      paramKey: column.paramKey,
      fileName: sheet.fileName,
      sheetName: sheet.sheetName,
      header: column.header,
      samples: column.samples,
      involvedProducts: products.length,
      missingProducts: missingProducts.length,
      extractable,
      matchedNoValue,
      unmatched,
      ambiguous,
    });
  }
  return out;
}

function collectSheetSummarySets(
  file: SourceFileProducts,
  sheet: SheetParamAnalysis,
  summarySets: Map<string, { files: Set<string>; sheets: Set<string>; involved: Set<string>; missing: Set<string>; extractable: Set<string> }>,
) {
  for (const column of sheet.paramColumns) {
    const sets = summarySets.get(column.paramKey);
    if (!sets) continue;
    for (const product of file.products) {
      sets.involved.add(product.productId);
      if (product.existingParams.has(column.paramKey)) continue;
      sets.missing.add(product.productId);
      const match = findExactMatchRow(product, sheet);
      if (match.status !== "matched") continue;
      const raw = cellToString(sheet.rows[match.rowIndex]?.[column.index]);
      if (raw) sets.extractable.add(product.productId);
    }
  }
}

function buildCoverageRows(
  products: SourceProduct[],
  summarySets: Map<string, { files: Set<string>; sheets: Set<string>; involved: Set<string>; missing: Set<string>; extractable: Set<string> }>,
): CoverageRow[] {
  return PARAM_KEYS.map((paramKey) => {
    const currentCovered = products.filter((product) => product.existingParams.has(paramKey)).length;
    const sets = summarySets.get(paramKey);
    const incremental = sets?.extractable.size ?? 0;
    return {
      paramKey,
      appearingFiles: sets?.files.size ?? 0,
      appearingSheets: sets?.sheets.size ?? 0,
      involvedProducts: sets?.involved.size ?? 0,
      currentCovered,
      sourceProducts: products.length,
      missingProducts: products.length - currentCovered,
      auditCeiling: currentCovered + incremental,
      incremental,
    };
  }).sort((left, right) => right.incremental - left.incremental || left.paramKey.localeCompare(right.paramKey));
}

function detectHeaderRow(rows: unknown[][]): HeaderInfo | null {
  let fallback: HeaderInfo | null = null;
  for (let rowIndex = 0; rowIndex < Math.min(rows.length, HEADER_SCAN_ROWS); rowIndex += 1) {
    const values = rows[rowIndex] ?? [];
    const nonEmptyCount = values.filter((cell) => cellToString(cell)).length;
    if (nonEmptyCount < MIN_HEADER_CELLS) continue;
    if (!fallback) fallback = { rowIndex, values };
    if (values.some((cell) => isModelHeader(cellToString(cell)) || Boolean(matchHeaderToParam(cellToString(cell))))) return { rowIndex, values };
  }
  return fallback;
}

function findParamColumns(headerValues: unknown[]): ParamColumn[] {
  const columns: ParamColumn[] = [];
  for (const [index, value] of headerValues.entries()) {
    const header = cellToString(value);
    const matched = matchHeaderToParam(header);
    if (!matched) continue;
    columns.push({ index, header, paramKey: matched.param_key, kind: matched.kind, samples: [] });
  }
  return columns;
}

function matchHeaderToParam(value: string): HeaderParamRule | null {
  const normalized = normalizeHeader(value);
  if (!normalized || isBusinessHeader(normalized)) return null;
  return HEADER_TO_PARAM.find((rule) => rule.patterns.some((pattern) => pattern.test(normalized))) ?? null;
}

function findModelColumns(headerValues: unknown[]): number[] {
  const direct: number[] = [];
  for (const [index, value] of headerValues.entries()) {
    if (isModelHeader(cellToString(value))) direct.push(index);
  }
  if (direct.length > 0) return direct;

  const fallback: number[] = [];
  for (const [index, value] of headerValues.entries()) {
    const normalized = normalizeHeader(cellToString(value));
    if (!normalized || isBusinessHeader(normalized) || matchHeaderToParam(normalized)) continue;
    fallback.push(index);
    if (fallback.length >= 4) break;
  }
  return fallback;
}

function buildRowIndexByModel(rows: unknown[][], headerRowIndex: number | null, modelColumns: number[]): Map<string, number[]> {
  const map = new Map<string, number[]>();
  if (headerRowIndex == null || modelColumns.length === 0) return map;
  for (let rowIndex = headerRowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    if (isBlankRow(row)) continue;
    for (const columnIndex of modelColumns) {
      const key = normalizeExact(cellToString(row[columnIndex]));
      if (!isUsefulExactKey(key)) continue;
      const values = map.get(key) ?? [];
      values.push(rowIndex);
      map.set(key, values);
    }
  }
  return map;
}

export function findExactMatchRow(product: SourceProduct, sheet: Pick<SheetParamAnalysis, "rowIndexByModel">): { status: "matched"; rowIndex: number } | { status: "ambiguous" } | { status: "unmatched" } {
  const key = normalizeExact(product.modelNo ?? "");
  if (!isUsefulExactKey(key)) return { status: "unmatched" };
  const rowIndexes = [...new Set(sheet.rowIndexByModel.get(key) ?? [])];
  if (rowIndexes.length === 0) return { status: "unmatched" };
  if (rowIndexes.length > 1) return { status: "ambiguous" };
  return { status: "matched", rowIndex: rowIndexes[0] };
}

function collectColumnSamples(rows: unknown[][], headerRowIndex: number | null, columnIndex: number): string[] {
  if (headerRowIndex == null) return [];
  const samples: string[] = [];
  for (let rowIndex = headerRowIndex + 1; rowIndex < rows.length && samples.length < SAMPLE_LIMIT; rowIndex += 1) {
    const value = cellToString(rows[rowIndex]?.[columnIndex]);
    if (value) samples.push(value);
  }
  return [...new Set(samples)].slice(0, SAMPLE_LIMIT);
}

function collectUnrecognizedInHeader(headerValues: unknown[], rows: unknown[][], headerRowIndex: number | null): Array<{ header: string; samples: string[] }> {
  const out: Array<{ header: string; samples: string[] }> = [];
  for (const [index, value] of headerValues.entries()) {
    const header = cellToString(value);
    if (!header || isModelHeader(header) || isBusinessHeader(header) || matchHeaderToParam(header)) continue;
    out.push({ header, samples: collectColumnSamples(rows, headerRowIndex, index) });
  }
  return out;
}

function collectUnrecognizedHeaders(unrecognized: Map<string, { count: number; samples: Set<string> }>, headers: Array<{ header: string; samples: string[] }>) {
  for (const header of headers) {
    const key = normalizeHeader(header.header) || header.header;
    const stat = unrecognized.get(key) ?? { count: 0, samples: new Set<string>() };
    stat.count += 1;
    for (const sample of header.samples.slice(0, 3)) stat.samples.add(sample);
    unrecognized.set(key, stat);
  }
}

function buildUnrecognizedHeaderStats(unrecognized: Map<string, { count: number; samples: Set<string> }>): UnrecognizedHeaderStat[] {
  return [...unrecognized.entries()]
    .filter(([, stat]) => stat.count >= UNRECOGNIZED_MIN_COUNT)
    .map(([header, stat]) => ({ header, count: stat.count, samples: [...stat.samples].slice(0, 5), suggestedParamKey: suggestParamKey(header) }))
    .sort((left, right) => right.count - left.count || left.header.localeCompare(right.header));
}

function suggestParamKey(header: string): string {
  if (/color|颜色|colour/i.test(header)) return "color";
  if (/weight|重量|净重|毛重/i.test(header)) return "weight";
  if (/carton|ctn|箱/i.test(header)) return "carton";
  if (/qty|数量|pcs/i.test(header)) return "quantity";
  if (/长度|length|高|宽|height|width|diameter|直径/i.test(header)) return "size_related";
  return "-";
}

export function buildFullParamAuditReport(summary: FullParamAuditSummary): string {
  const detailByParam = groupDetailsByParam(summary.details);
  const recognizedRows = buildRecognizedSummaryRows(summary);
  const ceilingRows = summary.coverageRows
    .map((row) => `| ${md(row.paramKey)} | ${formatInteger(row.currentCovered)}/${formatInteger(row.sourceProducts)} (${formatPercent(row.currentCovered, row.sourceProducts)}) | ${formatInteger(row.auditCeiling)}/${formatInteger(row.sourceProducts)} (${formatPercent(row.auditCeiling, row.sourceProducts)}) | +${formatInteger(row.incremental)} |`)
    .join("\n");
  return `# V27.0 全参数源文件列审计报告

时间: ${new Date().toISOString()}
模式: read-only

## 总览
- 有源文件产品数: ${formatInteger(summary.sourceProductCount)}
- 源文件数: ${formatInteger(summary.sourceFileCount)}
- 可读取源文件: ${formatInteger(summary.readableFileCount)}
- 不可读取源文件: ${formatInteger(summary.unreadableFiles.length)}

## 列头识别汇总

| param_key | 出现文件数 | 出现 sheet 数 | 涉及产品数 | 当前缺失该参数的产品数 | 预计可提取 |
|-----------|-----------|-------------|-----------|---------------------|-----------|
${recognizedRows}

## 按 param_key 详细

${PARAM_KEYS.map((paramKey) => buildParamDetailSection(paramKey, detailByParam.get(paramKey) ?? [])).join("\n\n")}

## 列头未识别统计

| 列头原文 | 出现次数 | 值样本 | 建议 param_key |
|---------|---------|--------|---------------|
${summary.unrecognizedHeaders.map((row) => `| ${md(row.header)} | ${formatInteger(row.count)} | ${md(row.samples.join(" / ") || "-")} | ${md(row.suggestedParamKey)} |`).join("\n")}

## 整体天花板预估

| param_key | 当前覆盖 | 审计天花板 | 增量 |
|-----------|---------|-----------|------|
${ceilingRows}

## product_params 当前统计

| param_key | 当前覆盖产品数 | 有源文件产品数 | 当前覆盖率 |
|-----------|---------------|---------------|-----------|
${summary.coverageRows
  .slice()
  .sort((left, right) => left.paramKey.localeCompare(right.paramKey))
  .map((row) => `| ${md(row.paramKey)} | ${formatInteger(row.currentCovered)} | ${formatInteger(row.sourceProducts)} | ${formatPercent(row.currentCovered, row.sourceProducts)} |`)
  .join("\n")}

## 文件读取问题

| 文件名 | 路径 | 原因 |
|--------|------|------|
${summary.unreadableFiles.map((file) => `| ${md(file.fileName)} | ${md(file.absolutePathSnapshot)} | ${md(file.readError ?? "-")} |`).join("\n")}

## 说明
- 只读审计，未写入数据库。
- 产品匹配预检只使用 model_no 精确匹配，不使用 normalized/loose match。
- 预计可提取只表示列存在、型号唯一匹配、单元格非空；V27.1 写库前还会做值验证。
`;
}

function buildRecognizedSummaryRows(summary: FullParamAuditSummary): string {
  return summary.coverageRows
    .map((row) => {
      return `| ${md(row.paramKey)} | ${formatInteger(row.appearingFiles)} | ${formatInteger(row.appearingSheets)} | ${formatInteger(row.involvedProducts)} | ${formatInteger(row.missingProducts)} | ${formatInteger(row.incremental)} |`;
    })
    .join("\n");
}

function buildParamDetailSection(paramKey: string, details: ParamDetail[]): string {
  const rows = details
    .slice()
    .sort((left, right) => right.extractable - left.extractable || left.fileName.localeCompare(right.fileName) || left.sheetName.localeCompare(right.sheetName))
    .map((detail) => `| ${md(detail.fileName)} | ${md(detail.sheetName)} | ${md(detail.header)} | ${md(detail.samples.slice(0, 5).join(" / ") || "-")} | ${formatInteger(detail.involvedProducts)} | ${formatInteger(detail.missingProducts)} | ${formatInteger(detail.extractable)} |`)
    .join("\n");
  return `### ${paramKey}

| 文件名 | sheet 名 | 列头原文 | 值样本(前5) | 涉及产品数 | 缺该参数数 | 可匹配+有值 |
|--------|---------|---------|------------|-----------|-----------|------------|
${rows}`;
}

function groupDetailsByParam(details: ParamDetail[]): Map<string, ParamDetail[]> {
  const map = new Map<string, ParamDetail[]>();
  for (const detail of details) {
    const values = map.get(detail.paramKey) ?? [];
    values.push(detail);
    map.set(detail.paramKey, values);
  }
  return map;
}

export function unitForParam(paramKey: string): string | null {
  if (paramKey === "beam_angle") return "°";
  if (paramKey === "lumens") return "lm";
  if (paramKey === "luminous_efficacy") return "lm/W";
  if (paramKey === "cct") return "K";
  if (paramKey === "voltage") return "V";
  return null;
}

export function cellToString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value).trim();
  return String(value).trim();
}

function normalizeHeader(value: string): string {
  return value
    .normalize("NFC")
    .replace(/[\r\n]+/g, " ")
    .replace(/[（(][^）)]*[）)]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizeExact(value: string): string {
  return value.normalize("NFC").toLowerCase().replace(/\s+/g, "").trim();
}

function isUsefulExactKey(value: string): boolean {
  if (value.length < 2) return false;
  if (value === "-" || value === "/" || value === "unknown") return false;
  return true;
}

function isModelHeader(value: string): boolean {
  const normalized = normalizeHeader(value);
  return Boolean(normalized && MODEL_HEADER_PATTERNS.some((pattern) => pattern.test(normalized)));
}

function isBusinessHeader(value: string): boolean {
  const normalized = normalizeHeader(value);
  return BUSINESS_HEADER_PATTERNS.some((pattern) => pattern.test(normalized));
}

function isBlankRow(row: unknown[]): boolean {
  return row.every((cell) => !cellToString(cell));
}

function cleanCategory(value: string | null): string {
  const trimmed = value?.trim();
  return trimmed || "(未分类)";
}

function isCliEntry(): boolean {
  const entry = process.argv[1];
  return Boolean(entry && pathToFileURL(path.resolve(entry)).href === import.meta.url);
}

if (isCliEntry()) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
