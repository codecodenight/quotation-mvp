import { describe, expect, test } from "vitest";

import { cleanParamValue, findModelColumnIndex, mapHeaderToParam, matchesProductIdentity, normalizeIdentity } from "./v23.0-excel-reextract-params";

describe("v23.0 excel reextract helpers", () => {
  test("maps common Excel headers to param keys", () => {
    expect(mapHeaderToParam("Power")?.paramKey).toBe("watts");
    expect(mapHeaderToParam("IP grade")?.paramKey).toBe("ip");
    expect(mapHeaderToParam("Cut-out")?.paramKey).toBe("cutout_mm");
    expect(mapHeaderToParam("PRICE")).toBeNull();
  });

  test("finds model column from mixed headers", () => {
    expect(findModelColumnIndex(["Picture", "Model No.", "Power", "PRICE"])).toBe(1);
    expect(findModelColumnIndex(["图片", "产品型号", "功率"])).toBe(1);
  });

  test("matches exact model ignoring spaces and case", () => {
    expect(matchesProductIdentity("WL S02-6W", "Other Name", "wls02-6w")).toBe(true);
    expect(normalizeIdentity(" WL-S02 6W ")).toBe("wls026w");
  });

  test("cleans parameter values according to param type", () => {
    expect(cleanParamValue("watts", "10W±10%", "W")).toEqual({ rawValue: "10W±10%", normalizedValue: "10", unit: "W" });
    expect(cleanParamValue("cri", "Ra>80", null)).toEqual({ rawValue: "Ra>80", normalizedValue: "80", unit: null });
    expect(cleanParamValue("size_display", "90*28*58mm", "mm")).toEqual({
      rawValue: "90*28*58mm",
      normalizedValue: "90×28×58",
      unit: "mm",
    });
  });
});
