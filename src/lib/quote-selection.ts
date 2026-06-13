import type { ProductParamDisplay } from "@/lib/product-param-display";
import { rankOffers } from "@/lib/offer-ranking";

export type QuoteSelectionOffer = {
  id: string;
  factoryName: string;
  purchasePrice: string;
  currency: string;
  moq: string | null;
  ctnQty: string | null;
  ctnLength: string | null;
  ctnWidth: string | null;
  ctnHeight: string | null;
  leadTime?: string | null;
  remark?: string | null;
  priceUpdatedAt?: string | null;
};

export type QuoteSelectionProduct = {
  id: string;
  productName: string;
  modelNo: string | null;
  material: string | null;
  size: string | null;
  remark: string | null;
  supplierOffers: QuoteSelectionOffer[];
  displayParams?: ProductParamDisplay[];
};

export type SelectedQuoteItem = {
  product: QuoteSelectionProduct;
  selectedOfferId: string;
  quantity: string;
  remark: string;
};

export type QuoteFormDataInput = {
  customerName: string;
  profitMargin: string;
  currency: string;
  exchangeRate: string;
  customerMode: boolean;
  selectedItems: Map<string, SelectedQuoteItem>;
};

export type QuoteDraftState = {
  selectedItems: Map<string, SelectedQuoteItem>;
  customerName: string;
  profitMargin: string;
  currency: string;
  exchangeRate: string;
  lastEditableExchangeRate: string;
  customerMode: boolean;
};

export type ReusableQuoteItemInput = {
  productId: string;
  productName: string;
  modelNo: string | null;
  supplierOfferId: string | null;
  quantity: number;
  remark: string | null;
};

export type ReusableQuoteDraftInput = {
  quote: {
    customerName: string;
    profitMargin: string | number | { toString(): string };
    currency: string;
    exchangeRate: string | number | { toString(): string } | null;
  };
  currentProducts: QuoteSelectionProduct[];
  items: ReusableQuoteItemInput[];
};

export type ReusableQuoteDraftResult = QuoteDraftState & {
  warnings: string[];
  skippedItems: Array<{
    label: string;
    reason: string;
  }>;
};

export type SerializedReusableQuoteDraftResult = Omit<ReusableQuoteDraftResult, "selectedItems"> & {
  selectedItems: Array<[string, SelectedQuoteItem]>;
};

export function createDefaultQuoteDraft(): QuoteDraftState {
  return {
    selectedItems: new Map(),
    customerName: "",
    profitMargin: "0.2",
    currency: "USD",
    exchangeRate: "7.2",
    lastEditableExchangeRate: "7.2",
    customerMode: true,
  };
}

export function buildReusableQuoteDraft(input: ReusableQuoteDraftInput): ReusableQuoteDraftResult {
  const productById = new Map(input.currentProducts.map((product) => [product.id, product]));
  const productByModelNo = new Map(
    input.currentProducts
      .filter((product) => product.modelNo && product.modelNo.trim().length > 0)
      .map((product) => [normalizeModelNo(product.modelNo), product]),
  );
  const selectedItems = new Map<string, SelectedQuoteItem>();
  const warnings: string[] = [];
  const skippedItems: ReusableQuoteDraftResult["skippedItems"] = [];

  for (const item of input.items) {
    const product = productById.get(item.productId) ?? productByModelNo.get(normalizeModelNo(item.modelNo));
    const label = item.productName || item.modelNo || item.productId;

    if (!product) {
      skippedItems.push({ label, reason: "产品已不在库中，已跳过。" });
      continue;
    }

    if (product.supplierOffers.length === 0) {
      skippedItems.push({ label: product.productName, reason: "当前产品没有可用供应商报价，已跳过。" });
      continue;
    }

    const recommendedOfferId = getRecommendedOfferId(product);
    const currentOfferStillExists = product.supplierOffers.some((offer) => offer.id === item.supplierOfferId);
    const selectedOfferId = currentOfferStillExists ? item.supplierOfferId ?? recommendedOfferId : recommendedOfferId;
    if (item.supplierOfferId && !currentOfferStillExists) {
      warnings.push(`${product.productName}：原供应商报价已变更，已改用当前第一条报价。`);
    }

    selectedItems.set(product.id, {
      product,
      selectedOfferId,
      quantity: String(item.quantity),
      remark: item.remark ?? "",
    });
  }

  const exchangeRate = input.quote.exchangeRate === null ? "" : input.quote.exchangeRate.toString();
  return {
    selectedItems,
    customerName: input.quote.customerName,
    profitMargin: input.quote.profitMargin.toString(),
    currency: input.quote.currency,
    exchangeRate,
    lastEditableExchangeRate: exchangeRate || "7.2",
    customerMode: true,
    warnings,
    skippedItems,
  };
}

export function serializeReusableQuoteDraft(
  result: ReusableQuoteDraftResult,
): SerializedReusableQuoteDraftResult {
  return {
    ...result,
    selectedItems: Array.from(result.selectedItems.entries()),
  };
}

export function createSelectedQuoteItem(product: QuoteSelectionProduct): SelectedQuoteItem {
  return {
    product,
    selectedOfferId: getRecommendedOfferId(product),
    quantity: "1",
    remark: "",
  };
}

export function resolveSelectedOffer(item: SelectedQuoteItem): QuoteSelectionOffer | null {
  return item.product.supplierOffers.find((offer) => offer.id === item.selectedOfferId) ?? null;
}

export function allSelectedOffersUseCurrency(
  selectedItems: Map<string, SelectedQuoteItem>,
  currency: string,
): boolean {
  if (selectedItems.size === 0) {
    return false;
  }

  const normalizedCurrency = normalizeCurrency(currency);
  return Array.from(selectedItems.values()).every((item) => {
    const offer = resolveSelectedOffer(item);
    return offer !== null && normalizeCurrency(offer.currency) === normalizedCurrency;
  });
}

export function buildQuoteFormData(input: QuoteFormDataInput): FormData {
  const formData = new FormData();
  formData.set("customerName", input.customerName);
  formData.set("profitMargin", input.profitMargin);
  formData.set("currency", input.currency);
  formData.set("exchangeRate", input.exchangeRate);
  if (input.customerMode) {
    formData.set("customerMode", "on");
  }

  for (const [productId, item] of input.selectedItems) {
    formData.append("productIds", productId);
    formData.set(`supplierOfferId:${productId}`, item.selectedOfferId);
    formData.set(`quantity:${productId}`, item.quantity);
    formData.set(`remark:${productId}`, item.remark);
  }

  return formData;
}

function normalizeCurrency(value: string): string {
  return value.trim().toUpperCase();
}

function normalizeModelNo(value: string | null): string {
  return value?.trim().toUpperCase() ?? "";
}

function getRecommendedOfferId(product: QuoteSelectionProduct): string {
  const ranked = rankOffers(product.supplierOffers);
  return ranked[0]?.offerId ?? product.supplierOffers[0]?.id ?? "";
}
