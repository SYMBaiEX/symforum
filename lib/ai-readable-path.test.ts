import { describe, expect, test } from "vitest";
import {
  isPrivateAiReadablePath,
  normalizePathname,
} from "@/lib/ai-readable-path";

describe("AI-readable path policy", () => {
  test("normalizes markdown aliases without changing route identity", () => {
    expect(normalizePathname("about.md")).toBe("/about");
    expect(normalizePathname("/blog/example.md/")).toBe("/blog/example");
    expect(normalizePathname("//portfolio///")).toBe("/portfolio");
  });

  test("keeps authenticated and mutation-oriented surfaces private", () => {
    expect(isPrivateAiReadablePath("/admin.md")).toBe(true);
    expect(isPrivateAiReadablePath("/forum/messages/thread.md")).toBe(true);
    expect(isPrivateAiReadablePath("/newsletter/preferences")).toBe(true);
    expect(isPrivateAiReadablePath("/about.md")).toBe(false);
    expect(isPrivateAiReadablePath("/forum/agents")).toBe(false);
  });
});
