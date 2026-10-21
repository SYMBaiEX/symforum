// @vitest-environment node
/// <reference types="vite/client" />

import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import schema from "./schema";
import { dailyDraftSchema, editorialDraftWordCount, scoreEditorialPackage } from "./newsletterAgent";

const route = vi.hoisted(() => vi.fn());
vi.mock("../lib/ai-model-routing", async importOriginal => ({
  ...(await importOriginal<typeof import("../lib/ai-model-routing")>()),
  runWithModelFallback: route,
}));
vi.mock("./modelRouting", async importOriginal => ({
  ...(await importOriginal<typeof import("./modelRouting")>()),
  convexModelRoutingConfig: async () => ({ openRouterApiKey: "test-only-key" }),
}));
vi.mock("./sukiForumAgent", async importOriginal => ({
  ...(await importOriginal<typeof import("./sukiForumAgent")>()),
  fetchArticleSnapshots: async (candidates: Array<{
    id: string; sourceKey: string; sourceName: string; sourceFeedUrl: string;
    title: string; url: string; summary: string; boardSlugs: string[];
  }>) => candidates.map(candidate => ({
    ...candidate,
    articleTitle: candidate.title,
    articleDescription: "The original report describes source and evaluation records.",
    articleText: sourceText,
    sourceFetchSucceeded: true,
  })),
}));

const themes = [
  { id: 1, name: "manifest records", detail: "prompt templates and evaluation settings", effect: "missing fields can change the meaning of a comparison" },
  { id: 2, name: "sandbox boundaries", detail: "execution permissions and isolated failures", effect: "tool errors remain distinguishable from model behavior" },
  { id: 3, name: "sample provenance", detail: "selection rules and original observations", effect: "reviewers can judge whether examples fit the intended question" },
] as const;
const storyCopies = themes.map(theme => ({
  hnItemId: theme.id,
  summary: `The public report on ${theme.name} explains ${theme.detail}. It distinguishes records that can be checked directly from interpretation layered on top. A missing field should remain visible, because a later reader cannot reconstruct a decision from a polished headline alone.`,
  whyItMatters: `For ${theme.name}, ${theme.effect}. Teams should keep the original source beside the conclusion, identify the uncertainty it resolves, and write down what additional evidence would alter a decision.`,
  takeaways: [
    `Preserve the ${theme.name} evidence with the decision it supports, while marking gaps before sharing a reported result.`,
    `Check ${theme.detail} against the source, then explain which assumption would change if the record proves incomplete.`,
  ],
  signalScore: 76,
}));
const sourceText = [
  "The reports describe manifest records, prompt templates, evaluation settings, sandbox boundaries, execution permissions, isolated failures, sample provenance, selection rules, and original observations.",
  ...storyCopies.flatMap(copy => [copy.summary, copy.whyItMatters, ...copy.takeaways]),
].join(" ");
const validDraft = dailyDraftSchema.parse({
  subject: "The records behind a reproducible technical comparison",
  headline: "Keep the boundary beside the reported outcome",
  dek: "Three source records show why a technical comparison needs its original settings, execution limits, and sample selection beside the final interpretation.",
  thesis: "A comparison becomes inspectable only when another reader can recover the prompt and evaluator settings, the permission boundary around execution, and the origins of the observations being compared.",
  lead: "A neat score can hide several different questions. A manifest can omit a field that changes what was asked; an execution failure can be confused with model behavior; a selected sample can quietly narrow the conclusion. The three source records in this edition describe those boundaries from different angles. Together, they suggest a practical habit: keep the source record at the point where a decision is made, not just in an archive discovered after a dispute. That habit does not prove any model or process is superior. It makes the argument easier for someone else to inspect, challenge, and improve. Before relying on a summary, ask which missing field would make you rerun the comparison from its recorded inputs.",
  heroHnItemId: 1,
  chart: {
    title: "Editorial relevance of source records",
    subtitle: "Scores compare editorial relevance for reproducibility, not measured system performance.",
    items: themes.map(theme => ({ hnItemId: theme.id, label: theme.name, value: 76,
      note: `Shows how ${theme.name} can clarify a technical conclusion.`,
    })),
  },
  practicalMoves: [
    "Capture prompt and evaluator settings before the run, so a later review cannot silently replace the question that produced the result.",
    "Record tool permission failures separately from model output, because those two failure modes call for different corrective actions.",
    "Keep sample selection rules near the conclusion, then ask whether the observations reflect the population relevant to the decision.",
    "Leave unknown fields marked as unknown and require a fresh run when a high-impact conclusion depends on reconstructing them.",
  ],
  whatToWatch: [
    "Watch whether later primary-source updates provide missing settings that change the interpretation of a comparison already shared.",
    "Watch for shifts in permission boundaries or sample selection that would make a previous outcome incomparable with a new one.",
  ],
  discussionQuestion: "Which field in your current comparison record would another team struggle to reconstruct, and what decision would that uncertainty affect?",
  stories: storyCopies,
});
const invalidChartDraft = dailyDraftSchema.parse({
  ...validDraft,
  chart: { ...validDraft.chart, items: validDraft.chart.items.map((item, index) =>
    index === 0 ? { ...item, hnItemId: 8 } : item),
  },
});
const shortValidDraft = dailyDraftSchema.parse({
  ...validDraft,
  dek: "The original reports describe the records that let a reviewer inspect a technical comparison before relying on its result.",
  thesis: "The useful record preserves prompt and evaluation settings, execution boundaries, and sample origins. Those details let another reader challenge an interpretation instead of trusting a polished score.",
  lead: "A reported comparison can hide missing settings, tool errors, or a narrow sample. The sources describe distinct ways those gaps change interpretation. Keep the original record close to the decision, and mark uncertainty before treating a summary as reproducible evidence.",
  stories: validDraft.stories.map(story => ({
    ...story,
    summary: story.summary.slice(0, 140),
    whyItMatters: story.whyItMatters.slice(0, 110),
    takeaways: story.takeaways.map(takeaway => takeaway.slice(0, 50)),
  })),
  practicalMoves: validDraft.practicalMoves.map(move => move.slice(0, 75)),
  whatToWatch: validDraft.whatToWatch.map(item => item.slice(0, 70)),
});

