import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { Prisma } from "@prisma/client";

import { rankOffers, type OfferBadge } from "@/lib/offer-ranking";
import { formatParamLabel, sortDisplayParams } from "@/lib/product-param-display";
import { prisma } from "@/lib/prisma";

export type ChatToolName =
  | "search_products"
  | "get_product_offers"
  | "search_customer_history"
  | "compare_factories";

export type ChatToolResult =
  | { toolName: "search_products"; data: SearchProductsResult }
  | { toolName: "get_product_offers"; data: ProductOffersResult }
  | { toolName: "search_customer_history"; data: CustomerHistoryResult }
  | { toolName: "compare_factories"; data: FactoryComparisonResult }
  | { toolName: ChatToolName; data: { error: string } };

export type ChatProductOffer = {
  id: string;
  factory_name: string;
  purchase_price: string;
  currency: string;
  moq: string | null;
  price_flag: string | null;
  source_file_id: string | null;
  source_file_name: string | null;
};

export type ChatProductCard = {
  id: string;
  model_no: string | null;
  product_name: string;
  category: string | null;
  image_path: string | null;
  recommended_offer: ChatProductOffer | null;
  offer_count: number;
  params: ChatDisplayParam[];
};

export type ChatDisplayParam = {
  key: string;
  value: string;
  unit: string | null;
};

export type SearchProductsResult = {
  total: number;
  products: ChatProductCard[];
};

export type ProductOffersResult = {
  product_id: string;
  product_name: string;
  model_no: string | null;
  category: string | null;
  image_path: string | null;
  offers: Array<ChatProductOffer & {
    ctn_qty: string | null;
    ctn_dimensions: string | null;
    lead_time: string | null;
    price_updated_at: string | null;
    recommendation_score: number;
    badges: OfferBadge[];
  }>;
  params: ChatDisplayParam[];
};

export type CustomerHistoryResult = {
  total: number;
  rows: Array<{
    raw_model: string | null;
    raw_description: string | null;
    sale_price_usd: number | null;
    customer_name: string | null;
    quote_date: string | null;
    matched_product_name: string | null;
    source_file: string | null;
  }>;
};

export type FactoryComparisonResult = {
  category: string;
  comparison: Array<{
    factory_name: string;
    product_count: number;
    price_range: { min: string; max: string; currency: string };
    sample_product: { model_no: string | null; product_name: string; price: string };
  }>;
};

export type ChatQuoteDraftInput = {
  customerName: string;
  profitMargin: string;
  currency: string;
  exchangeRate: string;
  customerMode?: boolean;
  items: Array<{
    productId: string;
    offerId: string;
    quantity: number;
    remark: string;
  }>;
};

export const CHAT_TOOL_DEFINITIONS: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "search_products",
      description: "搜索产品库，返回匹配产品、关键参数和推荐供应商报价。",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "型号、产品名、规格或工厂关键词" },
          category: { type: "string", description: "品类精确匹配，例如 面板灯、投光灯" },
          min_watts: { type: "number", description: "功率下限" },
          max_watts: { type: "number", description: "功率上限" },
          factory: { type: "string", description: "工厂名模糊匹配" },
          limit: { type: "number", description: "返回数量，默认 10，最大 20" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_product_offers",
      description: "查看单个产品的全部供应商报价，按推荐顺序排序。",
      parameters: {
        type: "object",
        properties: {
          product_id: { type: "string", description: "产品 ID" },
        },
        required: ["product_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_customer_history",
      description: "搜索已导入的历史客户 FOB USD 报价记录。",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "型号、描述或文件名关键词" },
          customer_name: { type: "string", description: "客户名" },
          category: { type: "string", description: "品类" },
          limit: { type: "number", description: "返回数量，默认 10，最大 20" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "compare_factories",
      description: "按品类和规格对比不同工厂价格区间。",
      parameters: {
        type: "object",
        properties: {
          category: { type: "string", description: "品类，必填" },
          watts: { type: "number", description: "功率精确匹配" },
          query: { type: "string", description: "型号或规格关键词" },
        },
        required: ["category"],
      },
    },
  },
];

