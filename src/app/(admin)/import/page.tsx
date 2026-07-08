import type { File as SourceFile } from "@prisma/client";
import { FileSpreadsheet, Rows3 } from "lucide-react";

import { buildColumns, columnLabel, readWorkbookPreview, type ImportColumn, type SheetRows } from "@/lib/excel-import";
import { resolveStoredFilePath } from "@/lib/file-paths";
import { prisma } from "@/lib/prisma";
import { importHejiaProducts, importRawProducts } from "./actions";
import { HejiaDescriptionField } from "./hejia-description-field";

type ImportPageProps = {
  searchParams: Promise<{
    importMode?: string;
    fileId?: string;
    sheetName?: string;
    headerRowIndex?: string;
    imported?: string;
    hejiaImported?: string;
    hejiaSkipped?: string;
    hejiaImages?: string;
    hejiaImageFailed?: string;
    hejiaSkippedRows?: string;
    error?: string;
  }>;
};

const selectClass =
  "h-10 w-full rounded-md border border-line bg-white px-3 text-sm outline-none focus:border-leaf";

export default async function ImportPage({ searchParams }: ImportPageProps) {
  const params = await searchParams;
  const importMode = params.importMode === "hejia" ? "hejia" : "factory";
  const excelFiles = await prisma.file.findMany({
    where: { fileType: "excel" },
    orderBy: [{ scannedAt: "desc" }, { fileName: "asc" }],
    take: 500,
  });
  const selectedFile = params.fileId
    ? excelFiles.find((file) => file.id === params.fileId) ?? null
    : null;
  const selectedHeaderRowIndex = parseHeaderRowIndex(params.headerRowIndex);
  const skippedRows = parseSkippedRows(params.hejiaSkippedRows);

  let preview:
    | {
        sheetNames: string[];
        selectedSheetName: string;
        rows: SheetRows;
        columns: ImportColumn[];
      }
    | null = null;
  let previewError = "";

  if (selectedFile) {
    try {
      const resolvedPath = await resolveStoredFilePath(selectedFile);
      preview = readWorkbookPreview(resolvedPath, params.sheetName, selectedHeaderRowIndex ?? undefined);
    } catch (error) {
      previewError = error instanceof Error ? error.message : "Excel 读取失败。";
    }
  }

  const rawProductCount = selectedFile
    ? await prisma.rawProduct.count({ where: { sourceFileId: selectedFile.id } })
    : 0;
  const hejiaOfferCount = selectedFile
    ? await prisma.supplierOffer.count({ where: { sourceFileId: selectedFile.id } })
    : 0;

  return (
    <div className="mx-auto max-w-7xl">
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <div className="text-sm font-semibold uppercase tracking-[0.18em] text-leaf">Phase 4</div>
          <h1 className="mt-2 text-3xl font-semibold text-ink">Excel 导入</h1>
        </div>
        <div className="rounded-md border border-line bg-paper px-4 py-2 text-sm shadow-panel">
          {excelFiles.length} 个 Excel 文件
        </div>
      </header>

      {params.error ? <Notice tone="error">{params.error}</Notice> : null}
      {params.imported ? <Notice tone="success">已导入 {params.imported} 行到 raw_products。</Notice> : null}
      {params.hejiaImported ? (
        <Notice tone="success">
          ✓ 导入 {params.hejiaImported} 条 supplier_offers
          {` | 产品图 ${params.hejiaImages ?? "0"} 张`}
          {params.hejiaSkipped ? ` | ⚠️ 跳过 ${params.hejiaSkipped} 条` : ""}
          {isPositiveCount(params.hejiaImageFailed) ? ` | ⚠️ 图片失败 ${params.hejiaImageFailed} 张` : ""}
        </Notice>
      ) : null}
      {skippedRows.length > 0 ? <SkippedRowsNotice rows={skippedRows} /> : null}
      {previewError ? <Notice tone="error">{previewError}</Notice> : null}

      <section className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
        <div className="space-y-4">
          <StepCard step="1" title="选择导入模式">
            <form className="grid gap-3">
              <select name="importMode" defaultValue={importMode} className={selectClass}>
                <option value="factory">工厂报价模式：写入 raw_products</option>
                <option value="hejia">核价导入模式：直接写入产品和工厂报价</option>
              </select>
              {selectedFile ? <input type="hidden" name="fileId" value={selectedFile.id} /> : null}
              {preview ? <input type="hidden" name="sheetName" value={preview.selectedSheetName} /> : null}
              {selectedHeaderRowIndex ? (
                <input type="hidden" name="headerRowIndex" value={selectedHeaderRowIndex} />
              ) : null}
              <button className="h-10 rounded-md bg-primary hover:bg-primary-hover px-4 text-sm font-semibold text-white">切换模式</button>
            </form>
          </StepCard>

          <StepCard step="2" title="选择文件">
            <form className="grid gap-3">
              <input type="hidden" name="importMode" value={importMode} />
              <select name="fileId" defaultValue={selectedFile?.id ?? ""} className={selectClass}>
                <option value="">选择已扫描的 Excel 文件</option>
                {excelFiles.map((file) => (
                  <option key={file.id} value={file.id}>
                    {file.fileName}
                  </option>
                ))}
              </select>
              <button className="h-10 rounded-md bg-primary hover:bg-primary-hover px-4 text-sm font-semibold text-white">读取文件</button>
            </form>
          </StepCard>

          <StepCard step="3" title="选择 Sheet">
            {selectedFile && preview ? (
              <form className="grid gap-3">
                <input type="hidden" name="importMode" value={importMode} />
                <input type="hidden" name="fileId" value={selectedFile.id} />
                <select name="sheetName" defaultValue={preview.selectedSheetName} className={selectClass}>
                  {preview.sheetNames.map((sheetName) => (
                    <option key={sheetName} value={sheetName}>
                      {sheetName}
                    </option>
                  ))}
                </select>
                <button className="h-10 rounded-md bg-primary hover:bg-primary-hover px-4 text-sm font-semibold text-white">确认 Sheet</button>
              </form>
            ) : (
              <Muted>先选择 Excel 文件。</Muted>
            )}
          </StepCard>

          <StepCard step="4" title="选择表头行">
            {selectedFile && preview ? (
              <form className="grid gap-3">
                <input type="hidden" name="importMode" value={importMode} />
                <input type="hidden" name="fileId" value={selectedFile.id} />
                <input type="hidden" name="sheetName" value={preview.selectedSheetName} />
                <select name="headerRowIndex" defaultValue={selectedHeaderRowIndex ?? ""} className={selectClass}>
                  <option value="">选择表头所在行</option>
                  {preview.rows.slice(0, 20).map((row, index) => (
                    <option key={index + 1} value={index + 1}>
                      第 {index + 1} 行：{row.filter(Boolean).slice(0, 4).join(" / ") || "空行"}
                    </option>
                  ))}
                </select>
                <button className="h-10 rounded-md bg-primary hover:bg-primary-hover px-4 text-sm font-semibold text-white">生成预览</button>
              </form>
            ) : (
              <Muted>先选择 sheet。</Muted>
            )}
          </StepCard>

          <StepCard step="5" title="导入状态">
            {selectedFile ? (
              <div className="space-y-2 text-sm text-stone-700">
                <div className="font-medium text-ink">{selectedFile.fileName}</div>
                {importMode === "factory" ? (
                  <div>当前文件 raw_products：{rawProductCount} 行</div>
                ) : (
                  <div>当前文件 supplier_offers：{hejiaOfferCount} 条</div>
                )}
                <div className="break-all text-xs text-stone-500">{selectedFile.relativePath}</div>
              </div>
            ) : (
              <Muted>等待选择文件。</Muted>
            )}
          </StepCard>
        </div>

        <div className="space-y-4">
          {preview ? (
            <>
              <PreviewTable
                rows={preview.rows}
                selectedHeaderRowIndex={selectedHeaderRowIndex}
                title={`${selectedFile?.fileName ?? ""} / ${preview.selectedSheetName}`}
              />

              {selectedFile && selectedHeaderRowIndex ? (
                <MappingForm
                  importMode={importMode}
                  file={selectedFile}
                  sheetName={preview.selectedSheetName}
                  headerRowIndex={selectedHeaderRowIndex}
                  columns={preview.columns.length ? preview.columns : buildColumns(preview.rows, selectedHeaderRowIndex)}
                  rows={preview.rows}
                />
              ) : (
                <div className="rounded-md border border-line bg-paper p-5 text-sm text-stone-600 shadow-panel">
                  选择表头行后显示字段映射。
                </div>
              )}
            </>
          ) : (
            <div className="flex min-h-96 items-center justify-center rounded-md border border-line bg-paper p-8 text-center shadow-panel">
              <div>
                <FileSpreadsheet className="mx-auto h-10 w-10 text-brass" aria-hidden="true" />
                <div className="mt-4 text-lg font-semibold text-ink">等待读取 Excel</div>
                <p className="mt-2 text-sm text-stone-600">先在左侧选择已扫描的 Excel 文件。</p>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function MappingForm({
  importMode,
  file,
  sheetName,
  headerRowIndex,
  columns,
  rows,
}: {
  importMode: "factory" | "hejia";
  file: SourceFile;
  sheetName: string;
  headerRowIndex: number;
  columns: ImportColumn[];
  rows: SheetRows;
}) {
  if (importMode === "hejia") {
    return (
      <HejiaMappingForm
        file={file}
        sheetName={sheetName}
        headerRowIndex={headerRowIndex}
        columns={columns}
        rows={rows}
      />
    );
  }

  return <FactoryMappingForm file={file} sheetName={sheetName} headerRowIndex={headerRowIndex} columns={columns} />;
}

function FactoryMappingForm({
  file,
  sheetName,
  headerRowIndex,
  columns,
}: {
  file: SourceFile;
  sheetName: string;
  headerRowIndex: number;
  columns: ImportColumn[];
}) {
  return (
    <form action={importRawProducts} className="rounded-md border border-line bg-paper p-5 shadow-panel">
      <div className="mb-4 flex items-center gap-2">
        <Rows3 className="h-5 w-5 text-brass" aria-hidden="true" />
        <h2 className="text-lg font-semibold text-ink">工厂报价字段映射</h2>
      </div>
      <input type="hidden" name="fileId" value={file.id} />
      <input type="hidden" name="sheetName" value={sheetName} />
      <input type="hidden" name="headerRowIndex" value={headerRowIndex} />

      <div className="grid gap-4 md:grid-cols-2">
        <Field label="产品标识列（必填）">
          <ColumnSelect name="identifierColumn" columns={columns} required />
        </Field>
        <Field label="标识存入字段">
          <select name="identifierTarget" defaultValue="rawProductName" className={selectClass}>
            <option value="rawProductName">产品名 / 规格</option>
            <option value="rawModelNo">款号 / 型号</option>
          </select>
        </Field>
        <Field label="价格列（必填，多价格列选一个）">
          <ColumnSelect name="priceColumn" columns={columns} required />
        </Field>
        <Field label="币种（必填）">
          <select name="currency" defaultValue="RMB" className={selectClass}>
            <option value="RMB">RMB</option>
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
          </select>
        </Field>
        <Field label="MOQ（可跳过）">
          <ColumnSelect name="moqColumn" columns={columns} />
        </Field>
        <Field label="材质（可跳过）">
          <ColumnSelect name="materialColumn" columns={columns} />
        </Field>
        <Field label="尺寸（可跳过）">
          <ColumnSelect name="sizeColumn" columns={columns} />
        </Field>
        <Field label="描述 / 参数（建议选择）">
          <ColumnSelect name="descriptionColumn" columns={columns} />
        </Field>
      </div>

      <button className="mt-5 h-11 rounded-md bg-primary hover:bg-primary-hover px-5 text-sm font-semibold text-white">
        写入 raw_products
      </button>
    </form>
  );
}

function HejiaMappingForm({
  file,
  sheetName,
  headerRowIndex,
  columns,
  rows,
}: {
  file: SourceFile;
  sheetName: string;
  headerRowIndex: number;
  columns: ImportColumn[];
  rows: SheetRows;
}) {
  return (
    <form action={importHejiaProducts} className="rounded-md border border-line bg-paper p-5 shadow-panel">
      <div className="mb-4 flex items-center gap-2">
        <Rows3 className="h-5 w-5 text-brass" aria-hidden="true" />
        <h2 className="text-lg font-semibold text-ink">核价字段映射</h2>
      </div>
      <input type="hidden" name="fileId" value={file.id} />
      <input type="hidden" name="sheetName" value={sheetName} />
      <input type="hidden" name="headerRowIndex" value={headerRowIndex} />

      <div className="grid gap-4 md:grid-cols-2">
        <Field label="产品款号列（必填）">
          <ColumnSelect name="modelNoColumn" columns={columns} required />
        </Field>
        <Field label="工厂名列（必填）">
          <ColumnSelect name="factoryNameColumn" columns={columns} required />
        </Field>
        <Field label="工厂 RMB 价格列（必填）">
          <ColumnSelect name="factoryPriceColumn" columns={columns} required />
        </Field>
        <Field label="工厂报价币种（默认 RMB）">
          <select name="currency" defaultValue="RMB" className={selectClass}>
            <option value="RMB">RMB</option>
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
          </select>
        </Field>
        <HejiaDescriptionField columns={columns} rows={rows} headerRowIndex={headerRowIndex} />
        <Field label="产品描述列（旧单列兼容，可跳过）">
          <ColumnSelect name="descriptionColumn" columns={columns} />
        </Field>
        <Field label="尺寸列（可跳过）">
          <ColumnSelect name="sizeColumn" columns={columns} />
        </Field>
        <Field label="MOQ 列（可跳过）">
          <ColumnSelect name="moqColumn" columns={columns} />
        </Field>
        <Field label="CTN Qty 列（可跳过）">
          <ColumnSelect name="ctnQtyColumn" columns={columns} />
        </Field>
        <Field label="Carton Size 整列（可跳过）">
          <ColumnSelect name="ctnSizeColumn" columns={columns} />
        </Field>
        <Field label="Carton L 长（可跳过）">
          <ColumnSelect name="ctnLengthColumn" columns={columns} />
        </Field>
        <Field label="Carton W 宽（可跳过）">
          <ColumnSelect name="ctnWidthColumn" columns={columns} />
        </Field>
        <Field label="Carton H 高（可跳过）">
          <ColumnSelect name="ctnHeightColumn" columns={columns} />
        </Field>
        <Field label="客户 USD 价格列（可跳过）">
          <ColumnSelect name="customerUsdPriceColumn" columns={columns} />
        </Field>
        <Field label="系数 / 汇率列（可跳过）">
          <ColumnSelect name="coefficientColumn" columns={columns} />
        </Field>
      </div>

      <button className="mt-5 h-11 rounded-md bg-primary hover:bg-primary-hover px-5 text-sm font-semibold text-white">
        直接写入产品和工厂报价
      </button>
    </form>
  );
}

function PreviewTable({
  rows,
  selectedHeaderRowIndex,
  title,
}: {
  rows: SheetRows;
  selectedHeaderRowIndex: number | null;
  title: string;
}) {
  const maxColumns = Math.min(Math.max(...rows.map((row) => row.length), 0), 12);
  const displayRows = rows.slice(0, 20);

  return (
    <section className="overflow-hidden rounded-md border border-line bg-paper shadow-panel">
      <div className="border-b border-line px-4 py-3">
        <h2 className="font-semibold text-ink">{title}</h2>
        <div className="mt-1 text-xs text-stone-500">预览前 20 行 / 前 12 列</div>
      </div>
      <div className="overflow-auto bg-white">
        <table className="w-full border-collapse text-left text-xs">
          <thead className="bg-cream text-stone-600">
            <tr>
              <th className="sticky left-0 border-r border-line bg-cream px-2 py-2">行</th>
              {Array.from({ length: maxColumns }, (_, index) => (
                <th key={index} className="whitespace-nowrap px-2 py-2">
                  {columnLabel(index)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayRows.map((row, rowIndex) => {
              const isHeader = selectedHeaderRowIndex === rowIndex + 1;
              return (
                <tr key={rowIndex} className={isHeader ? "bg-[#fff7df]" : "odd:bg-white even:bg-[#fbfaf7]"}>
                  <td className="sticky left-0 border-r border-line bg-inherit px-2 py-2 font-semibold">
                    {rowIndex + 1}
                  </td>
                  {Array.from({ length: maxColumns }, (_, columnIndex) => (
                    <td key={columnIndex} className="max-w-64 whitespace-nowrap px-2 py-2 text-stone-700">
                      {row[columnIndex] ?? ""}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ColumnSelect({
  name,
  columns,
  required = false,
}: {
  name: string;
  columns: ImportColumn[];
  required?: boolean;
}) {
  return (
    <select name={name} className={selectClass} required={required} defaultValue="">
      <option value="">{required ? "请选择" : "跳过"}</option>
      {columns.map((column) => (
        <option key={column.index} value={column.index}>
          {column.label}：{column.header}
        </option>
      ))}
    </select>
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

function StepCard({ step, title, children }: { step: string; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md border border-line bg-paper p-4 shadow-panel">
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary hover:bg-primary-hover text-xs font-semibold text-white">
          {step}
        </span>
        <h2 className="font-semibold text-ink">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function Notice({ tone, children }: { tone: "error" | "success"; children: React.ReactNode }) {
  const className =
    tone === "error"
      ? "mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
      : "mb-4 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800";

  return <div className={className}>{children}</div>;
}

type SkippedRowNotice = {
  rowIndex: number;
  reason: string;
  rawData: string;
};

function SkippedRowsNotice({ rows }: { rows: SkippedRowNotice[] }) {
  return (
    <details className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      <summary className="cursor-pointer font-semibold">查看跳过的行（最多显示 20 条）</summary>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-amber-200">
              <th className="whitespace-nowrap px-2 py-2">行号</th>
              <th className="whitespace-nowrap px-2 py-2">原因</th>
              <th className="px-2 py-2">原始内容</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.rowIndex}:${row.reason}`} className="border-b border-amber-100 last:border-0">
                <td className="whitespace-nowrap px-2 py-2 font-semibold">{row.rowIndex}</td>
                <td className="whitespace-nowrap px-2 py-2">{row.reason}</td>
                <td className="min-w-96 px-2 py-2 text-amber-950">{row.rawData}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <div className="text-sm text-stone-500">{children}</div>;
}

function parseHeaderRowIndex(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseSkippedRows(value: string | undefined): SkippedRowNotice[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((row) => ({
        rowIndex: Number(row?.rowIndex),
        reason: String(row?.reason ?? ""),
        rawData: String(row?.rawData ?? ""),
      }))
      .filter((row) => Number.isInteger(row.rowIndex) && row.rowIndex > 0 && row.reason);
  } catch {
    return [];
  }
}

function isPositiveCount(value: string | undefined): boolean {
  return Boolean(value && Number(value) > 0);
}
