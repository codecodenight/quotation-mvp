import { execFileSync } from "node:child_process";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const DB_PATH = path.join("prisma", "dev.db");
const BACKUP_DIR = "backups";
const REPORT_PATH = path.join("docs", "v30.2-factory-name-fix-report.md");

type MappingGroup = "A" | "B" | "C";

type Mapping = {
  group: MappingGroup;
  label: string;
  fromFactory: string;
  toFactory: string;
  expected: number;
  updateSql: string;
  sampleSql: string;
};

type SampleRow = {
  product_name: string | null;
  model_no: string | null;
  old_factory_name: string | null;
  new_factory_name: string | null;
  file_name: string | null;
};

type MappingResult = Mapping & {
  actual: number;
  samples: SampleRow[];
};

type FactoryCount = {
  factory_name: string;
  count: number;
};

type ReportData = {
  generatedAt: string;
  backupPath: string;
  beforeCounts: FactoryCount[];
  afterCounts: FactoryCount[];
  results: MappingResult[];
};

const TRACKED_FACTORY_NAMES = [
  "太阳能壁灯草坪灯",
  "科蒲尔",
  "优泽",
  "瑞雪",
  "凯益德",
  "名威 支架系列 报价-2023.9.20.xls",
  "NOVA -名威新款支架 报价-2024.2.27.xls",
  "广交会最终核价",
  "核价 发客户",
  "sample data",
  "博登",
  "巨鑫",
  "羽成",
  "欣益进",
  "精友",
  "晟高",
  "华浦",
  "汇孚",
  "巨登",
  "名威",
];

const SAMPLE_SELECT_PREFIX = `
  SELECT
    p.product_name,
    p.model_no,
    so.factory_name AS old_factory_name,
    '' AS new_factory_name,
    f.file_name
  FROM supplier_offers so
  JOIN products p ON p.id = so.product_id
  LEFT JOIN files f ON f.id = so.source_file_id
`;

const mappings: Mapping[] = [
  groupAMapping("太阳能壁灯草坪灯→博登", "博登", "%博登%", 87),
  groupAMapping("太阳能壁灯草坪灯→巨鑫", "巨鑫", "%巨鑫%", 65),
  groupAMapping("太阳能壁灯草坪灯→羽成", "羽成", "%羽成%", 66),
  groupAMapping("太阳能壁灯草坪灯→欣益进", "欣益进", "%欣益进%", 24),
  groupAMapping("太阳能壁灯草坪灯→精友", "精友", "%精友%", 4),
  groupAMapping("太阳能壁灯草坪灯→晟高", "晟高", "%晟高%", 1),
  groupBMapping("科蒲尔%→科蒲尔", "科蒲尔%", "科蒲尔", 31),
  groupBMapping("优泽%→优泽", "优泽%", "优泽", 12),
  groupBMapping("瑞雪%→瑞雪", "瑞雪%", "瑞雪", 12),
  groupBMapping("凯益德%→凯益德", "凯益德%", "凯益德", 10),
  {
    group: "B",
    label: "名威 支架%→名威",
    fromFactory: "名威 支架%",
    toFactory: "名威",
    expected: 3,
    updateSql: `
      UPDATE supplier_offers SET factory_name = '名威'
      WHERE factory_name LIKE '名威 支架%'
    `,
    sampleSql: `
      ${SAMPLE_SELECT_PREFIX}
      WHERE so.factory_name LIKE '名威 支架%'
      ORDER BY p.product_name
      LIMIT 3
    `,
  },
  {
    group: "B",
    label: "NOVA%名威%→名威",
    fromFactory: "NOVA%名威%",
    toFactory: "名威",
    expected: 1,
    updateSql: `
      UPDATE supplier_offers SET factory_name = '名威'
      WHERE factory_name LIKE 'NOVA%名威%'
    `,
    sampleSql: `
      ${SAMPLE_SELECT_PREFIX}
      WHERE so.factory_name LIKE 'NOVA%名威%'
      ORDER BY p.product_name
      LIMIT 3
    `,
  },
  groupCMapping("广交会最终核价+华浦→华浦", "广交会最终核价", "华浦", "%华浦%", 21),
  groupCMapping("广交会最终核价+汇孚→汇孚", "广交会最终核价", "汇孚", "%汇孚%", 66),
  groupCMapping("核价 发客户+巨登→巨登", "核价 发客户", "巨登", "%巨登%", 11),
  groupCMapping("sample data+汇孚→汇孚", "sample data", "汇孚", "%汇孚%", 9),
];

