// @vitest-environment node
/// <reference types="vite/client" />

import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";

const route = vi.hoisted(() => vi.fn());
vi.mock("../lib/ai-model-routing", async importOriginal => ({
  ...(await importOriginal<typeof import("../lib/ai-model-routing")>()),
  runWithModelFallback: route,
}));
vi.mock("./modelRouting", async importOriginal => ({
  ...(await importOriginal<typeof import("./modelRouting")>()),
  convexModelRoutingConfig: async (_ctx: unknown, options: { elizaRuntime?: string }) => {
    if (options.elizaRuntime !== "off") throw new Error("pilot baseline must use legacy route");
    return { openRouterApiKey: "test-only-key" };
  },
}));
vi.mock("./sukiForumAgent", async importOriginal => ({
  ...(await importOriginal<typeof import("./sukiForumAgent")>()),
  fetchArticleSnapshots: async (candidates: Array<{
    id: string; sourceKey: string; sourceName: string; sourceFeedUrl: string;
    title: string; url: string; summary: string; boardSlugs: string[];
  }>) => candidates.map(candidate => ({
    ...candidate,
    articleTitle: candidate.title,
    articleDescription: "The original report explains how to preserve the decision boundary.",
    articleText: sourceText,
    sourceFetchSucceeded: true,
  })),
}));

const sourceText = [
  "The report describes benchmark manifest fields, source identifiers, prompt templates, evaluator settings, model routes, and missing values.",
  "It also discusses sandbox execution boundaries, permission checks, failure isolation, dataset provenance, sampling records, and reproducible audits.",
].join(" ").repeat(8);
const distinct = [
  { id: 1, theme: "benchmark manifests", focus: "recording prompt templates and evaluator settings", consequence: "comparisons become easier to reproduce when missing fields remain visible" },
  { id: 2, theme: "sandbox boundaries", focus: "isolating execution permissions and failure paths", consequence: "operators can separate a model error from a tool permission error" },
  { id: 3, theme: "dataset provenance", focus: "preserving sample origins and selection rules", consequence: "reviewers can see whether the evidence reflects the intended population" },
] as const;
const storyCopies = distinct.map(item => ({
  hnItemId: item.id,
  summary: `The public report on ${item.theme} explains ${item.focus}. It describes the relevant records, the boundary they cover, and the places where a missing value should stay explicit. The useful lesson is not a single headline but a trace that another reader can inspect before accepting a comparison.`,
  whyItMatters: `For ${item.theme}, ${item.consequence}. A team making an operational decision should keep the original record beside the interpretation, then identify which part of the argument can actually be checked by someone outside the drafting process.`,
  takeaways: [
    `Keep the ${item.theme} evidence linked to the decision it is meant to support, and mark any unresolved gap before sharing a result.`,
    `Review ${item.focus} against the original source, then describe what would change the conclusion if more evidence arrived.`,
  ],
  signalScore: 78,
}));
const draft = {
  subject: "Three records that make technical comparisons inspectable",
  headline: "A comparison is only useful when its boundary survives",
  dek: "Three source records point to a practical editorial rule: preserve the settings, permissions, and sample origins that let another reader question a reported outcome.",
  thesis: "A reproducible comparison depends on more than keeping the final score. The source record has to preserve how a prompt was assembled, where a tool was allowed to act, and which observations were selected for the analysis.",
  lead: "A tidy result can conceal three different uncertainties. One report explains why the comparison manifest matters; another asks whether the execution boundary remained stable; a third looks at the provenance of the examples under review. Read together, they suggest a simple discipline for technical teams: preserve the record at the moment a decision is made. That does not establish that any given model is better. It makes the proposed comparison open to inspection, and it gives a later reviewer a place to locate disagreements. The operational question is which fields would be difficult to reconstruct after the run, because those fields deserve attention before another dashboard is built.",
  heroHnItemId: 1,
  chart: {
    title: "Editorial value of inspectable records",
    subtitle: "These scores compare editorial relevance for reproducibility; they are not measured performance results.",
    items: distinct.map(item => ({ hnItemId: item.id, label: item.theme, value: 78,
      note: `Shows where ${item.theme} can make a technical claim easier to challenge.`,
    })),
  },
  practicalMoves: [
    "Write down the prompt template and evaluator settings before comparing outcomes, because later reconstruction can quietly change the question being asked.",
    "Separate sandbox permission failures from model behavior in the run record, so an operational review does not assign the wrong cause to a missing result.",
    "Keep dataset selection rules and sample origins close to the reported conclusion, then ask whether the examples represent the intended use case.",
    "Label unknown fields as unknown rather than filling them from memory, and require a fresh run when a decision depends on those gaps.",
  ],
  whatToWatch: [
    "Watch whether later source updates supply the missing manifest details needed for an independent comparison, and revise the conclusion when they do.",
    "Watch for a change in sample selection or tool permissions that would alter the meaning of a previously reported result.",
  ],
  discussionQuestion: "Which field in your current comparison record would be hardest for another team to reconstruct, and what decision depends on it?",
  stories: storyCopies,
};

