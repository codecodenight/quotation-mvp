import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const REPORT_PATH = "docs/v5.0e-rematch-report.md";

type Mode = "audit" | "apply";

type ProductRow = {
  id: string;
  model_no: string | null;
  category: string | null;
};

type CustomerQuoteRow = {
  id: number;
  file_id: number;
  row_number: number;
  raw_model: string | null;
  raw_description: string | null;
  sale_price_usd: number | null;
  raw_row_json: string | null;
  relative_path: string;
  sheet_name: string;
  customer_name: string | null;
  quote_date: string | null;
  file_name: string;
};

type Candidate = {
  id: string;
  category: string | null;
  modelNo: string;
};

type MatchMethod =
  | "aggressive-normalized"
  | "category-cross"
  | "prefix-stripped"
  | "raw-row-json"
  | "product-prefix";

type MatchDecision =
  | {
      status: "match";
      method: MatchMethod;
      reason: string;
      product: Candidate;
    }
  | {
      status: "no-match";
      reason: string;
      candidateCount: number;
    };

type RowAnalysis = {
  row: CustomerQuoteRow;
  pathCategory: string | null;
  targetCategory: string | null;
  reason: string;
  product: Candidate | null;
  method: MatchMethod | null;
  rawJsonHintCount: number;
};

type ProductIndex = {
  aggressive: Map<string, Candidate[]>;
  prefix: Map<string, Candidate[]>;
  prefixEntries: Array<{ key: string; candidate: Candidate }>;
};

const CATEGORY_MAP: Record<string, string> = {
  "面板灯": "面板灯",
  "大面板灯": "面板灯",
  "吸顶灯": "吸顶灯",
  "球泡": "球泡",
  "灯带": "灯带",
  "太阳能": "太阳能壁灯",
  "三防灯": "三防灯",
  "线条灯": "线条灯",
  "筒灯": "筒灯",
  "地插灯 太阳能壁灯": "太阳能壁灯",
  "地插灯/太阳能壁灯": "太阳能壁灯",
  "防潮灯": "防潮灯",
  "Highbay": "Highbay",
  "路灯": "路灯",
  "庭院灯": "庭院灯",
  "投光灯": "投光灯",
  "轨道灯": "轨道灯",
  "台灯": "台灯",
  "镜前灯": "镜前灯",
  "灯丝灯": "灯丝灯",
  "壁灯": "壁灯",
  "灯管": "灯管",
  "净化灯": "净化灯",
  "应急灯": "应急灯",
  "五面办公灯-溢利多+ 名威": "五面办公灯",
};

const CATEGORY_ALIASES: Record<string, string[]> = {
  "面板灯": ["面板灯", "大面板灯"],
  "太阳能壁灯": ["太阳能壁灯", "地埋灯/地插灯", "太阳能"],
  "灯管": ["灯管", "支架"],
  "球泡": ["球泡", "G4G9"],
  "线条灯": ["线条灯", "支架"],
};

async function main() {
  const mode = parseMode();
  const [baseline, products, rows] = await Promise.all([loadBaselineCounts(), loadProducts(), loadUnmatchedRows()]);
  const productIndex = buildProductIndex(products);
  const analyses = rows.map((row) => analyzeRow(row, productIndex));
  const plannedMatches = analyses.filter((analysis) => analysis.product);

  let applied = 0;
  if (mode === "apply") {
    applied = await applyMatches(plannedMatches);
  }

  const after = mode === "apply" ? await loadBaselineCounts() : predictAfterCounts(baseline, plannedMatches.length);
  await mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await writeFile(REPORT_PATH, buildReport({ mode, baseline, after, analyses, applied }), "utf8");

  console.log(`Wrote ${REPORT_PATH}`);
  console.log(
    JSON.stringify(
      {
        mode,
        unmatchedRowsAnalyzed: analyses.length,
        plannedMatches: plannedMatches.length,
        applied,
        matchedBefore: baseline.matched,
        matchedAfter: after.matched,
        unmatchedAfter: after.unmatched,
        danglingMatches: await countDanglingMatches(),
      },
      null,
      2,
    ),
  );
}