async function main() {
  await mkdir(BACKUP_DIR, { recursive: true });
  await mkdir(path.dirname(REPORT_PATH), { recursive: true });

  const backupPath = path.join(BACKUP_DIR, `dev-before-v30.2-${timestamp()}.sqlite`);
  await copyFile(DB_PATH, backupPath);

  const beforeCounts = loadTrackedCounts();
  const results: MappingResult[] = [];

  for (const mapping of mappings) {
    const samples = queryJson<SampleRow>(mapping.sampleSql).map((sample) => ({
      ...sample,
      new_factory_name: mapping.toFactory,
    }));
    const actual = executeUpdate(mapping.updateSql);
    results.push({ ...mapping, actual, samples });
  }

  const afterCounts = loadTrackedCounts();
  const reportData: ReportData = {
    generatedAt: new Date().toISOString(),
    backupPath,
    beforeCounts,
    afterCounts,
    results,
  };

  await writeFile(REPORT_PATH, buildReport(reportData), "utf8");

  console.log(JSON.stringify({
    reportPath: REPORT_PATH,
    backupPath,
    totalUpdated: results.reduce((sum, result) => sum + result.actual, 0),
    expectedTotal: results.reduce((sum, result) => sum + result.expected, 0),
  }, null, 2));
}

function groupAMapping(label: string, toFactory: string, fileLike: string, expected: number): Mapping {
  return {
    group: "A",
    label,
    fromFactory: "太阳能壁灯草坪灯",
    toFactory,
    expected,
    updateSql: `
      UPDATE supplier_offers SET factory_name = '${toFactory}'
      WHERE factory_name = '太阳能壁灯草坪灯'
        AND source_file_id IN (SELECT id FROM files WHERE file_name LIKE '${fileLike}')
    `,
    sampleSql: `
      ${SAMPLE_SELECT_PREFIX}
      WHERE so.factory_name = '太阳能壁灯草坪灯'
        AND so.source_file_id IN (SELECT id FROM files WHERE file_name LIKE '${fileLike}')
      ORDER BY f.file_name, p.product_name
      LIMIT 3
    `,
  };
}

function groupBMapping(label: string, factoryLike: string, toFactory: string, expected: number): Mapping {
  return {
    group: "B",
    label,
    fromFactory: factoryLike,
    toFactory,
    expected,
    updateSql: `
      UPDATE supplier_offers SET factory_name = '${toFactory}'
      WHERE factory_name LIKE '${factoryLike}' AND factory_name != '${toFactory}'
    `,
    sampleSql: `
      ${SAMPLE_SELECT_PREFIX}
      WHERE so.factory_name LIKE '${factoryLike}' AND so.factory_name != '${toFactory}'
      ORDER BY so.factory_name, p.product_name
      LIMIT 3
    `,
  };
}

function groupCMapping(
  label: string,
  fromFactory: string,
  toFactory: string,
  fileLike: string,
  expected: number,
): Mapping {
  return {
    group: "C",
    label,
    fromFactory,
    toFactory,
    expected,
    updateSql: `
      UPDATE supplier_offers SET factory_name = '${toFactory}'
      WHERE factory_name = '${fromFactory}'
        AND source_file_id IN (SELECT id FROM files WHERE file_name LIKE '${fileLike}')
    `,
    sampleSql: `
      ${SAMPLE_SELECT_PREFIX}
      WHERE so.factory_name = '${fromFactory}'
        AND so.source_file_id IN (SELECT id FROM files WHERE file_name LIKE '${fileLike}')
      ORDER BY f.file_name, p.product_name
      LIMIT 3
    `,
  };
}

function loadTrackedCounts(): FactoryCount[] {
  const inList = TRACKED_FACTORY_NAMES.map((name) => `'${name.replace(/'/g, "''")}'`).join(", ");
  return queryJson<{ factory_name: string; count: number }>(`
    SELECT factory_name, COUNT(*) AS count
    FROM supplier_offers
    WHERE factory_name IN (${inList})
       OR factory_name LIKE '科蒲尔%'
       OR factory_name LIKE '优泽%'
       OR factory_name LIKE '瑞雪%'
       OR factory_name LIKE '凯益德%'
       OR factory_name LIKE '名威 支架%'
       OR factory_name LIKE 'NOVA%名威%'
    GROUP BY factory_name
    ORDER BY factory_name
  `).map((row) => ({ factory_name: row.factory_name, count: Number(row.count) }));
}

