import { existsSync } from "node:fs";
import { readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const REPORT_PATH = path.join("docs", "v7.0a-drive-audit.md");
const EXTERNAL_VOLUME = "My Passport";
const IMAGE_DIR = path.join("data", "images");

type CountSizeRow = {
  label: string | null;
  count: number | bigint;
  bytes: number | bigint | null;
};

type FileTypeVolumeRow = {
  file_type: string;
  volume_name: string;
  count: number | bigint;
  bytes: number | bigint | null;
};

type RuntimeHit = {
  file: string;
  line: number;
  category: "path-field" | "db-file-read" | "source-file-id";
  snippet: string;
};

type ImageStats = {
  products: number;
  withImage: number;
  localImages: number;
  externalImages: number;
  otherImages: number;
  imageDirExists: boolean;
  imageFileCount: number;
};

type FkStats = {
  supplierOfferRefs: number;
  supplierOffersNullSource: number;
  priceHistoryOldRefs: number;
  priceHistoryNewRefs: number;
  rawProductRefs: number;
  orphanFileCount: number;
  orphanFileBytes: number;
  orphanSamples: Array<{ file_name: string; relative_path: string; file_type: string; bytes: number }>;
  fkReferencedFileCount: number;
  fkReferencedFileBytes: number;
  migrationFileCount: number;
  migrationFileBytes: number;
};

async function main() {
  const beforeCounts = await getDbCounts();
  const volumeRows = await getVolumeRows();
  const typeVolumeRows = await getTypeVolumeRows();
  const topDirectoryRows = await getTopDirectoryRows();
  const fkStats = await getFkStats();
  const runtimeHits = await scanRuntimeDependencies(path.join(process.cwd(), "src"));
  const imageStats = await getImageStats();
  const customerQuoteStats = await getCustomerQuotePathStats();
  const afterCounts = await getDbCounts();
  const dbUnchanged = JSON.stringify(beforeCounts) === JSON.stringify(afterCounts);

  const report = buildReport({
    volumeRows,
    typeVolumeRows,
    topDirectoryRows,
    fkStats,
    runtimeHits,
    imageStats,
    customerQuoteStats,
    dbUnchanged,
  });

  await writeFile(REPORT_PATH, report, "utf8");

  console.log(
    JSON.stringify(
      {
        reportPath: REPORT_PATH,
        dbUnchanged,
        migrationFiles: fkStats.migrationFileCount,
        migrationSizeMb: roundMb(fkStats.migrationFileBytes),
        orphanFiles: fkStats.orphanFileCount,
        runtimeHits: runtimeHits.length,
        externalImages: imageStats.externalImages,
      },
      null,
      2,
    ),
  );
}

async function getDbCounts(): Promise<Record<string, number>> {
  const rows = await prisma.$queryRaw<Array<{ table_name: string; cnt: number | bigint }>>`
    SELECT 'files' AS table_name, COUNT(*) AS cnt FROM files
    UNION ALL SELECT 'supplier_offers', COUNT(*) FROM supplier_offers
    UNION ALL SELECT 'price_history', COUNT(*) FROM price_history
    UNION ALL SELECT 'raw_products', COUNT(*) FROM raw_products
    UNION ALL SELECT 'products', COUNT(*) FROM products
    UNION ALL SELECT 'customer_quote_files', COUNT(*) FROM customer_quote_files
  `;

  return Object.fromEntries(rows.map((row) => [row.table_name, toNumber(row.cnt)]));
}

async function getVolumeRows(): Promise<CountSizeRow[]> {
  return prisma.$queryRaw<CountSizeRow[]>`
    SELECT volume_name AS label, COUNT(*) AS count, COALESCE(SUM(file_size), 0) AS bytes
    FROM files
    GROUP BY volume_name
    ORDER BY COUNT(*) DESC, volume_name
  `;
}

async function getTypeVolumeRows(): Promise<FileTypeVolumeRow[]> {
  return prisma.$queryRaw<FileTypeVolumeRow[]>`
    SELECT file_type, volume_name, COUNT(*) AS count, COALESCE(SUM(file_size), 0) AS bytes
    FROM files
    GROUP BY file_type, volume_name
    ORDER BY file_type, volume_name
  `;
}

async function getTopDirectoryRows(): Promise<CountSizeRow[]> {
  return prisma.$queryRaw<CountSizeRow[]>`
    SELECT
      CASE
        WHEN relative_path IS NULL OR TRIM(relative_path) = '' THEN '(empty)'
        WHEN instr(relative_path, '/') > 0 THEN substr(relative_path, 1, instr(relative_path, '/') - 1)
        ELSE '(root)'
      END AS label,
      COUNT(*) AS count,
      COALESCE(SUM(file_size), 0) AS bytes
    FROM files
    WHERE volume_name = ${EXTERNAL_VOLUME}
    GROUP BY label
    ORDER BY COUNT(*) DESC, label
  `;
}

async function getFkStats(): Promise<FkStats> {
  const [supplierOfferRefs] = await prisma.$queryRaw<Array<{ cnt: number | bigint }>>`
    SELECT COUNT(*) AS cnt
    FROM supplier_offers so
    JOIN files f ON f.id = so.source_file_id
    WHERE f.volume_name = ${EXTERNAL_VOLUME}
  `;
  const [supplierOffersNullSource] = await prisma.$queryRaw<Array<{ cnt: number | bigint }>>`
    SELECT COUNT(*) AS cnt
    FROM supplier_offers
    WHERE source_file_id IS NULL
  `;
  const [priceHistoryOldRefs] = await prisma.$queryRaw<Array<{ cnt: number | bigint }>>`
    SELECT COUNT(*) AS cnt
    FROM price_history ph
    JOIN files f ON f.id = ph.old_source_file_id
    WHERE f.volume_name = ${EXTERNAL_VOLUME}
  `;
  const [priceHistoryNewRefs] = await prisma.$queryRaw<Array<{ cnt: number | bigint }>>`
    SELECT COUNT(*) AS cnt
    FROM price_history ph
    JOIN files f ON f.id = ph.new_source_file_id
    WHERE f.volume_name = ${EXTERNAL_VOLUME}
  `;
  const [rawProductRefs] = await prisma.$queryRaw<Array<{ cnt: number | bigint }>>`
    SELECT COUNT(*) AS cnt
    FROM raw_products rp
    JOIN files f ON f.id = rp.source_file_id
    WHERE f.volume_name = ${EXTERNAL_VOLUME}
  `;

  const [orphanSummary] = await prisma.$queryRaw<Array<{ cnt: number | bigint; bytes: number | bigint | null }>>`
    SELECT COUNT(*) AS cnt, COALESCE(SUM(file_size), 0) AS bytes
    FROM files f
    WHERE f.volume_name = ${EXTERNAL_VOLUME}
      AND NOT EXISTS (SELECT 1 FROM supplier_offers so WHERE so.source_file_id = f.id)
      AND NOT EXISTS (SELECT 1 FROM price_history ph WHERE ph.old_source_file_id = f.id)
      AND NOT EXISTS (SELECT 1 FROM price_history ph WHERE ph.new_source_file_id = f.id)
      AND NOT EXISTS (SELECT 1 FROM raw_products rp WHERE rp.source_file_id = f.id)
  `;

  const orphanSamples = await prisma.$queryRaw<
    Array<{ file_name: string; relative_path: string; file_type: string; bytes: number | bigint }>
  >`
    SELECT file_name, relative_path, file_type, file_size AS bytes
    FROM files f
    WHERE f.volume_name = ${EXTERNAL_VOLUME}
      AND NOT EXISTS (SELECT 1 FROM supplier_offers so WHERE so.source_file_id = f.id)
      AND NOT EXISTS (SELECT 1 FROM price_history ph WHERE ph.old_source_file_id = f.id)
      AND NOT EXISTS (SELECT 1 FROM price_history ph WHERE ph.new_source_file_id = f.id)
      AND NOT EXISTS (SELECT 1 FROM raw_products rp WHERE rp.source_file_id = f.id)
    ORDER BY file_type, file_size DESC, relative_path
    LIMIT 50
  `;

  const [fkReferencedSummary] = await prisma.$queryRaw<Array<{ cnt: number | bigint; bytes: number | bigint | null }>>`
    SELECT COUNT(*) AS cnt, COALESCE(SUM(file_size), 0) AS bytes
    FROM files f
    WHERE f.volume_name = ${EXTERNAL_VOLUME}
      AND (
        EXISTS (SELECT 1 FROM supplier_offers so WHERE so.source_file_id = f.id)
        OR EXISTS (SELECT 1 FROM price_history ph WHERE ph.old_source_file_id = f.id)
        OR EXISTS (SELECT 1 FROM price_history ph WHERE ph.new_source_file_id = f.id)
        OR EXISTS (SELECT 1 FROM raw_products rp WHERE rp.source_file_id = f.id)
      )
  `;

  const [migrationSummary] = await prisma.$queryRaw<Array<{ cnt: number | bigint; bytes: number | bigint | null }>>`
    SELECT COUNT(*) AS cnt, COALESCE(SUM(file_size), 0) AS bytes
    FROM files f
    WHERE f.volume_name = ${EXTERNAL_VOLUME}
      AND (
        EXISTS (SELECT 1 FROM supplier_offers so WHERE so.source_file_id = f.id)
        OR EXISTS (SELECT 1 FROM price_history ph WHERE ph.old_source_file_id = f.id)
        OR EXISTS (SELECT 1 FROM price_history ph WHERE ph.new_source_file_id = f.id)
      )
  `;

  return {
    supplierOfferRefs: toNumber(supplierOfferRefs.cnt),
    supplierOffersNullSource: toNumber(supplierOffersNullSource.cnt),
    priceHistoryOldRefs: toNumber(priceHistoryOldRefs.cnt),
    priceHistoryNewRefs: toNumber(priceHistoryNewRefs.cnt),
    rawProductRefs: toNumber(rawProductRefs.cnt),
    orphanFileCount: toNumber(orphanSummary.cnt),
    orphanFileBytes: toNumber(orphanSummary.bytes),
    orphanSamples: orphanSamples.map((row) => ({
      file_name: row.file_name,
      relative_path: row.relative_path,
      file_type: row.file_type,
      bytes: toNumber(row.bytes),
    })),
    fkReferencedFileCount: toNumber(fkReferencedSummary.cnt),
    fkReferencedFileBytes: toNumber(fkReferencedSummary.bytes),
    migrationFileCount: toNumber(migrationSummary.cnt),
    migrationFileBytes: toNumber(migrationSummary.bytes),
  };
}

async function scanRuntimeDependencies(srcDir: string): Promise<RuntimeHit[]> {
  const files = await listSourceFiles(srcDir);
  const hits: RuntimeHit[] = [];
  const patterns: Array<{ category: RuntimeHit["category"]; regex: RegExp }> = [
    {
      category: "path-field",
      regex: /\b(relativePath|relative_path|absolutePathSnapshot|absolute_path_snapshot|volumeName|volume_name|resolveFilePath)\b/,
    },
    { category: "db-file-read", regex: /\b(readFile|readFileSync|createReadStream)\b/ },
    { category: "source-file-id", regex: /\b(sourceFileId|source_file_id)\b/ },
  ];

  for (const file of files) {
    const content = await import("node:fs/promises").then((fs) => fs.readFile(file, "utf8"));
    const lines = content.split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const pattern of patterns) {
        if (pattern.regex.test(line)) {
          hits.push({
            file: path.relative(process.cwd(), file),
            line: index + 1,
            category: pattern.category,
            snippet: line.trim().slice(0, 180),
          });
        }
      }
    });
  }

  return hits.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.category.localeCompare(b.category));
}

