import { describe, expect, test } from "vitest";

import { upsertSupplierOffer, type SupplierOfferUpsertClient } from "./supplier-offer-upsert";

type FakeOffer = {
  id: string;
  productId: string;
  factoryName: string;
  purchasePrice: { toString(): string };
  currency: string;
  moq: string | null;
  ctnQty: string | null;
  ctnLength: string | null;
  ctnWidth: string | null;
  ctnHeight: string | null;
  sourceFileId: string | null;
};

function decimal(value: string): { toString(): string } {
  return { toString: () => value };
}

function createFakeClient(initialOffers: FakeOffer[] = []): SupplierOfferUpsertClient & {
  offers: FakeOffer[];
  histories: unknown[];
} {
  const offers = [...initialOffers];
  const histories: unknown[] = [];

  return {
    offers,
    histories,
    supplierOffer: {
      findFirst: async ({ where }) =>
        offers.find((offer) => offer.productId === where.productId && offer.factoryName === where.factoryName) ?? null,
      create: async ({ data }) => {
        const offer = {
          id: `offer-${offers.length + 1}`,
          productId: data.productId,
          factoryName: data.factoryName,
          purchasePrice: decimal(String(data.purchasePrice)),
          currency: data.currency,
          moq: data.moq ?? null,
          ctnQty: data.ctnQty ?? null,
          ctnLength: data.ctnLength ?? null,
          ctnWidth: data.ctnWidth ?? null,
          ctnHeight: data.ctnHeight ?? null,
          sourceFileId: data.sourceFileId ?? null,
        };
        offers.push(offer);
        return { id: offer.id };
      },
      update: async ({ where, data }) => {
        const offer = offers.find((entry) => entry.id === where.id);
        if (!offer) {
          throw new Error("missing fake offer");
        }
        if (data.purchasePrice !== undefined) {
          offer.purchasePrice = decimal(String(data.purchasePrice));
        }
        if (data.currency !== undefined) {
          offer.currency = data.currency;
        }
        if (data.moq !== undefined) {
          offer.moq = data.moq;
        }
        if (data.ctnQty !== undefined) {
          offer.ctnQty = data.ctnQty;
        }
        if (data.ctnLength !== undefined) {
          offer.ctnLength = data.ctnLength;
        }
        if (data.ctnWidth !== undefined) {
          offer.ctnWidth = data.ctnWidth;
        }
        if (data.ctnHeight !== undefined) {
          offer.ctnHeight = data.ctnHeight;
        }
        if (data.sourceFileId !== undefined) {
          offer.sourceFileId = data.sourceFileId;
        }
        return { id: offer.id };
      },
    },
    priceHistory: {
      create: async ({ data }) => {
        histories.push(data);
        return { id: `history-${histories.length}` };
      },
    },
  };
}

const baseInput = {
  productId: "product-1",
  factoryName: "汇孚",
  purchasePrice: "10.00",
  currency: "RMB",
  moq: null,
  ctnQty: null,
  ctnLength: null,
  ctnWidth: null,
  ctnHeight: null,
  sourceFileId: "file-new",
  remark: null,
};

describe("upsertSupplierOffer", () => {
  test("creates a new offer without price history when no offer exists", async () => {
    const tx = createFakeClient();

    const result = await upsertSupplierOffer(tx, baseInput, new Date("2026-06-09T00:00:00Z"));

    expect(result.status).toBe("created");
    expect(tx.offers).toHaveLength(1);
    expect(tx.offers[0].purchasePrice.toString()).toBe("10.00");
    expect(tx.histories).toHaveLength(0);
  });

  test("skips an existing offer with the same price and no new supplemental data", async () => {
    const tx = createFakeClient([
      {
        id: "offer-1",
        productId: "product-1",
        factoryName: "汇孚",
        purchasePrice: decimal("10"),
        currency: "RMB",
        moq: "1000",
        ctnQty: "100",
        ctnLength: "52",
        ctnWidth: "49",
        ctnHeight: "27",
        sourceFileId: "file-old",
      },
    ]);

    const result = await upsertSupplierOffer(tx, baseInput, new Date("2026-06-09T00:00:00Z"));

    expect(result.status).toBe("skipped");
    expect(tx.offers[0].sourceFileId).toBe("file-old");
    expect(tx.histories).toHaveLength(0);
  });

  test("updates price and writes price history when price changes", async () => {
    const tx = createFakeClient([
      {
        id: "offer-1",
        productId: "product-1",
        factoryName: "汇孚",
        purchasePrice: decimal("10"),
        currency: "RMB",
        moq: null,
        ctnQty: null,
        ctnLength: null,
        ctnWidth: null,
        ctnHeight: null,
        sourceFileId: "file-old",
      },
    ]);

    const result = await upsertSupplierOffer(
      tx,
      { ...baseInput, purchasePrice: "12.50" },
      new Date("2026-06-09T00:00:00Z"),
    );

    expect(result.status).toBe("updated");
    expect(result.priceChanged).toBe(true);
    expect(tx.offers[0].purchasePrice.toString()).toBe("12.50");
    expect(tx.offers[0].sourceFileId).toBe("file-new");
    expect(tx.histories).toHaveLength(1);
    expect(tx.histories[0]).toMatchObject({
      supplierOfferId: "offer-1",
      newPrice: "12.50",
      oldSourceFileId: "file-old",
      newSourceFileId: "file-new",
    });
    expect((tx.histories[0] as { oldPrice: { toString(): string } }).oldPrice.toString()).toBe("10");
  });

  test("supplements missing MOQ and CTN data without writing price history", async () => {
    const tx = createFakeClient([
      {
        id: "offer-1",
        productId: "product-1",
        factoryName: "汇孚",
        purchasePrice: decimal("10"),
        currency: "RMB",
        moq: null,
        ctnQty: null,
        ctnLength: null,
        ctnWidth: null,
        ctnHeight: null,
        sourceFileId: "file-old",
      },
    ]);

    const result = await upsertSupplierOffer(tx, {
      ...baseInput,
      moq: "1000",
      ctnQty: "100",
      ctnLength: "52.3",
      ctnWidth: "49.5",
      ctnHeight: "27.4",
    });

    expect(result.status).toBe("updated");
    expect(result.supplemented).toBe(true);
    expect(tx.offers[0]).toMatchObject({
      moq: "1000",
      ctnQty: "100",
      ctnLength: "52.3",
      ctnWidth: "49.5",
      ctnHeight: "27.4",
      sourceFileId: "file-old",
    });
    expect(tx.histories).toHaveLength(0);
  });

  test("does not overwrite existing MOQ or CTN data with different incoming values", async () => {
    const tx = createFakeClient([
      {
        id: "offer-1",
        productId: "product-1",
        factoryName: "汇孚",
        purchasePrice: decimal("10"),
        currency: "RMB",
        moq: "500",
        ctnQty: "50",
        ctnLength: "40",
        ctnWidth: "30",
        ctnHeight: "20",
        sourceFileId: "file-old",
      },
    ]);

    const result = await upsertSupplierOffer(tx, {
      ...baseInput,
      moq: "1000",
      ctnQty: "100",
      ctnLength: "52.3",
      ctnWidth: "49.5",
      ctnHeight: "27.4",
    });

    expect(result.status).toBe("skipped");
    expect(tx.offers[0]).toMatchObject({
      moq: "500",
      ctnQty: "50",
      ctnLength: "40",
      ctnWidth: "30",
      ctnHeight: "20",
      sourceFileId: "file-old",
    });
    expect(tx.histories).toHaveLength(0);
  });
});
