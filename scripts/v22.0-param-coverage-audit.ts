import "dotenv/config";

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const REPORT_PATH = path.join("docs", "v22.0-param-coverage-audit-report.md");

const CORE_PARAM_KEYS = [
  "watts",
  "cct",
  "cri",
  "pf",
  "voltage",
  "ip",
  "material",
  "size_display",
  "driver_type",
  "beam_angle",
  "luminous_efficacy",
  "base",
  "shape",
  "led_type",
  "leds_per_meter",
  "cutout_mm",
  "sensor",
  "lumens",
] as const;

type ProductRow = {
  id: string;
  productName: string;
  modelNo: string | null;
  category: string | null;
  material: string | null;
  size: string | null;
};

type ProductParamRow = {
  productId: string;
  paramKey: string;
  rawValue: string;
  normalizedValue: string | null;
};

type CoverageCell = {
  covered: number;
  total: number;
  pct: number;
};

type TemplateColumn = {
  header: string;
  paramKeys: string[];
  fallback?: string;
};

type TemplateSpec = {
  category: string;
  sheetName: string;
  source: "implemented" | "documented-v21.2";
  columns: TemplateColumn[];
};

type TemplateColumnCoverage = TemplateColumn & {
  covered: number;
  total: number;
  pct: number;
  status: Status;
};

type Status = "GREEN" | "YELLOW" | "RED";

type FeasibilityRow = {
  category: string;
  paramKey: string;
  products: number;
  currentCovered: number;
  currentPct: number;
  missingProducts: number;
  sampleSize: number;
  extractable: number;
  extractablePct: number;
  extractor: string;
  examples: string[];
  priorityScore: number;
};

