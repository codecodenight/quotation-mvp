import * as XLSX from "xlsx";
import { readFileSync } from "node:fs";

export type CellValue = string;
export type SheetRows = CellValue[][];
export type IdentifierTarget = "rawProductName" | "rawModelNo";

export type ImportColumn = {
  index: number;
  label: string;
  header: string;
};

export type WorkbookPreview = {
  sheetNames: string[];
  selectedSheetName: string;
  rows: SheetRows;
  columns: ImportColumn[];
};

export type ImportMapping = {
  identifierColumn: number | null;
  identifierTarget: IdentifierTarget;
  priceColumn: number | null;
  currency: string;
  moqColumn?: number | null;
  materialColumn?: number | null;
  sizeColumn?: number | null;
  descriptionColumn?: number | null;
};

export type MultiPriceEntry = {
  variant: string;
  price: string;
};

export type RawProductImportRow = {
  sourceFileId: string;
  factoryName: string | null;
  rawProductName: string | null;
  rawModelNo: string | null;
  rawPrice: string | null;
  rawCurrency: string;
  rawMoq: string | null;
  rawMaterial: string | null;
  rawSize: string | null;
  rawDescription: string | null;
  rawRemark: string | null;
  rawRowData: {
    rowNumber: number;
    cells: Array<{
      columnIndex: number;
      columnLabel: string;
      header: string;
      value: string;
    }>;
  };
  sourceSheetName: string;
  headerRowIndex: number;
};

const PREVIEW_ROW_LIMIT = 60;

export function readWorkbookPreview(
  filePath: string,
  selectedSheetName?: string,
  headerRowIndex?: number,
): WorkbookPreview {
  const workbook = readWorkbook(filePath);
  const sheetNames = workbook.SheetNames;
  const selectedSheet = selectedSheetName && sheetNames.includes(selectedSheetName) ? selectedSheetName : sheetNames[0];

  if (!selectedSheet) {
    throw new Error("Excel 文件没有可读取的 sheet。");
  }

  const worksheet = workbook.Sheets[selectedSheet];
  const rows = normalizeRows(XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false, defval: "" })).slice(
    0,
    PREVIEW_ROW_LIMIT,
  );

  return {
    sheetNames,
    selectedSheetName: selectedSheet,
    rows,
    columns: headerRowIndex ? buildColumns(rows, headerRowIndex) : [],
  };
}

export function readSheetRows(filePath: string, sheetName: string): SheetRows {
  const workbook = readWorkbook(filePath);
  const worksheet = workbook.Sheets[sheetName];

  if (!worksheet) {
    throw new Error("选择的 sheet 不存在。");
  }

  return normalizeRows(XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false, defval: "" }));
}

export function buildColumns(rows: SheetRows, headerRowIndex: number): ImportColumn[] {
  const header = rows[headerRowIndex - 1] ?? [];
  const maxColumns = Math.max(...rows.map((row) => row.length), header.length, 0);

  return Array.from({ length: maxColumns }, (_, index) => {
    const label = columnLabel(index);
    const headerValue = cleanCell(header[index]);
    return {
      index,
      label,
      header: headerValue || `未命名列 ${label}`,
    };
  });
}

