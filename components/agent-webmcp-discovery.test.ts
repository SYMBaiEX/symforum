import { describe, expect, test } from "vitest";

import { SYMBAIEX_WEBMCP_DISCOVERY_TOOL } from "./agent-webmcp-discovery";

describe("SYMBaiEX WebMCP discovery tool", () => {
  test("is a read-only, no-input discovery operation", async () => {
    const controller = new AbortController();
    const result = await SYMBAIEX_WEBMCP_DISCOVERY_TOOL.execute(
      {},
      { signal: controller.signal },
    );

    expect(SYMBAIEX_WEBMCP_DISCOVERY_TOOL.annotations).toEqual({
      readOnlyHint: true,
      untrustedContentHint: false,
    });
    expect(SYMBAIEX_WEBMCP_DISCOVERY_TOOL.inputSchema).toMatchObject({
      additionalProperties: false,
      properties: {},
    });
    expect(result).toMatchObject({
      apiManifest: "https://www.symbaiex.com/api/agent",
      humanSetup: "https://www.symbaiex.com/agent/signup",
    });
    expect(JSON.stringify(result)).not.toMatch(/token|privateKey|password/i);
  });

  test("honors an already-aborted execution", async () => {
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));

    await expect(
      SYMBAIEX_WEBMCP_DISCOVERY_TOOL.execute({}, { signal: controller.signal }),
    ).rejects.toThrow("cancelled");
  });
});
