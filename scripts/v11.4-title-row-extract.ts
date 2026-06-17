import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { PrismaClient } from "@prisma/client";
import * as XLSX from "xlsx";

import {
  cellToString,
  detectBestHeader,
  escapeMd,
  INSERT_BATCH_SIZE,
  productParamKey,
  resolvePhysicalPath,
} from "./v11-shared";

const prisma = new PrismaClient();

const REPORT_PATH = path.join("docs", "v11.4-title-row-report.md");
const BACKUP_PATH = path.join("prisma", "dev.db.bak-v11.4");
const APPLY_MODE = process.argv.includes("--apply");

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

type TitleParam = {
  paramKey: string;
  rawValue: string;
  normalizedValue: string;
  unit: string | null;
};

type PlannedParam = {
  id: string;
  productId: string;
  productModel: string;
  productName: string;
  category: string;
  fileName: string;
  sheetName: string;
  paramKey: string;
  rawValue: string;
  normalizedValue: string;
  unit: string | null;
};

type TitleSample = {
  fileName: string;
  sheetName: string;
  titleText: string;
  paramKeys: string;
};

type ProductSample = {
  fileName: string;
  sheetName: string;
  params: string;
  productCount: number;
  exampleModel: string;
};

type FileResult = {
  fileName: string;
  relativePath: string;
  sheetCount: number;
  parsedSheets: number;
  benefitedProducts: number;
  plannedParams: number;
  existingParamsSkipped: number;
  readError: string | null;
};

type ParamStats = {
  paramKey: string;
  newRecords: number;
  productIds: Set<string>;
};

type CategoryStats = {
  category: string;
  sheetKeys: Set<string>;
  productIds: Set<string>;
  newParams: number;
};

async function main() {
  if (!existsSync(BACKUP_PATH)) {
    throw new Error(`Missing DB backup: ${BACKUP_PATH}`);
  }

  const productParamsBefore = await prisma.productParam.count();
  const sourceFiles = await loadSourceFiles();
  const allProductIds = [...new Set(sourceFiles.flatMap((file) => file.products.map((product) => product.productId)))];
  const existingParamKeys = await loadExistingParamKeys(allProductIds);
  const plannedParams: PlannedParam[] = [];
  const fileResults: FileResult[] = [];
  const titleSamples: TitleSample[] = [];
  const productSamples: ProductSample[] = [];

  for (const [index, file] of sourceFiles.entries()) {
    if (index === 0 || (index + 1) % 50 === 0 || index + 1 === sourceFiles.length) {
      console.log(`V11.4 title-row scan ${index + 1}/${sourceFiles.length}: ${file.relativePath}`);
    }
    fileResults.push(scanFile(file, existingParamKeys, plannedParams, titleSamples, productSamples));
  }

  const insertedParams = APPLY_MODE ? await insertParams(plannedParams) : 0;
  const productParamsAfter = await prisma.productParam.count();
  await mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await writeFile(
    REPORT_PATH,
    buildReport({
      mode: APPLY_MODE ? "apply" : "dry-run",
      fileResults,
      plannedParams,
      titleSamples,
      productSamples,
      insertedParams,
      productParamsBefore,
      productParamsAfter,
    }),
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        mode: APPLY_MODE ? "apply" : "dry-run",
        reportPath: REPORT_PATH,
        files: sourceFiles.length,
        parsedFiles: fileResults.filter((file) => file.parsedSheets > 0).length,
        parsedSheets: fileResults.reduce((sum, file) => sum + file.parsedSheets, 0),
        benefitedProducts: fileResults.reduce((sum, file) => sum + file.benefitedProducts, 0),
        plannedParams: plannedParams.length,
        insertedParams,
        productParamsBefore,
        productParamsAfter,
      },
      null,
      2,
    ),
  );

  await prisma.$disconnect();
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

