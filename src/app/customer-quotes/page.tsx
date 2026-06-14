import Link from "next/link";
import type { ReactNode } from "react";

import { prisma } from "@/lib/prisma";
import { ProductBindingCell } from "./product-binding-cell";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
const INTERNAL_CUSTOMER_VALUE = "__internal__";
const ALL_MATCHED_VALUE = "all";
const SORT_FIELDS = new Set(["date", "price", "model"]);
const SORT_ORDERS = new Set(["asc", "desc"]);

type CustomerQuotesPageProps = {
  searchParams: Promise<{
    search?: string;
    customer?: string;
    dateFrom?: string;
    dateTo?: string;
    matched?: string;
    category?: string;
    page?: string;
    sort?: string;
    order?: string;
  }>;
};

type Filters = {
  search: string;
  customer: string;
  dateFrom: string;
  dateTo: string;
  matched: "all" | "matched" | "unmatched";
  category: string;
  page: number;
  sort: "date" | "price" | "model";
  order: "asc" | "desc";
};

type CustomerOption = {
  value: string;
  label: string;
  count: number;
};

type CategoryOption = {
  category: string;
  count: number;
};

type CustomerQuoteRow = {
  id: number;
  row_number: number;
  raw_model: string | null;
  raw_description: string | null;
  sale_price_usd: number | null;
  sale_price_text: string | null;
  rmb_cost: number | null;
  raw_row_json: string | null;
  file_name: string;
  relative_path: string;
  sheet_name: string;
  customer_name: string | null;
  quote_date: string | null;
  header_snapshot: string | null;
  matched_product_id: string | null;
  matched_model_no: string | null;
  matched_product_name: string | null;
  matched_category: string | null;
  category: string;
};

type SummaryRow = {
  total: number;
  matched: number;
  customer_count: number;
  min_date: string | null;
  max_date: string | null;
};

type CountRow = {
  count: number;
};

