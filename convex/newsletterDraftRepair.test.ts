// @vitest-environment node
/// <reference types="vite/client" />

import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { NoObjectGeneratedError, ToolLoopAgent } from "ai";
import { makeFunctionReference } from "convex/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { routedModelCandidates } from "../lib/ai-model-routing";
import { OPENROUTER_PAID_FALLBACK_MODEL } from "../lib/ai-models";
import { internal } from "./_generated/api";
import schema from "./schema";
import { CompletedEditorialReviewError, dailyDraftSchema, editorialDraftWordCount, editorialEvidenceFields, editorialEvidenceReviewPrompt, editorialPrompt, NEWSLETTER_MODEL_IDS, scoreEditorialPackage, validateEditorialEvidenceReview } from "./newsletterAgent";

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
    articleText: typeof articleTextOverride === "function"
      ? articleTextOverride(candidate) : articleTextOverride ?? sourceText,
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
let articleTextOverride: string | ((candidate: { id: string }) => string) | undefined;
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
function compactReview(draft: typeof validDraft) {
  const review = reviewedDraft(draft);
  return {
    fields: review.fields.map(field => field.verdict === "fact"
      ? {
          path: field.path, verdict: "fact", quoteIds: [`${field.sourceId}:q0`],
        }
      : { path: field.path, verdict: "analysis" }),
    coherence: "clear",
    coherenceReason: null,
  };
}

function expectStrictReviewObjects(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) expectStrictReviewObjects(item);
    return;
  }
  if (value === null || typeof value !== "object") return;
  const node = value as Record<string, unknown>;
  expect(node).not.toHaveProperty("oneOf");
  expect(node).not.toHaveProperty("const");
  if (node.format !== undefined) {
    expect(["date-time", "time", "date", "duration", "email", "hostname", "ipv4", "ipv6", "uuid"])
      .toContain(node.format);
  }
  if (node.type === "object") {
    const properties = node.properties as Record<string, unknown>;
    expect(node.additionalProperties).toBe(false);
    expect((node.required as string[]).slice().sort()).toEqual(Object.keys(properties).sort());
  }
  for (const child of Object.values(node)) expectStrictReviewObjects(child);
}

test("daily writer counts only publication prose and keeps the same target on revision", () => {
  const promptArgs = { edition: "daily-signal" as const, runDate: "2026-10-20", snapshotDate: "2026-10-20" };
  const recent = { headlines: [], theses: [], storyIds: [] };
  for (const prompt of [
    editorialPrompt(promptArgs, [], recent),
    editorialPrompt(promptArgs, [], recent, { feedback: ["Too short"], previousDraft: validDraft }),
  ]) {
    expect(prompt).toContain("900-1,100 counted prose words");
    expect(prompt).toContain("excludes subject, headline, all chart text and notes, JSON keys, IDs, and URLs");
    expect(prompt).toContain("not padding or repeated claims");
    expect(prompt).toContain("summary at or below 320 characters in two focused factual sentences");
  }
});

test("factual numbers must appear in exact cited quotes, including every mixed-source clause", () => {
  const mixedDraft = {
    ...validDraft,
    lead: "The experimenter reported 50,000 live page fetches, while a systems release described offline inference features.",
  };
  const firstQuote = "The systems release describes offline inference features for selected models.";
  const secondQuote = "The experimenter reported 50,000 live page fetches in the observed period.";
  const sources = [
    { hnItemId: 1, sourceText: `${sourceText} ${firstQuote}` },
    { hnItemId: 2, sourceText: `${sourceText} ${secondQuote}` },
    { hnItemId: 3, sourceText },
  ];
  const base = reviewedDraft(mixedDraft);
  const reviewWithQuotes = (includeSecond: boolean) => ({
    ...base,
    fields: base.fields.map(field => field.path === "lead"
      ? {
          ...field, verdict: "fact" as const, sourceId: 1, quote: firstQuote,
          additionalSupports: includeSecond ? [{ sourceId: 2, quote: secondQuote }] : [],
        }
      : field),
  });
  expect(validateEditorialEvidenceReview(mixedDraft, sources, reviewWithQuotes(false)))
    .toContainEqual(expect.stringContaining("lacks cited numeric support at lead: 50000"));
  expect(validateEditorialEvidenceReview(mixedDraft, sources, reviewWithQuotes(true))).toEqual([]);
  const scoreDraft = {
    ...mixedDraft,
    chart: { ...mixedDraft.chart, subtitle: "Editorial signal scores use a 0–100 scale, while the experimenter reported 50,000 live page fetches." },
  };
  const scoreReview = reviewWithQuotes(true);
  scoreReview.fields = scoreReview.fields.map(field => field.path === "chart.subtitle"
    ? { ...field, verdict: "fact", sourceId: 2, quote: secondQuote }
    : field);
  expect(validateEditorialEvidenceReview(scoreDraft, sources, scoreReview)).toEqual([]);
  // Numeric membership is only a deterministic guard; it does not establish semantic entailment.
});

