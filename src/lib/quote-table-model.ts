import { buildProductDetailsFromParams, type ProductDetailsParam } from "./product-details-builder";
import { checkQuoteItemHealth, type CategorizedWarning, type WarningTier } from "./quote-health";
import { getTemplate, type QuoteTemplateColumn, type QuoteTemplateConfig, type QuoteTemplateItem } from "./quote-template-registry";

export type QuoteCellValue = string | number | null;

export type QuoteTableColumn = {
  key: string;
  header: string;
  width: number;
  align?: "left" | "center" | "right";
  numFmt?: string;
};

export type QuoteTableRow = {
  productId: string;
  supplierOfferId: string;
  cells: Record<string, QuoteCellValue>;
  warnings: CategorizedWarning[];
};

export type QuoteTableModel = {
  templateId: string;
  customerMode: boolean;
  meta: {
    customerName: string;
    currency: string;
    profitMargin: number;
    exchangeRate: number | null;
    purchaseCurrency: string;
    createdAt: Date;
  };
  columns: QuoteTableColumn[];
  rows: QuoteTableRow[];
};

type QuoteTableSourceData = {
  customerName: string;
  currency: string;
  profitMargin: string | number | { toString(): string };
  exchangeRate: string | number | { toString(): string } | null;
  createdAt: Date;
  items: QuoteTableSourceItem[];
};

type QuoteTableSourceItem = {
  productId?: string;
  supplierOfferId?: string;
  imagePath?: string | null;
  productName: string;
  category?: string | null;
  modelNo: string | null;
  factoryName: string;
  purchasePrice: string | number | { toString(): string };
  purchaseCurrency: string;
  salePrice: string | number | { toString(): string };
  moq: string | null;
  ctnQty: string | null;
  ctnLength: string | null;
  ctnWidth: string | null;
  ctnHeight: string | null;
  material: string | null;
  size: string | null;
  productRemark: string | null;
  productParams?: ProductDetailsParam[];
  remark: string | null;
};

const SIZE_PARAM_KEYS = new Set(["size_display", "length_mm", "width_mm", "height_mm"]);
const WARNING_TIERS: WarningTier[] = ["customer", "quote", "logistics"];
const IMAGE_COLUMN: QuoteTableColumn = {
  key: "image",
  header: "Photo",
  width: 12,
  align: "center",
};

const TEMPLATE_IDS_BY_CATEGORY: Record<string, string> = {
  G4G9: "g4g9",
  Highbay: "highbay",
  三防灯: "triproof",
  净化灯: "purification",
  台灯: "desk-lamp",
  吸顶灯: "ceiling",
  地埋灯: "inground",
  "地埋灯/地插灯": "inground",
  壁灯: "wall-lamp",
  工作灯: "work-light",
  庭院灯: "garden",
  应急灯: "emergency",
  投光灯: "floodlight",
  橱柜灯: "cabinet",
  灯丝灯: "filament",
  灯带: "strip",
  灯管: "tube",
  球泡: "bulb",
  皮线灯: "string-light",
  磁吸灯: "magnetic-track",
  筒灯: "downlight",
  线条灯: "linear",
  路灯: "street-light",
  轨道灯: "track-light",
  防潮灯: "moisture-proof",
  镜前灯: "mirror-light",
  面板灯: "panel",
  风扇灯: "fan-light",
  太阳能: "solar",
  太阳能壁灯: "solar-wall",
};

export function buildQuoteTableModel(
  quote: QuoteTableSourceData,
  options: { customerMode: boolean },
): QuoteTableModel {
  const customerMode = options.customerMode !== false;
  const template = findCategoryTemplate(quote);
  const columns = template
    ? buildTemplateColumns(template, quote.currency, customerMode)
    : buildGenericColumns(quote.currency, customerMode);

  return {
    templateId: template ? TEMPLATE_IDS_BY_CATEGORY[template.category] ?? template.category : "generic",
    customerMode,
    meta: {
      customerName: quote.customerName,
      currency: quote.currency,
      profitMargin: Number(quote.profitMargin.toString()),
      exchangeRate: quote.exchangeRate === null ? null : Number(quote.exchangeRate.toString()),
      purchaseCurrency: buildPurchaseCurrencyLabel(quote.items),
      createdAt: quote.createdAt,
    },
    columns,
    rows: quote.items.map((item, index) => {
      const cells = template
        ? buildTemplateRowCells(template, item, quote.currency, index, customerMode)
        : buildGenericRowCells(item, customerMode);

      return {
        productId: item.productId ?? `product-${index + 1}`,
        supplierOfferId: item.supplierOfferId ?? `offer-${index + 1}`,
        cells,
        warnings: buildQuoteTableWarnings(item),
      };
    }),
  };
}