export default async function CustomerQuotesPage({ searchParams }: CustomerQuotesPageProps) {
  const params = await searchParams;
  const filters = normalizeFilters(params);
  const offset = (filters.page - 1) * PAGE_SIZE;

  const [customerOptions, categoryOptions, summary, totalRows, rows] = await Promise.all([
    loadCustomerOptions(),
    loadCategoryOptions(),
    loadSummary(filters),
    loadTotalRows(filters),
    loadRows(filters, offset),
  ]);
  const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
  const safePage = Math.min(filters.page, totalPages);

  return (
    <div className="mx-auto max-w-7xl">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-sm font-semibold uppercase tracking-[0.18em] text-leaf">V5.2</div>
          <h1 className="mt-2 text-3xl font-semibold text-ink">历史客户报价</h1>
          <p className="mt-2 text-sm text-stone-600">
            搜索已导入的客户 FOB USD 报价记录；未匹配到产品库的历史价格也会显示。
          </p>
        </div>
        <div className="rounded-md border border-line bg-paper px-4 py-2 text-sm font-semibold text-ink shadow-panel">
          {formatInteger(totalRows)} 条记录
        </div>
      </header>

      <form className="mb-4 rounded-md border border-line bg-paper p-4 shadow-panel">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1.6fr)_220px_160px_160px]">
          <Field label="搜索">
            <input
              name="search"
              defaultValue={filters.search}
              placeholder="raw_model / 描述 / 价格文本"
              className={inputClass}
            />
          </Field>
          <Field label="客户">
            <select name="customer" defaultValue={filters.customer} className={inputClass}>
              <option value="">全部客户</option>
              <option value={INTERNAL_CUSTOMER_VALUE}>（内部核价）</option>
              {customerOptions.map((customer) => (
                <option key={customer.value} value={customer.value}>
                  {customer.label} ({customer.count})
                </option>
              ))}
            </select>
          </Field>
          <Field label="日期从">
            <input name="dateFrom" type="date" defaultValue={filters.dateFrom} className={inputClass} />
          </Field>
          <Field label="到">
            <input name="dateTo" type="date" defaultValue={filters.dateTo} className={inputClass} />
          </Field>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-[220px_220px_auto_auto]">
          <Field label="匹配状态">
            <select name="matched" defaultValue={filters.matched} className={inputClass}>
              <option value={ALL_MATCHED_VALUE}>全部</option>
              <option value="matched">已匹配</option>
              <option value="unmatched">未匹配</option>
            </select>
          </Field>
          <Field label="品类">
            <select name="category" defaultValue={filters.category} className={inputClass}>
              <option value="">全部品类</option>
              {categoryOptions.map((option) => (
                <option key={option.category} value={option.category}>
                  {option.category} ({option.count})
                </option>
              ))}
            </select>
          </Field>
          <input type="hidden" name="sort" value={filters.sort} />
          <input type="hidden" name="order" value={filters.order} />
          <div className="flex items-end">
            <button className="h-10 rounded-md bg-ink px-5 text-sm font-semibold text-white">搜索</button>
          </div>
          <div className="flex items-end">
            <Link
              href="/customer-quotes"
              className="inline-flex h-10 items-center rounded-md border border-line bg-white px-4 text-sm font-semibold text-stone-700 hover:border-leaf"
            >
              清空
            </Link>
          </div>
        </div>
      </form>

      <section className="mb-4 grid gap-3 md:grid-cols-4">
        <SummaryCard label="当前结果" value={formatInteger(summary.total)} detail="历史报价行" />
        <SummaryCard
          label="已匹配"
          value={formatInteger(summary.matched)}
          detail={`${formatPercent(summary.matched, summary.total)} matched`}
        />
        <SummaryCard label="客户数" value={formatInteger(summary.customer_count)} detail="不含内部核价" />
        <SummaryCard
          label="日期范围"
          value={formatDateRange(summary.min_date, summary.max_date)}
          detail="按筛选结果统计"
        />
      </section>

      <section className="overflow-hidden rounded-md border border-line bg-paper shadow-panel">
        <div className="grid grid-cols-[96px_minmax(120px,0.8fr)_minmax(160px,1fr)_minmax(220px,1.7fr)_110px_110px_minmax(180px,1.2fr)_minmax(240px,1.4fr)] gap-3 bg-[#3F4A35] px-4 py-3 text-xs font-semibold uppercase tracking-[0.08em] text-white">
          <SortableHeader label="日期" field="date" filters={filters} />
          <div>客户</div>
          <SortableHeader label="型号" field="model" filters={filters} />
          <div>描述</div>
          <SortableHeader label="FOB USD" field="price" filters={filters} align="right" />
          <div className="text-right">RMB 成本</div>
          <div>来源</div>
          <div>匹配</div>
        </div>

        <div className="divide-y divide-line bg-white">
          {rows.map((row) => (
            <details key={row.id} className="group">
              <summary className="grid cursor-pointer list-none grid-cols-[96px_minmax(120px,0.8fr)_minmax(160px,1fr)_minmax(220px,1.7fr)_110px_110px_minmax(180px,1.2fr)_minmax(240px,1.4fr)] gap-3 px-4 py-3 text-sm hover:bg-cream/50">
                <div className="font-medium text-ink">{formatQuoteDate(row.quote_date)}</div>
                <div className="break-words text-stone-700">{formatCustomer(row.customer_name)}</div>
                <div className="break-words font-semibold text-ink">{row.raw_model || "—"}</div>
                <div className="min-w-0 truncate text-stone-700" title={row.raw_description ?? ""}>
                  {row.raw_description || "—"}
                </div>
                <div className="text-right font-semibold text-ink">{formatUsd(row.sale_price_usd, row.sale_price_text)}</div>
                <div className="text-right text-stone-700">{formatRmb(row.rmb_cost)}</div>
                <div className="min-w-0 truncate text-stone-700" title={row.file_name}>
                  {row.file_name}
                </div>
                <ProductBindingCell
                  rowId={row.id}
                  rawModel={row.raw_model}
                  rawDescription={row.raw_description}
                  initialMatchedProduct={
                    row.matched_product_id
                      ? {
                          id: row.matched_product_id,
                          modelNo: row.matched_model_no,
                          productName: row.matched_product_name ?? row.matched_model_no ?? row.matched_product_id,
                          category: row.matched_category,
                        }
                      : null
                  }
                />
              </summary>
              <div className="border-t border-line bg-[#fbfaf6] px-4 py-4">
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                  <DetailBlock title="完整信息">
                    <DetailLine label="客户" value={formatCustomer(row.customer_name)} />
                    <DetailLine label="日期" value={row.quote_date ?? "—"} />
                    <DetailLine label="品类" value={row.category} />
                    <DetailLine label="Sheet" value={row.sheet_name} />
                    <DetailLine label="行号" value={String(row.row_number)} />
                    <DetailLine label="来源路径" value={row.relative_path} />
                    {row.raw_description ? <DetailLine label="完整描述" value={row.raw_description} /> : null}
                    {row.matched_product_id ? (
                      <DetailLine
                        label="匹配产品"
                        value={`${row.matched_model_no ?? row.matched_product_name ?? row.matched_product_id}${
                          row.matched_category ? ` / ${row.matched_category}` : ""
                        }`}
                      />
                    ) : null}
                  </DetailBlock>

                  <div className="space-y-3">
                    <DetailBlock title="原始行 JSON">
                      <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md border border-line bg-white p-3 text-xs leading-5 text-stone-700">
                        {formatJson(row.raw_row_json)}
                      </pre>
                    </DetailBlock>
                    <DetailBlock title="表头快照">
                      <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md border border-line bg-white p-3 text-xs leading-5 text-stone-700">
                        {formatJson(row.header_snapshot)}
                      </pre>
                    </DetailBlock>
                  </div>
                </div>
              </div>
            </details>
          ))}
          {rows.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-stone-500">没有找到符合条件的历史报价。</div>
          ) : null}
        </div>
      </section>

      <Pagination filters={filters} totalPages={totalPages} safePage={safePage} totalRows={totalRows} />
    </div>
  );
}

