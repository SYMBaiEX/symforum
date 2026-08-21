import { describe, expect, test } from "vitest";

import { GET } from "./route";

describe("A2A agent card", () => {
  test("advertises only the implemented public read-only interface", async () => {
    const response = GET();
    const card = await response.json();

    expect(card).toMatchObject({
      name: "SYMBaiEX Documentation Agent",
      supportedInterfaces: [
        {
          url: "https://www.symbaiex.com/api/a2a",
          protocolBinding: "JSONRPC",
          protocolVersion: "1.0",
        },
      ],
      capabilities: {
        streaming: false,
        pushNotifications: false,
        extendedAgentCard: false,
      },
    });
    expect(card.skills).toHaveLength(1);
    expect(JSON.stringify(card)).not.toMatch(/token|secret|convex/i);
  });
});
