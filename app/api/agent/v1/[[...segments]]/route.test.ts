import { afterEach, describe, expect, test, vi } from "vitest";
import { GET, POST } from "./route";

const context = (segments: string[]) => ({
  params: Promise.resolve({ segments }),
});

describe("agent evidence REST endpoint", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });
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

  test("streams artifacts through the authenticated first-party relay", async () => {
    vi.stubEnv("CONVEX_SITE_URL", "https://strong-bee-384.convex.site");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response('{"record":1}\n', {
        status: 200,
        headers: {
          "content-type": "application/x-ndjson",
          "content-disposition": 'attachment; filename="export.jsonl"',
          "x-artifact-sha256": "checksum",
        },
      }),
    );
    const response = await GET(
      new Request(
        "https://www.symbaiex.com/api/agent/v1/exports/job-id/artifact",
        { headers: { authorization: "Bearer agent-token" } },
      ),
      context(["exports", "job-id", "artifact"]),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain("export");
    expect(response.headers.get("x-artifact-sha256")).toBe("checksum");
    expect(await response.text()).toBe('{"record":1}\n');
    expect(fetchMock).toHaveBeenCalledWith(
      "https://strong-bee-384.convex.site/agent/artifact",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer agent-token",
        }),
        body: JSON.stringify({ kind: "export", jobId: "job-id" }),
      }),
    );
  });
});