function normalizeFilters(params: Awaited<CustomerQuotesPageProps["searchParams"]>): Filters {
  const page = Number.parseInt(params.page ?? "1", 10);
  const sort = SORT_FIELDS.has(params.sort ?? "") ? (params.sort as Filters["sort"]) : "date";
  const order = SORT_ORDERS.has(params.order ?? "") ? (params.order as Filters["order"]) : "desc";
  const matched =
    params.matched === "matched" || params.matched === "unmatched" ? params.matched : ALL_MATCHED_VALUE;

  return {
    search: normalizeQueryValue(params.search),
    customer: normalizeQueryValue(params.customer),
    dateFrom: normalizeQueryValue(params.dateFrom),
    dateTo: normalizeQueryValue(params.dateTo),
    matched,
    category: normalizeQueryValue(params.category),
    page: Number.isFinite(page) && page > 0 ? page : 1,
    sort,
    order,
  };
}

async function loadRows(filters: Filters, offset: number): Promise<CustomerQuoteRow[]> {
  const where = buildWhere(filters);
  return prisma.$queryRawUnsafe<CustomerQuoteRow[]>(
    `SELECT
       cqr.id,
       cqr.row_number,
       cqr.raw_model,
       cqr.raw_description,
       cqr.sale_price_usd,
       cqr.sale_price_text,
       cqr.rmb_cost,
       cqr.raw_row_json,
       cqf.file_name,
       cqf.relative_path,
       cqf.sheet_name,
       cqf.customer_name,
       cqf.quote_date,
       cqf.header_snapshot,
       cqr.matched_product_id,
       p.model_no AS matched_model_no,
       p.product_name AS matched_product_name,
       p.category AS matched_category,
       ${categorySql()} AS category
     FROM customer_quote_rows cqr
     JOIN customer_quote_files cqf ON cqf.id = cqr.file_id
     LEFT JOIN products p ON p.id = cqr.matched_product_id
     ${where.sql}
     ORDER BY ${orderBySql(filters)}, cqr.id ASC
     LIMIT ? OFFSET ?`,
    ...where.values,
    PAGE_SIZE,
    offset,
  );
}

async function loadTotalRows(filters: Filters): Promise<number> {
  const where = buildWhere(filters);
  const [row] = await prisma.$queryRawUnsafe<CountRow[]>(
    `SELECT COUNT(*) AS count
     FROM customer_quote_rows cqr
     JOIN customer_quote_files cqf ON cqf.id = cqr.file_id
     LEFT JOIN products p ON p.id = cqr.matched_product_id
     ${where.sql}`,
    ...where.values,
  );
  return Number(row?.count ?? 0);
}

