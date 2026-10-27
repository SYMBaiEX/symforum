// @vitest-environment node
/// <reference types="vite/client" />
import agentTest from "@convex-dev/agent/test";
import workflowTest from "@convex-dev/workflow/test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import { telegramWebhookSecret } from "../lib/telegram-agent-policy";
import { TELEGRAM_AGENT_SLUGS } from "../lib/telegram-agent-policy";
import { telegramVoice } from "./telegramAgentReply";

const modules = import.meta.glob("./**/*.ts");
const request = {
  agentSlug: "suki",
  botId: "123456789",
  updateId: 1,
  messageId: 2,
  topicId: 20,
  senderId: "10001",
  text: "Hi Suki",
  kind: "ask" as const,
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("TELEGRAM_AGENTS_ENABLED", "true");
  vi.stubEnv("ELIZA_RUNTIME_MODE", "live");
  vi.stubEnv(
    "TELEGRAM_AGENT_BOTS",
    JSON.stringify({
      suki: {
        token: `123456789:${"a".repeat(35)}`,
        username: "symbaiex_suki_bot",
      },
    }),
  );
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
async function setup() {
  const t = convexTest(schema, modules);
  agentTest.register(t);
  workflowTest.register(t);
  registerRateLimiter(t);
  await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      name: "Suki",
      isAgent: true,
      agentSlug: "suki",
    });
    await ctx.db.insert("forumAgents", {
      slug: "suki",
      name: "Suki",
      userId,
      persona: "Forum scout",
      model: "openai/gpt-6-luna",
      enabled: true,
      dailyPostTarget: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });
  return t;
}

