import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { gunzip, gzip } from "node:zlib";

import { PrismaClient } from "@prisma/client";
import type * as ExcelJSNamespace from "exceljs";

import { searchProducts } from "../src/lib/chat-tools";
import { calculateSalePrice, writeQuoteWorkbook, type QuoteWorkbookData } from "../src/lib/quote-export";
import { buildQuoteTableModel, type QuoteTableModel } from "../src/lib/quote-table-model";
import { prisma as appPrisma } from "../src/lib/prisma";

type Status = "PASS" | "FAIL" | "WARN" | "INFO";

type BlockResult = {
  title: string;
  status: Status;
  body: string[];
};

type ExportContext = {
  filePath: string;
  quote: QuoteWorkbookData;
  model: QuoteTableModel;
  dataStartRow: number;
  worksheetName: string;
};

type CountRow = { count: bigint | number | null };

type CategoryStatsRow = {
  category: string;
  product_count: bigint | number;
  offer_count: bigint | number | null;
  image_count: bigint | number | null;
  param_product_count: bigint | number | null;
};

type CategoryProductStatsRow = {
  category: string;
  product_count: bigint | number;
  image_count: bigint | number | null;
};

type CategoryOfferStatsRow = {
  category: string;
  offer_count: bigint | number;
};

type CategoryParamStatsRow = {
  category: string;
  param_product_count: bigint | number;
};

type FlagDistributionRow = {
  price_flag: string;
  count: bigint | number;
};

type FlagSampleRow = {
  product_name: string;
  model_no: string | null;
  category: string | null;
  factory_name: string;
  purchase_price: number | string;
  currency: string;
};

type QuoteCandidateRow = {
  id: string;
};

type SnapshotDiffRow = {
  quote_id: string;
  quote_item_id: string;
  product_name: string;
  model_no: string | null;
  factory_name: string | null;
  quote_purchase_price: string | number;
  current_purchase_price: string | number;
  history_count: bigint | number;
  snapshot_in_history: bigint | number;
};

const prisma = new PrismaClient({ log: ["error"] });
const execFileAsync = promisify(execFile);
const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);
const reportPath = join(process.cwd(), "docs", "v45-beta-prevalidation-report.md");
const highFrequencyCategories = ["筒灯", "面板灯", "投光灯"];
const statusOrder: Status[] = ["PASS", "FAIL", "WARN", "INFO"];
let excelJsModule: typeof ExcelJSNamespace | null = null;

let exportContext: ExportContext | null = null;

async function main() {
  const blocks: BlockResult[] = [];

  blocks.push(await runBlock("1. 数据完整度快照", checkDataCompleteness));
  blocks.push(await runBlock("2. 搜索覆盖验证", checkSearchCoverage));
  blocks.push(await runBlock("3. 价格公式验证", checkPricingFormula));
  blocks.push(await runBlock("4. 报价导出一致性", checkQuoteExportConsistency));
  blocks.push(await runBlock("5. 价格异常分布", checkPriceFlagDistribution));
  blocks.push(await runBlock("6. 备份恢复验证", checkBackupRestore));
  blocks.push(await runBlock("7. 导出文件完整性", checkExportFileIntegrity));
  blocks.push(await runBlock("8. 历史报价快照一致性", checkQuoteSnapshotConsistency));

  await writeReport(blocks);
  await cleanupExportContext();
  await prisma.$disconnect();
  await appPrisma.$disconnect();
}

async function runBlock(title: string, runner: () => Promise<Omit<BlockResult, "title">>): Promise<BlockResult> {
  const startedAt = Date.now();
  console.error(`[V45] START ${title}`);
  try {
    const result = await runner();
    console.error(`[V45] END ${title} ${Date.now() - startedAt}ms ${result.status}`);
    return { title, ...result };
  } catch (error) {
    console.error(`[V45] END ${title} ${Date.now() - startedAt}ms FAIL`);
    return {
      title,
      status: "FAIL",
      body: [`检查块执行失败：${formatError(error)}`],
    };
  }
}