const modules = { ...import.meta.glob("./**/*.ts"), ...import.meta.glob("./**/*.tsx") };
const generateDailySignal = makeFunctionReference<"action", {
  runDate: string; snapshotDate: string; siteUrl: string;
  shadowSourceRunKey: string; forceLegacyGeneration: boolean;
}, {
  payload: { quality: { score: number }; stories: Array<{ hnItemId: number }> };
  shadowEnqueue?: { status: string };
}>("newsletterAgent:generateDailySignal");

function setup() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t);
  return t;
}
async function seedSnapshot(t: ReturnType<typeof setup>) {
  await t.run(async ctx => {
    await ctx.db.insert("newsSnapshots", {
      snapshotDate: "2026-10-20", status: "complete", startedAt: 1,
      completedAt: 2, storyCount: 8,
    });
    for (let rank = 1; rank <= 8; rank++) {
      await ctx.db.insert("hnStories", {
        hnItemId: rank, snapshotDate: "2026-10-20", rank,
        title: `Public source ${rank}`, host: `source${rank}.example`,
        url: `https://source${rank}.example/report`, text: sourceText,
        fetchedAt: 2,
      });
    }
  });
}
function mockDrafts(...drafts: Array<typeof validDraft>) {
  for (const draft of drafts) {
    route.mockResolvedValueOnce({
      route: { persistedModel: "openrouter/free" },
      value: { draft, usage: { inputTokens: 700, outputTokens: 900 }, modelId: "openrouter/free" },
    });
  }
}
const args = {
  runDate: "2026-10-20", snapshotDate: "2026-10-20", siteUrl: "https://symbaiex.com",
  shadowSourceRunKey: "pilot:belle:draft-repair-test", forceLegacyGeneration: true,
};

