import { describe, expect, it } from "vitest";

import { previewChatDraft } from "./actions";

describe("chat quote actions", () => {
  it("exports a preview action for chat quote drafts", () => {
    expect(typeof previewChatDraft).toBe("function");
  });
});
