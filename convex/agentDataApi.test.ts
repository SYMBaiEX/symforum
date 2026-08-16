/// <reference types="vite/client" />

import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

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
