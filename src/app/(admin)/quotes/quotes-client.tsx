"use client";

import { type FormEvent, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Download, FileSpreadsheet, Plus, RotateCcw, Search, Trash2 } from "lucide-react";

import { formatDateTime, formatMoney } from "@/lib/format";
import { OFFER_BADGE_META, rankOffers, type OfferBadge, type OfferScore } from "@/lib/offer-ranking";
import { formatParamLabel, sortDisplayParams } from "@/lib/product-param-display";
import { buildQuoteHealth, type CategorizedWarning, type QuoteProductHealth, type WarningTier } from "@/lib/quote-health";
import {
  createDefaultQuoteSearchFilters,
  type QuoteDetail,
  type QuoteSearchFilters,
  type QuoteSearchResult,
} from "@/lib/quote-history";
import type { QuotePreviewData, QuotePreviewRow } from "@/lib/quote-preview";
import {
  allSelectedOffersUseCurrency,
  buildQuoteFormData,
  createDefaultQuoteDraft,
  createSelectedQuoteItem,
  resolveSelectedOffer,
  type QuoteSelectionProduct,
  type SelectedQuoteItem,
} from "@/lib/quote-selection";
import { createQuote, getQuoteDetail, previewQuote, reuseQuote, searchQuotes } from "./actions";

export type QuoteProductOption = QuoteSelectionProduct;

export type QuoteHistoryRow = QuoteSearchResult;

export type QuoteFilters = {
  search: string;
  category: string;
  factory: string;
  minWatts: string;
  maxWatts: string;
  ip: string;
  cct: string;
  voltage: string;
  material: string;
  sort: string;
  error: string;
};

type QuotesClientProps = {
  filters: QuoteFilters;
  shouldLoadProducts: boolean;
  products: QuoteProductOption[];
  quotes: QuoteHistoryRow[];
  categories: { category: string; count: number }[];
  ipOptions: { value: string; count: number }[];
  cctOptions: { value: string; count: number }[];
  voltageOptions: { value: string; count: number }[];
  materialOptions: { value: string; count: number }[];
};

const inputClass =
  "h-10 w-full rounded-md border border-line bg-white px-3 text-sm outline-none focus:border-leaf";
const selectClass =
  "h-10 w-full rounded-md border border-line bg-white px-3 text-sm outline-none focus:border-leaf";
const SELECTED_ITEMS_STORAGE_KEY = "quotation-mvp:quote-selected-items:v1";
const QUOTE_PARAMS_STORAGE_KEY = "quotation-mvp:quote-params:v1";
const SIZE_PARAM_KEYS = new Set(["size_display", "length_mm", "width_mm", "height_mm"]);
const WARNING_TIER_ORDER: WarningTier[] = ["customer", "quote", "logistics"];
const WARNING_TIER_META: Record<WarningTier, { label: string; badgeClass: string; textClass: string; rowClass: string }> = {
  customer: {
    label: "客户可见",
    badgeClass: "border-red-200 bg-red-50 text-red-800",
    textClass: "text-red-800",
    rowClass: "bg-red-50",
  },
  quote: {
    label: "报价风险",
    badgeClass: "border-amber-200 bg-amber-50 text-amber-800",
    textClass: "text-amber-800",
    rowClass: "bg-amber-50",
  },
  logistics: {
    label: "物流缺失",
    badgeClass: "border-stone-300 bg-stone-50 text-stone-700",
    textClass: "text-stone-700",
    rowClass: "bg-stone-50",
  },
};

