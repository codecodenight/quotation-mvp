import Link from "next/link";

import { getDataQuality, type CategoryQuality } from "@/lib/data-quality";

export const dynamic = "force-dynamic";

export default async function DataQualityPage() {
  const summary = await getDataQuality();
  const { categories, totals } = summary;

  return (
    <div className="mx-auto max-w-7xl">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-sm font-semibold uppercase tracking-[0.18em] text-leaf">V4.4A</div>
          <h1 className="mt-2 text-3xl font-semibold text-ink">数据质量仪表盘</h1>
          <p className="mt-2 text-sm text-stone-600">
            按品类查看图片、参数、Size 和 CTN 覆盖率，用来决定下一轮补数据优先级。
          </p>
        </div>
        <div className="rounded-md border border-line bg-paper px-4 py-2 text-sm font-semibold text-ink shadow-panel">
          {categories.length} 个品类
        </div>
      </header>

      <section className="mb-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <SummaryCard href="/products" label="产品总数" value={formatInteger(totals.productCount)} detail="进入产品库" />
        <SummaryCard label="报价总数" value={formatInteger(totals.offerCount)} detail="supplier offers" />
        <SummaryCard
          label="图片覆盖"
          value={formatPercent(rate(totals.imageCount, totals.productCount))}
          detail={`${formatInteger(totals.imageCount)} / ${formatInteger(totals.productCount)}`}
          valueClass={coverageClass(rate(totals.imageCount, totals.productCount))}
        />
        <SummaryCard
          label="参数覆盖"
          value={formatPercent(rate(totals.paramProductCount, totals.productCount))}
          detail={`${formatInteger(totals.paramProductCount)} / ${formatInteger(totals.productCount)}`}
          valueClass={coverageClass(rate(totals.paramProductCount, totals.productCount))}
        />
        <SummaryCard
          label="CTN 覆盖"
          value={formatPercent(rate(totals.ctnOfferCount, totals.offerCount))}
          detail={`${formatInteger(totals.ctnOfferCount)} / ${formatInteger(totals.offerCount)}`}
          valueClass={coverageClass(rate(totals.ctnOfferCount, totals.offerCount))}
        />
      </section>

      <section className="rounded-md border border-line bg-paper shadow-panel">
        <div className="border-b border-line px-4 py-4">
          <h2 className="text-lg font-semibold text-ink">品类明细</h2>
          <p className="mt-1 text-xs text-stone-500">默认按产品数降序。点击品类进入产品库筛选。</p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-[#3F4A35] text-xs uppercase tracking-[0.08em] text-white">
              <tr>
                <th className="px-3 py-3">品类</th>
                <th className="px-3 py-3 text-right">产品数</th>
                <th className="px-3 py-3 text-right">报价数</th>
                <th className="px-3 py-3 text-right">图片覆盖</th>
                <th className="px-3 py-3 text-right">参数覆盖</th>
                <th className="px-3 py-3 text-right">Size 覆盖</th>
                <th className="px-3 py-3 text-right">CTN 覆盖</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line bg-white">
              {categories.map((category) => (
                <CategoryQualityRow key={category.category} category={category} />
              ))}
              {categories.length === 0 ? (
                <tr>
                  <td className="px-3 py-8 text-center text-stone-500" colSpan={7}>
                    暂无产品数据。
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  detail,
  href,
  valueClass = "text-ink",
}: {
  label: string;
  value: string;
  detail: string;
  href?: string;
  valueClass?: string;
}) {
  const content = (
    <>
      <div className="text-xs font-semibold text-stone-500">{label}</div>
      <div className={`mt-3 text-2xl font-semibold ${valueClass}`}>{value}</div>
      <div className="mt-2 text-xs text-stone-500">{detail}</div>
    </>
  );

  if (href) {
    return (
      <Link href={href} className="rounded-md border border-line bg-paper p-4 shadow-panel hover:border-leaf">
        {content}
      </Link>
    );
  }

  return <div className="rounded-md border border-line bg-paper p-4 shadow-panel">{content}</div>;
}

function CategoryQualityRow({ category }: { category: CategoryQuality }) {
  return (
    <tr className="align-top">
      <td className="min-w-40 px-3 py-3 font-semibold text-ink">
        <Link
          href={`/products?category=${encodeURIComponent(category.category)}`}
          className="underline-offset-2 hover:text-leaf hover:underline"
        >
          {category.category}
        </Link>
      </td>
      <td className="px-3 py-3 text-right font-medium text-ink">{formatInteger(category.productCount)}</td>
      <td className="px-3 py-3 text-right font-medium text-ink">{formatInteger(category.offerCount)}</td>
      <CoverageCell numerator={category.imageCount} denominator={category.productCount} />
      <CoverageCell numerator={category.paramProductCount} denominator={category.productCount} />
      <CoverageCell numerator={category.sizeProductCount} denominator={category.productCount} />
      <CoverageCell numerator={category.ctnOfferCount} denominator={category.offerCount} />
    </tr>
  );
}

function CoverageCell({ numerator, denominator }: { numerator: number; denominator: number }) {
  const coverageRate = rate(numerator, denominator);

  return (
    <td className="px-3 py-3 text-right">
      <div className={`font-semibold ${coverageClass(coverageRate)}`}>{formatPercent(coverageRate)}</div>
      <div className="mt-0.5 text-xs text-stone-500">
        {formatInteger(numerator)} / {formatInteger(denominator)}
      </div>
    </td>
  );
}

function rate(numerator: number, denominator: number): number {
  if (denominator <= 0) {
    return 0;
  }
  return numerator / denominator;
}

function coverageClass(coverageRate: number): string {
  if (coverageRate >= 0.8) {
    return "text-green-700";
  }
  if (coverageRate >= 0.4) {
    return "text-amber-700";
  }
  return "text-red-700";
}

function formatPercent(coverageRate: number): string {
  return `${(coverageRate * 100).toFixed(0)}%`;
}

function formatInteger(value: number): string {
  return value.toLocaleString("en-US");
}