async function loadSummary(filters: Filters): Promise<SummaryRow> {
  const where = buildWhere(filters);
  const [row] = await prisma.$queryRawUnsafe<SummaryRow[]>(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN cqr.matched_product_id IS NOT NULL THEN 1 ELSE 0 END) AS matched,
       COUNT(DISTINCT CASE WHEN cqf.customer_name IS NOT NULL AND trim(cqf.customer_name) <> '' THEN cqf.customer_name END) AS customer_count,
       MIN(cqf.quote_date) AS min_date,
       MAX(cqf.quote_date) AS max_date
     FROM customer_quote_rows cqr
     JOIN customer_quote_files cqf ON cqf.id = cqr.file_id
     LEFT JOIN products p ON p.id = cqr.matched_product_id
     ${where.sql}`,
    ...where.values,
  );

  return {
    total: Number(row?.total ?? 0),
    matched: Number(row?.matched ?? 0),
    customer_count: Number(row?.customer_count ?? 0),
    min_date: row?.min_date ?? null,
    max_date: row?.max_date ?? null,
  };
}

async function loadCustomerOptions(): Promise<CustomerOption[]> {
  const rows = await prisma.$queryRawUnsafe<Array<{ customer_name: string; count: number }>>(
    `SELECT customer_name, COUNT(*) AS count
     FROM customer_quote_files
     WHERE customer_name IS NOT NULL AND trim(customer_name) <> ''
     GROUP BY customer_name
     ORDER BY customer_name COLLATE NOCASE ASC`,
  );
  return rows.map((row) => ({
    value: row.customer_name,
    label: row.customer_name,
    count: Number(row.count),
  }));
}

async function loadCategoryOptions(): Promise<CategoryOption[]> {
  const rows = await prisma.$queryRawUnsafe<Array<{ category: string; count: number }>>(
    `SELECT ${categorySql()} AS category, COUNT(*) AS count
     FROM customer_quote_rows cqr
     JOIN customer_quote_files cqf ON cqf.id = cqr.file_id
     GROUP BY category
     ORDER BY count DESC, category COLLATE NOCASE ASC`,
  );
  return rows.map((row) => ({
    category: row.category || "根目录",
    count: Number(row.count),
  }));
}

function buildWhere(filters: Filters): { sql: string; values: Array<string | number> } {
  const clauses: string[] = [];
  const values: Array<string | number> = [];

  if (filters.search) {
    const like = `%${escapeLike(filters.search)}%`;
    clauses.push(
      `(cqr.raw_model LIKE ? ESCAPE '\\' OR cqr.raw_description LIKE ? ESCAPE '\\' OR cqr.sale_price_text LIKE ? ESCAPE '\\' OR cqf.file_name LIKE ? ESCAPE '\\')`,
    );
    values.push(like, like, like, like);
  }
  if (filters.customer === INTERNAL_CUSTOMER_VALUE) {
    clauses.push(`(cqf.customer_name IS NULL OR trim(cqf.customer_name) = '')`);
  } else if (filters.customer) {
    clauses.push(`cqf.customer_name = ?`);
    values.push(filters.customer);
  }
  if (filters.dateFrom) {
    clauses.push(`cqf.quote_date >= ?`);
    values.push(filters.dateFrom);
  }
  if (filters.dateTo) {
    clauses.push(`cqf.quote_date <= ?`);
    values.push(filters.dateTo);
  }
  if (filters.matched === "matched") {
    clauses.push(`cqr.matched_product_id IS NOT NULL`);
  } else if (filters.matched === "unmatched") {
    clauses.push(`cqr.matched_product_id IS NULL`);
  }
  if (filters.category) {
    clauses.push(`${categorySql()} = ?`);
    values.push(filters.category);
  }

  return {
    sql: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "",
    values,
  };
}

function orderBySql(filters: Filters): string {
  const direction = filters.order === "asc" ? "ASC" : "DESC";
  if (filters.sort === "price") {
    return `cqr.sale_price_usd ${direction}`;
  }
  if (filters.sort === "model") {
    return `cqr.raw_model COLLATE NOCASE ${direction}`;
  }
  return `cqf.quote_date ${direction}`;
}

function categorySql(): string {
  return `CASE
    WHEN instr(cqf.relative_path, '/') > 0 THEN substr(cqf.relative_path, 1, instr(cqf.relative_path, '/') - 1)
    ELSE '根目录'
  END`;
}

function Pagination({
  filters,
  totalPages,
  safePage,
  totalRows,
}: {
  filters: Filters;
  totalPages: number;
  safePage: number;
  totalRows: number;
}) {
  const start = totalRows === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1;
  const end = Math.min(safePage * PAGE_SIZE, totalRows);

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-paper px-4 py-3 text-sm shadow-panel">
      <div className="text-stone-600">
        显示 {formatInteger(start)}-{formatInteger(end)} / {formatInteger(totalRows)}
      </div>
      <div className="flex items-center gap-2">
        <PageLink disabled={safePage <= 1} href={buildHref(filters, { page: safePage - 1 })}>
          上一页
        </PageLink>
        <span className="px-2 text-stone-600">
          第 {safePage} / {totalPages} 页
        </span>
        <PageLink disabled={safePage >= totalPages} href={buildHref(filters, { page: safePage + 1 })}>
          下一页
        </PageLink>
      </div>
    </div>
  );
}

function PageLink({ href, disabled, children }: { href: string; disabled: boolean; children: ReactNode }) {
  if (disabled) {
    return (
      <span className="rounded-md border border-line bg-stone-100 px-3 py-1.5 text-stone-400">{children}</span>
    );
  }
  return (
    <Link href={href} className="rounded-md border border-line bg-white px-3 py-1.5 font-semibold hover:border-leaf">
      {children}
    </Link>
  );
}

function SortableHeader({
  label,
  field,
  filters,
  align,
}: {
  label: string;
  field: Filters["sort"];
  filters: Filters;
  align?: "right";
}) {
  const active = filters.sort === field;
  const nextOrder = active && filters.order === "desc" ? "asc" : "desc";
  const suffix = active ? (filters.order === "desc" ? " ↓" : " ↑") : "";
  return (
    <Link href={buildHref(filters, { sort: field, order: nextOrder, page: 1 })} className={align === "right" ? "text-right" : ""}>
      {label}
      {suffix}
    </Link>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm font-semibold text-stone-700">
      {label}
      <div className="mt-1">{children}</div>
    </label>
  );
}

function SummaryCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-md border border-line bg-paper p-4 shadow-panel">
      <div className="text-xs font-semibold text-stone-500">{label}</div>
      <div className="mt-3 text-2xl font-semibold text-ink">{value}</div>
      <div className="mt-2 text-xs text-stone-500">{detail}</div>
    </div>
  );
}

function DetailBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold text-ink">{title}</h3>
      <div className="space-y-2 text-sm">{children}</div>
    </section>
  );
}

function DetailLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-2 md:grid-cols-[92px_minmax(0,1fr)]">
      <div className="text-xs font-semibold text-stone-500">{label}</div>
      <div className="break-words text-stone-800">{value || "—"}</div>
    </div>
  );
}

function buildPageParams(filters: Filters, overrides: Partial<Filters>): URLSearchParams {
  const next = { ...filters, ...overrides };
  const params = new URLSearchParams();
  if (next.search) params.set("search", next.search);
  if (next.customer) params.set("customer", next.customer);
  if (next.dateFrom) params.set("dateFrom", next.dateFrom);
  if (next.dateTo) params.set("dateTo", next.dateTo);
  if (next.matched !== ALL_MATCHED_VALUE) params.set("matched", next.matched);
  if (next.category) params.set("category", next.category);
  if (next.page > 1) params.set("page", String(next.page));
  if (next.sort !== "date") params.set("sort", next.sort);
  if (next.order !== "desc") params.set("order", next.order);
  return params;
}

function buildHref(filters: Filters, overrides: Partial<Filters>): string {
  const params = buildPageParams(filters, overrides);
  const query = params.toString();
  return query ? `/customer-quotes?${query}` : "/customer-quotes";
}

function normalizeQueryValue(value: string | undefined): string {
  return String(value ?? "").normalize("NFC").trim();
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function formatCustomer(value: string | null): string {
  const text = normalizeQueryValue(value ?? undefined);
  return text || "（内部核价）";
}

function formatQuoteDate(value: string | null): string {
  const text = normalizeQueryValue(value ?? undefined);
  if (!text) return "—";
  return text.length >= 7 ? text.slice(0, 7) : text;
}

function formatDateRange(minDate: string | null, maxDate: string | null): string {
  if (!minDate && !maxDate) return "—";
  return `${formatQuoteDate(minDate)} ~ ${formatQuoteDate(maxDate)}`;
}

function formatUsd(value: number | null, fallback: string | null): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return `$${value.toFixed(2)}`;
  }
  return fallback || "—";
}

function formatRmb(value: number | null): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return `¥${value.toFixed(2)}`;
  }
  return "—";
}

function formatInteger(value: number): string {
  return value.toLocaleString("en-US");
}

function formatPercent(count: number, total: number): string {
  if (total <= 0) return "0%";
  return `${Math.round((count / total) * 100)}%`;
}

function formatJson(value: string | null): string {
  const text = normalizeQueryValue(value ?? undefined);
  if (!text) return "—";
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

const inputClass =
  "h-10 w-full rounded-md border border-line bg-white px-3 text-sm text-ink outline-none focus:border-leaf";
