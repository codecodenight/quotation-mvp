import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const TARGET_CATEGORY_CONFIGS = {
  v3b: {
    title: "V3.0B",
    categories: ["投光灯", "面板灯", "线条灯", "路灯", "灯带"],
    defaultReport: "docs/v3.0b-dry-run-report.md",
  },
  v3c: {
    title: "V3.0C",
    categories: ["吸顶灯", "筒灯", "三防灯", "磁吸灯", "净化灯", "镜前灯", "防潮灯"],
    defaultReport: "docs/v3.0c-dry-run-report.md",
  },
  v3d: {
    title: "V3.0D",
    categories: [
      "灯丝灯",
      "轨道灯",
      "橱柜灯",
      "太阳能壁灯",
      "庭院灯",
      "应急灯",
      "地埋灯/地插灯",
      "壁灯",
      "台灯",
      "灯管",
      "Highbay",
      "皮线灯",
    ],
    defaultReport: "docs/v3.0d-dry-run-report.md",
  },
  v3e: {
    title: "V3.0E",
    categories: [
      "太阳能壁灯",
      "风扇灯",
      "壁灯",
      "线条灯",
      "太阳能",
      "皮线灯",
      "灯丝灯",
      "工作灯",
      "橱柜灯",
      "G4G9",
      "Highbay",
      "地埋灯/地插灯",
      "庭院灯",
      "应急灯",
      "轨道灯",
      "台灯",
    ],
    defaultReport: "docs/v3.0e-dry-run-report.md",
  },
  v3f: {
    title: "V3.0F",
    categories: ["球泡", "灯管"],
    defaultReport: "docs/v3.0f-dry-run-report.md",
  },
  v3g: {
    title: "V3.0G",
    categories: ["充电灯", "投光灯", "面板灯", "太阳能壁灯", "路灯", "工作灯", "Highbay"],
    defaultReport: "docs/v3.0g-dry-run-report.md",
  },
} as const;

const targetConfig = readTargetConfig();
const TARGET_CATEGORIES: TargetCategory[] = [...targetConfig.categories];
const mode = process.argv.includes("--apply") ? "apply" : "dry-run";
const reportPath = readArg("--report") ?? targetConfig.defaultReport;

type TargetCategoryConfig = typeof TARGET_CATEGORY_CONFIGS;
export type TargetCategory = TargetCategoryConfig[keyof TargetCategoryConfig]["categories"][number];
export type SourceField = "model_no" | "product_name" | "remark" | "size" | "material" | "offer_remark";
type Confidence = "high" | "medium" | "low";

export type ProductForExtraction = {
  id: string;
  productName: string;
  category: string | null;
  modelNo: string | null;
  material: string | null;
  size: string | null;
  remark: string | null;
  supplierOffers: Array<{ remark: string | null; createdAt: Date }>;
};

export type ExtractedParam = {
  paramKey: string;
  rawValue: string;
  normalizedValue: string | null;
  unit: string | null;
  sourceField: SourceField;
  confidence: Confidence;
};

type ExtractedParamWithProduct = ExtractedParam & {
  productId: string;
  category: string;
  modelNo: string | null;
  productName: string;
};

type CategoryStats = {
  category: string;
  products: number;
  productsWithParams: number;
  totalParams: number;
  writableParams: number;
  lowParams: number;
  byKey: Map<string, ParamKeyStats>;
  samples: ProductSample[];
};

type ParamKeyStats = {
  total: number;
  high: number;
  medium: number;
  low: number;
  products: Set<string>;
};

type ProductSample = {
  productId: string;
  modelNo: string | null;
  productName: string;
  params: ExtractedParam[];
};

const CONFIDENCE_RANK: Record<Confidence, number> = {
  low: 1,
  medium: 2,
  high: 3,
};

const SOURCE_PRIORITY: Record<SourceField, number> = {
  remark: 1,
  size: 2,
  material: 3,
  model_no: 4,
  product_name: 5,
  offer_remark: 6,
};

const MULTI_VALUE_KEYS = new Set(["base", "cct", "certification"]);

function readTargetConfig() {
  const target = readArg("--target") ?? "v3c";
  const config = TARGET_CATEGORY_CONFIGS[target as keyof typeof TARGET_CATEGORY_CONFIGS];
  if (!config) {
    throw new Error(`Unknown extraction target: ${target}. Use --target=v3b, --target=v3c, --target=v3d, --target=v3e, --target=v3f or --target=v3g.`);
  }
  return config;
}

async function main() {
  const startedAt = new Date();
  const productParamCountBefore = await prisma.productParam.count();
  const products = await loadTargetProducts();
  const extracted = extractAll(products);
  const stats = buildCategoryStats(products, extracted);

  let insertedParams = 0;
  let clearedProducts = 0;
  if (mode === "apply") {
    const applyResult = await applyExtractedParams(extracted);
    insertedParams = applyResult.insertedParams;
    clearedProducts = applyResult.clearedProducts;
  }

  const productParamCountAfter = await prisma.productParam.count();
  const report = buildMarkdownReport({
    startedAt,
    finishedAt: new Date(),
    products,
    stats,
    extracted,
    productParamCountBefore,
    productParamCountAfter,
    insertedParams,
    clearedProducts,
  });
  await writeFile(reportPath, report, "utf8");

  console.log(
    JSON.stringify(
      {
        mode,
        reportPath,
        targetProducts: products.length,
        extractedParams: extracted.length,
        writableParams: extracted.filter((param) => param.confidence !== "low").length,
        lowParams: extracted.filter((param) => param.confidence === "low").length,
        productParamCountBefore,
        productParamCountAfter,
        insertedParams,
      },
      null,
      2,
    ),
  );
}

async function loadTargetProducts(): Promise<ProductForExtraction[]> {
  return prisma.product.findMany({
    where: { category: { in: [...TARGET_CATEGORIES] } },
    orderBy: [{ category: "asc" }, { modelNo: "asc" }, { productName: "asc" }],
    select: {
      id: true,
      productName: true,
      category: true,
      modelNo: true,
      material: true,
      size: true,
      remark: true,
      supplierOffers: {
        orderBy: { createdAt: "asc" },
        select: { remark: true, createdAt: true },
      },
    },
  });
}

function extractAll(products: ProductForExtraction[]): ExtractedParamWithProduct[] {
  const extracted: ExtractedParamWithProduct[] = [];
  for (const product of products) {
    const category = product.category;
    if (!isTargetCategory(category)) {
      continue;
    }
    const params = dedupeParams(extractProductParams(product, category));
    for (const param of params) {
      extracted.push({
        ...param,
        productId: product.id,
        category,
        modelNo: product.modelNo,
        productName: product.productName,
      });
    }
  }
  return extracted;
}

function extractProductParams(product: ProductForExtraction, category: TargetCategory): ExtractedParam[] {
  const params: ExtractedParam[] = [];
  params.push(...extractCommonSizeParams(product.size));

  switch (category) {
    case "投光灯":
      params.push(...extractFloodlightParams(product));
      break;
    case "面板灯":
      params.push(...extractPanelParams(product));
      break;
    case "线条灯":
      params.push(...extractLinearParams(product));
      break;
    case "路灯":
      params.push(...extractStreetLightParams(product));
      break;
    case "灯带":
      params.push(...extractStripParams(product));
      break;
    case "球泡":
      params.push(...extractBulbParams(product));
      break;
    case "吸顶灯":
      params.push(...extractCeilingParams(product));
      break;
    case "筒灯":
      params.push(...extractDownlightParams(product));
      break;
    case "三防灯":
      params.push(...extractTriProofParams(product));
      break;
    case "磁吸灯":
      params.push(...extractMagneticParams(product));
      break;
    case "净化灯":
      params.push(...extractCleanRoomParams(product));
      break;
    case "镜前灯":
      params.push(...extractMirrorLightParams(product));
      break;
    case "防潮灯":
      params.push(...extractMoistureProofParams(product));
      break;
    case "灯丝灯":
      params.push(...extractFilamentParams(product));
      break;
    case "轨道灯":
      params.push(...extractTrackLightParams(product));
      break;
    case "橱柜灯":
      params.push(...extractCabinetLightParams(product));
      break;
    case "太阳能壁灯":
      params.push(...extractSolarWallLightParams(product));
      break;
    case "庭院灯":
      params.push(...extractGenericParams(product));
      break;
    case "应急灯":
      params.push(...extractGenericParams(product));
      break;
    case "地埋灯/地插灯":
      params.push(...extractInGroundLightParams(product));
      break;
    case "壁灯":
      params.push(...extractWallLightParams(product));
      break;
    case "台灯":
      params.push(...extractTableLampParams(product));
      break;
    case "灯管":
      params.push(...extractTubeLightParams(product));
      break;
    case "Highbay":
      params.push(...extractHighbayParams(product));
      break;
    case "皮线灯":
      params.push(...extractGenericParams(product));
      break;
    case "风扇灯":
      params.push(...extractFanLightParams(product));
      break;
    case "工作灯":
      params.push(...extractWorkLightParams(product));
      break;
    case "G4G9":
      params.push(...extractG4G9Params(product));
      break;
    case "充电灯":
      params.push(...extractChargingLightParams(product));
      break;
  }

  return params.filter((param) => param.rawValue.trim().length > 0);
}

export function extractProductParamsForTest(product: ProductForExtraction, category: TargetCategory): ExtractedParam[] {
  return dedupeParams(extractProductParams(product, category));
}

function extractFloodlightParams(product: ProductForExtraction): ExtractedParam[] {
  const params: ExtractedParam[] = [];
  const modelNo = readSource(product, "model_no");
  const remark = readSource(product, "remark");
  const material = readSource(product, "material");
  const joined = `${remark} ${modelNo}`;

  params.push(...extractWatts(remark, "remark"));
  params.push(...extractWatts(modelNo, "model_no"));
  params.push(...extractIp(joined, remark ? "remark" : "model_no"));
  params.push(...extractBeamAngles(remark, "remark"));
  params.push(...extractVoltage(remark, "remark"));
  params.push(...extractCct(remark, "remark"));
  params.push(...extractPf(remark, "remark"));
  params.push(...extractLmW(remark, "remark"));
  params.push(...extractLabeledMaterial(remark, "remark"));
  if (material) {
    params.push(param("material", material, normalizeMaterial(material), null, "material", "medium"));
  }

  return params;
}

function extractPanelParams(product: ProductForExtraction): ExtractedParam[] {
  const params: ExtractedParam[] = [];
  const modelNo = readSource(product, "model_no");
  const remark = readSource(product, "remark");
  const size = readSource(product, "size");
  const joined = `${modelNo} ${remark} ${size}`;

  params.push(...extractWatts(modelNo, "model_no"));
  params.push(...extractWatts(remark, "remark"));
  const panelSize = extractPanelSize(size);
  if (panelSize) {
    params.push(param("panel_size", size, panelSize.normalized, "mm", "size", "high"));
    params.push(param("shape", panelSize.rawShape, panelSize.shape, null, "size", "medium"));
  }
  const mountType = extractMountType(joined);
  if (mountType) {
    params.push(param("mount_type", mountType.raw, mountType.normalized, null, mountType.sourceField, "medium"));
  }
  const backlit = extractBacklit(joined);
  if (backlit) {
    params.push(param("backlit", backlit.raw, backlit.normalized, null, backlit.sourceField, "medium"));
  }

  return params;
}