async function listSourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) {
      continue;
    }

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listSourceFiles(fullPath)));
    } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

async function getImageStats(): Promise<ImageStats> {
  const [summary] = await prisma.$queryRaw<
    Array<{
      products: number | bigint;
      with_image: number | bigint;
      local_images: number | bigint;
      external_images: number | bigint;
      other_images: number | bigint;
    }>
  >`
    SELECT
      COUNT(*) AS products,
      SUM(CASE WHEN image_path IS NOT NULL AND TRIM(image_path) <> '' THEN 1 ELSE 0 END) AS with_image,
      SUM(CASE WHEN image_path LIKE 'data/images/%' THEN 1 ELSE 0 END) AS local_images,
      SUM(CASE WHEN image_path LIKE '/Volumes/%' OR image_path LIKE '%My Passport%' THEN 1 ELSE 0 END) AS external_images,
      SUM(CASE
        WHEN image_path IS NOT NULL
          AND TRIM(image_path) <> ''
          AND image_path NOT LIKE 'data/images/%'
          AND image_path NOT LIKE '/Volumes/%'
          AND image_path NOT LIKE '%My Passport%'
        THEN 1 ELSE 0 END
      ) AS other_images
    FROM products
  `;

  return {
    products: toNumber(summary.products),
    withImage: toNumber(summary.with_image),
    localImages: toNumber(summary.local_images),
    externalImages: toNumber(summary.external_images),
    otherImages: toNumber(summary.other_images),
    imageDirExists: existsSync(IMAGE_DIR),
    imageFileCount: existsSync(IMAGE_DIR) ? await countFiles(IMAGE_DIR) : 0,
  };
}

