import { describe, expect, test } from "vitest";

import { rankOffers, type RankableOffer } from "./offer-ranking";

const baseOffer: RankableOffer = {
  id: "offer-1",
  factoryName: "Factory A",
  purchasePrice: "10",
  currency: "RMB",
  moq: null,
  ctnQty: null,
  ctnLength: null,
  ctnWidth: null,
  ctnHeight: null,
  leadTime: null,
  remark: null,
  priceUpdatedAt: null,
};

function offer(input: Partial<RankableOffer> & { id: string; purchasePrice: string }): RankableOffer {
  return {
    ...baseOffer,
    ...input,
  };
}

describe("rankOffers", () => {
  test("marks a single offer as recommended", () => {
    const [score] = rankOffers([offer({ id: "single", purchasePrice: "10" })]);

    expect(score).toMatchObject({
      offerId: "single",
      priceRank: 30,
      badges: expect.arrayContaining(["lowest-price", "most-complete", "recommended"]),
    });
  });

  test("scores completeness, price rank, recency, and badge winners", () => {
    const scores = rankOffers([
      offer({
        id: "cheap",
        purchasePrice: "8",
        moq: "100",
        priceUpdatedAt: "2026-06-01",
      }),
      offer({
        id: "complete",
        purchasePrice: "12",
        moq: "100",
        ctnQty: "20",
        ctnLength: "50",
        ctnWidth: "40",
        ctnHeight: "30",
        leadTime: "15 days",
        remark: "full data",
        priceUpdatedAt: "2026-04-01",
      }),
      offer({
        id: "middle",
        purchasePrice: "10",
        ctnQty: "10",
        priceUpdatedAt: "2026-05-01",
      }),
    ]);

    expect(scores.map((score) => score.offerId)).toEqual(["complete", "cheap", "middle"]);
    expect(scores.find((score) => score.offerId === "cheap")?.badges).toContain("lowest-price");
    expect(scores.find((score) => score.offerId === "complete")?.badges).toEqual(
      expect.arrayContaining(["most-complete", "recommended"]),
    );
    expect(scores.find((score) => score.offerId === "cheap")?.badges).toContain("newest");
  });

  test("pushes zero prices behind valid prices", () => {
    const scores = rankOffers([
      offer({ id: "zero", purchasePrice: "0", priceUpdatedAt: "2026-06-01" }),
      offer({ id: "valid", purchasePrice: "5" }),
    ]);

    expect(scores.map((score) => score.offerId)).toEqual(["valid", "zero"]);
    expect(scores.find((score) => score.offerId === "zero")?.priceRank).toBe(0);
    expect(scores.find((score) => score.offerId === "valid")?.badges).toContain("lowest-price");
  });

  test("ignores missing or invalid priceUpdatedAt while keeping other scores", () => {
    const scores = rankOffers([
      offer({ id: "invalid-date", purchasePrice: "8", priceUpdatedAt: "not-a-date" }),
      offer({ id: "no-date", purchasePrice: "10" }),
    ]);

    expect(scores.find((score) => score.offerId === "invalid-date")?.recency).toBe(0);
    expect(scores.find((score) => score.offerId === "no-date")?.recency).toBe(0);
    expect(scores.find((score) => score.offerId === "invalid-date")?.badges).not.toContain("newest");
  });

  test("sorts by price when completeness is tied", () => {
    const scores = rankOffers([
      offer({ id: "third", purchasePrice: "30", moq: "100" }),
      offer({ id: "first", purchasePrice: "10", moq: "100" }),
      offer({ id: "second", purchasePrice: "20", moq: "100" }),
    ]);

    expect(scores.map((score) => score.offerId)).toEqual(["first", "second", "third"]);
    expect(scores.map((score) => score.priceRank)).toEqual([30, 20, 10]);
  });
});