export function buildTierCounts(rows: QuoteTableRow[]): Record<WarningTier, number> {
  return WARNING_TIERS.reduce(
    (counts, tier) => {
      counts[tier] = rows.reduce(
        (sum, row) => sum + row.warnings.filter((warning) => warning.tier === tier).length,
        0,
      );
      return counts;
    },
    { customer: 0, quote: 0, logistics: 0 } as Record<WarningTier, number>,
  );
}

export function buildGenericRowCells(
  item: QuoteTableSourceItem,
  customerMode: boolean,
): Record<string, QuoteCellValue> {
  const cells: Record<string, QuoteCellValue> = {
    image: item.imagePath ?? null,
    modelNo: item.modelNo ?? "",
    productDetails: buildProductDetails(item),
    salePrice: readWorkbookNumber(item.salePrice),
    moq: cleanMoq(item.moq),
    ctnQty: item.ctnQty ?? "",
    ctnLength: formatDimension(item.ctnLength),
    ctnWidth: formatDimension(item.ctnWidth),
    ctnHeight: formatDimension(item.ctnHeight),
    ctnVolume: calcVolume(item.ctnLength, item.ctnWidth, item.ctnHeight),
    remark: item.remark ?? "",
  };

  if (!customerMode) {
    cells.factoryName = item.factoryName;
    cells.purchasePrice = formatPurchasePrice(item);
  }

  return cells;
}

export function buildTemplateItem(item: QuoteTableSourceItem, currency: string): QuoteTemplateItem {
  return {
    productName: item.productName,
    imagePath: item.imagePath ?? null,
    modelNo: item.modelNo,
    size: item.size,
    material: item.material,
    remark: item.remark,
    salePrice: readWorkbookNumber(item.salePrice),
    purchasePrice: readWorkbookNumber(item.purchasePrice),
    currency,
    moq: item.moq,
    ctnQty: item.ctnQty,
    ctnLength: item.ctnLength,
    ctnWidth: item.ctnWidth,
    ctnHeight: item.ctnHeight,
    params: buildTemplateParams(item.productParams ?? []),
  };
}

export function buildProductDetails(item: QuoteTableSourceItem): string {
  if (item.productParams && item.productParams.length > 0) {
    const paramDetails = buildProductDetailsFromParams(item.productParams);
    if (paramDetails) {
      const size = item.size?.trim() ?? "";
      const hasSizeDisplay = item.productParams.some(
        (param) => param.paramKey === "size_display" && Boolean(param.normalizedValue?.trim()),
      );
      if (!hasSizeDisplay && size) {
        return `${paramDetails}\nSize: ${size}`;
      }
      return paramDetails;
    }
  }

  const remark = cleanRemarkForCustomer(stripModelPrefix(item.productRemark?.trim() ?? "", item.modelNo));
  const productName = stripModelPrefix(item.productName?.trim() ?? "", item.modelNo);
  const size = item.size?.trim() ?? "";
  const details = remark || productName;

  if (details && size) {
    return `${details}\nSize: ${size}`;
  }
  if (details) {
    return details;
  }
  return size;
}

export function cleanMoq(raw: string | null): string {
  if (!raw) {
    return "";
  }

  const match = raw.match(/^[\d,]+/);
  return match ? match[0].replace(/,/g, "") : "";
}

export function formatDimension(value: string | null): string {
  if (!value) {
    return "";
  }
  return `${value} cm`;
}

