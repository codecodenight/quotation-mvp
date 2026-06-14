import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const REPORT_PATH = "docs/v5.0c-match-report.md";

type Mode = "dry-run" | "apply";
type MatchMethod = "exact" | "normalized" | "unmatched";

type ProductRow = {
  id: string;
  model_no: string | null;
  category: string | null;
};

type CustomerQuoteRow = {
  id: number;
  raw_model: string | null;
  sale_price_usd: number | null;
  relative_path: string;
};

type Candidate = {
  id: string;
  category: string | null;
  modelNo: string;
};

type MatchResult = {
  row: CustomerQuoteRow;
  pathCategory: string | null;
  targetCategory: string | null;
  productId: string | null;
  method: MatchMethod;
  reason: string;
};

type CategorySummary = {
  category: string;
  total: number;
  matched: number;
  exact: number;
  normalized: number;
  unmatched: number;
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

async function main() {
  const mode = parseMode();
  const products = await loadProducts();
  const quoteRows = await loadQuoteRows();
  const matcher = buildMatcher(products);
  const results = quoteRows.map((row) => matchRow(row, matcher));

  if (mode === "dry-run") {
    printDryRun(results);
    return;
  }

  const updated = await applyMatches(results);
  await mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await writeFile(REPORT_PATH, buildReport(results, updated), "utf8");
  console.log(`Wrote ${REPORT_PATH}`);
  console.log(JSON.stringify({ totalRows: results.length, updated }, null, 2));
}

function parseMode(): Mode {
  const args = new Set(process.argv.slice(2));
  if (args.has("--dry-run")) return "dry-run";
  if (args.has("--apply")) return "apply";
  throw new Error("Usage: npx tsx scripts/customer-quote-match-v5.0c.ts --dry-run|--apply");
}

async function loadProducts(): Promise<ProductRow[]> {
  return prisma.$queryRawUnsafe<ProductRow[]>(
    "SELECT id, model_no, category FROM products WHERE model_no IS NOT NULL AND trim(model_no) <> ''",
  );
}

async function loadQuoteRows(): Promise<CustomerQuoteRow[]> {
  return prisma.$queryRawUnsafe<CustomerQuoteRow[]>(
    `SELECT cqr.id, cqr.raw_model, cqr.sale_price_usd, cqf.relative_path
     FROM customer_quote_rows cqr
     JOIN customer_quote_files cqf ON cqf.id = cqr.file_id
     ORDER BY cqr.id`,
  );
}

function buildMatcher(products: ProductRow[]) {
  const exact = new Map<string, Candidate[]>();
  const normalized = new Map<string, Candidate[]>();

  for (const product of products) {
    const modelNo = normalizeText(product.model_no);
    if (!isUsableModel(modelNo)) {
      continue;
    }
    const candidate = {
      id: product.id,
      category: product.category,
      modelNo,
    };
    pushMap(exact, exactKey(modelNo), candidate);
    pushMap(normalized, normalizedKey(modelNo), candidate);
  }

  return { exact, normalized };
}

function matchRow(
  row: CustomerQuoteRow,
  matcher: ReturnType<typeof buildMatcher>,
): MatchResult {
  const rawModel = normalizeText(row.raw_model);
  const pathCategory = extractPathCategory(row.relative_path);
  const targetCategory = pathCategory ? CATEGORY_MAP[pathCategory] ?? null : null;

  if (!isUsableModel(rawModel)) {
    return { row, pathCategory, targetCategory, productId: null, method: "unmatched", reason: "no usable raw_model" };
  }

  const exactMatch = chooseCandidate(matcher.exact.get(exactKey(rawModel)) ?? [], targetCategory);
  if (exactMatch.status === "matched") {
    return { row, pathCategory, targetCategory, productId: exactMatch.candidate.id, method: "exact", reason: "exact model_no" };
  }
  if (exactMatch.status === "ambiguous") {
    return { row, pathCategory, targetCategory, productId: null, method: "unmatched", reason: exactMatch.reason };
  }

  const normalizedMatch = chooseCandidate(matcher.normalized.get(normalizedKey(rawModel)) ?? [], targetCategory);
  if (normalizedMatch.status === "matched") {
    return {
      row,
      pathCategory,
      targetCategory,
      productId: normalizedMatch.candidate.id,
      method: "normalized",
      reason: "normalized model_no",
    };
  }
  return {
    row,
    pathCategory,
    targetCategory,
    productId: null,
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

async function applyMatches(results: MatchResult[]): Promise<number> {
  let updated = 0;
  for (const result of results) {
    if (!result.productId) {
      continue;
    }
    const count = await prisma.$executeRawUnsafe(
      "UPDATE customer_quote_rows SET matched_product_id = ? WHERE id = ? AND matched_product_id IS NULL",
      result.productId,
      result.row.id,
    );
    updated += count;
  }
  return updated;
}

function printDryRun(results: MatchResult[]) {
  const summary = summarize(results);
  console.log("\n=== Customer Quote Match V5.0C (dry-run) ===");
  console.log("");
  printTopline(results);
  console.log("");
  console.log("按品类统计:");
  printCategoryTable(summary);
  console.log("");
  console.log("未匹配样本（前 20 行）:");
  console.log("| raw_model | 品类 | sale_price_usd | reason |");
  console.log("|---|---|---:|---|");
  for (const result of results.filter((item) => !item.productId).slice(0, 20)) {
    console.log(
      `| ${escapeMarkdown(result.row.raw_model ?? "-")} | ${escapeMarkdown(result.targetCategory ?? result.pathCategory ?? "根目录")} | ${result.row.sale_price_usd ?? "-"} | ${escapeMarkdown(result.reason)} |`,
    );
  }
}

function buildReport(results: MatchResult[], updated: number): string {
  const summary = summarize(results);
  const reasonCounts = countBy(results.filter((item) => !item.productId), (item) => item.reason);
  return [
    "# V5.0C — 历史客户报价产品匹配报告",
    "",
    `Generated: ${new Date().toISOString()}`,
    "Mode: apply",
    "",
    "## 总结",
    "",
    "| 指标 | 数量 |",
    "|---|---:|",
    `| 总行数 | ${results.length} |`,
    `| 有 raw_model 行 | ${results.filter((item) => isUsableModel(item.row.raw_model)).length} |`,
    `| 精确匹配 | ${results.filter((item) => item.method === "exact").length} |`,
    `| 归一化匹配 | ${results.filter((item) => item.method === "normalized").length} |`,
    `| 总匹配 | ${results.filter((item) => item.productId).length} |`,
    `| 实际写入 matched_product_id | ${updated} |`,
    `| 未匹配 | ${results.filter((item) => !item.productId).length} |`,
    `| 匹配率 | ${percentage(results.filter((item) => item.productId).length, results.length)} |`,
    "",
    "## 按品类统计",
    "",
    "| 品类 | 总行 | 匹配 | 匹配率 | 精确 | 归一化 | 未匹配 |",
    "|---|---:|---:|---:|---:|---:|---:|",
    ...summary.map(
      (row) =>
        `| ${escapeMarkdown(row.category)} | ${row.total} | ${row.matched} | ${percentage(row.matched, row.total)} | ${row.exact} | ${row.normalized} | ${row.unmatched} |`,
    ),
    "",
    "## 未匹配原因",
    "",
    "| 原因 | 行数 |",
    "|---|---:|",
    ...[...reasonCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([reason, count]) => `| ${escapeMarkdown(reason)} | ${count} |`),
    "",
    "## 未匹配样本",
    "",
    "| raw_model | 品类 | sale_price_usd | reason |",
    "|---|---|---:|---|",
    ...results
      .filter((item) => !item.productId)
      .slice(0, 50)
      .map(
        (result) =>
          `| ${escapeMarkdown(result.row.raw_model ?? "-")} | ${escapeMarkdown(result.targetCategory ?? result.pathCategory ?? "根目录")} | ${result.row.sale_price_usd ?? "-"} | ${escapeMarkdown(result.reason)} |`,
      ),
    "",
    "## 安全说明",
    "",
    "- 只更新 `customer_quote_rows.matched_product_id`。",
    "- 匹配要求候选唯一；跨品类歧义、同品类重复型号、根目录多候选全部留空。",
    "- `products` / `supplier_offers` / `quote_items` 未写入。",
    "",
  ].join("\n");
}

function printTopline(results: MatchResult[]) {
  const total = results.length;
  const usable = results.filter((result) => isUsableModel(result.row.raw_model)).length;
  const exact = results.filter((result) => result.method === "exact").length;
  const normalized = results.filter((result) => result.method === "normalized").length;
  const unmatched = results.filter((result) => !result.productId).length;
  console.log(`总行数: ${total}`);
  console.log(`可匹配行数（有 raw_model）: ${usable}`);
  console.log(`精确匹配: ${exact} (${percentage(exact, total)})`);
  console.log(`归一化匹配: ${normalized} (${percentage(normalized, total)})`);
  console.log(`未匹配: ${unmatched} (${percentage(unmatched, total)})`);
}

function printCategoryTable(summary: CategorySummary[]) {
  console.log("| 品类 | 总行 | 匹配 | 匹配率 |");
  console.log("|---|---:|---:|---:|");
  for (const row of summary) {
    console.log(`| ${row.category} | ${row.total} | ${row.matched} | ${percentage(row.matched, row.total)} |`);
  }
}

function summarize(results: MatchResult[]): CategorySummary[] {
  const map = new Map<string, CategorySummary>();
  for (const result of results) {
    const category = result.targetCategory ?? result.pathCategory ?? "根目录/不限品类";
    const row =
      map.get(category) ??
      ({
        category,
        total: 0,
        matched: 0,
        exact: 0,
        normalized: 0,
        unmatched: 0,
      } satisfies CategorySummary);
    row.total += 1;
    if (result.productId) row.matched += 1;
    if (result.method === "exact") row.exact += 1;
    if (result.method === "normalized") row.normalized += 1;
    if (!result.productId) row.unmatched += 1;
    map.set(category, row);
  }
  return [...map.values()].sort((a, b) => b.total - a.total || a.category.localeCompare(b.category, "zh-Hans-CN"));
}

function extractPathCategory(relativePath: string): string | null {
  const parts = relativePath.split("/");
  return parts.length > 1 ? parts[0] : null;
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

function escapeMarkdown(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, "<br>");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
