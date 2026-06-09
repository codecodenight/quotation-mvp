"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { buildHejiaImportRows, type HejiaProductInput } from "@/lib/hejia-import";
import { extractImagesFromExcel, storeExtractedImage, type ExtractedImage } from "@/lib/image-extractor";
import { buildRawProductRows, type IdentifierTarget, readSheetRows } from "@/lib/excel-import";
import { resolveStoredFilePath } from "@/lib/file-paths";
import { prisma } from "@/lib/prisma";
import { upsertSupplierOffer } from "@/lib/supplier-offer-upsert";

export async function importRawProducts(formData: FormData) {
  let fileId: string;
  let sheetName: string;
  let headerRowIndex: number;
  let identifierColumn: number;
  let priceColumn: number;
  let currency: string;
  let identifierTarget: IdentifierTarget;

  try {
    fileId = requiredText(formData, "fileId", "请选择 Excel 文件。");
    sheetName = requiredText(formData, "sheetName", "请选择 sheet。");
    headerRowIndex = requiredPositiveInteger(formData, "headerRowIndex", "请选择表头行。");
    identifierColumn = requiredColumn(formData, "identifierColumn", "产品标识列不能为空");
    priceColumn = requiredColumn(formData, "priceColumn", "价格列不能为空");
    currency = requiredText(formData, "currency", "币种不能为空。").toUpperCase();
    identifierTarget = readIdentifierTarget(formData);
  } catch (error) {
    const message = error instanceof Error ? error.message : "导入表单不完整。";
    redirect(`/import?error=${encodeURIComponent(message)}`);
  }

  const file = await prisma.file.findUnique({ where: { id: fileId } });
  if (!file || file.fileType !== "excel") {
    redirect(`/import?error=${encodeURIComponent("Excel 文件记录不存在。")}`);
  }

  let importedCount = 0;

  try {
    const resolvedPath = await resolveStoredFilePath(file);
    const rows = readSheetRows(resolvedPath, sheetName);
    const rawRows = buildRawProductRows({
      sourceFileId: file.id,
      factoryName: file.factoryGuess,
      sheetName,
      headerRowIndex,
      rows,
      mapping: {
        identifierColumn,
        identifierTarget,
        priceColumn,
        currency,
        moqColumn: optionalColumn(formData, "moqColumn"),
        materialColumn: optionalColumn(formData, "materialColumn"),
        sizeColumn: optionalColumn(formData, "sizeColumn"),
        descriptionColumn: optionalColumn(formData, "descriptionColumn"),
      },
    });

    if (rawRows.length === 0) {
      importedCount = 0;
    } else {
      await prisma.rawProduct.createMany({ data: rawRows });
      importedCount = rawRows.length;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "导入失败。";
    redirect(
      `/import?fileId=${encodeURIComponent(fileId)}&sheetName=${encodeURIComponent(sheetName)}&headerRowIndex=${headerRowIndex}&error=${encodeURIComponent(message)}`,
    );
  }

  revalidatePath("/import");
  if (importedCount === 0) {
    redirect(
      `/import?fileId=${encodeURIComponent(fileId)}&sheetName=${encodeURIComponent(sheetName)}&headerRowIndex=${headerRowIndex}&error=没有可导入的产品行。`,
    );
  }

  redirect(
    `/import?fileId=${encodeURIComponent(fileId)}&sheetName=${encodeURIComponent(sheetName)}&headerRowIndex=${headerRowIndex}&imported=${importedCount}`,
  );
}

export async function importHejiaProducts(formData: FormData) {
  let fileId: string;
  let sheetName: string;
  let headerRowIndex: number;
  let modelNoColumn: number;
  let factoryNameColumn: number;
  let factoryPriceColumn: number;
  let currency: string;

  try {
    fileId = requiredText(formData, "fileId", "请选择 Excel 文件。");
    sheetName = requiredText(formData, "sheetName", "请选择 sheet。");
    headerRowIndex = requiredPositiveInteger(formData, "headerRowIndex", "请选择表头行。");
    modelNoColumn = requiredColumn(formData, "modelNoColumn", "产品款号列不能为空");
    factoryNameColumn = requiredColumn(formData, "factoryNameColumn", "工厂名列不能为空");
    factoryPriceColumn = requiredColumn(formData, "factoryPriceColumn", "工厂RMB价格列不能为空");
    currency = requiredText(formData, "currency", "币种不能为空。").toUpperCase();
  } catch (error) {
    const message = error instanceof Error ? error.message : "核价导入表单不完整。";
    redirect(`/import?importMode=hejia&error=${encodeURIComponent(message)}`);
  }

  const file = await prisma.file.findUnique({ where: { id: fileId } });
  if (!file || file.fileType !== "excel") {
    redirect(`/import?importMode=hejia&error=${encodeURIComponent("Excel 文件记录不存在。")}`);
  }

  let importedOfferCount = 0;
  let skippedRowCount = 0;
  let importedImageCount = 0;
  let failedImageCount = 0;
  let skippedRowsParam = encodeURIComponent("[]");

  try {
    const resolvedPath = await resolveStoredFilePath(file);
    const rows = readSheetRows(resolvedPath, sheetName);
    const hejiaRows = buildHejiaImportRows({
      sourceFileId: file.id,
      sheetName,
      headerRowIndex,
      rows,
      mapping: {
        modelNoColumn,
        factoryNameColumn,
        factoryPriceColumn,
        currency,
        descriptionColumns: optionalColumns(formData, "descriptionColumns"),
        descriptionColumn: optionalColumn(formData, "descriptionColumn"),
        sizeColumn: optionalColumn(formData, "sizeColumn"),
        moqColumn: optionalColumn(formData, "moqColumn"),
        ctnQtyColumn: optionalColumn(formData, "ctnQtyColumn"),
        ctnSizeColumn: optionalColumn(formData, "ctnSizeColumn"),
        ctnLengthColumn: optionalColumn(formData, "ctnLengthColumn"),
        ctnWidthColumn: optionalColumn(formData, "ctnWidthColumn"),
        ctnHeightColumn: optionalColumn(formData, "ctnHeightColumn"),
        customerUsdPriceColumn: optionalColumn(formData, "customerUsdPriceColumn"),
        coefficientColumn: optionalColumn(formData, "coefficientColumn"),
      },
    });

    if (hejiaRows.offers.length > 0) {
      const productIdByModelNo = new Map<string, string>();

      await prisma.$transaction(async (tx) => {
        for (const productInput of hejiaRows.products) {
          const existingProduct = await tx.product.findFirst({
            where: { modelNo: productInput.modelNo },
            orderBy: [{ createdAt: "asc" }],
          });

          if (existingProduct) {
            productIdByModelNo.set(productInput.modelNo, existingProduct.id);
            continue;
          }

          const createdProduct = await tx.product.create({
            data: {
              productName: productInput.productName,
              category: productInput.category,
              modelNo: productInput.modelNo,
              material: null,
              size: productInput.size,
              imagePath: null,
              remark: productInput.remark,
            },
          });
          productIdByModelNo.set(productInput.modelNo, createdProduct.id);
        }

        for (const offerInput of hejiaRows.offers) {
          const productId = productIdByModelNo.get(offerInput.modelNo);
          if (!productId) {
            throw new Error(`产品 ${offerInput.modelNo} 未创建，不能写入 supplier_offer。`);
          }

          await upsertSupplierOffer(tx, {
            productId,
            factoryName: offerInput.factoryName,
            purchasePrice: offerInput.purchasePrice,
            currency: offerInput.currency,
            moq: offerInput.moq,
            ctnQty: offerInput.ctnQty,
            ctnLength: offerInput.ctnLength,
            ctnWidth: offerInput.ctnWidth,
            ctnHeight: offerInput.ctnHeight,
            sourceFileId: offerInput.sourceFileId,
            remark: offerInput.remark,
          });
        }
      });
      importedOfferCount = hejiaRows.offers.length;

      const imageResult = await attachHejiaProductImages({
        filePath: resolvedPath,
        sourceFileId: file.id,
        sheetName,
        products: hejiaRows.products.flatMap((product) => {
          const productId = productIdByModelNo.get(product.modelNo);
          return productId ? [{ ...product, productId }] : [];
        }),
      });
      importedImageCount = imageResult.importedImageCount;
      failedImageCount = imageResult.failedImageCount;
    }
    skippedRowCount = hejiaRows.skippedRows.length;
    skippedRowsParam = encodeURIComponent(JSON.stringify(hejiaRows.skippedRows.slice(0, 20)));
  } catch (error) {
    const message = error instanceof Error ? error.message : "核价导入失败。";
    redirect(
      `/import?importMode=hejia&fileId=${encodeURIComponent(fileId)}&sheetName=${encodeURIComponent(sheetName)}&headerRowIndex=${headerRowIndex}&error=${encodeURIComponent(message)}`,
    );
  }

  revalidatePath("/import");
  revalidatePath("/products");
  if (importedOfferCount === 0) {
    redirect(
      `/import?importMode=hejia&fileId=${encodeURIComponent(fileId)}&sheetName=${encodeURIComponent(sheetName)}&headerRowIndex=${headerRowIndex}&error=${encodeURIComponent("没有可导入的核价行。")}&hejiaSkipped=${skippedRowCount}&hejiaSkippedRows=${skippedRowsParam}`,
    );
  }

  redirect(
    `/import?importMode=hejia&fileId=${encodeURIComponent(fileId)}&sheetName=${encodeURIComponent(sheetName)}&headerRowIndex=${headerRowIndex}&hejiaImported=${importedOfferCount}&hejiaSkipped=${skippedRowCount}&hejiaImages=${importedImageCount}&hejiaImageFailed=${failedImageCount}&hejiaSkippedRows=${skippedRowsParam}`,
  );
}

async function attachHejiaProductImages({
  filePath,
  sourceFileId,
  sheetName,
  products,
}: {
  filePath: string;
  sourceFileId: string;
  sheetName: string;
  products: Array<HejiaProductInput & { productId: string }>;
}): Promise<{ importedImageCount: number; failedImageCount: number }> {
  if (products.length === 0) {
    return { importedImageCount: 0, failedImageCount: 0 };
  }

  let extractedImages: ExtractedImage[];
  try {
    extractedImages = await extractImagesFromExcel(filePath, sheetName);
  } catch {
    return { importedImageCount: 0, failedImageCount: 1 };
  }

  if (extractedImages.length === 0) {
    return { importedImageCount: 0, failedImageCount: 0 };
  }

  const imageByRow = new Map<number, ExtractedImage>();
  for (const image of extractedImages) {
    if (!imageByRow.has(image.anchorRow)) {
      imageByRow.set(image.anchorRow, image);
    }
  }

  const existingProducts = await prisma.product.findMany({
    where: { id: { in: products.map((product) => product.productId) } },
    select: { id: true, imagePath: true },
  });
  const existingImageByProductId = new Map(existingProducts.map((product) => [product.id, product.imagePath]));
  let importedImageCount = 0;
  let failedImageCount = 0;

  for (const product of products) {
    if (existingImageByProductId.get(product.productId)) {
      continue;
    }

    const image = imageByRow.get(product.sourceRowIndex);
    if (!image) {
      continue;
    }

    try {
      const storedImage = await storeExtractedImage({ image, sourceFileId, sheetName });
      await prisma.product.update({
        where: { id: product.productId },
        data: { imagePath: storedImage.thumbnailPath },
      });
      existingImageByProductId.set(product.productId, storedImage.thumbnailPath);
      importedImageCount += 1;
    } catch {
      failedImageCount += 1;
    }
  }

  return { importedImageCount, failedImageCount };
}

function requiredText(formData: FormData, key: string, message: string): string {
  const value = formData.get(key);
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(message);
  }
  return value.trim();
}

function requiredPositiveInteger(formData: FormData, key: string, message: string): number {
  const value = Number(requiredText(formData, key, message));
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(message);
  }
  return value;
}

function requiredColumn(formData: FormData, key: string, message: string): number {
  const value = optionalColumn(formData, key);
  if (value === null) {
    throw new Error(message);
  }
  return value;
}

function optionalColumn(formData: FormData, key: string): number | null {
  const value = formData.get(key);
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function optionalColumns(formData: FormData, key: string): number[] {
  return formData
    .getAll(key)
    .filter((value): value is string => typeof value === "string" && value.trim() !== "")
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value >= 0);
}

function readIdentifierTarget(formData: FormData): IdentifierTarget {
  const value = formData.get("identifierTarget");
  return value === "rawModelNo" ? "rawModelNo" : "rawProductName";
}