export async function executeChatTool(name: string, args: unknown): Promise<ChatToolResult> {
  const toolName = name as ChatToolName;
  try {
    switch (toolName) {
      case "search_products":
        return { toolName, data: await searchProducts(readArgs(args)) };
      case "get_product_offers":
        return { toolName, data: await getProductOffers(readArgs(args)) };
      case "search_customer_history":
        return { toolName, data: await searchCustomerHistory(readArgs(args)) };
      case "compare_factories":
        return { toolName, data: await compareFactories(readArgs(args)) };
      default:
        return { toolName, data: { error: `未知工具：${name}` } };
    }
  } catch (error) {
    return {
      toolName,
      data: { error: error instanceof Error ? error.message : "工具执行失败。" },
    };
  }
}

export async function searchProducts(args: Record<string, unknown>): Promise<SearchProductsResult> {
  const limit = clampToolLimit(args.limit, 10, 20);
  const query = normalizeToolText(args.query);
  const category = normalizeToolText(args.category);
  const factory = normalizeToolText(args.factory);
  const minWatts = parseToolNumber(args.min_watts);
  const maxWatts = parseToolNumber(args.max_watts);
  const wattsProductIds = await getWattsProductIds(minWatts, maxWatts);

  if (wattsProductIds && wattsProductIds.length === 0) {
    return { total: 0, products: [] };
  }

  const where = buildProductWhere({ query, category, factory, productIds: wattsProductIds });
  const [total, products] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      select: productSelection,
      orderBy: [{ updatedAt: "desc" }, { productName: "asc" }],
      take: limit,
    }),
  ]);

  const cards = products.map(serializeProductCard);
  cards.sort((left, right) => {
    const leftWattageOnly = isWattageOnlyModel(left.model_no);
    const rightWattageOnly = isWattageOnlyModel(right.model_no);
    if (leftWattageOnly !== rightWattageOnly) return leftWattageOnly ? 1 : -1;
    return 0;
  });

  return {
    total,
    products: cards,
  };
}

export async function getProductOffers(args: Record<string, unknown>): Promise<ProductOffersResult> {
  const productId = normalizeToolText(args.product_id);
  if (!productId) {
    throw new Error("产品 ID 不能为空。");
  }

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: productSelection,
  });
  if (!product) {
    throw new Error("产品不存在。");
  }

  const scores = rankOffers(product.supplierOffers);
  const scoreByOfferId = new Map(scores.map((score) => [score.offerId, score]));
  const sortedOffers = [...product.supplierOffers].sort((left, right) => {
    const leftScore = scoreByOfferId.get(left.id)?.total ?? 0;
    const rightScore = scoreByOfferId.get(right.id)?.total ?? 0;
    return rightScore - leftScore || parsePrice(left.purchasePrice) - parsePrice(right.purchasePrice);
  });

  return {
    product_id: product.id,
    product_name: product.productName,
    model_no: product.modelNo,
    category: product.category,
    image_path: product.imagePath,
    offers: sortedOffers.map((offer) => {
      const score = scoreByOfferId.get(offer.id);
      return {
        ...serializeChatProductOffer(offer),
        ctn_qty: offer.ctnQty,
        ctn_dimensions: formatCartonDimensions(offer.ctnLength, offer.ctnWidth, offer.ctnHeight),
        lead_time: offer.leadTime,
        price_updated_at: offer.priceUpdatedAt?.toISOString() ?? null,
        recommendation_score: score?.total ?? 0,
        badges: score?.badges ?? [],
      };
    }),
    params: toDisplayParams(product.params),
  };
}

