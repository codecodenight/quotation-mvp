import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { PrismaClient } from "@prisma/client";
import * as XLSX from "xlsx";

const prisma = new PrismaClient();

const REPORT_PATH = path.join("docs", "v10.0-audit-report.md");
const HEADER_SCAN_ROWS = 10;
const MIN_HEADER_CELLS = 5;

type ColumnCategory = "identifier" | "business" | "param" | "unknown";

type ExcelFileRow = {
  id: string;
  fileName: string;
  relativePath: string;
  folderName: string | null;
};

type HeaderClassification = {
  category: ColumnCategory;
  paramKey: string | null;
};

type ColumnOccurrence = {
  fileId: string;
  sheetName: string;
  rawHeader: string;
  normalizedHeader: string;
  category: ColumnCategory;
  paramKey: string | null;
};

type ColumnAggregate = {
  normalizedHeader: string;
  category: ColumnCategory;
  paramKey: string | null;
  rawSamples: Map<string, number>;
  fileIds: Set<string>;
  sheetCount: number;
  occurrenceCount: number;
};

type FileIntegrityRow = {
  fileId: string;
  fileName: string;
  relativePath: string;
  dataRows: number;
  linkedProducts: number;
  diff: number;
  diffRate: number;
  status: string;
};

type FileScanResult = {
  file: ExcelFileRow;
  physicalPath: string;
  accessible: boolean;
  sheetCount: number;
  dataRows: number;
  columns: ColumnOccurrence[];
  error: string | null;
};

type ParamCoverageRow = {
  paramKey: string;
  recordCount: number;
  productCount: number;
};

type CategoryCountRow = {
  category: string;
  productCount: number;
};

type CategoryParamCoverageRow = {
  category: string;
  paramKey: string;
  productCount: number;
};

type PanelSuggestion = {
  totalPanelProducts: number;
  largePanelProducts: number;
  smallPanelProducts: number;
  unknownPanelProducts: number;
};

const IDENTIFIER_PATTERNS = [
  /item\s*no/i,
  /model/i,
  /型号/i,
  /产品名/i,
  /product\s*name/i,
  /photo/i,
  /picture/i,
  /图片/i,
  /序号/i,
  /^no\.?$/i,
];

const BUSINESS_PATTERNS = [
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
  /g\.?\s*w/i,
  /n\.?\s*w/i,
  /毛重/i,
  /净重/i,
  /箱规/i,
  /外箱/i,
  /内盒/i,
  /装箱/i,
];

const PARAM_EXCLUSION_PATTERNS = [/power\s*cord/i, /线材规格/i];

const HEADER_TO_PARAM: Record<string, string> = {
  power: "watts",
  watt: "watts",
  watts: "watts",
  wattage: "watts",
  "actual watt": "watts",
  "actual power": "watts",
  "real power": "watts",
  "rated wattage": "watts",
  "rated power": "watts",
  功率: "watts",
  实际功率: "watts",
  额定功率: "watts",
  瓦数: "watts",
  w: "watts",
  cct: "cct",
  色温: "cct",
  可选色温: "cct",
  cri: "cri",
  ra: "cri",
  显指: "cri",
  pf: "pf",
  "power factor": "pf",
  功率因数: "pf",
  功率因素: "pf",
  pf值: "pf",
  "lm/w": "luminous_efficacy",
  efficiency: "luminous_efficacy",
  光效: "luminous_efficacy",
  整灯光效: "luminous_efficacy",
  裸灯光效: "luminous_efficacy",
  "luminous flux": "luminous_efficacy",
  lumens: "lumens",
  lumen: "lumens",
  光通量: "lumens",
  "beam angle": "beam_angle",
  光束角: "beam_angle",
  ip: "ip",
  "ip class": "ip",
  "ip grade": "ip",
  "ip rate": "ip",
  防护等级: "ip",
  防水等级: "ip",
  voltage: "voltage",
  "input voltage": "voltage",
  input: "voltage",
  电压: "voltage",
  material: "material",
  材质: "material",
  size: "size_display",
  dimension: "size_display",
  尺寸: "size_display",
  产品尺寸: "size_display",
  面环规格: "size_display",
  "product size": "size_display",
  "body size": "size_display",
  规格: "size_display",
  "led type": "led_type",
  "chip type": "led_type",
  chip: "led_type",
  base: "base",
  灯头: "base",
  warranty: "warranty",
  质保: "warranty",
  guarantee: "warranty",
  certificate: "certification",
  认证: "certification",
  shape: "shape",
  形状: "shape",
  "cut size": "cutout_mm",
  "hole size": "cutout_mm",
  开孔: "cutout_mm",
  "led qty": "led_count",
  "led no": "led_count",
  "chips qty": "led_count",
  "led quantity": "led_count",
  灯珠数: "led_count",
  灯珠颗数: "led_count",
  driver: "driver_type",
  "driver brand": "driver_brand",
  驱动: "driver_type",
  flicker: "flicker",
  flickery: "flicker",
  频闪: "flicker",
  sdcm: "sdcm",
  色容差: "sdcm",
  spd: "spd",
  surge: "spd",
  "ambient temperature": "ambient_temp",
  环境温度: "ambient_temp",
  height: "height_mm",
  高度: "height_mm",
  "maximum linkable power": "max_linkable_power",
  accessories: "accessories",
  note: "note",
  remark: "note",
  备注: "note",
};

