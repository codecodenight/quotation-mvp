import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const REPORT_PATH = path.join("docs", "v20.0-price-config-audit-report.md");
const SAMPLE_CATEGORIES = ["球泡", "投光灯", "Highbay"];
const CONFIG_PARAM_KEYS = ["voltage", "driver_type", "luminous_efficacy"] as const;

type ConfigParamKey = (typeof CONFIG_PARAM_KEYS)[number];

type ProductRow = {
  id: string;
  productName: string;
  modelNo: string | null;
  category: string | null;
};

type ProductParamRow = {
  productId: string;
  paramKey: string;
  rawValue: string;
  normalizedValue: string | null;
  unit: string | null;
};

type OfferRow = {
  id: string;
  productId: string;
  factoryName: string;
  purchasePrice: { toString(): string };
  currency: string;
};

type DuplicateOfferRow = {
  product_id: string;
  factory_name: string;
  cnt: number | bigint;
  prices: string | null;
  product_name: string;
  model_no: string | null;
  category: string | null;
};

type ProductSummary = {
  id: string;
  productName: string;
  modelNo: string;
  category: string;
  prefix: string;
  params: Record<ConfigParamKey, string[]>;
  offers: Array<{
    factoryName: string;
    price: string;
    currency: string;
  }>;
};

type PrefixGroup = {
  category: string;
  prefix: string;
  products: ProductSummary[];
  voltageDifferent: boolean;
  driverTypeDifferent: boolean;
  efficacyDifferent: boolean;
};

type AuditResult = {
  generatedAt: string;
  productsWithModelNo: number;
  prefixGroups: PrefixGroup[];
  duplicateOfferRows: DuplicateOfferRow[];
  sampleGroupsByCategory: Map<string, PrefixGroup[]>;
};

async function main() {
  const [products, params, offers, duplicateOfferRows] = await Promise.all([
    prisma.product.findMany({
      where: {
        modelNo: {
          not: null,
        },
      },
      select: {
        id: true,
        productName: true,
        modelNo: true,
        category: true,
      },
    }),
    prisma.productParam.findMany({
      where: {
        paramKey: {
          in: [...CONFIG_PARAM_KEYS],
        },
      },
      select: {
        productId: true,
        paramKey: true,
        rawValue: true,
        normalizedValue: true,
        unit: true,
      },
    }),
    prisma.supplierOffer.findMany({
      select: {
        id: true,
        productId: true,
        factoryName: true,
        purchasePrice: true,
        currency: true,
      },
      orderBy: [{ factoryName: "asc" }, { purchasePrice: "asc" }],
    }),
    loadDuplicateOfferRows(),
  ]);

  const paramsByProduct = groupParamsByProduct(params);
  const offersByProduct = groupOffersByProduct(offers);
  const prefixGroups = buildPrefixGroups(products, paramsByProduct, offersByProduct);
  const sampleGroupsByCategory = new Map(
    SAMPLE_CATEGORIES.map((category) => [
      category,
      prefixGroups.filter((group) => group.category === category).sort(compareGroupsForReport),
    ]),
  );

  const result: AuditResult = {
    generatedAt: new Date().toISOString(),
    productsWithModelNo: products.length,
    prefixGroups,
    duplicateOfferRows,
    sampleGroupsByCategory,
  };

  await mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await writeFile(REPORT_PATH, buildReport(result), "utf8");

  console.log(
    JSON.stringify(
      {
        reportPath: REPORT_PATH,
        productsWithModelNo: result.productsWithModelNo,
        prefixGroups: result.prefixGroups.length,
        voltageDifferent: result.prefixGroups.filter((group) => group.voltageDifferent).length,
        driverTypeDifferent: result.prefixGroups.filter((group) => group.driverTypeDifferent).length,
        efficacyDifferent: result.prefixGroups.filter((group) => group.efficacyDifferent).length,
        duplicateOfferGroups: result.duplicateOfferRows.length,
      },
      null,
      2,
    ),
  );
}

async function loadDuplicateOfferRows(): Promise<DuplicateOfferRow[]> {
  return prisma.$queryRaw<DuplicateOfferRow[]>`
    SELECT
      so.product_id,
      so.factory_name,
      COUNT(*) AS cnt,
      GROUP_CONCAT(CAST(so.purchase_price AS TEXT) || ' ' || so.currency, ' / ') AS prices,
      p.product_name,
      p.model_no,
      p.category
    FROM supplier_offers so
    JOIN products p ON p.id = so.product_id
    GROUP BY so.product_id, so.factory_name
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC, p.category, p.model_no, so.factory_name
  `;
}

