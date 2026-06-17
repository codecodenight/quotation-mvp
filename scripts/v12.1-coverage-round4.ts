import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

import { escapeMd, INSERT_BATCH_SIZE, productParamKey } from "./v11-shared";

const prisma = new PrismaClient();

const REPORT_PATH = path.join("docs", "v12.1-coverage-round4-report.md");
const BACKUP_PATH = path.join("prisma", "dev.db.bak-v12.1");
const APPLY_MODE = process.argv.includes("--apply");

const PROPAGATABLE_PARAMS = ["voltage", "driver_type", "ip", "cri", "pf", "cct", "material"] as const;
const CATEGORY_IP_MAP: Record<string, string> = {
  灯丝灯: "20",
  球泡: "20",
  风扇灯: "20",
  橱柜灯: "20",
};
const COVERAGE_KEYS = [
  "size_display",
  "watts",
  "cct",
  "voltage",
  "material",
  "luminous_efficacy",
  "cri",
  "pf",
  "ip",
  "driver_type",
  "base",
  "lumens",
  "beam_angle",
  "led_count",
];

type PropagatableParam = (typeof PROPAGATABLE_PARAMS)[number];

type BasicCounts = {
  products: number;
  supplierOffers: number;
  productParams: number;
  priceHistory: number;
};

type BadParam = {
  id: string;
  product_id: string;
  param_key: string;
  raw_value: string;
  normalized_value: string | null;
  source_field: string;
};

type PartAGroup = "A1 价格误当参数" | "A2 CRI 脏数据" | "A3 PF 脏数据" | "A4 IP 脏数据";

type PartAResult = {
  groups: Record<PartAGroup, BadParam[]>;
  deleted: Record<PartAGroup, number>;
};

type ZeroParamProduct = {
  id: string;
  product_name: string;
  model_no: string | null;
  category: string | null;
  image_path: string | null;
  quote_item_count: number | bigint;
  customer_quote_row_count: number | bigint;
  price_history_count: number | bigint;
  offer_count: number | bigint;
};

type JunkCandidate = {
  product: ZeroParamProduct;
  pattern: string;
  safe: boolean;
  skipReason: string | null;
  offerIds: string[];
};

type PartBResult = {
  zeroParamProducts: ZeroParamProduct[];
  candidates: JunkCandidate[];
  deleteResult: DeleteResult;
};

type DeleteResult = {
  products: number;
  supplierOffers: number;
  priceHistory: number;
  productParams: number;
};

type LinkedProductRow = {
  file_id: string;
  file_name: string;
  relative_path: string;
  product_id: string;
  model_no: string | null;
  product_name: string;
  category: string | null;
};

type LinkedProduct = {
  productId: string;
  modelNo: string | null;
  productName: string;
  category: string | null;
};

type SourceFile = {
  id: string;
  fileName: string;
  relativePath: string;
  products: LinkedProduct[];
};

type ExistingParam = {
  product_id: string;
  param_key: string;
  raw_value: string;
  normalized_value: string | null;
  unit: string | null;
  source_field: string;
};

type PlannedParam = {
  id: string;
  productId: string;
  productModel: string;
  productName: string;
  category: string;
  source: "file_propagation_70" | "category_inference" | "product_name_v2";
  confidence: "high" | "medium" | "low";
  fileId: string | null;
  fileName: string | null;
  paramKey: string;
  rawValue: string;
  normalizedValue: string | null;
  unit: string | null;
};

type PropagationSample = {
  paramKey: string;
  value: string;
  fileName: string;
  ratio: number;
  benefitedProducts: number;
};

type PartCResult = {
  scannedFiles: number;
  propagationGroups: number;
  benefitedProducts: Set<string>;
  plannedParams: PlannedParam[];
  inserted: number;
  samples: PropagationSample[];
};

type CategoryIpRow = {
  category: string;
  planned: number;
  existingSkipped: number;
};

type PartDResult = {
  rows: CategoryIpRow[];
  plannedParams: PlannedParam[];
  inserted: number;
};

type NameExtractionSample = {
  paramKey: string;
  rawValue: string;
  productName: string;
  modelNo: string | null;
};

type PartEResult = {
  scannedProducts: number;
  plannedParams: PlannedParam[];
  inserted: number;
  existingSkippedByKey: Map<string, number>;
  samples: NameExtractionSample[];
};

type CoverageRow = {
  paramKey: string;
  before: number;
  after: number;
  totalProducts: number;
};

type JunkPattern = {
  name: string;
  test: (name: string) => boolean;
};

type NameExtractor = {
  paramKey: string;
  regex: RegExp;
  normalize: (match: RegExpMatchArray) => string;
  unit?: string | null;
  validate?: (value: string) => boolean;
};

