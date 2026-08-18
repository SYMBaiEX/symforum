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

  test("maps platform errors without exposing a token", async () => {
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
        message: "Scope denied.",
      }),
    );
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
    ).toThrow(/trustedOrigins/i);
    expect(tokenReads).toBe(0);
  });
});