async function checkDataCompleteness(): Promise<Omit<BlockResult, "title">> {
  const [productCount, productsWithOfferCount, productsWithImageCount, productsWithParamsCount] = await Promise.all([
    countSql("SELECT COUNT(*) AS count FROM products"),
    countSql(`
      SELECT COUNT(DISTINCT p.id) AS count
      FROM products p
      JOIN supplier_offers so ON so.product_id = p.id
    `),
    countSql("SELECT COUNT(*) AS count FROM products WHERE image_path IS NOT NULL AND TRIM(image_path) != ''"),
    countSql("SELECT COUNT(DISTINCT product_id) AS count FROM product_params"),
  ]);

  const [productRows, offerRows, paramRows] = await Promise.all([
    prisma.$queryRaw<CategoryProductStatsRow[]>`
    SELECT
      COALESCE(category, '未分类') AS category,
      COUNT(*) AS product_count,
      SUM(CASE WHEN image_path IS NOT NULL AND TRIM(image_path) != '' THEN 1 ELSE 0 END) AS image_count
    FROM products
    GROUP BY COALESCE(category, '未分类')
  `,
    prisma.$queryRaw<CategoryOfferStatsRow[]>`
    SELECT
      COALESCE(p.category, '未分类') AS category,
      COUNT(so.id) AS offer_count
    FROM supplier_offers so
    JOIN products p ON p.id = so.product_id
    GROUP BY COALESCE(p.category, '未分类')
  `,
    prisma.$queryRaw<CategoryParamStatsRow[]>`
    SELECT
      COALESCE(p.category, '未分类') AS category,
      COUNT(DISTINCT pp.product_id) AS param_product_count
    FROM product_params pp
    JOIN products p ON p.id = pp.product_id
    GROUP BY COALESCE(p.category, '未分类')
  `,
  ]);
  const categoryRows = mergeCategoryStats(productRows, offerRows, paramRows);

  const highFrequencyRows = await Promise.all(
    highFrequencyCategories.map(async (category) => {
      const count = await countSql(
        `
          SELECT COUNT(*) AS count
          FROM supplier_offers so
          JOIN products p ON p.id = so.product_id
          WHERE p.category = ?
            AND CAST(so.purchase_price AS REAL) > 0
            AND so.price_flag IS NULL
        `,
        category,
      );
      return { category, count };
    }),
  );
  const status: Status = highFrequencyRows.every((row) => row.count >= 50) ? "PASS" : "WARN";

  return {
    status,
    body: [
      "### 总览",
      table(
        ["指标", "数量"],
        [
          ["产品总数", formatInteger(productCount)],
          ["有 offer 的产品数", formatInteger(productsWithOfferCount)],
          ["有图的产品数", formatInteger(productsWithImageCount)],
          ["有参数的产品数", formatInteger(productsWithParamsCount)],
        ],
      ),
      "",
      "### 高频品类有效 offer",
      table(
        ["品类", "有效 offer 数", "判定"],
        highFrequencyRows.map((row) => [
          row.category,
          formatInteger(row.count),
          row.count >= 50 ? "PASS" : "WARN",
        ]),
      ),
      "",
      "### 按品类统计",
      table(
        ["品类", "产品数", "Offer 数", "有图率", "有参数率"],
        categoryRows.map((row) => {
          const productCountForCategory = toNumber(row.product_count);
          return [
            row.category,
            formatInteger(productCountForCategory),
            formatInteger(row.offer_count),
            formatPercent(safeRate(row.image_count, productCountForCategory)),
            formatPercent(safeRate(row.param_product_count, productCountForCategory)),
          ];
        }),
      ),
    ],
  };
}

async function checkSearchCoverage(): Promise<Omit<BlockResult, "title">> {
  const cases = [
    { label: "筒灯 5-15W", args: { category: "筒灯", min_watts: 5, max_watts: 15, limit: 20 } },
    { label: "面板灯 18-48W", args: { category: "面板灯", min_watts: 18, max_watts: 48, limit: 20 } },
    { label: "投光灯 50-200W", args: { category: "投光灯", min_watts: 50, max_watts: 200, limit: 20 } },
  ];

  const rows = await Promise.all(
    cases.map(async (testCase) => {
      const result = await searchProducts(testCase.args);
      const withOffer = result.products.filter((product) => product.offer_count > 0).length;
      const withImage = result.products.filter((product) => Boolean(product.image_path)).length;
      return {
        label: testCase.label,
        total: result.total,
        returned: result.products.length,
        withOffer,
        withImage,
        status: withOffer >= 5 ? "PASS" : "FAIL",
      };
    }),
  );

  return {
    status: rows.every((row) => row.status === "PASS") ? "PASS" : "FAIL",
    body: [
      table(
        ["搜索条件", "总匹配产品", "返回产品", "返回中有 offer", "返回中有图", "判定"],
        rows.map((row) => [
          row.label,
          formatInteger(row.total),
          formatInteger(row.returned),
          formatInteger(row.withOffer),
          formatInteger(row.withImage),
          row.status,
        ]),
      ),
    ],
  };
}

