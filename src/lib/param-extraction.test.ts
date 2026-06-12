import { describe, expect, test } from "vitest";

import {
  extractCct,
  extractLmW,
  extractPf,
  extractProductParamsForTest,
  type ProductForExtraction,
} from "../../scripts/extract-params";
import { resolveCategory } from "../../scripts/batch-import-v2.14";

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
    expect(extractLmW("LUMEN: 1400LM", "remark")).toEqual([]);
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

describe("V3.0C Batch 2 parameter extraction", () => {
  test("extracts clean room light structured Chinese fields", () => {
    const params = extractProductParamsForTest(
      product({
        category: "净化灯",
        modelNo: "高光效弧形H系列成本 - 75MM宽弧形H75款彩钢板净化灯双支灯条 - 1200*75*23 - 48W",
        size: "1200*75*23",
        remark:
          "规格（mm): 1200*75*23\n灯珠型号: 2835\n灯珠数量: 156\n功率(W): 48W\n色温（K): 6500K\n功率 因素(PF): 0.5\n显值(Ra）: 70\n光效（LM/W): 75-80\n备注: 0.14厚彩钢板，PP堵头，PP奶白罩，恒流IC驱动，质保2年",
      }),
      "净化灯" as never,
    );
    expect(params).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ paramKey: "watts", normalizedValue: "48" }),
        expect.objectContaining({ paramKey: "cct", normalizedValue: "6500" }),
        expect.objectContaining({ paramKey: "pf", normalizedValue: "0.5" }),
        expect.objectContaining({ paramKey: "cri", normalizedValue: "Ra70" }),
        expect.objectContaining({ paramKey: "luminous_efficacy", normalizedValue: "75-80" }),
        expect.objectContaining({ paramKey: "body_material", normalizedValue: "彩涂板" }),
        expect.objectContaining({ paramKey: "led_bars", normalizedValue: "2" }),
      ]),
    );
  });

  test("extracts downlight cutout, watts, CCT and material", () => {
    const params = extractProductParamsForTest(
      product({
        category: "筒灯",
        modelNo: "YB03-TPAR30-R",
        size: "φ135*35mm",
        remark: "整灯尺寸: φ135*35mm\n材质: 塑包铝\n开孔尺寸: 120mm\n电压: 110-240V\n光通量±10%: 1050LM\n功率±10%: 12W\n功率因数: 0.5\n色温: 2700K-6500K\n显指: 80",
      }),
      "筒灯" as never,
    );
    expect(params).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ paramKey: "diameter_mm", normalizedValue: "135" }),
        expect.objectContaining({ paramKey: "height_mm", normalizedValue: "35" }),
        expect.objectContaining({ paramKey: "cutout_mm", normalizedValue: "120" }),
        expect.objectContaining({ paramKey: "watts", normalizedValue: "12" }),
        expect.objectContaining({ paramKey: "cct", normalizedValue: "2700-6500" }),
        expect.objectContaining({ paramKey: "lumens", normalizedValue: "1050" }),
        expect.objectContaining({ paramKey: "material", normalizedValue: "塑包铝" }),
      ]),
    );
  });

  test("does not extract watts embedded in alphanumeric series codes", () => {
    const params = extractProductParamsForTest(
      product({
        category: "筒灯",
        modelNo: "10W COB",
        remark: "基本参数: XY-KD80W",
      }),
      "筒灯" as never,
    );
    expect(params.find((param) => param.paramKey === "watts")).toMatchObject({
      rawValue: "10W",
      normalizedValue: "10",
      sourceField: "model_no",
    });
  });

  test("extracts magnetic light module, track system and optical fields", () => {
    const params = extractProductParamsForTest(
      product({
        category: "磁吸灯",
        modelNo: "M05-ML-D80",
        size: "D80",
        remark: "规格/mm: D80\n功率: 5W\n电压: 24V\n显指: ≧90\n色温: 3000K/4000K/6000K\n质保: 3年\n材质: 铝+玻璃",
      }),
      "磁吸灯" as never,
    );
    expect(params).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ paramKey: "track_system", normalizedValue: "M05" }),
        expect.objectContaining({ paramKey: "module_type", normalizedValue: "linear" }),
        expect.objectContaining({ paramKey: "diameter_mm", normalizedValue: "80" }),
        expect.objectContaining({ paramKey: "watts", normalizedValue: "5" }),
        expect.objectContaining({ paramKey: "voltage", normalizedValue: "24V" }),
        expect.objectContaining({ paramKey: "cct", normalizedValue: "3000" }),
        expect.objectContaining({ paramKey: "material", normalizedValue: "铝+玻璃" }),
      ]),
    );
  });

  test("extracts moisture-proof light IP, material, PF and dimensions", () => {
    const params = extractProductParamsForTest(
      product({
        category: "防潮灯",
        modelNo: "MYF-1048L",
        size: "275*275*86",
        remark: "材质: 壳体压铸铝 PC罩，IP54\n产品尺寸（mm): 275*275*86\n外箱尺寸CM: 57.5*29.5*29.5",
      }),
      "防潮灯" as never,
    );
    expect(params).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ paramKey: "length_mm", normalizedValue: "275" }),
        expect.objectContaining({ paramKey: "width_mm", normalizedValue: "275" }),
        expect.objectContaining({ paramKey: "height_mm", normalizedValue: "86" }),
        expect.objectContaining({ paramKey: "ip", normalizedValue: "IP54" }),
        expect.objectContaining({ paramKey: "material", normalizedValue: "壳体压铸铝 PC罩，IP54" }),
      ]),
    );
  });
});

