import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { PrismaClient } from "../node_modules/.prisma/client/index.js";

const prisma = new PrismaClient();

const ROOT = "/Volumes/My Passport/AI 报价/各家工厂最新报价汇总";
const REPORT_PATH = "docs/v2.20-pdf-inventory.md";
const CSV_PATH = "docs/v2.20-pdf-inventory.csv";
const VOLUME_NAME = "My Passport";

type PdfKind =
  | "quotation"
  | "catalog"
  | "spec"
  | "certificate-report"
  | "packaging-image"
  | "manual"
  | "other";

type PdfRecord = {
  absolutePath: string;
  relativePath: string;
  fileName: string;
  fileSize: bigint;
  modifiedAt: Date;
  folderName: string | null;
  major: string;
  pathCategory: string;
  category: string;
  factory: string | null;
  kind: PdfKind;
  reason: string;
  existingFileId: string | null;
  existingRelativePath: string | null;
  action: "create" | "update" | "unchanged";
};

type ScriptOptions = {
  apply: boolean;
  reportPath: string;
  csvPath: string;
};

type ApplyResult = {
  backupPath: string | null;
  created: number;
  updated: number;
  unchanged: number;
};

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const startedAt = Date.now();

  if (!existsSync(ROOT)) {
    throw new Error(`硬盘目录不可访问：${ROOT}`);
  }

  const beforeCounts = await loadDbCounts();
  const existingFiles = await loadExistingPdfFiles();
  const pdfs = await scanPdfs(ROOT, existingFiles);
  const applyResult = options.apply ? await applyPdfRecords(pdfs) : null;
  const afterCounts = await loadDbCounts();

  await mkdir(path.dirname(options.reportPath), { recursive: true });
  await writeFile(options.reportPath, buildMarkdownReport(pdfs, beforeCounts, afterCounts, applyResult, Date.now() - startedAt), "utf8");
  await writeFile(options.csvPath, buildCsv(pdfs), "utf8");

  console.log(
    JSON.stringify(
      {
        mode: options.apply ? "apply" : "dry-run",
        scannedPdfs: pdfs.length,
        create: pdfs.filter((pdf) => pdf.action === "create").length,
        update: pdfs.filter((pdf) => pdf.action === "update").length,
        unchanged: pdfs.filter((pdf) => pdf.action === "unchanged").length,
        reportPath: options.reportPath,
        csvPath: options.csvPath,
        backupPath: applyResult?.backupPath ?? null,
      },
      null,
      2,
    ),
  );
}

function parseArgs(args: string[]): ScriptOptions {
  const options: ScriptOptions = {
    apply: false,
    reportPath: REPORT_PATH,
    csvPath: CSV_PATH,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--apply") {
      options.apply = true;
    } else if (arg === "--report") {
      options.reportPath = args[index + 1] ?? options.reportPath;
      index += 1;
    } else if (arg === "--csv") {
      options.csvPath = args[index + 1] ?? options.csvPath;
      index += 1;
    }
  }

  return options;
}

async function loadDbCounts() {
  const [allFiles, pdfFiles, pdfSourceRootFiles, products, offers] = await Promise.all([
    prisma.file.count({ where: { volumeName: VOLUME_NAME } }),
    prisma.file.count({ where: { volumeName: VOLUME_NAME, fileType: "pdf" } }),
    prisma.file.count({
      where: {
        volumeName: VOLUME_NAME,
        fileType: "pdf",
        absolutePathSnapshot: { startsWith: ROOT },
      },
    }),
    prisma.product.count(),
    prisma.supplierOffer.count(),
  ]);

  return {
    allFiles,
    pdfFiles,
    pdfSourceRootFiles,
    products,
    offers,
  };
}

