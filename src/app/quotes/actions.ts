"use server";

import { mkdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import { calculateSalePrice, writeQuoteWorkbook, type QuoteWorkbookData } from "@/lib/quote-export";
import { prisma } from "@/lib/prisma";
import { buildQuotePreview, type QuotePreviewData } from "@/lib/quote-preview";
import {
  buildQuoteSearchWhere,
  serializeQuoteDetail,
  serializeQuoteSearchResult,
  type QuoteDetail,
  type QuoteSearchFilters,
  type QuoteSearchResult,
} from "@/lib/quote-history";
import {
  buildReusableQuoteDraft,
  serializeReusableQuoteDraft,
  type QuoteSelectionProduct,
  type SerializedReusableQuoteDraftResult,
} from "@/lib/quote-selection";

export type CreateQuoteResult = {
  quoteId: string;
  quoteFilePath: string;
};

export async function createQuote(formData: FormData): Promise<CreateQuoteResult> {
  const input = parseQuoteFormData(formData);
  const quoteItems = await prepareQuoteItems(input);
  const quoteId = randomUUID();
  const createdAt = new Date();

  const outputDir = join(process.cwd(), "outputs", "quotes");
  await mkdir(outputDir, { recursive: true });
  const quoteFilePath = join(
    outputDir,
    `${createdAt.toISOString().slice(0, 10)}-${safeFileName(input.customerName)}-${quoteId.slice(0, 8)}.xlsx`,
  );

  const workbookData: QuoteWorkbookData = {
    id: quoteId,
    customerName: input.customerName,
    currency: input.currency,
    profitMargin: input.profitMargin,
    exchangeRate: input.exchangeRate,
    createdAt,
    items: quoteItems.map(({ offer, quantity, remark, salePrice }) => ({
      productName: offer.product.productName,
      modelNo: offer.product.modelNo,
      factoryName: offer.factoryName,
      purchasePrice: offer.purchasePrice,
      purchaseCurrency: offer.currency,
      salePrice,
      quantity,
      moq: offer.moq,
      ctnQty: offer.ctnQty,
      ctnLength: offer.ctnLength,
      ctnWidth: offer.ctnWidth,
      ctnHeight: offer.ctnHeight,
      material: offer.product.material,
      size: offer.product.size,
      productRemark: offer.product.remark,
      productParams: mapProductParams(offer.product.params),
      remark,
    })),
  };

  await writeQuoteWorkbook(workbookData, quoteFilePath, { customerMode: input.customerMode });

  try {
    await prisma.$transaction(async (tx) => {
      await tx.quote.create({
        data: {
          id: quoteId,
          customerName: input.customerName,
          currency: input.currency,
          profitMargin: input.profitMargin,
          exchangeRate: input.exchangeRate,
          quoteFilePath,
          createdAt,
        },
      });

      await tx.quoteItem.createMany({
        data: quoteItems.map(({ offer, quantity, remark, salePrice }) => ({
          quoteId,
          productId: offer.productId,
          supplierOfferId: offer.id,
          purchasePrice: offer.purchasePrice,
          purchaseCurrency: offer.currency,
          salePrice,
          quantity,
          remark,
        })),
      });
    });
  } catch (error) {
    await unlink(quoteFilePath).catch(() => undefined);
    throw error;
  }

  revalidatePath("/quotes");
  return { quoteId, quoteFilePath };
}

export async function previewQuote(formData: FormData): Promise<QuotePreviewData> {
  const input = parseQuoteFormData(formData);
  const quoteItems = await prepareQuoteItems(input);

  return buildQuotePreview({
    customerName: input.customerName,
    currency: input.currency,
    profitMargin: input.profitMargin,
    exchangeRate: input.exchangeRate,
    items: quoteItems.map(({ offer, quantity, remark }) => ({
      productId: offer.productId,
      supplierOfferId: offer.id,
      productName: offer.product.productName,
      modelNo: offer.product.modelNo,
      factoryName: offer.factoryName,
      purchasePrice: offer.purchasePrice,
      purchaseCurrency: offer.currency,
      quantity,
      moq: offer.moq,
      ctnQty: offer.ctnQty,
      ctnLength: offer.ctnLength,
      ctnWidth: offer.ctnWidth,
      ctnHeight: offer.ctnHeight,
      material: offer.product.material,
      size: offer.product.size,
      productRemark: offer.product.remark,
      productParams: mapProductParams(offer.product.params),
      remark,
    })),
  });
}

export async function searchQuotes(filters: QuoteSearchFilters): Promise<QuoteSearchResult[]> {
  const quotes = await prisma.quote.findMany({
    where: buildQuoteSearchWhere(filters),
    include: {
      _count: {
        select: { items: true },
      },
    },
    orderBy: [{ createdAt: "desc" }],
    take: 50,
  });

  return quotes.map(serializeQuoteSearchResult);
}

export async function getQuoteDetail(quoteId: string): Promise<QuoteDetail> {
  const id = quoteId.trim();
  if (!id) {
    throw new Error("报价记录不存在。");
  }

  const quote = await prisma.quote.findUnique({
    where: { id },
    include: {
      items: {
        include: {
          product: {
            include: {
              params: {
                select: {
                  paramKey: true,
                  rawValue: true,
                  normalizedValue: true,
                  unit: true,
                  confidence: true,
                },
              },
            },
          },
          supplierOffer: {
            select: {
              factoryName: true,
              moq: true,
              ctnQty: true,
              ctnLength: true,
              ctnWidth: true,
              ctnHeight: true,
            },
          },
        },
        orderBy: [{ productId: "asc" }],
      },
    },
  });
  if (!quote) {
    throw new Error("报价记录不存在。");
  }

  return serializeQuoteDetail(quote, await quoteFileExists(quote.quoteFilePath));
}

export async function reuseQuote(quoteId: string): Promise<SerializedReusableQuoteDraftResult> {
  const id = quoteId.trim();
  if (!id) {
    throw new Error("报价记录不存在。");
  }

  const quote = await prisma.quote.findUnique({
    where: { id },
    include: {
      items: {
        include: { product: true },
        orderBy: [{ productId: "asc" }],
      },
    },
  });
  if (!quote) {
    throw new Error("报价记录不存在。");
  }

  const productIds = Array.from(new Set(quote.items.map((item) => item.productId)));
  const modelNos = Array.from(
    new Set(
      quote.items
        .map((item) => item.product.modelNo?.trim())
        .filter((modelNo): modelNo is string => Boolean(modelNo)),
    ),
  );
  const productLookup = [
    productIds.length > 0 ? { id: { in: productIds } } : null,
    modelNos.length > 0 ? { modelNo: { in: modelNos } } : null,
  ].filter((where): where is { id: { in: string[] } } | { modelNo: { in: string[] } } => where !== null);
  const currentProducts = await prisma.product.findMany({
    where: productLookup.length > 0 ? { OR: productLookup } : { id: "__no_products__" },
    include: {
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
          remark: true,
          priceUpdatedAt: true,
        },
        orderBy: [{ factoryName: "asc" }, { createdAt: "desc" }],
      },
    },
  });

  return serializeReusableQuoteDraft(
    buildReusableQuoteDraft({
      quote: {
        customerName: quote.customerName,
        profitMargin: quote.profitMargin,
        currency: quote.currency,
        exchangeRate: quote.exchangeRate,
      },
      currentProducts: currentProducts.map(serializeQuoteSelectionProduct),
      items: quote.items.map((item) => ({
        productId: item.productId,
        productName: item.product.productName,
        modelNo: item.product.modelNo,
        supplierOfferId: item.supplierOfferId,
        quantity: item.quantity,
        remark: item.remark,
      })),
    }),
  );
}