function parseMode(): Mode {
  const args = new Set(process.argv.slice(2));
  if (args.has("--audit")) return "audit";
  if (args.has("--apply")) return "apply";
  throw new Error("Usage: npx tsx scripts/customer-quote-rematch-v5.0e.ts --audit|--apply");
}

async function loadBaselineCounts() {
  const [row] = await prisma.$queryRawUnsafe<Array<{ total: number; matched: number; unmatched: number }>>(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN matched_product_id IS NOT NULL THEN 1 ELSE 0 END) AS matched,
       SUM(CASE WHEN matched_product_id IS NULL THEN 1 ELSE 0 END) AS unmatched
     FROM customer_quote_rows`,
  );
  return {
    total: Number(row.total),
    matched: Number(row.matched),
    unmatched: Number(row.unmatched),
  };
}

function predictAfterCounts(baseline: Awaited<ReturnType<typeof loadBaselineCounts>>, plannedMatches: number) {
  return {
    total: baseline.total,
    matched: baseline.matched + plannedMatches,
    unmatched: baseline.unmatched - plannedMatches,
  };
}

async function loadProducts(): Promise<ProductRow[]> {
  return prisma.$queryRawUnsafe<ProductRow[]>(
    "SELECT id, model_no, category FROM products WHERE model_no IS NOT NULL AND trim(model_no) <> ''",
  );
}

async function loadUnmatchedRows(): Promise<CustomerQuoteRow[]> {
  return prisma.$queryRawUnsafe<CustomerQuoteRow[]>(
    `SELECT
       cqr.id,
       cqr.file_id,
       cqr.row_number,
       cqr.raw_model,
       cqr.raw_description,
       cqr.sale_price_usd,
       cqr.raw_row_json,
       cqf.relative_path,
       cqf.sheet_name,
       cqf.customer_name,
       cqf.quote_date,
       cqf.file_name
     FROM customer_quote_rows cqr
     JOIN customer_quote_files cqf ON cqf.id = cqr.file_id
     WHERE cqr.matched_product_id IS NULL
     ORDER BY cqr.id`,
  );
}

function buildProductIndex(products: ProductRow[]): ProductIndex {
  const aggressive = new Map<string, Candidate[]>();
  const prefix = new Map<string, Candidate[]>();
  const prefixEntries: Array<{ key: string; candidate: Candidate }> = [];

  for (const product of products) {
    const modelNo = normalizeText(product.model_no);
    if (!isUsableModel(modelNo)) {
      continue;
    }

    const candidate: Candidate = {
      id: product.id,
      category: product.category,
      modelNo,
    };

    for (const key of uniqueKeys(expandedAggressiveKeys(modelNo))) {
      pushMap(aggressive, key, candidate);
      if (isSafePrefixKey(key)) {
        prefixEntries.push({ key, candidate });
      }
    }
    for (const key of uniqueKeys(prefixStrippedKeys(modelNo))) {
      pushMap(prefix, key, candidate);
    }
  }

  return { aggressive, prefix, prefixEntries };
}

function analyzeRow(row: CustomerQuoteRow, productIndex: ProductIndex): RowAnalysis {
  const rawModel = normalizeText(row.raw_model);
  const pathCategory = extractPathCategory(row.relative_path);
  const targetCategory = resolveTargetCategory(pathCategory);
  const rawJsonHintCount = row.raw_model == null || rawModel.length === 0 ? countRawJsonModelHints(row.raw_row_json) : 0;

  const rejectReason = rejectRawModel(rawModel);
  if (rejectReason) {
    if (rejectReason === "无 raw_model") {
      const rawJsonDecision = chooseCandidateFromRawJson(row.raw_row_json, productIndex, targetCategory);
      if (rawJsonDecision.status === "match") {
        return {
          row,
          pathCategory,
          targetCategory,
          reason: rawJsonDecision.reason,
          product: rawJsonDecision.product,
          method: rawJsonDecision.method,
          rawJsonHintCount,
        };
      }
    }
    return {
      row,
      pathCategory,
      targetCategory,
      reason: rejectReason,
      product: null,
      method: null,
      rawJsonHintCount,
    };
  }

  const aggressiveDecision = chooseCandidateFromKeys({
    index: productIndex.aggressive,
    keys: expandedAggressiveKeys(rawModel),
    targetCategory,
    preferredMethod: "aggressive-normalized",
  });
  if (aggressiveDecision.status === "match") {
    return {
      row,
      pathCategory,
      targetCategory,
      reason: aggressiveDecision.reason,
      product: aggressiveDecision.product,
      method: aggressiveDecision.method,
      rawJsonHintCount,
    };
  }

  const prefixDecision = chooseCandidateFromKeys({
    index: productIndex.prefix,
    keys: prefixStrippedKeys(rawModel),
    targetCategory,
    preferredMethod: "prefix-stripped",
  });
  if (prefixDecision.status === "match") {
    return {
      row,
      pathCategory,
      targetCategory,
      reason: prefixDecision.reason,
      product: prefixDecision.product,
      method: prefixDecision.method,
      rawJsonHintCount,
    };
  }

  const productPrefixDecision = chooseProductPrefixCandidate({
    index: productIndex,
    keys: expandedAggressiveKeys(rawModel),
    targetCategory,
  });
  if (productPrefixDecision.status === "match") {
    return {
      row,
      pathCategory,
      targetCategory,
      reason: productPrefixDecision.reason,
      product: productPrefixDecision.product,
      method: productPrefixDecision.method,
      rawJsonHintCount,
    };
  }

  return {
    row,
    pathCategory,
    targetCategory,
    reason: moreSpecificNoMatchReason(rawModel, aggressiveDecision, prefixDecision, productPrefixDecision),
    product: null,
    method: null,
    rawJsonHintCount,
  };
}

function chooseCandidateFromKeys(input: {
  index: Map<string, Candidate[]>;
  keys: string[];
  targetCategory: string | null;
  preferredMethod: MatchMethod;
}): MatchDecision {
  const candidates = uniqueCandidates(input.keys.flatMap((key) => input.index.get(key) ?? []));
  if (candidates.length === 0) {
    return { status: "no-match", reason: "真正无候选", candidateCount: 0 };
  }

  const scoped = scopedCandidates(candidates, input.targetCategory);
  if (scoped.length === 1) {
    return {
      status: "match",
      method: scoped[0].category === input.targetCategory ? input.preferredMethod : "category-cross",
      reason: scoped[0].category === input.targetCategory ? labelForMethod(input.preferredMethod) : "品类交叉唯一命中",
      product: scoped[0],
    };
  }
  if (scoped.length > 1) {
    return { status: "no-match", reason: `候选不唯一（${scoped.length}）`, candidateCount: scoped.length };
  }

  if (input.targetCategory && candidates.length === 1) {
    return {
      status: "match",
      method: "category-cross",
      reason: "品类交叉唯一命中",
      product: candidates[0],
    };
  }

  return { status: "no-match", reason: `候选不唯一（${candidates.length}）`, candidateCount: candidates.length };
}

function chooseCandidateFromRawJson(
  rawJson: string | null,
  productIndex: ProductIndex,
  targetCategory: string | null,
): MatchDecision {
  const hints = uniqueKeys(extractLabeledModelValues(rawJson));
  if (hints.length === 0) {
    return { status: "no-match", reason: "raw_row_json 无款号候选", candidateCount: 0 };
  }

  const matchedProducts: Candidate[] = [];
  for (const hint of hints) {
    const decision = chooseCandidateFromKeys({
      index: productIndex.aggressive,
      keys: expandedAggressiveKeys(hint),
      targetCategory,
      preferredMethod: "raw-row-json",
    });
    if (decision.status === "match") {
      matchedProducts.push(decision.product);
    }
    const prefixDecision = chooseProductPrefixCandidate({
      index: productIndex,
      keys: expandedAggressiveKeys(hint),
      targetCategory,
    });
    if (prefixDecision.status === "match") {
      matchedProducts.push(prefixDecision.product);
    }
  }

  const uniqueProducts = uniqueCandidates(matchedProducts);
  if (uniqueProducts.length === 1) {
    const product = uniqueProducts[0];
    return {
      status: "match",
      method: product.category === targetCategory ? "raw-row-json" : "category-cross",
      reason: product.category === targetCategory ? "raw_row_json 款号唯一命中" : "raw_row_json 品类交叉唯一命中",
      product,
    };
  }
  if (uniqueProducts.length > 1) {
    return {
      status: "no-match",
      reason: `raw_row_json 候选不唯一（${uniqueProducts.length}）`,
      candidateCount: uniqueProducts.length,
    };
  }
  return { status: "no-match", reason: "raw_row_json 无唯一命中", candidateCount: 0 };
}

function chooseProductPrefixCandidate(input: {
  index: ProductIndex;
  keys: string[];
  targetCategory: string | null;
}): MatchDecision {
  const products: Candidate[] = [];
  for (const rawKey of uniqueKeys(input.keys).filter(isSafePrefixKey)) {
    for (const entry of input.index.prefixEntries) {
      if (rawKey.length <= entry.key.length) {
        continue;
      }
      if (rawKey.startsWith(entry.key)) {
        products.push(entry.candidate);
      }
    }
  }

  const candidates = uniqueCandidates(products);
  if (candidates.length === 0) {
    return { status: "no-match", reason: "真正无候选", candidateCount: 0 };
  }

  const scoped = scopedCandidates(candidates, input.targetCategory);
  if (scoped.length === 1) {
    return {
      status: "match",
      method: scoped[0].category === input.targetCategory ? "product-prefix" : "category-cross",
      reason: scoped[0].category === input.targetCategory ? "长款号前缀唯一命中" : "长款号品类交叉唯一命中",
      product: scoped[0],
    };
  }
  if (scoped.length > 1) {
    return { status: "no-match", reason: `长款号前缀候选不唯一（${scoped.length}）`, candidateCount: scoped.length };
  }
  if (input.targetCategory && candidates.length === 1) {
    return {
      status: "match",
      method: "category-cross",
      reason: "长款号品类交叉唯一命中",
      product: candidates[0],
    };
  }
  return { status: "no-match", reason: `长款号前缀候选不唯一（${candidates.length}）`, candidateCount: candidates.length };
}

function scopedCandidates(candidates: Candidate[], targetCategory: string | null): Candidate[] {
  if (!targetCategory) {
    return candidates;
  }
  const allowed = new Set([targetCategory, ...(CATEGORY_ALIASES[targetCategory] ?? [])]);
  return candidates.filter((candidate) => candidate.category != null && allowed.has(candidate.category));
}

async function applyMatches(analyses: RowAnalysis[]): Promise<number> {
  let updated = 0;
  for (const analysis of analyses) {
    if (!analysis.product) {
      continue;
    }
    const count = await prisma.$executeRawUnsafe(
      "UPDATE customer_quote_rows SET matched_product_id = ? WHERE id = ? AND matched_product_id IS NULL",
      analysis.product.id,
      analysis.row.id,
    );
    updated += count;
  }
  return updated;
}

async function countDanglingMatches(): Promise<number> {
  const [row] = await prisma.$queryRawUnsafe<Array<{ count: number }>>(
    `SELECT COUNT(*) AS count
     FROM customer_quote_rows
     WHERE matched_product_id IS NOT NULL
       AND matched_product_id NOT IN (SELECT id FROM products)`,
  );
  return Number(row.count);
}

function buildReport(input: {
  mode: Mode;
  baseline: Awaited<ReturnType<typeof loadBaselineCounts>>;
  after: Awaited<ReturnType<typeof loadBaselineCounts>>;
  analyses: RowAnalysis[];
  applied: number;
}): string {
  const { mode, baseline, after, analyses, applied } = input;
  const plannedMatches = analyses.filter((analysis) => analysis.product);
  const remainingUnmatched = analyses.filter((analysis) => !analysis.product);
  const noRawModel = remainingUnmatched.filter((analysis) => normalizeText(analysis.row.raw_model).length === 0);
  const withRawModel = remainingUnmatched.filter((analysis) => normalizeText(analysis.row.raw_model).length > 0);
  const reasonCountsWithRawModel = countBy(withRawModel, (analysis) => analysis.reason);
  const noRawModelFiles = summarizeNoRawModelFiles(noRawModel);
  const topUnmatchedRawModels = summarizeTopRawModels(
    analyses.filter((analysis) => !analysis.product && normalizeText(analysis.row.raw_model).length > 0),
  );

  const lines = [
    "# V5.0E — 历史报价补匹配报告",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Mode: ${mode}`,
    "",
    "## 匹配率变化",
    "",
    "| 指标 | V5.0C 后 | V5.0E 后 | 变化 |",
    "|---|---:|---:|---:|",
    `| 总行数 | ${baseline.total} | ${after.total} | — |`,
    `| 已匹配 | ${baseline.matched} | ${after.matched} | +${after.matched - baseline.matched} |`,
    `| 未匹配 | ${baseline.unmatched} | ${after.unmatched} | -${baseline.unmatched - after.unmatched} |`,
    `| 匹配率 | ${percentage(baseline.matched, baseline.total)} | ${percentage(after.matched, after.total)} | +${percentagePoints(after.matched, baseline.matched, baseline.total)} |`,
    "",
    "## 仍未匹配原因细分",
    "",
    `### A. 无 raw_model (${noRawModel.length} 行)`,
    "",
    "| 来源文件 | Sheet | 行数 | raw_row_json 疑似款号行数 | 原因 |",
    "|---|---|---:|---:|---|",
    ...noRawModelFiles
      .slice(0, 80)
      .map(
        (row) =>
          `| ${md(row.relativePath)} | ${md(row.sheetName)} | ${row.count} | ${row.hintRows} | ${md(row.reason)} |`,
      ),
    noRawModelFiles.length > 80 ? `| ... | ... | ... | ... | 其余 ${noRawModelFiles.length - 80} 个文件/sheet 省略 |` : "",
    "",
    `### B. 有 raw_model 但仍未匹配 (${withRawModel.length} 行)`,
    "",
    "| 归类 | 行数 | 说明 |",
    "|---|---:|---|",
    ...[...reasonCountsWithRawModel.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "zh-Hans-CN"))
      .map(([reason, count]) => `| ${md(reason)} | ${count} | ${md(reasonDescription(reason))} |`),
    "",
    "## 补匹配详情",
    "",
    `Planned/applied matches: ${plannedMatches.length}${mode === "apply" ? ` / ${applied}` : ""}`,
    "",
    "| raw_model | 匹配到 product.model_no | product.category | 匹配方式 | 来源文件 |",
    "|---|---|---|---|---|",
    ...plannedMatches
      .slice(0, 500)
      .map(
        (analysis) =>
          `| ${md(displayRawModel(analysis.row.raw_model))} | ${md(analysis.product?.modelNo ?? "-")} | ${md(analysis.product?.category ?? "-")} | ${md(analysis.reason)} | ${md(analysis.row.file_name)} |`,
      ),
    plannedMatches.length > 500 ? `| ... | ... | ... | ... | 其余 ${plannedMatches.length - 500} 条省略 |` : "",
    "",
    "## 仍然未匹配的 Top 20 raw_model",
    "",
    "| raw_model | 出现次数 | 品类 | 原因 |",
    "|---|---:|---|---|",
    ...topUnmatchedRawModels
      .slice(0, 20)
      .map((row) => `| ${md(row.rawModel)} | ${row.count} | ${md(row.category)} | ${md(row.reason)} |`),
    "",
    "## 安全验证",
    "",
    "- 本脚本只写 `customer_quote_rows.matched_product_id`。",
    "- 纯数字序号、纯瓦数、表头词、候选不唯一的 raw_model 不自动匹配。",
    "- 无 raw_model 的行只审计 `raw_row_json` 是否有疑似款号，不自动猜测。",
    "",
  ];

  return lines.filter((line) => line !== "").join("\n") + "\n";
}

