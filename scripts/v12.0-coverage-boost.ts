import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { PrismaClient } from "@prisma/client";
import * as XLSX from "xlsx";

import {
  cellToString,
  detectBestHeader,
  detectMultiRowHeader,
  escapeMd,
  INSERT_BATCH_SIZE,
  isBlankRow,
  matchProduct,
  normalizeForMatch,
  productParamKey,
  resolvePhysicalPath,
} from "./v11-shared";

const prisma = new PrismaClient();

const REPORT_PATH = path.join("docs", "v12.0-coverage-boost-report.md");
const BACKUP_PATH = path.join("prisma", "dev.db.bak-v12.0");
const APPLY_MODE = process.argv.includes("--apply");
const PROPAGATABLE_PARAMS = ["voltage", "driver_type", "ip", "cri", "pf", "cct", "material"] as const;

type PropagatableParam = (typeof PROPAGATABLE_PARAMS)[number];

type LinkedProductRow = {
  file_id: string;
  file_name: string;
  relative_path: string;
  product_id: string;
  model_no: string | null;
  product_name: string;
  category: string | null;
};

type LinkedProduct = {
  productId: string;
  modelNo: string | null;
  productName: string;
  category: string | null;
};

type SourceFile = {
  id: string;
  fileName: string;
  relativePath: string;
  products: LinkedProduct[];
};

type ExistingParam = {
  product_id: string;
  param_key: string;
  raw_value: string;
  normalized_value: string | null;
  unit: string | null;
};

type PlannedParam = {
  id: string;
  productId: string;
  productModel: string;
  productName: string;
  category: string;
  source: "column_header_value" | "compound_model" | "file_propagation";
  confidence: "high" | "medium" | "low";
  fileId: string | null;
  fileName: string | null;
  sheetName: string | null;
  rowNumber: number | null;
  header: string | null;
  paramKey: string;
  rawValue: string;
  normalizedValue: string | null;
  unit: string | null;
};

type ValueHeader = {
  colIndex: number;
  rawHeader: string;
  paramKey: string;
  normalizedValue: string;
  unit: string | null;
};

type BadParam = {
  id: string;
  product_id: string;
  param_key: string;
  raw_value: string;
  normalized_value: string | null;
  model_no: string | null;
  category: string | null;
};

type PartAResult = {
  badParams: BadParam[];
  deleted: number;
};

type PartBFileResult = {
  fileName: string;
  relativePath: string;
  sheets: number;
  valueHeaderSheets: number;
  matchedRows: number;
  existingParamsSkipped: number;
  plannedParams: number;
  multiWattsConflicts: number;
  readError: string | null;
};

type HeaderStats = {
  rawHeader: string;
  paramKey: string;
  normalizedValue: string;
  fileKeys: Set<string>;
  matchedRows: number;
};

type PartBResult = {
  fileResults: PartBFileResult[];
  plannedParams: PlannedParam[];
  headerStats: Map<string, HeaderStats>;
  matchSamples: MatchSample[];
  conflictSamples: ConflictSample[];
  inserted: number;
};

type MatchSample = {
  fileName: string;
  sheetName: string;
  productName: string;
  header: string;
  paramKey: string;
  value: string;
};

type ConflictSample = {
  fileName: string;
  productName: string;
  powerHeaders: string;
};

type ParsedCompoundParam = {
  paramKey: string;
  rawValue: string;
  normalizedValue: string | null;
  unit: string | null;
};

type PartCResult = {
  scannedProducts: number;
  parsedProducts: number;
  plannedParams: PlannedParam[];
  existingParamsSkipped: number;
  inserted: number;
};

type PropagationSample = {
  paramKey: string;
  value: string;
  fileName: string;
  ratio: number;
  benefitedProducts: number;
};

type PartDResult = {
  scannedFiles: number;
  propagationGroups: number;
  benefitedProducts: Set<string>;
  plannedParams: PlannedParam[];
  existingParamsSkipped: number;
  samples: PropagationSample[];
  inserted: number;
};

type ParamStats = {
  paramKey: string;
  newRecords: number;
  productIds: Set<string>;
};

type CoverageRow = {
  paramKey: string;
  before: number;
  after: number;
};

