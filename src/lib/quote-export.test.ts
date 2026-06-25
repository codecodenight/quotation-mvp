import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type * as ExcelJSNamespace from "exceljs";
import { describe, expect, test } from "vitest";

import { buildProductDetails, calculateSalePrice, writeQuoteWorkbook } from "./quote-export";

const ExcelJS = require("exceljs/dist/exceljs.min.js") as typeof ExcelJSNamespace;

async function loadWorkbook(filePath: string): Promise<ExcelJSNamespace.Workbook> {
  const workbook = new ExcelJS.Workbook();
  const buffer = await readFile(filePath);
  await workbook.xlsx.load(buffer);
  return workbook;
}

const quote = {
  id: "quote-1",
  customerName: "ACME",
  currency: "USD",
  profitMargin: "0.2",
  exchangeRate: "7.2",
  createdAt: new Date("2026-06-05T08:00:00.000Z"),
  items: [
    {
      productName: "COB 灯带",
      modelNo: "COB-120",
      factoryName: "汇孚",
      purchasePrice: "10",
      purchaseCurrency: "RMB",
      salePrice: "1.67",
      quantity: 1,
      moq: "1000/色",
      ctnQty: "10",
      ctnLength: "52.3",
      ctnWidth: "49.5",
      ctnHeight: "27.4",
      material: "PVC",
      size: "8mm",
      productRemark: "COB light strip\n120 LEDs/m",
      remark: "客户备注",
    },
  ],
};

describe("calculateSalePrice", () => {
  test("divides by exchange rate when purchase and sale currency differ", () => {
    expect(
      calculateSalePrice({
        purchasePrice: "10",
        purchaseCurrency: "RMB",
        saleCurrency: "USD",
        exchangeRate: "7.2",
        profitMargin: "0.2",
      }),
    ).toBe("1.67");

    expect(
      calculateSalePrice({
        purchasePrice: "10",
        purchaseCurrency: "USD",
        saleCurrency: "USD",
        exchangeRate: "7.2",
        profitMargin: "0.2",
      }),
    ).toBe("12.00");
  });

  test("rejects missing exchange rate for cross-currency quotes", () => {
    expect(() =>
      calculateSalePrice({
        purchasePrice: "10",
        purchaseCurrency: "RMB",
        saleCurrency: "USD",
        exchangeRate: null,
        profitMargin: "0.2",
      }),
    ).toThrow("汇率不能为空");
  });
});

describe("buildProductDetails", () => {
  test("uses structured params when at least 2 displayable params exist", () => {
    expect(
      buildProductDetails({
        ...quote.items[0],
        productRemark: "Messy raw remark",
        size: "Raw size",
        productParams: [
          { paramKey: "watts", normalizedValue: "18", unit: "W", rawValue: "18W" },
          { paramKey: "ip", normalizedValue: "IP65", unit: null, rawValue: "IP65" },
          { paramKey: "size_display", normalizedValue: "90x66x23mm", unit: null, rawValue: "90*66*23" },
        ],
      }),
    ).toBe("Power: 18W\nIP: IP65\nSize: 90x66x23mm");
  });

  test("falls back to remark and size when structured params are insufficient", () => {
    expect(
      buildProductDetails({
        ...quote.items[0],
        productName: "Panel Light",
        modelNo: "PNL-1",
        productRemark: "Clean fallback remark",
        size: "600x600",
        productParams: [{ paramKey: "watts", normalizedValue: "18", unit: "W", rawValue: "18W" }],
      }),
    ).toBe("Clean fallback remark\nSize: 600x600");
  });

  test("appends raw size only when param details do not already include size_display", () => {
    expect(
      buildProductDetails({
        ...quote.items[0],
        size: "Raw size",
        productParams: [
          { paramKey: "watts", normalizedValue: "18", unit: "W", rawValue: "18W" },
          { paramKey: "ip", normalizedValue: "IP65", unit: null, rawValue: "IP65" },
        ],
      }),
    ).toBe("Power: 18W\nIP: IP65\nSize: Raw size");
  });

  test("fallback filters packaging labels and empty values from remark", () => {
    const details = buildProductDetails({
      ...quote.items[0],
      productName: "LS-W12F-20W",
      modelNo: "LS-W12F-20W",
      productRemark:
        "PF: 0.9\nVoltage: /\nPower: 20W±10%\nLumen: 1600LM±10%\n产品单灯尺寸(MM): 128*93*28\n外箱尺寸(MM) 参考用: 620*280*280",
      size: "128*93*28",
      productParams: [],
    });

    expect(details).not.toContain("外箱尺寸");
    expect(details).not.toContain("Voltage: /");
    expect(details).toContain("PF: 0.9");
    expect(details).toContain("Size: 128*93*28");
  });
});

