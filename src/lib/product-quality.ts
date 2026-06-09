import type { Prisma } from "@prisma/client";

export type ProductQualityFilter =
  | "all"
  | "needsData"
  | "missingCtn"
  | "missingSize"
  | "temporaryModel"
  | "identifierIssue";

export type ProductQualityIssueInput = {
  modelNo: string | null;
  productName?: string | null;
  size: string | null;
  supplierOffers: {
    ctnQty: string | null;
    ctnLength: string | null;
    ctnWidth: string | null;
    ctnHeight: string | null;
  }[];
};

export const PRODUCT_QUALITY_FILTERS: { value: ProductQualityFilter; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "needsData", label: "待补资料" },
  { value: "missingCtn", label: "缺 CTN" },
  { value: "missingSize", label: "缺 Size" },
  { value: "temporaryModel", label: "临时款号" },
  { value: "identifierIssue", label: "标识异常" },
];

export const missingCtnOfferWhere: Prisma.SupplierOfferWhereInput = {
  OR: [
    { ctnQty: null },
    { ctnQty: "" },
    { ctnLength: null },
    { ctnLength: "" },
    { ctnWidth: null },
    { ctnWidth: "" },
    { ctnHeight: null },
    { ctnHeight: "" },
  ],
};

export const missingSizeProductWhere: Prisma.ProductWhereInput = {
  OR: [{ size: null }, { size: "" }],
};

export const temporaryModelProductWhere: Prisma.ProductWhereInput = {
  modelNo: { startsWith: "壁灯-" },
};

export const numericIdentifierValues = Array.from({ length: 500 }, (_, index) => String(index + 1));

export const productIdentifierIssueWhere: Prisma.ProductWhereInput = {
  OR: [
    { modelNo: null },
    { modelNo: "" },
    temporaryModelProductWhere,
    { modelNo: { in: numericIdentifierValues } },
    { productName: { in: numericIdentifierValues } },
  ],
};

export function normalizeProductQualityFilter(value: string | undefined): ProductQualityFilter {
  return PRODUCT_QUALITY_FILTERS.some((filter) => filter.value === value) ? (value as ProductQualityFilter) : "all";
}

export function buildProductQualityWhere(filter: ProductQualityFilter): Prisma.ProductWhereInput {
  switch (filter) {
    case "needsData":
      return {
        OR: [
          { supplierOffers: { some: missingCtnOfferWhere } },
          missingSizeProductWhere,
          temporaryModelProductWhere,
          productIdentifierIssueWhere,
        ],
      };
    case "missingCtn":
      return { supplierOffers: { some: missingCtnOfferWhere } };
    case "missingSize":
      return missingSizeProductWhere;
    case "temporaryModel":
      return temporaryModelProductWhere;
    case "identifierIssue":
      return productIdentifierIssueWhere;
    case "all":
      return {};
  }
}

export function buildProductQualityIssueSummary(product: ProductQualityIssueInput): string[] {
  const issues: string[] = [];

  if (!product.size?.trim()) {
    issues.push("缺 Size");
  }
  if (product.supplierOffers.some(hasMissingCtnData)) {
    issues.push("缺 CTN");
  }
  if (product.modelNo?.startsWith("壁灯-")) {
    issues.push("临时款号");
  }
  if (hasProductIdentifierIssue(product)) {
    issues.push("标识异常");
  }

  return Array.from(new Set(issues));
}

export function hasProductIdentifierIssue(product: Pick<ProductQualityIssueInput, "modelNo" | "productName">): boolean {
  const modelNo = product.modelNo?.trim() ?? "";
  const productName = product.productName?.trim() ?? "";

  return (
    modelNo.length === 0 ||
    modelNo.startsWith("壁灯-") ||
    isPlainInteger(modelNo) ||
    isPlainInteger(productName)
  );
}

function isPlainInteger(value: string): boolean {
  return /^\d+$/.test(value);
}

function hasMissingCtnData(offer: ProductQualityIssueInput["supplierOffers"][number]): boolean {
  return (
    !offer.ctnQty?.trim() ||
    !offer.ctnLength?.trim() ||
    !offer.ctnWidth?.trim() ||
    !offer.ctnHeight?.trim()
  );
}
