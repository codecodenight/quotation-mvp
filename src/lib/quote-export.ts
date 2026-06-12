import ExcelJS from "exceljs";

import { buildProductDetailsFromParams, type ProductDetailsParam } from "./product-details-builder";

type SalePriceInput = {
  purchasePrice: string | number | { toString(): string };
  purchaseCurrency: string;
  saleCurrency: string;
  exchangeRate: string | number | { toString(): string } | null;
  profitMargin: string | number | { toString(): string };
};

export type QuoteWorkbookItem = {
  productName: string;
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
  const columns = buildQuoteColumns(customerMode);
  const lastColumnLetter = columnLetter(columns.length);
  const salePriceColumnIndex = columns.findIndex((column) => column.key === "salePrice") + 1;
  const cartonStartColumnIndex = columns.findIndex((column) => column.key === "ctnLength") + 1;

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
  sheet.getCell("B3").value = quote.customerName;
  sheet.getCell("D3").value = "报价币种";
  sheet.getCell("E3").value = quote.currency;
  sheet.getCell("G3").value = "报价日期";
  sheet.getCell("H3").value = quote.createdAt;
  sheet.getCell("H3").numFmt = "yyyy-mm-dd";

  sheet.getCell("A4").value = "利润率";
  sheet.getCell("B4").value = Number(readNonNegativeNumber(quote.profitMargin, "利润率不能小于 0"));
  sheet.getCell("B4").numFmt = "0.00%";
  sheet.getCell("D4").value = `汇率（1 ${quote.currency} = ? ${getPurchaseCurrencyLabel(quote.items)}）`;
  sheet.getCell("E4").value = quote.exchangeRate === null ? "-" : Number(quote.exchangeRate.toString());

  writeHeaderRows(sheet, columns, quote.currency, cartonStartColumnIndex);
  sheet.getRow(6).height = 22;
  sheet.getRow(7).height = 22;

  quote.items.forEach((item, index) => {
    const row = sheet.getRow(8 + index);
    row.values = columns.map((column) => readQuoteCellValue(column.key, item));
    row.height = 54;
    row.getCell(salePriceColumnIndex).numFmt = `#,##0.00 "${quote.currency}"`;
  });

  const lastRow = Math.max(8, 7 + quote.items.length);
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

  await workbook.xlsx.writeFile(filePath);
}

type QuoteColumnKey =
  | "modelNo"
  | "productDetails"
  | "factoryName"
  | "purchasePrice"
  | "salePrice"
  | "moq"
  | "ctnQty"
  | "ctnLength"
  | "ctnWidth"
  | "ctnHeight"
  | "ctnVolume"
  | "remark";

type QuoteColumn = {
  key: QuoteColumnKey;
  header: string;
  width: number;
};

function buildQuoteColumns(customerMode: boolean): QuoteColumn[] {
  const columns: QuoteColumn[] = [
    { key: "modelNo", header: "Model Name", width: 18 },
    { key: "productDetails", header: "Product Details", width: 48 },
  ];

  if (!customerMode) {
    columns.push(
      { key: "factoryName", header: "Factory Name", width: 18 },
      { key: "purchasePrice", header: "Purchase Price", width: 16 },
    );
  }

  columns.push(
    { key: "salePrice", header: "Unit Price (USD)", width: 16 },
    { key: "moq", header: "MOQ", width: 12 },
    { key: "ctnQty", header: "CTN Qty", width: 12 },
    { key: "ctnLength", header: "L", width: 10 },
    { key: "ctnWidth", header: "W", width: 10 },
    { key: "ctnHeight", header: "H", width: 10 },
    { key: "ctnVolume", header: "Volume", width: 14 },
    { key: "remark", header: "Remark", width: 24 },
  );

  return columns;
}

