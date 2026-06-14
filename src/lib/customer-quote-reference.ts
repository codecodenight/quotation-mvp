import { prisma } from "@/lib/prisma";

export type HistoricalCustomerQuote = {
  salePriceUsd: number;
  salePriceText: string | null;
  rawModel: string | null;
  customerName: string | null;
  quoteDate: string | null;
  fileName: string;
  totalCount: number;
};

type HistoricalCustomerQuoteRow = {
  productId: string;
  salePriceUsd: number;
  salePriceText: string | null;
  rawModel: string | null;
  customerName: string | null;
  quoteDate: string | null;
  fileName: string;
  totalCount: number | bigint;
};

export async function getHistoricalQuotesByProductIds(
  productIds: string[],
): Promise<Map<string, HistoricalCustomerQuote[]>> {
  const uniqueProductIds = Array.from(new Set(productIds.map((id) => id.trim()).filter(Boolean)));
  if (uniqueProductIds.length === 0) {
    return new Map();
  }

  const placeholders = uniqueProductIds.map(() => "?").join(", ");
  const rows = await prisma.$queryRawUnsafe<HistoricalCustomerQuoteRow[]>(
    `
      WITH ranked AS (
        SELECT
          cqr.matched_product_id AS productId,
          cqr.sale_price_usd AS salePriceUsd,
          cqr.sale_price_text AS salePriceText,
          cqr.raw_model AS rawModel,
          cqf.customer_name AS customerName,
          cqf.quote_date AS quoteDate,
          cqf.file_name AS fileName,
          COUNT(*) OVER (PARTITION BY cqr.matched_product_id) AS totalCount,
          ROW_NUMBER() OVER (
            PARTITION BY cqr.matched_product_id
            ORDER BY
              CASE WHEN cqf.quote_date IS NULL THEN 1 ELSE 0 END,
              cqf.quote_date DESC,
              cqf.id DESC,
              cqr.id DESC
          ) AS rowRank
        FROM customer_quote_rows cqr
        JOIN customer_quote_files cqf ON cqf.id = cqr.file_id
        WHERE cqr.matched_product_id IN (${placeholders})
          AND cqr.sale_price_usd IS NOT NULL
      )
      SELECT productId, salePriceUsd, salePriceText, rawModel, customerName, quoteDate, fileName, totalCount
      FROM ranked
      WHERE rowRank <= 10
      ORDER BY productId ASC, rowRank ASC
    `,
    ...uniqueProductIds,
  );

  const grouped = new Map<string, HistoricalCustomerQuote[]>();
  for (const row of rows) {
    const quotes = grouped.get(row.productId) ?? [];
    quotes.push({
      salePriceUsd: row.salePriceUsd,
      salePriceText: row.salePriceText,
      rawModel: row.rawModel,
      customerName: row.customerName,
      quoteDate: row.quoteDate,
      fileName: row.fileName,
      totalCount: Number(row.totalCount),
    });
    grouped.set(row.productId, quotes);
  }

  return grouped;
}