function summarizeNoRawModelFiles(rows: RowAnalysis[]) {
  const map = new Map<string, { relativePath: string; sheetName: string; count: number; hintRows: number; reason: string }>();
  for (const analysis of rows) {
    const key = `${analysis.row.relative_path}\n${analysis.row.sheet_name}`;
    const item =
      map.get(key) ??
      ({
        relativePath: analysis.row.relative_path,
        sheetName: analysis.row.sheet_name,
        count: 0,
        hintRows: 0,
        reason: "V5.0B 未识别到款号列或源单元格为空；需回查源表列映射",
      } satisfies { relativePath: string; sheetName: string; count: number; hintRows: number; reason: string });
    item.count += 1;
    if (analysis.rawJsonHintCount > 0) {
      item.hintRows += 1;
    }
    map.set(key, item);
  }
  return [...map.values()].sort((left, right) => right.count - left.count || left.relativePath.localeCompare(right.relativePath));
}

function summarizeTopRawModels(rows: RowAnalysis[]) {
  const map = new Map<string, { rawModel: string; count: number; category: string; reason: string }>();
  for (const analysis of rows) {
    const rawModel = normalizeText(analysis.row.raw_model);
    const category = analysis.targetCategory ?? analysis.pathCategory ?? "根目录/不限品类";
    const key = `${rawModel}\n${category}\n${analysis.reason}`;
    const item =
      map.get(key) ??
      ({
        rawModel,
        count: 0,
        category,
        reason: analysis.reason,
      } satisfies { rawModel: string; count: number; category: string; reason: string });
    item.count += 1;
    map.set(key, item);
  }
  return [...map.values()].sort((left, right) => right.count - left.count || left.rawModel.localeCompare(right.rawModel));
}

