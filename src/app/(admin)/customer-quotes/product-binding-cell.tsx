"use client";

import { type MouseEvent, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Link2Off, Search } from "lucide-react";

import {
  bindCustomerQuoteRowToProduct,
  searchProductsForCustomerQuote,
  unbindCustomerQuoteRow,
  type CustomerQuoteProductSearchResult,
} from "./actions";

type MatchedProduct = {
  id: string;
  modelNo: string | null;
  productName: string;
  category: string | null;
};

type ProductBindingCellProps = {
  rowId: number;
  rawModel: string | null;
  rawDescription: string | null;
  initialMatchedProduct: MatchedProduct | null;
};

export function ProductBindingCell({
  rowId,
  rawModel,
  rawDescription,
  initialMatchedProduct,
}: ProductBindingCellProps) {
  const router = useRouter();
  const [matchedProduct, setMatchedProduct] = useState<MatchedProduct | null>(initialMatchedProduct);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CustomerQuoteProductSearchResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isSearching, startSearchTransition] = useTransition();

  useEffect(() => {
    if (!isPanelOpen) {
      return;
    }

    const safeQuery = query.trim();
    if (safeQuery.length < 2) {
      return;
    }

    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      startSearchTransition(async () => {
        try {
          const data = await searchProductsForCustomerQuote(safeQuery);
          if (!cancelled) {
            setResults(data);
            setError(null);
          }
        } catch (searchError) {
          if (!cancelled) {
            setResults([]);
            setError(searchError instanceof Error ? searchError.message : "产品搜索失败。");
          }
        }
      });
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [isPanelOpen, query]);

  function openPanel(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    setIsPanelOpen(true);
    setError(null);
    setResults([]);
    if (!query) {
      setQuery(buildInitialQuery(rawModel, rawDescription));
    }
  }

  function closePanel(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    setIsPanelOpen(false);
    setError(null);
  }

  function handleBind(event: MouseEvent<HTMLButtonElement>, product: CustomerQuoteProductSearchResult) {
    event.preventDefault();
    event.stopPropagation();
    setError(null);
    startTransition(async () => {
      try {
        const updatedProduct = await bindCustomerQuoteRowToProduct(rowId, product.id);
        setMatchedProduct(toMatchedProduct(updatedProduct));
        setIsPanelOpen(false);
        router.refresh();
      } catch (bindError) {
        setError(bindError instanceof Error ? bindError.message : "绑定失败。");
      }
    });
  }

  function handleQueryChange(value: string) {
    setQuery(value);
    if (value.trim().length < 2) {
      setResults([]);
    }
  }

  function handleUnbind(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (!window.confirm("确认解除这条历史报价和产品的绑定？")) {
      return;
    }

    setError(null);
    startTransition(async () => {
      try {
        await unbindCustomerQuoteRow(rowId);
        setMatchedProduct(null);
        router.refresh();
      } catch (unbindError) {
        setError(unbindError instanceof Error ? unbindError.message : "解绑失败。");
      }
    });
  }

  return (
    <div
      className="min-w-0"
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      {matchedProduct ? (
        <div className="space-y-2">
          <Link
            href={`/products?search=${encodeURIComponent(matchedProduct.modelNo ?? matchedProduct.productName)}&productId=${encodeURIComponent(matchedProduct.id)}`}
            className="block break-words font-semibold text-leaf underline-offset-2 hover:underline"
          >
            {matchedProduct.modelNo ?? matchedProduct.productName}
          </Link>
          <button
            type="button"
            onClick={handleUnbind}
            disabled={isPending}
            className="inline-flex items-center gap-1 rounded-sm border border-red-200 bg-red-50 px-2 py-1 text-xs font-semibold text-red-700 disabled:opacity-60"
          >
            <Link2Off className="h-3 w-3" aria-hidden="true" />
            解绑
          </button>
          {error ? <div className="text-xs text-red-700">{error}</div> : null}
        </div>
      ) : (
        <div className="space-y-2">
          <button
            type="button"
            onClick={openPanel}
            className="rounded-sm border border-line bg-white px-2 py-1 text-xs font-semibold text-stone-700 hover:border-leaf"
          >
            绑定产品
          </button>
          {isPanelOpen ? (
            <div className="mt-2 w-[320px] max-w-[calc(100vw-2rem)] rounded-md border border-line bg-paper p-3 shadow-panel">
              <label className="block text-xs font-semibold text-stone-600">
                搜索产品库
                <div className="mt-1 flex items-center gap-2 rounded-md border border-line bg-white px-2">
                  <Search className="h-4 w-4 shrink-0 text-stone-400" aria-hidden="true" />
                  <input
                    value={query}
                    onChange={(event) => handleQueryChange(event.target.value)}
                    placeholder="model_no / 产品名 / 品类"
                    className="h-9 min-w-0 flex-1 bg-transparent text-sm text-ink outline-none"
                  />
                </div>
              </label>
              <div className="mt-2 max-h-72 space-y-2 overflow-auto">
                {query.trim().length < 2 ? (
                  <div className="rounded-md border border-line bg-white px-3 py-2 text-xs text-stone-500">
                    输入至少 2 个字符开始搜索。
                  </div>
                ) : null}
                {isSearching ? (
                  <div className="rounded-md border border-line bg-white px-3 py-2 text-xs text-stone-500">
                    搜索中...
                  </div>
                ) : null}
                {!isSearching && query.trim().length >= 2 && results.length === 0 ? (
                  <div className="rounded-md border border-line bg-white px-3 py-2 text-xs text-stone-500">
                    没有找到匹配产品。
                  </div>
                ) : null}
                {results.map((product) => (
                  <SearchResultRow
                    key={product.id}
                    product={product}
                    disabled={isPending}
                    onBind={handleBind}
                  />
                ))}
              </div>
              <div className="mt-2 flex justify-between gap-2">
                <button
                  type="button"
                  onClick={closePanel}
                  className="rounded-sm border border-line bg-white px-2 py-1 text-xs font-semibold text-stone-700 hover:border-leaf"
                >
                  取消
                </button>
                {error ? <div className="text-xs text-red-700">{error}</div> : null}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function SearchResultRow({
  product,
  disabled,
  onBind,
}: {
  product: CustomerQuoteProductSearchResult;
  disabled: boolean;
  onBind: (event: MouseEvent<HTMLButtonElement>, product: CustomerQuoteProductSearchResult) => void;
}) {
  return (
    <div className="grid grid-cols-[44px_minmax(0,1fr)_auto] gap-2 rounded-md border border-line bg-white p-2">
      {product.hasImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/products/${product.id}/image`}
          alt={product.modelNo ?? product.productName}
          className="h-11 w-11 rounded-sm border border-line object-cover"
        />
      ) : (
        <div className="flex h-11 w-11 items-center justify-center rounded-sm border border-line bg-cream text-xs text-stone-400">
          图
        </div>
      )}
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-ink">{product.modelNo ?? product.productName}</div>
        <div className="truncate text-xs text-stone-600">{product.productName}</div>
        <div className="mt-1 flex flex-wrap gap-1 text-[11px] text-stone-500">
          {product.category ? <span>{product.category}</span> : null}
          {product.factoryName ? <span>{product.factoryName}</span> : null}
        </div>
      </div>
      <button
        type="button"
        onClick={(event) => onBind(event, product)}
        disabled={disabled}
        className="self-center rounded-sm bg-ink px-2 py-1 text-xs font-semibold text-white disabled:opacity-60"
      >
        选择
      </button>
    </div>
  );
}

function buildInitialQuery(rawModel: string | null, rawDescription: string | null): string {
  const model = rawModel?.normalize("NFC").trim();
  if (model) {
    return model;
  }
  const description = rawDescription?.normalize("NFC").trim();
  return description ? description.slice(0, 60) : "";
}

function toMatchedProduct(product: CustomerQuoteProductSearchResult): MatchedProduct {
  return {
    id: product.id,
    modelNo: product.modelNo,
    productName: product.productName,
    category: product.category,
  };
}