test("one day accepts only an exact cited single-day phrase from the selected source", () => {
  const takeaway = "The author generated 50,000 pages in one day.";
  const draft = {
    ...validDraft,
    stories: validDraft.stories.map((story, index) => index === 0
      ? { ...story, takeaways: [takeaway, story.takeaways[1]!] }
      : story),
  };
  const quote = "The author generated 50,000 pages in a single day.";
  const source = `${sourceText} ${quote}`;
  const sources = themes.map((theme, index) => ({
    hnItemId: theme.id,
    title: theme.name,
    rank: index + 1,
    sourceText: theme.id === 1 ? source : sourceText,
  }));
  const qualityFor = (evidence: typeof sources) => scoreEditorialPackage({
    draft, edition: "daily-signal",
    recent: { headlines: [], theses: [], storyIds: [] },
    sources: evidence.map(item => ({
      hnItemId: item.hnItemId, host: `source${item.hnItemId}.example`,
      sourceText: item.sourceText,
    })),
  });
  expect(qualityFor(sources).blockingIssues.join(" ")).not.toContain("one day");
  const review = reviewedDraft(draft);
  const field = review.fields.find(item => item.path === "stories.0.takeaways.0")!;
  field.verdict = "fact";
  field.sourceId = 1;
  field.quote = quote;
  expect(validateEditorialEvidenceReview(draft, sources, review)).toEqual([]);
  const prompt = editorialEvidenceReviewPrompt(draft, sources);
  expect(JSON.parse(prompt.prompt).task).toContain("lack of reported evidence is not evidence of real-world absence");
  const promptField = (JSON.parse(prompt.prompt).fields as Array<{
    path: string; numericSupportCandidates: Array<{ token: string; quoteIds: string[] }>;
  }>).find(item => item.path === "stories.0.takeaways.0")!;
  expect(promptField.numericSupportCandidates.find(item => item.token === "one day")?.quoteIds.length)
    .toBeGreaterThan(0);

  field.quote = "The author generated 50,000 pages in a SINGLE-DAY.";
  const hyphenSources = sources.map(item => item.hnItemId === 1
    ? { ...item, sourceText: `${sourceText} ${field.quote}` }
    : item);
  expect(qualityFor(hyphenSources).blockingIssues.join(" ")).not.toContain("one day");
  expect(validateEditorialEvidenceReview(draft, hyphenSources, review)).toEqual([]);

  for (const unsupported of [
    "The author generated 50,000 pages in a single-daydream.",
    "The author generated 50,000 pages in a single month.",
    "The author generated 50,000 pages in two days.",
  ]) {
    field.quote = unsupported;
    const alternateSources = sources.map(item => item.hnItemId === 1
      ? { ...item, sourceText: `${sourceText} ${unsupported}` }
      : item);
    expect(qualityFor(alternateSources).blockingIssues.join(" ")).toContain("one day");
    expect(validateEditorialEvidenceReview(draft, alternateSources, review))
      .toContainEqual(expect.stringContaining("lacks cited numeric support at stories.0.takeaways.0: one day"));
  }
  field.quote = "The author generated 50,000 pages in a single";
  field.additionalSupports = [{ sourceId: 1, quote: "day at the site." }];
  expect(validateEditorialEvidenceReview(draft, sources.map(item => item.hnItemId === 1
    ? { ...item, sourceText: `${sourceText} ${field.quote} later. day at the site.` }
    : item), review))
    .toContainEqual(expect.stringContaining("lacks cited numeric support at stories.0.takeaways.0: one day"));
  field.additionalSupports = [];
  field.quote = quote;
  field.sourceId = 2;
  expect(qualityFor(sources.map(item => item.hnItemId === 1
    ? { ...item, sourceText }
    : { ...item, sourceText: source })).blockingIssues.join(" ")).toContain("one day");
  expect(validateEditorialEvidenceReview(draft, sources, review))
    .toContainEqual(expect.stringContaining("exact quote from the correct selected source"));
});
const args = {
  runDate: "2026-10-20", snapshotDate: "2026-10-20", siteUrl: "https://symbaiex.com",
  shadowSourceRunKey: "pilot:belle:draft-repair-test", forceLegacyGeneration: true,
};