async function main() {
  if (!existsSync(BACKUP_PATH)) {
    throw new Error(`Missing DB backup: ${BACKUP_PATH}`);
  }

  const productParamsBefore = await prisma.productParam.count();
  const coverageBefore = await loadCoverage(Array.from(new Set([...PROPAGATABLE_PARAMS, "watts", "luminous_efficacy", "base", "size_display"])));

  const allProductIdsBefore = await loadAllProductIds();
  const existingParamKeys = await loadExistingParamKeys(allProductIdsBefore);
  const sourceFiles = await loadSourceFiles();

  const partA = await runPartA();
  const partB = await runPartB(sourceFiles, existingParamKeys);
  const partC = await runPartC(existingParamKeys);
  const partD = await runPartD(sourceFiles, existingParamKeys);

  const productParamsAfter = await prisma.productParam.count();
  const coverageAfter = await loadCoverage(Array.from(new Set([...coverageBefore.keys(), ...PROPAGATABLE_PARAMS, "watts", "luminous_efficacy", "base", "size_display"])));
  const coverageRows = buildCoverageRows(coverageBefore, coverageAfter);

  await mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await writeFile(
    REPORT_PATH,
    buildReport({
      mode: APPLY_MODE ? "apply" : "dry-run",
      partA,
      partB,
      partC,
      partD,
      productParamsBefore,
      productParamsAfter,
      coverageRows,
    }),
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        mode: APPLY_MODE ? "apply" : "dry-run",
        reportPath: REPORT_PATH,
        partADeleted: partA.deleted,
        partBPlanned: partB.plannedParams.length,
        partBInserted: partB.inserted,
        partCPlanned: partC.plannedParams.length,
        partCInserted: partC.inserted,
        partDPlanned: partD.plannedParams.length,
        partDInserted: partD.inserted,
        productParamsBefore,
        productParamsAfter,
      },
      null,
      2,
    ),
  );

  await prisma.$disconnect();
}

async function loadAllProductIds(): Promise<string[]> {
  const products = await prisma.product.findMany({ select: { id: true } });
  return products.map((product) => product.id);
}

async function loadSourceFiles(): Promise<SourceFile[]> {
  const rows = await prisma.$queryRaw<LinkedProductRow[]>`
    SELECT DISTINCT
      f.id AS file_id,
      f.file_name,
      f.relative_path,
      p.id AS product_id,
      p.model_no,
      p.product_name,
      p.category
    FROM supplier_offers so
    JOIN files f ON f.id = so.source_file_id
    JOIN products p ON p.id = so.product_id
    WHERE so.source_file_id IS NOT NULL
      AND f.file_type = 'excel'
    ORDER BY f.relative_path, p.model_no, p.product_name
  `;

  const files = new Map<string, SourceFile>();
  for (const row of rows) {
    const file = files.get(row.file_id) ?? { id: row.file_id, fileName: row.file_name, relativePath: row.relative_path, products: [] };
    file.products.push({
      productId: row.product_id,
      modelNo: row.model_no,
      productName: row.product_name,
      category: row.category,
    });
    files.set(row.file_id, file);
  }
  return [...files.values()];
}

async function loadExistingParamKeys(productIds: string[]): Promise<Set<string>> {
  const existing = new Set<string>();
  for (let index = 0; index < productIds.length; index += 900) {
    const chunk = productIds.slice(index, index + 900);
    const rows = await prisma.productParam.findMany({ where: { productId: { in: chunk } }, select: { productId: true, paramKey: true } });
    for (const row of rows) existing.add(productParamKey(row.productId, row.paramKey));
  }
  return existing;
}

async function loadCoverage(paramKeys: string[]): Promise<Map<string, number>> {
  const coverage = new Map<string, number>();
  for (const key of paramKeys) coverage.set(key, 0);
  if (paramKeys.length === 0) return coverage;
  const rows = await prisma.productParam.groupBy({
    by: ["paramKey"],
    where: { paramKey: { in: paramKeys } },
    _count: { productId: true },
  });
  for (const row of rows) coverage.set(row.paramKey, row._count.productId);
  return coverage;
}

async function runPartA(): Promise<PartAResult> {
  const badParams = await prisma.$queryRaw<BadParam[]>`
    SELECT pp.id,
           pp.product_id,
           pp.param_key,
           pp.raw_value,
           pp.normalized_value,
           p.model_no,
           p.category
    FROM product_params pp
    JOIN products p ON p.id = pp.product_id
    WHERE pp.source_field = 'reverse_match'
      AND pp.raw_value LIKE '$%'
      AND pp.raw_value GLOB '$[0-9]*'
    ORDER BY pp.param_key, pp.raw_value, p.category, p.model_no
  `;

  const deleted = APPLY_MODE ? await deleteProductParams(badParams.map((param) => param.id)) : 0;
  return { badParams, deleted };
}

