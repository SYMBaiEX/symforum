// @vitest-environment node

import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ActionCtx } from "./_generated/server";
import { OPENROUTER_FORUM_MODEL } from "../lib/ai-models";
import { ElizaRuntimeTransportError } from "../lib/eliza-runtime-transport";

const model = vi.hoisted(() => ({
  outputs: [] as unknown[],
  prompts: [] as string[],
  review: vi.fn(),
}));

vi.mock("ai", async (original) => ({
  ...(await original<typeof import("ai")>()),
  ToolLoopAgent: class {
    async generate({ prompt }: { prompt: string }) {
      model.prompts.push(prompt);
      const output = model.outputs.shift();
      if (output === undefined) throw new Error("Unexpected model generation");
      if (output instanceof Error) throw output;
      return {
        output,
        usage: { inputTokens: 100, outputTokens: 40 },
        response: { modelId: OPENROUTER_FORUM_MODEL },
      };
    }
  },
  generateText: model.review,
}));
vi.mock("./forumAgentMemory", async (original) => ({
  ...(await original<typeof import("./forumAgentMemory")>()),
  searchEditorialMemory: vi.fn(async () => []),
}));
vi.mock("./modelRouting", () => ({
  convexModelRoutingConfig: vi.fn(async () => ({
    openRouterApiKey: "fixture-not-a-real-key",
  })),
}));
vi.mock("../lib/ai-model-routing", async (original) => ({
  ...(await original<typeof import("../lib/ai-model-routing")>()),
  runWithModelFallback: vi.fn(async (_config, options) => ({
    value: await options.run(
      {
        model: {},
        modelId: OPENROUTER_FORUM_MODEL,
        persistedModel: OPENROUTER_FORUM_MODEL,
        provider: "openrouter",
        providerOptions: {},
      },
      new AbortController().signal,
    ),
    route: { persistedModel: OPENROUTER_FORUM_MODEL, provider: "openrouter" },
  })),
}));

import { runForumResearchSlot } from "./sukiForumAgent";

const sourceSentence =
  "Version 2.4 adds checkpoint recovery to interrupted synchronization jobs.";
const sourceText = [
  sourceSentence,
  "The integrity manifest records completed batch checksums for an operational audit.",
  "Operators can compare the checkpoint and manifest before restarting a synchronization job.",
  "A completed batch is recorded before the next batch begins, and interrupted jobs can resume from a checkpoint.",
].join(" ");
const articleUrl = "https://example.com/checkpoint";
const now = Date.parse("2026-10-22T18:05:00.000Z");
const candidate = {
  id: "source-a",
  sourceKey: "source-a",
  sourceName: "Example",
  sourceFeedUrl: "https://example.com/feed.xml",
  title: "Checkpoint recovery release",
  url: articleUrl,
  summary: sourceSentence,
  boardSlugs: ["ai-frameworks"],
  publishedAt: now,
};
const selection = {
  angle: "Test checkpoint recovery before adopting the SDK",
  candidateIds: ["source-a"],
  categorySlug: "ai-frameworks",
  postType: "news-analysis",
  prefixSlug: "news",
  includePoll: false,
  contentFormat: "discovery",
};
const board = {
  slug: "ai-frameworks",
  name: "AI Frameworks",
  description: "Practical tooling",
};
const config = {
  slug: "test",
  name: "Test",
  dailySlots: 1,
  promptVersion: "test",
  deskDescription: "Practical tooling",
  topicInstructions: "Choose supported tooling",
  writerInstructions: "Use source evidence",
};

function draft(extra: string) {
  return {
    title: "Checkpoint recovery and manifest validation",
    body: `${sourceSentence} ${extra} Before adoption, compare the checkpoint against the documented integrity manifest.`,
    poll: null,
    imageCandidateId: null,
    claims: [
      {
        claim: sourceSentence,
        sourceCandidateId: "source-a",
        confidence: "high",
        kind: "fact",
      },
    ],
    originalValue: [sourceSentence],
    discussionQuestion: "",
  };
}

function fixtureContext() {
  const mutations: { name: string; args: Record<string, unknown> }[] = [];
  const runMutation = vi.fn(async (reference, args) => {
    const name = getFunctionName(reference);
    mutations.push({ name, args });
    if (name === "sukiForumAgentData:claimRun") {
      return { claimed: true, runKey: "test:revision-cursor" };
    }
    if (name === "sukiForumAgentData:reserveResearchTopic") {
      return { reserved: true };
    }
    throwIfPublished(name);
    return null;
  });
  const runQuery = vi.fn(async (reference, args) => {
    switch (getFunctionName(reference)) {
      case "forum:readForumAgentContext":
        return {
          agent: { enabled: true, model: OPENROUTER_FORUM_MODEL },
          categories: [board],
          recentBoardSlugs: [],
          recentThreadTitles: [],
          recentThreads: [],
          editorialSignals: [],
        };
      case "forumAgentEditorialData:readEditorialStrategies":
        return [];
      case "sukiForumAgentData:readResearchCaches":
        return args.cacheKeys.map((cacheKey: string) => ({
          cacheKey,
          payloadJson: JSON.stringify([candidate]),
        }));
      case "forum:selectAvailableForumAgentSourceKeys":
        return [candidate.sourceKey];
      default:
        throw new Error(`Unexpected query: ${getFunctionName(reference)}`);
    }
  });
  const runAfter = vi.fn();
  return {
    ctx: {
      runMutation,
      runQuery,
      scheduler: { runAfter },
    } as unknown as ActionCtx,
    mutations,
    runAfter,
  };
}

