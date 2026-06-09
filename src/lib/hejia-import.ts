import type { SheetRows } from "./excel-import";
import { parsePriceValue } from "./excel-import";

export type HejiaImportMapping = {
  modelNoColumn: number | null;
  factoryNameColumn: number | null;
  factoryPriceColumn: number | null;
  currency: string;
  descriptionColumn?: number | null;
  descriptionColumns?: number[];
  fillDownModelColumn?: boolean;
  sizeColumn?: number | null;
  moqColumn?: number | null;
  ctnQtyColumn?: number | null;
  ctnSizeColumn?: number | null;
  ctnLengthColumn?: number | null;
  ctnWidthColumn?: number | null;
  ctnHeightColumn?: number | null;
  customerUsdPriceColumn?: number | null;
  coefficientColumn?: number | null;
};

export type HejiaProductInput = {
  modelNo: string;
  productName: string;
  category: string;
  size: string | null;
  remark: string | null;
  sourceRowIndex: number;
};

export type HejiaOfferInput = {
  modelNo: string;
  factoryName: string;
  purchasePrice: string;
  currency: string;
  moq: string | null;
  ctnQty: string | null;
  ctnLength: string | null;
  ctnWidth: string | null;
  ctnHeight: string | null;
  sourceFileId: string;
  customerUsdPrice: string | null;
  coefficient: string | null;
  remark: string | null;
};

export type HejiaImportResult = {
  products: HejiaProductInput[];
  offers: HejiaOfferInput[];
  skippedRows: HejiaSkippedRow[];
};

export type HejiaSkippedRow = {
  rowIndex: number;
  reason: "价格列非有效数字" | "缺少产品款号" | "缺少工厂名";
  rawData: string;
};

export function buildHejiaImportRows({
  sourceFileId,
  sheetName,
  headerRowIndex,
  rows,
  mapping,
}: {
  sourceFileId: string;
  sheetName: string;
  headerRowIndex: number;
  rows: SheetRows;
  mapping: HejiaImportMapping;
}): HejiaImportResult {
  validateMapping(mapping);

  const productsByModelNo = new Map<string, HejiaProductInput>();
  const offers: HejiaOfferInput[] = [];
  const skippedRows: HejiaSkippedRow[] = [];
  let lastFactoryName: string | null = null;
  let lastModelNo: string | null = null;
  const header = rows[headerRowIndex - 1] ?? [];
  const descCols =
    mapping.descriptionColumns ?? (mapping.descriptionColumn !== null && mapping.descriptionColumn !== undefined
      ? [mapping.descriptionColumn]
      : []);
  const hasExplicitDescriptionColumns = mapping.descriptionColumns !== undefined && mapping.descriptionColumns.length > 0;

  rows.slice(headerRowIndex).forEach((row, index) => {
    const rowIndex = headerRowIndex + index + 1;
    if (isEmptyRow(row)) {
      return;
    }

    const mappedModelNo = cellAt(row, mapping.modelNoColumn);
    const modelNo = mappedModelNo ?? (mapping.fillDownModelColumn ? lastModelNo : null);
    const mappedFactoryName = cellAt(row, mapping.factoryNameColumn);
    const factoryName = mappedFactoryName ?? lastFactoryName;
    const purchasePrice = parsePriceValue(cellAt(row, mapping.factoryPriceColumn));

    if (mappedModelNo) {
      lastModelNo = mappedModelNo;
    }
    if (mappedFactoryName) {
      lastFactoryName = mappedFactoryName;
    }
    if (!modelNo) {
      skippedRows.push(buildSkippedRow(rowIndex, "缺少产品款号", row));
      return;
    }
    if (!factoryName) {
      skippedRows.push(buildSkippedRow(rowIndex, "缺少工厂名", row));
      return;
    }
    if (!purchasePrice) {
      skippedRows.push(buildSkippedRow(rowIndex, "价格列非有效数字", row));
      return;
    }

    const description = hasExplicitDescriptionColumns
      ? mergeColumnsToRemark(row, descCols, header)
      : cellAt(row, mapping.descriptionColumn);
    const size = cellAt(row, mapping.sizeColumn);
    const customerUsdPrice = cellAt(row, mapping.customerUsdPriceColumn);
    const coefficient = cellAt(row, mapping.coefficientColumn);
    const ctnDimensions = readCtnDimensions(row, mapping);

    if (!productsByModelNo.has(modelNo)) {
      productsByModelNo.set(modelNo, {
        modelNo,
        productName: hasExplicitDescriptionColumns ? modelNo : description ?? modelNo,
        category: sheetName,
        size,
        remark: description,
        sourceRowIndex: rowIndex - 1,
      });
    }

    offers.push({
      modelNo,
      factoryName,
      purchasePrice,
      currency: mapping.currency.trim().toUpperCase(),
      moq: cellAt(row, mapping.moqColumn),
      ctnQty: cleanIntegerText(cellAt(row, mapping.ctnQtyColumn)),
      ctnLength: ctnDimensions.length,
      ctnWidth: ctnDimensions.width,
      ctnHeight: ctnDimensions.height,
      sourceFileId,
      customerUsdPrice,
      coefficient,
      remark: buildHejiaSupplierOfferRemark({ customerUsdPrice, coefficient }),
    });
  });

  return {
    products: Array.from(productsByModelNo.values()),
    offers,
    skippedRows,
  };
}