async function runDraft(t: ReturnType<typeof setup>, actionArgs: typeof args & {
  forceElizaRuntimeGeneration?: boolean;
}) {
  if (actionArgs.shadowSourceRunKey.startsWith("pilot:belle:")) {
    await t.run(ctx => ctx.db.insert("elizaPilotRuns", {
      nonce: actionArgs.shadowSourceRunKey.slice("pilot:belle:".length),
      kind: "belle-newsletter",
      sourceKey: `snapshot:${actionArgs.snapshotDate}:run:${actionArgs.runDate}${actionArgs.forceElizaRuntimeGeneration && !actionArgs.forceLegacyGeneration ? ":eliza" : ""}`,
      status: "reserved",
      createdAt: 1,
      updatedAt: 1,
    }));
  }
  return t.action(generateDailySignal, actionArgs);
}

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
  const result = await runDraft(t, {
    ...args, shadowSourceRunKey: "newsletter:nonpilot-repair-test",
  });
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
  expect(shadow[0]!.promptVersion).toBe("belle-newsletter-v32-focused-implication");
  const system = JSON.parse(shadow[0]!.inputJson).system as string;
  expect(system).toContain(
    "Do not turn a report that only documents hidden instructions into a categorical claim of no assistant exposure",
  );
  expect(system).toContain("keep digits, units, ranges, and qualifiers");
  expect(system).toContain("Keep began-building, launch, observation, and report-publication events separate");
  expect(system).toContain("a property of a noteworthy subset must not be assigned to every item in the larger count");
  expect(system).toContain("if its facts would need more than four quotes in total, remove clauses");
  expect(system).toContain("add a new numeric or temporal fact there only when essential and literally supported by the source");
  expect(system).toContain("each whyItMatters at 220–320 characters and never above its generated 400-character ceiling");
  expect(system).toContain("Make whyItMatters one focused conditional implication or decision and a useful next check");
  expect(system).toContain("Do not inventory features, versions, benchmark conditions, or scope there");
  expect(system).toContain("preserve material caveats in the appropriate story field instead of dropping them");
  const baseline = JSON.parse(shadow[0]!.baselineJson);
  expect(baseline.evaluation.evidenceReview.reviewedFields).toBeGreaterThan(0);
  expect(baseline.evaluation.evidenceReview.verdicts[0]).not.toHaveProperty("selectedQuotes");
  expect(baseline.generation).toMatchObject({ inputTokens: 1_700, outputTokens: 2_000 });
  expect(baseline.generation).not.toHaveProperty("revisionEvaluation");
  expect(await t.run(ctx => ctx.db.query("newsletterIssues").take(10))).toEqual([]);
  expect(await t.run(ctx => ctx.db.query("dailyNewsletterRuns").take(10))).toEqual([]);
  expect(await t.run(ctx => ctx.db.query("elizaPilotRuns").take(10))).toEqual([]);
});

test("pilot retains accepted private output before a disabled comparison", async () => {
  vi.stubEnv("ELIZA_SHADOW_MODE", "off");
  const t = setup();
  await seedSnapshot(t);
  mockDrafts(validDraft);
  const result = await runDraft(t, {
    ...args, shadowSourceRunKey: "pilot:belle:disabled-accepted-capture",
  });
  expect(result.shadowEnqueue).toMatchObject({ status: "disabled", artifactRetained: true });
  expect(route.mock.calls.map(call => call[1]?.stage)).toEqual([
    "belle:daily-signal:draft", "belle:daily-signal:evidence-review",
  ]);
  const [pilot] = await t.run(ctx => ctx.db.query("elizaPilotRuns").take(10));
  expect(pilot).toMatchObject({
    artifactStatus: "accepted",
    sourceKey: "snapshot:2026-10-20:run:2026-10-20",
  });
  expect(JSON.parse(pilot!.baselineJson!).draft.subject).toBe(validDraft.subject);
  expect(JSON.parse(pilot!.baselineJson!).evaluation.evidenceReview.verdicts)
    .toContainEqual(expect.objectContaining({
      path: "stories.0.summary",
      selectedQuotes: [{ sourceId: 1, quote: sourceText.slice(0, 80) }],
    }));
  expect(JSON.parse(pilot!.evaluationJson!).stories[0].sourceText).toContain("manifest records");
  expect(await t.run(ctx => ctx.db.query("elizaShadowJobs").take(10))).toEqual([]);
  expect(await t.run(ctx => ctx.db.query("newsletterIssues").take(10))).toEqual([]);
});

test("pilot retains rejected private output after comparison capacity is exhausted", async () => {
  const t = setup();
  await seedSnapshot(t);
  const packet = JSON.stringify({
    version: 1, kind: "belle-newsletter", system: "fixture", prompt: "fixture",
    schema: { type: "object", properties: { healthy: { type: "boolean" } } },
  });
  for (let i = 0; i < 12; i++) {
    const queued = await t.mutation(internal.elizaShadowData.enqueue, {
      jobKey: `capacity-${i}`, kind: "belle-newsletter", sourceRunKey: `capacity-${i}`,
      promptVersion: "fixture", inputJson: packet,
      baselineJson: "{}", evaluationJson: "{}",
    });
    expect(queued.status).toBe("queued");
  }
  const clipped = dailyDraftSchema.parse({
    ...validDraft, lead: `${validDraft.lead} The report stopped because`,
  });
  mockDrafts(clipped, clipped);
  await expect(runDraft(t, {
    ...args, shadowSourceRunKey: "pilot:belle:limited-rejected-capture",
  })).rejects.toThrow(/baseline_quality_rejected.*artifactRetained.*true.*shadowStatus.*limited/);
  expect(route.mock.calls.filter(call => call[1]?.stage.endsWith(":evidence-review"))).toHaveLength(2);
  const [pilot] = await t.run(ctx => ctx.db.query("elizaPilotRuns").take(10));
  expect(pilot).toMatchObject({ artifactStatus: "rejected" });
  expect(JSON.parse(pilot!.baselineJson!).evaluation.feedback).toContainEqual(
    expect.stringContaining("lead ends without a complete sentence"),
  );
  expect(await t.run(ctx => ctx.db.query("elizaShadowJobs").take(20))).toHaveLength(12);
  expect(await t.run(ctx => ctx.db.query("newsletterIssues").take(10))).toEqual([]);
});