async function runPartB(sourceFiles: SourceFile[], existingParamKeys: Set<string>): Promise<PartBResult> {
  const plannedParams: PlannedParam[] = [];
  const fileResults: PartBFileResult[] = [];
  const headerStats = new Map<string, HeaderStats>();
  const matchSamples: MatchSample[] = [];
  const conflictSamples: ConflictSample[] = [];

  for (const [index, file] of sourceFiles.entries()) {
    if (index === 0 || (index + 1) % 50 === 0 || index + 1 === sourceFiles.length) {
      console.log(`V12.0 Part B value-header scan ${index + 1}/${sourceFiles.length}: ${file.relativePath}`);
    }
    fileResults.push(scanValueHeaderFile(file, existingParamKeys, plannedParams, headerStats, matchSamples, conflictSamples));
  }

  const inserted = APPLY_MODE ? await insertParams(plannedParams) : 0;
  return { fileResults, plannedParams, headerStats, matchSamples, conflictSamples, inserted };
}

function scanValueHeaderFile(
  file: SourceFile,
  existingParamKeys: Set<string>,
  plannedParams: PlannedParam[],
  headerStats: Map<string, HeaderStats>,
  matchSamples: MatchSample[],
  conflictSamples: ConflictSample[],
): PartBFileResult {
  const result: PartBFileResult = {
    fileName: file.fileName,
    relativePath: file.relativePath,
    sheets: 0,
    valueHeaderSheets: 0,
    matchedRows: 0,
    existingParamsSkipped: 0,
    plannedParams: 0,
    multiWattsConflicts: 0,
    readError: null,
  };

  const physicalPath = resolvePhysicalPath(file.relativePath);
  if (!existsSync(physicalPath)) {
    result.readError = "file missing";
    return result;
  }

  try {
    const workbook = XLSX.readFile(physicalPath, { cellDates: false });
    result.sheets = workbook.SheetNames.length;
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet?.["!ref"]) continue;
      const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: false });
      const header = detectBestHeader(rows);
      if (header.modelColIndex == null) continue;
      const valueHeaderSource = getValueHeaderSource(rows);
      if (!valueHeaderSource) continue;
      const valueHeaders = detectValueHeaders(valueHeaderSource);
      if (valueHeaders.length < 2) continue;
      result.valueHeaderSheets += 1;

      const dataRows = rows.slice(header.dataStartRow);
      for (const [offset, row] of dataRows.entries()) {
        if (isBlankRow(row)) continue;
        const excelModel = cellToString(row[header.modelColIndex]);
        if (!excelModel) continue;
        const product = matchProduct(excelModel, file.products);
        if (!product) continue;

        const activeHeaders = valueHeaders.filter((valueHeader) => hasDataInColumn(row, valueHeader.colIndex));
        if (activeHeaders.length === 0) continue;
        const activeWatts = activeHeaders.filter((valueHeader) => valueHeader.paramKey === "watts");
        if (activeWatts.length > 1) {
          result.multiWattsConflicts += 1;
          if (conflictSamples.length < 50) {
            conflictSamples.push({
              fileName: file.fileName,
              productName: product.productName,
              powerHeaders: activeWatts.map((headerValue) => headerValue.rawHeader).join(", "),
            });
          }
        }

        let addedForRow = 0;
        for (const valueHeader of activeHeaders) {
          if (valueHeader.paramKey === "watts" && activeWatts.length > 1) continue;
          const key = productParamKey(product.productId, valueHeader.paramKey);
          if (existingParamKeys.has(key)) {
            result.existingParamsSkipped += 1;
            continue;
          }
          plannedParams.push({
            id: randomUUID(),
            productId: product.productId,
            productModel: product.modelNo ?? "",
            productName: product.productName,
            category: product.category ?? "(未分类)",
            source: "column_header_value",
            confidence: "high",
            fileId: file.id,
            fileName: file.fileName,
            sheetName,
            rowNumber: header.dataStartRow + offset + 1,
            header: valueHeader.rawHeader,
            paramKey: valueHeader.paramKey,
            rawValue: valueHeader.rawHeader,
            normalizedValue: valueHeader.normalizedValue,
            unit: valueHeader.unit,
          });
          existingParamKeys.add(key);
          addedForRow += 1;
          addHeaderStat(headerStats, valueHeader, file.id, `${sheetName}\u0000${offset}`);
          if (matchSamples.length < 50) {
            matchSamples.push({
              fileName: file.fileName,
              sheetName,
              productName: product.productName,
              header: valueHeader.rawHeader,
              paramKey: valueHeader.paramKey,
              value: `${valueHeader.normalizedValue}${valueHeader.unit ?? ""}`,
            });
          }
        }
        if (addedForRow > 0) {
          result.matchedRows += 1;
          result.plannedParams += addedForRow;
        }
      }
    }
  } catch (error) {
    result.readError = error instanceof Error ? error.message : String(error);
  }

  return result;
}

