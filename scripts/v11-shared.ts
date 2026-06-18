import path from "node:path";

import type { PrismaClient } from "@prisma/client";

export const HEADER_SCAN_ROWS = 10;
export const MIN_HEADER_CELLS = 3;
export const INSERT_BATCH_SIZE = 500;

export type LinkedProduct = {
  productId: string;
  modelNo: string | null;
  productName: string;
  category: string | null;
};

export type HeaderInfo = {
  rowIndex: number;
  values: unknown[];
};

export type MultiRowHeaderInfo = {
  mainRow: number;
  subRow: number | null;
  mergedValues: unknown[];
};

export type ParamColumn = {
  index: number;
  header: string;
  normalizedHeader: string;
  paramKey: string;
};

export type SheetParam = {
  paramKey: string;
  rawValue: string;
  normalizedValue: string;
  unit: string | null;
};

export type NormalizedParamValue = {
  normalizedValue: string | null;
  unit: string | null;
};

export const MODEL_HEADER_PATTERNS = [
  /item\s*no/i,
  /model/i,
  /型号/i,
  /product\s*no/i,
  /编号/i,
  /款号/i,
  /^item$/i,
  /^product\s*name$/i,
  /^产品名称$/i,
  /^品名$/i,
  /^名称$/i,
  /^specifications?$/i,
  /^description$/i,
];

const BUSINESS_PATTERNS = [
  /price/i,
  /fob/i,
  /unit\s*price/i,
  /单价/i,
  /价格/i,
  /含税/i,
  /不含税/i,
  /moq/i,
  /起订/i,
  /ctn/i,
  /carton/i,
  /package/i,
  /packing/i,
  /color\s*box/i,
  /彩盒/i,
  /g\.?\s*w/i,
  /n\.?\s*w/i,
  /毛重/i,
  /净重/i,
  /箱规/i,
  /外箱/i,
  /内盒/i,
  /装箱/i,
];

const PARAM_EXCLUSION_PATTERNS = [/power\s*cord/i, /power\s*supply/i, /power\s*solution/i, /线材规格/i, /电源/i];

export const HEADER_TO_PARAM: Record<string, string> = {
  power: "watts",
  watt: "watts",
  watts: "watts",
  wattage: "watts",
  "actual watt": "watts",
  "actual power": "watts",
  "actual test power": "watts",
  "real power": "watts",
  "rated wattage": "watts",
  "rated power": "watts",
  功率: "watts",
  实际功率: "watts",
  实测功率: "watts",
  额定功率: "watts",
  瓦数: "watts",
  w: "watts",
  cct: "cct",
  色温: "cct",
  可选色温: "cct",
  "color temperature": "cct",
  cri: "cri",
  ra: "cri",
  显指: "cri",
  显值: "cri",
  显色指数: "cri",
  pf: "pf",
  "power factor": "pf",
  功率因数: "pf",
  功率因素: "pf",
  pf值: "pf",
  "lm/w": "luminous_efficacy",
  efficiency: "luminous_efficacy",
  "lumen efficiency": "luminous_efficacy",
  "light efficiency": "luminous_efficacy",
  "luminous efficiency": "luminous_efficacy",
  光效: "luminous_efficacy",
  整灯光效: "luminous_efficacy",
  裸灯光效: "luminous_efficacy",
  "luminous flux": "lumens",
  lumens: "lumens",
  lumen: "lumens",
  光通量: "lumens",
  "beam angle": "beam_angle",
  angle: "beam_angle",
  光束角: "beam_angle",
  角度: "beam_angle",
  发光角度: "beam_angle",
  ip: "ip",
  "ip class": "ip",
  "ip grade": "ip",
  "ip rate": "ip",
  ip等级: "ip",
  防护等级: "ip",
  防水等级: "ip",
  voltage: "voltage",
  "input voltage": "voltage",
  input: "voltage",
  电压: "voltage",
  "output voltage": "note",
  "output current": "note",
  输出电压: "note",
  输出电流: "note",
  material: "material",
  材料: "material",
  材质: "material",
  size: "size_display",
  dimension: "size_display",
  "out size": "size_display",
  "outside size": "size_display",
  尺寸: "size_display",
  产品尺寸: "size_display",
  产品规格: "size_display",
  成品尺寸: "size_display",
  灯体尺寸: "size_display",
  灯具尺寸: "size_display",
  整灯尺寸: "size_display",
  太阳能板尺寸: "size_display",
  面板尺寸: "size_display",
  外形尺寸: "size_display",
  面环规格: "size_display",
  "product size": "size_display",
  "body size": "size_display",
  规格: "size_display",
  "led type": "led_type",
  "chip type": "led_type",
  chip: "led_type",
  灯珠: "led_type",
  灯珠类型: "led_type",
  base: "base",
  灯头: "base",
  warranty: "warranty",
  质保: "warranty",
  guarantee: "warranty",
  certificate: "certification",
  认证: "certification",
  shape: "shape",
  形状: "shape",
  "cut size": "cutout_mm",
  "hole size": "cutout_mm",
  开孔: "cutout_mm",
  "led number": "led_count",
  "led qty": "led_count",
  "led no": "led_count",
  "chips qty": "led_count",
  "led quantity": "led_count",
  led数量: "led_count",
  灯珠数量: "led_count",
  灯珠数: "led_count",
  灯珠颗数: "led_count",
  driver: "driver_type",
  驱动方案: "driver_type",
  驱动类型: "driver_type",
  "driver brand": "driver_brand",
  驱动: "driver_type",
  flicker: "flicker",
  flickery: "flicker",
  频闪: "flicker",
  sdcm: "sdcm",
  色容差: "sdcm",
  spd: "spd",
  surge: "spd",
  "ambient temperature": "ambient_temp",
  "working temperature": "ambient_temp",
  环境温度: "ambient_temp",
  工作温度: "ambient_temp",
  height: "height_mm",
  高度: "height_mm",
  "maximum linkable power": "max_linkable_power",
  accessories: "accessories",
  color: "color",
  "body color": "color",
  颜色: "color",
  note: "note",
  remark: "note",
  备注: "note",
};

