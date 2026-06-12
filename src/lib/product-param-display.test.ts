import { describe, expect, test } from "vitest";

import { formatParamLabel, sortDisplayParams } from "./product-param-display";

describe("product param display helpers", () => {
  test("formats common params as compact customer-readable tags", () => {
    expect(formatParamLabel(param("watts", "18", "W"))).toBe("18W");
    expect(formatParamLabel(param("ip", "IP65", null))).toBe("IP65");
    expect(formatParamLabel(param("voltage", "AC220-240V", null))).toBe("AC220-240V");
    expect(formatParamLabel(param("cct", "3000", "K"))).toBe("3000K");
    expect(formatParamLabel(param("beam_angle", "120", null))).toBe("120°");
    expect(formatParamLabel(param("pf", "0.9", null))).toBe("PF 0.9");
    expect(formatParamLabel(param("luminous_efficacy", "95", "lm/W"))).toBe("95lm/W");
    expect(formatParamLabel(param("cutout_mm", "75", "mm"))).toBe("cutout_mm: 75mm");
  });

  test("sorts priority params before lower-priority params", () => {
    const sorted = sortDisplayParams([
      param("pf", "0.9", null),
      param("material", "Aluminum", null),
      param("watts", "18", "W"),
      param("ip", "IP65", null),
      param("cct", "3000", "K"),
    ]);

    expect(sorted.map((item) => item.paramKey)).toEqual(["watts", "ip", "cct", "material", "pf"]);
  });

  test("falls back to raw value when normalized value is empty", () => {
    expect(formatParamLabel({ ...param("material", "", null), rawValue: "铝材" })).toBe("铝材");
  });
});

function param(paramKey: string, normalizedValue: string | null, unit: string | null) {
  return {
    paramKey,
    rawValue: normalizedValue ?? "",
    normalizedValue,
    unit,
    confidence: "medium",
  };
}
