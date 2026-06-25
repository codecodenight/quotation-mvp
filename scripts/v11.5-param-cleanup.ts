import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

import { escapeMd } from "./v11-shared";

const prisma = new PrismaClient();

const REPORT_PATH = path.join("docs", "v11.5-param-cleanup-report.md");
const BACKUP_PATH = path.join("prisma", "dev.db.bak-v11.5");
const APPLY_MODE = process.argv.includes("--apply");
const DELETE_BATCH_SIZE = 500;

type BadParam = {
  id: string;
  product_id: string;
  param_key: string;
  raw_value: string;
  normalized_value: string | null;
  model_no: string | null;
  category: string | null;
};

type BadParamType = "价格当参数" | "颜色名当 CCT" | "加价当 CCT" | "CCT 数值异常";

type TypeStats = {
  type: BadParamType;
  paramKey: string;
  count: number;
  examples: string[];
};

async function main() {
  if (!existsSync(BACKUP_PATH)) {
    throw new Error(`Missing DB backup: ${BACKUP_PATH}`);
  }

  const beforeParams = await prisma.productParam.count();
  const badParams = await findBadParams();
  const deleted = APPLY_MODE ? await deleteBadParams(badParams) : 0;
  const afterParams = await prisma.productParam.count();

  await mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await writeFile(
    REPORT_PATH,
    buildReport({
      mode: APPLY_MODE ? "apply" : "dry-run",
      badParams,
      deleted,
      beforeParams,
      afterParams,
    }),
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        mode: APPLY_MODE ? "apply" : "dry-run",
        reportPath: REPORT_PATH,
        detectedBadParams: badParams.length,
        deleted,
        productParamsBefore: beforeParams,
        productParamsAfter: afterParams,
      },
      null,
      2,
    ),
  );

  await prisma.$disconnect();
}

async function findBadParams(): Promise<BadParam[]> {
  return prisma.$queryRaw<BadParam[]>`
    SELECT pp.id,
           pp.product_id,
           pp.param_key,
           pp.raw_value,
           pp.normalized_value,
           p.model_no,
           p.category
    FROM product_params pp
    JOIN products p ON p.id = pp.product_id
    WHERE pp.source_field = 'reverse_match'
      AND (
        pp.raw_value LIKE '￥%'
        OR pp.raw_value LIKE '¥%'
        OR pp.raw_value LIKE 'US$%'
        OR pp.raw_value LIKE 'US $%'
        OR (pp.param_key = 'cct' AND pp.raw_value IN (
          'Red','Green','Bule','Blue','Flag Color','RGB+W/C','RGBW',
          'RGB','任意','单色','CCT','白光','暖光','冷光'
        ))
        OR (pp.param_key = 'cct' AND pp.raw_value LIKE '加%元')
        OR (
          pp.param_key = 'cct'
          AND pp.normalized_value IS NOT NULL
          AND pp.normalized_value NOT LIKE '%-%'
          AND CAST(pp.normalized_value AS REAL) > 0
          AND CAST(pp.normalized_value AS REAL) < 1000
        )
      )
    ORDER BY pp.param_key, pp.raw_value, p.category, p.model_no
  `;
}

async function deleteBadParams(badParams: BadParam[]): Promise<number> {
  let deleted = 0;
  const ids = badParams.map((param) => param.id);
  for (let index = 0; index < ids.length; index += DELETE_BATCH_SIZE) {
    const chunk = ids.slice(index, index + DELETE_BATCH_SIZE);
    const result = await prisma.productParam.deleteMany({ where: { id: { in: chunk } } });
    deleted += result.count;
  }
  return deleted;
}

function classifyBadParam(param: BadParam): BadParamType {
  if (/^(?:￥|¥|US\$|US \$)/i.test(param.raw_value)) return "价格当参数";
  if (param.param_key === "cct" && /^加.*元/.test(param.raw_value)) return "加价当 CCT";
  if (param.param_key === "cct" && isColorCctValue(param.raw_value)) return "颜色名当 CCT";
  return "CCT 数值异常";
}

function isColorCctValue(rawValue: string): boolean {
  return new Set(["Red", "Green", "Bule", "Blue", "Flag Color", "RGB+W/C", "RGBW", "RGB", "任意", "单色", "CCT", "白光", "暖光", "冷光"]).has(rawValue);
}

function buildTypeStats(badParams: BadParam[]): TypeStats[] {
  const stats = new Map<string, TypeStats>();
  for (const param of badParams) {
    const type = classifyBadParam(param);
    const key = `${type}\t${param.param_key}`;
    const stat = stats.get(key) ?? { type, paramKey: param.param_key, count: 0, examples: [] };
    stat.count += 1;
    if (stat.examples.length < 5 && !stat.examples.includes(param.raw_value)) stat.examples.push(param.raw_value);
    stats.set(key, stat);
  }
  return [...stats.values()].sort((left, right) => right.count - left.count || left.type.localeCompare(right.type) || left.paramKey.localeCompare(right.paramKey));
}

function buildReport(input: { mode: "dry-run" | "apply"; badParams: BadParam[]; deleted: number; beforeParams: number; afterParams: number }): string {
  const typeStats = buildTypeStats(input.badParams);

  return `# V11.5 参数清理报告

模式: ${input.mode}
时间: ${new Date().toISOString()}
备份: ${BACKUP_PATH}

## 汇总

| 指标 | 数值 |
|---|---:|
| 检测到脏数据 | ${input.badParams.length.toLocaleString()} |
| 删除 | ${input.deleted.toLocaleString()} |
| product_params 变化 | ${input.beforeParams.toLocaleString()} → ${input.afterParams.toLocaleString()} |

## 按脏数据类型

| 类型 | param_key | 数量 | 示例 raw_value |
|---|---|---:|---|
${typeStats.map((stat) => `| ${escapeMd(stat.type)} | ${escapeMd(stat.paramKey)} | ${stat.count.toLocaleString()} | ${escapeMd(stat.examples.join(" / "))} |`).join("\n")}

## 删除采样（全部，≤200）

| param_key | raw_value | normalized_value | model_no | category |
|---|---|---|---|---|
${input.badParams
  .slice(0, 200)
  .map((param) => `| ${escapeMd(param.param_key)} | ${escapeMd(param.raw_value)} | ${escapeMd(param.normalized_value ?? "-")} | ${escapeMd(param.model_no ?? "-")} | ${escapeMd(param.category ?? "(未分类)")} |`)
  .join("\n")}
`;
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
