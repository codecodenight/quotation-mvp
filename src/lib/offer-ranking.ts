export type RankableOffer = {
  id: string;
  factoryName: string;
  purchasePrice: string | { toString(): string };
  currency: string;
  moq: string | null;
  ctnQty: string | null;
  ctnLength: string | null;
  ctnWidth: string | null;
  ctnHeight: string | null;
  leadTime?: string | null;
  remark?: string | null;
  priceUpdatedAt?: Date | string | null;
};

export type OfferBadge = "lowest-price" | "most-complete" | "newest" | "recommended";

export type OfferScore = {
  offerId: string;
  total: number;
  completeness: number;
  priceRank: number;
  recency: number;
  badges: OfferBadge[];
};

export const OFFER_BADGE_META: Record<OfferBadge, { label: string; className: string }> = {
  "lowest-price": { label: "最低价", className: "border-green-200 bg-green-100 text-green-800" },
  "most-complete": { label: "资料全", className: "border-blue-200 bg-blue-100 text-blue-800" },
  newest: { label: "最新", className: "border-purple-200 bg-purple-100 text-purple-800" },
  recommended: { label: "推荐", className: "border-amber-200 bg-amber-100 text-amber-800" },
};

type ScoreDraft = OfferScore & {
  index: number;
  price: number | null;
  timestamp: number | null;
};

export function rankOffers(offers: RankableOffer[]): OfferScore[] {
  const drafts = offers.map((offer, index): ScoreDraft => {
    const completeness = scoreCompleteness(offer);
    const recency = scoreRecency(offer.priceUpdatedAt);
    return {
      offerId: offer.id,
      total: completeness + recency,
      completeness,
      priceRank: 0,
      recency,
      badges: [],
      index,
      price: parseOfferPrice(offer.purchasePrice),
      timestamp: parseTimestamp(offer.priceUpdatedAt),
    };
  });

  applyPriceRanks(drafts);
  for (const draft of drafts) {
    draft.total = draft.completeness + draft.priceRank + draft.recency;
  }

  applyBadges(drafts);

  return drafts
    .sort(compareScores)
    .map(({ offerId, total, completeness, priceRank, recency, badges }) => ({
      offerId,
      total,
      completeness,
      priceRank,
      recency,
      badges,
    }));
}

function scoreCompleteness(offer: RankableOffer): number {
  let score = 0;
  if (hasText(offer.moq)) {
    score += 8;
  }
  if (hasText(offer.ctnQty)) {
    score += 8;
  }
  if (hasText(offer.ctnLength) && hasText(offer.ctnWidth) && hasText(offer.ctnHeight)) {
    score += 8;
  }
  if (hasText(offer.leadTime)) {
    score += 8;
  }
  if (hasText(offer.remark)) {
    score += 8;
  }
  return score;
}

function applyPriceRanks(scores: ScoreDraft[]) {
  const validPrices = scores
    .filter((score) => score.price !== null && score.price > 0)
    .sort((left, right) => {
      const priceDiff = (left.price ?? Number.POSITIVE_INFINITY) - (right.price ?? Number.POSITIVE_INFINITY);
      return priceDiff !== 0 ? priceDiff : left.index - right.index;
    });

  validPrices.forEach((score, index) => {
    if (index === 0) {
      score.priceRank = 30;
    } else if (index === 1) {
      score.priceRank = 20;
    } else if (index === 2) {
      score.priceRank = 10;
    } else {
      score.priceRank = 0;
    }
  });
}

function scoreRecency(value: Date | string | null | undefined): number {
  const timestamp = parseTimestamp(value);
  if (timestamp === null) {
    return 0;
  }

  const ageInDays = (Date.now() - timestamp) / (24 * 60 * 60 * 1000);
  if (ageInDays <= 183) {
    return 20;
  }
  if (ageInDays <= 366) {
    return 10;
  }
  return 5;
}

function applyBadges(scores: ScoreDraft[]) {
  const lowestPrice = scores
    .filter((score) => score.price !== null && score.price > 0)
    .sort((left, right) => {
      const priceDiff = (left.price ?? Number.POSITIVE_INFINITY) - (right.price ?? Number.POSITIVE_INFINITY);
      return priceDiff !== 0 ? priceDiff : left.index - right.index;
    })[0];
  lowestPrice?.badges.push("lowest-price");

  const mostComplete = [...scores].sort((left, right) => {
    const completenessDiff = right.completeness - left.completeness;
    return completenessDiff !== 0 ? completenessDiff : compareScores(left, right);
  })[0];
  mostComplete?.badges.push("most-complete");

  const newest = scores
    .filter((score) => score.timestamp !== null)
    .sort((left, right) => {
      const timestampDiff = (right.timestamp ?? 0) - (left.timestamp ?? 0);
      return timestampDiff !== 0 ? timestampDiff : left.index - right.index;
    })[0];
  newest?.badges.push("newest");

  const recommended = [...scores].sort(compareScores)[0];
  recommended?.badges.push("recommended");
}

function compareScores(left: ScoreDraft, right: ScoreDraft): number {
  const totalDiff = right.total - left.total;
  if (totalDiff !== 0) {
    return totalDiff;
  }

  const priceRankDiff = right.priceRank - left.priceRank;
  if (priceRankDiff !== 0) {
    return priceRankDiff;
  }

  const completenessDiff = right.completeness - left.completeness;
  if (completenessDiff !== 0) {
    return completenessDiff;
  }

  const recencyDiff = right.recency - left.recency;
  if (recencyDiff !== 0) {
    return recencyDiff;
  }

  const leftPrice = left.price !== null && left.price > 0 ? left.price : Number.POSITIVE_INFINITY;
  const rightPrice = right.price !== null && right.price > 0 ? right.price : Number.POSITIVE_INFINITY;
  const priceDiff = leftPrice - rightPrice;
  if (priceDiff !== 0) {
    return priceDiff;
  }

  return left.index - right.index;
}

function parseOfferPrice(value: string | { toString(): string }): number | null {
  const parsed = Number.parseFloat(value.toString().replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseTimestamp(value: Date | string | null | undefined): number | null {
  if (value == null) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  const timestamp = date.getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function hasText(value: string | null | undefined): boolean {
  return value != null && value.trim().length > 0;
}
