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
    expect(response.headers.get("www-authenticate")).toContain(
      'resource_metadata="https://www.symbaiex.com/.well-known/oauth-protected-resource"',
    );
    await expect(response.json()).resolves.toMatchObject({
      code: "AGENT_AUTH_REQUIRED",
    });
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

  test("relays semantic search only with bounded idempotency and a server secret", async () => {
    vi.stubEnv("CONVEX_SITE_URL", "https://strong-bee-384.convex.site");
    vi.stubEnv(
      "AGENT_SEMANTIC_RELAY_SECRET",
      "test-semantic-relay-secret-at-least-32-characters",
    );
    const missingKey = await GET(
      new Request(
        "https://www.symbaiex.com/api/agent/v1/semantic-search?q=convex&limit=10",
        { headers: { authorization: "Bearer agent-token" } },
      ),
      context(["semantic-search"]),
    );
    expect(missingKey.status).toBe(400);

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json([{ title: "Lexical result" }]));
    const response = await GET(
      new Request(
        "https://www.symbaiex.com/api/agent/v1/semantic-search?q=convex&limit=10",
        {
          headers: {
            authorization: "Bearer agent-token",
            "idempotency-key": "semantic-search-001",
          },
        },
      ),
      context(["semantic-search"]),
    );
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://strong-bee-384.convex.site/agent/v1",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer agent-token",
          "x-symbaiex-semantic-relay":
            "test-semantic-relay-secret-at-least-32-characters",
        }),
        body: expect.stringContaining('"operation":"semantic_search"'),
      }),
    );
    expect(
      JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)),
    ).toMatchObject({
      operation: "semantic_search",
      input: { query: "convex", limit: 10 },
      idempotencyKey: "semantic-search-001",
      requestFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  test("relays the bounded claim timeline through the canonical REST path", async () => {
    vi.stubEnv("CONVEX_SITE_URL", "https://strong-bee-384.convex.site");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json([{ status: "outdated" }]));
    const response = await GET(
      new Request(
        "https://www.symbaiex.com/api/agent/v1/claims/release-security/timeline?limit=2",
        { headers: { authorization: "Bearer agent-token" } },
      ),
      context(["claims", "release-security", "timeline"]),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([{ status: "outdated" }]);
    expect(
      JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)),
    ).toMatchObject({
      operation: "claim_timeline",
      input: { claimKey: "release-security", limit: 2 },
    });
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

  test("streams immutable export manifests through the same authenticated relay", async () => {
    vi.stubEnv("CONVEX_SITE_URL", "https://strong-bee-384.convex.site");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response('{"schemaVersion":"symbaiex-evidence-document-v2"}', {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const response = await GET(
      new Request(
        "https://www.symbaiex.com/api/agent/v1/exports/job-id/manifest",
        { headers: { authorization: "Bearer agent-token" } },
      ),
      context(["exports", "job-id", "manifest"]),
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://strong-bee-384.convex.site/agent/artifact",
      expect.objectContaining({
        body: JSON.stringify({ kind: "export-manifest", jobId: "job-id" }),
      }),
    );
  });
});
