import type { Prisma } from "@prisma/client";

import { buildProductDetails } from "./quote-export";

export type QuoteSearchFilters = {
  customerName?: string;
  dateFrom?: string;
  dateTo?: string;
  currency?: string;
  productKeyword?: string;
};

export const DEFAULT_QUOTE_SEARCH_FILTERS: Required<QuoteSearchFilters> = {
  customerName: "",
  dateFrom: "",
  dateTo: "",
  currency: "ALL",
  productKeyword: "",
};

export function createDefaultQuoteSearchFilters(): Required<QuoteSearchFilters> {
  return { ...DEFAULT_QUOTE_SEARCH_FILTERS };
}

export type QuoteSearchResult = {
  id: string;
  customerName: string;
  currency: string;
  profitMargin: number;
  exchangeRate: number | null;
  createdAt: string;
  itemCount: number;
  filePath: string | null;
};

export type QuoteDetail = {
  id: string;
  customerName: string;
  currency: string;
  profitMargin: number;
  exchangeRate: number | null;
  createdAt: string;
  filePath: string | null;
  fileExists: boolean;
  items: QuoteDetailItem[];
};

export type QuoteDetailItem = {
  modelNo: string;
  productName: string;
  productDetails: string;
  purchasePrice: number;
  purchaseCurrency: string;
  salePrice: number;
  moq: string | null;
  ctnQty: string | null;
  quantity: number;
  remark: string | null;
};

type SerializableDecimal = {
  toString(): string;
};

type QuoteSearchRow = {
  id: string;
  customerName: string;
  currency: string;
  profitMargin: SerializableDecimal;
  exchangeRate: SerializableDecimal | null;
  quoteFilePath: string | null;
  createdAt: Date;
  _count: {
    items: number;
  };
};

type QuoteDetailRow = {
  id: string;
  customerName: string;
  currency: string;
  profitMargin: SerializableDecimal;
  exchangeRate: SerializableDecimal | null;
  quoteFilePath: string | null;
  createdAt: Date;
  items: QuoteDetailItemRow[];
};

type QuoteDetailItemRow = {
  purchasePrice: SerializableDecimal;
  purchaseCurrency: string;
  salePrice: SerializableDecimal;
  quantity: number;
  remark: string | null;
  product: {
    productName: string;
    modelNo: string | null;
    material: string | null;
    size: string | null;
    remark: string | null;
  };
  supplierOffer: {
    factoryName?: string | null;
    moq: string | null;
    ctnQty: string | null;
    ctnLength?: string | null;
    ctnWidth?: string | null;
    ctnHeight?: string | null;
  } | null;
};

export function buildQuoteSearchWhere(filters: QuoteSearchFilters): Prisma.QuoteWhereInput {
  const and: Prisma.QuoteWhereInput[] = [];
  const customerName = filters.customerName?.trim();
  const currency = filters.currency?.trim().toUpperCase();
  const productKeyword = filters.productKeyword?.trim();
  const createdAt = buildCreatedAtFilter(filters.dateFrom, filters.dateTo);

  if (customerName) {
    and.push({ customerName: { contains: customerName } });
  }
  if (createdAt) {
    and.push({ createdAt });
  }
  if (currency && currency !== "ALL") {
    and.push({ currency });
  }
  if (productKeyword) {
    and.push({
      items: {
        some: {
          product: {
            OR: [{ modelNo: { contains: productKeyword } }, { productName: { contains: productKeyword } }],
          },
        },
      },
    });
  }

  return and.length > 0 ? { AND: and } : {};
}

export function serializeQuoteSearchResult(quote: QuoteSearchRow): QuoteSearchResult {
  return {
    id: quote.id,
    customerName: quote.customerName,
    currency: quote.currency,
    profitMargin: Number(quote.profitMargin.toString()),
    exchangeRate: quote.exchangeRate === null ? null : Number(quote.exchangeRate.toString()),
    createdAt: quote.createdAt.toISOString(),
    itemCount: quote._count.items,
    filePath: quote.quoteFilePath,
  };
}

export function serializeQuoteDetail(quote: QuoteDetailRow, fileExists: boolean): QuoteDetail {
  return {
    id: quote.id,
    customerName: quote.customerName,
    currency: quote.currency,
    profitMargin: Number(quote.profitMargin.toString()),
    exchangeRate: quote.exchangeRate === null ? null : Number(quote.exchangeRate.toString()),
    createdAt: quote.createdAt.toISOString(),
    filePath: quote.quoteFilePath,
    fileExists,
    items: quote.items.map((item) => serializeQuoteDetailItem(item)),
  };
}

function serializeQuoteDetailItem(item: QuoteDetailItemRow): QuoteDetailItem {
  const salePrice = Number(item.salePrice.toString());
  return {
    modelNo: item.product.modelNo ?? "",
    productName: item.product.productName,
    productDetails: buildProductDetails({
      productName: item.product.productName,
      modelNo: item.product.modelNo,
      factoryName: item.supplierOffer?.factoryName ?? "",
      purchasePrice: item.purchasePrice,
      purchaseCurrency: item.purchaseCurrency,
      salePrice,
      quantity: item.quantity,
      moq: item.supplierOffer?.moq ?? null,
      ctnQty: item.supplierOffer?.ctnQty ?? null,
      ctnLength: item.supplierOffer?.ctnLength ?? null,
      ctnWidth: item.supplierOffer?.ctnWidth ?? null,
      ctnHeight: item.supplierOffer?.ctnHeight ?? null,
      material: item.product.material,
      size: item.product.size,
      productRemark: item.product.remark,
      remark: item.remark,
    }),
    purchasePrice: Number(item.purchasePrice.toString()),
    purchaseCurrency: item.purchaseCurrency,
    salePrice,
    moq: item.supplierOffer?.moq ?? null,
    ctnQty: item.supplierOffer?.ctnQty ?? null,
    quantity: item.quantity,
    remark: item.remark,
  };
}

function buildCreatedAtFilter(dateFrom?: string, dateTo?: string): Prisma.DateTimeFilter<"Quote"> | null {
  const from = parseDateStart(dateFrom);
  const to = parseDateEnd(dateTo);
  if (!from && !to) {
    return null;
  }

  return {
    ...(from ? { gte: from } : {}),
    ...(to ? { lte: to } : {}),
  };
}

function parseDateStart(value?: string): Date | null {
  const parts = parseDateParts(value);
  return parts ? new Date(parts.year, parts.month - 1, parts.day, 0, 0, 0, 0) : null;
}

function parseDateEnd(value?: string): Date | null {
  const parts = parseDateParts(value);
  return parts ? new Date(parts.year, parts.month - 1, parts.day, 23, 59, 59, 999) : null;
}

function parseDateParts(value?: string): { year: number; month: number; day: number } | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) {
    return null;
  }
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}
