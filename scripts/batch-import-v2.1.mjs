import fs from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import * as XLSX from "xlsx";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const ROOT_A = "/Volumes/My Passport/AI 报价/发客户报价单汇总";
const ROOT_B = "/Volumes/My Passport/AI 报价/各家工厂最新报价汇总";
const PART_A_REPORT = "docs/v2.1-step0-scan-report.md";
const PART_B_REPORT = "docs/v2.1-second-dir-scan-report.md";
const RESULT_REPORT = "docs/v2.1-batch-import-result.md";
const DRY_RUN_REPORT = "docs/v2.1-batch-import-dry-run.md";

const mode = process.argv.includes("--apply") ? "apply" : "dry-run";
const now = new Date();
const priceUpdatedAtIso = now.toISOString();

const partATasks = [
  taskA("大面板灯", "核价LED Big Panel Quotation - Welfull -20240426.xlsx", "LED Slim Panel"),
  taskA("防潮灯", "核价 弘跃款 LED Bulkhead(LB-D) Quotation - Wellux - 20240506.xlsx", "LB-D 100-265V"),
  taskA("净化灯", "核价- LINEAR LUMINAIRE - WELLUX 20241107.xls", "臻森常规款汇总"),
  taskA("净化灯", "核价- LINEAR LUMINAIRE - WELLUX 20241107.xls", "南非热销款"),
  taskA("镜前灯", "NEW~ CE LED Mirror Light - Welfull 20250819_RMB.xlsx", "Plastic LED Mirror Light"),
  taskA("镜前灯", "NEW~ CE LED Mirror Light - Welfull 20250819_RMB.xlsx", "Metal LED Mirror Light "),
  taskA("路灯", "To Anas - LED Street Lamp - Wellux 202305.xlsx", "LS-A  "),
  taskA("路灯", "To Anas - LED Street Lamp - Wellux 202305.xlsx", "LS-D "),
  taskA("路灯", "To Anas - LED Street Lamp - Wellux 202305.xlsx", "LS-C "),
  taskA("路灯", "To Anas - LED Street Lamp - Wellux 202305.xlsx", "LS-E"),
  taskA("台灯", "核算-发价格敏感客户Table lamp - Wellux Lighting 20250423.xlsx", "Decorative table lamp"),
  taskA("筒灯", "核价 汇总所有筒灯报价 LED Spotlight Quotation -  Wellux - 202308 - 副本.xlsx", "LD-B CCT "),
  taskA("筒灯", "核价 汇总所有筒灯报价 LED Spotlight Quotation -  Wellux - 202308 - 副本.xlsx", "LD-B High end "),
  taskA("筒灯", "核价 汇总所有筒灯报价 LED Spotlight Quotation -  Wellux - 202308 - 副本.xlsx", "LD-B2 Middle end"),
  taskA("筒灯", "核价 汇总所有筒灯报价 LED Spotlight Quotation -  Wellux - 202308 - 副本.xlsx", "LD-C UGR"),
  taskA("筒灯", "核价 汇总所有筒灯报价 LED Spotlight Quotation -  Wellux - 202308 - 副本.xlsx", "LD-C2 UGR"),
  taskA("筒灯", "核价 汇总所有筒灯报价 LED Spotlight Quotation -  Wellux - 202308 - 副本.xlsx", "LD-G"),
  taskA("筒灯", "核价 汇总所有筒灯报价 LED Spotlight Quotation -  Wellux - 202308 - 副本.xlsx", "LD-H UGR"),
  taskA("筒灯", "核价 汇总所有筒灯报价 LED Spotlight Quotation -  Wellux - 202308 - 副本.xlsx", "LD-I"),
  taskA("投光灯", "核价绿晟 F22 To HTF - Eco LED Floodlight LF-I - Wellux - 20251024.xls", "LF-I "),
  taskA("投光灯", "To Anas - LED Floodlight - Wellux - 202305.xls", "LF-I"),
  taskA("投光灯", "To Anas - LED Floodlight - Wellux - 202305.xls", "LF- L"),
  taskA("投光灯", "To Anas - LED Floodlight - Wellux - 202305.xls", "LF-J"),
  taskA("投光灯", "To Anas - LED Floodlight - Wellux - 202305.xls", "LF-G"),
  taskA("五面办公灯", "办公灯 quotation of  led linear fixture 2022.7.7 名威 价格更新.xls", "sheet1"),
  taskA("吸顶灯", "核价To HTF - LED Ceiling Light - LC-H - Wellux 20250305.xlsx", "Sheet 1"),
  taskA("吸顶灯", "核价 非标配置 LED Ceiling Lamp - Wellux - 20241112.xls", "Sheet1"),
  taskA("吸顶灯", "核价 非标配置 LED Ceiling Lamp - Wellux - 20241112.xls", "CELING LAMP以这个为准"),
  taskA("吸顶灯", "核价LED Ceiling Lamp - Wellux - 20230502.xls", "LC-E"),
  taskA("吸顶灯", "核价LED Ceiling Lamp - Wellux - 20230502.xls", "LC-F"),
  taskA("吸顶灯", "核价LED Ceiling Lamp - Wellux - 20230502.xls", "LC-J"),
  taskA("吸顶灯", "稣赐花灯核价 LED Ceiling Price - Wellux 20240314.xlsx", "给DENI报价"),
  taskA("吸顶灯", "稣赐花灯核价 LED Ceiling Price - Wellux 20240314.xlsx", "广交会4月更新"),
  taskA("Highbay", "核价LED Highbay - Wellux - 20230506 - 副本.xls", "汇总 隆景所有的款"),
];

