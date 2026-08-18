/// <reference types="vite/client" />

import { createHash } from "node:crypto";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = {
  ...import.meta.glob("./**/*.ts"),
  ...import.meta.glob("./**/*.tsx"),
};

const dispatch = makeFunctionReference<
  "action",
  {
    query: string;
    limit: number;
    idempotencyKey: string;
    requestFingerprint: string;
  },
  Array<{ title: string; canonicalUrl: string }>
>("agentSemanticApi:dispatch");

function setup() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t);
  return t;
}

function fingerprint(query: string, limit: number) {
  return createHash("sha256")
    .update(
      `semantic_search:{"limit":${limit},"query":${JSON.stringify(query)}}`,
    )
    .digest("hex");
}

async function fixture(
  t: ReturnType<typeof setup>,
  options: {
    evidenceScope?: boolean;
    identityStatus?: "active" | "revoked";
    serviceAccount?: "active" | "revoked";
    serviceAccountOwner?: "identity" | "other";
  } = {},
) {
  const evidenceScope = options.evidenceScope ?? true;
  const ids = await t.run(async (ctx) => {
    const ownerUserId = await ctx.db.insert("users", {
      name: "Semantic owner",
      username: `semantic-owner-${crypto.randomUUID()}`,
      usernameNormalized: `semantic-owner-${crypto.randomUUID()}`,
      role: "reader",
    });
    const otherOwnerUserId = await ctx.db.insert("users", {
      name: "Other owner",
      username: `other-owner-${crypto.randomUUID()}`,
      usernameNormalized: `other-owner-${crypto.randomUUID()}`,
      role: "reader",
    });
    const agentId = `semantic-agent-${crypto.randomUUID()}`;
    const agentUserId = await ctx.db.insert("users", {
      name: "Semantic agent",
      username: agentId,
      usernameNormalized: agentId,
      role: "reader",
      isAgent: true,
      agentSlug: agentId,
      agentStatus: "active",
      agentScopes: evidenceScope ? ["evidence"] : ["forum"],
      agentKeyVersion: 1,
      agentEnrolledAt: 1,
    });
    const identityId = await ctx.db.insert("agentIdentities", {
      agentId,
      userId: agentUserId,
      ownerUserId,
      publicKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      scopes: evidenceScope ? ["evidence"] : ["forum"],
      status: options.identityStatus ?? "active",
      keyVersion: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("apiProducts", {
      productKey: "evidence-search",
      name: "Evidence search",
      description: "Bounded evidence search",
      status: "active",
      visibility: "public",
      createdAt: 1,
      updatedAt: 1,
    });

    if (options.serviceAccount !== undefined) {
      const organizationId = await ctx.db.insert("organizations", {
        slug: `semantic-org-${crypto.randomUUID()}`,
        name: "Semantic organization",
        status: "active",
        createdByUserId: ownerUserId,
        createdAt: 1,
        updatedAt: 1,
      });
      const projectId = await ctx.db.insert("organizationProjects", {
        organizationId,
        projectKey: "semantic",
        name: "Semantic project",
        status: "active",
        allowedAgentScopes: ["evidence"],
        createdByUserId: ownerUserId,
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("organizationServiceAccounts", {
        organizationId,
        projectId,
        agentIdentityId: identityId,
        agentUserId,
        ownerUserId:
          options.serviceAccountOwner === "other"
            ? otherOwnerUserId
            : ownerUserId,
        name: "Semantic service account",
        status: options.serviceAccount,
        allowedScopes: ["evidence"],
        createdByUserId: ownerUserId,
        createdAt: 1,
        updatedAt: 1,
      });
      const now = new Date();
      const monthKey = `${now.getUTCFullYear()}-${String(
        now.getUTCMonth() + 1,
      ).padStart(2, "0")}`;
      await ctx.db.insert("organizationBudgets", {
        organizationId,
        monthKey,
        currency: "USD",
        limitMicros: 1_000,
        spentMicros: 0,
        createdByUserId: ownerUserId,
        updatedByUserId: ownerUserId,
        createdAt: 1,
        updatedAt: 1,
      });
    }
    return { ownerUserId, otherOwnerUserId, agentUserId, agentId };
  });

  const source = await t.mutation(internal.evidence.upsertSource, {
    sourceKey: `semantic-source-${crypto.randomUUID()}`,
    name: "Semantic API test source",
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
    externalKey: "semantic-transport",
    canonicalUrl: "https://example.test/semantic-transport",
    canonicalUrlHash: `url-${crypto.randomUUID()}`,
    contentHash: `content-${crypto.randomUUID()}`,
    kind: "release",
    visibility: "public",
    title: "Authenticated semantic transport",
    excerpt: "A public lexical fallback for semantic transport.",
    searchText: "authenticated semantic transport lexical fallback",
    tags: ["semantic"],
    authors: ["SYMBaiEX"],
    documentLicenseClass: "open",
    fetchedAt: 1,
    publishedAt: 1,
    sourceRevision: "v1",
    sourceUpdatedAt: 1,
    retrievalUrl: "https://example.test/semantic-transport",
    licenseClass: "open",
  });
  return ids;
}

function args(
  idempotencyKey = "semantic-action-001",
  query = "semantic transport",
  limit = 10,
) {
  return {
    query,
    limit,
    idempotencyKey,
    requestFingerprint: fingerprint(query, limit),
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("authenticated semantic search transport", () => {
  test("returns lexical fallback and replays without another debit or provider call", async () => {
    vi.stubEnv("SEMANTIC_SEARCH_ENABLED", "false");
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const t = setup();
    const ids = await fixture(t);
    const agent = t.withIdentity({ subject: ids.agentUserId });

    const first = await agent.action(dispatch, args());
    const replay = await agent.action(dispatch, args());
    expect(first).toEqual(replay);
    expect(first[0]?.title).toMatch(/semantic transport/i);
    expect(fetchMock).not.toHaveBeenCalled();
    await t.run(async (ctx) => {
      expect(await ctx.db.query("agentQuotaUsage").collect()).toHaveLength(1);
      expect(await ctx.db.query("apiUsageLedger").collect()).toHaveLength(1);
      const command = await ctx.db.query("apiCommands").unique();
      expect(command?.ownerUserId).toBe(ids.ownerUserId);
      expect(command?.status).toBe("completed");
      expect(command?.resultJson).not.toContain("convex.site");
    });
  });

  test("rejects owner spoofing, scope removal, revocation, and fingerprint mismatch before spend", async () => {
    vi.stubEnv("SEMANTIC_SEARCH_ENABLED", "true");
    const fetchMock = vi.spyOn(globalThis, "fetch");

    for (const options of [
      { evidenceScope: false },
      { identityStatus: "revoked" as const },
      {
        serviceAccount: "active" as const,
        serviceAccountOwner: "other" as const,
      },
      { serviceAccount: "revoked" as const },
    ]) {
      const t = setup();
      const ids = await fixture(t, options);
      const agent = t.withIdentity({ subject: ids.agentUserId });
      await expect(agent.action(dispatch, args())).rejects.toThrow();
      await t.run(async (ctx) => {
        expect(await ctx.db.query("agentQuotaUsage").collect()).toHaveLength(0);
        expect(await ctx.db.query("apiUsageLedger").collect()).toHaveLength(0);
        expect(
          await ctx.db.query("organizationUsageLedger").collect(),
        ).toHaveLength(0);
      });
    }

    const t = setup();
    const ids = await fixture(t);
    const agent = t.withIdentity({ subject: ids.agentUserId });
    await expect(
      agent.action(dispatch, {
        ...args(),
        requestFingerprint: "0".repeat(64),
      }),
    ).rejects.toThrow(/fingerprint/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("reserves organization service-account budget once before lexical fallback", async () => {
    vi.stubEnv("SEMANTIC_SEARCH_ENABLED", "false");
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const t = setup();
    const ids = await fixture(t, { serviceAccount: "active" });
    const agent = t.withIdentity({ subject: ids.agentUserId });
    await expect(
      agent.action(dispatch, args("semantic-org-001")),
    ).resolves.toHaveLength(1);
    await expect(
      agent.action(dispatch, args("semantic-org-001")),
    ).resolves.toHaveLength(1);
    await t.run(async (ctx) => {
      const usage = await ctx.db.query("organizationUsageLedger").unique();
      expect(usage?.amountMicros).toBe(12);
      const budget = await ctx.db.query("organizationBudgets").unique();
      expect(budget?.spentMicros).toBe(12);
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("rejects an idempotency key reused for another query", async () => {
    vi.stubEnv("SEMANTIC_SEARCH_ENABLED", "false");
    const t = setup();
    const ids = await fixture(t);
    const agent = t.withIdentity({ subject: ids.agentUserId });
    await agent.action(dispatch, args("semantic-reuse-001", "first query"));
    await expect(
      agent.action(dispatch, args("semantic-reuse-001", "second query")),
    ).rejects.toThrow(/idempotency|fingerprint|different/i);
    await t.run(async (ctx) => {
      expect(await ctx.db.query("agentQuotaUsage").collect()).toHaveLength(1);
      expect(await ctx.db.query("apiUsageLedger").collect()).toHaveLength(1);
    });
  });
});