export function QuotesClient({
  filters,
  shouldLoadProducts,
  products,
  quotes,
  categories,
  ipOptions,
  cctOptions,
  voltageOptions,
  materialOptions,
}: QuotesClientProps) {
  const [mode, setMode] = useState<"editing" | "previewing">("editing");
  const [preview, setPreview] = useState<QuotePreviewData | null>(null);
  const [warningFilter, setWarningFilter] = useState<Set<WarningTier>>(new Set());
  const [actionError, setActionError] = useState<string | null>(null);
  const [reuseNotice, setReuseNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isHistoryPending, startHistoryTransition] = useTransition();
  const hasRestoredStorageRef = useRef(false);
  const historySectionRef = useRef<HTMLDivElement>(null);
  const [selectedItems, setSelectedItems] = useState<Map<string, SelectedQuoteItem>>(new Map());
  const [customerName, setCustomerName] = useState("");
  const [profitMargin, setProfitMargin] = useState("0.2");
  const [currency, setCurrency] = useState("USD");
  const [exchangeRate, setExchangeRate] = useState("7.2");
  const [lastEditableExchangeRate, setLastEditableExchangeRate] = useState("7.2");
  const [customerMode, setCustomerMode] = useState(true);
  const [historyQuotes, setHistoryQuotes] = useState<QuoteHistoryRow[]>(quotes);
  const [historyFilters, setHistoryFilters] = useState<Required<QuoteSearchFilters>>(createDefaultQuoteSearchFilters);
  const [expandedQuoteId, setExpandedQuoteId] = useState<string | null>(null);
  const [quoteDetails, setQuoteDetails] = useState<Map<string, QuoteDetail>>(new Map());
  const [loadingQuoteId, setLoadingQuoteId] = useState<string | null>(null);
  const [reusingQuoteId, setReusingQuoteId] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const selectedProductIds = new Set(selectedItems.keys());
  const sameCurrencyMode = allSelectedOffersUseCurrency(selectedItems, currency);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      const restoredItems = readStoredSelectedItems();
      if (restoredItems.size > 0) {
        setSelectedItems(restoredItems);
      }

      const restoredParams = readStoredQuoteParams();
      if (restoredParams) {
        setCustomerName(restoredParams.customerName);
        setProfitMargin(restoredParams.profitMargin);
        setCurrency(restoredParams.currency);
        setExchangeRate(restoredParams.exchangeRate);
        setLastEditableExchangeRate(restoredParams.lastEditableExchangeRate);
        setCustomerMode(restoredParams.customerMode);
      }
      hasRestoredStorageRef.current = true;
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, []);

  useEffect(() => {
    if (!hasRestoredStorageRef.current) {
      return;
    }
    window.localStorage.setItem(SELECTED_ITEMS_STORAGE_KEY, JSON.stringify(Array.from(selectedItems.entries())));
  }, [selectedItems]);

  useEffect(() => {
    if (!hasRestoredStorageRef.current) {
      return;
    }
    window.localStorage.setItem(
      QUOTE_PARAMS_STORAGE_KEY,
      JSON.stringify({
        customerName,
        profitMargin,
        currency,
        exchangeRate,
        lastEditableExchangeRate,
        customerMode,
      }),
    );
  }, [customerName, profitMargin, currency, exchangeRate, lastEditableExchangeRate, customerMode]);

  function addSelectedProduct(product: QuoteProductOption) {
    if (product.supplierOffers.length === 0) {
      return;
    }

    setSelectedItems((current) => {
      if (current.has(product.id)) {
        return current;
      }
      const next = new Map(current);
      next.set(product.id, createSelectedQuoteItem(product));
      setReuseNotice(null);
      return next;
    });
  }

  function updateSelectedItem(productId: string, updater: (item: SelectedQuoteItem) => SelectedQuoteItem) {
    setSelectedItems((current) => {
      const item = current.get(productId);
      if (!item) {
        return current;
      }
      const next = new Map(current);
      next.set(productId, updater(item));
      return next;
    });
  }

  function removeSelectedProduct(productId: string) {
    setSelectedItems((current) => {
      const next = new Map(current);
      next.delete(productId);
      return next;
    });
  }

  function handleCurrencyChange(nextCurrency: string) {
    setCurrency(nextCurrency);
    if (allSelectedOffersUseCurrency(selectedItems, nextCurrency)) {
      if (exchangeRate !== "1" && exchangeRate.trim().length > 0) {
        setLastEditableExchangeRate(exchangeRate);
      }
      setExchangeRate("1");
    } else if (exchangeRate === "1") {
      setExchangeRate(lastEditableExchangeRate);
    }
  }

  function handleExchangeRateChange(value: string) {
    setExchangeRate(value);
    if (value.trim().length > 0) {
      setLastEditableExchangeRate(value);
    }
  }

  function handlePreview() {
    setActionError(null);
    if (selectedItems.size === 0) {
      setActionError("请至少加入一个产品。");
      return;
    }

    const formData = buildCurrentFormData();
    startTransition(async () => {
      try {
        const data = await previewQuote(formData);
        setPreview(data);
        setWarningFilter(new Set());
        setMode("previewing");
      } catch (error) {
        setActionError(error instanceof Error ? error.message : "预览生成失败。");
      }
    });
  }

  function handleExport() {
    setActionError(null);
    if (selectedItems.size === 0) {
      setActionError("请至少加入一个产品。");
      return;
    }

    const formData = buildCurrentFormData();
    startTransition(async () => {
      try {
        const result = await createQuote(formData);
        clearSelectedItemsAfterExport();
        setHistoryError(null);
        try {
          const defaultFilters = createDefaultQuoteSearchFilters();
          const [latestQuotes, detail] = await Promise.all([
            searchQuotes(defaultFilters),
            getQuoteDetail(result.quoteId),
          ]);
          setHistoryFilters(defaultFilters);
          setHistoryQuotes(latestQuotes);
          setQuoteDetails((current) => {
            const next = new Map(current);
            next.set(result.quoteId, detail);
            return next;
          });
          setExpandedQuoteId(result.quoteId);
          setReuseNotice("报价已导出，历史列表已更新。");
          window.setTimeout(scrollToHistory, 0);
        } catch (refreshError) {
          setHistoryError(refreshError instanceof Error ? refreshError.message : "历史列表刷新失败，请手动搜索。");
          setReuseNotice("报价已导出。历史列表没有自动刷新，请点搜索或刷新页面查看。");
        }
      } catch (error) {
        setActionError(error instanceof Error ? error.message : "报价生成失败。");
      }
    });
  }

  function handleNewQuote() {
    if (
      selectedItems.size > 0 &&
      !window.confirm(`当前有 ${selectedItems.size} 个已选产品，确定清空开始新报价？`)
    ) {
      return;
    }
    resetQuoteDraft();
  }

  function handleReuseQuote(quoteId: string) {
    if (
      selectedItems.size > 0 &&
      !window.confirm(`当前已有 ${selectedItems.size} 个已选产品，复用会替换。继续？`)
    ) {
      return;
    }

    setActionError(null);
    setReuseNotice(null);
    setReusingQuoteId(quoteId);
    startTransition(async () => {
      try {
        const draft = await reuseQuote(quoteId);
        const nextSelectedItems = new Map(draft.selectedItems);
        setSelectedItems(nextSelectedItems);
        setCustomerName(draft.customerName);
        setProfitMargin(draft.profitMargin);
        setCurrency(draft.currency);
        setExchangeRate(draft.exchangeRate);
        setLastEditableExchangeRate(draft.lastEditableExchangeRate);
        setCustomerMode(draft.customerMode);
        setMode("editing");
        setPreview(null);
        setWarningFilter(new Set());

        const noticeParts = [`已加载 ${nextSelectedItems.size} 个产品`];
        if (draft.skippedItems.length > 0) {
          noticeParts.push(
            `跳过 ${draft.skippedItems.length} 个：${draft.skippedItems
              .map((item) => `${item.label}（${item.reason}）`)
              .join("；")}`,
          );
        }
        if (draft.warnings.length > 0) {
          noticeParts.push(draft.warnings.join("；"));
        }
        setReuseNotice(noticeParts.join("；"));
        window.scrollTo({ top: 0, behavior: "smooth" });
      } catch (error) {
        setActionError(error instanceof Error ? error.message : "复用报价失败。");
      } finally {
        setReusingQuoteId(null);
      }
    });
  }

  function handleHistoryFilterChange(key: keyof Required<QuoteSearchFilters>, value: string) {
    setHistoryFilters((current) => ({ ...current, [key]: value }));
  }

  function handleSearchHistory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setHistoryError(null);
    startHistoryTransition(async () => {
      try {
        await refreshHistoryQuotes(historyFilters);
      } catch (error) {
        setHistoryError(error instanceof Error ? error.message : "历史报价搜索失败。");
      }
    });
  }

  function handleToggleQuoteDetail(quoteId: string) {
    if (expandedQuoteId === quoteId) {
      setExpandedQuoteId(null);
      return;
    }

    if (quoteDetails.has(quoteId)) {
      setExpandedQuoteId(quoteId);
      return;
    }

    setHistoryError(null);
    setLoadingQuoteId(quoteId);
    startHistoryTransition(async () => {
      try {
        const detail = await getQuoteDetail(quoteId);
        setQuoteDetails((current) => {
          const next = new Map(current);
          next.set(quoteId, detail);
          return next;
        });
        setExpandedQuoteId(quoteId);
      } catch (error) {
        setHistoryError(error instanceof Error ? error.message : "报价详情加载失败。");
      } finally {
        setLoadingQuoteId(null);
      }
    });
  }

  function clearSelectedItemsAfterExport() {
    setSelectedItems(new Map());
    setMode("editing");
    setPreview(null);
    setWarningFilter(new Set());
    setActionError(null);
    setReuseNotice(null);
    window.localStorage.removeItem(SELECTED_ITEMS_STORAGE_KEY);
  }

  async function refreshHistoryQuotes(filtersToUse: Required<QuoteSearchFilters>) {
    const results = await searchQuotes(filtersToUse);
    setHistoryQuotes(results);
    setExpandedQuoteId(null);
  }

  function scrollToHistory() {
    historySectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function resetQuoteDraft() {
    const draft = createDefaultQuoteDraft();
    setSelectedItems(draft.selectedItems);
    setCustomerName(draft.customerName);
    setProfitMargin(draft.profitMargin);
    setCurrency(draft.currency);
    setExchangeRate(draft.exchangeRate);
    setLastEditableExchangeRate(draft.lastEditableExchangeRate);
    setCustomerMode(draft.customerMode);
    setMode("editing");
    setPreview(null);
    setWarningFilter(new Set());
    setActionError(null);
    setReuseNotice(null);
    window.localStorage.removeItem(SELECTED_ITEMS_STORAGE_KEY);
    window.localStorage.setItem(
      QUOTE_PARAMS_STORAGE_KEY,
      JSON.stringify({
        customerName: draft.customerName,
        profitMargin: draft.profitMargin,
        currency: draft.currency,
        exchangeRate: draft.exchangeRate,
        lastEditableExchangeRate: draft.lastEditableExchangeRate,
        customerMode: draft.customerMode,
      }),
    );
  }

  function buildCurrentFormData(): FormData {
    return buildQuoteFormData({
      customerName,
      profitMargin,
      currency,
      exchangeRate: sameCurrencyMode ? "1" : exchangeRate,
      customerMode,
      selectedItems,
    });
  }

  return (
    <div className="mx-auto max-w-7xl">
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <div className="text-sm font-semibold uppercase tracking-[0.18em] text-leaf">Phase 6</div>
          <h1 className="mt-2 text-3xl font-semibold text-ink">报价中心</h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleNewQuote}
            className="inline-flex h-10 items-center gap-2 rounded-md border border-line bg-paper px-4 text-sm font-semibold text-ink shadow-panel hover:border-leaf"
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            新建报价
          </button>
          <button
            type="button"
            onClick={scrollToHistory}
            className="inline-flex h-10 items-center gap-2 rounded-md border border-line bg-paper px-4 text-sm font-semibold text-ink shadow-panel hover:border-leaf"
          >
            <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
            {historyQuotes.length} 条历史报价
          </button>
        </div>
      </header>

      {filters.error || actionError ? (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {actionError ?? filters.error}
        </div>
      ) : null}
      {reuseNotice ? (
        <div className="mb-4 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          {reuseNotice}
        </div>
      ) : null}

      <section className="mb-4 rounded-md border border-line bg-paper p-4 shadow-panel">
        <form className="space-y-3">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_180px_auto]">
            <Field label="搜索产品">
              <input
                name="search"
                defaultValue={filters.search}
                placeholder="产品名 / 款号 / 类目"
                className={inputClass}
              />
            </Field>
            <Field label="品类">
              <select name="category" defaultValue={filters.category} className={selectClass}>
                <option value="">全部品类</option>
                {categories.map((category) => (
                  <option key={category.category} value={category.category}>
                    {category.category} ({category.count})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="工厂">
              <input name="factory" defaultValue={filters.factory} placeholder="工厂名" className={inputClass} />
            </Field>
            <div className="flex items-end">
              <button className="inline-flex h-10 items-center gap-2 rounded-md bg-ink px-4 text-sm font-semibold text-white">
                <Search className="h-4 w-4" aria-hidden="true" />
                筛选
              </button>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-4 xl:grid-cols-7">
            <Field label="最小功率">
              <input name="minWatts" defaultValue={filters.minWatts} placeholder="10" className={inputClass} />
            </Field>
            <Field label="最大功率">
              <input name="maxWatts" defaultValue={filters.maxWatts} placeholder="50" className={inputClass} />
            </Field>
            <Field label="IP">
              <select name="ip" defaultValue={filters.ip} className={selectClass}>
                <option value="">不限</option>
                {ipOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.value} ({option.count})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="色温">
              <select name="cct" defaultValue={filters.cct} className={selectClass}>
                <option value="">不限</option>
                {cctOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.value}K ({option.count})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="电压">
              <select name="voltage" defaultValue={filters.voltage} className={selectClass}>
                <option value="">不限</option>
                {voltageOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {formatVoltageOption(option.value)} ({option.count})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="材质">
              <select name="material" defaultValue={filters.material} className={selectClass}>
                <option value="">不限</option>
                {materialOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.value} ({option.count})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="排序">
              <select name="sort" defaultValue={filters.sort} className={selectClass}>
                <option value="">默认</option>
                <option value="price-asc">价格 ↑</option>
                <option value="price-desc">价格 ↓</option>
                <option value="newest">最新</option>
                <option value="name">名称</option>
              </select>
            </Field>
          </div>
        </form>
      </section>

      <div>
        <div className={mode === "editing" ? "" : "hidden"}>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="space-y-4">
              <SelectedProductsTable
                selectedItems={selectedItems}
                onUpdate={updateSelectedItem}
                onRemove={removeSelectedProduct}
              />
              <ProductSelectionTable
                products={products}
                shouldLoadProducts={shouldLoadProducts}
                selectedProductIds={selectedProductIds}
                onAdd={addSelectedProduct}
              />
            </div>
            <QuoteParameterPanel
              customerName={customerName}
              profitMargin={profitMargin}
              currency={currency}
              exchangeRate={sameCurrencyMode ? "1" : exchangeRate}
              customerMode={customerMode}
              exchangeRateDisabled={sameCurrencyMode}
              isPending={isPending}
              onCustomerNameChange={setCustomerName}
              onProfitMarginChange={setProfitMargin}
              onCurrencyChange={handleCurrencyChange}
              onExchangeRateChange={handleExchangeRateChange}
              onCustomerModeChange={setCustomerMode}
              onPreview={handlePreview}
            />
          </div>
        </div>

        {mode === "previewing" && preview ? (
          <QuotePreviewPanel
            preview={preview}
            warningFilter={warningFilter}
            isPending={isPending}
            onBack={() => setMode("editing")}
            onExport={handleExport}
            onWarningFilterChange={setWarningFilter}
          />
        ) : null}
      </div>

      <div ref={historySectionRef}>
        <QuoteHistoryTable
          quotes={historyQuotes}
          filters={historyFilters}
          details={quoteDetails}
          expandedQuoteId={expandedQuoteId}
          loadingQuoteId={loadingQuoteId}
          reusingQuoteId={reusingQuoteId}
          isPending={isHistoryPending}
          error={historyError}
          onFilterChange={handleHistoryFilterChange}
          onSearch={handleSearchHistory}
          onToggleDetail={handleToggleQuoteDetail}
          onReuseQuote={handleReuseQuote}
        />
      </div>
    </div>
  );
}

function SelectedProductsTable({
  selectedItems,
  onUpdate,
  onRemove,
}: {
  selectedItems: Map<string, SelectedQuoteItem>;
  onUpdate: (productId: string, updater: (item: SelectedQuoteItem) => SelectedQuoteItem) => void;
  onRemove: (productId: string) => void;
}) {
  const items = Array.from(selectedItems.values());
  const [expandedOfferProducts, setExpandedOfferProducts] = useState<Set<string>>(new Set());

  function toggleOfferList(productId: string) {
    setExpandedOfferProducts((current) => {
      const next = new Set(current);
      if (next.has(productId)) {
        next.delete(productId);
      } else {
        next.add(productId);
      }
      return next;
    });
  }

  return (
    <section className="rounded-md border border-line bg-paper shadow-panel">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <h2 className="text-lg font-semibold text-ink">已选产品</h2>
          <div className="mt-1 text-xs text-stone-500">跨搜索保留，导出时只使用这里的产品。</div>
        </div>
        <div className="rounded-md border border-line bg-white px-3 py-1.5 text-sm font-semibold text-ink">
          {items.length} 个产品
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-[#ebe5d8] text-xs uppercase tracking-[0.08em] text-stone-600">
            <tr>
              <th className="px-3 py-3">产品</th>
              <th className="px-3 py-3">Supplier Offer</th>
              <th className="px-3 py-3">数量</th>
              <th className="px-3 py-3">备注</th>
              <th className="px-3 py-3">检查</th>
              <th className="px-3 py-3">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line bg-white">
            {items.map((item) => {
              const product = item.product;
              const selectedOffer = resolveSelectedOffer(item);
              const health = buildQuoteHealth(withSizeParamSignal(product));
              const rankedOffers = rankOffers(product.supplierOffers);
              const offerById = new Map(product.supplierOffers.map((offer) => [offer.id, offer]));
              const selectedScore = rankedOffers.find((score) => score.offerId === item.selectedOfferId);
              const isExpanded = expandedOfferProducts.has(product.id);

              return (
                <tr key={product.id} className="align-top">
                  <td className="min-w-56 px-3 py-3">
                    <div className="font-semibold text-ink">{product.productName}</div>
                    <div className="mt-1 text-xs text-stone-600">{product.modelNo ?? "-"}</div>
                    <QuoteParamTags product={product} />
                  </td>
                  <td className="min-w-72 px-3 py-3">
                    <SelectedOfferPicker
                      offers={product.supplierOffers}
                      rankedOffers={rankedOffers}
                      offerById={offerById}
                      selectedOfferId={item.selectedOfferId}
                      selectedOffer={selectedOffer}
                      selectedScore={selectedScore}
                      expanded={isExpanded}
                      onToggle={() => toggleOfferList(product.id)}
                      onSelect={(offerId) =>
                        onUpdate(product.id, (current) => ({
                          ...current,
                          selectedOfferId: offerId,
                        }))
                      }
                    />
                    <HistoricalPriceReference quotes={product.historicalQuotes ?? []} />
                  </td>
                  <td className="w-28 px-3 py-3">
                    <input
                      value={item.quantity}
                      className={inputClass}
                      onChange={(event) =>
                        onUpdate(product.id, (current) => ({
                          ...current,
                          quantity: event.target.value,
                        }))
                      }
                    />
                  </td>
                  <td className="min-w-52 px-3 py-3">
                    <input
                      value={item.remark}
                      className={inputClass}
                      onChange={(event) =>
                        onUpdate(product.id, (current) => ({
                          ...current,
                          remark: event.target.value,
                        }))
                      }
                    />
                  </td>
                  <td className="min-w-48 px-3 py-3">
                    <QuoteHealthSummary health={health} />
                    {health.totalIssueCount > 0 ? (
                      <Link
                        href={`/products?productId=${product.id}#product-${product.id}`}
                        className="mt-2 inline-flex text-xs font-semibold text-leaf underline-offset-2 hover:underline"
                      >
                        去产品库补资料
                      </Link>
                    ) : null}
                  </td>
                  <td className="px-3 py-3">
                    <button
                      type="button"
                      onClick={() => onRemove(product.id)}
                      className="inline-flex h-9 items-center gap-2 rounded-md border border-line bg-white px-3 text-sm font-semibold text-stone-700 hover:border-red-200 hover:text-red-700"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                      移除
                    </button>
                  </td>
                </tr>
              );
            })}
            {items.length === 0 ? (
              <tr>
                <td className="px-3 py-8 text-center text-stone-500" colSpan={6}>
                  还没有已选产品。先在下方搜索结果里加入产品。
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ProductSelectionTable({
  products,
  shouldLoadProducts,
  selectedProductIds,
  onAdd,
}: {
  products: QuoteProductOption[];
  shouldLoadProducts: boolean;
  selectedProductIds: Set<string>;
  onAdd: (product: QuoteProductOption) => void;
}) {
  return (
    <section className="rounded-md border border-line bg-paper shadow-panel">
      <div className="border-b border-line px-4 py-3">
        <h2 className="text-lg font-semibold text-ink">搜索结果</h2>
        <div className="mt-1 text-xs text-stone-500">
          {shouldLoadProducts ? `显示 ${products.length} 条匹配产品` : "先搜索产品或工厂，再加入报价。"}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-[#ebe5d8] text-xs uppercase tracking-[0.08em] text-stone-600">
            <tr>
              <th className="px-3 py-3">操作</th>
              <th className="px-3 py-3">产品</th>
              <th className="px-3 py-3">材质 / 尺寸</th>
              <th className="px-3 py-3">报价概况</th>
              <th className="px-3 py-3">检查</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line bg-white">
            {products.map((product) => {
              const health = buildQuoteHealth(withSizeParamSignal(product));
              const isSelected = selectedProductIds.has(product.id);
              const rankedOffers = rankOffers(product.supplierOffers);
              const offerById = new Map(product.supplierOffers.map((offer) => [offer.id, offer]));

              return (
                <tr key={product.id} className="align-top">
                  <td className="px-3 py-3">
                    {isSelected ? (
                      <span className="inline-flex h-9 items-center rounded-md border border-green-200 bg-green-50 px-3 text-sm font-semibold text-green-700">
                        已选
                      </span>
                    ) : (
                      <button
                        type="button"
                        disabled={product.supplierOffers.length === 0}
                        onClick={() => onAdd(product)}
                        className="inline-flex h-9 items-center gap-2 rounded-md bg-ink px-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Plus className="h-4 w-4" aria-hidden="true" />
                        加入
                      </button>
                    )}
                  </td>
                  <td className="min-w-56 px-3 py-3">
                    <div className="font-semibold text-ink">{product.productName}</div>
                    <div className="mt-1 text-xs text-stone-600">{product.modelNo ?? "-"}</div>
                  </td>
                  <td className="min-w-44 px-3 py-3 text-stone-700">
                    <div>{product.material ?? "-"}</div>
                    <div className="mt-1 text-xs text-stone-600">{product.size ?? "-"}</div>
                  </td>
                  <td className="min-w-72 px-3 py-3">
                    {product.supplierOffers.length > 0 ? (
                      <>
                        <RankedOfferSummary rankedOffers={rankedOffers} offerById={offerById} />
                        <QuoteOfferHealthList health={health} />
                      </>
                    ) : (
                      <span className="text-stone-500">暂无 supplier_offer</span>
                    )}
                  </td>
                  <td className="min-w-48 px-3 py-3">
                    <QuoteHealthSummary health={health} />
                    {health.totalIssueCount > 0 ? (
                      <Link
                        href={`/products?productId=${product.id}#product-${product.id}`}
                        className="mt-2 inline-flex text-xs font-semibold text-leaf underline-offset-2 hover:underline"
                      >
                        去产品库补资料
                      </Link>
                    ) : null}
                  </td>
                </tr>
              );
            })}
            {products.length === 0 ? (
              <tr>
                <td className="px-3 py-8 text-center text-stone-500" colSpan={5}>
                  {shouldLoadProducts ? "没有符合条件的产品。" : "输入产品名、款号、类目或工厂后显示产品。"}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SelectedOfferPicker({
  offers,
  rankedOffers,
  offerById,
  selectedOfferId,
  selectedOffer,
  selectedScore,
  expanded,
  onToggle,
  onSelect,
}: {
  offers: QuoteProductOption["supplierOffers"];
  rankedOffers: OfferScore[];
  offerById: Map<string, QuoteProductOption["supplierOffers"][number]>;
  selectedOfferId: string;
  selectedOffer: QuoteProductOption["supplierOffers"][number] | null;
  selectedScore: OfferScore | undefined;
  expanded: boolean;
  onToggle: () => void;
  onSelect: (offerId: string) => void;
}) {
  if (!selectedOffer) {
    return <div className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-800">未选择报价</div>;
  }

  return (
    <div>
      <div className="rounded-md border border-line bg-white p-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-ink">{selectedOffer.factoryName}</span>
              <span className="font-semibold text-ink">{formatMoney(selectedOffer.purchasePrice, selectedOffer.currency)}</span>
              <QuoteOfferBadgeList badges={selectedScore?.badges ?? []} compact />
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-stone-500">
              <span>采购币种 {selectedOffer.currency}</span>
              <span>MOQ {selectedOffer.moq ?? "-"}</span>
              <span>CTN {selectedOffer.ctnQty ?? "-"}</span>
            </div>
          </div>
          {offers.length > 1 ? (
            <button
              type="button"
              onClick={onToggle}
              className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-line bg-white px-2 text-xs font-semibold text-stone-700 hover:border-leaf"
            >
              {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              切换报价
            </button>
          ) : null}
        </div>
      </div>

      {expanded && offers.length > 1 ? (
        <div className="mt-2 space-y-1">
          {rankedOffers.map((score) => {
            const offer = offerById.get(score.offerId);
            if (!offer) {
              return null;
            }
            const isSelected = offer.id === selectedOfferId;
            return (
              <button
                key={offer.id}
                type="button"
                onClick={() => onSelect(offer.id)}
                className={`w-full rounded-md border p-2 text-left text-sm ${
                  isSelected ? "border-leaf bg-leaf/5" : "border-line bg-white hover:border-leaf"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-ink">{offer.factoryName}</span>
                  <span className="whitespace-nowrap font-semibold text-ink">{formatMoney(offer.purchasePrice, offer.currency)}</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-stone-500">
                  <span>MOQ {offer.moq ?? "-"}</span>
                  <span>CTN {offer.ctnQty ?? "-"}</span>
                  <span>{formatOfferUpdatedAt(offer.priceUpdatedAt)}</span>
                </div>
                <QuoteOfferBadgeList badges={score.badges} />
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function HistoricalPriceReference({ quotes }: { quotes: NonNullable<QuoteProductOption["historicalQuotes"]> }) {
  if (quotes.length === 0) {
    return null;
  }

  const latest = quotes[0];
  const totalCount = latest?.totalCount ?? quotes.length;
  const hiddenCount = Math.max(0, totalCount - quotes.length);

  return (
    <details className="mt-2 rounded-md border border-amber-200 bg-amber-50/70 text-xs text-stone-700">
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-2 py-2 [&::-webkit-details-marker]:hidden">
        <span className="inline-flex items-center gap-1.5 font-semibold text-ink">
          <FileSpreadsheet className="h-3.5 w-3.5 text-amber-700" aria-hidden="true" />
          历史售价参考 ({totalCount}条)
        </span>
        <span className="text-stone-600">
          最近: {formatHistoricalUsd(latest.salePriceUsd)} ({formatHistoricalQuoteDate(latest.quoteDate)},{" "}
          {formatHistoricalCustomer(latest.customerName)})
        </span>
      </summary>
      <div className="border-t border-amber-200 bg-white/80">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead className="bg-amber-100/70 text-[11px] uppercase tracking-[0.06em] text-stone-600">
              <tr>
                <th className="px-2 py-1.5">日期</th>
                <th className="px-2 py-1.5">客户</th>
                <th className="px-2 py-1.5 text-right">FOB USD</th>
                <th className="px-2 py-1.5">来源文件</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-amber-100">
              {quotes.map((quote, index) => (
                <tr key={`${quote.fileName}:${quote.quoteDate ?? "unknown"}:${quote.salePriceUsd}:${index}`}>
                  <td className="whitespace-nowrap px-2 py-1.5">{formatHistoricalQuoteDate(quote.quoteDate)}</td>
                  <td className="whitespace-nowrap px-2 py-1.5">{formatHistoricalCustomer(quote.customerName)}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right font-semibold text-ink">
                    {formatHistoricalUsd(quote.salePriceUsd)}
                  </td>
                  <td className="max-w-64 truncate px-2 py-1.5" title={quote.fileName}>
                    {quote.fileName}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {hiddenCount > 0 ? (
          <div className="border-t border-amber-100 px-2 py-1.5 text-stone-500">
            还有 {hiddenCount} 条更早记录
          </div>
        ) : null}
      </div>
    </details>
  );
}

function RankedOfferSummary({
  rankedOffers,
  offerById,
}: {
  rankedOffers: OfferScore[];
  offerById: Map<string, QuoteProductOption["supplierOffers"][number]>;
}) {
  return (
    <div className="space-y-1">
      <div className="font-medium text-ink">{rankedOffers.length} 条报价</div>
      {rankedOffers.slice(0, 3).map((score) => {
        const offer = offerById.get(score.offerId);
        if (!offer) {
          return null;
        }
        return (
          <div key={offer.id} className="flex flex-wrap items-center gap-2 text-xs text-stone-600">
            {score.badges.includes("recommended") ? (
              <span className="rounded border border-amber-200 bg-amber-100 px-1 text-amber-800">推荐</span>
            ) : null}
            <span className="font-medium text-ink">{offer.factoryName}</span>
            <span>{formatMoney(offer.purchasePrice, offer.currency)}</span>
            {offer.moq ? <span className="text-stone-500">MOQ {offer.moq}</span> : null}
          </div>
        );
      })}
    </div>
  );
}

function QuoteOfferBadgeList({ badges, compact = false }: { badges: OfferBadge[]; compact?: boolean }) {
  if (badges.length === 0) {
    return null;
  }

  return (
    <div className={`flex flex-wrap gap-1 ${compact ? "" : "mt-1"}`}>
      {sortOfferBadges(badges).map((badge) => {
        const meta = OFFER_BADGE_META[badge];
        return (
          <span key={badge} className={`rounded border px-1.5 py-0.5 text-xs font-semibold ${meta.className}`}>
            {meta.label}
          </span>
        );
      })}
    </div>
  );
}

function sortOfferBadges(badges: OfferBadge[]): OfferBadge[] {
  const order: OfferBadge[] = ["recommended", "lowest-price", "most-complete", "newest"];
  return [...badges].sort((left, right) => order.indexOf(left) - order.indexOf(right));
}

function formatOfferUpdatedAt(value: string | null | undefined): string {
  if (!value) {
    return "更新 -";
  }

  try {
    const date = new Date(value);
    const timestamp = date.getTime();
    if (!Number.isFinite(timestamp)) {
      return "更新 -";
    }

    const ageInDays = Math.max(0, Math.floor((Date.now() - timestamp) / (24 * 60 * 60 * 1000)));
    if (ageInDays < 30) {
      return ageInDays <= 0 ? "今天更新" : `${ageInDays}天前更新`;
    }
    if (ageInDays < 365) {
      return `${Math.floor(ageInDays / 30)}个月前更新`;
    }
    return `${date.toISOString().slice(0, 10)} 更新`;
  } catch {
    return "更新 -";
  }
}

function formatHistoricalUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

function formatHistoricalQuoteDate(value: string | null): string {
  return value?.trim() || "日期未知";
}

function formatHistoricalCustomer(value: string | null): string {
  return value?.trim() || "（内部核价）";
}

function QuoteParamTags({ product }: { product: QuoteProductOption }) {
  const params = product.displayParams ?? [];
  const tags = sortDisplayParams(params)
    .map((param) => formatParamLabel(param))
    .filter((label) => label.length > 0)
    .slice(0, 6);

  if (tags.length === 0) {
    return null;
  }

  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {tags.map((label, index) => (
        <span
          key={`${label}-${index}`}
          className="rounded-sm border border-stone-200 bg-stone-50 px-1.5 py-0.5 text-xs font-medium text-stone-600"
        >
          {label}
        </span>
      ))}
    </div>
  );
}

function QuoteParameterPanel({
  customerName,
  profitMargin,
  currency,
  exchangeRate,
  customerMode,
  exchangeRateDisabled,
  isPending,
  onCustomerNameChange,
  onProfitMarginChange,
  onCurrencyChange,
  onExchangeRateChange,
  onCustomerModeChange,
  onPreview,
}: {
  customerName: string;
  profitMargin: string;
  currency: string;
  exchangeRate: string;
  customerMode: boolean;
  exchangeRateDisabled: boolean;
  isPending: boolean;
  onCustomerNameChange: (value: string) => void;
  onProfitMarginChange: (value: string) => void;
  onCurrencyChange: (value: string) => void;
  onExchangeRateChange: (value: string) => void;
  onCustomerModeChange: (value: boolean) => void;
  onPreview: () => void;
}) {
  return (
    <aside className="space-y-4">
      <section className="rounded-md border border-line bg-paper p-4 shadow-panel">
        <h2 className="mb-3 text-lg font-semibold text-ink">报价参数</h2>
        <div className="grid gap-3">
          <Field label="客户名">
            <input value={customerName} onChange={(event) => onCustomerNameChange(event.target.value)} className={inputClass} />
          </Field>
          <Field label="利润率">
            <input
              value={profitMargin}
              onChange={(event) => onProfitMarginChange(event.target.value)}
              placeholder="0.2 = 20%"
              className={inputClass}
            />
          </Field>
          <Field label="报价币种">
            <select value={currency} onChange={(event) => onCurrencyChange(event.target.value)} className={selectClass}>
              <option value="USD">USD</option>
              <option value="RMB">RMB</option>
              <option value="EUR">EUR</option>
            </select>
          </Field>
          <Field label="汇率（1 报价币种 = ? 采购币种）">
            <input
              value={exchangeRate}
              disabled={exchangeRateDisabled}
              onChange={(event) => onExchangeRateChange(event.target.value)}
              placeholder="USD → RMB 填 7.2"
              className={`${inputClass} disabled:bg-stone-100 disabled:text-stone-500`}
            />
            {exchangeRateDisabled ? (
              <div className="mt-1 text-xs text-stone-500">报价币种和采购币种相同，汇率固定为 1。</div>
            ) : null}
          </Field>
          <label className="flex items-center gap-3 rounded-md border border-line bg-white px-3 py-2 text-sm text-stone-700">
            <input
              type="checkbox"
              checked={customerMode}
              onChange={(event) => onCustomerModeChange(event.target.checked)}
              className="h-4 w-4 accent-leaf"
            />
            <span>客户模式：隐藏工厂和采购价</span>
          </label>
        </div>
        <button
          type="button"
          disabled={isPending}
          onClick={onPreview}
          className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-ink px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
          {isPending ? "生成预览中..." : "预览报价"}
        </button>
      </section>
    </aside>
  );
}

function QuotePreviewPanel({
  preview,
  warningFilter,
  isPending,
  onBack,
  onExport,
  onWarningFilterChange,
}: {
  preview: QuotePreviewData;
  warningFilter: Set<WarningTier>;
  isPending: boolean;
  onBack: () => void;
  onExport: () => void;
  onWarningFilterChange: (value: Set<WarningTier>) => void;
}) {
  const problemRows = preview.rows.filter((row) => row.warnings.length > 0);
  const sortedRows = [...preview.rows].sort((left, right) => getRowWarningPriority(left) - getRowWarningPriority(right));
  const visibleRows =
    warningFilter.size === 0
      ? sortedRows
      : sortedRows.filter((row) => row.warnings.some((warning) => warningFilter.has(warning.tier)));
  const customerWarnings = preview.tierCounts.customer;
  const totalWarnings = preview.totalWarnings;

  function toggleWarningFilter(tier: WarningTier, checked: boolean) {
    const nextFilter = new Set(warningFilter);
    if (checked) {
      nextFilter.add(tier);
    } else {
      nextFilter.delete(tier);
    }
    onWarningFilterChange(nextFilter);
  }

  return (
    <section className="rounded-md border border-line bg-paper shadow-panel">
      <div className="border-b border-line px-4 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold uppercase tracking-[0.18em] text-leaf">Preview</div>
            <h2 className="mt-1 text-2xl font-semibold text-ink">报价预览</h2>
          </div>
          <PreviewWarningBadges tierCounts={preview.tierCounts} totalWarnings={totalWarnings} />
        </div>
        <div className="mt-4 grid gap-2 text-sm text-stone-700 md:grid-cols-3 xl:grid-cols-6">
          <PreviewStat label="客户" value={preview.customerName} />
          <PreviewStat label="币种" value={preview.currency} />
          <PreviewStat label="利润率" value={`${preview.profitMargin * 100}%`} />
          <PreviewStat label="汇率" value={preview.exchangeRate === null ? "-" : String(preview.exchangeRate)} />
          <PreviewStat label="采购币种" value={preview.purchaseCurrency} />
          <PreviewStat label="产品数" value={String(preview.rows.length)} />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-white px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          {WARNING_TIER_ORDER.map((tier) => (
            <label key={tier} className="inline-flex items-center gap-2 text-sm font-medium text-stone-700">
              <input
                type="checkbox"
                checked={warningFilter.has(tier)}
                onChange={(event) => toggleWarningFilter(tier, event.target.checked)}
                className="h-4 w-4 accent-leaf"
              />
              {WARNING_TIER_META[tier].label}
            </label>
          ))}
        </div>
        <div className="text-sm text-stone-600">
          客户可见 {preview.tierCounts.customer} / 报价风险 {preview.tierCounts.quote} / 物流{" "}
          {preview.tierCounts.logistics} / 问题行 {problemRows.length} / 共 {preview.rows.length} 行
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-[#3F4A35] text-xs uppercase tracking-[0.08em] text-white">
            <tr>
              <th className="px-3 py-3">Model Name</th>
              <th className="px-3 py-3">Product Details</th>
              <th className="px-3 py-3 text-right">Unit Price</th>
              <th className="px-3 py-3">MOQ</th>
              <th className="px-3 py-3">CTN Qty</th>
              <th className="px-3 py-3">L</th>
              <th className="px-3 py-3">W</th>
              <th className="px-3 py-3">H</th>
              <th className="px-3 py-3">Volume</th>
              <th className="px-3 py-3">Remark</th>
              <th className="px-3 py-3">检查</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line bg-white">
            {visibleRows.map((row) => (
              <PreviewRow key={`${row.productId}:${row.supplierOfferId}`} row={row} />
            ))}
            {visibleRows.length === 0 ? (
              <tr>
                <td className="px-3 py-8 text-center text-stone-500" colSpan={11}>
                  当前没有匹配的警告行。
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-4">
        <button
          type="button"
          onClick={onBack}
          className="h-10 rounded-md border border-line bg-white px-4 text-sm font-semibold text-stone-700"
        >
          返回修改
        </button>
        <div className="flex flex-wrap items-center gap-3">
          {customerWarnings > 0 ? (
            <span className="text-sm font-semibold text-red-800">有 {customerWarnings} 条客户可见问题，建议修复后再导出</span>
          ) : totalWarnings > 0 ? (
            <span className="text-sm text-amber-800">有 {totalWarnings} 条警告，仍要导出？</span>
          ) : null}
          <button
            type="button"
            disabled={isPending}
            onClick={onExport}
            className="inline-flex h-10 items-center gap-2 rounded-md bg-ink px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
            {isPending ? "正在导出..." : "确认导出"}
          </button>
        </div>
      </div>
    </section>
  );
}

function PreviewRow({ row }: { row: QuotePreviewRow }) {
  const highestTier = getHighestWarningTier(row.warnings);
  const groupedWarnings = groupWarningsByTier(row.warnings);

  return (
    <tr className={`align-top ${highestTier ? WARNING_TIER_META[highestTier].rowClass : ""}`}>
      <td className="min-w-36 px-3 py-3 font-semibold text-ink">{row.modelNo || "-"}</td>
      <td className="max-w-sm whitespace-pre-line px-3 py-3 text-stone-700">{row.productDetails || "-"}</td>
      <td className="whitespace-nowrap px-3 py-3 text-right font-semibold text-ink">{row.salePriceDisplay}</td>
      <td className="whitespace-nowrap px-3 py-3">{row.moq || "-"}</td>
      <td className="whitespace-nowrap px-3 py-3">{row.ctnQty || "-"}</td>
      <td className="whitespace-nowrap px-3 py-3">{row.ctnL || "-"}</td>
      <td className="whitespace-nowrap px-3 py-3">{row.ctnW || "-"}</td>
      <td className="whitespace-nowrap px-3 py-3">{row.ctnH || "-"}</td>
      <td className="whitespace-nowrap px-3 py-3">{row.volume || "-"}</td>
      <td className="min-w-40 px-3 py-3">{row.remark || "-"}</td>
      <td className="min-w-48 px-3 py-3">
        {highestTier ? (
          <div className="space-y-2 text-xs">
            {WARNING_TIER_ORDER.map((tier) =>
              groupedWarnings[tier].length > 0 ? (
                <div key={tier} className={WARNING_TIER_META[tier].textClass}>
                  <div className="font-semibold">{WARNING_TIER_META[tier].label}</div>
                  {groupedWarnings[tier].map((warning) => (
                    <div key={`${tier}:${warning.message}`}>{warning.message}</div>
                  ))}
                </div>
              ) : null,
            )}
            <Link
              href={`/products?productId=${row.productId}#product-${row.productId}`}
              className="inline-flex font-semibold text-leaf underline-offset-2 hover:underline"
            >
              去产品库补资料
            </Link>
          </div>
        ) : (
          <span className="text-xs font-medium text-green-700">通过</span>
        )}
      </td>
    </tr>
  );
}

function PreviewWarningBadges({
  tierCounts,
  totalWarnings,
}: {
  tierCounts: Record<WarningTier, number>;
  totalWarnings: number;
}) {
  if (totalWarnings === 0) {
    return (
      <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">无警告</div>
    );
  }

  return (
    <div className="flex flex-wrap justify-end gap-2">
      {WARNING_TIER_ORDER.map((tier) =>
        tierCounts[tier] > 0 ? (
          <div key={tier} className={`rounded-md border px-3 py-2 text-sm ${WARNING_TIER_META[tier].badgeClass}`}>
            {WARNING_TIER_META[tier].label} {tierCounts[tier]}
          </div>
        ) : null,
      )}
    </div>
  );
}

function QuoteHistoryTable({
  quotes,
  filters,
  details,
  expandedQuoteId,
  loadingQuoteId,
  reusingQuoteId,
  isPending,
  error,
  onFilterChange,
  onSearch,
  onToggleDetail,
  onReuseQuote,
}: {
  quotes: QuoteHistoryRow[];
  filters: Required<QuoteSearchFilters>;
  details: Map<string, QuoteDetail>;
  expandedQuoteId: string | null;
  loadingQuoteId: string | null;
  reusingQuoteId: string | null;
  isPending: boolean;
  error: string | null;
  onFilterChange: (key: keyof Required<QuoteSearchFilters>, value: string) => void;
  onSearch: (event: FormEvent<HTMLFormElement>) => void;
  onToggleDetail: (quoteId: string) => void;
  onReuseQuote: (quoteId: string) => void;
}) {
  return (
    <section className="mt-6 rounded-md border border-line bg-paper shadow-panel">
      <div className="border-b border-line px-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-ink">历史报价</h2>
            <div className="mt-1 text-xs text-stone-500">搜索旧报价，点击行查看明细和下载 Excel。</div>
          </div>
          <div className="rounded-md border border-line bg-white px-3 py-1.5 text-sm font-semibold text-ink">
            {quotes.length} 条
          </div>
        </div>

        <form className="mt-4 grid gap-3 lg:grid-cols-[1fr_150px_150px_130px_1fr_auto]" onSubmit={onSearch}>
          <Field label="客户名">
            <input
              value={filters.customerName}
              onChange={(event) => onFilterChange("customerName", event.target.value)}
              placeholder="客户报价测试"
              className={inputClass}
            />
          </Field>
          <Field label="日期从">
            <input
              type="date"
              value={filters.dateFrom}
              onChange={(event) => onFilterChange("dateFrom", event.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="到">
            <input
              type="date"
              value={filters.dateTo}
              onChange={(event) => onFilterChange("dateTo", event.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="币种">
            <select
              value={filters.currency}
              onChange={(event) => onFilterChange("currency", event.target.value)}
              className={selectClass}
            >
              <option value="ALL">全部</option>
              <option value="USD">USD</option>
              <option value="RMB">RMB</option>
              <option value="EUR">EUR</option>
            </select>
          </Field>
          <Field label="产品关键词">
            <input
              value={filters.productKeyword}
              onChange={(event) => onFilterChange("productKeyword", event.target.value)}
              placeholder="model_no / 产品名"
              className={inputClass}
            />
          </Field>
          <div className="flex items-end">
            <button
              type="submit"
              disabled={isPending}
              className="inline-flex h-10 items-center gap-2 rounded-md bg-ink px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Search className="h-4 w-4" aria-hidden="true" />
              {isPending ? "搜索中..." : "搜索"}
            </button>
          </div>
        </form>
        {error ? (
          <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </div>
        ) : null}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-[#ebe5d8] text-xs uppercase tracking-[0.08em] text-stone-600">
            <tr>
              <th className="px-3 py-3">展开</th>
              <th className="px-3 py-3">客户</th>
              <th className="px-3 py-3">日期</th>
              <th className="px-3 py-3">币种</th>
              <th className="px-3 py-3">利润率</th>
              <th className="px-3 py-3">汇率方向</th>
              <th className="px-3 py-3">产品数</th>
              <th className="px-3 py-3">文件路径</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line bg-white">
            {quotes.map((quote) => {
              const detail = details.get(quote.id) ?? null;
              const expanded = expandedQuoteId === quote.id;
              const loading = loadingQuoteId === quote.id;

              return (
                <QuoteHistoryRowView
                  key={quote.id}
                  quote={quote}
                  detail={detail}
                  expanded={expanded}
                  loading={loading}
                  reusing={reusingQuoteId === quote.id}
                  onToggle={() => onToggleDetail(quote.id)}
                  onReuse={() => onReuseQuote(quote.id)}
                />
              );
            })}
            {quotes.length === 0 ? (
              <tr>
                <td className="px-3 py-8 text-center text-stone-500" colSpan={8}>
                  未找到匹配的历史报价。
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function QuoteHistoryRowView({
  quote,
  detail,
  expanded,
  loading,
  reusing,
  onToggle,
  onReuse,
}: {
  quote: QuoteHistoryRow;
  detail: QuoteDetail | null;
  expanded: boolean;
  loading: boolean;
  reusing: boolean;
  onToggle: () => void;
  onReuse: () => void;
}) {
  return (
    <>
      <tr className="align-top hover:bg-stone-50">
        <td className="px-3 py-3">
          <button
            type="button"
            onClick={onToggle}
            className="inline-flex h-8 items-center gap-1 rounded-md border border-line bg-white px-2 text-sm font-semibold text-stone-700 hover:border-leaf"
          >
            {expanded ? (
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
            ) : (
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            )}
            {loading ? "加载" : expanded ? "收起" : "详情"}
          </button>
        </td>
        <td className="px-3 py-3 font-semibold text-ink">{quote.customerName}</td>
        <td className="whitespace-nowrap px-3 py-3">{formatDateTime(new Date(quote.createdAt))}</td>
        <td className="px-3 py-3">{quote.currency}</td>
        <td className="px-3 py-3">{formatPercent(quote.profitMargin)}</td>
        <td className="px-3 py-3">
          {quote.exchangeRate ? `1 ${quote.currency} = ${quote.exchangeRate} 采购币种` : "-"}
        </td>
        <td className="whitespace-nowrap px-3 py-3">{quote.itemCount} 个产品</td>
        <td className="max-w-xl break-all px-3 py-3 text-xs text-stone-600">{quote.filePath ?? "-"}</td>
      </tr>
      {expanded ? (
        <tr>
          <td colSpan={8} className="bg-stone-50 px-4 py-4">
            {detail ? (
              <QuoteDetailPanel detail={detail} reusing={reusing} onReuse={onReuse} />
            ) : (
              <div className="text-sm text-stone-500">加载详情中...</div>
            )}
          </td>
        </tr>
      ) : null}
    </>
  );
}

function QuoteDetailPanel({
  detail,
  reusing,
  onReuse,
}: {
  detail: QuoteDetail;
  reusing: boolean;
  onReuse: () => void;
}) {
  return (
    <div className="rounded-md border border-line bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="text-sm text-stone-700">
          <span className="font-semibold text-ink">{detail.customerName}</span>
          <span className="mx-2 text-stone-300">/</span>
          {formatDateTime(new Date(detail.createdAt))}
          <span className="mx-2 text-stone-300">/</span>
          {detail.currency}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {detail.filePath && detail.fileExists ? (
            <a
              href={`/api/quotes/${detail.id}/download`}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-line bg-white px-3 text-sm font-semibold text-stone-700 hover:border-leaf"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              下载 Excel
            </a>
          ) : (
            <span className="inline-flex h-9 items-center rounded-md border border-amber-200 bg-amber-50 px-3 text-sm font-semibold text-amber-800">
              文件已移动或删除
            </span>
          )}
          <button
            type="button"
            disabled={reusing}
            onClick={onReuse}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-line bg-white px-3 text-sm font-semibold text-stone-700 hover:border-leaf disabled:cursor-not-allowed disabled:bg-stone-100 disabled:text-stone-500"
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            {reusing ? "复用中..." : "复用此报价"}
          </button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-[#3F4A35] text-xs uppercase tracking-[0.08em] text-white">
            <tr>
              <th className="px-3 py-3">Model Name</th>
              <th className="px-3 py-3">Product Details</th>
              <th className="px-3 py-3 text-right">采购价</th>
              <th className="px-3 py-3 text-right">售价</th>
              <th className="px-3 py-3">MOQ</th>
              <th className="px-3 py-3">CTN Qty</th>
              <th className="px-3 py-3">数量</th>
              <th className="px-3 py-3">备注</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {detail.items.map((item) => (
              <tr key={`${item.modelNo}:${item.salePrice}:${item.quantity}`} className="align-top">
                <td className="min-w-44 px-3 py-3 font-semibold text-ink">{item.modelNo || "-"}</td>
                <td className="max-w-sm whitespace-pre-line px-3 py-3 text-stone-700">{item.productDetails || "-"}</td>
                <td className="whitespace-nowrap px-3 py-3 text-right">
                  {formatMoney(item.purchasePrice, item.purchaseCurrency)}
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-right font-semibold text-ink">
                  {formatMoney(item.salePrice, detail.currency)}
                </td>
                <td className="whitespace-nowrap px-3 py-3">{item.moq ?? "-"}</td>
                <td className="whitespace-nowrap px-3 py-3">{item.ctnQty ?? "-"}</td>
                <td className="whitespace-nowrap px-3 py-3">{item.quantity}</td>
                <td className="min-w-40 px-3 py-3">{item.remark ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(2).replace(/\.?0+$/, "")}%`;
}

function readStoredSelectedItems(): Map<string, SelectedQuoteItem> {
  try {
    const raw = window.localStorage.getItem(SELECTED_ITEMS_STORAGE_KEY);
    if (!raw) {
      return new Map();
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return new Map();
    }

    const items = parsed.filter(isStoredSelectedItemEntry);
    return new Map(items);
  } catch {
    return new Map();
  }
}

function readStoredQuoteParams():
  | {
      customerName: string;
      profitMargin: string;
      currency: string;
      exchangeRate: string;
      lastEditableExchangeRate: string;
      customerMode: boolean;
    }
  | null {
  try {
    const raw = window.localStorage.getItem(QUOTE_PARAMS_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<{
      customerName: unknown;
      profitMargin: unknown;
      currency: unknown;
      exchangeRate: unknown;
      lastEditableExchangeRate: unknown;
      customerMode: unknown;
    }>;

    return {
      customerName: typeof parsed.customerName === "string" ? parsed.customerName : "",
      profitMargin: typeof parsed.profitMargin === "string" ? parsed.profitMargin : "0.2",
      currency: typeof parsed.currency === "string" ? parsed.currency : "USD",
      exchangeRate: typeof parsed.exchangeRate === "string" ? parsed.exchangeRate : "7.2",
      lastEditableExchangeRate:
        typeof parsed.lastEditableExchangeRate === "string" ? parsed.lastEditableExchangeRate : "7.2",
      customerMode: typeof parsed.customerMode === "boolean" ? parsed.customerMode : true,
    };
  } catch {
    return null;
  }
}

function isStoredSelectedItemEntry(value: unknown): value is [string, SelectedQuoteItem] {
  if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== "string") {
    return false;
  }

  const item = value[1] as Partial<SelectedQuoteItem> | undefined;
  const product = item?.product as Partial<QuoteSelectionProduct> | undefined;
  return (
    typeof item?.selectedOfferId === "string" &&
    typeof item?.quantity === "string" &&
    typeof item?.remark === "string" &&
    typeof product?.id === "string" &&
    typeof product?.productName === "string" &&
    Array.isArray(product?.supplierOffers)
  );
}

function withSizeParamSignal(product: QuoteSelectionProduct): QuoteSelectionProduct & { hasSizeParam: boolean } {
  return {
    ...product,
    hasSizeParam:
      product.displayParams?.some((param) => SIZE_PARAM_KEYS.has(param.paramKey) && Boolean(param.normalizedValue?.trim())) ??
      false,
  };
}

function formatVoltageOption(value: string): string {
  return /v$/i.test(value.trim()) ? value : `${value}V`;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-stone-600">{label}</span>
      {children}
    </label>
  );
}

function PreviewStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-line bg-white px-3 py-2">
      <div className="text-xs text-stone-500">{label}</div>
      <div className="mt-1 font-semibold text-ink">{value}</div>
    </div>
  );
}

function getHighestWarningTier(warnings: CategorizedWarning[]): WarningTier | null {
  return WARNING_TIER_ORDER.find((tier) => warnings.some((warning) => warning.tier === tier)) ?? null;
}

function getRowWarningPriority(row: QuotePreviewRow): number {
  const highestTier = getHighestWarningTier(row.warnings);
  return highestTier ? WARNING_TIER_ORDER.indexOf(highestTier) : WARNING_TIER_ORDER.length;
}

function groupWarningsByTier(warnings: CategorizedWarning[]): Record<WarningTier, CategorizedWarning[]> {
  return WARNING_TIER_ORDER.reduce(
    (groups, tier) => {
      groups[tier] = warnings.filter((warning) => warning.tier === tier);
      return groups;
    },
    { customer: [], quote: [], logistics: [] } as Record<WarningTier, CategorizedWarning[]>,
  );
}

function QuoteHealthSummary({ health }: { health: QuoteProductHealth }) {
  if (health.totalIssueCount === 0) {
    return <div className="mt-2 text-xs font-medium text-green-700">体检通过</div>;
  }

  const warnings = [
    ...health.productIssues,
    ...health.offerIssues.flatMap((offer) => offer.issues),
  ];
  const tierCounts = countWarningsByTier(warnings);

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {WARNING_TIER_ORDER.map((tier) =>
        tierCounts[tier] > 0 ? (
          <span
            key={tier}
            className={`rounded-md border px-2 py-0.5 text-xs font-medium ${WARNING_TIER_META[tier].badgeClass}`}
          >
            {WARNING_TIER_META[tier].label} {tierCounts[tier]}
          </span>
        ) : null,
      )}
      {health.productIssues.map((issue) => (
        <span
          key={`${issue.tier}:${issue.message}`}
          className={`rounded-md border px-2 py-0.5 text-xs ${WARNING_TIER_META[issue.tier].badgeClass}`}
        >
          {issue.message}
        </span>
      ))}
    </div>
  );
}

function QuoteOfferHealthList({ health }: { health: QuoteProductHealth }) {
  if (health.offerIssues.length === 0) {
    return null;
  }

  return (
    <div className="mt-2 space-y-1 text-xs">
      {health.offerIssues.slice(0, 3).map((offer) => (
        <div key={offer.offerId} className="rounded-md border border-line bg-white px-2 py-1">
          <div className="font-semibold text-ink">{offer.factoryName}</div>
          <div className="mt-1 flex flex-wrap gap-1">
            {offer.issues.map((issue) => (
              <span
                key={`${offer.offerId}:${issue.tier}:${issue.message}`}
                className={`rounded-md border px-2 py-0.5 ${WARNING_TIER_META[issue.tier].badgeClass}`}
              >
                {issue.message}
              </span>
            ))}
          </div>
        </div>
      ))}
      {health.offerIssues.length > 3 ? (
        <div className="text-stone-500">另有 {health.offerIssues.length - 3} 条报价需要检查</div>
      ) : null}
    </div>
  );
}

function countWarningsByTier(warnings: CategorizedWarning[]): Record<WarningTier, number> {
  return WARNING_TIER_ORDER.reduce(
    (counts, tier) => {
      counts[tier] = warnings.filter((warning) => warning.tier === tier).length;
      return counts;
    },
    { customer: 0, quote: 0, logistics: 0 } as Record<WarningTier, number>,
  );
}