const modules = { ...import.meta.glob("./**/*.ts"), ...import.meta.glob("./**/*.tsx") };
const belleAction = makeFunctionReference<"action", { nonce: string; runDate: string; snapshotDate: string }, {
  duplicate: boolean; run: { status: string; errorCode?: string; shadowJobId?: Id<"elizaShadowJobs">; sourceCount?: number };
}>("elizaPilotValidation:validateBelle");

beforeEach(() => {
  vi.stubEnv("ELIZA_SHADOW_MODE", "shadow");
  vi.stubEnv("ELIZA_SHADOW_WORKER_SECRET", "test-only-shadow-secret-at-least-32-characters");
  vi.stubEnv("ELIZA_SHADOW_WORKER_URL", "https://shadow-worker.up.railway.app");
  vi.stubEnv("ELIZA_SHADOW_DAILY_BUDGET_USD", "1");
  vi.stubEnv("OPENROUTER_DAILY_BUDGET_USD", "10");
  route.mockReset();
  route.mockResolvedValue({
    route: { persistedModel: "openrouter/free" },
    value: { draft, usage: { inputTokens: 800, outputTokens: 1_200 }, modelId: "openrouter/free" },
  });
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

test("actual Belle generator scores a complete source packet and enqueues without publishing", async () => {
  const t = convexTest(schema, modules);
  registerRateLimiter(t);
  await t.run(async ctx => {
    await ctx.db.insert("newsSnapshots", {
      snapshotDate: "2026-10-20", status: "complete", startedAt: 1,
      completedAt: 2, storyCount: 8,
    });
    for (let rank = 1; rank <= 8; rank++) {
      await ctx.db.insert("hnStories", {
        hnItemId: rank, snapshotDate: "2026-10-20", rank,
        title: `Public HN story ${rank}`, host: `publisher${rank}.example`,
        url: `https://publisher${rank}.example/report`,
        text: sourceText, fetchedAt: 2,
      });
    }
  });
  const result = await t.action(belleAction, {
    nonce: "pilot_real_generator_belle_001", runDate: "2026-10-20", snapshotDate: "2026-10-20",
  });
  expect(result).toMatchObject({ duplicate: false, run: { status: "completed", sourceCount: 8 } });
  expect(result.run.shadowJobId).toBeDefined();
  expect(route).toHaveBeenCalled();
  const state = await t.run(async ctx => ({
    issues: await ctx.db.query("newsletterIssues").take(10),
    runs: await ctx.db.query("dailyNewsletterRuns").take(10),
    sends: await ctx.db.query("newsletterSendLogs").take(10),
    shadow: await ctx.db.query("elizaShadowJobs").take(10),
  }));
  expect(state.issues).toEqual([]);
  expect(state.runs).toEqual([]);
  expect(state.sends).toEqual([]);
  expect(state.shadow).toHaveLength(1);
  expect(state.shadow[0]).toMatchObject({ kind: "belle-newsletter", status: "queued", isCanary: false });
});
