/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import { ALPHA_DESKS } from "../lib/forum-alpha-editorial";
import { startBreakingPublication } from "./forumAgentWorkflow";

vi.mock("./forumAgentWorkflow", async (original) => ({
  ...(await original<typeof import("./forumAgentWorkflow")>()),
  startBreakingPublication: vi.fn(async () => "synthetic-workflow"),
}));
const modules = import.meta.glob("./**/*.ts");
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.UTC(2026, 9, 29, 14));
  vi.stubEnv("FORUM_BREAKING_NEWS_ENABLED", "true");
  vi.stubEnv("FORUM_ALPHA_EDITORIAL_ENABLED", "true");
  vi.stubEnv("FORUM_AGENT_DAILY_PUBLICATION_LIMIT", "37");
  vi.mocked(startBreakingPublication).mockClear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
async function setup() {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("aiOperationalStates", {
      key: "forum-agent-structured-canary",
      healthy: true,
      checkedAt: Date.now(),
      pauseUntil: 0,
      updatedAt: Date.now(),
    });
    for (const slug of Object.keys(ALPHA_DESKS)) {
      const userId = await ctx.db.insert("users", {
        isAgent: true,
        agentSlug: slug,
      });
      await ctx.db.insert("forumAgents", {
        slug,
        name: slug,
        userId,
        persona: "Test",
        model: "test",
        enabled: true,
        dailyPostTarget: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
  });
  return t;
}
function candidate(key = "a") {
  return {
    sourceKey: key.repeat(16),
    title: "Solana project launches a new integration",
    summary: "The deployment is available.",
    url: `https://example.com/${key}`,
    publishedAt: Date.now() - 60_000,
  };
}
test("binds one source to one workflow and enforces shared hourly admission", async () => {
  const t = await setup();
  expect(
    (
      await t.mutation(internal.forumBreakingNews.admit, {
        candidates: [candidate()],
      })
    ).queued,
  ).toBe(true);
  expect(startBreakingPublication).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ alphaSourceKey: "a".repeat(16), slot: 1 }),
  );
  expect(
    (
      await t.mutation(internal.forumBreakingNews.admit, {
        candidates: [candidate("b")],
      })
    ).queued,
  ).toBe(false);
  vi.advanceTimersByTime(60 * 60_000);
  // The admitted source cannot be replayed even if its workflow never returned.
  expect(
    (
      await t.mutation(internal.forumBreakingNews.admit, {
        candidates: [candidate()],
      })
    ).queued,
  ).toBe(false);
  expect(
    (
      await t.mutation(internal.forumBreakingNews.admit, {
        candidates: [candidate("b")],
      })
    ).queued,
  ).toBe(true);
  const rows = await t.run((ctx) =>
    ctx.db.query("forumAlphaDeskRuns").take(30),
  );
  expect(new Set(rows.map((r) => r.agentSlug)).size).toBe(2);
});
test("urgent primary news can use the 30-minute lane, but never a five-minute burst", async () => {
  const t = await setup();
  await t.mutation(internal.forumBreakingNews.admit, {
    candidates: [candidate()],
  });
  const urgent = () => ({
    ...candidate("c"),
    url: "https://solana.com/news/release",
  });
  vi.advanceTimersByTime(5 * 60_000);
  expect(
    (
      await t.mutation(internal.forumBreakingNews.admit, {
        candidates: [urgent()],
      })
    ).queued,
  ).toBe(false);
  vi.advanceTimersByTime(25 * 60_000);
  expect(
    (
      await t.mutation(internal.forumBreakingNews.admit, {
        candidates: [urgent()],
      })
    ).queued,
  ).toBe(true);
});
test("old, unverified-date and unrelated stories never start paid work; flag disables admission", async () => {
  const t = await setup();
  expect(
    (
      await t.mutation(internal.forumBreakingNews.admit, {
        candidates: [
          { ...candidate(), publishedAt: Date.now() - 7 * 3600_000 },
        ],
      })
    ).queued,
  ).toBe(false);
  vi.stubEnv("FORUM_BREAKING_NEWS_ENABLED", "false");
  expect(
    (
      await t.mutation(internal.forumBreakingNews.admit, {
        candidates: [candidate()],
      })
    ).reason,
  ).toBe("disabled");
  expect(startBreakingPublication).not.toHaveBeenCalled();
});