const KEY_PARAMS = ["watts", "lumens", "luminous_efficacy", "cri", "cct", "pf", "ip", "beam_angle", "driver_type"];

async function main() {
  const startedAt = Date.now();
  const beforeParamCount = await countProductParams();
  const [files, totalProducts, linkedProductsByFile, paramCoverage, categoryCounts, categoryParamCoverage, panelSuggestion] =
    await Promise.all([
      loadExcelFiles(),
      countProducts(),
      loadLinkedProductCountsByFile(),
      loadParamCoverage(),
      loadCategoryCounts(),
      loadCategoryParamCoverage(),
      loadPanelSuggestion(),
    ]);

  const scanResults: FileScanResult[] = [];
  const occurrences: ColumnOccurrence[] = [];

  for (const [index, file] of files.entries()) {
    if (index === 0 || (index + 1) % 50 === 0 || index + 1 === files.length) {
      console.log(`Scanning ${index + 1}/${files.length}: ${file.relativePath}`);
    }

    const result = inspectExcelFile(file);
    scanResults.push(result);
    occurrences.push(...result.columns);
  }

  const afterParamCount = await countProductParams();
  const columnAggregates = aggregateColumns(occurrences);
  const integrityRows = buildIntegrityRows(scanResults, linkedProductsByFile);

  await mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await writeFile(
    REPORT_PATH,
    buildReport({
      generatedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      files,
      scanResults,
      columnAggregates,
      totalProducts,
      paramCoverage,
      categoryCounts,
      categoryParamCoverage,
      integrityRows,
      panelSuggestion,
      beforeParamCount,
      afterParamCount,
    }),
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        reportPath: REPORT_PATH,
        excelFileRecords: files.length,
        scannedFiles: scanResults.filter((result) => !result.error && result.accessible).length,
        inaccessibleFiles: scanResults.filter((result) => !result.accessible).length,
        readErrors: scanResults.filter((result) => result.error).length,
        sheets: scanResults.reduce((sum, result) => sum + result.sheetCount, 0),
        uniqueHeaders: columnAggregates.length,
        productParamsBefore: beforeParamCount,
        productParamsAfter: afterParamCount,
      },
      null,
      2,
    ),
  );

  await prisma.$disconnect();
}

async function loadExcelFiles(): Promise<ExcelFileRow[]> {
  return prisma.file.findMany({
    where: { fileType: "excel" },
    select: { id: true, fileName: true, relativePath: true, folderName: true },
    orderBy: [{ relativePath: "asc" }],
  });
}

async function countProducts(): Promise<number> {
  return prisma.product.count();
}

