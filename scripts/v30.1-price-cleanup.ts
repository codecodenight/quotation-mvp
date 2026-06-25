import { execFileSync } from "node:child_process";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const DB_PATH = path.join("prisma", "dev.db");
const BACKUP_DIR = "backups";
const REPORT_PATH = path.join("docs", "v30.1-price-cleanup-report.md");

type DbCounts = {
  supplierOffers: number;
  products: number;
  productParams: number;
  priceHistory: number;
  quoteItemsWithNullOffer: number;
};

type SampleRow = {
  product_name?: string | null;
  model_no?: string | null;
  category?: string | null;
  factory_name?: string | null;
  price?: string | number | null;
  product_id?: string | null;
  param_count?: number | null;
};

type SubStep = {
  name: string;
  expected: number | string;
  actual: number;
  sql: string;
  sampleSql: string;
  samples: SampleRow[];
};

type StepSummary = {
  name: string;
  expected: number | string;
  actual: number;
  samples: SampleRow[];
  subSteps?: SubStep[];
};

type ReportData = {
  generatedAt: string;
  backupPath: string;
  before: DbCounts;
  after: DbCounts;
  steps: StepSummary[];
};

const OFFER_SAMPLE_SELECT = `
  SELECT
    p.product_name,
    p.model_no,
    p.category,
    so.factory_name,
    CAST(so.purchase_price AS TEXT) AS price
  FROM supplier_offers so
  JOIN products p ON p.id = so.product_id
`;