const JUNK_PATTERNS: JunkPattern[] = [
  { name: "price", test: (name) => /^[US$￥¥€£]?\s*[\d,.]+\s*[元]?\s*$/i.test(name) || /^US?\$\s*[\d,.]+/i.test(name) || /^￥\s*[\d,.]+/.test(name) },
  { name: "quantity", test: (name) => /^\d+\s*(?:pcs|sets?|pieces?|套|条|个|台|只|米|卷|箱|盒)\s*$/i.test(name) || (/^\d+\/\d+$/.test(name) && name.length <= 5) },
  { name: "dimension", test: (name) => /^\d+(?:\.\d+)?\s*[*×x]\s*\d+(?:\.\d+)?(?:\s*[*×x]\s*\d+(?:\.\d+)?)?\s*(?:cm|mm|CM|MM)?\s*$/i.test(name) },
  { name: "weight", test: (name) => /^[NG]\.?\s*W\.?\s*[:：]/i.test(name) },
  { name: "moq", test: (name) => /^MOQ\b/i.test(name) || /规格少于.*不接单/.test(name) || /^单一规格MOQ/i.test(name) },
  { name: "spec_note", test: (name) => /^\d+[：:、]\s*(?:含|无|配件|包装|外箱|产品标贴|尼龙|棕色)/.test(name) || /^包装方式/.test(name) },
  { name: "pricing_note", test: (name) => /^换\d+.*不锈钢.*元\/套/.test(name) },
  { name: "led_spec", test: (name) => /^SMD\s*\d{4}\s+\d+D$/i.test(name) || /^\d+\s*[*×]\s*(?:cool|warm|white|LED)\s/i.test(name) },
  { name: "solar_spec", test: (name) => /^Polycrystal\s/i.test(name) },
  { name: "contract_note", test: (name) => name.length > 50 && /(?:安排进仓|提供包材|不干胶|灯座.*接线.*膨胀管)/.test(name) },
  { name: "declaration", test: (name) => /^全部产品过/.test(name) },
  { name: "label", test: (name) => /^产品图片$/.test(name) },
  { name: "contract_terms", test: (name) => /^(?:\d+[\.:、]?\s*)?(?:Payment|FOB|T\/T|Validity|Delivery|Lead Time|MOQ|Bulk order|Sample|warranty|质保|交期|付款|报价有效|包装)/i.test(name) },
  { name: "remark_row", test: (name) => /^(?:\d+[\.:、]?\s*)?(?:Remark|备注|注[：:]|以上产品|如果包装|不含税|含税|不含运费)/i.test(name) },
  { name: "packaging_info", test: (name) => /^\d+[\.\*x×]\d+[\.\*x×]?\d*\s*(?:cm|mm|pcs|pieces|sets)?$/i.test(name) },
  { name: "quantity_row", test: (name) => /^\d+\s*(?:PCS|pieces|sets|pcs\/|月)$/i.test(name) },
  { name: "excel_formula", test: (name) => /^=DISPIMG\(|^=IMAGE\(/i.test(name) },
  { name: "bank_info", test: (name) => /^(?:BANK|Beneficiary|Account|SWIFT|IBAN|Fax:|Tel\s|E-mail:|CONTACT)/i.test(name) },
  { name: "wire_spec", test: (name) => /^[12]\*[\d.]+平方.*(?:PVC|电缆|棕蓝|红黑)/i.test(name) },
  { name: "led_spec_only", test: (name) => /^(?:LED Qty:|Chip Type:|SMD\s*\d{4}\b)(?:\s|$)/i.test(name) },
  { name: "solar_spec_v2", test: (name) => /^(?:Capacity:|Back up time:|Cable Length:)/i.test(name) },
  { name: "carton_size", test: (name) => /^\d+[\.\*x×]\d+[\.\*x×]\d+\s*cm$/i.test(name) },
  { name: "price_note", test: (name) => /^(?:价格[：:]|￥\d|¥\d|RGB \+ ￥)/i.test(name) },
];

const NAME_EXTRACTORS: NameExtractor[] = [
  {
    paramKey: "ip",
    regex: /\bIP\s*[Xx]?\s*(\d{2})\b/i,
    normalize: (match) => match[1],
    validate: (value) => ["20", "40", "44", "45", "54", "55", "65", "66", "67", "68"].includes(value),
  },
  {
    paramKey: "voltage",
    regex: /\b(?:AC|DC)?\s*(\d{2,3})\s*V?\s*[-~–]\s*(\d{2,3})\s*V\b/i,
    normalize: (match) => `${match[1]}-${match[2]}`,
    unit: "V",
  },
  {
    paramKey: "voltage",
    regex: /\b(AC|DC)\s*(\d{2,3})\s*V\b/i,
    normalize: (match) => `${match[1].toUpperCase()}${match[2]}`,
    unit: "V",
  },
  {
    paramKey: "cct",
    regex: /\b(\d{4})\s*(?:[-~–]\s*(\d{4})\s*)?[Kk]\b/,
    normalize: (match) => (match[2] ? `${match[1]}-${match[2]}` : match[1]),
    validate: (value) => value.split("-").map(Number).every((num) => num >= 1800 && num <= 10000),
    unit: "K",
  },
  {
    paramKey: "cct",
    regex: /\b(?:3CCT|CCT可调|双色温|三色温|(?:2|3)色)\b/i,
    normalize: () => "tunable",
  },
  {
    paramKey: "cri",
    regex: /\b(?:CRI|Ra)\s*[>≥]\s*(\d{2})\b/i,
    normalize: (match) => match[1],
    validate: (value) => Number(value) >= 60 && Number(value) <= 99,
  },
  {
    paramKey: "pf",
    regex: /\bPF\s*[>≥=]\s*(0\.\d+)\b/i,
    normalize: (match) => match[1],
  },
  {
    paramKey: "driver_type",
    regex: /\b(DOB|IC驱动|恒流IC|恒流|线性方案?)\b/i,
    normalize: (match) => match[1],
  },
];

async function main() {
  if (!existsSync(BACKUP_PATH)) {
    throw new Error(`Missing DB backup: ${BACKUP_PATH}`);
  }

  const beforeCounts = await loadBasicCounts();
  const totalProductsBefore = beforeCounts.products;
  const coverageBefore = await loadCoverage(COVERAGE_KEYS);

  const partA = await runPartA();
  const partB = await runPartB();

  const allProductIds = await loadAllProductIds();
  const existingParamKeys = await loadExistingParamKeys(allProductIds);
  const sourceFiles = await loadSourceFiles();

  const partC = await runPartC(sourceFiles, existingParamKeys);
  const partD = await runPartD(existingParamKeys);
  const partE = await runPartE(existingParamKeys);

  const afterCounts = await loadBasicCounts();
  const coverageAfter = await loadCoverage(COVERAGE_KEYS);
  const coverageRows = buildCoverageRows(coverageBefore, coverageAfter, afterCounts.products);

  await mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await writeFile(
    REPORT_PATH,
    buildReport({ mode: APPLY_MODE ? "apply" : "dry-run", beforeCounts, afterCounts, totalProductsBefore, partA, partB, partC, partD, partE, coverageRows }),
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        mode: APPLY_MODE ? "apply" : "dry-run",
        reportPath: REPORT_PATH,
        partADeleted: sumDeleted(partA),
        partBDeletedProducts: partB.deleteResult.products,
        partCInserted: partC.inserted,
        partDInserted: partD.inserted,
        partEInserted: partE.inserted,
        productsBefore: beforeCounts.products,
        productsAfter: afterCounts.products,
        productParamsBefore: beforeCounts.productParams,
        productParamsAfter: afterCounts.productParams,
      },
      null,
      2,
    ),
  );

  await prisma.$disconnect();
}