function getValueHeaderSource(rows: unknown[][]): unknown[] | null {
  const multi = detectMultiRowHeader(rows);
  if (multi?.subRow != null) return rows[multi.subRow] ?? null;
  const best = detectBestHeader(rows);
  return best.headerValues.length > 0 ? best.headerValues : null;
}

function detectValueHeaders(headerValues: unknown[]): ValueHeader[] {
  const results: ValueHeader[] = [];
  for (const [index, value] of headerValues.entries()) {
    const raw = cellToString(value);
    if (!raw) continue;

    const wattsMatch = raw.match(/^(\d+(?:\.\d+)?)\s*[Ww](?:\s*±\s*\d+%)?$/);
    if (wattsMatch) {
      results.push({ colIndex: index, rawHeader: raw, paramKey: "watts", normalizedValue: wattsMatch[1], unit: "W" });
      continue;
    }

    const efficacyMatch = raw.match(/^(\d+(?:\.\d+)?)\s*(?:lm\/[Ww]|LM\/W)(?:\s*±\s*\d+%)?$/i);
    if (efficacyMatch) {
      results.push({ colIndex: index, rawHeader: raw, paramKey: "luminous_efficacy", normalizedValue: efficacyMatch[1], unit: "lm/W" });
      continue;
    }

    const criMatch = raw.match(/^(?:Ra\s*)?[>≥]\s*(\d{2})$/i);
    if (criMatch && Number(criMatch[1]) >= 60 && Number(criMatch[1]) <= 99) {
      results.push({ colIndex: index, rawHeader: raw, paramKey: "cri", normalizedValue: criMatch[1], unit: null });
      continue;
    }

    const pfMatch = raw.match(/^(?:PF\s*)?[>≥]\s*(0\.\d+)$/i);
    if (pfMatch) {
      results.push({ colIndex: index, rawHeader: raw, paramKey: "pf", normalizedValue: pfMatch[1], unit: null });
      continue;
    }

    const ipMatch = raw.match(/^IP\s*(\d{2})$/i);
    if (ipMatch) {
      results.push({ colIndex: index, rawHeader: raw, paramKey: "ip", normalizedValue: ipMatch[1], unit: null });
      continue;
    }

    const voltageMatch = raw.match(/^(?:AC\s*)?(\d+)\s*(?:[-~–]\s*(\d+)\s*)?V$/i);
    if (voltageMatch) {
      const normalized = voltageMatch[2] ? `${voltageMatch[1]}-${voltageMatch[2]}` : voltageMatch[1];
      results.push({ colIndex: index, rawHeader: raw, paramKey: "voltage", normalizedValue: normalized, unit: "V" });
      continue;
    }

    const cctMatch = raw.match(/^(\d{4})\s*(?:[-~–]\s*(\d{4})\s*)?[Kk]$/);
    if (cctMatch) {
      const first = Number(cctMatch[1]);
      const second = cctMatch[2] ? Number(cctMatch[2]) : null;
      if (first >= 1800 && first <= 10000 && (second == null || (second >= 1800 && second <= 10000))) {
        const normalized = cctMatch[2] ? `${cctMatch[1]}-${cctMatch[2]}` : cctMatch[1];
        results.push({ colIndex: index, rawHeader: raw, paramKey: "cct", normalizedValue: normalized, unit: "K" });
      }
    }
  }
  return results;
}

function hasDataInColumn(row: unknown[], colIndex: number): boolean {
  const value = cellToString(row[colIndex]);
  if (!value) return false;
  return !["-", "/", "\\", "n/a", "na", "无"].includes(normalizeForMatch(value));
}

function addHeaderStat(stats: Map<string, HeaderStats>, valueHeader: ValueHeader, fileId: string, rowKey: string) {
  const key = `${valueHeader.paramKey}\u0000${valueHeader.normalizedValue}\u0000${valueHeader.rawHeader}`;
  const stat = stats.get(key) ?? {
    rawHeader: valueHeader.rawHeader,
    paramKey: valueHeader.paramKey,
    normalizedValue: valueHeader.normalizedValue,
    fileKeys: new Set<string>(),
    matchedRows: 0,
  };
  stat.fileKeys.add(fileId);
  stat.matchedRows += rowKey ? 1 : 0;
  stats.set(key, stat);
}

