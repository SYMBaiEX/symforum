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
