"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  buildSupplierOfferFromRaw,
  optionalTextFromForm,
  parseTriageProductForm,
} from "@/lib/raw-product-triage";
import { prisma } from "@/lib/prisma";

export async function importRawAsNewProduct(formData: FormData) {
  const rawProductId = readRequired(formData, "rawProductId", "raw_product ID 不能为空。");

  try {
    const productInput = parseTriageProductForm(formData);
    const manualMoq = optionalTextFromForm(formData, "moq");
    const rawProduct = await getPendingRawProduct(rawProductId);

    await prisma.$transaction(async (tx) => {
      const product = await tx.product.create({ data: productInput });
      const offerInput = buildSupplierOfferFromRaw(rawProduct, product.id, manualMoq);
      await tx.supplierOffer.create({ data: offerInput });
      await tx.rawProduct.update({
        where: { id: rawProduct.id },
        data: { rawStatus: "processed" },
      });
    });
  } catch (error) {
    redirectWithError(error);
  }

  revalidatePath("/triage");
  redirect("/triage");
}

export async function linkRawToExistingProduct(formData: FormData) {
  const rawProductId = readRequired(formData, "rawProductId", "raw_product ID 不能为空。");
  const productId = readRequired(formData, "productId", "请选择已有产品。");

  try {
    const manualMoq = optionalTextFromForm(formData, "moq");
    const rawProduct = await getPendingRawProduct(rawProductId);
    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) {
      throw new Error("选择的产品不存在。");
    }

    await prisma.$transaction(async (tx) => {
      const offerInput = buildSupplierOfferFromRaw(rawProduct, productId, manualMoq);
      await tx.supplierOffer.create({ data: offerInput });
      await tx.rawProduct.update({
        where: { id: rawProduct.id },
        data: { rawStatus: "processed" },
      });
    });
  } catch (error) {
    redirectWithError(error);
  }

  revalidatePath("/triage");
  redirect("/triage");
}

export async function ignoreRawProduct(formData: FormData) {
  const rawProductId = readRequired(formData, "rawProductId", "raw_product ID 不能为空。");

  try {
    await prisma.rawProduct.update({
      where: { id: rawProductId },
      data: { rawStatus: "ignored" },
    });
  } catch (error) {
    redirectWithError(error);
  }

  revalidatePath("/triage");
  redirect("/triage");
}

async function getPendingRawProduct(rawProductId: string) {
  const rawProduct = await prisma.rawProduct.findUnique({ where: { id: rawProductId } });

  if (!rawProduct) {
    throw new Error("raw_product 不存在。");
  }
  if (rawProduct.rawStatus !== "pending") {
    throw new Error("该 raw_product 已处理，不能重复整理。");
  }

  return rawProduct;
}

function readRequired(formData: FormData, key: string, message: string): string {
  const value = formData.get(key);
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(message);
  }
  return value.trim();
}

function redirectWithError(error: unknown): never {
  const message = error instanceof Error ? error.message : "产品整理失败。";
  redirect(`/triage?error=${encodeURIComponent(message)}`);
}