const TEMPLATE_SPECS: TemplateSpec[] = [
  {
    category: "面板灯",
    sheetName: "LED Slim Panel-plastic sheet",
    source: "implemented",
    columns: [
      { header: "Power", paramKeys: ["watts"] },
      { header: "Size (mm)", paramKeys: ["size_display", "length_mm", "width_mm", "height_mm"], fallback: "products.size" },
      { header: "Material", paramKeys: ["material"], fallback: "products.material" },
      { header: "CCT", paramKeys: ["cct"] },
      { header: "CRI", paramKeys: ["cri"] },
      { header: "PF", paramKeys: ["pf"] },
      { header: "Voltage", paramKeys: ["voltage"] },
      { header: "Driver", paramKeys: ["driver_type"] },
      { header: "IP", paramKeys: ["ip"] },
    ],
  },
  {
    category: "投光灯",
    sheetName: "LED Floodlight",
    source: "implemented",
    columns: [
      { header: "Power", paramKeys: ["watts"] },
      { header: "Size (mm)", paramKeys: ["size_display"], fallback: "products.size" },
      { header: "Material", paramKeys: ["material"], fallback: "products.material" },
      { header: "CCT", paramKeys: ["cct"] },
      { header: "CRI", paramKeys: ["cri"] },
      { header: "PF", paramKeys: ["pf"] },
      { header: "Voltage", paramKeys: ["voltage"] },
      { header: "Driver", paramKeys: ["driver_type"] },
      { header: "IP", paramKeys: ["ip"] },
      { header: "Beam Angle", paramKeys: ["beam_angle"] },
    ],
  },
  {
    category: "线条灯",
    sheetName: "LED Linear Light",
    source: "implemented",
    columns: [
      { header: "Power", paramKeys: ["watts"] },
      { header: "Length (mm)", paramKeys: ["length_mm", "size_display"], fallback: "products.size" },
      { header: "Material", paramKeys: ["material"], fallback: "products.material" },
      { header: "CCT", paramKeys: ["cct"] },
      { header: "CRI", paramKeys: ["cri"] },
      { header: "PF", paramKeys: ["pf"] },
      { header: "Voltage", paramKeys: ["voltage"] },
      { header: "IP", paramKeys: ["ip"] },
    ],
  },
  {
    category: "球泡",
    sheetName: "LED Bulb",
    source: "implemented",
    columns: [
      { header: "Power", paramKeys: ["watts"] },
      { header: "Base", paramKeys: ["base"] },
      { header: "Shape", paramKeys: ["shape"] },
      { header: "CCT", paramKeys: ["cct"] },
      { header: "CRI", paramKeys: ["cri"] },
      { header: "PF", paramKeys: ["pf"] },
      { header: "Voltage", paramKeys: ["voltage"] },
      { header: "Driver", paramKeys: ["driver_type"] },
      { header: "Luminous Efficacy", paramKeys: ["luminous_efficacy"] },
    ],
  },
  {
    category: "灯带",
    sheetName: "LED Strips",
    source: "implemented",
    columns: [
      { header: "W/m", paramKeys: ["watts"] },
      { header: "Voltage", paramKeys: ["voltage"] },
      { header: "LED Chip", paramKeys: ["led_type"] },
      { header: "LEDs/m", paramKeys: ["leds_per_meter", "led_count"] },
      { header: "CCT", paramKeys: ["cct"] },
      { header: "CRI", paramKeys: ["cri"] },
      { header: "IP", paramKeys: ["ip"] },
      { header: "PCB Width", paramKeys: ["width_mm"] },
    ],
  },
  {
    category: "筒灯",
    sheetName: "LED Downlight",
    source: "documented-v21.2",
    columns: [
      { header: "Power", paramKeys: ["watts"] },
      { header: "Size (mm)", paramKeys: ["size_display"], fallback: "products.size" },
      { header: "Cutout (mm)", paramKeys: ["cutout_mm"] },
      { header: "Material", paramKeys: ["material"], fallback: "products.material" },
      { header: "CCT", paramKeys: ["cct"] },
      { header: "CRI", paramKeys: ["cri"] },
      { header: "PF", paramKeys: ["pf"] },
      { header: "Voltage", paramKeys: ["voltage"] },
      { header: "Driver", paramKeys: ["driver_type"] },
      { header: "Beam Angle", paramKeys: ["beam_angle"] },
    ],
  },
  {
    category: "三防灯",
    sheetName: "LED Tri-proof Light",
    source: "documented-v21.2",
    columns: [
      { header: "Power", paramKeys: ["watts"] },
      { header: "Length (mm)", paramKeys: ["length_mm", "size_display"], fallback: "products.size" },
      { header: "CCT", paramKeys: ["cct"] },
      { header: "CRI", paramKeys: ["cri"] },
      { header: "PF", paramKeys: ["pf"] },
      { header: "Voltage", paramKeys: ["voltage"] },
      { header: "IP", paramKeys: ["ip"] },
      { header: "Luminous Efficacy", paramKeys: ["luminous_efficacy"] },
    ],
  },
  {
    category: "吸顶灯",
    sheetName: "LED Ceiling Lamp",
    source: "documented-v21.2",
    columns: [
      { header: "Power", paramKeys: ["watts"] },
      { header: "Size (mm)", paramKeys: ["size_display", "diameter_mm"], fallback: "products.size" },
      { header: "Material", paramKeys: ["material"], fallback: "products.material" },
      { header: "CCT", paramKeys: ["cct"] },
      { header: "CRI", paramKeys: ["cri"] },
      { header: "PF", paramKeys: ["pf"] },
      { header: "Voltage", paramKeys: ["voltage"] },
      { header: "Driver", paramKeys: ["driver_type"] },
    ],
  },
  {
    category: "太阳能壁灯",
    sheetName: "Solar Wall Light",
    source: "documented-v21.2",
    columns: [
      { header: "Power", paramKeys: ["watts"] },
      { header: "Material", paramKeys: ["material"], fallback: "products.material" },
      { header: "CCT", paramKeys: ["cct"] },
      { header: "CRI", paramKeys: ["cri"] },
      { header: "IP", paramKeys: ["ip"] },
      { header: "Lumens", paramKeys: ["lumens"] },
      { header: "Sensor", paramKeys: ["sensor"] },
    ],
  },
];

