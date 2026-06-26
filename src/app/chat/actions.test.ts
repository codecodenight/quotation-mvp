import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("chat quote actions", () => {
  it("declares preview and generate actions for chat quote drafts", () => {
    const source = readFileSync(join(process.cwd(), "src/app/chat/actions.ts"), "utf8");

    expect(source).toContain("export async function previewChatDraft");
    expect(source).toContain("export async function generateQuoteFromChatDraft");
    expect(source).toContain("previewQuote(buildChatQuoteFormData(input))");
  });
});
