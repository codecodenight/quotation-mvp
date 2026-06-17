import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

import { escapeMd } from "./v11-shared";

const prisma = new PrismaClient();

const APPLY_MODE = process.argv.includes("--apply");
const BACKUP_PATH = path.join("prisma", "dev.db.bak-v12.2");
const REPORT_PATH = path.join("docs", "v12.2-param-normalize-report.md");
const NORMALIZE_KEYS = new Set(["voltage", "cri", "ip", "cct", "pf"]);
const UPDATE_BATCH_SIZE = 250;
const DELETE_BATCH_SIZE = 500;

const CONFIDENCE_RANK: Record<string, number> = {
  high: 4,
  medium: 3,
  low: 2,
  inferred: 1,
};

const SOURCE_RANK: Record<string, number> = {
  excel_column: 10,
  excel_multirow: 9,
  excel_header: 8,
  column_header_value: 8,
  reverse_match: 7,
  title_row: 6,
  product_name: 5,
  product_name_v2: 5,
  model_no: 4,
  sheet_name: 3,
  derived: 2,
  file_propagation: 1,
  file_propagation_70: 1,
  category_inference: 0,
};

type DbCount = bigint | number | null;

type ParamRow = {
  id: string;
  product_id: string;
  param_key: string;
  raw_value: string;
  normalized_value: string | null;
  unit: string | null;
  source_field: string;
  confidence: string;
  model_no: string | null;
  product_name: string;
};

type Counts = {
  productParams: number;
};

type NormalizeChange = {
  row: ParamRow;
  nextNormalizedValue: string | null;
  nextUnit: string | null;
};

type NormalizeSummary = {
  scanned: Map<string, number>;
  changes: NormalizeChange[];
  samples: NormalizeChange[];
};

type DuplicateGroup = {
  key: string;
  paramKey: string;
  normalizedValue: string;
  rows: ParamRow[];
  keep: ParamRow;
  deleteRows: ParamRow[];
};

type DuplicateSummary = {
  groups: DuplicateGroup[];
  deleteRows: ParamRow[];
  samples: ParamRow[];
};

async function main() {
  if (!existsSync(BACKUP_PATH)) {
    throw new Error(`Missing DB backup: ${BACKUP_PATH}`);
  }

  const before = await loadCounts();
  const rows = await loadParamRows();
  const normalizeSummary = planNormalization(rows);
  const effectiveRows = applyEffectiveNormalization(rows, normalizeSummary.changes);
  const duplicateSummary = planDuplicateDeletion(effectiveRows);

  let updated = 0;
  let deleted = 0;

  if (APPLY_MODE) {
    updated = await applyNormalization(normalizeSummary.changes);
    deleted = await deleteDuplicateRows(duplicateSummary.deleteRows);
  }

  const after = await loadCounts();
  await writeReport({
    mode: APPLY_MODE ? "apply" : "dry-run",
    before,
    after,
    normalizeSummary,
    duplicateSummary,
    updated,
    deleted,
  });

  console.log(
    JSON.stringify(
      {
        mode: APPLY_MODE ? "apply" : "dry-run",
        reportPath: REPORT_PATH,
        normalizeChanges: normalizeSummary.changes.length,
        duplicateDeletes: duplicateSummary.deleteRows.length,
        updated,
        deleted,
        productParamsBefore: before.productParams,
        productParamsAfter: after.productParams,
      },
      null,
      2,
    ),
  );
}

async function loadCounts(): Promise<Counts> {
  const rows = await prisma.$queryRawUnsafe<Array<{ product_params: DbCount }>>(
    "SELECT COUNT(*) as product_params FROM product_params",
  );
  return { productParams: toNumber(rows[0]?.product_params) };
}

async function loadParamRows(): Promise<ParamRow[]> {
  return prisma.$queryRawUnsafe<ParamRow[]>(`
    SELECT
      pp.id,
      pp.product_id,
      pp.param_key,
      pp.raw_value,
      pp.normalized_value,
      pp.unit,
      pp.source_field,
      pp.confidence,
      p.model_no,
      p.product_name
    FROM product_params pp
    JOIN products p ON p.id = pp.product_id
  `);
}