async function loadBasicCounts(): Promise<BasicCounts> {
  const [products, supplierOffers, productParams, priceHistory] = await Promise.all([
    prisma.product.count(),
    prisma.supplierOffer.count(),
    prisma.productParam.count(),
    prisma.priceHistory.count(),
  ]);
  return { products, supplierOffers, productParams, priceHistory };
}

async function loadAllProductIds(): Promise<string[]> {
  const products = await prisma.product.findMany({ select: { id: true } });
  return products.map((product) => product.id);
}

async function loadExistingParamKeys(productIds: string[]): Promise<Set<string>> {
  const existing = new Set<string>();
  for (let index = 0; index < productIds.length; index += 900) {
    const chunk = productIds.slice(index, index + 900);
    const rows = await prisma.productParam.findMany({ where: { productId: { in: chunk } }, select: { productId: true, paramKey: true } });
    for (const row of rows) existing.add(productParamKey(row.productId, row.paramKey));
  }
  return existing;
}

async function loadCoverage(paramKeys: string[]): Promise<Map<string, number>> {
  const rows = await prisma.$queryRaw<Array<{ param_key: string; cnt: number | bigint }>>`
    SELECT param_key, COUNT(DISTINCT product_id) AS cnt
    FROM product_params
    GROUP BY param_key
  `;
  const coverage = new Map<string, number>();
  for (const key of paramKeys) coverage.set(key, 0);
  for (const row of rows) {
    if (coverage.has(row.param_key)) coverage.set(row.param_key, toNumber(row.cnt));
  }
  return coverage;
}

async function runPartA(): Promise<PartAResult> {
  const groups: Record<PartAGroup, BadParam[]> = {
    "A1 价格误当参数": await prisma.$queryRaw<BadParam[]>`
      SELECT id, product_id, param_key, raw_value, normalized_value, source_field
      FROM product_params
      WHERE source_field IN ('excel_column', 'excel_multirow')
        AND (
          raw_value LIKE '￥%'
          OR raw_value LIKE '¥%'
          OR raw_value LIKE 'US$%'
          OR raw_value LIKE 'US $%'
          OR (raw_value LIKE '$%' AND raw_value GLOB '$[0-9]*')
        )
      ORDER BY source_field, param_key, raw_value
    `,
    "A2 CRI 脏数据": await prisma.$queryRaw<BadParam[]>`
      SELECT id, product_id, param_key, raw_value, normalized_value, source_field
      FROM product_params
      WHERE param_key = 'cri'
        AND (
          (normalized_value IN ('8','10','12') AND raw_value LIKE '%mm%')
          OR (normalized_value IN ('21','24') AND raw_value LIKE '%流明%')
          OR (normalized_value LIKE 'Ra%' AND LENGTH(REPLACE(normalized_value, 'Ra', '')) = 3)
          OR normalized_value = 'Ra45'
          OR (normalized_value GLOB '[0-9]*' AND CAST(normalized_value AS REAL) < 50 AND normalized_value NOT LIKE '%-%')
        )
      ORDER BY normalized_value, raw_value
    `,
    "A3 PF 脏数据": await prisma.$queryRaw<BadParam[]>`
      SELECT id, product_id, param_key, raw_value, normalized_value, source_field
      FROM product_params
      WHERE param_key = 'pf'
        AND (
          CAST(normalized_value AS REAL) >= 2.0
          OR (normalized_value IS NULL OR normalized_value = '')
        )
      ORDER BY normalized_value, raw_value
    `,
    "A4 IP 脏数据": await prisma.$queryRaw<BadParam[]>`
      SELECT id, product_id, param_key, raw_value, normalized_value, source_field
      FROM product_params
      WHERE param_key = 'ip'
        AND normalized_value IN (
          '2years', '30000Hrs',
          'Lighting Control+Remote Control',
          'Lighting Control/PIR Sensor/Remote Control'
        )
      ORDER BY normalized_value, source_field
    `,
  };

  const deleted: Record<PartAGroup, number> = {
    "A1 价格误当参数": 0,
    "A2 CRI 脏数据": 0,
    "A3 PF 脏数据": 0,
    "A4 IP 脏数据": 0,
  };
  if (APPLY_MODE) {
    for (const key of Object.keys(groups) as PartAGroup[]) {
      deleted[key] = await deleteProductParams(groups[key].map((param) => param.id));
    }
  }
  return { groups, deleted };
}

