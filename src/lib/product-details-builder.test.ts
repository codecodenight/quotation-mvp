import { describe, expect, test } from "vitest";

import { buildProductDetailsFromParams } from "./product-details-builder";

describe("buildProductDetailsFromParams", () => {
  test("generates structured details from params in a fixed order", () => {
    const result = buildProductDetailsFromParams([
      { paramKey: "watts", normalizedValue: "18", unit: "W", rawValue: "18W" },
      { paramKey: "ip", normalizedValue: "IP65", unit: null, rawValue: "IP65" },
      { paramKey: "cct", normalizedValue: "3000-6500", unit: "K", rawValue: "3000-6500K" },
      { paramKey: "voltage", normalizedValue: "AC220-240V", unit: "V", rawValue: "AC220-240V" },
      { paramKey: "size_display", normalizedValue: "90x66x23mm", unit: null, rawValue: "90*66*23" },
    ]);

    expect(result).toBe("Power: 18W\nCCT: 3000-6500K\nIP: IP65\nSize: 90x66x23mm\nVoltage: AC220-240V");
  });

  test("returns null when fewer than 2 displayable params exist", () => {
    expect(
      buildProductDetailsFromParams([{ paramKey: "watts", normalizedValue: "18", unit: "W", rawValue: "18W" }]),
    ).toBeNull();
  });

  test("skips params with empty normalized value", () => {
    const result = buildProductDetailsFromParams([
      { paramKey: "watts", normalizedValue: "18", unit: "W", rawValue: "18W" },
      { paramKey: "ip", normalizedValue: "", unit: null, rawValue: "IP65" },
      { paramKey: "cct", normalizedValue: "3000", unit: "K", rawValue: "3000K" },
    ]);

    expect(result).toBe("Power: 18W\nCCT: 3000K");
  });

  test("ignores unknown param keys covered by size_display", () => {
    const result = buildProductDetailsFromParams([
      { paramKey: "watts", normalizedValue: "18", unit: "W", rawValue: "18W" },
      { paramKey: "length_mm", normalizedValue: "300", unit: "mm", rawValue: "300" },
      { paramKey: "height_mm", normalizedValue: "55", unit: "mm", rawValue: "55" },
      { paramKey: "cct", normalizedValue: "4000", unit: "K", rawValue: "4000K" },
    ]);

    expect(result).toBe("Power: 18W\nCCT: 4000K");
  });

  test("appends degree sign to beam angle if missing", () => {
    const result = buildProductDetailsFromParams([
      { paramKey: "watts", normalizedValue: "50", unit: "W", rawValue: "50W" },
      { paramKey: "beam_angle", normalizedValue: "120", unit: null, rawValue: "120" },
      { paramKey: "luminous_efficacy", normalizedValue: "80-90", unit: "lm/W", rawValue: "80-90lm/W" },
    ]);

    expect(result).toBe("Power: 50W\nBeam Angle: 120°\nLuminous Efficacy: 80-90 lm/W");
  });
});
