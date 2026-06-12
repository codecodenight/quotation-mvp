import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import * as XLSX from "xlsx";

const ROOT = "/Volumes/My Passport/AI 报价/各家工厂最新报价汇总";
const CSV_PATH = "docs/v2.13a-import-candidates.csv";
const DEFAULT_REPORT_PATH = "docs/tube-bulb-classify-report.md";
const DEFAULT_PLAN_PATH = "docs/tube-bulb-split-import-plan.md";

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
  csvRelativePath: string;
  relativePath: string;
  pathResolutionNote: string | null;
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

type ResolvedRelativePath = {
  relativePath: string;
  note: string | null;
};

type ImportPlanItem = {
  relativePath: string;
  factory: string;
  category: "球泡" | "灯管";
  sheets: string[];
  reason: string;
};

const FILE_BULB_REGEX = /球泡|A泡|T泡|G泡|异[形性]泡|C3[57]|GU10|GU5\.?3|蜡烛|玉兰花|PAR|LED灯泡|bulb/i;
const FILE_TUBE_REGEX = /灯管|T8|T5|TUBE|一体化支架/i;

const BULB_REGEX =
  /球泡|蜡烛|尖泡|拉尾|玉兰花|蘑菇|反射灯|G泡|T泡|A泡|R泡|柱泡|橄榄灯|异[形性]泡|LED灯泡|bulb|\bA(?:45|50|55|60|65|70|75|80|95)\b|\bC3[57]\b|\bG(?:4[05]|50|95|125)\b|\bR50\b|\bPAR\d*\b|\bGU10\b|\bGU5\.?3\b|\bE14\b|\bE27\b/i;
const TUBE_REGEX = /灯管|日光灯管|一体化支架|\bT[58]\b|\bTUBE\b/i;

