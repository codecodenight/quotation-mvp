import { describe, expect, test } from "vitest";

import { buildQuoteHealth } from "./quote-health";

describe("buildQuoteHealth", () => {
  test("reports product-level and offer-level quotation risks without blocking export", () => {
    const health = buildQuoteHealth({
      productName: "GU10-3.3W",
      modelNo: "GU10-3.3W",
      remark: "GU10-3.3W",
      size: "",
      supplierOffers: [
        {
          id: "offer-1",
          factoryName: "优品",
          purchasePrice: "0",
          moq: "Package",
          ctnQty: null,
          ctnLength: "27",
          ctnWidth: null,
          ctnHeight: "25",
        },
      ],
    });

    expect(health.productIssues).toEqual(["Product Details 过短或重复", "缺 Size"]);
    expect(health.offerIssues).toEqual([
      {
        offerId: "offer-1",
        factoryName: "优品",
        issues: ["采购价异常", "MOQ 可能不是数量", "缺 CTN Qty", "缺 CTN L/W/H"],
      },
    ]);
    expect(health.totalIssueCount).toBe(6);
  });

  test("does not report issues for a complete quotation candidate", () => {
    const health = buildQuoteHealth({
      productName: "COB light strip",
      modelNo: "COB-120",
      remark: "COB light strip 120 LEDs/m",
      size: "8mm",
      supplierOffers: [
        {
          id: "offer-1",
          factoryName: "汇孚",
          purchasePrice: "10.5",
          moq: "1000/色",
          ctnQty: "10",
          ctnLength: "52.3",
          ctnWidth: "49.5",
          ctnHeight: "27.4",
        },
      ],
    });

    expect(health.productIssues).toEqual([]);
    expect(health.offerIssues).toEqual([]);
    expect(health.totalIssueCount).toBe(0);
  });

  test("does not warn size when a structured size parameter exists", () => {
    const health = buildQuoteHealth({
      productName: "LS-R02A-30W",
      modelNo: "LS-R02A-30W",
      remark: "Rechargeable work light 30W",
      size: null,
      hasSizeParam: true,
      supplierOffers: [
        {
          id: "offer-1",
          factoryName: "绿晟",
          purchasePrice: "75",
          moq: null,
          ctnQty: "10",
          ctnLength: "52",
          ctnWidth: "40",
          ctnHeight: "30",
        },
      ],
    });

    expect(health.productIssues).not.toContain("缺 Size");
  });
});
