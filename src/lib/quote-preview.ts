import { calculateSalePrice, type QuoteWorkbookData, type QuoteWorkbookItem } from "./quote-export";
import {
  buildQuoteTableModel,
  buildTierCounts,
  type QuoteTableColumn,
  type QuoteTableRow,
} from "./quote-table-model";
import type { WarningTier } from "./quote-health";

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

export type QuotePreviewRow = QuoteTableRow;

export type QuotePreviewData = {
  customerName: string;
  currency: string;
  profitMargin: number;
  exchangeRate: number | null;
  customerMode: boolean;
  purchaseCurrency: string;
  columns: QuoteTableColumn[];
  rows: QuotePreviewRow[];
  totalWarnings: number;
  tierCounts: Record<WarningTier, number>;
};

export function buildQuotePreview(input: QuotePreviewInput): QuotePreviewData {
  const quote: QuoteWorkbookData = {
    id: "preview",
    customerName: input.customerName,
    currency: input.currency,
    profitMargin: input.profitMargin,
    exchangeRate: input.exchangeRate,
    createdAt: new Date(),
    items: input.items.map((item) => {
    const salePrice = calculateSalePrice({
      purchasePrice: item.purchasePrice,
      purchaseCurrency: item.purchaseCurrency,
      saleCurrency: input.currency,
      exchangeRate: input.exchangeRate,
      profitMargin: input.profitMargin,
    });
      return { ...item, salePrice };
    }),
  };
  const model = buildQuoteTableModel(quote, { customerMode: input.customerMode !== false });

  return {
    customerName: model.meta.customerName,
    currency: model.meta.currency,
    profitMargin: model.meta.profitMargin,
    exchangeRate: model.meta.exchangeRate,
    customerMode: model.customerMode,
    purchaseCurrency: model.meta.purchaseCurrency,
    columns: model.columns,
    rows: model.rows,
    totalWarnings: model.rows.reduce((sum, row) => sum + row.warnings.length, 0),
    tierCounts: buildTierCounts(model.rows),
  };
}