export async function searchCustomerHistory(args: Record<string, unknown>): Promise<CustomerHistoryResult> {
  const limit = clampToolLimit(args.limit, 10, 20);
  const query = normalizeToolText(args.query);
  const customerName = normalizeToolText(args.customer_name);
  const category = normalizeToolText(args.category);
  const whereParts: string[] = ["1 = 1"];
  const params: Array<string | number> = [];

  if (query) {
    whereParts.push(
      "(cqr.raw_model LIKE ? OR cqr.raw_description LIKE ? OR cqf.file_name LIKE ? OR cqr.sale_price_text LIKE ?)",
    );
    const like = `%${query}%`;
    params.push(like, like, like, like);
  }
  if (customerName) {
    whereParts.push("COALESCE(cqf.customer_name, '') LIKE ?");
    params.push(`%${customerName}%`);
  }
  if (category) {
    whereParts.push("COALESCE(p.category, cqf.relative_path, '') LIKE ?");
    params.push(`%${category}%`);
  }

  const whereSql = whereParts.join(" AND ");
  const countRows = await prisma.$queryRawUnsafe<Array<{ total: number }>>(
    `SELECT COUNT(*) AS total
     FROM customer_quote_rows cqr
     JOIN customer_quote_files cqf ON cqf.id = cqr.file_id
     LEFT JOIN products p ON p.id = cqr.matched_product_id
     WHERE ${whereSql}`,
    ...params,
  );
  const rows = await prisma.$queryRawUnsafe<
    Array<{
      raw_model: string | null;
      raw_description: string | null;
      sale_price_usd: number | null;
      customer_name: string | null;
      quote_date: string | null;
      matched_product_name: string | null;
      source_file: string | null;
    }>
  >(
    `SELECT cqr.raw_model,
            cqr.raw_description,
            cqr.sale_price_usd,
            cqf.customer_name,
            cqf.quote_date,
            p.product_name AS matched_product_name,
            cqf.file_name AS source_file
     FROM customer_quote_rows cqr
     JOIN customer_quote_files cqf ON cqf.id = cqr.file_id
     LEFT JOIN products p ON p.id = cqr.matched_product_id
     WHERE ${whereSql}
     ORDER BY COALESCE(cqf.quote_date, '') DESC, cqr.sale_price_usd DESC
     LIMIT ?`,
    ...params,
    limit,
  );

  return {
    total: Number(countRows[0]?.total ?? 0),
    rows,
  };
}

export async function compareFactories(args: Record<string, unknown>): Promise<FactoryComparisonResult> {
  const category = normalizeToolText(args.category);
  if (!category) {
    throw new Error("品类不能为空。");
  }

  const watts = parseToolNumber(args.watts);
  const query = normalizeToolText(args.query);
  const wattsProductIds = watts === null ? null : await getWattsProductIds(watts - 0.01, watts + 0.01);
  if (wattsProductIds && wattsProductIds.length === 0) {
    return { category, comparison: [] };
  }

  const products = await prisma.product.findMany({
    where: buildProductWhere({ query, category, productIds: wattsProductIds }),
    select: productSelection,
    orderBy: [{ productName: "asc" }],
    take: 200,
  });
  const grouped = new Map<
    string,
    {
      productIds: Set<string>;
      prices: number[];
      currency: string;
      sample: { model_no: string | null; product_name: string; price: string };
    }
  >();

  for (const product of products) {
    for (const offer of product.supplierOffers) {
      const price = parsePrice(offer.purchasePrice);
      if (!Number.isFinite(price) || price <= 0) {
        continue;
      }
      const group =
        grouped.get(offer.factoryName) ??
        ({
        productIds: new Set<string>(),
        prices: [] as number[],
        currency: offer.currency,
        sample: {
          model_no: product.modelNo,
          product_name: product.productName,
          price: offer.purchasePrice.toString(),
        },
      } satisfies {
        productIds: Set<string>;
        prices: number[];
        currency: string;
        sample: { model_no: string | null; product_name: string; price: string };
      });
      group.productIds.add(product.id);
      group.prices.push(price);
      const sampleWattageOnly = isWattageOnlyModel(group.sample.model_no);
      const productWattageOnly = isWattageOnlyModel(product.modelNo);
      if (
        (sampleWattageOnly && !productWattageOnly) ||
        (sampleWattageOnly === productWattageOnly && price < Number.parseFloat(group.sample.price))
      ) {
        group.sample = {
          model_no: product.modelNo,
          product_name: product.productName,
          price: offer.purchasePrice.toString(),
        };
        group.currency = offer.currency;
      }
      grouped.set(offer.factoryName, group);
    }
  }

  return {
    category,
    comparison: Array.from(grouped.entries())
      .map(([factoryName, group]) => {
        const min = Math.min(...group.prices);
        const max = Math.max(...group.prices);
        return {
          factory_name: factoryName,
          product_count: group.productIds.size,
          price_range: {
            min: formatMoney(min),
            max: formatMoney(max),
            currency: group.currency,
          },
          sample_product: group.sample,
        };
      })
      .sort((left, right) => Number.parseFloat(left.price_range.min) - Number.parseFloat(right.price_range.min))
      .slice(0, 20),
  };
}

