import { describe, expect, test } from "vitest";
import { AgentApiError, AgentClient, DEFAULT_PLATFORM_ORIGIN } from "./index";

describe("AgentClient", () => {
  test("uses only the public platform origin and injects bearer auth", async () => {
    const calls: Array<{ url: string; authorization: string | null }> = [];
    const client = new AgentClient({
      fetch: async (input, init) => {
        calls.push({
          url: String(input),
          authorization: new Headers(init?.headers).get("authorization"),
        });
        return Response.json({ agentId: "suki", monthKey: "2026-08" });
      },
      tokenStore: {
        async getToken() {
          return "access-token";
        },
      },
    });
    await expect(client.quota()).resolves.toMatchObject({ agentId: "suki" });
    expect(calls).toEqual([
      {
        url: `${DEFAULT_PLATFORM_ORIGIN}/api/agent/quota`,
        authorization: "Bearer access-token",
      },
    ]);
  });

  test("sanitizes platform errors without exposing a token", async () => {
    const client = new AgentClient({
      fetch: async () =>
        Response.json(
          { error: "Scope denied.", code: "SCOPE_DENIED" },
          { status: 403 },
        ),
      tokenStore: {
        async getToken() {
          return "never-in-error";
        },
      },
    });
    await expect(client.search("security")).rejects.toEqual(
      expect.objectContaining<Partial<AgentApiError>>({
        status: 403,
        code: "SCOPE_DENIED",
        message: "The platform request failed.",
      }),
    );
  });

  test("bounds transport time and sanitizes network failures", async () => {
    const tokenStore = {
      async getToken() {
        return "access-token";
      },
    };
    const offline = new AgentClient({
      fetch: async () => {
        throw new Error("socket details must not escape");
      },
      tokenStore,
    });
    await expect(offline.status()).rejects.toMatchObject({
      status: 0,
      code: "NETWORK_ERROR",
      message: "The platform request could not be completed.",
    });

    const stalled = new AgentClient({
      fetch: async (_input, init) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new Error("aborted")),
            { once: true },
          );
        }),
      tokenStore,
      requestTimeoutMs: 5,
    });
    await expect(stalled.status()).rejects.toMatchObject({
      status: 408,
      code: "REQUEST_TIMEOUT",
      message: "The platform request timed out.",
    });
    expect(() => new AgentClient({ requestTimeoutMs: 0 })).toThrow(
      /requestTimeoutMs/,
    );
  });

  test("uses the bounded universal lexical-search endpoint", async () => {
    const calls: string[] = [];
    const client = new AgentClient({
      fetch: async (input) => {
        calls.push(String(input));
        return Response.json([]);
      },
      tokenStore: {
        async getToken() {
          return "access-token";
        },
      },
    });
    await expect(client.universalSearch("public evidence", 5)).resolves.toEqual(
      [],
    );
    expect(calls).toEqual([
      `${DEFAULT_PLATFORM_ORIGIN}/api/agent/v1/universal-search?q=public+evidence&limit=5`,
    ]);
    await expect(client.universalSearch("x", 51)).rejects.toThrow(
      /between 1 and 50/i,
    );
  });

  test("uses the first-party replay-safe semantic-search endpoint", async () => {
    const calls: Array<{ url: string; idempotencyKey: string | null }> = [];
    const client = new AgentClient({
      fetch: async (input, init) => {
        calls.push({
          url: String(input),
          idempotencyKey: new Headers(init?.headers).get("idempotency-key"),
        });
        return Response.json([]);
      },
      tokenStore: {
        async getToken() {
          return "access-token";
        },
      },
    });
    await expect(
      client.semanticSearch("public evidence", {
        limit: 5,
        idempotencyKey: "semantic-sdk-001",
      }),
    ).resolves.toEqual([]);
    expect(calls).toEqual([
      {
        url: `${DEFAULT_PLATFORM_ORIGIN}/api/agent/v1/semantic-search?q=public+evidence&limit=5`,
        idempotencyKey: "semantic-sdk-001",
      },
    ]);
    await expect(
      client.semanticSearch("x", {
        limit: 21,
        idempotencyKey: "semantic-sdk-002",
      }),
    ).rejects.toThrow(/between 1 and 20/i);
    await expect(
      client.semanticSearch("x", { idempotencyKey: "short" }),
    ).rejects.toThrow(/8-96/i);
  });

  test("sends caller-provided idempotency keys on public write endpoints", async () => {
    const client = new AgentClient({
      fetch: async (_input, init) => {
        expect(init?.method).toBe("POST");
        expect(new Headers(init?.headers).get("idempotency-key")).toBe(
          "research-001",
        );
        expect(init?.body).toBe('{"query":"bounded research"}');
        return Response.json({ jobId: "job-1", status: "queued" });
      },
      tokenStore: {
        async getToken() {
          return "access-token";
        },
      },
    });
    await expect(
      client.createResearch("bounded research", "research-001"),
    ).resolves.toEqual({ jobId: "job-1", status: "queued" });
  });

  test("uses bounded, owner-scoped webhook management paths", async () => {
    const calls: Array<{ url: string; method: string; body: string | null }> =
      [];
    const client = new AgentClient({
      fetch: async (input, init) => {
        calls.push({
          url: String(input),
          method: init?.method ?? "GET",
          body: typeof init?.body === "string" ? init.body : null,
        });
        return Response.json({ enabled: true });
      },
      tokenStore: {
        async getToken() {
          return "access-token";
        },
      },
    });
    await client.webhookAvailability();
    await client.webhookHistory("research-events", 5);
    await client.sendWebhookTest(
      "research-events",
      "evidence.research.completed",
      "webhook-test-001",
    );
    expect(calls).toEqual([
      {
        url: `${DEFAULT_PLATFORM_ORIGIN}/api/agent/v1/webhooks/availability`,
        method: "GET",
        body: null,
      },
      {
        url: `${DEFAULT_PLATFORM_ORIGIN}/api/agent/v1/webhooks/research-events/deliveries?limit=5`,
        method: "GET",
        body: null,
      },
      {
        url: `${DEFAULT_PLATFORM_ORIGIN}/api/agent/v1/webhooks/research-events/test`,
        method: "POST",
        body: '{"eventType":"evidence.research.completed"}',
      },
    ]);
  });

  test("covers public auth, artifact, and MCP contracts without a live network", async () => {
    const calls: Array<{ url: string; method: string; headers: Headers }> = [];
    const client = new AgentClient({
      fetch: async (input, init) => {
        calls.push({
          url: String(input),
          method: init?.method ?? "GET",
          headers: new Headers(init?.headers),
        });
        if (String(input).endsWith("/artifact")) {
          return new Response(new Uint8Array([1, 2, 3]));
        }
        return Response.json({ ok: true });
      },
      tokenStore: {
        async getToken() {
          return "access-token";
        },
      },
    });

    await client.challenge("suki");
    await client.signIn("suki", "challenge", "signature");
    await client.refresh("refresh-token");
    await client.sources(5);
    await client.sourceRegistry();
    await client.document("doc/1");
    await client.verifyClaim("claim-1", "claim-verify-001");
    await client.entities("zero trust", 2);
    await client.versionClaims("version-1", 2);
    await client.claimTimeline("release-security", 2);
    await client.products(2);
    await client.datasets(2);
    await client.benchmarks(2);
    await client.entitlements();
    await client.usage(2);
    await client.researchJob("job-1");
    await expect(client.researchArtifact("job-1")).resolves.toEqual(
      new Uint8Array([1, 2, 3]),
    );
    await client.createExport("dataset-1", "export-001");
    await client.exportJob("job-2");
    await client.exportArtifact("job-2");
    await client.rotateWebhookSecret("primary", "rotate-001");
    await client.replayWebhookDelivery("primary", "event-1", "replay-001");
    await client.mcp(
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      { method: "tools/list" },
    );

    expect(calls.map((call) => call.url)).toEqual(
      expect.arrayContaining([
        `${DEFAULT_PLATFORM_ORIGIN}/api/agent/auth/challenge`,
        `${DEFAULT_PLATFORM_ORIGIN}/api/agent/auth/sign-in`,
        `${DEFAULT_PLATFORM_ORIGIN}/api/agent/auth/refresh`,
        `${DEFAULT_PLATFORM_ORIGIN}/api/agent/v1/sources?limit=5`,
        `${DEFAULT_PLATFORM_ORIGIN}/api/agent/v1/source-registry`,
        `${DEFAULT_PLATFORM_ORIGIN}/api/agent/v1/documents/doc%2F1`,
        `${DEFAULT_PLATFORM_ORIGIN}/api/agent/v1/claims/claim-1/verify`,
        `${DEFAULT_PLATFORM_ORIGIN}/api/agent/v1/claims/release-security/timeline?limit=2`,
        `${DEFAULT_PLATFORM_ORIGIN}/api/agent/v1/research-jobs/job-1/artifact`,
        `${DEFAULT_PLATFORM_ORIGIN}/api/agent/v1/exports/job-2/artifact`,
        `${DEFAULT_PLATFORM_ORIGIN}/api/agent/mcp`,
      ]),
    );
    const mcp = calls.at(-1);
    expect(mcp?.headers.get("mcp-protocol-version")).toBe("2026-07-28");
    expect(mcp?.headers.get("mcp-method")).toBe("tools/list");
  });

  test("rejects reflected bearer material and oversized JSON", async () => {
    const bearer = "ACCESS_TOKEN_DO_NOT_REFLECT";
    const reflected = new AgentClient({
      fetch: async () =>
        Response.json(
          { code: "UPSTREAM_ACCESS_TOKEN_DO_NOT_REFLECT", error: bearer },
          { status: 500 },
        ),
      tokenStore: {
        async getToken() {
          return bearer;
        },
      },
    });
    await expect(reflected.status()).rejects.toMatchObject({
      code: "HTTP_500",
      message: "The platform request failed.",
    });

    const oversized = new AgentClient({
      fetch: async () =>
        new Response("{}", {
          headers: { "content-length": String(2 * 1024 * 1024 + 1) },
        }),
      tokenStore: {
        async getToken() {
          return "access-token";
        },
      },
    });
    await expect(oversized.status()).rejects.toMatchObject({
      code: "RESPONSE_TOO_LARGE",
    });
  });

  test("rejects an untrusted custom origin before reading a bearer token", () => {
    let tokenReads = 0;
    expect(
      () =>
        new AgentClient({
          origin: "https://untrusted.example",
          tokenStore: {
            async getToken() {
              tokenReads += 1;
              return "access-token";
            },
          },
        }),
    ).toThrow(/HTTPS or a localhost/i);
    expect(tokenReads).toBe(0);
    expect(
      () =>
        new AgentClient({
          origin: "https://www.symbaiex.com/not-an-origin",
          trustedOrigins: [DEFAULT_PLATFORM_ORIGIN],
        }),
    ).toThrow(/without a path/i);
  });
});