async function runPartB(): Promise<PartBResult> {
  const zeroParamProducts = await loadZeroParamProducts();
  const candidates: JunkCandidate[] = [];
  for (const product of zeroParamProducts) {
    const pattern = classifyJunk(product);
    if (!pattern) continue;
    const offerIds = await loadOfferIds(product.id);
    const skipReasons: string[] = [];
    if (product.image_path) skipReasons.push("has image");
    if (toNumber(product.quote_item_count) > 0) skipReasons.push(`${toNumber(product.quote_item_count)} quote_items`);
    if (toNumber(product.customer_quote_row_count) > 0) skipReasons.push(`${toNumber(product.customer_quote_row_count)} customer_quote_rows`);
    candidates.push({
      product,
      pattern,
      safe: skipReasons.length === 0,
      skipReason: skipReasons.length > 0 ? skipReasons.join("; ") : null,
      offerIds,
    });
  }
  const safeCandidates = candidates.filter((candidate) => candidate.safe);
  const deleteResult = APPLY_MODE ? await deleteJunkCandidates(safeCandidates) : { products: 0, supplierOffers: 0, priceHistory: 0, productParams: 0 };
  return { zeroParamProducts, candidates, deleteResult };
}

async function loadZeroParamProducts(): Promise<ZeroParamProduct[]> {
  return prisma.$queryRaw<ZeroParamProduct[]>`
    SELECT p.id,
           p.product_name,
           p.model_no,
           p.category,
           p.image_path,
           (SELECT COUNT(*) FROM quote_items qi WHERE qi.product_id = p.id) AS quote_item_count,
           (SELECT COUNT(*) FROM customer_quote_rows cqr WHERE cqr.matched_product_id = p.id) AS customer_quote_row_count,
           (SELECT COUNT(*) FROM supplier_offers so WHERE so.product_id = p.id) AS offer_count,
           (SELECT COUNT(*) FROM price_history ph JOIN supplier_offers so2 ON so2.id = ph.supplier_offer_id WHERE so2.product_id = p.id) AS price_history_count
    FROM products p
    WHERE NOT EXISTS (SELECT 1 FROM product_params pp WHERE pp.product_id = p.id)
    ORDER BY p.category, p.model_no, p.product_name
  `;
}

async function loadOfferIds(productId: string): Promise<string[]> {
  const offers = await prisma.supplierOffer.findMany({ where: { productId }, select: { id: true } });
  return offers.map((offer) => offer.id);
}

function classifyJunk(product: ZeroParamProduct): string | null {
  const candidates = [product.product_name, product.model_no ?? ""].map((value) => value.trim()).filter(Boolean);
  for (const candidate of candidates) {
    const match = JUNK_PATTERNS.find((pattern) => pattern.test(candidate));
    if (match) return match.name;
  }
  return null;
}

async function deleteJunkCandidates(candidates: JunkCandidate[]): Promise<DeleteResult> {
  const result: DeleteResult = { products: 0, supplierOffers: 0, priceHistory: 0, productParams: 0 };
  for (const candidate of candidates) {
    await prisma.$transaction(async (tx) => {
      const priceHistory = await tx.priceHistory.deleteMany({ where: { supplierOfferId: { in: candidate.offerIds } } });
      const supplierOffers = await tx.supplierOffer.deleteMany({ where: { productId: candidate.product.id } });
      const productParams = await tx.productParam.deleteMany({ where: { productId: candidate.product.id } });
      await tx.product.delete({ where: { id: candidate.product.id } });
      result.products += 1;
      result.supplierOffers += supplierOffers.count;
      result.priceHistory += priceHistory.count;
      result.productParams += productParams.count;
    });
  }
  return result;
}

async function loadSourceFiles(): Promise<SourceFile[]> {
  const rows = await prisma.$queryRaw<LinkedProductRow[]>`
    SELECT DISTINCT
      f.id AS file_id,
      f.file_name,
      f.relative_path,
      p.id AS product_id,
      p.model_no,
      p.product_name,
      p.category
    FROM supplier_offers so
    JOIN files f ON f.id = so.source_file_id
    JOIN products p ON p.id = so.product_id
    WHERE so.source_file_id IS NOT NULL
      AND f.file_type = 'excel'
    ORDER BY f.relative_path, p.model_no, p.product_name
  `;

  const files = new Map<string, SourceFile>();
  for (const row of rows) {
    const file = files.get(row.file_id) ?? { id: row.file_id, fileName: row.file_name, relativePath: row.relative_path, products: [] };
    file.products.push({
      productId: row.product_id,
      modelNo: row.model_no,
      productName: row.product_name,
      category: row.category,
    });
    files.set(row.file_id, file);
  }
  return [...files.values()];
}

