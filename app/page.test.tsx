import { renderToReadableStream } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

vi.mock("@/lib/blog-data", () => ({
  getLatestPosts: vi.fn(async () => []),
}));
vi.mock("@/lib/news-data", () => ({
  getDailyNews: vi.fn(async () => []),
}));
vi.mock("next/image", () => ({ default: () => null }));

import HomePage from "./page";

describe("SYMBaiEX homepage discoverability", () => {
  test("links public agent and developer resources in server-rendered content", async () => {
    const stream = await renderToReadableStream(<HomePage />);
    await stream.allReady;
    const html = await new Response(stream).text();

    expect(html).toContain('href="/developers"');
    expect(html).toContain('href="/developers/mcp"');
    expect(html).toContain('href="/developers/api"');
    expect(html).toContain("public documentation MCP");
    expect(html).toContain("separately owner-approved");
  });
});