async function runPartC(existingParamKeys: Set<string>): Promise<PartCResult> {
  const products = await prisma.product.findMany({
    where: { modelNo: { contains: " - " } },
    select: { id: true, modelNo: true, productName: true, category: true },
    orderBy: [{ category: "asc" }, { modelNo: "asc" }],
  });
  const plannedParams: PlannedParam[] = [];
  let parsedProducts = 0;
  let existingParamsSkipped = 0;

  for (const product of products) {
    const parsed = parseCompoundModel(product.modelNo ?? "");
    if (parsed.length === 0) continue;
    parsedProducts += 1;
    for (const param of parsed) {
      const key = productParamKey(product.id, param.paramKey);
      if (existingParamKeys.has(key)) {
        existingParamsSkipped += 1;
        continue;
      }
      plannedParams.push({
        id: randomUUID(),
        productId: product.id,
        productModel: product.modelNo ?? "",
        productName: product.productName,
        category: product.category ?? "(未分类)",
        source: "compound_model",
        confidence: "high",
        fileId: null,
        fileName: null,
        sheetName: null,
        rowNumber: null,
        header: null,
        paramKey: param.paramKey,
        rawValue: param.rawValue,
        normalizedValue: param.normalizedValue,
        unit: param.unit,
      });
      existingParamKeys.add(key);
    }
  }

  const inserted = APPLY_MODE ? await insertParams(plannedParams) : 0;
  return { scannedProducts: products.length, parsedProducts, plannedParams, existingParamsSkipped, inserted };
}

function parseCompoundModel(modelNo: string): ParsedCompoundParam[] {
  const params: ParsedCompoundParam[] = [];
  const segments = modelNo.split(/\s+-\s+/).map((segment) => segment.trim()).filter(Boolean);
  if (segments.length < 3) return params;

  const wattsMatch = segments[1]?.match(/^(\d+(?:\.\d+)?)\s*[Ww]$/);
  if (wattsMatch) {
    params.push({ paramKey: "watts", rawValue: segments[1], normalizedValue: wattsMatch[1], unit: "W" });
  }

  const baseMatch = segments[2]?.match(/^(E\d+(?:\s+E\d+)?)$/i);
  if (baseMatch) {
    params.push({ paramKey: "base", rawValue: segments[2], normalizedValue: segments[2], unit: null });
  }

  if (segments[3]) {
    const sizeMatch = segments[3].match(/(\d+\*\d+)/);
    if (sizeMatch) {
      params.push({ paramKey: "size_display", rawValue: segments[3], normalizedValue: segments[3], unit: null });
    }
  }

  return params;
}

async function runPartD(sourceFiles: SourceFile[], existingParamKeys: Set<string>): Promise<PartDResult> {
  const plannedParams: PlannedParam[] = [];
  const benefitedProducts = new Set<string>();
  const samples: PropagationSample[] = [];
  let existingParamsSkipped = 0;
  let propagationGroups = 0;

  const productIds = [...new Set(sourceFiles.flatMap((file) => file.products.map((product) => product.productId)))];
  const paramsByProduct = await loadParamsByProduct(productIds, [...PROPAGATABLE_PARAMS]);

  for (const [index, file] of sourceFiles.entries()) {
    if (index === 0 || (index + 1) % 100 === 0 || index + 1 === sourceFiles.length) {
      console.log(`V12.0 Part D propagation scan ${index + 1}/${sourceFiles.length}: ${file.relativePath}`);
    }
    for (const paramKey of PROPAGATABLE_PARAMS) {
      const valueDistribution = new Map<string, { rawValue: string; normalizedValue: string | null; unit: string | null; productIds: Set<string> }>();
      for (const product of file.products) {
        const productParams = paramsByProduct.get(product.productId);
        const param = productParams?.get(paramKey);
        if (!param?.normalized_value && !param?.raw_value) continue;
        const normalized = normalizePropagationParam(paramKey, param.raw_value, param.normalized_value, param.unit);
        if (!normalized) continue;
        const valueKey = `${normalized.normalizedValue ?? normalized.rawValue}\u0000${normalized.unit ?? ""}`;
        const bucket = valueDistribution.get(valueKey) ?? { ...normalized, productIds: new Set<string>() };
        bucket.productIds.add(product.productId);
        valueDistribution.set(valueKey, bucket);
      }

      const buckets = [...valueDistribution.values()].sort((left, right) => right.productIds.size - left.productIds.size);
      const dominant = buckets[0];
      if (!dominant) continue;
      if (dominant.productIds.size < 5) continue;
      const ratio = dominant.productIds.size / Math.max(1, file.products.length);
      if (ratio < 0.9) continue;

      const missingProducts = file.products.filter((product) => !paramsByProduct.get(product.productId)?.has(paramKey));
      if (missingProducts.length === 0) continue;
      propagationGroups += 1;
      if (samples.length < 30) {
        samples.push({
          paramKey,
          value: `${dominant.normalizedValue ?? dominant.rawValue}${dominant.unit ?? ""}`,
          fileName: file.fileName,
          ratio,
          benefitedProducts: missingProducts.length,
        });
      }

      for (const product of missingProducts) {
        const key = productParamKey(product.productId, paramKey);
        if (existingParamKeys.has(key)) {
          existingParamsSkipped += 1;
          continue;
        }
        plannedParams.push({
          id: randomUUID(),
          productId: product.productId,
          productModel: product.modelNo ?? "",
          productName: product.productName,
          category: product.category ?? "(未分类)",
          source: "file_propagation",
          confidence: "low",
          fileId: file.id,
          fileName: file.fileName,
          sheetName: null,
          rowNumber: null,
          header: null,
          paramKey,
          rawValue: dominant.rawValue,
          normalizedValue: dominant.normalizedValue,
          unit: dominant.unit,
        });
        existingParamKeys.add(key);
        benefitedProducts.add(product.productId);
        const productParams = paramsByProduct.get(product.productId) ?? new Map<string, ExistingParam>();
        productParams.set(paramKey, {
          product_id: product.productId,
          param_key: paramKey,
          raw_value: dominant.rawValue,
          normalized_value: dominant.normalizedValue,
          unit: dominant.unit,
        });
        paramsByProduct.set(product.productId, productParams);
      }
    }
  }

  const inserted = APPLY_MODE ? await insertParams(plannedParams) : 0;
  return { scannedFiles: sourceFiles.length, propagationGroups, benefitedProducts, plannedParams, existingParamsSkipped, samples, inserted };
}