async function main() {
  await mkdir(BACKUP_DIR, { recursive: true });
  await mkdir(path.dirname(REPORT_PATH), { recursive: true });

  const backupPath = path.join(BACKUP_DIR, `dev-before-v30.1-${timestamp()}.sqlite`);
  await copyFile(DB_PATH, backupPath);

  const before = getCounts();
  const steps: StepSummary[] = [];

  steps.push(await runSingleStep("A1 电池=价格", 5, `
    DELETE FROM supplier_offers
    WHERE factory_name = '中千'
      AND CAST(purchase_price AS REAL) IN (14500, 18650, 26700)
  `, `
    ${OFFER_SAMPLE_SELECT}
    WHERE so.factory_name = '中千'
      AND CAST(so.purchase_price AS REAL) IN (14500, 18650, 26700)
    ORDER BY CAST(so.purchase_price AS REAL) DESC, p.product_name
    LIMIT 5
  `));

  steps.push(await runGroupedStep("A2 型号=价格", 65, [
    subStep("美莱德 >1000", 21, `
      DELETE FROM supplier_offers
      WHERE factory_name = '美莱德' AND CAST(purchase_price AS REAL) > 1000
    `, `
      ${OFFER_SAMPLE_SELECT}
      WHERE so.factory_name = '美莱德' AND CAST(so.purchase_price AS REAL) > 1000
      ORDER BY CAST(so.purchase_price AS REAL) DESC
      LIMIT 5
    `),
    subStep("雄企 QJ6870", 23, `
      DELETE FROM supplier_offers
      WHERE factory_name = '雄企' AND CAST(purchase_price AS REAL) = 6870
    `, `
      ${OFFER_SAMPLE_SELECT}
      WHERE so.factory_name = '雄企' AND CAST(so.purchase_price AS REAL) = 6870
      ORDER BY p.product_name
      LIMIT 5
    `),
    subStep("进成 >1000", 5, `
      DELETE FROM supplier_offers
      WHERE factory_name = '进成' AND CAST(purchase_price AS REAL) > 1000
    `, `
      ${OFFER_SAMPLE_SELECT}
      WHERE so.factory_name = '进成' AND CAST(so.purchase_price AS REAL) > 1000
      ORDER BY CAST(so.purchase_price AS REAL) DESC
      LIMIT 5
    `),
    subStep("优林 all", 4, `
      DELETE FROM supplier_offers
      WHERE factory_name = '优林'
    `, `
      ${OFFER_SAMPLE_SELECT}
      WHERE so.factory_name = '优林'
      ORDER BY CAST(so.purchase_price AS REAL) DESC
      LIMIT 5
    `),
    subStep("汇盈聚 >1000", 6, `
      DELETE FROM supplier_offers
      WHERE factory_name = '汇盈聚' AND CAST(purchase_price AS REAL) > 1000
    `, `
      ${OFFER_SAMPLE_SELECT}
      WHERE so.factory_name = '汇盈聚' AND CAST(so.purchase_price AS REAL) > 1000
      ORDER BY CAST(so.purchase_price AS REAL) DESC
      LIMIT 5
    `),
    subStep("博华 7182", 1, `
      DELETE FROM supplier_offers
      WHERE factory_name = '博华' AND CAST(purchase_price AS REAL) = 7182
    `, `
      ${OFFER_SAMPLE_SELECT}
      WHERE so.factory_name = '博华' AND CAST(so.purchase_price AS REAL) = 7182
      LIMIT 5
    `),
    subStep("太阳能壁灯草坪灯 >1000", 5, `
      DELETE FROM supplier_offers
      WHERE factory_name = '太阳能壁灯草坪灯'
        AND CAST(purchase_price AS REAL) > 1000
    `, `
      ${OFFER_SAMPLE_SELECT}
      WHERE so.factory_name = '太阳能壁灯草坪灯'
        AND CAST(so.purchase_price AS REAL) > 1000
      ORDER BY CAST(so.purchase_price AS REAL) DESC
      LIMIT 5
    `),
  ]));

  steps.push(await runGroupedStep("A3 规格=价格", 42, [
    subStep("合力尺寸=价格", 18, `
      DELETE FROM supplier_offers
      WHERE factory_name = '合力'
        AND CAST(purchase_price AS REAL) >= 100
        AND id IN (
          SELECT so.id FROM supplier_offers so
          JOIN products p ON p.id = so.product_id
          WHERE so.factory_name = '合力'
            AND CAST(so.purchase_price AS REAL) >= 100
            AND p.product_name NOT LIKE 'T80-A%'
        )
    `, `
      ${OFFER_SAMPLE_SELECT}
      WHERE so.factory_name = '合力'
        AND CAST(so.purchase_price AS REAL) >= 100
        AND p.product_name NOT LIKE 'T80-A%'
      ORDER BY CAST(so.purchase_price AS REAL) DESC
      LIMIT 5
    `),
    subStep("一群狼 FG", 4, `
      DELETE FROM supplier_offers
      WHERE factory_name = '一群狼'
        AND CAST(purchase_price AS REAL) IN (300, 600, 900, 1200)
        AND id IN (
          SELECT so.id FROM supplier_offers so
          JOIN products p ON p.id = so.product_id
          WHERE so.factory_name = '一群狼'
            AND p.product_name LIKE 'FG-%'
        )
    `, `
      ${OFFER_SAMPLE_SELECT}
      WHERE so.factory_name = '一群狼'
        AND CAST(so.purchase_price AS REAL) IN (300, 600, 900, 1200)
        AND p.product_name LIKE 'FG-%'
      ORDER BY CAST(so.purchase_price AS REAL) DESC
      LIMIT 5
    `),
    subStep("伊明特尺寸", 3, `
      DELETE FROM supplier_offers
      WHERE factory_name = '伊明特'
        AND CAST(purchase_price AS REAL) IN (460, 370, 260)
    `, `
      ${OFFER_SAMPLE_SELECT}
      WHERE so.factory_name = '伊明特'
        AND CAST(so.purchase_price AS REAL) IN (460, 370, 260)
      ORDER BY CAST(so.purchase_price AS REAL) DESC
      LIMIT 5
    `),
    subStep("伊特瓦数", 2, `
      DELETE FROM supplier_offers
      WHERE factory_name = '伊特'
        AND CAST(purchase_price AS REAL) IN (1500, 1000)
    `, `
      ${OFFER_SAMPLE_SELECT}
      WHERE so.factory_name = '伊特'
        AND CAST(so.purchase_price AS REAL) IN (1500, 1000)
      ORDER BY CAST(so.purchase_price AS REAL) DESC
      LIMIT 5
    `),
    subStep("名威 CCT/尺寸", 6, `
      DELETE FROM supplier_offers
      WHERE factory_name = '名威'
        AND CAST(purchase_price AS REAL) IN (3000, 1222, 638, 124)
    `, `
      ${OFFER_SAMPLE_SELECT}
      WHERE so.factory_name = '名威'
        AND CAST(so.purchase_price AS REAL) IN (3000, 1222, 638, 124)
      ORDER BY CAST(so.purchase_price AS REAL) DESC
      LIMIT 5
    `),
    subStep("宁波琦辉 CCT", 1, `
      DELETE FROM supplier_offers
      WHERE factory_name = '宁波琦辉' AND CAST(purchase_price AS REAL) = 3000
    `, `
      ${OFFER_SAMPLE_SELECT}
      WHERE so.factory_name = '宁波琦辉' AND CAST(so.purchase_price AS REAL) = 3000
      LIMIT 5
    `),
    subStep("异形 CCT", 1, `
      DELETE FROM supplier_offers
      WHERE factory_name = '异形' AND CAST(purchase_price AS REAL) = 6500
    `, `
      ${OFFER_SAMPLE_SELECT}
      WHERE so.factory_name = '异形' AND CAST(so.purchase_price AS REAL) = 6500
      LIMIT 5
    `),
    subStep("新时达尺寸", 2, `
      DELETE FROM supplier_offers
      WHERE factory_name = '新时达'
        AND CAST(purchase_price AS REAL) IN (595, 295)
    `, `
      ${OFFER_SAMPLE_SELECT}
      WHERE so.factory_name = '新时达'
        AND CAST(so.purchase_price AS REAL) IN (595, 295)
      ORDER BY CAST(so.purchase_price AS REAL) DESC
      LIMIT 5
    `),
    subStep("绿晟 CCT", 3, `
      DELETE FROM supplier_offers
      WHERE factory_name = '绿晟'
        AND CAST(purchase_price AS REAL) IN (6000, 3800, 2800)
    `, `
      ${OFFER_SAMPLE_SELECT}
      WHERE so.factory_name = '绿晟'
        AND CAST(so.purchase_price AS REAL) IN (6000, 3800, 2800)
      ORDER BY CAST(so.purchase_price AS REAL) DESC
      LIMIT 5
    `),
    subStep("镜前灯-中山惠尔佳内箱尺寸", 1, `
      DELETE FROM supplier_offers
      WHERE factory_name = '镜前灯-中山惠尔佳'
        AND CAST(purchase_price AS REAL) = 109
    `, `
      ${OFFER_SAMPLE_SELECT}
      WHERE so.factory_name = '镜前灯-中山惠尔佳'
        AND CAST(so.purchase_price AS REAL) = 109
      LIMIT 5
    `),
    subStep("应急球泡尺寸", 1, `
      DELETE FROM supplier_offers
      WHERE factory_name = '应急球泡'
        AND CAST(purchase_price AS REAL) = 325
    `, `
      ${OFFER_SAMPLE_SELECT}
      WHERE so.factory_name = '应急球泡'
        AND CAST(so.purchase_price AS REAL) = 325
      LIMIT 5
    `),
  ]));

  steps.push(await runSingleStep("A4 极端高价", 1, `
    DELETE FROM supplier_offers
    WHERE factory_name = '凯晟德'
      AND CAST(purchase_price AS REAL) > 10000
  `, `
    ${OFFER_SAMPLE_SELECT}
    WHERE so.factory_name = '凯晟德'
      AND CAST(so.purchase_price AS REAL) > 10000
    LIMIT 5
  `));

  steps.push(await runGroupedStep("A5 price=0", 9, [
    subStep("凯晟德 price=0", 8, `
      DELETE FROM supplier_offers
      WHERE factory_name = '凯晟德' AND CAST(purchase_price AS REAL) = 0
    `, `
      ${OFFER_SAMPLE_SELECT}
      WHERE so.factory_name = '凯晟德' AND CAST(so.purchase_price AS REAL) = 0
      ORDER BY p.product_name
      LIMIT 5
    `),
    subStep("普照 price=0", 1, `
      DELETE FROM supplier_offers
      WHERE factory_name = '普照' AND CAST(purchase_price AS REAL) = 0
    `, `
      ${OFFER_SAMPLE_SELECT}
      WHERE so.factory_name = '普照' AND CAST(so.purchase_price AS REAL) = 0
      LIMIT 5
    `),
  ]));

  steps.push(await runSingleStep("应急球泡", 23, `
    DELETE FROM supplier_offers
    WHERE factory_name = '应急球泡'
  `, `
    ${OFFER_SAMPLE_SELECT}
    WHERE so.factory_name = '应急球泡'
    ORDER BY CAST(so.purchase_price AS REAL) DESC, p.product_name
    LIMIT 5
  `));

  const orphanParamSamples = queryJson<SampleRow>(`
    SELECT
      p.id AS product_id,
      p.product_name,
      p.model_no,
      p.category,
      COUNT(pp.id) AS param_count
    FROM products p
    LEFT JOIN product_params pp ON pp.product_id = p.id
    WHERE p.id NOT IN (SELECT product_id FROM supplier_offers)
      AND p.id NOT IN (SELECT product_id FROM quote_items)
    GROUP BY p.id
    HAVING COUNT(pp.id) > 0
    ORDER BY p.product_name
    LIMIT 5
  `);

  const orphanParamCount = executeDelete(`
    DELETE FROM product_params
    WHERE product_id IN (
      SELECT id FROM products
      WHERE id NOT IN (SELECT product_id FROM supplier_offers)
        AND id NOT IN (SELECT product_id FROM quote_items)
    )
  `);

  steps.push({
    name: "孤儿 params",
    expected: "~100",
    actual: orphanParamCount,
    samples: orphanParamSamples,
  });

  const orphanProductSamples = queryJson<SampleRow>(`
    SELECT
      id AS product_id,
      product_name,
      model_no,
      category
    FROM products
    WHERE id NOT IN (SELECT product_id FROM supplier_offers)
      AND id NOT IN (SELECT product_id FROM quote_items)
    ORDER BY product_name
    LIMIT 5
  `);

  const orphanProductCount = executeDelete(`
    DELETE FROM products
    WHERE id NOT IN (SELECT product_id FROM supplier_offers)
      AND id NOT IN (SELECT product_id FROM quote_items)
  `);

  steps.push({
    name: "孤儿 products",
    expected: "~20",
    actual: orphanProductCount,
    samples: orphanProductSamples,
  });

  const after = getCounts();
  const reportData: ReportData = {
    generatedAt: new Date().toISOString(),
    backupPath,
    before,
    after,
    steps,
  };

  await writeFile(REPORT_PATH, buildReport(reportData), "utf8");

  console.log(JSON.stringify({
    reportPath: REPORT_PATH,
    backupPath,
    before,
    after,
    offerDelta: after.supplierOffers - before.supplierOffers,
    productDelta: after.products - before.products,
    paramDelta: after.productParams - before.productParams,
  }, null, 2));
}

