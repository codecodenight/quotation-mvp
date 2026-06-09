import { describe, expect, test } from "vitest";

import { cleanProductDetailsText, classifyProductDetailsIssue } from "./product-details-cleanup";

describe("product details cleanup helpers", () => {
  test("replaces mojibake diameter markers and strips UTF-8 prefix garbage", () => {
    expect(cleanProductDetailsText("¢295 panel")).toBe("φ295 panel");
    expect(cleanProductDetailsText("Âφ160 lamp")).toBe("φ160 lamp");
    expect(cleanProductDetailsText("Â¢295 lamp")).toBe("φ295 lamp");
  });

  test("falls back to size only when Product Details is empty", () => {
    expect(cleanProductDetailsText("", "1200*65*60")).toBe("1200*65*60");
    expect(cleanProductDetailsText(null, "1200*65*60")).toBe("1200*65*60");
    expect(cleanProductDetailsText("LED panel", "1200*65*60")).toBe("LED panel");
  });

  test("classifies dirty details without rewriting broad content", () => {
    expect(classifyProductDetailsIssue({ remark: "¢295", size: null })).toEqual(["special-character", "dirty-pattern", "too-short"]);
    expect(classifyProductDetailsIssue({ remark: "abc", size: null })).toEqual(["too-short"]);
    expect(classifyProductDetailsIssue({ remark: "", size: "1200*65*60" })).toEqual(["empty-with-size"]);
    expect(classifyProductDetailsIssue({ remark: "normal details", size: "1200*65*60" })).toEqual([]);
  });
});
