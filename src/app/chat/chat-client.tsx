"use client";

import { Bot, Download, FileSpreadsheet, Loader2, Plus, Search, Send, Trash2, X } from "lucide-react";
import Image from "next/image";
import { FormEvent, useMemo, useState, useTransition } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import {
  generateQuoteFromChatDraft,
  getProductOffersForChat,
  sendChatMessage,
  type AssistantChatResponse,
  type ChatQuoteGenerateResult,
} from "./actions";
import type {
  ChatProductCard,
  ChatToolResult,
  ProductOffersResult,
  SearchProductsResult,
  FactoryComparisonResult,
  CustomerHistoryResult,
} from "@/lib/chat-tools";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  toolResults: ChatToolResult[];
};

type DraftItem = {
  productId: string;
  productName: string;
  modelNo: string | null;
  category: string | null;
  offerId: string;
  factoryName: string;
  purchasePrice: string;
  currency: string;
  moq: string | null;
  quantity: number;
  remark: string;
};

type QuoteSettings = {
  customerName: string;
  profitMargin: string;
  currency: string;
  exchangeRate: string;
};

const starterPrompts = ["面板灯 36W", "投光灯 100W 最便宜", "上次给 HTF 报的面板灯", "面板灯 48W 有哪些工厂"];

export function ChatClient() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      text: "你可以直接问产品、价格、工厂对比或历史报价。我会查本地报价库，不会编造数据。",
      toolResults: [],
    },
  ]);
  const [input, setInput] = useState("");
  const [draftItems, setDraftItems] = useState<DraftItem[]>([]);
  const [isDraftOpen, setIsDraftOpen] = useState(false);
  const [settings, setSettings] = useState<QuoteSettings>({
    customerName: "",
    profitMargin: "0.2",
    currency: "USD",
    exchangeRate: "7.2",
  });
  const [quoteResult, setQuoteResult] = useState<ChatQuoteGenerateResult | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isGeneratingQuote, startQuoteTransition] = useTransition();

  const compactHistory = useMemo(
    () =>
      messages
        .filter((message) => message.id !== "welcome")
        .map((message) => ({ role: message.role, text: message.text }))
        .slice(-8),
    [messages],
  );

  function submitMessage(event?: FormEvent<HTMLFormElement>, override?: string) {
    event?.preventDefault();
    const text = (override ?? input).trim();
    if (!text || isPending) {
      return;
    }

    setInput("");
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      text,
      toolResults: [],
    };
    setMessages((current) => [...current, userMessage]);

    startTransition(async () => {
      const response = await sendChatMessage(text, compactHistory);
      appendAssistantResponse(response);
    });
  }

  function appendAssistantResponse(response: AssistantChatResponse) {
    setMessages((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        role: "assistant",
        text: response.text,
        toolResults: response.toolResults,
      },
    ]);
  }

  function addDraftItem(product: ChatProductCard, offer = product.recommended_offer) {
    if (!offer) {
      return;
    }
    setDraftItems((current) => {
      const withoutDuplicate = current.filter((item) => item.productId !== product.id);
      return [
        ...withoutDuplicate,
        {
          productId: product.id,
          productName: product.product_name,
          modelNo: product.model_no,
          category: product.category,
          offerId: offer.id,
          factoryName: offer.factory_name,
          purchasePrice: offer.purchase_price,
          currency: offer.currency,
          moq: offer.moq,
          quantity: 1,
          remark: "",
        },
      ];
    });
    setIsDraftOpen(true);
  }

  function addOfferFromDetails(result: ProductOffersResult, offer: ProductOffersResult["offers"][number]) {
    addDraftItem(
      {
        id: result.product_id,
        product_name: result.product_name,
        model_no: result.model_no,
        category: result.category,
        image_path: result.image_path,
        recommended_offer: {
          id: offer.id,
          factory_name: offer.factory_name,
          purchase_price: offer.purchase_price,
          currency: offer.currency,
          moq: offer.moq,
        },
        offer_count: result.offers.length,
        params: result.params,
      },
      {
        id: offer.id,
        factory_name: offer.factory_name,
        purchase_price: offer.purchase_price,
        currency: offer.currency,
        moq: offer.moq,
      },
    );
  }

  function loadOffers(productId: string) {
    startTransition(async () => {
      const result = await getProductOffersForChat(productId);
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: "这个产品的供应商报价如下。",
          toolResults: [result],
        },
      ]);
    });
  }

  function updateDraftItem(productId: string, patch: Partial<DraftItem>) {
    setDraftItems((current) => current.map((item) => (item.productId === productId ? { ...item, ...patch } : item)));
  }

  function removeDraftItem(productId: string) {
    setDraftItems((current) => current.filter((item) => item.productId !== productId));
  }

  function generateQuote() {
    if (draftItems.length === 0 || isGeneratingQuote) {
      return;
    }
    setQuoteResult(null);
    startQuoteTransition(async () => {
      try {
        const result = await generateQuoteFromChatDraft({
          customerName: settings.customerName.trim() || "Chat Quote",
          profitMargin: settings.profitMargin,
          currency: settings.currency,
          exchangeRate: settings.exchangeRate,
          customerMode: true,
          items: draftItems.map((item) => ({
            productId: item.productId,
            offerId: item.offerId,
            quantity: item.quantity,
            remark: item.remark,
          })),
        });
        setQuoteResult(result);
      } catch (error) {
        setMessages((current) => [
          ...current,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            text: error instanceof Error ? error.message : "生成报价单失败。",
            toolResults: [],
          },
        ]);
      }
    });
  }

  return (
    <div className="flex min-h-screen bg-[#f7f3e8] text-ink">
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center justify-between border-b border-line bg-paper px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-leaf text-white">
              <Bot size={20} />
            </div>
            <div>
              <div className="text-lg font-semibold">报价助手</div>
              <div className="text-xs text-stone-500">本地产品库 / 工厂报价 / 历史客户价</div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setIsDraftOpen((value) => !value)}
            className="inline-flex items-center gap-2 rounded-md border border-line bg-white px-4 py-2 text-sm font-semibold shadow-panel hover:border-leaf"
          >
            <FileSpreadsheet size={17} />
            报价草稿 ({draftItems.length})
          </button>
        </header>

        <section className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <div className="mx-auto flex max-w-5xl flex-col gap-4">
            <div className="flex flex-wrap gap-2">
              {starterPrompts.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => submitMessage(undefined, prompt)}
                  className="rounded-full border border-line bg-white px-3 py-1.5 text-xs font-semibold text-stone-700 hover:border-leaf"
                >
                  {prompt}
                </button>
              ))}
            </div>

            {messages.map((message) => (
              <ChatMessageView
                key={message.id}
                message={message}
                onAddDraft={addDraftItem}
                onLoadOffers={loadOffers}
                onAddOffer={addOfferFromDetails}
              />
            ))}
            {isPending ? (
              <div className="flex max-w-[78%] items-center gap-2 rounded-md border border-line bg-paper px-4 py-3 text-sm text-stone-600 shadow-panel">
                <Loader2 className="animate-spin" size={16} />
                正在查询...
              </div>
            ) : null}
          </div>
        </section>

        <form onSubmit={submitMessage} className="border-t border-line bg-paper px-6 py-4">
          <div className="mx-auto flex max-w-5xl items-end gap-3">
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              rows={2}
              placeholder="输入：找 36W 面板灯、对比投光灯工厂、查上次给客户的价格..."
              className="min-h-12 flex-1 resize-none rounded-md border border-line bg-white px-3 py-2 text-sm outline-none focus:border-leaf"
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  submitMessage();
                }
              }}
            />
            <button
              type="submit"
              disabled={isPending || !input.trim()}
              className="inline-flex h-12 items-center gap-2 rounded-md bg-ink px-5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Send size={17} />
              发送
            </button>
          </div>
        </form>
      </main>

      {isDraftOpen ? (
        <QuoteDraftPanel
          items={draftItems}
          settings={settings}
          quoteResult={quoteResult}
          isGenerating={isGeneratingQuote}
          onClose={() => setIsDraftOpen(false)}
          onRemove={removeDraftItem}
          onUpdate={updateDraftItem}
          onSettingsChange={setSettings}
          onGenerate={generateQuote}
        />
      ) : null}
    </div>
  );
}

