import { describe, expect, it } from "vitest";

import { getToolResultLabel } from "./tool-result-labels";

describe("chat tool result labels", () => {
  it("returns clear labels for known tool result groups", () => {
    expect(getToolResultLabel("search_products")).toBe("产品搜索");
    expect(getToolResultLabel("compare_factories")).toBe("工厂对比");
    expect(getToolResultLabel("get_product_offers")).toBe("供应商报价");
    expect(getToolResultLabel("search_customer_history")).toBe("历史报价");
  });

  it("returns undefined for unknown tool names", () => {
    expect(getToolResultLabel("unknown_tool")).toBeUndefined();
  });
});