export function buildChatQuoteFormData(input: ChatQuoteDraftInput): FormData {
  const formData = new FormData();
  formData.set("customerName", input.customerName);
  formData.set("profitMargin", input.profitMargin);
  formData.set("currency", input.currency);
  formData.set("exchangeRate", input.exchangeRate);
  if (input.customerMode !== false) {
    formData.set("customerMode", "on");
  }

  for (const item of input.items) {
    formData.append("productIds", item.productId);
    formData.set(`supplierOfferId:${item.productId}`, item.offerId);
    formData.set(`quantity:${item.productId}`, String(item.quantity));
    formData.set(`remark:${item.productId}`, item.remark);
  }

  return formData;
}

export function clampToolLimit(value: unknown, defaultLimit: number, maxLimit: number): number {
  const parsed = parseToolNumber(value);
  if (parsed === null || parsed < 1) {
    return defaultLimit;
  }
  return Math.min(Math.floor(parsed), maxLimit);
}

export function parseToolNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== "string") {
    return null;
  }
  const match = value.replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  if (!match) {
    return null;
  }
  const parsed = Number.parseFloat(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeToolText(value: unknown): string {
  return typeof value === "string" ? value.normalize("NFC").trim() : "";
}

export function isWattageOnlyModel(modelNo: string | null): boolean {
  if (!modelNo) return true;
  return /^\d+(\.\d+)?[wW]$/.test(modelNo.trim());
}

export function formatCartonDimensions(
  length: string | null,
  width: string | null,
  height: string | null,
): string | null {
  if (!length || !width || !height) {
    return null;
  }
  return `${length}×${width}×${height}`;
}

export function toDisplayParams(params: ProductWithOffers["params"]): ChatDisplayParam[] {
  return sortDisplayParams(params)
    .map((param) => ({
      key: param.paramKey,
      value: (param.normalizedValue || param.rawValue).trim(),
      unit: param.unit,
      label: formatParamLabel(param),
    }))
    .filter((param) => param.value.length > 0)
    .slice(0, 8)
    .map(({ key, value, unit }) => ({ key, value, unit }));
}

const productSelection = Prisma.validator<Prisma.ProductSelect>()({
  id: true,
  productName: true,
  modelNo: true,
  category: true,
  imagePath: true,
  supplierOffers: {
    select: {
      id: true,
      factoryName: true,
      purchasePrice: true,
      currency: true,
      moq: true,
      ctnQty: true,
      ctnLength: true,
      ctnWidth: true,
      ctnHeight: true,
      leadTime: true,
      sourceFileId: true,
      sourceFile: { select: { id: true, fileName: true } },
      remark: true,
      priceUpdatedAt: true,
      priceFlag: true,
    },
    orderBy: [{ factoryName: "asc" }, { createdAt: "desc" }],
  },
  params: {
    select: {
      paramKey: true,
      rawValue: true,
      normalizedValue: true,
      unit: true,
      confidence: true,
    },
  },
});

type ProductWithOffers = Prisma.ProductGetPayload<{ select: typeof productSelection }>;

function serializeProductCard(product: ProductWithOffers): ChatProductCard {
  const recommendedOffer = selectRecommendedChatOffer(product.supplierOffers);

  return {
    id: product.id,
    model_no: product.modelNo,
    product_name: product.productName,
    category: product.category,
    image_path: product.imagePath,
    recommended_offer: recommendedOffer ? serializeChatProductOffer(recommendedOffer) : null,
    offer_count: product.supplierOffers.length,
    params: toDisplayParams(product.params),
  };
}

export function selectRecommendedChatOffer<
  T extends { id: string; priceFlag?: string | null } & Parameters<typeof rankOffers>[0][number],
>(offers: T[]): T | undefined {
  const scores = rankOffers(offers);
  const normalOfferIds = new Set(offers.filter((offer) => offer.priceFlag == null).map((offer) => offer.id));
  const recommendedOfferId = scores.find((score) => normalOfferIds.has(score.offerId))?.offerId ?? scores[0]?.offerId;
  return offers.find((offer) => offer.id === recommendedOfferId);
}

export function serializeChatProductOffer(offer: {
  id: string;
  factoryName: string;
  purchasePrice: { toString(): string };
  currency: string;
  moq: string | null;
  priceFlag?: string | null;
  sourceFileId: string | null;
  sourceFile: { id: string; fileName: string } | null;
}): ChatProductOffer {
  return {
    id: offer.id,
    factory_name: offer.factoryName,
    purchase_price: offer.purchasePrice.toString(),
    currency: offer.currency,
    moq: offer.moq,
    price_flag: offer.priceFlag ?? null,
    source_file_id: offer.sourceFile?.id ?? offer.sourceFileId,
    source_file_name: offer.sourceFile?.fileName ?? null,
  };
}

function buildProductWhere({
  query,
  category,
  factory,
  productIds,
}: {
  query?: string;
  category?: string;
  factory?: string;
  productIds?: string[] | null;
}) {
  return {
    ...(productIds ? { id: { in: productIds } } : {}),
    ...(category ? { category } : {}),
    ...(factory ? { supplierOffers: { some: { factoryName: { contains: factory } } } } : {}),
    ...(query
      ? {
          OR: [
            { modelNo: { contains: query } },
            { productName: { contains: query } },
            { category: { contains: query } },
            { supplierOffers: { some: { factoryName: { contains: query } } } },
            { params: { some: { rawValue: { contains: query } } } },
            { params: { some: { normalizedValue: { contains: query } } } },
          ],
        }
      : {}),
  };
}

async function getWattsProductIds(minWatts: number | null, maxWatts: number | null): Promise<string[] | null> {
  if (minWatts === null && maxWatts === null) {
    return null;
  }

  let sql = "SELECT DISTINCT product_id FROM product_params WHERE param_key = 'watts'";
  const params: number[] = [];
  if (minWatts !== null) {
    sql += " AND CAST(normalized_value AS REAL) >= ?";
    params.push(minWatts);
  }
  if (maxWatts !== null) {
    sql += " AND CAST(normalized_value AS REAL) <= ?";
    params.push(maxWatts);
  }

  const rows = await prisma.$queryRawUnsafe<Array<{ product_id: string }>>(sql, ...params);
  return rows.map((row) => row.product_id);
}

function readArgs(args: unknown): Record<string, unknown> {
  return args && typeof args === "object" && !Array.isArray(args) ? (args as Record<string, unknown>) : {};
}

function parsePrice(value: { toString(): string }): number {
  const parsed = Number.parseFloat(value.toString().replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function formatMoney(value: number): string {
  return value.toFixed(2);
}