function normalizePropagationParam(
  paramKey: PropagatableParam,
  rawValue: string,
  normalizedValue: string | null,
  unit: string | null,
): { rawValue: string; normalizedValue: string | null; unit: string | null } | null {
  const raw = rawValue.trim();
  const normalized = normalizedValue?.trim() || null;
  const normalizedUnit = unit?.trim() || null;
  const combined = `${normalized ?? raw}${normalizedUnit ?? ""}`.replace(/\s+/g, "");

  if (paramKey === "voltage") {
    const voltageMatch = combined.match(/^(AC)?(\d+(?:[-~–]\d+)?)V+$/i);
    if (!voltageMatch) return { rawValue: raw, normalizedValue: normalized, unit: normalizedUnit };
    const range = voltageMatch[2].replace(/[~–]/g, "-");
    const voltage = `${voltageMatch[1] ? "AC" : ""}${range}`;
    return { rawValue: `${voltage}V`, normalizedValue: voltage, unit: "V" };
  }

  if (paramKey === "cct") {
    const cctMatch = combined.match(/^(\d{4}(?:[-~–]\d{4})?)K+$/i);
    if (!cctMatch) return { rawValue: raw, normalizedValue: normalized, unit: normalizedUnit };
    const range = cctMatch[1].replace(/[~–]/g, "-");
    const values = range.split("-").map((value) => Number(value));
    if (values.some((value) => value < 1800 || value > 10000)) return null;
    return { rawValue: `${range}K`, normalizedValue: range, unit: "K" };
  }

  return { rawValue: raw, normalizedValue: normalized, unit: normalizedUnit };
}

async function loadParamsByProduct(productIds: string[], paramKeys: string[]): Promise<Map<string, Map<string, ExistingParam>>> {
  const paramsByProduct = new Map<string, Map<string, ExistingParam>>();
  for (let index = 0; index < productIds.length; index += 900) {
    const chunk = productIds.slice(index, index + 900);
    const rows = await prisma.productParam.findMany({
      where: { productId: { in: chunk }, paramKey: { in: paramKeys } },
      select: { productId: true, paramKey: true, rawValue: true, normalizedValue: true, unit: true },
    });
    for (const row of rows) {
      const productParams = paramsByProduct.get(row.productId) ?? new Map<string, ExistingParam>();
      if (!productParams.has(row.paramKey)) {
        productParams.set(row.paramKey, {
          product_id: row.productId,
          param_key: row.paramKey,
          raw_value: row.rawValue,
          normalized_value: row.normalizedValue,
          unit: row.unit,
        });
      }
      paramsByProduct.set(row.productId, productParams);
    }
  }
  return paramsByProduct;
}

async function deleteProductParams(ids: string[]): Promise<number> {
  let deleted = 0;
  for (let index = 0; index < ids.length; index += INSERT_BATCH_SIZE) {
    const chunk = ids.slice(index, index + INSERT_BATCH_SIZE);
    const result = await prisma.productParam.deleteMany({ where: { id: { in: chunk } } });
    deleted += result.count;
  }
  return deleted;
}

