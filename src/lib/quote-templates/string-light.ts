import type { QuoteTemplateConfig } from "../quote-templates";
import {
  buildRowCellsFromValues,
  appendSuffix,
  calcVolume,
  cleanMoq,
  formatCct,
  formatCtnSize,
  readParam,
  thinBorder,
  writeHeader,
} from "./helpers";

export const stringLightTemplate: QuoteTemplateConfig = {
  category: "皮线灯",
  sheetName: "LED String Light",
  columns: [
    { header: "No.", key: "no", width: 8 },
    { header: "Model No.", key: "modelNo", width: 18 },
    { header: "Power", key: "power", width: 12 },
    { header: "CCT", key: "cct", width: 16 },
    { header: "Voltage", key: "voltage", width: 16 },
    { header: "Size (mm)", key: "size", width: 18 },
    { header: "Material", key: "material", width: 18 },
    { header: "FOB Price (USD)", key: "salePrice", width: 16 },
    { header: "MOQ (PCS)", key: "moq", width: 12 },
    { header: "CTN QTY", key: "ctnQty", width: 12 },
    { header: "CTN Size (cm)", key: "ctnSize", width: 18 },
    { header: "Packing Volume (m³)", key: "volume", width: 18 },
  ],
  writeHeader: (ws) => writeHeader(ws, stringLightTemplate),
  buildRowCells: (item, index) => buildRowCellsFromValues(stringLightTemplate.columns, [
      index + 1,
      item.modelNo ?? item.productName,
      appendSuffix(readParam(item, "watts"), "W"),
      formatCct(readParam(item, "cct")),
      appendSuffix(readParam(item, "voltage"), "V"),
      readParam(item, "size_display") || item.size || "",
      readParam(item, "material") || item.material || "",
      item.salePrice,
      cleanMoq(item.moq),
      item.ctnQty ?? "",
      formatCtnSize(item),
      calcVolume(item.ctnLength, item.ctnWidth, item.ctnHeight),

  ]),
  writeRow: (ws, rowIndex, item) => {
    const row = ws.getRow(rowIndex);
    row.values = [
      rowIndex - 1,
      item.modelNo ?? item.productName,
      appendSuffix(readParam(item, "watts"), "W"),
      formatCct(readParam(item, "cct")),
      appendSuffix(readParam(item, "voltage"), "V"),
      readParam(item, "size_display") || item.size || "",
      readParam(item, "material") || item.material || "",
      item.salePrice,
      cleanMoq(item.moq),
      item.ctnQty ?? "",
      formatCtnSize(item),
      calcVolume(item.ctnLength, item.ctnWidth, item.ctnHeight),
    ];
    row.height = 22;
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.border = thinBorder();
    });
    row.getCell(8).numFmt = '#,##0.00 "USD"';
  },
};
