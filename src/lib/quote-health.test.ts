import { describe, expect, test } from "vitest";

import { buildQuoteHealth } from "./quote-health";

const issue = (message: string, tier: "customer" | "quote" | "logistics") => ({ message, tier });

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

    expect(health.productIssues).toEqual([
      issue("Product Details 过短或重复", "customer"),
      issue("缺 Size", "quote"),
    ]);
    expect(health.offerIssues).toEqual([
      {
        offerId: "offer-1",
        factoryName: "优品",
        issues: [
          issue("采购价异常", "quote"),
          issue("MOQ 可能不是数量", "quote"),
          issue("缺 CTN Qty", "logistics"),
          issue("缺 CTN L/W/H", "logistics"),
        ],
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

    expect(health.productIssues).not.toContainEqual(issue("缺 Size", "quote"));
  });

  test("assigns correct tier to each warning type", () => {
    const health = buildQuoteHealth({
      productName: "MR16",
      modelNo: "MR16",
      remark: "MR16",
      size: null,
      supplierOffers: [
        {
          id: "offer-1",
          factoryName: "工厂",
          purchasePrice: "-1",
          moq: "Package",
          ctnQty: "",
          ctnLength: "",
          ctnWidth: "30",
          ctnHeight: "20",
        },
      ],
    });

    expect(health.productIssues).toEqual([
      issue("Product Details 过短或重复", "customer"),
      issue("缺 Size", "quote"),
    ]);
    expect(health.offerIssues[0]?.issues).toEqual([
      issue("采购价异常", "quote"),
      issue("MOQ 可能不是数量", "quote"),
      issue("缺 CTN Qty", "logistics"),
      issue("缺 CTN L/W/H", "logistics"),
    ]);
  });
});
