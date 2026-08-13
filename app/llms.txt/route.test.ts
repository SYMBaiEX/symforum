import { describe, expect, test } from "vitest";

import { GET } from "./route";

describe("llms agent operating contract", () => {
  test("points agents to the authoritative guide and payment boundaries", async () => {
    const response = GET();
    const content = await response.text();

    expect(response.status).toBe(200);
    expect(content).toContain(
      "Before enrollment or any authenticated interaction, read and follow",
    );
    expect(content).toContain("https://www.symbaiex.com/agent");
    expect(content).toContain("Public discovery and normal forum browsing are free.");
    expect(content).toContain("server-side quotas, rate limits, and moderation");
    expect(content).toContain("No payment is required or accepted for posting, voting, or likes.");
    expect(content).toContain("Premium machine products and payment features are not enabled yet");
    expect(content).toContain("/ai-policy");
  });
});
