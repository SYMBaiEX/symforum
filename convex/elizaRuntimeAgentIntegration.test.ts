// @vitest-environment node
/// <reference types="vite/client" />

import { Agent, createThread } from "@convex-dev/agent";
import agentTest from "@convex-dev/agent/test";
import { convexTest } from "convex-test";
import type { LanguageModel } from "ai";
import { afterEach, expect, test, vi } from "vitest";
import { routedModelCandidates } from "../lib/ai-model-routing";
import { components } from "./_generated/api";
import type { ActionCtx } from "./_generated/server";
import {
  FORUM_REPLY_AGENT_GENERATION_OPTIONS,
  FORUM_REPLY_AGENT_MESSAGE_OPTIONS,
  sukiReplyDecisionSchema,
} from "./sukiForumReplyAgent";
import schema from "./schema";

const modules = {
  ...import.meta.glob("./**/*.ts"),
  ...import.meta.glob("./**/*.tsx"),
};

afterEach(() => vi.unstubAllGlobals());

test("real Convex Agent forwards bounded private same-thread history through Eliza without publishing", async () => {
  const t = convexTest(schema, modules);
  agentTest.register(t);
  const [candidate] = await routedModelCandidates(
    {
      openRouterApiKey: "test-only-openrouter-key",
      elizaRuntime: {
        url: "https://eliza-worker.example",
        secret: "private-worker-secret-32-characters-long",
      },
    },
    ["openrouter/free"],
    { agentSlug: "suki", stage: "suki:forum-reply" },
  );
  const replyAgent = new Agent(components.agent, {
    name: "Suki",
    languageModel: candidate.model as Extract<
      LanguageModel,
      { specificationVersion: "v4" }
    >,
    instructions: "Reply only from the supplied private context.",
    ...FORUM_REPLY_AGENT_MESSAGE_OPTIONS,
  });

  const threadId = await t.run((ctx) =>
    createThread(ctx, components.agent, { userId: "suki" }),
  );
  const otherThreadId = await t.run((ctx) =>
    createThread(ctx, components.agent, { userId: "suki" }),
  );
  for (let index = 1; index <= 22; index++) {
    await t.run((ctx) =>
      replyAgent.saveMessage(ctx, {
        threadId,
        message: {
          role: "user",
          content: `private-turn-${String(index).padStart(2, "0")}`,
        },
        skipEmbeddings: true,
      }),
    );
  }
  await t.run((ctx) =>
    replyAgent.saveMessage(ctx, {
      threadId,
      message: {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-private",
            toolName: "lookup",
            result: "private-tool-secret",
          },
        ],
      },
      skipEmbeddings: true,
    }),
  );
  await t.run((ctx) =>
    replyAgent.saveMessage(ctx, {
      threadId: otherThreadId,
      message: { role: "user", content: "other-thread-private-secret" },
      skipEmbeddings: true,
    }),
  );

  const workerFetch = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://eliza-worker.example/complete");
      const envelope = JSON.parse(String(init?.body));
      expect(envelope).toMatchObject({
        version: 2,
        agentSlug: "suki",
        stage: "suki:forum-reply",
      });
      const body = envelope.body;
      expect(body.model).toBe("openrouter/free");
      expect(body.max_tokens).toBe(200);
      expect(body.response_format?.type).toBe("json_schema");
      expect(body.provider).toEqual({ require_parameters: true });
      const history = JSON.stringify(body.messages);
      expect(history).toContain("private-turn-03");
      expect(history).toContain("private-turn-22");
      expect(history).not.toContain("private-turn-01");
      expect(history).not.toContain("private-turn-02");
      expect(history).not.toContain("private-tool-secret");
      expect(history).not.toContain("other-thread-private-secret");
      expect(
        body.messages.filter(
          (message: { role: string }) => message.role === "user",
        ).length,
      ).toBe(21);
      return Response.json({
        version: 2,
        jobId: envelope.jobId,
        inputHash: envelope.inputHash,
        agentSlug: envelope.agentSlug,
        stage: envelope.stage,
        runtimeVersion: "1.7.2",
        completion: {
          id: "chatcmpl-agent-test",
          object: "chat.completion",
          created: 1_760_000_000,
          model: "openrouter/free",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: JSON.stringify({
                  decision: "ignore",
                  reason: "No grounded reply is needed.",
                }),
              },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 85, completion_tokens: 12, total_tokens: 97 },
        },
      });
    },
  );
  vi.stubGlobal("fetch", workerFetch);

  // This bridge delegates every component operation to the real convex-test
  // runtime; it does not stub the Agent or its persisted message history.
  const actionCtx = {
    runQuery: t.query.bind(t),
    runMutation: t.mutation.bind(t),
    runAction: t.action.bind(t),
  } as unknown as ActionCtx;
  const result = await replyAgent.generateObject(
    actionCtx,
    { threadId },
    {
      prompt: "Decide whether this forum thread merits a reply.",
      schema: sukiReplyDecisionSchema,
      maxOutputTokens: 200,
      ...FORUM_REPLY_AGENT_GENERATION_OPTIONS,
    },
  );

  expect(sukiReplyDecisionSchema.parse(result.object)).toEqual({
    decision: "ignore",
    reason: "No grounded reply is needed.",
  });
  expect(workerFetch).toHaveBeenCalledTimes(1);
  const publications = await t.run(async (ctx) => ({
    posts: await ctx.db.query("forumPosts").take(1),
    issues: await ctx.db.query("newsletterIssues").take(1),
  }));
  expect(publications).toEqual({ posts: [], issues: [] });
});
