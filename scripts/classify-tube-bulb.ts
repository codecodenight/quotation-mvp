import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import * as XLSX from "xlsx";

const ROOT = "/Volumes/My Passport/AI 报价/各家工厂最新报价汇总";
const CSV_PATH = "docs/v2.13a-import-candidates.csv";
const DEFAULT_REPORT_PATH = "docs/tube-bulb-classify-report.md";

export type TubeBulbCategory = "球泡" | "灯管" | "混合" | "未知";

export type CategoryHint = {
  category: Exclude<TubeBulbCategory, "混合">;
  basis: string;
};

export type SheetClassification = {
  sheetName: string;
  category: Exclude<TubeBulbCategory, "混合">;
  dataRows: number;
  bulbHits: number;
  tubeHits: number;
  basis: string;
  samples: string[];
};

type Candidate = {
  relativePath: string;
  factory: string;
  estimatedProducts: number;
};

type FileClassification = {
  candidate: Candidate;
  absolutePath: string;
  fileNameHint: CategoryHint;
  category: TubeBulbCategory;
  basis: string;
  sheets: SheetClassification[];
  readError: string | null;
};

type CsvRow = Record<string, string>;

const FILE_BULB_REGEX = /球泡|A泡|T泡|G泡|异[形性]泡|C3[57]|GU10|GU5\.?3|蜡烛|玉兰花|PAR|LED灯泡|bulb/i;
const FILE_TUBE_REGEX = /灯管|T8|T5|TUBE|一体化支架/i;

const BULB_REGEX =
  /球泡|蜡烛|尖泡|拉尾|玉兰花|蘑菇|反射灯|G泡|T泡|A泡|R泡|柱泡|橄榄灯|异[形性]泡|LED灯泡|bulb|\bA(?:45|50|55|60|65|70|75|80|95)\b|\bC3[57]\b|\bG(?:4[05]|50|95|125)\b|\bR50\b|\bPAR\d*\b|\bGU10\b|\bGU5\.?3\b|\bE14\b|\bE27\b/i;
const TUBE_REGEX = /灯管|日光灯管|一体化支架|\bT[58]\b|\bTUBE\b/i;

async function main() {
  const reportPath = readArg("--report") ?? DEFAULT_REPORT_PATH;
  const candidates = await loadCandidates();
  const results: FileClassification[] = [];

  for (const candidate of candidates) {
    results.push(await analyzeCandidate(candidate));
  }

  await writeFile(reportPath, buildReport(results), "utf8");
  console.log(
    JSON.stringify(
      {
        reportPath,
        files: results.length,
        bulb: results.filter((result) => result.category === "球泡").length,
        tube: results.filter((result) => result.category === "灯管").length,
        mixed: results.filter((result) => result.category === "混合").length,
        unknown: results.filter((result) => result.category === "未知").length,
      },
      null,
      2,
    ),
  );
}

async function loadCandidates(): Promise<Candidate[]> {
  const csvText = await readFile(CSV_PATH, "utf8");
  const rows = parseCsv(csvText);
  const [header, ...body] = rows;
  const records = body.map((row) => rowToRecord(header, row));
  return records
    .filter((record) => normalizeText(record.category) === "灯管")
    .filter((record) => normalizeText(record.classification) === "likely-importable")
    .map((record) => ({
      relativePath: normalizeText(record.path),
      factory: normalizeText(record.factory),
      estimatedProducts: Number(normalizeText(record.estimated_products)) || 0,
    }));
}

async function analyzeCandidate(candidate: Candidate): Promise<FileClassification> {
  const absolutePath = path.join(ROOT, candidate.relativePath);
  const fileNameHint = classifyFileName(path.basename(candidate.relativePath));

  try {
    const workbook = XLSX.readFile(absolutePath, { cellDates: false, cellNF: false, cellText: true });
    const sheets = workbook.SheetNames.map((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      const rows = normalizeRows(XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false }) as unknown[][]);
      return classifySheetRows(sheetName, rows);
    });
    const summary = summarizeFileCategory(fileNameHint, sheets);
    return {
      candidate,
      absolutePath,
      fileNameHint,
      category: summary.category,
      basis: summary.basis,
      sheets,
      readError: null,
    };
  } catch (error) {
    return {
      candidate,
      absolutePath,
      fileNameHint,
      category: fileNameHint.category === "未知" ? "未知" : fileNameHint.category,
      basis: `读取失败；${fileNameHint.basis}`,
      sheets: [],
      readError: error instanceof Error ? error.message : String(error),
    };
  }
}

