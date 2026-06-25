import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const REPORT_PATH = path.join("docs", "v30.0-price-audit-report.md");
const KNOWN_MODEL_PRICE_FACTORIES = new Set(["美莱德", "雄企", "进成", "优林"]);
const CATEGORY_FACTORY_NAMES = new Set(["太阳能壁灯草坪灯", "跨境产品", "sample data"]);
const KNOWN_BATTERY_PRICE_MODELS = new Set(["ZQ-WQD-002", "ZQ-WQD-004", "ZQ-SZGYBD", "单边"]);

type Recommendation =
  | "delete_offer"
  | "delete_product"
  | "fix_price"
  | "fix_factory"
  | "investigate"
  | "keep";

type IssueType =
  | "A1_battery_as_price"
  | "A2_model_as_price"
  | "A3_spec_as_price"
  | "A4_extreme"
  | "A5_garbage_product"
  | "B1_filename_as_factory"
  | "B2_category_as_factory"
  | "C_sub1_rmb";

type OfferRow = {
  id: string;
  productId: string;
  factoryName: string;
  purchasePrice: { toString(): string };
  currency: string;
  remark: string | null;
  sourceFileId: string | null;
  product: {
    id: string;
    productName: string;
    modelNo: string | null;
    category: string | null;
    remark: string | null;
  };
  sourceFile: {
    fileName: string;
    relativePath: string;
  } | null;
};

interface AuditResult {
  offerId: string;
  productId: string;
  productName: string;
  modelNo: string;
  category: string;
  factoryName: string;
  price: number;
  currency: string;
  sourceFileName: string | null;
  issueType: IssueType;
  evidence: string;
  recommendation: Recommendation;
  suggestedFix?: string;
}

type A2Result = {
  modelNumber: string;
  factoryMedian: number | null;
  forcedKnownFactory: boolean;
};

type SpecMatch = {
  value: number;
  label: string;
};

type FactoryGuess = {
  factoryName: string | null;
  confidence: "high" | "medium" | "low";
  rule: string;
};

type FactoryIssueGroup = {
  currentFactoryName: string;
  sourceFileName: string;
  sourceFileId: string | null;
  count: number;
  guessedFactory: string | null;
  confidence: "high" | "medium" | "low";
  issueType: "B1_filename_as_factory" | "B2_category_as_factory";
};

type Sub1Group = {
  category: string;
  factoryName: string;
  count: number;
  avg: number;
  median: number;
  min: number;
  max: number;
  recommendation: "keep" | "investigate";
  evidence: string;
  offerIds: string[];
  productIds: string[];
  items: Array<{ offerId: string; productId: string }>;
};

type AuditReport = {
  generatedAt: string;
  offerCount: number;
  issueRows: AuditResult[];
  factoryGroups: FactoryIssueGroup[];
  sub1Groups: Sub1Group[];
};

async function main() {
  const offers = await prisma.supplierOffer.findMany({
    select: {
      id: true,
      productId: true,
      factoryName: true,
      purchasePrice: true,
      currency: true,
      remark: true,
      sourceFileId: true,
      product: {
        select: {
          id: true,
          productName: true,
          modelNo: true,
          category: true,
          remark: true,
        },
      },
      sourceFile: {
        select: {
          fileName: true,
          relativePath: true,
        },
      },
    },
    orderBy: [{ factoryName: "asc" }, { purchasePrice: "desc" }],
  });

  const factoryMedians = buildFactoryMedianMap(offers);
  const issueRows = buildIssueRows(offers, factoryMedians);
  const factoryGroups = buildFactoryIssueGroups(offers);
  const sub1Groups = buildSub1Groups(offers);

  const report: AuditReport = {
    generatedAt: new Date().toISOString(),
    offerCount: offers.length,
    issueRows: [...issueRows, ...sub1Groups.flatMap(groupSub1Issues)],
    factoryGroups,
    sub1Groups,
  };

  await mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await writeFile(REPORT_PATH, buildReport(report), "utf8");

  console.log(
    JSON.stringify(
      {
        reportPath: REPORT_PATH,
        supplierOffersAudited: report.offerCount,
        issueRows: report.issueRows.length,
        priceIssues: issueRows.filter((row) => row.issueType.startsWith("A")).length,
        factoryIssueGroups: factoryGroups.length,
        sub1Groups: sub1Groups.length,
      },
      null,
      2,
    ),
  );
}

