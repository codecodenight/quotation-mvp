import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";

const DB_PATH = path.join("prisma", "dev.db");
const BACKUP_PATH = path.join("backups", "dev-pre-v31.0.db");
const REPORT_PATH = path.join("docs", "v31.0-chat-quality-fix-report.md");

type FactoryFix = {
  id: string;
  group: "玲玲发" | "牛志" | "Wellux" | "未知";
  fromFactory: string;
  toFactory: string;
  expected: number;
};

type CountRow = {
  count: number | string | null;
};

type FactorySnapshotRow = {
  factory_name: string;
  count: number | string;
};

type GlobalCounts = {
  products: number | string;
  supplier_offers: number | string;
  product_params: number | string;
  price_history: number | string;
};

type JunkSnapshot = {
  products: number;
  supplierOffers: number;
  productParams: number;
  priceHistory: number;
  quoteItems: number;
};

type Snapshot = {
  factoryCounts: Map<string, number>;
  filenameLikeFactoryCount: number;
  junk: JunkSnapshot;
  global: GlobalCounts;
};

const FACTORY_FIXES: FactoryFix[] = [
  {
    id: "linglingfa",
    group: "玲玲发",
    fromFactory: "玲玲发 核算！-PP筒灯价格对比 20250912.xlsx",
    toFactory: "玲玲发",
    expected: 101,
  },
  {
    id: "niuzhi",
    group: "牛志",
    fromFactory: "塑料壁灯 (1)牛志 202504 刘林给.xlsx",
    toFactory: "牛志",
    expected: 40,
  },
  {
    id: "wellux_panel",
    group: "Wellux",
    fromFactory: "出中东款核价Wellux Quotation of led panel 2020-10-8.xlsx",
    toFactory: "Wellux",
    expected: 75,
  },
  {
    id: "wellux_worklight",
    group: "Wellux",
    fromFactory: "核价wellux quotation of led worklight 20230907 (1).xls",
    toFactory: "Wellux",
    expected: 41,
  },
  {
    id: "wellux_fan",
    group: "Wellux",
    fromFactory: "核价- WELLUX FAN CEILING LAMP QUOTATION -2025.10.13 (3).xlsx",
    toFactory: "Wellux",
    expected: 24,
  },
  {
    id: "wellux_solar_wall",
    group: "Wellux",
    fromFactory: "核价Wellux Quotation of led solar wall light 20231027.xlsx",
    toFactory: "Wellux",
    expected: 4,
  },
  {
    id: "unknown_g9_r7s",
    group: "未知",
    fromFactory: "LED G9&R7S 核价2021.7.19.xlsx",
    toFactory: "未知",
    expected: 22,
  },
  {
    id: "unknown_anti_glare",
    group: "未知",
    fromFactory: "防眩光筒灯含税报价3.16.xls",
    toFactory: "未知",
    expected: 9,
  },
  {
    id: "unknown_cob_downlight",
    group: "未知",
    fromFactory: "刘林姐给COB深防眩筒灯报价单 铁皮的 含税加10%.xlsx",
    toFactory: "未知",
    expected: 1,
  },
];

const JUNK_PRODUCT_NAMES = [
  "Product Name",
  "Voltage （V）",
  "AC:165-265V",
  "3k-65k",
  "230mm",
  "210mm",
  "200mm",
  "175mm",
  "160mm",
  "155mm",
  "140mm",
  "8mm",
  "10MM",
  "0.25MM",
  "0.14MM",
  "0.2MM",
  "10mm",
  "12mm",
  "6.8mm",
  "11mm",
];

function main() {
  if (!existsSync(BACKUP_PATH)) {
    throw new Error(`Missing required DB backup: ${BACKUP_PATH}`);
  }

  const before = loadSnapshot();
  assertSafeJunkCleanup(before.junk);

  const factoryChanges = executeFactoryFixes();
  const junkChanges = executeJunkCleanup();
  const after = loadSnapshot();

  writeFileSync(
    REPORT_PATH,
    buildReport({
      generatedAt: new Date().toISOString(),
      before,
      after,
      factoryChanges,
      junkChanges,
    }),
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        backupPath: BACKUP_PATH,
        reportPath: REPORT_PATH,
        factoryUpdated: sumValues(factoryChanges),
        junkDeletedProducts: junkChanges.get("deleted_products") ?? 0,
        filenameLikeFactoryCount: after.filenameLikeFactoryCount,
        remainingJunkProducts: after.junk.products,
      },
      null,
      2,
    ),
  );
}

function loadSnapshot(): Snapshot {
  return {
    factoryCounts: loadFactoryCounts(),
    filenameLikeFactoryCount: scalar(`SELECT COUNT(*) AS count FROM supplier_offers WHERE factory_name LIKE '%.xls%'`),
    junk: loadJunkSnapshot(),
    global: queryJson<GlobalCounts>(`
      SELECT
        (SELECT COUNT(*) FROM products) AS products,
        (SELECT COUNT(*) FROM supplier_offers) AS supplier_offers,
        (SELECT COUNT(*) FROM product_params) AS product_params,
        (SELECT COUNT(*) FROM price_history) AS price_history
    `)[0],
  };
}