export function classifyFileName(fileName: string): CategoryHint {
  const normalized = normalizeText(fileName);
  if (FILE_TUBE_REGEX.test(normalized)) {
    return { category: "灯管", basis: "文件名命中灯管/T8/T5/TUBE/一体化支架" };
  }
  if (FILE_BULB_REGEX.test(normalized)) {
    return { category: "球泡", basis: "文件名命中球泡/A泡/T泡/G泡/C37/GU10 等" };
  }
  return { category: "未知", basis: "文件名不明确，需分析 sheet 内容" };
}

export function classifySheetRows(sheetName: string, rows: string[][]): SheetClassification {
  const normalizedRows = normalizeRows(rows);
  const headerRows = findHeaderRows(normalizedRows);
  const headerRowIndex = headerRows[0] ? headerRows[0] - 1 : findBestHeaderIndex(normalizedRows);
  const colCount = Math.max(0, ...normalizedRows.map((row) => row.length));
  const headers = buildHeaders(normalizedRows, headerRowIndex, colCount);
  const textColumns = findTextColumns(headers, normalizedRows, headerRowIndex);

  const dataRows = normalizedRows.slice(headerRowIndex + 1).filter((row) => !isEmptyRow(row));
  const samples = uniqueSamples(dataRows.map((row) => sampleRowText(row, textColumns)).filter(Boolean)).slice(0, 5);
  let bulbHits = 0;
  let tubeHits = 0;

  for (const row of dataRows) {
    const text = sampleRowText(row, textColumns) || row.slice(0, 12).join(" ");
    if (BULB_REGEX.test(text)) {
      bulbHits += 1;
    }
    if (TUBE_REGEX.test(text)) {
      tubeHits += 1;
    }
  }

  const normalizedSheetName = normalizeText(sheetName);
  if (TUBE_REGEX.test(normalizedSheetName)) {
    return { sheetName, category: "灯管", dataRows: dataRows.length, bulbHits, tubeHits, basis: "sheet 名命中灯管关键词", samples };
  }
  if (BULB_REGEX.test(normalizedSheetName)) {
    return { sheetName, category: "球泡", dataRows: dataRows.length, bulbHits, tubeHits, basis: "sheet 名命中球泡关键词", samples };
  }
  if (tubeHits > bulbHits) {
    return { sheetName, category: "灯管", dataRows: dataRows.length, bulbHits, tubeHits, basis: "数据行灯管关键词命中更多", samples };
  }
  if (bulbHits > tubeHits) {
    return { sheetName, category: "球泡", dataRows: dataRows.length, bulbHits, tubeHits, basis: "数据行球泡关键词命中更多", samples };
  }
  return { sheetName, category: "未知", dataRows: dataRows.length, bulbHits, tubeHits, basis: "关键词命中相等或无命中", samples };
}

export function summarizeFileCategory(
  fileNameHint: CategoryHint,
  sheets: SheetClassification[],
): { category: TubeBulbCategory; basis: string } {
  const sheetCategories = new Set(sheets.map((sheet) => sheet.category).filter((category) => category !== "未知"));
  if (sheetCategories.has("球泡") && sheetCategories.has("灯管")) {
    return { category: "混合", basis: "不同 sheet 分别命中球泡和灯管，需按 sheet 拆分导入" };
  }
  const onlySheetCategory = Array.from(sheetCategories)[0] as "球泡" | "灯管" | undefined;
  if (onlySheetCategory) {
    if (fileNameHint.category !== "未知" && fileNameHint.category !== onlySheetCategory) {
      return {
        category: "未知",
        basis: `文件名为${fileNameHint.category}，但 sheet 内容只命中${onlySheetCategory}，需人工确认`,
      };
    }
    return {
      category: onlySheetCategory,
      basis: fileNameHint.category === "未知" ? `sheet 内容判定为${onlySheetCategory}` : fileNameHint.basis,
    };
  }
  if (fileNameHint.category !== "未知") {
    return { category: fileNameHint.category, basis: fileNameHint.basis };
  }
  return { category: "未知", basis: "文件名和 sheet 内容都无法可靠判定" };
}

