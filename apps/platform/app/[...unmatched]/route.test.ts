import { describe, expect, test, vi } from "vitest";

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_HTTP_ERROR_FALLBACK;404");
  },
}));

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

  test("keeps HTML and refused Markdown requests on Next's branded 404", () => {
    for (const accept of ["text/html", "text/markdown;q=0, text/html"]) {
      expect(() =>
        GET(
          new Request("https://www.symbaiex.com/__ora-404-probe", {
            headers: { accept },
          }),
        ),
      ).toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
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