function loadFactoryCounts(): Map<string, number> {
  const trackedNames = unique([
    ...FACTORY_FIXES.flatMap((fix) => [fix.fromFactory, fix.toFactory]),
    "Wellux",
    "未知",
  ]);
  const rows = queryJson<FactorySnapshotRow>(`
    SELECT factory_name, COUNT(*) AS count
    FROM supplier_offers
    WHERE factory_name IN (${sqlList(trackedNames)})
    GROUP BY factory_name
    ORDER BY factory_name
  `);
  return new Map(rows.map((row) => [row.factory_name, Number(row.count)]));
}

function loadJunkSnapshot(): JunkSnapshot {
  const rows = queryJson<{
    products: number | string;
    supplier_offers: number | string;
    product_params: number | string;
    price_history: number | string;
    quote_items: number | string;
  }>(`
    WITH targets AS (
      SELECT id
      FROM products
      WHERE product_name IN (${sqlList(JUNK_PRODUCT_NAMES)})
    ),
    target_offers AS (
      SELECT id
      FROM supplier_offers
      WHERE product_id IN (SELECT id FROM targets)
    )
    SELECT
      (SELECT COUNT(*) FROM targets) AS products,
      (SELECT COUNT(*) FROM target_offers) AS supplier_offers,
      (SELECT COUNT(*) FROM product_params WHERE product_id IN (SELECT id FROM targets)) AS product_params,
      (SELECT COUNT(*) FROM price_history WHERE supplier_offer_id IN (SELECT id FROM target_offers)) AS price_history,
      (SELECT COUNT(*) FROM quote_items WHERE product_id IN (SELECT id FROM targets) OR supplier_offer_id IN (SELECT id FROM target_offers)) AS quote_items
  `)[0];

  return {
    products: Number(rows.products),
    supplierOffers: Number(rows.supplier_offers),
    productParams: Number(rows.product_params),
    priceHistory: Number(rows.price_history),
    quoteItems: Number(rows.quote_items),
  };
}

function assertSafeJunkCleanup(junk: JunkSnapshot) {
  if (junk.products !== 20) {
    throw new Error(`Unsafe Part C target count: expected 20 products, found ${junk.products}`);
  }
  if (junk.supplierOffers !== 20) {
    throw new Error(`Unsafe Part C offer count: expected 20 supplier_offers, found ${junk.supplierOffers}`);
  }
  if (junk.quoteItems !== 0) {
    throw new Error(`Unsafe Part C cleanup: ${junk.quoteItems} quote_items reference target products/offers`);
  }
}

function executeFactoryFixes(): Map<string, number> {
  const labeledSql = [
    "PRAGMA foreign_keys = ON;",
    "BEGIN IMMEDIATE;",
    ...FACTORY_FIXES.flatMap((fix) => [
      `UPDATE supplier_offers SET factory_name = ${sqlString(fix.toFactory)} WHERE factory_name = ${sqlString(fix.fromFactory)};`,
      `SELECT ${sqlString(fix.id)}, changes();`,
    ]),
    "COMMIT;",
  ].join("\n");
  return runLabeledSql(labeledSql);
}

function executeJunkCleanup(): Map<string, number> {
  const labeledSql = `
    PRAGMA foreign_keys = ON;
    BEGIN IMMEDIATE;
    CREATE TEMP TABLE v31_junk_product_ids(id TEXT PRIMARY KEY);
    INSERT INTO v31_junk_product_ids(id)
      SELECT id
      FROM products
      WHERE product_name IN (${sqlList(JUNK_PRODUCT_NAMES)});
    SELECT 'target_products', COUNT(*) FROM v31_junk_product_ids;
    DELETE FROM product_params
      WHERE product_id IN (SELECT id FROM v31_junk_product_ids);
    SELECT 'deleted_product_params', changes();
    DELETE FROM supplier_offers
      WHERE product_id IN (SELECT id FROM v31_junk_product_ids);
    SELECT 'deleted_supplier_offers', changes();
    DELETE FROM products
      WHERE id IN (SELECT id FROM v31_junk_product_ids);
    SELECT 'deleted_products', changes();
    COMMIT;
  `;
  return runLabeledSql(labeledSql);
}