async function runPartC(sourceFiles: SourceFile[], existingParamKeys: Set<string>): Promise<PartCResult> {
  const plannedParams: PlannedParam[] = [];
  const benefitedProducts = new Set<string>();
  const samples: PropagationSample[] = [];
  let propagationGroups = 0;

  const productIds = [...new Set(sourceFiles.flatMap((file) => file.products.map((product) => product.productId)))];
  const paramsByProduct = await loadParamsByProduct(productIds, [...PROPAGATABLE_PARAMS]);

  for (const [index, file] of sourceFiles.entries()) {
    if (index === 0 || (index + 1) % 100 === 0 || index + 1 === sourceFiles.length) {
      console.log(`V12.1 Part C propagation scan ${index + 1}/${sourceFiles.length}: ${file.relativePath}`);
    }
    for (const paramKey of PROPAGATABLE_PARAMS) {
      const valueDistribution = new Map<string, { rawValue: string; normalizedValue: string | null; unit: string | null; productIds: Set<string> }>();
      for (const product of file.products) {
        const param = paramsByProduct.get(product.productId)?.get(paramKey);
        if (!param?.normalized_value && !param?.raw_value) continue;
        const normalized = normalizePropagationParam(paramKey, param.raw_value, param.normalized_value, param.unit);
        if (!normalized) continue;
        const valueKey = `${normalized.normalizedValue ?? normalized.rawValue}\u0000${normalized.unit ?? ""}`;
        const bucket = valueDistribution.get(valueKey) ?? { ...normalized, productIds: new Set<string>() };
        bucket.productIds.add(product.productId);
        valueDistribution.set(valueKey, bucket);
      }

      const buckets = [...valueDistribution.values()].sort((left, right) => right.productIds.size - left.productIds.size);
      const dominant = buckets[0];
      if (!dominant) continue;
      if (dominant.productIds.size < 3) continue;
      const ratio = dominant.productIds.size / Math.max(1, file.products.length);
      if (ratio < 0.7) continue;

      const missingProducts = file.products.filter((product) => !paramsByProduct.get(product.productId)?.has(paramKey));
      if (missingProducts.length === 0) continue;
      propagationGroups += 1;
      if (samples.length < 30) {
        samples.push({
          paramKey,
          value: `${dominant.normalizedValue ?? dominant.rawValue}${dominant.unit ?? ""}`,
          fileName: file.fileName,
          ratio,
          benefitedProducts: missingProducts.length,
        });
      }

      for (const product of missingProducts) {
        const key = productParamKey(product.productId, paramKey);
        if (existingParamKeys.has(key)) continue;
        const planned = createPlannedParam({
          product,
          source: "file_propagation_70",
          confidence: "low",
          fileId: file.id,
          fileName: file.fileName,
          paramKey,
          rawValue: dominant.rawValue,
          normalizedValue: dominant.normalizedValue,
          unit: dominant.unit,
        });
        plannedParams.push(planned);
        existingParamKeys.add(key);
        benefitedProducts.add(product.productId);
        const productParams = paramsByProduct.get(product.productId) ?? new Map<string, ExistingParam>();
        productParams.set(paramKey, {
          product_id: product.productId,
          param_key: paramKey,
          raw_value: dominant.rawValue,
          normalized_value: dominant.normalizedValue,
          unit: dominant.unit,
          source_field: "file_propagation_70",
        });
        paramsByProduct.set(product.productId, productParams);
      }
    }
  }

  const inserted = APPLY_MODE ? await insertParams(plannedParams) : 0;
  return { scannedFiles: sourceFiles.length, propagationGroups, benefitedProducts, plannedParams, inserted, samples };
}

async function loadParamsByProduct(productIds: string[], paramKeys: string[]): Promise<Map<string, Map<string, ExistingParam>>> {
  const paramsByProduct = new Map<string, Map<string, ExistingParam>>();
  for (let index = 0; index < productIds.length; index += 900) {
    const chunk = productIds.slice(index, index + 900);
    const rows = await prisma.productParam.findMany({
      where: { productId: { in: chunk }, paramKey: { in: paramKeys } },
      select: { productId: true, paramKey: true, rawValue: true, normalizedValue: true, unit: true, sourceField: true },
    });
    for (const row of rows) {
      const productParams = paramsByProduct.get(row.productId) ?? new Map<string, ExistingParam>();
      if (!productParams.has(row.paramKey)) {
        productParams.set(row.paramKey, {
          product_id: row.productId,
          param_key: row.paramKey,
          raw_value: row.rawValue,
          normalized_value: row.normalizedValue,
          unit: row.unit,
          source_field: row.sourceField,
        });
      }
      paramsByProduct.set(row.productId, productParams);
    }
  }
  return paramsByProduct;
}

async function runPartD(existingParamKeys: Set<string>): Promise<PartDResult> {
  const plannedParams: PlannedParam[] = [];
  const rows: CategoryIpRow[] = [];
  for (const [category, ipValue] of Object.entries(CATEGORY_IP_MAP)) {
    const products = await prisma.product.findMany({
      where: { category },
      select: { id: true, modelNo: true, productName: true, category: true },
      orderBy: [{ modelNo: "asc" }, { productName: "asc" }],
    });
    let planned = 0;
    let existingSkipped = 0;
    for (const product of products) {
      const key = productParamKey(product.id, "ip");
      if (existingParamKeys.has(key)) {
        existingSkipped += 1;
        continue;
      }
      plannedParams.push(
        createPlannedParam({
          product: { productId: product.id, modelNo: product.modelNo, productName: product.productName, category: product.category },
          source: "category_inference",
          confidence: "low",
          fileId: null,
          fileName: null,
          paramKey: "ip",
          rawValue: `IP${ipValue}`,
          normalizedValue: ipValue,
          unit: null,
        }),
      );
      existingParamKeys.add(key);
      planned += 1;
    }
    rows.push({ category, planned, existingSkipped });
  }
  const inserted = APPLY_MODE ? await insertParams(plannedParams) : 0;
  return { rows, plannedParams, inserted };
}

