import Link from "next/link";

import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type CustomerSummary = {
  id: string;
  name: string;
  note: string | null;
  quoteCount: number;
  historyFileCount: number;
  historyRowCount: number;
  lastQuoteDate: string | null;
};

export default async function CustomersPage() {
  const customers = await prisma.customer.findMany({ orderBy: { name: "asc" } });

  const summaries: CustomerSummary[] = await Promise.all(
    customers.map(async (customer) => {
      const aliasNames = parseAliases(customer.aliases);
      const names = [customer.name, ...aliasNames];
      const [quoteCount, latestQuote, historyFiles] = await Promise.all([
        prisma.quote.count({ where: { customerName: { in: names } } }),
        prisma.quote.findFirst({
          where: { customerName: { in: names } },
          orderBy: { createdAt: "desc" },
          select: { createdAt: true },
        }),
        prisma.customerQuoteFile.findMany({
          where: { customerName: { in: names } },
          select: { rowCount: true, quoteDate: true },
        }),
      ]);
      const historyRowCount = historyFiles.reduce((sum, file) => sum + file.rowCount, 0);
      const latestHistoryDate = historyFiles
        .map((file) => file.quoteDate)
        .filter((value): value is string => Boolean(value))
        .sort()
        .at(-1);
      const latestQuoteDate = latestQuote?.createdAt.toISOString().slice(0, 10) ?? null;
      return {
        id: customer.id,
        name: customer.name,
        note: customer.note,
        quoteCount,
        historyFileCount: historyFiles.length,
        historyRowCount,
        lastQuoteDate: [latestQuoteDate, latestHistoryDate].filter(Boolean).sort().at(-1) ?? null,
      };
    }),
  );

  const active = summaries.filter((summary) => summary.quoteCount > 0 || summary.historyRowCount > 0);
  const inactive = summaries.filter((summary) => summary.quoteCount === 0 && summary.historyRowCount === 0);

  return (
    <div className="mx-auto max-w-6xl">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-sm font-semibold uppercase tracking-[0.18em] text-leaf">客户</div>
          <h1 className="mt-2 text-3xl font-semibold text-ink">客户管理</h1>
          <p className="mt-2 text-sm text-stone-600">
            客户实体来自新报价和历史报价文件的客户名归集，用于按客户查看报价历史。
          </p>
        </div>
        <div className="rounded-md border border-line bg-paper px-4 py-2 text-sm font-semibold text-ink shadow-panel">
          {summaries.length} 个客户
        </div>
      </header>

      {summaries.length === 0 ? (
        <div className="rounded-md border border-dashed border-line bg-white p-8 text-center text-sm text-stone-500">
          还没有客户记录。运行 <code>npx tsx scripts/v49-backfill-customers.ts</code> 从现有数据回填。
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border border-line bg-white shadow-panel">
          <div className="grid grid-cols-[minmax(0,1.4fr)_110px_130px_130px_120px] bg-cream px-4 py-2.5 text-xs font-semibold text-slate-600">
            <div>客户名</div>
            <div className="text-right">新报价单</div>
            <div className="text-right">历史报价文件</div>
            <div className="text-right">历史报价行</div>
            <div className="text-right">最近报价</div>
          </div>
          {[...active, ...inactive].map((summary) => (
            <Link
              key={summary.id}
              href={`/customers/${summary.id}`}
              className="grid grid-cols-[minmax(0,1.4fr)_110px_130px_130px_120px] items-center border-t border-line px-4 py-3 text-sm hover:bg-cream"
            >
              <div className="min-w-0">
                <div className="truncate font-semibold text-ink">{summary.name}</div>
                {summary.note ? <div className="truncate text-xs text-stone-500">{summary.note}</div> : null}
              </div>
              <div className="text-right tabular-nums">{summary.quoteCount || "-"}</div>
              <div className="text-right tabular-nums">{summary.historyFileCount || "-"}</div>
              <div className="text-right tabular-nums">{summary.historyRowCount || "-"}</div>
              <div className="text-right text-xs text-stone-500">{summary.lastQuoteDate ?? "-"}</div>
            </Link>
          ))}
        </div>
      )}
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
