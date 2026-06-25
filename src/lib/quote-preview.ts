import {
  buildProductDetails,
  calcVolume,
  calculateSalePrice,
  cleanMoq,
  formatDimension,
  type QuoteWorkbookItem,
} from "./quote-export";
import { checkQuoteItemHealth, type CategorizedWarning, type WarningTier } from "./quote-health";

const SIZE_PARAM_KEYS = new Set(["size_display", "length_mm", "width_mm", "height_mm"]);
const WARNING_TIERS: WarningTier[] = ["customer", "quote", "logistics"];

export type QuotePreviewItem = Omit<QuoteWorkbookItem, "salePrice"> & {
  productId: string;
  supplierOfferId: string;
};

export type QuotePreviewInput = {
  customerName: string;
  currency: string;
  profitMargin: string | number | { toString(): string };
  exchangeRate: string | number | { toString(): string } | null;
  customerMode?: boolean;
  items: QuotePreviewItem[];
};

export type QuotePreviewRow = {
  productId: string;
  supplierOfferId: string;
  modelNo: string;
  productDetails: string;
  factoryName: string;
  purchasePrice: string;
  salePrice: string;
  salePriceDisplay: string;
  moq: string;
  ctnQty: string;
  ctnL: string;
  ctnW: string;
  ctnH: string;
  volume: string;
  remark: string;
  warnings: CategorizedWarning[];
};

export type QuotePreviewData = {
  customerName: string;
  currency: string;
  profitMargin: number;
  exchangeRate: number | null;
  customerMode: boolean;
  purchaseCurrency: string;
  rows: QuotePreviewRow[];
  totalWarnings: number;
  tierCounts: Record<WarningTier, number>;
};

export function buildQuotePreview(input: QuotePreviewInput): QuotePreviewData {
  const rows = input.items.map((item) => {
    const salePrice = calculateSalePrice({
      purchasePrice: item.purchasePrice,
      purchaseCurrency: item.purchaseCurrency,
      saleCurrency: input.currency,
      exchangeRate: input.exchangeRate,
      profitMargin: input.profitMargin,
    });
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
        id: item.supplierOfferId,
        factoryName: item.factoryName,
        purchasePrice: item.purchasePrice,
        moq: item.moq,
        ctnQty: item.ctnQty,
        ctnLength: item.ctnLength,
        ctnWidth: item.ctnWidth,
        ctnHeight: item.ctnHeight,
      },
    );
    const productDetails = buildProductDetails({ ...item, salePrice });
    const warnings = [...healthWarnings, ...buildProductDetailsWarnings(productDetails)];

    return {
      productId: item.productId,
      supplierOfferId: item.supplierOfferId,
      modelNo: item.modelNo ?? "",
      productDetails,
      factoryName: item.factoryName,
      purchasePrice: `${Number(item.purchasePrice.toString()).toFixed(2)} ${item.purchaseCurrency}`,
      salePrice,
      salePriceDisplay: `${salePrice} ${input.currency}`,
      moq: cleanMoq(item.moq),
      ctnQty: item.ctnQty ?? "",
      ctnL: formatDimension(item.ctnLength),
      ctnW: formatDimension(item.ctnWidth),
      ctnH: formatDimension(item.ctnHeight),
      volume: calcVolume(item.ctnLength, item.ctnWidth, item.ctnHeight),
      remark: item.remark ?? "",
      warnings,
    };
  });

  return {
    customerName: input.customerName,
    currency: input.currency,
    profitMargin: Number(input.profitMargin.toString()),
    exchangeRate: input.exchangeRate === null ? null : Number(input.exchangeRate.toString()),
    customerMode: input.customerMode !== false,
    purchaseCurrency: buildPurchaseCurrencyLabel(input.items),
    rows,
    totalWarnings: rows.reduce((sum, row) => sum + row.warnings.length, 0),
    tierCounts: buildTierCounts(rows),
  };
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

function buildTierCounts(rows: QuotePreviewRow[]): Record<WarningTier, number> {
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

function hasStructuredSizeParam(params: QuotePreviewItem["productParams"]): boolean {
  return params?.some((param) => SIZE_PARAM_KEYS.has(param.paramKey) && Boolean(param.normalizedValue?.trim())) ?? false;
}

function buildPurchaseCurrencyLabel(items: QuotePreviewItem[]): string {
  const currencies = Array.from(new Set(items.map((item) => item.purchaseCurrency)));
  return currencies.length === 1 ? currencies[0] : currencies.join("/");
}
