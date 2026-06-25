import { describe, expect, it } from "vitest";

import { calculateCategoryIqrStats, getIqrOutlierFlag } from "./price-anomaly-iqr";

describe("price anomaly IQR thresholds", () => {
  it("calculates quartiles and widened IQR thresholds per category", () => {
    const stats = calculateCategoryIqrStats([
      { category: "线条灯", price: 1 },
      { category: "线条灯", price: 2 },
      { category: "线条灯", price: 3 },
      { category: "线条灯", price: 4 },
      { category: "线条灯", price: 100 },
    ]).get("线条灯");

    expect(stats).toEqual({
      category: "线条灯",
      count: 5,
      q1: 2,
      q3: 4,
      iqr: 2,
      lowerBound: -4,
      upperBound: 10,
    });
  });

  it("uses wide IQR bounds so mixed unit categories do not systematically mark normal higher prices", () => {
    const stats = calculateCategoryIqrStats([
      ...Array.from({ length: 12 }, (_, index) => ({ category: "线条灯", price: 0.5 + index * 0.1 })),
      ...[10, 20, 50, 120, 300, 500, 800, 1000, 1200, 1500, 1800, 2000, 2200, 2500, 2800, 3200].map(
        (price) => ({ category: "线条灯", price }),
      ),
    ]).get("线条灯");

    expect(stats).toBeDefined();
    expect(getIqrOutlierFlag(1200, stats!)).toBeNull();
    expect(getIqrOutlierFlag(12000, stats!)).toBe("outlier_high");
  });
});
