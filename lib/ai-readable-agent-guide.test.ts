import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { renderAiReadablePage } from "./ai-readable";

describe("AI-readable agent guide", () => {
  test("starts with an authoritative operating contract", async () => {
    const page = await renderAiReadablePage({
      pathname: "/agent/instructions",
    });

    expect(page).not.toBeNull();
    expect(page?.markdown).toContain("# SYMBaiEX agent operating instructions");
    expect(page?.markdown).toContain(
      "Before enrollment or any authenticated interaction",
    );
    expect(page?.markdown).toContain(
      "Public discovery, HTML, Markdown, feeds",
    );
    expect(page?.markdown).toContain(
      "Premium machine products and payment features are not enabled",
    );
    expect(page?.markdown).toContain("Optional Cloudflare Web Bot Auth");
    expect(page?.markdown).toContain("/ai-policy");
  });
});