function moreSpecificNoMatchReason(
  rawModel: string,
  aggressive: MatchDecision,
  prefix: MatchDecision,
  productPrefix: MatchDecision,
): string {
  if (aggressive.status === "no-match" && aggressive.reason !== "真正无候选") {
    return aggressive.reason;
  }
  if (prefix.status === "no-match" && prefix.reason !== "真正无候选") {
    return prefix.reason;
  }
  if (productPrefix.status === "no-match" && productPrefix.reason !== "真正无候选") {
    return productPrefix.reason;
  }
  if (/^WL[A-Z0-9]/i.test(rawModel) || /^WL-/i.test(rawModel)) {
    return "Wellux 自有编号但产品库无唯一对应";
  }
  return "真正无候选";
}

function rejectRawModel(rawModel: string): string | null {
  if (rawModel.length === 0) {
    return "无 raw_model";
  }
  if (isHeaderToken(rawModel)) {
    return "表头词/非产品型号";
  }
  if (isSerialModel(rawModel)) {
    return "序号型（1/2/3）";
  }
  if (isPureWattModel(rawModel)) {
    return "纯瓦数（48W）";
  }
  if (!isUsableModel(rawModel)) {
    return "非可用型号";
  }
  return null;
}

function isUsableModel(value: string | null | undefined): boolean {
  const text = normalizeText(value);
  if (text.length < 2 || text.length > 80) return false;
  if (!/[A-Za-z0-9]/.test(text)) return false;
  if (isHeaderToken(text)) return false;
  if (isSerialModel(text)) return false;
  if (isPureWattModel(text)) return false;
  return true;
}

