import type { Prisma } from "@prisma/client";

import { getHistoricalQuotesByProductIds, type HistoricalCustomerQuote } from "@/lib/customer-quote-reference";
import { getCategoryOptions, getCctOptions, getIpOptions, getProductIdsByWattsRange, parseOptionalNonNegativeDecimal } from "@/lib/product-filters";
import { prisma } from "@/lib/prisma";
import { buildQuoteSearchWhere, serializeQuoteSearchResult } from "@/lib/quote-history";
import { QuotesClient, type QuoteFilters, type QuoteHistoryRow, type QuoteProductOption } from "./quotes-client";

type QuoteProductResult = Prisma.ProductGetPayload<{
  include: {
    supplierOffers: {
      select: {
        id: true;
        factoryName: true;
        purchasePrice: true;
        currency: true;
        moq: true;
        ctnQty: true;
        ctnLength: true;
        ctnWidth: true;
        ctnHeight: true;
        leadTime: true;
        remark: true;
        priceUpdatedAt: true;
      };
    };
    params: {
      select: {
        paramKey: true;
        rawValue: true;
        normalizedValue: true;
        unit: true;
        confidence: true;
      };
    };
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
    category?: string;
    factory?: string;
    minWatts?: string;
    maxWatts?: string;
    ip?: string;
    cct?: string;
    error?: string;
  }>;
};

export default async function QuotesPage({ searchParams }: QuotesPageProps) {
  const params = await searchParams;
  const filters: QuoteFilters = {
    search: params.search?.trim() ?? "",
    category: params.category?.trim() ?? "",
    factory: params.factory?.trim() ?? "",
    minWatts: params.minWatts?.trim() ?? "",
    maxWatts: params.maxWatts?.trim() ?? "",
    ip: params.ip?.trim() ?? "",
    cct: params.cct?.trim() ?? "",
    error: params.error?.trim() ?? "",
  };
  const shouldLoadProducts = [
    filters.search,
    filters.category,
    filters.factory,
    filters.minWatts,
    filters.maxWatts,
    filters.ip,
    filters.cct,
  ].some((value) => value.length > 0);

  const [wattsProductIds, categories, ipOptions, cctOptions, quotes] = await Promise.all([
    getProductIdsByWattsRange(filters.minWatts, filters.maxWatts),
    getCategoryOptions(),
    getIpOptions(),
    getCctOptions(),
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
  const products = shouldLoadProducts
    ? await prisma.product.findMany({
        where: buildProductWhere(filters, wattsProductIds),
        include: {
          supplierOffers: {
            select: {
              id: true,
              factoryName: true,
              purchasePrice: true,
              currency: true,
              moq: true,
              ctnQty: true,
              ctnLength: true,
              ctnWidth: true,
              ctnHeight: true,
              leadTime: true,
              remark: true,
              priceUpdatedAt: true,
            },
            orderBy: [{ factoryName: "asc" }, { createdAt: "desc" }],
            take: 20,
          },
          params: {
            select: {
              paramKey: true,
              rawValue: true,
              normalizedValue: true,
              unit: true,
              confidence: true,
            },
            orderBy: { paramKey: "asc" },
          },
        },
        orderBy: [{ productName: "asc" }],
        take: 50,
      })
    : [];
  const historicalQuotesByProductId = await getHistoricalQuotesByProductIds(products.map((product) => product.id));

  return (
    <QuotesClient
      filters={filters}
      shouldLoadProducts={shouldLoadProducts}
      products={products.map((product) => serializeProduct(product, historicalQuotesByProductId.get(product.id) ?? []))}
      quotes={quotes.map(serializeQuote)}
      categories={categories}
      ipOptions={ipOptions}
      cctOptions={cctOptions}
    />
  );
}

function serializeProduct(product: QuoteProductResult, historicalQuotes: HistoricalCustomerQuote[]): QuoteProductOption {
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
      leadTime: offer.leadTime,
      remark: offer.remark,
      priceUpdatedAt: offer.priceUpdatedAt?.toISOString() ?? null,
    })),
    displayParams: product.params.map((param) => ({
      paramKey: param.paramKey,
      rawValue: param.rawValue,
      normalizedValue: param.normalizedValue,
      unit: param.unit,
      confidence: param.confidence,
    })),
    historicalQuotes,
  };
}

function serializeQuote(quote: QuoteHistoryResult): QuoteHistoryRow {
  return serializeQuoteSearchResult(quote);
}

function buildProductWhere(filters: QuoteFilters, wattsProductIds: string[] | null): Prisma.ProductWhereInput {
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

  if (filters.category) {
    and.push({ category: filters.category });
  }

  if (filters.ip) {
    and.push({
      params: {
        some: {
          paramKey: "ip",
          normalizedValue: filters.ip,
        },
      },
    });
  }

  if (filters.cct) {
    and.push({
      params: {
        some: {
          paramKey: "cct",
          normalizedValue: filters.cct,
        },
      },
    });
  }

  if (hasWattsFilter(filters)) {
    and.push({ id: { in: wattsProductIds ?? [] } });
  }

  return and.length > 0 ? { AND: and } : {};
}

function hasWattsFilter(filters: QuoteFilters): boolean {
  return (
    parseOptionalNonNegativeDecimal(filters.minWatts) !== null ||
    parseOptionalNonNegativeDecimal(filters.maxWatts) !== null
  );
}