function buildReport(input: {
  generatedAt: string;
  before: Snapshot;
  after: Snapshot;
  factoryChanges: Map<string, number>;
  junkChanges: Map<string, number>;
}): string {
  const factoryRows = FACTORY_FIXES.map((fix) => {
    const beforeOld = input.before.factoryCounts.get(fix.fromFactory) ?? 0;
    const afterOld = input.after.factoryCounts.get(fix.fromFactory) ?? 0;
    const changed = input.factoryChanges.get(fix.id) ?? 0;
    return [
      fix.group,
      fix.fromFactory,
      fix.toFactory,
      fix.expected,
      beforeOld,
      changed,
      afterOld,
      fix.expected === changed && afterOld === 0 ? "PASS" : "FAIL",
    ];
  });
  const groupRows = ["玲玲发", "牛志", "Wellux", "未知"].map((group) => {
    const expected = FACTORY_FIXES.filter((fix) => fix.group === group).reduce((sum, fix) => sum + fix.expected, 0);
    const changed = FACTORY_FIXES.filter((fix) => fix.group === group).reduce(
      (sum, fix) => sum + (input.factoryChanges.get(fix.id) ?? 0),
      0,
    );
    return [group, expected, changed, expected === changed ? "PASS" : "FAIL"];
  });
  const removedPriceHistory = input.before.junk.priceHistory - input.after.junk.priceHistory;

  return [
    "# V31.0 Chat Quality Fix Verification Report",
    "",
    `Generated: ${input.generatedAt}`,
    "",
    "## Backup",
    "",
    `- DB backup: ${BACKUP_PATH}`,
    "",
    "## Part A - Code",
    "",
    "- [x] `src/app/chat/actions.ts`: added `[CHAT-TOOL]` call/result server logs around tool execution.",
    "- [x] `src/lib/deepseek.ts`: added prompt guidance for numeric range tool parameters and factory price comparison.",
    "",
    "## Part B - Factory Name Fix",
    "",
    markdownTable(["Group", "Expected", "Updated", "Status"], groupRows),
    "",
    markdownTable(
      ["Group", "Old factory_name", "New factory_name", "Expected", "Before", "Updated", "Remaining old", "Status"],
      factoryRows,
    ),
    "",
    `- Total expected updates: ${FACTORY_FIXES.reduce((sum, fix) => sum + fix.expected, 0)}`,
    `- Total actual updates: ${sumValues(input.factoryChanges)}`,
    `- Remaining supplier_offers.factory_name LIKE '%.xls%': ${input.after.filenameLikeFactoryCount}`,
    "",
    "## Part C - Junk Product Delete",
    "",
    markdownTable(
      ["Metric", "Before", "Deleted", "After"],
      [
        ["products", input.before.junk.products, input.junkChanges.get("deleted_products") ?? 0, input.after.junk.products],
        [
          "supplier_offers",
          input.before.junk.supplierOffers,
          input.junkChanges.get("deleted_supplier_offers") ?? 0,
          input.after.junk.supplierOffers,
        ],
        [
          "product_params",
          input.before.junk.productParams,
          input.junkChanges.get("deleted_product_params") ?? 0,
          input.after.junk.productParams,
        ],
        ["price_history", input.before.junk.priceHistory, removedPriceHistory, input.after.junk.priceHistory],
        ["quote_items", input.before.junk.quoteItems, 0, input.after.junk.quoteItems],
      ],
    ),
    "",
    "## Final DB Counts",
    "",
    markdownTable(
      ["Table", "Count"],
      [
        ["products", input.after.global.products],
        ["supplier_offers", input.after.global.supplier_offers],
        ["product_params", input.after.global.product_params],
        ["price_history", input.after.global.price_history],
      ],
    ),
    "",
    "## Verification",
    "",
    `- Old filename-style factory names remaining: ${sumOldFactoryCounts(input.after.factoryCounts)}`,
    `- Filename extension factory names remaining: ${input.after.filenameLikeFactoryCount}`,
    `- Junk products remaining: ${input.after.junk.products}`,
    `- Junk supplier_offers remaining: ${input.after.junk.supplierOffers}`,
    `- Junk product_params remaining: ${input.after.junk.productParams}`,
    "",
  ].join("\n");
}

function queryJson<T>(sql: string): T[] {
  const output = execFileSync("sqlite3", ["-json", DB_PATH, sql], {
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
  }).trim();
  if (!output) return [];
  return JSON.parse(output) as T[];
}

function runLabeledSql(sql: string): Map<string, number> {
  const output = execFileSync("sqlite3", ["-batch", "-noheader", "-separator", "\t", DB_PATH], {
    input: sql,
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
  }).trim();
  const result = new Map<string, number>();
  if (!output) return result;

  for (const line of output.split(/\r?\n/)) {
    const [label, value] = line.split("\t");
    result.set(label, Number(value));
  }
  return result;
}

function scalar(sql: string): number {
  const rows = queryJson<CountRow>(sql);
  return Number(rows[0]?.count ?? 0);
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function sqlList(values: string[]): string {
  return values.map(sqlString).join(", ");
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function sumValues(map: Map<string, number>): number {
  return [...map.values()].reduce((sum, value) => sum + value, 0);
}

function sumOldFactoryCounts(factoryCounts: Map<string, number>): number {
  return FACTORY_FIXES.reduce((sum, fix) => sum + (factoryCounts.get(fix.fromFactory) ?? 0), 0);
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

main();