function extractLinearParams(product: ProductForExtraction): ExtractedParam[] {
  const params: ExtractedParam[] = [];
  const modelNo = readSource(product, "model_no");
  const remark = readSource(product, "remark");
  const size = readSource(product, "size");
  const material = readSource(product, "material");
  const joined = `${modelNo} ${remark} ${size}`;

  params.push(...extractWatts(modelNo, "model_no"));
  params.push(...extractWatts(remark, "remark"));
  params.push(...extractIp(joined, joined.includes("IP") ? "model_no" : "remark"));
  if (!extractCommonSizeParams(size).some((item) => item.paramKey === "length_mm")) {
    const length = extractLinearLengthFromText(modelNo);
    if (length) {
      params.push(param("length_mm", length.raw, length.normalized, "mm", "model_no", "high"));
    }
  }
  const extractedMaterial = extractMaterialKeyword(`${remark} ${material} ${modelNo}`);
  if (extractedMaterial) {
    params.push(param("material", extractedMaterial.raw, extractedMaterial.normalized, null, extractedMaterial.sourceField, "medium"));
  }
  const series = extractSeries(modelNo);
  if (series) {
    params.push(param("series", series, series.toUpperCase(), null, "model_no", "medium"));
  }

  return params;
}

function extractStreetLightParams(product: ProductForExtraction): ExtractedParam[] {
  const params: ExtractedParam[] = [];
  const modelNo = readSource(product, "model_no");
  const remark = readSource(product, "remark");
  const material = readSource(product, "material");
  const joined = `${remark} ${modelNo}`;

  params.push(...extractWatts(remark, "remark"));
  params.push(...extractWatts(modelNo, "model_no"));
  params.push(...extractIp(joined, remark ? "remark" : "model_no"));
  params.push(...extractBeamAngles(remark, "remark"));
  params.push(...extractVoltage(remark, "remark"));
  params.push(...extractLabeledMaterial(remark, "remark"));
  if (material) {
    params.push(param("material", material, normalizeMaterial(material), null, "material", "medium"));
  }
  params.push(...extractCri(remark, "remark"));
  params.push(...extractLmW(remark, "remark"));
  params.push(...extractPf(remark, "remark"));

  return params;
}

export function extractBulbParams(product: ProductForExtraction): ExtractedParam[] {
  const params: ExtractedParam[] = [];
  const modelNo = readSource(product, "model_no");
  const productName = readSource(product, "product_name");
  const remark = readSource(product, "remark");

  for (const sourceField of ["model_no", "product_name", "remark"] as SourceField[]) {
    const value = readSource(product, sourceField);
    params.push(...extractBases(value, sourceField));
    params.push(...extractWatts(value, sourceField));
    params.push(...extractCct(value, sourceField));
    params.push(...extractPf(value, sourceField));
  }

  params.push(...extractLabeledWatts(remark, "remark"));
  params.push(...extractLabeledBase(remark, "remark"));

  pushFirstMatch(params, modelNo, /\b(A\d{2,3}|C3[57]\w?|G\d{2,3}|PAR\d{2,3}|R\d{2,3}|T\d{2,3}|BR\d{2,3}|ED\d{2,3})\b/i, {
    paramKey: "shape",
    sourceField: "model_no",
    confidence: "high",
  });

  const lowerRemark = remark.toLowerCase();
  if (/不可调光|non[-\s]?dim|not\s+dimmable/.test(lowerRemark)) {
    params.push(param("dimmable", "不可调光", "no", null, "remark", "high"));
  } else if (/可调光|dimmable/.test(lowerRemark)) {
    params.push(param("dimmable", "可调光", "yes", null, "remark", "high"));
  }

  params.push(...extractVoltage(remark, "remark"));
  params.push(...extractCri(remark, "remark"));
  params.push(...extractLabeledCri(remark, "remark"));
  params.push(...extractPf(remark, "remark"));
  params.push(...extractLumens(remark, "remark"));
  params.push(...extractLumensLoose(remark, "remark"));
  params.push(...extractLmW(remark, "remark"));
  params.push(...extractCct(remark, "remark"));
  params.push(...extractLabeledCct(remark, "remark"));
  params.push(...extractLabeledMaterial(remark, "remark"));
  params.push(...extractChineseMaterial(remark, "remark"));
  params.push(...extractBeamAngles(modelNo, "model_no"));
  params.push(...extractBeamAngles(productName, "product_name"));
  params.push(...extractBeamAngles(remark, "remark"));
  params.push(...extractRemarkSizeParams(remark));

  return params;
}

export function extractSolarParams(product: ProductForExtraction): ExtractedParam[] {
  const params: ExtractedParam[] = [];
  const productName = readSource(product, "product_name");
  const modelNo = readSource(product, "model_no");

  params.push(...extractWatts(modelNo, "model_no"));

  pushFirstMatch(
    params,
    productName,
    /(?:Solar\s+[Pp]anel|Panel|Panel data)[:\s]*(\d+(?:\.\d*)?)\s*W/i,
    {
      paramKey: "panel_watts",
      sourceField: "product_name",
      unit: "W",
      confidence: "high",
    },
  );

  if (/mono/i.test(productName)) {
    params.push(param("panel_type", "mono", "monocrystalline", null, "product_name", "high"));
  } else if (/poly/i.test(productName)) {
    params.push(param("panel_type", "poly", "polycrystalline", null, "product_name", "high"));
  } else if (/amorphous/i.test(productName)) {
    params.push(param("panel_type", "amorphous", "amorphous", null, "product_name", "high"));
  }

  pushFirstMatch(
    params,
    productName,
    /(?:Battery|Battry)[:\s]*([\s\S]{2,80}?)(?=\b(?:LED|Solar|Material|Luminous|Color|Panel|IP|Charging|Working)\b|$)/i,
    {
      paramKey: "battery_spec",
      sourceField: "product_name",
      confidence: "medium",
      normalize: cleanInline,
    },
  );

  pushFirstMatch(params, productName, /(\d+)\s*PCS/i, {
    paramKey: "led_count",
    sourceField: "product_name",
    confidence: "high",
    unit: "pcs",
  });
  pushFirstMatch(params, productName, /(?:Luminous\s+[Ff]lux[:\s]*)?(\d+(?:-\d+)?)\s*[Ll][Mm]\b/i, {
    paramKey: "lumens",
    sourceField: "product_name",
    confidence: "high",
    unit: "lm",
  });

  const cctRange = productName.match(/\b(\d{4,5})\s*-\s*(\d{4,5})\s*K\b/i);
  if (cctRange) {
    params.push(param("cct", cctRange[0], `${cctRange[1]}-${cctRange[2]}`, "K", "product_name", "high"));
  } else {
    pushFirstMatch(params, productName, /(?:Color\s+[Tt]emp[:\s]*)?(\d{4,5})\s*K?/i, {
      paramKey: "cct",
      sourceField: "product_name",
      confidence: "high",
      unit: "K",
    });
  }

  params.push(...extractIp(productName, "product_name"));

  if (/PIR/i.test(productName)) {
    params.push(param("sensor", "PIR", "PIR", null, "product_name", "high"));
  } else if (/microwave/i.test(productName)) {
    params.push(param("sensor", "microwave", "microwave", null, "product_name", "high"));
  } else if (/radar/i.test(productName)) {
    params.push(param("sensor", "radar", "radar", null, "product_name", "high"));
  }

  pushFirstMatch(params, productName, /[Cc]harg(?:ing|e)\s*[Tt]ime[:\s]*>?\s*(\d+(?:-\d+)?)\s*[Hh]/i, {
    paramKey: "charging_time",
    sourceField: "product_name",
    confidence: "medium",
    unit: "h",
  });

  pushFirstMatch(params, productName, /(\d+)\s*[Ww]orking\s+[Mm]odes?/i, {
    paramKey: "working_modes",
    sourceField: "product_name",
    confidence: "medium",
  });
  if (!params.some((item) => item.paramKey === "working_modes")) {
    const modeMatches = productName.match(/\bMode\b/gi) ?? [];
    if (modeMatches.length >= 2) {
      params.push(param("working_modes", `${modeMatches.length} Mode mentions`, String(modeMatches.length), null, "product_name", "medium"));
    }
  }

  pushFirstMatch(
    params,
    productName,
    /[Mm]aterial[:\s]*([A-Za-z0-9+/\-\s]+?)(?=\s*(?:Solar|Color|Panel|IP|LED|Battery|Luminous|Charging|Working|$))/i,
    {
      paramKey: "material",
      sourceField: "product_name",
      confidence: "medium",
      normalize: cleanInline,
    },
  );

  return params;
}

function extractStripParams(product: ProductForExtraction): ExtractedParam[] {
  const params: ExtractedParam[] = [];
  const modelNo = readSource(product, "model_no");
  const productName = readSource(product, "product_name");
  const remark = readSource(product, "remark");
  const joined = `${productName} ${modelNo} ${remark}`;

  pushFirstMatch(params, joined, /LED\s*Type\s*[：:]\s*([A-Z]*\d{3,4}|COB|SMD\s*\d{3,4})/i, {
    paramKey: "led_type",
    sourceField: remark ? "remark" : "product_name",
    confidence: "high",
    normalize: normalizeLedType,
  });
  if (!params.some((item) => item.paramKey === "led_type")) {
    pushFirstMatch(params, joined, /\b((?:SMD\s*)?(?:2835|5050|3528|5730)|RGB5050|COB)\b/i, {
      paramKey: "led_type",
      sourceField: productName ? "product_name" : "model_no",
      confidence: "high",
      normalize: normalizeLedType,
    });
  }

  pushFirstMatch(params, joined, /(\d+)\s*D\/M\b/i, {
    paramKey: "leds_per_meter",
    sourceField: remark ? "remark" : "product_name",
    confidence: "high",
    unit: "pcs/m",
  });
  pushFirstMatch(params, joined, /(\d+)P\b/i, {
    paramKey: "leds_per_meter",
    sourceField: productName ? "product_name" : "model_no",
    confidence: "high",
    unit: "pcs/m",
  });
  pushFirstMatch(params, productName, /(\d+)\s*[Ll]ines?/i, {
    paramKey: "lines",
    sourceField: "product_name",
    confidence: "medium",
  });
  if (!params.some((item) => item.paramKey === "lines")) {
    const lineFromModel = modelNo.match(/-(2|3)-/);
    if (lineFromModel) {
      params.push(param("lines", lineFromModel[0], lineFromModel[1], null, "model_no", "medium"));
    }
  }

  const adaptorVoltage = remark.match(/Adaptor\s*[：:]\s*(\d{1,3})\s*V/i);
  if (adaptorVoltage) {
    params.push(param("voltage", adaptorVoltage[0], `DC${adaptorVoltage[1]}V`, "V", "remark", "high"));
  } else if (/220V/i.test(modelNo)) {
    params.push(param("voltage", "220V", "AC220V", "V", "model_no", "high"));
  } else if (/12V/i.test(joined)) {
    params.push(param("voltage", "12V", "DC12V", "V", joined.includes("12V") && remark.includes("12V") ? "remark" : "model_no", "high"));
  } else if (/24V/i.test(joined)) {
    params.push(param("voltage", "24V", "DC24V", "V", joined.includes("24V") && remark.includes("24V") ? "remark" : "model_no", "high"));
  }

  params.push(...extractIp(joined, remark ? "remark" : "model_no"));

  pushFirstMatch(params, joined, /\b(RGB|NW|WW|CW)\b/i, {
    paramKey: "color",
    sourceField: remark ? "remark" : "model_no",
    confidence: "high",
    normalize: (value) => value.toUpperCase(),
  });

  const productSizeWidth = extractStripWidthFromProductSize(remark);
  if (productSizeWidth) {
    params.push(param("width_mm", productSizeWidth.raw, productSizeWidth.normalized, "mm", "remark", "medium"));
  }
  const firstSize = firstNumber(readSource(product, "size"));
  if (firstSize !== null && !params.some((item) => item.paramKey === "width_mm")) {
    params.push(param("width_mm", readSource(product, "size"), formatNumber(firstSize), "mm", "size", "medium"));
  }

  return params;
}

