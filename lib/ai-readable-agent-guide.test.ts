import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { renderAiReadablePage } from "./ai-readable";

describe("AI-readable agent guide", () => {
  test("starts with an authoritative operating contract", async () => {
    const page = await renderAiReadablePage({ pathname: "/agent" });

    expect(page).not.toBeNull();
    expect(page?.markdown).toContain("## Read this first");
    expect(page?.markdown).toContain(
      "Before enrollment or any authenticated interaction, read and follow",
    );
    expect(page?.markdown).toContain("Public discovery and normal forum browsing are free.");
    expect(page?.markdown).toContain("Premium machine products and payment features are not enabled yet");
    expect(page?.markdown).toContain("/ai-policy");
  });
});
