export type MatchableProduct = {
  id: string;
  modelNo: string | null;
  productName: string;
  category: string | null;
};

export type MatchCandidate = {
  product: MatchableProduct;
  score: number;
  reason: "exact" | "contains" | "prefix" | "watts";
};

const MIN_CANDIDATE_SCORE = 40;
const MAX_CANDIDATES = 3;
const MIN_MEANINGFUL_LENGTH = 4;

export function normalizeModel(value: string | null | undefined): string {
  if (!value) {
    return "";
  }
  return value
    .normalize("NFC")
    .toUpperCase()
    .replace(/[^A-Z0-9一-鿿]/g, "");
}

export function extractWatts(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const match = value.normalize("NFC").match(/(\d+(?:\.\d+)?)\s*W(?![A-Za-z])/i);
  return match ? match[1] : null;
}

export function scoreCandidate(
  rawModel: string,
  rawDescription: string | null,
  product: MatchableProduct,
): MatchCandidate | null {
  const normalizedRaw = normalizeModel(rawModel);
  if (!normalizedRaw) {
    return null;
  }
  const normalizedProduct = normalizeModel(product.modelNo) || normalizeModel(product.productName);
  if (!normalizedProduct) {
    return null;
  }

  if (normalizedRaw === normalizedProduct) {
    return { product, score: 100, reason: "exact" };
  }

  if (normalizedRaw.length >= MIN_MEANINGFUL_LENGTH && normalizedProduct.length >= MIN_MEANINGFUL_LENGTH) {
    if (normalizedProduct.includes(normalizedRaw) || normalizedRaw.includes(normalizedProduct)) {
      const shorter = Math.min(normalizedRaw.length, normalizedProduct.length);
      const longer = Math.max(normalizedRaw.length, normalizedProduct.length);
      return { product, score: Math.round(70 + (shorter / longer) * 20), reason: "contains" };
    }

    const prefixLength = commonPrefixLength(normalizedRaw, normalizedProduct);
    if (prefixLength >= MIN_MEANINGFUL_LENGTH) {
      const score = Math.min(40 + prefixLength * 4, 69);
      return { product, score, reason: "prefix" };
    }
  }

  const rawWatts = extractWatts(rawModel) ?? extractWatts(rawDescription);
  const productWatts = extractWatts(product.modelNo) ?? extractWatts(product.productName);
  if (rawWatts && productWatts && rawWatts === productWatts && sharesCategoryHint(rawDescription, product.category)) {
    return { product, score: 40, reason: "watts" };
  }

  return null;
}

export function findCandidates(
  rawModel: string | null,
  rawDescription: string | null,
  products: MatchableProduct[],
): MatchCandidate[] {
  if (!rawModel?.trim()) {
    return [];
  }
  const candidates: MatchCandidate[] = [];
  for (const product of products) {
    const candidate = scoreCandidate(rawModel, rawDescription, product);
    if (candidate && candidate.score >= MIN_CANDIDATE_SCORE) {
      candidates.push(candidate);
    }
  }
  candidates.sort((left, right) => right.score - left.score);
  return candidates.slice(0, MAX_CANDIDATES);
}

function commonPrefixLength(left: string, right: string): number {
  const limit = Math.min(left.length, right.length);
  let index = 0;
  while (index < limit && left[index] === right[index]) {
    index += 1;
  }
  return index;
}

function sharesCategoryHint(rawDescription: string | null, category: string | null): boolean {
  if (!rawDescription || !category) {
    return false;
  }
  const normalizedDescription = rawDescription.normalize("NFC");
  return category
    .normalize("NFC")
    .split(/[/\s]+/)
    .some((token) => token.length >= 2 && normalizedDescription.includes(token));
}