type QuoteFormInput = {
  customerName: string;
  profitMargin: string;
  currency: string;
  exchangeRate: string | null;
  customerMode: boolean;
  selections: QuoteSelectionInput[];
};

type QuoteSelectionInput = {
  productId: string;
  offerId: string;
  quantity: number;
  remark: string | null;
};

function parseQuoteFormData(formData: FormData): QuoteFormInput {
  const selectedProducts = readSelectedProducts(formData);

  return {
    customerName: readRequired(formData, "customerName", "客户名不能为空。"),
    profitMargin: readNonNegativeDecimal(formData, "profitMargin", "利润率不能小于 0。"),
    currency: readRequired(formData, "currency", "报价币种不能为空。").toUpperCase(),
    exchangeRate: readOptionalDecimal(formData, "exchangeRate", "汇率必须大于 0。"),
    customerMode: formData.get("customerMode") === "on",
    selections: selectedProducts.map((productId) => ({
      productId,
      offerId: readRequired(formData, `supplierOfferId:${productId}`, "每个已选产品都必须选择供应商报价。"),
      quantity: readPositiveInteger(formData, `quantity:${productId}`, "数量必须大于 0。"),
      remark: readOptional(formData, `remark:${productId}`),
    })),
  };
}

async function prepareQuoteItems(input: QuoteFormInput) {
  const offerIds = input.selections.map((selection) => selection.offerId);
  const offers = await prisma.supplierOffer.findMany({
    where: { id: { in: offerIds } },
    select: {
      id: true,
      productId: true,
      factoryName: true,
      purchasePrice: true,
      currency: true,
      moq: true,
      ctnQty: true,
      ctnLength: true,
      ctnWidth: true,
      ctnHeight: true,
      product: {
        include: {
          params: {
            select: {
              paramKey: true,
              rawValue: true,
              normalizedValue: true,
              unit: true,
              confidence: true,
            },
          },
        },
      },
    },
  });
  if (offers.length !== offerIds.length) {
    throw new Error("选择的供应商报价不存在。");
  }

  const offerById = new Map(offers.map((offer) => [offer.id, offer]));

  return input.selections.map((selection) => {
    const offer = offerById.get(selection.offerId);
    if (!offer || offer.productId !== selection.productId) {
      throw new Error("供应商报价和产品不匹配。");
    }

    const salePrice = calculateSalePrice({
      purchasePrice: offer.purchasePrice,
      purchaseCurrency: offer.currency,
      saleCurrency: input.currency,
      exchangeRate: input.exchangeRate,
      profitMargin: input.profitMargin,
    });

    return { offer, quantity: selection.quantity, remark: selection.remark, salePrice };
  });
}