async function loadExistingPdfFiles(): Promise<{
  byRelativePath: Map<string, { id: string; relativePath: string; absolutePath: string; fileSize: bigint; modifiedAt: Date }>;
  byAbsolutePath: Map<string, { id: string; relativePath: string; absolutePath: string; fileSize: bigint; modifiedAt: Date }>;
}> {
  const files = await prisma.file.findMany({
    where: {
      volumeName: VOLUME_NAME,
      fileType: "pdf",
    },
    select: {
      id: true,
      relativePath: true,
      absolutePathSnapshot: true,
      fileSize: true,
      modifiedAt: true,
    },
  });

  const records = files.map((file) => ({
    id: file.id,
    relativePath: normalizePath(file.relativePath),
    absolutePath: normalizePath(file.absolutePathSnapshot),
    fileSize: BigInt(file.fileSize),
    modifiedAt: file.modifiedAt,
  }));

  return {
    byRelativePath: new Map(records.map((record) => [record.relativePath, record])),
    byAbsolutePath: new Map(records.map((record) => [record.absolutePath, record])),
  };
}

async function scanPdfs(
  root: string,
  existingFiles: Awaited<ReturnType<typeof loadExistingPdfFiles>>,
): Promise<PdfRecord[]> {
  const pdfs: PdfRecord[] = [];
  await walk(root);
  return pdfs.sort((left, right) => left.relativePath.localeCompare(right.relativePath, "zh-Hans-CN"));

  async function walk(currentPath: string) {
    const entries = await readdir(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const name = entry.name.normalize("NFC");
      if (name.startsWith(".") || name.startsWith("~$")) {
        continue;
      }

      const absolutePath = path.join(currentPath, entry.name);
      if (entry.isSymbolicLink()) {
        continue;
      }
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      if (!entry.isFile() || path.extname(name).toLowerCase() !== ".pdf") {
        continue;
      }

      const fileStat = await stat(absolutePath);
      const relativePath = normalizePath(path.relative(root, absolutePath));
      const normalizedAbsolutePath = normalizePath(absolutePath);
      const existing =
        existingFiles.byRelativePath.get(relativePath) ?? existingFiles.byAbsolutePath.get(normalizedAbsolutePath);
      const context = inferContext(relativePath, name);
      const classified = classifyPdf(relativePath, name);
      const fileSize = BigInt(fileStat.size);
      const action =
        existing == null
          ? "create"
          : existing.relativePath !== relativePath ||
              existing.absolutePath !== normalizedAbsolutePath ||
              existing.fileSize !== fileSize ||
              existing.modifiedAt.getTime() !== fileStat.mtime.getTime()
            ? "update"
            : "unchanged";

      pdfs.push({
        absolutePath,
        relativePath,
        fileName: name,
        fileSize,
        modifiedAt: fileStat.mtime,
        folderName: path.basename(path.dirname(absolutePath)) || null,
        major: context.major,
        pathCategory: context.pathCategory,
        category: context.category,
        factory: context.factory,
        kind: classified.kind,
        reason: classified.reason,
        existingFileId: existing?.id ?? null,
        existingRelativePath: existing?.relativePath ?? null,
        action,
      });
    }
  }
}

async function applyPdfRecords(pdfs: PdfRecord[]): Promise<ApplyResult> {
  const backupPath = await backupDatabase();
  let created = 0;
  let updated = 0;
  let unchanged = 0;
  const scannedAt = new Date();

  for (const pdf of pdfs) {
    if (pdf.action === "unchanged") {
      unchanged += 1;
      continue;
    }

    if (pdf.existingFileId) {
      await prisma.file.update({
        where: { id: pdf.existingFileId },
        data: {
          fileName: pdf.fileName,
          fileType: "pdf",
          fileSize: pdf.fileSize,
          folderName: pdf.folderName,
          factoryGuess: pdf.factory,
          relativePath: pdf.relativePath,
          absolutePathSnapshot: pdf.absolutePath,
          modifiedAt: pdf.modifiedAt,
          scannedAt,
        },
      });
    } else {
      await prisma.file.create({
        data: {
          fileName: pdf.fileName,
          fileType: "pdf",
          fileSize: pdf.fileSize,
          folderName: pdf.folderName,
          factoryGuess: pdf.factory,
          volumeName: VOLUME_NAME,
          relativePath: pdf.relativePath,
          absolutePathSnapshot: pdf.absolutePath,
          modifiedAt: pdf.modifiedAt,
          scannedAt,
        },
      });
    }

    if (pdf.action === "create") {
      created += 1;
    } else {
      updated += 1;
    }
  }

  return {
    backupPath,
    created,
    updated,
    unchanged,
  };
}