export function extractCleanRoomParams(product: ProductForExtraction): ExtractedParam[] {
  const params: ExtractedParam[] = [];
  const productName = readSource(product, "product_name");
  const modelNo = readSource(product, "model_no");
  const remark = readSource(product, "remark");
  const material = readSource(product, "material");
  const joined = `${productName} ${modelNo} ${remark} ${material}`;

  params.push(...extractWatts(productName, "product_name"));
  params.push(...extractWatts(modelNo, "model_no"));
  params.push(...extractWatts(remark, "remark"));
  params.push(...extractLabeledWatts(remark, "remark"));
  params.push(...extractVoltage(remark, "remark"));
  params.push(...extractCct(remark, "remark"));
  params.push(...extractLabeledCct(remark, "remark"));
  params.push(...extractPf(remark, "remark"));
  params.push(...extractLabeledPf(remark, "remark"));
  params.push(...extractCri(remark, "remark"));
  params.push(...extractLabeledCri(remark, "remark"));
  params.push(...extractLmW(remark, "remark"));
  params.push(...extractLumens(remark, "remark"));
  params.push(...extractIp(joined, "remark"));
  params.push(...extractWarranty(remark, "remark"));
  params.push(...extractChineseMaterial(remark, "remark"));

  if (/彩涂板|彩钢板/.test(joined)) {
    params.push(param("body_material", "彩涂板/彩钢板", "彩涂板", null, "product_name", "high"));
  } else if (/喷白铁/.test(joined)) {
    params.push(param("body_material", "喷白铁", "喷白铁材", null, "product_name", "high"));
  } else if (/铝材|铝/.test(joined)) {
    params.push(param("body_material", "铝", "铝材", null, "product_name", "high"));
  }

  if (/单支/.test(joined)) {
    params.push(param("led_bars", "单支", "1", null, "product_name", "high"));
  } else if (/双支/.test(joined)) {
    params.push(param("led_bars", "双支", "2", null, "product_name", "high"));
  } else if (/三支/.test(joined)) {
    params.push(param("led_bars", "三支", "3", null, "product_name", "high"));
  } else {
    pushFirstMatch(params, joined, /(\d+)\s*支/, {
      paramKey: "led_bars",
      sourceField: "product_name",
      confidence: "high",
    });
  }

  if (/高功率/.test(joined)) {
    params.push(param("power_tier", "高功率", "high", null, "product_name", "high"));
  } else if (/低功率|经济/.test(joined)) {
    params.push(param("power_tier", "低功率/经济", "low", null, "product_name", "high"));
  }

  if (/方形|F系列/.test(joined)) {
    params.push(param("shape", "方形/F系列", "方形", null, "product_name", "high"));
  } else if (/椭圆|T系列/.test(joined)) {
    params.push(param("shape", "椭圆/T系列", "椭圆", null, "product_name", "high"));
  }

  return params;
}

export function extractCeilingParams(product: ProductForExtraction): ExtractedParam[] {
  const params: ExtractedParam[] = [];
  const modelNo = readSource(product, "model_no");
  const remark = readSource(product, "remark");
  const material = readSource(product, "material");
  const joined = `${modelNo} ${remark} ${material}`;

  params.push(...extractWatts(modelNo, "model_no"));
  params.push(...extractWatts(remark, "remark"));
  params.push(...extractLabeledWatts(remark, "remark"));
  params.push(...extractVoltage(remark, "remark"));
  params.push(...extractCct(remark, "remark"));
  params.push(...extractLabeledCct(remark, "remark"));
  params.push(...extractPf(remark, "remark"));
  params.push(...extractLabeledPf(remark, "remark"));
  params.push(...extractCri(remark, "remark"));
  params.push(...extractLabeledCri(remark, "remark"));
  params.push(...extractLmW(remark, "remark"));
  params.push(...extractLumens(remark, "remark"));
  params.push(...extractChineseMaterial(remark, "remark"));
  params.push(...extractWarranty(remark, "remark"));
  params.push(...extractSensor(joined, "remark"));
  params.push(...extractDimmable(joined, "remark"));

  if (/(?:^|[-_\s])R(?:$|[-_\s\d])/i.test(modelNo)) {
    params.push(param("shape", "R", "圆", null, "model_no", "medium"));
  } else if (/(?:^|[-_\s])S(?:$|[-_\s\d])/i.test(modelNo)) {
    params.push(param("shape", "S", "方", null, "model_no", "medium"));
  }

  return params;
}

function extractDownlightParams(product: ProductForExtraction): ExtractedParam[] {
  const params: ExtractedParam[] = [];
  const modelNo = readSource(product, "model_no");
  const remark = readSource(product, "remark");
  const material = readSource(product, "material");
  const joined = `${modelNo} ${remark} ${material}`;

  params.push(...extractWatts(modelNo, "model_no"));
  params.push(...extractWatts(remark, "remark"));
  params.push(...extractLabeledWatts(remark, "remark"));
  params.push(...extractVoltage(remark, "remark"));
  params.push(...extractCct(remark, "remark"));
  params.push(...extractLabeledCct(remark, "remark"));
  params.push(...extractLumens(remark, "remark"));
  params.push(...extractCri(remark, "remark"));
  params.push(...extractLabeledCri(remark, "remark"));
  params.push(...extractPf(remark, "remark"));
  params.push(...extractLabeledPf(remark, "remark"));
  params.push(...extractBeamAngles(remark, "remark"));
  params.push(...extractChineseMaterial(remark, "remark"));
  params.push(...extractCutout(remark, "remark"));
  params.push(...extractDimmable(joined, "remark"));
  if (/CCT|调色|三色/i.test(joined)) {
    params.push(param("cct_type", "CCT/调色/三色", "adjustable", null, "remark", "medium"));
  }

  if (/(?:^|[-_\s])R(?:$|[-_\s\d])/i.test(modelNo)) {
    params.push(param("shape", "R", "圆", null, "model_no", "medium"));
  } else if (/(?:^|[-_\s])S(?:$|[-_\s\d])/i.test(modelNo)) {
    params.push(param("shape", "S", "方", null, "model_no", "medium"));
  }
  if (material) {
    params.push(param("material", material, normalizeMaterial(material), null, "material", "medium"));
  }

  return params;
}

function extractTriProofParams(product: ProductForExtraction): ExtractedParam[] {
  const params: ExtractedParam[] = [];
  const modelNo = readSource(product, "model_no");
  const remark = readSource(product, "remark");
  const material = readSource(product, "material");
  const joined = `${modelNo} ${remark} ${material}`;

  params.push(...extractWatts(modelNo, "model_no"));
  params.push(...extractWatts(remark, "remark"));
  params.push(...extractLabeledWatts(remark, "remark"));
  params.push(...extractIp(joined, "remark"));
  params.push(...extractVoltage(remark, "remark"));
  params.push(...extractCct(remark, "remark"));
  params.push(...extractLabeledCct(remark, "remark"));
  params.push(...extractPf(remark, "remark"));
  params.push(...extractLabeledPf(remark, "remark"));
  params.push(...extractCri(remark, "remark"));
  params.push(...extractLabeledCri(remark, "remark"));
  params.push(...extractLmW(remark, "remark"));
  params.push(...extractLumens(remark, "remark"));
  params.push(...extractBeamAngles(remark, "remark"));
  params.push(...extractChineseMaterial(remark, "remark"));
  params.push(...extractWarranty(remark, "remark"));
  params.push(...extractDimmable(joined, "remark"));
  const materialKeyword = extractMaterialKeyword(joined);
  if (materialKeyword) {
    params.push(param("material", materialKeyword.raw, materialKeyword.normalized, null, materialKeyword.sourceField, "medium"));
  }
  const series = extractSeries(modelNo);
  if (series) {
    params.push(param("series", series, series.toUpperCase(), null, "model_no", "medium"));
  }
  const mountType = extractMountType(joined);
  if (mountType) {
    params.push(param("mount_type", mountType.raw, mountType.normalized, null, mountType.sourceField, "medium"));
  }

  return params;
}

function extractMagneticParams(product: ProductForExtraction): ExtractedParam[] {
  const params: ExtractedParam[] = [];
  const modelNo = readSource(product, "model_no");
  const remark = readSource(product, "remark");
  const material = readSource(product, "material");
  const joined = `${modelNo} ${remark} ${material}`;

  params.push(...extractWatts(modelNo, "model_no"));
  params.push(...extractWatts(remark, "remark"));
  params.push(...extractLabeledWatts(remark, "remark"));
  params.push(...extractVoltage(remark, "remark"));
  params.push(...extractCct(remark, "remark"));
  params.push(...extractLabeledCct(remark, "remark"));
  params.push(...extractCri(remark, "remark"));
  params.push(...extractLabeledCri(remark, "remark"));
  params.push(...extractBeamAngles(remark, "remark"));
  params.push(...extractChineseMaterial(remark, "remark"));
  params.push(...extractWarranty(remark, "remark"));
  const materialKeyword = extractMaterialKeyword(joined);
  if (materialKeyword) {
    params.push(param("material", materialKeyword.raw, materialKeyword.normalized, null, materialKeyword.sourceField, "medium"));
  }
  const trackSystem = extractTrackSystem(modelNo);
  if (trackSystem) {
    params.push(param("track_system", trackSystem, trackSystem.toUpperCase(), null, "model_no", "high"));
  }
  const moduleType = extractMagneticModuleType(joined);
  if (moduleType) {
    params.push(param("module_type", moduleType.raw, moduleType.normalized, null, moduleType.sourceField, "medium"));
  }

  return params;
}

function extractMirrorLightParams(product: ProductForExtraction): ExtractedParam[] {
  const params: ExtractedParam[] = [];
  const modelNo = readSource(product, "model_no");
  const remark = readSource(product, "remark");
  const joined = `${modelNo} ${remark}`;

  params.push(...extractWatts(joined, remark ? "remark" : "model_no"));
  params.push(...extractLabeledWatts(remark, "remark"));
  params.push(...extractIp(joined, "remark"));
  params.push(...extractVoltage(remark, "remark"));
  params.push(...extractCct(remark, "remark"));
  params.push(...extractLabeledCct(remark, "remark"));
  params.push(...extractBeamAngles(remark, "remark"));
  params.push(...extractChineseMaterial(remark, "remark"));
  params.push(...extractCertification(remark, "remark"));
  params.push(...extractWarranty(remark, "remark"));
  const descriptionSize = extractDescriptionSize(remark);
  if (descriptionSize) {
    params.push(...descriptionSize);
  } else {
    const length = extractLinearLengthFromText(modelNo);
    if (length) {
      params.push(param("length_mm", length.raw, length.normalized, "mm", "model_no", "medium"));
    }
  }

  return params;
}