const partBTasks = [
  taskB("壁灯", "户外照明 工业照明/市电壁灯", "稣赐-壁灯广交会款询价单 20230406.xls", "第1页", {
    headerRowIndexOverride: 2,
    modelFallbackColumns: [2, 3, 5],
  }),
  taskB("橱柜灯", "室内照明/LED橱柜灯/暖光天启", "天启智能2024产品目录报价24.5.13.xlsx1.xlsx", null, {
    expandAllSheets: true,
  }),
  taskB("灯管", "光源/球泡灯管/合力/202504", "ERP F级&E级 T8 TUBE 更新 -2025.3.25.xlsx", null),
  taskB("灯丝灯", "光源/灯丝灯/德雷普/工厂报价", "伊凡格灵LED灯丝灯泡报价2025.xls", null),
  taskB("庭院灯", "户外照明 工业照明/户外工厂/艾轩/202404 艾轩", "荣耀庭院灯AX-FB-TYD garden light 20240316.xls", null),
  taskB("应急灯", "室内照明/应急灯/应急指示灯", "三越三千高端产品报价标20240423.xls", null),
  taskB("地插灯/太阳能壁灯", "户外照明 工业照明/太阳能壁灯草坪灯地插灯/太阳能壁灯草坪灯/欣益进", "NEW太阳能报价单2024 0719.xls", null),
  taskB("轨道灯", "室内照明/轨道灯/开启/开启目录和报价", "3.Kyqee Track light（CNY).xls", null),
];

let partBSectionsCache = null;

function taskA(category, fileName, sheetName) {
  return { part: "A", root: ROOT_A, category, fileName, sheetName };
}

function taskB(category, folder, fileName, sheetName, options = {}) {
  return { part: "B", root: ROOT_B, category, folder, fileName, sheetName, ...options };
}

function clean(value) {
  return String(value ?? "")
    .normalize("NFC")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactKey(value) {
  return clean(value).replace(/\s+/g, "").toLowerCase();
}

function colLetter(index) {
  if (index === null || index === undefined) return "?";
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function colIndexFromLetter(letter) {
  let n = 0;
  for (const char of clean(letter).toUpperCase()) {
    if (char < "A" || char > "Z") continue;
    n = n * 26 + char.charCodeAt(0) - 64;
  }
  return n > 0 ? n - 1 : null;
}

function parsePrice(value) {
  const text = clean(value)
    .replace(/^\s*[\$¥￥]\s*/, "")
    .replace(/\s*(USD|RMB|CNY|元)\s*$/i, "")
    .replace(/,/g, "")
    .trim();
  if (!text || text === "/" || text === "-") return null;
  const match = text.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const n = Number(match[0]);
  return Number.isFinite(n) && n > 0 ? match[0] : null;
}

function cleanIntegerText(value) {
  const text = clean(value);
  if (!text) return null;
  const match = text.match(/^[\d,]+/);
  return match ? match[0].replace(/,/g, "") : null;
}

function cleanDimensionText(value) {
  const match = clean(value).replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  return match ? match[0] : null;
}

function parseCtnSize(value) {
  const raw = clean(value);
  if (!raw) return { length: null, width: null, height: null };
  const parts = raw.replace(/\s*(cm|厘米|mm)\s*$/i, "").split(/\s*[×xX*]\s*/).map(cleanDimensionText);
  if (parts.length !== 3 || parts.some((part) => !part)) {
    return { length: null, width: null, height: null };
  }
  return { length: parts[0], width: parts[1], height: parts[2] };
}

function headerAt(rows, headerRowIndex, columnIndex) {
  if (columnIndex === null || columnIndex === undefined) return "";
  return clean(rows[headerRowIndex - 1]?.[columnIndex]);
}

function cellAt(row, columnIndex) {
  if (columnIndex === null || columnIndex === undefined) return null;
  const value = clean(row[columnIndex]);
  return value || null;
}

function buildModelFallback(row, task, rowIndex) {
  if (!task.modelFallbackColumns?.length) return null;
  const parts = task.modelFallbackColumns.map((columnIndex) => cellAt(row, columnIndex)).filter(Boolean);
  if (parts.length === 0) return null;
  return `${task.category}-${parts.join("-")}-${rowIndex}`.replace(/\s+/g, " ").trim();
}

function isEmptyRow(row) {
  return row.every((cell) => clean(cell) === "");
}

function isPhotoHeader(header) {
  return /photo|picture|image|图片|照片|图\s*片|产品图片/i.test(clean(header));
}

function isNoHeader(header) {
  return /^(no\.?|序号|序\s*号)$/i.test(clean(header));
}

function sanitizeDescriptionColumns(columns, rows, headerRowIndex) {
  return [...new Set(columns ?? [])].filter((columnIndex) => {
    const header = headerAt(rows, headerRowIndex, columnIndex);
    return header && !isPhotoHeader(header) && !isNoHeader(header);
  });
}

function mergeDescription(row, rows, headerRowIndex, columns) {
  const parts = [];
  for (const columnIndex of columns) {
    const value = cellAt(row, columnIndex);
    if (!value) continue;
    const label = headerAt(rows, headerRowIndex, columnIndex) || `列 ${columnIndex + 1}`;
    parts.push(`${label}: ${value}`);
  }
  return parts.length ? parts.join("\n") : null;
}

function readRows(filePath, sheetName) {
  const workbook = XLSX.read(readFileSync(filePath), { type: "buffer", cellDates: false, raw: false });
  const actualSheetName = workbook.SheetNames.find((name) => clean(name) === clean(sheetName)) ?? sheetName;
  const sheet = workbook.Sheets[actualSheetName];
  if (!sheet) {
    throw new Error(`找不到 sheet: ${sheetName}`);
  }
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });
  return { rows: rows.map((row) => row.map(clean)), actualSheetName, sheetNames: workbook.SheetNames };
}