function buildReport(results: FileClassification[]): string {
  const lines: string[] = [];
  const fileNameBulb = results.filter((result) => result.fileNameHint.category === "球泡").length;
  const fileNameTube = results.filter((result) => result.fileNameHint.category === "灯管").length;
  const needsContent = results.filter((result) => result.fileNameHint.category === "未知").length;
  const mixed = results.filter((result) => result.category === "混合").length;
  const unknown = results.filter((result) => result.category === "未知").length;

  lines.push("# 灯管/球泡文件分类报告");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("## 总览");
  lines.push("");
  lines.push("| 指标 | 值 |");
  lines.push("|---|---:|");
  lines.push(`| 分析文件 | ${results.length} |`);
  lines.push(`| 明确球泡（文件名） | ${fileNameBulb} |`);
  lines.push(`| 明确灯管（文件名） | ${fileNameTube} |`);
  lines.push(`| 需分析内容 | ${needsContent} |`);
  lines.push(`| 混合文件（含两种 sheet） | ${mixed} |`);
  lines.push(`| 无法判定 | ${unknown} |`);
  lines.push("");

  lines.push("## 分类结果");
  lines.push("");
  appendPureSection(lines, "球泡", results);
  appendPureSection(lines, "灯管", results);
  appendMixedSection(lines, results);
  appendUnknownSection(lines, results);
  appendDetails(lines, results);
  appendImportAdvice(lines, results);

  return lines.join("\n");
}

function appendPureSection(lines: string[], category: "球泡" | "灯管", results: FileClassification[]) {
  lines.push(`### ${category}`);
  lines.push("");
  lines.push("| 文件 | 工厂 | Sheets | 数据行 | 分类依据 |");
  lines.push("|---|---|---:|---:|---|");
  for (const result of results.filter((item) => item.category === category)) {
    lines.push(
      `| ${md(result.candidate.relativePath)} | ${md(result.candidate.factory)} | ${result.sheets.length} | ${sumRows(result.sheets)} | ${md(result.basis)} |`,
    );
  }
  lines.push("");
}

function appendMixedSection(lines: string[], results: FileClassification[]) {
  lines.push("### 混合（需按 sheet 拆分导入）");
  lines.push("");
  lines.push("| 文件 | 工厂 | 球泡 sheets | 灯管 sheets | 分类依据 |");
  lines.push("|---|---|---|---|---|");
  for (const result of results.filter((item) => item.category === "混合")) {
    lines.push(
      `| ${md(result.candidate.relativePath)} | ${md(result.candidate.factory)} | ${md(sheetNames(result, "球泡"))} | ${md(sheetNames(result, "灯管"))} | ${md(result.basis)} |`,
    );
  }
  lines.push("");
}

function appendUnknownSection(lines: string[], results: FileClassification[]) {
  lines.push("### 无法判定");
  lines.push("");
  lines.push("| 文件 | 工厂 | Sheets | 数据行 | 备注 |");
  lines.push("|---|---|---:|---:|---|");
  for (const result of results.filter((item) => item.category === "未知")) {
    const note = result.readError ? `读取失败：${result.readError}` : result.basis;
    lines.push(`| ${md(result.candidate.relativePath)} | ${md(result.candidate.factory)} | ${result.sheets.length} | ${sumRows(result.sheets)} | ${md(note)} |`);
  }
  lines.push("");
}

function appendDetails(lines: string[], results: FileClassification[]) {
  lines.push("## 每文件明细");
  lines.push("");
  for (const result of results) {
    lines.push(`### ${md(result.candidate.relativePath)}`);
    lines.push("");
    lines.push(`- 工厂：${md(result.candidate.factory)}`);
    lines.push(`- 绝对路径：${md(result.absolutePath)}`);
    lines.push(`- 文件名预判：${result.fileNameHint.category}（${md(result.fileNameHint.basis)}）`);
    lines.push(`- 文件结论：${result.category}（${md(result.basis)}）`);
    if (result.readError) {
      lines.push(`- 读取错误：${md(result.readError)}`);
    }
    lines.push("");
    lines.push("| Sheet | 数据行 | 球泡命中 | 灯管命中 | 结论 | 依据 | 样本 |");
    lines.push("|---|---:|---:|---:|---|---|---|");
    for (const sheet of result.sheets) {
      lines.push(
        `| ${md(sheet.sheetName)} | ${sheet.dataRows} | ${sheet.bulbHits} | ${sheet.tubeHits} | ${sheet.category} | ${md(sheet.basis)} | ${md(sheet.samples.join("; "))} |`,
      );
    }
    if (result.sheets.length === 0) {
      lines.push("| - | 0 | 0 | 0 | 未知 | 无可读 sheet | - |");
    }
    lines.push("");
  }
}