async function checkPricingFormula(): Promise<Omit<BlockResult, "title">> {
  const cases = [
    {
      label: "RMB 10.00 / 7.2 * 1.20",
      input: { purchasePrice: "10.00", purchaseCurrency: "RMB", saleCurrency: "USD", exchangeRate: "7.2", profitMargin: "0.2" },
      expected: 1.67,
    },
    {
      label: "RMB 50.00 / 7.2 * 1.15",
      input: { purchasePrice: "50.00", purchaseCurrency: "RMB", saleCurrency: "USD", exchangeRate: "7.2", profitMargin: "0.15" },
      expected: 7.99,
    },
    {
      label: "USD 5.00 * 1.20",
      input: { purchasePrice: "5.00", purchaseCurrency: "USD", saleCurrency: "USD", exchangeRate: "1", profitMargin: "0.2" },
      expected: 6.0,
    },
    {
      label: "RMB 0.50 / 7.2 * 1.20",
      input: { purchasePrice: "0.50", purchaseCurrency: "RMB", saleCurrency: "USD", exchangeRate: "7.2", profitMargin: "0.2" },
      expected: 0.08,
    },
  ];

  const rows = cases.map((testCase) => {
    const actual = Number(calculateSalePrice(testCase.input));
    const delta = Math.abs(actual - testCase.expected);
    return {
      label: testCase.label,
      expected: testCase.expected,
      actual,
      delta,
      status: delta <= 0.01 ? "PASS" : "FAIL",
    };
  });

  return {
    status: rows.every((row) => row.status === "PASS") ? "PASS" : "FAIL",
    body: [
      table(
        ["场景", "期望", "实际", "差值", "判定"],
        rows.map((row) => [
          row.label,
          formatMoney(row.expected),
          formatMoney(row.actual),
          row.delta.toFixed(4),
          row.status,
        ]),
      ),
    ],
  };
}

async function checkQuoteExportConsistency(): Promise<Omit<BlockResult, "title">> {
  const quote = await loadQuoteForExport();
  if (!quote) {
    return { status: "FAIL", body: ["未找到至少 3 行、且所有行都有 supplier offer 的历史报价。"] };
  }

  const model = buildQuoteTableModel(quote, { customerMode: true });
  const tempDir = await mkdtemp(join(tmpdir(), "v45-quote-export-"));
  const filePath = join(tempDir, `quote-${quote.id}.xlsx`);
  await writeQuoteWorkbook(quote, filePath, { customerMode: true });

  const workbook = await loadWorkbook(filePath);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new Error("导出的 Excel 没有 worksheet。");
  }

  const dataStartRow = model.templateId === "generic" ? 8 : 2;
  exportContext = {
    filePath,
    quote,
    model,
    dataStartRow,
    worksheetName: worksheet.name,
  };

  const diffs: string[][] = [];
  const modelNoColumn = findColumnIndex(model, "modelNo");
  const salePriceColumn = findColumnIndex(model, "salePrice");
  const productDetailsColumn = findColumnIndex(model, "productDetails");

  model.rows.forEach((row, rowIndex) => {
    const sheetRow = worksheet.getRow(dataStartRow + rowIndex);

    if (modelNoColumn !== null) {
      const expected = normalizeCellValue(row.cells.modelNo);
      const actual = normalizeCellValue(sheetRow.getCell(modelNoColumn).value);
      if (expected !== actual) {
        diffs.push([String(rowIndex + 1), "modelNo", expected, actual]);
      }
    }

    if (productDetailsColumn !== null) {
      const expected = normalizeCellValue(row.cells.productDetails);
      const actual = normalizeCellValue(sheetRow.getCell(productDetailsColumn).value);
      if (expected !== actual) {
        diffs.push([String(rowIndex + 1), "productDetails", truncate(expected, 80), truncate(actual, 80)]);
      }
    }

    if (salePriceColumn !== null) {
      const expected = Number(row.cells.salePrice ?? 0);
      const actual = Number(sheetRow.getCell(salePriceColumn).value ?? 0);
      if (!numbersClose(expected, actual, 0.001)) {
        diffs.push([String(rowIndex + 1), "salePrice", formatMoney(expected), formatMoney(actual)]);
      }
    }
  });

  return {
    status: diffs.length === 0 ? "PASS" : "FAIL",
    body: [
      table(
        ["字段", "值"],
        [
          ["quote_id", quote.id],
          ["客户", quote.customerName],
          ["worksheet", worksheet.name],
          ["template", model.templateId],
          ["行数", String(model.rows.length)],
          ["导出路径", filePath],
        ],
      ),
      diffs.length === 0
        ? "预览模型与导出 Excel 的 modelNo / Product Details（如存在）/ salePrice 均匹配。"
        : [
            "### 差异",
            table(["行", "字段", "预览模型", "Excel"], diffs),
          ].join("\n"),
    ],
  };
}

