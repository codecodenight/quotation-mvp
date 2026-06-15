import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const REPORT_PATH = path.join("docs", "v2.26-long-model-report.md");

type LongModelProduct = {
  id: string;
  product_name: string;
  category: string | null;
  model_no: string;
  remark: string | null;
  factory_name: string | null;
  file_name: string | null;
  relative_path: string | null;
  watts: string | null;
};

type CleanupPlan = LongModelProduct & {
  oldModelLength: number;
  factoryShort: string;
  categoryCode: string;
  newModelNo: string;
  remarkWillUpdate: boolean;
};

type Counts = {
  products: number;
  longModels: number;
  supplierOffers: number;
};

async function main() {
  const before = await getCounts();
  const targets = await loadTargets();
  const plan = await buildCleanupPlan(targets);
  let backupPath: string | null = null;
  let updatedProducts = 0;

  if (APPLY && plan.length > 0) {
    backupPath = await backupDatabase();
    await prisma.$transaction(async (tx) => {
      for (const item of plan) {
        const result = await tx.product.update({
          where: { id: item.id },
          data: {
            modelNo: item.newModelNo,
            remark: item.remarkWillUpdate ? item.model_no : item.remark,
          },
        });
        if (result.id) {
          updatedProducts += 1;
        }
      }
    });
  }

  const after = await getCounts();
  const remainingTargetIssues = await verifyTargetRemarksAndLengths(plan);
  const duplicateRows = await findSameCategoryDuplicates(plan.map((item) => item.newModelNo));
  const verification = {
    longModelsRemoved: APPLY ? after.longModels === 0 : after.longModels === before.longModels,
    supplierOffersUnchanged: after.supplierOffers === before.supplierOffers,
    targetRemarksPresent: remainingTargetIssues.length === 0,
    newModelNosUniqueInCategory: duplicateRows.length === 0,
    dryRunUnchanged: APPLY ? true : JSON.stringify(before) === JSON.stringify(after),
  };

  await writeFile(
    REPORT_PATH,
    buildReport({
      mode: APPLY ? "apply" : "dry-run",
      backupPath,
      before,
      after,
      plan,
      updatedProducts,
      remainingTargetIssues,
      duplicateRows,
      verification,
    }),
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        reportPath: REPORT_PATH,
        mode: APPLY ? "apply" : "dry-run",
        backupPath,
        targets: plan.length,
        updatedProducts,
        beforeLongModels: before.longModels,
        afterLongModels: after.longModels,
        verificationPass: Object.values(verification).every(Boolean),
      },
      null,
      2,
    ),
  );
}

async function getCounts(): Promise<Counts> {
  const [products, longModelsRow, supplierOffers] = await Promise.all([
    prisma.product.count(),
    prisma.$queryRaw<Array<{ cnt: number | bigint }>>`
      SELECT COUNT(*) AS cnt
      FROM products
      WHERE model_no IS NOT NULL AND LENGTH(model_no) > 200
    `,
    prisma.supplierOffer.count(),
  ]);

  return {
    products,
    longModels: toNumber(longModelsRow[0]?.cnt),
    supplierOffers,
  };
}

async function loadTargets(): Promise<LongModelProduct[]> {
  return prisma.$queryRaw<LongModelProduct[]>`
    SELECT
      p.id,
      p.product_name,
      p.category,
      p.model_no,
      p.remark,
      so.factory_name,
      f.file_name,
      f.relative_path,
      (
        SELECT pp.normalized_value
        FROM product_params pp
        WHERE pp.product_id = p.id
          AND pp.param_key = 'watts'
          AND pp.normalized_value IS NOT NULL
          AND TRIM(pp.normalized_value) <> ''
        ORDER BY pp.confidence DESC, pp.id
        LIMIT 1
      ) AS watts
    FROM products p
    LEFT JOIN supplier_offers so ON so.id = (
      SELECT so2.id
      FROM supplier_offers so2
      WHERE so2.product_id = p.id
      ORDER BY so2.created_at, so2.id
      LIMIT 1
    )
    LEFT JOIN files f ON f.id = so.source_file_id
    WHERE p.model_no IS NOT NULL
      AND LENGTH(p.model_no) > 200
    ORDER BY p.category, f.relative_path, LENGTH(p.model_no) DESC, p.id
  `;
}

async function buildCleanupPlan(targets: LongModelProduct[]): Promise<CleanupPlan[]> {
  const existingByCategory = new Map<string, Set<string>>();
  const categoryList = Array.from(new Set(targets.map((target) => target.category ?? "")));

  for (const category of categoryList) {
    const rows = await prisma.product.findMany({
      where: {
        category: category || null,
        id: { notIn: targets.map((target) => target.id) },
        modelNo: { not: null },
      },
      select: { modelNo: true },
    });
    existingByCategory.set(category, new Set(rows.map((row) => row.modelNo).filter(Boolean) as string[]));
  }

  const sequenceByBase = new Map<string, number>();
  const plan: CleanupPlan[] = [];

  for (const target of targets) {
    const category = target.category ?? "";
    const used = existingByCategory.get(category) ?? new Set<string>();
    existingByCategory.set(category, used);

    const factoryShort = inferFactoryShort(target);
    const categoryCode = getCategoryCode(target.category);
    const watts = cleanWatts(target.watts);
    const base = watts ? `${factoryShort}-${categoryCode}-${watts}W` : `${factoryShort}-${categoryCode}`;
    const sequenceKey = `${category}::${base}`;
    let sequence = (sequenceByBase.get(sequenceKey) ?? 0) + 1;
    let candidate = `${base}-${sequence}`;

    while (used.has(candidate)) {
      sequence += 1;
      candidate = `${base}-${sequence}`;
    }

    sequenceByBase.set(sequenceKey, sequence);
    used.add(candidate);

    plan.push({
      ...target,
      oldModelLength: target.model_no.length,
      factoryShort,
      categoryCode,
      newModelNo: candidate,
      remarkWillUpdate: !target.remark || target.remark.trim() === "",
    });
  }

  return plan;
}