function ChatMessageView({
  message,
  onAddDraft,
  onLoadOffers,
  onAddOffer,
}: {
  message: ChatMessage;
  onAddDraft: (product: ChatProductCard) => void;
  onLoadOffers: (productId: string) => void;
  onAddOffer: (result: ProductOffersResult, offer: ProductOffersResult["offers"][number]) => void;
}) {
  const isUser = message.role === "user";
  return (
    <article className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[86%] rounded-md border px-4 py-3 shadow-panel ${
          isUser ? "border-ink bg-ink text-white" : "border-line bg-paper text-ink"
        }`}
      >
        {isUser ? (
          <div className="whitespace-pre-wrap text-sm leading-6">{message.text}</div>
        ) : (
          <div className="prose prose-sm prose-stone max-w-none prose-headings:my-2 prose-p:my-2 prose-table:text-sm prose-th:bg-[#3F4A35] prose-th:text-white prose-td:border prose-td:border-line prose-th:border prose-th:border-line">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.text}</ReactMarkdown>
          </div>
        )}
        {!isUser && message.toolResults.length > 0 ? (
          <div className="mt-3 flex flex-col gap-3">
            {message.toolResults.map((result, index) => (
              <ToolResultView
                key={`${result.toolName}-${index}`}
                result={result}
                onAddDraft={onAddDraft}
                onLoadOffers={onLoadOffers}
                onAddOffer={onAddOffer}
              />
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function ToolResultView({
  result,
  onAddDraft,
  onLoadOffers,
  onAddOffer,
}: {
  result: ChatToolResult;
  onAddDraft: (product: ChatProductCard) => void;
  onLoadOffers: (productId: string) => void;
  onAddOffer: (result: ProductOffersResult, offer: ProductOffersResult["offers"][number]) => void;
}) {
  if ("error" in result.data) {
    return <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{result.data.error}</div>;
  }

  switch (result.toolName) {
    case "search_products":
      return <ProductCardList result={result.data as SearchProductsResult} onAddDraft={onAddDraft} onLoadOffers={onLoadOffers} />;
    case "get_product_offers":
      return <OfferComparisonTable result={result.data as ProductOffersResult} onAddOffer={onAddOffer} />;
    case "search_customer_history":
      return <HistoryTable result={result.data as CustomerHistoryResult} />;
    case "compare_factories":
      return <FactoryComparisonCard result={result.data as FactoryComparisonResult} />;
    default:
      return null;
  }
}

function ProductCardList({
  result,
  onAddDraft,
  onLoadOffers,
}: {
  result: SearchProductsResult;
  onAddDraft: (product: ChatProductCard) => void;
  onLoadOffers: (productId: string) => void;
}) {
  if (result.products.length === 0) {
    return <div className="rounded-md border border-line bg-white p-3 text-sm text-stone-600">没有找到匹配产品。</div>;
  }
  return (
    <div className="grid gap-3">
      <div className="text-xs font-semibold uppercase tracking-[0.08em] text-stone-500">
        找到 {result.total} 个匹配产品
      </div>
      {result.products.map((product) => (
        <div key={product.id} className="rounded-md border border-line bg-white p-3">
          <div className="flex gap-3">
            <ProductThumb product={product} />
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{product.model_no || product.product_name}</div>
              <div className="mt-0.5 text-sm text-stone-600">{product.product_name}</div>
              <ParamBadges params={product.params} />
              <div className="mt-2 text-sm">
                {product.recommended_offer ? (
                  <span>
                    推荐：{product.recommended_offer.factory_name} / {product.recommended_offer.purchase_price}{" "}
                    {product.recommended_offer.currency}
                  </span>
                ) : (
                  <span className="text-stone-500">暂无供应商报价</span>
                )}
              </div>
            </div>
            <div className="flex shrink-0 flex-col gap-2">
              <button
                type="button"
                onClick={() => onLoadOffers(product.id)}
                className="rounded-md border border-line px-3 py-1.5 text-xs font-semibold hover:border-leaf"
              >
                全部报价
              </button>
              <button
                type="button"
                disabled={!product.recommended_offer}
                onClick={() => onAddDraft(product)}
                className="inline-flex items-center gap-1 rounded-md bg-ink px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              >
                <Plus size={14} />
                加入
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function OfferComparisonTable({
  result,
  onAddOffer,
}: {
  result: ProductOffersResult;
  onAddOffer: (result: ProductOffersResult, offer: ProductOffersResult["offers"][number]) => void;
}) {
  return (
    <div className="overflow-hidden rounded-md border border-line bg-white">
      <div className="border-b border-line px-3 py-2 text-sm font-semibold">
        {result.model_no || result.product_name} / {result.offers.length} 条报价
      </div>
      <div className="grid grid-cols-[1fr_100px_80px_120px_84px] bg-[#3F4A35] px-3 py-2 text-xs font-semibold text-white">
        <div>工厂</div>
        <div>价格</div>
        <div>MOQ</div>
        <div>标签</div>
        <div>操作</div>
      </div>
      {result.offers.map((offer) => (
        <div key={offer.id} className="grid grid-cols-[1fr_100px_80px_120px_84px] items-center border-t border-line px-3 py-2 text-sm">
          <div className="font-semibold">{offer.factory_name}</div>
          <div>
            {offer.purchase_price} {offer.currency}
          </div>
          <div>{offer.moq || "-"}</div>
          <div className="text-xs text-stone-600">{offer.badges.join(" / ") || "-"}</div>
          <button
            type="button"
            onClick={() => onAddOffer(result, offer)}
            className="rounded-md bg-ink px-2 py-1 text-xs font-semibold text-white"
          >
            加入
          </button>
        </div>
      ))}
    </div>
  );
}

function HistoryTable({ result }: { result: CustomerHistoryResult }) {
  if (result.rows.length === 0) {
    return <div className="rounded-md border border-line bg-white p-3 text-sm text-stone-600">没有找到历史客户报价记录。</div>;
  }
  return (
    <div className="overflow-hidden rounded-md border border-line bg-white">
      <div className="border-b border-line px-3 py-2 text-sm font-semibold">历史报价 {result.total} 条</div>
      <div className="grid grid-cols-[110px_1fr_90px_120px] bg-[#3F4A35] px-3 py-2 text-xs font-semibold text-white">
        <div>日期</div>
        <div>型号</div>
        <div>FOB USD</div>
        <div>客户</div>
      </div>
      {result.rows.map((row, index) => (
        <div key={`${row.raw_model}-${index}`} className="grid grid-cols-[110px_1fr_90px_120px] border-t border-line px-3 py-2 text-sm">
          <div>{row.quote_date || "-"}</div>
          <div className="truncate" title={row.raw_description ?? ""}>
            {row.raw_model || row.matched_product_name || "-"}
          </div>
          <div className="font-semibold">{row.sale_price_usd == null ? "-" : `$${row.sale_price_usd.toFixed(2)}`}</div>
          <div className="truncate">{row.customer_name || "内部核价"}</div>
        </div>
      ))}
    </div>
  );
}

function FactoryComparisonCard({ result }: { result: FactoryComparisonResult }) {
  if (result.comparison.length === 0) {
    return <div className="rounded-md border border-line bg-white p-3 text-sm text-stone-600">没有找到该品类的工厂报价对比。</div>;
  }
  return (
    <div className="grid gap-2">
      {result.comparison.map((factory) => (
        <div key={factory.factory_name} className="rounded-md border border-line bg-white p-3 text-sm">
          <div className="flex items-center justify-between gap-3">
            <div className="font-semibold">{factory.factory_name}</div>
            <div>
              {factory.price_range.min}-{factory.price_range.max} {factory.price_range.currency}
            </div>
          </div>
          <div className="mt-1 text-stone-600">
            {factory.product_count} 个产品 / 样本：{factory.sample_product.model_no || factory.sample_product.product_name}
          </div>
        </div>
      ))}
    </div>
  );
}

function QuoteDraftPanel({
  items,
  settings,
  quoteResult,
  isGenerating,
  onClose,
  onRemove,
  onUpdate,
  onSettingsChange,
  onGenerate,
}: {
  items: DraftItem[];
  settings: QuoteSettings;
  quoteResult: ChatQuoteGenerateResult | null;
  isGenerating: boolean;
  onClose: () => void;
  onRemove: (productId: string) => void;
  onUpdate: (productId: string, patch: Partial<DraftItem>) => void;
  onSettingsChange: (settings: QuoteSettings) => void;
  onGenerate: () => void;
}) {
  return (
    <aside className="flex w-[420px] shrink-0 flex-col border-l border-line bg-paper shadow-panel">
      <header className="flex h-16 items-center justify-between border-b border-line px-4">
        <div>
          <div className="font-semibold">报价草稿</div>
          <div className="text-xs text-stone-500">{items.length} 个产品</div>
        </div>
        <button type="button" onClick={onClose} className="rounded-md border border-line p-2 hover:border-leaf">
          <X size={16} />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="grid gap-3">
          {items.length === 0 ? (
            <div className="rounded-md border border-dashed border-line p-4 text-sm text-stone-500">还没有加入产品。</div>
          ) : null}
          {items.map((item) => (
            <div key={item.productId} className="rounded-md border border-line bg-white p-3">
              <div className="flex justify-between gap-3">
                <div>
                  <div className="font-semibold">{item.modelNo || item.productName}</div>
                  <div className="text-sm text-stone-600">
                    {item.factoryName} / {item.purchasePrice} {item.currency}
                  </div>
                </div>
                <button type="button" onClick={() => onRemove(item.productId)} className="text-red-600">
                  <Trash2 size={16} />
                </button>
              </div>
              <div className="mt-3 grid grid-cols-[90px_1fr] gap-2">
                <input
                  type="number"
                  min={1}
                  value={item.quantity}
                  onChange={(event) => onUpdate(item.productId, { quantity: Number(event.target.value) || 1 })}
                  className={draftInputClass}
                />
                <input
                  value={item.remark}
                  onChange={(event) => onUpdate(item.productId, { remark: event.target.value })}
                  placeholder="备注"
                  className={draftInputClass}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
      <footer className="border-t border-line p-4">
        <div className="grid gap-2">
          <input
            value={settings.customerName}
            onChange={(event) => onSettingsChange({ ...settings, customerName: event.target.value })}
            placeholder="客户名"
            className={draftInputClass}
          />
          <div className="grid grid-cols-3 gap-2">
            <input
              value={settings.profitMargin}
              onChange={(event) => onSettingsChange({ ...settings, profitMargin: event.target.value })}
              placeholder="利润率"
              className={draftInputClass}
            />
            <input
              value={settings.currency}
              onChange={(event) => onSettingsChange({ ...settings, currency: event.target.value.toUpperCase() })}
              placeholder="USD"
              className={draftInputClass}
            />
            <input
              value={settings.exchangeRate}
              onChange={(event) => onSettingsChange({ ...settings, exchangeRate: event.target.value })}
              placeholder="7.2"
              className={draftInputClass}
            />
          </div>
          <button
            type="button"
            onClick={onGenerate}
            disabled={items.length === 0 || isGenerating}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-ink text-sm font-semibold text-white disabled:opacity-50"
          >
            {isGenerating ? <Loader2 className="animate-spin" size={16} /> : <Download size={16} />}
            生成报价单
          </button>
          {quoteResult ? (
            <a
              href={quoteResult.downloadUrl}
              className="inline-flex h-10 items-center justify-center rounded-md border border-leaf bg-green-50 text-sm font-semibold text-leaf"
            >
              下载 Excel / {quoteResult.itemCount} 项 / {quoteResult.totalSaleAmount} {settings.currency}
            </a>
          ) : null}
        </div>
      </footer>
    </aside>
  );
}

function ProductThumb({ product }: { product: ChatProductCard }) {
  if (!product.image_path) {
    return (
      <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-md border border-line bg-cream text-stone-500">
        <Search size={18} />
      </div>
    );
  }
  return (
    <Image
      src={`/api/products/${product.id}/image`}
      alt={product.model_no || product.product_name}
      width={64}
      height={64}
      className="h-16 w-16 shrink-0 rounded-md border border-line object-cover"
    />
  );
}

function ParamBadges({ params }: { params: ChatProductCard["params"] }) {
  if (params.length === 0) {
    return null;
  }
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {params.slice(0, 6).map((param) => (
        <span key={`${param.key}-${param.value}`} className="rounded border border-line bg-cream px-2 py-0.5 text-xs text-stone-700">
          {param.key}: {param.value}
          {param.unit ?? ""}
        </span>
      ))}
    </div>
  );
}

const draftInputClass =
  "h-10 rounded-md border border-line bg-white px-3 text-sm outline-none focus:border-leaf";
