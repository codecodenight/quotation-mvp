"use client";

import { useMemo, useState } from "react";

import type { ImportColumn, SheetRows } from "@/lib/excel-import";

const selectClass =
  "min-h-28 w-full rounded-md border border-line bg-white px-3 py-2 text-sm outline-none focus:border-leaf";

export function HejiaDescriptionField({
  columns,
  rows,
  headerRowIndex,
}: {
  columns: ImportColumn[];
  rows: SheetRows;
  headerRowIndex: number;
}) {
  const [selectedColumns, setSelectedColumns] = useState<number[]>([]);
  const previewRows = useMemo(
    () => buildDescriptionPreview(rows, columns, headerRowIndex, selectedColumns),
    [columns, headerRowIndex, rows, selectedColumns],
  );

  return (
    <div className="md:col-span-2">
      <label className="block">
        <span className="mb-1.5 block text-xs font-semibold text-stone-600">
          Product Details 多列合并（可跳过）
        </span>
        <select
          name="descriptionColumns"
          multiple
          className={selectClass}
          value={selectedColumns.map(String)}
          onChange={(event) =>
            setSelectedColumns(
              Array.from(event.currentTarget.selectedOptions)
                .map((option) => Number(option.value))
                .filter((value) => Number.isInteger(value) && value >= 0),
            )
          }
        >
          {columns.map((column) => (
            <option key={column.index} value={column.index}>
              {column.label}：{column.header}
            </option>
          ))}
        </select>
      </label>

      {selectedColumns.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {selectedColumns.map((index) => {
            const column = columns.find((item) => item.index === index);
            return (
              <span key={index} className="rounded-sm border border-line bg-white px-2 py-1 text-xs text-stone-700">
                {column?.label ?? index + 1}: {column?.header ?? "未命名列"}
              </span>
            );
          })}
        </div>
      ) : (
        <div className="mt-2 text-xs text-stone-500">不选择时 Product Details 留空，仍可用下方旧单列描述兼容字段。</div>
      )}

      {previewRows.length > 0 ? (
        <div className="mt-3 rounded-md border border-line bg-white">
          <div className="border-b border-line px-3 py-2 text-xs font-semibold text-stone-600">
            Product Details 合并预览
          </div>
          <div className="divide-y divide-line">
            {previewRows.map((row) => (
              <div key={row.rowIndex} className="grid gap-2 px-3 py-2 text-xs md:grid-cols-[72px_minmax(0,1fr)]">
                <div className="font-semibold text-stone-500">第 {row.rowIndex} 行</div>
                <pre className="whitespace-pre-wrap break-words font-sans text-stone-800">{row.text}</pre>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function buildDescriptionPreview(
  rows: SheetRows,
  columns: ImportColumn[],
  headerRowIndex: number,
  selectedColumns: number[],
): Array<{ rowIndex: number; text: string }> {
  if (selectedColumns.length === 0) {
    return [];
  }

  const header = rows[headerRowIndex - 1] ?? [];
  const dataRows = rows.slice(headerRowIndex, headerRowIndex + 5);

  return dataRows
    .map((row, index) => ({
      rowIndex: headerRowIndex + index + 1,
      text: selectedColumns
        .map((columnIndex) => {
          const value = cleanCell(row[columnIndex]);
          if (!value) {
            return "";
          }
          const headerText =
            cleanCell(header[columnIndex]) ||
            columns.find((column) => column.index === columnIndex)?.header ||
            `列 ${columnIndex + 1}`;
          return `${headerText}: ${value}`;
        })
        .filter(Boolean)
        .join("\n"),
    }))
    .filter((row) => row.text.length > 0);
}

function cleanCell(value: unknown): string {
  return String(value ?? "")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