function groupParamsByProduct(params: ProductParamRow[]): Map<string, Record<ConfigParamKey, string[]>> {
  const grouped = new Map<string, Record<ConfigParamKey, string[]>>();
  for (const param of params) {
    if (!isConfigParamKey(param.paramKey)) continue;
    const values = grouped.get(param.productId) ?? {
      voltage: [],
      driver_type: [],
      luminous_efficacy: [],
    };
    const value = formatParamValue(param);
    if (value && !values[param.paramKey].includes(value)) {
      values[param.paramKey].push(value);
    }
    grouped.set(param.productId, values);
  }

  return grouped;
}

function groupOffersByProduct(offers: OfferRow[]): Map<string, ProductSummary["offers"]> {
  const grouped = new Map<string, ProductSummary["offers"]>();
  for (const offer of offers) {
    const rows = grouped.get(offer.productId) ?? [];
    rows.push({
      factoryName: offer.factoryName,
      price: offer.purchasePrice.toString(),
      currency: offer.currency,
    });
    grouped.set(offer.productId, rows);
  }
  return grouped;
}

function buildPrefixGroups(
  products: ProductRow[],
  paramsByProduct: Map<string, Record<ConfigParamKey, string[]>>,
  offersByProduct: Map<string, ProductSummary["offers"]>,
): PrefixGroup[] {
  const grouped = new Map<string, ProductSummary[]>();

  for (const product of products) {
    const modelNo = product.modelNo?.trim();
    if (!modelNo) continue;
    const category = product.category?.trim() || "(未分类)";
    const prefix = deriveModelPrefix(modelNo);
    if (!prefix || prefix.length < 2) continue;

    const key = `${category}\u0000${prefix}`;
    const rows = grouped.get(key) ?? [];
    rows.push({
      id: product.id,
      productName: product.productName,
      modelNo,
      category,
      prefix,
      params: paramsByProduct.get(product.id) ?? {
        voltage: [],
        driver_type: [],
        luminous_efficacy: [],
      },
      offers: offersByProduct.get(product.id) ?? [],
    });
    grouped.set(key, rows);
  }

  const groups: PrefixGroup[] = [];
  for (const productsInGroup of grouped.values()) {
    if (productsInGroup.length < 2) continue;
    groups.push({
      category: productsInGroup[0]?.category ?? "(未分类)",
      prefix: productsInGroup[0]?.prefix ?? "",
      products: productsInGroup.sort((left, right) => left.modelNo.localeCompare(right.modelNo)),
      voltageDifferent: hasDifferentParamValues(productsInGroup, "voltage"),
      driverTypeDifferent: hasDifferentParamValues(productsInGroup, "driver_type"),
      efficacyDifferent: hasDifferentParamValues(productsInGroup, "luminous_efficacy"),
    });
  }

  return groups.sort(compareGroupsForReport);
}

function deriveModelPrefix(modelNo: string): string {
  let prefix = normalizeModel(modelNo);

  const suffixPatterns = [
    /\s*[-_/+]*\s*(?:AC|DC)?\d{2,3}(?:[-~–]\d{2,3})?\s*V$/i,
    /\s*[-_/+]*\s*(?:DOB|DOBIC|LINEAR|IC|DRIVER|隔离|非隔离|恒流|线性)$/i,
    /\s*[-_/+]*\s*\d+(?:\.\d+)?\s*(?:LM\/?W|LM|LUMEN)$/i,
    /\s*[-_/+]*\s*\d+(?:\.\d+)?\s*W$/i,
    /\s*[-_/+]*\s*(?:[23456]CCT|CCT|单色|双色|三色|调光|DIMMABLE)$/i,
  ];

  let changed = true;
  while (changed) {
    changed = false;
    for (const pattern of suffixPatterns) {
      const next = prefix.replace(pattern, "").trim();
      if (next !== prefix) {
        prefix = cleanupPrefixSeparators(next);
        changed = true;
      }
    }
  }

  return cleanupPrefixSeparators(prefix);
}