beforeEach(() => {
  vi.stubEnv("ELIZA_SHADOW_MODE", "shadow");
  vi.stubEnv("ELIZA_SHADOW_WORKER_SECRET", "test-only-shadow-secret-at-least-32-characters");
  vi.stubEnv("ELIZA_SHADOW_WORKER_URL", "https://shadow-worker.up.railway.app");
  vi.stubEnv("ELIZA_SHADOW_DAILY_BUDGET_USD", "1");
  vi.stubEnv("OPENROUTER_DAILY_BUDGET_USD", "10");
  route.mockReset();
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

test("chart source outside selected package gets one repair and accepts valid revision", async () => {
  expect(editorialDraftWordCount(validDraft)).toBeGreaterThanOrEqual(650);
  expect(scoreEditorialPackage({
    draft: validDraft, edition: "daily-signal",
    recent: { headlines: [], theses: [], storyIds: [] },
    sources: themes.map(theme => ({ hnItemId: theme.id, host: `source${theme.id}.example`, sourceText })),
  }).score).toBeGreaterThanOrEqual(82);
  const t = setup();
  await seedSnapshot(t);
  mockDrafts(invalidChartDraft, validDraft);
  const result = await t.action(generateDailySignal, args);
  expect(route).toHaveBeenCalledTimes(2);
  expect(route.mock.calls[1]?.[1]?.stage).toBe("belle:daily-signal:revision");
  expect(route.mock.calls[1]?.[1]?.run).toBeDefined();
  expect(result.payload.quality.score).toBeGreaterThanOrEqual(82);
  expect(result.payload.stories.map(story => story.hnItemId)).toEqual([1, 2, 3]);
  expect(result.shadowEnqueue?.status).toBe("queued");
  expect(await t.run(ctx => ctx.db.query("elizaShadowJobs").take(10))).toHaveLength(1);
  expect(await t.run(ctx => ctx.db.query("newsletterIssues").take(10))).toEqual([]);
  expect(await t.run(ctx => ctx.db.query("dailyNewsletterRuns").take(10))).toEqual([]);
});

test("repeated invalid selection fails after one repair without shadow or publication", async () => {
  const t = setup();
  await seedSnapshot(t);
  mockDrafts(invalidChartDraft, invalidChartDraft);
  await expect(t.action(generateDailySignal, {
    ...args, shadowSourceRunKey: "pilot:belle:draft-repair-invalid",
  })).rejects.toThrow("chart referenced a story outside the selected package");
  expect(route).toHaveBeenCalledTimes(2);
  expect(await t.run(ctx => ctx.db.query("elizaShadowJobs").take(10))).toEqual([]);
  expect(await t.run(ctx => ctx.db.query("newsletterIssues").take(10))).toEqual([]);
  expect(await t.run(ctx => ctx.db.query("dailyNewsletterRuns").take(10))).toEqual([]);
  expect(await t.run(ctx => ctx.db.query("newsletterSendLogs").take(10))).toEqual([]);
});

test("a structurally valid original is retained when its revision has a bad chart", async () => {
  expect(editorialDraftWordCount(shortValidDraft)).toBeLessThan(650);
  const t = setup();
  await seedSnapshot(t);
  mockDrafts(shortValidDraft, invalidChartDraft);
  let message = "";
  try {
    await t.action(generateDailySignal, {
      ...args, shadowSourceRunKey: "pilot:belle:draft-repair-regression",
    });
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  expect(message).toContain("Belle's daily-signal");
  expect(message).not.toContain("chart referenced a story");
  expect(route).toHaveBeenCalledTimes(2);
  expect(await t.run(ctx => ctx.db.query("elizaShadowJobs").take(10))).toEqual([]);
  expect(await t.run(ctx => ctx.db.query("newsletterIssues").take(10))).toEqual([]);
});
