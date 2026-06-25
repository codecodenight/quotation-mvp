import { readFile, writeFile } from "node:fs/promises";

import type * as ExcelJSNamespace from "exceljs";

import type { ProductDetailsParam } from "./product-details-builder";
import { buildQuoteTableModel, type QuoteTableColumn, type QuoteTableModel } from "./quote-table-model";
import { getTemplate, type QuoteTemplateConfig } from "./quote-template-registry";

export { buildProductDetails, calcVolume, cleanMoq, formatDimension } from "./quote-table-model";

let excelJsModule: typeof ExcelJSNamespace | null = null;

function getExcelJS(): typeof ExcelJSNamespace {
  excelJsModule ??= require("exceljs/dist/exceljs.min.js") as typeof ExcelJSNamespace;
  return excelJsModule;
}

type SalePriceInput = {
  purchasePrice: string | number | { toString(): string };
  purchaseCurrency: string;
  saleCurrency: string;
  exchangeRate: string | number | { toString(): string } | null;
  profitMargin: string | number | { toString(): string };
};

export type QuoteWorkbookItem = {
  productId?: string;
  supplierOfferId?: string;
  imagePath?: string | null;
  priceFlag?: string | null;
  productName: string;
  category?: string | null;
  modelNo: string | null;
  factoryName: string;
  purchasePrice: string | number | { toString(): string };
  purchaseCurrency: string;
  salePrice: string | number | { toString(): string };
  quantity: number;
  moq: string | null;
  ctnQty: string | null;
  ctnLength: string | null;
  ctnWidth: string | null;
  ctnHeight: string | null;
  material: string | null;
  size: string | null;
  productRemark: string | null;
  productParams?: ProductDetailsParam[];
  remark: string | null;
};

export type QuoteWorkbookData = {
  id: string;
  customerName: string;
  currency: string;
  profitMargin: string | number | { toString(): string };
  exchangeRate: string | number | { toString(): string } | null;
  createdAt: Date;
  items: QuoteWorkbookItem[];
};

export type QuoteWorkbookOptions = {
  customerMode?: boolean;
};

export function calculateSalePrice(input: SalePriceInput): string {
  const purchasePrice = readPositiveNumber(input.purchasePrice, "采购价必须大于 0");
  const profitMargin = readNonNegativeNumber(input.profitMargin, "利润率不能小于 0");
  const sameCurrency = normalizeCurrency(input.purchaseCurrency) === normalizeCurrency(input.saleCurrency);

  let currencyFactor = 1;
  if (!sameCurrency) {
    if (input.exchangeRate === null) {
      throw new Error("汇率不能为空");
    }
    const exchangeRate = readPositiveNumber(input.exchangeRate, "汇率必须大于 0");
    currencyFactor = 1 / exchangeRate;
  }

  return (purchasePrice * currencyFactor * (1 + profitMargin)).toFixed(2);
}

