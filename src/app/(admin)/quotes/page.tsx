import type { Prisma } from "@prisma/client";

import { getHistoricalQuotesByProductIds, type HistoricalCustomerQuote } from "@/lib/customer-quote-reference";
import {
  getCategoryOptions,
  getCctOptions,
  getIpOptions,
  getMaterialOptions,
  getProductIdsByWattsRange,
  getVoltageOptions,
  parseOptionalNonNegativeDecimal,
} from "@/lib/product-filters";
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
    voltage?: string;
    material?: string;
    sort?: string;
    error?: string;
  }>;
};

const MAX_PRODUCTS_FOR_SORTING = 200;
const PRODUCT_RESULT_LIMIT = 50;
const MAX_SORTABLE_PRICE = 10_000;

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
    voltage: params.voltage?.trim() ?? "",
    material: params.material?.trim() ?? "",
    sort: params.sort?.trim() ?? "",
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
    filters.voltage,
    filters.material,
    filters.sort,
  ].some((value) => value.length > 0);

  const [wattsProductIds, categories, ipOptions, cctOptions, voltageOptions, materialOptions, quotes] = await Promise.all([
    getProductIdsByWattsRange(filters.minWatts, filters.maxWatts),
    getCategoryOptions(),
    getIpOptions(),
    getCctOptions(),
    getVoltageOptions(),
    getMaterialOptions(),
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
        orderBy: getProductOrderBy(filters.sort),
        take: shouldSortInMemory(filters.sort) ? MAX_PRODUCTS_FOR_SORTING : PRODUCT_RESULT_LIMIT,
      })
    : [];
  const sortedProducts = sortProducts(products, filters.sort).slice(0, PRODUCT_RESULT_LIMIT);
  const historicalQuotesByProductId = await getHistoricalQuotesByProductIds(sortedProducts.map((product) => product.id));

  return (
    <QuotesClient
      filters={filters}
      shouldLoadProducts={shouldLoadProducts}
      products={sortedProducts.map((product) => serializeProduct(product, historicalQuotesByProductId.get(product.id) ?? []))}
      quotes={quotes.map(serializeQuote)}
      categories={categories}
      ipOptions={ipOptions}
      cctOptions={cctOptions}
      voltageOptions={voltageOptions}
      materialOptions={materialOptions}
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
    and.push(buildParamFilter("ip", filters.ip));
  }

  if (filters.cct) {
    and.push(buildParamFilter("cct", filters.cct));
  }

  if (filters.voltage) {
    and.push(buildParamFilter("voltage", filters.voltage));
  }

  if (filters.material) {
    and.push(buildParamFilter("material", filters.material));
  }

  if (hasWattsFilter(filters)) {
    and.push({ id: { in: wattsProductIds ?? [] } });
  }

  return and.length > 0 ? { AND: and } : {};
}

function buildParamFilter(paramKey: string, filterValue: string): Prisma.ProductWhereInput {
  return {
    OR: [
      {
        params: {
          some: {
            paramKey,
            normalizedValue: filterValue,
          },
        },
      },
      {
        params: {
          none: {
            paramKey,
            normalizedValue: { not: null },
          },
        },
      },
    ],
  };
}

function hasWattsFilter(filters: QuoteFilters): boolean {
  return (
    parseOptionalNonNegativeDecimal(filters.minWatts) !== null ||
    parseOptionalNonNegativeDecimal(filters.maxWatts) !== null
  );
}

function getProductOrderBy(sort: string): Prisma.ProductOrderByWithRelationInput[] | undefined {
  switch (sort) {
    case "newest":
      return [{ createdAt: "desc" }, { productName: "asc" }];
    case "name":
    case "":
    case "default":
      return [{ productName: "asc" }];
    default:
      return [{ productName: "asc" }];
  }
}

function shouldSortInMemory(sort: string): boolean {
  return sort === "price-asc" || sort === "price-desc";
}

function sortProducts(products: QuoteProductResult[], sort: string): QuoteProductResult[] {
  switch (sort) {
    case "price-asc":
      return [...products].sort((left, right) => compareByOfferPrice(left, right, "asc"));
    case "price-desc":
      return [...products].sort((left, right) => compareByOfferPrice(left, right, "desc"));
    case "newest":
    case "name":
    case "":
    case "default":
    default:
      return products;
  }
}

function compareByOfferPrice(left: QuoteProductResult, right: QuoteProductResult, direction: "asc" | "desc"): number {
  const leftPrice = minSortableOfferPrice(left);
  const rightPrice = minSortableOfferPrice(right);
  const leftMissing = !Number.isFinite(leftPrice);
  const rightMissing = !Number.isFinite(rightPrice);
  if (leftMissing && rightMissing) return left.productName.localeCompare(right.productName);
  if (leftMissing) return 1;
  if (rightMissing) return -1;
  return direction === "asc"
    ? leftPrice - rightPrice || left.productName.localeCompare(right.productName)
    : rightPrice - leftPrice || left.productName.localeCompare(right.productName);
}

function minSortableOfferPrice(product: QuoteProductResult): number {
  const prices = product.supplierOffers
    .map((offer) => Number(offer.purchasePrice.toString()))
    .filter((price) => Number.isFinite(price) && price > 0 && price <= MAX_SORTABLE_PRICE);
  return prices.length > 0 ? Math.min(...prices) : Number.POSITIVE_INFINITY;
}