async function walkExcel(root) {
  const files = [];
  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name).normalize("NFC");
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && /\.(xlsx|xls)$/i.test(entry.name) && !entry.name.startsWith("._")) {
        files.push(full);
      }
    }
  }
  await walk(root);
  return files;
}

const excelFilesByRoot = new Map();

async function locateFile(task) {
  if (task.folder) {
    const exact = path.join(task.root, task.folder, task.fileName).normalize("NFC");
    if (existsSync(exact)) return exact;
  }
  if (!excelFilesByRoot.has(task.root)) {
    excelFilesByRoot.set(task.root, await walkExcel(task.root));
  }
  const files = excelFilesByRoot.get(task.root);
  const target = compactKey(task.fileName);
  const found = files.find((filePath) => compactKey(path.basename(filePath)) === target);
  if (found) return found;
  const loose = files.find((filePath) => compactKey(path.basename(filePath)).includes(target) || target.includes(compactKey(path.basename(filePath))));
  if (loose) return loose;
  throw new Error(`找不到文件: ${task.fileName}`);
}

function parsePartAReport() {
  const text = readFileSync(PART_A_REPORT, "utf8");
  const sections = new Map();
  const blocks = text.split(/\n### /g);
  for (const rawBlock of blocks) {
    const block = rawBlock.startsWith("### ") ? rawBlock.slice(4) : rawBlock;
    const titleMatch = block.match(/^\[([^\]]+)] (.+?) — (.+?)\n/);
    if (!titleMatch) continue;
    const [, folder, fileName, sheetName] = titleMatch;
    const getNumber = (label) => {
      const match = block.match(new RegExp(`- ${label} → (\\d+) \\(`));
      return match ? Number(match[1]) : null;
    };
    const descMatch = block.match(/- descriptionColumns → \[([^\]]*)]/);
    const descriptionColumns = descMatch
      ? [...descMatch[1].matchAll(/(\d+) \(/g)].map((match) => Number(match[1]))
      : [];
    const headerMatch = block.match(/- 表头行：第 (\d+) 行/);
    sections.set(sectionKey(fileName, sheetName), {
      folder,
      fileName,
      sheetName,
      headerRowIndex: headerMatch ? Number(headerMatch[1]) : null,
      mapping: {
        modelNoColumn: getNumber("modelNoColumn"),
        factoryNameColumn: getNumber("factoryNameColumn"),
        factoryPriceColumn: getNumber("factoryPriceColumn"),
        descriptionColumns,
        sizeColumn: getNumber("sizeColumn"),
        moqColumn: getNumber("moqColumn"),
        ctnQtyColumn: getNumber("ctnQtyColumn"),
        ctnSizeColumn: getNumber("ctnSizeColumn"),
        ctnLengthColumn: getNumber("ctnLengthColumn"),
        ctnWidthColumn: getNumber("ctnWidthColumn"),
        ctnHeightColumn: getNumber("ctnHeightColumn"),
      },
    });
  }
  return sections;
}

function parsePartBReport() {
  const text = readFileSync(PART_B_REPORT, "utf8");
  const sections = new Map();
  const byFile = new Map();
  const blocks = text.split(/\n### /g);
  for (const rawBlock of blocks) {
    const block = rawBlock.startsWith("### ") ? rawBlock.slice(4) : rawBlock;
    const titleMatch = block.match(/^\[([^\]]+)] (.+?) — (.+?)\n/);
    if (!titleMatch) continue;
    const [, folder, fileName, sheetName] = titleMatch;
    const headerMatch = block.match(/- 表头行：第 (\d+) 行/);
    const mappingLine = block.match(/- 建议映射：(.+)/)?.[1] ?? "";
    const parsed = {
      folder,
      fileName,
      sheetName,
      headerRowIndex: headerMatch ? Number(headerMatch[1]) : null,
      mapping: parsePartBMappingLine(mappingLine),
    };
    sections.set(sectionKey(fileName, sheetName), parsed);
    const fileKey = compactKey(fileName);
    const list = byFile.get(fileKey) ?? [];
    list.push(parsed);
    byFile.set(fileKey, list);
  }
  return { sections, byFile };
}