function isHeaderToken(value: string): boolean {
  const text = normalizeText(value).toUpperCase().replace(/\s+/g, " ");
  return /^(MODEL|MODEL NO\.?|MODEL NAME|ITEM|ITEM NO\.?|NO\.?|PICTURE|PHOTO|SIZE|POWER|WATT|PRODUCT|DESCRIPTION|DESC|PRICE|UNIT PRICE|FOB|REMARK|款号|型号|序号|产品|单价|图片|照片)$/.test(
    text,
  );
}

function isSerialModel(value: string): boolean {
  const text = normalizeText(value);
  if (!/^\d+$/.test(text)) return false;
  const parsed = Number.parseInt(text, 10);
  return parsed >= 1 && parsed <= 99;
}

function isPureWattModel(value: string): boolean {
  const text = normalizeText(value).toUpperCase();
  return /^\d+(?:\.\d+)?\s*W$/.test(text);
}

function expandedAggressiveKeys(value: string): string[] {
  const base = aggressiveKey(value);
  return [
    base,
    stripCommonPrefix(base),
    stripCommonSuffix(base),
    stripCommonSuffix(stripCommonPrefix(base)),
    base.replace(/W$/, ""),
  ].filter((key) => key.length >= 2);
}

function prefixStrippedKeys(value: string): string[] {
  const base = aggressiveKey(value);
  return [stripCommonPrefix(base), stripCommonSuffix(stripCommonPrefix(base))].filter((key) => key.length >= 2);
}