const EXTRACTORS: Record<string, { label: string; extract: (value: string) => string | null }> = {
  watts: {
    label: String.raw`/(\d+(?:\.\d+)?)\s*(?:[Ww](?![A-Za-z])|瓦)/`,
    extract: (value) => firstMatch(value, /(\d+(?:\.\d+)?)\s*(?:[Ww](?![A-Za-z])|瓦)/),
  },
  cct: {
    label: String.raw`/(\d{4})\s*[Kk]/ or /\b(2700|3000|4000|5000|6000|6500)\b/`,
    extract: (value) => firstMatch(value, /(\d{4})\s*[Kk]/) ?? firstMatch(value, /\b(2700|3000|4000|5000|6000|6500)\b/),
  },
  voltage: {
    label: String.raw`/(\d{2,3})\s*[Vv]/ or /AC\s*(\d+-\d+)/i`,
    extract: (value) => firstMatch(value, /AC\s*(\d{2,3}\s*-\s*\d{2,3})/i)?.replace(/\s+/g, "") ?? firstMatch(value, /(\d{2,3})\s*[Vv]/),
  },
  ip: {
    label: String.raw`/IP\s*(\d{2})/i`,
    extract: (value) => firstMatch(value, /IP\s*(\d{2})/i),
  },
  beam_angle: {
    label: String.raw`/(\d+)\s*°/ or /(\d+)\s*degree/i`,
    extract: (value) => firstMatch(value, /(\d+)\s*°/) ?? firstMatch(value, /(\d+)\s*degree/i),
  },
  material: {
    label: String.raw`/(aluminum|plastic|iron|glass|acrylic|PC|ABS|steel|铝|塑料|铁|玻璃|亚克力|钢)/i`,
    extract: (value) => firstMatch(value, /(aluminum|plastic|iron|glass|acrylic|PC|ABS|steel|铝|塑料|铁|玻璃|亚克力|钢)/i),
  },
  base: {
    label: String.raw`/(E27|E14|E26|B22|GU10|GU5\.3|MR16|G9|G4)/i`,
    extract: (value) => firstMatch(value, /(E27|E14|E26|B22|GU10|GU5\.3|MR16|G9|G4)/i),
  },
  cri: {
    label: String.raw`/(?:CRI|Ra)\s*≥?\s*(\d{2,3})/i`,
    extract: (value) => firstMatch(value, /(?:CRI|Ra)\s*≥?\s*(\d{2,3})/i),
  },
  pf: {
    label: String.raw`/PF\s*≥?\s*(0?\.\d+|[01](?:\.0)?)/i`,
    extract: (value) => firstMatch(value, /PF\s*≥?\s*(0?\.\d+|[01](?:\.0)?)/i),
  },
  luminous_efficacy: {
    label: String.raw`/(\d+(?:\.\d+)?)\s*lm\s*\/\s*w/i`,
    extract: (value) => firstMatch(value, /(\d+(?:\.\d+)?)\s*lm\s*\/\s*w/i),
  },
  lumens: {
    label: String.raw`/(\d+(?:\.\d+)?)\s*(?:lm|流明)/i`,
    extract: (value) => firstMatch(value, /(\d+(?:\.\d+)?)\s*(?:lm|流明)/i),
  },
  led_type: {
    label: String.raw`/(SMD\s*\d{4}|COB|2835|3030|5050)/i`,
    extract: (value) => firstMatch(value, /(SMD\s*\d{4}|COB|2835|3030|5050)/i),
  },
  leds_per_meter: {
    label: String.raw`/(\d+)\s*(?:leds?\/m|灯\/米|珠\/米)/i`,
    extract: (value) => firstMatch(value, /(\d+)\s*(?:leds?\/m|灯\/米|珠\/米)/i),
  },
  cutout_mm: {
    label: String.raw`/开孔\s*(\d+)/ or /(\d+)\s*mm\s*开孔/i`,
    extract: (value) => firstMatch(value, /开孔\s*(\d+)/) ?? firstMatch(value, /(\d+)\s*mm\s*开孔/i),
  },
  sensor: {
    label: String.raw`/(PIR|motion\s*sensor|sensor|感应|雷达|人体)/i`,
    extract: (value) => firstMatch(value, /(PIR|motion\s*sensor|sensor|感应|雷达|人体)/i),
  },
  shape: {
    label: String.raw`/\b(?:A|T|C|G|ST|R|PAR|MR)\d{2,3}\b/i`,
    extract: (value) => firstMatch(value, /\b((?:A|T|C|G|ST|R|PAR|MR)\d{2,3})\b/i),
  },
  size_display: {
    label: String.raw`/\d+(?:\.\d+)?\s*[×x*]\s*\d+(?:\.\d+)?/`,
    extract: (value) => firstMatch(value, /(\d+(?:\.\d+)?\s*[×x*]\s*\d+(?:\.\d+)?(?:\s*[×x*]\s*\d+(?:\.\d+)?)?)/),
  },
  length_mm: {
    label: String.raw`/(\d{3,5})\s*mm/i`,
    extract: (value) => firstMatch(value, /(\d{3,5})\s*mm/i),
  },
  diameter_mm: {
    label: String.raw`/[Φφ]\s*(\d+)/ or /D\s*(\d{2,4})/i`,
    extract: (value) => firstMatch(value, /[Φφ]\s*(\d+)/) ?? firstMatch(value, /D\s*(\d{2,4})/i),
  },
};

