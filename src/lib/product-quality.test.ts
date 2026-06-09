import { describe, expect, test } from "vitest";

import {
  buildProductQualityIssueSummary,
  buildProductQualityWhere,
  hasProductIdentifierIssue,
  normalizeProductQualityFilter,
} from "./product-quality";

describe("product quality helpers", () => {
  test("normalizes unsupported quality filters to all", () => {
    expect(normalizeProductQualityFilter("missingCtn")).toBe("missingCtn");
    expect(normalizeProductQualityFilter("identifierIssue")).toBe("identifierIssue");
    expect(normalizeProductQualityFilter("unknown")).toBe("all");
    expect(normalizeProductQualityFilter(undefined)).toBe("all");
  });

  test("builds Prisma filters for missing CTN, missing size, temporary model numbers, and needs-data queue", () => {
    expect(buildProductQualityWhere("missingCtn")).toEqual({
      supplierOffers: { some: { OR: expect.any(Array) } },
    });
    expect(buildProductQualityWhere("missingSize")).toEqual({
      OR: [{ size: null }, { size: "" }],
    });
    expect(buildProductQualityWhere("temporaryModel")).toEqual({
      modelNo: { startsWith: "壁灯-" },
    });
    expect(buildProductQualityWhere("identifierIssue")).toEqual({
      OR: [
        { modelNo: null },
        { modelNo: "" },
        { modelNo: { startsWith: "壁灯-" } },
        { modelNo: { in: expect.any(Array) } },
        { productName: { in: expect.any(Array) } },
      ],
    });
    expect(buildProductQualityWhere("needsData")).toEqual({
      OR: [
        { supplierOffers: { some: { OR: expect.any(Array) } } },
        { OR: [{ size: null }, { size: "" }] },
        { modelNo: { startsWith: "壁灯-" } },
        { OR: expect.any(Array) },
      ],
    });
    expect(buildProductQualityWhere("all")).toEqual({});
  });

  test("summarizes specific product quality issues", () => {
    expect(
      buildProductQualityIssueSummary({
        modelNo: "壁灯-8W-1",
        size: "",
        supplierOffers: [
          { ctnQty: "", ctnLength: "52", ctnWidth: "49", ctnHeight: "" },
          { ctnQty: "10", ctnLength: "52", ctnWidth: "49", ctnHeight: "27" },
        ],
      }),
    ).toEqual(["缺 Size", "缺 CTN", "临时款号", "标识异常"]);
  });

  test("detects product identifiers that should not be sent to customers as-is", () => {
    expect(hasProductIdentifierIssue({ modelNo: "1", productName: "1" })).toBe(true);
    expect(hasProductIdentifierIssue({ modelNo: "壁灯-8W-铝-1", productName: "壁灯-8W-铝-1" })).toBe(true);
    expect(hasProductIdentifierIssue({ modelNo: "", productName: "皮线灯-单色" })).toBe(true);
    expect(hasProductIdentifierIssue({ modelNo: "T80-A HIGH-50W-E27", productName: "T80-A HIGH" })).toBe(false);
    expect(hasProductIdentifierIssue({ modelNo: "20W", productName: "20W" })).toBe(false);
  });
});
