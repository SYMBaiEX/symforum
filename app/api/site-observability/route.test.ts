import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { GET } from "./route";

const originalToken = process.env.SITE_OBSERVABILITY_TOKEN;

afterEach(() => {
  if (originalToken === undefined) delete process.env.SITE_OBSERVABILITY_TOKEN;
  else process.env.SITE_OBSERVABILITY_TOKEN = originalToken;
});

describe("site observability endpoint", () => {
  test("fails closed when no operator token is configured", async () => {
    delete process.env.SITE_OBSERVABILITY_TOKEN;
    const response = GET(
      new Request("https://www.symbaiex.com/api/site-observability"),
    );
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  test("rejects missing or incorrect operator credentials", async () => {
    process.env.SITE_OBSERVABILITY_TOKEN = "operator-secret";
    expect(
      GET(new Request("https://www.symbaiex.com/api/site-observability"))
        .status,
    ).toBe(401);
    expect(
      GET(
        new Request("https://www.symbaiex.com/api/site-observability", {
          headers: { authorization: "Bearer wrong-secret" },
        }),
      ).status,
    ).toBe(401);
  });

  test("returns the bounded report for the operator token", async () => {
    process.env.SITE_OBSERVABILITY_TOKEN = "operator-secret";
    const response = GET(
      new Request("https://www.symbaiex.com/api/site-observability", {
        headers: { authorization: "Bearer operator-secret" },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.report.sitemap.entryCap).toBe(50_000);
    expect(body.report.webBotAuth.approvalStatus).toBe("not-claimed");
  });
});
