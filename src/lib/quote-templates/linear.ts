import type { QuoteTemplateConfig, QuoteTemplateItem } from "../quote-template-registry";
import {
  buildRowCellsFromValues,
  appendSuffix,
  calcVolume,
  cleanMoq,
  formatCct,
  formatCtnSize,
  prefixValue,
  readParam,
  thinBorder,
  writeHeader,
} from "./helpers";

export const linearTemplate: QuoteTemplateConfig = {
  category: "线条灯",
  sheetName: "LED Linear Light",
  columns: [
    { header: "No.", key: "no", width: 8 },
    { header: "Model No.", key: "modelNo", width: 18 },
    { header: "Power", key: "power", width: 12 },
    { header: "Length (mm)", key: "length", width: 16 },
    { header: "Material", key: "material", width: 18 },
    { header: "CCT", key: "cct", width: 18 },
    { header: "CRI", key: "cri", width: 10 },
    { header: "PF", key: "pf", width: 10 },
    { header: "Voltage", key: "voltage", width: 16 },
    { header: "IP", key: "ip", width: 10 },
    { header: "FOB Price (USD)", key: "salePrice", width: 16 },
    { header: "MOQ (PCS)", key: "moq", width: 12 },
    { header: "CTN QTY", key: "ctnQty", width: 12 },
    { header: "CTN Size (cm)", key: "ctnSize", width: 18 },
    { header: "Packing Volume (m³)", key: "volume", width: 18 },
  ],
  writeHeader: (ws) => writeHeader(ws, linearTemplate),
  buildRowCells: (item, index) => buildRowCellsFromValues(linearTemplate.columns, [
      index + 1,
      item.modelNo ?? item.productName,
      appendSuffix(readParam(item, "watts"), "W"),
      readLength(item),
      readParam(item, "material") || item.material || "",
      formatCct(readParam(item, "cct")),
      prefixValue(readParam(item, "cri"), "Ra"),
      readParam(item, "pf"),
      appendSuffix(readParam(item, "voltage"), "V"),
      prefixValue(readParam(item, "ip"), "IP"),
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
      readLength(item),
      readParam(item, "material") || item.material || "",
      formatCct(readParam(item, "cct")),
      prefixValue(readParam(item, "cri"), "Ra"),
      readParam(item, "pf"),
      appendSuffix(readParam(item, "voltage"), "V"),
      prefixValue(readParam(item, "ip"), "IP"),
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
    row.getCell(11).numFmt = '#,##0.00 "USD"';
  },
};

function readLength(item: QuoteTemplateItem): string {
  const length = readParam(item, "length_mm") || readParam(item, "size_display");
  return length ? stripTrailingUnit(length, "mm") : item.size ?? "";
}

function stripTrailingUnit(value: string, unit: string): string {
  return value.replace(new RegExp(`\\s*${unit}\\s*$`, "i"), "").trim();
}