function extractMoistureProofParams(product: ProductForExtraction): ExtractedParam[] {
  const params: ExtractedParam[] = [];
  const modelNo = readSource(product, "model_no");
  const remark = readSource(product, "remark");
  const material = readSource(product, "material");
  const joined = `${modelNo} ${remark} ${material}`;

  params.push(...extractWatts(joined, remark ? "remark" : "model_no"));
  params.push(...extractLabeledWatts(remark, "remark"));
  params.push(...extractIp(joined, "remark"));
  params.push(...extractVoltage(remark, "remark"));
  params.push(...extractCct(remark, "remark"));
  params.push(...extractLabeledCct(remark, "remark"));
  params.push(...extractPf(remark, "remark"));
  params.push(...extractLabeledPf(remark, "remark"));
  params.push(...extractCri(remark, "remark"));
  params.push(...extractLabeledCri(remark, "remark"));
  params.push(...extractLmW(remark, "remark"));
  params.push(...extractLumens(remark, "remark"));
  params.push(...extractChineseMaterial(remark, "remark"));
  const mountType = extractMountType(joined);
  if (mountType) {
    params.push(param("mount_type", mountType.raw, mountType.normalized, null, mountType.sourceField, "medium"));
  }
  if (/圆|round/i.test(joined)) {
    params.push(param("shape", "圆/round", "圆", null, "remark", "medium"));
  } else if (/方|square/i.test(joined)) {
    params.push(param("shape", "方/square", "方", null, "remark", "medium"));
  }

  return params;
}

function extractFilamentParams(product: ProductForExtraction): ExtractedParam[] {
  const params: ExtractedParam[] = [];
  const modelNo = readSource(product, "model_no");
  const productName = readSource(product, "product_name");
  const remark = readSource(product, "remark");

  params.push(...extractWatts(remark, "remark"));
  params.push(...extractLabeledWatts(remark, "remark"));
  params.push(...extractWatts(modelNo, "model_no"));
  params.push(...extractWatts(productName, "product_name"));
  params.push(...extractLumens(remark, "remark"));
  params.push(...extractBases(productName, "product_name"));
  params.push(...extractBases(modelNo, "model_no"));
  params.push(...extractVoltage(remark, "remark"));
  params.push(...extractCri(remark, "remark"));
  params.push(...extractBeamAngles(remark, "remark"));

  return params;
}

function extractTrackLightParams(product: ProductForExtraction): ExtractedParam[] {
  const params = extractGenericParams(product);
  const modelNo = readSource(product, "model_no");
  const productName = readSource(product, "product_name");
  params.push(...extractWatts(modelNo, "model_no"));
  params.push(...extractWatts(productName, "product_name"));
  return params;
}

function extractCabinetLightParams(product: ProductForExtraction): ExtractedParam[] {
  const params = extractGenericParams(product);
  const modelNo = readSource(product, "model_no");
  const productName = readSource(product, "product_name");
  const remark = readSource(product, "remark");
  params.push(...extractLabeledWatts(remark, "remark"));
  params.push(...extractBases(productName, "product_name"));
  params.push(...extractBases(modelNo, "model_no"));
  return params;
}

function extractSolarWallLightParams(product: ProductForExtraction): ExtractedParam[] {
  const params: ExtractedParam[] = [];
  const productName = readSource(product, "product_name");
  const remark = readSource(product, "remark");
  const joined = `${productName} ${remark}`;

  params.push(...extractWatts(joined, remark ? "remark" : "product_name"));
  params.push(...extractIp(joined, remark ? "remark" : "product_name"));
  params.push(...extractLumensLoose(remark, "remark"));
  params.push(...extractLumensLoose(productName, "product_name"));
  params.push(...extractCct(remark, "remark"));
  params.push(...extractLabeledCct(remark, "remark"));
  params.push(...extractSolarCctTolerance(remark, "remark"));
  params.push(...extractBatterySpec(remark, "remark"));
  params.push(...extractSensor(joined, remark ? "remark" : "product_name"));

  if (/感应|motion|sensor/i.test(joined) && !params.some((item) => item.paramKey === "sensor")) {
    params.push(param("sensor", "感应/motion", "motion", null, remark ? "remark" : "product_name", "medium"));
  }

  return params;
}

function extractInGroundLightParams(product: ProductForExtraction): ExtractedParam[] {
  const params: ExtractedParam[] = [];
  const modelNo = readSource(product, "model_no");
  const remark = readSource(product, "remark");
  const material = readSource(product, "material");
  const joined = `${modelNo} ${remark} ${material}`;

  params.push(...extractWatts(modelNo, "model_no"));
  params.push(...extractWatts(remark, "remark"));
  params.push(...extractLabeledWatts(remark, "remark"));
  params.push(...extractIp(joined, "remark"));
  params.push(...extractCct(remark, "remark"));
  params.push(...extractLabeledCct(remark, "remark"));
  params.push(...extractBeamAngles(remark, "remark"));
  params.push(...extractVoltage(remark, "remark"));
  params.push(...extractLabeledMaterial(remark, "remark"));
  if (material) {
    params.push(param("material", material, normalizeMaterial(material), null, "material", "medium"));
  }

  return params;
}

function extractWallLightParams(product: ProductForExtraction): ExtractedParam[] {
  const params: ExtractedParam[] = [];
  const modelNo = readSource(product, "model_no");
  const productName = readSource(product, "product_name");
  const remark = readSource(product, "remark");
  const material = readSource(product, "material");
  const joined = `${modelNo} ${productName} ${remark} ${material}`;

  params.push(...extractWatts(joined, remark ? "remark" : "model_no"));
  params.push(...extractLabeledWatts(remark, "remark"));
  params.push(...extractIp(joined, "remark"));
  params.push(...extractCri(remark, "remark"));
  params.push(...extractLabeledCri(remark, "remark"));
  params.push(...extractBeamAngles(remark, "remark"));
  params.push(...extractLabeledMaterial(remark, "remark"));
  if (material) {
    params.push(param("material", material, normalizeMaterial(material), null, "material", "high"));
  }

  return params;
}

function extractTableLampParams(product: ProductForExtraction): ExtractedParam[] {
  const params = extractGenericParams(product);
  const remark = readSource(product, "remark");
  params.push(...extractLabeledMaterial(remark, "remark"));
  return params;
}

function extractTubeLightParams(product: ProductForExtraction): ExtractedParam[] {
  const params: ExtractedParam[] = [];
  const productName = readSource(product, "product_name");
  const modelNo = readSource(product, "model_no");
  const remark = readSource(product, "remark");

  params.push(...extractWatts(modelNo, "model_no"));
  params.push(...extractWatts(productName, "product_name"));
  params.push(...extractWatts(remark, "remark"));
  params.push(...extractLabeledWatts(remark, "remark"));
  params.push(...extractVoltage(remark, "remark"));
  params.push(...extractCri(remark, "remark"));
  params.push(...extractLabeledCri(remark, "remark"));
  params.push(...extractPf(remark, "remark"));
  params.push(...extractLumens(remark, "remark"));
  params.push(...extractLumensLoose(remark, "remark"));
  params.push(...extractCct(remark, "remark"));
  params.push(...extractLabeledCct(remark, "remark"));

  return params;
}

function extractHighbayParams(product: ProductForExtraction): ExtractedParam[] {
  const params: ExtractedParam[] = [];
  const modelNo = readSource(product, "model_no");
  const productName = readSource(product, "product_name");
  const remark = readSource(product, "remark");
  const material = readSource(product, "material");
  const joined = `${modelNo} ${productName} ${remark} ${material}`;

  params.push(...extractWatts(modelNo, "model_no"));
  params.push(...extractWatts(productName, "product_name"));
  params.push(...extractWatts(remark, "remark"));
  params.push(...extractLabeledWatts(remark, "remark"));
  params.push(...extractLabeledMaterial(remark, "remark"));
  if (material) {
    params.push(param("material", material, normalizeMaterial(material), null, "material", "medium"));
  }
  params.push(...extractCct(remark, "remark"));
  params.push(...extractLabeledCct(remark, "remark"));
  params.push(...extractBeamAngles(remark, "remark"));
  params.push(...extractIp(joined, "remark"));
  params.push(...extractVoltage(remark, "remark"));
  params.push(...extractCri(remark, "remark"));
  params.push(...extractLmW(remark, "remark"));

  return params;
}

function extractFanLightParams(product: ProductForExtraction): ExtractedParam[] {
  const params: ExtractedParam[] = [];
  const remark = readSource(product, "remark");
  const modelNo = readSource(product, "model_no");

  params.push(...extractWatts(remark, "remark"));
  params.push(...extractLabeledWatts(remark, "remark"));
  params.push(...extractWatts(modelNo, "model_no"));
  params.push(...extractLumens(remark, "remark"));
  params.push(...extractLabeledMaterial(remark, "remark"));
  params.push(...extractVoltage(remark, "remark"));
  params.push(...extractIp(remark, "remark"));
  params.push(...extractCct(remark, "remark"));
  params.push(...extractLabeledCct(remark, "remark"));
  params.push(...extractColor(remark, "remark"));

  return params;
}

function extractWorkLightParams(product: ProductForExtraction): ExtractedParam[] {
  const params: ExtractedParam[] = [];
  const remark = readSource(product, "remark");
  const modelNo = readSource(product, "model_no");

  params.push(...extractWatts(remark, "remark"));
  params.push(...extractLabeledWatts(remark, "remark"));
  params.push(...extractWatts(modelNo, "model_no"));
  params.push(...extractVoltage(remark, "remark"));
  params.push(...extractCri(remark, "remark"));
  params.push(...extractLabeledCri(remark, "remark"));
  params.push(...extractLmW(remark, "remark"));
  params.push(...extractBeamAngles(remark, "remark"));
  params.push(...extractLabeledMaterial(remark, "remark"));
  params.push(...extractCct(remark, "remark"));
  params.push(...extractLabeledCct(remark, "remark"));
  params.push(...extractIp(remark, "remark"));
  params.push(...extractWarranty(remark, "remark"));
  params.push(...extractCertification(remark, "remark"));

  return params;
}

function extractChargingLightParams(product: ProductForExtraction): ExtractedParam[] {
  const params: ExtractedParam[] = [];
  const remark = readSource(product, "remark");

  for (const sourceField of ["model_no", "product_name", "remark"] as SourceField[]) {
    params.push(...extractWatts(readSource(product, sourceField), sourceField));
  }
  params.push(...extractLabeledWatts(remark, "remark"));
  params.push(...extractVoltage(remark, "remark"));
  params.push(...extractLumens(remark, "remark"));
  params.push(...extractLumensLoose(remark, "remark"));
  params.push(...extractBeamAngles(remark, "remark"));
  params.push(...extractCct(remark, "remark"));
  params.push(...extractLabeledCct(remark, "remark"));
  params.push(...extractLabeledMaterial(remark, "remark"));
  params.push(...extractChineseMaterial(remark, "remark"));
  params.push(...extractPf(remark, "remark"));
  params.push(...extractRemarkSizeParams(remark));
  params.push(...extractChargingLightSizeParams(remark));

  return params;
}

function extractChargingLightSizeParams(value: string): ExtractedParam[] {
  const params: ExtractedParam[] = [];
  const regex =
    /(?:产品尺寸|Product\s*Size|Size)\s*(?:[（(]\s*(?:MM|mm|CM|cm)\s*[）)])?\s*[:：]\s*([φΦøØ]?\s*\d+(?:\.\d+)?(?:\s*[×xX*]\s*\d+(?:\.\d+)?){1,2}\s*(?:mm|MM|cm|CM)?)/gi;
  for (const match of value.matchAll(regex)) {
    params.push(...extractCommonSizeParams(match[1], "remark"));
  }
  return params;
}

