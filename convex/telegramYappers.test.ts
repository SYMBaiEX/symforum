// @vitest-environment node
/// <reference types="vite/client" />
import agentTest from "@convex-dev/agent/test";
import workflowTest from "@convex-dev/workflow/test";
import { register as registerLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import { yapSlot, YAPPERS_FOLLOWUP_DELAY_MS } from "../lib/telegram-yappers";
const modules = import.meta.glob("./**/*.ts");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-27T16:10:00Z"));
  for (const [key, value] of Object.entries({
    TELEGRAM_AGENTS_ENABLED: "true",
    ELIZA_RUNTIME_MODE: "live",
    TELEGRAM_YAPPERS_ENABLED: "true",
    TELEGRAM_YAPPERS_TOPIC_ID: "296",
    OPENROUTER_API_KEY: "synthetic-key",
    OPENROUTER_DAILY_BUDGET_USD: "0.75",
    ELIZA_RUNTIME_WORKER_URL: "https://eliza-worker.example",
    ELIZA_RUNTIME_WORKER_SECRET: "synthetic-live-secret-at-least-32-characters",
  }))
    vi.stubEnv(key, value);
  vi.stubEnv(
    "TELEGRAM_AGENT_BOTS",
    JSON.stringify({
      suki: {
        token: `123456789:${"a".repeat(35)}`,
        username: "symbaiex_suki_bot",
      },
      nyx: {
        token: `987654321:${"b".repeat(35)}`,
        username: "symbaiex_nyx_bot",
      },
    }),
  );
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
async function setup() {
  const t = convexTest(schema, modules);
  agentTest.register(t);
  workflowTest.register(t);
  registerLimiter(t);
  await t.run(async (ctx) => {
    for (const slug of ["suki", "nyx"]) {
      const userId = await ctx.db.insert("users", {
        name: slug,
        isAgent: true,
        agentSlug: slug,
      });
      await ctx.db.insert("forumAgents", {
        slug,
        name: slug,
        userId,
        persona: "Public software and AI participant",
        model: "openai/gpt-6-luna",
        enabled: true,
        dailyPostTarget: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
  });
  return t;
}

function transport(timeout = false) {
  const envelopes: Array<{ stage: string; body: unknown }> = [];
  const sends: Record<string, unknown>[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("getWebhookInfo"))
        return Response.json({
          ok: true,
          result: {
            url: `https://strong-bee-384.convex.site/telegram/agents/${url.includes("123456789") ? "suki" : "nyx"}`,
          },
        });
      if (url.endsWith("getChatMember"))
        return Response.json({ ok: true, result: { status: "member" } });
      if (url.endsWith("getMe"))
        return Response.json({
          ok: true,
          result: {
            id: url.includes("123456789") ? 123456789 : 987654321,
            can_join_groups: true,
            can_read_all_group_messages: false,
          },
        });
      if (url.endsWith("sendMessage")) {
        sends.push(JSON.parse(String(init?.body)));
        if (timeout) throw Error("synthetic timeout");
        return Response.json({
          ok: true,
          result: { message_id: 100 + sends.length, message_thread_id: 296 },
        });
      }
      if (url === "https://eliza-worker.example/complete") {
        const e = JSON.parse(String(init?.body));
        envelopes.push(e);
        const output = e.stage.endsWith("evidence-review")
          ? { approved: true, issues: [] }
          : {
              text: sends.length
                ? "A minimal reproduction makes that easier to verify."
                : "A useful bug report includes the expected result. What helps you reproduce a bug?",
            };
        return Response.json({
          version: 2,
          jobId: e.jobId,
          inputHash: e.inputHash,
          agentSlug: e.agentSlug,
          stage: e.stage,
          runtimeVersion: "1.7.2",
          completion: {
            id: "synthetic",
            object: "chat.completion",
            created: Math.floor(Date.now() / 1000),
            model: "openai/gpt-6-luna",
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: JSON.stringify(output) },
                finish_reason: "stop",
              },
            ],
            usage: {
              prompt_tokens: 100,
              completion_tokens: 30,
              total_tokens: 130,
            },
          },
        });
      }
      throw Error("Unexpected endpoint");
    }),
  );
  return { envelopes, sends };
}

test("Chicago schedule follows DST and rejects night/unscheduled times", () => {
  expect(yapSlot(Date.parse("2026-10-27T16:10:00Z"))).toEqual({
    day: "2026-10-27",
    round: 0,
  });
  expect(yapSlot(Date.parse("2026-12-01T17:10:00Z"))).toEqual({
    day: "2026-12-01",
    round: 0,
  });
  expect(yapSlot(Date.parse("2026-10-27T22:10:00Z"))?.round).toBe(1);
  expect(yapSlot(Date.parse("2026-10-27T17:10:00Z"))).toBeNull();
  expect(yapSlot(Date.parse("2026-10-28T04:00:00Z"), true)).toBeNull();
});