async function backupDatabase(): Promise<string | null> {
  const source = "prisma/dev.db";
  if (!existsSync(source)) {
    return null;
  }
  await mkdir("backups", { recursive: true });
  const backupPath = `backups/dev-before-v2.20-pdf-${timestampForFile(new Date())}.sqlite`;
  await copyFile(source, backupPath);
  return backupPath;
}

function inferContext(relativePath: string, fileName: string): {
  major: string;
  pathCategory: string;
  category: string;
  factory: string | null;
} {
  const parts = relativePath.split("/").map((part) => part.trim());
  const major = parts[0] ?? "(root)";
  const pathCategory = parts[1] ?? "(root)";
  const factory = parts[2] ?? null;
  const text = normalizeText(`${relativePath} ${fileName}`);
  let category = pathCategory;

  if (major === "灯带") {
    if (/连接器|connector/i.test(text)) category = "灯带连接器";
    else if (/控制器|controller/i.test(text)) category = "灯带控制器";
    else category = "灯带";
  } else if (major === "光源") {
    if (/应急/.test(text)) category = "应急灯";
    else if (/灯管|tube|t8|t5/i.test(text)) category = "灯管";
    else if (/灯丝|filament/i.test(text)) category = "灯丝灯";
    else if (/球泡|bulb|g45|g95|a60|c35/i.test(text)) category = "球泡";
  } else if (major === "室内照明") {
    if (pathCategory === "大面板" || pathCategory === "小面板灯") category = "面板灯";
    else if (pathCategory === "线条灯办公灯") category = "线条灯";
    else if (/面板|panel/i.test(text)) category = "面板灯";
    else if (/线条|办公灯|linear|batten/i.test(text)) category = "线条灯";
  } else if (major === "户外照明 工业照明") {
    if (pathCategory === "LED 地埋灯地插灯") category = "地埋灯/地插灯";
    else if (pathCategory === "太阳能壁灯草坪灯地插灯") {
      if (/壁灯|wall/i.test(text)) category = "太阳能壁灯";
      else if (/草坪|lawn/i.test(text)) category = "草坪灯";
      else if (/地插|地埋|spike|inground/i.test(text)) category = "地插灯/太阳能壁灯";
      else category = "太阳能";
    } else if (pathCategory === "户外工厂") {
      category = inferOutdoorMixedCategory(text);
    }
  }

  return {
    major,
    pathCategory,
    category,
    factory,
  };
}

function inferOutdoorMixedCategory(text: string): string {
  if (/庭院灯|garden/i.test(text)) return "庭院灯";
  if (/投光灯|flood|泛光/i.test(text)) return "投光灯";
  if (/工矿|highbay|ufo/i.test(text)) return "Highbay";
  if (/路灯|street|\bsl\b/i.test(text)) return "路灯";
  if (/工作灯|working|work light/i.test(text)) return "工作灯";
  if (/充电灯|rechargeable|portable/i.test(text)) return "充电灯";
  if (/壁灯|wall/i.test(text)) return "太阳能壁灯";
  return "户外工厂-未判定";
}

function classifyPdf(relativePath: string, fileName: string): { kind: PdfKind; reason: string } {
  const text = normalizeText(`${relativePath} ${fileName}`);
  if (/报价|报价单|报价表|价目|价格|quotation|quote|price\s*list|pricelist|\bprice\b|\boffer\b|核价/i.test(text)) {
    return { kind: "quotation", reason: "文件名/路径含报价或价格关键词" };
  }
  if (/画册|目录|产品册|catalogue|catalog|brochure|e-?catalog/i.test(text)) {
    return { kind: "catalog", reason: "文件名/路径含目录或画册关键词" };
  }
  if (/规格|参数|spec|datasheet|data\s*sheet|产品知识|knowledge/i.test(text)) {
    return { kind: "spec", reason: "文件名/路径含规格或参数关键词" };
  }
  if (/证书|认证|检测|测试|报告|inspection|test\s*report|report|cert|certificate|rohs|ce|emc|lvd|cb|etl|saa/i.test(text)) {
    return { kind: "certificate-report", reason: "文件名/路径含证书、检测或报告关键词" };
  }
  if (/包装|彩盒|外箱|箱唛|唛头|packing|package|carton|image|photo|图片|照片/i.test(text)) {
    return { kind: "packaging-image", reason: "文件名/路径含包装或图片关键词" };
  }
  if (/说明书|安装|manual|instruction|user\s*guide|install/i.test(text)) {
    return { kind: "manual", reason: "文件名/路径含说明书或安装关键词" };
  }
  return { kind: "other", reason: "文件名/路径未命中明确分类关键词" };
}

