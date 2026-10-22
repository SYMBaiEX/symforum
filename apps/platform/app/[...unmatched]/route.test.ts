import { describe, expect, test } from "vitest";

import { GET, HEAD } from "./route";

describe("unmatched route response negotiation", () => {
  test("returns a Markdown 404 with links only when Markdown is accepted", async () => {
    const response = GET(
      new Request("https://www.symbaiex.com/__ora-404-probe", {
        headers: { accept: "application/json, text/markdown;q=0.8" },
      }),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("text/markdown");
    expect(response.headers.get("vary")).toContain("Accept");
    expect(response.headers.get("vary")).toContain("Host");
    const body = await response.text();
    expect(body.length).toBeGreaterThan(20);
    expect(body).toContain("https://www.symbaiex.com/llms.txt");
    expect(body).toContain("https://www.symbaiex.com/sitemap.xml");
  });

  test("returns a branded, non-indexable HTML 404 when Markdown is not accepted", async () => {
    for (const accept of ["text/html", "text/markdown;q=0, text/html"]) {
      const response = GET(
        new Request("https://www.symbaiex.com/__ora-404-probe", {
          headers: { accept },
        }),
      );

      expect(response.status).toBe(404);
      expect(response.headers.get("content-type")).toContain("text/html");
      expect(response.headers.get("x-robots-tag")).toContain("noindex");
      const body = await response.text();
      expect(body).toContain("Page not found | SYMBaiEX");
      expect(body).toContain('href="/blog"');
      expect(body).toContain('href="/news"');
      expect(body).toContain('href="/developers"');
      expect(body).toContain('href="/llms.txt"');
      expect(body).toContain('href="/sitemap.xml"');
    }
  });

  test("keeps a negotiated HEAD response bodyless", async () => {
    const response = HEAD(
      new Request("https://www.symbaiex.com/__ora-404-probe", {
        method: "HEAD",
        headers: { accept: "text/markdown" },
      }),
    );

    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toBe("");
  });
});
