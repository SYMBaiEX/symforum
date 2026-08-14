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
    expect(page?.markdown).toContain("Public discovery, HTML, Markdown, feeds");
    expect(page?.markdown).toContain(
      "Premium machine products and payment features are not enabled",
    );
    expect(page?.markdown).toContain("Optional Cloudflare Web Bot Auth");
    expect(page?.markdown).toContain("/ai-policy");
  });

  test("includes the research hub surface", async () => {
    const page = await renderAiReadablePage({
      pathname: "/research",
    });

    expect(page).not.toBeNull();
    expect(page?.title).toBe("Research hubs");
    expect(page?.markdown).toContain("# SYMBaiEX research hub");
    expect(page?.markdown).toContain("AI-readable web architecture");
    expect(page?.markdown).toContain(
      "Editorial authority and machine contracts",
    );
    expect(page?.markdown).toContain("/research/ai-readable-web");
    expect(page?.markdown).toContain("/research/editorial-trust-and-contracts");
  });

  test("includes editorial-trust topic in markdown surface", async () => {
    const page = await renderAiReadablePage({
      pathname: "/research/editorial-trust-and-contracts",
    });

    expect(page).not.toBeNull();
    expect(page?.title).toBe("Editorial authority and machine contracts");
    expect(page?.markdown).toContain("Updated: 2026-08-13");
    expect(page?.markdown).toContain("/ai-policy");
    expect(page?.markdown).toContain("publisher reviews research");
  });

  test("keeps contact details in no-JS markdown surface", async () => {
    const page = await renderAiReadablePage({
      pathname: "/contact",
    });

    expect(page).not.toBeNull();
    expect(page?.title).toBe("Contact Austin Hamilton");
    expect(page?.markdown).toContain("# Contact Austin Hamilton");
    expect(page?.markdown).toContain("mailto:solsymbaiex@gmail.com");
    expect(page?.markdown).toContain("X/Twitter");
  });
});
