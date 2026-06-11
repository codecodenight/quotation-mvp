import { describe, expect, test } from "vitest";

import {
  extractCct,
  extractLmW,
  extractPf,
  extractProductParamsForTest,
  type ProductForExtraction,
} from "../../scripts/extract-params";

function product(overrides: Partial<ProductForExtraction>): ProductForExtraction {
  return {
    id: "product-id",
    productName: overrides.productName ?? overrides.modelNo ?? "Sample",
    category: overrides.category ?? "投光灯",
    modelNo: overrides.modelNo ?? null,
    material: overrides.material ?? null,
    size: overrides.size ?? null,
    remark: overrides.remark ?? null,
    supplierOffers: overrides.supplierOffers ?? [],
  };
}

describe("V3.0B parameter extraction", () => {
  test("extracts CCT, PF, and lm/W from structured remark text", () => {
    expect(extractCct("CCT: 6000-6500K", "remark")).toMatchObject([
      { paramKey: "cct", normalizedValue: "6000-6500", unit: "K" },
    ]);
    expect(extractPf("PF>0.9", "remark")).toMatchObject([
      { paramKey: "pf", normalizedValue: "0.9", unit: null },
    ]);
    expect(extractLmW("Lumen: 90-100lm/w", "remark")).toMatchObject([
      { paramKey: "luminous_efficacy", normalizedValue: "90-100", unit: "lm/W" },
    ]);
  });

  test("extracts floodlight structured remark fields", () => {
    const params = extractProductParamsForTest(
      product({
        category: "投光灯",
        modelNo: "FL-10W-IP65",
        remark: "Watt: 10W\nPF: 0.9\nVoltage: AC220-240V\nLM/W: 80-90LM/W\nCCT: 6000-6500K\nBeam Angle: 110°\nIP: 65\nMaterial: Die-cast Aluminum",
      }),
      "投光灯",
    );
    expect(params.map((param) => param.paramKey)).toEqual(
      expect.arrayContaining(["watts", "pf", "voltage", "luminous_efficacy", "cct", "beam_angle", "ip", "material"]),
    );
  });

  test("extracts panel size, shape, mount type, and backlight type", () => {
    const params = extractProductParamsForTest(
      product({
        category: "面板灯",
        modelNo: "Recessed backlit panel 36W",
        size: "300×1200",
        remark: "嵌入式 直下发光",
      }),
      "面板灯",
    );
    expect(params).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ paramKey: "panel_size", normalizedValue: "300×1200" }),
        expect.objectContaining({ paramKey: "shape", normalizedValue: "方" }),
        expect.objectContaining({ paramKey: "mount_type", normalizedValue: "嵌入" }),
        expect.objectContaining({ paramKey: "backlit", normalizedValue: "backlit" }),
      ]),
    );
  });

  test("extracts linear length, material, and series", () => {
    const params = extractProductParamsForTest(
      product({
        category: "线条灯",
        modelNo: "LWF-5040-1200 36W IP65",
        size: "1200*80*70",
        remark: "PC diffuser aluminum body",
      }),
      "线条灯",
    );
    expect(params).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ paramKey: "length_mm", normalizedValue: "1200" }),
        expect.objectContaining({ paramKey: "material", normalizedValue: "aluminum" }),
        expect.objectContaining({ paramKey: "series", normalizedValue: "LWF-5040" }),
      ]),
    );
  });

  test("prefers fixture watts over maximum connectable power", () => {
    const params = extractProductParamsForTest(
      product({
        category: "线条灯",
        modelNo: "100-265V",
        size: "300*50*55mm",
        remark:
          "功率: 10W\n色温: 3000K 4000K 6500K\n功率因数: >0.9\n材质: 铝+PC\n光效: 100\n尺寸: 300*50*55mm\n质保: 2年\n单组可连接最大功率: 1000W",
      }),
      "线条灯",
    );
    expect(params.find((param) => param.paramKey === "watts")).toMatchObject({
      rawValue: "10W",
      normalizedValue: "10",
    });
  });

  test("does not treat price-like size text as dimensions", () => {
    const params = extractProductParamsForTest(
      product({
        category: "线条灯",
        modelNo: "10",
        size: "￥35.00",
      }),
      "线条灯",
    );
    expect(params.some((param) => ["length_mm", "width_mm", "height_mm", "size_display"].includes(param.paramKey))).toBe(
      false,
    );
  });

  test("extracts street light structured remark fields", () => {
    const params = extractProductParamsForTest(
      product({
        category: "路灯",
        modelNo: "ST-50W",
        remark: "Power(±10%): 50W\nPF: PF>0.9\nMaterial: Aluminum+Plastic\nRa: 80\nBeam Angle: 85*140°\nLumen: 90-100lm/w",
      }),
      "路灯",
    );
    expect(params.map((param) => param.paramKey)).toEqual(
      expect.arrayContaining(["watts", "pf", "material", "cri", "beam_angle", "luminous_efficacy"]),
    );
  });

  test("extracts new LED strip remark format", () => {
    const params = extractProductParamsForTest(
      product({
        category: "灯带",
        modelNo: "RGB strip",
        remark:
          "Description: Item：5M LED RGB Strip Light LED Type：RGB5050 LED Qtys： 30D/M，150D Adaptor：24V 0.75A，18W Control： 24keys IR Control Waterproof：PU Coating， IP20 Product Size：L5000m*10mm",
      }),
      "灯带",
    );
    expect(params).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ paramKey: "led_type", normalizedValue: "RGB5050" }),
        expect.objectContaining({ paramKey: "voltage", normalizedValue: "DC24V" }),
        expect.objectContaining({ paramKey: "ip", normalizedValue: "IP20" }),
        expect.objectContaining({ paramKey: "leds_per_meter", normalizedValue: "30" }),
        expect.objectContaining({ paramKey: "width_mm", normalizedValue: "10" }),
        expect.objectContaining({ paramKey: "color", normalizedValue: "RGB" }),
      ]),
    );
  });
});