async function runPartE(existingParamKeys: Set<string>): Promise<PartEResult> {
  const products = await prisma.product.findMany({
    select: { id: true, modelNo: true, productName: true, category: true },
    orderBy: [{ category: "asc" }, { modelNo: "asc" }, { productName: "asc" }],
  });
  const plannedParams: PlannedParam[] = [];
  const existingSkippedByKey = new Map<string, number>();
  const samples: NameExtractionSample[] = [];

  for (const product of products) {
    const text = `${product.productName} ${product.modelNo ?? ""}`.normalize("NFC");
    const addedForProduct = new Set<string>();
    for (const extractor of NAME_EXTRACTORS) {
      if (addedForProduct.has(extractor.paramKey)) continue;
      const key = productParamKey(product.id, extractor.paramKey);
      if (existingParamKeys.has(key)) {
        existingSkippedByKey.set(extractor.paramKey, (existingSkippedByKey.get(extractor.paramKey) ?? 0) + 1);
        continue;
      }
      const match = text.match(extractor.regex);
      if (!match) continue;
      const normalizedValue = extractor.normalize(match);
      if (extractor.validate && !extractor.validate(normalizedValue)) continue;
      const rawValue = match[0].trim();
      plannedParams.push(
        createPlannedParam({
          product: { productId: product.id, modelNo: product.modelNo, productName: product.productName, category: product.category },
          source: "product_name_v2",
          confidence: "medium",
          fileId: null,
          fileName: null,
          paramKey: extractor.paramKey,
          rawValue,
          normalizedValue,
          unit: extractor.unit ?? null,
        }),
      );
      existingParamKeys.add(key);
      addedForProduct.add(extractor.paramKey);
      if (samples.length < 30) {
        samples.push({ paramKey: extractor.paramKey, rawValue, productName: product.productName, modelNo: product.modelNo });
      }
    }
  }

  const inserted = APPLY_MODE ? await insertParams(plannedParams) : 0;
  return { scannedProducts: products.length, plannedParams, inserted, existingSkippedByKey, samples };
}

function normalizePropagationParam(
  paramKey: PropagatableParam,
  rawValue: string,
  normalizedValue: string | null,
  unit: string | null,
): { rawValue: string; normalizedValue: string | null; unit: string | null } | null {
  const raw = rawValue.trim();
  const normalized = normalizedValue?.trim() || null;
  const normalizedUnit = unit?.trim() || null;
  const combined = `${normalized ?? raw}${normalizedUnit ?? ""}`.replace(/\s+/g, "");

  if (paramKey === "voltage") {
    const voltageMatch = combined.match(/^(AC|DC)?(\d+(?:[-~–]\d+)?)V+$/i);
    if (!voltageMatch) return { rawValue: raw, normalizedValue: normalized, unit: normalizedUnit };
    const range = voltageMatch[2].replace(/[~–]/g, "-");
    const voltage = `${voltageMatch[1] ? voltageMatch[1].toUpperCase() : ""}${range}`;
    return { rawValue: `${voltage}V`, normalizedValue: voltage, unit: "V" };
  }

  if (paramKey === "cct") {
    if (combined.toLowerCase() === "tunable") return { rawValue: "tunable", normalizedValue: "tunable", unit: null };
    const cctMatch = combined.match(/^(\d{4}(?:[-~–]\d{4})?)K+$/i);
    if (!cctMatch) return { rawValue: raw, normalizedValue: normalized, unit: normalizedUnit };
    const range = cctMatch[1].replace(/[~–]/g, "-");
    const values = range.split("-").map((value) => Number(value));
    if (values.some((value) => value < 1800 || value > 10000)) return null;
    return { rawValue: `${range}K`, normalizedValue: range, unit: "K" };
  }

  return { rawValue: raw, normalizedValue: normalized, unit: normalizedUnit };
}

function createPlannedParam(input: {
  product: LinkedProduct;
  source: PlannedParam["source"];
  confidence: PlannedParam["confidence"];
  fileId: string | null;
  fileName: string | null;
  paramKey: string;
  rawValue: string;
  normalizedValue: string | null;
  unit: string | null;
}): PlannedParam {
  return {
    id: randomUUID(),
    productId: input.product.productId,
    productModel: input.product.modelNo ?? "",
    productName: input.product.productName,
    category: input.product.category ?? "(未分类)",
    source: input.source,
    confidence: input.confidence,
    fileId: input.fileId,
    fileName: input.fileName,
    paramKey: input.paramKey,
    rawValue: input.rawValue,
    normalizedValue: input.normalizedValue,
    unit: input.unit,
  };
}

async function deleteProductParams(ids: string[]): Promise<number> {
  let deleted = 0;
  for (let index = 0; index < ids.length; index += INSERT_BATCH_SIZE) {
    const chunk = ids.slice(index, index + INSERT_BATCH_SIZE);
    const result = await prisma.productParam.deleteMany({ where: { id: { in: chunk } } });
    deleted += result.count;
  }
  return deleted;
}

async function insertParams(plannedParams: PlannedParam[]): Promise<number> {
  let inserted = 0;
  for (let index = 0; index < plannedParams.length; index += INSERT_BATCH_SIZE) {
    const chunk = plannedParams.slice(index, index + INSERT_BATCH_SIZE);
    const result = await prisma.productParam.createMany({
      data: chunk.map((param) => ({
        id: param.id,
        productId: param.productId,
        paramKey: param.paramKey,
        rawValue: param.rawValue,
        normalizedValue: param.normalizedValue,
        unit: param.unit,
        sourceField: param.source,
        confidence: param.confidence,
      })),
    });
    inserted += result.count;
  }
  return inserted;
}

function buildCoverageRows(before: Map<string, number>, after: Map<string, number>, totalProducts: number): CoverageRow[] {
  return [...new Set([...before.keys(), ...after.keys()])]
    .map((paramKey) => ({ paramKey, before: before.get(paramKey) ?? 0, after: after.get(paramKey) ?? 0, totalProducts }))
    .sort((left, right) => right.after - left.after || left.paramKey.localeCompare(right.paramKey));
}

