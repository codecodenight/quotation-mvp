import {
  buildProductDetails,
  calcVolume,
  calculateSalePrice,
  cleanMoq,
  formatDimension,
  type QuoteWorkbookItem,
} from "./quote-export";
import { checkQuoteItemHealth } from "./quote-health";

export type QuotePreviewItem = Omit<QuoteWorkbookItem, "salePrice"> & {
  productId: string;
  supplierOfferId: string;
};

export type QuotePreviewInput = {
  customerName: string;
  currency: string;
  profitMargin: string | number | { toString(): string };
  exchangeRate: string | number | { toString(): string } | null;
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
  warnings: string[];
};

export type QuotePreviewData = {
  customerName: string;
  currency: string;
  profitMargin: number;
  exchangeRate: number | null;
  purchaseCurrency: string;
  rows: QuotePreviewRow[];
  totalWarnings: number;
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
    const warnings = checkQuoteItemHealth(
      {
        productName: item.productName,
        modelNo: item.modelNo,
        remark: item.productRemark,
        size: item.size,
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

    return {
      productId: item.productId,
      supplierOfferId: item.supplierOfferId,
      modelNo: item.modelNo ?? "",
      productDetails: buildProductDetails({ ...item, salePrice }),
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
    purchaseCurrency: buildPurchaseCurrencyLabel(input.items),
    rows,
    totalWarnings: rows.reduce((sum, row) => sum + row.warnings.length, 0),
  };
}

function buildPurchaseCurrencyLabel(items: QuotePreviewItem[]): string {
  const currencies = Array.from(new Set(items.map((item) => item.purchaseCurrency)));
  return currencies.length === 1 ? currencies[0] : currencies.join("/");
}