function buildIssueRows(offers: OfferRow[], factoryMedians: Map<string, number>): AuditResult[] {
  const rows: AuditResult[] = [];

  for (const offer of offers) {
    const price = priceToNumber(offer.purchasePrice);
    const base = baseAuditFields(offer, price);

    const a5Evidence = getGarbageProductEvidence(offer);
    if (a5Evidence) {
      rows.push({
        ...base,
        issueType: "A5_garbage_product",
        evidence: a5Evidence,
        recommendation: "delete_product",
      });
    }

    const a1Evidence = getBatteryAsPriceEvidence(offer, price);
    if (a1Evidence) {
      rows.push({
        ...base,
        issueType: "A1_battery_as_price",
        evidence: a1Evidence,
        recommendation: "delete_offer",
      });
      continue;
    }

    const a3Evidence = getSpecAsPriceEvidence(offer, price);
    if (a3Evidence) {
      rows.push({
        ...base,
        issueType: "A3_spec_as_price",
        evidence: a3Evidence,
        recommendation: "delete_offer",
      });
      continue;
    }

    const a2Result = getModelAsPriceResult(offer, price, factoryMedians);
    if (a2Result) {
      rows.push({
        ...base,
        issueType: "A2_model_as_price",
        evidence: [
          `price ${formatPrice(price)} appears in model_no as ${a2Result.modelNumber}`,
          `same-factory median=${formatNullablePrice(a2Result.factoryMedian)}`,
          a2Result.forcedKnownFactory ? "known model-code factory pattern" : "median exclusion did not apply",
        ].join("; "),
        recommendation: "delete_offer",
      });
      continue;
    }

    if (price > 10000) {
      rows.push({
        ...base,
        issueType: "A4_extreme",
        evidence: `price ${formatPrice(price)} RMB > 10000 and not classified as battery/model/spec-as-price`,
        recommendation: "investigate",
      });
    }
  }

  for (const offer of offers) {
    const price = priceToNumber(offer.purchasePrice);
    const base = baseAuditFields(offer, price);
    const factoryIssue = classifyFactoryIssue(offer);
    if (!factoryIssue) continue;

    const guess = guessFactoryFromFileName(offer.sourceFile?.fileName ?? offer.factoryName);
    rows.push({
      ...base,
      issueType: factoryIssue,
      evidence:
        factoryIssue === "B1_filename_as_factory"
          ? "factory_name looks like a file name / quotation marker"
          : "factory_name is a category, descriptor, or sample-data label",
      recommendation: "fix_factory",
      suggestedFix: guess.factoryName ?? undefined,
    });
  }

  return rows;
}

function buildFactoryMedianMap(offers: OfferRow[]): Map<string, number> {
  const grouped = new Map<string, number[]>();
  for (const offer of offers) {
    if (offer.currency !== "RMB") continue;
    const price = priceToNumber(offer.purchasePrice);
    if (price <= 0) continue;
    const values = grouped.get(offer.factoryName) ?? [];
    values.push(price);
    grouped.set(offer.factoryName, values);
  }

  const medians = new Map<string, number>();
  for (const [factoryName, prices] of grouped) {
    medians.set(factoryName, median(prices));
  }
  return medians;
}