function planNormalization(rows: ParamRow[]): NormalizeSummary {
  const scanned = new Map<string, number>();
  const changes: NormalizeChange[] = [];

  for (const row of rows) {
    if (!NORMALIZE_KEYS.has(row.param_key)) {
      continue;
    }

    scanned.set(row.param_key, (scanned.get(row.param_key) ?? 0) + 1);
    const normalized = normalizeParam(row);
    if (!normalized) {
      continue;
    }

    if (normalized.normalizedValue !== row.normalized_value || normalized.unit !== row.unit) {
      changes.push({
        row,
        nextNormalizedValue: normalized.normalizedValue,
        nextUnit: normalized.unit,
      });
    }
  }

  return {
    scanned,
    changes,
    samples: changes.slice(0, 30),
  };
}

function normalizeParam(row: ParamRow): { normalizedValue: string | null; unit: string | null } | null {
  const value = (row.normalized_value ?? "").trim();
  if (!value) {
    return null;
  }

  switch (row.param_key) {
    case "voltage":
      return normalizeVoltage(value, row.unit);
    case "cri":
      return normalizeCri(value, row.unit);
    case "ip":
      return normalizeIp(value, row.unit);
    case "cct":
      return normalizeCct(value, row.unit);
    case "pf":
      return normalizePf(value, row.unit);
    default:
      return null;
  }
}

function normalizeVoltage(value: string, unit: string | null): { normalizedValue: string; unit: string } | null {
  const normalizedText = value.replace(/[~–]/g, "-").replace(/\s+/g, "");
  const match = normalizedText.match(/^(?:AC|DC)?(\d+(?:-\d+)?)V?$/i);
  if (!match) {
    return null;
  }
  return { normalizedValue: match[1], unit: "V" };
}

function normalizeCri(value: string, unit: string | null): { normalizedValue: string; unit: string | null } | null {
  const match = value.trim().match(/^(?:Ra)?\s*(\d+(?:\.00)?)$/i);
  if (!match) {
    return null;
  }
  const normalizedValue = match[1].replace(/\.00$/, "");
  return { normalizedValue, unit };
}

function normalizeIp(value: string, unit: string | null): { normalizedValue: string; unit: string | null } | null {
  const match = value.trim().match(/^IP\s*(X?\d+)$/i);
  if (!match) {
    return null;
  }
  return { normalizedValue: match[1].toUpperCase(), unit };
}

function normalizeCct(value: string, unit: string | null): { normalizedValue: string; unit: string | null } | null {
  if (/^(?:CCT|tunable|3CCT)$/i.test(value.trim())) {
    return null;
  }

  const match = value.trim().match(/^(\d{4})\s*[-~–]\s*(\d{4,5})$/);
  if (!match) {
    return null;
  }

  const left = Number(match[1]);
  const right = Number(match[2]);
  if (left < 1800 || left > 10000 || right < 1800 || right > 10000 || left <= right) {
    return null;
  }

  return { normalizedValue: `${right}-${left}`, unit };
}

function normalizePf(value: string, unit: string | null): { normalizedValue: string; unit: string | null } | null {
  const match = value.trim().match(/^[>≥=]\s*(0?\.\d+|\d+(?:\.\d+)?)$/);
  if (!match) {
    return null;
  }
  return { normalizedValue: match[1], unit };
}

function applyEffectiveNormalization(rows: ParamRow[], changes: NormalizeChange[]): ParamRow[] {
  const changesById = new Map(changes.map((change) => [change.row.id, change]));
  return rows.map((row) => {
    const change = changesById.get(row.id);
    if (!change) {
      return row;
    }
    return {
      ...row,
      normalized_value: change.nextNormalizedValue,
      unit: change.nextUnit,
    };
  });
}