function scanFile(
  file: SourceFile,
  existingParamKeys: Set<string>,
  plannedParams: PlannedParam[],
  titleSamples: TitleSample[],
  productSamples: ProductSample[],
): FileResult {
  const result: FileResult = {
    fileName: file.fileName,
    relativePath: file.relativePath,
    sheetCount: 0,
    parsedSheets: 0,
    benefitedProducts: 0,
    plannedParams: 0,
    existingParamsSkipped: 0,
    readError: null,
  };
  if (file.products.length === 0) return result;

  const physicalPath = resolvePhysicalPath(file.relativePath);
  if (!existsSync(physicalPath)) {
    result.readError = "file missing";
    return result;
  }

  try {
    const workbook = XLSX.readFile(physicalPath, { cellDates: false });
    result.sheetCount = workbook.SheetNames.length;
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet?.["!ref"]) continue;
      const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: false });
      const header = detectBestHeader(rows);
      if (header.headerValues.length === 0 || header.headerRowIndex <= 0) continue;
      const titleText = collectTitleText(rows, header.headerRowIndex);
      if (titleText.length < 5) continue;
      const params = extractTitleParams(titleText);
      if (params.length === 0) continue;

      const before = plannedParams.length;
      const benefited = new Set<string>();
      for (const product of file.products) {
        for (const param of params) {
          const key = productParamKey(product.productId, param.paramKey);
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
            fileName: file.fileName,
            sheetName,
            paramKey: param.paramKey,
            rawValue: param.rawValue,
            normalizedValue: param.normalizedValue,
            unit: param.unit,
          });
          existingParamKeys.add(key);
          benefited.add(product.productId);
        }
      }

      const added = plannedParams.length - before;
      if (added > 0) {
        result.parsedSheets += 1;
        result.benefitedProducts += benefited.size;
        result.plannedParams += added;
        if (titleSamples.length < 50) {
          titleSamples.push({
            fileName: file.fileName,
            sheetName,
            titleText: titleText.slice(0, 160),
            paramKeys: params.map((param) => param.paramKey).join(", "),
          });
        }
        if (productSamples.length < 50) {
          productSamples.push({
            fileName: file.fileName,
            sheetName,
            params: params.map((param) => `${param.paramKey}=${param.normalizedValue}${param.unit ?? ""}`).join(", "),
            productCount: benefited.size,
            exampleModel: file.products[0]?.modelNo ?? file.products[0]?.productName ?? "",
          });
        }
      }
    }
  } catch (error) {
    result.readError = error instanceof Error ? error.message : String(error);
  }

  return result;
}

function collectTitleText(rows: unknown[][], headerRowIndex: number): string {
  const texts: string[] = [];
  for (let index = 0; index < headerRowIndex; index += 1) {
    const row = rows[index] ?? [];
    for (const cell of row) {
      const value = cellToString(cell);
      if (value.length > 3) texts.push(value);
    }
  }
  return texts.join(" ").normalize("NFC").replace(/\s+/g, " ").trim();
}

