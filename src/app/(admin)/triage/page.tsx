import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { Ban, Link2, PackagePlus } from "lucide-react";

import { formatMoney } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { ignoreRawProduct, importRawAsNewProduct, linkRawToExistingProduct } from "./actions";

type TriagePageProps = {
  searchParams: Promise<{
    status?: string;
    sourceFileId?: string;
    factory?: string;
    error?: string;
  }>;
};

const inputClass =
  "h-10 w-full rounded-md border border-line bg-white px-3 text-sm outline-none focus:border-leaf";
const selectClass =
  "h-10 w-full rounded-md border border-line bg-white px-3 text-sm outline-none focus:border-leaf";
const textAreaClass =
  "min-h-20 w-full rounded-md border border-line bg-white px-3 py-2 text-sm outline-none focus:border-leaf";

const statusOptions = [
  { value: "pending", label: "待处理" },
  { value: "processed", label: "已处理" },
  { value: "ignored", label: "已忽略" },
  { value: "all", label: "全部" },
];

export default async function TriagePage({ searchParams }: TriagePageProps) {
  const params = await searchParams;
  const filters = {
    status: params.status?.trim() || "pending",
    sourceFileId: params.sourceFileId?.trim() || "all",
    factory: params.factory?.trim() || "",
    error: params.error?.trim() || "",
  };

  const rawProducts = await prisma.rawProduct.findMany({
    where: buildRawWhere(filters),
    include: { sourceFile: true },
    orderBy: [{ createdAt: "desc" }],
    take: 200,
  });
  const sourceFiles = await prisma.file.findMany({
    where: { rawProducts: { some: {} } },
    orderBy: [{ fileName: "asc" }],
  });
  const products = await prisma.product.findMany({
    orderBy: [{ productName: "asc" }],
    take: 500,
  });
  const statusCounts = await getStatusCounts();

  return (
    <div className="mx-auto max-w-7xl">
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <div className="text-sm font-semibold uppercase tracking-[0.18em] text-leaf">Phase 5</div>
          <h1 className="mt-2 text-3xl font-semibold text-ink">产品整理</h1>
        </div>
        <div className="rounded-md border border-line bg-paper px-4 py-2 text-sm shadow-panel">
          {statusCounts.pending} 待处理
        </div>
      </header>

      {filters.error ? (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {filters.error}
        </div>
      ) : null}

      <section className="mb-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <form className="rounded-md border border-line bg-paper p-4 shadow-panel">
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="状态">
              <select name="status" defaultValue={filters.status} className={selectClass}>
                {statusOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="来源文件">
              <select name="sourceFileId" defaultValue={filters.sourceFileId} className={selectClass}>
                <option value="all">全部</option>
                {sourceFiles.map((file) => (
                  <option key={file.id} value={file.id}>
                    {file.fileName}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="工厂">
              <input name="factory" defaultValue={filters.factory} placeholder="factory_name" className={inputClass} />
            </Field>
          </div>
          <div className="mt-3 flex justify-end">
            <button className="h-10 rounded-md bg-primary hover:bg-primary-hover px-4 text-sm font-semibold text-white">筛选</button>
          </div>
        </form>

        <div className="grid gap-2 rounded-md border border-line bg-paper p-4 text-sm shadow-panel">
          <Metric label="待处理" value={statusCounts.pending} />
          <Metric label="已处理" value={statusCounts.processed} />
          <Metric label="已忽略" value={statusCounts.ignored} />
        </div>
      </section>

      <section className="space-y-4">
        {rawProducts.map((raw) => (
          <article key={raw.id} className="rounded-md border border-line bg-paper shadow-panel">
            <div className="grid gap-4 border-b border-line p-4 xl:grid-cols-[minmax(0,1fr)_520px]">
              <div>
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <StatusBadge status={raw.rawStatus} />
                  <span className="rounded-sm border border-line bg-white px-2 py-1 text-xs text-stone-600">
                    {raw.sourceFile.fileName}
                  </span>
                  {raw.sourceSheetName ? (
                    <span className="rounded-sm border border-line bg-white px-2 py-1 text-xs text-stone-600">
                      {raw.sourceSheetName}
                    </span>
                  ) : null}
                </div>
                <h2 className="text-xl font-semibold text-ink">
                  {raw.rawProductName ?? raw.rawModelNo ?? "未命名 raw_product"}
                </h2>
                <div className="mt-3 grid gap-3 text-sm md:grid-cols-3">
                  <Info label="工厂" value={raw.factoryName} />
                  <Info label="款号" value={raw.rawModelNo} />
                  <Info label="价格" value={raw.rawPrice ? formatMoney(raw.rawPrice, raw.rawCurrency ?? "") : null} />
                  <Info label="MOQ" value={raw.rawMoq} />
                  <Info label="材质" value={raw.rawMaterial} />
                  <Info label="尺寸" value={raw.rawSize} />
                </div>
                {raw.rawDescription ? (
                  <div className="mt-3 rounded-md border border-line bg-white p-3 text-sm text-stone-700">
                    {raw.rawDescription}
                  </div>
                ) : null}
              </div>

              {raw.rawStatus === "pending" ? (
                <div className="space-y-3">
                  <details className="rounded-md border border-line bg-white p-3" open>
                    <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold text-ink">
                      <PackagePlus className="h-4 w-4 text-brass" aria-hidden="true" />
                      导入为新产品
                    </summary>
                    <NewProductForm raw={raw} />
                  </details>

                  <details className="rounded-md border border-line bg-white p-3">
                    <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold text-ink">
                      <Link2 className="h-4 w-4 text-leaf" aria-hidden="true" />
                      关联到已有产品
                    </summary>
                    <LinkProductForm rawId={raw.id} rawMoq={raw.rawMoq} products={products} />
                  </details>

                  <form action={ignoreRawProduct}>
                    <input type="hidden" name="rawProductId" value={raw.id} />
                    <button className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md border border-stone-300 bg-white px-3 text-sm font-semibold text-stone-700">
                      <Ban className="h-4 w-4" aria-hidden="true" />
                      忽略
                    </button>
                  </form>
                </div>
              ) : (
                <div className="rounded-md border border-line bg-white p-4 text-sm text-stone-600">
                  该 raw_product 已离开待处理队列。
                </div>
              )}
            </div>
          </article>
        ))}

        {rawProducts.length === 0 ? (
          <div className="rounded-md border border-line bg-paper px-4 py-10 text-center text-stone-500 shadow-panel">
            当前筛选下没有 raw_products。
            <Link href="/import" className="ml-2 font-semibold text-leaf">
              去 Excel 导入
            </Link>
          </div>
        ) : null}
      </section>
    </div>
  );
}

type RawForForm = {
  id: string;
  rawProductName: string | null;
  rawModelNo: string | null;
  rawMoq: string | null;
  rawMaterial: string | null;
  rawSize: string | null;
  rawDescription: string | null;
};

type ProductForSelect = {
  id: string;
  productName: string;
  modelNo: string | null;
};

function NewProductForm({ raw }: { raw: RawForForm }) {
  return (
    <form action={importRawAsNewProduct} className="mt-3 grid gap-3">
      <input type="hidden" name="rawProductId" value={raw.id} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="产品名">
          <input name="productName" defaultValue={raw.rawProductName ?? raw.rawModelNo ?? ""} className={inputClass} />
        </Field>
        <Field label="款号">
          <input name="modelNo" defaultValue={raw.rawModelNo ?? ""} className={inputClass} />
        </Field>
        <Field label="类目">
          <input name="category" className={inputClass} />
        </Field>
        <Field label="MOQ（可人工补）">
          <input name="moq" defaultValue={raw.rawMoq ?? ""} className={inputClass} />
        </Field>
        <Field label="材质（可人工补）">
          <input name="material" defaultValue={raw.rawMaterial ?? ""} className={inputClass} />
        </Field>
        <Field label="尺寸（可人工补）">
          <input name="size" defaultValue={raw.rawSize ?? ""} className={inputClass} />
        </Field>
      </div>
      <Field label="图片路径">
        <input name="imagePath" className={inputClass} />
      </Field>
      <Field label="备注">
        <textarea name="remark" defaultValue={raw.rawDescription ?? ""} className={textAreaClass} />
      </Field>
      <button className="h-10 rounded-md bg-primary hover:bg-primary-hover px-4 text-sm font-semibold text-white">
        创建 product + supplier_offer
      </button>
    </form>
  );
}

function LinkProductForm({
  rawId,
  rawMoq,
  products,
}: {
  rawId: string;
  rawMoq: string | null;
  products: ProductForSelect[];
}) {
  return (
    <form action={linkRawToExistingProduct} className="mt-3 grid gap-3">
      <input type="hidden" name="rawProductId" value={rawId} />
      <Field label="已有产品">
        <select name="productId" className={selectClass} required defaultValue="">
          <option value="">请选择</option>
          {products.map((product) => (
            <option key={product.id} value={product.id}>
              {product.productName}
              {product.modelNo ? ` / ${product.modelNo}` : ""}
            </option>
          ))}
        </select>
      </Field>
      <Field label="MOQ（可人工覆盖）">
        <input name="moq" defaultValue={rawMoq ?? ""} className={inputClass} />
      </Field>
      <button className="h-10 rounded-md bg-primary hover:bg-primary-hover px-4 text-sm font-semibold text-white">
        创建 supplier_offer
      </button>
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
      <div className="text-xs text-stone-500">{label}</div>
      <div className="mt-1 font-medium text-stone-800">{value ?? "-"}</div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between border-b border-line pb-2 last:border-0 last:pb-0">
      <span className="text-stone-600">{label}</span>
      <span className="font-semibold text-ink">{value}</span>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const label = status === "processed" ? "已处理" : status === "ignored" ? "已忽略" : "待处理";
  const className =
    status === "processed"
      ? "rounded-sm border border-green-200 bg-green-50 px-2 py-1 text-xs font-semibold text-green-700"
      : status === "ignored"
        ? "rounded-sm border border-stone-300 bg-stone-50 px-2 py-1 text-xs font-semibold text-stone-600"
        : "rounded-sm border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700";

  return <span className={className}>{label}</span>;
}

function buildRawWhere(filters: { status: string; sourceFileId: string; factory: string }): Prisma.RawProductWhereInput {
  const where: Prisma.RawProductWhereInput = {};

  if (filters.status !== "all") {
    where.rawStatus = filters.status;
  }
  if (filters.sourceFileId !== "all") {
    where.sourceFileId = filters.sourceFileId;
  }
  if (filters.factory) {
    where.factoryName = { contains: filters.factory };
  }

  return where;
}

async function getStatusCounts() {
  const groups = await prisma.rawProduct.groupBy({
    by: ["rawStatus"],
    _count: { rawStatus: true },
  });

  return {
    pending: groups.find((group) => group.rawStatus === "pending")?._count.rawStatus ?? 0,
    processed: groups.find((group) => group.rawStatus === "processed")?._count.rawStatus ?? 0,
    ignored: groups.find((group) => group.rawStatus === "ignored")?._count.rawStatus ?? 0,
  };
}