export function calcVolume(length: string | null, width: string | null, height: string | null): string {
  if (!length || !width || !height) {
    return "";
  }

  const parsedLength = Number.parseFloat(length);
  const parsedWidth = Number.parseFloat(width);
  const parsedHeight = Number.parseFloat(height);
  if (!Number.isFinite(parsedLength) || !Number.isFinite(parsedWidth) || !Number.isFinite(parsedHeight)) {
    return "";
  }

  return `${((parsedLength * parsedWidth * parsedHeight) / 1_000_000).toFixed(3)} m³`;
}

function buildTemplateColumns(
  template: QuoteTemplateConfig,
  currency: string,
  customerMode: boolean,
): QuoteTableColumn[] {
  const columns = [IMAGE_COLUMN, ...template.columns.map((column) => toTableColumn(column, currency))];
  if (customerMode) {
    return columns;
  }

  return insertColumnBefore(
    insertColumnAfter(columns, "modelNo", {
      key: "factoryName",
      header: "Factory Name",
      width: 18,
      align: "left",
    }),
    "salePrice",
    {
      key: "purchasePrice",
      header: "Purchase Price",
      width: 16,
      align: "right",
    },
  );
}

function buildGenericColumns(currency: string, customerMode: boolean): QuoteTableColumn[] {
  const columns: QuoteTableColumn[] = [
    IMAGE_COLUMN,
    { key: "modelNo", header: "Model Name", width: 18, align: "left" },
    { key: "productDetails", header: "Product Details", width: 48, align: "left" },
  ];

  if (!customerMode) {
    columns.push(
      { key: "factoryName", header: "Factory Name", width: 18, align: "left" },
      { key: "purchasePrice", header: "Purchase Price", width: 16, align: "right" },
    );
  }

  columns.push(
    { key: "salePrice", header: "Unit Price", width: 16, align: "right", numFmt: priceFormat(currency) },
    { key: "moq", header: "MOQ", width: 12, align: "center" },
    { key: "ctnQty", header: "CTN Qty", width: 12, align: "center" },
    { key: "ctnLength", header: "L", width: 10, align: "center" },
    { key: "ctnWidth", header: "W", width: 10, align: "center" },
    { key: "ctnHeight", header: "H", width: 10, align: "center" },
    { key: "ctnVolume", header: "Volume", width: 14, align: "center" },
    { key: "remark", header: "Remark", width: 24, align: "left" },
  );

  return columns;
}

function buildTemplateRowCells(
  template: QuoteTemplateConfig,
  item: QuoteTableSourceItem,
  currency: string,
  index: number,
  customerMode: boolean,
): Record<string, QuoteCellValue> {
  const cells = template.buildRowCells(buildTemplateItem(item, currency), index);
  cells.image = item.imagePath ?? null;
  if (!customerMode) {
    cells.factoryName = item.factoryName;
    cells.purchasePrice = formatPurchasePrice(item);
  }
  return cells;
}

function buildQuoteTableWarnings(item: QuoteTableSourceItem): CategorizedWarning[] {
  const productDetails = buildProductDetails(item);
  const healthWarnings = checkQuoteItemHealth(
    {
      productName: item.productName,
      modelNo: item.modelNo,
      remark: item.productRemark,
      size: item.size,
      hasSizeParam: hasStructuredSizeParam(item.productParams ?? []),
      supplierOffers: [],
    },
    {
      id: item.supplierOfferId ?? "",
      factoryName: item.factoryName,
      purchasePrice: item.purchasePrice,
      moq: item.moq,
      ctnQty: item.ctnQty,
      ctnLength: item.ctnLength,
      ctnWidth: item.ctnWidth,
      ctnHeight: item.ctnHeight,
    },
  );
  return [...healthWarnings, ...buildProductDetailsWarnings(productDetails)];
}

function buildProductDetailsWarnings(productDetails: string): CategorizedWarning[] {
  const warnings: CategorizedWarning[] = [];
  const trimmedDetails = productDetails.trim();

  if (/[一-鿿]/.test(trimmedDetails)) {
    warnings.push({ message: "Product Details 含中文", tier: "customer" });
  }
  if (/外箱尺寸|内盒尺寸|彩盒尺寸|包装尺寸|carton\s*size/i.test(trimmedDetails)) {
    warnings.push({ message: "Product Details 含包装标签", tier: "customer" });
  }
  if (trimmedDetails.split(/\r?\n/).filter((line) => line.trim().length > 0).length < 2) {
    warnings.push({ message: "Product Details 不足 2 行", tier: "customer" });
  }

  return warnings;
}