async function main() {
  const [products, params] = await Promise.all([
    prisma.product.findMany({
      select: {
        id: true,
        productName: true,
        modelNo: true,
        category: true,
        material: true,
        size: true,
      },
    }),
    prisma.productParam.findMany({
      select: {
        productId: true,
        paramKey: true,
        rawValue: true,
        normalizedValue: true,
      },
    }),
  ]);

  const productById = new Map(products.map((product) => [product.id, product]));
  const paramKeysByProduct = buildProductParamKeyMap(params);
  const categoryProducts = groupProductsByCategory(products);
  const coverage = buildCoverage(categoryProducts, paramKeysByProduct);
  const matrixCategories = [...categoryProducts.entries()]
    .filter(([, rows]) => rows.length > 50)
    .sort((a, b) => b[1].length - a[1].length)
    .map(([category]) => category);
  const templateCoverage = buildTemplateCoverage(categoryProducts, paramKeysByProduct);
  const feasibility = buildBackfillFeasibility(categoryProducts, paramKeysByProduct, templateCoverage);

  const report = buildReport({
    productCount: products.length,
    paramCount: params.length,
    matrixCategories,
    categoryProducts,
    coverage,
    templateCoverage,
    feasibility,
  });

  await mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await writeFile(REPORT_PATH, report, "utf8");

  console.log("## Part A: 全局覆盖率矩阵");
  console.log(buildCoverageMatrix(matrixCategories, categoryProducts, coverage));
  console.log("\n## Part B: 模板列→参数映射");
  console.log(buildTemplateCoverageSection(templateCoverage));
  console.log("\n## Part C: 产品名可回填参数");
  console.log(buildFeasibilitySection(feasibility));
  console.log(`\nFull report written to ${REPORT_PATH}`);

  await prisma.$disconnect();
}

function buildProductParamKeyMap(params: ProductParamRow[]): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  for (const param of params) {
    if (!hasValue(param.normalizedValue) && !hasValue(param.rawValue)) {
      continue;
    }
    const productKeys = result.get(param.productId) ?? new Set<string>();
    productKeys.add(param.paramKey);
    result.set(param.productId, productKeys);
  }
  return result;
}

function groupProductsByCategory(products: ProductRow[]): Map<string, ProductRow[]> {
  const result = new Map<string, ProductRow[]>();
  for (const product of products) {
    const category = product.category?.trim() || "(未分类)";
    const rows = result.get(category) ?? [];
    rows.push(product);
    result.set(category, rows);
  }
  return result;
}

function buildCoverage(
  categoryProducts: Map<string, ProductRow[]>,
  paramKeysByProduct: Map<string, Set<string>>,
): Map<string, Map<string, CoverageCell>> {
  const result = new Map<string, Map<string, CoverageCell>>();
  const allKeys = new Set<string>([
    ...CORE_PARAM_KEYS,
    ...TEMPLATE_SPECS.flatMap((template) => template.columns.flatMap((column) => column.paramKeys)),
  ]);

  for (const [category, products] of categoryProducts) {
    const keyCoverage = new Map<string, CoverageCell>();
    for (const paramKey of allKeys) {
      const covered = products.filter((product) => paramKeysByProduct.get(product.id)?.has(paramKey)).length;
      keyCoverage.set(paramKey, {
        covered,
        total: products.length,
        pct: percent(covered, products.length),
      });
    }
    result.set(category, keyCoverage);
  }
  return result;
}

function buildTemplateCoverage(
  categoryProducts: Map<string, ProductRow[]>,
  paramKeysByProduct: Map<string, Set<string>>,
): Map<string, TemplateColumnCoverage[]> {
  const result = new Map<string, TemplateColumnCoverage[]>();
  for (const template of TEMPLATE_SPECS) {
    const products = categoryProducts.get(template.category) ?? [];
    const rows = template.columns.map((column) => {
      const covered = products.filter((product) => {
        const productKeys = paramKeysByProduct.get(product.id);
        return column.paramKeys.some((paramKey) => productKeys?.has(paramKey));
      }).length;
      const pct = percent(covered, products.length);
      return {
        ...column,
        covered,
        total: products.length,
        pct,
        status: statusFor(pct),
      };
    });
    result.set(template.category, rows);
  }
  return result;
}

