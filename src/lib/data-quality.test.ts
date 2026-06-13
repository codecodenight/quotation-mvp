import { describe, expect, test } from "vitest";

import { buildDataQualitySummary } from "./data-quality";

describe("buildDataQualitySummary", () => {
  test("merges category quality rows and computes totals", () => {
    const summary = buildDataQualitySummary({
      productRows: [
        { category: "球泡", product_count: 10n, image_count: 8n },
        { category: "灯管", product_count: 5n, image_count: 1n },
      ],
      offerRows: [
        { category: "球泡", offer_count: 20n, ctn_count: 10n },
        { category: "灯管", offer_count: 2n, ctn_count: 0n },
      ],
      paramRows: [
        { category: "球泡", param_product_count: 7n },
        { category: "灯管", param_product_count: 1n },
      ],
      sizeRows: [{ category: "球泡", size_count: 9n }],
    });

    expect(summary.categories).toEqual([
      {
        category: "球泡",
        productCount: 10,
        offerCount: 20,
        imageCount: 8,
        paramProductCount: 7,
        sizeProductCount: 9,
        ctnOfferCount: 10,
      },
      {
        category: "灯管",
        productCount: 5,
        offerCount: 2,
        imageCount: 1,
        paramProductCount: 1,
        sizeProductCount: 0,
        ctnOfferCount: 0,
      },
    ]);
    expect(summary.totals).toEqual({
      category: "全部",
      productCount: 15,
      offerCount: 22,
      imageCount: 9,
      paramProductCount: 8,
      sizeProductCount: 9,
      ctnOfferCount: 10,
    });
  });

  test("keeps categories that only appear in non-product rows", () => {
    const summary = buildDataQualitySummary({
      productRows: [],
      offerRows: [{ category: "未分类", offer_count: 3n, ctn_count: 1n }],
      paramRows: [{ category: "未分类", param_product_count: 2n }],
      sizeRows: [],
    });

    expect(summary.categories).toEqual([
      {
        category: "未分类",
        productCount: 0,
        offerCount: 3,
        imageCount: 0,
        paramProductCount: 2,
        sizeProductCount: 0,
        ctnOfferCount: 1,
      },
    ]);
  });
});
