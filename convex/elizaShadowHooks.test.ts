// @vitest-environment node

import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ActionCtx } from "./_generated/server";

const generation = vi.hoisted(() => ({
  writer: vi.fn(),
  reviewer: vi.fn(),
}));

vi.mock("@convex-dev/agent", () => ({
  Agent: class {
    generateObject = generation.writer;
  },
}));
vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  generateText: generation.reviewer,
}));
vi.mock("./modelRouting", () => ({
  convexModelRoutingConfig: vi.fn(async () => ({
    openRouterApiKey: "test-only-not-a-credential",
  })),
}));
vi.mock("../lib/ai-model-routing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/ai-model-routing")>()),
  runWithModelFallback: vi.fn(async (_config, args) => ({
    value: await args.run(
      {
        model: {},
        modelId: "openrouter/free",
        persistedModel: "openrouter/free",
        provider: "openrouter",
        providerOptions: {},
      },
      new AbortController().signal,
    ),
    route: { persistedModel: "openrouter/free", provider: "openrouter" },
  })),
}));

import { runReplySweep } from "./sukiForumReplyAgent";

const finalBody =
  "Compare the request identities before changing retry configuration.";

beforeEach(() => {
  generation.writer.mockResolvedValue({
    object: {
      decision: "reply",
      reason: "answer-the-question",
      body: finalBody,
      contribution: "next-step",
      evidenceSourceUrls: [],
      evidenceExcerpt: "",
    },
    usage: { inputTokens: 100, outputTokens: 30 },
    response: { modelId: "test/writer:free" },
  });
  generation.reviewer.mockResolvedValue({
    output: { approved: true, issues: [] },
    usage: { inputTokens: 100, outputTokens: 20 },
    response: { modelId: "test/reviewer:free" },
  });
  vi.spyOn(globalThis, "fetch").mockRejectedValue(
    new Error("Unexpected external request"),
  );
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

function liveContext(shadowFails: boolean) {
  const runMutation = vi.fn(
    async (reference: Parameters<typeof getFunctionName>[0]) => {
      const name = getFunctionName(reference);
      if (name === "forum:claimSukiForumReplyCandidate") {
        return {
          claimed: true,
          runId: "test-reply-run",
          conversationId: "PRIVATE_HISTORY_ID",
          candidate: {
            authorName: "Private display name",
            authorIsAgent: false,
            categoryName: "Development",
            categorySlug: "development",
            recentPosts: [],
            sourceBody: "How should I investigate retry configuration?",
            sourceKind: "thread",
            sourcePostNumber: 1,
            threadId: "test-thread",
            threadBody: "A public conversation about request duplication.",
            threadTitle: "Debugging duplicate requests",
          },
        };
      }
      if (name === "elizaShadowData:enqueue") {
        if (shadowFails) throw new Error("Shadow unavailable");
        return { status: "queued" };
      }
      if (name === "forum:publishSukiForumReply") {
        return {
          status: "replied",
          categorySlug: "development",
          threadSlug: "duplicate-requests",
          postNumber: 3,
        };
      }
      return null;
    },
  );
  const runAfter = vi.fn();
  return {
    runMutation,
    runAfter,
    ctx: { runMutation, scheduler: { runAfter } } as unknown as ActionCtx,
  };
}

async function invokeLiveReply(ctx: ActionCtx) {
  return await (
    runReplySweep as unknown as {
      _handler: (
        ctx: ActionCtx,
        args: Record<string, never>,
      ) => Promise<unknown>;
    }
  )._handler(ctx, {});
}

describe("live reply shadow non-interference", () => {
  test.each([false, true])(
    "preserves the exact reviewed publication when shadow enqueue failure is %s",
    async (shadowFails) => {
      const context = liveContext(shadowFails);
      expect(await invokeLiveReply(context.ctx)).toEqual({
        status: "replied",
        categorySlug: "development",
        threadSlug: "duplicate-requests",
        postNumber: 3,
      });
      const calls = context.runMutation.mock.calls as unknown as Array<
        [Parameters<typeof getFunctionName>[0], Record<string, unknown>]
      >;
      expect(
        calls.filter(
          ([reference]) =>
            getFunctionName(reference) ===
            "forumAgentEditorialData:recordUsage",
        ),
      ).toHaveLength(2);
      const shadowIndex = calls.findIndex(
        ([reference]) =>
          getFunctionName(reference) === "elizaShadowData:enqueue",
      );
      const publishIndex = calls.findIndex(
        ([reference]) =>
          getFunctionName(reference) === "forum:publishSukiForumReply",
      );
      expect(shadowIndex).toBeGreaterThan(0);
      expect(publishIndex).toBeGreaterThan(shadowIndex);
      expect(calls[publishIndex][1]).toEqual({
        agentSlug: "suki",
        runId: "test-reply-run",
        body: finalBody,
        reason: "answer-the-question",
        inputTokens: 100,
        outputTokens: 30,
      });
      expect(
        calls.some(
          ([reference]) =>
            getFunctionName(reference) === "forum:markSukiForumReplyFailed",
        ),
      ).toBe(false);
      expect(context.runAfter).not.toHaveBeenCalled();
      expect(globalThis.fetch).not.toHaveBeenCalled();
    },
  );

  test("captures the final reviewed abstention and never publishes a rejected reply", async () => {
    generation.reviewer.mockResolvedValue({
      output: {
        approved: false,
        issues: ["Source does not entail the correction."],
      },
      usage: { inputTokens: 100, outputTokens: 20 },
      response: { modelId: "test/reviewer:free" },
    });
    const context = liveContext(true);
    expect(await invokeLiveReply(context.ctx)).toEqual({
      status: "skipped",
      reason: "original-evidence-review-rejected",
    });
    const calls = context.runMutation.mock.calls as unknown as Array<
      [Parameters<typeof getFunctionName>[0], Record<string, unknown>]
    >;
    const shadow = calls.find(
      ([reference]) => getFunctionName(reference) === "elizaShadowData:enqueue",
    );
    expect(JSON.parse(shadow![1].baselineJson as string).decision).toEqual({
      decision: "ignore",
      reason: "original-evidence-review-rejected",
    });
    expect(
      calls.some(
        ([reference]) =>
          getFunctionName(reference) === "forum:publishSukiForumReply",
      ),
    ).toBe(false);
    expect(
      calls.some(
        ([reference]) =>
          getFunctionName(reference) === "forum:markSukiForumReplyIgnored",
      ),
    ).toBe(true);
    expect(context.runAfter).not.toHaveBeenCalled();
  });
});