function buildMarkdownReport(
  pdfs: PdfRecord[],
  beforeCounts: Awaited<ReturnType<typeof loadDbCounts>>,
  afterCounts: Awaited<ReturnType<typeof loadDbCounts>>,
  applyResult: ApplyResult | null,
  durationMs: number,
): string {
  const lines: string[] = [];
  const created = pdfs.filter((pdf) => pdf.action === "create");
  const updated = pdfs.filter((pdf) => pdf.action === "update");
  const quotation = pdfs.filter((pdf) => pdf.kind === "quotation");

  lines.push("# V2.20 — PDF 文件盘点 + 入库索引");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Mode: ${applyResult ? "apply" : "dry-run"}`);
  lines.push(`Root: ${ROOT}`);
  lines.push(`Duration: ${(durationMs / 1000).toFixed(1)}s`);
  lines.push("");
  lines.push("## Scope");
  lines.push("");
  lines.push("- 只扫描 `各家工厂最新报价汇总/`。");
  lines.push("- 只处理真实 `.pdf` 文件，跳过 macOS `._*.pdf` 和隐藏文件。");
  lines.push("- 写入范围仅限 `files` 表；不解析 PDF 内容，不写 products / supplier_offers / product_params。");
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push("| Metric | Count |");
  lines.push("|---|---:|");
  lines.push(`| Disk PDF files scanned | ${pdfs.length} |`);
  lines.push(`| New files to create | ${created.length} |`);
  lines.push(`| Existing files to update | ${updated.length} |`);
  lines.push(`| Existing unchanged | ${pdfs.filter((pdf) => pdf.action === "unchanged").length} |`);
  lines.push(`| Quotation-like PDF candidates | ${quotation.length} |`);
  lines.push(`| DB files before → after | ${beforeCounts.allFiles} → ${afterCounts.allFiles} |`);
  lines.push(`| DB PDF files before → after | ${beforeCounts.pdfFiles} → ${afterCounts.pdfFiles} |`);
  lines.push(`| Source-root PDF files before → after | ${beforeCounts.pdfSourceRootFiles} → ${afterCounts.pdfSourceRootFiles} |`);
  lines.push(`| Products before → after | ${beforeCounts.products} → ${afterCounts.products} |`);
  lines.push(`| Supplier offers before → after | ${beforeCounts.offers} → ${afterCounts.offers} |`);
  if (applyResult?.backupPath) {
    lines.push(`| DB backup | ${escapeMd(applyResult.backupPath)} |`);
  }
  lines.push("");
  lines.push("## By Major Folder");
  lines.push("");
  lines.push("| Major | PDFs | Create | Update | Quotation-like | Catalog | Spec | Certificate/Report | Packaging/Image | Manual | Other |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const row of groupedMajorRows(pdfs)) {
    lines.push(
      `| ${escapeMd(row.major)} | ${row.total} | ${row.create} | ${row.update} | ${row.quotation} | ${row.catalog} | ${row.spec} | ${row.certificateReport} | ${row.packagingImage} | ${row.manual} | ${row.other} |`,
    );
  }
  lines.push("");
  lines.push("## By Category");
  lines.push("");
  lines.push("| Category | PDFs | Create | Update | Quotation-like | Catalog | Spec | Certificate/Report | Packaging/Image | Manual | Other |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const row of groupedCategoryRows(pdfs)) {
    lines.push(
      `| ${escapeMd(row.category)} | ${row.total} | ${row.create} | ${row.update} | ${row.quotation} | ${row.catalog} | ${row.spec} | ${row.certificateReport} | ${row.packagingImage} | ${row.manual} | ${row.other} |`,
    );
  }
  lines.push("");
  lines.push("## V2.21 Spike Candidates");
  lines.push("");
  lines.push("优先看这些疑似报价 PDF，判断是否为文本 PDF、是否有表格价格、是否能不用 OCR 解析。");
  lines.push("");
  lines.push("| # | Category | Factory | Kind | Size | Path | Reason |");
  lines.push("|---:|---|---|---|---:|---|---|");
  for (const [index, pdf] of quotation.slice(0, 40).entries()) {
    lines.push(
      `| ${index + 1} | ${escapeMd(pdf.category)} | ${escapeMd(pdf.factory ?? "-")} | ${pdf.kind} | ${formatBytes(pdf.fileSize)} | ${escapeMd(pdf.relativePath)} | ${escapeMd(pdf.reason)} |`,
    );
  }
  lines.push("");
  lines.push("## Full PDF Inventory");
  lines.push("");
  lines.push("完整 CSV: `docs/v2.20-pdf-inventory.csv`");
  lines.push("");
  lines.push("| Path | Category | Factory | Kind | Action | Size | Modified | Reason |");
  lines.push("|---|---|---|---|---|---:|---|---|");
  for (const pdf of pdfs) {
    lines.push(
      `| ${escapeMd(pdf.relativePath)} | ${escapeMd(pdf.category)} | ${escapeMd(pdf.factory ?? "-")} | ${pdf.kind} | ${pdf.action} | ${formatBytes(pdf.fileSize)} | ${formatDate(pdf.modifiedAt)} | ${escapeMd(pdf.reason)} |`,
    );
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function groupedMajorRows(pdfs: PdfRecord[]) {
  return groupRows(pdfs, (pdf) => pdf.major).map((row) => ({ major: row.key, ...row }));
}

function groupedCategoryRows(pdfs: PdfRecord[]) {
  return groupRows(pdfs, (pdf) => pdf.category).map((row) => ({ category: row.key, ...row }));
}

function groupRows(pdfs: PdfRecord[], keyFn: (pdf: PdfRecord) => string) {
  const groups = new Map<string, PdfRecord[]>();
  for (const pdf of pdfs) {
    const key = keyFn(pdf);
    groups.set(key, [...(groups.get(key) ?? []), pdf]);
  }
  return Array.from(groups.entries())
    .map(([key, items]) => ({
      key,
      total: items.length,
      create: items.filter((item) => item.action === "create").length,
      update: items.filter((item) => item.action === "update").length,
      quotation: items.filter((item) => item.kind === "quotation").length,
      catalog: items.filter((item) => item.kind === "catalog").length,
      spec: items.filter((item) => item.kind === "spec").length,
      certificateReport: items.filter((item) => item.kind === "certificate-report").length,
      packagingImage: items.filter((item) => item.kind === "packaging-image").length,
      manual: items.filter((item) => item.kind === "manual").length,
      other: items.filter((item) => item.kind === "other").length,
    }))
    .sort((left, right) => right.total - left.total || left.key.localeCompare(right.key, "zh-Hans-CN"));
}

function buildCsv(pdfs: PdfRecord[]): string {
  const rows = [
    [
      "relative_path",
      "major",
      "path_category",
      "category",
      "factory",
      "kind",
      "action",
      "file_size",
      "modified_at",
      "reason",
      "absolute_path",
    ],
    ...pdfs.map((pdf) => [
      pdf.relativePath,
      pdf.major,
      pdf.pathCategory,
      pdf.category,
      pdf.factory ?? "",
      pdf.kind,
      pdf.action,
      pdf.fileSize.toString(),
      pdf.modifiedAt.toISOString(),
      pdf.reason,
      pdf.absolutePath,
    ]),
  ];
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}

function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function normalizePath(value: string): string {
  return value.normalize("NFC").split(path.sep).join("/");
}

function normalizeText(value: string): string {
  return value.normalize("NFC").replace(/\s+/g, " ").trim();
}

function formatBytes(value: bigint): string {
  const number = Number(value);
  if (number < 1024) return `${number} B`;
  if (number < 1024 * 1024) return `${(number / 1024).toFixed(1)} KB`;
  return `${(number / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function timestampForFile(value: Date): string {
  return value.toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
}

function escapeMd(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
