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

export const floodlightTemplate: QuoteTemplateConfig = {
  category: "投光灯",
  sheetName: "LED Floodlight",
  columns: [
    { header: "No.", key: "no", width: 8 },
    { header: "Model No.", key: "modelNo", width: 18 },
    { header: "Power", key: "power", width: 12 },
    { header: "Size (mm)", key: "size", width: 18 },
    { header: "Material", key: "material", width: 18 },
    { header: "CCT", key: "cct", width: 14 },
    { header: "CRI", key: "cri", width: 10 },
    { header: "PF", key: "pf", width: 10 },
    { header: "Voltage", key: "voltage", width: 16 },
    { header: "Driver", key: "driver", width: 16 },
    { header: "IP", key: "ip", width: 10 },
    { header: "Beam Angle", key: "beamAngle", width: 14 },
    { header: "FOB Price (USD)", key: "salePrice", width: 16 },
    { header: "MOQ (PCS)", key: "moq", width: 12 },
    { header: "CTN QTY", key: "ctnQty", width: 12 },
    { header: "CTN Size (cm)", key: "ctnSize", width: 18 },
    { header: "Packing Volume (m³)", key: "volume", width: 18 },
  ],
  writeHeader: (ws) => writeHeader(ws, floodlightTemplate),
  buildRowCells: (item, index) => buildRowCellsFromValues(floodlightTemplate.columns, [
      index + 1,
      item.modelNo ?? item.productName,
      appendSuffix(readParam(item, "watts"), "W"),
      readSize(item),
      readParam(item, "material") || item.material || "",
      formatCct(readParam(item, "cct")),
      prefixValue(readParam(item, "cri"), "Ra"),
      readParam(item, "pf"),
      appendSuffix(readParam(item, "voltage"), "V"),
      readParam(item, "driver_type"),
      prefixValue(readParam(item, "ip"), "IP"),
      appendSuffix(readParam(item, "beam_angle"), "°"),
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
      readSize(item),
      readParam(item, "material") || item.material || "",
      formatCct(readParam(item, "cct")),
      prefixValue(readParam(item, "cri"), "Ra"),
      readParam(item, "pf"),
      appendSuffix(readParam(item, "voltage"), "V"),
      readParam(item, "driver_type"),
      prefixValue(readParam(item, "ip"), "IP"),
      appendSuffix(readParam(item, "beam_angle"), "°"),
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
    row.getCell(13).numFmt = '#,##0.00 "USD"';
  },
};

function readSize(item: QuoteTemplateItem): string {
  const explicit = readParam(item, "size_display");
  return explicit ? stripTrailingUnit(explicit, "mm") : item.size ?? "";
}

function stripTrailingUnit(value: string, unit: string): string {
  return value.replace(new RegExp(`\\s*${unit}\\s*$`, "i"), "").trim();
}