function aggressiveKey(value: string): string {
  return normalizeText(value)
    .toUpperCase()
    .replace(/[×＊*]/g, "X")
    .replace(/[（）()[\]{}]/g, "")
    .replace(/[\s_\-—–/\\.,:+]+/g, "")
    .replace(/[^A-Z0-9]/g, "");
}

function stripCommonPrefix(value: string): string {
  return value.replace(/^(WL|WELLUX|WELFULL)/, "");
}

function stripCommonSuffix(value: string): string {
  return value.replace(/(ECO|PRO|NEW|PLUS|V2|V3)$/, "");
}

function isSafePrefixKey(value: string): boolean {
  if (value.length < 7) {
    return false;
  }
  if (/^\d+(PCS|PC|PCE|CTN|CARTON)$/.test(value)) {
    return false;
  }
  if (/^\d+W$/.test(value)) {
    return false;
  }
  return /[A-Z]/.test(value) && /\d/.test(value);
}

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
}

function uniqueKeys(keys: string[]): string[] {
  return [...new Set(keys.filter(Boolean))];
}

function uniqueCandidates(candidates: Candidate[]): Candidate[] {
  const map = new Map<string, Candidate>();
  for (const candidate of candidates) {
    map.set(candidate.id, candidate);
  }
  return [...map.values()];
}

