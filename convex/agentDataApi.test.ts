/// <reference types="vite/client" />

import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";

import { internal } from "./_generated/api";
import schema from "./schema";

const modules = {
  ...import.meta.glob("./**/*.ts"),
  ...import.meta.glob("./**/*.tsx"),
};

function setup() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t);
  return t;
}

async function fixture(t: ReturnType<typeof setup>, evidenceScope = true) {
  const ids = await t.run(async (ctx) => {
    const ownerUserId = await ctx.db.insert("users", {
      name: "Evidence owner",
      username: `evidence-owner-${evidenceScope}`,
      usernameNormalized: `evidence-owner-${evidenceScope}`,
      role: "reader",
    });
    const agentUserId = await ctx.db.insert("users", {
      name: "Evidence agent",
      username: `evidence-agent-${evidenceScope}`,
      usernameNormalized: `evidence-agent-${evidenceScope}`,
      role: "reader",
      isAgent: true,
      agentSlug: `evidence-agent-${evidenceScope}`,
      agentStatus: "active",
      agentScopes: evidenceScope ? ["evidence"] : ["forum"],
      agentKeyVersion: 1,
      agentEnrolledAt: 1,
    });
    await ctx.db.insert("agentIdentities", {
      agentId: `evidence-agent-${evidenceScope}`,
      userId: agentUserId,
      ownerUserId,
      publicKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      scopes: evidenceScope ? ["evidence"] : ["forum"],
      status: "active",
      keyVersion: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    return { ownerUserId, agentUserId };
  });
  await t.mutation(internal.evidenceJobs.ensureCatalog, {});
  const source = await t.mutation(internal.evidence.upsertSource, {
    sourceKey: "api-test-source",
    name: "API test source",
    sourceType: "api",
    ingestionEnabled: true,
    baseUrl: "https://example.test/api",
    homepageUrl: "https://example.test",
    status: "active",
    licenseClass: "open",
    provenanceClass: "official",
    visibility: "public",
    termsUrl: "https://example.test/terms",
    etag: "",
    lastModified: "",
    cursor: "",
    lastFetchedAt: 1,
    lastSucceededAt: 1,
    lastErrorAt: 0,
    lastErrorMessage: "",
  });
  await t.mutation(internal.evidence.upsertDocumentVersion, {
    sourceId: source.sourceId,
    externalKey: "convex-release",
    canonicalUrl: "https://example.test/convex-release",
    canonicalUrlHash: "url-hash",
    contentHash: "content-hash",
    kind: "release",
    visibility: "public",
    title: "Convex evidence API release",
    excerpt: "A public Convex evidence API release.",
    searchText: "Convex evidence API release",
    tags: ["convex"],
    authors: ["Example"],
    documentLicenseClass: "open",
    fetchedAt: 1,
    publishedAt: 1,
    sourceRevision: "v1",
    sourceUpdatedAt: 1,
    retrievalUrl: "https://example.test/convex-release",
    licenseClass: "open",
  });
  return ids;
}

describe("agent data API dispatch", () => {
  test("HTTP route preserves safe ConvexError codes without returning error data", async () => {
    const t = setup();
    const unauthenticated = await t.fetch("/agent/v1", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(unauthenticated.status).toBe(401);
    expect(await unauthenticated.json()).toEqual({
      code: "AUTH_REQUIRED",
      error: "A bearer access token is required.",
    });

    const invalidToken = await t.fetch("/agent/v1", {
      method: "POST",
      headers: {
        authorization: "Bearer invalid-public-smoke-token",
        "content-type": "application/json",
      },
      body: "{}",
    });
    expect(invalidToken.status).toBe(401);
    expect(invalidToken.headers.get("www-authenticate")).toContain(
      'error="invalid_token"',
    );
    expect(await invalidToken.json()).toEqual({
      code: "INVALID_TOKEN",
      error: "A bearer access token is required.",
    });

    const ids = await fixture(t);
    const agent = t.withIdentity({ subject: ids.agentUserId });
    const invalid = await agent.fetch("/agent/v1", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operation: "search",
        input: { query: "" },
        idempotencyKey: "invalid-http-search",
        requestFingerprint: "sha256-invalid-http-search",
      }),
    });

    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({
      code: "INVALID_REQUEST",
      error: "Agent data request could not be completed.",
    });

    const deniedIds = await fixture(t, false);
    const deniedAgent = t.withIdentity({ subject: deniedIds.agentUserId });
    const denied = await deniedAgent.fetch("/agent/v1", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operation: "status",
        input: {},
        idempotencyKey: "denied-http-status",
        requestFingerprint: "sha256-denied-http-status",
      }),
    });

    expect(denied.status).toBe(403);
    expect(denied.headers.get("www-authenticate")).toContain(
      'error="insufficient_scope"',
    );
    expect(await denied.json()).toEqual({
      code: "AGENT_SCOPE_DENIED",
      error: "An active agent identity with the evidence scope is required.",
    });
  });

  test("uses one owner-scoped quota and commerce record across a replay", async () => {
    const t = setup();
    const ids = await fixture(t);
    const agent = t.withIdentity({ subject: ids.agentUserId });
    const args = {
      operation: "search" as const,
      input: { query: "Convex", limit: 5 },
      idempotencyKey: "search-one",
      requestFingerprint: "sha256-search-one",
    };
    await expect(
      agent.mutation(internal.agentDataApi.dispatch, args),
    ).resolves.toHaveLength(1);
    await expect(
      agent.mutation(internal.agentDataApi.dispatch, args),
    ).resolves.toHaveLength(1);
    await t.run(async (ctx) => {
      expect(await ctx.db.query("agentQuotaUsage").collect()).toHaveLength(1);
      const ledger = await ctx.db.query("apiUsageLedger").unique();
      expect(ledger?.ownerUserId).toBe(ids.ownerUserId);
      expect(ledger?.operation).toBe("evidence.search");
    });
  });

  test("replays webhook side effects exactly once for an idempotency key", async () => {
    vi.stubEnv("EVIDENCE_WEBHOOK_ALLOWED_HOSTS", "hooks.example.test");
    vi.stubEnv("EVIDENCE_WEBHOOK_KEK", "test_webhook_kek_0123456789abcdef");
    try {
      const t = setup();
      const ids = await fixture(t);
      const agent = t.withIdentity({ subject: ids.agentUserId });
      const createArgs = {
        operation: "webhooks_create" as const,
        input: {
          subscriptionKey: "research-events",
          url: "https://hooks.example.test/v1/evidence",
          eventTypes: ["evidence.research.completed"],
        },
        idempotencyKey: "webhook-create-once",
        requestFingerprint: "sha256-webhook-create-once",
      };
      const created = await agent.mutation(internal.agentDataApi.dispatch, createArgs);
      const createdReplay = await agent.mutation(internal.agentDataApi.dispatch, createArgs);
      expect(createdReplay).toEqual(created);
      await expect(
        agent.mutation(internal.agentDataApi.dispatch, {
          ...createArgs,
          requestFingerprint: "sha256-webhook-create-different",
        }),
      ).rejects.toThrow(/different operation|fingerprint/i);

      const rotateArgs = {
        operation: "webhooks_rotate" as const,
        input: { subscriptionKey: "research-events" },
        idempotencyKey: "webhook-rotate-once",
        requestFingerprint: "sha256-webhook-rotate-once",
      };
      const rotated = await agent.mutation(internal.agentDataApi.dispatch, rotateArgs);
      const rotatedReplay = await agent.mutation(internal.agentDataApi.dispatch, rotateArgs);
      expect(rotatedReplay).toEqual(rotated);

      const testArgs = {
        operation: "webhooks_test" as const,
        input: {
          subscriptionKey: "research-events",
          eventType: "evidence.research.completed",
        },
        idempotencyKey: "webhook-test-once",
        requestFingerprint: "sha256-webhook-test-once",
      };
      const sent = await agent.mutation(internal.agentDataApi.dispatch, testArgs);
      const sentReplay = await agent.mutation(internal.agentDataApi.dispatch, testArgs);
      expect(sentReplay).toEqual(sent);
      await t.run(async (ctx) => {
        expect(await ctx.db.query("apiWebhookEvents").collect()).toHaveLength(1);
        expect(await ctx.db.query("apiWebhookDeliveries").collect()).toHaveLength(1);
      });

      const replayDelivery = await t.run(async (ctx) => {
        const subscription = await ctx.db.query("apiWebhookSubscriptions").first();
        if (subscription === null) throw new Error("Expected webhook subscription");
        await ctx.db.insert("apiWebhookEvents", {
          provider: "evidence-delivery",
          eventKey: "research:failed-once",
          payloadJson: JSON.stringify({ eventType: "evidence.research.completed", payloadJson: JSON.stringify({ failed: true }) }),
          receivedAt: Date.now(),
        });
        return await ctx.db.insert("apiWebhookDeliveries", {
          subscriptionId: subscription._id,
          eventKey: "research:failed-once",
          status: "dead_letter",
          attempt: 4,
          replayCount: 0,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      });
      const replayArgs = {
        operation: "webhooks_replay" as const,
        input: { subscriptionKey: "research-events", eventKey: "research:failed-once" },
        idempotencyKey: "webhook-replay-once",
        requestFingerprint: "sha256-webhook-replay-once",
      };
      const replayed = await agent.mutation(internal.agentDataApi.dispatch, replayArgs);
      const replayedAgain = await agent.mutation(internal.agentDataApi.dispatch, replayArgs);
      expect(replayedAgain).toEqual(replayed);
      await t.run(async (ctx) => {
        expect(await ctx.db.get("apiWebhookDeliveries", replayDelivery)).toMatchObject({
          replayCount: 1,
          status: "in_flight",
        });
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  test("routes universal search through the evidence scope and shared quota path", async () => {
    const t = setup();
    const ids = await fixture(t);
    const agent = t.withIdentity({ subject: ids.agentUserId });
    await expect(
      agent.mutation(internal.agentDataApi.dispatch, {
        operation: "universal_search",
        input: { query: "Convex", limit: 5 },
        idempotencyKey: "universal-search-one",
        requestFingerprint: "sha256-universal-search-one",
      }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "evidence_document",
          visibility: "public",
        }),
      ]),
    );
    const deniedIds = await fixture(t, false);
    await expect(
      t
        .withIdentity({ subject: deniedIds.agentUserId })
        .mutation(internal.agentDataApi.dispatch, {
          operation: "universal_search",
          input: { query: "Convex" },
          idempotencyKey: "universal-search-denied",
          requestFingerprint: "sha256-universal-search-denied",
        }),
    ).rejects.toThrow(/evidence scope/i);
  });

  test("validates inputs before usage and rejects agents without evidence scope", async () => {
    const t = setup();
    const ids = await fixture(t);
    const agent = t.withIdentity({ subject: ids.agentUserId });
    await expect(
      agent.mutation(internal.agentDataApi.dispatch, {
        operation: "search",
        input: { query: "" },
        idempotencyKey: "invalid-search",
        requestFingerprint: "sha256-invalid",
      }),
    ).rejects.toThrow(/query is required/i);
    await t.run(async (ctx) => {
      expect(await ctx.db.query("agentQuotaUsage").collect()).toHaveLength(0);
      expect(await ctx.db.query("apiUsageLedger").collect()).toHaveLength(0);
    });

    const deniedIds = await fixture(t, false);
    const denied = t.withIdentity({ subject: deniedIds.agentUserId });
    await expect(
      denied.mutation(internal.agentDataApi.dispatch, {
        operation: "status",
        input: {},
        idempotencyKey: "status-one",
        requestFingerprint: "sha256-status",
      }),
    ).rejects.toThrow(/evidence scope/i);
  });

  test("never exposes citations or claims from a private document version", async () => {
    const t = setup();
    const ids = await fixture(t);
    const privateEvidence = await t.run(async (ctx) => {
      const source = await ctx.db.query("evidenceSources").first();
      const documentId = await ctx.db.insert("evidenceDocuments", {
        sourceId: source!._id,
        externalKey: "private-api-document",
        canonicalUrl: "https://example.test/private-api-document",
        canonicalUrlHash: "private-api-url-hash",
        kind: "document",
        visibility: "private",
        title: "Private API document",
        excerpt: "Private",
        searchText: "Private",
        tags: [],
        authors: [],
        licenseClass: "restricted",
        currentVersionId: null,
        publishedAt: null,
        firstSeenAt: 1,
        updatedAt: 1,
      });
      const versionId = await ctx.db.insert("evidenceDocumentVersions", {
        documentId,
        version: 1,
        contentHash: "private-api-content-hash",
        title: "Private API document",
        excerpt: "Private",
        searchText: "Private",
        fetchedAt: 1,
        publishedAt: null,
        sourceRevision: "private-v1",
        sourceUpdatedAt: 1,
        rawStorageId: null,
        retrievalUrl: "https://example.test/private-api-document",
        licenseClass: "restricted",
        metadataJson: "{}",
        createdAt: 1,
      });
      await ctx.db.patch("evidenceDocuments", documentId, {
        currentVersionId: versionId,
      });
      const claimId = await ctx.db.insert("evidenceClaims", {
        claimKey: "legacy-private-citation",
        statement: "A legacy public claim has private backing.",
        subjectEntityId: null,
        predicate: "privacy",
        objectText: "protected",
        status: "supported",
        confidence: 0.8,
        visibility: "public",
        observedAt: 1,
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("evidenceClaimCitations", {
        claimId,
        documentVersionId: versionId,
        citationKey: "legacy-private-citation-v1",
        relation: "supports",
        locator: "private paragraph",
        excerpt: "This excerpt is private.",
        confidence: 0.8,
        createdAt: 1,
      });
      return { claimId, versionId };
    });
    const agent = t.withIdentity({ subject: ids.agentUserId });
    await expect(
      agent.mutation(internal.agentDataApi.dispatch, {
        operation: "verify",
        input: { claimId: privateEvidence.claimId },
        idempotencyKey: "verify-private-citation",
        requestFingerprint: "sha256-verify-private-citation",
      }),
    ).resolves.toMatchObject({ citations: [] });
    await expect(
      agent.mutation(internal.agentDataApi.dispatch, {
        operation: "version_claims",
        input: { documentVersionId: privateEvidence.versionId },
        idempotencyKey: "claims-private-version",
        requestFingerprint: "sha256-claims-private-version",
      }),
    ).resolves.toEqual([]);
  });
});
