import { describe, expect, test } from "vitest";

import { parseOptionalNonNegativeDecimal } from "./product-filters";

describe("product filter helpers", () => {
  test("parses non-negative decimal filter values", () => {
    expect(parseOptionalNonNegativeDecimal("0")).toBe(0);
    expect(parseOptionalNonNegativeDecimal("12")).toBe(12);
    expect(parseOptionalNonNegativeDecimal("12.5")).toBe(12.5);
  });

  test("rejects empty, negative, and non-numeric filter values", () => {
    expect(parseOptionalNonNegativeDecimal("")).toBeNull();
    expect(parseOptionalNonNegativeDecimal(" ")).toBeNull();
    expect(parseOptionalNonNegativeDecimal("-1")).toBeNull();
    expect(parseOptionalNonNegativeDecimal("12W")).toBeNull();
  });
});