function mapProductParams(
  params: Array<{ paramKey: string; rawValue: string; normalizedValue: string | null; unit: string | null }>,
) {
  return params.map((param) => ({
    paramKey: param.paramKey,
    rawValue: param.rawValue,
    normalizedValue: param.normalizedValue,
    unit: param.unit,
  }));
}

function readSelectedProducts(formData: FormData): string[] {
  const values = formData.getAll("productIds").filter((value): value is string => typeof value === "string");
  if (values.length === 0) {
    throw new Error("请至少勾选一个产品。");
  }
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function readRequired(formData: FormData, key: string, message: string): string {
  const value = formData.get(key);
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(message);
  }
  return value.trim();
}

function readOptional(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readNonNegativeDecimal(formData: FormData, key: string, message: string): string {
  const value = readRequired(formData, key, message);
  if (!/^\d+(\.\d+)?$/.test(value)) {
    throw new Error(message);
  }
  return value;
}

function readOptionalDecimal(formData: FormData, key: string, message: string): string | null {
  const value = readOptional(formData, key);
  if (value === null) {
    return null;
  }
  if (!/^\d+(\.\d+)?$/.test(value) || Number(value) <= 0) {
    throw new Error(message);
  }
  return value;
}

function readPositiveInteger(formData: FormData, key: string, message: string): number {
  const value = readRequired(formData, key, message);
  if (!/^\d+$/.test(value) || Number(value) <= 0) {
    throw new Error(message);
  }
  return Number(value);
}

function safeFileName(value: string): string {
  return value
    .normalize("NFC")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 48);
}

async function quoteFileExists(filePath: string | null): Promise<boolean> {
  if (!filePath) {
    return false;
  }
  try {
    const file = await stat(filePath);
    return file.isFile();
  } catch {
    return false;
  }
}

function serializeQuoteSelectionProduct(
  product: Awaited<ReturnType<typeof prisma.product.findMany>>[number] & {
    supplierOffers: Array<{
      id: string;
      factoryName: string;
      purchasePrice: { toString(): string };
      currency: string;
      moq: string | null;
      ctnQty: string | null;
      ctnLength: string | null;
      ctnWidth: string | null;
      ctnHeight: string | null;
      leadTime: string | null;
      remark: string | null;
      priceUpdatedAt: Date | null;
    }>;
  },
): QuoteSelectionProduct {
  return {
    id: product.id,
    productName: product.productName,
    modelNo: product.modelNo,
    material: product.material,
    size: product.size,
    remark: product.remark,
    supplierOffers: product.supplierOffers.map((offer) => ({
      id: offer.id,
      factoryName: offer.factoryName,
      purchasePrice: offer.purchasePrice.toString(),
      currency: offer.currency,
      moq: offer.moq,
      ctnQty: offer.ctnQty,
      ctnLength: offer.ctnLength,
      ctnWidth: offer.ctnWidth,
      ctnHeight: offer.ctnHeight,
      leadTime: offer.leadTime,
      remark: offer.remark,
      priceUpdatedAt: serializePriceUpdatedAt(offer.priceUpdatedAt),
    })),
  };
}

function serializePriceUpdatedAt(value: string | Date | null): string | null {
  if (value == null) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : value;
}
