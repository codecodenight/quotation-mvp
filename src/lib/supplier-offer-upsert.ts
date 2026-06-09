type DecimalLike = string | number | { toString(): string };

type ExistingSupplierOffer = {
  id: string;
  purchasePrice: DecimalLike;
  currency: string;
  moq: string | null;
  ctnQty: string | null;
  ctnLength: string | null;
  ctnWidth: string | null;
  ctnHeight: string | null;
  sourceFileId: string | null;
};

type SupplierOfferFindArgs = {
  where: { productId: string; factoryName: string };
  select?: Record<string, boolean>;
  orderBy?: Array<Record<string, "asc" | "desc">>;
};

type SupplierOfferCreateData = {
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
  priceUpdatedAt: Date;
};

type SupplierOfferUpdateData = Partial<{
  purchasePrice: string;
  currency: string;
  moq: string | null;
  ctnQty: string | null;
  ctnLength: string | null;
  ctnWidth: string | null;
  ctnHeight: string | null;
  sourceFileId: string | null;
  priceUpdatedAt: Date;
}>;

type PriceHistoryCreateData = {
  supplierOfferId: string;
  oldPrice: string;
  newPrice: string;
  oldSourceFileId: string | null;
  newSourceFileId: string | null;
};

export type SupplierOfferUpsertClient = {
  supplierOffer: {
    findFirst(args: SupplierOfferFindArgs): Promise<ExistingSupplierOffer | null>;
    create(args: { data: SupplierOfferCreateData; select?: { id: true } }): Promise<{ id: string }>;
    update(args: { where: { id: string }; data: SupplierOfferUpdateData; select?: { id: true } }): Promise<{ id: string }>;
  };
  priceHistory: {
    create(args: { data: PriceHistoryCreateData }): Promise<{ id: string }>;
  };
};

export type SupplierOfferUpsertInput = {
  productId: string;
  factoryName: string;
  purchasePrice: string;
  currency: string;
  moq: string | null;
  ctnQty: string | null;
  ctnLength: string | null;
  ctnWidth: string | null;
  ctnHeight: string | null;
  sourceFileId: string | null;
  remark: string | null;
};

export type SupplierOfferUpsertResult = {
  offerId: string;
  status: "created" | "updated" | "skipped";
  priceChanged: boolean;
  supplemented: boolean;
};

export async function upsertSupplierOffer(
  tx: SupplierOfferUpsertClient,
  input: SupplierOfferUpsertInput,
  now = new Date(),
): Promise<SupplierOfferUpsertResult> {
  const existingOffer = await tx.supplierOffer.findFirst({
    where: {
      productId: input.productId,
      factoryName: input.factoryName,
    },
    select: {
      id: true,
      purchasePrice: true,
      currency: true,
      moq: true,
      ctnQty: true,
      ctnLength: true,
      ctnWidth: true,
      ctnHeight: true,
      sourceFileId: true,
    },
    orderBy: [{ priceUpdatedAt: "desc" }, { createdAt: "desc" }],
  });

  if (!existingOffer) {
    const createdOffer = await tx.supplierOffer.create({
      data: {
        productId: input.productId,
        factoryName: input.factoryName,
        purchasePrice: input.purchasePrice,
        currency: input.currency,
        moq: input.moq,
        ctnQty: input.ctnQty,
        ctnLength: input.ctnLength,
        ctnWidth: input.ctnWidth,
        ctnHeight: input.ctnHeight,
        leadTime: null,
        sourceFileId: input.sourceFileId,
        remark: input.remark,
        priceUpdatedAt: now,
      },
      select: { id: true },
    });
    return {
      offerId: createdOffer.id,
      status: "created",
      priceChanged: false,
      supplemented: false,
    };
  }

  const supplementData = buildSupplementData(existingOffer, input);
  const supplemented = Object.keys(supplementData).length > 0;
  const priceChanged = !sameDecimal(existingOffer.purchasePrice, input.purchasePrice);

  if (!priceChanged && !supplemented) {
    return {
      offerId: existingOffer.id,
      status: "skipped",
      priceChanged: false,
      supplemented: false,
    };
  }

  if (priceChanged) {
    await tx.priceHistory.create({
      data: {
        supplierOfferId: existingOffer.id,
        oldPrice: existingOffer.purchasePrice.toString(),
        newPrice: input.purchasePrice,
        oldSourceFileId: existingOffer.sourceFileId,
        newSourceFileId: input.sourceFileId,
      },
    });
  }

  await tx.supplierOffer.update({
    where: { id: existingOffer.id },
    data: {
      ...supplementData,
      ...(priceChanged
        ? {
            purchasePrice: input.purchasePrice,
            currency: input.currency,
            sourceFileId: input.sourceFileId,
            priceUpdatedAt: now,
          }
        : {}),
    },
    select: { id: true },
  });

  return {
    offerId: existingOffer.id,
    status: "updated",
    priceChanged,
    supplemented,
  };
}

function buildSupplementData(
  existingOffer: ExistingSupplierOffer,
  input: SupplierOfferUpsertInput,
): SupplierOfferUpdateData {
  const data: SupplierOfferUpdateData = {};
  supplementText(data, "moq", existingOffer.moq, input.moq);
  supplementText(data, "ctnQty", existingOffer.ctnQty, input.ctnQty);
  supplementText(data, "ctnLength", existingOffer.ctnLength, input.ctnLength);
  supplementText(data, "ctnWidth", existingOffer.ctnWidth, input.ctnWidth);
  supplementText(data, "ctnHeight", existingOffer.ctnHeight, input.ctnHeight);
  return data;
}

function supplementText<K extends keyof SupplierOfferUpdateData>(
  data: SupplierOfferUpdateData,
  key: K,
  existingValue: string | null,
  incomingValue: string | null,
): void {
  if (isBlank(existingValue) && !isBlank(incomingValue)) {
    data[key] = incomingValue as SupplierOfferUpdateData[K];
  }
}

function sameDecimal(left: DecimalLike, right: DecimalLike): boolean {
  const leftNumber = Number(left.toString());
  const rightNumber = Number(right.toString());
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
    return Math.abs(leftNumber - rightNumber) < 0.000001;
  }
  return left.toString() === right.toString();
}

function isBlank(value: string | null): boolean {
  return value === null || value.trim().length === 0;
}