function queryJson<T>(sql: string): T[] {
  const output = execFileSync("sqlite3", ["-json", DB_PATH, sql], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  }).trim();
  if (!output) return [];
  return JSON.parse(output) as T[];
}

function executeUpdate(sql: string): number {
  const rows = queryJson<{ changes: number }>(`
    PRAGMA foreign_keys = ON;
    ${sql};
    SELECT changes() AS changes;
  `);
  return Number(rows[0]?.changes ?? 0);
}

function buildReport(data: ReportData): string {
  const beforeMap = countMap(data.beforeCounts);
  const afterMap = countMap(data.afterCounts);
  const abnormalNames = [
    "太阳能壁灯草坪灯",
    "广交会最终核价",
    "核价 发客户",
    "sample data",
    ...data.beforeCounts
      .map((row) => row.factory_name)
      .filter((name) =>
        name.startsWith("科蒲尔") ||
        name.startsWith("优泽") ||
        name.startsWith("瑞雪") ||
        name.startsWith("凯益德") ||
        name.startsWith("名威 支架") ||
        name.startsWith("NOVA"),
      ),
  ];
  const uniqueAbnormalNames = [...new Set(abnormalNames)];

  return [
    "# V30.2 工厂名修正报告",
    "",
    `Generated: ${data.generatedAt}`,
    "",
    "## 备份",
    `路径: ${data.backupPath}`,
    "",
    "## 执行结果",
    "",
    markdownTable(
      ["组", "映射", "预期", "实际", "状态"],
      data.results.map((result) => [
        result.group,
        `${result.label}`,
        result.expected,
        result.actual,
        result.expected === result.actual ? "✓" : "✗",
      ]),
    ),
    "",
    "## 修正前后对比",
    "",
    markdownTable(
      ["异常 factory_name", "修正前条数", "修正后条数", "变化"],
      uniqueAbnormalNames.map((name) => {
        const before = beforeMap.get(name) ?? 0;
        const after = afterMap.get(name) ?? 0;
        return [name, before, after, signed(after - before)];
      }),
    ),
    "",
    "## 修正后目标工厂计数",
    "",
    markdownTable(
      ["factory_name", "修正前条数", "修正后条数", "变化"],
      ["博登", "巨鑫", "羽成", "欣益进", "精友", "晟高", "科蒲尔", "优泽", "瑞雪", "凯益德", "名威", "华浦", "汇孚", "巨登"].map((name) => {
        const before = beforeMap.get(name) ?? 0;
        const after = afterMap.get(name) ?? 0;
        return [name, before, after, signed(after - before)];
      }),
    ),
    "",
    "## 抽检样本",
    "",
    ...data.results.flatMap((result) => buildSampleSection(result)),
    "## 不动的记录",
    "",
    "- Wellux/Welfull 来源的 `太阳能壁灯草坪灯` 记录未修改。",
    "- `跨境产品` 未修改。",
    "- `sample data` 非汇孚来源未修改。",
    "- 其他无法从文件名高置信度确认的工厂名未修改。",
    "",
    "## 约束确认",
    "",
    "- 已先备份数据库，再执行 UPDATE。",
    "- 未修改价格数据。",
    "- 未修改 src/ 文件或源 Excel 文件。",
    "- 所有 Group A/C UPDATE 均通过 `source_file_id` 匹配 `files.file_name`。",
    "",
  ].join("\n");
}

function buildSampleSection(result: MappingResult): string[] {
  return [
    `### ${result.group} ${result.label}`,
    "",
    markdownTable(
      ["product_name", "model_no", "旧工厂名", "新工厂名", "源文件名"],
      result.samples.map((sample) => [
        sample.product_name ?? "-",
        sample.model_no ?? "-",
        sample.old_factory_name ?? "-",
        sample.new_factory_name ?? "-",
        sample.file_name ?? "-",
      ]),
    ),
    "",
  ];
}

function countMap(rows: FactoryCount[]): Map<string, number> {
  return new Map(rows.map((row) => [row.factory_name, Number(row.count)]));
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