describe("writeQuoteWorkbook", () => {
  test("uses the panel template when all items are panel lights", async () => {
    const dir = await mkdtemp(join(tmpdir(), "quote-export-"));
    const filePath = join(dir, "quote-panel.xlsx");
    const panelQuote = {
      ...quote,
      items: [
        {
          ...quote.items[0],
          productName: "LED Slim Panel Light",
          modelNo: "PNL-36W",
          category: "面板灯",
          salePrice: "8.5",
          purchasePrice: "50",
          moq: "500PCS",
          ctnQty: "8",
          ctnLength: "62",
          ctnWidth: "62",
          ctnHeight: "28",
          productParams: [
            { paramKey: "watts", normalizedValue: "36", unit: "W", rawValue: "36W" },
            { paramKey: "size_display", normalizedValue: "600×600×10", unit: "mm", rawValue: "600*600*10mm" },
            { paramKey: "material", normalizedValue: "PS+Aluminum", unit: null, rawValue: "PS+Aluminum" },
            { paramKey: "cct", normalizedValue: "4000", unit: "K", rawValue: "4000K" },
            { paramKey: "cri", normalizedValue: "80", unit: null, rawValue: "Ra80" },
            { paramKey: "pf", normalizedValue: "0.9", unit: null, rawValue: "PF0.9" },
            { paramKey: "voltage", normalizedValue: "220-240", unit: "V", rawValue: "AC220-240V" },
            { paramKey: "driver_type", normalizedValue: "Isolated", unit: null, rawValue: "Isolated driver" },
            { paramKey: "ip", normalizedValue: "20", unit: null, rawValue: "IP20" },
          ],
        },
      ],
    };

    try {
      await writeQuoteWorkbook(panelQuote, filePath, { customerMode: true });

      const workbook = await loadWorkbook(filePath);
      const sheet = workbook.getWorksheet("LED Slim Panel-plastic sheet");

      expect(sheet).toBeDefined();
      expect(sheet?.getRow(1).values).toEqual([
        undefined,
        "Photo",
        "No.",
        "Model No.",
        "Power",
        "Size",
        "Material",
        "CCT",
        "CRI",
        "PF",
        "Voltage",
        "Driver",
        "IP",
        "FOB Price",
        "MOQ",
        "CTN QTY",
        "CTN Size",
        "Volume",
      ]);
      expect(sheet?.getCell("B2").value).toBe(1);
      expect(sheet?.getCell("C2").value).toBe("PNL-36W");
      expect(sheet?.getCell("D2").value).toBe("36W");
      expect(sheet?.getCell("E2").value).toBe("600×600×10");
      expect(sheet?.getCell("G2").value).toBe("4000K");
      expect(sheet?.getCell("H2").value).toBe("Ra80");
      expect(sheet?.getCell("J2").value).toBe("220-240V");
      expect(sheet?.getCell("L2").value).toBe("IP20");
      expect(sheet?.getCell("M2").value).toBe(8.5);
      expect(sheet?.getCell("N2").value).toBe("500");
      expect(sheet?.getCell("P2").value).toBe("62 × 62 × 28");
      expect(sheet?.getCell("Q2").value).toBe(0.108);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("keeps the generic workbook when quote items span multiple categories", async () => {
    const dir = await mkdtemp(join(tmpdir(), "quote-export-"));
    const filePath = join(dir, "quote-mixed.xlsx");
    const mixedQuote = {
      ...quote,
      items: [
        { ...quote.items[0], category: "面板灯" },
        { ...quote.items[0], productName: "Flood Light", modelNo: "FL-50W", category: "投光灯" },
      ],
    };

    try {
      await writeQuoteWorkbook(mixedQuote, filePath, { customerMode: true });

      const workbook = await loadWorkbook(filePath);

      expect(workbook.getWorksheet("LED Slim Panel-plastic sheet")).toBeUndefined();
      expect(workbook.getWorksheet("报价单")?.getCell("A1").value).toBe("报价单");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("uses the floodlight template when all items are floodlights", async () => {
    const dir = await mkdtemp(join(tmpdir(), "quote-export-"));
    const filePath = join(dir, "quote-floodlight.xlsx");
    const floodlightQuote = {
      ...quote,
      items: [
        {
          ...quote.items[0],
          productName: "LED Floodlight",
          modelNo: "FL-100W",
          category: "投光灯",
          salePrice: "12.5",
          moq: "1,000PCS",
          ctnQty: "4",
          ctnLength: "45",
          ctnWidth: "32",
          ctnHeight: "28",
          productParams: [
            { paramKey: "watts", normalizedValue: "100", unit: "W", rawValue: "100W" },
            { paramKey: "size_display", normalizedValue: "280×220×45", unit: "mm", rawValue: "280*220*45mm" },
            { paramKey: "material", normalizedValue: "Aluminum", unit: null, rawValue: "Aluminum" },
            { paramKey: "cct", normalizedValue: "6500", unit: "K", rawValue: "6500K" },
            { paramKey: "cri", normalizedValue: "80", unit: null, rawValue: "Ra80" },
            { paramKey: "pf", normalizedValue: "0.95", unit: null, rawValue: "PF0.95" },
            { paramKey: "voltage", normalizedValue: "220-240", unit: "V", rawValue: "AC220-240V" },
            { paramKey: "driver_type", normalizedValue: "DOB", unit: null, rawValue: "DOB" },
            { paramKey: "ip", normalizedValue: "65", unit: null, rawValue: "IP65" },
            { paramKey: "beam_angle", normalizedValue: "120", unit: "°", rawValue: "120°" },
          ],
        },
      ],
    };

    try {
      await writeQuoteWorkbook(floodlightQuote, filePath, { customerMode: true });

      const workbook = await loadWorkbook(filePath);
      const sheet = workbook.getWorksheet("LED Floodlight");

      expect(sheet).toBeDefined();
      expect(sheet?.getRow(1).values).toEqual([
        undefined,
        "Photo",
        "No.",
        "Model No.",
        "Power",
        "Size",
        "Material",
        "CCT",
        "CRI",
        "PF",
        "Voltage",
        "Driver",
        "IP",
        "Beam Angle",
        "FOB Price",
        "MOQ",
        "CTN QTY",
        "CTN Size",
        "Volume",
      ]);
      expect(sheet?.getCell("C2").value).toBe("FL-100W");
      expect(sheet?.getCell("D2").value).toBe("100W");
      expect(sheet?.getCell("E2").value).toBe("280×220×45");
      expect(sheet?.getCell("G2").value).toBe("6500K");
      expect(sheet?.getCell("H2").value).toBe("Ra80");
      expect(sheet?.getCell("J2").value).toBe("220-240V");
      expect(sheet?.getCell("L2").value).toBe("IP65");
      expect(sheet?.getCell("M2").value).toBe("120°");
      expect(sheet?.getCell("N2").value).toBe(12.5);
      expect(sheet?.getCell("O2").value).toBe("1000");
      expect(sheet?.getCell("Q2").value).toBe("45 × 32 × 28");
      expect(sheet?.getCell("R2").value).toBe(0.04);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("uses the linear light template when all items are linear lights", async () => {
    const dir = await mkdtemp(join(tmpdir(), "quote-export-"));
    const filePath = join(dir, "quote-linear.xlsx");
    const linearQuote = {
      ...quote,
      items: [
        {
          ...quote.items[0],
          productName: "LED Linear Light",
          modelNo: "LN-40W",
          category: "线条灯",
          salePrice: "9.25",
          moq: "300PCS",
          ctnQty: "6",
          ctnLength: "120",
          ctnWidth: "25",
          ctnHeight: "18",
          productParams: [
            { paramKey: "watts", normalizedValue: "40", unit: "W", rawValue: "40W" },
            { paramKey: "length_mm", normalizedValue: "1200", unit: "mm", rawValue: "1200mm" },
            { paramKey: "material", normalizedValue: "Aluminum+PC", unit: null, rawValue: "Aluminum+PC" },
            { paramKey: "cct", normalizedValue: "3000/4000/6500", unit: "K", rawValue: "3CCT" },
            { paramKey: "cri", normalizedValue: "80", unit: null, rawValue: "Ra80" },
            { paramKey: "pf", normalizedValue: "0.9", unit: null, rawValue: "PF0.9" },
            { paramKey: "voltage", normalizedValue: "220-240", unit: "V", rawValue: "AC220-240V" },
            { paramKey: "ip", normalizedValue: "20", unit: null, rawValue: "IP20" },
          ],
        },
      ],
    };

    try {
      await writeQuoteWorkbook(linearQuote, filePath, { customerMode: true });

      const workbook = await loadWorkbook(filePath);
      const sheet = workbook.getWorksheet("LED Linear Light");

      expect(sheet).toBeDefined();
      expect(sheet?.getRow(1).values).toEqual([
        undefined,
        "Photo",
        "No.",
        "Model No.",
        "Power",
        "Length",
        "Material",
        "CCT",
        "CRI",
        "PF",
        "Voltage",
        "IP",
        "FOB Price",
        "MOQ",
        "CTN QTY",
        "CTN Size",
        "Volume",
      ]);
      expect(sheet?.getCell("C2").value).toBe("LN-40W");
      expect(sheet?.getCell("D2").value).toBe("40W");
      expect(sheet?.getCell("E2").value).toBe("1200");
      expect(sheet?.getCell("G2").value).toBe("3000K/4000K/6500K");
      expect(sheet?.getCell("K2").value).toBe("IP20");
      expect(sheet?.getCell("L2").value).toBe(9.25);
      expect(sheet?.getCell("M2").value).toBe("300");
      expect(sheet?.getCell("O2").value).toBe("120 × 25 × 18");
      expect(sheet?.getCell("P2").value).toBe(0.054);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("uses the bulb template when all items are bulbs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "quote-export-"));
    const filePath = join(dir, "quote-bulb.xlsx");
    const bulbQuote = {
      ...quote,
      items: [
        {
          ...quote.items[0],
          productName: "A60 LED Bulb",
          modelNo: "BLB-9W",
          category: "球泡",
          salePrice: "1.15",
          moq: "2000PCS",
          ctnQty: "100",
          ctnLength: "50",
          ctnWidth: "40",
          ctnHeight: "36",
          productParams: [
            { paramKey: "watts", normalizedValue: "9", unit: "W", rawValue: "9W" },
            { paramKey: "base", normalizedValue: "E27", unit: null, rawValue: "E27" },
            { paramKey: "shape", normalizedValue: "A60", unit: null, rawValue: "A60" },
            { paramKey: "cct", normalizedValue: "3000", unit: "K", rawValue: "3000K" },
            { paramKey: "cri", normalizedValue: "80", unit: null, rawValue: "Ra80" },
            { paramKey: "pf", normalizedValue: "0.5", unit: null, rawValue: "PF0.5" },
            { paramKey: "voltage", normalizedValue: "220-240", unit: "V", rawValue: "AC220-240V" },
            { paramKey: "driver_type", normalizedValue: "Linear IC", unit: null, rawValue: "Linear IC" },
            { paramKey: "luminous_efficacy", normalizedValue: "90", unit: "lm/W", rawValue: "90lm/W" },
          ],
        },
      ],
    };

    try {
      await writeQuoteWorkbook(bulbQuote, filePath, { customerMode: true });

      const workbook = await loadWorkbook(filePath);
      const sheet = workbook.getWorksheet("LED Bulb");

      expect(sheet).toBeDefined();
      expect(sheet?.getRow(1).values).toEqual([
        undefined,
        "Photo",
        "No.",
        "Model No.",
        "Power",
        "Base",
        "Shape",
        "CCT",
        "CRI",
        "PF",
        "Voltage",
        "Driver",
        "Luminous Efficacy",
        "FOB Price",
        "MOQ",
        "CTN QTY",
        "CTN Size",
        "Volume",
      ]);
      expect(sheet?.getCell("C2").value).toBe("BLB-9W");
      expect(sheet?.getCell("D2").value).toBe("9W");
      expect(sheet?.getCell("E2").value).toBe("E27");
      expect(sheet?.getCell("F2").value).toBe("A60");
      expect(sheet?.getCell("G2").value).toBe("3000K");
      expect(sheet?.getCell("H2").value).toBe("Ra80");
      expect(sheet?.getCell("J2").value).toBe("220-240V");
      expect(sheet?.getCell("L2").value).toBe("90lm/W");
      expect(sheet?.getCell("M2").value).toBe(1.15);
      expect(sheet?.getCell("N2").value).toBe("2000");
      expect(sheet?.getCell("P2").value).toBe("50 × 40 × 36");
      expect(sheet?.getCell("Q2").value).toBe(0.072);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("uses the strip template when all items are LED strips", async () => {
    const dir = await mkdtemp(join(tmpdir(), "quote-export-"));
    const filePath = join(dir, "quote-strip.xlsx");
    const stripQuote = {
      ...quote,
      items: [
        {
          ...quote.items[0],
          productName: "LED Strip",
          modelNo: "ST-2835-120",
          category: "灯带",
          salePrice: "0.85",
          moq: "1000m",
          ctnQty: "500",
          ctnLength: "52.3",
          ctnWidth: "49.5",
          ctnHeight: "27.4",
          productParams: [
            { paramKey: "watts", normalizedValue: "12", unit: "W/m", rawValue: "12W/m" },
            { paramKey: "voltage", normalizedValue: "24", unit: "V", rawValue: "24V" },
            { paramKey: "led_type", normalizedValue: "SMD2835", unit: null, rawValue: "2835" },
            { paramKey: "leds_per_meter", normalizedValue: "120", unit: null, rawValue: "120LED/m" },
            { paramKey: "cct", normalizedValue: "2700/6500", unit: "K", rawValue: "2700K/6500K" },
            { paramKey: "cri", normalizedValue: "90", unit: null, rawValue: "Ra90" },
            { paramKey: "ip", normalizedValue: "65", unit: null, rawValue: "IP65" },
            { paramKey: "width_mm", normalizedValue: "8", unit: "mm", rawValue: "8mm" },
          ],
        },
      ],
    };

    try {
      await writeQuoteWorkbook(stripQuote, filePath, { customerMode: true });

      const workbook = await loadWorkbook(filePath);
      const sheet = workbook.getWorksheet("LED Strips");

      expect(sheet).toBeDefined();
      expect(sheet?.getRow(1).values).toEqual([
        undefined,
        "Photo",
        "No.",
        "Model No.",
        "W/m",
        "Voltage",
        "LED Chip",
        "LEDs/m",
        "CCT",
        "CRI",
        "IP",
        "PCB Width",
        "FOB Price (USD/m)",
        "MOQ (m)",
        "CTN QTY",
        "CTN Size",
        "Volume",
      ]);
      expect(sheet?.getCell("C2").value).toBe("ST-2835-120");
      expect(sheet?.getCell("D2").value).toBe("12");
      expect(sheet?.getCell("E2").value).toBe("24V");
      expect(sheet?.getCell("F2").value).toBe("SMD2835");
      expect(sheet?.getCell("G2").value).toBe("120");
      expect(sheet?.getCell("H2").value).toBe("2700K/6500K");
      expect(sheet?.getCell("J2").value).toBe("IP65");
      expect(sheet?.getCell("K2").value).toBe("8mm");
      expect(sheet?.getCell("L2").value).toBe(0.85);
      expect(sheet?.getCell("M2").value).toBe("1000");
      expect(sheet?.getCell("O2").value).toBe("52.3 × 49.5 × 27.4");
      expect(sheet?.getCell("P2").value).toBe(0.071);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("uses the downlight template when all items are downlights", async () => {
    const dir = await mkdtemp(join(tmpdir(), "quote-export-"));
    const filePath = join(dir, "quote-downlight.xlsx");
    const downlightQuote = {
      ...quote,
      items: [
        {
          ...quote.items[0],
          productName: "LED Downlight",
          modelNo: "DL-18W",
          category: "筒灯",
          salePrice: "3.2",
          moq: "500PCS",
          ctnQty: "24",
          ctnLength: "40",
          ctnWidth: "35",
          ctnHeight: "30",
          productParams: [
            { paramKey: "watts", normalizedValue: "18", unit: "W", rawValue: "18W" },
            { paramKey: "size_display", normalizedValue: "95×45", unit: "mm", rawValue: "95*45mm" },
            { paramKey: "cutout_mm", normalizedValue: "75", unit: "mm", rawValue: "75mm" },
            { paramKey: "material", normalizedValue: "Aluminum", unit: null, rawValue: "Aluminum" },
            { paramKey: "cct", normalizedValue: "3000/4000/6500", unit: "K", rawValue: "3CCT" },
            { paramKey: "cri", normalizedValue: "80", unit: null, rawValue: "Ra80" },
            { paramKey: "pf", normalizedValue: "0.9", unit: null, rawValue: "PF0.9" },
            { paramKey: "voltage", normalizedValue: "220-240", unit: "V", rawValue: "AC220-240V" },
            { paramKey: "driver_type", normalizedValue: "Isolated", unit: null, rawValue: "Isolated" },
            { paramKey: "beam_angle", normalizedValue: "100", unit: "°", rawValue: "100°" },
          ],
        },
      ],
    };

    try {
      await writeQuoteWorkbook(downlightQuote, filePath, { customerMode: true });

      const workbook = await loadWorkbook(filePath);
      const sheet = workbook.getWorksheet("LED Downlight");

      expect(sheet).toBeDefined();
      expect(sheet?.getRow(1).values).toEqual([
        undefined,
        "Photo",
        "No.",
        "Model No.",
        "Power",
        "Size",
        "Cutout",
        "Material",
        "CCT",
        "CRI",
        "PF",
        "Voltage",
        "Driver",
        "Beam Angle",
        "FOB Price",
        "MOQ",
        "CTN QTY",
        "CTN Size",
        "Volume",
      ]);
      expect(sheet?.getCell("C2").value).toBe("DL-18W");
      expect(sheet?.getCell("D2").value).toBe("18W");
      expect(sheet?.getCell("E2").value).toBe("95×45");
      expect(sheet?.getCell("F2").value).toBe("75");
      expect(sheet?.getCell("H2").value).toBe("3000K/4000K/6500K");
      expect(sheet?.getCell("I2").value).toBe("Ra80");
      expect(sheet?.getCell("K2").value).toBe("220-240V");
      expect(sheet?.getCell("M2").value).toBe("100°");
      expect(sheet?.getCell("N2").value).toBe(3.2);
      expect(sheet?.getCell("O2").value).toBe("500");
      expect(sheet?.getCell("Q2").value).toBe("40 × 35 × 30");
      expect(sheet?.getCell("R2").value).toBe(0.042);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("uses the tri-proof template when all items are tri-proof lights", async () => {
    const dir = await mkdtemp(join(tmpdir(), "quote-export-"));
    const filePath = join(dir, "quote-triproof.xlsx");
    const triproofQuote = {
      ...quote,
      items: [
        {
          ...quote.items[0],
          productName: "LED Tri-proof Light",
          modelNo: "TP-40W",
          category: "三防灯",
          salePrice: "8.8",
          moq: "300PCS",
          ctnQty: "12",
          ctnLength: "130",
          ctnWidth: "28",
          ctnHeight: "24",
          productParams: [
            { paramKey: "watts", normalizedValue: "40", unit: "W", rawValue: "40W" },
            { paramKey: "length_mm", normalizedValue: "1200", unit: "mm", rawValue: "1200mm" },
            { paramKey: "cct", normalizedValue: "4000", unit: "K", rawValue: "4000K" },
            { paramKey: "cri", normalizedValue: "80", unit: null, rawValue: "Ra80" },
            { paramKey: "pf", normalizedValue: "0.9", unit: null, rawValue: "PF0.9" },
            { paramKey: "voltage", normalizedValue: "220-240", unit: "V", rawValue: "AC220-240V" },
            { paramKey: "ip", normalizedValue: "65", unit: null, rawValue: "IP65" },
            { paramKey: "luminous_efficacy", normalizedValue: "120", unit: "lm/W", rawValue: "120lm/W" },
          ],
        },
      ],
    };

    try {
      await writeQuoteWorkbook(triproofQuote, filePath, { customerMode: true });

      const workbook = await loadWorkbook(filePath);
      const sheet = workbook.getWorksheet("LED Tri-proof Light");

      expect(sheet).toBeDefined();
      expect(sheet?.getRow(1).values).toEqual([
        undefined,
        "Photo",
        "No.",
        "Model No.",
        "Power",
        "Length",
        "CCT",
        "CRI",
        "PF",
        "Voltage",
        "IP",
        "Luminous Efficacy",
        "FOB Price",
        "MOQ",
        "CTN QTY",
        "CTN Size",
        "Volume",
      ]);
      expect(sheet?.getCell("C2").value).toBe("TP-40W");
      expect(sheet?.getCell("D2").value).toBe("40W");
      expect(sheet?.getCell("E2").value).toBe("1200");
      expect(sheet?.getCell("F2").value).toBe("4000K");
      expect(sheet?.getCell("G2").value).toBe("Ra80");
      expect(sheet?.getCell("I2").value).toBe("220-240V");
      expect(sheet?.getCell("J2").value).toBe("IP65");
      expect(sheet?.getCell("K2").value).toBe("120lm/W");
      expect(sheet?.getCell("L2").value).toBe(8.8);
      expect(sheet?.getCell("M2").value).toBe("300");
      expect(sheet?.getCell("O2").value).toBe("130 × 28 × 24");
      expect(sheet?.getCell("P2").value).toBe(0.087);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("uses the ceiling lamp template when all items are ceiling lamps", async () => {
    const dir = await mkdtemp(join(tmpdir(), "quote-export-"));
    const filePath = join(dir, "quote-ceiling.xlsx");
    const ceilingQuote = {
      ...quote,
      items: [
        {
          ...quote.items[0],
          productName: "LED Ceiling Lamp",
          modelNo: "CL-24W",
          category: "吸顶灯",
          salePrice: "5.6",
          moq: "200PCS",
          ctnQty: "10",
          ctnLength: "55",
          ctnWidth: "55",
          ctnHeight: "35",
          productParams: [
            { paramKey: "watts", normalizedValue: "24", unit: "W", rawValue: "24W" },
            { paramKey: "size_display", normalizedValue: "300×65", unit: "mm", rawValue: "300*65mm" },
            { paramKey: "diameter_mm", normalizedValue: "300", unit: "mm", rawValue: "300mm" },
            { paramKey: "material", normalizedValue: "PMMA+Iron", unit: null, rawValue: "PMMA+Iron" },
            { paramKey: "cct", normalizedValue: "3000/6500", unit: "K", rawValue: "3000K/6500K" },
            { paramKey: "cri", normalizedValue: "80", unit: null, rawValue: "Ra80" },
            { paramKey: "pf", normalizedValue: "0.5", unit: null, rawValue: "PF0.5" },
            { paramKey: "voltage", normalizedValue: "220-240", unit: "V", rawValue: "AC220-240V" },
            { paramKey: "driver_type", normalizedValue: "Linear IC", unit: null, rawValue: "Linear IC" },
          ],
        },
      ],
    };

    try {
      await writeQuoteWorkbook(ceilingQuote, filePath, { customerMode: true });

      const workbook = await loadWorkbook(filePath);
      const sheet = workbook.getWorksheet("LED Ceiling Lamp");

      expect(sheet).toBeDefined();
      expect(sheet?.getRow(1).values).toEqual([
        undefined,
        "Photo",
        "No.",
        "Model No.",
        "Power",
        "Size",
        "Material",
        "CCT",
        "CRI",
        "PF",
        "Voltage",
        "Driver",
        "FOB Price",
        "MOQ",
        "CTN QTY",
        "CTN Size",
        "Volume",
      ]);
      expect(sheet?.getCell("C2").value).toBe("CL-24W");
      expect(sheet?.getCell("D2").value).toBe("24W");
      expect(sheet?.getCell("E2").value).toBe("300");
      expect(sheet?.getCell("F2").value).toBe("PMMA+Iron");
      expect(sheet?.getCell("G2").value).toBe("3000K/6500K");
      expect(sheet?.getCell("H2").value).toBe("Ra80");
      expect(sheet?.getCell("J2").value).toBe("220-240V");
      expect(sheet?.getCell("L2").value).toBe(5.6);
      expect(sheet?.getCell("M2").value).toBe("200");
      expect(sheet?.getCell("O2").value).toBe("55 × 55 × 35");
      expect(sheet?.getCell("P2").value).toBe(0.106);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("uses the solar wall light template when all items are solar wall lights", async () => {
    const dir = await mkdtemp(join(tmpdir(), "quote-export-"));
    const filePath = join(dir, "quote-solar-wall.xlsx");
    const solarWallQuote = {
      ...quote,
      items: [
        {
          ...quote.items[0],
          productName: "Solar Wall Light",
          modelNo: "SWL-10W",
          category: "太阳能壁灯",
          salePrice: "6.75",
          moq: "100PCS",
          ctnQty: "20",
          ctnLength: "48",
          ctnWidth: "38",
          ctnHeight: "32",
          productParams: [
            { paramKey: "watts", normalizedValue: "10", unit: "W", rawValue: "10W" },
            { paramKey: "material", normalizedValue: "ABS", unit: null, rawValue: "ABS" },
            { paramKey: "cct", normalizedValue: "6500", unit: "K", rawValue: "6500K" },
            { paramKey: "cri", normalizedValue: "70", unit: null, rawValue: "Ra70" },
            { paramKey: "ip", normalizedValue: "65", unit: null, rawValue: "IP65" },
            { paramKey: "lumens", normalizedValue: "1000", unit: "lm", rawValue: "1000lm" },
            { paramKey: "sensor", normalizedValue: "PIR", unit: null, rawValue: "PIR sensor" },
          ],
        },
      ],
    };

    try {
      await writeQuoteWorkbook(solarWallQuote, filePath, { customerMode: true });

      const workbook = await loadWorkbook(filePath);
      const sheet = workbook.getWorksheet("Solar Wall Light");

      expect(sheet).toBeDefined();
      expect(sheet?.getRow(1).values).toEqual([
        undefined,
        "Photo",
        "No.",
        "Model No.",
        "Power",
        "Material",
        "CCT",
        "CRI",
        "IP",
        "Lumens",
        "Sensor",
        "FOB Price",
        "MOQ",
        "CTN QTY",
        "CTN Size",
        "Volume",
      ]);
      expect(sheet?.getCell("C2").value).toBe("SWL-10W");
      expect(sheet?.getCell("D2").value).toBe("10W");
      expect(sheet?.getCell("E2").value).toBe("ABS");
      expect(sheet?.getCell("F2").value).toBe("6500K");
      expect(sheet?.getCell("G2").value).toBe("Ra70");
      expect(sheet?.getCell("H2").value).toBe("IP65");
      expect(sheet?.getCell("I2").value).toBe("1000lm");
      expect(sheet?.getCell("J2").value).toBe("PIR");
      expect(sheet?.getCell("K2").value).toBe(6.75);
      expect(sheet?.getCell("L2").value).toBe("100");
      expect(sheet?.getCell("N2").value).toBe("48 × 38 × 32");
      expect(sheet?.getCell("O2").value).toBe(0.058);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("uses the magnetic track light template when all items are magnetic track lights", async () => {
    const dir = await mkdtemp(join(tmpdir(), "quote-export-"));
    const filePath = join(dir, "quote-magnetic-track.xlsx");
    const magneticQuote = {
      ...quote,
      items: [
        {
          ...quote.items[0],
          productName: "LED Magnetic Track Light",
          modelNo: "MT-24W",
          category: "磁吸灯",
          salePrice: "11.2",
          moq: "100PCS",
          ctnQty: "12",
          ctnLength: "58",
          ctnWidth: "36",
          ctnHeight: "30",
          productParams: [
            { paramKey: "watts", normalizedValue: "24", unit: "W", rawValue: "24W" },
            { paramKey: "track_system", normalizedValue: "48V", unit: null, rawValue: "48V magnetic" },
            { paramKey: "size_display", normalizedValue: "220×35×45", unit: "mm", rawValue: "220*35*45mm" },
            { paramKey: "material", normalizedValue: "Aluminum", unit: null, rawValue: "Aluminum" },
            { paramKey: "cct", normalizedValue: "3000/4000", unit: "K", rawValue: "3000K/4000K" },
            { paramKey: "cri", normalizedValue: "90", unit: null, rawValue: "Ra90" },
            { paramKey: "beam_angle", normalizedValue: "24", unit: "°", rawValue: "24°" },
            { paramKey: "voltage", normalizedValue: "48", unit: "V", rawValue: "DC48V" },
          ],
        },
      ],
    };

    try {
      await writeQuoteWorkbook(magneticQuote, filePath, { customerMode: true });

      const workbook = await loadWorkbook(filePath);
      const sheet = workbook.getWorksheet("LED Magnetic Track Light");

      expect(sheet).toBeDefined();
      expect(sheet?.getRow(1).values).toEqual([
        undefined,
        "Photo",
        "No.",
        "Model No.",
        "Power",
        "Track System",
        "Size",
        "Material",
        "CCT",
        "CRI",
        "Beam Angle",
        "Voltage",
        "FOB Price",
        "MOQ",
        "CTN QTY",
        "CTN Size",
        "Volume",
      ]);
      expect(sheet?.getCell("C2").value).toBe("MT-24W");
      expect(sheet?.getCell("D2").value).toBe("24W");
      expect(sheet?.getCell("E2").value).toBe("48V");
      expect(sheet?.getCell("F2").value).toBe("220×35×45");
      expect(sheet?.getCell("H2").value).toBe("3000K/4000K");
      expect(sheet?.getCell("I2").value).toBe("Ra90");
      expect(sheet?.getCell("J2").value).toBe("24°");
      expect(sheet?.getCell("K2").value).toBe("48V");
      expect(sheet?.getCell("L2").value).toBe(11.2);
      expect(sheet?.getCell("M2").value).toBe("100");
      expect(sheet?.getCell("O2").value).toBe("58 × 36 × 30");
      expect(sheet?.getCell("P2").value).toBe(0.063);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("uses the filament bulb template when all items are filament bulbs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "quote-export-"));
    const filePath = join(dir, "quote-filament.xlsx");
    const filamentQuote = {
      ...quote,
      items: [
        {
          ...quote.items[0],
          productName: "LED Filament Bulb",
          modelNo: "FIL-C35-6W",
          category: "灯丝灯",
          salePrice: "1.35",
          moq: "2000PCS",
          ctnQty: "100",
          ctnLength: "48",
          ctnWidth: "42",
          ctnHeight: "38",
          productParams: [
            { paramKey: "watts", normalizedValue: "6", unit: "W", rawValue: "6W" },
            { paramKey: "base", normalizedValue: "E27", unit: null, rawValue: "E27" },
            { paramKey: "led_type", normalizedValue: "Filament", unit: null, rawValue: "Filament" },
            { paramKey: "cct", normalizedValue: "2700", unit: "K", rawValue: "2700K" },
            { paramKey: "cri", normalizedValue: "80", unit: null, rawValue: "Ra80" },
            { paramKey: "pf", normalizedValue: "0.5", unit: null, rawValue: "PF0.5" },
            { paramKey: "voltage", normalizedValue: "220-240", unit: "V", rawValue: "AC220-240V" },
            { paramKey: "lumens", normalizedValue: "600", unit: "lm", rawValue: "600lm" },
            { paramKey: "luminous_efficacy", normalizedValue: "100", unit: "lm/W", rawValue: "100lm/W" },
          ],
        },
      ],
    };

    try {
      await writeQuoteWorkbook(filamentQuote, filePath, { customerMode: true });

      const workbook = await loadWorkbook(filePath);
      const sheet = workbook.getWorksheet("LED Filament Bulb");

      expect(sheet).toBeDefined();
      expect(sheet?.getRow(1).values).toEqual([
        undefined,
        "Photo",
        "No.",
        "Model No.",
        "Power",
        "Base",
        "LED Type",
        "CCT",
        "CRI",
        "PF",
        "Voltage",
        "Lumens",
        "Luminous Efficacy",
        "FOB Price",
        "MOQ",
        "CTN QTY",
        "CTN Size",
        "Volume",
      ]);
      expect(sheet?.getCell("C2").value).toBe("FIL-C35-6W");
      expect(sheet?.getCell("D2").value).toBe("6W");
      expect(sheet?.getCell("E2").value).toBe("E27");
      expect(sheet?.getCell("F2").value).toBe("Filament");
      expect(sheet?.getCell("G2").value).toBe("2700K");
      expect(sheet?.getCell("H2").value).toBe("Ra80");
      expect(sheet?.getCell("J2").value).toBe("220-240V");
      expect(sheet?.getCell("K2").value).toBe("600lm");
      expect(sheet?.getCell("L2").value).toBe("100lm/W");
      expect(sheet?.getCell("M2").value).toBe(1.35);
      expect(sheet?.getCell("N2").value).toBe("2000");
      expect(sheet?.getCell("P2").value).toBe("48 × 42 × 38");
      expect(sheet?.getCell("Q2").value).toBe(0.077);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("uses the fan light template when all items are fan lights", async () => {
    const dir = await mkdtemp(join(tmpdir(), "quote-export-"));
    const filePath = join(dir, "quote-fan-light.xlsx");
    const fanLightQuote = {
      ...quote,
      items: [
        {
          ...quote.items[0],
          productName: "LED Fan Light",
          modelNo: "FAN-36W",
          category: "风扇灯",
          salePrice: "18.5",
          moq: "50PCS",
          ctnQty: "4",
          ctnLength: "62",
          ctnWidth: "62",
          ctnHeight: "28",
          productParams: [
            { paramKey: "watts", normalizedValue: "36", unit: "W", rawValue: "36W" },
            { paramKey: "size_display", normalizedValue: "520×180", unit: "mm", rawValue: "520*180mm" },
            { paramKey: "material", normalizedValue: "ABS+Iron", unit: null, rawValue: "ABS+Iron" },
            { paramKey: "cct", normalizedValue: "3000/6500", unit: "K", rawValue: "3000K/6500K" },
            { paramKey: "cri", normalizedValue: "80", unit: null, rawValue: "Ra80" },
            { paramKey: "voltage", normalizedValue: "220-240", unit: "V", rawValue: "AC220-240V" },
            { paramKey: "ip", normalizedValue: "20", unit: null, rawValue: "IP20" },
          ],
        },
      ],
    };

    try {
      await writeQuoteWorkbook(fanLightQuote, filePath, { customerMode: true });

      const workbook = await loadWorkbook(filePath);
      const sheet = workbook.getWorksheet("LED Fan Light");

      expect(sheet).toBeDefined();
      expect(sheet?.getRow(1).values).toEqual([
        undefined,
        "Photo",
        "No.",
        "Model No.",
        "Power",
        "Size",
        "Material",
        "CCT",
        "CRI",
        "Voltage",
        "IP",
        "FOB Price",
        "MOQ",
        "CTN QTY",
        "CTN Size",
        "Volume",
      ]);
      expect(sheet?.getCell("C2").value).toBe("FAN-36W");
      expect(sheet?.getCell("D2").value).toBe("36W");
      expect(sheet?.getCell("E2").value).toBe("520×180");
      expect(sheet?.getCell("F2").value).toBe("ABS+Iron");
      expect(sheet?.getCell("G2").value).toBe("3000K/6500K");
      expect(sheet?.getCell("H2").value).toBe("Ra80");
      expect(sheet?.getCell("I2").value).toBe("220-240V");
      expect(sheet?.getCell("J2").value).toBe("IP20");
      expect(sheet?.getCell("K2").value).toBe(18.5);
      expect(sheet?.getCell("L2").value).toBe("50");
      expect(sheet?.getCell("N2").value).toBe("62 × 62 × 28");
      expect(sheet?.getCell("O2").value).toBe(0.108);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("uses the generic solar light template when all items are solar lights", async () => {
    const dir = await mkdtemp(join(tmpdir(), "quote-export-"));
    const filePath = join(dir, "quote-solar.xlsx");
    const solarQuote = {
      ...quote,
      items: [
        {
          ...quote.items[0],
          productName: "Solar LED Street Light",
          modelNo: "SOL-100W",
          category: "太阳能",
          salePrice: "28.75",
          moq: "20PCS",
          ctnQty: "1",
          ctnLength: "78",
          ctnWidth: "32",
          ctnHeight: "18",
          productParams: [
            { paramKey: "watts", normalizedValue: "100", unit: "W", rawValue: "100W" },
            { paramKey: "size_display", normalizedValue: "650×260×80", unit: "mm", rawValue: "650*260*80mm" },
            { paramKey: "material", normalizedValue: "ABS", unit: null, rawValue: "ABS" },
            { paramKey: "cct", normalizedValue: "6500", unit: "K", rawValue: "6500K" },
            { paramKey: "cri", normalizedValue: "70", unit: null, rawValue: "Ra70" },
            { paramKey: "pf", normalizedValue: "0.9", unit: null, rawValue: "PF0.9" },
            { paramKey: "ip", normalizedValue: "65", unit: null, rawValue: "IP65" },
            { paramKey: "beam_angle", normalizedValue: "120", unit: "°", rawValue: "120°" },
            { paramKey: "lumens", normalizedValue: "12000", unit: "lm", rawValue: "12000lm" },
          ],
        },
      ],
    };

    try {
      await writeQuoteWorkbook(solarQuote, filePath, { customerMode: true });

      const workbook = await loadWorkbook(filePath);
      const sheet = workbook.getWorksheet("Solar LED Light");

      expect(sheet).toBeDefined();
      expect(sheet?.getRow(1).values).toEqual([
        undefined,
        "Photo",
        "No.",
        "Model No.",
        "Power",
        "Size",
        "Material",
        "CCT",
        "CRI",
        "PF",
        "IP",
        "Beam Angle",
        "Lumens",
        "FOB Price",
        "MOQ",
        "CTN QTY",
        "CTN Size",
        "Volume",
      ]);
      expect(sheet?.getCell("C2").value).toBe("SOL-100W");
      expect(sheet?.getCell("D2").value).toBe("100W");
      expect(sheet?.getCell("E2").value).toBe("650×260×80");
      expect(sheet?.getCell("F2").value).toBe("ABS");
      expect(sheet?.getCell("G2").value).toBe("6500K");
      expect(sheet?.getCell("H2").value).toBe("Ra70");
      expect(sheet?.getCell("I2").value).toBe("0.9");
      expect(sheet?.getCell("J2").value).toBe("IP65");
      expect(sheet?.getCell("K2").value).toBe("120°");
      expect(sheet?.getCell("L2").value).toBe("12000lm");
      expect(sheet?.getCell("M2").value).toBe(28.75);
      expect(sheet?.getCell("N2").value).toBe("20");
      expect(sheet?.getCell("P2").value).toBe("78 × 32 × 18");
      expect(sheet?.getCell("Q2").value).toBe(0.045);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  type FinalTemplateCase = {
    name: string;
    category: string;
    sheetName: string;
    modelNo: string;
    headers: string[];
    saleCell: string;
    salePrice: number;
    extraParams?: { paramKey: string; normalizedValue: string; unit: string | null; rawValue: string }[];
    extraChecks?: [string, string | number][];
  };

  const finalTemplateCases: FinalTemplateCase[] = [
    {
      name: "wall lamp",
      category: "壁灯",
      sheetName: "LED Wall Lamp",
      modelNo: "WL-12W",
      saleCell: "K2",
      salePrice: 7.2,
      headers: [
        "No.",
        "Model No.",
        "Power",
        "Size",
        "Material",
        "CCT",
        "CRI",
        "Voltage",
        "Driver",
        "FOB Price",
        "MOQ",
        "CTN QTY",
        "CTN Size",
        "Volume",
      ],
      extraParams: [{ paramKey: "driver_type", normalizedValue: "DOB", unit: null, rawValue: "DOB" }],
      extraChecks: [["J2", "DOB"]],
    },
    {
      name: "purification light",
      category: "净化灯",
      sheetName: "LED Purification Light",
      modelNo: "PL-40W",
      saleCell: "L2",
      salePrice: 8.4,
      headers: [
        "No.",
        "Model No.",
        "Power",
        "Size",
        "CCT",
        "CRI",
        "PF",
        "Voltage",
        "Driver",
        "Luminous Efficacy",
        "FOB Price",
        "MOQ",
        "CTN QTY",
        "CTN Size",
        "Volume",
      ],
      extraParams: [
        { paramKey: "pf", normalizedValue: "0.9", unit: null, rawValue: "PF0.9" },
        { paramKey: "driver_type", normalizedValue: "Isolated", unit: null, rawValue: "Isolated" },
        { paramKey: "luminous_efficacy", normalizedValue: "120", unit: "lm/W", rawValue: "120lm/W" },
      ],
      extraChecks: [["K2", "120lm/W"]],
    },
    {
      name: "street light",
      category: "路灯",
      sheetName: "LED Street Light",
      modelNo: "SL-100W",
      saleCell: "M2",
      salePrice: 25.5,
      headers: [
        "No.",
        "Model No.",
        "Power",
        "Size",
        "CCT",
        "CRI",
        "PF",
        "Voltage",
        "IP",
        "Beam Angle",
        "Luminous Efficacy",
        "FOB Price",
        "MOQ",
        "CTN QTY",
        "CTN Size",
        "Volume",
      ],
      extraParams: [
        { paramKey: "pf", normalizedValue: "0.95", unit: null, rawValue: "PF0.95" },
        { paramKey: "ip", normalizedValue: "65", unit: null, rawValue: "IP65" },
        { paramKey: "beam_angle", normalizedValue: "120", unit: "°", rawValue: "120°" },
        { paramKey: "luminous_efficacy", normalizedValue: "150", unit: "lm/W", rawValue: "150lm/W" },
      ],
      extraChecks: [["J2", "IP65"]],
    },
    {
      name: "cabinet light",
      category: "橱柜灯",
      sheetName: "LED Cabinet Light",
      modelNo: "CB-10W",
      saleCell: "K2",
      salePrice: 3.6,
      headers: [
        "No.",
        "Model No.",
        "Power",
        "Size",
        "Material",
        "CCT",
        "CRI",
        "Voltage",
        "IP",
        "FOB Price",
        "MOQ",
        "CTN QTY",
        "CTN Size",
        "Volume",
      ],
      extraParams: [{ paramKey: "ip", normalizedValue: "20", unit: null, rawValue: "IP20" }],
      extraChecks: [["J2", "IP20"]],
    },
    {
      name: "mirror light",
      category: "镜前灯",
      sheetName: "LED Mirror Light",
      modelNo: "ML-18W",
      saleCell: "M2",
      salePrice: 6.8,
      headers: [
        "No.",
        "Model No.",
        "Power",
        "Size",
        "Material",
        "CCT",
        "CRI",
        "Voltage",
        "IP",
        "Driver",
        "Luminous Efficacy",
        "FOB Price",
        "MOQ",
        "CTN QTY",
        "CTN Size",
        "Volume",
      ],
      extraParams: [
        { paramKey: "ip", normalizedValue: "44", unit: null, rawValue: "IP44" },
        { paramKey: "driver_type", normalizedValue: "Isolated", unit: null, rawValue: "Isolated" },
        { paramKey: "luminous_efficacy", normalizedValue: "100", unit: "lm/W", rawValue: "100lm/W" },
      ],
      extraChecks: [["L2", "100lm/W"]],
    },
    {
      name: "string light",
      category: "皮线灯",
      sheetName: "LED String Light",
      modelNo: "STR-5W",
      saleCell: "I2",
      salePrice: 2.1,
      headers: [
        "No.",
        "Model No.",
        "Power",
        "CCT",
        "Voltage",
        "Size",
        "Material",
        "FOB Price",
        "MOQ",
        "CTN QTY",
        "CTN Size",
        "Volume",
      ],
      extraChecks: [["E2", "3000K/6500K"]],
    },
    {
      name: "track light",
      category: "轨道灯",
      sheetName: "LED Track Light",
      modelNo: "TR-20W",
      saleCell: "K2",
      salePrice: 5.7,
      headers: [
        "No.",
        "Model No.",
        "Power",
        "Size",
        "CCT",
        "CRI",
        "PF",
        "Voltage",
        "Beam Angle",
        "FOB Price",
        "MOQ",
        "CTN QTY",
        "CTN Size",
        "Volume",
      ],
      extraParams: [
        { paramKey: "pf", normalizedValue: "0.9", unit: null, rawValue: "PF0.9" },
        { paramKey: "beam_angle", normalizedValue: "36", unit: "°", rawValue: "36°" },
      ],
      extraChecks: [["J2", "36°"]],
    },
    {
      name: "moisture-proof light",
      category: "防潮灯",
      sheetName: "LED Moisture-proof Light",
      modelNo: "MP-18W",
      saleCell: "M2",
      salePrice: 4.8,
      headers: [
        "No.",
        "Model No.",
        "Power",
        "Size",
        "Material",
        "CCT",
        "CRI",
        "PF",
        "Voltage",
        "IP",
        "Driver",
        "FOB Price",
        "MOQ",
        "CTN QTY",
        "CTN Size",
        "Volume",
      ],
      extraParams: [
        { paramKey: "pf", normalizedValue: "0.9", unit: null, rawValue: "PF0.9" },
        { paramKey: "ip", normalizedValue: "65", unit: null, rawValue: "IP65" },
        { paramKey: "driver_type", normalizedValue: "DOB", unit: null, rawValue: "DOB" },
      ],
      extraChecks: [["L2", "DOB"]],
    },
    {
      name: "emergency light",
      category: "应急灯",
      sheetName: "LED Emergency Light",
      modelNo: "EM-12W",
      saleCell: "I2",
      salePrice: 6.2,
      headers: [
        "No.",
        "Model No.",
        "Power",
        "Size",
        "Material",
        "CCT",
        "Voltage",
        "FOB Price",
        "MOQ",
        "CTN QTY",
        "CTN Size",
        "Volume",
      ],
      extraChecks: [["H2", "220-240V"]],
    },
    {
      name: "tube",
      category: "灯管",
      sheetName: "LED Tube",
      modelNo: "T8-18W",
      saleCell: "L2",
      salePrice: 2.9,
      headers: [
        "No.",
        "Model No.",
        "Power",
        "Size",
        "CCT",
        "CRI",
        "PF",
        "Voltage",
        "Lumens",
        "Luminous Efficacy",
        "FOB Price",
        "MOQ",
        "CTN QTY",
        "CTN Size",
        "Volume",
      ],
      extraParams: [
        { paramKey: "pf", normalizedValue: "0.9", unit: null, rawValue: "PF0.9" },
        { paramKey: "lumens", normalizedValue: "1800", unit: "lm", rawValue: "1800lm" },
        { paramKey: "luminous_efficacy", normalizedValue: "100", unit: "lm/W", rawValue: "100lm/W" },
      ],
      extraChecks: [["J2", "1800lm"]],
    },
    {
      name: "inground light",
      category: "地埋灯/地插灯",
      sheetName: "LED Inground Light",
      modelNo: "IG-9W",
      saleCell: "M2",
      salePrice: 9.9,
      headers: [
        "No.",
        "Model No.",
        "Power",
        "Size",
        "Material",
        "CCT",
        "CRI",
        "PF",
        "Voltage",
        "IP",
        "Beam Angle",
        "FOB Price",
        "MOQ",
        "CTN QTY",
        "CTN Size",
        "Volume",
      ],
      extraParams: [
        { paramKey: "pf", normalizedValue: "0.9", unit: null, rawValue: "PF0.9" },
        { paramKey: "ip", normalizedValue: "67", unit: null, rawValue: "IP67" },
        { paramKey: "beam_angle", normalizedValue: "30", unit: "°", rawValue: "30°" },
      ],
      extraChecks: [["K2", "IP67"]],
    },
    {
      name: "work light",
      category: "工作灯",
      sheetName: "LED Work Light",
      modelNo: "WK-30W",
      saleCell: "M2",
      salePrice: 12.4,
      headers: [
        "No.",
        "Model No.",
        "Power",
        "Size",
        "Material",
        "CCT",
        "CRI",
        "Voltage",
        "IP",
        "Beam Angle",
        "Luminous Efficacy",
        "FOB Price",
        "MOQ",
        "CTN QTY",
        "CTN Size",
        "Volume",
      ],
      extraParams: [
        { paramKey: "ip", normalizedValue: "65", unit: null, rawValue: "IP65" },
        { paramKey: "beam_angle", normalizedValue: "120", unit: "°", rawValue: "120°" },
        { paramKey: "luminous_efficacy", normalizedValue: "110", unit: "lm/W", rawValue: "110lm/W" },
      ],
      extraChecks: [["L2", "110lm/W"]],
    },
    {
      name: "garden light",
      category: "庭院灯",
      sheetName: "LED Garden Light",
      modelNo: "GD-20W",
      saleCell: "K2",
      salePrice: 13.5,
      headers: [
        "No.",
        "Model No.",
        "Power",
        "Size",
        "Material",
        "CCT",
        "Voltage",
        "IP",
        "Lumens",
        "FOB Price",
        "MOQ",
        "CTN QTY",
        "CTN Size",
        "Volume",
      ],
      extraParams: [
        { paramKey: "ip", normalizedValue: "65", unit: null, rawValue: "IP65" },
        { paramKey: "lumens", normalizedValue: "2000", unit: "lm", rawValue: "2000lm" },
      ],
      extraChecks: [["J2", "2000lm"]],
    },
    {
      name: "G4/G9 bulb",
      category: "G4G9",
      sheetName: "LED G4-G9 Bulb",
      modelNo: "G9-5W",
      saleCell: "K2",
      salePrice: 1.6,
      headers: [
        "No.",
        "Model No.",
        "Power",
        "Base",
        "Size",
        "CCT",
        "CRI",
        "Voltage",
        "Luminous Efficacy",
        "FOB Price",
        "MOQ",
        "CTN QTY",
        "CTN Size",
        "Volume",
      ],
      extraParams: [
        { paramKey: "base", normalizedValue: "G9", unit: null, rawValue: "G9" },
        { paramKey: "luminous_efficacy", normalizedValue: "90", unit: "lm/W", rawValue: "90lm/W" },
      ],
      extraChecks: [["E2", "G9"]],
    },
    {
      name: "highbay",
      category: "Highbay",
      sheetName: "LED Highbay",
      modelNo: "HB-150W",
      saleCell: "N2",
      salePrice: 36.5,
      headers: [
        "No.",
        "Model No.",
        "Power",
        "Size",
        "CCT",
        "CRI",
        "PF",
        "Voltage",
        "IP",
        "Beam Angle",
        "Luminous Efficacy",
        "Driver",
        "FOB Price",
        "MOQ",
        "CTN QTY",
        "CTN Size",
        "Volume",
      ],
      extraParams: [
        { paramKey: "pf", normalizedValue: "0.95", unit: null, rawValue: "PF0.95" },
        { paramKey: "ip", normalizedValue: "65", unit: null, rawValue: "IP65" },
        { paramKey: "beam_angle", normalizedValue: "90", unit: "°", rawValue: "90°" },
        { paramKey: "luminous_efficacy", normalizedValue: "170", unit: "lm/W", rawValue: "170lm/W" },
        { paramKey: "driver_type", normalizedValue: "Isolated", unit: null, rawValue: "Isolated" },
      ],
      extraChecks: [["M2", "Isolated"]],
    },
    {
      name: "desk lamp",
      category: "台灯",
      sheetName: "LED Desk Lamp",
      modelNo: "DLAMP-8W",
      saleCell: "J2",
      salePrice: 5.4,
      headers: [
        "No.",
        "Model No.",
        "Power",
        "Size",
        "Material",
        "CCT",
        "CRI",
        "Voltage",
        "FOB Price",
        "MOQ",
        "CTN QTY",
        "CTN Size",
        "Volume",
      ],
      extraChecks: [["I2", "220-240V"]],
    },
  ];

  test.each(finalTemplateCases)("uses the $name template when all items share its category", async (templateCase) => {
    const dir = await mkdtemp(join(tmpdir(), "quote-export-"));
    const filePath = join(dir, `${templateCase.name.replace(/[^a-z0-9]+/gi, "-")}.xlsx`);
    const finalTemplateQuote = {
      ...quote,
      items: [
        {
          ...quote.items[0],
          productName: templateCase.sheetName,
          modelNo: templateCase.modelNo,
          category: templateCase.category,
          salePrice: String(templateCase.salePrice),
          moq: "100PCS",
          ctnQty: "12",
          ctnLength: "50",
          ctnWidth: "40",
          ctnHeight: "30",
          material: "Raw Material",
          size: "Raw Size",
          productParams: [
            { paramKey: "watts", normalizedValue: "12", unit: "W", rawValue: "12W" },
            { paramKey: "size_display", normalizedValue: "120×80×40", unit: "mm", rawValue: "120*80*40mm" },
            { paramKey: "material", normalizedValue: "Aluminum", unit: null, rawValue: "Aluminum" },
            { paramKey: "cct", normalizedValue: "3000/6500", unit: "K", rawValue: "3000K/6500K" },
            { paramKey: "cri", normalizedValue: "80", unit: null, rawValue: "Ra80" },
            { paramKey: "voltage", normalizedValue: "220-240", unit: "V", rawValue: "AC220-240V" },
            ...(templateCase.extraParams ?? []),
          ],
        },
      ],
    };

    try {
      await writeQuoteWorkbook(finalTemplateQuote, filePath, { customerMode: true });

      const workbook = await loadWorkbook(filePath);
      const sheet = workbook.getWorksheet(templateCase.sheetName);

      expect(sheet).toBeDefined();
      expect(sheet?.getRow(1).values).toEqual([undefined, "Photo", ...templateCase.headers]);
      expect(sheet?.getCell("C2").value).toBe(templateCase.modelNo);
      expect(sheet?.getCell("D2").value).toBe("12W");
      expect(sheet?.getCell(templateCase.saleCell).value).toBe(templateCase.salePrice);
      for (const [cell, expected] of templateCase.extraChecks ?? []) {
        expect(sheet?.getCell(cell).value).toBe(expected);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("writes the internal mode workbook with factory and purchase columns", async () => {
    const dir = await mkdtemp(join(tmpdir(), "quote-export-"));
    const filePath = join(dir, "quote.xlsx");

    try {
      await writeQuoteWorkbook(quote, filePath, { customerMode: false });

      const bytes = await readFile(filePath);
      expect(bytes.length).toBeGreaterThan(0);

      const workbook = await loadWorkbook(filePath);
      const sheet = workbook.getWorksheet("报价单");

      expect(sheet).toBeDefined();
      expect(sheet?.getCell("A1").value).toBe("报价单");
      expect(sheet?.getCell("A3").value).toBe("客户");
      expect(sheet?.getCell("B3").value).toBe("ACME");
      expect(sheet?.getCell("B6").value).toBe("Model Name");
      expect(sheet?.getCell("B8").value).toBe("COB-120");
      expect(sheet?.getCell("D4").value).toBe("汇率（1 USD = ? RMB）");
      expect(sheet?.getRow(6).values).toEqual([
        undefined,
        "Photo",
        "Model Name",
        "Product Details",
        "Factory Name",
        "Purchase Price",
        "Unit Price",
        "MOQ",
        "CTN Qty",
        "Carton Size",
        "Carton Size",
        "Carton Size",
        "Carton Size",
        "Remark",
      ]);
      expect(sheet?.getRow(7).values).toEqual([
        undefined,
        "Photo",
        "Model Name",
        "Product Details",
        "Factory Name",
        "Purchase Price",
        "Unit Price",
        "MOQ",
        "CTN Qty",
        "L",
        "W",
        "H",
        "Volume",
        "Remark",
      ]);
      expect(sheet?.getCell("F8").value).toBe(1.67);
      expect(sheet?.getCell("G8").value).toBe("1000");
      expect(sheet?.getCell("I8").value).toBe("52.3 cm");
      expect(sheet?.getCell("J8").value).toBe("49.5 cm");
      expect(sheet?.getCell("K8").value).toBe("27.4 cm");
      expect(sheet?.getCell("L8").value).toBe("0.071 m³");
      expect(sheet?.autoFilter).toEqual("A7:M7");
      expect(sheet?.views[0]).toMatchObject({ state: "frozen", ySplit: 7, topLeftCell: "A8" });
      expect(sheet?.getColumn(2).width).toBeGreaterThanOrEqual(18);
      expect(sheet?.getColumn(3).width).toBe(48);
      expect(sheet?.getCell("C8").value).toBe("COB light strip\n120 LEDs/m\nSize: 8mm");
      expect(sheet?.getCell("B6").border?.bottom?.style).toBe("thin");
      expect(sheet?.getCell("B6").fill).toMatchObject({
        fgColor: { argb: "FF3F4A35" },
      });
      expect(sheet?.getCell("I7").fill).toMatchObject({
        fgColor: { argb: "FF6B7A5A" },
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("omits factory and purchase price columns in customer mode", async () => {
    const dir = await mkdtemp(join(tmpdir(), "quote-export-"));
    const filePath = join(dir, "quote-customer.xlsx");

    try {
      await writeQuoteWorkbook(quote, filePath, { customerMode: true });

      const workbook = await loadWorkbook(filePath);
      const sheet = workbook.getWorksheet("报价单");

      expect(sheet?.getRow(6).values).toEqual([
        undefined,
        "Photo",
        "Model Name",
        "Product Details",
        "Unit Price",
        "MOQ",
        "CTN Qty",
        "Carton Size",
        "Carton Size",
        "Carton Size",
        "Carton Size",
        "Remark",
      ]);
      expect(sheet?.getRow(7).values).toEqual([
        undefined,
        "Photo",
        "Model Name",
        "Product Details",
        "Unit Price",
        "MOQ",
        "CTN Qty",
        "L",
        "W",
        "H",
        "Volume",
        "Remark",
      ]);
      expect(sheet?.getRow(6).values).not.toContain("Factory Name");
      expect(sheet?.getRow(6).values).not.toContain("Purchase Price");
      expect(sheet?.getCell("B8").value).toBe("COB-120");
      expect(sheet?.getCell("C8").value).toBe("COB light strip\n120 LEDs/m\nSize: 8mm");
      expect(sheet?.getCell("D8").value).toBe(1.67);
      expect(sheet?.getCell("E8").value).toBe("1000");
      expect(sheet?.getCell("F8").value).toBe("10");
      expect(sheet?.getCell("G8").value).toBe("52.3 cm");
      expect(sheet?.getCell("H8").value).toBe("49.5 cm");
      expect(sheet?.getCell("I8").value).toBe("27.4 cm");
      expect(sheet?.getCell("J8").value).toBe("0.071 m³");
      expect(sheet?.autoFilter).toEqual("A7:K7");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("cleans invalid MOQ text and removes duplicated model prefix from product details", async () => {
    const dir = await mkdtemp(join(tmpdir(), "quote-export-"));
    const filePath = join(dir, "quote-clean-details.xlsx");
    const quoteWithDirtyText = {
      ...quote,
      items: [
        {
          ...quote.items[0],
          productName: "GU10-3.3W",
          modelNo: "GU10-3.3W",
          moq: "MOQ",
          productRemark: "GU10-3.3W / 3.3W / GU10",
          size: "Φ50*55",
        },
        {
          ...quote.items[0],
          productName: "Package only",
          modelNo: "PKG-1",
          moq: "Package",
          productRemark: "PKG-1",
          size: null,
        },
      ],
    };

    try {
      await writeQuoteWorkbook(quoteWithDirtyText, filePath, { customerMode: true });

      const workbook = await loadWorkbook(filePath);
      const sheet = workbook.getWorksheet("报价单");

      expect(sheet?.getCell("C8").value).toBe("3.3W / GU10\nSize: Φ50*55");
      expect(sheet?.getCell("E8").value).toBe("");
      expect(sheet?.getCell("C9").value).toBe("Package only");
      expect(sheet?.getCell("E9").value).toBe("");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
