import { describe, expect, test } from "vitest";

import { extractParamFromText } from "./v22.1-param-backfill";

describe("v22.1 param extraction", () => {
  test("extracts watts from the number directly followed by W", () => {
    expect(extractParamFromText("watts", "LED Panel Light 36W 600x600 AC220-240V 4000K Ra80 IP20")).toEqual({
      rawValue: "36W",
      normalizedValue: "36",
      unit: "W",
    });
  });

  test("extracts voltage range with AC prefix before plain voltage", () => {
    expect(extractParamFromText("voltage", "AC220-240V backup 12V driver")).toEqual({
      rawValue: "AC220-240V",
      normalizedValue: "220-240",
      unit: "V",
    });
  });

  test("extracts named material with canonical casing", () => {
    expect(extractParamFromText("material", "housing aluminium + PC diffuser")).toEqual({
      rawValue: "aluminium",
      normalizedValue: "aluminium",
      unit: null,
    });
  });
});