async function countFiles(dir: string): Promise<number> {
  const entries = await readdir(dir, { withFileTypes: true });
  let total = 0;

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += await countFiles(fullPath);
    } else if (entry.isFile()) {
      total += 1;
    }
  }

  return total;
}

async function getCustomerQuotePathStats() {
  const [summary] = await prisma.$queryRaw<
    Array<{
      total: number | bigint;
      with_relative_path: number | bigint;
      external_like: number | bigint;
      my_passport_like: number | bigint;
    }>
  >`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN relative_path IS NOT NULL AND TRIM(relative_path) <> '' THEN 1 ELSE 0 END) AS with_relative_path,
      SUM(CASE WHEN relative_path LIKE '/Volumes/%' THEN 1 ELSE 0 END) AS external_like,
      SUM(CASE WHEN relative_path LIKE '%My Passport%' THEN 1 ELSE 0 END) AS my_passport_like
    FROM customer_quote_files
  `;

  return {
    total: toNumber(summary.total),
    withRelativePath: toNumber(summary.with_relative_path),
    externalLike: toNumber(summary.external_like),
    myPassportLike: toNumber(summary.my_passport_like),
  };
}

function buildReport(input: {
  volumeRows: CountSizeRow[];
  typeVolumeRows: FileTypeVolumeRow[];
  topDirectoryRows: CountSizeRow[];
  fkStats: FkStats;
  runtimeHits: RuntimeHit[];
  imageStats: ImageStats;
  customerQuoteStats: Awaited<ReturnType<typeof getCustomerQuotePathStats>>;
  dbUnchanged: boolean;
}) {
  const externalVolume = input.volumeRows.find((row) => row.label === EXTERNAL_VOLUME);
  const externalBytes = toNumber(externalVolume?.bytes);
  const runtimeByCategory = groupCount(input.runtimeHits, (hit) => hit.category);

  return `# V7.0A — 硬盘依赖审计

Generated: ${new Date().toISOString()}

## 1. 依赖概览

### files by volume

| Volume | Files | Size |
|---|---:|---:|
${input.volumeRows.map((row) => `| ${escapeMd(row.label ?? "(null)")} | ${toNumber(row.count).toLocaleString()} | ${formatBytes(toNumber(row.bytes))} |`).join("\n")}

外置硬盘 \`${EXTERNAL_VOLUME}\` 文件总大小：${formatBytes(externalBytes)}

### file_type × volume

| File Type | Volume | Files | Size |
|---|---|---:|---:|
${input.typeVolumeRows.map((row) => `| ${escapeMd(row.file_type)} | ${escapeMd(row.volume_name)} | ${toNumber(row.count).toLocaleString()} | ${formatBytes(toNumber(row.bytes))} |`).join("\n")}

### My Passport 顶层目录分布

| Top Directory | Files | Size |
|---|---:|---:|
${input.topDirectoryRows.map((row) => `| ${escapeMd(row.label ?? "(null)")} | ${toNumber(row.count).toLocaleString()} | ${formatBytes(toNumber(row.bytes))} |`).join("\n")}

## 2. FK 依赖

| Dependency | Count |
|---|---:|
| supplier_offers.source_file_id → My Passport files | ${input.fkStats.supplierOfferRefs.toLocaleString()} offers |
| supplier_offers.source_file_id IS NULL | ${input.fkStats.supplierOffersNullSource.toLocaleString()} offers |
| price_history.old_source_file_id → My Passport files | ${input.fkStats.priceHistoryOldRefs.toLocaleString()} rows |
| price_history.new_source_file_id → My Passport files | ${input.fkStats.priceHistoryNewRefs.toLocaleString()} rows |
| raw_products.source_file_id → My Passport files | ${input.fkStats.rawProductRefs.toLocaleString()} rows |
| My Passport files referenced by any FK | ${input.fkStats.fkReferencedFileCount.toLocaleString()} files / ${formatBytes(input.fkStats.fkReferencedFileBytes)} |
| My Passport files in V7.0B migration scope | ${input.fkStats.migrationFileCount.toLocaleString()} files / ${formatBytes(input.fkStats.migrationFileBytes)} |
| My Passport files with no FK references | ${input.fkStats.orphanFileCount.toLocaleString()} files / ${formatBytes(input.fkStats.orphanFileBytes)} |

### Orphan file samples

| Type | Size | Relative Path |
|---|---:|---|
${input.fkStats.orphanSamples.map((row) => `| ${escapeMd(row.file_type)} | ${formatBytes(row.bytes)} | ${escapeMd(row.relative_path)} |`).join("\n")}

## 3. 运行时依赖

运行时代码命中 ${input.runtimeHits.length} 处：

| Category | Hits |
|---|---:|
${Object.entries(runtimeByCategory).map(([category, count]) => `| ${category} | ${count} |`).join("\n")}

### Code locations

| Category | Location | Snippet |
|---|---|---|
${input.runtimeHits.map((hit) => `| ${hit.category} | \`${escapeMd(hit.file)}:${hit.line}\` | \`${escapeMd(hit.snippet)}\` |`).join("\n")}

