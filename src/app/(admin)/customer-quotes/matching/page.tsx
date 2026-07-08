import { prisma } from "@/lib/prisma";
import { findCandidates, type MatchableProduct } from "@/lib/customer-quote-matching";
import { MatchingClient, type MatchingRow } from "./matching-client";

export const dynamic = "force-dynamic";

const BATCH_SIZE = 30;

export default async function CustomerQuoteMatchingPage() {
  const [unmatchedTotal, rows, products] = await Promise.all([
    prisma.customerQuoteRow.count({
      where: { matchedProductId: null, rawModel: { not: null } },
    }),
    prisma.customerQuoteRow.findMany({
      where: { matchedProductId: null, rawModel: { not: null } },
      select: {
        id: true,
        rawModel: true,
        rawDescription: true,
        salePriceUsd: true,
        file: {
          select: { customerName: true, quoteDate: true, fileName: true },
        },
      },
      orderBy: [{ fileId: "asc" }, { rowNumber: "asc" }],
      take: BATCH_SIZE * 4,
    }),
    prisma.product.findMany({
      select: { id: true, modelNo: true, productName: true, category: true, imagePath: true },
    }),
  ]);

  const matchableProducts: MatchableProduct[] = products.map((product) => ({
    id: product.id,
    modelNo: product.modelNo,
    productName: product.productName,
    category: product.category,
  }));
  const imageByProductId = new Map(products.map((product) => [product.id, Boolean(product.imagePath)]));

  const matchingRows: MatchingRow[] = [];
  for (const row of rows) {
    if (matchingRows.length >= BATCH_SIZE) {
      break;
    }
    const candidates = findCandidates(row.rawModel, row.rawDescription, matchableProducts);
    if (candidates.length === 0) {
      continue;
    }
    matchingRows.push({
      rowId: row.id,
      rawModel: row.rawModel,
      rawDescription: row.rawDescription,
      salePriceUsd: row.salePriceUsd,
      customerName: row.file.customerName,
      quoteDate: row.file.quoteDate,
      fileName: row.file.fileName,
      candidates: candidates.map((candidate) => ({
        productId: candidate.product.id,
        modelNo: candidate.product.modelNo,
        productName: candidate.product.productName,
        category: candidate.product.category,
        score: candidate.score,
        reason: candidate.reason,
        hasImage: imageByProductId.get(candidate.product.id) ?? false,
      })),
    });
  }

  return <MatchingClient unmatchedTotal={unmatchedTotal} initialRows={matchingRows} />;
}