function parsePartBMappingLine(line) {
  const readSingle = (name) => {
    const match = line.match(new RegExp(`${name}=([^;]+)`));
    if (!match) return null;
    const col = match[1].trim().match(/^([A-Z]+)/i)?.[1];
    return col ? colIndexFromLetter(col) : null;
  };
  const readDescription = () => {
    const match = line.match(/description=([^;]+)/);
    if (!match || /未找到/.test(match[1])) return [];
    return [...match[1].matchAll(/(?:^|\s)([A-Z]+):/g)].map((m) => colIndexFromLetter(m[1])).filter((v) => v !== null);
  };
  const carton = line.match(/carton=([^;]+)/)?.[1] ?? "";
  const direct = [...carton.matchAll(/\b([LWH])=([A-Z]+):/g)];
  const ctnLengthColumn = direct.find((m) => m[1] === "L")?.[2] ? colIndexFromLetter(direct.find((m) => m[1] === "L")[2]) : null;
  const ctnWidthColumn = direct.find((m) => m[1] === "W")?.[2] ? colIndexFromLetter(direct.find((m) => m[1] === "W")[2]) : null;
  const ctnHeightColumn = direct.find((m) => m[1] === "H")?.[2] ? colIndexFromLetter(direct.find((m) => m[1] === "H")[2]) : null;
  const ctnSizeColumn = direct.length > 0 ? null : readSingle("carton");
  const factoryNameColumn = /^factory=[A-Z]+:/i.test(line) ? readSingle("factory") : null;
  return {
    modelNoColumn: readSingle("modelNo"),
    factoryNameColumn,
    factoryPriceColumn: readSingle("price"),
    descriptionColumns: readDescription(),
    sizeColumn: readSingle("size"),
    moqColumn: readSingle("moq"),
    ctnQtyColumn: readSingle("ctnQty"),
    ctnSizeColumn,
    ctnLengthColumn,
    ctnWidthColumn,
    ctnHeightColumn,
  };
}

function sectionKey(fileName, sheetName) {
  return `${compactKey(fileName)}::${compactKey(sheetName)}`;
}

function detectHeaderRow(rows) {
  let best = { index: 0, score: -1 };
  for (let i = 0; i < Math.min(rows.length, 30); i += 1) {
    const row = rows[i] ?? [];
    const joined = row.map(clean).join(" ").toLowerCase();
    let score = 0;
    if (/item|model|型号|款号|货号|产品|编码|序号/.test(joined)) score += 3;
    if (/factory|supplier|工厂|供应商|厂家/.test(joined)) score += 2;
    if (/price|价格|单价|rmb|人民币|含税|不含税|成本|出厂|fob|usd|美金|美元|cny/.test(joined)) score += 4;
    if (/carton|ctn|箱规|装箱|外箱|package|packing|moq/.test(joined)) score += 2;
    score += Math.min(row.filter((value) => clean(value)).length, 12) / 3;
    if (score > best.score) best = { index: i, score };
  }
  return best.index + 1;
}

function buildColumns(rows, headerRowIndex) {
  const header = rows[headerRowIndex - 1] ?? [];
  const max = Math.max(...rows.map((row) => row.length), header.length, 0);
  return Array.from({ length: max }, (_, index) => ({ index, header: clean(header[index]) }));
}

function looksUsd(header) {
  const h = clean(header);
  return /usd/i.test(h) || /美金|美元/.test(h) || /fob(?!.*rmb)/i.test(h);
}

function looksRmb(header) {
  const h = clean(header);
  if (!h || looksUsd(h)) return false;
  return /rmb|cny|exw/i.test(h) || /人民币|含税|不含税|出厂|成本|核算|工厂.*价|采购价|进货价|拿货价|单价|价格/.test(h);
}

function findColumn(columns, tests) {
  for (const test of tests) {
    const found = columns.find((column) => test.test(column.header));
    if (found) return found.index;
  }
  return null;
}

function findAllColumns(columns, tests) {
  return columns.filter((column) => tests.some((test) => test.test(column.header))).map((column) => column.index);
}