function buildBackfillFeasibility(
  categoryProducts: Map<string, ProductRow[]>,
  paramKeysByProduct: Map<string, Set<string>>,
  templateCoverage: Map<string, TemplateColumnCoverage[]>,
): FeasibilityRow[] {
  const candidates: Array<{ category: string; paramKey: string }> = [];

  for (const template of TEMPLATE_SPECS) {
    const columns = templateCoverage.get(template.category) ?? [];
    for (const column of columns) {
      if (column.pct >= 50) {
        continue;
      }
      const paramKey = column.paramKeys.find((key) => EXTRACTORS[key]) ?? column.paramKeys[0];
      if (!candidates.some((candidate) => candidate.category === template.category && candidate.paramKey === paramKey)) {
        candidates.push({ category: template.category, paramKey });
      }
    }
  }

  return candidates
    .map(({ category, paramKey }) => {
      const products = categoryProducts.get(category) ?? [];
      const extractor = EXTRACTORS[paramKey];
      const missing = products
        .filter((product) => !paramKeysByProduct.get(product.id)?.has(paramKey))
        .sort((a, b) => (a.modelNo ?? a.productName).localeCompare(b.modelNo ?? b.productName, "zh-Hans-CN"));
      const sample = missing.slice(0, 50);
      const extracted = extractor
        ? sample
            .map((product) => ({ product, value: extractor.extract(product.productName) }))
            .filter((item): item is { product: ProductRow; value: string } => hasValue(item.value))
        : [];
      const currentCovered = products.length - missing.length;
      const extractablePct = percent(extracted.length, sample.length);
      const currentPct = percent(currentCovered, products.length);

      return {
        category,
        paramKey,
        products: products.length,
        currentCovered,
        currentPct,
        missingProducts: missing.length,
        sampleSize: sample.length,
        extractable: extracted.length,
        extractablePct,
        extractor: extractor?.label ?? "no regex configured",
        examples: extracted.slice(0, 5).map((item) => `${displayProduct(item.product)} => ${item.value}`),
        priorityScore: Math.round(products.length * (1 - currentPct / 100) * (extractablePct / 100)),
      };
    })
    .sort((a, b) => b.priorityScore - a.priorityScore || b.products - a.products || a.category.localeCompare(b.category, "zh-Hans-CN"));
}

function buildReport(input: {
  productCount: number;
  paramCount: number;
  matrixCategories: string[];
  categoryProducts: Map<string, ProductRow[]>;
  coverage: Map<string, Map<string, CoverageCell>>;
  templateCoverage: Map<string, TemplateColumnCoverage[]>;
  feasibility: FeasibilityRow[];
}): string {
  const recommendations = input.feasibility.filter((row) => row.extractablePct >= 10 && row.priorityScore > 0).slice(0, 12);
  const weakSignals = input.feasibility.filter((row) => row.extractablePct > 0 && row.extractablePct < 10);
  return [
    "# V22.0 参数覆盖率审计报告",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Scope",
    "",
    `- DB: \`prisma/dev.db\``,
    `- Products audited: ${input.productCount.toLocaleString("en-US")}`,
    `- Product params audited: ${input.paramCount.toLocaleString("en-US")}`,
    "- Analysis mode: read-only; no database writes.",
    "- Source note: `src/lib/quote-templates.ts` currently registers 5 templates. This report audits those 5 implemented mappings plus the 4 V21.2 documented mappings because V22.0 defines the template universe as 9 categories.",
    "",
    "## Part A — 全局覆盖率矩阵",
    "",
    buildCoverageMatrix(input.matrixCategories, input.categoryProducts, input.coverage),
    "",
    "## Part B — 模板列→参数映射",
    "",
    buildTemplateCoverageSection(input.templateCoverage),
    "",
    "## Part C — 产品名中的可回填参数",
    "",
    buildFeasibilitySection(input.feasibility),
    "",
    "## Summary — 最值得回填的组合",
    "",
    buildRecommendations(recommendations, weakSignals),
    "",
    "## Method Notes",
    "",
    "- Coverage counts distinct products with a non-empty `product_params.raw_value` or `normalized_value` for the param key.",
    "- Part A only shows categories with more than 50 products and only the V22.0 core param keys.",
    "- Part B uses union coverage when a template column can read multiple param keys, such as `size_display` plus dimension-specific keys.",
    "- Part C samples up to 50 products per low-coverage template-needed combo and only tests `products.product_name`, not `model_no`, remarks, source rows, or supplier file contents.",
    "- Backfill feasibility is directional. It does not execute any backfill and does not validate extracted values against source files.",
  ].join("\n");
}