function subStep(name: string, expected: number, sql: string, sampleSql: string): SubStep {
  return { name, expected, actual: 0, sql, sampleSql, samples: [] };
}

async function runGroupedStep(name: string, expected: number, subSteps: SubStep[]): Promise<StepSummary> {
  for (const step of subSteps) {
    step.samples = queryJson<SampleRow>(step.sampleSql);
    step.actual = executeDelete(step.sql);
  }

  const samples = subSteps.flatMap((step) => step.samples).slice(0, 5);
  return {
    name,
    expected,
    actual: subSteps.reduce((sum, step) => sum + step.actual, 0),
    samples,
    subSteps,
  };
}

async function runSingleStep(name: string, expected: number, sql: string, sampleSql: string): Promise<StepSummary> {
  const samples = queryJson<SampleRow>(sampleSql);
  const actual = executeDelete(sql);
  return { name, expected, actual, samples };
}

function getCounts(): DbCounts {
  const rows = queryJson<{
    supplier_offers: number;
    products: number;
    product_params: number;
    price_history: number;
    quote_items_with_null_offer: number;
  }>(`
    SELECT
      (SELECT COUNT(*) FROM supplier_offers) AS supplier_offers,
      (SELECT COUNT(*) FROM products) AS products,
      (SELECT COUNT(*) FROM product_params) AS product_params,
      (SELECT COUNT(*) FROM price_history) AS price_history,
      (SELECT COUNT(*) FROM quote_items WHERE supplier_offer_id IS NULL) AS quote_items_with_null_offer
  `);
  const row = rows[0];
  if (!row) {
    throw new Error("Unable to load database counts");
  }
  return {
    supplierOffers: Number(row.supplier_offers),
    products: Number(row.products),
    productParams: Number(row.product_params),
    priceHistory: Number(row.price_history),
    quoteItemsWithNullOffer: Number(row.quote_items_with_null_offer),
  };
}

