import Link from "next/link";
import {
  ArrowRight,
  Database,
  FileSpreadsheet,
  FolderSearch,
  ListChecks,
  PackageSearch,
  ReceiptText,
} from "lucide-react";

import { prisma } from "@/lib/prisma";

export default async function HomePage() {
  const fileCount = await prisma.file.count();
  const productCount = await prisma.product.count();
  const rawProductCount = await prisma.rawProduct.count();
  const pendingRawProductCount = await prisma.rawProduct.count({ where: { rawStatus: "pending" } });
  const quoteCount = await prisma.quote.count();

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-8">
        <div className="text-sm font-semibold uppercase tracking-[0.18em] text-leaf">
          Supplier Quotation System
        </div>
        <h1 className="mt-3 text-4xl font-semibold text-ink">本地供应商报价资料管理</h1>
      </header>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Link
          href="/scan"
          className="group rounded-md border border-line bg-paper p-5 shadow-panel transition hover:-translate-y-0.5"
        >
          <div className="flex items-center justify-between">
            <FolderSearch className="h-6 w-6 text-brass" aria-hidden="true" />
            <ArrowRight className="h-4 w-4 text-stone-500 group-hover:text-ink" aria-hidden="true" />
          </div>
          <div className="mt-8 text-2xl font-semibold">文件扫描</div>
          <div className="mt-2 text-sm text-stone-600">输入本地目录，递归写入文件索引。</div>
        </Link>

        <Link
          href="/files"
          className="group rounded-md border border-line bg-paper p-5 shadow-panel transition hover:-translate-y-0.5"
        >
          <div className="flex items-center justify-between">
            <Database className="h-6 w-6 text-brass" aria-hidden="true" />
            <ArrowRight className="h-4 w-4 text-stone-500 group-hover:text-ink" aria-hidden="true" />
          </div>
          <div className="mt-8 text-2xl font-semibold">{fileCount}</div>
          <div className="mt-2 text-sm text-stone-600">已扫描文件</div>
        </Link>

        <Link
          href="/products"
          className="group rounded-md border border-line bg-paper p-5 shadow-panel transition hover:-translate-y-0.5"
        >
          <div className="flex items-center justify-between">
            <PackageSearch className="h-6 w-6 text-brass" aria-hidden="true" />
            <ArrowRight className="h-4 w-4 text-stone-500 group-hover:text-ink" aria-hidden="true" />
          </div>
          <div className="mt-8 text-2xl font-semibold">{productCount}</div>
          <div className="mt-2 text-sm text-stone-600">产品记录</div>
        </Link>

        <Link
          href="/import"
          className="group rounded-md border border-line bg-paper p-5 shadow-panel transition hover:-translate-y-0.5"
        >
          <div className="flex items-center justify-between">
            <FileSpreadsheet className="h-6 w-6 text-brass" aria-hidden="true" />
            <ArrowRight className="h-4 w-4 text-stone-500 group-hover:text-ink" aria-hidden="true" />
          </div>
          <div className="mt-8 text-2xl font-semibold">{rawProductCount}</div>
          <div className="mt-2 text-sm text-stone-600">原始导入行</div>
        </Link>

        <Link
          href="/triage"
          className="group rounded-md border border-line bg-paper p-5 shadow-panel transition hover:-translate-y-0.5"
        >
          <div className="flex items-center justify-between">
            <ListChecks className="h-6 w-6 text-brass" aria-hidden="true" />
            <ArrowRight className="h-4 w-4 text-stone-500 group-hover:text-ink" aria-hidden="true" />
          </div>
          <div className="mt-8 text-2xl font-semibold">{pendingRawProductCount}</div>
          <div className="mt-2 text-sm text-stone-600">待整理 raw_products</div>
        </Link>

        <Link
          href="/quotes"
          className="group rounded-md border border-line bg-paper p-5 shadow-panel transition hover:-translate-y-0.5"
        >
          <div className="flex items-center justify-between">
            <ReceiptText className="h-6 w-6 text-brass" aria-hidden="true" />
            <ArrowRight className="h-4 w-4 text-stone-500 group-hover:text-ink" aria-hidden="true" />
          </div>
          <div className="mt-8 text-2xl font-semibold">{quoteCount}</div>
          <div className="mt-2 text-sm text-stone-600">历史报价</div>
        </Link>
      </section>
    </div>
  );
}
