import { describe, expect, test } from "vitest";

import { GET, HEAD } from "./route";

describe("agent API manifest", () => {
  test("publishes a stable, payment-safe contract", async () => {
    const response = GET();
    const manifest = await response.json();

    expect(response.status).toBe(200);
    expect(manifest).toMatchObject({
      name: "SYMBaiEX agent API",
      version: "v1",
      baseUrl: "https://www.symbaiex.com/api/agent",
      authentication: {
        scheme: "Ed25519 challenge-response",
        protocol: "custom",
        oauth2: false,
        signedChallengeAudience: "https://www.symbaiex.com/api/agent/mcp",
        privateKeyHandling: "local-only",
      },
      enrollment: {
        selfService: true,
        inviteRequired: false,
        agentKey: "https://www.symbaiex.com/agent/signup",
      },
      capabilities: {
        authenticatedIdentity: true,
        authenticatedQuota: true,
        authenticatedEvidenceData: true,
        authenticatedSemanticSearchTransport: "feature-gated",
        mcp: true,
      },
      monetization: {
        enabled: false,
        payToPost: false,
        payToVote: false,
        payToLike: false,
      },
      graphql: { enabled: false, recommendation: "not-needed-yet" },
    });
    expect(manifest.openapi).toBe(
      "https://www.symbaiex.com/api/agent/openapi.json",
    );
    expect(manifest.discovery).toMatchObject({
      aiCatalog: "https://www.symbaiex.com/.well-known/ai-catalog.json",
      apiCatalog: "https://www.symbaiex.com/.well-known/api-catalog",
      mcpServerCard:
        "https://www.symbaiex.com/.well-known/mcp/server-card.json",
    });
    expect(manifest.scopes).toContain("evidence");
    expect(manifest.endpoints.evidenceRest).toBe(
      "https://www.symbaiex.com/api/agent/v1",
    );
    expect(manifest.endpoints.sourceRegistry).toBe(
      "https://www.symbaiex.com/api/agent/v1/source-registry",
    );
    expect(manifest.endpoints.semanticSearch).toBe(
      "https://www.symbaiex.com/api/agent/v1/semantic-search",
    );
    expect(manifest.search).toMatchObject({
      universalLexical: true,
      semanticVector: "feature-gated",
      semanticFallback: "lexical-only",
      semanticMaximumResults: 20,
      semanticRequiresIdempotencyKey: true,
    });
    expect(manifest.mcp).toMatchObject({
      resource: "https://www.symbaiex.com/api/agent/mcp",
      serverInfo: {
        name: "symbaiex-evidence",
        version: "v1",
        responseHeaders: ["Mcp-Server-Name", "Mcp-Server-Version"],
      },
      supportedProtocolVersions: ["2026-07-28", "2025-03-26"],
      modernDiscoveryMethod: "server/discover",
      legacyInitializeCompatibility: true,
    });
    expect(manifest.premiumBoundary).toMatchObject({
      enabled: false,
      hostname: null,
      documentation: "https://www.symbaiex.com/agent/instructions",
    });
    expect(manifest.researchJobs.enabled).toBe(true);
    expect(manifest.exports).toMatchObject({ enabled: true, format: "jsonl" });
    expect(manifest.webhooks.infrastructureEnabled).toBe(true);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
  });

  test("supports discovery HEAD requests without a body", async () => {
    const response = HEAD();
    expect(response.status).toBe(200);
    expect(response.body).toBeNull();
    expect(response.headers.get("cache-control")).toContain("s-maxage=3600");
  });
});
