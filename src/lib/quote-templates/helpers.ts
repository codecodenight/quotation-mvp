import type { Borders, Worksheet } from "exceljs";

import type { QuoteTemplateConfig, QuoteTemplateItem } from "../quote-template-registry";

type QuoteCellValue = string | number | null;

export function readParam(item: QuoteTemplateItem, key: string): string {
  return item.params[key]?.trim() ?? "";
}

export function appendSuffix(value: string, suffix: string): string {
  if (!value) {
    return "";
  }
  return value.toUpperCase().endsWith(suffix.toUpperCase()) ? value : `${value}${suffix}`;
}

export function prefixValue(value: string, prefix: string): string {
  if (!value) {
    return "";
  }
  return value.toUpperCase().startsWith(prefix.toUpperCase()) ? value : `${prefix}${value}`;
}

export function formatCct(value: string): string {
  if (!value) {
    return "";
  }
  return value
    .split("/")
    .map((part) => appendSuffix(part.trim(), "K"))
    .join("/");
}

export function cleanMoq(raw: string | null): string {
  if (!raw) {
    return "";
  }

  const match = raw.match(/^[\d,]+/);
  return match ? match[0].replace(/,/g, "") : "";
}

export function formatCtnSize(item: QuoteTemplateItem): string {
  if (!item.ctnLength || !item.ctnWidth || !item.ctnHeight) {
    return "";
  }
  return `${item.ctnLength} × ${item.ctnWidth} × ${item.ctnHeight}`;
}

export function calcVolume(length: string | null, width: string | null, height: string | null): number | string {
  if (!length || !width || !height) {
    return "";
  }

  const parsedLength = Number.parseFloat(length);
  const parsedWidth = Number.parseFloat(width);
  const parsedHeight = Number.parseFloat(height);
  if (!Number.isFinite(parsedLength) || !Number.isFinite(parsedWidth) || !Number.isFinite(parsedHeight)) {
    return "";
  }

  return Number(((parsedLength * parsedWidth * parsedHeight) / 1_000_000).toFixed(3));
}

export function buildRowCellsFromValues(
  columns: QuoteTemplateConfig["columns"],
  values: QuoteCellValue[],
): Record<string, QuoteCellValue> {
  return Object.fromEntries(columns.map((column, index) => [column.key, values[index] ?? ""]));
}

export function thinBorder(): Partial<Borders> {
  return {
    top: { style: "thin", color: { argb: "FFD8D1C2" } },
    left: { style: "thin", color: { argb: "FFD8D1C2" } },
    bottom: { style: "thin", color: { argb: "FFD8D1C2" } },
    right: { style: "thin", color: { argb: "FFD8D1C2" } },
  };
}

export function writeHeader(ws: Worksheet, template: QuoteTemplateConfig): void {
  ws.getRow(1).height = 24;
  template.columns.forEach((column, index) => {
    const cell = ws.getRow(1).getCell(index + 1);
    cell.value = column.header;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF3F4A35" } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = thinBorder();
  });
}
