import Link from "next/link";
import { notFound } from "next/navigation";

import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const HISTORY_ROW_LIMIT = 100;

type CustomerDetailPageProps = {
  params: Promise<{ id: string }>;
};

export default async function CustomerDetailPage({ params }: CustomerDetailPageProps) {
  const { id } = await params;
  const customer = await prisma.customer.findUnique({ where: { id } });
  if (!customer) {
    notFound();
  }

  const aliasNames = parseAliases(customer.aliases);
  const names = [customer.name, ...aliasNames];

  const [quotes, historyRows] = await Promise.all([
    prisma.quote.findMany({
      where: { customerName: { in: names } },
      orderBy: { createdAt: "desc" },
      include: { items: { select: { id: true } } },
      take: 50,
    }),
    prisma.customerQuoteRow.findMany({
      where: { file: { customerName: { in: names } } },
      orderBy: [{ file: { quoteDate: "desc" } }, { rowNumber: "asc" }],
      select: {
        id: true,
        rawModel: true,
        rawDescription: true,
        salePriceUsd: true,
        matchedProduct: { select: { id: true, modelNo: true, productName: true } },
        file: { select: { quoteDate: true, fileName: true } },
      },
      take: HISTORY_ROW_LIMIT,
    }),
  ]);

  return (
    <div className="mx-auto max-w-6xl">
      <header className="mb-6">
        <Link href="/customers" className="text-sm text-stone-500 hover:text-leaf">
          ← 客户管理
        </Link>
        <h1 className="mt-2 text-3xl font-semibold text-ink">{customer.name}</h1>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-stone-600">
          {aliasNames.length > 0 ? <span>别名：{aliasNames.join("、")}</span> : null}
          {customer.note ? <span>{customer.note}</span> : null}
          <span>
            新报价单 {quotes.length} 个 · 历史报价行 {historyRows.length}
            {historyRows.length === HISTORY_ROW_LIMIT ? "+" : ""} 条
          </span>
        </div>
      </header>

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold text-ink">新报价单</h2>
        {quotes.length === 0 ? (
          <div className="rounded-md border border-dashed border-line bg-white p-5 text-sm text-stone-500">
            还没有用系统给这个客户生成过报价单。
          </div>
        ) : (
          <div className="overflow-hidden rounded-md border border-line bg-white shadow-panel">
            <div className="grid grid-cols-[120px_minmax(0,1fr)_90px_90px_110px] bg-cream px-4 py-2.5 text-xs font-semibold text-slate-600">
              <div>日期</div>
              <div>报价单</div>
              <div className="text-right">产品数</div>
              <div className="text-right">利润率</div>
              <div className="text-right">币种</div>
            </div>
            {quotes.map((quote) => (
              <div
                key={quote.id}
                className="grid grid-cols-[120px_minmax(0,1fr)_90px_90px_110px] items-center border-t border-line px-4 py-3 text-sm"
              >
                <div className="text-stone-600">{quote.createdAt.toISOString().slice(0, 10)}</div>
                <div className="min-w-0">
                  <a
                    href={`/api/quotes/${quote.id}/download`}
                    className="truncate font-semibold text-leaf underline-offset-2 hover:underline"
                  >
                    下载 Excel
                  </a>
                </div>
                <div className="text-right tabular-nums">{quote.items.length}</div>
                <div className="text-right tabular-nums">{Number(quote.profitMargin) * 100}%</div>
                <div className="text-right">{quote.currency}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-ink">历史报价记录</h2>
        {historyRows.length === 0 ? (
          <div className="rounded-md border border-dashed border-line bg-white p-5 text-sm text-stone-500">
            没有导入过这个客户的历史报价文件。
          </div>
        ) : (
          <div className="overflow-hidden rounded-md border border-line bg-white shadow-panel">
            <div className="grid grid-cols-[110px_minmax(0,1.2fr)_minmax(0,1fr)_90px] bg-cream px-4 py-2.5 text-xs font-semibold text-slate-600">
              <div>日期</div>
              <div>型号</div>
              <div>绑定产品</div>
              <div className="text-right">FOB USD</div>
            </div>
            {historyRows.map((row) => (
              <div
                key={row.id}
                className="grid grid-cols-[110px_minmax(0,1.2fr)_minmax(0,1fr)_90px] items-center border-t border-line px-4 py-2.5 text-sm"
              >
                <div className="text-stone-600">{row.file.quoteDate ?? "-"}</div>
                <div className="min-w-0 truncate" title={row.rawDescription ?? ""}>
                  {row.rawModel || "-"}
                </div>
                <div className="min-w-0 truncate text-stone-600">
                  {row.matchedProduct ? (
                    <Link
                      href={`/products?search=${encodeURIComponent(row.matchedProduct.modelNo ?? row.matchedProduct.productName)}&productId=${encodeURIComponent(row.matchedProduct.id)}`}
                      className="text-leaf underline-offset-2 hover:underline"
                    >
                      {row.matchedProduct.modelNo ?? row.matchedProduct.productName}
                    </Link>
                  ) : (
                    <span className="text-stone-400">未绑定</span>
                  )}
                </div>
                <div className="text-right font-semibold tabular-nums">
                  {row.salePriceUsd == null ? "-" : `$${row.salePriceUsd.toFixed(2)}`}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function parseAliases(aliases: string | null): string[] {
  if (!aliases) {
    return [];
  }
  try {
    const parsed = JSON.parse(aliases);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}