async function main() {
  const reportPath = readArg("--report") ?? DEFAULT_REPORT_PATH;
  const planPath = readArg("--plan") ?? DEFAULT_PLAN_PATH;
  const candidates = await loadCandidates();
  const results: FileClassification[] = [];

  for (const candidate of candidates) {
    results.push(await analyzeCandidate(candidate));
  }

  await writeFile(reportPath, buildReport(results), "utf8");
  await writeFile(planPath, buildSplitImportPlan(results), "utf8");
  console.log(
    JSON.stringify(
      {
        reportPath,
        planPath,
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
  const candidateInputs = records
    .filter((record) => normalizeText(record.category) === "灯管")
    .filter((record) => normalizeText(record.classification) === "likely-importable")
    .map((record) => ({
      relativePath: normalizeCsvPath(record.path),
      factory: normalizeText(record.factory),
      estimatedProducts: Number(normalizeText(record.estimated_products)) || 0,
    }));

  return Promise.all(
    candidateInputs.map(async (candidate) => {
      const resolved = await resolveCandidatePath(candidate.relativePath);
      return {
        csvRelativePath: candidate.relativePath,
        relativePath: resolved.relativePath,
        pathResolutionNote: resolved.note,
        factory: candidate.factory,
        estimatedProducts: candidate.estimatedProducts,
      };
    }),
  );
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
    if (result.candidate.pathResolutionNote) {
      lines.push(`- 路径修正：${md(result.candidate.pathResolutionNote)}`);
      lines.push(`- CSV 原路径：${md(result.candidate.csvRelativePath)}`);
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

function buildSplitImportPlan(results: FileClassification[]): string {
  const plan = buildPlanItems(results);
  const mixedSheetCount = plan.mixed.flatMap((result) =>
    result.sheets.filter((sheet) => sheet.category === "球泡" || sheet.category === "灯管"),
  ).length;

  const lines: string[] = [];
  lines.push("# V2.17B — 灯管/球泡拆品类导入计划");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("## 总览");
  lines.push("");
  lines.push("| 指标 | 值 |");
  lines.push("|---|---:|");
  lines.push(`| 分析文件 | ${results.length} |`);
  lines.push(`| 球泡导入候选项 | ${plan.bulb.length} |`);
  lines.push(`| 灯管导入候选项 | ${plan.tube.length} |`);
  lines.push(`| 混合文件 | ${plan.mixed.length} |`);
  lines.push(`| 混合拆分 sheet 数 | ${mixedSheetCount} |`);
  lines.push(`| Skip 文件 | ${plan.skip.length} |`);
  lines.push(`| 仍需人工确认 | ${plan.manual.length} |`);
  lines.push("");

  lines.push("## 人工确认结果已应用");
  lines.push("");
  lines.push("- 佛山凯徽 `2年质保，光效高点的询价单2023.10.31.xlsx`：skip，不导入。");
  lines.push("- 合力 `T5一体化支架价格(1).xlsx`：归入灯管。");
  lines.push("- 嘉家旺文件：以硬盘实际路径 `嘉家旺202404.xlsx` 为准，脚本通过去空格唯一匹配解析。");
  lines.push("");

  appendPlanSection(lines, "直接导入为球泡", plan.bulb);
  appendPlanSection(lines, "直接导入为灯管", plan.tube);
  appendMixedPlanSection(lines, plan.mixed);
  appendSkipPlanSection(lines, plan.skip);
  appendManualPlanSection(lines, plan.manual);

  lines.push("## 下一步");
  lines.push("");
  lines.push("- 基于本计划更新 V2.14 导入脚本：按 `category` 拆为球泡/灯管。");
  lines.push("- 对混合文件按 sheet 白名单拆分导入。");
  lines.push("- 本计划不包含 dry-run，不写 DB，不导入。");
  lines.push("");

  return lines.join("\n");
}

function buildPlanItems(results: FileClassification[]) {
  const bulb: ImportPlanItem[] = [];
  const tube: ImportPlanItem[] = [];
  const mixed: FileClassification[] = [];
  const skip: Array<{ relativePath: string; factory: string; reason: string }> = [];
  const manual: Array<{ relativePath: string; factory: string; reason: string }> = [];

  for (const result of results) {
    const manualDecision = getManualDecision(result.candidate.relativePath);
    if (manualDecision?.action === "skip") {
      skip.push({ relativePath: result.candidate.relativePath, factory: result.candidate.factory, reason: manualDecision.reason });
      continue;
    }
    if (manualDecision?.action === "category") {
      const item = {
        relativePath: result.candidate.relativePath,
        factory: result.candidate.factory,
        category: manualDecision.category,
        sheets: importableSheetNames(result),
        reason: manualDecision.reason,
      };
      (manualDecision.category === "球泡" ? bulb : tube).push(item);
      continue;
    }

    if (result.category === "球泡" || result.category === "灯管") {
      const item = {
        relativePath: result.candidate.relativePath,
        factory: result.candidate.factory,
        category: result.category,
        sheets: importableSheetNames(result),
        reason: result.basis,
      };
      (result.category === "球泡" ? bulb : tube).push(item);
      continue;
    }
    if (result.category === "混合") {
      mixed.push(result);
      for (const category of ["球泡", "灯管"] as const) {
        const sheets = result.sheets.filter((sheet) => sheet.category === category).map((sheet) => sheet.sheetName);
        if (sheets.length === 0) continue;
        const item = {
          relativePath: result.candidate.relativePath,
          factory: result.candidate.factory,
          category,
          sheets,
          reason: "混合文件按 sheet 拆分",
        };
        (category === "球泡" ? bulb : tube).push(item);
      }
      continue;
    }

    manual.push({ relativePath: result.candidate.relativePath, factory: result.candidate.factory, reason: result.basis });
  }

  return { bulb, tube, mixed, skip, manual };
}

function appendPlanSection(lines: string[], title: string, items: ImportPlanItem[]) {
  lines.push(`## ${title}`);
  lines.push("");
  lines.push("| 文件 | 工厂 | Sheets | 分类依据 |");
  lines.push("|---|---|---|---|");
  for (const item of items) {
    lines.push(`| ${md(item.relativePath)} | ${md(item.factory)} | ${md(item.sheets.join(", ") || "全部/待读取")} | ${md(item.reason)} |`);
  }
  lines.push("");
}

function appendMixedPlanSection(lines: string[], results: FileClassification[]) {
  lines.push("## 混合文件拆分");
  lines.push("");
  lines.push("| 文件 | 工厂 | 球泡 Sheets | 灯管 Sheets |");
  lines.push("|---|---|---|---|");
  for (const result of results) {
    lines.push(`| ${md(result.candidate.relativePath)} | ${md(result.candidate.factory)} | ${md(sheetNames(result, "球泡"))} | ${md(sheetNames(result, "灯管"))} |`);
  }
  lines.push("");
}

function appendSkipPlanSection(lines: string[], items: Array<{ relativePath: string; factory: string; reason: string }>) {
  lines.push("## Skip 文件");
  lines.push("");
  lines.push("| 文件 | 工厂 | 理由 |");
  lines.push("|---|---|---|");
  for (const item of items) {
    lines.push(`| ${md(item.relativePath)} | ${md(item.factory)} | ${md(item.reason)} |`);
  }
  lines.push("");
}

function appendManualPlanSection(lines: string[], items: Array<{ relativePath: string; factory: string; reason: string }>) {
  lines.push("## 仍需人工确认");
  lines.push("");
  lines.push("| 文件 | 工厂 | 原因 |");
  lines.push("|---|---|---|");
  if (items.length === 0) {
    lines.push("| - | - | 无 |");
  } else {
    for (const item of items) {
      lines.push(`| ${md(item.relativePath)} | ${md(item.factory)} | ${md(item.reason)} |`);
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

export function normalizeCsvPath(value: unknown): string {
  return String(value ?? "")
    .normalize("NFC")
    .replace(/\r?\n/g, " ")
    .trim();
}

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFC")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function resolveCandidatePath(relativePath: string): Promise<ResolvedRelativePath> {
  const normalized = normalizeCsvPath(relativePath);
  if (existsSync(path.join(ROOT, normalized))) {
    return { relativePath: normalized, note: null };
  }

  const directory = path.posix.dirname(normalized);
  const absoluteDirectory = path.join(ROOT, directory);
  try {
    const entries = await readdir(absoluteDirectory, { withFileTypes: true });
    const availableRelativePaths = entries
      .filter((entry) => entry.isFile())
      .filter((entry) => !entry.name.startsWith(".") && !entry.name.startsWith("~$"))
      .filter((entry) => /\.(xlsx|xls)$/i.test(entry.name))
      .map((entry) => path.posix.join(directory, normalizeCsvPath(entry.name)));
    return resolveRelativePath(normalized, availableRelativePaths);
  } catch {
    return { relativePath: normalized, note: null };
  }
}

export function resolveRelativePath(relativePath: string, availableRelativePaths: string[]): ResolvedRelativePath {
  const normalized = normalizeCsvPath(relativePath);
  const normalizedAvailable = availableRelativePaths.map(normalizeCsvPath);
  if (normalizedAvailable.includes(normalized)) {
    return { relativePath: normalized, note: null };
  }

  const directory = path.posix.dirname(normalized);
  const targetBase = path.posix.basename(normalized);
  const targetExt = path.posix.extname(targetBase).toLowerCase();
  const targetKey = whitespaceInsensitive(targetBase);
  const matches = normalizedAvailable.filter((candidatePath) => {
    return (
      path.posix.dirname(candidatePath) === directory &&
      path.posix.extname(candidatePath).toLowerCase() === targetExt &&
      whitespaceInsensitive(path.posix.basename(candidatePath)) === targetKey
    );
  });

  if (matches.length === 1) {
    return {
      relativePath: matches[0],
      note: `CSV 路径不存在，按去空格唯一匹配到：${matches[0]}`,
    };
  }
  if (matches.length > 1) {
    return {
      relativePath: normalized,
      note: `CSV 路径不存在，去空格匹配到 ${matches.length} 个候选，需人工确认`,
    };
  }
  return { relativePath: normalized, note: null };
}

function whitespaceInsensitive(value: string): string {
  return normalizeCsvPath(value).replace(/\s+/g, "");
}

function getManualDecision(relativePath: string):
  | { action: "skip"; reason: string }
  | { action: "category"; category: "球泡" | "灯管"; reason: string }
  | null {
  const key = whitespaceInsensitive(relativePath);
  if (key.includes("佛山凯徽/2年质保，光效高点的询价单2023.10.31.xlsx")) {
    return { action: "skip", reason: "人工确认不用管，不导入" };
  }
  if (key.includes("合力/202604/T5一体化支架价格(1).xlsx")) {
    return { action: "category", category: "灯管", reason: "人工确认归灯管" };
  }
  return null;
}

function importableSheetNames(result: FileClassification): string[] {
  if (result.sheets.length === 0) {
    return [];
  }
  const dataSheets = result.sheets.filter((sheet) => sheet.dataRows > 0).map((sheet) => sheet.sheetName);
  return dataSheets.length > 0 ? dataSheets : result.sheets.map((sheet) => sheet.sheetName);
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
  return normalizeCsvPath(value).replaceAll("|", "\\|");
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