describe("Telegram durable admission and delivery", () => {
  test("all existing personas retain their configured voice, including NyX's dedicated profile", () => {
    for (const slug of TELEGRAM_AGENT_SLUGS)
      expect(typeof telegramVoice(slug)).toBe("string");
    expect(telegramVoice("nyx")).toContain("evidence-first");
  });
  test("webhook authentication precedes admission and valid duplicate deliveries remain idempotent", async () => {
    const t = await setup();
    const payload = JSON.stringify({
      update_id: 1,
      message: {
        message_id: 2,
        message_thread_id: 20,
        date: Math.floor(Date.now() / 1000),
        chat: { id: -1004387387301, type: "supergroup" },
        from: { id: 10001, is_bot: false },
        text: "/help@symbaiex_suki_bot",
      },
    });
    const headers = {
      "content-type": "application/json",
      "x-telegram-bot-api-secret-token": "wrong",
    };
    expect(
      (
        await t.fetch("/telegram/agents/suki", {
          method: "POST",
          body: payload,
          headers,
        })
      ).status,
    ).toBe(404);
    expect(
      await t.run((ctx) => ctx.db.query("telegramAgentRequests").take(1)),
    ).toHaveLength(0);
    headers["x-telegram-bot-api-secret-token"] = await telegramWebhookSecret(
      `123456789:${"a".repeat(35)}`,
    );
    expect(
      (
        await t.fetch("/telegram/agents/suki", {
          method: "POST",
          body: payload,
          headers,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await t.fetch("/telegram/agents/suki", {
          method: "POST",
          body: payload,
          headers,
        })
      ).status,
    ).toBe(200);
    expect(
      await t.run((ctx) => ctx.db.query("telegramAgentRequests").take(5)),
    ).toHaveLength(1);
  });
  test("uses the real Agent and Eliza transport for reviewed, metered, topic-preserving delivery exactly once", async () => {
    const t = await setup();
    vi.stubEnv("OPENROUTER_API_KEY", "synthetic-provider-key");
    vi.stubEnv("OPENROUTER_DAILY_BUDGET_USD", "0.75");
    vi.stubEnv("ELIZA_RUNTIME_WORKER_URL", "https://eliza-worker.example");
    vi.stubEnv(
      "ELIZA_RUNTIME_WORKER_SECRET",
      "synthetic-live-secret-at-least-32-characters",
    );
    const calls: string[] = [];
    const mockFetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) === "https://eliza-worker.example/complete") {
          const envelope = JSON.parse(String(init?.body));
          calls.push(envelope.stage);
          expect(envelope.agentSlug).toBe("suki");
          expect(envelope.body.model).toBe("openai/gpt-6-luna");
          const output = envelope.stage.endsWith("evidence-review")
            ? { approved: true, issues: [] }
            : { text: "Hello! Welcome to SYMBaiEX Forum." };
          return Response.json({
            version: 2,
            jobId: envelope.jobId,
            inputHash: envelope.inputHash,
            agentSlug: envelope.agentSlug,
            stage: envelope.stage,
            runtimeVersion: "1.7.2",
            completion: {
              id: "synthetic-completion",
              object: "chat.completion",
              created: Math.floor(Date.now() / 1000),
              model: "openai/gpt-6-luna",
              choices: [
                {
                  index: 0,
                  message: {
                    role: "assistant",
                    content: JSON.stringify(output),
                  },
                  finish_reason: "stop",
                },
              ],
              usage: {
                prompt_tokens: 100,
                completion_tokens: 20,
                total_tokens: 120,
              },
            },
          });
        }
        expect(String(input).endsWith("/sendMessage")).toBe(true);
        expect(JSON.parse(String(init?.body))).toMatchObject({
          chat_id: "-1004387387301",
          message_thread_id: 20,
          reply_parameters: { message_id: 2 },
          text: "Hello! Welcome to SYMBaiEX Forum.",
        });
        return Response.json({ ok: true, result: { message_id: 88 } });
      },
    );
    vi.stubGlobal("fetch", mockFetch);
    await t.mutation(internal.telegramAgents.accept, request);
    const [row] = await t.run((ctx) =>
      ctx.db.query("telegramAgentRequests").take(1),
    );
    await t.action(internal.telegramAgentReply.respond, { requestId: row._id });
    expect(
      await t.query(internal.telegramAgents.inspect, { agentSlug: "suki" }),
    ).toMatchObject([{ status: "sent", messageId: 88 }]);
    expect(calls).toEqual([
      "suki:telegram-reply",
      "suki:telegram-evidence-review",
    ]);
    expect(
      await t.run((ctx) => ctx.db.query("elizaRuntimeCalls").take(5)),
    ).toHaveLength(2);
    expect(
      await t.run((ctx) => ctx.db.query("forumThreads").take(1)),
    ).toHaveLength(0);
    const previousCalls = mockFetch.mock.calls.length;
    await t.action(internal.telegramAgentReply.respond, { requestId: row._id });
    expect(mockFetch).toHaveBeenCalledTimes(previousCalls);
  });
  test("duplicate webhook delivery creates one workflow and one conversation", async () => {
    const t = await setup();
    expect(await t.mutation(internal.telegramAgents.accept, request)).toBe(
      true,
    );
    expect(await t.mutation(internal.telegramAgents.accept, request)).toBe(
      false,
    );
    expect(
      await t.run((ctx) => ctx.db.query("telegramAgentRequests").take(10)),
    ).toHaveLength(1);
    expect(
      await t.run((ctx) => ctx.db.query("telegramAgentConversations").take(10)),
    ).toHaveLength(1);
  });
  test("topics and members get separate histories; unaddressed content is not ingested", async () => {
    const t = await setup();
    await t.mutation(internal.telegramAgents.accept, request);
    await t.mutation(internal.telegramAgents.accept, {
      ...request,
      updateId: 2,
      topicId: 21,
    });
    await t.mutation(internal.telegramAgents.accept, {
      ...request,
      updateId: 3,
      senderId: "10002",
    });
    const rows = await t.run((ctx) =>
      ctx.db.query("telegramAgentConversations").take(10),
    );
    expect(new Set(rows.map((r) => r.threadId)).size).toBe(3);
  });
  test("delivery intent can be claimed once and an uncertain send is never replayed", async () => {
    const t = await setup();
    await t.mutation(internal.telegramAgents.accept, {
      ...request,
      kind: "help",
    });
    const [row] = await t.run((ctx) =>
      ctx.db.query("telegramAgentRequests").take(1),
    );
    expect(
      await t.mutation(internal.telegramAgents.claim, { requestId: row._id }),
    ).toBe(true);
    expect(
      await t.mutation(internal.telegramAgents.claim, { requestId: row._id }),
    ).toBe(false);
    await t.mutation(internal.telegramAgents.ready, {
      requestId: row._id,
      name: "Suki",
      text: "Hello",
    });
    expect(
      await t.mutation(internal.telegramAgents.claimDelivery, {
        requestId: row._id,
      }),
    ).toBe(true);
    expect(
      await t.mutation(internal.telegramAgents.claimDelivery, {
        requestId: row._id,
      }),
    ).toBe(false);
    await t.mutation(internal.telegramAgents.finish, {
      requestId: row._id,
      reason: "delivery_unconfirmed",
    });
    expect(
      await t.mutation(internal.telegramAgents.claimDelivery, {
        requestId: row._id,
      }),
    ).toBe(false);
    const current = await t.run((ctx) =>
      ctx.db.get("telegramAgentRequests", row._id),
    );
    expect(current).toMatchObject({ status: "held" });
    expect(current?.prompt).toBeUndefined();
    expect(current?.reply).toBeUndefined();
  });
  test("disabling the integration or persona prevents admission", async () => {
    const t = await setup();
    vi.stubEnv("TELEGRAM_AGENTS_ENABLED", "false");
    expect(await t.mutation(internal.telegramAgents.accept, request)).toBe(
      false,
    );
    vi.stubEnv("TELEGRAM_AGENTS_ENABLED", "true");
    await t.run(async (ctx) => {
      const a = await ctx.db
        .query("forumAgents")
        .withIndex("by_slug", (q) => q.eq("slug", "suki"))
        .unique();
      await ctx.db.patch("forumAgents", a!._id, { enabled: false });
    });
    expect(await t.mutation(internal.telegramAgents.accept, request)).toBe(
      false,
    );
  });
});