function buildReport(input: {
  mode: "dry-run" | "apply";
  beforeCounts: BasicCounts;
  afterCounts: BasicCounts;
  totalProductsBefore: number;
  partA: PartAResult;
  partB: PartBResult;
  partC: PartCResult;
  partD: PartDResult;
  partE: PartEResult;
  coverageRows: CoverageRow[];
}): string {
  const partAStats = buildPartAStats(input.partA);
  const junkStats = buildJunkStats(input.partB.candidates);
  const safeJunk = input.partB.candidates.filter((candidate) => candidate.safe);
  const skippedImages = input.partB.candidates.filter((candidate) => candidate.product.image_path).length;
  const skippedQuoteItems = input.partB.candidates.filter((candidate) => toNumber(candidate.product.quote_item_count) > 0).length;
  const propagationStats = buildParamStats(input.partC.plannedParams);
  const nameStats = buildParamStats(input.partE.plannedParams);

  return `# V12.1 覆盖率第四轮综合提升报告

模式: ${input.mode}
时间: ${new Date().toISOString()}
备份: ${BACKUP_PATH}

## Part A — 脏数据清理

| 类别 | 检测 | 删除 |
|---|---:|---:|
${partAStats.map((stat) => `| ${escapeMd(stat.group)} | ${stat.detected.toLocaleString()} | ${stat.deleted.toLocaleString()} |`).join("\n")}
| 合计 | ${sumDetected(input.partA).toLocaleString()} | ${sumDeleted(input.partA).toLocaleString()} |

### A1 按 (source_field, param_key)

| source_field | param_key | 数量 |
|---|---|---:|
${buildBadParamStats(input.partA.groups["A1 价格误当参数"], (param) => `${param.source_field}\u0000${param.param_key}`)
  .map((row) => `| ${escapeMd(row.parts[0])} | ${escapeMd(row.parts[1])} | ${row.count.toLocaleString()} |`)
  .join("\n")}

### A2 脏 CRI 采样

| normalized_value | raw_value | source_field | 数量 |
|---|---|---|---:|
${buildBadParamStats(input.partA.groups["A2 CRI 脏数据"], (param) => `${param.normalized_value ?? ""}\u0000${param.raw_value}\u0000${param.source_field}`)
  .slice(0, 30)
  .map((row) => `| ${escapeMd(row.parts[0])} | ${escapeMd(row.parts[1])} | ${escapeMd(row.parts[2])} | ${row.count.toLocaleString()} |`)
  .join("\n")}

### A3 脏 PF 采样

| normalized_value | raw_value | source_field | 数量 |
|---|---|---|---:|
${buildBadParamStats(input.partA.groups["A3 PF 脏数据"], (param) => `${param.normalized_value ?? ""}\u0000${param.raw_value}\u0000${param.source_field}`)
  .slice(0, 30)
  .map((row) => `| ${escapeMd(row.parts[0])} | ${escapeMd(row.parts[1])} | ${escapeMd(row.parts[2])} | ${row.count.toLocaleString()} |`)
  .join("\n")}

### A4 脏 IP 采样

| normalized_value | source_field | 数量 |
|---|---|---:|
${buildBadParamStats(input.partA.groups["A4 IP 脏数据"], (param) => `${param.normalized_value ?? ""}\u0000${param.source_field}`)
  .slice(0, 30)
  .map((row) => `| ${escapeMd(row.parts[0])} | ${escapeMd(row.parts[1])} | ${row.count.toLocaleString()} |`)
  .join("\n")}

## Part B — 垃圾产品清理

| 指标 | 数值 |
|---|---:|
| 零参数产品总数 | ${input.partB.zeroParamProducts.length.toLocaleString()} |
| 匹配垃圾模式 | ${input.partB.candidates.length.toLocaleString()} |
| 有图片跳过 | ${skippedImages.toLocaleString()} |
| 有 quote_items 跳过 | ${skippedQuoteItems.toLocaleString()} |
| 安全删除 | ${safeJunk.length.toLocaleString()} |
| 实际删除产品 | ${input.partB.deleteResult.products.toLocaleString()} |
| 删除 supplier_offers | ${input.partB.deleteResult.supplierOffers.toLocaleString()} |
| 删除 price_history | ${input.partB.deleteResult.priceHistory.toLocaleString()} |

### 按模式分类

| 模式 | 匹配数 | 删除数 | 跳过（图片） |
|---|---:|---:|---:|
${junkStats.map((stat) => `| ${escapeMd(stat.pattern)} | ${stat.matched.toLocaleString()} | ${stat.deleted.toLocaleString()} | ${stat.skippedImages.toLocaleString()} |`).join("\n")}

### 删除采样（前 50 条）

| category | product_name | 模式 |
|---|---|---|
${safeJunk
  .slice(0, 50)
  .map((candidate) => `| ${escapeMd(candidate.product.category ?? "(未分类)")} | ${escapeMd(candidate.product.product_name)} | ${escapeMd(candidate.pattern)} |`)
  .join("\n")}

## Part C — 文件级参数传播（70%）

| 指标 | 数值 |
|---|---:|
| 扫描文件数 | ${input.partC.scannedFiles.toLocaleString()} |
| 触发组数 | ${input.partC.propagationGroups.toLocaleString()} |
| 受益产品数 | ${input.partC.benefitedProducts.size.toLocaleString()} |
| 新增参数 | ${input.partC.plannedParams.length.toLocaleString()} |
| 实际插入 | ${input.partC.inserted.toLocaleString()} |

### 按 param_key

| param_key | 新增 | 受益产品 | 传播文件数 |
|---|---:|---:|---:|
${propagationStats.map((stat) => `| ${escapeMd(stat.paramKey)} | ${stat.newRecords.toLocaleString()} | ${stat.productIds.size.toLocaleString()} | ${stat.fileNames.size.toLocaleString()} |`).join("\n")}

### 采样（前 30 条）

| param_key | 值 | 文件名 | 比例 | 受益产品数 |
|---|---|---|---:|---:|
${input.partC.samples
  .map((sample) => `| ${escapeMd(sample.paramKey)} | ${escapeMd(sample.value)} | ${escapeMd(sample.fileName)} | ${(sample.ratio * 100).toFixed(1)}% | ${sample.benefitedProducts.toLocaleString()} |`)
  .join("\n")}

## Part D — 品类 IP 推断

| 品类 | 推断产品数 | 已有跳过 |
|---|---:|---:|
${input.partD.rows.map((row) => `| ${escapeMd(row.category)} | ${row.planned.toLocaleString()} | ${row.existingSkipped.toLocaleString()} |`).join("\n")}

## Part E — product_name 参数再提取

| param_key | 新增 | 已有跳过 |
|---|---:|---:|
${nameStats.map((stat) => `| ${escapeMd(stat.paramKey)} | ${stat.newRecords.toLocaleString()} | ${(input.partE.existingSkippedByKey.get(stat.paramKey) ?? 0).toLocaleString()} |`).join("\n")}

### 采样（前 30 条）

| param_key | raw_value | product_name | model_no |
|---|---|---|---|
${input.partE.samples.map((sample) => `| ${escapeMd(sample.paramKey)} | ${escapeMd(sample.rawValue)} | ${escapeMd(sample.productName)} | ${escapeMd(sample.modelNo ?? "")} |`).join("\n")}

## 汇总

| 指标 | 数值 |
|---|---:|
| Part A 删除参数 | ${sumDeleted(input.partA).toLocaleString()} |
| Part B 删除产品 | ${input.partB.deleteResult.products.toLocaleString()} |
| Part C 新增参数 | ${input.partC.plannedParams.length.toLocaleString()} |
| Part D 新增参数 | ${input.partD.plannedParams.length.toLocaleString()} |
| Part E 新增参数 | ${input.partE.plannedParams.length.toLocaleString()} |
| products 变化 | ${input.beforeCounts.products.toLocaleString()} → ${input.afterCounts.products.toLocaleString()} |
| supplier_offers 变化 | ${input.beforeCounts.supplierOffers.toLocaleString()} → ${input.afterCounts.supplierOffers.toLocaleString()} |
| price_history 变化 | ${input.beforeCounts.priceHistory.toLocaleString()} → ${input.afterCounts.priceHistory.toLocaleString()} |
| product_params 变化 | ${input.beforeCounts.productParams.toLocaleString()} → ${input.afterCounts.productParams.toLocaleString()} |

## 覆盖率变化（去重产品数）

注意：使用 COUNT(DISTINCT product_id) 统计，非记录数。

| param_key | 之前 | 之后 | 变化 | 覆盖率 |
|---|---:|---:|---:|---:|
${input.coverageRows
  .map((row) => {
    const rate = row.totalProducts > 0 ? `${((row.after / row.totalProducts) * 100).toFixed(1)}%` : "0%";
    return `| ${escapeMd(row.paramKey)} | ${row.before.toLocaleString()} | ${row.after.toLocaleString()} | ${(row.after - row.before).toLocaleString()} | ${rate} |`;
  })
  .join("\n")}
`;
}