function extractG4G9Params(product: ProductForExtraction): ExtractedParam[] {
  const params: ExtractedParam[] = [];
  const remark = readSource(product, "remark");
  const modelNo = readSource(product, "model_no");
  const productName = readSource(product, "product_name");

  params.push(...extractLabeledWatts(remark, "remark"));
  params.push(...extractWatts(remark, "remark"));
  params.push(...extractWatts(modelNo, "model_no"));
  params.push(...extractLumens(remark, "remark"));
  params.push(...extractCri(remark, "remark"));
  params.push(...extractLabeledCri(remark, "remark"));
  params.push(...extractCct(remark, "remark"));
  params.push(...extractLabeledCct(remark, "remark"));
  params.push(...extractLabeledBase(remark, "remark"));
  params.push(...extractBases(productName, "product_name"));
  params.push(...extractBases(modelNo, "model_no"));
  params.push(...extractLabeledMaterial(remark, "remark"));
  params.push(...extractVoltage(remark, "remark"));

  return params;
}

function extractGenericParams(product: ProductForExtraction): ExtractedParam[] {
  const params: ExtractedParam[] = [];
  const modelNo = readSource(product, "model_no");
  const productName = readSource(product, "product_name");
  const remark = readSource(product, "remark");
  const material = readSource(product, "material");
  const offerRemark = readSource(product, "offer_remark");
  const joined = `${remark} ${modelNo} ${productName} ${material} ${offerRemark}`;

  params.push(...extractWatts(remark, "remark"));
  params.push(...extractLabeledWatts(remark, "remark"));
  params.push(...extractWatts(modelNo, "model_no"));
  params.push(...extractWatts(productName, "product_name"));
  params.push(...extractIp(joined, remark ? "remark" : "model_no"));
  params.push(...extractCct(remark, "remark"));
  params.push(...extractLabeledCct(remark, "remark"));
  params.push(...extractLabeledMaterial(remark, "remark"));
  params.push(...extractChineseMaterial(remark, "remark"));
  params.push(...extractCri(remark, "remark"));
  params.push(...extractLabeledCri(remark, "remark"));
  params.push(...extractBeamAngles(remark, "remark"));
  params.push(...extractLumens(remark, "remark"));
  params.push(...extractVoltage(remark, "remark"));
  params.push(...extractPf(remark, "remark"));
  params.push(...extractLabeledPf(remark, "remark"));
  params.push(...extractLmW(remark, "remark"));
  params.push(...extractSensor(joined, remark ? "remark" : "model_no"));
  params.push(...extractWarranty(remark, "remark"));
  params.push(...extractCertification(remark, "remark"));
  params.push(...extractDimmable(joined, remark ? "remark" : "model_no"));
  params.push(...extractBases(productName, "product_name"));
  params.push(...extractBases(modelNo, "model_no"));
  if (material) {
    params.push(param("material", material, normalizeMaterial(material), null, "material", "medium"));
  }

  return params;
}

function extractCommonSizeParams(size: string | null, sourceField: SourceField = "size"): ExtractedParam[] {
  const raw = cleanInline(size ?? "");
  if (!raw) {
    return [];
  }
  if (isPriceLikeSize(raw)) {
    return [];
  }
  const stringLightLength = extractStringLightLength(raw);
  if (stringLightLength) {
    return [
      param("length_mm", raw, stringLightLength, "mm", sourceField, "medium"),
      param("size_display", raw, `${stringLightLength}mm`, null, sourceField, "medium"),
    ];
  }

  const unitMultiplier = detectSizeUnitMultiplier(raw);
  const normalized = raw
    .replace(/[×xX*]/g, "×")
    .replace(/（.*?）|\(.*?\)/g, "")
    .trim();
  const params: ExtractedParam[] = [];

  const lwh = extractPrefixedDimensions(raw, unitMultiplier);
  if (lwh.length >= 2) {
    params.push(...lwh.map(([key, value]) => param(key, raw, formatNumber(value), "mm", sourceField, "medium")));
    params.push(param("size_display", raw, buildSizeDisplay(lwh), null, sourceField, "medium"));
    return params;
  }

  const lengthDiameter = extractLengthDiameterDimensions(raw, unitMultiplier);
  if (lengthDiameter.length > 0) {
    params.push(...lengthDiameter.map(([key, value]) => param(key, raw, formatNumber(value), "mm", sourceField, "medium")));
    params.push(param("size_display", raw, buildLengthDiameterDisplay(lengthDiameter), null, sourceField, "medium"));
    return params;
  }

  const numbers = extractNumbers(normalized).map((value) => value * unitMultiplier);
  if (numbers.length === 0) {
    return [];
  }

  const hasDiameter = /[φΦøØ]|dia|(?:^|[\s:/])D\s*\d/i.test(raw);
  if (hasDiameter) {
    params.push(param("diameter_mm", raw, formatNumber(numbers[0]), "mm", sourceField, "medium"));
    if (numbers[1] !== undefined) {
      params.push(param("height_mm", raw, formatNumber(numbers[1]), "mm", sourceField, "medium"));
    }
    params.push(param("size_display", raw, buildDiameterDisplay(numbers), null, sourceField, "medium"));
    return params;
  }

  if (numbers[0] !== undefined) {
    params.push(param("length_mm", raw, formatNumber(numbers[0]), "mm", sourceField, "medium"));
  }
  if (numbers[1] !== undefined) {
    params.push(param("width_mm", raw, formatNumber(numbers[1]), "mm", sourceField, "medium"));
  }
  if (numbers[2] !== undefined) {
    params.push(param("height_mm", raw, formatNumber(numbers[2]), "mm", sourceField, "medium"));
  }
  params.push(param("size_display", raw, buildRectDisplay(numbers), null, sourceField, "medium"));
  return params;
}

function extractRemarkSizeParams(value: string): ExtractedParam[] {
  const params: ExtractedParam[] = [];
  const regexes = [
    /(?:产品规格|产品尺寸|Product\s*Size|Size|尺寸|规格)\s*[:：]\s*([A-Z]?\d+(?:\.\d+)?(?:\s*[×xX*]\s*\d+(?:\.\d+)?){1,2}\s*(?:mm|CM|cm)?)/gi,
    /(?:产品规格|产品尺寸|Product\s*Size|Size|尺寸|规格)\s*[:：]\s*([φΦøØ]?\s*\d+(?:\.\d+)?\s*[×xX*]\s*\d+(?:\.\d+)?\s*(?:mm|CM|cm)?)/gi,
    /\b(Dia\d+(?:\.\d+)?\s*[×xX*]\s*\d+(?:\.\d+)?\s*(?:mm|CM|cm)?)/gi,
  ];

  for (const regex of regexes) {
    for (const match of value.matchAll(regex)) {
      const raw = match[1];
      params.push(...extractCommonSizeParams(raw, "remark"));
    }
  }

  return params;
}

function extractBases(value: string, sourceField: SourceField): ExtractedParam[] {
  const params: ExtractedParam[] = [];
  const regex = /\b(GU5\.3|GU10|MR16|MR11|GX53|E27|E14|E26|B22|B15)\b/gi;
  for (const match of value.matchAll(regex)) {
    params.push(param("base", match[0], match[0].toUpperCase(), null, sourceField, "high"));
  }
  return params;
}

function extractLabeledBase(value: string, sourceField: SourceField): ExtractedParam[] {
  const params: ExtractedParam[] = [];
  const match = value.match(/Base\s*[:：]\s*(E14|E27|E26|B22|B15|GU10|GU5\.3|MR16|MR11|GX53|G9|G4|R7S)\b/i);
  if (match) {
    params.push(param("base", match[0], match[1].toUpperCase(), null, sourceField, "high"));
  }
  return params;
}

function extractWatts(value: string, sourceField: SourceField): ExtractedParam[] {
  const params: ExtractedParam[] = [];
  for (const match of value.matchAll(/(?<![A-Za-z0-9])(\d+(?:\.\d+)?)\s*W(?![A-Za-z0-9])/gi)) {
    const contextBefore = value.slice(Math.max(0, match.index - 24), match.index);
    if (/最大功率|连接最大|可连接|总功率|total\s+power|max(?:imum)?\s+power/i.test(contextBefore)) {
      continue;
    }
    params.push(param("watts", match[0], trimLeadingZero(match[1]), "W", sourceField, "high"));
  }
  return params;
}

function extractLabeledWatts(value: string, sourceField: SourceField): ExtractedParam[] {
  const params: ExtractedParam[] = [];
  const rangeRegex =
    /(?:实际功率|额定功率|功率(?!\s*(?:因数|因素|系数))|REAL\s*POWER|Power|Wattage|Watt)(?:\s*\/\s*(?:REAL\s*POWER|Power))?\s*(?:[（(]\s*W\s*[）)]|[（(]\s*±\d+%\s*[）)])?\s*(?:±\d+%)?\s*[:：]?\s*(\d+(?:\.\d+)?)\s*[-－~～]\s*(\d+(?:\.\d+)?)\s*W?/gi;
  for (const match of value.matchAll(rangeRegex)) {
    params.push(param("watts", match[0], `${trimLeadingZero(match[1])}-${trimLeadingZero(match[2])}`, "W", sourceField, "high"));
  }

  const regex =
    /(?:实际功率|额定功率|功率(?!\s*(?:因数|因素|系数))|REAL\s*POWER|Power|Wattage|Watt)(?:\s*\/\s*(?:REAL\s*POWER|Power))?\s*(?:[（(]\s*W\s*[）)]|[（(]\s*±\d+%\s*[）)])?\s*(?:±\d+%)?\s*[:：]?\s*(\d+(?:\.\d+)?)\s*W?/gi;
  for (const match of value.matchAll(regex)) {
    if (params.some((item) => item.rawValue === match[0])) {
      continue;
    }
    params.push(param("watts", match[0], trimLeadingZero(match[1]), "W", sourceField, "high"));
  }
  return params;
}

export function extractCct(value: string, sourceField: SourceField): ExtractedParam[] {
  const params: ExtractedParam[] = [];
  for (const match of value.matchAll(/(\d{3,5})\s*[-/~]\s*(\d{3,5})\s*K\b/gi)) {
    params.push(param("cct", match[0], `${match[1]}-${match[2]}`, "K", sourceField, "medium"));
  }
  for (const match of value.matchAll(/(?<![\d-~/])(\d{3,5})\s*K\b/gi)) {
    const normalized = match[1];
    if (params.some((item) => item.normalizedValue?.includes(normalized))) {
      continue;
    }
    params.push(param("cct", match[0], normalized, "K", sourceField, "medium"));
  }
  return params;
}

function extractLabeledCct(value: string, sourceField: SourceField): ExtractedParam[] {
  const params: ExtractedParam[] = [];
  const regex = /(?:CCT|色温)\s*(?:[（(]\s*K\s*[）)])?\s*[:：]?\s*([0-9Kk\s/、,-]+)/gi;
  for (const match of value.matchAll(regex)) {
    const rawValue = match[0];
    const numbers = Array.from(match[1].matchAll(/\d{3,5}/g)).map((item) => item[0]);
    if (numbers.length === 0) {
      continue;
    }
    if (numbers.length === 2 && /[-~]/.test(match[1])) {
      params.push(param("cct", rawValue, `${numbers[0]}-${numbers[1]}`, "K", sourceField, "medium"));
      continue;
    }
    for (const valueItem of numbers.slice(0, 6)) {
      params.push(param("cct", valueItem, valueItem, "K", sourceField, "medium"));
    }
  }
  return params;
}

export function extractPf(value: string, sourceField: SourceField): ExtractedParam[] {
  const params: ExtractedParam[] = [];
  for (const match of value.matchAll(/\bP\.?\s*F\.?\s*[:：]?\s*(?:P\.?\s*F\.?)?\s*[>≥]?\s*([\d.,]+)/gi)) {
    params.push(param("pf", match[0], match[1].replace(",", "."), null, sourceField, "medium"));
  }
  return params;
}

