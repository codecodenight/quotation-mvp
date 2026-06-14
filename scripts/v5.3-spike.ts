import { writeFile } from "node:fs/promises";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const REPORT_PATH = path.join("docs", "v5.3-spike.md");
const SAMPLE_SIZE = 50;

type MatchMethod = "exact" | "normalized" | "unmatched";
type SampleClassification = "match-possible" | "weak-candidates" | "no-candidates";

type DbCounts = {
  products: number;
  supplier_offers: number;
  product_params: number;
  customer_quote_rows: number;
};

type StatusSnapshot = {
  totalRows: number;
  matchedRows: number;
  unmatchedWithRawModel: number;
  unmatchedWithoutRawModel: number;
};

type ProductRow = {
  id: string;
  model_no: string | null;
  product_name: string;
  category: string | null;
};

type ParamRow = {
  product_id: string;
  normalized_value: string | null;
  raw_value: string;
};

type ProductCandidate = {
  id: string;
  modelNo: string;
  productName: string;
  category: string | null;
  exactKey: string;
  normalizedKey: string;
  watts: number[];
};

type CustomerQuoteRow = {
  id: number;
  raw_model: string | null;
  raw_description: string | null;
  sale_price_usd: number | null;
  file_name: string;
  relative_path: string;
};

type Candidate = {
  id: string;
  category: string | null;
  modelNo: string;
  productName: string;
};

type MatchResult = {
  row: CustomerQuoteRow;
  pathCategory: string | null;
  targetCategory: string | null;
  productId: string | null;
  productModelNo: string | null;
  productCategory: string | null;
  method: MatchMethod;
  reason: string;
};

type Matcher = {
  products: ProductCandidate[];
  exact: Map<string, Candidate[]>;
  normalized: Map<string, Candidate[]>;
};