function autoDetectMapping(rows, headerRowIndex) {
  const columns = buildColumns(rows, headerRowIndex);
  const rmbColumns = columns.filter((column) => looksRmb(column.header));
  return {
    modelNoColumn: findColumn(columns, [/item\s*no/i, /^item$/i, /model/i, /型号/, /款号/, /货号/, /产品.*编号/, /产品代号/, /编码/, /灯具型号/]),
    factoryNameColumn: findColumn(columns, [/^工厂$/, /工厂名/, /供应商/, /厂家/, /^factory$/i, /^supplier$/i, /^vendor$/i]),
    factoryPriceColumn: rmbColumns[0]?.index ?? null,
    descriptionColumns: findAllColumns(columns, [
      /description/i,
      /details/i,
      /spec/i,
      /power|watt/i,
      /voltage/i,
      /cct/i,
      /lumen|flux/i,
      /material/i,
      /warranty/i,
      /参数/,
      /描述/,
      /功率/,
      /电压/,
      /色温/,
      /光通/,
      /材质/,
      /质保/,
      /工作模式/,
      /功能/,
      /配置/,
      /驱动/,
      /显指/,
      /光效/,
    ]).slice(0, 12),
    sizeColumn: findColumn(columns, [/^size$/i, /dimension/i, /尺寸/, /规格/, /product size/i]),
    moqColumn: findColumn(columns, [/moq/i, /起订/, /最小起订/]),
    ctnQtyColumn: findColumn(columns, [/ctn.*qty/i, /qty.*ctn/i, /pcs.*ctn/i, /装箱/, /每箱/, /外箱.*数量/, /case pack/i]),
    ctnSizeColumn: findColumn(columns, [/carton.*size/i, /ctn.*size/i, /outer.*box/i, /箱规/, /外箱.*尺寸/, /包装.*尺寸/, /纸箱.*尺寸/, /carton size/i]),
    ctnLengthColumn: findColumn(columns, [/^l$/i, /^length$/i, /ctn l/i, /carton.*l/i, /^长$/, /长度/]),
    ctnWidthColumn: findColumn(columns, [/^w$/i, /^width$/i, /ctn w/i, /carton.*w/i, /^宽$/, /宽度/]),
    ctnHeightColumn: findColumn(columns, [/^h$/i, /^height$/i, /ctn h/i, /carton.*h/i, /^高$/, /高度/]),
  };
}

function inferFactory(filePath, task) {
  const text = `${path.basename(filePath)} ${filePath}`.normalize("NFC");
  const preferred = [
    "伊凡格灵",
    "三越三千",
    "欣益进",
    "稣赐",
    "天启",
    "合力",
    "德雷普",
    "艾轩",
    "开启",
    "绿晟",
    "名威",
    "弘跃",
    "Welfull",
    "Wellux",
  ];
  for (const name of preferred) {
    if (text.toLowerCase().includes(name.toLowerCase())) return name;
  }
  if (task.folder) {
    const parts = task.folder.split("/").filter(Boolean);
    return parts[parts.length - 1] ?? task.category;
  }
  return task.category;
}

function buildRowsForTask({ task, fileId, filePath, rows, actualSheetName, mapping, headerRowIndex, factoryOverride }) {
  const descriptionColumns = sanitizeDescriptionColumns(mapping.descriptionColumns, rows, headerRowIndex);
  const out = [];
  const skippedRows = [];
  const productsInTask = new Set();
  let lastFactoryName = null;

  for (let i = headerRowIndex; i < rows.length; i += 1) {
    const row = rows[i];
    const rowIndex = i + 1;
    if (isEmptyRow(row)) continue;

    const modelNo = cellAt(row, mapping.modelNoColumn) ?? buildModelFallback(row, task, rowIndex);
    const mappedFactoryName = cellAt(row, mapping.factoryNameColumn);
    const factoryName = mappedFactoryName ?? lastFactoryName ?? factoryOverride;
    const price = parsePrice(cellAt(row, mapping.factoryPriceColumn));
    if (mappedFactoryName) lastFactoryName = mappedFactoryName;

    if (!modelNo) {
      skippedRows.push({ rowIndex, reason: "缺少产品款号" });
      continue;
    }
    if (!factoryName) {
      skippedRows.push({ rowIndex, reason: "缺少工厂名" });
      continue;
    }
    if (!price) {
      skippedRows.push({ rowIndex, reason: "价格列非有效数字" });
      continue;
    }

    const description = mergeDescription(row, rows, headerRowIndex, descriptionColumns);
    const ctnDimensions = readCtnDimensions(row, mapping);
    out.push({
      sourceFileId: fileId,
      filePath,
      part: task.part,
      category: task.category,
      sheetName: actualSheetName,
      modelNo,
      productName: modelNo,
      size: cellAt(row, mapping.sizeColumn),
      remark: description,
      factoryName,
      purchasePrice: price,
      currency: "RMB",
      moq: cellAt(row, mapping.moqColumn),
      ctnQty: cleanIntegerText(cellAt(row, mapping.ctnQtyColumn)),
      ctnLength: ctnDimensions.length,
      ctnWidth: ctnDimensions.width,
      ctnHeight: ctnDimensions.height,
      rowIndex,
      descriptionColumns,
    });
    productsInTask.add(modelNo);
  }

  return { rows: out, skippedRows, productCount: productsInTask.size };
}