describe("V3.0D remaining category parameter extraction", () => {
  test("extracts filament bulb watts, lumens, base and size", () => {
    const params = extractProductParamsForTest(
      product({
        category: "灯丝灯",
        productName: "G95 Pumpkin Golden - 2W - E27 - 95*135",
        modelNo: "G95 - 2W - E27",
        size: "95*135",
        remark: "Watts: 2W\nLumens: 140Lm\nLED Chip Model: 1PCS\nProduct Size（mm): 95*138",
      }),
      "灯丝灯",
    );

    expect(params).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ paramKey: "watts", normalizedValue: "2" }),
        expect.objectContaining({ paramKey: "lumens", normalizedValue: "140" }),
        expect.objectContaining({ paramKey: "base", normalizedValue: "E27" }),
        expect.objectContaining({ paramKey: "size_display", normalizedValue: "95×135mm" }),
      ]),
    );
  });

  test("extracts solar wall light IP, lumens, CCT, battery and sensor", () => {
    const params = extractProductParamsForTest(
      product({
        category: "太阳能壁灯",
        productName: "Solar wall light 500LM",
        remark: "太阳能壁灯 IP65 500LM 色温6500±500K 感应角度120度 电池18650 1*2000MAH 3.7V PIR感应",
      }),
      "太阳能壁灯",
    );

    expect(params).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ paramKey: "ip", normalizedValue: "IP65" }),
        expect.objectContaining({ paramKey: "lumens", normalizedValue: "500" }),
        expect.objectContaining({ paramKey: "cct", normalizedValue: "6500±500" }),
        expect.objectContaining({ paramKey: "battery_spec", normalizedValue: "18650 1*2000MAH 3.7V" }),
        expect.objectContaining({ paramKey: "sensor", normalizedValue: "PIR" }),
      ]),
    );
  });

  test("extracts highbay structured fields", () => {
    const params = extractProductParamsForTest(
      product({
        category: "Highbay",
        modelNo: "HB-100W",
        size: "300*150",
        remark: "Watt (±5%): 100W\nMaterial: Aluminum+Optical Lens\nCCT: 3000K /4000K /6500K\nBeam Angle: 90°\nIP: 65",
      }),
      "Highbay",
    );

    expect(params).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ paramKey: "watts", normalizedValue: "100" }),
        expect.objectContaining({ paramKey: "material", normalizedValue: "Aluminum+Optical Lens" }),
        expect.objectContaining({ paramKey: "cct", normalizedValue: "3000" }),
        expect.objectContaining({ paramKey: "beam_angle", normalizedValue: "90" }),
        expect.objectContaining({ paramKey: "ip", normalizedValue: "IP65" }),
      ]),
    );
  });

  test("extracts in-ground light wattage, IP, CCT and material", () => {
    const params = extractProductParamsForTest(
      product({
        category: "地埋灯/地插灯",
        size: "Φ43*245MM",
        remark:
          "Specification: Φ43*245MM black housing+spike\nMaterial: die casting aluminum\nIP Grade：IP65\nCCT: 3000K\nWattage: 5WCOB\nBeam Angle: 60°",
      }),
      "地埋灯/地插灯",
    );

    expect(params).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ paramKey: "watts", normalizedValue: "5" }),
        expect.objectContaining({ paramKey: "ip", normalizedValue: "IP65" }),
        expect.objectContaining({ paramKey: "cct", normalizedValue: "3000" }),
        expect.objectContaining({ paramKey: "material", normalizedValue: "die casting aluminum" }),
        expect.objectContaining({ paramKey: "beam_angle", normalizedValue: "60" }),
      ]),
    );
  });

  test("extracts table lamp material from technical data", () => {
    const params = extractProductParamsForTest(
      product({
        category: "台灯",
        remark:
          "Technical Data: TB-A-01 Size: D12*H30 CM Material: Metal with powder coating+Pine bracket Function: ON/OFF Switch online",
      }),
      "台灯",
    );

    expect(params).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ paramKey: "material", normalizedValue: "Metal with powder coating+Pine bracket" }),
      ]),
    );
  });

  test("does not treat string-light bead count as a physical width", () => {
    const params = extractProductParamsForTest(
      product({
        category: "皮线灯",
        size: "5m/50珠",
        material: "铜线+LED",
      }),
      "皮线灯",
    );

    expect(params).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ paramKey: "length_mm", normalizedValue: "5000" }),
        expect.objectContaining({ paramKey: "size_display", normalizedValue: "5000mm" }),
      ]),
    );
    expect(params.some((param) => param.paramKey === "width_mm")).toBe(false);
  });
});

describe("V2.14 Batch import category mapping", () => {
  test("maps Batch 3 CSV category names to DB category names", () => {
    expect(resolveCategory("LED橱柜灯")).toBe("橱柜灯");
    expect(resolveCategory("市电壁灯")).toBe("壁灯");
    expect(resolveCategory("支架")).toBe("线条灯");
    expect(resolveCategory("风扇灯")).toBe("风扇灯");
  });
});