function normalizeModel(value: string): string {
  return value
    .normalize("NFC")
    .replace(/[×＊]/g, "*")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanupPrefixSeparators(value: string): string {
  return value.replace(/\s*[-_/+|,，;；:：]\s*$/g, "").trim();
}

function hasDifferentParamValues(products: ProductSummary[], paramKey: ConfigParamKey): boolean {
  const signatures = new Set<string>();
  for (const product of products) {
    const values = product.params[paramKey].filter(Boolean).sort();
    if (values.length === 0) continue;
    signatures.add(values.join(" / "));
  }
  return signatures.size > 1;
}

function formatParamValue(param: ProductParamRow): string {
  const value = (param.normalizedValue || param.rawValue).trim();
  if (!value) return "";
  if (param.paramKey === "voltage" && param.unit === "V" && !/V$/i.test(value)) {
    return `${value}V`;
  }
  if (param.paramKey === "luminous_efficacy" && param.unit && !value.toLowerCase().includes("lm")) {
    return `${value}${param.unit}`;
  }
  return value;
}

function buildReport(result: AuditResult): string {
  const multiVoltage = result.prefixGroups.filter((group) => group.voltageDifferent);
  const multiDriver = result.prefixGroups.filter((group) => group.driverTypeDifferent);
  const multiEfficacy = result.prefixGroups.filter((group) => group.efficacyDifferent);
  const anyConfigDifferent = result.prefixGroups.filter(
    (group) => group.voltageDifferent || group.driverTypeDifferent || group.efficacyDifferent,
  );
  const sameParams = result.prefixGroups.filter(
    (group) => !group.voltageDifferent && !group.driverTypeDifferent && !group.efficacyDifferent,
  );
  const conclusion = buildConclusion(result.duplicateOfferRows.length, anyConfigDifferent.length);

  return `# V20.0 多配置价格审计报告

生成时间: ${result.generatedAt}

## 结论

${conclusion}

## Part 1: 同前缀多配置组

| 指标 | 数量 |
|---|---:|
| 有 model_no 的产品 | ${result.productsWithModelNo} |
| 同品类同前缀多产品组总数 | ${result.prefixGroups.length} |
| 其中 voltage 不同 | ${multiVoltage.length} |
| 其中 driver_type 不同 | ${multiDriver.length} |
| 其中 luminous_efficacy 不同 | ${multiEfficacy.length} |
| 任一配置参数不同 | ${anyConfigDifferent.length} |
| 前缀相同但配置参数也相同 | ${sameParams.length} |

### 多配置组样本（前 30 组）

| 品类 | 前缀 | 产品数 | voltage | driver_type | efficacy | 判断 |
|---|---|---:|---|---|---|---|
${result.prefixGroups.slice(0, 30).map(formatGroupSummaryRow).join("\n")}

## Part 2: 同产品多 offer

同产品同工厂多 offer 组: ${result.duplicateOfferRows.length}

${result.duplicateOfferRows.length === 0 ? "当前没有 `product_id + factory_name` 多 offer 组；这说明当前价格模型基本保持为“同工厂同产品一条报价”。" : formatDuplicateOfferRows(result.duplicateOfferRows)}

## Part 3: 抽样验证

${SAMPLE_CATEGORIES.map((category) => formatSampleCategory(category, result.sampleGroupsByCategory.get(category) ?? [])).join("\n\n")}

## 建议

${buildRecommendation(result.duplicateOfferRows.length, anyConfigDifferent.length)}
`;
}

function buildConclusion(duplicateOfferGroups: number, multiConfigGroups: number): string {
  if (duplicateOfferGroups > 0 && multiConfigGroups > 0) {
    return `当前 DB 已经有 ${multiConfigGroups} 个同前缀多配置产品组，说明电压/驱动/光效等配置大多已通过“多产品行”承载；同时存在 ${duplicateOfferGroups} 组同产品同工厂多 offer。后者在同一个 product_id 下无法表达不同配置，更像重复导入、多价格列残留或历史价格残留。结论：不应为了这些重复 offer 直接新增多配置 schema，应该先做重复 offer/价格语义治理。`;
  }
  if (duplicateOfferGroups === 0 && multiConfigGroups > 0) {
    return "当前 DB 已经大量通过“同系列不同产品行”承载电压/驱动/光效等多配置报价；暂不需要为了多配置 FOB 价格新增 schema。下一步更适合进入报价模板/展示层，让用户在报价时更清楚地选择具体配置产品。";
  }
  if (duplicateOfferGroups > 0) {
    return `当前 DB 存在 ${duplicateOfferGroups} 组同产品同工厂多 offer。由于这些记录共享同一个 product_id，无法在当前数据里区分 voltage/driver/efficacy 配置，优先判断为数据治理问题而不是 schema 需求。`;
  }
  return "当前审计未发现明显的多配置价格结构需求。";
}

function buildRecommendation(duplicateOfferGroups: number, multiConfigGroups: number): string {
  const lines: string[] = [];
  if (multiConfigGroups > 0) {
    lines.push("- 不建议立刻新增“同产品多配置价格”schema；现有数据已经以多个 products 表行表达多数配置差异。");
    lines.push("- 报价体验上，应优先增强产品选择/模板展示：在搜索结果和报价预览中突出 voltage / driver_type / luminous_efficacy，避免用户选错配置。");
  }
  if (duplicateOfferGroups > 0) {
    lines.push("- 对 Part 2 的同产品同工厂多 offer 做一次单独清理或确认；这些记录共享同一组产品参数，不能可靠表达不同配置。");
    lines.push("- 如果某些重复 offer 确实来自多 FOB 配置列，应在导入时拆成多个具体产品/配置行，再关联各自 supplier_offer。");
  } else {
    lines.push("- 同产品同工厂多 offer 为 0，说明 V2.10 upsert 价格模型仍然一致。");
  }
  lines.push("- 如果未来要导入客户报价汇总表的多 FOB 列，建议先解析为多个具体产品/配置行，而不是把多价格塞回同一个 supplier_offer。");
  return lines.join("\n");
}

function formatGroupSummaryRow(group: PrefixGroup): string {
  return [
    escapeMd(group.category),
    escapeMd(group.prefix),
    group.products.length,
    escapeMd(uniqueGroupParamValues(group, "voltage").join(" / ") || "-"),
    escapeMd(uniqueGroupParamValues(group, "driver_type").join(" / ") || "-"),
    escapeMd(uniqueGroupParamValues(group, "luminous_efficacy").join(" / ") || "-"),
    group.voltageDifferent || group.driverTypeDifferent || group.efficacyDifferent ? "配置已分行" : "同配置/尺寸变体",
  ].join(" | ").replace(/^/, "| ").replace(/$/, " |");
}

function formatDuplicateOfferRows(rows: DuplicateOfferRow[]): string {
  return `| 品类 | model_no | 产品名 | 工厂 | offer数 | 价格 |
|---|---|---|---|---:|---|
${rows.map((row) => `| ${escapeMd(row.category ?? "-")} | ${escapeMd(row.model_no ?? "-")} | ${escapeMd(row.product_name)} | ${escapeMd(row.factory_name)} | ${toNumber(row.cnt)} | ${escapeMd(row.prices ?? "-")} |`).join("\n")}`;
}

function formatSampleCategory(category: string, groups: PrefixGroup[]): string {
  const header = `### ${category}

前缀组数量: ${groups.length}
`;
  if (groups.length === 0) {
    return `${header}
未发现同前缀多产品组。`;
  }

  return `${header}
${groups.map(formatDetailedGroup).join("\n\n")}`;
}

function formatDetailedGroup(group: PrefixGroup): string {
  const verdict = group.voltageDifferent || group.driverTypeDifferent || group.efficacyDifferent
    ? "已通过多产品行覆盖配置差异"
    : "未发现 voltage/driver/efficacy 差异，可能是尺寸/外观变体或重复";

  return `#### ${escapeMd(group.prefix)}

判断: ${verdict}

| model_no | product_name | voltage | driver_type | efficacy | offers |
|---|---|---|---|---|---|
${group.products.map((product) => `| ${escapeMd(product.modelNo)} | ${escapeMd(product.productName)} | ${escapeMd(product.params.voltage.join(" / ") || "-")} | ${escapeMd(product.params.driver_type.join(" / ") || "-")} | ${escapeMd(product.params.luminous_efficacy.join(" / ") || "-")} | ${escapeMd(formatOffers(product.offers))} |`).join("\n")}`;
}

function formatOffers(offers: ProductSummary["offers"]): string {
  if (offers.length === 0) return "-";
  return offers
    .slice(0, 8)
    .map((offer) => `${offer.factoryName}: ${offer.price} ${offer.currency}`)
    .join("; ")
    .concat(offers.length > 8 ? `; ...(+${offers.length - 8})` : "");
}

function uniqueGroupParamValues(group: PrefixGroup, paramKey: ConfigParamKey): string[] {
  return Array.from(new Set(group.products.flatMap((product) => product.params[paramKey]))).sort();
}

function compareGroupsForReport(left: PrefixGroup, right: PrefixGroup): number {
  return (
    right.products.length - left.products.length ||
    left.category.localeCompare(right.category) ||
    left.prefix.localeCompare(right.prefix)
  );
}

function isConfigParamKey(value: string): value is ConfigParamKey {
  return CONFIG_PARAM_KEYS.includes(value as ConfigParamKey);
}

function toNumber(value: number | bigint): number {
  return typeof value === "bigint" ? Number(value) : value;
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
