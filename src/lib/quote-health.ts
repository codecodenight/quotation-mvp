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
  issues: string[];
};

export type QuoteProductHealth = {
  productIssues: string[];
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

export function checkQuoteItemHealth(product: QuoteHealthProductInput, offer: QuoteHealthOfferInput): string[] {
  return [...buildProductIssues(product), ...buildOfferIssues(offer)];
}

function buildProductIssues(product: QuoteHealthProductInput): string[] {
  const issues: string[] = [];
  const detailText = (product.remark || product.productName || "").trim();
  const modelNo = product.modelNo?.trim() ?? "";

  if (!detailText || (modelNo && detailText.toLowerCase() === modelNo.toLowerCase())) {
    issues.push("Product Details 过短或重复");
  }
  if (!product.size?.trim() && !product.hasSizeParam) {
    issues.push("缺 Size");
  }

  return issues;
}

function buildOfferIssues(offer: QuoteHealthOfferInput): string[] {
  const issues: string[] = [];

  if (!isPositiveNumber(offer.purchasePrice)) {
    issues.push("采购价异常");
  }
  if (offer.moq?.trim() && !/^[\d,]+/.test(offer.moq.trim())) {
    issues.push("MOQ 可能不是数量");
  }
  if (!offer.ctnQty?.trim()) {
    issues.push("缺 CTN Qty");
  }
  if (!offer.ctnLength?.trim() || !offer.ctnWidth?.trim() || !offer.ctnHeight?.trim()) {
    issues.push("缺 CTN L/W/H");
  }

  return issues;
}

function isPositiveNumber(value: string | number | { toString(): string }): boolean {
  const parsed = Number(value.toString());
  return Number.isFinite(parsed) && parsed > 0;
}
