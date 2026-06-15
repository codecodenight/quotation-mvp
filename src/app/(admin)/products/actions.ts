"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { parseProductForm, parseSupplierOfferForm } from "@/lib/product-form";
import { prisma } from "@/lib/prisma";

export async function createProduct(formData: FormData) {
  try {
    const input = parseProductForm(formData);
    await prisma.product.create({ data: input });
  } catch (error) {
    redirectWithError(error);
  }

  revalidatePath("/products");
  redirect("/products");
}

export async function updateProduct(formData: FormData) {
  const id = readRequiredId(formData, "id", "产品 ID 不能为空");

  try {
    const input = parseProductForm(formData);
    await prisma.product.update({ where: { id }, data: input });
  } catch (error) {
    redirectWithError(error);
  }

  revalidatePath("/products");
  redirect("/products");
}

export async function deleteProduct(formData: FormData) {
  const id = readRequiredId(formData, "id", "产品 ID 不能为空");

  try {
    await prisma.product.delete({ where: { id } });
  } catch {
    redirect("/products?error=产品已有报价或报价明细关联，不能删除。");
  }

  revalidatePath("/products");
  redirect("/products");
}

export async function createSupplierOffer(formData: FormData) {
  try {
    const input = parseSupplierOfferForm(formData);
    await prisma.supplierOffer.create({ data: input });
  } catch (error) {
    redirectWithError(error);
  }

  revalidatePath("/products");
  redirect("/products");
}

export async function updateSupplierOffer(formData: FormData) {
  const id = readRequiredId(formData, "id", "报价 ID 不能为空");

  try {
    const input = parseSupplierOfferForm(formData);
    await prisma.supplierOffer.update({ where: { id }, data: input });
  } catch (error) {
    redirectWithError(error);
  }

  revalidatePath("/products");
  redirect("/products");
}

export async function deleteSupplierOffer(formData: FormData) {
  const id = readRequiredId(formData, "id", "报价 ID 不能为空");

  try {
    await prisma.supplierOffer.delete({ where: { id } });
  } catch {
    redirect("/products?error=报价已有历史报价明细关联，不能删除。");
  }

  revalidatePath("/products");
  redirect("/products");
}

function readRequiredId(formData: FormData, key: string, message: string): string {
  const value = formData.get(key);
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(message);
  }
  return value.trim();
}

function redirectWithError(error: unknown): never {
  const message = error instanceof Error ? error.message : "操作失败。";
  redirect(`/products?error=${encodeURIComponent(message)}`);
}