async function checkPriceFlagDistribution(): Promise<Omit<BlockResult, "title">> {
  const total = await countSql("SELECT COUNT(*) AS count FROM supplier_offers");
  const distribution = await prisma.$queryRaw<FlagDistributionRow[]>`
    SELECT COALESCE(price_flag, 'normal') AS price_flag, COUNT(*) AS count
    FROM supplier_offers
    GROUP BY COALESCE(price_flag, 'normal')
    ORDER BY COUNT(*) DESC
  `;

  const sampleSections: string[] = [];
  for (const flag of ["suspicious_low", "suspicious_high", "outlier_high"]) {
    const samples = await prisma.$queryRawUnsafe<FlagSampleRow[]>(
      `
        SELECT
          p.product_name,
          p.model_no,
          p.category,
          so.factory_name,
          so.purchase_price,
          so.currency
        FROM supplier_offers so
        JOIN products p ON p.id = so.product_id
        WHERE so.price_flag = ?
        ORDER BY CAST(so.purchase_price AS REAL) DESC
        LIMIT 3
      `,
      flag,
    );
    sampleSections.push(
      `### ${flag} 样例`,
      samples.length > 0
        ? table(
            ["产品", "款号", "品类", "工厂", "采购价"],
            samples.map((sample) => [
              sample.product_name,
              sample.model_no ?? "",
              sample.category ?? "",
              sample.factory_name,
              `${sample.purchase_price} ${sample.currency}`,
            ]),
          )
        : "无样例。",
    );
  }

  return {
    status: "INFO",
    body: [
      table(
        ["price_flag", "数量", "占比"],
        distribution.map((row) => {
          const count = toNumber(row.count);
          return [row.price_flag, formatInteger(count), formatPercent(safeRate(count, total))];
        }),
      ),
      "",
      ...sampleSections,
    ],
  };
}

