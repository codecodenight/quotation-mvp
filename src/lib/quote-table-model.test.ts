import { describe, expect, test } from "vitest";

import type { QuoteWorkbookData } from "./quote-export";
import { buildQuotePreview } from "./quote-preview";
import { buildQuoteTableModel } from "./quote-table-model";

const panelItem = {
  productId: "product-panel",
  supplierOfferId: "offer-panel",
  productName: "LED Slim Panel Light",
  modelNo: "PNL-36W",
  category: "面板灯",
  factoryName: "Panel Factory",
  purchasePrice: "50",
  purchaseCurrency: "RMB",
  salePrice: "8.5",
  quantity: 1,
  moq: "500PCS",
  ctnQty: "8",
  ctnLength: "62",
  ctnWidth: "62",
  ctnHeight: "28",
  material: "PS",
  size: "600x600",
  productRemark: "LED Slim Panel Light",
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
  remark: "customer note",
};

const mixedItem = {
  productId: "product-flood",
  supplierOfferId: "offer-flood",
  productName: "LED Flood Light",
  modelNo: "FL-50W",
  category: "投光灯",
  factoryName: "Flood Factory",
  purchasePrice: "72",
  purchaseCurrency: "RMB",
  salePrice: "12",
  quantity: 1,
  moq: "1000/色",
  ctnQty: "4",
  ctnLength: "45",
  ctnWidth: "32",
  ctnHeight: "28",
  material: "Aluminum",
  size: "280x220x45",
  productRemark: "Power: 50W\nMaterial: Aluminum",
  productParams: [],
  remark: null,
};

const baseQuote = {
  id: "quote-1",
  customerName: "ACME",
  currency: "USD",
  profitMargin: "0.2",
  exchangeRate: "7.2",
  createdAt: new Date("2026-06-05T08:00:00.000Z"),
};

function quoteWithItems(items: unknown[]): QuoteWorkbookData {
  return { ...baseQuote, items } as QuoteWorkbookData;
}

describe("buildQuoteTableModel", () => {
  test("uses template columns and keyed cells for a single-category customer quote", () => {
    const model = buildQuoteTableModel(quoteWithItems([panelItem]), { customerMode: true });

    expect(model.templateId).toBe("panel");
    expect(model.customerMode).toBe(true);
    expect(model.columns.map((column) => column.key)).toEqual([
      "image",
      "no",
      "modelNo",
      "power",
      "size",
      "material",
      "cct",
      "cri",
      "pf",
      "voltage",
      "driver",
      "ip",
      "salePrice",
      "moq",
      "ctnQty",
      "ctnSize",
      "volume",
    ]);
    expect(model.columns.map((column) => column.header)).toContain("FOB Price");
    expect(model.rows[0]).toMatchObject({
      productId: "product-panel",
      supplierOfferId: "offer-panel",
      cells: {
        image: null,
        no: 1,
        modelNo: "PNL-36W",
        power: "36W",
        size: "600×600×10",
        material: "PS+Aluminum",
        cct: "4000K",
        cri: "Ra80",
        pf: "0.9",
        voltage: "220-240V",
        driver: "Isolated",
        ip: "IP20",
        salePrice: 8.5,
        moq: "500",
        ctnQty: "8",
        ctnSize: "62 × 62 × 28",
        volume: 0.108,
      },
    });
    expect(model.rows[0].cells).not.toHaveProperty("factoryName");
    expect(model.rows[0].cells).not.toHaveProperty("purchasePrice");
  });

  test("adds internal columns to template quotes without changing template column order otherwise", () => {
    const model = buildQuoteTableModel(quoteWithItems([panelItem]), { customerMode: false });

    expect(model.columns.map((column) => column.key)).toEqual([
      "image",
      "no",
      "modelNo",
      "factoryName",
      "power",
      "size",
      "material",
      "cct",
      "cri",
      "pf",
      "voltage",
      "driver",
      "ip",
      "purchasePrice",
      "salePrice",
      "moq",
      "ctnQty",
      "ctnSize",
      "volume",
    ]);
    expect(model.rows[0].cells.factoryName).toBe("Panel Factory");
    expect(model.rows[0].cells.purchasePrice).toBe("50.00 RMB");
  });

  test("uses generic columns for mixed-category customer quotes", () => {
    const model = buildQuoteTableModel(quoteWithItems([panelItem, mixedItem]), { customerMode: true });

    expect(model.templateId).toBe("generic");
    expect(model.columns.map((column) => column.key)).toEqual([
      "image",
      "modelNo",
      "productDetails",
      "salePrice",
      "moq",
      "ctnQty",
      "ctnLength",
      "ctnWidth",
      "ctnHeight",
      "ctnVolume",
      "remark",
    ]);
    expect(model.rows[0].cells).toMatchObject({
      image: null,
      modelNo: "PNL-36W",
      salePrice: 8.5,
      moq: "500",
      ctnLength: "62 cm",
      ctnWidth: "62 cm",
      ctnHeight: "28 cm",
      ctnVolume: "0.108 m³",
      remark: "customer note",
    });
    expect(String(model.rows[0].cells.productDetails)).toContain("Power: 36W");
  });

  test("adds internal columns to generic quotes", () => {
    const model = buildQuoteTableModel(quoteWithItems([panelItem, mixedItem]), { customerMode: false });

    expect(model.columns.map((column) => column.key)).toEqual([
      "image",
      "modelNo",
      "productDetails",
      "factoryName",
      "purchasePrice",
      "salePrice",
      "moq",
      "ctnQty",
      "ctnLength",
      "ctnWidth",
      "ctnHeight",
      "ctnVolume",
      "remark",
    ]);
    expect(model.rows[0].cells.factoryName).toBe("Panel Factory");
    expect(model.rows[0].cells.purchasePrice).toBe("50.00 RMB");
  });

  test("adds a photo column and keeps image paths in row cells", () => {
    const imagePath = "/tmp/quote-product-image.jpg";
    const model = buildQuoteTableModel(quoteWithItems([{ ...panelItem, imagePath }]), { customerMode: true });

    expect(model.columns[0]).toMatchObject({ key: "image", header: "Photo", width: 12, align: "center" });
    expect(model.rows[0].cells.image).toBe(imagePath);
  });

  test("keeps photo as the first column in internal mode", () => {
    const model = buildQuoteTableModel(quoteWithItems([{ ...panelItem, imagePath: null }]), { customerMode: false });

    expect(model.columns.slice(0, 4).map((column) => column.key)).toEqual([
      "image",
      "no",
      "modelNo",
      "factoryName",
    ]);
    expect(model.rows[0].cells.image).toBeNull();
  });

  test("preview exposes the same columns and keyed cells as the shared table model", () => {
    const preview = buildQuotePreview({
      customerName: baseQuote.customerName,
      currency: baseQuote.currency,
      profitMargin: baseQuote.profitMargin,
      exchangeRate: baseQuote.exchangeRate,
      customerMode: true,
      items: [panelItem],
    });
    const model = buildQuoteTableModel(quoteWithItems([{ ...panelItem, salePrice: "8.33" }]), { customerMode: true });

    expect(preview.columns).toEqual(model.columns);
    expect(preview.rows.map((row) => row.cells)).toEqual(model.rows.map((row) => row.cells));
  });
});
