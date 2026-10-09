import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ renderAiReadablePage: vi.fn() }));

vi.mock("@/lib/ai-readable", () => ({
  isPrivateAiReadablePath: (pathname: string) => pathname.startsWith("/admin"),
  normalizePathname: (pathname: string) => pathname,
  renderAiReadablePage: (...args: unknown[]) =>
    mocks.renderAiReadablePage(...args),
}));

import { GET } from "./route";

describe("agent-readable fallback route", () => {
  beforeEach(() => {
    mocks.renderAiReadablePage.mockReset();
    mocks.renderAiReadablePage.mockResolvedValue(null);
  });

  test("returns a Markdown 404 with public recovery links for unknown paths", async () => {
    const response = await GET(
      new Request("https://www.symbaiex.com/markdown/__not-found"),
      { params: Promise.resolve({ path: ["__not-found"] }) },
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("text/markdown");
    expect(response.headers.get("vary")).toContain("Accept");
    expect(response.headers.get("vary")).toContain("Host");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    const body = await response.text();
    expect(body).toContain("# Not found");
    expect(body).toContain("https://www.symbaiex.com/llms.txt");
    expect(body).toContain("https://www.symbaiex.com/sitemap.xml");
  });
});
