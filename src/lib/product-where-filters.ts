import type { Prisma } from "@prisma/client";

// SQLite has a bound-parameter limit; chunk large id lists into OR groups.
export const PRODUCT_ID_FILTER_CHUNK_SIZE = 400;

export function buildProductIdsFilter(productIds: string[]): Prisma.ProductWhereInput {
  if (productIds.length <= PRODUCT_ID_FILTER_CHUNK_SIZE) {
    return { id: { in: productIds } };
  }

  const chunks: Prisma.ProductWhereInput[] = [];
  for (let index = 0; index < productIds.length; index += PRODUCT_ID_FILTER_CHUNK_SIZE) {
    chunks.push({ id: { in: productIds.slice(index, index + PRODUCT_ID_FILTER_CHUNK_SIZE) } });
  }
  return { OR: chunks };
}

// Products missing the param entirely are kept (none-clause) so sparse data doesn't vanish from results.
export function buildParamFilter(paramKey: string, filterValue: string): Prisma.ProductWhereInput {
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

export function intersectProductIdFilters(left: string[] | null, right: string[] | null): string[] | null {
  if (left === null) return right;
  if (right === null) return left;
  const rightIds = new Set(right);
  return left.filter((id) => rightIds.has(id));
}
