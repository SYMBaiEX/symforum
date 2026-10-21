// @vitest-environment node
/// <reference types="vite/client" />

import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { routedModelCandidates } from "../lib/ai-model-routing";
import { OPENROUTER_PAID_FALLBACK_MODEL } from "../lib/ai-models";
import schema from "./schema";
import { dailyDraftSchema, editorialDraftWordCount, editorialEvidenceFields, NEWSLETTER_MODEL_IDS, scoreEditorialPackage, validateEditorialEvidenceReview } from "./newsletterAgent";

const route = vi.hoisted(() => vi.fn());
const routingConfig = vi.hoisted(() => vi.fn());
vi.mock("../lib/ai-model-routing", async importOriginal => ({
  ...(await importOriginal<typeof import("../lib/ai-model-routing")>()),
  runWithModelFallback: route,
}));
vi.mock("./modelRouting", async importOriginal => ({
  ...(await importOriginal<typeof import("./modelRouting")>()),
  convexModelRoutingConfig: routingConfig,
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
    articleText: articleTextOverride ?? sourceText,
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
let articleTextOverride: string | undefined;
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
const invalidStoryDraft = dailyDraftSchema.parse({
  ...validDraft,
  stories: validDraft.stories.map((story, index) =>
    index === 0 ? { ...story, hnItemId: 9 } : story),
});
const invalidChartDraft = dailyDraftSchema.parse({
  ...validDraft,
  chart: { ...validDraft.chart, items: validDraft.chart.items.map((item, index) =>
    index === 0 ? { ...item, hnItemId: 8, label: "Unselected source", value: 99,
      note: "This unsupported foreign source must never enter the payload." } : item),
  },
});
const truncatedSubjectDraft = dailyDraftSchema.parse({
  ...validDraft,
  subject: "The web is now a place where fake statistics get cited by AI, hidden ".padEnd(70),
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
  forceElizaRuntimeGeneration?: boolean;
}, {
  subject: string;
  payload: { quality: { score: number }; stories: Array<{ hnItemId: number }>; chart: {
    items: Array<{ label: string; value: number; note: string }>;
  } };
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
let draftQueue: Array<typeof validDraft> = [];
let currentDraft = validDraft;
let reviewOverrides: Array<(review: ReturnType<typeof reviewedDraft>) => ReturnType<typeof reviewedDraft>> = [];
function mockDrafts(...drafts: Array<typeof validDraft>) { draftQueue = [...drafts]; }
function reviewedDraft(draft: typeof validDraft): Parameters<typeof validateEditorialEvidenceReview>[2] {
  return {
    fields: editorialEvidenceFields(draft).map(field => ({
      path: field.path,
      verdict: field.path.endsWith(".summary") ? "fact" : "analysis",
      sourceId: field.path.endsWith(".summary") ? field.ownSourceId ?? null : null,
      quote: field.path.endsWith(".summary") ? sourceText.slice(0, 80) : null,
      reason: null,
    })),
    coherence: "clear", coherenceReason: null,
  };
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
  reviewOverrides = [];
  articleTextOverride = undefined;
  route.mockImplementation(async (_config, options) => {
    if (options.stage.endsWith(":evidence-review")) {
      const review = reviewedDraft(currentDraft);
      return {
        route: { persistedModel: "openrouter/free" },
        value: { review: (reviewOverrides.shift()?.(review) ?? review), usage: { inputTokens: 300, outputTokens: 200 }, modelId: "openrouter/free" },
      };
    }
    currentDraft = draftQueue.shift() ?? validDraft;
    return {
      route: { persistedModel: "openrouter/free" },
      value: { draft: currentDraft, usage: { inputTokens: 700, outputTokens: 900 }, modelId: "openrouter/free" },
    };
  });
  routingConfig.mockReset().mockImplementation(async (_ctx, options) => ({
    openRouterApiKey: "test-only-key",
    ...(options.elizaRuntime === "force" ? { elizaRuntime: {} } : {}),
  }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

test("bad story selection gets one repair and accepts valid revision", async () => {
  expect(editorialDraftWordCount(validDraft)).toBeGreaterThanOrEqual(650);
  expect(scoreEditorialPackage({
    draft: validDraft, edition: "daily-signal",
    recent: { headlines: [], theses: [], storyIds: [] },
    sources: themes.map(theme => ({ hnItemId: theme.id, host: `source${theme.id}.example`, sourceText })),
  }).score).toBeGreaterThanOrEqual(82);
  const t = setup();
  await seedSnapshot(t);
  mockDrafts(invalidStoryDraft, validDraft);
  const result = await t.action(generateDailySignal, args);
  expect(route).toHaveBeenCalledTimes(3);
  expect(route.mock.calls.map(call => call[2])).toEqual([
    [OPENROUTER_PAID_FALLBACK_MODEL], [OPENROUTER_PAID_FALLBACK_MODEL],
    [OPENROUTER_PAID_FALLBACK_MODEL],
  ]);
  expect(route.mock.calls[1]?.[1]?.stage).toBe("belle:daily-signal:revision");
  expect(route.mock.calls[1]?.[1]?.run).toBeDefined();
  expect(result.payload.quality.score).toBeGreaterThanOrEqual(82);
  expect(result.payload.stories.map(story => story.hnItemId)).toEqual([1, 2, 3]);
  expect(result.shadowEnqueue?.status).toBe("queued");
  const shadow = await t.run(ctx => ctx.db.query("elizaShadowJobs").take(10));
  expect(shadow).toHaveLength(1);
  const baseline = JSON.parse(shadow[0]!.baselineJson);
  expect(baseline.evaluation.evidenceReview.reviewedFields).toBeGreaterThan(0);
  expect(baseline.generation).toMatchObject({ inputTokens: 1_700, outputTokens: 2_000 });
  expect(await t.run(ctx => ctx.db.query("newsletterIssues").take(10))).toEqual([]);
  expect(await t.run(ctx => ctx.db.query("dailyNewsletterRuns").take(10))).toEqual([]);
});

test("a blind-review unit mismatch enters the one revision and a clean review can pass", async () => {
  const t = setup();
  await seedSnapshot(t);
  mockDrafts(validDraft, validDraft);
  reviewOverrides.push(review => {
    const field = review.fields.find(item => item.path === "lead")!;
    field.verdict = "unsupported";
    field.reason = "10,000 AI sessions cannot be reported as 10,000 ChatGPT citations";
    return review;
  });
  const result = await t.action(generateDailySignal, {
    ...args, shadowSourceRunKey: "pilot:belle:evidence-unit-repair",
  });
  expect(result.payload.quality.score).toBeGreaterThanOrEqual(82);
  expect(route.mock.calls.map(call => call[1]?.stage)).toEqual([
    "belle:daily-signal:draft", "belle:daily-signal:evidence-review",
    "belle:daily-signal:revision", "belle:daily-signal:evidence-review",
  ]);
  const shadow = await t.run(ctx => ctx.db.query("elizaShadowJobs").take(10));
  const baseline = JSON.parse(shadow[0]!.baselineJson);
  expect(baseline.generation).toMatchObject({ inputTokens: 2_000, outputTokens: 2_200 });
  expect(baseline.evaluation.evidenceReview.issues).toEqual([]);
});

test("two incomplete prose drafts fail closed after exactly two reviews", async () => {
  const t = setup();
  await seedSnapshot(t);
  const clipped = dailyDraftSchema.parse({
    ...validDraft, lead: `${validDraft.lead} The report stopped because`,
  });
  mockDrafts(clipped, clipped);
  await expect(t.action(generateDailySignal, {
    ...args, shadowSourceRunKey: "pilot:belle:clipped-prose-failed",
  })).rejects.toThrow("lead ends without a complete sentence");
  expect(route.mock.calls.filter(call => call[1]?.stage.endsWith(":evidence-review"))).toHaveLength(2);
  expect(await t.run(ctx => ctx.db.query("elizaShadowJobs").take(10))).toEqual([]);
  expect(await t.run(ctx => ctx.db.query("newsletterIssues").take(10))).toEqual([]);
});

test("partial blind-review coverage is not treated as approval", async () => {
  const t = setup();
  await seedSnapshot(t);
  mockDrafts(validDraft, validDraft);
  reviewOverrides.push(...[0, 1].map(() => (review: ReturnType<typeof reviewedDraft>) => {
    review.fields.pop();
    return review;
  }));
  await expect(t.action(generateDailySignal, {
    ...args, shadowSourceRunKey: "pilot:belle:partial-review-failed",
  })).rejects.toThrow("Evidence review omitted");
  expect(route.mock.calls.filter(call => call[1]?.stage.endsWith(":evidence-review"))).toHaveLength(2);
  expect(await t.run(ctx => ctx.db.query("elizaShadowJobs").take(10))).toEqual([]);
  expect(await t.run(ctx => ctx.db.query("newsletterIssues").take(10))).toEqual([]);
});

test("unknown reviewer transport fails closed without revision or publication", async () => {
  const t = setup();
  await seedSnapshot(t);
  route.mockImplementation(async (_config, options) => {
    if (options.stage.endsWith(":evidence-review")) throw new Error("Eliza runtime transport unknown outcome");
    return {
      route: { persistedModel: "openrouter/free" },
      value: { draft: validDraft, usage: { inputTokens: 700, outputTokens: 900 }, modelId: "openrouter/free" },
    };
  });
  await expect(t.action(generateDailySignal, {
    ...args, shadowSourceRunKey: "pilot:belle:review-transport-unknown",
  })).rejects.toThrow("transport unknown outcome");
  expect(route.mock.calls.map(call => call[1]?.stage)).toEqual([
    "belle:daily-signal:draft", "belle:daily-signal:evidence-review",
  ]);
  expect(await t.run(ctx => ctx.db.query("elizaShadowJobs").take(10))).toEqual([]);
  expect(await t.run(ctx => ctx.db.query("newsletterIssues").take(10))).toEqual([]);
});

test("oversize original selected evidence fails before any review route call", async () => {
  const t = setup();
  await seedSnapshot(t);
  articleTextOverride = "Original source evidence. ".repeat(6_000);
  mockDrafts(validDraft);
  await expect(t.action(generateDailySignal, {
    ...args, shadowSourceRunKey: "pilot:belle:review-input-overflow",
  })).rejects.toThrow("bounded input window; no source was truncated");
  expect(route.mock.calls.map(call => call[1]?.stage)).toEqual(["belle:daily-signal:draft"]);
  expect(await t.run(ctx => ctx.db.query("elizaShadowJobs").take(10))).toEqual([]);
  expect(await t.run(ctx => ctx.db.query("newsletterIssues").take(10))).toEqual([]);
});

test("repeated invalid selection fails after one repair without shadow or publication", async () => {
  const t = setup();
  await seedSnapshot(t);
  mockDrafts(invalidStoryDraft, invalidStoryDraft);
  await expect(t.action(generateDailySignal, {
    ...args, shadowSourceRunKey: "pilot:belle:draft-repair-invalid",
  })).rejects.toThrow("selected a source outside the research packet");
  expect(route).toHaveBeenCalledTimes(2);
  expect(await t.run(ctx => ctx.db.query("elizaShadowJobs").take(10))).toEqual([]);
  expect(await t.run(ctx => ctx.db.query("newsletterIssues").take(10))).toEqual([]);
  expect(await t.run(ctx => ctx.db.query("dailyNewsletterRuns").take(10))).toEqual([]);
  expect(await t.run(ctx => ctx.db.query("newsletterSendLogs").take(10))).toEqual([]);
});

test("a clipped subject triggers one revision and accepts a complete replacement", async () => {
  expect(truncatedSubjectDraft.subject).toHaveLength(70);
  const t = setup();
  await seedSnapshot(t);
  mockDrafts(truncatedSubjectDraft, validDraft);
  const result = await t.action(generateDailySignal, {
    ...args, shadowSourceRunKey: "pilot:belle:subject-repair-test",
  });
  expect(route).toHaveBeenCalledTimes(4);
  expect(route.mock.calls[2]?.[1]?.stage).toBe("belle:daily-signal:revision");
  expect(route.mock.calls[2]?.[1]?.run).toBeDefined();
  expect(route.mock.calls[2]?.[1]?.estimatedInputTokens).toBeGreaterThan(0);
  expect(result.subject).toBe(validDraft.subject);
  expect(result.payload.quality.score).toBeGreaterThanOrEqual(82);
});

test("a repeatedly clipped subject fails closed after one revision", async () => {
  const t = setup();
  await seedSnapshot(t);
  mockDrafts(truncatedSubjectDraft, truncatedSubjectDraft);
  await expect(t.action(generateDailySignal, {
    ...args, shadowSourceRunKey: "pilot:belle:subject-repair-failed-test",
  })).rejects.toThrow("subject is incomplete");
  expect(route).toHaveBeenCalledTimes(4);
  expect(await t.run(ctx => ctx.db.query("elizaShadowJobs").take(10))).toEqual([]);
  expect(await t.run(ctx => ctx.db.query("newsletterIssues").take(10))).toEqual([]);
});

test("a structurally valid original is retained when its revision has a bad selection", async () => {
  expect(editorialDraftWordCount(shortValidDraft)).toBeLessThan(650);
  const t = setup();
  await seedSnapshot(t);
  mockDrafts(shortValidDraft, invalidStoryDraft);
  let message = "";
  try {
    await t.action(generateDailySignal, {
      ...args, shadowSourceRunKey: "pilot:belle:draft-repair-regression",
    });
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  expect(message).toContain("Belle's daily-signal");
  expect(message).not.toContain("selected a source outside");
  expect(route).toHaveBeenCalledTimes(3);
  expect(await t.run(ctx => ctx.db.query("elizaShadowJobs").take(10))).toEqual([]);
  expect(await t.run(ctx => ctx.db.query("newsletterIssues").take(10))).toEqual([]);
});

test("chart rows come from selected story scores and analysis, never foreign model rows", async () => {
  const t = setup();
  await seedSnapshot(t);
  mockDrafts(invalidChartDraft);
  const result = await t.action(generateDailySignal, {
    ...args, shadowSourceRunKey: "pilot:belle:chart-derived-test",
  });
  expect(route).toHaveBeenCalledTimes(2);
  expect(result.payload.stories.map(story => story.hnItemId)).toEqual([1, 2, 3]);
  expect(result.payload.chart.items.map(item => item.value)).toEqual([76, 76, 76]);
  expect(result.payload.chart.items.map(item => item.label)).toEqual([
    "Public source 1", "Public source 2", "Public source 3",
  ]);
  expect(result.payload.chart.items[0]?.note).toContain("manifest records");
  expect(JSON.stringify(result.payload.chart)).not.toContain("Unselected source");
  expect(JSON.stringify(result.payload.chart)).not.toContain("unsupported foreign source");
  expect(result.payload.quality.score).toBeGreaterThanOrEqual(82);
});

test("explicit v2 override reaches routing and conflicting overrides fail closed", async () => {
  const t = setup();
  await seedSnapshot(t);
  mockDrafts(validDraft);
  await t.action(generateDailySignal, {
    ...args,
    forceLegacyGeneration: false,
    forceElizaRuntimeGeneration: true,
    shadowSourceRunKey: "pilot:belle:forced-v2-test",
  });
  expect(routingConfig.mock.calls[0]?.[1]).toMatchObject({
    runtimeScope: "forum-newsletter",
    elizaRuntime: "force",
  });
  expect(route).toHaveBeenCalledTimes(2);
  expect(route.mock.calls.map(call => call[2])).toEqual([
    NEWSLETTER_MODEL_IDS, NEWSLETTER_MODEL_IDS,
  ]);
  await expect(t.action(generateDailySignal, {
    ...args,
    forceElizaRuntimeGeneration: true,
    shadowSourceRunKey: "pilot:belle:conflicting-overrides-test",
  })).rejects.toThrow("Conflicting Belle generation transport overrides");
  expect(routingConfig).toHaveBeenCalledTimes(1);
});

test("normal legacy generation keeps DeepSeek for both writer and reviewer", async () => {
  const t = setup();
  await seedSnapshot(t);
  mockDrafts(validDraft);
  await t.action(generateDailySignal, {
    ...args, forceLegacyGeneration: false,
    shadowSourceRunKey: "pilot:belle:normal-runtime-off-model",
  });
  expect(route.mock.calls.map(call => call[2])).toEqual([
    [OPENROUTER_PAID_FALLBACK_MODEL], [OPENROUTER_PAID_FALLBACK_MODEL],
  ]);
});

test("Belle's Mistral SDK requests use the pinned price ceiling without reasoning output", async () => {
  const t = setup();
  await seedSnapshot(t);
  mockDrafts(invalidStoryDraft, validDraft);
  await t.action(generateDailySignal, {
    ...args, forceLegacyGeneration: false, forceElizaRuntimeGeneration: true,
    shadowSourceRunKey: "pilot:belle:mistral-serialization-test",
  });
  const requestBodies: Record<string, unknown>[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requestBodies.push(body);
    const responseContent = body.max_tokens === 4_000
      ? reviewedDraft(validDraft) : validDraft;
    return new Response(JSON.stringify({
      id: "belle-structured-test", object: "chat.completion", created: 1_760_000_000,
      model: "mistralai/mistral-small-3.2-24b-instruct",
      choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(responseContent) },
        finish_reason: "stop" }],
      usage: { prompt_tokens: 100, completion_tokens: 900, total_tokens: 1000 },
    }), { headers: { "content-type": "application/json" } });
  }));
  const [candidate] = await routedModelCandidates(
    { openRouterApiKey: "test-only-key" }, NEWSLETTER_MODEL_IDS,
  );
  expect(route).toHaveBeenCalledTimes(3);
  expect(route.mock.calls.map(call => call[2])).toEqual([
    NEWSLETTER_MODEL_IDS, NEWSLETTER_MODEL_IDS, NEWSLETTER_MODEL_IDS,
  ]);
  for (const call of route.mock.calls.filter(call => !call[1]?.stage.endsWith(":evidence-review"))) {
    const run = call[1]?.run;
    expect(run).toBeTypeOf("function");
    const generated = await run(candidate, new AbortController().signal);
    expect(generated.draft.stories).toHaveLength(3);
  }
  const reviewRun = route.mock.calls.find(call => call[1]?.stage.endsWith(":evidence-review"))?.[1]?.run;
  expect(reviewRun).toBeTypeOf("function");
  const reviewed = await reviewRun(candidate, new AbortController().signal);
  expect(reviewed.review.fields).toHaveLength(editorialEvidenceFields(validDraft).length);
  expect(requestBodies).toHaveLength(3);
  for (const body of requestBodies.slice(0, 2)) {
    expect(body).toMatchObject({
      model: NEWSLETTER_MODEL_IDS[0],
      max_tokens: 8000,
      provider: { max_price: { prompt: "0.2", completion: "0.5" } },
    });
    expect(body.reasoning).toBeUndefined();
    expect(body.reasoning_effort).toBeUndefined();
    expect(JSON.stringify(body.messages)).toContain("Reasoning strength: none");
    expect(JSON.stringify(body.messages)).toContain("standalone email subject of at most 64 characters");
    expect(JSON.stringify(body.messages)).toContain("Citation or retrieval of a web page by ChatGPT is not evidence");
    expect(JSON.stringify(body.messages)).toContain("prefer three genuinely connected source anchors");
    expect(JSON.stringify(body.messages)).toContain("remove a factual premise from an unselected source");
  }
  expect(requestBodies[2]).toMatchObject({
    model: NEWSLETTER_MODEL_IDS[0], max_tokens: 4_000,
    provider: { max_price: { prompt: "0.2", completion: "0.5" } },
  });
  expect(requestBodies[2]?.reasoning).toBeUndefined();
  expect(requestBodies[2]?.reasoning_effort).toBeUndefined();
  expect(JSON.stringify(requestBodies[2]?.messages)).toContain("10,000 AI sessions is NOT 10,000 ChatGPT citations");
  expect(JSON.stringify(requestBodies[2]?.messages)).toContain("editorial label; factual assertions still need evidence");
  expect(JSON.stringify(requestBodies[2]?.messages)).toContain("Do not demand one source support a compound claim about multiple sources");
  expect(JSON.stringify(requestBodies[2]?.messages)).toContain("A proposal to check something is not a claim that it was already observed");
  expect(JSON.stringify(requestBodies[2]?.messages)).toContain("unrelated topics are not automatically a coherent synthesis");
});

test("legacy DeepSeek writer and reviewer explicitly disable reasoning", async () => {
  const t = setup();
  await seedSnapshot(t);
  mockDrafts(validDraft);
  await t.action(generateDailySignal, {
    ...args, shadowSourceRunKey: "pilot:belle:legacy-deepseek-serialization-test",
  });
  expect(route.mock.calls.map(call => call[2])).toEqual([
    [OPENROUTER_PAID_FALLBACK_MODEL], [OPENROUTER_PAID_FALLBACK_MODEL],
  ]);
  const requestBodies: Record<string, unknown>[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requestBodies.push(body);
    return new Response(JSON.stringify({
      id: "belle-legacy-structured-test", object: "chat.completion", created: 1_760_000_000,
      model: "deepseek/deepseek-v4-flash-latest",
      choices: [{ index: 0, message: {
        role: "assistant",
        content: JSON.stringify(body.max_tokens === 4_000 ? reviewedDraft(validDraft) : validDraft),
      }, finish_reason: "stop" }],
      usage: { prompt_tokens: 100, completion_tokens: 900, total_tokens: 1000 },
    }), { headers: { "content-type": "application/json" } });
  }));
  const [candidate] = await routedModelCandidates(
    { openRouterApiKey: "test-only-key" }, [OPENROUTER_PAID_FALLBACK_MODEL],
  );
  for (const call of route.mock.calls) {
    await call[1].run(candidate, new AbortController().signal);
  }
  expect(requestBodies).toHaveLength(2);
  expect(requestBodies.map(body => body.max_tokens)).toEqual([8_000, 4_000]);
  for (const body of requestBodies) {
    expect(body.model).toBe(OPENROUTER_PAID_FALLBACK_MODEL);
    expect(body.reasoning).toEqual({ enabled: false });
    expect(body.reasoning_effort).toBeUndefined();
    expect((body.provider as Record<string, unknown>)?.max_price).toBeUndefined();
  }
});
