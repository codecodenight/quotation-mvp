type FormSource = FormData | Record<string, unknown>;

export type ProductFormInput = {
  productName: string;
  category: string | null;
  modelNo: string | null;
  material: string | null;
  size: string | null;
  imagePath: string | null;
  remark: string | null;
};

export type SupplierOfferFormInput = {
  productId: string;
  factoryName: string;
  purchasePrice: string;
  currency: string;
  moq: string | null;
  ctnQty: string | null;
  ctnLength: string | null;
  ctnWidth: string | null;
  ctnHeight: string | null;
  leadTime: string | null;
  sourceFileId: string | null;
  remark: string | null;
};

export function parseProductForm(source: FormSource): ProductFormInput {
  const productName = requiredText(source, "productName", "产品名不能为空");

  return {
    productName,
    category: optionalText(source, "category"),
    modelNo: optionalText(source, "modelNo"),
    material: optionalText(source, "material"),
    size: optionalText(source, "size"),
    imagePath: optionalText(source, "imagePath"),
    remark: optionalText(source, "remark"),
  };
}

export function parseSupplierOfferForm(source: FormSource): SupplierOfferFormInput {
  const productId = requiredText(source, "productId", "产品 ID 不能为空");
  const factoryName = requiredText(source, "factoryName", "工厂名不能为空");
  const purchasePrice = requiredPositiveDecimal(source, "purchasePrice", "采购价必须大于 0");
  const currency = requiredText(source, "currency", "币种不能为空").toUpperCase();

  return {
    productId,
    factoryName,
    purchasePrice,
    currency,
    moq: optionalText(source, "moq"),
    ctnQty: optionalText(source, "ctnQty"),
    ctnLength: optionalText(source, "ctnLength"),
    ctnWidth: optionalText(source, "ctnWidth"),
    ctnHeight: optionalText(source, "ctnHeight"),
    leadTime: optionalText(source, "leadTime"),
    sourceFileId: optionalText(source, "sourceFileId"),
    remark: optionalText(source, "remark"),
  };
}

function requiredText(source: FormSource, key: string, message: string): string {
  const value = optionalText(source, key);
  if (!value) {
    throw new Error(message);
  }
  return value;
}

function optionalText(source: FormSource, key: string): string | null {
  const raw = readValue(source, key);
  const value = raw.trim();
  return value.length > 0 ? value : null;
}

function requiredPositiveDecimal(source: FormSource, key: string, message: string): string {
  const value = requiredText(source, key, message);
  if (!/^\d+(\.\d+)?$/.test(value) || Number(value) <= 0) {
    throw new Error(message);
  }
  return value;
}

function readValue(source: FormSource, key: string): string {
  if (source instanceof FormData) {
    const value = source.get(key);
    return typeof value === "string" ? value : "";
  }

  const value = source[key];
  return typeof value === "string" ? value : "";
}