function extractLabeledPf(value: string, sourceField: SourceField): ExtractedParam[] {
  const params: ExtractedParam[] = [];
  const regex = /(?:功率\s*(?:因数|因素)|PF值?|[（(]\s*PF\s*[）)])\s*[:：]?\s*[>≥]?\s*(\d+(?:\.\d+)?(?:-\d+(?:\.\d+)?)?)/gi;
  for (const match of value.matchAll(regex)) {
    params.push(param("pf", match[0], match[1], null, sourceField, "medium"));
  }
  return params;
}

export function extractLmW(value: string, sourceField: SourceField): ExtractedParam[] {
  const params: ExtractedParam[] = [];
  const labeledPatterns = [
    /(?:LM\/W|光效)\s*(?:[（(]\s*LM\/W\s*[）)])?\s*[:：]?\s*(\d+)\s*[-~]\s*(\d+)\s*(?:lm\/w|LM\/W)?/gi,
    /(?:LM\/W|光效)\s*(?:[（(]\s*LM\/W\s*[）)])?\s*[:：]?\s*(\d+)\s*(?:lm\/w|LM\/W)?/gi,
    /(?:光效|Lumens?)\s*(?:[（(][^）)]*[）)])?\s*[:：]?\s*(\d+)\s*(?:lm\/w|LM\/W)/gi,
    /Lumen\s*[:：]?\s*(\d+)\s*[-~]\s*(\d+)\s*(?:lm\/w|LM\/W)/gi,
    /Lumen\s*[:：]?\s*(\d+)\s*(?:lm\/w|LM\/W)/gi,
  ];
  for (const match of value.matchAll(labeledPatterns[0])) {
    params.push(param("luminous_efficacy", match[0], `${match[1]}-${match[2]}`, "lm/W", sourceField, "medium"));
  }
  for (const match of value.matchAll(labeledPatterns[1])) {
    const normalized = match[1];
    if (params.some((item) => item.normalizedValue?.includes(normalized))) {
      continue;
    }
    params.push(param("luminous_efficacy", match[0], normalized, "lm/W", sourceField, "medium"));
  }
  for (const match of value.matchAll(labeledPatterns[2])) {
    const normalized = match[1];
    if (params.some((item) => item.normalizedValue === normalized)) {
      continue;
    }
    params.push(param("luminous_efficacy", match[0], normalized, "lm/W", sourceField, "medium"));
  }
  for (const match of value.matchAll(labeledPatterns[3])) {
    const normalized = `${match[1]}-${match[2]}`;
    if (params.some((item) => item.normalizedValue === normalized)) {
      continue;
    }
    params.push(param("luminous_efficacy", match[0], normalized, "lm/W", sourceField, "medium"));
  }
  for (const match of value.matchAll(labeledPatterns[4])) {
    const normalized = match[1];
    if (params.some((item) => item.normalizedValue?.includes(normalized))) {
      continue;
    }
    params.push(param("luminous_efficacy", match[0], normalized, "lm/W", sourceField, "medium"));
  }
  for (const match of value.matchAll(/(\d+)\s*[-~]\s*(\d+)\s*(?:lm\/w|LM\/W)/gi)) {
    const normalized = `${match[1]}-${match[2]}`;
    if (params.some((item) => item.normalizedValue === normalized)) {
      continue;
    }
    params.push(param("luminous_efficacy", match[0], normalized, "lm/W", sourceField, "medium"));
  }
  return params;
}

function extractVoltage(value: string, sourceField: SourceField): ExtractedParam[] {
  const params: ExtractedParam[] = [];
  const patterns = [
    /\b((?:AC|DC)\s*\d+(?:[-－~～]\d+)?\s*V?)\b/gi,
    /\b(\d{2,3}\s*[-－~～]\s*\d{2,3}\s*V)\b/gi,
    /(?:Voltage|电压)\s*[:：]?\s*((?:AC|DC)?\s*\d{1,3}(?:[-－~～]\d{1,3})?\s*V)\b/gi,
  ];
  for (const regex of patterns) {
    for (const match of value.matchAll(regex)) {
      const raw = cleanInline(match[1]);
      const normalized = raw.replace(/\s+/g, "").replace(/[－～]/g, "-").replace(/V?$/i, "V").toUpperCase();
      params.push(param("voltage", raw, normalized, "V", sourceField, "high"));
    }
  }
  return params;
}

function extractCri(value: string, sourceField: SourceField): ExtractedParam[] {
  const params: ExtractedParam[] = [];
  for (const match of value.matchAll(/(?:Ra|CRI)\s*[:：]?\s*[≥>]?\s*(\d+)/gi)) {
    params.push(param("cri", match[0], `Ra${match[1]}`, null, sourceField, "high"));
  }
  for (const match of value.matchAll(/[≥>]?\s*(\d{2,3})\s*显指/g)) {
    params.push(param("cri", match[0], `Ra${match[1]}`, null, sourceField, "high"));
  }
  return params;
}

function extractLabeledCri(value: string, sourceField: SourceField): ExtractedParam[] {
  const params: ExtractedParam[] = [];
  for (const match of value.matchAll(/(?:显指|显值)\s*(?:[（(]\s*Ra\s*[）)])?\s*[:：]?\s*[≥>]?\s*(\d+)/gi)) {
    params.push(param("cri", match[0], `Ra${match[1]}`, null, sourceField, "high"));
  }
  return params;
}

function extractLumens(value: string, sourceField: SourceField): ExtractedParam[] {
  const params: ExtractedParam[] = [];
  for (const match of value.matchAll(/(?:光通量|Lumen|Lumens)(?:\s*\/\s*(?:Lumen|Lumens))?\s*(?:\[\s*lm\s*\])?\s*(?:±\d+%)?\s*[:：]?\s*(?:\d{3,5}K\s*=\s*)?(\d+(?:\.\d+)?)\s*(?:LM|lm|m)\b/gi)) {
    params.push(param("lumens", match[0], trimLeadingZero(match[1]), "lm", sourceField, "high"));
  }
  for (const match of value.matchAll(/(?:光通量|Lumen|Lumens)(?:\s*\/\s*(?:Lumen|Lumens))?\s*(?:\[\s*lm\s*\])?\s*(?:±\d+%)?\s*[:：]?\s*(\d+(?:\.\d+)?)(?!\s*(?:@|元|￥|¥))/gi)) {
    if (params.some((item) => item.normalizedValue === trimLeadingZero(match[1]))) {
      continue;
    }
    params.push(param("lumens", match[0], trimLeadingZero(match[1]), "lm", sourceField, "medium"));
  }
  return params;
}

function extractLumensLoose(value: string, sourceField: SourceField): ExtractedParam[] {
  const params: ExtractedParam[] = [...extractLumens(value, sourceField)];
  for (const match of value.matchAll(/(?<![A-Za-z0-9])(\d+(?:\.\d+)?)\s*(?:LM|lm)\b/g)) {
    const normalized = trimLeadingZero(match[1]);
    if (params.some((item) => item.normalizedValue === normalized)) {
      continue;
    }
    params.push(param("lumens", match[0], normalized, "lm", sourceField, "medium"));
  }
  return params;
}

function extractSolarCctTolerance(value: string, sourceField: SourceField): ExtractedParam[] {
  const params: ExtractedParam[] = [];
  for (const match of value.matchAll(/(\d{4,5})\s*[±]\s*(\d{2,4})\s*K?/g)) {
    params.push(param("cct", match[0], `${match[1]}±${match[2]}`, "K", sourceField, "medium"));
  }
  return params;
}

function extractBatterySpec(value: string, sourceField: SourceField): ExtractedParam[] {
  const params: ExtractedParam[] = [];
  for (const match of value.matchAll(/\b18650\s+\d+\s*[×xX*]\s*\d+\s*MAH\s+[\d.]+\s*V\b/gi)) {
    const normalized = cleanInline(match[0]).replace(/[×xX]/g, "*").replace(/\s+/g, " ").toUpperCase();
    params.push(param("battery_spec", match[0], normalized, null, sourceField, "medium"));
  }
  return params;
}

function extractBeamAngles(value: string, sourceField: SourceField): ExtractedParam[] {
  const params: ExtractedParam[] = [];
  for (const match of value.matchAll(/Beam\s*Angle\s*[:：]?\s*(\d{2,3})\s*[×xX*]\s*(\d{2,3})\s*[°度]?/gi)) {
    params.push(param("beam_angle", match[0], `${match[1]}×${match[2]}`, "°", sourceField, "high"));
  }
  for (const match of value.matchAll(/(\d{2,3})\s*[°度]/g)) {
    if (params.some((item) => item.rawValue.includes(match[0]))) {
      continue;
    }
    params.push(param("beam_angle", match[0], match[1], "°", sourceField, "high"));
  }
  return params;
}

function extractIp(value: string, sourceField: SourceField): ExtractedParam[] {
  const params: ExtractedParam[] = [];
  for (const match of value.matchAll(/\bIP\s*(\d{2})\b/gi)) {
    params.push(param("ip", match[0], `IP${match[1]}`, null, sourceField, "high"));
  }
  for (const match of value.matchAll(/\bIP\s*[:：]\s*(\d{2})\b/gi)) {
    if (params.some((item) => item.normalizedValue === `IP${match[1]}`)) {
      continue;
    }
    params.push(param("ip", match[0], `IP${match[1]}`, null, sourceField, "high"));
  }
  return params;
}

function extractLabeledMaterial(value: string, sourceField: SourceField): ExtractedParam[] {
  const params: ExtractedParam[] = [];
  const match = value.match(
    /Material\s*[:：]\s*([^:：]+?)(?=\s+(?:Motor\s+Power|Lamp\s+power|View\s+angle|Color\s+Temp|Color|Cable|Driver|Warranty|Ra|CRI|PF|Power|Watt|Beam|Lumen|LM\/W|Voltage|CCT|IP|Size|Function|Switch)\b|$)/i,
  );
  if (match) {
    params.push(param("material", match[1], normalizeMaterial(match[1]), null, sourceField, "medium"));
  }
  return params;
}

function extractColor(value: string, sourceField: SourceField): ExtractedParam[] {
  const params: ExtractedParam[] = [];
  const match = value.match(/\bColor\s*[:：]\s*([^,\s]+(?:\/[^,\s]+)*)/i);
  if (match) {
    params.push(param("color", match[0], cleanInline(match[1]).toLowerCase(), null, sourceField, "medium"));
  }
  return params;
}

function extractChineseMaterial(value: string, sourceField: SourceField): ExtractedParam[] {
  const params: ExtractedParam[] = [];
  const regex =
    /(?:材质|材料|Materials?|Description\s*材质)\s*[:：]\s*([^:：]+?)(?=\s+(?:产品尺寸|灯体尺寸|外箱|规格|开孔|功率|额定功率|电压|色温|光通|光效|显指|显值|功率\s*因|PF|包装|备注|驱动|CCT|Voltage|Power|Size)|$)/gi;
  for (const match of value.matchAll(regex)) {
    const raw = cleanInline(match[1]);
    if (!raw || raw === "/") {
      continue;
    }
    params.push(param("material", raw, normalizeMaterial(raw), null, sourceField, "high"));
  }
  return params;
}

