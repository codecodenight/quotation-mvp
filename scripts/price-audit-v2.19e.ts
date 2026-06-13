import { access, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DB_PATH = "prisma/dev.db";
const REPORT_PATH = "docs/v2.19e-price-audit.md";
const SOURCE_ROOT = "/Volumes/My Passport/AI 报价/各家工厂最新报价汇总";

const TARGET_GROUPS = [
  {
    index: 1,
    category: "线条灯",
    factoryName: "伟润",
    problem: "多数 price=0，型号正常，疑似价格列缺失/错列",
  },
  {
    index: 2,
    category: "面板灯",
    factoryName: "欧诺 塑料 小面板灯",
    problem: "部分 price=0 或 price=1，型号正常，疑似价格列错位",
  },
  {
    index: 3,
    category: "灯带",
    factoryName: "尼奥",
    problem: "芯片型号/灯珠数被当价格：2835、5050、240、288 等",
  },
] as const;

type TargetGroup = (typeof TARGET_GROUPS)[number];

type PriceDistributionRow = {
  price: number | null;
  cnt: number | null;
};

type SourceFileRow = {
  file_id: string | null;
  file_name: string | null;
  relative_path: string | null;
  absolute_path_snapshot: string | null;
  offer_count: number | null;
};

type ProductSampleRow = {
  product_name: string;
  model_no: string | null;
  purchase_price: number | string | null;
  remark: string | null;
  size: string | null;
};

type PriceHistoryRow = {
  history_count: number | null;
  had_nonzero_price: number | null;
};

type ChipPriceRow = {
  product_name: string;
  model_no: string | null;
  purchase_price: number | string | null;
  remark: string | null;
};

type GroupCounts = {
  product_count: number | null;
  offer_count: number | null;
  zero_price_count: number | null;
  one_price_count: number | null;
  high_price_count: number | null;
};

type SourceFileReport = SourceFileRow & {
  resolved_path: string | null;
  exists_on_disk: boolean;
};

type GroupReport = {
  target: TargetGroup;
  counts: GroupCounts;
  priceDistribution: PriceDistributionRow[];
  sourceFiles: SourceFileReport[];
  zeroSamples: ProductSampleRow[];
  positiveSamples: ProductSampleRow[];
  priceHistory: PriceHistoryRow;
  chipPriceRows: ChipPriceRow[];
  recommendation: string;
};

async function main() {
  const reports = await Promise.all(TARGET_GROUPS.map(loadGroupReport));
  await writeFile(REPORT_PATH, buildMarkdown(reports), "utf8");
  console.log(
    JSON.stringify(
      {
        reportPath: REPORT_PATH,
        groups: reports.map((report) => ({
          category: report.target.category,
          factoryName: report.target.factoryName,
          products: toNumber(report.counts.product_count),
          offers: toNumber(report.counts.offer_count),
          zeroPrice: toNumber(report.counts.zero_price_count),
          sourceFiles: report.sourceFiles.length,
          sourceFilesExisting: report.sourceFiles.filter((file) => file.exists_on_disk).length,
        })),
      },
      null,
      2,
    ),
  );
}

async function loadGroupReport(target: TargetGroup): Promise<GroupReport> {
  const [countsRows, priceDistribution, sourceFileRows, zeroSamples, positiveSamples, historyRows, chipPriceRows] =
    await Promise.all([
      queryRows<GroupCounts>(buildCountsSql(target)),
      queryRows<PriceDistributionRow>(buildPriceDistributionSql(target)),
      queryRows<SourceFileRow>(buildSourceFilesSql(target)),
      queryRows<ProductSampleRow>(buildProductSampleSql(target, "zero")),
      queryRows<ProductSampleRow>(buildProductSampleSql(target, "positive")),
      queryRows<PriceHistoryRow>(buildPriceHistorySql(target)),
      target.category === "灯带" && target.factoryName === "尼奥" ? queryRows<ChipPriceRow>(buildNeonChipPriceSql()) : Promise.resolve([]),
    ]);

  const sourceFiles = await Promise.all(sourceFileRows.map(resolveSourceFile));
  const counts = countsRows[0] ?? emptyGroupCounts();
  const priceHistory = historyRows[0] ?? { history_count: 0, had_nonzero_price: 0 };

  return {
    target,
    counts,
    priceDistribution,
    sourceFiles,
    zeroSamples,
    positiveSamples,
    priceHistory,
    chipPriceRows,
    recommendation: buildRecommendation(target, counts, sourceFiles, priceHistory),
  };
}

function buildCountsSql(target: TargetGroup): string {
  return `
    SELECT
      COUNT(DISTINCT p.id) as product_count,
      COUNT(so.id) as offer_count,
      SUM(CASE WHEN CAST(so.purchase_price AS REAL) = 0 THEN 1 ELSE 0 END) as zero_price_count,
      SUM(CASE WHEN CAST(so.purchase_price AS REAL) = 1 THEN 1 ELSE 0 END) as one_price_count,
      SUM(CASE WHEN CAST(so.purchase_price AS REAL) > ${target.category === "灯带" ? 100 : 2000} THEN 1 ELSE 0 END) as high_price_count
    FROM supplier_offers so
    JOIN products p ON so.product_id = p.id
    WHERE ${groupWhereSql(target)}
  `;
}

function buildPriceDistributionSql(target: TargetGroup): string {
  return `
    SELECT
      CAST(so.purchase_price AS REAL) as price,
      COUNT(*) as cnt
    FROM supplier_offers so
    JOIN products p ON so.product_id = p.id
    WHERE ${groupWhereSql(target)}
    GROUP BY price
    ORDER BY cnt DESC, price ASC
    LIMIT 20
  `;
}

function buildSourceFilesSql(target: TargetGroup): string {
  return `
    SELECT
      f.id as file_id,
      f.file_name,
      f.relative_path,
      f.absolute_path_snapshot,
      COUNT(so.id) as offer_count
    FROM supplier_offers so
    JOIN products p ON so.product_id = p.id
    LEFT JOIN files f ON so.source_file_id = f.id
    WHERE ${groupWhereSql(target)}
    GROUP BY f.id, f.file_name, f.relative_path, f.absolute_path_snapshot
    ORDER BY offer_count DESC, f.file_name
  `;
}

function buildProductSampleSql(target: TargetGroup, mode: "zero" | "positive"): string {
  const pricePredicate =
    mode === "zero"
      ? "(CAST(so.purchase_price AS REAL) = 0 OR so.purchase_price IS NULL)"
      : "CAST(so.purchase_price AS REAL) > 0";

  return `
    SELECT
      p.product_name,
      p.model_no,
      so.purchase_price,
      p.remark,
      p.size
    FROM products p
    JOIN supplier_offers so ON so.product_id = p.id
    WHERE ${groupWhereSql(target)}
      AND ${pricePredicate}
    ORDER BY p.product_name
    LIMIT 10
  `;
}

function buildPriceHistorySql(target: TargetGroup): string {
  return `
    SELECT
      COUNT(*) as history_count,
      SUM(CASE WHEN CAST(ph.old_price AS REAL) > 0 THEN 1 ELSE 0 END) as had_nonzero_price
    FROM price_history ph
    JOIN supplier_offers so ON ph.supplier_offer_id = so.id
    JOIN products p ON so.product_id = p.id
    WHERE ${groupWhereSql(target)}
  `;
}

function buildNeonChipPriceSql(): string {
  return `
    SELECT
      p.product_name,
      p.model_no,
      so.purchase_price,
      p.remark
    FROM products p
    JOIN supplier_offers so ON so.product_id = p.id
    WHERE p.category = '灯带'
      AND so.factory_name = '尼奥'
      AND CAST(so.purchase_price AS REAL) > 100
    ORDER BY CAST(so.purchase_price AS REAL) DESC, p.product_name
  `;
}

function groupWhereSql(target: TargetGroup): string {
  return `p.category = ${sqlString(target.category)} AND so.factory_name = ${sqlString(target.factoryName)}`;
}

async function resolveSourceFile(row: SourceFileRow): Promise<SourceFileReport> {
  const candidatePaths = [
    row.absolute_path_snapshot,
    row.relative_path ? path.join(SOURCE_ROOT, row.relative_path) : null,
    row.relative_path ? path.join("/Volumes/My Passport", row.relative_path) : null,
  ].filter((value): value is string => value != null && value.trim() !== "");

  for (const candidate of candidatePaths) {
    if (await pathExists(candidate)) {
      return {
        ...row,
        resolved_path: candidate,
        exists_on_disk: true,
      };
    }
  }

  return {
    ...row,
    resolved_path: candidatePaths[0] ?? null,
    exists_on_disk: false,
  };
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function buildRecommendation(
  target: TargetGroup,
  counts: GroupCounts,
  sourceFiles: SourceFileReport[],
  priceHistory: PriceHistoryRow,
): string {
  const existingSources = sourceFiles.filter((file) => file.exists_on_disk);
  const hadNonzeroHistory = toNumber(priceHistory.had_nonzero_price) > 0;
  const zeroPriceCount = toNumber(counts.zero_price_count);
  const highPriceCount = toNumber(counts.high_price_count);

  if (target.category === "线条灯" && target.factoryName === "伟润") {
    if (existingSources.length > 0) {
      return `建议重新检查源文件价格列并重新导入/修正。当前 ${formatInteger(zeroPriceCount)} 条 price=0，源文件仍在硬盘上；price_history 中${
        hadNonzeroHistory ? "曾出现非零旧价，需防止再次被 0 覆盖" : "没有非零旧价，说明库内无法直接恢复价格"
      }。`;
    }
    return "源文件缺失，无法从硬盘重新提取；建议在报价前标记为不可报价或人工补价。";
  }

  if (target.category === "面板灯" && target.factoryName === "欧诺 塑料 小面板灯") {
    if (existingSources.length > 0) {
      return `建议从源文件重新核对价格列；当前 price=0 有 ${formatInteger(zeroPriceCount)} 条，price=1 有 ${formatInteger(
        toNumber(counts.one_price_count),
      )} 条，产品型号正常，不建议删除。`;
    }
    return "产品型号正常但源文件缺失；建议人工补价，暂不删除。";
  }

  if (target.category === "灯带" && target.factoryName === "尼奥") {
    if (existingSources.length > 0) {
      return `建议人工核价或从源文件重新提取。当前 ${formatInteger(highPriceCount)} 条 price>100，高概率是芯片型号/灯珠数进入价格列；产品本身有图片/参数，不应删除。`;
    }
    return "源文件缺失；保留产品，后续人工修正 2835/5050/240/288 等异常价格。";
  }

  return "保留产品，后续按源文件或人工核价修正价格。";
}

function buildMarkdown(reports: GroupReport[]): string {
  return [
    "# V2.19E 价格异常调查报告",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## 总结",
    "",
    "| 组 | 品类 | 工厂 | 产品数 | Offer 数 | price=0 | price=1 | 高价异常 | 源文件 | 可修复？ |",
    "|---|---|---|---:|---:|---:|---:|---:|---|---|",
    ...reports.map(renderSummaryRow),
    "",
    ...reports.flatMap(renderGroupReport),
    "## 修复方案总结",
    "",
    "| 组 | 方向 | 前提条件 |",
    "|---|---|---|",
    ...reports.map((report) => {
      const direction =
        report.target.category === "灯带"
          ? "人工修正异常价格 / 或从源文件重新提取"
          : "重新导入正确价格列 / 或批量补价";
      const condition =
        report.sourceFiles.some((file) => file.exists_on_disk)
          ? "源文件存在；下一步可读 Excel 表头确认正确价格列"
          : "源文件缺失；只能人工补价或标记不可报价";
      return `| ${report.target.index}. ${escapeMarkdown(report.target.category)} — ${escapeMarkdown(
        report.target.factoryName,
      )} | ${escapeMarkdown(direction)} | ${escapeMarkdown(condition)} |`;
    }),
    "",
    "## 约束确认",
    "",
    "- 本脚本只读取 SQLite 数据和检查源文件是否存在。",
    "- 未读取 Excel 内容。",
    "- 未修改数据库、schema 或任何源文件。",
    "",
  ].join("\n");
}

function renderSummaryRow(report: GroupReport): string {
  const sourceText = renderSourceSummary(report.sourceFiles);
  const fixable = report.sourceFiles.some((file) => file.exists_on_disk) ? "可重新检查源文件" : "源文件缺失";
  return `| ${report.target.index} | ${escapeMarkdown(report.target.category)} | ${escapeMarkdown(report.target.factoryName)} | ${formatInteger(
    toNumber(report.counts.product_count),
  )} | ${formatInteger(toNumber(report.counts.offer_count))} | ${formatInteger(
    toNumber(report.counts.zero_price_count),
  )} | ${formatInteger(toNumber(report.counts.one_price_count))} | ${formatInteger(
    toNumber(report.counts.high_price_count),
  )} | ${escapeMarkdown(sourceText)} | ${escapeMarkdown(fixable)} |`;
}

function renderGroupReport(report: GroupReport): string[] {
  return [
    `## 组 ${report.target.index}: ${report.target.category} — ${report.target.factoryName}`,
    "",
    `问题：${report.target.problem}`,
    "",
    "### 价格分布",
    "",
    "| price | count |",
    "|---:|---:|",
    ...renderPriceDistributionRows(report.priceDistribution),
    "",
    "### 源文件",
    "",
    "| file_id | file_name | offer_count | relative_path | 磁盘存在 | resolved_path |",
    "|---|---|---:|---|---|---|",
    ...renderSourceFileRows(report.sourceFiles),
    "",
    "### 产品采样",
    "",
    "#### price=0（前 10）",
    "",
    "| product_name | model_no | price | remark | size |",
    "|---|---|---:|---|---|",
    ...renderSampleRows(report.zeroSamples),
    "",
    "#### price>0（前 10）",
    "",
    "| product_name | model_no | price | remark | size |",
    "|---|---|---:|---|---|",
    ...renderSampleRows(report.positiveSamples),
    "",
    "### Price history",
    "",
    `- history_count: ${formatInteger(toNumber(report.priceHistory.history_count))}`,
    `- had_nonzero_price: ${formatInteger(toNumber(report.priceHistory.had_nonzero_price))}`,
    "",
    ...(report.target.category === "灯带" && report.target.factoryName === "尼奥" ? renderNeonSection(report.chipPriceRows) : []),
    "### 修复建议",
    "",
    report.recommendation,
    "",
    "---",
    "",
  ];
}

function renderPriceDistributionRows(rows: PriceDistributionRow[]): string[] {
  if (rows.length === 0) {
    return ["| - | 0 |"];
  }
  return rows.map((row) => `| ${formatPrice(row.price)} | ${formatInteger(toNumber(row.cnt))} |`);
}

function renderSourceFileRows(rows: SourceFileReport[]): string[] {
  if (rows.length === 0) {
    return ["| - | - | 0 | - | MISSING | - |"];
  }
  return rows.map(
    (row) =>
      `| ${escapeMarkdown(row.file_id ?? "NULL")} | ${escapeMarkdown(row.file_name ?? "NULL")} | ${formatInteger(
        toNumber(row.offer_count),
      )} | ${escapeMarkdown(row.relative_path ?? "NULL")} | ${row.exists_on_disk ? "EXISTS" : "MISSING"} | ${escapeMarkdown(
        row.resolved_path ?? "NULL",
      )} |`,
  );
}

function renderSampleRows(rows: ProductSampleRow[]): string[] {
  if (rows.length === 0) {
    return ["| - | - | - | - | - |"];
  }
  return rows.map(
    (row) =>
      `| ${escapeMarkdown(row.product_name)} | ${escapeMarkdown(row.model_no ?? "-")} | ${formatPrice(row.purchase_price)} | ${escapeMarkdown(
        truncateCell(row.remark),
      )} | ${escapeMarkdown(truncateCell(row.size))} |`,
  );
}

function renderNeonSection(rows: ChipPriceRow[]): string[] {
  return [
    "### 尼奥专项：芯片型号价格检查",
    "",
    "| product_name | model_no | price | remark |",
    "|---|---|---:|---|",
    ...(rows.length === 0
      ? ["| - | - | - | - |"]
      : rows.map(
          (row) =>
            `| ${escapeMarkdown(row.product_name)} | ${escapeMarkdown(row.model_no ?? "-")} | ${formatPrice(
              row.purchase_price,
            )} | ${escapeMarkdown(truncateCell(row.remark))} |`,
        )),
    "",
  ];
}

function renderSourceSummary(rows: SourceFileReport[]): string {
  if (rows.length === 0) {
    return "无 source_file";
  }
  const existing = rows.filter((row) => row.exists_on_disk).length;
  return `${existing}/${rows.length} 存在`;
}

async function queryRows<T>(sql: string): Promise<T[]> {
  const { stdout } = await execFileAsync("sqlite3", ["-json", DB_PATH, sql], {
    maxBuffer: 20 * 1024 * 1024,
  });
  const trimmed = stdout.trim();
  if (!trimmed) {
    return [];
  }
  return JSON.parse(trimmed) as T[];
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function toNumber(value: number | null | undefined): number {
  return value ?? 0;
}

function formatInteger(value: number): string {
  return value.toLocaleString("en-US");
}

function formatPrice(value: number | string | null | undefined): string {
  if (value == null) {
    return "-";
  }
  return String(value);
}

function truncateCell(value: string | null | undefined): string {
  if (value == null || value.trim() === "") {
    return "-";
  }
  const oneLine = value.replace(/\s+/g, " ").trim();
  return oneLine.length > 140 ? `${oneLine.slice(0, 137)}...` : oneLine;
}

function escapeMarkdown(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function emptyGroupCounts(): GroupCounts {
  return {
    product_count: 0,
    offer_count: 0,
    zero_price_count: 0,
    one_price_count: 0,
    high_price_count: 0,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