function countRawJsonModelHints(rawJson: string | null): number {
  if (!rawJson) {
    return 0;
  }
  try {
    const parsed = JSON.parse(rawJson) as unknown;
    return collectPrimitiveValues(parsed).filter((value) => isPotentialModelHint(value)).length;
  } catch {
    return 0;
  }
}

function extractLabeledModelValues(rawJson: string | null): string[] {
  if (!rawJson) {
    return [];
  }
  try {
    const parsed = JSON.parse(rawJson) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return [];
    }

    const values: string[] = [];
    for (const [key, value] of Object.entries(parsed)) {
      const keyText = normalizeText(key).toUpperCase();
      const keyLooksLikeModel = /(MODEL|MODEL NO|ITEM|ITEM NO|MARKS?\s*&?\s*NOS?\.?|款号|型号)/.test(keyText);
      if (!keyLooksLikeModel) {
        continue;
      }
      if (typeof value !== "string" && typeof value !== "number") {
        continue;
      }
      const text = normalizeText(String(value));
      if (isPotentialModelHint(text)) {
        values.push(text);
      }
      const slashParts = normalizeText(key)
        .split("/")
        .map((part) => normalizeText(part))
        .filter(Boolean);
      const keyCandidate = slashParts.at(-1);
      if (keyCandidate && isPotentialModelHint(keyCandidate)) {
        values.push(keyCandidate);
      }
    }
    return values;
  } catch {
    return [];
  }
}

function collectPrimitiveValues(value: unknown): string[] {
  if (typeof value === "string" || typeof value === "number") {
    return [String(value)];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectPrimitiveValues(item));
  }
  if (value && typeof value === "object") {
    return Object.values(value).flatMap((item) => collectPrimitiveValues(item));
  }
  return [];
}