function queryJson<T>(sql: string): T[] {
  const output = execFileSync("sqlite3", ["-json", DB_PATH, sql], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  }).trim();
  if (!output) return [];
  return JSON.parse(output) as T[];
}

function executeDelete(sql: string): number {
  const rows = queryJson<{ changes: number }>(`
    PRAGMA foreign_keys = ON;
    ${sql};
    SELECT changes() AS changes;
  `);
  return Number(rows[0]?.changes ?? 0);
}

function timestamp(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    "-",
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join("");
}

function buildReport(data: ReportData): string {
  return [
    "# V30.1 价格异常清理报告",
    "",
    `Generated: ${data.generatedAt}`,
    "",
    "## 备份",
    `路径: ${data.backupPath}`,
    "",
    "## 执行结果",
    "",
    markdownTable(
      ["步骤", "预期", "实际", "状态"],
      data.steps.map((step) => [
        step.name,
        String(step.expected),
        String(step.actual),
        stepStatus(step.expected, step.actual),
      ]),
    ),
    "",
    "## 数据库变化",
    "",
    markdownTable(
      ["指标", "清理前", "清理后", "变化"],
      [
        ["supplier_offers", data.before.supplierOffers, data.after.supplierOffers, signed(data.after.supplierOffers - data.before.supplierOffers)],
        ["products", data.before.products, data.after.products, signed(data.after.products - data.before.products)],
        ["product_params", data.before.productParams, data.after.productParams, signed(data.after.productParams - data.before.productParams)],
        ["price_history", data.before.priceHistory, data.after.priceHistory, signed(data.after.priceHistory - data.before.priceHistory)],
        [
          "quote_items.supplier_offer_id IS NULL",
          data.before.quoteItemsWithNullOffer,
          data.after.quoteItemsWithNullOffer,
          signed(data.after.quoteItemsWithNullOffer - data.before.quoteItemsWithNullOffer),
        ],
      ],
    ),
    "",
    "## 分项明细",
    "",
    ...data.steps.flatMap((step) => buildStepDetail(step)),
    "## 抽检样本",
    "",
    ...data.steps.flatMap((step) => buildSampleSection(step)),
    "## 约束确认",
    "",
    "- 已先备份数据库，再执行写入操作。",
    "- 未修改 B 类工厂名。",
    "- 未修改 C 类 sub-1 RMB 价格。",
    "- 未删除合力 T80-A HIGH 系列假阳性。",
    "- 未修改 src/ 文件或源 Excel 文件。",
    "",
  ].join("\n");
}

