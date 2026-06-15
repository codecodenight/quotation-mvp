"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/prisma";

export type CustomerQuoteProductSearchResult = {
  id: string;
  modelNo: string | null;
  productName: string;
  category: string | null;
  factoryName: string | null;
  hasImage: boolean;
};

export async function searchProductsForCustomerQuote(keyword: string): Promise<CustomerQuoteProductSearchResult[]> {
  const query = normalizeInput(keyword);
  if (query.length < 2) {
    return [];
  }

  const products = await prisma.product.findMany({
    where: {
      OR: [
        { modelNo: { contains: query } },
        { productName: { contains: query } },
        { category: { contains: query } },
      ],
    },
    select: {
      id: true,
      modelNo: true,
      productName: true,
      category: true,
      imagePath: true,
      supplierOffers: {
        select: { factoryName: true },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
    orderBy: [{ updatedAt: "desc" }, { productName: "asc" }],
    take: 20,
  });

  return products.map((product) => ({
    id: product.id,
    modelNo: product.modelNo,
    productName: product.productName,
    category: product.category,
    factoryName: product.supplierOffers[0]?.factoryName ?? null,
    hasImage: Boolean(product.imagePath),
  }));
}

export async function bindCustomerQuoteRowToProduct(
  rowId: number,
  productId: string,
): Promise<CustomerQuoteProductSearchResult> {
  const safeRowId = parseRowId(rowId);
  const safeProductId = normalizeInput(productId);
  if (!safeProductId) {
    throw new Error("产品 ID 不能为空。");
  }

  const [rowExists, product] = await Promise.all([
    customerQuoteRowExists(safeRowId),
    prisma.product.findUnique({
      where: { id: safeProductId },
      select: {
        id: true,
        modelNo: true,
        productName: true,
        category: true,
        imagePath: true,
        supplierOffers: {
          select: { factoryName: true },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    }),
  ]);

  if (!rowExists) {
    throw new Error("历史报价行不存在。");
  }
  if (!product) {
    throw new Error("产品不存在。");
  }

  await prisma.$executeRaw`
    UPDATE customer_quote_rows
    SET matched_product_id = ${product.id}
    WHERE id = ${safeRowId}
  `;
  revalidateCustomerQuotePaths();

  return {
    id: product.id,
    modelNo: product.modelNo,
    productName: product.productName,
    category: product.category,
    factoryName: product.supplierOffers[0]?.factoryName ?? null,
    hasImage: Boolean(product.imagePath),
  };
}

export async function unbindCustomerQuoteRow(rowId: number): Promise<void> {
  const safeRowId = parseRowId(rowId);
  const rowExists = await customerQuoteRowExists(safeRowId);

  if (!rowExists) {
    throw new Error("历史报价行不存在。");
  }

  await prisma.$executeRaw`
    UPDATE customer_quote_rows
    SET matched_product_id = NULL
    WHERE id = ${safeRowId}
  `;
  revalidateCustomerQuotePaths();
}

async function customerQuoteRowExists(rowId: number): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ id: number }>>`
    SELECT id
    FROM customer_quote_rows
    WHERE id = ${rowId}
    LIMIT 1
  `;
  return rows.length > 0;
}

function parseRowId(rowId: number): number {
  if (!Number.isInteger(rowId) || rowId <= 0) {
    throw new Error("历史报价行 ID 不合法。");
  }
  return rowId;
}

function normalizeInput(value: string): string {
  return value.normalize("NFC").trim();
}

function revalidateCustomerQuotePaths() {
  revalidatePath("/customer-quotes");
  revalidatePath("/quotes");
}