function extractTitleParams(titleText: string): TitleParam[] {
  const params: TitleParam[] = [];
  const seen = new Set<string>();
  const add = (param: TitleParam) => {
    if (seen.has(param.paramKey)) return;
    seen.add(param.paramKey);
    params.push(param);
  };

  if (/非隔离/.test(titleText)) add({ paramKey: "driver_type", rawValue: "非隔离", normalizedValue: "非隔离", unit: null });
  else if (/隔离/.test(titleText) && !/非隔离/.test(titleText)) add({ paramKey: "driver_type", rawValue: "隔离", normalizedValue: "隔离", unit: null });
  if (/\bDOB\b/i.test(titleText)) add({ paramKey: "driver_type", rawValue: "DOB", normalizedValue: "DOB", unit: null });
  if (/恒流IC/i.test(titleText)) add({ paramKey: "driver_type", rawValue: "恒流IC", normalizedValue: "恒流IC", unit: null });

  const voltageParams = extractVoltages(titleText);
  if (voltageParams.length === 1) add(voltageParams[0]);

  const ipMatch = titleText.match(/IP\s*(\d{2})/i);
  if (ipMatch) add({ paramKey: "ip", rawValue: `IP${ipMatch[1]}`, normalizedValue: ipMatch[1], unit: null });

  const criMatch = titleText.match(/(?:Ra|CRI|显指)\s*[>≥]\s*(\d{2})/i);
  if (criMatch) add({ paramKey: "cri", rawValue: `Ra>${criMatch[1]}`, normalizedValue: criMatch[1], unit: null });

  const pfMatch = titleText.match(/(?:PF|功率因[数素])\s*[>≥]\s*(0\.\d+)/i);
  if (pfMatch) add({ paramKey: "pf", rawValue: `PF>${pfMatch[1]}`, normalizedValue: pfMatch[1], unit: null });

  const materialPatterns: Array<[RegExp, string]> = [
    [/压铸铝/i, "压铸铝"],
    [/全塑/i, "全塑"],
    [/铝\+?PC/i, "铝+PC"],
    [/PC\+?铝/i, "铝+PC"],
    [/GLASS\/PS\/PMMA/i, "GLASS/PS/PMMA"],
    [/全铝/i, "全铝"],
    [/不锈钢/i, "不锈钢"],
  ];
  for (const [pattern, value] of materialPatterns) {
    if (pattern.test(titleText)) {
      add({ paramKey: "material", rawValue: value, normalizedValue: value, unit: null });
      break;
    }
  }

  const cctMatch = titleText.match(/(\d{4})\s*[-~–]\s*(\d{4})\s*K/i);
  if (cctMatch) {
    const first = Number(cctMatch[1]);
    const second = Number(cctMatch[2]);
    if (first >= 1800 && first <= 10000 && second >= 1800 && second <= 10000) {
      add({ paramKey: "cct", rawValue: `${cctMatch[1]}-${cctMatch[2]}K`, normalizedValue: `${cctMatch[1]}-${cctMatch[2]}`, unit: "K" });
    }
  }
  if (/三色|3\s*CCT|tri-?color/i.test(titleText) && !seen.has("cct")) {
    add({ paramKey: "cct", rawValue: "三色", normalizedValue: "3000/4000/6500", unit: "K" });
  }

  const certMatch = titleText.match(/\b(CE|SAA|CB|UL|ETL|DLC|FCC|TUV|ENEC)\b/gi);
  if (certMatch) {
    const certs = [...new Set(certMatch.map((cert) => cert.toUpperCase()))].join(", ");
    add({ paramKey: "certification", rawValue: certs, normalizedValue: certs, unit: null });
  }

  return params;
}

function extractVoltages(text: string): TitleParam[] {
  const params: TitleParam[] = [];
  const ranges = [...text.matchAll(/(?:AC\s*)?(\d{2,3})\s*[-~–]\s*(\d{2,3})\s*V/gi)];
  for (const match of ranges) {
    const first = Number(match[1]);
    const second = Number(match[2]);
    if (first >= 12 && second <= 480) {
      params.push({ paramKey: "voltage", rawValue: `${first}-${second}V`, normalizedValue: `${first}-${second}`, unit: "V" });
    }
  }
  if (params.length > 0) return uniqueNormalized(params);

  const singles = [...text.matchAll(/(?:AC\s*)?(\d{2,3})\s*V(?:\b|[^a-zA-Z])/gi)];
  for (const match of singles) {
    const value = Number(match[1]);
    if (value >= 12 && value <= 480) {
      params.push({ paramKey: "voltage", rawValue: `${value}V`, normalizedValue: String(value), unit: "V" });
    }
  }
  return uniqueNormalized(params);
}

function uniqueNormalized(params: TitleParam[]): TitleParam[] {
  const byValue = new Map<string, TitleParam>();
  for (const param of params) byValue.set(param.normalizedValue, param);
  return [...byValue.values()];
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
        sourceField: "title_row",
        confidence: "medium",
      })),
    });
    inserted += result.count;
  }
  return inserted;
}