test("completed pilot reviewer failure retains private output even when comparison is disabled", async () => {
  vi.stubEnv("ELIZA_SHADOW_MODE", "off");
  const t = setup();
  await seedSnapshot(t);
  route.mockImplementation(async (_config, options) => {
    if (options.stage.endsWith(":evidence-review")) {
      throw new CompletedEditorialReviewError(new Error("completed unusable review"));
    }
    return {
      route: { persistedModel: "openrouter/free" },
      value: { draft: validDraft, usage: { inputTokens: 700, outputTokens: 900 }, modelId: "openrouter/free" },
    };
  });
  await expect(runDraft(t, {
    ...args, shadowSourceRunKey: "pilot:belle:disabled-review-failure",
  })).rejects.toThrow(/baseline_review_failed.*artifactRetained.*true.*shadowStatus.*disabled/);
  expect(route.mock.calls.map(call => call[1]?.stage)).toEqual([
    "belle:daily-signal:draft", "belle:daily-signal:evidence-review",
  ]);
  const [pilot] = await t.run(ctx => ctx.db.query("elizaPilotRuns").take(10));
  expect(pilot).toMatchObject({ artifactStatus: "review_failed" });
  expect(JSON.parse(pilot!.baselineJson!).evaluation.reviewStatus).toBe("unavailable");
  expect(await t.run(ctx => ctx.db.query("elizaShadowJobs").take(10))).toEqual([]);
  expect(await t.run(ctx => ctx.db.query("newsletterIssues").take(10))).toEqual([]);
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
  const result = await runDraft(t, {
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
  await expect(runDraft(t, {
    ...args, shadowSourceRunKey: "pilot:belle:clipped-prose-failed",
  })).rejects.toThrow("baseline_quality_rejected");
  expect(route.mock.calls.filter(call => call[1]?.stage.endsWith(":evidence-review"))).toHaveLength(2);
  const shadow = await t.run(ctx => ctx.db.query("elizaShadowJobs").take(10));
  expect(shadow).toHaveLength(1);
  expect(JSON.parse(shadow[0]!.baselineJson).evaluation.feedback).toContainEqual(
    expect.stringContaining("lead ends without a complete sentence"),
  );
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
  await expect(runDraft(t, {
    ...args, shadowSourceRunKey: "pilot:belle:partial-review-failed",
  })).rejects.toThrow("baseline_quality_rejected");
  expect(route.mock.calls.filter(call => call[1]?.stage.endsWith(":evidence-review"))).toHaveLength(2);
  const shadow = await t.run(ctx => ctx.db.query("elizaShadowJobs").take(10));
  expect(shadow).toHaveLength(1);
  expect(JSON.parse(shadow[0]!.baselineJson).evaluation.feedback).toContainEqual(
    expect.stringContaining("Evidence review omitted"),
  );
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
  await expect(runDraft(t, {
    ...args, shadowSourceRunKey: "pilot:belle:review-transport-unknown",
  })).rejects.toThrow("transport unknown outcome");
  expect(route.mock.calls.map(call => call[1]?.stage)).toEqual([
    "belle:daily-signal:draft", "belle:daily-signal:evidence-review",
  ]);
  expect(await t.run(ctx => ctx.db.query("elizaShadowJobs").take(10))).toEqual([]);
  expect((await t.run(ctx => ctx.db.query("elizaPilotRuns").take(10)))[0]).not.toHaveProperty("artifactStatus");
  expect(await t.run(ctx => ctx.db.query("newsletterIssues").take(10))).toEqual([]);
});

test("completed reviewer failure followed by budget or unknown transport preserves the final fatal error", async () => {
  const [candidate] = await routedModelCandidates(
    { openRouterApiKey: "test-only-key" }, NEWSLETTER_MODEL_IDS,
  );
  for (const failure of [
    new Error("review budget preflight denied"),
    new Error("Eliza runtime transport unknown outcome"),
  ]) {
    const t = setup();
    await seedSnapshot(t);
    route.mockReset();
    const noObject = new NoObjectGeneratedError({
      message: "No object generated", text: "not json",
      response: {} as ConstructorParameters<typeof NoObjectGeneratedError>[0]["response"],
      usage: {} as ConstructorParameters<typeof NoObjectGeneratedError>[0]["usage"],
      finishReason: "length",
    });
    const reviewerGenerate = vi.spyOn(ToolLoopAgent.prototype, "generate")
      .mockRejectedValueOnce(noObject);
    if (failure.message.includes("transport")) reviewerGenerate.mockRejectedValueOnce(failure);
    route.mockImplementation(async (_config, options) => {
      if (!options.stage.endsWith(":evidence-review")) {
        return {
          route: { persistedModel: "openrouter/free" },
          value: { draft: validDraft, usage: { inputTokens: 700, outputTokens: 900 }, modelId: "openrouter/free" },
        };
      }
      await expect(options.run(candidate, new AbortController().signal)).rejects.toBe(noObject);
      if (failure.message.includes("transport")) {
        await expect(options.run(candidate, new AbortController().signal)).rejects.toBe(failure);
      }
      throw failure;
    });
    await expect(runDraft(t, {
      ...args, shadowSourceRunKey: `pilot:belle:review-fail-then-${failure.message.includes("transport") ? "transport" : "budget"}`,
    })).rejects.toBe(failure);
    expect(route.mock.calls.map(call => call[1]?.stage)).toEqual([
      "belle:daily-signal:draft", "belle:daily-signal:evidence-review",
    ]);
    expect(await t.run(ctx => ctx.db.query("elizaShadowJobs").take(10))).toEqual([]);
    expect(await t.run(ctx => ctx.db.query("newsletterIssues").take(10))).toEqual([]);
    reviewerGenerate.mockRestore();
  }
});

test("oversize original selected evidence fails before any review route call", async () => {
  const t = setup();
  await seedSnapshot(t);
  articleTextOverride = "Original source evidence. ".repeat(6_000);
  mockDrafts(validDraft);
  await expect(runDraft(t, {
    ...args, shadowSourceRunKey: "pilot:belle:review-input-overflow",
  })).rejects.toThrow("bounded input window; no source was truncated");
  expect(route.mock.calls.map(call => call[1]?.stage)).toEqual(["belle:daily-signal:draft"]);
  expect(await t.run(ctx => ctx.db.query("elizaShadowJobs").take(10))).toEqual([]);
  expect(await t.run(ctx => ctx.db.query("newsletterIssues").take(10))).toEqual([]);
});

test("oversize full selected revision packet fails before the revision route", async () => {
  const t = setup();
  await seedSnapshot(t);
  articleTextOverride = candidate => candidate.id === "newsletter-1-0"
    ? "Original selected source evidence. ".repeat(1_900)
    : sourceText;
  mockDrafts(shortValidDraft);
  await expect(runDraft(t, {
    ...args, shadowSourceRunKey: "pilot:belle:revision-prompt-overflow",
  })).rejects.toThrow("Belle revision prompt exceeds the bounded input window; no selected source was truncated");
  expect(route.mock.calls.map(call => call[1]?.stage)).toEqual([
    "belle:daily-signal:draft", "belle:daily-signal:evidence-review",
  ]);
  expect(await t.run(ctx => ctx.db.query("newsletterIssues").take(10))).toEqual([]);
  expect(await t.run(ctx => ctx.db.query("elizaShadowJobs").take(10))).toEqual([]);
  expect(await t.run(ctx => ctx.db.query("dailyNewsletterRuns").take(10))).toEqual([]);
  expect(await t.run(ctx => ctx.db.query("newsletterSendLogs").take(10))).toEqual([]);
});

test("repeated invalid selection fails after one repair with private capture but no publication", async () => {
  const t = setup();
  await seedSnapshot(t);
  mockDrafts(invalidStoryDraft, invalidStoryDraft);
  await expect(runDraft(t, {
    ...args, shadowSourceRunKey: "pilot:belle:draft-repair-invalid",
  })).rejects.toThrow("baseline_quality_rejected");
  expect(route).toHaveBeenCalledTimes(2);
  const shadow = await t.run(ctx => ctx.db.query("elizaShadowJobs").take(10));
  expect(shadow).toHaveLength(1);
  expect(JSON.parse(shadow[0]!.baselineJson).evaluation.feedback).toContainEqual(
    expect.stringContaining("selected a source outside the research packet"),
  );
  expect(await t.run(ctx => ctx.db.query("newsletterIssues").take(10))).toEqual([]);
  expect(await t.run(ctx => ctx.db.query("dailyNewsletterRuns").take(10))).toEqual([]);
  expect(await t.run(ctx => ctx.db.query("newsletterSendLogs").take(10))).toEqual([]);
});

test("a clipped subject triggers one revision and accepts a complete replacement", async () => {
  expect(truncatedSubjectDraft.subject).toHaveLength(70);
  const t = setup();
  await seedSnapshot(t);
  mockDrafts(truncatedSubjectDraft, validDraft);
  const result = await runDraft(t, {
    ...args, shadowSourceRunKey: "pilot:belle:subject-repair-test",
  });
  expect(route).toHaveBeenCalledTimes(4);
  expect(route.mock.calls[2]?.[1]?.stage).toBe("belle:daily-signal:revision");
  expect(route.mock.calls[2]?.[1]?.run).toBeDefined();
  expect(route.mock.calls[2]?.[1]?.estimatedInputTokens).toBeGreaterThan(0);
  expect(result.subject).toBe(validDraft.subject);
  expect(result.payload.quality.score).toBeGreaterThanOrEqual(82);
  const shadow = await t.run(ctx => ctx.db.query("elizaShadowJobs").take(10));
  expect(shadow).toHaveLength(1);
  const generation = JSON.parse(shadow[0]!.baselineJson).generation;
  expect(generation.revisionAccepted).toBe(true);
  expect(generation).not.toHaveProperty("revisionEvaluation");
});

test("a repeatedly clipped subject fails closed after one revision", async () => {
  const t = setup();
  await seedSnapshot(t);
  mockDrafts(truncatedSubjectDraft, truncatedSubjectDraft);
  await expect(runDraft(t, {
    ...args, shadowSourceRunKey: "pilot:belle:subject-repair-failed-test",
  })).rejects.toThrow("baseline_quality_rejected");
  expect(route).toHaveBeenCalledTimes(4);
  const shadow = await t.run(ctx => ctx.db.query("elizaShadowJobs").take(10));
  expect(shadow).toHaveLength(1);
  expect(JSON.parse(shadow[0]!.baselineJson).evaluation.feedback).toContainEqual(
    expect.stringContaining("subject is incomplete"),
  );
  expect(await t.run(ctx => ctx.db.query("newsletterIssues").take(10))).toEqual([]);
});

test("a structurally valid original is retained when its revision has a bad selection", async () => {
  expect(editorialDraftWordCount(shortValidDraft)).toBeLessThan(650);
  const t = setup();
  await seedSnapshot(t);
  mockDrafts(shortValidDraft, invalidStoryDraft);
  let message = "";
  try {
    await runDraft(t, {
      ...args, shadowSourceRunKey: "pilot:belle:draft-repair-regression",
    });
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  expect(message).toContain("baseline_quality_rejected");
  expect(message).not.toContain("selected a source outside");
  expect(route).toHaveBeenCalledTimes(3);
  const shadow = await t.run(ctx => ctx.db.query("elizaShadowJobs").take(10));
  expect(shadow).toHaveLength(1);
  const baseline = JSON.parse(shadow[0]!.baselineJson);
  expect(baseline.evaluation).toMatchObject({
    wordCount: editorialDraftWordCount(shortValidDraft),
  });
  expect(baseline.draft.lead).toBe(shortValidDraft.lead);
  expect(baseline.generation).toMatchObject({
    revisionAttempted: true,
    revisionAccepted: false,
    revisionEvaluation: {
      score: 0,
      wordCount: editorialDraftWordCount(invalidStoryDraft),
      blockingIssueCount: 1,
      blockingIssues: ["Belle selected a source outside the research packet"],
      truncated: false,
    },
  });
  expect(baseline.generation.revisionEvaluation).not.toHaveProperty("totalIssueCount");
  expect(JSON.stringify(baseline.generation)).not.toContain(validDraft.lead);
  expect(await t.run(ctx => ctx.db.query("newsletterIssues").take(10))).toEqual([]);
});

test("pilot captures bounded reasons when a revision is rejected", async () => {
  const t = setup();
  await seedSnapshot(t);
  mockDrafts(shortValidDraft, validDraft);
  reviewOverrides.push(review => review, review => {
    for (const field of review.fields.slice(0, 15)) {
      field.verdict = "unsupported";
      field.reason = `Revision-only private diagnostic ${"x".repeat(300)}`;
    }
    return review;
  });
  await expect(runDraft(t, {
    ...args, shadowSourceRunKey: "pilot:belle:bounded-revision-diagnostic",
  })).rejects.toThrow("baseline_quality_rejected");
  const shadow = await t.run(ctx => ctx.db.query("elizaShadowJobs").take(10));
  expect(shadow).toHaveLength(1);
  const baseline = JSON.parse(shadow[0]!.baselineJson);
  expect(baseline.draft.lead).toBe(shortValidDraft.lead);
  expect(baseline.evaluation.wordCount).toBe(editorialDraftWordCount(shortValidDraft));
  expect(baseline.generation.revisionAccepted).toBe(false);
  expect(baseline.generation.revisionEvaluation).toMatchObject({
    score: expect.any(Number),
    wordCount: editorialDraftWordCount(validDraft),
    blockingIssueCount: 15,
    truncated: true,
  });
  const issues: string[] = baseline.generation.revisionEvaluation.blockingIssues;
  expect(issues).toHaveLength(12);
  expect(issues.every(issue => issue.length <= 240)).toBe(true);
  expect(JSON.stringify(baseline.generation)).not.toContain(validDraft.lead);
  expect(await t.run(ctx => ctx.db.query("newsletterIssues").take(10))).toEqual([]);
});

test("chart rows come from selected story scores and analysis, never foreign model rows", async () => {
  const t = setup();
  await seedSnapshot(t);
  mockDrafts(invalidChartDraft);
  const result = await runDraft(t, {
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
  await runDraft(t, {
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
  expect((await t.run(ctx => ctx.db.query("elizaPilotRuns").first()))?.sourceKey)
    .toBe("snapshot:2026-10-20:run:2026-10-20:eliza");
  await expect(runDraft(t, {
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
  await runDraft(t, {
    ...args, forceLegacyGeneration: false,
    shadowSourceRunKey: "pilot:belle:normal-runtime-off-model",
  });
  expect(route.mock.calls.map(call => call[2])).toEqual([
    [OPENROUTER_PAID_FALLBACK_MODEL], [OPENROUTER_PAID_FALLBACK_MODEL],
  ]);
});

test("Belle's fixed-model SDK requests use low private reasoning within the pinned limits", async () => {
  const t = setup();
  await seedSnapshot(t);
  const wire = compactReview(validDraft);
  expect(wire.fields.find(field => field.path === "lead")).toEqual({
    path: "lead", verdict: "analysis",
  });
  expect(JSON.stringify(wire).length).toBeLessThan(JSON.stringify(reviewedDraft(validDraft)).length);
  mockDrafts(invalidStoryDraft, validDraft);
  await runDraft(t, {
    ...args, runDate: "2026-10-21", forceLegacyGeneration: false, forceElizaRuntimeGeneration: true,
    shadowSourceRunKey: "pilot:belle:fixed-model-serialization-test",
  });
  const requestBodies: Record<string, unknown>[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requestBodies.push(body);
    const responseContent = body.max_tokens === 4_000
      ? compactReview(validDraft) : validDraft;
    return new Response(JSON.stringify({
      id: "belle-structured-test", object: "chat.completion", created: 1_760_000_000,
      model: NEWSLETTER_MODEL_IDS[0],
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
  const schemas = requestBodies.map(body => {
    const responseFormat = body.response_format as {
      type: string;
      json_schema: { strict: boolean; schema: Record<string, unknown> };
    };
    expect(responseFormat.type).toBe("json_schema");
    expect(responseFormat.json_schema.strict).toBe(true);
    expectStrictReviewObjects(responseFormat.json_schema.schema);
    return responseFormat.json_schema.schema;
  });
  const writerProperties = schemas[0]!.properties as Record<string, {
    items?: { properties?: Record<string, unknown> };
  }>;
  expect(writerProperties.stories.items?.properties?.hnItemId).toMatchObject({
    type: "integer", exclusiveMinimum: 0,
  });
  expect(writerProperties.stories.items?.properties?.signalScore).toMatchObject({
    type: "integer", minimum: 0, maximum: 100,
  });
  expect(writerProperties.stories.items?.properties?.whyItMatters).toMatchObject({
    type: "string", minLength: 90, maxLength: 400,
  });
  const reviewSchema = schemas[2]!;
  const reviewProperties = reviewSchema.properties as Record<string, {
    anyOf?: Array<{ type: string }>;
    items?: { anyOf?: unknown[] };
  }>;
  expect(reviewProperties.coherenceReason.anyOf?.map(option => option.type))
    .toEqual(["string", "null"]);
  expect(reviewProperties.fields.items?.anyOf).toHaveLength(4);
  const worker = await import(new URL("../workers/eliza-shadow/src/live.mjs", import.meta.url).href) as {
    liveInputHash(body: Record<string, unknown>): string;
    validateLiveRequest(input: unknown): unknown;
  };
  for (const [index, body] of requestBodies.slice(0, 3).entries()) {
    const envelope = {
      version: 2, jobId: `belle-strict-schema-test-${index}`,
      inputHash: worker.liveInputHash(body),
      agentSlug: "belle",
      stage: `belle:daily-signal:${index === 0 ? "draft" : index === 1 ? "revision" : "evidence-review"}`,
      body,
    };
    expect(worker.validateLiveRequest(envelope)).toEqual(envelope);
  }
  for (const body of requestBodies.slice(0, 2)) {
    expect(body).toMatchObject({
      model: NEWSLETTER_MODEL_IDS[0],
      max_tokens: 8000,
      provider: { max_price: { prompt: "0.2", completion: "0.5" } },
    });
    expect(body.reasoning).toEqual({ effort: "low", exclude: true });
    expect(body.reasoning_effort).toBeUndefined();
    expect(JSON.stringify(body.messages)).toContain("Reasoning strength: low");
    expect(JSON.stringify(body.messages)).toContain("Reason through the task privately");
    expect(JSON.stringify(body.messages)).not.toContain("Reasoning strength: none");
    expect(JSON.stringify(body.messages)).toContain("standalone email subject of at most 64 characters");
    expect(JSON.stringify(body.messages)).toContain("Citation or retrieval of a web page by ChatGPT is not evidence");
    expect(JSON.stringify(body.messages)).toContain("at most four short original source passages");
    expect(JSON.stringify(body.messages)).toContain("prefer three genuinely connected source anchors");
    expect(JSON.stringify(body.messages)).toContain("remove a factual premise from an unselected source");
    expect(JSON.stringify(body.messages)).toContain("at most one figure or version overall");
    expect(JSON.stringify(body.messages)).toContain("at most one figure or version rather than enumerating metrics");
    expect(JSON.stringify(body.messages)).toContain('Name the exact supported model from a source list instead of inferring a count such as \\"one model\\"');
    expect(JSON.stringify(body.messages)).toContain("Do not force unrelated reports into a shared observed failure");
    expect(JSON.stringify(body.messages)).toContain("A coherent lead may use contrast or a counterpoint");
    expect(JSON.stringify(body.messages)).toContain("date a source was discovered describe this newsletter's collection");
    expect(JSON.stringify(body.messages)).toContain("do not turn an older event covered in a recent report into a current-week release");
    expect(JSON.stringify(body.messages)).toContain("a bare undated release claim is fine");
    expect(JSON.stringify(body.messages)).toContain("released this week");
    expect(JSON.stringify(body.messages)).toContain("Source-specific assertions in whyItMatters are facts requiring citations");
    expect(JSON.stringify(body.messages)).toContain("Belle's editorial priorities");
    expect(JSON.stringify(body.messages)).toContain("not a measured result.");
    expect(JSON.stringify(body.messages)).toContain("each story summary at or below 320 characters in no more than two focused factual sentences");
    expect(JSON.stringify(body.messages)).toContain("central finding and one essential scope qualifier");
    expect(JSON.stringify(body.messages)).toContain("Preserve all material source caveats");
    expect(JSON.stringify(body.messages)).toContain("shortening a summary is not permission to drop a limitation");
    expect(JSON.stringify(body.messages)).toContain("do not state that they shape what it will tell a user without observed answer behavior");
    expect(JSON.stringify(body.messages)).toContain("even if a later sentence adds a caveat");
  }
  expect(requestBodies[2]).toMatchObject({
    model: NEWSLETTER_MODEL_IDS[0], max_tokens: 4_000,
    provider: { max_price: { prompt: "0.2", completion: "0.5" } },
  });
  expect(requestBodies[2]?.reasoning).toEqual({ effort: "low", exclude: true });
  expect(requestBodies[2]?.reasoning_effort).toBeUndefined();
  expect(JSON.stringify(requestBodies[2]?.messages)).toContain("Reasoning strength: low");
  expect(JSON.stringify(requestBodies[2]?.messages)).toContain("Reason through the task privately");
  expect(JSON.stringify(requestBodies[2]?.messages)).not.toContain("Reasoning strength: none");
  expect(JSON.stringify(requestBodies[2]?.messages)).toContain("10,000 AI sessions is NOT 10,000 ChatGPT citations");
  expect(JSON.stringify(requestBodies[2]?.messages)).toContain("editorial label; factual assertions still need evidence");
  expect(JSON.stringify(requestBodies[2]?.messages)).toContain("Do not demand one source support a compound claim about multiple sources");
  expect(JSON.stringify(requestBodies[2]?.messages)).toContain("A proposal to check something is not a claim that it was already observed");
  expect(JSON.stringify(requestBodies[2]?.messages)).toContain("unrelated topics are not automatically a coherent synthesis");
  expect(JSON.stringify(requestBodies[2]?.messages)).toContain("production-grade inference is now open source");
  expect(JSON.stringify(requestBodies[2]?.messages)).toContain("Hidden instructions found in pages establish their presence, not that a model obeyed them");
  expect(JSON.stringify(requestBodies[2]?.messages)).toContain("every clause of a mixed-source sentence and its attribution");
  expect(JSON.stringify(requestBodies[2]?.messages)).toContain("A field that names a source version or release remains a fact");
  expect(JSON.stringify(requestBodies[2]?.messages)).toContain("numericSupportCandidates");
  expect(JSON.stringify(requestBodies[2]?.messages)).toContain("non-exhaustive search hints, not evidence verdicts or automatic citations");
  expect(JSON.stringify(requestBodies[2]?.messages)).toContain("select 1–4 distinct exact quoteIds");
  expect(JSON.stringify(requestBodies[2]?.messages)).toContain("never repeat an ID within a field");
  expect(JSON.stringify(requestBodies[2]?.messages)).toContain("If no four-quote set supports every clause, mark the field unsupported or unknown");
  expect(JSON.stringify(requestBodies[2]?.messages)).toContain("A later caveat does not repair an earlier categorical assertion");
  expect(JSON.stringify(requestBodies[2]?.messages)).toContain("Set coherenceReason to null for clear coherence");
  expect(JSON.stringify(requestBodies[2]?.messages)).toContain('issueDate\\\":\\\"2026-10-21');
  expect(JSON.stringify(requestBodies[2]?.messages)).toContain("Check temporal claims as facts too");
  expect(JSON.stringify(requestBodies[2]?.messages)).toContain("issueDate is a comparison anchor for relative wording only");
  expect(JSON.stringify(requestBodies[2]?.messages)).toContain("later report about earlier work is not a current-week release");
  expect(JSON.stringify(requestBodies[2]?.messages)).toContain("An undated claim that an author released something can be supported");
});

test("legacy DeepSeek writer and reviewer explicitly disable reasoning", async () => {
  const t = setup();
  await seedSnapshot(t);
  mockDrafts(validDraft);
  await runDraft(t, {
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
        content: JSON.stringify(body.max_tokens === 4_000 ? compactReview(validDraft) : validDraft),
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
  expect(JSON.stringify(requestBodies[0]?.messages)).toContain("Reasoning strength: none");
  expect(JSON.stringify(requestBodies[1]?.messages)).not.toContain("Reasoning strength:");
});
