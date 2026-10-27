// @vitest-environment node
/// <reference types="vite/client" />
import agentTest from "@convex-dev/agent/test";
import { createThread, saveMessages } from "@convex-dev/agent";
import { components } from "./_generated/api";
import workflowTest from "@convex-dev/workflow/test";
import { register as registerLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import {
  yapSlot,
  legacyYapSlot,
  YAPPERS_INTERVAL_MS,
  YAPPERS_FOLLOWUP_DELAY_MS,
} from "../lib/telegram-yappers";
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
          result: {
            message_id: 100 + sends.length,
            message_thread_id: 296,
            chat: { id: -1004387387301 },
          },
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

test("half-hour slots run all night and survive Chicago DST repeats", () => {
  const start = Date.parse("2026-10-27T16:10:00Z");
  expect(yapSlot(start).round).toBe(Math.floor(start / YAPPERS_INTERVAL_MS));
  expect(yapSlot(start + YAPPERS_INTERVAL_MS).round).toBe(
    yapSlot(start).round + 1,
  );
  expect(yapSlot(Date.parse("2026-10-28T04:00:00Z")).day).toBe("2026-10-27");
  const before = yapSlot(Date.parse("2026-11-01T06:30:00Z"));
  const after = yapSlot(Date.parse("2026-11-01T07:30:00Z"));
  expect(after.day).toBe(before.day);
  expect(after.round).toBe(before.round + 2);
  expect(legacyYapSlot(start)?.round).toBe(0);
});

test("four short turns alternate speakers, share confirmed context and stop without a fifth reply", async () => {
  const t = await setup();
  const { envelopes, sends } = transport();
  await t.run(async (ctx) => {
    const privateThread = await createThread(ctx, components.agent, {});
    await saveMessages(ctx, components.agent, {
      threadId: privateThread,
      messages: [
        { role: "user", content: "PRIVATE_MEMBER_HISTORY" },
        { role: "assistant", content: "PRIVATE_REPLY" },
      ],
    });
  });
  const started = Date.now();
  const ids = [(await t.mutation(internal.telegramYappers.start, {}))!];
  expect(ids[0]).not.toBeNull();
  expect(
    await t.mutation(internal.telegramYappers.start, { kickoff: true }),
  ).toBeNull();
  for (let turn = 0; turn < 4; turn++) {
    await t.action(internal.telegramAgentReply.respond, {
      requestId: ids[turn],
    });
    expect(
      await t.mutation(internal.telegramYappers.followup, {
        requestId: ids[turn],
      }),
    ).toBeNull();
    vi.setSystemTime(Date.now() + YAPPERS_FOLLOWUP_DELAY_MS);
    const next = await t.mutation(internal.telegramYappers.followup, {
      requestId: ids[turn],
    });
    if (turn < 3) {
      expect(next).not.toBeNull();
      ids.push(next!);
    } else expect(next).toBeNull();
    expect(
      await t.mutation(internal.telegramYappers.followup, {
        requestId: ids[turn],
      }),
    ).toBeNull();
  }
  const rows = await t.run(
    async (ctx) =>
      await Promise.all(
        ids.map((id) => ctx.db.get("telegramAgentRequests", id)),
      ),
  );
  expect(rows.map((r) => r?.status)).toEqual(["sent", "sent", "sent", "sent"]);
  expect(rows[0]?.agentSlug).toBe(rows[2]?.agentSlug);
  expect(rows[1]?.agentSlug).toBe(rows[3]?.agentSlug);
  expect(rows[0]?.agentSlug).not.toBe(rows[1]?.agentSlug);
  expect(new Set(rows.map((r) => r?.conversationId)).size).toBe(1);
  expect(sends).toHaveLength(4);
  expect(envelopes).toHaveLength(8);
  expect(JSON.stringify(envelopes[3])).toContain("confirmedPublicRound");
  expect(JSON.stringify(envelopes[3])).toContain(
    "A useful bug report includes the expected result",
  );
  expect(JSON.stringify(envelopes[6])).toContain("final turn");
  expect(JSON.stringify(envelopes)).not.toContain("PRIVATE_");
  for (const send of sends)
    expect(send).toMatchObject({
      chat_id: "-1004387387301",
      message_thread_id: 296,
      disable_notification: true,
    });
  vi.setSystemTime(started + YAPPERS_INTERVAL_MS - 1);
  expect(await t.mutation(internal.telegramYappers.start, {})).toBeNull();
  vi.setSystemTime(started + YAPPERS_INTERVAL_MS + 1);
  expect(await t.mutation(internal.telegramYappers.start, {})).not.toBeNull();
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

test("a confirmed late-night opener can finish its one follow-up after Chicago midnight", async () => {
  const t = await setup();
  const { sends } = transport();
  vi.setSystemTime(new Date("2026-10-28T04:58:00Z"));
  const opener = (await t.mutation(internal.telegramYappers.start, {}))!;
  await t.action(internal.telegramAgentReply.respond, { requestId: opener });
  vi.setSystemTime(Date.now() + YAPPERS_FOLLOWUP_DELAY_MS);
  const followup = (await t.mutation(internal.telegramYappers.followup, {
    requestId: opener,
  }))!;
  expect(followup).not.toBeNull();
  await t.action(internal.telegramAgentReply.respond, { requestId: followup });
  expect(sends).toHaveLength(2);
  const [a, b] = await t.run(async (ctx) => [
    await ctx.db.get("telegramAgentRequests", opener),
    await ctx.db.get("telegramAgentRequests", followup),
  ]);
  expect(a?.conversationId).toBe(b?.conversationId);
  expect(a?.yapDay).toBe("2026-10-27");
  expect(
    (await t.query(internal.telegramYappers.inspect, {})).every(
      (r) => r.status === "sent",
    ),
  ).toBe(true);
});

test("a new schedule never reopens or follows a held legacy round", async () => {
  const t = await setup();
  const legacy = await t.run((ctx) =>
    ctx.db.insert("telegramAgentRequests", {
      key: "yap:2026-10-27:0:1",
      agentSlug: "nyx",
      botId: "987654321",
      updateId: 1,
      messageId: 0,
      topicId: 296,
      senderId: "autonomous-yappers",
      conversationId: "legacy-held-thread",
      kind: "yap",
      yapDay: "2026-10-27",
      yapRound: 0,
      yapTurn: 1,
      status: "held",
      reason: "review_rejected",
      createdAt: Date.now() - 60_000,
      updatedAt: Date.now() - 60_000,
    }),
  );
  const fresh = await t.mutation(internal.telegramYappers.start, {});
  expect(fresh).not.toBeNull();
  expect(
    await t.mutation(internal.telegramAgents.claim, { requestId: legacy }),
  ).toBe(false);
  expect(
    await t.mutation(internal.telegramYappers.followup, { requestId: legacy }),
  ).toBeNull();
  const old = await t.run((ctx) => ctx.db.get("telegramAgentRequests", legacy));
  expect(old).toMatchObject({
    key: "yap:2026-10-27:0:1",
    status: "held",
    reason: "review_rejected",
  });
});

test("slow turns cannot extend a conversation beyond its 25-minute window", async () => {
  const t = await setup();
  const { sends } = transport();
  const start = Date.now();
  const opener = (await t.mutation(internal.telegramYappers.start, {}))!;
  vi.setSystemTime(start + 7 * 60_000);
  await t.action(internal.telegramAgentReply.respond, { requestId: opener });
  vi.setSystemTime(start + 13 * 60_000);
  const child = (await t.mutation(internal.telegramYappers.followup, {
    requestId: opener,
  }))!;
  expect(child).not.toBeNull();
  vi.setSystemTime(start + 20 * 60_000);
  await t.action(internal.telegramAgentReply.respond, { requestId: child });
  vi.setSystemTime(start + 26 * 60_000);
  expect(
    await t.mutation(internal.telegramYappers.followup, { requestId: child }),
  ).toBeNull();
  expect(sends).toHaveLength(2);
});

test("a held middle reply stops the chain and cannot be skipped or resent", async () => {
  const t = await setup();
  transport();
  const opener = (await t.mutation(internal.telegramYappers.start, {}))!;
  await t.action(internal.telegramAgentReply.respond, { requestId: opener });
  vi.setSystemTime(Date.now() + YAPPERS_FOLLOWUP_DELAY_MS);
  const child = (await t.mutation(internal.telegramYappers.followup, {
    requestId: opener,
  }))!;
  const { sends } = transport(true);
  await t.action(internal.telegramAgentReply.respond, { requestId: child });
  await t.action(internal.telegramAgentReply.respond, { requestId: child });
  vi.setSystemTime(Date.now() + YAPPERS_FOLLOWUP_DELAY_MS);
  expect(
    await t.mutation(internal.telegramYappers.followup, { requestId: child }),
  ).toBeNull();
  expect(
    await t.mutation(internal.telegramYappers.followup, { requestId: opener }),
  ).toBeNull();
  expect(sends).toHaveLength(1);
});

test("an in-flight v2 round keeps its original single 20-minute follow-up", async () => {
  const t = await setup();
  const { sends } = transport();
  const opener = (await t.mutation(internal.telegramYappers.start, {}))!;
  await t.run(async (ctx) => {
    const row = (await ctx.db.get("telegramAgentRequests", opener))!;
    await ctx.db.patch("telegramAgentRequests", opener, {
      key: `yap2:${row.yapRound}:0`,
      yapVersion: 2,
      yapRoundStartedAt: undefined,
    });
  });
  await t.action(internal.telegramAgentReply.respond, { requestId: opener });
  vi.setSystemTime(Date.now() + YAPPERS_FOLLOWUP_DELAY_MS);
  expect(
    await t.mutation(internal.telegramYappers.followup, { requestId: opener }),
  ).toBeNull();
  vi.setSystemTime(Date.now() + 14 * 60_000);
  const child = (await t.mutation(internal.telegramYappers.followup, {
    requestId: opener,
  }))!;
  expect(child).not.toBeNull();
  await t.action(internal.telegramAgentReply.respond, { requestId: child });
  vi.setSystemTime(Date.now() + YAPPERS_FOLLOWUP_DELAY_MS);
  expect(
    await t.mutation(internal.telegramYappers.followup, { requestId: child }),
  ).toBeNull();
  expect(sends).toHaveLength(2);
});