export function resolvePhysicalPath(relativePath: string): string {
  return path.isAbsolute(relativePath) ? relativePath : path.join(process.cwd(), relativePath);
}

export function cellToString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value).trim();
  return String(value).trim();
}

export function normalizeHeader(input: string): string {
  return input
    .normalize("NFC")
    .replace(/[\r\n]+/g, " ")
    .replace(/[（(][^）)]*[）)]/g, " ")
    .replace(/±\s*\d+(?:\.\d+)?\s*(?:%|mm|cm)?/gi, " ")
    .replace(/\b(usd|rmb|cny|pcs|pc|mm|cm)\b$/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function normalizeForMatch(text: string): string {
  return text.normalize("NFC").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

export function normalizeForLooseMatch(text: string): string {
  return normalizeForMatch(text).replace(/[\s_\-–—/\\()（）.,，:：]+/g, "");
}

export function isBlankRow(row: unknown[]): boolean {
  return row.every((cell) => !cellToString(cell));
}

export function productParamKey(productId: string, paramKey: string): string {
  return `${productId}\u0000${paramKey}`;
}

export function escapeMd(value: string | number | null | undefined): string {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ").trim();
}

export function isUsefulParamValue(value: string): boolean {
  const normalized = value.trim();
  if (!normalized) return false;
  if (["-", "/", "\\", "n/a", "na", "null", "无"].includes(normalized.toLowerCase())) return false;
  return true;
}

export function isModelHeader(value: string): boolean {
  const normalized = normalizeHeader(value);
  return Boolean(normalized && MODEL_HEADER_PATTERNS.some((pattern) => pattern.test(normalized)));
}

export function isBusinessHeader(value: string): boolean {
  const normalized = normalizeHeader(value);
  return BUSINESS_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function isBroadGroupHeader(value: string): boolean {
  return /参数|parameter|面环|灯板|驱动|driver|尺寸|size|规格/i.test(value);
}

export function findModelColumn(headerValues: unknown[]): number | null {
  for (const [index, value] of headerValues.entries()) {
    if (isModelHeader(cellToString(value))) return index;
  }
  return null;
}

export function findPriceColumn(headerValues: unknown[]): number | null {
  const patterns = [/price/i, /单价/i, /含税/i, /报价/i, /fob/i, /unit\s*price/i, /rmb/i, /usd/i, /金额/i];
  for (const [index, value] of headerValues.entries()) {
    const normalized = normalizeHeader(cellToString(value));
    if (normalized && patterns.some((pattern) => pattern.test(normalized))) return index;
  }
  return null;
}

export function detectHeaderRow(rows: unknown[][]): HeaderInfo | null {
  let best: { rowIndex: number; values: unknown[]; nonEmptyCount: number } | null = null;
  for (const [rowIndex, row] of rows.entries()) {
    const nonEmptyCount = row.filter((cell) => cellToString(cell)).length;
    if (nonEmptyCount < MIN_HEADER_CELLS) continue;
    if (!best || nonEmptyCount > best.nonEmptyCount) best = { rowIndex, values: row, nonEmptyCount };
  }
  return best ? { rowIndex: best.rowIndex, values: best.values } : null;
}

export function detectModelHeaderRow(rows: unknown[][]): HeaderInfo | null {
  for (const [rowIndex, row] of rows.entries()) {
    if (row.some((cell) => isModelHeader(cellToString(cell)))) return { rowIndex, values: row };
  }
  return detectHeaderRow(rows);
}

export function detectMultiRowHeader(rows: unknown[][]): MultiRowHeaderInfo | null {
  for (let index = 0; index < Math.min(rows.length, HEADER_SCAN_ROWS); index += 1) {
    const row = rows[index] ?? [];
    if (!row.some((cell) => isModelHeader(cellToString(cell)))) continue;

    const nextRow = rows[index + 1] ?? null;
    if (nextRow) {
      const maxLength = Math.max(row.length, nextRow.length);
      const mainNulls = Array.from({ length: maxLength }, (_, col) => !cellToString(row[col])).filter(Boolean).length;
      const nextNonEmpty = nextRow.filter((cell) => cellToString(cell)).length;
      if (mainNulls >= 3 && nextNonEmpty >= 3) {
        return {
          mainRow: index,
          subRow: index + 1,
          mergedValues: mergeHeaderRows(row, nextRow, maxLength),
        };
      }
    }

    return { mainRow: index, subRow: null, mergedValues: [...row] };
  }
  return null;
}

export function detectBestHeader(rows: unknown[][]): {
  headerValues: unknown[];
  dataStartRow: number;
  modelColIndex: number | null;
  priceColIndex: number | null;
  headerRowIndex: number;
} {
  const multi = detectMultiRowHeader(rows);
  if (multi) {
    return {
      headerValues: multi.mergedValues,
      dataStartRow: (multi.subRow ?? multi.mainRow) + 1,
      modelColIndex: findModelColumn(multi.mergedValues),
      priceColIndex: findPriceColumn(multi.mergedValues),
      headerRowIndex: multi.mainRow,
    };
  }

  const standard = detectModelHeaderRow(rows.slice(0, HEADER_SCAN_ROWS));
  if (standard) {
    return {
      headerValues: standard.values,
      dataStartRow: standard.rowIndex + 1,
      modelColIndex: findModelColumn(standard.values),
      priceColIndex: findPriceColumn(standard.values),
      headerRowIndex: standard.rowIndex,
    };
  }

  return { headerValues: [], dataStartRow: 0, modelColIndex: null, priceColIndex: null, headerRowIndex: 0 };
}

export function mergeHeaderRows(mainRow: unknown[], subRow: unknown[], maxLength: number): unknown[] {
  return Array.from({ length: maxLength }, (_, index) => {
    const main = cellToString(mainRow[index]);
    const sub = cellToString(subRow[index]);
    if (!main) return sub || "";
    if (!sub) return main;
    if (isBusinessHeader(main) || isModelHeader(main)) return main;
    if (isBroadGroupHeader(main)) return `${main} ${sub}`.trim();
    return main;
  });
}

export function findParamColumns(headerValues: unknown[], modelColumnIndex: number | null = null): ParamColumn[] {
  const columns: ParamColumn[] = [];
  const seen = new Set<string>();
  for (const [index, value] of headerValues.entries()) {
    if (modelColumnIndex != null && index === modelColumnIndex) continue;
    const header = cellToString(value);
    const normalizedHeader = normalizeHeader(header);
    if (!normalizedHeader) continue;
    if (isBusinessHeader(normalizedHeader)) continue;
    const paramKey = matchParamKey(normalizedHeader);
    if (!paramKey) continue;
    if (seen.has(paramKey)) continue;
    seen.add(paramKey);
    columns.push({ index, header, normalizedHeader, paramKey });
  }
  return columns;
}

export function matchParamKey(normalizedHeader: string): string | null {
  if (PARAM_EXCLUSION_PATTERNS.some((pattern) => pattern.test(normalizedHeader))) return null;
  if (HEADER_TO_PARAM[normalizedHeader]) return HEADER_TO_PARAM[normalizedHeader];

  const entries = Object.entries(HEADER_TO_PARAM).sort(([left], [right]) => right.length - left.length);
  for (const [label, paramKey] of entries) {
    if (label.length <= 2) {
      if (normalizedHeader === label) return paramKey;
      continue;
    }
    if (containsHeaderLabel(normalizedHeader, label)) return paramKey;
  }
  return null;
}

export function containsHeaderLabel(normalizedHeader: string, label: string): boolean {
  if (/^[a-z0-9 ]+$/i.test(label)) {
    const escaped = escapeRegExp(label).replace(/\\ /g, "\\s+");
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(normalizedHeader);
  }
  return normalizedHeader.includes(label);
}

export function normalizeParamValue(paramKey: string, rawValue: string): NormalizedParamValue {
  const value = rawValue.trim();
  switch (paramKey) {
    case "watts":
      return normalizeNumberWithUnit(value, "W");
    case "luminous_efficacy":
      return normalizeNumberWithUnit(value, "lm/W");
    case "lumens":
      return normalizeNumberWithUnit(value, "lm");
    case "cct":
      return normalizeRangeNumberWithUnit(value, "K");
    case "cri":
    case "pf":
      return { normalizedValue: firstNumber(value), unit: null };
    case "ip": {
      const match = value.match(/ip\s*([0-9]{2})/i) ?? value.match(/\b([0-9]{2})\b/);
      return { normalizedValue: match?.[1] ?? value, unit: null };
    }
    case "beam_angle":
      return normalizeNumberWithUnit(value, "°");
    case "voltage":
      return { normalizedValue: normalizeVoltage(value), unit: "V" };
    case "led_count":
      return { normalizedValue: firstNumber(value), unit: null };
    case "cutout_mm":
      return { normalizedValue: value.replace(/[φΦ]/g, "").trim(), unit: "mm" };
    case "height_mm":
      return { normalizedValue: firstNumber(value), unit: "mm" };
    default:
      return { normalizedValue: value, unit: defaultUnitForParam(paramKey) };
  }
}

export function normalizeNumberWithUnit(value: string, unit: string): NormalizedParamValue {
  return { normalizedValue: firstNumber(value), unit };
}

export function normalizeRangeNumberWithUnit(value: string, unit: string): NormalizedParamValue {
  const numbers = value.match(/\d+(?:\.\d+)?/g);
  if (!numbers || numbers.length === 0) return { normalizedValue: value, unit };
  if (numbers.length >= 2) return { normalizedValue: `${numbers[0]}-${numbers[numbers.length - 1]}`, unit };
  return { normalizedValue: numbers[0], unit };
}

export function firstNumber(value: string | null | undefined): string | null {
  const match = String(value ?? "").replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  return match?.[0] ?? null;
}

export function normalizeVoltage(value: string): string {
  const match = value.replace(/,/g, "").match(/\d+(?:\.\d+)?(?:\s*[-~–]\s*\d+(?:\.\d+)?)?/);
  return match?.[0]?.replace(/\s+/g, "").replace(/–/g, "-") ?? value;
}

export function parsePriceValue(cell: unknown): number | null {
  let raw = cellToString(cell);
  if (!raw) return null;
  const currency = raw.match(/[¥￥]\s*([\d,.]+(?:\.\d+)?)/);
  if (currency) return Number.parseFloat(currency[1].replace(/,/g, ""));
  raw = raw
    .replace(/^\s*[\$¥￥]\s*/, "")
    .replace(/\s*(USD|RMB|CNY|元)\s*$/i, "")
    .replace(/,/g, "");
  const match = raw.match(/(\d+(?:\.\d+)?)/);
  return match ? Number.parseFloat(match[1]) : null;
}

export function parseSheetName(sheetName: string): SheetParam[] {
  const params: SheetParam[] = [];
  const seen = new Set<string>();
  const text = sheetName.normalize("NFC").trim();
  const add = (param: SheetParam) => {
    if (seen.has(param.paramKey)) return;
    seen.add(param.paramKey);
    params.push(param);
  };

  if (/非隔离/.test(text)) add({ paramKey: "driver_type", rawValue: text, normalizedValue: "非隔离", unit: null });
  else if (/隔离/.test(text) && !/非隔离/.test(text)) add({ paramKey: "driver_type", rawValue: text, normalizedValue: "隔离", unit: null });
  if (/\bDOB\b/i.test(text)) add({ paramKey: "driver_type", rawValue: text, normalizedValue: "DOB", unit: null });

  const voltageMatch = text.match(/[（(]?\s*(\d+)\s*V?\s*[-~–]\s*(\d+)\s*V\s*[）)]?/i);
  if (voltageMatch) {
    const v1 = Number.parseInt(voltageMatch[1], 10);
    const v2 = Number.parseInt(voltageMatch[2], 10);
    if (v1 >= 12 && v2 <= 480) add({ paramKey: "voltage", rawValue: `${v1}-${v2}V`, normalizedValue: `${v1}-${v2}`, unit: "V" });
  }

  const ipMatch = text.match(/IP\s*(\d{2})/i);
  if (ipMatch) add({ paramKey: "ip", rawValue: `IP${ipMatch[1]}`, normalizedValue: ipMatch[1], unit: null });

  const cctRange = text.match(/(\d{4})\s*[-~–]\s*(\d{4})\s*K/i);
  if (cctRange) {
    const k1 = Number.parseInt(cctRange[1], 10);
    const k2 = Number.parseInt(cctRange[2], 10);
    if (k1 >= 1800 && k2 <= 10000) add({ paramKey: "cct", rawValue: `${k1}-${k2}K`, normalizedValue: `${k1}-${k2}`, unit: "K" });
  } else {
    const cctSingle = text.match(/(\d{4})\s*K/i);
    if (cctSingle) {
      const k = Number.parseInt(cctSingle[1], 10);
      if (k >= 1800 && k <= 10000) add({ paramKey: "cct", rawValue: `${k}K`, normalizedValue: String(k), unit: "K" });
    }
  }

  return params;
}

export function inferCategoryFromFile(filePath: string, fileName: string): string | null {
  const combined = `${filePath} ${fileName}`.normalize("NFC");
  const categoryKeywords: Array<[string, string]> = [
    ["太阳能壁灯", "太阳能壁灯"],
    ["太阳能草坪灯", "太阳能"],
    ["太阳能庭院灯", "太阳能"],
    ["太阳能", "太阳能"],
    ["LED橱柜灯", "橱柜灯"],
    ["橱柜灯", "橱柜灯"],
    ["市电壁灯", "壁灯"],
    ["壁灯", "壁灯"],
    ["面板灯", "面板灯"],
    ["筒灯", "筒灯"],
    ["投光灯", "投光灯"],
    ["泛光灯", "投光灯"],
    ["线条灯", "线条灯"],
    ["办公灯", "线条灯"],
    ["三防灯", "三防灯"],
    ["灯丝灯", "灯丝灯"],
    ["灯带", "灯带"],
    ["轨道灯", "轨道灯"],
    ["磁吸灯", "磁吸灯"],
    ["净化灯", "净化灯"],
    ["天花灯", "天花灯"],
    ["工矿灯", "Highbay"],
    ["Highbay", "Highbay"],
    ["球泡", "球泡"],
    ["蜡烛灯", "灯丝灯"],
    ["灯管", "灯管"],
    ["皮线灯", "皮线灯"],
    ["路灯", "路灯"],
    ["庭院灯", "庭院灯"],
    ["工作灯", "工作灯"],
    ["风扇灯", "风扇灯"],
    ["G4G9", "G4G9"],
    ["净化", "净化灯"],
  ];
  for (const [keyword, category] of categoryKeywords) {
    if (combined.includes(keyword)) return category;
  }
  return null;
}

export function matchProduct(excelValue: string, products: LinkedProduct[]): LinkedProduct | null {
  const normalizedExcel = normalizeForMatch(excelValue);
  const looseExcel = normalizeForLooseMatch(excelValue);
  if (!normalizedExcel && !looseExcel) return null;

  const exact = chooseUnique(
    products.filter((product) => normalizeForMatch(product.modelNo ?? "") === normalizedExcel || normalizeForMatch(product.productName) === normalizedExcel),
    looseExcel,
  );
  if (exact) return exact;

  const looseExact = chooseUnique(
    products.filter((product) => normalizeForLooseMatch(product.modelNo ?? "") === looseExcel || normalizeForLooseMatch(product.productName) === looseExcel),
    looseExcel,
  );
  if (looseExact) return looseExact;

  return chooseUnique(
    products.filter((product) => {
      const model = normalizeForLooseMatch(product.modelNo ?? "");
      const name = normalizeForLooseMatch(product.productName);
      return (
        (model.length >= 3 && (looseExcel.includes(model) || model.includes(looseExcel))) ||
        (name.length >= 3 && (looseExcel.includes(name) || name.includes(looseExcel)))
      );
    }),
    looseExcel,
  );
}

export function chooseUnique(products: LinkedProduct[], excelValue: string): LinkedProduct | null {
  if (products.length === 0) return null;
  const scored = products
    .map((product) => ({
      product,
      score: Math.max(commonScore(excelValue, normalizeForLooseMatch(product.modelNo ?? "")), commonScore(excelValue, normalizeForLooseMatch(product.productName))),
    }))
    .sort((left, right) => right.score - left.score || left.product.productId.localeCompare(right.product.productId));
  return scored.length === 1 || scored[0].score > scored[1].score ? scored[0].product : null;
}

export function commonScore(left: string, right: string): number {
  if (!left || !right) return 0;
  if (left === right) return right.length + 1000;
  if (left.includes(right)) return right.length;
  if (right.includes(left)) return left.length;
  return 0;
}

export function extractCoreModel(modelNo: string): string | null {
  let core = modelNo
    .normalize("NFC")
    .replace(/[-_]\d+(?:mm|cm|寸|inch(?:es)?|")/gi, "")
    .replace(/[-_]\d+(?:\.\d+)?[Ww]$/g, "")
    .replace(/[-_]φ?\d+(?:[*×]\d+)?(?:mm)?$/gi, "")
    .replace(/[-_](?:圆形?|方形?|round|square)$/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (core.length < 3) return null;
  return core;
}

export function defaultUnitForParam(paramKey: string): string | null {
  switch (paramKey) {
    case "height_mm":
    case "cutout_mm":
      return "mm";
    default:
      return null;
  }
}

export const CATEGORY_CORE_PARAMS: Record<string, string[]> = {
  筒灯: ["voltage", "cct", "cri", "pf", "driver_type"],
  面板灯: ["voltage", "cct", "cri", "pf", "driver_type", "material"],
  磁吸灯: ["voltage", "cct", "cri"],
  吸顶灯: ["voltage", "cct", "cri", "pf", "driver_type"],
  灯丝灯: ["voltage", "cct", "cri", "pf", "base"],
  风扇灯: ["voltage", "cct", "cri"],
  球泡: ["voltage", "cct", "cri", "pf", "base"],
  壁灯: ["voltage", "cct", "cri", "driver_type", "material"],
  净化灯: ["voltage", "cct", "cri", "pf", "driver_type"],
  橱柜灯: ["voltage", "cct", "cri"],
  镜前灯: ["voltage", "cct", "cri", "driver_type"],
  轨道灯: ["voltage", "cct", "cri", "pf", "beam_angle"],
  防潮灯: ["voltage", "cct", "cri", "ip", "pf", "driver_type"],
  台灯: ["voltage", "cct", "cri"],
  G4G9: ["voltage", "cct", "cri", "base"],
  灯管: ["voltage", "cct", "cri", "pf"],
  线条灯: ["voltage", "cct", "cri", "ip"],
  投光灯: ["voltage", "cct", "cri", "ip", "pf", "beam_angle", "material"],
  三防灯: ["voltage", "cct", "cri", "ip", "pf"],
  太阳能壁灯: ["cct", "ip"],
  太阳能: ["cct", "ip"],
  路灯: ["voltage", "cct", "cri", "ip", "pf", "beam_angle"],
  "地埋灯/地插灯": ["voltage", "cct", "cri", "ip", "beam_angle"],
  工作灯: ["voltage", "cct", "cri", "ip"],
  庭院灯: ["voltage", "cct", "ip", "material"],
  Highbay: ["voltage", "cct", "cri", "ip", "pf", "beam_angle"],
  充电灯: ["cct", "ip"],
  应急灯: ["voltage", "cct"],
  灯带: ["voltage", "cct", "cri", "ip"],
  皮线灯: ["voltage"],
};

export async function loadAccessoryProductIds(prisma: PrismaClient): Promise<Set<string>> {
  const rows = await prisma.productParam.findMany({
    where: { paramKey: "product_role", normalizedValue: "accessory" },
    select: { productId: true },
  });
  return new Set(rows.map((row) => row.productId));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
