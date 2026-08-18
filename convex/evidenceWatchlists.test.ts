/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { makeFunctionReference } from "convex/server";
import { describe, expect, test } from "vitest";
import schema from "./schema";

const modules = {
  ...import.meta.glob("./**/*.ts"),
  ...import.meta.glob("./**/*.tsx"),
};
const watchlists = {
  create: makeFunctionReference<"mutation", any, any>(
    "evidenceWatchlists:create",
  ),
  listMine: makeFunctionReference<"query", any, any>(
    "evidenceWatchlists:listMine",
  ),
  setStatus: makeFunctionReference<"mutation", any, any>(
    "evidenceWatchlists:setStatus",
  ),
  remove: makeFunctionReference<"mutation", any, any>(
    "evidenceWatchlists:remove",
  ),
  drain: makeFunctionReference<"mutation", any, any>(
    "evidenceWatchlists:drainMine",
  ),
} as const;

function setup() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t);
  return t;
}

async function fixture(t: ReturnType<typeof setup>) {
  return await t.run(async (ctx) => {
    const owner = await ctx.db.insert("users", {
      name: "Owner",
      username: "owner",
      usernameNormalized: "owner",
      role: "owner",
    });
    const otherOwner = await ctx.db.insert("users", {
      name: "Other",
      username: "other",
      usernameNormalized: "other",
      role: "reader",
    });
    const agentOne = await ctx.db.insert("users", {
      name: "Agent One",
      username: "agent-one",
      usernameNormalized: "agent-one",
      role: "reader",
      isAgent: true,
      agentSlug: "agent-one",
      agentStatus: "active",
      agentScopes: ["evidence"],
    });
    const agentTwo = await ctx.db.insert("users", {
      name: "Agent Two",
      username: "agent-two",
      usernameNormalized: "agent-two",
      role: "reader",
      isAgent: true,
      agentSlug: "agent-two",
      agentStatus: "active",
      agentScopes: ["evidence"],
    });
    for (const [agentId, userId] of [
      ["agent-one", agentOne],
      ["agent-two", agentTwo],
    ] as const) {
      await ctx.db.insert("agentIdentities", {
        agentId,
        userId,
        ownerUserId: owner,
        publicKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        scopes: ["evidence"],
        status: "active",
        keyVersion: 1,
        createdAt: 1,
        updatedAt: 1,
      });
    }
    await ctx.db.insert("evidenceSources", {
      sourceKey: "public-source",
      name: "Public source",
      sourceType: "manual",
      ingestionEnabled: true,
      baseUrl: "https://example.com",
      homepageUrl: "https://example.com",
      status: "active",
      licenseClass: "open",
      provenanceClass: "official",
      visibility: "public",
      termsUrl: "https://example.com/terms",
      etag: "",
      lastModified: "",
      cursor: "",
      lastFetchedAt: 0,
      lastSucceededAt: 0,
      lastErrorAt: 0,
      lastErrorMessage: "",
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("evidenceEntities", {
      entityKey: "public-entity",
      kind: "organization",
      name: "Public entity",
      aliases: [],
      visibility: "public",
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("evidenceClaims", {
      claimKey: "private-claim",
      statement: "Private claim.",
      subjectEntityId: null,
      predicate: "private",
      objectText: "private",
      status: "unresolved",
      confidence: 0.5,
      visibility: "private",
      observedAt: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    return { owner, otherOwner, agentOne, agentTwo };
  });
}

describe("evidence watchlists", () => {
  test("uses the server-derived owner and agent principal, with pause, resume, and deletion", async () => {
    const t = setup();
    const ids = await fixture(t);
    const agentOne = t.withIdentity({ subject: ids.agentOne });
    const agentTwo = t.withIdentity({ subject: ids.agentTwo });
    const owner = t.withIdentity({ subject: ids.owner });
    const otherOwner = t.withIdentity({ subject: ids.otherOwner });
    const created = await agentOne.mutation(watchlists.create, {
      watchlistKey: "release-watch",
      targetType: "source",
      targetKey: "public-source",
      deliveryPreference: "in_app",
      eventCursor: "cursor-1",
    });
    expect(created).toMatchObject({ agentId: "agent-one", status: "active" });
    await expect(
      agentOne.mutation(watchlists.create, {
        watchlistKey: "release-watch",
        targetType: "source",
        targetKey: "public-source",
        deliveryPreference: "in_app",
        eventCursor: "cursor-1",
      }),
    ).resolves.toMatchObject({ watchlistId: created.watchlistId });
    expect(await agentTwo.query(watchlists.listMine, {})).toEqual([]);
    expect(await owner.query(watchlists.listMine, {})).toMatchObject([
      { watchlistKey: "release-watch", agentId: "agent-one" },
    ]);
    await expect(
      agentTwo.mutation(watchlists.setStatus, {
        watchlistKey: "release-watch",
        status: "paused",
      }),
    ).rejects.toThrow(/not found/i);
    await expect(
      otherOwner.mutation(watchlists.remove, { watchlistKey: "release-watch" }),
    ).rejects.toThrow(/not found/i);
    await expect(
      agentOne.mutation(watchlists.create, {
        watchlistKey: "private-watch",
        targetType: "claim",
        targetKey: "private-claim",
        deliveryPreference: "none",
      }),
    ).rejects.toThrow(/public evidence targets/i);
    await agentOne.mutation(watchlists.setStatus, {
      watchlistKey: "release-watch",
      status: "paused",
    });
    await expect(
      agentOne.mutation(watchlists.setStatus, {
        watchlistKey: "release-watch",
        status: "active",
      }),
    ).resolves.toMatchObject({ status: "active" });
    await agentOne.mutation(watchlists.remove, {
      watchlistKey: "release-watch",
    });
    expect(await owner.query(watchlists.listMine, {})).toEqual([]);
  });
});

describe("watchlist outbox", () => {
  test("replays public source events exactly once and advances its opaque cursor", async () => {
    const t = setup();
    const ids = await fixture(t);
    const owner = t.withIdentity({ subject: ids.owner });
    await owner.mutation(watchlists.create, {
      watchlistKey: "source",
      targetType: "source",
      targetKey: "public-source",
      deliveryPreference: "in_app",
    });
    await t.run(async (ctx) => {
      const source = await ctx.db
        .query("evidenceSources")
        .withIndex("by_sourceKey", (q) => q.eq("sourceKey", "public-source"))
        .unique();
      if (!source) throw new Error("source fixture missing");
      const documentId = await ctx.db.insert("evidenceDocuments", {
        sourceId: source._id,
        externalKey: "release-1",
        canonicalUrl: "https://example.com/release-1",
        canonicalUrlHash: "hash-1",
        kind: "release",
        visibility: "public",
        title: "Release",
        excerpt: "",
        searchText: "",
        tags: [],
        authors: [],
        licenseClass: "open",
        currentVersionId: null,
        publishedAt: null,
        firstSeenAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("evidenceChangeEvents", {
        eventKey: "document:release-1",
        entityType: "document",
        entityId: documentId,
        kind: "created",
        visibility: "public",
        summary: "Release",
        occurredAt: 1,
        createdAt: 1,
      });
    });
    const first = await owner.mutation(watchlists.drain, {
      watchlistKey: "source",
      idempotencyKey: "source-drain-1",
      requestFingerprint: "source-v1",
    });
    expect(first).toMatchObject({ scanned: 1, matched: 1, enqueued: 1 });
    expect(first.eventCursor).toEqual(expect.any(String));
    await expect(
      owner.mutation(watchlists.drain, {
        watchlistKey: "source",
        idempotencyKey: "source-drain-1",
        requestFingerprint: "source-v1",
      }),
    ).resolves.toMatchObject({ enqueued: 1 });
    await t.run(async (ctx) => {
      const rows = await ctx.db
        .query("evidenceWatchlistOutbox")
        .withIndex("by_status_and_createdAt", (q) => q.eq("status", "pending"))
        .take(10);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        ownerUserId: ids.owner,
        agentId: null,
        deliveryPreference: "in_app",
        eventKey: "document:release-1",
      });
    });
  });

  test("fails closed for private or retired targets and isolates owner rows", async () => {
    const t = setup();
    const ids = await fixture(t);
    const owner = t.withIdentity({ subject: ids.owner });
    const other = t.withIdentity({ subject: ids.otherOwner });
    await owner.mutation(watchlists.create, {
      watchlistKey: "source",
      targetType: "source",
      targetKey: "public-source",
      deliveryPreference: "none",
    });
    await expect(
      other.mutation(watchlists.drain, {
        watchlistKey: "source",
        idempotencyKey: "other-drain-1",
        requestFingerprint: "source-v1",
      }),
    ).rejects.toThrow(/not found/i);
    await t.run(async (ctx) => {
      const source = await ctx.db
        .query("evidenceSources")
        .withIndex("by_sourceKey", (q) => q.eq("sourceKey", "public-source"))
        .unique();
      if (!source) throw new Error("source fixture missing");
      await ctx.db.patch("evidenceSources", source._id, { status: "retired" });
    });
    await expect(
      owner.mutation(watchlists.drain, {
        watchlistKey: "source",
        idempotencyKey: "retired-drain-1",
        requestFingerprint: "source-v1",
      }),
    ).resolves.toMatchObject({ scanned: 0, enqueued: 0 });
    await t.run(async (ctx) => {
      expect(
        await ctx.db
          .query("evidenceWatchlistOutbox")
          .withIndex("by_status_and_createdAt", (q) =>
            q.eq("status", "pending"),
          )
          .take(10),
      ).toEqual([]);
    });
    await expect(
      owner.mutation(watchlists.create, {
        watchlistKey: "retired-source",
        targetType: "source",
        targetKey: "public-source",
        deliveryPreference: "in_app",
      }),
    ).rejects.toThrow(/current public evidence targets/i);
    await t.run(async (ctx) => {
      const entity = await ctx.db
        .query("evidenceEntities")
        .withIndex("by_entityKey", (q) => q.eq("entityKey", "public-entity"))
        .unique();
      if (!entity) throw new Error("entity fixture missing");
      await ctx.db.patch("evidenceEntities", entity._id, {
        visibility: "private",
      });
    });
    await expect(
      owner.mutation(watchlists.create, {
        watchlistKey: "private-entity",
        targetType: "entity",
        targetKey: "public-entity",
        deliveryPreference: "none",
      }),
    ).rejects.toThrow(/current public evidence targets/i);
  });

  test("caps a drain at one bounded page and resumes from its checkpoint", async () => {
    const t = setup();
    const ids = await fixture(t);
    const owner = t.withIdentity({ subject: ids.owner });
    await owner.mutation(watchlists.create, {
      watchlistKey: "source",
      targetType: "source",
      targetKey: "public-source",
      deliveryPreference: "webhook",
    });
    await t.run(async (ctx) => {
      const source = await ctx.db
        .query("evidenceSources")
        .withIndex("by_sourceKey", (q) => q.eq("sourceKey", "public-source"))
        .unique();
      if (!source) throw new Error("source fixture missing");
      for (let index = 0; index < 25; index += 1) {
        const documentId = await ctx.db.insert("evidenceDocuments", {
          sourceId: source._id,
          externalKey: `release-${index}`,
          canonicalUrl: `https://example.com/release-${index}`,
          canonicalUrlHash: `hash-${index}`,
          kind: "release",
          visibility: "public",
          title: `Release ${index}`,
          excerpt: "",
          searchText: "",
          tags: [],
          authors: [],
          licenseClass: "open",
          currentVersionId: null,
          publishedAt: null,
          firstSeenAt: index + 1,
          updatedAt: index + 1,
        });
        await ctx.db.insert("evidenceChangeEvents", {
          eventKey: `document:release-${index}`,
          entityType: "document",
          entityId: documentId,
          kind: "created",
          visibility: "public",
          summary: `Release ${index}`,
          occurredAt: index + 1,
          createdAt: index + 1,
        });
      }
    });
    await expect(
      owner.mutation(watchlists.drain, {
        watchlistKey: "source",
        idempotencyKey: "capped-drain-1",
        requestFingerprint: "source-v1",
      }),
    ).resolves.toMatchObject({ scanned: 20, matched: 20, enqueued: 20 });
    await expect(
      owner.mutation(watchlists.drain, {
        watchlistKey: "source",
        idempotencyKey: "capped-drain-2",
        requestFingerprint: "source-v1",
      }),
    ).resolves.toMatchObject({ scanned: 5, matched: 5, enqueued: 5 });
  });

  test("requires current public source ancestry for document and claim targets", async () => {
    const t = setup();
    const ids = await fixture(t);
    const owner = t.withIdentity({ subject: ids.owner });
    const fixtureIds = await t.run(async (ctx) => {
      const source = await ctx.db
        .query("evidenceSources")
        .withIndex("by_sourceKey", (q) => q.eq("sourceKey", "public-source"))
        .unique();
      if (!source) throw new Error("source fixture missing");
      const documentId = await ctx.db.insert("evidenceDocuments", {
        sourceId: source._id,
        externalKey: "cited-document",
        canonicalUrl: "https://example.com/cited-document",
        canonicalUrlHash: "cited-document",
        kind: "document",
        visibility: "public",
        title: "Cited document",
        excerpt: "",
        searchText: "",
        tags: [],
        authors: [],
        licenseClass: "open",
        currentVersionId: null,
        publishedAt: null,
        firstSeenAt: 1,
        updatedAt: 1,
      });
      const versionId = await ctx.db.insert("evidenceDocumentVersions", {
        documentId,
        version: 1,
        contentHash: "cited-v1",
        title: "Cited document",
        excerpt: "",
        searchText: "",
        fetchedAt: 1,
        publishedAt: null,
        sourceRevision: "1",
        sourceUpdatedAt: 1,
        rawStorageId: null,
        retrievalUrl: "https://example.com/cited-document",
        licenseClass: "open",
        metadataJson: "{}",
        createdAt: 1,
      });
      await ctx.db.patch("evidenceDocuments", documentId, {
        currentVersionId: versionId,
      });
      const claimId = await ctx.db.insert("evidenceClaims", {
        claimKey: "public-claim",
        statement: "Public claim.",
        subjectEntityId: null,
        predicate: "states",
        objectText: "fact",
        status: "supported",
        confidence: 1,
        visibility: "public",
        observedAt: 1,
        createdAt: 1,
        updatedAt: 1,
      });
      return { sourceId: source._id, documentId, versionId, claimId };
    });
    await expect(
      owner.mutation(watchlists.create, {
        watchlistKey: "claim-without-citation",
        targetType: "claim",
        targetKey: "public-claim",
        deliveryPreference: "none",
      }),
    ).rejects.toThrow(/current public evidence targets/i);
    await t.run(async (ctx) => {
      await ctx.db.insert("evidenceClaimCitations", {
        claimId: fixtureIds.claimId,
        documentVersionId: fixtureIds.versionId,
        citationKey: "public-claim-citation",
        relation: "supports",
        locator: "section-1",
        excerpt: "Public evidence.",
        confidence: 1,
        createdAt: 1,
      });
    });
    await owner.mutation(watchlists.create, {
      watchlistKey: "claim",
      targetType: "claim",
      targetKey: "public-claim",
      deliveryPreference: "none",
    });
    await t.run(async (ctx) => {
      await ctx.db.patch("evidenceDocuments", fixtureIds.documentId, {
        visibility: "private",
      });
    });
    await expect(
      owner.mutation(watchlists.drain, {
        watchlistKey: "claim",
        idempotencyKey: "private-citation-document",
        requestFingerprint: "claim-v1",
      }),
    ).resolves.toMatchObject({ scanned: 0, enqueued: 0 });
    await t.run(async (ctx) => {
      await ctx.db.patch("evidenceDocuments", fixtureIds.documentId, {
        visibility: "public",
      });
    });
    await owner.mutation(watchlists.create, {
      watchlistKey: "document",
      targetType: "document",
      targetKey: fixtureIds.documentId,
      deliveryPreference: "none",
    });
    await t.run(async (ctx) => {
      await ctx.db.patch("evidenceSources", fixtureIds.sourceId, {
        status: "paused",
      });
    });
    await expect(
      owner.mutation(watchlists.drain, {
        watchlistKey: "claim",
        idempotencyKey: "paused-claim-drain",
        requestFingerprint: "claim-v1",
      }),
    ).resolves.toMatchObject({ scanned: 0, enqueued: 0 });
    await expect(
      owner.mutation(watchlists.create, {
        watchlistKey: "paused-document",
        targetType: "document",
        targetKey: fixtureIds.documentId,
        deliveryPreference: "none",
      }),
    ).rejects.toThrow(/current public evidence targets/i);
  });

  test("replays the same public drain key without consuming extra capacity", async () => {
    const t = setup();
    const ids = await fixture(t);
    const owner = t.withIdentity({ subject: ids.owner });
    await owner.mutation(watchlists.create, {
      watchlistKey: "source",
      targetType: "source",
      targetKey: "public-source",
      deliveryPreference: "none",
    });
    const first = await owner.mutation(watchlists.drain, {
      watchlistKey: "source",
      idempotencyKey: "same-request",
      requestFingerprint: "source-v1",
    });
    await expect(
      owner.mutation(watchlists.drain, {
        watchlistKey: "source",
        idempotencyKey: "same-request",
        requestFingerprint: "source-v1",
      }),
    ).resolves.toEqual(first);
    await expect(
      owner.mutation(watchlists.drain, {
        watchlistKey: "source",
        idempotencyKey: "same-request",
        requestFingerprint: "different-request",
      }),
    ).rejects.toThrow(/different request/i);
    await owner.mutation(watchlists.drain, {
      watchlistKey: "source",
      idempotencyKey: "second-request",
      requestFingerprint: "source-v1",
    });
    await expect(
      owner.mutation(watchlists.drain, {
        watchlistKey: "source",
        idempotencyKey: "third-request",
        requestFingerprint: "source-v1",
      }),
    ).rejects.toThrow(/rate limited/i);
  });

  test("rate limits an agent independently from its owner", async () => {
    const t = setup();
    const ids = await fixture(t);
    const agent = t.withIdentity({ subject: ids.agentOne });
    await agent.mutation(watchlists.create, {
      watchlistKey: "agent-source",
      targetType: "source",
      targetKey: "public-source",
      deliveryPreference: "none",
    });
    await agent.mutation(watchlists.drain, {
      watchlistKey: "agent-source",
      idempotencyKey: "agent-request-1",
      requestFingerprint: "source-v1",
    });
    await agent.mutation(watchlists.drain, {
      watchlistKey: "agent-source",
      idempotencyKey: "agent-request-2",
      requestFingerprint: "source-v1",
    });
    await expect(
      agent.mutation(watchlists.drain, {
        watchlistKey: "agent-source",
        idempotencyKey: "agent-request-3",
        requestFingerprint: "source-v1",
      }),
    ).rejects.toThrow(/rate limited/i);
  });

  test("serializes concurrent paused and active replays into one canonical request", async () => {
    const t = setup();
    const ids = await fixture(t);
    const owner = t.withIdentity({ subject: ids.owner });
    const paused = await owner.mutation(watchlists.create, {
      watchlistKey: "paused-source",
      targetType: "source",
      targetKey: "public-source",
      deliveryPreference: "none",
    });
    await owner.mutation(watchlists.setStatus, {
      watchlistKey: "paused-source",
      status: "paused",
    });
    const pausedResults = await Promise.all(
      Array.from({ length: 3 }, () =>
        owner.mutation(watchlists.drain, {
          watchlistKey: "paused-source",
          idempotencyKey: "paused-concurrent",
          requestFingerprint: "paused-v1",
        }),
      ),
    );
    expect(pausedResults).toEqual([
      pausedResults[0],
      pausedResults[0],
      pausedResults[0],
    ]);
    await t.run(async (ctx) => {
      expect(
        await ctx.db
          .query("evidenceWatchlistDrainRequests")
          .withIndex("by_watchlistId_and_createdAt", (q) =>
            q.eq("watchlistId", paused.watchlistId),
          )
          .take(10),
      ).toHaveLength(1);
    });

    const active = await owner.mutation(watchlists.create, {
      watchlistKey: "active-source",
      targetType: "source",
      targetKey: "public-source",
      deliveryPreference: "none",
    });
    const activeResults = await Promise.all(
      Array.from({ length: 3 }, () =>
        owner.mutation(watchlists.drain, {
          watchlistKey: "active-source",
          idempotencyKey: "active-concurrent",
          requestFingerprint: "active-v1",
        }),
      ),
    );
    expect(activeResults).toEqual([
      activeResults[0],
      activeResults[0],
      activeResults[0],
    ]);
    await t.run(async (ctx) => {
      expect(
        await ctx.db
          .query("evidenceWatchlistDrainRequests")
          .withIndex("by_watchlistId_and_createdAt", (q) =>
            q.eq("watchlistId", active.watchlistId),
          )
          .take(10),
      ).toHaveLength(1);
      expect(
        await ctx.db
          .query("evidenceWatchlistOutbox")
          .withIndex("by_watchlistId_and_eventId", (q) =>
            q.eq("watchlistId", active.watchlistId),
          )
          .take(10),
      ).toHaveLength(0);
    });
  });
});