### Runtime impact

- 文件扫描、Excel 导入预览、源文件下载/预览仍需要能解析 \`files\` 表路径。
- 报价搜索、产品库、报价导出、历史报价展示主要依赖 SQLite 和本地图片，不需要外置硬盘在线。
- 如果只迁移被报价/价格历史引用的源文件，日常溯源和报价记录追查可以脱离硬盘；继续扫描新供应商文件仍需要硬盘或手动选择本地文件。

## 4. 图片独立性

| Metric | Count |
|---|---:|
| products | ${input.imageStats.products.toLocaleString()} |
| products.image_path not empty | ${input.imageStats.withImage.toLocaleString()} |
| image_path under data/images/ | ${input.imageStats.localImages.toLocaleString()} |
| image_path pointing to My Passport / /Volumes | ${input.imageStats.externalImages.toLocaleString()} |
| other image_path values | ${input.imageStats.otherImages.toLocaleString()} |
| data/images exists | ${input.imageStats.imageDirExists ? "yes" : "no"} |
| data/images file count | ${input.imageStats.imageFileCount.toLocaleString()} |

结论：${input.imageStats.externalImages === 0 && input.imageStats.imageDirExists && input.imageStats.imageFileCount > 0 ? "产品图片已经本地化，断开硬盘不影响图片展示。" : "图片路径仍需检查。"}

## 5. customer_quote_files 依赖

| Metric | Count |
|---|---:|
| customer_quote_files rows | ${input.customerQuoteStats.total.toLocaleString()} |
| rows with relative_path | ${input.customerQuoteStats.withRelativePath.toLocaleString()} |
| relative_path starts with /Volumes/ | ${input.customerQuoteStats.externalLike.toLocaleString()} |
| relative_path contains My Passport | ${input.customerQuoteStats.myPassportLike.toLocaleString()} |

结论：customer_quote_files 使用自己的 relative_path 语义，不参与 V7.0B 的 files 表迁移。

## 6. 迁移规模

| Scope | Files | Size |
|---|---:|---:|
| V7.0B scope: supplier_offers + price_history referenced My Passport files | ${input.fkStats.migrationFileCount.toLocaleString()} | ${formatBytes(input.fkStats.migrationFileBytes)} |
| All FK referenced My Passport files (including raw_products) | ${input.fkStats.fkReferencedFileCount.toLocaleString()} | ${formatBytes(input.fkStats.fkReferencedFileBytes)} |
| Unreferenced My Passport files | ${input.fkStats.orphanFileCount.toLocaleString()} | ${formatBytes(input.fkStats.orphanFileBytes)} |

如果只迁移 V7.0B 范围，需要约 **${formatBytes(input.fkStats.migrationFileBytes)}** 本地空间。建议预留 2 倍空间用于复制过程和备份。

## 7. 建议

1. V7.0B 只迁移被 \`supplier_offers\` / \`price_history\` 引用的 My Passport 文件，避免把 PDF 目录、证书、图片等孤儿文件整体复制到项目里。
2. 迁移后保持 \`relative_path\` 不变，仅把 \`volume_name\` 改为 \`local\`，并把 \`absolute_path_snapshot\` 指向 \`data/source-archive/\`。
3. 不迁移 \`raw_products\` 仅引用的文件，除非后续需要重跑 Phase 4 原始导入链路。
4. \`data/source-archive/\` 必须加入 .gitignore，源文件归档不能入库。

## Verification

- DB unchanged during audit: ${input.dbUnchanged ? "PASS" : "FAIL"}
- Script is read-only: PASS
`;
}

function groupCount<T>(items: T[], keyFn: (item: T) => string): Record<string, number> {
  return items.reduce<Record<string, number>>((acc, item) => {
    const key = keyFn(item);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}

function toNumber(value: number | bigint | null | undefined): number {
  if (value == null) {
    return 0;
  }
  return typeof value === "bigint" ? Number(value) : Number(value);
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`;
}

function roundMb(bytes: number): number {
  return Math.round((bytes / 1024 / 1024) * 100) / 100;
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
