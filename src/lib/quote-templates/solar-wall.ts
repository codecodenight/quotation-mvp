import type { QuoteTemplateConfig } from "../quote-templates";
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

export const solarWallTemplate: QuoteTemplateConfig = {
  category: "太阳能壁灯",
  sheetName: "Solar Wall Light",
  columns: [
    { header: "No.", key: "no", width: 8 },
    { header: "Model No.", key: "modelNo", width: 18 },
    { header: "Power", key: "power", width: 12 },
    { header: "Material", key: "material", width: 18 },
    { header: "CCT", key: "cct", width: 16 },
    { header: "CRI", key: "cri", width: 10 },
    { header: "IP", key: "ip", width: 10 },
    { header: "Lumens", key: "lumens", width: 12 },
    { header: "Sensor", key: "sensor", width: 14 },
    { header: "FOB Price (USD)", key: "salePrice", width: 16 },
    { header: "MOQ (PCS)", key: "moq", width: 12 },
    { header: "CTN QTY", key: "ctnQty", width: 12 },
    { header: "CTN Size (cm)", key: "ctnSize", width: 18 },
    { header: "Packing Volume (m³)", key: "volume", width: 18 },
  ],
  writeHeader: (ws) => writeHeader(ws, solarWallTemplate),
  buildRowCells: (item, index) => buildRowCellsFromValues(solarWallTemplate.columns, [
      index + 1,
      item.modelNo ?? item.productName,
      appendSuffix(readParam(item, "watts"), "W"),
      readParam(item, "material") || item.material || "",
      formatCct(readParam(item, "cct")),
      prefixValue(readParam(item, "cri"), "Ra"),
      prefixValue(readParam(item, "ip"), "IP"),
      appendSuffix(readParam(item, "lumens"), "lm"),
      readParam(item, "sensor"),
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
      readParam(item, "material") || item.material || "",
      formatCct(readParam(item, "cct")),
      prefixValue(readParam(item, "cri"), "Ra"),
      prefixValue(readParam(item, "ip"), "IP"),
      appendSuffix(readParam(item, "lumens"), "lm"),
      readParam(item, "sensor"),
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
    row.getCell(10).numFmt = '#,##0.00 "USD"';
  },
};
