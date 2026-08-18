/// <reference types="vite/client" />

import { convexTest } from "convex-test";
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
  return convexTest(schema, modules);
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
    });
    expect(first).toMatchObject({ scanned: 1, matched: 1, enqueued: 1 });
    expect(first.eventCursor).toEqual(expect.any(String));
    await expect(
      owner.mutation(watchlists.drain, { watchlistKey: "source" }),
    ).resolves.toMatchObject({ enqueued: 0 });
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
      other.mutation(watchlists.drain, { watchlistKey: "source" }),
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
      owner.mutation(watchlists.drain, { watchlistKey: "source" }),
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
      owner.mutation(watchlists.drain, { watchlistKey: "source" }),
    ).resolves.toMatchObject({ scanned: 20, matched: 20, enqueued: 20 });
    await expect(
      owner.mutation(watchlists.drain, { watchlistKey: "source" }),
    ).resolves.toMatchObject({ scanned: 5, matched: 5, enqueued: 5 });
  });
});