function buildPartAStats(partA: PartAResult): Array<{ group: PartAGroup; detected: number; deleted: number }> {
  return (Object.keys(partA.groups) as PartAGroup[]).map((group) => ({ group, detected: partA.groups[group].length, deleted: partA.deleted[group] }));
}

function buildBadParamStats(rows: BadParam[], keyFn: (row: BadParam) => string): Array<{ parts: string[]; count: number }> {
  const stats = new Map<string, number>();
  for (const row of rows) {
    const key = keyFn(row);
    stats.set(key, (stats.get(key) ?? 0) + 1);
  }
  return [...stats.entries()].map(([key, count]) => ({ parts: key.split("\u0000"), count })).sort((left, right) => right.count - left.count || left.parts.join("|").localeCompare(right.parts.join("|")));
}

function buildJunkStats(candidates: JunkCandidate[]): Array<{ pattern: string; matched: number; deleted: number; skippedImages: number }> {
  const stats = new Map<string, { pattern: string; matched: number; deleted: number; skippedImages: number }>();
  for (const candidate of candidates) {
    const stat = stats.get(candidate.pattern) ?? { pattern: candidate.pattern, matched: 0, deleted: 0, skippedImages: 0 };
    stat.matched += 1;
    if (candidate.safe) stat.deleted += 1;
    if (candidate.product.image_path) stat.skippedImages += 1;
    stats.set(candidate.pattern, stat);
  }
  return [...stats.values()].sort((left, right) => right.matched - left.matched || left.pattern.localeCompare(right.pattern));
}

function buildParamStats(plannedParams: PlannedParam[]): Array<{ paramKey: string; newRecords: number; productIds: Set<string>; fileNames: Set<string> }> {
  const stats = new Map<string, { paramKey: string; newRecords: number; productIds: Set<string>; fileNames: Set<string> }>();
  for (const param of plannedParams) {
    const stat = stats.get(param.paramKey) ?? { paramKey: param.paramKey, newRecords: 0, productIds: new Set<string>(), fileNames: new Set<string>() };
    stat.newRecords += 1;
    stat.productIds.add(param.productId);
    if (param.fileName) stat.fileNames.add(param.fileName);
    stats.set(param.paramKey, stat);
  }
  return [...stats.values()].sort((left, right) => right.newRecords - left.newRecords || left.paramKey.localeCompare(right.paramKey));
}

function sumDetected(partA: PartAResult): number {
  return (Object.keys(partA.groups) as PartAGroup[]).reduce((sum, key) => sum + partA.groups[key].length, 0);
}

function sumDeleted(partA: PartAResult): number {
  return (Object.keys(partA.deleted) as PartAGroup[]).reduce((sum, key) => sum + partA.deleted[key], 0);
}

function toNumber(value: number | bigint | null | undefined): number {
  return Number(value ?? 0);
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