function buildFactoryIssueGroups(offers: OfferRow[]): FactoryIssueGroup[] {
  const grouped = new Map<string, FactoryIssueGroup>();

  for (const offer of offers) {
    const issueType = classifyFactoryIssue(offer);
    if (!issueType) continue;

    const sourceFileName = offer.sourceFile?.fileName ?? "(missing source file)";
    const key = `${issueType}\u0000${offer.factoryName}\u0000${offer.sourceFileId ?? ""}\u0000${sourceFileName}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.count += 1;
      continue;
    }

    const guess = guessFactoryFromFileName(sourceFileName === "(missing source file)" ? offer.factoryName : sourceFileName);
    grouped.set(key, {
      currentFactoryName: offer.factoryName,
      sourceFileName,
      sourceFileId: offer.sourceFileId,
      count: 1,
      guessedFactory: guess.factoryName,
      confidence: guess.confidence,
      issueType,
    });
  }

  return [...grouped.values()].sort((left, right) => {
    if (left.issueType !== right.issueType) return left.issueType.localeCompare(right.issueType);
    if (right.count !== left.count) return right.count - left.count;
    return left.currentFactoryName.localeCompare(right.currentFactoryName);
  });
}

function buildSub1Groups(offers: OfferRow[]): Sub1Group[] {
  const grouped = new Map<string, OfferRow[]>();

  for (const offer of offers) {
    const price = priceToNumber(offer.purchasePrice);
    if (price <= 0 || price >= 1) continue;
    const category = offer.product.category?.trim() || "(未分类)";
    const key = `${category}\u0000${offer.factoryName}`;
    const rows = grouped.get(key) ?? [];
    rows.push(offer);
    grouped.set(key, rows);
  }

  const groups: Sub1Group[] = [];
  for (const rows of grouped.values()) {
    const prices = rows.map((row) => priceToNumber(row.purchasePrice));
    const first = rows[0];
    if (!first) continue;
    const category = first.product.category?.trim() || "(未分类)";
    const factoryName = first.factoryName;
    const keepLikely = isLikelyLegitimateSub1Group(rows);
    groups.push({
      category,
      factoryName,
      count: rows.length,
      avg: prices.reduce((sum, price) => sum + price, 0) / prices.length,
      median: median(prices),
      min: Math.min(...prices),
      max: Math.max(...prices),
      recommendation: keepLikely ? "keep" : "investigate",
      evidence: keepLikely
        ? "low unit price is plausible for strip/profile/accessory style rows; preserve for manual unit check"
        : "sub-1 RMB price needs unit/price-column validation",
      offerIds: rows.map((row) => row.id),
      productIds: unique(rows.map((row) => row.productId)),
      items: rows.map((row) => ({ offerId: row.id, productId: row.productId })),
    });
  }

  return groups.sort((left, right) => {
    if (right.count !== left.count) return right.count - left.count;
    return `${left.category}${left.factoryName}`.localeCompare(`${right.category}${right.factoryName}`);
  });
}

function groupSub1Issues(group: Sub1Group): AuditResult[] {
  return group.items.map((item) => ({
    offerId: item.offerId,
    productId: item.productId,
    productName: "(grouped in C section)",
    modelNo: "",
    category: group.category,
    factoryName: group.factoryName,
    price: group.avg,
    currency: "RMB",
    sourceFileName: null,
    issueType: "C_sub1_rmb",
    evidence: group.evidence,
    recommendation: group.recommendation,
  }));
}

function classifyFactoryIssue(offer: OfferRow): "B1_filename_as_factory" | "B2_category_as_factory" | null {
  const factoryName = offer.factoryName.trim();
  const lower = factoryName.toLowerCase();
  if (lower.includes(".xls") || factoryName.includes("核价") || factoryName.includes("报价")) {
    return "B1_filename_as_factory";
  }
  if (CATEGORY_FACTORY_NAMES.has(factoryName)) {
    return "B2_category_as_factory";
  }
  return null;
}

function getBatteryAsPriceEvidence(offer: OfferRow, price: number): string | null {
  if (offer.factoryName !== "中千") return null;
  const priceInt = asInteger(price);
  if (![14500, 18650, 26700].includes(priceInt)) return null;
  const modelNo = offer.product.modelNo?.trim() ?? "";
  const text = [offer.remark, offer.product.productName, offer.product.modelNo, offer.product.remark].filter(Boolean).join(" ");
  if (text.includes("电池") && text.includes(String(priceInt))) {
    return `remark/product text contains battery marker and ${priceInt}`;
  }
  if (KNOWN_BATTERY_PRICE_MODELS.has(modelNo) || modelNo.startsWith("ZQ-FY-T")) {
    return `known Zhongqian battery-code price pattern: ${modelNo || offer.product.productName} -> ${priceInt}`;
  }
  return null;
}

function getModelAsPriceResult(
  offer: OfferRow,
  price: number,
  factoryMedians: Map<string, number>,
): A2Result | null {
  if (price <= 1000) return null;
  const priceInt = asInteger(price);
  if (priceInt <= 0) return null;

  const modelNo = offer.product.modelNo?.trim() || "";
  if (!modelNo) return null;

  const matchingNumber = extractModelNumberMatches(modelNo).find((part) => part === String(priceInt));
  if (!matchingNumber) return null;

  const factoryMedian = factoryMedians.get(offer.factoryName) ?? null;
  const forcedKnownFactory = KNOWN_MODEL_PRICE_FACTORIES.has(offer.factoryName);
  if (!forcedKnownFactory && factoryMedian != null && isWithinPercent(factoryMedian, price, 0.5)) {
    return null;
  }

  return {
    modelNumber: matchingNumber,
    factoryMedian,
    forcedKnownFactory,
  };
}

function getSpecAsPriceEvidence(offer: OfferRow, price: number): string | null {
  if (price <= 0) return null;
  const priceInt = asInteger(price);
  if (priceInt <= 0) return null;

  const text = [offer.product.productName, offer.product.modelNo].filter(Boolean).join(" | ");
  const specMatches = extractSpecMatches(text);
  const match = specMatches.find((item) => item.value === priceInt);
  if (!match) return null;

  return `${match.label} value ${match.value} equals price ${formatPrice(price)}`;
}

function getGarbageProductEvidence(offer: OfferRow): string | null {
  const price = priceToNumber(offer.purchasePrice);
  if (price !== 0) return null;

  const candidates = [offer.product.productName, offer.product.modelNo]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.replace(/\s*\([^)]*\)\s*$/, "").replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const purePatterns: Array<{ label: string; pattern: RegExp }> = [
    { label: "pure CCT", pattern: /^\d{4}\s*K$/i },
    { label: "pure IP rating", pattern: /^IP\d{2}$/i },
    { label: "pure wattage", pattern: /^\d+(?:\.\d+)?\s*W$/i },
    { label: "pure lumen", pattern: /^\d+(?:\.\d+)?\s*lm$/i },
    { label: "pure duration", pattern: /^\d+(?:\.\d+)?\s*hours?$/i },
    { label: "pure length", pattern: /^\d+(?:\.\d+)?\s*M$/i },
    { label: "pure material", pattern: /^(?:ABS|PC|铝)$/i },
  ];

  for (const normalized of candidates) {
    const match = purePatterns.find(({ pattern }) => pattern.test(normalized));
    if (match) return `${match.label}: ${normalized}`;
  }
  return null;
}

function extractSpecMatches(text: string): SpecMatch[] {
  const matches: SpecMatch[] = [];
  const patterns: Array<{ label: string; pattern: RegExp }> = [
    { label: "CCT", pattern: /(\d{4})(?:\s*[-~]\s*\d{4})?\s*K/gi },
    { label: "high-risk wattage", pattern: /(\d{4,5})\s*W\b/gi },
    { label: "dimension", pattern: /(\d{3,4})\s*[*×x]\s*\d+(?:\.\d+)?/gi },
    { label: "FG model width", pattern: /\bFG[-\s]*(\d{3,4})\b/gi },
  ];

  for (const { label, pattern } of patterns) {
    for (const match of text.matchAll(pattern)) {
      const value = Number(match[1]);
      if (Number.isFinite(value)) matches.push({ label, value });
    }
  }

  return matches;
}

function extractModelNumberMatches(modelNo: string): string[] {
  return [...modelNo.matchAll(/\d{4,6}/g)].map((match) => match[0]);
}

function guessFactoryFromFileName(fileName: string): FactoryGuess {
  const baseName = fileName
    .normalize("NFC")
    .replace(/\.(?:xlsx?|xlsm|csv)$/i, "")
    .replace(/^\s*(?:副本|复件|copy\s+of\s*)/i, "")
    .trim();

  const patterns: Array<{ pattern: RegExp; confidence: "high" | "medium"; rule: string }> = [
    {
      pattern: /^([\u4e00-\u9fa5A-Za-z]{2,6})(?:报价|价格|太阳能|照明|灯|核价|常规|主推|产品)/,
      confidence: "high",
      rule: "leading factory token before quotation/product keyword",
    },
    {
      pattern: /^(?:核价\s*)?(?:To\s+)?([\u4e00-\u9fa5A-Za-z]{2,8})\s*[-_]/i,
      confidence: "medium",
      rule: "leading token before separator",
    },
    {
      pattern: /(?:报价|价格|核价)[-_ ]*([\u4e00-\u9fa5A-Za-z]{2,6})/,
      confidence: "medium",
      rule: "factory token after quotation keyword",
    },
    {
      pattern: /^([\u4e00-\u9fa5A-Za-z]{2,6})\s+\d{4}/,
      confidence: "medium",
      rule: "leading token before year",
    },
  ];

  for (const { pattern, confidence, rule } of patterns) {
    const match = baseName.match(pattern);
    const candidate = cleanFactoryGuess(match?.[1] ?? "");
    if (candidate) return { factoryName: candidate, confidence, rule };
  }

  return { factoryName: null, confidence: "low", rule: "no reliable filename pattern matched" };
}

function cleanFactoryGuess(value: string): string | null {
  const cleaned = value
    .replace(/^(?:核价|报价|价格|灯具|照明)+/, "")
    .replace(/(?:报价|价格|核价|照明|灯具|太阳能|系列)+$/, "")
    .trim();

  if (cleaned.length < 2) return null;
  if (
    /^(?:Wellux|Welfull|Quotation|LED|To|NEW|Solar)$/i.test(cleaned) ||
    /^(?:对比|出中东款|塑料壁|低压|刘林姐发|防眩光筒)$/.test(cleaned)
  ) {
    return null;
  }
  return cleaned;
}

function isLikelyLegitimateSub1Group(rows: OfferRow[]): boolean {
  const first = rows[0];
  if (!first) return false;
  const category = first.product.category ?? "";
  const factory = first.factoryName;
  const text = rows
    .slice(0, 20)
    .map((row) => [row.product.productName, row.product.modelNo, row.product.remark, row.sourceFile?.fileName].filter(Boolean).join(" "))
    .join(" ");

  if (factory === "伟润" && category.includes("线条灯")) return true;
  if (/铝|型材|profile|strip|connector|配件|支架|线|米/i.test(text)) return true;
  return false;
}

function baseAuditFields(offer: OfferRow, price: number) {
  return {
    offerId: offer.id,
    productId: offer.productId,
    productName: offer.product.productName,
    modelNo: offer.product.modelNo ?? "",
    category: offer.product.category ?? "(未分类)",
    factoryName: offer.factoryName,
    price,
    currency: offer.currency,
    sourceFileName: offer.sourceFile?.fileName ?? null,
  };
}

function buildReport(report: AuditReport): string {
  const priceRows = report.issueRows.filter((row) => row.issueType.startsWith("A"));
  const a1Rows = rowsOfType(report.issueRows, "A1_battery_as_price");
  const a2Rows = rowsOfType(report.issueRows, "A2_model_as_price");
  const a3Rows = rowsOfType(report.issueRows, "A3_spec_as_price");
  const a4Rows = rowsOfType(report.issueRows, "A4_extreme");
  const a5Rows = rowsOfType(report.issueRows, "A5_garbage_product");
  const b1Groups = report.factoryGroups.filter((group) => group.issueType === "B1_filename_as_factory");
  const b2Groups = report.factoryGroups.filter((group) => group.issueType === "B2_category_as_factory");
  const summaries = buildRecommendationSummaries(report.issueRows);
  const issueCounts = countBy(report.issueRows, (row) => row.issueType);

  return [
    "# V30.0 价格数据审计报告",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    "Mode: read-only audit. No database writes were performed.",
    "",
    "## 审计总览",
    "",
    `- supplier_offers audited: ${report.offerCount}`,
    `- issue rows classified: ${report.issueRows.length}`,
    `- price anomaly rows: ${priceRows.length}`,
    `- factory-name anomaly rows: ${rowsOfType(report.issueRows, "B1_filename_as_factory").length + rowsOfType(report.issueRows, "B2_category_as_factory").length}`,
    `- sub-1 RMB offer rows: ${rowsOfType(report.issueRows, "C_sub1_rmb").length}`,
    "",
    markdownTable(
      ["类别", "条数", "建议操作"],
      [
        ["A1 电池型号=价格", String(issueCounts.get("A1_battery_as_price") ?? 0), "delete_offer"],
        ["A2 型号编码=价格", String(issueCounts.get("A2_model_as_price") ?? 0), "delete_offer"],
        ["A3 CCT/watts/规格值=价格", String(issueCounts.get("A3_spec_as_price") ?? 0), "delete_offer"],
        ["A4 极端高价", String(issueCounts.get("A4_extreme") ?? 0), "investigate"],
        ["A5 垃圾产品", String(issueCounts.get("A5_garbage_product") ?? 0), "delete_product"],
        ["B1 文件名=工厂名", String(issueCounts.get("B1_filename_as_factory") ?? 0), "fix_factory"],
        ["B2 品类名/描述=工厂名", String(issueCounts.get("B2_category_as_factory") ?? 0), "fix_factory"],
        ["C Sub-1 RMB 价格", String(issueCounts.get("C_sub1_rmb") ?? 0), "keep / investigate"],
      ],
    ),
    "",
    "## A. 价格异常",
    "",
    "### A1. 电池型号=价格",
    "",
    markdownTable(
      ["product_name", "model_no", "factory", "price", "电池型号", "建议"],
      a1Rows.map((row) => [
        row.productName,
        row.modelNo,
        row.factoryName,
        formatPrice(row.price),
        extractFirstNumber(row.evidence),
        row.recommendation,
      ]),
    ),
    "",
    "### A2. 型号编码=价格",
    "",
    markdownTable(
      ["product_name", "model_no", "factory", "price", "型号数字", "同工厂中位价", "建议"],
      a2Rows.map((row) => [
        row.productName,
        row.modelNo,
        row.factoryName,
        formatPrice(row.price),
        extractFirstNumber(row.evidence),
        extractMedianText(row.evidence),
        row.recommendation,
      ]),
    ),
    "",
    "### A3. CCT/watts 值=价格",
    "",
    markdownTable(
      ["product_name", "factory", "price", "被提取的规格值", "建议"],
      a3Rows.map((row) => [
        row.productName,
        row.factoryName,
        formatPrice(row.price),
        row.evidence,
        row.recommendation,
      ]),
    ),
    "",
    "### A4. 极端高价",
    "",
    markdownTable(
      ["product_name", "factory", "price", "源文件", "建议"],
      a4Rows.map((row) => [
        row.productName,
        row.factoryName,
        formatPrice(row.price),
        row.sourceFileName ?? "-",
        row.recommendation,
      ]),
    ),
    "",
    "### A5. 垃圾产品",
    "",
    markdownTable(
      ["product_name", "factory", "price", "证据", "建议"],
      a5Rows.map((row) => [
        row.productName,
        row.factoryName,
        formatPrice(row.price),
        row.evidence,
        row.recommendation,
      ]),
    ),
    "",
    "## B. 工厂名异常",
    "",
    "### B1. 文件名=工厂名",
    "",
    markdownTable(
      ["当前工厂名", "条数", "源文件", "推断工厂名", "置信度"],
      b1Groups.map((group) => [
        group.currentFactoryName,
        String(group.count),
        group.sourceFileName,
        group.guessedFactory ?? "-",
        group.confidence,
      ]),
    ),
    "",
    "### B2. 品类名/描述=工厂名",
    "",
    markdownTable(
      ["当前工厂名", "条数", "源文件分组", "推断工厂名", "置信度"],
      b2Groups.map((group) => [
        group.currentFactoryName,
        String(group.count),
        group.sourceFileName,
        group.guessedFactory ?? "-",
        group.confidence,
      ]),
    ),
    "",
    "## C. Sub-1 RMB 价格",
    "",
    markdownTable(
      ["品类", "工厂", "条数", "均值", "中位数", "范围", "建议(keep/investigate)"],
      report.sub1Groups.map((group) => [
        group.category,
        group.factoryName,
        String(group.count),
        formatPrice(group.avg),
        formatPrice(group.median),
        `${formatPrice(group.min)}-${formatPrice(group.max)}`,
        group.recommendation,
      ]),
    ),
    "",
    "## 修正方案汇总",
    "",
    markdownTable(
      ["操作", "条数", "涉及 offer", "涉及 product"],
      summaries.map((summary) => [
        summary.recommendation,
        String(summary.issueCount),
        compactIdList(summary.offerIds),
        compactIdList(summary.productIds),
      ]),
    ),
    "",
    "## 约束确认",
    "",
    "- 本次脚本只读取 SQLite/Prisma 数据，并写出 Markdown 报告。",
    "- 未修改数据库、业务代码、schema 或源 Excel 文件。",
    "- B 类工厂名仅提供推断建议，不自动修正。",
    "- C 类 sub-1 RMB 仅按组标记 keep/investigate，不预设全部错误。",
    "",
  ].join("\n");
}

function rowsOfType(rows: AuditResult[], issueType: IssueType): AuditResult[] {
  return rows.filter((row) => row.issueType === issueType);
}

function buildRecommendationSummaries(rows: AuditResult[]) {
  const grouped = new Map<
    Recommendation,
    { recommendation: Recommendation; issueCount: number; offerIds: string[]; productIds: string[] }
  >();

  for (const row of rows) {
    const existing = grouped.get(row.recommendation) ?? {
      recommendation: row.recommendation,
      issueCount: 0,
      offerIds: [],
      productIds: [],
    };
    existing.issueCount += 1;
    existing.offerIds.push(row.offerId);
    if (row.productId) existing.productIds.push(row.productId);
    grouped.set(row.recommendation, existing);
  }

  const order: Recommendation[] = ["delete_offer", "delete_product", "fix_price", "fix_factory", "investigate", "keep"];
  return [...grouped.values()]
    .map((summary) => ({
      ...summary,
      offerIds: unique(summary.offerIds),
      productIds: unique(summary.productIds),
    }))
    .sort((left, right) => order.indexOf(left.recommendation) - order.indexOf(right.recommendation));
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

function compactIdList(ids: string[]): string {
  const uniqueIds = unique(ids);
  if (uniqueIds.length === 0) return "-";
  const shown = uniqueIds.slice(0, 8).join(", ");
  return uniqueIds.length > 8 ? `${uniqueIds.length} total; first 8: ${shown}` : shown;
}

function countBy<T>(items: T[], keyFn: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = keyFn(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function priceToNumber(value: { toString(): string } | number): number {
  const raw = typeof value === "number" ? String(value) : value.toString();
  const numeric = Number(raw.replace(/,/g, ""));
  return Number.isFinite(numeric) ? numeric : 0;
}

function formatPrice(value: number): string {
  if (!Number.isFinite(value)) return "-";
  return value.toFixed(4).replace(/\.?0+$/, "");
}

function formatNullablePrice(value: number | null): string {
  return value == null ? "-" : formatPrice(value);
}

function asInteger(value: number): number {
  const rounded = Math.round(value);
  return Math.abs(value - rounded) < 0.001 ? rounded : -1;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

function isWithinPercent(left: number, right: number, percent: number): boolean {
  const lower = right * (1 - percent);
  const upper = right * (1 + percent);
  return left >= lower && left <= upper;
}

function extractFirstNumber(text: string): string {
  return text.match(/\d+(?:\.\d+)?/)?.[0] ?? "-";
}

function extractMedianText(text: string): string {
  return text.match(/same-factory median=([^;]+)/)?.[1] ?? "-";
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
