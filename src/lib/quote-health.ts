export type QuoteHealthOfferInput = {
  id: string;
  factoryName: string;
  purchasePrice: string | number | { toString(): string };
  moq: string | null;
  ctnQty: string | null;
  ctnLength: string | null;
  ctnWidth: string | null;
  ctnHeight: string | null;
};

export type WarningTier = "customer" | "quote" | "logistics";

export type CategorizedWarning = {
  message: string;
  tier: WarningTier;
};

export type QuoteHealthProductInput = {
  productName: string;
  modelNo: string | null;
  remark: string | null;
  size: string | null;
  hasSizeParam?: boolean;
  supplierOffers: QuoteHealthOfferInput[];
};

export type QuoteOfferHealth = {
  offerId: string;
  factoryName: string;
  issues: CategorizedWarning[];
};

export type QuoteProductHealth = {
  productIssues: CategorizedWarning[];
  offerIssues: QuoteOfferHealth[];
  totalIssueCount: number;
};

export function buildQuoteHealth(product: QuoteHealthProductInput): QuoteProductHealth {
  const productIssues = buildProductIssues(product);
  const offerIssues = product.supplierOffers
    .map((offer) => ({
      offerId: offer.id,
      factoryName: offer.factoryName,
      issues: buildOfferIssues(offer),
    }))
    .filter((offer) => offer.issues.length > 0);

  return {
    productIssues,
    offerIssues,
    totalIssueCount: productIssues.length + offerIssues.reduce((sum, offer) => sum + offer.issues.length, 0),
  };
}

export function checkQuoteItemHealth(
  product: QuoteHealthProductInput,
  offer: QuoteHealthOfferInput,
): CategorizedWarning[] {
  return [...buildProductIssues(product), ...buildOfferIssues(offer)];
}

function buildProductIssues(product: QuoteHealthProductInput): CategorizedWarning[] {
  const issues: CategorizedWarning[] = [];
  const detailText = (product.remark || product.productName || "").trim();
  const modelNo = product.modelNo?.trim() ?? "";

  if (!detailText || (modelNo && detailText.toLowerCase() === modelNo.toLowerCase())) {
    issues.push(warning("Product Details 过短或重复", "customer"));
  }
  if (!product.size?.trim() && !product.hasSizeParam) {
    issues.push(warning("缺 Size", "quote"));
  }

  return issues;
}

function buildOfferIssues(offer: QuoteHealthOfferInput): CategorizedWarning[] {
  const issues: CategorizedWarning[] = [];

  if (!isPositiveNumber(offer.purchasePrice)) {
    issues.push(warning("采购价异常", "quote"));
  }
  if (offer.moq?.trim() && !/^[\d,]+/.test(offer.moq.trim())) {
    issues.push(warning("MOQ 可能不是数量", "quote"));
  }
  if (!offer.ctnQty?.trim()) {
    issues.push(warning("缺 CTN Qty", "logistics"));
  }
  if (!offer.ctnLength?.trim() || !offer.ctnWidth?.trim() || !offer.ctnHeight?.trim()) {
    issues.push(warning("缺 CTN L/W/H", "logistics"));
  }

  return issues;
}

function warning(message: string, tier: WarningTier): CategorizedWarning {
  return { message, tier };
}

function isPositiveNumber(value: string | number | { toString(): string }): boolean {
  const parsed = Number(value.toString());
  return Number.isFinite(parsed) && parsed > 0;
}