function readCtnDimensions(row, mapping) {
  const direct = {
    length: cleanDimensionText(cellAt(row, mapping.ctnLengthColumn)),
    width: cleanDimensionText(cellAt(row, mapping.ctnWidthColumn)),
    height: cleanDimensionText(cellAt(row, mapping.ctnHeightColumn)),
  };
  if (direct.length && direct.width && direct.height) return direct;
  return parseCtnSize(cellAt(row, mapping.ctnSizeColumn));
}

async function ensureFileRecord(filePath, task, factoryGuess) {
  const existingByPath = await prisma.file.findFirst({ where: { absolutePathSnapshot: filePath } });
  if (existingByPath) return existingByPath;

  const stat = await fs.stat(filePath);
  const relativePath = path.relative(task.root, filePath).normalize("NFC");
  const data = {
    fileName: path.basename(filePath).normalize("NFC"),
    fileType: "excel",
    fileSize: BigInt(stat.size),
    folderName: task.category,
    factoryGuess,
    volumeName: "My Passport",
    relativePath,
    absolutePathSnapshot: filePath,
    modifiedAt: stat.mtime,
  };

  const existingByRelative = await prisma.file.findUnique({
    where: { volumeName_relativePath: { volumeName: data.volumeName, relativePath: data.relativePath } },
  });
  if (existingByRelative) return existingByRelative;
  return prisma.file.create({ data });
}

async function importRows(rows) {
  const result = {
    newProducts: 0,
    reusedProducts: 0,
    newOffers: 0,
    duplicateOffers: 0,
    errors: [],
  };
  const productCache = new Map();
  const offerSeen = new Set();

  await prisma.$transaction(async (tx) => {
    for (const row of rows) {
      let product = productCache.get(row.modelNo);
      if (!product) {
        product = await tx.product.findFirst({
          where: { modelNo: row.modelNo },
          orderBy: [{ createdAt: "asc" }],
        });
        if (product) {
          result.reusedProducts += 1;
        } else {
          product = await tx.product.create({
            data: {
              productName: row.productName,
              category: row.category,
              modelNo: row.modelNo,
              material: null,
              size: row.size,
              imagePath: null,
              remark: row.remark,
            },
          });
          result.newProducts += 1;
        }
        productCache.set(row.modelNo, product);
      }

      const duplicateKey = `${product.id}::${row.factoryName}`;
      if (offerSeen.has(duplicateKey)) {
        result.duplicateOffers += 1;
        continue;
      }
      offerSeen.add(duplicateKey);

      const existingOffer = await tx.supplierOffer.findFirst({
        where: { productId: product.id, factoryName: row.factoryName },
        select: { id: true },
      });
      if (existingOffer) {
        result.duplicateOffers += 1;
        continue;
      }

      await tx.$executeRaw`
        INSERT INTO supplier_offers (
          id,
          product_id,
          factory_name,
          purchase_price,
          currency,
          moq,
          ctn_qty,
          ctn_length,
          ctn_width,
          ctn_height,
          lead_time,
          source_file_id,
          remark,
          price_updated_at
        )
        VALUES (
          ${randomUUID()},
          ${product.id},
          ${row.factoryName},
          ${row.purchasePrice},
          ${row.currency},
          ${row.moq},
          ${row.ctnQty},
          ${row.ctnLength},
          ${row.ctnWidth},
          ${row.ctnHeight},
          ${null},
          ${row.sourceFileId},
          ${null},
          ${priceUpdatedAtIso}
        )
      `;
      result.newOffers += 1;
    }
  });

  return result;
}

async function buildPlanRows() {
  const partASections = parsePartAReport();
  const tasks = [...partATasks, ...expandPartBTasks()];
  const results = [];
  const allRows = [];

  for (const task of tasks) {
    const filePath = await locateFile(task);
    const { sheetNames } = XLSX.read(readFileSync(filePath), { type: "buffer", bookSheets: true });
    const selectedSheets = task.sheetName
      ? [task.sheetName]
      : sheetNames.filter((name) => !/summary|汇总目录/i.test(clean(name)));

    for (const sheetName of selectedSheets) {
      const { rows, actualSheetName } = readRows(filePath, sheetName);
      const fromReport = task.part === "A"
        ? partASections.get(sectionKey(path.basename(filePath), actualSheetName))
        : partBSectionsCache.sections.get(sectionKey(path.basename(filePath), actualSheetName));
      const headerRowIndex = task.headerRowIndexOverride ?? fromReport?.headerRowIndex ?? detectHeaderRow(rows);
      const autoMapping = autoDetectMapping(rows, headerRowIndex);
      const mapping = fromReport?.mapping
        ? { ...autoMapping, ...dropNullish(fromReport.mapping) }
        : autoMapping;
      const factoryOverride = inferFactory(filePath, task);
      const fileRecord = await ensureFileRecord(filePath, task, factoryOverride);
      const built = buildRowsForTask({
        task,
        fileId: fileRecord.id,
        filePath,
        rows,
        actualSheetName,
        mapping,
        headerRowIndex,
        factoryOverride,
      });

      results.push({
        part: task.part,
        file: path.basename(filePath),
        sheet: actualSheetName,
        category: task.category,
        factoryOverride,
        headerRowIndex,
        mapping,
        descriptionColumns: sanitizeDescriptionColumns(mapping.descriptionColumns, rows, headerRowIndex),
        plannedRows: built.rows.length,
        plannedProducts: built.productCount,
        skippedRows: built.skippedRows.length,
        errors: validateTaskMapping(mapping),
      });
      allRows.push(...built.rows);
    }
  }

  return { results, allRows };
}

