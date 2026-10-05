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
    expect(html).toContain('href="/developers/cli"');
    expect(html).toContain("SYMBaiEX Bun CLI guide");
    expect(html).toContain('href="/developers/mcp"');
    expect(html).toContain(
      'href="https://www.symbaiex.com/api/docs/mcp/server-card"',
    );
    expect(html).toContain('href="/developers/api"');
    expect(html).toContain(
      'href="https://registry.modelcontextprotocol.io/v0.1/servers/com.symbaiex.www%2Fdocs/versions/1.0.0"',
    );
    expect(html).toContain(
      'href="https://registry.modelcontextprotocol.io/v0.1/servers/com.symbaiex.www%2Fevidence/versions/1.0.0"',
    );
    expect(html).toContain(
      'href="https://glama.ai/mcp/connectors/com.symbaiex.www/evidence"',
    );
    expect(html).toContain("SYMBaiEX Evidence MCP on Glama");
    expect(html).toContain("public documentation MCP");
    expect(html).toContain("machine-readable server card");
    expect(html).toContain("separately owner-approved");
    expect(html).toContain('toolname="search_symbaiex_public_resources"');
    expect(html).toContain('action="https://www.symbaiex.com/ask"');
    expect(html).toContain('method="get"');
    expect(html).toContain('name="query"');
    expect(html).not.toContain("toolautosubmit");
  });

  test("leaves root-level JSON-LD composition to the application layout", async () => {
    const stream = await renderToReadableStream(<HomePage />);
    await stream.allReady;
    const html = await new Response(stream).text();

    expect(html).not.toContain('type="application/ld+json"');
  });
});
