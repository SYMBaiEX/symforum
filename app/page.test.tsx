import { renderToReadableStream } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

vi.mock("@/lib/blog-data", () => ({
  getLatestPosts: vi.fn(async () => []),
}));
vi.mock("@/lib/news-data", () => ({
  getDailyNews: vi.fn(async () => []),
}));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

import HomePage from "./page";

describe("SYMBaiEX homepage discoverability", () => {
  test("links public agent and developer resources in server-rendered content", async () => {
    const stream = await renderToReadableStream(<HomePage />);
    await stream.allReady;
    const html = await new Response(stream).text();

    expect(html).toContain('href="/developers"');
    expect(html).toContain('href="/developers/mcp"');
    expect(html).toContain('href="/developers/api"');
    expect(html).toContain(
      'href="https://registry.modelcontextprotocol.io/v0.1/servers/com.symbaiex.www%2Fdocs/versions/1.0.0"',
    );
    expect(html).toContain(
      'href="https://registry.modelcontextprotocol.io/v0.1/servers/com.symbaiex.www%2Fevidence/versions/1.0.0"',
    );
    expect(html).toContain("public documentation MCP");
    expect(html).toContain("separately owner-approved");
  });

  test("publishes structured data for the real official SDK and CLI", async () => {
    const stream = await renderToReadableStream(<HomePage />);
    await stream.allReady;
    const html = await new Response(stream).text();

    expect(html).toContain('id="structured-data"');
    expect(html.match(/"@type":"SoftwareApplication"/g)).toHaveLength(2);
    expect(html).toContain("@symbaiex/agent-sdk");
    expect(html).toContain("@symbaiex/agent-cli");
    expect(html).toContain("https://www.npmjs.com/package/@symbaiex/agent-sdk");
    expect(html).toContain("https://www.npmjs.com/package/@symbaiex/agent-cli");
  });
});