function expandPartBTasks() {
  partBSectionsCache = parsePartBReport();
  return partBTasks.flatMap((task) => {
    if (task.sheetName) return [task];
    if (task.expandAllSheets) {
      const filePath = path.join(task.root, task.folder, task.fileName).normalize("NFC");
      const workbook = XLSX.read(readFileSync(filePath), { type: "buffer", bookSheets: true });
      return workbook.SheetNames.map((sheetName) => ({ ...task, sheetName }));
    }
    const mappedSections = (partBSectionsCache.byFile.get(compactKey(task.fileName)) ?? [])
      .filter((section) => foldersMatch(section.folder, task.folder));
    if (mappedSections.length > 0) {
      return mappedSections.map((section) => ({ ...task, sheetName: section.sheetName }));
    }
    const filePath = path.join(task.root, task.folder, task.fileName).normalize("NFC");
    const workbook = XLSX.read(readFileSync(filePath), { type: "buffer", bookSheets: true });
    return workbook.SheetNames.map((sheetName) => ({ ...task, sheetName }));
  });
}

function foldersMatch(reportFolder, taskFolder) {
  const reportKey = compactKey(reportFolder);
  const taskKey = compactKey(taskFolder);
  return reportKey.includes(taskKey) || taskKey.includes(reportKey);
}

function dropNullish(value) {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== null && v !== undefined));
}

function validateTaskMapping(mapping) {
  const errors = [];
  if (mapping.modelNoColumn === null || mapping.modelNoColumn === undefined) errors.push("缺少 modelNoColumn");
  if (mapping.factoryPriceColumn === null || mapping.factoryPriceColumn === undefined) errors.push("缺少 factoryPriceColumn");
  return errors;
}

async function countTables() {
  const [products, supplierOffers] = await Promise.all([
    prisma.product.count(),
    prisma.supplierOffer.count(),
  ]);
  return { products, supplierOffers };
}

async function qualityChecks() {
  const byCategory = await prisma.product.groupBy({
    by: ["category"],
    _count: { _all: true },
    orderBy: { _count: { category: "desc" } },
  });
  const focusCategories = [
    "筒灯",
    "轨道灯",
    "台灯",
    "Highbay",
    "净化灯",
    "办公灯",
    "五面办公灯",
    "防潮灯",
    "灯管",
    "灯丝灯",
    "镜前灯",
    "路灯",
    "庭院灯",
    "吸顶灯",
    "投光灯",
    "壁灯",
    "橱柜灯",
    "应急灯",
    "大面板灯",
    "地插灯/太阳能壁灯",
  ];
  const focus = byCategory.filter((row) => focusCategories.includes(row.category ?? ""));
  const ctn = await prisma.$queryRaw`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN ctn_qty IS NOT NULL AND ctn_qty != '' THEN 1 ELSE 0 END) as has_ctn_qty,
      SUM(CASE WHEN ctn_length IS NOT NULL AND ctn_length != '' THEN 1 ELSE 0 END) as has_lwh,
      SUM(CASE WHEN price_updated_at IS NOT NULL THEN 1 ELSE 0 END) as has_timestamp
    FROM supplier_offers
  `;
  const timestampDistribution = await prisma.$queryRaw`
    SELECT
      CASE
        WHEN price_updated_at IS NULL THEN '无时间戳（旧数据）'
        ELSE '有时间戳（V2.1+）'
      END as status,
      COUNT(*) as cnt
    FROM supplier_offers
    GROUP BY status
  `;
  const duplicates = await prisma.$queryRaw`
    SELECT p.model_no, so.factory_name, COUNT(*) as cnt
    FROM supplier_offers so
    JOIN products p ON so.product_id = p.id
    GROUP BY p.model_no, so.factory_name
    HAVING cnt > 1
    ORDER BY cnt DESC
    LIMIT 20
  `;
  return { byCategory, focus, ctn, timestampDistribution, duplicates };
}

function mdEscape(value) {
  return clean(value).replaceAll("|", "\\|");
}

function mappingLabel(mapping) {
  return [
    `model=${colLetter(mapping.modelNoColumn)}`,
    `price=${colLetter(mapping.factoryPriceColumn)}`,
    mapping.factoryNameColumn != null ? `factory=${colLetter(mapping.factoryNameColumn)}` : "factory=override",
  ].join(", ");
}