function buildCoverageMatrix(
  categories: string[],
  categoryProducts: Map<string, ProductRow[]>,
  coverage: Map<string, Map<string, CoverageCell>>,
): string {
  const header = ["品类", "产品数", ...CORE_PARAM_KEYS];
  const rows = categories.map((category) => {
    const productCount = categoryProducts.get(category)?.length ?? 0;
    const cells = CORE_PARAM_KEYS.map((key) => {
      const cell = coverage.get(category)?.get(key);
      return cell ? `${cell.covered}(${cell.pct}%)` : "0(0%)";
    });
    return [category, String(productCount), ...cells];
  });
  return markdownTable(header, rows);
}

function buildTemplateCoverageSection(templateCoverage: Map<string, TemplateColumnCoverage[]>): string {
  return TEMPLATE_SPECS.map((template) => {
    const rows = templateCoverage.get(template.category) ?? [];
    const productCount = rows[0]?.total ?? 0;
    return [
      `### ${template.category} (${productCount} products, ${template.source}, sheet: ${template.sheetName})`,
      "",
      markdownTable(
        ["模板列", "param_key", "覆盖率", "状态", "fallback"],
        rows.map((row) => [
          row.header,
          row.paramKeys.join(" / "),
          `${row.covered}/${row.total} (${row.pct}%)`,
          row.status,
          row.fallback ?? "",
        ]),
      ),
    ].join("\n");
  }).join("\n\n");
}

function buildFeasibilitySection(rows: FeasibilityRow[]): string {
  if (rows.length === 0) {
    return "No template-needed param combinations are below 50% coverage.";
  }

  return markdownTable(
    ["品类", "param_key", "当前覆盖", "缺失产品", "样本", "可提取", "可回填率", "优先分", "regex", "示例"],
    rows.map((row) => [
      row.category,
      row.paramKey,
      `${row.currentCovered}/${row.products} (${row.currentPct}%)`,
      String(row.missingProducts),
      String(row.sampleSize),
      String(row.extractable),
      `${row.extractablePct}%`,
      String(row.priorityScore),
      row.extractor,
      row.examples.length > 0 ? row.examples.join("<br>") : "",
    ]),
  );
}

function buildRecommendations(rows: FeasibilityRow[], weakSignals: FeasibilityRow[]): string {
  if (rows.length === 0) {
    const weakNote =
      weakSignals.length > 0
        ? ` Weak signals exist but are not recommended for direct product-name backfill: ${weakSignals
            .map((row) => `${row.category}.${row.paramKey} (${row.extractablePct}%)`)
            .join(", ")}.`
        : "";
    return `No strong product-name backfill opportunities were found among template-needed low-coverage params.${weakNote}`;
  }

  const table = markdownTable(
    ["优先级", "品类", "param_key", "原因"],
    rows.map((row, index) => [
      String(index + 1),
      row.category,
      row.paramKey,
      `${row.products} products, current ${row.currentPct}% coverage, sample backfill ${row.extractablePct}%, priority score ${row.priorityScore}`,
    ]),
  );
  const weakNote =
    weakSignals.length > 0
      ? `\n\nWeak signals kept out of the recommendation list: ${weakSignals
          .map((row) => `${row.category}.${row.paramKey} (${row.extractablePct}%)`)
          .join(", ")}.`
      : "";
  return `${table}${weakNote}`;
}

function markdownTable(headers: string[], rows: string[][]): string {
  const escapeCell = (value: string) => value.replace(/\|/g, "\\|").replace(/\n/g, "<br>");
  return [
    `| ${headers.map(escapeCell).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(escapeCell).join(" | ")} |`),
  ].join("\n");
}

function firstMatch(value: string, regex: RegExp): string | null {
  const match = value.match(regex);
  if (!match) {
    return null;
  }
  return (match[1] ?? match[0]).trim();
}

function displayProduct(product: ProductRow): string {
  return [product.modelNo, product.productName].filter(Boolean).join(" / ");
}

function statusFor(pct: number): Status {
  if (pct < 50) {
    return "RED";
  }
  if (pct <= 80) {
    return "YELLOW";
  }
  return "GREEN";
}

function percent(numerator: number, denominator: number): number {
  if (denominator === 0) {
    return 0;
  }
  return Math.round((numerator / denominator) * 1000) / 10;
}

function hasValue(value: string | null | undefined): value is string {
  return value != null && value.trim() !== "";
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
