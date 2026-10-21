// @vitest-environment node
/// <reference types="vite/client" />

import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";

const routed = vi.hoisted(() => vi.fn());
vi.mock("../lib/ai-model-routing", async importOriginal => ({
  ...(await importOriginal<typeof import("../lib/ai-model-routing")>()),
  runWithModelFallback: routed,
}));
vi.mock("./modelRouting", async importOriginal => ({
  ...(await importOriginal<typeof import("./modelRouting")>()),
  convexModelRoutingConfig: async () => ({ openRouterApiKey: "test-only-key" }),
}));
vi.mock("./sukiForumReplyAgent", async importOriginal => ({
  ...(await importOriginal<typeof import("./sukiForumReplyAgent")>()),
  reviewForumReplyEvidence: async () => ({
    route: { persistedModel: "openrouter/free" },
    value: {
      output: { approved: true, issues: [] },
      response: { modelId: "openrouter/free" },
      usage: { inputTokens: 120, outputTokens: 20 },
    },
  }),
}));
const modules = { ...import.meta.glob("./**/*.ts"), ...import.meta.glob("./**/*.tsx") };
const sukiAction = makeFunctionReference<"action", { nonce: string; threadId: Id<"forumThreads"> }, {
  duplicate: boolean; run: { status: string; shadowJobId?: Id<"elizaShadowJobs">; baselineDecision?: string };
}>("elizaPilotValidation:validateSuki");

function setup() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t);
  return t;
}
beforeEach(() => {
  vi.stubEnv("ELIZA_SHADOW_MODE", "shadow");
  vi.stubEnv("ELIZA_SHADOW_WORKER_SECRET", "test-only-shadow-secret-at-least-32-characters");
  vi.stubEnv("ELIZA_SHADOW_WORKER_URL", "https://shadow-worker.up.railway.app");
  vi.stubEnv("ELIZA_SHADOW_DAILY_BUDGET_USD", "1");
  vi.stubEnv("OPENROUTER_DAILY_BUDGET_USD", "10");
  routed.mockReset();
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("successful pilot actions stay outside publication state", () => {
  test("missing access on a board or ancestor, and a private ancestor, stop before provider and queue", async () => {
    const t = setup();
    const targets = await t.run(async ctx => {
      const authorId = await ctx.db.insert("users", { name: "Human author" });
      const makeCategory = (slug: string, kind: "board" | "section",
        viewAccess?: "public" | "members", parentCategoryId?: Id<"forumCategories">,
      ) => ctx.db.insert("forumCategories", {
        slug, name: slug, description: "", kind,
        ...(viewAccess ? { viewAccess } : {}),
        ...(parentCategoryId ? { parentCategoryId } : {}),
        status: "active", position: 0, threadCount: 0, postCount: 0,
        createdAt: 1, updatedAt: 1,
      });
      const makeThread = (categoryId: Id<"forumCategories">, slug: string) =>
        ctx.db.insert("forumThreads", {
          categoryId, categorySlug: slug, slug: `${slug}-thread`,
          title: "A public-looking question", body: "Which records are needed to reproduce the comparison?",
          authorId, status: "active", pinned: false, replyCount: 0,
          viewCount: 0, lastPostAt: 1, lastPostUserId: authorId,
          searchText: "comparison records", createdAt: 1, updatedAt: 1,
        });
      const legacyBoard = await makeCategory("legacy-board", "board");
      const legacyParent = await makeCategory("legacy-parent", "section");
      const legacyChild = await makeCategory("legacy-child", "board", "public", legacyParent);
      const privateParent = await makeCategory("private-parent", "section", "members");
      const privateChild = await makeCategory("private-child", "board", "public", privateParent);
      return [
        await makeThread(legacyBoard, "legacy-board"),
        await makeThread(legacyChild, "legacy-child"),
        await makeThread(privateChild, "private-child"),
      ];
    });
    for (const [index, threadId] of targets.entries()) {
      const result = await t.action(sukiAction, {
        nonce: `pilot_hidden_boundary_${index}_001`, threadId,
      });
      expect(result.run).toMatchObject({
        status: "blocked", errorCode: "public_source_unavailable",
      });
    }
    expect(routed).not.toHaveBeenCalled();
    expect(await t.run(ctx => ctx.db.query("elizaShadowJobs").take(10))).toEqual([]);
    expect(await t.run(ctx => ctx.db.query("forumPosts").take(10))).toEqual([]);
  });

  test("public human Suki source uses normal route and enqueues one private shadow job", async () => {
    routed.mockImplementation(async (_config, _options, models) => {
      expect(models).toBeUndefined();
      return {
        route: { persistedModel: "openrouter/free" },
        value: {
          output: {
            decision: "reply", reason: "answer the reproducibility question",
            body: "Keep the full comparison manifest beside the results, including the prompt and evaluation settings. If a field goes missing, mark that run incomplete and rerun from the recorded inputs before comparing scores.",
            contribution: "next-step", evidenceSourceUrls: [], evidenceExcerpt: "",
          },
          response: { modelId: "openrouter/free" },
          usage: { inputTokens: 230, outputTokens: 70 },
        },
      };
    });
    const t = setup();
    const threadId = await t.run(async ctx => {
      const authorId = await ctx.db.insert("users", { name: "Human author" });
      const categoryId = await ctx.db.insert("forumCategories", {
        slug: "research", name: "Research", description: "", kind: "board",
        status: "active", viewAccess: "public", position: 0,
        threadCount: 1, postCount: 0, createdAt: 1, updatedAt: 1,
      });
      return ctx.db.insert("forumThreads", {
        categoryId, categorySlug: "research", slug: "reproducible-llm-comparisons",
        title: "A lightweight checklist for reproducible LLM comparisons",
        body: "Which manifest fields must be retained so another team can reproduce a comparison when some settings are lost?",
        authorId, status: "active", pinned: false, replyCount: 0,
        viewCount: 0, lastPostAt: 1, lastPostUserId: authorId,
        searchText: "reproducible comparisons", createdAt: 1, updatedAt: 1,
      });
    });
    const result = await t.action(sukiAction, { nonce: "pilot_success_suki_001", threadId });
    expect(result).toMatchObject({ duplicate: false, run: { status: "completed", baselineDecision: "reply" } });
    expect(result.run.shadowJobId).toBeDefined();
    expect(routed).toHaveBeenCalledTimes(1);
    const state = await t.run(async ctx => ({
      posts: await ctx.db.query("forumPosts").take(10),
      replyRuns: await ctx.db.query("forumAgentReplyRuns").take(10),
      thread: await ctx.db.get("forumThreads", threadId),
      shadow: await ctx.db.query("elizaShadowJobs").take(10),
    }));
    expect(state.posts).toEqual([]);
    expect(state.replyRuns).toEqual([]);
    expect(state.thread).toMatchObject({ replyCount: 0, status: "active" });
    expect(state.shadow).toHaveLength(1);
    expect(state.shadow[0]).toMatchObject({ kind: "suki-reply", status: "queued", isCanary: false });
  });

});
