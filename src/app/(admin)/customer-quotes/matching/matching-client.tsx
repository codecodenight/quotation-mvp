"use client";

import { Check, ChevronRight, Loader2, RefreshCw, SkipForward } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { bindCustomerQuoteRowToProduct } from "../actions";

export type MatchingCandidate = {
  productId: string;
  modelNo: string | null;
  productName: string;
  category: string | null;
  score: number;
  reason: "exact" | "contains" | "prefix" | "watts";
  hasImage: boolean;
};

export type MatchingRow = {
  rowId: number;
  rawModel: string | null;
  rawDescription: string | null;
  salePriceUsd: number | null;
  customerName: string | null;
  quoteDate: string | null;
  fileName: string;
  candidates: MatchingCandidate[];
};

const REASON_LABELS: Record<MatchingCandidate["reason"], string> = {
  exact: "型号一致",
  contains: "型号包含",
  prefix: "前缀相同",
  watts: "瓦数+品类",
};

export function MatchingClient({
  unmatchedTotal,
  initialRows,
}: {
  unmatchedTotal: number;
  initialRows: MatchingRow[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState<MatchingRow[]>(initialRows);
  const [confirmedCount, setConfirmedCount] = useState(0);
  const [bindingRowId, setBindingRowId] = useState<number | null>(null);
  const [errorByRow, setErrorByRow] = useState<Record<number, string>>({});
  const [isPending, startTransition] = useTransition();

  function confirmCandidate(row: MatchingRow, candidate: MatchingCandidate) {
    if (bindingRowId !== null) {
      return;
    }
    setBindingRowId(row.rowId);
    setErrorByRow((current) => ({ ...current, [row.rowId]: "" }));
    startTransition(async () => {
      try {
        await bindCustomerQuoteRowToProduct(row.rowId, candidate.productId);
        setRows((current) => current.filter((item) => item.rowId !== row.rowId));
        setConfirmedCount((count) => count + 1);
      } catch (error) {
        setErrorByRow((current) => ({
          ...current,
          [row.rowId]: error instanceof Error ? error.message : "绑定失败。",
        }));
      } finally {
        setBindingRowId(null);
      }
    });
  }

  function skipRow(rowId: number) {
    setRows((current) => current.filter((item) => item.rowId !== rowId));
  }

  return (
    <div className="space-y-4 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">历史报价半自动匹配</h1>
          <p className="mt-1 text-sm text-stone-500">
            剩余 {Math.max(unmatchedTotal - confirmedCount, 0)} 条未匹配 · 本批已确认 {confirmedCount} 条
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => router.refresh()}
            className="inline-flex items-center gap-1.5 rounded-md border border-line bg-white px-3 py-2 text-sm font-semibold text-stone-700 hover:border-leaf"
          >
            <RefreshCw size={15} />
            换一批
          </button>
          <Link
            href="/customer-quotes?matched=unmatched"
            className="inline-flex items-center gap-1 rounded-md border border-line bg-white px-3 py-2 text-sm text-stone-600 hover:border-leaf"
          >
            手动模式
            <ChevronRight size={15} />
          </Link>
        </div>
      </header>

      {rows.length === 0 ? (
        <div className="rounded-md border border-dashed border-line bg-white p-8 text-center text-sm text-stone-500">
          本批候选已处理完。点「换一批」加载下一批，或切换到手动模式处理剩余低置信度记录。
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <div key={row.rowId} className="rounded-md border border-line bg-white p-4 shadow-panel">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold text-ink">{row.rawModel || "（无型号）"}</div>
                  {row.rawDescription ? (
                    <div className="mt-0.5 max-w-xl truncate text-sm text-stone-600" title={row.rawDescription}>
                      {row.rawDescription}
                    </div>
                  ) : null}
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-stone-400">
                    <span>{row.customerName || "内部核价"}</span>
                    {row.quoteDate ? <span>{row.quoteDate}</span> : null}
                    {row.salePriceUsd != null ? (
                      <span className="font-semibold text-stone-600">${row.salePriceUsd.toFixed(2)}</span>
                    ) : null}
                    <span className="truncate" title={row.fileName}>
                      {row.fileName}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => skipRow(row.rowId)}
                  className="inline-flex shrink-0 items-center gap-1 rounded-md border border-line bg-white px-2.5 py-1.5 text-xs font-semibold text-stone-500 hover:border-stone-400"
                >
                  <SkipForward size={13} />
                  跳过
                </button>
              </div>

              <div className="mt-3 grid gap-2 md:grid-cols-3">
                {row.candidates.map((candidate) => (
                  <div
                    key={candidate.productId}
                    className="flex items-start gap-2.5 rounded-md border border-line bg-paper p-2.5"
                  >
                    {candidate.hasImage ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`/api/products/${candidate.productId}/image`}
                        alt=""
                        className="h-11 w-11 shrink-0 rounded-sm border border-line object-cover"
                      />
                    ) : (
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-sm border border-line bg-cream text-xs text-stone-400">
                        图
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-ink" title={candidate.modelNo ?? candidate.productName}>
                        {candidate.modelNo ?? candidate.productName}
                      </div>
                      <div className="truncate text-xs text-stone-500">{candidate.productName}</div>
                      <div className="mt-1 flex items-center gap-1.5">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${
                            candidate.score >= 90
                              ? "bg-green-100 text-green-800"
                              : candidate.score >= 70
                                ? "bg-amber-100 text-amber-800"
                                : "bg-stone-100 text-stone-600"
                          }`}
                        >
                          {candidate.score}分 · {REASON_LABELS[candidate.reason]}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={isPending && bindingRowId === row.rowId}
                      onClick={() => confirmCandidate(row, candidate)}
                      className="inline-flex shrink-0 items-center gap-1 self-center rounded-md bg-primary hover:bg-primary-hover px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                    >
                      {isPending && bindingRowId === row.rowId ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <Check size={13} />
                      )}
                      确认
                    </button>
                  </div>
                ))}
              </div>
              {errorByRow[row.rowId] ? (
                <div className="mt-2 text-xs text-red-700">{errorByRow[row.rowId]}</div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
