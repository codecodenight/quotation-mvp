import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { buildQuoteSearchWhere, serializeQuoteSearchResult } from "@/lib/quote-history";
import { QuotesClient, type QuoteFilters, type QuoteHistoryRow, type QuoteProductOption } from "./quotes-client";

type QuoteProductResult = Prisma.ProductGetPayload<{
  include: {
    supplierOffers: true;
  };
}>;

type QuoteHistoryResult = Prisma.QuoteGetPayload<{
  include: {
    _count: {
      select: {
        items: true;
      };
    };
  };
}>;

type QuotesPageProps = {
  searchParams: Promise<{
    search?: string;
    factory?: string;
    error?: string;
  }>;
};

export default async function QuotesPage({ searchParams }: QuotesPageProps) {
  const params = await searchParams;
  const filters: QuoteFilters = {
    search: params.search?.trim() ?? "",
    factory: params.factory?.trim() ?? "",
    error: params.error?.trim() ?? "",
  };
  const shouldLoadProducts = filters.search.length > 0 || filters.factory.length > 0;

  const [products, quotes] = await Promise.all([
    shouldLoadProducts
      ? prisma.product.findMany({
          where: buildProductWhere(filters),
          include: {
            supplierOffers: {
              orderBy: [{ factoryName: "asc" }, { createdAt: "desc" }],
              take: 20,
            },
          },
          orderBy: [{ productName: "asc" }],
          take: 50,
        })
      : Promise.resolve([]),
    prisma.quote.findMany({
      include: {
        _count: {
          select: { items: true },
        },
      },
      where: buildQuoteSearchWhere({}),
      orderBy: [{ createdAt: "desc" }],
      take: 50,
    }),
  ]);

  return (
    <QuotesClient
      filters={filters}
      shouldLoadProducts={shouldLoadProducts}
      products={products.map(serializeProduct)}
      quotes={quotes.map(serializeQuote)}
    />
  );
}

function serializeProduct(product: QuoteProductResult): QuoteProductOption {
  return {
    id: product.id,
    productName: product.productName,
    modelNo: product.modelNo,
    material: product.material,
    size: product.size,
    remark: product.remark,
    supplierOffers: product.supplierOffers.map((offer) => ({
      id: offer.id,
      factoryName: offer.factoryName,
      purchasePrice: offer.purchasePrice.toString(),
      currency: offer.currency,
      moq: offer.moq,
      ctnQty: offer.ctnQty,
      ctnLength: offer.ctnLength,
      ctnWidth: offer.ctnWidth,
      ctnHeight: offer.ctnHeight,
    })),
  };
}

function serializeQuote(quote: QuoteHistoryResult): QuoteHistoryRow {
  return serializeQuoteSearchResult(quote);
}

function buildProductWhere(filters: { search: string; factory: string }): Prisma.ProductWhereInput {
  const and: Prisma.ProductWhereInput[] = [];

  if (filters.search) {
    and.push({
      OR: [
        { productName: { contains: filters.search } },
        { modelNo: { contains: filters.search } },
        { category: { contains: filters.search } },
      ],
    });
  }

  if (filters.factory) {
    and.push({ supplierOffers: { some: { factoryName: { contains: filters.factory } } } });
  }

  return and.length > 0 ? { AND: and } : {};
}