function toTableColumn(column: QuoteTemplateColumn, currency: string): QuoteTableColumn {
  return {
    ...column,
    header: normalizeTemplateHeader(column.header),
    align: column.key === "modelNo" ? "left" : column.key === "salePrice" ? "right" : "center",
    numFmt: column.key === "salePrice" ? priceFormat(currency) : undefined,
  };
}

function normalizeTemplateHeader(header: string): string {
  return header
    .replace(/\s*\((?:USD|PCS|cm|mm|m³)\)\s*/gi, "")
    .replace(/^Packing Volume$/i, "Volume")
    .trim();
}

function insertColumnAfter(
  columns: QuoteTableColumn[],
  key: string,
  column: QuoteTableColumn,
): QuoteTableColumn[] {
  const index = columns.findIndex((candidate) => candidate.key === key);
  if (index < 0) {
    return [...columns, column];
  }
  return [...columns.slice(0, index + 1), column, ...columns.slice(index + 1)];
}

function insertColumnBefore(
  columns: QuoteTableColumn[],
  key: string,
  column: QuoteTableColumn,
): QuoteTableColumn[] {
  const index = columns.findIndex((candidate) => candidate.key === key);
  if (index < 0) {
    return [...columns, column];
  }
  return [...columns.slice(0, index), column, ...columns.slice(index)];
}

function findCategoryTemplate(quote: QuoteTableSourceData): QuoteTemplateConfig | null {
  const itemCategories = quote.items.map((item) => item.category?.trim() ?? "");
  if (itemCategories.length === 0 || itemCategories.some((category) => !category)) {
    return null;
  }

  const categories = new Set(itemCategories);
  if (categories.size !== 1) {
    return null;
  }

  return getTemplate(Array.from(categories)[0]);
}

function buildTemplateParams(params: ProductDetailsParam[]): Record<string, string> {
  const record: Record<string, string> = {};
  for (const param of params) {
    const value = param.normalizedValue?.trim() || param.rawValue?.trim();
    if (value && !record[param.paramKey]) {
      record[param.paramKey] = value;
    }
  }
  return record;
}

function hasStructuredSizeParam(params: ProductDetailsParam[]): boolean {
  return params.some((param) => SIZE_PARAM_KEYS.has(param.paramKey) && Boolean(param.normalizedValue?.trim()));
}

function buildPurchaseCurrencyLabel(items: QuoteTableSourceItem[]): string {
  const currencies = Array.from(new Set(items.map((item) => normalizeCurrency(item.purchaseCurrency)).filter(Boolean)));
  return currencies.length === 1 ? currencies[0] : currencies.join("/") || "采购币种";
}

function formatPurchasePrice(item: QuoteTableSourceItem): string {
  return `${readWorkbookNumber(item.purchasePrice).toFixed(2)} ${item.purchaseCurrency}`;
}

function priceFormat(currency: string): string {
  return `#,##0.00 "${currency}"`;
}

function readWorkbookNumber(value: string | number | { toString(): string }): number {
  const parsed = Number(value.toString());
  return Number.isFinite(parsed) ? parsed : 0;
}

function stripModelPrefix(text: string, modelNo: string | null): string {
  if (!text || !modelNo?.trim()) {
    return text;
  }

  const model = modelNo.trim();
  if (text.trim().toLowerCase() === model.toLowerCase()) {
    return "";
  }

  const pattern = new RegExp(`^${escapeRegExp(model)}(?:\\s*[/|,;:]\\s*|\\s+)`, "i");
  return text.replace(pattern, "").trim();
}

function cleanRemarkForCustomer(text: string): string {
  if (!text) {
    return "";
  }

  return text
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/外箱尺寸|内盒尺寸|彩盒尺寸|包装尺寸|carton\s*size/i.test(line))
    .filter((line) => !/^\s*\S+\s*[:：]\s*[/／]\s*$/.test(line))
    .join("\n")
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeCurrency(value: string): string {
  return value.trim().toUpperCase();
}
