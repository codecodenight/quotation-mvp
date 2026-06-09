import type { Prisma } from "@prisma/client";
import { PackagePlus, Pencil, Plus, Trash2 } from "lucide-react";
import Image from "next/image";

import { formatMoney } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import {
  buildProductQualityIssueSummary,
  buildProductQualityWhere,
  missingCtnOfferWhere,
  missingSizeProductWhere,
  productIdentifierIssueWhere,
  PRODUCT_QUALITY_FILTERS,
  temporaryModelProductWhere,
  type ProductQualityFilter,
} from "@/lib/product-quality";
import {
  createProduct,
  createSupplierOffer,
  deleteProduct,
  deleteSupplierOffer,
  updateProduct,
  updateSupplierOffer,
} from "./actions";

const PRODUCT_LIST_LIMIT = 50;
const SOURCE_FILE_SELECT_LIMIT = 80;

type ProductsPageProps = {
  searchParams: Promise<{
    search?: string;
    factory?: string;
    minPrice?: string;
    maxPrice?: string;
    moq?: string;
    quality?: string;
    productId?: string;
    error?: string;
  }>;
};

export default async function ProductsPage({ searchParams }: ProductsPageProps) {
  const params = await searchParams;
  const filters = normalizeFilters(params);
  const [products, sourceFiles, qualityStats] = await Promise.all([
    prisma.product.findMany({
      where: buildProductWhere(filters),
      include: {
        supplierOffers: {
          include: { sourceFile: true },
          orderBy: [{ factoryName: "asc" }, { createdAt: "desc" }],
        },
      },
      orderBy: [{ updatedAt: "desc" }, { productName: "asc" }],
      take: PRODUCT_LIST_LIMIT,
    }),
    prisma.file.findMany({
      orderBy: [{ fileName: "asc" }],
      take: SOURCE_FILE_SELECT_LIMIT,
    }),
    getProductQualityStats(),
  ]);

  return (
    <div className="mx-auto max-w-7xl">
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <div className="text-sm font-semibold uppercase tracking-[0.18em] text-leaf">Phase 3</div>
          <h1 className="mt-2 text-3xl font-semibold text-ink">产品管理</h1>
        </div>
        <div className="rounded-md border border-line bg-paper px-4 py-2 text-sm shadow-panel">
          显示 {products.length} 个产品
        </div>
      </header>

      {filters.error ? (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {filters.error}
        </div>
      ) : null}

      <section className="mb-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
        <form className="rounded-md border border-line bg-paper p-4 shadow-panel">
          <div className="grid gap-3 md:grid-cols-5">
            <Field label="搜索">
              <input
                name="search"
                defaultValue={filters.search}
                placeholder="产品名 / 款号 / 类目"
                className={inputClass}
              />
            </Field>
            <Field label="工厂">
              <input name="factory" defaultValue={filters.factory} placeholder="工厂名" className={inputClass} />
            </Field>
            <Field label="最低价">
              <input name="minPrice" defaultValue={filters.minPrice} placeholder="0" className={inputClass} />
            </Field>
            <Field label="最高价">
              <input name="maxPrice" defaultValue={filters.maxPrice} placeholder="100" className={inputClass} />
            </Field>
            <Field label="MOQ">
              <input name="moq" defaultValue={filters.moq} placeholder="1000/色" className={inputClass} />
            </Field>
          </div>
          <div className="mt-3 flex justify-end">
            <button className="h-10 rounded-md bg-ink px-4 text-sm font-semibold text-white">筛选</button>
          </div>
        </form>

        <details className="rounded-md border border-line bg-paper p-4 shadow-panel" open={products.length === 0}>
          <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold text-ink">
            <PackagePlus className="h-4 w-4 text-brass" aria-hidden="true" />
            新增产品
          </summary>
          <ProductForm action={createProduct} submitLabel="保存产品" />
        </details>
      </section>

      <section className="mb-4 rounded-md border border-line bg-paper p-4 shadow-panel">
        <div className="mb-3 flex flex-wrap gap-2">
          {PRODUCT_QUALITY_FILTERS.map((filter) => (
            <a
              key={filter.value}
              href={buildProductsHref(filters, filter.value)}
              className={`rounded-md border px-3 py-1.5 text-sm font-semibold ${
                filters.quality === filter.value
                  ? "border-leaf bg-leaf text-white"
                  : "border-line bg-white text-stone-700 hover:border-leaf"
              }`}
            >
              {filter.label}
            </a>
          ))}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-stone-700">
          <span>全部 {qualityStats.totalProducts}</span>
          <span>待补资料 {qualityStats.needsDataProducts}</span>
          <span>缺 CTN {qualityStats.missingCtnOffers} offers</span>
          <span>缺 Size {qualityStats.missingSizeProducts}</span>
          <span>临时款号 {qualityStats.temporaryModelProducts}</span>
          <span>标识异常 {qualityStats.identifierIssueProducts}</span>
          {products.length === PRODUCT_LIST_LIMIT ? (
            <span className="text-stone-500">当前列表最多显示前 {PRODUCT_LIST_LIMIT} 个</span>
          ) : null}
        </div>
      </section>

      <section className="space-y-4">
        {products.map((product) => {
          const qualityIssues = buildProductQualityIssueSummary(product);

          return (
            <article
              id={`product-${product.id}`}
              key={product.id}
              className={`scroll-mt-6 rounded-md border bg-paper shadow-panel ${
                filters.productId === product.id ? "border-amber-300 ring-2 ring-amber-100" : "border-line"
              }`}
            >
            <div className="grid gap-4 border-b border-line p-4 lg:grid-cols-[minmax(0,1fr)_360px]">
              <div className="flex gap-4">
                <ProductThumbnail
                  productId={product.id}
                  hasImage={Boolean(product.imagePath)}
                  label={product.modelNo ?? product.productName}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="break-words text-xl font-semibold text-ink">{product.productName}</h2>
                    {product.category ? (
                      <span className="rounded-sm border border-line bg-white px-2 py-1 text-xs text-stone-600">
                        {product.category}
                      </span>
                    ) : null}
                    {qualityIssues.map((issue) => (
                      <span
                        key={issue}
                        className="rounded-sm border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800"
                      >
                        {issue}
                      </span>
                    ))}
                  </div>
                  <div className="mt-2 grid gap-2 text-sm text-stone-700 md:grid-cols-3">
                    <Info label="款号" value={product.modelNo} />
                    <Info label="材质" value={product.material} />
                    <Info label="尺寸" value={product.size} />
                  </div>
                  {product.remark ? <p className="mt-3 whitespace-pre-line text-sm text-stone-600">{product.remark}</p> : null}
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <details className="rounded-md border border-line bg-white p-3">
                  <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold">
                    <Pencil className="h-4 w-4 text-leaf" aria-hidden="true" />
                    编辑产品
                  </summary>
                  <ProductForm action={updateProduct} product={product} submitLabel="更新产品" />
                </details>
                <details className="rounded-md border border-line bg-white p-3">
                  <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold">
                    <Plus className="h-4 w-4 text-leaf" aria-hidden="true" />
                    新增工厂报价
                  </summary>
                  <OfferForm
                    action={createSupplierOffer}
                    productId={product.id}
                    sourceFiles={sourceFiles}
                    submitLabel="保存报价"
                  />
                </details>
                <form action={deleteProduct}>
                  <input type="hidden" name="id" value={product.id} />
                  <button className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 text-sm font-semibold text-red-700">
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                    删除产品
                  </button>
                </form>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm">
                <thead className="bg-[#ebe5d8] text-xs uppercase tracking-[0.08em] text-stone-600">
                  <tr>
                    <th className="px-3 py-3">工厂</th>
                    <th className="px-3 py-3">采购价</th>
                    <th className="px-3 py-3">MOQ</th>
                    <th className="px-3 py-3">CTN</th>
                    <th className="px-3 py-3">交期</th>
                    <th className="px-3 py-3">来源文件</th>
                    <th className="px-3 py-3">备注</th>
                    <th className="px-3 py-3">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line bg-white">
                  {product.supplierOffers.map((offer) => (
                    <tr key={offer.id} className="align-top">
                      <td className="px-3 py-3 font-medium">{offer.factoryName}</td>
                      <td className="whitespace-nowrap px-3 py-3">
                        {formatMoney(offer.purchasePrice, offer.currency)}
                      </td>
                      <td className="px-3 py-3 text-stone-700">{offer.moq ?? "-"}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-stone-700">
                        <div>{offer.ctnQty ? `Qty ${offer.ctnQty}` : "-"}</div>
                        <div className="mt-1 text-xs text-stone-500">
                          {formatCtnDimensions(offer.ctnLength, offer.ctnWidth, offer.ctnHeight)}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-stone-700">{offer.leadTime ?? "-"}</td>
                      <td className="max-w-72 px-3 py-3 text-xs text-stone-600">
                        {offer.sourceFile?.fileName ?? "-"}
                      </td>
                      <td className="max-w-72 px-3 py-3 text-stone-700">{offer.remark ?? "-"}</td>
                      <td className="min-w-64 px-3 py-3">
                        <details className="mb-2 rounded-md border border-line p-2">
                          <summary className="cursor-pointer list-none text-xs font-semibold text-leaf">
                            编辑报价
                          </summary>
                          <OfferForm
                            action={updateSupplierOffer}
                            productId={product.id}
                            offer={offer}
                            sourceFiles={sourceFiles}
                            submitLabel="更新报价"
                          />
                        </details>
                        <form action={deleteSupplierOffer}>
                          <input type="hidden" name="id" value={offer.id} />
                          <button className="inline-flex h-8 items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2 text-xs font-semibold text-red-700">
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                            删除报价
                          </button>
                        </form>
                      </td>
                    </tr>
                  ))}
                  {product.supplierOffers.length === 0 ? (
                    <tr>
                      <td className="px-3 py-6 text-center text-stone-500" colSpan={7}>
                        暂无工厂报价
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            </article>
          );
        })}

        {products.length === 0 ? (
          <div className="rounded-md border border-line bg-paper px-4 py-10 text-center text-stone-500 shadow-panel">
            没有符合条件的产品
          </div>
        ) : null}
      </section>
    </div>
  );
}

type ProductForForm = {
  id: string;
  productName: string;
  category: string | null;
  modelNo: string | null;
  material: string | null;
  size: string | null;
  imagePath: string | null;
  remark: string | null;
};

type OfferForForm = {
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
  sourceFileId: string | null;
  remark: string | null;
};

type SourceFileForForm = {
  id: string;
  fileName: string;
};

const inputClass =
  "h-10 w-full rounded-md border border-line bg-white px-3 text-sm outline-none focus:border-leaf";
const textAreaClass =
  "min-h-20 w-full rounded-md border border-line bg-white px-3 py-2 text-sm outline-none focus:border-leaf";

function ProductForm({
  action,
  product,
  submitLabel,
}: {
  action: (formData: FormData) => Promise<void>;
  product?: ProductForForm;
  submitLabel: string;
}) {
  return (
    <form action={action} className="mt-3 grid gap-3">
      {product ? <input type="hidden" name="id" value={product.id} /> : null}
      <Field label="产品名">
        <input name="productName" defaultValue={product?.productName ?? ""} className={inputClass} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="类目">
          <input name="category" defaultValue={product?.category ?? ""} className={inputClass} />
        </Field>
        <Field label="款号">
          <input name="modelNo" defaultValue={product?.modelNo ?? ""} className={inputClass} />
        </Field>
        <Field label="材质">
          <input name="material" defaultValue={product?.material ?? ""} className={inputClass} />
        </Field>
        <Field label="尺寸">
          <input name="size" defaultValue={product?.size ?? ""} className={inputClass} />
        </Field>
      </div>
      <Field label="图片路径">
        <input name="imagePath" defaultValue={product?.imagePath ?? ""} className={inputClass} />
      </Field>
      <Field label="备注">
        <textarea name="remark" defaultValue={product?.remark ?? ""} className={textAreaClass} />
      </Field>
      <button className="h-10 rounded-md bg-ink px-4 text-sm font-semibold text-white">{submitLabel}</button>
    </form>
  );
}

function OfferForm({
  action,
  productId,
  offer,
  sourceFiles,
  submitLabel,
}: {
  action: (formData: FormData) => Promise<void>;
  productId: string;
  offer?: OfferForForm;
  sourceFiles: SourceFileForForm[];
  submitLabel: string;
}) {
  return (
    <form action={action} className="mt-3 grid gap-3">
      {offer ? <input type="hidden" name="id" value={offer.id} /> : null}
      <input type="hidden" name="productId" value={productId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="工厂名">
          <input name="factoryName" defaultValue={offer?.factoryName ?? ""} className={inputClass} />
        </Field>
        <Field label="采购价">
          <input name="purchasePrice" defaultValue={offer?.purchasePrice.toString() ?? ""} className={inputClass} />
        </Field>
        <Field label="币种">
          <select name="currency" defaultValue={offer?.currency ?? "RMB"} className={inputClass}>
            <option value="RMB">RMB</option>
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
          </select>
        </Field>
        <Field label="MOQ">
          <input name="moq" defaultValue={offer?.moq ?? ""} className={inputClass} />
        </Field>
        <Field label="CTN Qty">
          <input name="ctnQty" defaultValue={offer?.ctnQty ?? ""} className={inputClass} />
        </Field>
        <Field label="Carton L (cm)">
          <input name="ctnLength" defaultValue={offer?.ctnLength ?? ""} className={inputClass} />
        </Field>
        <Field label="Carton W (cm)">
          <input name="ctnWidth" defaultValue={offer?.ctnWidth ?? ""} className={inputClass} />
        </Field>
        <Field label="Carton H (cm)">
          <input name="ctnHeight" defaultValue={offer?.ctnHeight ?? ""} className={inputClass} />
        </Field>
        <Field label="交期">
          <input name="leadTime" defaultValue={offer?.leadTime ?? ""} className={inputClass} />
        </Field>
        <Field label="来源文件">
          <select name="sourceFileId" defaultValue={offer?.sourceFileId ?? ""} className={inputClass}>
            <option value="">无</option>
            {sourceFiles.map((file) => (
              <option key={file.id} value={file.id}>
                {file.fileName}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="备注">
        <textarea name="remark" defaultValue={offer?.remark ?? ""} className={textAreaClass} />
      </Field>
      <button className="h-10 rounded-md bg-ink px-4 text-sm font-semibold text-white">{submitLabel}</button>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-stone-600">{label}</span>
      {children}
    </label>
  );
}

function Info({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <span className="text-xs text-stone-500">{label}</span>
      <div className="mt-1 font-medium text-stone-800">{value ?? "-"}</div>
    </div>
  );
}

function ProductThumbnail({ productId, hasImage, label }: { productId: string; hasImage: boolean; label: string }) {
  if (!hasImage) {
    return (
      <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-md border border-dashed border-line bg-white text-xs text-stone-400">
        无图
      </div>
    );
  }

  return (
    <Image
      src={`/api/products/${productId}/image`}
      alt={`${label} 产品图`}
      width={80}
      height={80}
      unoptimized
      className="h-20 w-20 shrink-0 rounded-md border border-line bg-white object-contain p-1"
    />
  );
}

function normalizeFilters(params: Awaited<ProductsPageProps["searchParams"]>) {
  return {
    search: params.search?.trim() ?? "",
    factory: params.factory?.trim() ?? "",
    minPrice: params.minPrice?.trim() ?? "",
    maxPrice: params.maxPrice?.trim() ?? "",
    moq: params.moq?.trim() ?? "",
    quality: normalizeProductQualityFilter(params.quality),
    productId: params.productId?.trim() ?? "",
    error: params.error?.trim() ?? "",
  };
}

function buildProductWhere(filters: ReturnType<typeof normalizeFilters>): Prisma.ProductWhereInput {
  if (filters.productId) {
    return { id: filters.productId };
  }

  const and: Prisma.ProductWhereInput[] = [];
  const qualityWhere = buildProductQualityWhere(filters.quality);
  if (Object.keys(qualityWhere).length > 0) {
    and.push(qualityWhere);
  }

  if (filters.search) {
    and.push({
      OR: [
        { productName: { contains: filters.search } },
        { modelNo: { contains: filters.search } },
        { category: { contains: filters.search } },
      ],
    });
  }

  if (filters.factory) {
    and.push({ supplierOffers: { some: { factoryName: { contains: filters.factory } } } });
  }

  if (filters.moq) {
    and.push({ supplierOffers: { some: { moq: { contains: filters.moq } } } });
  }

  const priceFilter: Prisma.SupplierOfferWhereInput = {};
  if (isPositiveDecimal(filters.minPrice)) {
    priceFilter.purchasePrice = { gte: filters.minPrice };
  }
  if (isPositiveDecimal(filters.maxPrice)) {
    priceFilter.purchasePrice = {
      ...(typeof priceFilter.purchasePrice === "object" ? priceFilter.purchasePrice : {}),
      lte: filters.maxPrice,
    };
  }
  if (Object.keys(priceFilter).length > 0) {
    and.push({ supplierOffers: { some: priceFilter } });
  }

  return and.length > 0 ? { AND: and } : {};
}

function normalizeProductQualityFilter(value: string | undefined): ProductQualityFilter {
  return PRODUCT_QUALITY_FILTERS.some((filter) => filter.value === value) ? (value as ProductQualityFilter) : "all";
}

async function getProductQualityStats() {
  const [
    totalProducts,
    needsDataProducts,
    missingCtnOffers,
    missingSizeProducts,
    temporaryModelProducts,
    identifierIssueProducts,
  ] = await Promise.all([
      prisma.product.count(),
      prisma.product.count({ where: buildProductQualityWhere("needsData") }),
      prisma.supplierOffer.count({ where: missingCtnOfferWhere }),
      prisma.product.count({ where: missingSizeProductWhere }),
      prisma.product.count({ where: temporaryModelProductWhere }),
      prisma.product.count({ where: productIdentifierIssueWhere }),
    ]);

  return {
    totalProducts,
    needsDataProducts,
    missingCtnOffers,
    missingSizeProducts,
    temporaryModelProducts,
    identifierIssueProducts,
  };
}

function buildProductsHref(filters: ReturnType<typeof normalizeFilters>, quality: ProductQualityFilter): string {
  const params = new URLSearchParams();
  for (const key of ["search", "factory", "minPrice", "maxPrice", "moq"] as const) {
    if (filters[key]) {
      params.set(key, filters[key]);
    }
  }
  if (quality !== "all") {
    params.set("quality", quality);
  }
  const query = params.toString();
  return query ? `/products?${query}` : "/products";
}

function isPositiveDecimal(value: string): boolean {
  return /^\d+(\.\d+)?$/.test(value) && Number(value) > 0;
}

function formatCtnDimensions(length: string | null, width: string | null, height: string | null): string {
  if (!length || !width || !height) {
    return "-";
  }

  return `${length} × ${width} × ${height} cm`;
}
