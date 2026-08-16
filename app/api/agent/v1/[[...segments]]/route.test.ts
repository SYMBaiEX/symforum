import { describe, expect, test } from "vitest";
import { GET, POST } from "./route";

const context = (segments: string[]) => ({
  params: Promise.resolve({ segments }),
});

describe("agent evidence REST endpoint", () => {
  test("requires bearer authentication", async () => {
    const response = await GET(
      new Request("https://www.symbaiex.com/api/agent/v1/status"),
      context(["status"]),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  test("rejects unknown paths before relaying", async () => {
    const response = await GET(
      new Request("https://www.symbaiex.com/api/agent/v1/nope", {
        headers: { authorization: "Bearer test" },
      }),
      context(["nope"]),
    );
    expect(response.status).toBe(404);
  });

  test("accepts only documented bounded job request bodies", async () => {
    const research = await POST(
      new Request("https://www.symbaiex.com/api/agent/v1/research-jobs", {
        method: "POST",
        headers: {
          authorization: "Bearer test",
          "content-type": "application/json",
        },
        body: JSON.stringify({ query: "Compare current evidence" }),
      }),
      context(["research-jobs"]),
    );
    expect(research.status).toBe(503);
    const invalid = await POST(
      new Request("https://www.symbaiex.com/api/agent/v1/research-jobs", {
        method: "POST",
        headers: {
          authorization: "Bearer test",
          "content-type": "application/json",
        },
        body: JSON.stringify({ query: "x", ownerUserId: "spoof" }),
      }),
      context(["research-jobs"]),
    );
    expect(invalid.status).toBe(404);
  });
});
