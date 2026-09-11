import { renderToReadableStream } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

import DevelopersPage, { metadata } from "./page";

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

describe("SYMBaiEX developer resources page", () => {
  test("publishes a branded, crawlable index of every public developer surface", async () => {
    const stream = await renderToReadableStream(<DevelopersPage />);
    await stream.allReady;
    const html = await new Response(stream).text();

    expect(metadata.title).toBe("SYMBaiEX developer resources");
    expect(metadata.description).toContain("OpenAPI 3.1");
    expect(html).toContain("<h1");
    expect(html).toContain("SYMBaiEX developer resources");
    expect(html).toContain("SoftwareApplication");
    expect(html).toContain("@symbaiex/agent-sdk");
    expect(html).toContain("@symbaiex/agent-cli");
    expect(html).toContain("@symbaiex/agent-sdk@0.1.0");
    expect(html).toContain("@symbaiex/agent-cli@0.1.0 manifest");
    expect(html).toContain("https://www.symbaiex.com/api/docs/mcp");
    expect(html).toContain("https://www.symbaiex.com/api/agent/mcp");
    expect(html).toContain("search_symbaiex_docs");
    expect(html).toContain("read_symbaiex_doc");
    expect(html).toContain("WorkOS Connect");
    for (const path of [
      "api",
      "openapi",
      "authentication",
      "mcp",
      "webhooks",
      "api-lifecycle",
    ])
      expect(html).toContain(`href="/developers/${path}"`);
    for (const resource of [
      "API docs",
      "OpenAPI 3.1 contract",
      "authentication guide",
      "MCP server cards",
      "signed webhook contract",
      "official SDK and CLI",
      "synthetic sandbox",
    ]) {
      expect(html).toContain(resource);
    }
  });
});