type SampleAnalysis = {
  row: CustomerQuoteRow;
  targetCategory: string | null;
  classification: SampleClassification;
  strategy: string;
  candidateCount: number;
  bestCandidate: ProductCandidate | null;
  prefixLength: number | null;
  counts: {
    prefix: number;
    numeric: number;
    categoryNumber: number;
    categoryWatts: number;
  };
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
  "防潮灯": "防潮灯",
  Highbay: "Highbay",
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

async function main() {
  const beforeCounts = await getDbCounts();
  const snapshot = await getStatusSnapshot();
  const products = await loadProducts();
  const matcher = buildMatcher(products);
  const unmatchedRows = await loadUnmatchedRowsWithRawModel();
  const rematchResults = unmatchedRows.map((row) => matchRow(row, matcher));
  const newlyMatched = rematchResults.filter((result) => result.productId);
  const stillUnmatched = rematchResults.filter((result) => !result.productId);
  const sampleRows = sampleRowsRandomly(stillUnmatched.map((result) => result.row), SAMPLE_SIZE);
  const sampleAnalyses = sampleRows.map((row) => analyzeSampleRow(row, matcher));
  const afterCounts = await getDbCounts();

  const report = buildReport({
    beforeCounts,
    afterCounts,
    snapshot,
    newlyMatched,
    stillUnmatchedCount: stillUnmatched.length,
    sampleAnalyses,
  });

  await writeFile(REPORT_PATH, report, "utf8");
  console.log(
    JSON.stringify(
      {
        reportPath: REPORT_PATH,
        totalRows: snapshot.totalRows,
        matchedRows: snapshot.matchedRows,
        unmatchedWithRawModel: snapshot.unmatchedWithRawModel,
        unmatchedWithoutRawModel: snapshot.unmatchedWithoutRawModel,
        newlyMatchedByV50cStrategy: newlyMatched.length,
        sampledRows: sampleAnalyses.length,
        dbUnchanged: JSON.stringify(beforeCounts) === JSON.stringify(afterCounts),
      },
      null,
      2,
    ),
  );
}

async function getDbCounts(): Promise<DbCounts> {
  const rows = await prisma.$queryRaw<Array<{ table_name: keyof DbCounts; cnt: number | bigint }>>`
    SELECT 'products' AS table_name, COUNT(*) AS cnt FROM products
    UNION ALL SELECT 'supplier_offers', COUNT(*) FROM supplier_offers
    UNION ALL SELECT 'product_params', COUNT(*) FROM product_params
    UNION ALL SELECT 'customer_quote_rows', COUNT(*) FROM customer_quote_rows
  `;
  return Object.fromEntries(rows.map((row) => [row.table_name, toNumber(row.cnt)])) as DbCounts;
}

async function getStatusSnapshot(): Promise<StatusSnapshot> {
  const [row] = await prisma.$queryRaw<
    Array<{
      total_rows: number | bigint;
      matched_rows: number | bigint;
      unmatched_with_raw_model: number | bigint;
      unmatched_without_raw_model: number | bigint;
    }>
  >`
    SELECT
      COUNT(*) AS total_rows,
      SUM(CASE WHEN matched_product_id IS NOT NULL THEN 1 ELSE 0 END) AS matched_rows,
      SUM(CASE WHEN raw_model IS NOT NULL AND TRIM(raw_model) <> '' AND matched_product_id IS NULL THEN 1 ELSE 0 END) AS unmatched_with_raw_model,
      SUM(CASE WHEN (raw_model IS NULL OR TRIM(raw_model) = '') AND matched_product_id IS NULL THEN 1 ELSE 0 END) AS unmatched_without_raw_model
    FROM customer_quote_rows
  `;

  return {
    totalRows: toNumber(row.total_rows),
    matchedRows: toNumber(row.matched_rows),
    unmatchedWithRawModel: toNumber(row.unmatched_with_raw_model),
    unmatchedWithoutRawModel: toNumber(row.unmatched_without_raw_model),
  };
}

async function loadProducts(): Promise<ProductCandidate[]> {
  const productRows = await prisma.$queryRaw<ProductRow[]>`
    SELECT id, model_no, product_name, category
    FROM products
    WHERE model_no IS NOT NULL
      AND TRIM(model_no) <> ''
  `;
  const paramRows = await prisma.$queryRaw<ParamRow[]>`
    SELECT product_id, normalized_value, raw_value
    FROM product_params
    WHERE param_key = 'watts'
  `;
  const wattsByProduct = new Map<string, number[]>();
  for (const row of paramRows) {
    const watt = parseNumber(row.normalized_value ?? row.raw_value);
    if (watt === null) {
      continue;
    }
    const watts = wattsByProduct.get(row.product_id) ?? [];
    watts.push(watt);
    wattsByProduct.set(row.product_id, watts);
  }

  return productRows
    .map((product) => {
      const modelNo = normalizeText(product.model_no);
      return {
        id: product.id,
        modelNo,
        productName: normalizeText(product.product_name),
        category: product.category,
        exactKey: exactKey(modelNo),
        normalizedKey: normalizedKey(modelNo),
        watts: uniqueNumbers(wattsByProduct.get(product.id) ?? []),
      };
    })
    .filter((product) => isUsableModel(product.modelNo));
}

async function loadUnmatchedRowsWithRawModel(): Promise<CustomerQuoteRow[]> {
  return prisma.$queryRaw<CustomerQuoteRow[]>`
    SELECT
      cqr.id,
      cqr.raw_model,
      cqr.raw_description,
      cqr.sale_price_usd,
      cqf.file_name,
      cqf.relative_path
    FROM customer_quote_rows cqr
    JOIN customer_quote_files cqf ON cqf.id = cqr.file_id
    WHERE cqr.matched_product_id IS NULL
      AND cqr.raw_model IS NOT NULL
      AND TRIM(cqr.raw_model) <> ''
    ORDER BY cqr.id
  `;
}

function buildMatcher(products: ProductCandidate[]): Matcher {
  const exact = new Map<string, Candidate[]>();
  const normalized = new Map<string, Candidate[]>();

  for (const product of products) {
    const candidate = {
      id: product.id,
      category: product.category,
      modelNo: product.modelNo,
      productName: product.productName,
    };
    pushMap(exact, product.exactKey, candidate);
    pushMap(normalized, product.normalizedKey, candidate);
  }

  return { products, exact, normalized };
}

function matchRow(row: CustomerQuoteRow, matcher: Matcher): MatchResult {
  const rawModel = normalizeText(row.raw_model);
  const pathCategory = extractPathCategory(row.relative_path);
  const targetCategory = pathCategory ? CATEGORY_MAP[pathCategory] ?? null : null;

  if (!isUsableModel(rawModel)) {
    return {
      row,
      pathCategory,
      targetCategory,
      productId: null,
      productModelNo: null,
      productCategory: null,
      method: "unmatched",
      reason: "no usable raw_model",
    };
  }

  const exactMatch = chooseCandidate(matcher.exact.get(exactKey(rawModel)) ?? [], targetCategory);
  if (exactMatch.status === "matched") {
    return {
      row,
      pathCategory,
      targetCategory,
      productId: exactMatch.candidate.id,
      productModelNo: exactMatch.candidate.modelNo,
      productCategory: exactMatch.candidate.category,
      method: "exact",
      reason: "exact model_no",
    };
  }
  if (exactMatch.status === "ambiguous") {
    return {
      row,
      pathCategory,
      targetCategory,
      productId: null,
      productModelNo: null,
      productCategory: null,
      method: "unmatched",
      reason: exactMatch.reason,
    };
  }

  const normalizedMatch = chooseCandidate(matcher.normalized.get(normalizedKey(rawModel)) ?? [], targetCategory);
  if (normalizedMatch.status === "matched") {
    return {
      row,
      pathCategory,
      targetCategory,
      productId: normalizedMatch.candidate.id,
      productModelNo: normalizedMatch.candidate.modelNo,
      productCategory: normalizedMatch.candidate.category,
      method: "normalized",
      reason: "normalized model_no",
    };
  }

  return {
    row,
    pathCategory,
    targetCategory,
    productId: null,
    productModelNo: null,
    productCategory: null,
    method: "unmatched",
    reason: normalizedMatch.status === "ambiguous" ? normalizedMatch.reason : "no candidate",
  };
}

function chooseCandidate(candidates: Candidate[], targetCategory: string | null) {
  if (candidates.length === 0) {
    return { status: "none" as const };
  }

  const scoped = targetCategory ? candidates.filter((candidate) => candidate.category === targetCategory) : candidates;
  if (scoped.length === 1) {
    return { status: "matched" as const, candidate: scoped[0] };
  }
  if (scoped.length > 1) {
    return { status: "ambiguous" as const, reason: `ambiguous within ${targetCategory ?? "all categories"} (${scoped.length})` };
  }
  if (targetCategory && candidates.length === 1) {
    return { status: "matched" as const, candidate: candidates[0] };
  }
  if (targetCategory) {
    return { status: "none" as const };
  }
  return { status: "ambiguous" as const, reason: `ambiguous globally (${candidates.length})` };
}

function analyzeSampleRow(row: CustomerQuoteRow, matcher: Matcher): SampleAnalysis {
  const rawModel = normalizeText(row.raw_model);
  const targetCategory = extractTargetCategory(row.relative_path);
  const rawKey = normalizedKey(rawModel);
  const prefixResult = findPrefixCandidates(rawKey, matcher.products);
  const numberTokens = extractNumberTokens(`${rawModel} ${row.raw_description ?? ""}`);
  const numericCandidates = findNumberCandidates(numberTokens, matcher.products);
  const categoryNumberCandidates = targetCategory
    ? numericCandidates.filter((candidate) => candidate.category === targetCategory)
    : [];
  const watt = extractWatts(`${rawModel} ${row.raw_description ?? ""}`);
  const categoryWattCandidates =
    targetCategory && watt !== null
      ? matcher.products.filter((candidate) => candidate.category === targetCategory && candidate.watts.some((value) => nearlyEqual(value, watt)))
      : [];
  const allCandidates = uniqueProducts([
    ...prefixResult.candidates,
    ...numericCandidates,
    ...categoryNumberCandidates,
    ...categoryWattCandidates,
  ]);
  const bestCandidate = chooseBestSampleCandidate({
    prefixCandidates: prefixResult.candidates,
    categoryNumberCandidates,
    categoryWattCandidates,
    numericCandidates,
    allCandidates,
  });
  const strategy = buildSampleStrategy({
    prefixLength: prefixResult.prefixLength,
    numberTokens,
    watt,
    targetCategory,
    counts: {
      prefix: prefixResult.candidates.length,
      numeric: numericCandidates.length,
      categoryNumber: categoryNumberCandidates.length,
      categoryWatts: categoryWattCandidates.length,
    },
  });
  const classification = classifySample({
    prefixLength: prefixResult.prefixLength,
    counts: {
      prefix: prefixResult.candidates.length,
      numeric: numericCandidates.length,
      categoryNumber: categoryNumberCandidates.length,
      categoryWatts: categoryWattCandidates.length,
    },
  });

  return {
    row,
    targetCategory,
    classification,
    strategy,
    candidateCount: allCandidates.length,
    bestCandidate,
    prefixLength: prefixResult.prefixLength,
    counts: {
      prefix: prefixResult.candidates.length,
      numeric: numericCandidates.length,
      categoryNumber: categoryNumberCandidates.length,
      categoryWatts: categoryWattCandidates.length,
    },
  };
}

function findPrefixCandidates(rawKey: string, products: ProductCandidate[]) {
  const maxPrefix = Math.min(rawKey.length, 16);
  for (let length = maxPrefix; length >= 3; length -= 1) {
    const prefix = rawKey.slice(0, length);
    if (prefix.length < 3 || !/[A-Z0-9]/.test(prefix)) {
      continue;
    }
    const candidates = products.filter((product) => product.normalizedKey.startsWith(prefix));
    if (candidates.length > 0) {
      return { prefixLength: length, candidates };
    }
  }
  return { prefixLength: null, candidates: [] as ProductCandidate[] };
}

function findNumberCandidates(numberTokens: string[], products: ProductCandidate[]): ProductCandidate[] {
  if (numberTokens.length === 0) {
    return [];
  }
  const tokens = numberTokens.filter((token) => token.length >= 2);
  if (tokens.length === 0) {
    return [];
  }
  return products.filter((product) => tokens.some((token) => product.normalizedKey.includes(token)));
}

function chooseBestSampleCandidate(input: {
  prefixCandidates: ProductCandidate[];
  categoryNumberCandidates: ProductCandidate[];
  categoryWattCandidates: ProductCandidate[];
  numericCandidates: ProductCandidate[];
  allCandidates: ProductCandidate[];
}): ProductCandidate | null {
  return (
    input.prefixCandidates[0] ??
    input.categoryNumberCandidates[0] ??
    input.categoryWattCandidates[0] ??
    input.numericCandidates[0] ??
    input.allCandidates[0] ??
    null
  );
}

function classifySample(input: {
  prefixLength: number | null;
  counts: { prefix: number; numeric: number; categoryNumber: number; categoryWatts: number };
}): SampleClassification {
  if ((input.prefixLength ?? 0) >= 5 || input.counts.categoryNumber > 0 || input.counts.categoryWatts > 0) {
    return "match-possible";
  }
  if ((input.prefixLength ?? 0) >= 3 || input.counts.numeric > 0) {
    return "weak-candidates";
  }
  return "no-candidates";
}

function buildSampleStrategy(input: {
  prefixLength: number | null;
  numberTokens: string[];
  watt: number | null;
  targetCategory: string | null;
  counts: { prefix: number; numeric: number; categoryNumber: number; categoryWatts: number };
}): string {
  const parts: string[] = [];
  if (input.prefixLength !== null) {
    parts.push(`prefix ${input.prefixLength} chars: ${input.counts.prefix}`);
  }
  if (input.numberTokens.length > 0) {
    parts.push(`numeric tokens ${input.numberTokens.slice(0, 5).join("/")}: ${input.counts.numeric}`);
  }
  if (input.targetCategory) {
    parts.push(`category ${input.targetCategory} + number: ${input.counts.categoryNumber}`);
  }
  if (input.targetCategory && input.watt !== null) {
    parts.push(`category ${input.targetCategory} + ${input.watt}W: ${input.counts.categoryWatts}`);
  }
  return parts.length > 0 ? parts.join("; ") : "no candidate strategy matched";
}

function sampleRowsRandomly<T>(rows: T[], size: number): T[] {
  return rows
    .map((row) => ({ row, sort: Math.random() }))
    .sort((a, b) => a.sort - b.sort)
    .slice(0, size)
    .map((item) => item.row);
}

function buildReport(input: {
  beforeCounts: DbCounts;
  afterCounts: DbCounts;
  snapshot: StatusSnapshot;
  newlyMatched: MatchResult[];
  stillUnmatchedCount: number;
  sampleAnalyses: SampleAnalysis[];
}): string {
  const sampleCounts = countBy(input.sampleAnalyses, (item) => item.classification);
  const strategyCounts = countStrategyTypes(input.sampleAnalyses.filter((item) => item.classification === "match-possible"));
  const noCandidatePatterns = countBy(
    input.sampleAnalyses.filter((item) => item.classification === "no-candidates"),
    (item) => classifyRawModelPattern(item.row.raw_model),
  );
  const matchPossibleCount = sampleCounts.get("match-possible") ?? 0;
  const weakCount = sampleCounts.get("weak-candidates") ?? 0;
  const noCount = sampleCounts.get("no-candidates") ?? 0;
  const estimatedPossible = Math.round((matchPossibleCount / Math.max(input.sampleAnalyses.length, 1)) * input.stillUnmatchedCount);
  const recommendation = buildRecommendation(matchPossibleCount, weakCount, noCount, input.newlyMatched.length);
  const dbUnchanged = JSON.stringify(input.beforeCounts) === JSON.stringify(input.afterCounts);

  const lines: string[] = [];
  lines.push("# V5.3 Spike — 历史报价未匹配行匹配策略调研");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("## 当前匹配状态");
  lines.push("");
  lines.push("| 指标 | 数量 |");
  lines.push("|---|---:|");
  lines.push(`| 总行数 | ${input.snapshot.totalRows} |`);
  lines.push(`| 已匹配 | ${input.snapshot.matchedRows} |`);
  lines.push(`| 有款号但未匹配 | ${input.snapshot.unmatchedWithRawModel} |`);
  lines.push(`| 无款号未匹配 | ${input.snapshot.unmatchedWithoutRawModel} |`);
  lines.push(`| 当前匹配率 | ${percentage(input.snapshot.matchedRows, input.snapshot.totalRows)} |`);
  lines.push("");
  lines.push("## V6.2B 后再匹配结果");
  lines.push("");
  lines.push(`- 用 V5.0C exact/normalized 策略可新增匹配：${input.newlyMatched.length}`);
  lines.push(`- exact：${input.newlyMatched.filter((item) => item.method === "exact").length}`);
  lines.push(`- normalized：${input.newlyMatched.filter((item) => item.method === "normalized").length}`);
  lines.push("");
  if (input.newlyMatched.length === 0) {
    lines.push("无新增 exact/normalized 匹配。");
  } else {
    lines.push("| raw_model | matched product model_no | category | method | source file |");
    lines.push("|---|---|---|---|---|");
    for (const result of input.newlyMatched.slice(0, 20)) {
      lines.push(
        `| ${md(result.row.raw_model ?? "-")} | ${md(result.productModelNo ?? "-")} | ${md(result.productCategory ?? "-")} | ${md(
          result.method,
        )} | ${md(result.row.file_name)} |`,
      );
    }
  }
  lines.push("");
  lines.push("## 50 条抽样详情表");
  lines.push("");
  lines.push(
    "| raw_model | raw_description | raw_price_usd | source file_name | 候选数 | 最佳候选 | 分类 | 匹配策略描述 |",
  );
  lines.push("|---|---|---:|---|---:|---|---|---|");
  for (const item of input.sampleAnalyses) {
    lines.push(
      `| ${md(item.row.raw_model ?? "-")} | ${md(truncate(item.row.raw_description, 50))} | ${
        item.row.sale_price_usd ?? "-"
      } | ${md(item.row.file_name)} | ${item.candidateCount} | ${md(formatCandidate(item.bestCandidate))} | ${md(
        item.classification,
      )} | ${md(item.strategy)} |`,
    );
  }
  lines.push("");
  lines.push("## 汇总分析");
  lines.push("");
  lines.push("### 抽样分类统计");
  lines.push("");
  lines.push("| 分类 | 数量 | 占比 |");
  lines.push("|---|---:|---:|");
  lines.push(`| match-possible | ${matchPossibleCount} | ${percentage(matchPossibleCount, input.sampleAnalyses.length)} |`);
  lines.push(`| weak-candidates | ${weakCount} | ${percentage(weakCount, input.sampleAnalyses.length)} |`);
  lines.push(`| no-candidates | ${noCount} | ${percentage(noCount, input.sampleAnalyses.length)} |`);
  lines.push("");
  lines.push("### match-possible 常见策略");
  lines.push("");
  if (strategyCounts.size === 0) {
    lines.push("抽样中没有 match-possible。");
  } else {
    lines.push("| 策略 | 数量 |");
    lines.push("|---|---:|");
    for (const [strategy, count] of [...strategyCounts.entries()].sort((a, b) => b[1] - a[1])) {
      lines.push(`| ${md(strategy)} | ${count} |`);
    }
  }
  lines.push("");
  lines.push("### no-candidates raw_model 模式");
  lines.push("");
  if (noCandidatePatterns.size === 0) {
    lines.push("抽样中没有 no-candidates。");
  } else {
    lines.push("| 模式 | 数量 |");
    lines.push("|---|---:|");
    for (const [pattern, count] of [...noCandidatePatterns.entries()].sort((a, b) => b[1] - a[1])) {
      lines.push(`| ${md(pattern)} | ${count} |`);
    }
  }
  lines.push("");
  lines.push("### 全量估算");
  lines.push("");
  lines.push(`- exact/normalized 可安全新增匹配：${input.newlyMatched.length} 行`);
  lines.push(`- exact/normalized 后仍有款号未匹配：${input.stillUnmatchedCount} 行`);
  lines.push(`- 按抽样 match-possible 比例估算，仍可进一步人工/规则匹配约：${estimatedPossible} 行`);
  lines.push("");
  lines.push("### 推荐结论");
  lines.push("");
  lines.push(recommendation);
  lines.push("");
  lines.push("## 只读验证");
  lines.push("");
  lines.push(`- DB unchanged: ${dbUnchanged ? "YES" : "NO"}`);
  lines.push("");
  lines.push("| Table | Before | After |");
  lines.push("|---|---:|---:|");
  for (const key of Object.keys(input.beforeCounts).sort() as Array<keyof DbCounts>) {
    lines.push(`| ${md(key)} | ${input.beforeCounts[key]} | ${input.afterCounts[key]} |`);
  }
  lines.push("");
  lines.push("## Notes");
  lines.push("");
  lines.push("- 本脚本只读数据库，不更新 `matched_product_id`。");
  lines.push("- exact/normalized 逻辑沿用 V5.0C：候选必须唯一，或能通过来源品类唯一消歧。");
  lines.push("- 前缀、数字、品类+瓦数只是可行性评估，不代表可直接全量 apply。");
  lines.push("");

  return `${lines.join("\n")}\n`;
}

function countStrategyTypes(items: SampleAnalysis[]): Map<string, number> {
  const rows = new Map<string, number>();
  for (const item of items) {
    if ((item.prefixLength ?? 0) >= 5) {
      increment(rows, "prefix >= 5 chars");
    }
    if (item.counts.categoryNumber > 0) {
      increment(rows, "category + numeric token");
    }
    if (item.counts.categoryWatts > 0) {
      increment(rows, "category + watts");
    }
  }
  return rows;
}

function buildRecommendation(matchPossible: number, weak: number, noCandidate: number, newlyMatched: number): string {
  const lines: string[] = [];
  if (newlyMatched > 0) {
    lines.push(`建议做一个小型 V5.3 apply：先把 ${newlyMatched} 条 exact/normalized 高置信度匹配写入。`);
  } else {
    lines.push("不建议单独做 exact/normalized apply：V6.2B 后没有带来新的安全匹配。");
  }
  if (matchPossible >= 10) {
    lines.push("抽样中 match-possible 比例较高，值得继续设计半自动 review 工作流，而不是直接全量模糊匹配。");
  } else if (weak > matchPossible) {
    lines.push("抽样中弱候选更多，直接自动匹配风险偏高；更适合在 UI 中做候选建议，让人工确认。");
  } else if (noCandidate > matchPossible + weak) {
    lines.push("多数未匹配行在当前产品库里没有可用候选，继续提升匹配率需要先补产品库或处理无款号行。");
  }
  return lines.join("\n\n");
}

function classifyRawModelPattern(value: string | null): string {
  const text = normalizeText(value);
  if (!text) return "empty";
  if (/^\d+(\.\d+)?$/.test(text)) return "纯数字/尺寸类";
  if (/[+/]/.test(text)) return "组合型号/多型号";
  if (text.length > 30) return "长规格文本";
  if (/^[A-Z]{1,4}[-\w]*\d/i.test(text)) return "供应商/客户编码";
  if (/\d+\s*w/i.test(text)) return "瓦数规格";
  return "其他";
}

function extractTargetCategory(relativePath: string): string | null {
  const pathCategory = extractPathCategory(relativePath);
  return pathCategory ? CATEGORY_MAP[pathCategory] ?? null : null;
}

function extractPathCategory(relativePath: string): string | null {
  const parts = relativePath.split("/");
  return parts.length > 1 ? parts[0] : null;
}

function extractNumberTokens(value: string): string[] {
  return Array.from(new Set(normalizeText(value).match(/\d+(?:\.\d+)?/g) ?? []));
}

function extractWatts(value: string): number | null {
  const match = normalizeText(value).match(/(\d+(?:\.\d+)?)\s*w\b/i);
  if (!match) {
    return null;
  }
  return Number(match[1]);
}

function parseNumber(value: string): number | null {
  const match = normalizeText(value).match(/\d+(?:\.\d+)?/);
  if (!match) {
    return null;
  }
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
}

function exactKey(value: string): string {
  return normalizeText(value).toUpperCase();
}

function normalizedKey(value: string): string {
  return exactKey(value)
    .replace(/[（）()]/g, "")
    .replace(/[\s_\-—–/\\.,+]+/g, "");
}

function isUsableModel(value: string | null | undefined): boolean {
  const text = normalizeText(value);
  if (text.length < 2 || text.length > 80) return false;
  if (!/[A-Za-z0-9]/.test(text)) return false;
  if (/^(model|item|item no\.?|model name|quotation|picture|photo|size|power|watt|product)$/i.test(text)) return false;
  return true;
}

function uniqueProducts(products: ProductCandidate[]): ProductCandidate[] {
  const seen = new Set<string>();
  const out: ProductCandidate[] = [];
  for (const product of products) {
    if (seen.has(product.id)) {
      continue;
    }
    seen.add(product.id);
    out.push(product);
  }
  return out;
}

function uniqueNumbers(values: number[]): number[] {
  return Array.from(new Set(values.map((value) => String(value)))).map(Number);
}

function nearlyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) < 0.001;
}

function pushMap<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const values = map.get(key) ?? [];
  values.push(value);
  map.set(key, values);
}

function countBy<T>(items: T[], keyFn: (item: T) => string): Map<string, number> {
  const map = new Map<string, number>();
  for (const item of items) {
    increment(map, keyFn(item));
  }
  return map;
}

function increment(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function toNumber(value: number | bigint | null | undefined): number {
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (typeof value === "number") {
    return value;
  }
  return 0;
}

function percentage(count: number, total: number): string {
  if (total === 0) return "0%";
  return `${Math.round((count / total) * 100)}%`;
}

function truncate(value: string | null, length: number): string {
  const text = normalizeText(value);
  if (text.length <= length) {
    return text || "-";
  }
  return `${text.slice(0, length)}...`;
}

function formatCandidate(candidate: ProductCandidate | null): string {
  if (!candidate) {
    return "-";
  }
  return `${candidate.modelNo} / ${candidate.category ?? "-"} / ${candidate.productName}`;
}

function md(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\n/g, " ").replace(/\r/g, " ").trim();
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