function throwIfPublished(name: string) {
  if (
    name === "forum:publishSukiForumThread" ||
    name === "forum:publishForumAgentFollowUp"
  ) {
    throw new Error("Publication was not expected");
  }
}

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(now);
  model.outputs = [];
  model.prompts = [];
  model.review.mockReset();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url !== articleUrl) throw new Error(`Unexpected fetch: ${url}`);
      return new Response(
        `<html><head><title>Checkpoint recovery release</title></head><body><article>${sourceText}</article></body></html>`,
        {
          headers: { "content-type": "text/html" },
        },
      );
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Suki action revision cursor", () => {
  test("revises the latest attempt but retains the unchanged best draft for the final decision", async () => {
    const first = draft("Version 9.9 adds autonomous checkpoint encryption.");
    const second = draft("Version 8.8 adds autonomous checkpoint encryption.");
    const third = draft("Version 7.7 adds autonomous checkpoint encryption.");
    model.outputs = [selection, first, second, third];
    const { ctx, mutations, runAfter } = fixtureContext();

    const result = await runForumResearchSlot(
      ctx,
      { slot: 0, runDate: "2026-10-22" },
      config,
    );

    expect(result).toEqual({ status: "skipped", reason: "editorial-quality" });
    expect(model.prompts).toHaveLength(4);
    expect(model.prompts[3]).toContain(second.body);
    expect(model.prompts[3]).toContain("8.8");
    expect(model.prompts[3]).not.toContain(first.body);
    expect(model.prompts[3]).not.toContain("9.9");
    const usage = mutations.filter(
      ({ name }) => name === "forumAgentEditorialData:recordUsage",
    );
    expect(usage.map(({ args }) => args.stage)).toEqual([
      "topic",
      "draft",
      "revision",
      "revision",
    ]);
    expect(usage[1].args.qualityAfter).toBe(77);
    expect(usage[2].args.qualityAfter).toBe(77);
    expect(usage[3].args.qualityBefore).toBe(usage[2].args.qualityAfter);
    const decisions = mutations.filter(
      ({ name }) =>
        name === "forumAgentResearchPackets:recordPublicationDecision",
    );
    expect(decisions).toHaveLength(1);
    expect(decisions[0].args).toMatchObject({
      body: first.body,
      revision: 0,
      publishable: false,
    });
    expect(model.review).not.toHaveBeenCalled();
    expect(
      mutations.some(
        ({ name }) =>
          name === "forum:publishSukiForumThread" ||
          name === "forum:publishForumAgentFollowUp",
      ),
    ).toBe(false);
    expect(runAfter).not.toHaveBeenCalled();
  });

  test("reviews the passing second correction, then holds it when independent review rejects", async () => {
    const first = draft("Version 9.9 adds autonomous checkpoint encryption.");
    const second = draft("Version 8.8 adds autonomous checkpoint encryption.");
    const corrected = {
      ...draft(""),
      body: sourceText,
      claims: sourceText.split(". ").map((part) => ({
        claim: part.endsWith(".") ? part : `${part}.`,
        sourceCandidateId: "source-a",
        confidence: "high",
        kind: "fact",
      })),
    };
    model.outputs = [selection, first, second, corrected];
    model.review.mockResolvedValue({
      output: {
        approved: false,
        issues: ["Source does not establish practical utility"],
      },
      usage: { inputTokens: 100, outputTokens: 20 },
      response: { modelId: OPENROUTER_FORUM_MODEL },
    });
    const { ctx, mutations, runAfter } = fixtureContext();

    const result = await runForumResearchSlot(
      ctx,
      { slot: 0, runDate: "2026-10-22" },
      config,
    );

    expect(result).toEqual({ status: "skipped", reason: "editorial-quality" });
    expect(model.prompts).toHaveLength(4);
    expect(model.review).toHaveBeenCalledTimes(1);
    expect(model.review.mock.calls[0][0].prompt).toContain(corrected.body);
    expect(
      mutations.filter(
        ({ name }) =>
          name === "forumAgentResearchPackets:recordPublicationDecision",
      ),
    ).toEqual([]);
    expect(
      mutations
        .filter(
          ({ name }) =>
            name === "forumAgentResearchPackets:recordDraftRevision",
        )
        .at(-1)?.args,
    ).toMatchObject({
      body: corrected.body,
      revision: 2,
    });
    expect(runAfter).not.toHaveBeenCalled();
  });

  test("an uncertain revision stops without another correction, publication or scheduled retry", async () => {
    const first = draft("Version 9.9 adds autonomous checkpoint encryption.");
    model.outputs = [
      selection,
      first,
      new ElizaRuntimeTransportError("outcome_unknown", true),
      draft("Version 8.8 adds autonomous checkpoint encryption."),
    ];
    const { ctx, mutations, runAfter } = fixtureContext();

    const result = await runForumResearchSlot(
      ctx,
      { slot: 0, runDate: "2026-10-22" },
      config,
    );

    expect(result).toMatchObject({ status: "failed" });
    expect(model.prompts).toHaveLength(3);
    expect(model.outputs).toHaveLength(1);
    expect(model.review).not.toHaveBeenCalled();
    expect(
      mutations.some(
        ({ name }) =>
          name === "forum:publishSukiForumThread" ||
          name === "forum:publishForumAgentFollowUp",
      ),
    ).toBe(false);
    expect(runAfter).not.toHaveBeenCalled();
  });
});