function buildReport(input: {
  mode: "dry-run" | "apply";
  fileResults: FileResult[];
  plannedParams: PlannedParam[];
  titleSamples: TitleSample[];
  productSamples: ProductSample[];
  insertedParams: number;
  productParamsBefore: number;
  productParamsAfter: number;
}): string {
  const paramStats = buildParamStats(input.plannedParams);
  const categoryStats = buildCategoryStats(input.plannedParams);
  const parsedFiles = input.fileResults.filter((file) => file.parsedSheets > 0).length;
  const parsedSheets = input.fileResults.reduce((sum, file) => sum + file.parsedSheets, 0);
  const benefitedProducts = new Set(input.plannedParams.map((param) => param.productId)).size;
  const existingSkipped = input.fileResults.reduce((sum, file) => sum + file.existingParamsSkipped, 0);

  return `# V11.4 标题行参数提取报告

模式: ${input.mode}
时间: ${new Date().toISOString()}
备份: ${BACKUP_PATH}

## 汇总

| 指标 | 数值 |
|---|---:|
| 扫描文件数 | ${input.fileResults.length.toLocaleString()} |
| 含标题行参数的文件 | ${parsedFiles.toLocaleString()} |
| 含标题行参数的 sheet | ${parsedSheets.toLocaleString()} |
| 受益产品数 | ${benefitedProducts.toLocaleString()} |
| 新增参数 | ${input.plannedParams.length.toLocaleString()} |
| 跳过（已存在） | ${existingSkipped.toLocaleString()} |
| 实际插入 | ${input.insertedParams.toLocaleString()} |
| product_params 变化 | ${input.productParamsBefore.toLocaleString()} → ${input.productParamsAfter.toLocaleString()} |

## 按 param_key 统计

| param_key | 新增记录 | 覆盖产品数 |
|---|---:|---:|
${paramStats.map((stat) => `| ${escapeMd(stat.paramKey)} | ${stat.newRecords.toLocaleString()} | ${stat.productIds.size.toLocaleString()} |`).join("\n")}

## 按品类统计

| 品类 | 含标题参数 sheet | 受益产品 | 新增参数 |
|---|---:|---:|---:|
${categoryStats
  .map((stat) => `| ${escapeMd(stat.category)} | ${stat.sheetKeys.size.toLocaleString()} | ${stat.productIds.size.toLocaleString()} | ${stat.newParams.toLocaleString()} |`)
  .join("\n")}

## 标题行采样（前 50 条）

| 文件名 | Sheet | 标题文本(前80字) | 提取 param_key |
|---|---|---|---|
${input.titleSamples
  .map((sample) => `| ${escapeMd(sample.fileName)} | ${escapeMd(sample.sheetName)} | ${escapeMd(sample.titleText.slice(0, 80))} | ${escapeMd(sample.paramKeys)} |`)
  .join("\n")}

## 产品关联采样

| 文件名 | Sheet | 提取参数 | 受益产品数 | 示例产品 model_no |
|---|---|---|---:|---|
${input.productSamples
  .map((sample) => `| ${escapeMd(sample.fileName)} | ${escapeMd(sample.sheetName)} | ${escapeMd(sample.params)} | ${sample.productCount.toLocaleString()} | ${escapeMd(sample.exampleModel)} |`)
  .join("\n")}

## 读取失败文件

| 文件名 | 原因 |
|---|---|
${input.fileResults
  .filter((file) => file.readError)
  .map((file) => `| ${escapeMd(file.fileName)} | ${escapeMd(file.readError ?? "")} |`)
  .join("\n")}
`;
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

function buildCategoryStats(plannedParams: PlannedParam[]): CategoryStats[] {
  const stats = new Map<string, CategoryStats>();
  for (const param of plannedParams) {
    const stat = stats.get(param.category) ?? { category: param.category, sheetKeys: new Set<string>(), productIds: new Set<string>(), newParams: 0 };
    stat.sheetKeys.add(`${param.fileName}\u0000${param.sheetName}`);
    stat.productIds.add(param.productId);
    stat.newParams += 1;
    stats.set(param.category, stat);
  }
  return [...stats.values()].sort((left, right) => right.newParams - left.newParams || left.category.localeCompare(right.category));
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
