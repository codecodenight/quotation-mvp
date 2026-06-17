import Link from "next/link";

import {
  getCategoryCompletionData,
  getDataQuality,
  type CategoryCompletion,
  type CategoryParamCoverage,
  type CategoryQuality,
  type ParamKeyCoverage,
} from "@/lib/data-quality";

export const dynamic = "force-dynamic";

const PARAM_DISPLAY_NAMES: Record<string, string> = {
  watts: "功率 (W)",
  voltage: "电压 (V)",
  cct: "色温 (K)",
  cri: "显色指数",
  ip: "防护等级",
  pf: "功率因数",
  driver_type: "驱动类型",
  material: "材质",
  luminous_efficacy: "光效 (lm/W)",
  base: "灯头",
  size_display: "尺寸",
};

const MATRIX_PARAM_KEYS = ["watts", "voltage", "cct", "cri", "ip", "pf"] as const;

export default async function DataQualityPage() {
  const [summary, completionData] = await Promise.all([getDataQuality(), getCategoryCompletionData()]);
  const { categories, totals, paramCoverage, categoryParamMatrix } = summary;

  return (
    <div className="mx-auto max-w-7xl">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-sm font-semibold uppercase tracking-[0.18em] text-leaf">V4.4B</div>
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

      <section className="mb-5 grid gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <ParamCoverageBars params={paramCoverage} totalProducts={totals.productCount} />
        <CategoryParamHeatmap categories={categories} matrix={categoryParamMatrix} />
      </section>

      <CoreParamCompletion categories={completionData} />

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

function CoreParamCompletion({ categories }: { categories: CategoryCompletion[] }) {
  const totalProducts = categories.reduce((sum, category) => sum + category.totalProducts, 0);
  const totalComplete = categories.reduce((sum, category) => sum + category.completeProducts, 0);
  const completionRate = rate(totalComplete, totalProducts);

  return (
    <section className="mb-5 rounded-md border border-line bg-paper shadow-panel">
      <div className="border-b border-line px-4 py-4">
        <h2 className="text-lg font-semibold text-ink">核心参数完成率</h2>
        <p className="mt-1 text-xs text-stone-500">每个品类的核心规格参数全部有值才算完成，已排除功率和尺寸。</p>
      </div>

      <div className="border-b border-line p-4">
        <div className="grid gap-3 md:grid-cols-[9rem_minmax(0,1fr)_12rem] md:items-center">
          <div className="text-sm font-semibold text-ink">全局完成率</div>
          <div className="h-4 overflow-hidden rounded-full bg-stone-200">
            <div className="h-full rounded-full bg-leaf" style={{ width: `${clampPercent(completionRate * 100)}%` }} />
          </div>
          <div className="text-sm md:text-right">
            <span className={`font-semibold ${completionTextClass(completionRate)}`}>{formatPrecisePercent(completionRate)}</span>
            <span className="ml-2 text-xs text-stone-500">
              ({formatInteger(totalComplete)} / {formatInteger(totalProducts)})
            </span>
          </div>
        </div>
      </div>

      <div className="divide-y divide-line">
        {categories.map((category) => (
          <CoreParamCompletionRow key={category.category} category={category} />
        ))}
        {categories.length === 0 ? <div className="py-8 text-center text-sm text-stone-500">暂无核心参数完成率数据。</div> : null}
      </div>
    </section>
  );
}

function CoreParamCompletionRow({ category }: { category: CategoryCompletion }) {
  const completionRate = rate(category.completeProducts, category.totalProducts);
  const breakdownEntries = Object.entries(category.paramBreakdown);

  return (
    <details className="group">
      <summary className="grid cursor-pointer list-none gap-3 px-4 py-3 hover:bg-stone-50 md:grid-cols-[minmax(8rem,1fr)_5rem_5rem_7rem_minmax(10rem,1.1fr)] md:items-center">
        <div className="font-semibold text-ink">
          <Link
            href={`/products?category=${encodeURIComponent(category.category)}`}
            className="underline-offset-2 hover:text-leaf hover:underline"
          >
            {category.category}
          </Link>
          <span className="ml-2 text-xs font-medium text-stone-500 group-open:hidden">展开</span>
          <span className="ml-2 hidden text-xs font-medium text-stone-500 group-open:inline">收起</span>
        </div>
        <div className="text-sm text-stone-600 md:text-right">总数 {formatInteger(category.totalProducts)}</div>
        <div className="text-sm text-stone-600 md:text-right">完成 {formatInteger(category.completeProducts)}</div>
        <div className={`text-sm font-semibold md:text-right ${completionTextClass(completionRate)}`}>
          {formatPrecisePercent(completionRate)}
        </div>
        <div className="flex items-center gap-2">
          <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-stone-200">
            <div className="h-full rounded-full bg-leaf" style={{ width: `${clampPercent(completionRate * 100)}%` }} />
          </div>
          <span className={`rounded border px-2 py-1 text-xs font-semibold ${completionBgClass(completionRate)}`}>
            {completionStatusLabel(completionRate)}
          </span>
        </div>
      </summary>

      <div className="border-t border-line bg-stone-50 px-4 py-4">
        <div className="mb-3 text-xs text-stone-500">
          核心参数数：{category.coreParamCount}。下方显示每个核心参数覆盖了多少个产品。
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          {breakdownEntries.map(([paramKey, productCount]) => {
            const paramRate = rate(productCount, category.totalProducts);
            return (
              <div key={`${category.category}-${paramKey}`} className="grid gap-2 sm:grid-cols-[7.5rem_minmax(0,1fr)_8.5rem] sm:items-center">
                <div className="text-sm font-semibold text-ink">{PARAM_DISPLAY_NAMES[paramKey] ?? paramKey}</div>
                <div className="h-3 overflow-hidden rounded-full bg-stone-200">
                  <div className="h-full rounded-full bg-leaf" style={{ width: `${clampPercent(paramRate * 100)}%` }} />
                </div>
                <div className="text-sm sm:text-right">
                  <span className={`font-semibold ${completionTextClass(paramRate)}`}>{formatPrecisePercent(paramRate)}</span>
                  <span className="ml-2 text-xs text-stone-500">
                    ({formatInteger(productCount)} / {formatInteger(category.totalProducts)})
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </details>
  );
}

function ParamCoverageBars({ params, totalProducts }: { params: ParamKeyCoverage[]; totalProducts: number }) {
  return (
    <section className="rounded-md border border-line bg-paper shadow-panel">
      <div className="border-b border-line px-4 py-4">
        <h2 className="text-lg font-semibold text-ink">参数覆盖率明细</h2>
        <p className="mt-1 text-xs text-stone-500">按去重产品数统计，显示每个关键参数覆盖了多少产品。</p>
      </div>
      <div className="space-y-3 p-4">
        {params.map((param) => {
          const coverageRate = param.percentage / 100;
          return (
            <div key={param.paramKey} className="grid gap-2 sm:grid-cols-[7.5rem_minmax(0,1fr)_8.5rem] sm:items-center">
              <div className="text-sm font-semibold text-ink">{PARAM_DISPLAY_NAMES[param.paramKey] ?? param.paramKey}</div>
              <div className="h-3 overflow-hidden rounded-full bg-stone-200">
                <div className="h-full rounded-full bg-leaf" style={{ width: `${clampPercent(param.percentage)}%` }} />
              </div>
              <div className="text-sm sm:text-right">
                <span className={`font-semibold ${coverageClass(coverageRate)}`}>{formatPrecisePercent(coverageRate)}</span>
                <span className="ml-2 text-xs text-stone-500">
                  ({formatInteger(param.productCount)} / {formatInteger(totalProducts)})
                </span>
              </div>
            </div>
          );
        })}
        {params.length === 0 ? <div className="py-8 text-center text-sm text-stone-500">暂无参数覆盖数据。</div> : null}
      </div>
    </section>
  );
}

function CategoryParamHeatmap({
  categories,
  matrix,
}: {
  categories: CategoryQuality[];
  matrix: CategoryParamCoverage[];
}) {
  const topCategories = categories.slice(0, 15);
  const matrixByCategory = new Map<string, Map<string, number>>();

  for (const row of matrix) {
    const categoryMap = matrixByCategory.get(row.category) ?? new Map<string, number>();
    categoryMap.set(row.paramKey, row.productCount);
    matrixByCategory.set(row.category, categoryMap);
  }

  return (
    <section className="rounded-md border border-line bg-paper shadow-panel">
      <div className="border-b border-line px-4 py-4">
        <h2 className="text-lg font-semibold text-ink">品类×参数矩阵</h2>
        <p className="mt-1 text-xs text-stone-500">产品数 Top 15 品类，快速定位哪个品类缺哪类参数。</p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[680px] border-collapse text-left text-sm">
          <thead className="bg-[#3F4A35] text-xs uppercase tracking-[0.08em] text-white">
            <tr>
              <th className="px-3 py-3">品类</th>
              {MATRIX_PARAM_KEYS.map((paramKey) => (
                <th key={paramKey} className="px-3 py-3 text-center">
                  {PARAM_DISPLAY_NAMES[paramKey]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line bg-white">
            {topCategories.map((category) => {
              const categoryMap = matrixByCategory.get(category.category);
              return (
                <tr key={category.category}>
                  <td className="min-w-36 px-3 py-3 font-semibold text-ink">
                    <Link
                      href={`/products?category=${encodeURIComponent(category.category)}`}
                      className="underline-offset-2 hover:text-leaf hover:underline"
                    >
                      {category.category}
                    </Link>
                  </td>
                  {MATRIX_PARAM_KEYS.map((paramKey) => {
                    const productCount = categoryMap?.get(paramKey) ?? 0;
                    return (
                      <HeatmapCell
                        key={`${category.category}-${paramKey}`}
                        productCount={productCount}
                        totalProducts={category.productCount}
                      />
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
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

function HeatmapCell({ productCount, totalProducts }: { productCount: number; totalProducts: number }) {
  if (productCount <= 0 || totalProducts <= 0) {
    return (
      <td className="px-2 py-2 text-center">
        <span className="inline-flex min-w-14 justify-center rounded border border-line bg-stone-50 px-2 py-1 text-xs font-semibold text-stone-400">
          —
        </span>
      </td>
    );
  }

  const coverageRate = rate(productCount, totalProducts);
  return (
    <td className="px-2 py-2 text-center">
      <span
        className={`inline-flex min-w-14 justify-center rounded border px-2 py-1 text-xs font-semibold ${coverageBgClass(
          coverageRate,
        )}`}
      >
        {formatPercent(coverageRate)}
      </span>
    </td>
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

function coverageBgClass(coverageRate: number): string {
  if (coverageRate >= 0.8) {
    return "border-green-200 bg-green-50 text-green-700";
  }
  if (coverageRate >= 0.5) {
    return "border-stone-200 bg-stone-100 text-ink";
  }
  if (coverageRate >= 0.3) {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }
  return "border-red-200 bg-red-50 text-red-700";
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
  if (coverageRate >= 0.5) {
    return "text-ink";
  }
  if (coverageRate >= 0.3) {
    return "text-amber-700";
  }
  return "text-red-700";
}

function completionBgClass(coverageRate: number): string {
  if (coverageRate >= 0.8) {
    return "border-green-200 bg-green-50 text-green-700";
  }
  if (coverageRate >= 0.4) {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }
  return "border-red-200 bg-red-50 text-red-700";
}

function completionTextClass(coverageRate: number): string {
  if (coverageRate >= 0.8) {
    return "text-green-700";
  }
  if (coverageRate >= 0.4) {
    return "text-amber-700";
  }
  return "text-red-700";
}

function completionStatusLabel(coverageRate: number): string {
  if (coverageRate >= 0.8) {
    return "达标";
  }
  if (coverageRate >= 0.4) {
    return "关注";
  }
  return "偏低";
}

function formatPercent(coverageRate: number): string {
  return `${(coverageRate * 100).toFixed(0)}%`;
}

function formatPrecisePercent(coverageRate: number): string {
  return `${(coverageRate * 100).toFixed(1)}%`;
}

function formatInteger(value: number): string {
  return value.toLocaleString("en-US");
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}
