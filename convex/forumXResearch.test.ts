/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { register } from "@convex-dev/rate-limiter/test";
import { afterEach, expect, test, vi } from "vitest";
import schema from "./schema";
import { installationBinding } from "./installation";
import { internal } from "./_generated/api";
const modules = import.meta.glob("./**/*.ts");
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
test("one shared paid read rotates desks, respects backoff and never exceeds six/day", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.UTC(2026, 9, 31));
  vi.stubEnv("FORUM_X_RESEARCH_ENABLED", "true");
  vi.stubEnv("FORUM_ALPHA_EDITORIAL_ENABLED", "true");
  vi.stubEnv("X_AGENTS_ENABLED", "true");
  const t = convexTest(schema, modules);
  register(t);
  const ids = await t.run(async (ctx) => {
    const ownerUserId = await ctx.db.insert("users", { role: "owner" });
    const userId = await ctx.db.insert("users", {
      isAgent: true,
      agentSlug: "nyx",
    });
    await ctx.db.insert("forumAgents", {
      slug: "nyx",
      name: "NyX",
      userId,
      persona: "Test",
      model: "test",
      enabled: true,
      dailyPostTarget: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const accountId = await ctx.db.insert("xAgentAccounts", {
      agentSlug: "nyx",
      ownerUserId,
      expectedUsername: "symbaiex_nyx",
      connected: true,
      mode: "automatic",
      epoch: 1,
      xUserId: "123",
      grant: { ciphertext: "synthetic", nonce: "synthetic" },
      scope: "tweet.read users.read tweet.write offline.access",
      updatedAt: Date.now(),
    });
    const activityId = await ctx.db.insert("xAgentActivity", {
      accountId,
      installationBinding,
      enabled: true,
      epoch: 1,
      options: { reposts: true, comments: true, aiRepliesApproved: true },
      enabledAt: Date.now(),
      nextPollAt: Date.now(),
      cursors: [],
      lease: "research",
      leaseUntil: Date.now() + 25 * 3600_000,
    });
    return { activityId, lease: "research" };
  });
  const desks = [];
  for (let i = 0; i < 6; i++) {
    const claim = await t.mutation(internal.forumXResearch.claim, ids);
    expect(claim, `paid-read slot ${i}`).not.toBeNull();
    desks.push(claim!.desk);
    expect(await t.mutation(internal.forumXResearch.claim, ids)).toBeNull();
    await t.mutation(internal.forumXResearch.finish, {
      ...ids,
      desk: claim!.desk,
      ok: true,
      posts: [],
    });
    if (i < 5) vi.advanceTimersByTime(4 * 3600_000 + 1);
  }
  expect(desks).toEqual([
    "solana",
    "pumpfun",
    "bags",
    "solana",
    "pumpfun",
    "bags",
  ]);
  expect(await t.mutation(internal.forumXResearch.claim, ids)).toBeNull();
  vi.stubEnv("FORUM_X_RESEARCH_ENABLED", "false");
  expect(await t.query(internal.forumXResearch.read, {})).toEqual([]);
});
