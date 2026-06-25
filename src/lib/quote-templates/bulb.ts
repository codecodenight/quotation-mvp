import type { QuoteTemplateConfig, QuoteTemplateItem } from "../quote-templates";
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

export const bulbTemplate: QuoteTemplateConfig = {
  category: "球泡",
  sheetName: "LED Bulb",
  columns: [
    { header: "No.", key: "no", width: 8 },
    { header: "Model No.", key: "modelNo", width: 18 },
    { header: "Power", key: "power", width: 12 },
    { header: "Base", key: "base", width: 12 },
    { header: "Shape", key: "shape", width: 12 },
    { header: "CCT", key: "cct", width: 14 },
    { header: "CRI", key: "cri", width: 10 },
    { header: "PF", key: "pf", width: 10 },
    { header: "Voltage", key: "voltage", width: 16 },
    { header: "Driver", key: "driver", width: 16 },
    { header: "Luminous Efficacy", key: "luminousEfficacy", width: 18 },
    { header: "FOB Price (USD)", key: "salePrice", width: 16 },
    { header: "MOQ (PCS)", key: "moq", width: 12 },
    { header: "CTN QTY", key: "ctnQty", width: 12 },
    { header: "CTN Size (cm)", key: "ctnSize", width: 18 },
    { header: "Packing Volume (m³)", key: "volume", width: 18 },
  ],
  writeHeader: (ws) => writeHeader(ws, bulbTemplate),
  buildRowCells: (item, index) => buildRowCellsFromValues(bulbTemplate.columns, [
      index + 1,
      item.modelNo ?? item.productName,
      appendSuffix(readParam(item, "watts"), "W"),
      readParam(item, "base"),
      readBulbShape(item),
      formatCct(readParam(item, "cct")),
      prefixValue(readParam(item, "cri"), "Ra"),
      readParam(item, "pf"),
      appendSuffix(readParam(item, "voltage"), "V"),
      readParam(item, "driver_type"),
      appendSuffix(readParam(item, "luminous_efficacy"), "lm/W"),
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
      readParam(item, "base"),
      readBulbShape(item),
      formatCct(readParam(item, "cct")),
      prefixValue(readParam(item, "cri"), "Ra"),
      readParam(item, "pf"),
      appendSuffix(readParam(item, "voltage"), "V"),
      readParam(item, "driver_type"),
      appendSuffix(readParam(item, "luminous_efficacy"), "lm/W"),
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
    row.getCell(12).numFmt = '#,##0.00 "USD"';
  },
};

function readBulbShape(item: QuoteTemplateItem): string {
  const explicit = readParam(item, "shape");
  if (explicit) {
    return explicit;
  }

  const match = item.productName.match(/\b(?:A|T|C|G|ST|R|PAR|MR)\d{2,3}\b/i);
  return match ? match[0].toUpperCase() : "";
}