function readQuoteCellValue(key: QuoteColumnKey, item: QuoteWorkbookItem): string | number {
  switch (key) {
    case "modelNo":
      return item.modelNo ?? "";
    case "productDetails":
      return buildProductDetails(item);
    case "factoryName":
      return item.factoryName;
    case "purchasePrice":
      return `${Number(item.purchasePrice.toString()).toFixed(2)} ${item.purchaseCurrency}`;
    case "salePrice":
      return Number(item.salePrice.toString());
    case "moq":
      return cleanMoq(item.moq);
    case "ctnQty":
      return item.ctnQty ?? "";
    case "ctnLength":
      return formatDimension(item.ctnLength);
    case "ctnWidth":
      return formatDimension(item.ctnWidth);
    case "ctnHeight":
      return formatDimension(item.ctnHeight);
    case "ctnVolume":
      return calcVolume(item.ctnLength, item.ctnWidth, item.ctnHeight);
    case "remark":
      return item.remark ?? "";
  }
}

function writeHeaderRows(
  sheet: ExcelJS.Worksheet,
  columns: QuoteColumn[],
  currency: string,
  cartonStartColumnIndex: number,
): void {
  const lastColumnIndex = columns.length;
  const cartonEndColumnIndex = cartonStartColumnIndex + 3;

  for (let columnNumber = 1; columnNumber <= lastColumnIndex; columnNumber += 1) {
    const key = columns[columnNumber - 1].key;
    const header = key === "salePrice" ? `Unit Price (${currency})` : columns[columnNumber - 1].header;

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

export function buildProductDetails(item: QuoteWorkbookItem): string {
  if (item.productParams && item.productParams.length > 0) {
    const paramDetails = buildProductDetailsFromParams(item.productParams);
    if (paramDetails) {
      const size = item.size?.trim() ?? "";
      const hasSizeDisplay = item.productParams.some(
        (param) => param.paramKey === "size_display" && Boolean(param.normalizedValue?.trim()),
      );
      if (!hasSizeDisplay && size) {
        return `${paramDetails}\nSize: ${size}`;
      }
      return paramDetails;
    }
  }

  const remark = stripModelPrefix(item.productRemark?.trim() ?? "", item.modelNo);
  const productName = stripModelPrefix(item.productName?.trim() ?? "", item.modelNo);
  const size = item.size?.trim() ?? "";
  const details = remark || productName;

  if (details && size) {
    return `${details}\nSize: ${size}`;
  }
  if (details) {
    return details;
  }
  return size;
}

export function cleanMoq(raw: string | null): string {
  if (!raw) {
    return "";
  }

  const match = raw.match(/^[\d,]+/);
  return match ? match[0].replace(/,/g, "") : "";
}

function stripModelPrefix(text: string, modelNo: string | null): string {
  if (!text || !modelNo?.trim()) {
    return text;
  }

  const model = modelNo.trim();
  if (text.trim().toLowerCase() === model.toLowerCase()) {
    return "";
  }

  const pattern = new RegExp(`^${escapeRegExp(model)}(?:\\s*[/|,;:]\\s*|\\s+)`, "i");
  return text.replace(pattern, "").trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function formatDimension(value: string | null): string {
  if (!value) {
    return "";
  }
  return `${value} cm`;
}

export function calcVolume(length: string | null, width: string | null, height: string | null): string {
  if (!length || !width || !height) {
    return "";
  }

  const parsedLength = Number.parseFloat(length);
  const parsedWidth = Number.parseFloat(width);
  const parsedHeight = Number.parseFloat(height);
  if (!Number.isFinite(parsedLength) || !Number.isFinite(parsedWidth) || !Number.isFinite(parsedHeight)) {
    return "";
  }

  return `${((parsedLength * parsedWidth * parsedHeight) / 1_000_000).toFixed(3)} m³`;
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

function getPurchaseCurrencyLabel(items: QuoteWorkbookItem[]): string {
  const currencies = new Set(items.map((item) => normalizeCurrency(item.purchaseCurrency)).filter(Boolean));
  return currencies.size === 1 ? Array.from(currencies)[0] : "采购币种";
}

function thinBorder(): Partial<ExcelJS.Borders> {
  return {
    top: { style: "thin", color: { argb: "FFD8D1C2" } },
    left: { style: "thin", color: { argb: "FFD8D1C2" } },
    bottom: { style: "thin", color: { argb: "FFD8D1C2" } },
    right: { style: "thin", color: { argb: "FFD8D1C2" } },
  };
}