async function countProductParams(): Promise<number> {
  return prisma.productParam.count();
}

async function loadLinkedProductCountsByFile(): Promise<Map<string, number>> {
  const rows = await prisma.$queryRaw<Array<{ source_file_id: string; product_count: number | bigint }>>`
    SELECT source_file_id, COUNT(DISTINCT product_id) AS product_count
    FROM supplier_offers
    WHERE source_file_id IS NOT NULL
    GROUP BY source_file_id
  `;

  return new Map(rows.map((row) => [row.source_file_id, toNumber(row.product_count)]));
}

async function loadParamCoverage(): Promise<Map<string, ParamCoverageRow>> {
  const rows = await prisma.$queryRaw<Array<{ param_key: string; record_count: number | bigint; product_count: number | bigint }>>`
    SELECT param_key, COUNT(*) AS record_count, COUNT(DISTINCT product_id) AS product_count
    FROM product_params
    GROUP BY param_key
    ORDER BY param_key
  `;

  return new Map(
    rows.map((row) => [
      row.param_key,
      {
        paramKey: row.param_key,
        recordCount: toNumber(row.record_count),
        productCount: toNumber(row.product_count),
      },
    ]),
  );
}

async function loadCategoryCounts(): Promise<CategoryCountRow[]> {
  const rows = await prisma.$queryRaw<Array<{ category: string | null; product_count: number | bigint }>>`
    SELECT COALESCE(category, '(未分类)') AS category, COUNT(*) AS product_count
    FROM products
    GROUP BY COALESCE(category, '(未分类)')
    ORDER BY COUNT(*) DESC, category
  `;

  return rows.map((row) => ({ category: row.category ?? "(未分类)", productCount: toNumber(row.product_count) }));
}

async function loadCategoryParamCoverage(): Promise<CategoryParamCoverageRow[]> {
  const rows = await prisma.$queryRaw<Array<{ category: string | null; param_key: string; product_count: number | bigint }>>`
    SELECT COALESCE(p.category, '(未分类)') AS category, pp.param_key, COUNT(DISTINCT p.id) AS product_count
    FROM products p
    JOIN product_params pp ON pp.product_id = p.id
    WHERE pp.param_key IN (${KEY_PARAMS.join(",")})
    GROUP BY COALESCE(p.category, '(未分类)'), pp.param_key
  `;

  return rows.map((row) => ({
    category: row.category ?? "(未分类)",
    paramKey: row.param_key,
    productCount: toNumber(row.product_count),
  }));
}

async function loadPanelSuggestion(): Promise<PanelSuggestion> {
  const rows = await prisma.$queryRaw<Array<{ product_id: string; param_key: string | null; value: string | null }>>`
    SELECT p.id AS product_id, pp.param_key, COALESCE(pp.normalized_value, pp.raw_value) AS value
    FROM products p
    LEFT JOIN product_params pp ON pp.product_id = p.id
      AND pp.param_key IN ('panel_size', 'size_display', 'diameter_mm', 'cutout_mm', 'length_mm', 'width_mm')
    WHERE p.category = '面板灯'
  `;

  const valuesByProduct = new Map<string, string[]>();
  for (const row of rows) {
    const values = valuesByProduct.get(row.product_id) ?? [];
    if (row.value) values.push(row.value);
    valuesByProduct.set(row.product_id, values);
  }

  let largePanelProducts = 0;
  let smallPanelProducts = 0;
  let unknownPanelProducts = 0;

  for (const values of valuesByProduct.values()) {
    const joined = values.join(" ").toLowerCase();
    if (/(595|600|603|606)\s*[x×*]\s*(595|600|603|606)|\b(595|600|603|606)\b/.test(joined)) {
      largePanelProducts += 1;
    } else if (joined.trim()) {
      smallPanelProducts += 1;
    } else {
      unknownPanelProducts += 1;
    }
  }

  return {
    totalPanelProducts: valuesByProduct.size,
    largePanelProducts,
    smallPanelProducts,
    unknownPanelProducts,
  };
}