function isPotentialModelHint(value: string): boolean {
  const text = normalizeText(value);
  if (!isUsableModel(text)) {
    return false;
  }
  if (/^\d+\s*(PCS|PC|PCE|CTN|CARTON)$/i.test(text)) {
    return false;
  }
  if (/^(PCS|PC|PCE|CTN|CARTON)\s*\/?\s*\d+$/i.test(text)) {
    return false;
  }
  if (/^\d+(?:\.\d+)?$/.test(text)) {
    return false;
  }
  return /[A-Za-z]/.test(text) && /\d/.test(text);
}

function extractPathCategory(relativePath: string): string | null {
  const parts = relativePath.split("/");
  return parts.length > 1 ? parts[0] : null;
}

function resolveTargetCategory(pathCategory: string | null): string | null {
  if (!pathCategory) {
    return null;
  }
  return CATEGORY_MAP[pathCategory] ?? pathCategory;
}

function labelForMethod(method: MatchMethod): string {
  if (method === "raw-row-json") return "raw_row_json 款号唯一命中";
  if (method === "product-prefix") return "长款号前缀唯一命中";
  if (method === "prefix-stripped") return "前缀/后缀清洗唯一命中";
  if (method === "category-cross") return "品类交叉唯一命中";
  return "激进归一化唯一命中";
}

function reasonDescription(reason: string): string {
  if (reason === "无 raw_model") return "导入时未识别款号列或源单元格为空";
  if (reason === "序号型（1/2/3）") return "客户报价表内序号，不是产品型号";
  if (reason === "纯瓦数（48W）") return "型号碰撞风险高，不自动匹配";
  if (reason === "表头词/非产品型号") return "表头或非型号文本";
  if (reason === "激进归一化唯一命中") return "去空格/连字符/大小写/符号后唯一命中";
  if (reason === "品类交叉唯一命中") return "目标品类内无命中，但全库唯一命中";
  if (reason === "前缀/后缀清洗唯一命中") return "去 WL-/ECO/PRO 等前后缀后唯一命中";
  if (reason === "raw_row_json 款号唯一命中") return "raw_model 为空，但原始行 JSON 的 Model/Item 字段唯一命中";
  if (reason === "raw_row_json 品类交叉唯一命中") return "raw_model 为空，但原始行 JSON 的 Model/Item 字段全库唯一命中";
  if (reason.startsWith("raw_row_json 候选不唯一")) return "原始行 JSON 有多个可能产品，留给人工确认";
  if (reason === "raw_row_json 无唯一命中") return "原始行 JSON 有疑似款号但未命中产品库";
  if (reason === "长款号前缀唯一命中") return "历史报价长款号以现有产品 model_no 开头，且唯一命中";
  if (reason === "长款号品类交叉唯一命中") return "历史报价长款号以现有产品 model_no 开头，全库唯一命中";
  if (reason.startsWith("长款号前缀候选不唯一")) return "前缀匹配有多个候选，留给人工确认";
  if (reason.startsWith("候选不唯一")) return "存在多个候选，留给人工确认";
  if (reason === "Wellux 自有编号但产品库无唯一对应") return "客户报价内编号无法安全映射到现有产品";
  if (reason === "真正无候选") return "产品库当前无对应 model_no";
  return "未自动匹配";
}

function pushMap<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const values = map.get(key) ?? [];
  values.push(value);
  map.set(key, values);
}

function countBy<T>(items: T[], keyFn: (item: T) => string): Map<string, number> {
  const map = new Map<string, number>();
  for (const item of items) {
    const key = keyFn(item);
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return map;
}

function percentage(count: number, total: number): string {
  if (total === 0) return "0%";
  return `${Math.round((count / total) * 100)}%`;
}

function percentagePoints(afterCount: number, beforeCount: number, total: number): string {
  if (total === 0) return "0pp";
  return `${(((afterCount - beforeCount) / total) * 100).toFixed(1)}pp`;
}

function md(value: string): string {
  return normalizeText(value).replace(/\|/g, "\\|").replace(/\n/g, "<br>");
}

function displayRawModel(value: string | null): string {
  const text = normalizeText(value);
  return text.length > 0 ? text : "（空）";
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