export async function writeQuoteWorkbook(
  quote: QuoteWorkbookData,
  filePath: string,
  options: QuoteWorkbookOptions = {},
): Promise<void> {
  const customerMode = options.customerMode ?? true;
  const model = buildQuoteTableModel(quote, { customerMode });
  const categoryTemplate = findCategoryTemplate(quote);
  if (categoryTemplate) {
    await writeTemplatedQuoteWorkbook(model, filePath, categoryTemplate);
    return;
  }

  const columns = model.columns;
  const lastColumnLetter = columnLetter(columns.length);
  const salePriceColumnIndex = columns.findIndex((column) => column.key === "salePrice") + 1;
  const cartonStartColumnIndex = columns.findIndex((column) => column.key === "ctnLength") + 1;

  const ExcelJS = getExcelJS();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "quotation-mvp";
  workbook.created = quote.createdAt;

  const sheet = workbook.addWorksheet("报价单", {
    views: [{ state: "frozen", ySplit: 7, topLeftCell: "A8" }],
    pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  sheet.columns = columns.map(({ key, width }) => ({ key, width }));

  sheet.mergeCells(`A1:${lastColumnLetter}1`);
  sheet.getCell("A1").value = "报价单";
  sheet.getCell("A1").font = { bold: true, size: 18, color: { argb: "FF2D2A24" } };
  sheet.getCell("A1").alignment = { horizontal: "center", vertical: "middle" };
  sheet.getRow(1).height = 28;

  sheet.getCell("A3").value = "客户";
  sheet.getCell("B3").value = model.meta.customerName;
  sheet.getCell("D3").value = "报价币种";
  sheet.getCell("E3").value = model.meta.currency;
  sheet.getCell("G3").value = "报价日期";
  sheet.getCell("H3").value = model.meta.createdAt;
  sheet.getCell("H3").numFmt = "yyyy-mm-dd";

  sheet.getCell("A4").value = "利润率";
  sheet.getCell("B4").value = model.meta.profitMargin;
  sheet.getCell("B4").numFmt = "0.00%";
  sheet.getCell("D4").value = `汇率（1 ${model.meta.currency} = ? ${model.meta.purchaseCurrency}）`;
  sheet.getCell("E4").value = model.meta.exchangeRate === null ? "-" : model.meta.exchangeRate;

  writeHeaderRows(sheet, columns, cartonStartColumnIndex);
  sheet.getRow(6).height = 22;
  sheet.getRow(7).height = 22;

  model.rows.forEach((modelRow, index) => {
    const row = sheet.getRow(8 + index);
    row.values = columns.map((column) => getExcelCellValue(modelRow, column));
    row.height = 54;
    if (salePriceColumnIndex > 0) {
      row.getCell(salePriceColumnIndex).numFmt =
        columns[salePriceColumnIndex - 1].numFmt ?? `#,##0.00 "${model.meta.currency}"`;
    }
  });

  const lastRow = Math.max(8, 7 + model.rows.length);
  for (let rowNumber = 6; rowNumber <= lastRow; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.border = thinBorder();
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    });
  }

  sheet.getRow(6).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF3F4A35" } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  });

  for (let columnNumber = cartonStartColumnIndex; columnNumber <= cartonStartColumnIndex + 3; columnNumber += 1) {
    const cell = sheet.getRow(7).getCell(columnNumber);
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF6B7A5A" } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  }

  ["A3", "D3", "G3", "A4", "D4"].forEach((address) => {
    const cell = sheet.getCell(address);
    cell.font = { bold: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFECE5D8" } };
    cell.alignment = { vertical: "middle", wrapText: true };
  });

  sheet.autoFilter = {
    from: "A7",
    to: `${lastColumnLetter}7`,
  };

  await embedProductImages(workbook, sheet, model, columns, 8);
  await saveWorkbook(workbook, filePath);
}

async function writeTemplatedQuoteWorkbook(
  model: QuoteTableModel,
  filePath: string,
  template: QuoteTemplateConfig,
): Promise<void> {
  const ExcelJS = getExcelJS();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "quotation-mvp";
  workbook.created = model.meta.createdAt;

  const columns = model.columns;
  const lastColumnLetter = columnLetter(columns.length);
  const salePriceColumnIndex = columns.findIndex((column) => column.key === "salePrice") + 1;
  const sheet = workbook.addWorksheet(template.sheetName, {
    views: [{ state: "frozen", ySplit: 1, topLeftCell: "A2" }],
    pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  sheet.columns = columns.map(({ key, width }) => ({ key, width }));

  writeTemplateHeaderRow(sheet, columns);

  model.rows.forEach((modelRow, index) => {
    const row = sheet.getRow(2 + index);
    row.values = columns.map((column) => getExcelCellValue(modelRow, column));
    applyDataRowStyle(row, salePriceColumnIndex, columns[salePriceColumnIndex - 1]?.numFmt, hasImage(modelRow));
  });

  sheet.autoFilter = {
    from: "A1",
    to: `${lastColumnLetter}1`,
  };

  await embedProductImages(workbook, sheet, model, columns, 2);
  await saveWorkbook(workbook, filePath);
}

async function saveWorkbook(workbook: ExcelJSNamespace.Workbook, filePath: string): Promise<void> {
  const buffer = await workbook.xlsx.writeBuffer();
  await writeFile(filePath, Buffer.from(buffer));
}

function getExcelCellValue(row: QuoteTableModel["rows"][number], column: QuoteTableColumn): string | number {
  if (column.key === "image") {
    return "";
  }
  return row.cells[column.key] ?? "";
}

async function embedProductImages(
  workbook: ExcelJSNamespace.Workbook,
  sheet: ExcelJSNamespace.Worksheet,
  model: QuoteTableModel,
  columns: QuoteTableColumn[],
  dataStartRow: number,
): Promise<void> {
  const imageColumnIndex = columns.findIndex((column) => column.key === "image");
  if (imageColumnIndex < 0) {
    return;
  }

  for (let index = 0; index < model.rows.length; index += 1) {
    const imagePath = model.rows[index].cells.image;
    if (typeof imagePath !== "string" || imagePath.trim().length === 0) {
      continue;
    }

    try {
      const buffer = await readFile(imagePath);
      const imageId = workbook.addImage({
        buffer: buffer as unknown as ArrayBuffer,
        extension: imageExtensionFromPath(imagePath),
      });
      sheet.addImage(imageId, {
        tl: { col: imageColumnIndex, row: dataStartRow + index - 1 },
        ext: { width: 60, height: 60 },
      });
    } catch {
      // Missing or unreadable product images should leave a blank photo cell, not block export.
    }
  }
}

function hasImage(row: QuoteTableModel["rows"][number]): boolean {
  const value = row.cells.image;
  return typeof value === "string" && value.trim().length > 0;
}

function imageExtensionFromPath(filePath: string): ExcelJSNamespace.Image["extension"] {
  const normalized = filePath.toLowerCase();
  if (normalized.endsWith(".png")) {
    return "png";
  }
  if (normalized.endsWith(".gif")) {
    return "gif";
  }
  return "jpeg";
}

function writeTemplateHeaderRow(sheet: ExcelJSNamespace.Worksheet, columns: QuoteTableColumn[]): void {
  sheet.getRow(1).height = 24;
  columns.forEach((column, index) => {
    const cell = sheet.getRow(1).getCell(index + 1);
    cell.value = column.header;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF3F4A35" } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = thinBorder();
  });
}

function applyDataRowStyle(
  row: ExcelJSNamespace.Row,
  priceColumnIndex: number,
  priceNumFmt?: string,
  containsImage = false,
): void {
  row.height = containsImage ? 54 : 22;
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = thinBorder();
  });
  if (priceColumnIndex > 0) {
    row.getCell(priceColumnIndex).numFmt = priceNumFmt ?? '#,##0.00 "USD"';
  }
}

function findCategoryTemplate(quote: QuoteWorkbookData): QuoteTemplateConfig | null {
  const itemCategories = quote.items.map((item) => item.category?.trim() ?? "");
  if (itemCategories.length === 0 || itemCategories.some((category) => !category)) {
    return null;
  }

  const categories = new Set(itemCategories);
  if (categories.size !== 1) {
    return null;
  }

  return getTemplate(Array.from(categories)[0]);
}

function writeHeaderRows(
  sheet: ExcelJSNamespace.Worksheet,
  columns: QuoteTableColumn[],
  cartonStartColumnIndex: number,
): void {
  const lastColumnIndex = columns.length;
  const cartonEndColumnIndex = cartonStartColumnIndex + 3;

  for (let columnNumber = 1; columnNumber <= lastColumnIndex; columnNumber += 1) {
    const key = columns[columnNumber - 1].key;
    const header = columns[columnNumber - 1].header;

    if (columnNumber < cartonStartColumnIndex || columnNumber > cartonEndColumnIndex) {
      sheet.mergeCells(6, columnNumber, 7, columnNumber);
      sheet.getRow(6).getCell(columnNumber).value = header;
      continue;
    }

    sheet.getRow(7).getCell(columnNumber).value = header;
  }

  sheet.mergeCells(6, cartonStartColumnIndex, 6, cartonEndColumnIndex);
  sheet.getRow(6).getCell(cartonStartColumnIndex).value = "Carton Size";
}

function columnLetter(columnCount: number): string {
  let value = "";
  let current = columnCount;

  while (current > 0) {
    const remainder = (current - 1) % 26;
    value = String.fromCharCode(65 + remainder) + value;
    current = Math.floor((current - 1) / 26);
  }

  return value;
}

function readPositiveNumber(value: string | number | { toString(): string }, message: string): number {
  const parsed = Number(value.toString());
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(message);
  }
  return parsed;
}

function readNonNegativeNumber(value: string | number | { toString(): string }, message: string): number {
  const parsed = Number(value.toString());
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(message);
  }
  return parsed;
}

function normalizeCurrency(value: string): string {
  return value.trim().toUpperCase();
}

function thinBorder(): Partial<ExcelJSNamespace.Borders> {
  return {
    top: { style: "thin", color: { argb: "FFD8D1C2" } },
    left: { style: "thin", color: { argb: "FFD8D1C2" } },
    bottom: { style: "thin", color: { argb: "FFD8D1C2" } },
    right: { style: "thin", color: { argb: "FFD8D1C2" } },
  };
}