async function checkBackupRestore(): Promise<Omit<BlockResult, "title">> {
  const originalCount = await countSql("SELECT COUNT(*) AS count FROM products");
  const tempDir = await mkdtemp(join(tmpdir(), "v45-backup-"));
  const backupPath = join(tempDir, "dev-backup.db");
  const gzipPath = `${backupPath}.gz`;
  const restoredPath = join(tempDir, "dev-restored.db");

  try {
    await execFileAsync("sqlite3", [join(process.cwd(), "prisma", "dev.db"), `.backup '${backupPath}'`]);
    const backupBuffer = await readFile(backupPath);
    await writeFile(gzipPath, await gzipAsync(backupBuffer));
    const compressedBuffer = await readFile(gzipPath);
    await writeFile(restoredPath, await gunzipAsync(compressedBuffer));

    const restoredCount = await countRestoredProducts(restoredPath);
    return {
      status: restoredCount === originalCount ? "PASS" : "FAIL",
      body: [
        table(
          ["检查", "结果"],
          [
            ["原 DB products", formatInteger(originalCount)],
            ["恢复 DB products", formatInteger(restoredCount)],
            ["临时 gzip 文件大小", formatInteger((await stat(gzipPath)).size)],
          ],
        ),
      ],
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function checkExportFileIntegrity(): Promise<Omit<BlockResult, "title">> {
  if (!exportContext) {
    return { status: "FAIL", body: ["检查块 4 未生成可复用的导出文件。"] };
  }

  const fileStat = await stat(exportContext.filePath);
  const workbook = await loadWorkbook(exportContext.filePath);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    return { status: "FAIL", body: ["导出的 Excel 没有 worksheet。"] };
  }

  const headerRows = exportContext.model.templateId === "generic" ? [6, 7] : [1];
  const headerText = headerRows
    .flatMap((rowNumber) => worksheet.getRow(rowNumber).values as unknown[])
    .map((value) => normalizeCellValue(value))
    .join(" ");
  const hasHeaderKeyword = /产品|Product|Model|Photo|FOB|Unit Price/i.test(headerText);
  const populatedDataRows = countPopulatedRows(worksheet, exportContext.dataStartRow, exportContext.model.rows.length);
  const checks = [
    { label: "文件大小 > 0", pass: fileStat.size > 0, value: formatInteger(fileStat.size) },
    { label: "worksheet 数量 >= 1", pass: workbook.worksheets.length >= 1, value: formatInteger(workbook.worksheets.length) },
    { label: "表头包含产品/报价关键词", pass: hasHeaderKeyword, value: truncate(headerText, 160) },
    {
      label: "数据行数 = quote_items 数",
      pass: populatedDataRows === exportContext.model.rows.length,
      value: `${populatedDataRows} / ${exportContext.model.rows.length}`,
    },
  ];

  return {
    status: checks.every((check) => check.pass) ? "PASS" : "FAIL",
    body: [
      table(
        ["检查", "值", "判定"],
        checks.map((check) => [check.label, check.value, check.pass ? "PASS" : "FAIL"]),
      ),
    ],
  };
}

async function checkQuoteSnapshotConsistency(): Promise<Omit<BlockResult, "title">> {
  const changedRows = await prisma.$queryRaw<SnapshotDiffRow[]>`
    SELECT
      qi.quote_id,
      qi.id AS quote_item_id,
      p.product_name,
      p.model_no,
      so.factory_name,
      qi.purchase_price AS quote_purchase_price,
      so.purchase_price AS current_purchase_price,
      COUNT(ph.id) AS history_count,
      SUM(
        CASE
          WHEN CAST(ph.old_price AS TEXT) = CAST(qi.purchase_price AS TEXT)
            OR CAST(ph.new_price AS TEXT) = CAST(qi.purchase_price AS TEXT)
          THEN 1 ELSE 0
        END
      ) AS snapshot_in_history
    FROM quote_items qi
    JOIN products p ON p.id = qi.product_id
    JOIN supplier_offers so ON so.id = qi.supplier_offer_id
    LEFT JOIN price_history ph ON ph.supplier_offer_id = so.id
    WHERE CAST(qi.purchase_price AS TEXT) != CAST(so.purchase_price AS TEXT)
    GROUP BY qi.id
    ORDER BY qi.quote_id ASC
    LIMIT 10
  `;

  if (changedRows.length === 0) {
    return {
      status: "INFO",
      body: ["无 quote_items.purchase_price 与当前 supplier_offers.purchase_price 不一致的案例，无法验证价格变动后的快照保持。"],
    };
  }

  const unexplainedRows = changedRows.filter((row) => toNumber(row.history_count) === 0);
  const historyMatchedRows = changedRows.filter((row) => toNumber(row.snapshot_in_history) > 0);
  const status: Status =
    unexplainedRows.length > 0 ? "WARN" : historyMatchedRows.length > 0 ? "PASS" : "WARN";

  return {
    status,
    body: [
      table(
        ["quote_id", "产品", "款号", "工厂", "报价快照价", "当前 offer 价", "price_history", "快照在历史中"],
        changedRows.map((row) => [
          row.quote_id,
          row.product_name,
          row.model_no ?? "",
          row.factory_name ?? "",
          String(row.quote_purchase_price),
          String(row.current_purchase_price),
          formatInteger(row.history_count),
          toNumber(row.snapshot_in_history) > 0 ? "是" : "否",
        ]),
      ),
    ],
  };
}

async function loadQuoteForExport(): Promise<QuoteWorkbookData | null> {
  const candidates = await prisma.$queryRaw<QuoteCandidateRow[]>`
    SELECT q.id
    FROM quotes q
    JOIN quote_items qi ON qi.quote_id = q.id
    JOIN products p ON p.id = qi.product_id
    WHERE qi.supplier_offer_id IS NOT NULL
    GROUP BY q.id
    HAVING COUNT(*) >= 3
       AND COUNT(*) = SUM(CASE WHEN qi.supplier_offer_id IS NOT NULL THEN 1 ELSE 0 END)
       AND COUNT(DISTINCT COALESCE(p.category, '')) = 1
    ORDER BY COUNT(*) DESC, q.created_at DESC
    LIMIT 1
  `;
  const quoteId = candidates[0]?.id;
  if (!quoteId) {
    return null;
  }

  const quote = await prisma.quote.findUnique({
    where: { id: quoteId },
    include: {
      items: {
        include: {
          product: {
            include: {
              params: {
                select: {
                  paramKey: true,
                  rawValue: true,
                  normalizedValue: true,
                  unit: true,
                },
              },
            },
          },
          supplierOffer: true,
        },
        orderBy: [{ productId: "asc" }],
      },
    },
  });
  if (!quote || quote.items.length < 3 || quote.items.some((item) => item.supplierOffer === null)) {
    return null;
  }

  return {
    id: quote.id,
    customerName: quote.customerName,
    currency: quote.currency,
    profitMargin: quote.profitMargin,
    exchangeRate: quote.exchangeRate,
    createdAt: quote.createdAt,
    items: quote.items.map((item) => {
      const offer = item.supplierOffer;
      if (!offer) {
        throw new Error("quote item missing supplier offer");
      }
      return {
        productId: item.productId,
        supplierOfferId: offer.id,
        imagePath: item.product.imagePath,
        priceFlag: offer.priceFlag,
        productName: item.product.productName,
        category: item.product.category,
        modelNo: item.product.modelNo,
        factoryName: offer.factoryName,
        purchasePrice: item.purchasePrice,
        purchaseCurrency: item.purchaseCurrency,
        salePrice: item.salePrice,
        quantity: item.quantity,
        moq: offer.moq,
        ctnQty: offer.ctnQty,
        ctnLength: offer.ctnLength,
        ctnWidth: offer.ctnWidth,
        ctnHeight: offer.ctnHeight,
        material: item.product.material,
        size: item.product.size,
        productRemark: item.product.remark,
        productParams: item.product.params,
        remark: item.remark,
      };
    }),
  };
}

async function countSql(sql: string, ...params: Array<string | number>): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<CountRow[]>(sql, ...params);
  return toNumber(rows[0]?.count);
}

function mergeCategoryStats(
  productRows: CategoryProductStatsRow[],
  offerRows: CategoryOfferStatsRow[],
  paramRows: CategoryParamStatsRow[],
): CategoryStatsRow[] {
  const byCategory = new Map<string, CategoryStatsRow>();

  for (const row of productRows) {
    byCategory.set(row.category, {
      category: row.category,
      product_count: row.product_count,
      offer_count: 0,
      image_count: row.image_count,
      param_product_count: 0,
    });
  }

  for (const row of offerRows) {
    const stats = getOrCreateCategoryStats(byCategory, row.category);
    stats.offer_count = row.offer_count;
  }

  for (const row of paramRows) {
    const stats = getOrCreateCategoryStats(byCategory, row.category);
    stats.param_product_count = row.param_product_count;
  }

  return Array.from(byCategory.values()).sort(
    (left, right) =>
      toNumber(right.product_count) - toNumber(left.product_count) || left.category.localeCompare(right.category),
  );
}

function getOrCreateCategoryStats(byCategory: Map<string, CategoryStatsRow>, category: string): CategoryStatsRow {
  const existing = byCategory.get(category);
  if (existing) {
    return existing;
  }
  const created = {
    category,
    product_count: 0,
    offer_count: 0,
    image_count: 0,
    param_product_count: 0,
  };
  byCategory.set(category, created);
  return created;
}

async function countRestoredProducts(dbPath: string): Promise<number> {
  const { stdout } = await execFileAsync("sqlite3", [dbPath, "SELECT COUNT(*) FROM products;"]);
  return Number(stdout.trim());
}

function findColumnIndex(model: QuoteTableModel, key: string): number | null {
  const index = model.columns.findIndex((column) => column.key === key);
  return index >= 0 ? index + 1 : null;
}

function newExcelWorkbook(): ExcelJSNamespace.Workbook {
  // Use the same runtime bundle as quote-export.ts; the standard exceljs entry is slow to load under npx tsx here.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  excelJsModule ??= require("exceljs/dist/exceljs.min.js") as typeof ExcelJSNamespace;
  return new excelJsModule.Workbook();
}

async function loadWorkbook(filePath: string): Promise<ExcelJSNamespace.Workbook> {
  const workbook = newExcelWorkbook();
  const buffer = await readFile(filePath);
  await workbook.xlsx.load(buffer);
  return workbook;
}

function countPopulatedRows(worksheet: ExcelJSNamespace.Worksheet, startRow: number, rowCount: number): number {
  let count = 0;
  for (let rowNumber = startRow; rowNumber < startRow + rowCount; rowNumber += 1) {
    const values = worksheet.getRow(rowNumber).values as unknown[];
    if (values.some((value) => normalizeCellValue(value).length > 0)) {
      count += 1;
    }
  }
  return count;
}

function normalizeCellValue(value: unknown): string {
  if (value == null) {
    return "";
  }
  if (typeof value === "object" && "text" in value && typeof value.text === "string") {
    return value.text.trim();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return String(value).trim();
}

function numbersClose(left: number, right: number, tolerance: number): boolean {
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= tolerance;
}

function table(headers: string[], rows: Array<Array<string | number>>): string {
  return [
    `| ${headers.map(escapeTableCell).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map((cell) => escapeTableCell(String(cell))).join(" | ")} |`),
  ].join("\n");
}

function escapeTableCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
}