async function insertParams(plannedParams: PlannedParam[]): Promise<number> {
  let inserted = 0;
  for (let index = 0; index < plannedParams.length; index += INSERT_BATCH_SIZE) {
    const chunk = plannedParams.slice(index, index + INSERT_BATCH_SIZE);
    const result = await prisma.productParam.createMany({
      data: chunk.map((param) => ({
        id: param.id,
        productId: param.productId,
        paramKey: param.paramKey,
        rawValue: param.rawValue,
        normalizedValue: param.normalizedValue,
        unit: param.unit,
        sourceField: param.source,
        confidence: param.confidence,
      })),
    });
    inserted += result.count;
  }
  return inserted;
}

function buildCoverageRows(before: Map<string, number>, after: Map<string, number>): CoverageRow[] {
  const keys = [...new Set([...before.keys(), ...after.keys()])];
  return keys.map((paramKey) => ({ paramKey, before: before.get(paramKey) ?? 0, after: after.get(paramKey) ?? 0 })).sort((left, right) => right.after - left.after || left.paramKey.localeCompare(right.paramKey));
}

function buildParamStats(plannedParams: PlannedParam[]): ParamStats[] {
  const stats = new Map<string, ParamStats>();
  for (const param of plannedParams) {
    const stat = stats.get(param.paramKey) ?? { paramKey: param.paramKey, newRecords: 0, productIds: new Set<string>() };
    stat.newRecords += 1;
    stat.productIds.add(param.productId);
    stats.set(param.paramKey, stat);
  }
  return [...stats.values()].sort((left, right) => right.newRecords - left.newRecords || left.paramKey.localeCompare(right.paramKey));
}

function buildPropagationStats(plannedParams: PlannedParam[]): Array<{ paramKey: string; newRecords: number; productIds: Set<string>; fileNames: Set<string> }> {
  const stats = new Map<string, { paramKey: string; newRecords: number; productIds: Set<string>; fileNames: Set<string> }>();
  for (const param of plannedParams) {
    const stat = stats.get(param.paramKey) ?? { paramKey: param.paramKey, newRecords: 0, productIds: new Set<string>(), fileNames: new Set<string>() };
    stat.newRecords += 1;
    stat.productIds.add(param.productId);
    if (param.fileName) stat.fileNames.add(param.fileName);
    stats.set(param.paramKey, stat);
  }
  return [...stats.values()].sort((left, right) => right.newRecords - left.newRecords || left.paramKey.localeCompare(right.paramKey));
}

