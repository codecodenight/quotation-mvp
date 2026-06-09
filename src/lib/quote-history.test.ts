import { describe, expect, test } from "vitest";

import {
  buildQuoteSearchWhere,
  serializeQuoteDetail,
  serializeQuoteSearchResult,
} from "./quote-history";

describe("quote history helpers", () => {
  test("builds optional quote search filters", () => {
    expect(
      buildQuoteSearchWhere({
        customerName: " 客户报价测试 ",
        dateFrom: "2026-06-01",
        dateTo: "2026-06-08",
        currency: "USD",
        productKeyword: "A60",
      }),
    ).toEqual({
      AND: [
        { customerName: { contains: "客户报价测试" } },
        {
          createdAt: {
            gte: new Date(2026, 5, 1, 0, 0, 0, 0),
            lte: new Date(2026, 5, 8, 23, 59, 59, 999),
          },
        },
        { currency: "USD" },
        {
          items: {
            some: {
              product: {
                OR: [{ modelNo: { contains: "A60" } }, { productName: { contains: "A60" } }],
              },
            },
          },
        },
      ],
    });
  });

  test("ignores empty filters and all currency", () => {
    expect(
      buildQuoteSearchWhere({
        customerName: "",
        currency: "all",
        productKeyword: " ",
      }),
    ).toEqual({});
  });

  test("serializes quote search rows without item details", () => {
    const createdAt = new Date("2026-06-08T08:30:00.000Z");

    expect(
      serializeQuoteSearchResult({
        id: "quote-1",
        customerName: "客户报价测试",
        currency: "USD",
        profitMargin: { toString: () => "0.2" },
        exchangeRate: { toString: () => "7.2" },
        quoteFilePath: "/tmp/quote.xlsx",
        createdAt,
        _count: { items: 3 },
      }),
    ).toEqual({
      id: "quote-1",
      customerName: "客户报价测试",
      currency: "USD",
      profitMargin: 0.2,
      exchangeRate: 7.2,
      createdAt: createdAt.toISOString(),
      itemCount: 3,
      filePath: "/tmp/quote.xlsx",
    });
  });

  test("serializes quote detail using sale price snapshots and current product details", () => {
    const createdAt = new Date("2026-06-08T08:30:00.000Z");

    const detail = serializeQuoteDetail(
      {
        id: "quote-1",
        customerName: "客户报价测试",
        currency: "USD",
        profitMargin: { toString: () => "0.2" },
        exchangeRate: { toString: () => "7.2" },
        quoteFilePath: "/tmp/quote.xlsx",
        createdAt,
        items: [
          {
            purchasePrice: { toString: () => "13.34" },
            purchaseCurrency: "RMB",
            salePrice: { toString: () => "2.22" },
            quantity: 1,
            remark: "客户备注",
            product: {
              productName: "Tri-proof Light",
              modelNo: "WP-B-112",
              material: "PC",
              size: "1X1200mm",
              remark: "Power: 24W",
            },
            supplierOffer: {
              moq: "1000/色",
              ctnQty: "12",
            },
          },
        ],
      },
      true,
    );

    expect(detail).toMatchObject({
      id: "quote-1",
      customerName: "客户报价测试",
      currency: "USD",
      profitMargin: 0.2,
      exchangeRate: 7.2,
      createdAt: createdAt.toISOString(),
      filePath: "/tmp/quote.xlsx",
      fileExists: true,
      items: [
        {
          modelNo: "WP-B-112",
          productName: "Tri-proof Light",
          purchasePrice: 13.34,
          purchaseCurrency: "RMB",
          salePrice: 2.22,
          moq: "1000/色",
          ctnQty: "12",
          quantity: 1,
          remark: "客户备注",
        },
      ],
    });
    expect(detail.items[0].productDetails).toBe("Power: 24W\nSize: 1X1200mm");
  });
});