function formatInteger(value: bigint | number | null | undefined): string {
  return toNumber(value).toLocaleString("en-US");
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatMoney(value: number): string {
  return value.toFixed(2);
}

function safeRate(numerator: bigint | number | null | undefined, denominator: bigint | number | null | undefined): number {
  const denominatorNumber = toNumber(denominator);
  if (denominatorNumber <= 0) {
    return 0;
  }
  return toNumber(numerator) / denominatorNumber;
}

function toNumber(value: bigint | number | null | undefined): number {
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  return 0;
}

function truncate(value: string, length: number): string {
  return value.length <= length ? value : `${value.slice(0, length - 1)}…`;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function writeReport(blocks: BlockResult[]) {
  const statusCounts = Object.fromEntries(statusOrder.map((status) => [status, 0])) as Record<Status, number>;
  for (const block of blocks) {
    statusCounts[block.status] += 1;
  }

  const lines = [
    "# V45 Beta 技术预验收报告",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## 汇总",
    "",
    table(
      ["状态", "数量"],
      statusOrder.map((status) => [status, statusCounts[status]]),
    ),
    "",
    ...blocks.flatMap((block) => [
      `## ${block.title}`,
      "",
      `Status: **${block.status}**`,
      "",
      ...block.body,
      "",
    ]),
  ];

  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${lines.join("\n")}\n`, "utf8");
}

async function cleanupExportContext() {
  if (!exportContext) {
    return;
  }
  await rm(dirname(exportContext.filePath), { recursive: true, force: true });
}

main().catch(async (error) => {
  await writeReport([
    {
      title: "Fatal",
      status: "FAIL",
      body: [`脚本执行发生未捕获错误：${formatError(error)}`],
    },
  ]);
  await cleanupExportContext();
  await prisma.$disconnect().catch(() => undefined);
  await appPrisma.$disconnect().catch(() => undefined);
  process.exitCode = 1;
});