function appendImportAdvice(lines: string[], results: FileClassification[]) {
  lines.push("## 导入建议");
  lines.push("");
  lines.push("- 纯球泡文件：导入时 `category=\"球泡\"`。");
  lines.push("- 纯灯管文件：导入时 `category=\"灯管\"`。");
  lines.push("- 混合文件：按 sheet 拆分导入，球泡 sheets 归「球泡」，灯管 sheets 归「灯管」。");
  lines.push("- 无法判定：人工打开复核后再决定。");
  lines.push("");
  lines.push("| 文件 | 建议 | 细节 |");
  lines.push("|---|---|---|");
  for (const result of results) {
    if (result.category === "混合") {
      lines.push(
        `| ${md(result.candidate.relativePath)} | 按 sheet 拆分 | 球泡：${md(sheetNames(result, "球泡"))}；灯管：${md(sheetNames(result, "灯管"))} |`,
      );
    } else if (result.category === "未知") {
      lines.push(`| ${md(result.candidate.relativePath)} | 人工复核 | ${md(result.basis)} |`);
    } else {
      lines.push(`| ${md(result.candidate.relativePath)} | ${result.category} | ${md(result.basis)} |`);
    }
  }
  lines.push("");
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

function findTextColumns(headers: string[], rows: string[][], headerRowIndex: number): number[] {
  const preferred = headers
    .map((header, index) => ({ header, index }))
    .filter(({ header }) => /型号|款号|model|item|code|品名|产品|名称|name|description|规格|spec/i.test(header))
    .map(({ index }) => index);
  if (preferred.length > 0) {
    return preferred.slice(0, 6);
  }

  const colCount = Math.max(0, ...rows.map((row) => row.length));
  return Array.from({ length: Math.min(colCount, 8) }, (_, index) => index).filter((index) =>
    rows
      .slice(headerRowIndex + 1)
      .some((row) => {
        const text = normalizeText(row[index]);
        return /[A-Za-z\u4e00-\u9fff]/.test(text);
      }),
  );
}

function sampleRowText(row: string[], columns: number[]): string {
  return columns.map((index) => normalizeText(row[index])).filter(Boolean).join(" ");
}

function isEmptyRow(row: string[]): boolean {
  return row.every((cell) => normalizeText(cell) === "");
}

function normalizeRows(rows: unknown[][]): string[][] {
  return rows.map((row) => row.map((cell) => normalizeText(cell)));
}

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFC")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }
    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(cell);
      if (row.some((value) => value.length > 0)) {
        rows.push(row);
      }
      row = [];
      cell = "";
      continue;
    }
    cell += char;
  }

  row.push(cell);
  if (row.some((value) => value.length > 0)) {
    rows.push(row);
  }
  return rows;
}

function rowToRecord(header: string[], row: string[]): CsvRow {
  const record: CsvRow = {};
  for (let index = 0; index < header.length; index += 1) {
    record[header[index]] = row[index] ?? "";
  }
  return record;
}

function sumRows(sheets: SheetClassification[]): number {
  return sheets.reduce((sum, sheet) => sum + sheet.dataRows, 0);
}

function sheetNames(result: FileClassification, category: "球泡" | "灯管"): string {
  const names = result.sheets.filter((sheet) => sheet.category === category).map((sheet) => sheet.sheetName);
  return names.length > 0 ? names.join(", ") : "-";
}

function uniqueSamples(values: string[]): string[] {
  return Array.from(new Set(values.map(normalizeText).filter(Boolean)));
}

function md(value: string): string {
  return normalizeText(value).replaceAll("|", "\\|");
}

function readArg(name: string): string | null {
  const equalPrefix = `${name}=`;
  const equalArg = process.argv.find((arg) => arg.startsWith(equalPrefix));
  if (equalArg) {
    return equalArg.slice(equalPrefix.length) || null;
  }
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return null;
  }
  return process.argv[index + 1] ?? null;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