function renderPlanReport({ baseline, planResults, applyResult, finalCounts, checks }) {
  const lines = [];
  lines.push(`# V2.1 Batch Import ${mode === "apply" ? "Result" : "Dry Run"}`);
  lines.push("");
  lines.push(`Generated at: ${now.toISOString()}`);
  lines.push(`Mode: ${mode}`);
  lines.push("");
  lines.push("## Baseline");
  lines.push("");
  lines.push(`- Products: ${baseline.products}`);
  lines.push(`- Supplier offers: ${baseline.supplierOffers}`);
  if (finalCounts) {
    lines.push(`- Products after: ${finalCounts.products}`);
    lines.push(`- Supplier offers after: ${finalCounts.supplierOffers}`);
  }
  lines.push("");
  lines.push("## Import Plan Results");
  lines.push("");
  lines.push("| # | Part | 文件 | Sheet | 品类 | 工厂来源 | 表头行 | 预估产品 | 预估报价行 | 跳过行 | 映射 | 问题 |");
  lines.push("|---:|---|---|---|---|---|---:|---:|---:|---:|---|---|");
  planResults.forEach((row, index) => {
    lines.push(`| ${index + 1} | ${row.part} | ${mdEscape(row.file)} | ${mdEscape(row.sheet)} | ${mdEscape(row.category)} | ${mdEscape(row.factoryOverride)} | ${row.headerRowIndex} | ${row.plannedProducts} | ${row.plannedRows} | ${row.skippedRows} | ${mdEscape(mappingLabel(row.mapping))} | ${mdEscape(row.errors.join("; ") || "-")} |`);
  });
  if (applyResult) {
    lines.push("");
    lines.push("## Write Result");
    lines.push("");
    lines.push(`- 新增产品: ${applyResult.newProducts}`);
    lines.push(`- 复用已有产品: ${applyResult.reusedProducts}`);
    lines.push(`- 新增 supplier_offers: ${applyResult.newOffers}`);
    lines.push(`- 跳过重复 offer: ${applyResult.duplicateOffers}`);
  }
  if (checks) {
    lines.push("");
    lines.push("## Step 2 Quality Checks");
    lines.push("");
    lines.push("### Focus Categories");
    lines.push("");
    lines.push("| Category | Products |");
    lines.push("|---|---:|");
    for (const row of checks.focus) {
      lines.push(`| ${mdEscape(row.category ?? "(null)")} | ${Number(row._count._all)} |`);
    }
    lines.push("");
    lines.push("### CTN / Timestamp Coverage");
    lines.push("");
    const ctn = checks.ctn[0] ?? {};
    lines.push(`- total: ${Number(ctn.total ?? 0)}`);
    lines.push(`- has_ctn_qty: ${Number(ctn.has_ctn_qty ?? 0)}`);
    lines.push(`- has_lwh: ${Number(ctn.has_lwh ?? 0)}`);
    lines.push(`- has_timestamp: ${Number(ctn.has_timestamp ?? 0)}`);
    lines.push("");
    lines.push("### Timestamp Distribution");
    lines.push("");
    lines.push("| Status | Count |");
    lines.push("|---|---:|");
    for (const row of checks.timestampDistribution) {
      lines.push(`| ${mdEscape(row.status)} | ${Number(row.cnt)} |`);
    }
    lines.push("");
    lines.push("### Duplicate model_no + factory_name");
    lines.push("");
    lines.push("| model_no | factory_name | count |");
    lines.push("|---|---|---:|");
    for (const row of checks.duplicates) {
      lines.push(`| ${mdEscape(row.model_no)} | ${mdEscape(row.factory_name)} | ${Number(row.cnt)} |`);
    }
  }
  return lines.join("\n");
}

async function main() {
  const baseline = await countTables();
  const { results, allRows } = await buildPlanRows();
  const errors = results.flatMap((row) => row.errors.map((error) => `${row.file} / ${row.sheet}: ${error}`));
  if (errors.length > 0) {
    const report = renderPlanReport({ baseline, planResults: results });
    await fs.writeFile(DRY_RUN_REPORT, report, "utf8");
    throw new Error(`导入计划有 ${errors.length} 个映射问题，已写入 dry-run 报告。`);
  }

  if (mode === "dry-run") {
    const report = renderPlanReport({ baseline, planResults: results });
    await fs.writeFile(DRY_RUN_REPORT, report, "utf8");
    console.log(JSON.stringify({
      mode,
      tasks: results.length,
      plannedRows: allRows.length,
      plannedProducts: new Set(allRows.map((row) => row.modelNo)).size,
      report: DRY_RUN_REPORT,
    }, null, 2));
    return;
  }

  const applyResult = await importRows(allRows);
  const finalCounts = await countTables();
  const checks = await qualityChecks();
  const report = renderPlanReport({ baseline, planResults: results, applyResult, finalCounts, checks });
  await fs.writeFile(RESULT_REPORT, report, "utf8");
  console.log(JSON.stringify({
    mode,
    tasks: results.length,
    plannedRows: allRows.length,
    applyResult,
    baseline,
    finalCounts,
    report: RESULT_REPORT,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
