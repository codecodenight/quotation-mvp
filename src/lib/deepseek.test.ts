import { describe, expect, test } from "vitest";

import { CHAT_SYSTEM_PROMPT } from "./deepseek";

describe("CHAT_SYSTEM_PROMPT", () => {
  test("requires product search before factory comparison", () => {
    expect(CHAT_SYSTEM_PROMPT).toContain("必须先调 search_products 获取产品列表");
    expect(CHAT_SYSTEM_PROMPT).toContain("再调 compare_factories 做分组对比");
    expect(CHAT_SYSTEM_PROMPT).not.toContain("优先使用 compare_factories");
  });
});
