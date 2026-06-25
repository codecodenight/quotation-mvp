export type CategoryPriceInput = {
  category: string;
  price: number;
};

export type CategoryIqrStats = {
  category: string;
  count: number;
  q1: number;
  q3: number;
  iqr: number;
  lowerBound: number;
  upperBound: number;
};

export function calculateCategoryIqrStats(prices: CategoryPriceInput[]): Map<string, CategoryIqrStats> {
  const groups = new Map<string, number[]>();
  for (const row of prices) {
    if (!Number.isFinite(row.price)) continue;
    const values = groups.get(row.category) ?? [];
    values.push(row.price);
    groups.set(row.category, values);
  }

  const stats = new Map<string, CategoryIqrStats>();
  for (const [category, values] of groups.entries()) {
    values.sort((left, right) => left - right);
    if (values.length === 0) continue;

    const q1 = percentile(values, 0.25);
    const q3 = percentile(values, 0.75);
    const iqr = q3 - q1;
    stats.set(category, {
      category,
      count: values.length,
      q1,
      q3,
      iqr,
      lowerBound: q1 - 3 * iqr,
      upperBound: q3 + 3 * iqr,
    });
  }
  return stats;
}

export function getIqrOutlierFlag(price: number, stats: CategoryIqrStats): "outlier_low" | "outlier_high" | null {
  if (!Number.isFinite(price) || stats.iqr <= 0) {
    return null;
  }
  if (price < stats.lowerBound) {
    return "outlier_low";
  }
  if (price > stats.upperBound) {
    return "outlier_high";
  }
  return null;
}

function percentile(sortedValues: number[], ratio: number): number {
  if (sortedValues.length === 1) {
    return sortedValues[0];
  }

  const index = (sortedValues.length - 1) * ratio;
  const lowerIndex = Math.floor(index);
  const upperIndex = Math.ceil(index);
  if (lowerIndex === upperIndex) {
    return sortedValues[lowerIndex];
  }

  const lower = sortedValues[lowerIndex];
  const upper = sortedValues[upperIndex];
  return lower + (upper - lower) * (index - lowerIndex);
}