function buildStepDetail(step: StepSummary): string[] {
  if (!step.subSteps?.length) return [];
  return [
    `### ${step.name}`,
    "",
    markdownTable(
      ["子项", "预期", "实际", "状态"],
      step.subSteps.map((sub) => [
        sub.name,
        String(sub.expected),
        String(sub.actual),
        stepStatus(sub.expected, sub.actual),
      ]),
    ),
    "",
  ];
}

function buildSampleSection(step: StepSummary): string[] {
  return [
    `### ${step.name}`,
    "",
    markdownTable(
      ["product_name", "model_no", "category", "factory_name", "price", "param_count"],
      step.samples.map((sample) => [
        sample.product_name ?? "-",
        sample.model_no ?? "-",
        sample.category ?? "-",
        sample.factory_name ?? "-",
        sample.price ?? "-",
        sample.param_count ?? "-",
      ]),
    ),
    "",
  ];
}

function stepStatus(expected: number | string, actual: number): string {
  if (typeof expected === "number") return expected === actual ? "✓" : "✗";
  return "";
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function markdownTable(headers: string[], rows: Array<Array<string | number>>): string {
  const safeRows = rows.length > 0 ? rows : [headers.map(() => "-")];
  return [
    `| ${headers.map(escapeCell).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...safeRows.map((row) => `| ${row.map((cell) => escapeCell(String(cell))).join(" | ")} |`),
  ].join("\n");
}

function escapeCell(value: string): string {
  return value.replace(/\r?\n/g, " ").replace(/\|/g, "\\|").trim();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