test("two once-only rounds share a four-post cap; only confirmed public posts reach a different agent", async () => {
  const t = await setup();
  const { envelopes, sends } = transport();
  const opener = await t.mutation(internal.telegramYappers.start, {});
  expect(opener).not.toBeNull();
  expect(
    await t.mutation(internal.telegramYappers.start, { kickoff: true }),
  ).toBeNull();
  await t.action(internal.telegramAgentReply.respond, { requestId: opener! });
  expect(
    await t.mutation(internal.telegramYappers.followup, { requestId: opener! }),
  ).toBeNull();
  vi.setSystemTime(Date.now() + YAPPERS_FOLLOWUP_DELAY_MS);
  const follow = await t.mutation(internal.telegramYappers.followup, {
    requestId: opener!,
  });
  expect(follow).not.toBeNull();
  const a = await t.run((ctx) => ctx.db.get("telegramAgentRequests", opener!));
  const b = await t.run((ctx) => ctx.db.get("telegramAgentRequests", follow!));
  expect(a?.agentSlug).not.toBe(b?.agentSlug);
  expect(a?.conversationId).toBe(b?.conversationId);
  await t.action(internal.telegramAgentReply.respond, { requestId: follow! });
  expect(JSON.stringify(envelopes[2].body)).toContain(
    "A useful bug report includes the expected result",
  );
  expect(
    await t.mutation(internal.telegramYappers.followup, { requestId: follow! }),
  ).toBeNull();
  expect(
    await t.mutation(internal.telegramYappers.followup, { requestId: opener! }),
  ).toBeNull();
  vi.setSystemTime(new Date("2026-10-27T22:10:00Z"));
  const second = await t.mutation(internal.telegramYappers.start, {});
  await t.action(internal.telegramAgentReply.respond, { requestId: second! });
  vi.setSystemTime(Date.now() + YAPPERS_FOLLOWUP_DELAY_MS);
  const last = await t.mutation(internal.telegramYappers.followup, {
    requestId: second!,
  });
  await t.action(internal.telegramAgentReply.respond, { requestId: last! });
  await t.action(internal.telegramAgentReply.respond, { requestId: last! });
  expect(sends).toHaveLength(4);
  expect(envelopes).toHaveLength(8);
  for (const send of sends) {
    expect(send).toMatchObject({
      chat_id: "-1004387387301",
      message_thread_id: 296,
      disable_notification: true,
    });
    expect(send).not.toHaveProperty("reply_parameters");
  }
  const rows = await t.query(internal.telegramYappers.inspect, {});
  expect(rows).toHaveLength(4);
  expect(rows.every((r) => r.status === "sent")).toBe(true);
});

test("uncertain send holds without replay or follow-up", async () => {
  const t = await setup();
  const { sends } = transport(true);
  const requestId = await t.mutation(internal.telegramYappers.start, {});
  await t.action(internal.telegramAgentReply.respond, {
    requestId: requestId!,
  });
  await t.action(internal.telegramAgentReply.respond, {
    requestId: requestId!,
  });
  vi.setSystemTime(Date.now() + YAPPERS_FOLLOWUP_DELAY_MS);
  expect(
    await t.mutation(internal.telegramYappers.followup, {
      requestId: requestId!,
    }),
  ).toBeNull();
  expect(sends).toHaveLength(1);
  expect(
    (await t.query(internal.telegramYappers.inspect, {}))[0],
  ).toMatchObject({ status: "held", reason: "delivery_unconfirmed" });
});

test("switches, destination changes and expiry block generation; webhook admission cannot create yaps", async () => {
  const t = await setup();
  const { envelopes, sends } = transport();
  const requestId = await t.mutation(internal.telegramYappers.start, {});
  vi.stubEnv("TELEGRAM_YAPPERS_TOPIC_ID", "0");
  await t.action(internal.telegramAgentReply.respond, {
    requestId: requestId!,
  });
  expect(envelopes).toHaveLength(0);
  expect(sends).toHaveLength(0);
  vi.stubEnv("TELEGRAM_YAPPERS_TOPIC_ID", "296");
  vi.setSystemTime(Date.now() + 9 * 60_000);
  await t.mutation(internal.telegramYappers.expire, { requestId: requestId! });
  expect((await t.query(internal.telegramYappers.inspect, {}))[0].status).toBe(
    "held",
  );
  expect(
    await t.mutation(internal.telegramAgents.accept, {
      agentSlug: "suki",
      botId: "123456789",
      updateId: 7,
      messageId: 2,
      topicId: 296,
      senderId: "101",
      text: "hello",
      kind: "yap",
    }),
  ).toBe(false);
  vi.stubEnv("TELEGRAM_YAPPERS_ENABLED", "false");
  vi.setSystemTime(new Date("2026-10-27T22:10:00Z"));
  expect(await t.mutation(internal.telegramYappers.start, {})).toBeNull();
});