function extractCutout(value: string, sourceField: SourceField): ExtractedParam[] {
  const params: ExtractedParam[] = [];
  for (const match of value.matchAll(/(?:开孔尺寸|cut[-\s]?out)\s*[:：]?\s*[φΦøØ]?\s*(\d+(?:\.\d+)?)\s*mm?/gi)) {
    params.push(param("cutout_mm", match[0], formatNumber(Number(match[1])), "mm", sourceField, "high"));
  }
  return params;
}

function extractWarranty(value: string, sourceField: SourceField): ExtractedParam[] {
  const params: ExtractedParam[] = [];
  for (const match of value.matchAll(/(?:质保|Warranty)\s*(?:[（(]?\s*年\s*[）)]?)?\s*[:：]?\s*(\d+(?:\.\d+)?)\s*(?:年|years?|Y)?/gi)) {
    params.push(param("warranty", match[0], trimLeadingZero(match[1]), "year", sourceField, "medium"));
  }
  return params;
}

function extractSensor(value: string, sourceField: SourceField): ExtractedParam[] {
  const params: ExtractedParam[] = [];
  if (/雷达|radar/i.test(value)) {
    params.push(param("sensor", "雷达/radar", "radar", null, sourceField, "medium"));
  }
  if (/微波|microwave/i.test(value)) {
    params.push(param("sensor", "微波/microwave", "microwave", null, sourceField, "medium"));
  }
  if (/PIR|红外/i.test(value)) {
    params.push(param("sensor", "PIR/红外", "PIR", null, sourceField, "medium"));
  }
  return params;
}

function extractDimmable(value: string, sourceField: SourceField): ExtractedParam[] {
  const params: ExtractedParam[] = [];
  if (/不调光|不可调光|non[-\s]?dim|not\s+dimmable/i.test(value)) {
    params.push(param("dimmable", "不调光", "no", null, sourceField, "high"));
  } else if (/调光|dimmable/i.test(value)) {
    params.push(param("dimmable", "调光", "yes", null, sourceField, "medium"));
  }
  return params;
}

function extractCertification(value: string, sourceField: SourceField): ExtractedParam[] {
  const params: ExtractedParam[] = [];
  for (const match of value.matchAll(/\b(CE|RoHS|SAA|UL|ETL|ERP|EMC)\b/gi)) {
    params.push(param("certification", match[0], match[1].toUpperCase(), null, sourceField, "medium"));
  }
  return params;
}

function extractTrackSystem(modelNo: string): string | null {
  const match = cleanInline(modelNo).match(/\b([MSR]\d{2})\b/i);
  return match ? match[1] : null;
}

function extractMagneticModuleType(value: string): { raw: string; normalized: string; sourceField: SourceField } | null {
  const text = cleanInline(value);
  if (/格栅|grille/i.test(text)) {
    return { raw: "格栅/grille", normalized: "grille", sourceField: "remark" };
  }
  if (/泛光|flood/i.test(text)) {
    return { raw: "泛光/flood", normalized: "floodlight", sourceField: "remark" };
  }
  if (/射灯|spot/i.test(text)) {
    return { raw: "射灯/spot", normalized: "spotlight", sourceField: "remark" };
  }
  if (/吊装|吊线|pendant/i.test(text)) {
    return { raw: "吊装/pendant", normalized: "pendant", sourceField: "remark" };
  }
  if (/转角|corner/i.test(text)) {
    return { raw: "转角/corner", normalized: "corner", sourceField: "remark" };
  }
  if (/\bML\b|线条|linear/i.test(text)) {
    return { raw: "ML/linear", normalized: "linear", sourceField: "model_no" };
  }
  return null;
}

function extractDescriptionSize(value: string): ExtractedParam[] | null {
  const match = cleanInline(value).match(/DESCRIPTION\s*[:：]\s*([φΦøØ]?\d+(?:\.\d+)?\s*[×xX*]\s*\d+(?:\.\d+)?(?:\s*[×xX*]\s*\d+(?:\.\d+)?)?)\s*mm?/i);
  if (!match) {
    return null;
  }
  return extractCommonSizeParams(match[1]);
}

function extractPanelSize(size: string): { normalized: string; shape: string; rawShape: string } | null {
  const raw = cleanInline(size);
  if (!raw) return null;
  const multiplier = detectSizeUnitMultiplier(raw);
  const numbers = extractNumbers(raw).map((value) => value * multiplier);
  if (numbers.length === 0) return null;
  if (/[φΦøØ]|dia|圆|round/i.test(raw) || numbers.length === 1) {
    return {
      normalized: `Φ${formatNumber(numbers[0])}`,
      shape: "圆",
      rawShape: raw,
    };
  }
  return {
    normalized: numbers.slice(0, 2).map(formatNumber).join("×"),
    shape: "方",
    rawShape: raw,
  };
}

function extractMountType(value: string): { raw: string; normalized: string; sourceField: SourceField } | null {
  const text = cleanInline(value);
  if (/嵌入|嵌装|recessed/i.test(text)) {
    return { raw: "嵌入/recessed", normalized: "嵌入", sourceField: "remark" };
  }
  if (/明装|surface/i.test(text)) {
    return { raw: "明装/surface", normalized: "明装", sourceField: "remark" };
  }
  if (/吊装|suspended|pendant/i.test(text)) {
    return { raw: "吊装/suspended", normalized: "吊装", sourceField: "remark" };
  }
  return null;
}

function extractBacklit(value: string): { raw: string; normalized: string; sourceField: SourceField } | null {
  const text = cleanInline(value);
  if (/backlit|back[-\s]?lit|直下|背光/i.test(text)) {
    return { raw: "backlit/直下", normalized: "backlit", sourceField: "remark" };
  }
  if (/edge[-\s]?lit|侧发光|侧光/i.test(text)) {
    return { raw: "edge-lit/侧发光", normalized: "edge-lit", sourceField: "remark" };
  }
  return null;
}

function extractLinearLengthFromText(value: string): { raw: string; normalized: string } | null {
  const match = cleanInline(value).match(/\b(300|450|600|900|1000|1200|1500|1800|2400)\b/);
  return match ? { raw: match[0], normalized: match[1] } : null;
}

function extractMaterialKeyword(value: string): { raw: string; normalized: string; sourceField: SourceField } | null {
  const text = cleanInline(value);
  if (/aluminum|aluminium|铝/i.test(text)) {
    return { raw: "aluminum/铝", normalized: "aluminum", sourceField: "remark" };
  }
  if (/\bPC\b|聚碳酸酯/i.test(text)) {
    return { raw: "PC", normalized: "PC", sourceField: "remark" };
  }
  if (/ABS/i.test(text)) {
    return { raw: "ABS", normalized: "ABS", sourceField: "remark" };
  }
  return null;
}

function extractSeries(modelNo: string): string | null {
  const match = cleanInline(modelNo).match(/\b([A-Z]{2,5}-[A-Z0-9]{2,6})(?=-|\b)/i);
  return match ? match[1] : null;
}

function extractStripWidthFromProductSize(value: string): { raw: string; normalized: string } | null {
  const match = cleanInline(value).match(/Product\s*Size\s*[：:]\s*[^:：]*?[×xX*]\s*(\d+(?:\.\d+)?)\s*mm\b/i);
  return match ? { raw: match[0], normalized: formatNumber(Number(match[1])) } : null;
}

function normalizeLedType(value: string): string {
  return cleanInline(value).replace(/\s+/g, "").toUpperCase();
}

function normalizeMaterial(value: string): string {
  return cleanInline(value)
    .replace(/Die[-\s]?cast\s+Aluminum/i, "die-cast aluminum")
    .replace(/Aluminium/gi, "Aluminum")
    .trim();
}

function pushFirstMatch(
  params: ExtractedParam[],
  value: string,
  regex: RegExp,
  options: {
    paramKey: string;
    sourceField: SourceField;
    confidence: Confidence;
    unit?: string | null;
    normalize?: (raw: string) => string;
  },
): void {
  const match = value.match(regex);
  if (!match) {
    return;
  }
  const raw = cleanInline(match[0]);
  const captured = cleanInline(match[1] ?? match[0]);
  params.push(
    param(
      options.paramKey,
      raw,
      options.normalize ? options.normalize(captured) : captured,
      options.unit ?? null,
      options.sourceField,
      options.confidence,
    ),
  );
}

function dedupeParams(params: ExtractedParam[]): ExtractedParam[] {
  const dedupedByValue = new Map<string, ExtractedParam>();
  for (const item of params) {
    const normalizedKey = normalizeParamValue(item.normalizedValue ?? item.rawValue);
    const key = `${item.paramKey}:${normalizedKey}`;
    const existing = dedupedByValue.get(key);
    if (!existing || compareParam(item, existing) < 0) {
      dedupedByValue.set(key, item);
    }
  }

  const byKey = new Map<string, ExtractedParam[]>();
  for (const item of dedupedByValue.values()) {
    byKey.set(item.paramKey, [...(byKey.get(item.paramKey) ?? []), item]);
  }

  const result: ExtractedParam[] = [];
  for (const [paramKey, values] of byKey.entries()) {
    const sorted = values.sort(compareParam);
    if (MULTI_VALUE_KEYS.has(paramKey)) {
      result.push(...sorted);
    } else {
      result.push(sorted[0]);
    }
  }
  return result.sort((a, b) => a.paramKey.localeCompare(b.paramKey));
}

function compareParam(a: ExtractedParam, b: ExtractedParam): number {
  const confidenceDiff = CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence];
  if (confidenceDiff !== 0) {
    return confidenceDiff;
  }
  const sourceDiff = SOURCE_PRIORITY[a.sourceField] - SOURCE_PRIORITY[b.sourceField];
  if (sourceDiff !== 0) {
    return sourceDiff;
  }
  return a.rawValue.localeCompare(b.rawValue);
}

async function applyExtractedParams(extracted: ExtractedParamWithProduct[]) {
  const writable = extracted.filter((param) => param.confidence !== "low");
  const productIds = Array.from(new Set(writable.map((param) => param.productId)));
  let insertedParams = 0;

  for (const category of TARGET_CATEGORIES) {
    const categoryProductIds = Array.from(
      new Set(writable.filter((param) => param.category === category).map((param) => param.productId)),
    );
    if (categoryProductIds.length === 0) {
      continue;
    }
    const categoryParams = writable.filter((param) => param.category === category);
    await prisma.$transaction(async (tx) => {
      await tx.productParam.deleteMany({ where: { productId: { in: categoryProductIds } } });
      if (categoryParams.length > 0) {
        await tx.productParam.createMany({
          data: categoryParams.map((param) => ({
            id: randomUUID(),
            productId: param.productId,
            paramKey: param.paramKey,
            rawValue: param.rawValue,
            normalizedValue: param.normalizedValue,
            unit: param.unit,
            sourceField: param.sourceField,
            confidence: param.confidence,
            updatedAt: new Date(),
          })),
        });
      }
    });
    insertedParams += categoryParams.length;
  }

  return { insertedParams, clearedProducts: productIds.length };
}