function buildReport(input: {
  mode: "dry-run" | "apply";
  partA: PartAResult;
  partB: PartBResult;
  partC: PartCResult;
  partD: PartDResult;
  productParamsBefore: number;
  productParamsAfter: number;
  coverageRows: CoverageRow[];
}): string {
  const partBParamStats = buildParamStats(input.partB.plannedParams);
  const partCParamStats = buildParamStats(input.partC.plannedParams);
  const partDParamStats = buildPropagationStats(input.partD.plannedParams);
  const valueHeaderFiles = input.partB.fileResults.filter((file) => file.valueHeaderSheets > 0).length;
  const valueHeaderSheets = input.partB.fileResults.reduce((sum, file) => sum + file.valueHeaderSheets, 0);
  const matchedRows = input.partB.fileResults.reduce((sum, file) => sum + file.matchedRows, 0);
  const partBExistingSkipped = input.partB.fileResults.reduce((sum, file) => sum + file.existingParamsSkipped, 0);
  const partBConflicts = input.partB.fileResults.reduce((sum, file) => sum + file.multiWattsConflicts, 0);

  return `# V12.0 参数覆盖率第三轮提升报告

模式: ${input.mode}
时间: ${new Date().toISOString()}
备份: ${BACKUP_PATH}

## Part A — 脏数据清理

| 指标 | 数值 |
|---|---:|
| 检测到 | ${input.partA.badParams.length.toLocaleString()} |
| 删除 | ${input.partA.deleted.toLocaleString()} |

## Part B — 列头数值修复

| 指标 | 数值 |
|---|---:|
| 扫描文件数 | ${input.partB.fileResults.length.toLocaleString()} |
| 检测到数值列头的文件 | ${valueHeaderFiles.toLocaleString()} |
| 检测到数值列头的 sheet | ${valueHeaderSheets.toLocaleString()} |
| 匹配产品行数 | ${matchedRows.toLocaleString()} |
| 新增参数 | ${input.partB.plannedParams.length.toLocaleString()} |
| 跳过（已存在） | ${partBExistingSkipped.toLocaleString()} |
| 跳过（多 watts 冲突） | ${partBConflicts.toLocaleString()} |
| 实际插入 | ${input.partB.inserted.toLocaleString()} |

### Part B 按 param_key

| param_key | 新增记录 |
|---|---:|
${partBParamStats.map((stat) => `| ${escapeMd(stat.paramKey)} | ${stat.newRecords.toLocaleString()} |`).join("\n")}

### Part B 检测到的数值列头

| 列头原文 | 解析为 param_key | 出现文件数 | 匹配行数 |
|---|---|---:|---:|
${[...input.partB.headerStats.values()]
  .sort((left, right) => right.matchedRows - left.matchedRows || left.rawHeader.localeCompare(right.rawHeader))
  .slice(0, 100)
  .map((stat) => `| ${escapeMd(stat.rawHeader)} | ${escapeMd(stat.paramKey)} | ${stat.fileKeys.size.toLocaleString()} | ${stat.matchedRows.toLocaleString()} |`)
  .join("\n")}

### Part B 样本

| 文件名 | Sheet | 产品 | 列头 | param_key | 值 |
|---|---|---|---|---|---|
${input.partB.matchSamples
  .slice(0, 30)
  .map((sample) => `| ${escapeMd(sample.fileName)} | ${escapeMd(sample.sheetName)} | ${escapeMd(sample.productName)} | ${escapeMd(sample.header)} | ${escapeMd(sample.paramKey)} | ${escapeMd(sample.value)} |`)
  .join("\n")}

## Part C — 复合型号解析

| 指标 | 数值 |
|---|---:|
| 扫描产品数 | ${input.partC.scannedProducts.toLocaleString()} |
| 解析成功 | ${input.partC.parsedProducts.toLocaleString()} |
| 新增参数 | ${input.partC.plannedParams.length.toLocaleString()} |
| 跳过（已存在） | ${input.partC.existingParamsSkipped.toLocaleString()} |
| 实际插入 | ${input.partC.inserted.toLocaleString()} |

### Part C 按 param_key

| param_key | 新增记录 |
|---|---:|
${partCParamStats.map((stat) => `| ${escapeMd(stat.paramKey)} | ${stat.newRecords.toLocaleString()} |`).join("\n")}

## Part D — 同文件参数传播

| 指标 | 数值 |
|---|---:|
| 扫描文件数 | ${input.partD.scannedFiles.toLocaleString()} |
| 触发传播的 (文件, param_key) 组 | ${input.partD.propagationGroups.toLocaleString()} |
| 受益产品数 | ${input.partD.benefitedProducts.size.toLocaleString()} |
| 新增参数 | ${input.partD.plannedParams.length.toLocaleString()} |
| 跳过（已存在） | ${input.partD.existingParamsSkipped.toLocaleString()} |
| 实际插入 | ${input.partD.inserted.toLocaleString()} |

### Part D 按 param_key

| param_key | 新增记录 | 受益产品数 | 传播源文件数 |
|---|---:|---:|---:|
${partDParamStats.map((stat) => `| ${escapeMd(stat.paramKey)} | ${stat.newRecords.toLocaleString()} | ${stat.productIds.size.toLocaleString()} | ${stat.fileNames.size.toLocaleString()} |`).join("\n")}

### Part D 采样（前 30 条）

| param_key | 传播值 | 文件名 | 已有比例 | 受益产品数 |
|---|---|---|---:|---:|
${input.partD.samples
  .slice(0, 30)
  .map((sample) => `| ${escapeMd(sample.paramKey)} | ${escapeMd(sample.value)} | ${escapeMd(sample.fileName)} | ${formatPercent(sample.ratio)} | ${sample.benefitedProducts.toLocaleString()} |`)
  .join("\n")}

## 汇总

| 指标 | 数值 |
|---|---:|
| Part A 删除 | ${input.partA.deleted.toLocaleString()} |
| Part B 新增 | ${input.partB.plannedParams.length.toLocaleString()} |
| Part C 新增 | ${input.partC.plannedParams.length.toLocaleString()} |
| Part D 新增 | ${input.partD.plannedParams.length.toLocaleString()} |
| product_params 变化 | ${input.productParamsBefore.toLocaleString()} → ${input.productParamsAfter.toLocaleString()} |

## 覆盖率变化

| param_key | 之前 | 之后 | 变化 |
|---|---:|---:|---:|
${input.coverageRows.map((row) => `| ${escapeMd(row.paramKey)} | ${row.before.toLocaleString()} | ${row.after.toLocaleString()} | ${(row.after - row.before).toLocaleString()} |`).join("\n")}
`;
}

function formatPercent(value: number): string {
  return `${Math.round(value * 1000) / 10}%`;
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