function planDuplicateDeletion(rows: ParamRow[]): DuplicateSummary {
  const groups = new Map<string, ParamRow[]>();

  for (const row of rows) {
    const normalizedValue = row.normalized_value?.trim();
    if (!normalizedValue) {
      continue;
    }

    const key = `${row.product_id}\u0000${row.param_key}\u0000${normalizedValue}`;
    const existing = groups.get(key) ?? [];
    existing.push(row);
    groups.set(key, existing);
  }

  const duplicateGroups: DuplicateGroup[] = [];
  const deleteRows: ParamRow[] = [];

  for (const [key, groupRows] of groups) {
    if (groupRows.length <= 1) {
      continue;
    }

    const sorted = [...groupRows].sort(compareParamPriority);
    const [keep, ...rest] = sorted;
    duplicateGroups.push({
      key,
      paramKey: keep.param_key,
      normalizedValue: keep.normalized_value ?? "",
      rows: sorted,
      keep,
      deleteRows: rest,
    });
    deleteRows.push(...rest);
  }

  return {
    groups: duplicateGroups,
    deleteRows,
    samples: deleteRows.slice(0, 30),
  };
}

function compareParamPriority(left: ParamRow, right: ParamRow): number {
  const confidenceDelta = rankConfidence(right.confidence) - rankConfidence(left.confidence);
  if (confidenceDelta !== 0) {
    return confidenceDelta;
  }

  const sourceDelta = rankSource(right.source_field) - rankSource(left.source_field);
  if (sourceDelta !== 0) {
    return sourceDelta;
  }

  return left.id.localeCompare(right.id);
}

function rankConfidence(confidence: string): number {
  return CONFIDENCE_RANK[confidence] ?? 0;
}

function rankSource(sourceField: string): number {
  return SOURCE_RANK[sourceField] ?? 0;
}

async function applyNormalization(changes: NormalizeChange[]): Promise<number> {
  let updated = 0;
  for (let index = 0; index < changes.length; index += UPDATE_BATCH_SIZE) {
    const batch = changes.slice(index, index + UPDATE_BATCH_SIZE);
    await Promise.all(
      batch.map((change) =>
        prisma.productParam.update({
          where: { id: change.row.id },
          data: {
            normalizedValue: change.nextNormalizedValue,
            unit: change.nextUnit,
          },
        }),
      ),
    );
    updated += batch.length;
  }
  return updated;
}

async function deleteDuplicateRows(rows: ParamRow[]): Promise<number> {
  let deleted = 0;
  for (let index = 0; index < rows.length; index += DELETE_BATCH_SIZE) {
    const batch = rows.slice(index, index + DELETE_BATCH_SIZE);
    const result = await prisma.productParam.deleteMany({
      where: {
        id: {
          in: batch.map((row) => row.id),
        },
      },
    });
    deleted += result.count;
  }
  return deleted;
}

async function writeReport(input: {
  mode: "dry-run" | "apply";
  before: Counts;
  after: Counts;
  normalizeSummary: NormalizeSummary;
  duplicateSummary: DuplicateSummary;
  updated: number;
  deleted: number;
}) {
  await mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await writeFile(REPORT_PATH, buildReport(input), "utf8");
}

