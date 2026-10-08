import { describe, expect, test } from "vitest";

import { GET, POST } from "./route";

describe("NLWeb ask endpoint", () => {
  test("returns bounded schema.org list results", async () => {
    const response = await GET(
      new Request(
        "https://www.symbaiex.com/ask?query=developer+API&streaming=false",
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body._meta).toEqual({ response_type: "list", version: "0.5" });
    expect(body.results[0]).toMatchObject({
      name: "SYMBaiEX developer guide",
      schema_object: { "@context": "https://schema.org" },
    });
    expect(body.results.length).toBeLessThanOrEqual(5);
  });

  test("supports the current object query and SSE event sequence", async () => {
    const response = await POST(
      new Request("https://www.symbaiex.com/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: { text: "agent authentication" },
          prefer: { streaming: true },
          mode: "list",
        }),
      }),
    );
    const body = await response.text();

    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(body).toContain("event: start");
    expect(body).toContain("event: result");
    expect(body).toContain("event: complete");
    expect(body).toContain("SYMBaiEX authentication guide");
  });

  test("rejects generate mode and oversized queries without provider work", async () => {
    const unsupported = await GET(
      new Request("https://www.symbaiex.com/ask?query=evidence&mode=generate"),
    );
    expect(unsupported.status).toBe(400);
    await expect(unsupported.json()).resolves.toMatchObject({
      code: "unsupported_mode",
    });

    const oversized = await GET(
      new Request(`https://www.symbaiex.com/ask?query=${"a".repeat(301)}`),
    );
    expect(oversized.status).toBe(400);
  });
});
