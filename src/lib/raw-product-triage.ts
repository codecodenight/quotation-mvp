type FormSource = FormData | Record<string, unknown>;

export type TriageProductInput = {
  productName: string;
  category: string | null;
  modelNo: string | null;
  material: string | null;
  size: string | null;
  imagePath: string | null;
  remark: string | null;
};

type RawProductForOffer = {
  sourceFileId: string;
  factoryName: string | null;
  rawPrice: { toString(): string } | null;
  rawCurrency: string | null;
  rawMoq: string | null;
};

export type SupplierOfferFromRawInput = {
  productId: string;
  factoryName: string;
  purchasePrice: string;
  currency: string;
  moq: string | null;
  leadTime: string | null;
  sourceFileId: string;
  remark: string | null;
};

export function parseTriageProductForm(source: FormSource): TriageProductInput {
  return {
    productName: requiredText(source, "productName", "产品名不能为空"),
    category: optionalText(source, "category"),
    modelNo: optionalText(source, "modelNo"),
    material: optionalText(source, "material"),
    size: optionalText(source, "size"),
    imagePath: optionalText(source, "imagePath"),
    remark: optionalText(source, "remark"),
  };
}

export function buildSupplierOfferFromRaw(
  rawProduct: RawProductForOffer,
  productId: string,
  manualMoq: string | null,
): SupplierOfferFromRawInput {
  if (!rawProduct.rawPrice) {
    throw new Error("raw_price 为空，不能创建 supplier_offer。");
  }
  if (!rawProduct.rawCurrency) {
    throw new Error("raw_currency 为空，不能创建 supplier_offer。");
  }
  if (!rawProduct.factoryName) {
    throw new Error("factory_name 为空，不能创建 supplier_offer。");
  }

  return {
    productId,
    factoryName: rawProduct.factoryName,
    purchasePrice: rawProduct.rawPrice.toString(),
    currency: rawProduct.rawCurrency,
    moq: normalizeOptional(manualMoq) ?? rawProduct.rawMoq,
    leadTime: null,
    sourceFileId: rawProduct.sourceFileId,
    remark: null,
  };
}

export function optionalTextFromForm(source: FormSource, key: string): string | null {
  return optionalText(source, key);
}

function requiredText(source: FormSource, key: string, message: string): string {
  const value = optionalText(source, key);
  if (!value) {
    throw new Error(message);
  }
  return value;
}

function optionalText(source: FormSource, key: string): string | null {
  return normalizeOptional(readValue(source, key));
}

function normalizeOptional(value: unknown): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length > 0 ? text : null;
}

function readValue(source: FormSource, key: string): string {
  if (source instanceof FormData) {
    const value = source.get(key);
    return typeof value === "string" ? value : "";
  }

  const value = source[key];
  return typeof value === "string" ? value : "";
}