export function buildRawProductRows({
  sourceFileId,
  factoryName = null,
  sheetName,
  headerRowIndex,
  rows,
  mapping,
}: {
  sourceFileId: string;
  factoryName?: string | null;
  sheetName: string;
  headerRowIndex: number;
  rows: SheetRows;
  mapping: ImportMapping;
}): RawProductImportRow[] {
  validateMapping(mapping);

  const header = rows[headerRowIndex - 1] ?? [];
  const dataRows = rows.slice(headerRowIndex);
  const imported: RawProductImportRow[] = [];

  dataRows.forEach((row, index) => {
    if (isEmptyRow(row)) {
      return;
    }

    const identifier = cellAt(row, mapping.identifierColumn);
    if (!identifier) {
      return;
    }

    const rawProductName = mapping.identifierTarget === "rawProductName" ? identifier : null;
    const rawModelNo = mapping.identifierTarget === "rawModelNo" ? identifier : null;
    const rawPrice = parsePriceValue(cellAt(row, mapping.priceColumn));

    imported.push({
      sourceFileId,
      factoryName,
      rawProductName,
      rawModelNo,
      rawPrice,
      rawCurrency: mapping.currency.trim().toUpperCase(),
      rawMoq: cellAt(row, mapping.moqColumn),
      rawMaterial: cellAt(row, mapping.materialColumn),
      rawSize: cellAt(row, mapping.sizeColumn),
      rawDescription: cellAt(row, mapping.descriptionColumn),
      rawRemark: null,
      rawRowData: {
        rowNumber: headerRowIndex + index + 1,
        cells: row.map((value, columnIndex) => ({
          columnIndex,
          columnLabel: columnLabel(columnIndex),
          header: cleanCell(header[columnIndex]) || `未命名列 ${columnLabel(columnIndex)}`,
          value: cleanCell(value),
        })),
      },
      sourceSheetName: sheetName,
      headerRowIndex,
    });
  });

  return imported;
}

export function parsePriceValue(value: unknown): string | null {
  const normalized = cleanCell(value).replace(/,/g, "").trim();
  const rmbSymbolIndex = normalized.search(/[¥￥]/);
  const text =
    rmbSymbolIndex >= 0
      ? normalized.slice(rmbSymbolIndex + 1).trim()
      : normalized
          .replace(/^\s*\$\s*/, "")
          .replace(/\s*(USD|RMB|CNY|元)\s*$/i, "")
          .trim();

  if (!text || text === "/" || text === "-") {
    return null;
  }

  const match = text.match(/-?\d+(?:\.\d+)?/);
  if (!match) {
    return null;
  }

  const numeric = Number(match[0]);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }

  return match[0];
}

export function parseMultiPrice(value: unknown): MultiPriceEntry[] | null {
  const normalized = cleanCell(value).trim();
  if (!normalized || normalized === "/" || normalized === "-") {
    return null;
  }

  const pairPattern = /([\p{L}\p{N}_+\-]+)\s*[:：]\s*(-?\d+(?:\.\d+)?)/gu;
  const entries: MultiPriceEntry[] = [];
  let match: RegExpExecArray | null;

  while ((match = pairPattern.exec(normalized)) !== null) {
    const numeric = Number(match[2]);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      return null;
    }

    entries.push({
      variant: match[1],
      price: match[2],
    });
  }

  if (entries.length < 2) {
    return null;
  }

  const remainingText = normalized.replace(pairPattern, "").trim();
  if (remainingText && !/^[\s,，;；]+$/.test(remainingText)) {
    return null;
  }

  return entries;
}

export function columnLabel(index: number): string {
  let value = "";
  let current = index + 1;

  while (current > 0) {
    const remainder = (current - 1) % 26;
    value = String.fromCharCode(65 + remainder) + value;
    current = Math.floor((current - 1) / 26);
  }

  return value;
}

function validateMapping(mapping: ImportMapping): void {
  if (mapping.identifierColumn === null || mapping.identifierColumn === undefined) {
    throw new Error("产品标识列不能为空");
  }
  if (mapping.priceColumn === null || mapping.priceColumn === undefined) {
    throw new Error("价格列不能为空");
  }
  if (!mapping.currency.trim()) {
    throw new Error("币种不能为空");
  }
}

function readWorkbook(filePath: string): XLSX.WorkBook {
  const buffer = readFileSync(filePath);
  return XLSX.read(buffer, { type: "buffer", cellDates: false, raw: false });
}

function normalizeRows(rows: unknown[][]): SheetRows {
  return rows.map((row) => row.map(cleanCell));
}

function cleanCell(value: unknown): string {
  return String(value ?? "")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cellAt(row: SheetRows[number], index: number | null | undefined): string | null {
  if (index === null || index === undefined) {
    return null;
  }

  const value = cleanCell(row[index]);
  return value.length > 0 ? value : null;
}

function isEmptyRow(row: SheetRows[number]): boolean {
  return row.every((cell) => cleanCell(cell).length === 0);
}