export function mergeColumnsToRemark(
  row: SheetRows[number],
  remarkColumns: number[],
  headerRow: SheetRows[number],
): string | null {
  const parts: string[] = [];
  for (const columnIndex of remarkColumns) {
    const value = cellAt(row, columnIndex);
    if (!value) {
      continue;
    }
    const header = cellAt(headerRow, columnIndex) ?? `列 ${columnIndex + 1}`;
    parts.push(`${header}: ${value}`);
  }

  return parts.length > 0 ? parts.join("\n") : null;
}

function readCtnDimensions(
  row: SheetRows[number],
  mapping: HejiaImportMapping,
): { length: string | null; width: string | null; height: string | null } {
  const mappedDimensions = {
    length: cleanDimensionText(cellAt(row, mapping.ctnLengthColumn)),
    width: cleanDimensionText(cellAt(row, mapping.ctnWidthColumn)),
    height: cleanDimensionText(cellAt(row, mapping.ctnHeightColumn)),
  };

  if (mappedDimensions.length && mappedDimensions.width && mappedDimensions.height) {
    return mappedDimensions;
  }

  return parseCtnSize(cellAt(row, mapping.ctnSizeColumn)) ?? { length: null, width: null, height: null };
}

export function parseCtnSize(
  raw: string | null,
): { length: string; width: string; height: string } | null {
  if (!raw) {
    return null;
  }

  const cleaned = raw.replace(/\s*(cm|厘米|mm)\s*$/i, "").trim();
  const parts = cleaned.split(/\s*[×xX*]\s*/).map((part) => cleanDimensionText(part));
  if (parts.length !== 3 || parts.some((part) => part === null)) {
    return null;
  }

  const [length, width, height] = parts;
  if (!length || !width || !height) {
    return null;
  }

  return { length, width, height };
}

function cleanIntegerText(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const match = value.match(/^[\d,]+/);
  return match ? match[0].replace(/,/g, "") : null;
}

function cleanDimensionText(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const match = value.replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  return match ? match[0] : null;
}

export function buildHejiaSupplierOfferRemark({
  customerUsdPrice,
  coefficient,
}: {
  customerUsdPrice: string | null;
  coefficient: string | null;
}): string | null {
  const parts: string[] = [];
  if (customerUsdPrice) {
    parts.push(`客户USD价: ${customerUsdPrice}`);
  }
  if (coefficient) {
    parts.push(`系数/汇率: ${coefficient}`);
  }

  return parts.length > 0 ? parts.join("\n") : null;
}

function validateMapping(mapping: HejiaImportMapping): void {
  if (mapping.modelNoColumn === null || mapping.modelNoColumn === undefined) {
    throw new Error("产品款号列不能为空");
  }
  if (mapping.factoryNameColumn === null || mapping.factoryNameColumn === undefined) {
    throw new Error("工厂名列不能为空");
  }
  if (mapping.factoryPriceColumn === null || mapping.factoryPriceColumn === undefined) {
    throw new Error("工厂RMB价格列不能为空");
  }
  if (!mapping.currency.trim()) {
    throw new Error("币种不能为空");
  }
}

function cellAt(row: SheetRows[number], index: number | null | undefined): string | null {
  if (index === null || index === undefined) {
    return null;
  }

  const value = cleanCell(row[index]);
  return value.length > 0 ? value : null;
}

function cleanCell(value: unknown): string {
  return String(value ?? "")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isEmptyRow(row: SheetRows[number]): boolean {
  return row.every((cell) => cleanCell(cell).length === 0);
}

function buildSkippedRow(rowIndex: number, reason: HejiaSkippedRow["reason"], row: SheetRows[number]): HejiaSkippedRow {
  return {
    rowIndex,
    reason,
    rawData: row.map((cell) => cleanCell(cell)).join(" | "),
  };
}