function inspectExcelFile(file: ExcelFileRow): FileScanResult {
  const physicalPath = resolvePhysicalPath(file.relativePath);
  if (!existsSync(physicalPath)) {
    return {
      file,
      physicalPath,
      accessible: false,
      sheetCount: 0,
      dataRows: 0,
      columns: [],
      error: "file missing",
    };
  }

  try {
    const workbook = XLSX.readFile(physicalPath, { cellDates: false });
    const columns: ColumnOccurrence[] = [];
    let dataRows = 0;

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const range = sheet?.["!ref"] ? XLSX.utils.decode_range(sheet["!ref"]) : null;
      if (!sheet || !range) continue;

      const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
        header: 1,
        defval: "",
        raw: false,
        range: {
          s: { r: 0, c: 0 },
          e: { r: Math.min(range.e.r, HEADER_SCAN_ROWS - 1), c: range.e.c },
        },
      });
      const header = detectHeaderRow(rows);
      if (!header) continue;

      dataRows += Math.max(0, range.e.r - header.rowIndex);
      for (const rawCell of header.values) {
        const rawHeader = cellToString(rawCell);
        if (!rawHeader) continue;

        const normalizedHeader = normalizeHeader(rawHeader);
        if (!normalizedHeader) continue;
        const classification = classifyHeader(normalizedHeader);
        columns.push({
          fileId: file.id,
          sheetName,
          rawHeader,
          normalizedHeader,
          category: classification.category,
          paramKey: classification.paramKey,
        });
      }
    }

    return {
      file,
      physicalPath,
      accessible: true,
      sheetCount: workbook.SheetNames.length,
      dataRows,
      columns,
      error: null,
    };
  } catch (error) {
    return {
      file,
      physicalPath,
      accessible: true,
      sheetCount: 0,
      dataRows: 0,
      columns: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function resolvePhysicalPath(relativePath: string): string {
  if (path.isAbsolute(relativePath)) return relativePath;
  return path.join(process.cwd(), relativePath);
}

function detectHeaderRow(rows: unknown[][]): { rowIndex: number; values: unknown[] } | null {
  let best: { rowIndex: number; values: unknown[]; nonEmptyCount: number } | null = null;

  for (const [rowIndex, row] of rows.entries()) {
    const nonEmptyCount = row.filter((cell) => cellToString(cell)).length;
    if (nonEmptyCount < MIN_HEADER_CELLS) continue;
    if (!best || nonEmptyCount > best.nonEmptyCount) {
      best = { rowIndex, values: row, nonEmptyCount };
    }
  }

  return best ? { rowIndex: best.rowIndex, values: best.values } : null;
}

function normalizeHeader(input: string): string {
  return input
    .normalize("NFC")
    .replace(/[\r\n]+/g, " ")
    .replace(/[（(][^）)]*[）)]/g, " ")
    .replace(/±\s*\d+\s*%/gi, " ")
    .replace(/\b(usd|rmb|cny|pcs|pc|mm|cm)\b$/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function classifyHeader(normalizedHeader: string): HeaderClassification {
  if (BUSINESS_PATTERNS.some((pattern) => pattern.test(normalizedHeader))) {
    return { category: "business", paramKey: null };
  }

  if (IDENTIFIER_PATTERNS.some((pattern) => pattern.test(normalizedHeader))) {
    return { category: "identifier", paramKey: null };
  }

  const paramKey = matchParamKey(normalizedHeader);
  if (paramKey) return { category: "param", paramKey };

  return { category: "unknown", paramKey: null };
}

function matchParamKey(normalizedHeader: string): string | null {
  if (PARAM_EXCLUSION_PATTERNS.some((pattern) => pattern.test(normalizedHeader))) return null;

  if (HEADER_TO_PARAM[normalizedHeader]) return HEADER_TO_PARAM[normalizedHeader];

  const entries = Object.entries(HEADER_TO_PARAM).sort(([left], [right]) => right.length - left.length);
  for (const [label, paramKey] of entries) {
    if (label.length <= 2) continue;
    if (containsHeaderLabel(normalizedHeader, label)) return paramKey;
  }

  return null;
}

function containsHeaderLabel(normalizedHeader: string, label: string): boolean {
  if (/^[a-z0-9 ]+$/i.test(label)) {
    const escaped = escapeRegExp(label).replace(/\\ /g, "\\s+");
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(normalizedHeader);
  }

  return normalizedHeader.includes(label);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function aggregateColumns(occurrences: ColumnOccurrence[]): ColumnAggregate[] {
  const aggregates = new Map<string, ColumnAggregate>();

  for (const occurrence of occurrences) {
    const key = `${occurrence.normalizedHeader}\u0000${occurrence.category}\u0000${occurrence.paramKey ?? ""}`;
    const aggregate =
      aggregates.get(key) ??
      ({
        normalizedHeader: occurrence.normalizedHeader,
        category: occurrence.category,
        paramKey: occurrence.paramKey,
        rawSamples: new Map<string, number>(),
        fileIds: new Set<string>(),
        sheetCount: 0,
        occurrenceCount: 0,
      } satisfies ColumnAggregate);

    aggregate.rawSamples.set(occurrence.rawHeader, (aggregate.rawSamples.get(occurrence.rawHeader) ?? 0) + 1);
    aggregate.fileIds.add(occurrence.fileId);
    aggregate.sheetCount += 1;
    aggregate.occurrenceCount += 1;
    aggregates.set(key, aggregate);
  }

  return [...aggregates.values()].sort((a, b) => {
    const fileDiff = b.fileIds.size - a.fileIds.size;
    if (fileDiff !== 0) return fileDiff;
    const occurrenceDiff = b.occurrenceCount - a.occurrenceCount;
    if (occurrenceDiff !== 0) return occurrenceDiff;
    return a.normalizedHeader.localeCompare(b.normalizedHeader);
  });
}

function buildIntegrityRows(results: FileScanResult[], linkedProductsByFile: Map<string, number>): FileIntegrityRow[] {
  return results
    .map((result) => {
      const linkedProducts = linkedProductsByFile.get(result.file.id) ?? 0;
      const diff = linkedProducts - result.dataRows;
      const denominator = Math.max(result.dataRows, linkedProducts, 1);
      const diffRate = Math.abs(diff) / denominator;
      const status = !result.accessible || result.error ? "read-error" : diffRate > 0.3 ? "⚠️ >30%" : "ok";
      return {
        fileId: result.file.id,
        fileName: result.file.fileName,
        relativePath: result.file.relativePath,
        dataRows: result.dataRows,
        linkedProducts,
        diff,
        diffRate,
        status,
      };
    })
    .sort((a, b) => b.diffRate - a.diffRate || b.dataRows - a.dataRows);
}

function buildReport(input: {
  generatedAt: string;
  durationMs: number;
  files: ExcelFileRow[];
  scanResults: FileScanResult[];
  columnAggregates: ColumnAggregate[];
  totalProducts: number;
  paramCoverage: Map<string, ParamCoverageRow>;
  categoryCounts: CategoryCountRow[];
  categoryParamCoverage: CategoryParamCoverageRow[];
  integrityRows: FileIntegrityRow[];
  panelSuggestion: PanelSuggestion;
  beforeParamCount: number;
  afterParamCount: number;
}) {
  const scanned = input.scanResults.filter((result) => result.accessible && !result.error);
  const missing = input.scanResults.filter((result) => !result.accessible);
  const errors = input.scanResults.filter((result) => result.error && result.accessible);
  const paramExcelCounts = countExcelFilesByParam(input.columnAggregates);
  const allParamKeys = [...new Set([...paramExcelCounts.keys(), ...input.paramCoverage.keys()])].sort();
  const categoryParamMap = buildCategoryParamMap(input.categoryParamCoverage);
  const unknownColumns = input.columnAggregates.filter((column) => column.category === "unknown");

  return `# V10.0 源文件参数审计报告

生成时间: ${input.generatedAt}
运行耗时: ${formatDuration(input.durationMs)}

| 指标 | 数值 |
|---|---:|
| DB Excel 文件记录 | ${input.files.length.toLocaleString()} |
| 成功扫描文件数 | ${scanned.length.toLocaleString()} |
| 不可访问文件 | ${missing.length.toLocaleString()} |
| 读取失败文件 | ${errors.length.toLocaleString()} |
| 扫描 Sheet 数 | ${input.scanResults.reduce((sum, result) => sum + result.sheetCount, 0).toLocaleString()} |
| 抽取列名总次数 | ${input.columnAggregates.reduce((sum, column) => sum + column.occurrenceCount, 0).toLocaleString()} |
| 唯一归一化列名 | ${input.columnAggregates.length.toLocaleString()} |
| DB 产品总数 | ${input.totalProducts.toLocaleString()} |
| product_params 运行前 | ${input.beforeParamCount.toLocaleString()} |
| product_params 运行后 | ${input.afterParamCount.toLocaleString()} |
| DB 写入检查 | ${input.beforeParamCount === input.afterParamCount ? "通过，未变化" : "⚠️ 数量变化"} |

## 不可访问 / 读取失败文件

${buildProblemFileList(missing, errors)}

## 一、源文件列名汇总

| 原始列名（采样） | 归一化 | 映射 param_key | 出现文件数 | 类别 |
|---|---|---|---:|---|
${input.columnAggregates
  .map(
    (column) =>
      `| ${escapeMd(sampleRawHeaders(column.rawSamples))} | ${escapeMd(column.normalizedHeader)} | ${escapeMd(column.paramKey ?? "-")} | ${column.fileIds.size.toLocaleString()} | ${formatCategory(column.category)} |`,
  )
  .join("\n")}

## 二、参数覆盖率对比

| param_key | Excel 出现文件数 | DB 已有记录数 | DB 覆盖产品数 | 总产品数 | 覆盖率 | 状态 |
|---|---:|---:|---:|---:|---:|---|
${allParamKeys
  .map((paramKey) => {
    const coverage = input.paramCoverage.get(paramKey);
    const productCount = coverage?.productCount ?? 0;
    const rate = input.totalProducts > 0 ? productCount / input.totalProducts : 0;
    return `| ${escapeMd(paramKey)} | ${(paramExcelCounts.get(paramKey) ?? 0).toLocaleString()} | ${(coverage?.recordCount ?? 0).toLocaleString()} | ${productCount.toLocaleString()} | ${input.totalProducts.toLocaleString()} | ${formatPercent(rate)} | ${formatCoverageStatus(rate, coverage?.recordCount ?? 0)} |`;
  })
  .join("\n")}

## 三、品类 × 参数覆盖率矩阵

| 品类 | 产品数 | watts | lumens | efficacy | cri | cct | pf | ip | beam_angle | driver_type |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
${input.categoryCounts
  .map((category) => {
    const values = KEY_PARAMS.map((paramKey) => {
      const covered = categoryParamMap.get(`${category.category}\u0000${paramKey}`) ?? 0;
      return formatPercent(category.productCount > 0 ? covered / category.productCount : 0);
    });
    return `| ${escapeMd(category.category)} | ${category.productCount.toLocaleString()} | ${values.join(" | ")} |`;
  })
  .join("\n")}

## 四、数据完整性

| 文件名 | Excel 数据行 | 关联 Product 数 | 差异 | 差异率 | 状态 |
|---|---:|---:|---:|---:|---|
${input.integrityRows
  .map(
    (row) =>
      `| ${escapeMd(row.fileName)} | ${row.dataRows.toLocaleString()} | ${row.linkedProducts.toLocaleString()} | ${row.diff.toLocaleString()} | ${formatPercent(row.diffRate)} | ${row.status} |`,
  )
  .join("\n")}

### 差异率 > 30% 文件明细

| 文件名 | relative_path | Excel 数据行 | 关联 Product 数 | 差异率 |
|---|---|---:|---:|---:|
${input.integrityRows
  .filter((row) => row.diffRate > 0.3)
  .map(
    (row) =>
      `| ${escapeMd(row.fileName)} | ${escapeMd(row.relativePath)} | ${row.dataRows.toLocaleString()} | ${row.linkedProducts.toLocaleString()} | ${formatPercent(row.diffRate)} |`,
  )
  .join("\n")}

## 五、未识别列名

| 原始列名（采样） | 归一化 | 出现文件数 | 出现次数 |
|---|---|---:|---:|
${unknownColumns
  .map(
    (column) =>
      `| ${escapeMd(sampleRawHeaders(column.rawSamples))} | ${escapeMd(column.normalizedHeader)} | ${column.fileIds.size.toLocaleString()} | ${column.occurrenceCount.toLocaleString()} |`,
  )
  .join("\n")}

## 六、品类细分建议

基于 \`面板灯\` 的 \`panel_size / size_display / diameter / length / width\` 参数粗分：

| 分组 | 产品数 |
|---|---:|
| 大面板（595/600/603/606 系） | ${input.panelSuggestion.largePanelProducts.toLocaleString()} |
| 小面板 / 圆形 / 嵌入式等 | ${input.panelSuggestion.smallPanelProducts.toLocaleString()} |
| 缺少可判断尺寸 | ${input.panelSuggestion.unknownPanelProducts.toLocaleString()} |
| 面板灯总数 | ${input.panelSuggestion.totalPanelProducts.toLocaleString()} |

建议：如果报价工作中大面板和小面板的供应商、价格体系、客户询价方式明显不同，可以把 \`面板灯\` 拆成独立 category。当前报告只给出数据依据，不自动改库。
`;
}

function countExcelFilesByParam(columnAggregates: ColumnAggregate[]): Map<string, number> {
  const result = new Map<string, Set<string>>();
  for (const column of columnAggregates) {
    if (!column.paramKey) continue;
    const fileIds = result.get(column.paramKey) ?? new Set<string>();
    for (const fileId of column.fileIds) fileIds.add(fileId);
    result.set(column.paramKey, fileIds);
  }

  return new Map([...result.entries()].map(([paramKey, fileIds]) => [paramKey, fileIds.size]));
}

function buildCategoryParamMap(rows: CategoryParamCoverageRow[]): Map<string, number> {
  return new Map(rows.map((row) => [`${row.category}\u0000${row.paramKey}`, row.productCount]));
}

function buildProblemFileList(missing: FileScanResult[], errors: FileScanResult[]): string {
  if (missing.length === 0 && errors.length === 0) return "无。";

  const lines = ["| 文件名 | relative_path | 问题 |", "|---|---|---|"];
  for (const result of [...missing, ...errors]) {
    lines.push(`| ${escapeMd(result.file.fileName)} | ${escapeMd(result.file.relativePath)} | ${escapeMd(result.error ?? "file missing")} |`);
  }

  return lines.join("\n");
}

function sampleRawHeaders(samples: Map<string, number>): string {
  return [...samples.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 4)
    .map(([sample]) => sample)
    .join(" / ");
}

function formatCategory(category: ColumnCategory): string {
  switch (category) {
    case "identifier":
      return "标识";
    case "business":
      return "商务/包装";
    case "param":
      return "参数";
    case "unknown":
      return "未识别";
  }
}

function formatCoverageStatus(rate: number, recordCount: number): string {
  if (recordCount === 0) return "🆕 DB 里完全没有";
  if (rate > 0.5) return "✓ >50%";
  if (rate >= 0.1) return "⚠️ 10-50%";
  return "❌ <10%";
}

function formatDuration(durationMs: number): string {
  const seconds = Math.round(durationMs / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function formatPercent(value: number): string {
  return `${Math.round(value * 1000) / 10}%`;
}

function escapeMd(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ").trim();
}

function cellToString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value).trim();
  return String(value).trim();
}

function toNumber(value: number | bigint): number {
  return typeof value === "bigint" ? Number(value) : value;
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