function buildReport(input: {
  mode: "dry-run" | "apply";
  before: Counts;
  after: Counts;
  normalizeSummary: NormalizeSummary;
  duplicateSummary: DuplicateSummary;
  updated: number;
  deleted: number;
}): string {
  const normalizeByKey = groupNormalizeChanges(input.normalizeSummary.changes);
  const duplicateByKey = groupDuplicateDeletes(input.duplicateSummary.groups);

  const lines: string[] = [];
  lines.push("# V12.2 参数值标准化 + 去重报告");
  lines.push("");
  lines.push(`模式: ${input.mode}`);
  lines.push(`时间: ${new Date().toISOString()}`);
  lines.push(`备份: ${BACKUP_PATH}`);
  lines.push("");
  lines.push("## Part A — 标准化");
  lines.push("");
  lines.push("| param_key | 扫描记录 | 修改记录 | 示例变更 |");
  lines.push("|---|---:|---:|---|");
  for (const paramKey of ["voltage", "cri", "ip", "cct", "pf"]) {
    const changes = normalizeByKey.get(paramKey) ?? [];
    lines.push(
      `| ${paramKey} | ${(input.normalizeSummary.scanned.get(paramKey) ?? 0).toLocaleString()} | ${changes.length.toLocaleString()} | ${escapeMd(
        formatExampleChange(changes[0]),
      )} |`,
    );
  }
  lines.push("");
  lines.push("### Part A 修改采样（前 30 条）");
  lines.push("");
  lines.push("| param_key | 原 normalized_value | 新 normalized_value | product model_no |");
  lines.push("|---|---|---|---|");
  for (const sample of input.normalizeSummary.samples) {
    lines.push(
      `| ${sample.row.param_key} | ${escapeMd(sample.row.normalized_value ?? "")} | ${escapeMd(sample.nextNormalizedValue ?? "")} | ${escapeMd(
        sample.row.model_no ?? sample.row.product_name,
      )} |`,
    );
  }
  if (input.normalizeSummary.samples.length === 0) {
    lines.push("| - | - | - | - |");
  }
  lines.push("");
  lines.push("## Part B — 去重");
  lines.push("");
  lines.push("| param_key | 重复组数 | 删除记录 |");
  lines.push("|---|---:|---:|");
  for (const [paramKey, summary] of Array.from(duplicateByKey.entries()).sort(([left], [right]) => left.localeCompare(right))) {
    lines.push(`| ${paramKey} | ${summary.groups.toLocaleString()} | ${summary.deleteRows.toLocaleString()} |`);
  }
  if (duplicateByKey.size === 0) {
    lines.push("| - | 0 | 0 |");
  }
  lines.push("");
  lines.push("### Part B 删除采样（前 30 条）");
  lines.push("");
  lines.push("| param_key | normalized_value | source_field | confidence | product model_no |");
  lines.push("|---|---|---|---|---|");
  for (const sample of input.duplicateSummary.samples) {
    lines.push(
      `| ${sample.param_key} | ${escapeMd(sample.normalized_value ?? "")} | ${escapeMd(sample.source_field)} | ${escapeMd(
        sample.confidence,
      )} | ${escapeMd(sample.model_no ?? sample.product_name)} |`,
    );
  }
  if (input.duplicateSummary.samples.length === 0) {
    lines.push("| - | - | - | - | - |");
  }
  lines.push("");
  lines.push("## 汇总");
  lines.push("");
  lines.push("| 指标 | 数值 |");
  lines.push("|---|---:|");
  lines.push(`| Part A 修改记录 | ${(input.mode === "apply" ? input.updated : input.normalizeSummary.changes.length).toLocaleString()} |`);
  lines.push(`| Part B 删除记录 | ${(input.mode === "apply" ? input.deleted : input.duplicateSummary.deleteRows.length).toLocaleString()} |`);
  lines.push(`| product_params 变化 | ${input.before.productParams.toLocaleString()} → ${input.after.productParams.toLocaleString()} |`);
  lines.push("");
  lines.push("## 说明");
  lines.push("");
  lines.push("- Part A 只修改 normalized_value 和 voltage 的 unit，不修改 raw_value。");
  lines.push("- Part B 只删除同一 product_id + param_key + normalized_value 的重复记录，不删除不同 normalized_value 的多值参数。");
  lines.push("- 去重保留规则：confidence DESC → source_field 优先级 DESC → id ASC。");
  lines.push("");
  return lines.join("\n");
}

function groupNormalizeChanges(changes: NormalizeChange[]): Map<string, NormalizeChange[]> {
  const grouped = new Map<string, NormalizeChange[]>();
  for (const change of changes) {
    const existing = grouped.get(change.row.param_key) ?? [];
    existing.push(change);
    grouped.set(change.row.param_key, existing);
  }
  return grouped;
}

function groupDuplicateDeletes(groups: DuplicateGroup[]): Map<string, { groups: number; deleteRows: number }> {
  const grouped = new Map<string, { groups: number; deleteRows: number }>();
  for (const group of groups) {
    const existing = grouped.get(group.paramKey) ?? { groups: 0, deleteRows: 0 };
    existing.groups += 1;
    existing.deleteRows += group.deleteRows.length;
    grouped.set(group.paramKey, existing);
  }
  return grouped;
}

function formatExampleChange(change: NormalizeChange | undefined): string {
  if (!change) {
    return "-";
  }
  return `${change.row.normalized_value ?? ""} → ${change.nextNormalizedValue ?? ""}`;
}

function toNumber(value: DbCount): number {
  if (typeof value === "bigint") {
    return Number(value);
  }
  return value ?? 0;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
