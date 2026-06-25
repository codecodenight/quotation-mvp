import type { QuoteTemplateConfig } from "../quote-template-registry";
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

export const stripTemplate: QuoteTemplateConfig = {
  category: "灯带",
  sheetName: "LED Strips",
  columns: [
    { header: "No.", key: "no", width: 8 },
    { header: "Model No.", key: "modelNo", width: 18 },
    { header: "W/m", key: "wattsPerMeter", width: 12 },
    { header: "Voltage", key: "voltage", width: 16 },
    { header: "LED Chip", key: "ledChip", width: 14 },
    { header: "LEDs/m", key: "ledsPerMeter", width: 12 },
    { header: "CCT", key: "cct", width: 16 },
    { header: "CRI", key: "cri", width: 10 },
    { header: "IP", key: "ip", width: 10 },
    { header: "PCB Width", key: "pcbWidth", width: 12 },
    { header: "FOB Price (USD/m)", key: "salePrice", width: 18 },
    { header: "MOQ (m)", key: "moq", width: 12 },
    { header: "CTN QTY", key: "ctnQty", width: 12 },
    { header: "CTN Size (cm)", key: "ctnSize", width: 18 },
    { header: "Packing Volume (m³)", key: "volume", width: 18 },
  ],
  writeHeader: (ws) => writeHeader(ws, stripTemplate),
  buildRowCells: (item, index) => buildRowCellsFromValues(stripTemplate.columns, [
      index + 1,
      item.modelNo ?? item.productName,
      readParam(item, "watts"),
      appendSuffix(readParam(item, "voltage"), "V"),
      readParam(item, "led_type"),
      readParam(item, "leds_per_meter") || readParam(item, "led_count"),
      formatCct(readParam(item, "cct")),
      prefixValue(readParam(item, "cri"), "Ra"),
      prefixValue(readParam(item, "ip"), "IP"),
      appendSuffix(readParam(item, "width_mm"), "mm"),
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
      readParam(item, "watts"),
      appendSuffix(readParam(item, "voltage"), "V"),
      readParam(item, "led_type"),
      readParam(item, "leds_per_meter") || readParam(item, "led_count"),
      formatCct(readParam(item, "cct")),
      prefixValue(readParam(item, "cri"), "Ra"),
      prefixValue(readParam(item, "ip"), "IP"),
      appendSuffix(readParam(item, "width_mm"), "mm"),
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
