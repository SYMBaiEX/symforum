// @vitest-environment node
/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";

const modules = { ...import.meta.glob("./**/*.ts"), ...import.meta.glob("./**/*.tsx") };
const reserve = makeFunctionReference<"mutation", {
  nonce: string; kind: "suki-reply" | "belle-newsletter"; sourceKey: string;
}, { duplicate: boolean; run: { status: string } }>("elizaPilotValidationData:reserve");
const readPublicThread = makeFunctionReference<"query", { threadId: Id<"forumThreads"> }, unknown>(
  "elizaPilotValidationData:readPublicThread",
);
const validateSuki = makeFunctionReference<"action", { nonce: string; threadId: Id<"forumThreads"> }, {
  duplicate: boolean; run: { status: string; errorCode?: string };
}>("elizaPilotValidation:validateSuki");
const validateBelle = makeFunctionReference<"action", {
  nonce: string; runDate: string; snapshotDate: string;
}, { duplicate: boolean; run: { status: string; errorCode?: string } }>(
  "elizaPilotValidation:validateBelle",
);

function setup() { return convexTest(schema, modules); }
const nonce = "pilot_unique_nonce_001";

describe("real-source pilot admission", () => {
  test("same nonce admits one attempt; conflicting target fails", async () => {
    const t = setup();
    const input = { nonce, kind: "suki-reply" as const, sourceKey: "thread:one" };
    const [a, b] = await Promise.all([t.mutation(reserve, input), t.mutation(reserve, input)]);
    expect([a.duplicate, b.duplicate].sort()).toEqual([false, true]);
    expect(await t.run(ctx => ctx.db.query("elizaPilotRuns").take(10))).toHaveLength(1);
    await expect(t.mutation(reserve, { ...input, sourceKey: "thread:two" }))
      .rejects.toThrow("pilot_nonce_conflict");
  });

  test("private or inactive public-source target cannot enter model path", async () => {
    const t = setup();
    const { privateThread, inactiveThread } = await t.run(async ctx => {
      const userId = await ctx.db.insert("users", { name: "Member" });
      const parent = await ctx.db.insert("forumCategories", {
        slug: "private", name: "Private", description: "", kind: "section",
        status: "active", viewAccess: "members", position: 0,
        threadCount: 0, postCount: 0, createdAt: 1, updatedAt: 1,
      });
      const privateBoard = await ctx.db.insert("forumCategories", {
        slug: "private-board", name: "Private board", description: "", kind: "board",
        parentCategoryId: parent, status: "active", viewAccess: "public", position: 0,
        threadCount: 0, postCount: 0, createdAt: 1, updatedAt: 1,
      });
      const publicBoard = await ctx.db.insert("forumCategories", {
        slug: "public-board", name: "Public board", description: "", kind: "board",
        status: "active", viewAccess: "public", position: 0,
        threadCount: 0, postCount: 0, createdAt: 1, updatedAt: 1,
      });
      const thread = (categoryId: Id<"forumCategories">, categorySlug: string,
        status: "active" | "hidden") => ctx.db.insert("forumThreads", {
          categoryId, categorySlug, slug: `${categorySlug}-thread`,
          title: "A real technical question", body: "How should we investigate this issue?",
          authorId: userId, status, pinned: false, replyCount: 0,
          viewCount: 0, lastPostAt: 1, lastPostUserId: userId,
          searchText: "technical question", createdAt: 1, updatedAt: 1,
        });
      return {
        privateThread: await thread(privateBoard, "private-board", "active"),
        inactiveThread: await thread(publicBoard, "public-board", "hidden"),
      };
    });
    expect(await t.query(readPublicThread, { threadId: privateThread })).toBeNull();
    expect(await t.query(readPublicThread, { threadId: inactiveThread })).toBeNull();
    const result = await t.action(validateSuki, { nonce, threadId: privateThread });
    expect(result.run).toMatchObject({ status: "blocked", errorCode: "public_source_unavailable" });
    expect(await t.run(ctx => ctx.db.query("elizaShadowJobs").take(10))).toEqual([]);
    expect(await t.run(ctx => ctx.db.get("forumThreads", privateThread)))
      .toMatchObject({ status: "active", replyCount: 0 });
    const duplicate = await t.action(validateSuki, { nonce, threadId: privateThread });
    expect(duplicate.duplicate).toBe(true);
  });

  test("nonce and target length budgets reject malformed attempts before writes", async () => {
    const t = setup();
    await expect(t.mutation(reserve, {
      nonce: "short", kind: "belle-newsletter", sourceKey: "snapshot:2026-10-20",
    })).rejects.toThrow("invalid_pilot_identity");
    await expect(t.mutation(reserve, {
      nonce, kind: "belle-newsletter", sourceKey: "x".repeat(161),
    })).rejects.toThrow("invalid_pilot_identity");
    expect(await t.run(ctx => ctx.db.query("elizaPilotRuns").take(10))).toEqual([]);
  });

  test("missing real news snapshot blocks before generation or publication", async () => {
    const t = setup();
    const result = await t.action(validateBelle, {
      nonce, runDate: "2026-10-20", snapshotDate: "2026-10-20",
    });
    expect(result.run).toMatchObject({ status: "blocked", errorCode: "complete_snapshot_required" });
    expect(await t.run(ctx => ctx.db.query("elizaShadowJobs").take(10))).toEqual([]);
    expect(await t.run(ctx => ctx.db.query("newsletterIssues").take(10))).toEqual([]);
    expect(await t.run(ctx => ctx.db.query("newsletterSendLogs").take(10))).toEqual([]);
  });
});