function inferFactoryShort(target: LongModelProduct): string {
  const text = `${target.relative_path ?? ""}/${target.file_name ?? ""}/${target.factory_name ?? ""}`;
  const known = ["博登", "欣益进", "欣益", "汇孚"];
  const matched = known.find((name) => text.includes(name));
  if (matched) {
    return firstChineseChars(matched, 2);
  }

  const factory = target.factory_name?.replace(/[()（）].*?[)）]/g, "").trim() || "未知";
  return firstChineseChars(factory, 2) || factory.slice(0, 2) || "未知";
}

function getCategoryCode(category: string | null): string {
  if (category === "太阳能壁灯") return "SWL";
  if (category === "灯带") return "STR";
  return (category ?? "CAT").replace(/\s+/g, "").slice(0, 3).toUpperCase() || "CAT";
}

function firstChineseChars(value: string, count: number): string {
  const chars = value.match(/[\u4e00-\u9fff]/g);
  return chars ? chars.slice(0, count).join("") : "";
}

function cleanWatts(value: string | null): string | null {
  if (!value) return null;
  const match = value.match(/\d+(?:\.\d+)?/);
  if (!match) return null;
  const numeric = Number(match[0]);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Number.isInteger(numeric) ? String(numeric) : String(numeric).replace(/0+$/, "").replace(/\.$/, "");
}

async function verifyTargetRemarksAndLengths(plan: CleanupPlan[]) {
  if (plan.length === 0) return [];
  const rows = await prisma.product.findMany({
    where: { id: { in: plan.map((item) => item.id) } },
    select: { id: true, modelNo: true, remark: true },
  });

  return rows.filter(
    (row) => (row.modelNo?.length ?? 0) > 200 || !row.remark || row.remark.trim() === "",
  );
}

async function findSameCategoryDuplicates(modelNos: string[]) {
  if (modelNos.length === 0) return [];
  return prisma.$queryRaw<Array<{ category: string | null; model_no: string; cnt: number | bigint }>>`
    SELECT category, model_no, COUNT(*) AS cnt
    FROM products
    WHERE model_no IN (${Prisma.join(modelNos)})
    GROUP BY category, model_no
    HAVING COUNT(*) > 1
  `;
}

async function backupDatabase(): Promise<string> {
  await mkdir("backups", { recursive: true });
  const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const backupPath = path.join("backups", `dev-before-v2.26-${timestamp}.sqlite`);
  execFileSync("cp", ["prisma/dev.db", backupPath]);
  return backupPath;
}

function buildReport(input: {
  mode: "dry-run" | "apply";
  backupPath: string | null;
  before: Counts;
  after: Counts;
  plan: CleanupPlan[];
  updatedProducts: number;
  remainingTargetIssues: Array<{ id: string; modelNo: string | null; remark: string | null }>;
  duplicateRows: Array<{ category: string | null; model_no: string; cnt: number | bigint }>;
  verification: Record<string, boolean>;
}) {
  const planRows = input.plan
    .map(
      (item) =>
        `| \`${item.id}\` | ${escapeMd(item.factoryShort)} | ${escapeMd(item.category ?? "-")} | ${item.oldModelLength} | ${escapeMd(item.newModelNo)} | ${item.remarkWillUpdate ? "yes" : "no"} | ${escapeMd(item.file_name ?? "-")} |`,
    )
    .join("\n");
  const verificationRows = Object.entries(input.verification)
    .map(([name, pass]) => `| ${name} | ${pass ? "PASS" : "FAIL"} |`)
    .join("\n");

  return `# V2.26 — Long Model Cleanup

Generated: ${new Date().toISOString()}

Mode: **${input.mode}**

Backup: ${input.backupPath ? `\`${input.backupPath}\`` : "(dry-run, none)"}

## Cleanup Plan / Result

| ID | 工厂短名 | 品类 | 旧 model_no 长度 | 新 model_no | remark 是否更新 | 来源文件 |
|---|---|---|---:|---|---|---|
${planRows || "| - | - | - | - | - | - | - |"}

## Counts

| Metric | Before | After |
|---|---:|---:|
| products | ${input.before.products.toLocaleString()} | ${input.after.products.toLocaleString()} |
| long model_no products (>200 chars) | ${input.before.longModels.toLocaleString()} | ${input.after.longModels.toLocaleString()} |
| supplier_offers | ${input.before.supplierOffers.toLocaleString()} | ${input.after.supplierOffers.toLocaleString()} |

- Products updated: ${input.updatedProducts}

## Remaining Issues

- Target rows still long or missing remark: ${input.remainingTargetIssues.length}
- New model_no duplicate rows in same category: ${input.duplicateRows.length}

## Verification

| Check | Result |
|---|---|
${verificationRows}
`;
}

function toNumber(value: number | bigint | null | undefined): number {
  if (value == null) return 0;
  return typeof value === "bigint" ? Number(value) : Number(value);
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
