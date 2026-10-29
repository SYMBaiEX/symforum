import { describe, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { ownerConsoleReadTools } from "./admin-ai-tools";

describe("owner console authority", () => {
  test("untrusted source content only has read tools available", async () => {
    const query = vi.fn(async () => []);
    const mutation = vi.fn(() => {
      throw new Error("Writes are forbidden");
    });
    const tools = ownerConsoleReadTools({ query, mutation } as never);
    expect(Object.keys(tools).sort()).toEqual([
      "communityState",
      "contentInventory",
      "newsletterEditorialPerformance",
      "newsletterState",
      "platformOverview",
      "systemHealth",
    ]);
    for (const tool of Object.values(tools)) {
      await tool.execute!({}, { toolCallId: "fixture", messages: [] } as never);
    }
    expect(query).toHaveBeenCalled();
    expect(mutation).not.toHaveBeenCalled();
    expect(tools).not.toHaveProperty("sendNewsletterTestIssue");
    expect(tools).not.toHaveProperty("updateDailyNewsletterSettings");
  });
});
