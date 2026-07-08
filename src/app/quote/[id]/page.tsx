import Image from "next/image";
import { notFound } from "next/navigation";

import { getQuoteDetail } from "@/app/(admin)/quotes/actions";
import { prisma } from "@/lib/prisma";
import { PrintButton } from "./print-button";

export const dynamic = "force-dynamic";

const QUOTE_VALID_DAYS = 30;

type WebQuotePageProps = {
  params: Promise<{ id: string }>;
};

export default async function WebQuotePage({ params }: WebQuotePageProps) {
  const { id } = await params;

  let detail;
  try {
    detail = await getQuoteDetail(id);
  } catch {
    notFound();
  }

  // Same orderBy as getQuoteDetail so images pair with items by index.
  const itemProducts = await prisma.quoteItem.findMany({
    where: { quoteId: detail.id },
    orderBy: [{ productId: "asc" }],
    select: { product: { select: { id: true, imagePath: true } } },
  });

  const createdAt = new Date(detail.createdAt);
  const validUntil = new Date(createdAt.getTime() + QUOTE_VALID_DAYS * 24 * 60 * 60 * 1000);
  const totalAmount = detail.items.reduce((sum, item) => sum + item.salePrice * item.quantity, 0);

  return (
    <div className="min-h-screen bg-white text-ink">
      <div className="mx-auto max-w-5xl px-6 py-8">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-ink pb-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">QUOTATION</h1>
            <div className="mt-3 grid gap-1 text-sm text-slate-600">
              <div>
                <span className="inline-block w-24 text-slate-400">Customer</span>
                <span className="font-semibold text-ink">{detail.customerName}</span>
              </div>
              <div>
                <span className="inline-block w-24 text-slate-400">Date</span>
                {createdAt.toISOString().slice(0, 10)}
              </div>
              <div>
                <span className="inline-block w-24 text-slate-400">Valid Until</span>
                {validUntil.toISOString().slice(0, 10)}
              </div>
              <div>
                <span className="inline-block w-24 text-slate-400">Quote No.</span>
                <span className="tabular-nums">{detail.id.slice(0, 8).toUpperCase()}</span>
              </div>
            </div>
          </div>
          <PrintButton />
        </header>

        <div className="mt-6 overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-cream text-xs uppercase tracking-wider text-slate-600">
              <tr>
                <th className="border border-line px-3 py-2.5 text-center">No.</th>
                <th className="border border-line px-3 py-2.5 text-center">Photo</th>
                <th className="border border-line px-3 py-2.5">Model No.</th>
                <th className="border border-line px-3 py-2.5">Product Details</th>
                <th className="border border-line px-3 py-2.5 text-right">Unit Price ({detail.currency})</th>
                <th className="border border-line px-3 py-2.5 text-right">MOQ</th>
                <th className="border border-line px-3 py-2.5 text-right">Qty</th>
                <th className="border border-line px-3 py-2.5 text-right">Amount ({detail.currency})</th>
                <th className="border border-line px-3 py-2.5">Remark</th>
              </tr>
            </thead>
            <tbody>
              {detail.items.map((item, index) => {
                const product = itemProducts[index]?.product;
                return (
                  <tr key={`${item.modelNo}:${index}`} className="align-middle">
                    <td className="border border-line px-3 py-2.5 text-center tabular-nums text-slate-500">
                      {index + 1}
                    </td>
                    <td className="border border-line px-2 py-2 text-center">
                      {product?.imagePath ? (
                        <Image
                          src={`/api/products/${product.id}/image`}
                          alt={item.modelNo || item.productName}
                          width={56}
                          height={56}
                          className="mx-auto h-14 w-14 rounded-md border border-line object-contain"
                        />
                      ) : (
                        <span className="text-xs text-slate-300">-</span>
                      )}
                    </td>
                    <td className="border border-line px-3 py-2.5 font-semibold">{item.modelNo || item.productName}</td>
                    <td className="max-w-xs whitespace-pre-line border border-line px-3 py-2.5 text-xs leading-5 text-slate-600">
                      {item.productDetails || "-"}
                    </td>
                    <td className="border border-line px-3 py-2.5 text-right font-semibold tabular-nums">
                      {item.salePrice.toFixed(2)}
                    </td>
                    <td className="border border-line px-3 py-2.5 text-right tabular-nums text-slate-600">
                      {item.moq || "-"}
                    </td>
                    <td className="border border-line px-3 py-2.5 text-right tabular-nums">{item.quantity}</td>
                    <td className="border border-line px-3 py-2.5 text-right font-semibold tabular-nums">
                      {(item.salePrice * item.quantity).toFixed(2)}
                    </td>
                    <td className="border border-line px-3 py-2.5 text-xs text-slate-500">{item.remark || ""}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-cream font-semibold">
                <td colSpan={7} className="border border-line px-3 py-2.5 text-right uppercase tracking-wider text-slate-600">
                  Total
                </td>
                <td className="border border-line px-3 py-2.5 text-right tabular-nums">{totalAmount.toFixed(2)}</td>
                <td className="border border-line px-3 py-2.5" />
              </tr>
            </tfoot>
          </table>
        </div>

        <footer className="mt-8 grid gap-1 border-t border-line pt-4 text-xs leading-5 text-slate-500">
          <div>1. Price term: FOB. Validity: {QUOTE_VALID_DAYS} days from quotation date.</div>
          <div>2. Lead time and packing details to be confirmed with order.</div>
          <div>3. This quotation is generated electronically and is valid without signature.</div>
        </footer>
      </div>
    </div>
  );
}