function buildCategoryStats(products: ProductForExtraction[], extracted: ExtractedParamWithProduct[]): CategoryStats[] {
  const statsByCategory = new Map<string, CategoryStats>();
  for (const category of TARGET_CATEGORIES) {
    statsByCategory.set(category, {
      category,
      products: products.filter((product) => product.category === category).length,
      productsWithParams: 0,
      totalParams: 0,
      writableParams: 0,
      lowParams: 0,
      byKey: new Map(),
      samples: [],
    });
  }

  const paramsByProduct = new Map<string, ExtractedParamWithProduct[]>();
  for (const item of extracted) {
    const productParams = paramsByProduct.get(item.productId) ?? [];
    productParams.push(item);
    paramsByProduct.set(item.productId, productParams);

    const stats = statsByCategory.get(item.category);
    if (!stats) {
      continue;
    }
    stats.totalParams += 1;
    if (item.confidence === "low") {
      stats.lowParams += 1;
    } else {
      stats.writableParams += 1;
    }
    const keyStats = stats.byKey.get(item.paramKey) ?? {
      total: 0,
      high: 0,
      medium: 0,
      low: 0,
      products: new Set<string>(),
    };
    keyStats.total += 1;
    keyStats[item.confidence] += 1;
    keyStats.products.add(item.productId);
    stats.byKey.set(item.paramKey, keyStats);
  }

  for (const product of products) {
    const category = product.category;
    if (!isTargetCategory(category)) {
      continue;
    }
    const stats = statsByCategory.get(category);
    const productParams = paramsByProduct.get(product.id) ?? [];
    if (!stats || productParams.length === 0) {
      continue;
    }
    stats.productsWithParams += 1;
    if (stats.samples.length < 1) {
      stats.samples.push({
        productId: product.id,
        modelNo: product.modelNo,
        productName: product.productName,
        params: productParams.sort(compareParam),
      });
    }
  }

  return Array.from(statsByCategory.values());
}

function buildMarkdownReport(input: {
  startedAt: Date;
  finishedAt: Date;
  products: ProductForExtraction[];
  stats: CategoryStats[];
  extracted: ExtractedParamWithProduct[];
  productParamCountBefore: number;
  productParamCountAfter: number;
  insertedParams: number;
  clearedProducts: number;
}): string {
  const writable = input.extracted.filter((param) => param.confidence !== "low");
  const low = input.extracted.filter((param) => param.confidence === "low");
  const lines: string[] = [];

  lines.push(`# ${targetConfig.title} DB Parameter Extraction Report`);
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("## Scope");
  lines.push("");
  lines.push(`- Mode: ${mode}`);
  lines.push("- Source: existing DB fields only (`products` + first `supplier_offers.remark`).");
  lines.push("- Source Excel files: not read.");
  lines.push("- Existing product fields: not modified.");
  lines.push(`- Target categories: ${TARGET_CATEGORIES.join(", ")}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push("| Metric | Count |");
  lines.push("|---|---:|");
  lines.push(`| Target products | ${input.products.length} |`);
  lines.push(`| Products with extracted params | ${new Set(input.extracted.map((param) => param.productId)).size} |`);
  lines.push(`| Extracted params total | ${input.extracted.length} |`);
  lines.push(`| Writable params (high/medium) | ${writable.length} |`);
  lines.push(`| Low-confidence params | ${low.length} |`);
  lines.push(`| product_params before | ${input.productParamCountBefore} |`);
  lines.push(`| product_params after | ${input.productParamCountAfter} |`);
  lines.push(`| Inserted params | ${input.insertedParams} |`);
  lines.push(`| Cleared products | ${input.clearedProducts} |`);
  if (mode === "dry-run") {
    lines.push("");
    lines.push("Dry-run expectation: `product_params after` should equal `before`, and `inserted params` should be 0.");
  }
  lines.push("");

  for (const stats of input.stats) {
    lines.push(`## ${stats.category} (${stats.products} products)`);
    lines.push("");
    lines.push("| Param | Extracted | Coverage | High | Medium | Low |");
    lines.push("|---|---:|---:|---:|---:|---:|");
    for (const [paramKey, keyStats] of Array.from(stats.byKey.entries()).sort((a, b) => b[1].products.size - a[1].products.size)) {
      lines.push(
        `| ${paramKey} | ${keyStats.total} | ${percent(keyStats.products.size, stats.products)} | ${keyStats.high} | ${keyStats.medium} | ${keyStats.low} |`,
      );
    }
    lines.push("");
    lines.push(`- Products with params: ${stats.productsWithParams}/${stats.products} (${percent(stats.productsWithParams, stats.products)})`);
    lines.push(`- Total params: ${stats.totalParams}`);
    lines.push(`- Writable params: ${stats.writableParams}`);
    lines.push(`- Skipped low-confidence params: ${stats.lowParams}`);
    lines.push("");

    if (stats.samples.length > 0) {
      lines.push("### Sample");
      lines.push("");
      for (const sample of stats.samples) {
        lines.push(`- Product: ${md(sample.modelNo ?? sample.productName)} (${sample.productId})`);
        lines.push("");
        lines.push("| Key | Raw | Normalized | Unit | Source | Confidence |");
        lines.push("|---|---|---|---|---|---|");
        for (const param of sample.params) {
          lines.push(
            `| ${param.paramKey} | ${md(param.rawValue)} | ${md(param.normalizedValue ?? "")} | ${md(param.unit ?? "")} | ${param.sourceField} | ${param.confidence} |`,
          );
        }
        lines.push("");
      }
    }
  }

  lines.push("## Low Confidence Params");
  lines.push("");
  if (low.length === 0) {
    lines.push("- None.");
  } else {
    lines.push("| Category | Product | Key | Raw | Normalized | Source |");
    lines.push("|---|---|---|---|---|---|");
    for (const item of low.slice(0, 200)) {
      lines.push(
        `| ${item.category} | ${md(item.modelNo ?? item.productName)} | ${item.paramKey} | ${md(item.rawValue)} | ${md(item.normalizedValue ?? "")} | ${item.sourceField} |`,
      );
    }
    if (low.length > 200) {
      lines.push(`| ... | ... | ... | ... | ... | ${low.length - 200} more omitted |`);
    }
  }
  lines.push("");

  lines.push("## Decision");
  lines.push("");
  if (mode === "dry-run") {
    lines.push("STOP. Review this dry-run report before running apply.");
  } else {
    lines.push("Apply completed.");
  }
  lines.push("");

  return lines.join("\n");
}

function readSource(product: ProductForExtraction, sourceField: SourceField): string {
  switch (sourceField) {
    case "model_no":
      return cleanInline(product.modelNo ?? "");
    case "product_name":
      return cleanInline(product.productName);
    case "remark":
      return cleanInline(product.remark ?? "");
    case "size":
      return cleanInline(product.size ?? "");
    case "material":
      return cleanInline(product.material ?? "");
    case "offer_remark":
      return cleanInline(product.supplierOffers.find((offer) => offer.remark?.trim())?.remark ?? "");
  }
}

function param(
  paramKey: string,
  rawValue: string,
  normalizedValue: string | null,
  unit: string | null,
  sourceField: SourceField,
  confidence: Confidence,
): ExtractedParam {
  return {
    paramKey,
    rawValue: cleanInline(rawValue),
    normalizedValue: normalizedValue ? cleanInline(normalizedValue) : null,
    unit,
    sourceField,
    confidence,
  };
}

function detectSizeUnitMultiplier(value: string): number {
  if (/\bcm\b|厘米/i.test(value)) {
    return 10;
  }
  if (/\bmm\b|毫米/i.test(value)) {
    return 1;
  }
  if (/^\s*\d+(?:\.\d+)?\s*m\b/i.test(value)) {
    return 1000;
  }
  return 1;
}

function extractPrefixedDimensions(value: string, multiplier: number): Array<[string, number]> {
  const result: Array<[string, number]> = [];
  const normalized = value.replace(/[：:]/g, "");
  const patterns: Array<[string, RegExp]> = [
    ["length_mm", /\bL\s*(\d+(?:\.\d+)?)/i],
    ["width_mm", /\bW\s*(\d+(?:\.\d+)?)/i],
    ["height_mm", /\bH\s*(\d+(?:\.\d+)?)/i],
  ];
  for (const [key, regex] of patterns) {
    const match = normalized.match(regex);
    if (match) {
      result.push([key, Number(match[1]) * multiplier]);
    }
  }
  return result;
}

function extractLengthDiameterDimensions(value: string, multiplier: number): Array<[string, number]> {
  const text = value.replace(/[：:]/g, "");
  const match = text.match(/(\d+(?:\.\d+)?)\s*[×xX*]\s*[φΦøØ]\s*(\d+(?:\.\d+)?)/i);
  if (!match) {
    return [];
  }
  return [
    ["length_mm", Number(match[1]) * multiplier],
    ["diameter_mm", Number(match[2]) * multiplier],
  ];
}

function extractNumbers(value: string): number[] {
  return Array.from(value.matchAll(/\d+(?:\.\d+)?/g)).map((match) => Number(match[0]));
}

function firstNumber(value: string): number | null {
  if (isPriceLikeSize(value)) {
    return null;
  }
  const match = value.match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) * detectSizeUnitMultiplier(value) : null;
}

function isPriceLikeSize(value: string): boolean {
  return /[¥￥$]|(?:RMB|CNY|USD)\b|单价|价格|报价|含税|不含税/i.test(cleanInline(value));
}

function extractStringLightLength(value: string): string | null {
  const raw = cleanInline(value);
  if (!/珠/.test(raw)) {
    return null;
  }
  const meterMatch = raw.match(/(\d+(?:\.\d+)?)\s*m\b/i);
  if (meterMatch) {
    return formatNumber(Number(meterMatch[1]) * 1000);
  }
  const centimeterMatch = raw.match(/(\d+(?:\.\d+)?)\s*(?:cm|厘米)\b/i);
  if (centimeterMatch) {
    return formatNumber(Number(centimeterMatch[1]) * 10);
  }
  return null;
}

function buildSizeDisplay(dimensions: Array<[string, number]>): string {
  const ordered = ["length_mm", "width_mm", "height_mm"]
    .map((key) => dimensions.find(([dimensionKey]) => dimensionKey === key)?.[1])
    .filter((value): value is number => value !== undefined);
  return `${ordered.map(formatNumber).join("×")}mm`;
}

function buildDiameterDisplay(numbers: number[]): string {
  if (numbers.length >= 2) {
    return `Φ${formatNumber(numbers[0])}×${formatNumber(numbers[1])}mm`;
  }
  return `Φ${formatNumber(numbers[0])}mm`;
}

function buildLengthDiameterDisplay(dimensions: Array<[string, number]>): string {
  const length = dimensions.find(([key]) => key === "length_mm")?.[1];
  const diameter = dimensions.find(([key]) => key === "diameter_mm")?.[1];
  if (length !== undefined && diameter !== undefined) {
    return `${formatNumber(length)}×Φ${formatNumber(diameter)}mm`;
  }
  return buildSizeDisplay(dimensions);
}

function buildRectDisplay(numbers: number[]): string {
  return `${numbers.slice(0, 3).map(formatNumber).join("×")}mm`;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

function trimLeadingZero(value: string): string {
  return formatNumber(Number(value));
}

function normalizeParamValue(value: string): string {
  return cleanInline(value).toLowerCase().replace(/\s+/g, "");
}

function cleanInline(value: string): string {
  return String(value ?? "")
    .normalize("NFC")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isTargetCategory(category: string | null): category is TargetCategory {
  return TARGET_CATEGORIES.includes(category as TargetCategory);
}

function percent(count: number, total: number): string {
  return `${percentNumber(count, total)}%`;
}

function percentNumber(count: number, total: number): string {
  if (total === 0) {
    return "0";
  }
  return ((count / total) * 100).toFixed(1);
}

function md(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, "<br>");
}

function readArg(name: string): string | null {
  const equalPrefix = `${name}=`;
  const equalArg = process.argv.find((arg) => arg.startsWith(equalPrefix));
  if (equalArg) {
    return equalArg.slice(equalPrefix.length) || null;
  }
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return null;
  }
  return process.argv[index + 1] ?? null;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
