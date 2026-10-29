// @vitest-environment node
/// <reference types="vite/client" />
import agentTest from "@convex-dev/agent/test";
import { listMessages, saveMessages } from "@convex-dev/agent";
import workflowTest from "@convex-dev/workflow/test";
import { register } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import sharp from "sharp";
import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { components, internal } from "./_generated/api";
import schema from "./schema";
import { MEME_INTERVAL_MS } from "../lib/telegram-memes";
import {
  normalizeMemeText,
  MEME_REVIEW_INSTRUCTIONS,
} from "../lib/telegram-meme-library";
const modules = import.meta.glob("./**/*.ts");
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse("2026-10-28T07:00:00Z"));
  for (const [key, value] of Object.entries({
    TELEGRAM_MEMES_PIPELINE_VERSION: "2",
    TELEGRAM_MEMES_ENABLED: "true",
    TELEGRAM_MEMES_TOPIC_ID: "13",
    TELEGRAM_AGENTS_ENABLED: "true",
    ELIZA_RUNTIME_MODE: "live",
    OPENROUTER_API_KEY: "synthetic-key",
    OPENROUTER_DAILY_BUDGET_USD: "0.75",
    ELIZA_RUNTIME_WORKER_URL: "https://eliza-worker.example",
    ELIZA_RUNTIME_WORKER_SECRET: "synthetic-live-secret-at-least-32-characters",
    TELEGRAM_AGENT_BOTS: JSON.stringify({
      belle: {
        token: `123456789:${"a".repeat(35)}`,
        username: "symbaiex_belle_bot",
      },
    }),
  }))
    vi.stubEnv(key, value);
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
async function setup(reserves = true) {
  const t = convexTest(schema, modules);
  agentTest.register(t);
  workflowTest.register(t);
  register(t);
  const image = await sharp({
    create: { width: 512, height: 512, channels: 3, background: "blue" },
  })
    .png()
    .toBuffer();
  await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      name: "Belle",
      isAgent: true,
      agentSlug: "belle",
    });
    await ctx.db.insert("forumAgents", {
      slug: "belle",
      name: "Belle",
      userId,
      persona: "warm culture correspondent",
      model: "openai/gpt-6-luna",
      enabled: true,
      dailyPostTarget: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const storageId = await ctx.storage.store(
      new Blob([Uint8Array.from(image)], { type: "image/png" }),
    );
    await ctx.db.insert("telegramMemeConfig", { key: "belle", storageId });
    if (reserves)
      for (let i = 0; i < 3; i++)
        await ctx.db.insert("telegramMemeAssets", {
          key: `reserve:test:${i}`,
          kind: "reserve",
          media: i === 2 ? "animation" : "photo",
          storageId,
          text: `TOP: prepared joke ${i}\nBOTTOM: safe punchline`,
          lastUsedAt: 0,
          createdAt: Date.now(),
          ...(i === 2
            ? {
                sourceName: "Classic GIF via Memegen",
                sourceUrl: "https://memegen.link/",
              }
            : {}),
        });
  });
  return { t, image };
}
function transport(
  image: Uint8Array,
  options: {
    approved?: boolean;
    issues?: string[];
    unknownSend?: boolean;
    code?: number;
    wrongTopic?: boolean;
    badInstallation?: boolean;
    invalidCaption?: boolean;
  } = {},
) {
  const calls: Array<{ stage: string; body: unknown }> = [],
    sends: Record<string, unknown>[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("getWebhookInfo"))
        return Response.json({
          ok: true,
          result: {
            url: "https://convex.test/telegram/agents/belle",
          },
        });
      if (url.endsWith("getChatMember"))
        return Response.json({
          ok: true,
          result: {
            status: options.badInstallation ? "administrator" : "member",
          },
        });
      if (url.endsWith("getMe"))
        return Response.json({
          ok: true,
          result: {
            id: 123456789,
            can_join_groups: true,
            can_read_all_group_messages: false,
          },
        });
      if (/send(Photo|Animation)$/.test(url)) {
        sends.push(JSON.parse(String(init?.body)));
        if (options.unknownSend) throw Error("synthetic timeout");
        if (options.code && sends.length === 1)
          return Response.json(
            {
              ok: false,
              error_code: options.code,
              parameters: { retry_after: 10 },
            },
            { status: options.code },
          );
        return Response.json({
          ok: true,
          result: {
            message_id: 400 + sends.length,
            message_thread_id: options.wrongTopic ? 9 : 13,
            chat: { id: -1004387387301 },
            photo: [{ file_id: "cached-photo" }],
            animation: { file_id: "cached-animation" },
          },
        });
      }
      if (url === "https://eliza-worker.example/complete") {
        const e = JSON.parse(String(init?.body));
        calls.push(e);
        const output = e.stage.endsWith("evidence-review")
          ? { approved: options.approved ?? true, issues: options.issues ?? [] }
          : {
              text: options.invalidCaption
                ? "bad formatting"
                : "TOP: The agent said ‘quick fix’\nBOTTOM: Six new dependencies later",
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
      return new Response(Uint8Array.from(image), {
        headers: { "Content-Type": "image/png" },
      });
    }),
  );
  return { calls, sends };
}
async function start(
  t: Awaited<ReturnType<typeof setup>>["t"],
  mode?: "original" | "template" | "recycle",
) {
  const id = (await t.mutation(internal.telegramMemes.start, {}))!;
  expect(id).not.toBeNull();
  if (mode)
    await t.run((ctx) =>
      ctx.db.patch("telegramAgentRequests", id, { memeMode: mode }),
    );
  return id;
}
test("legacy assistant-only history stays bounded and new confirmed memes start fresh orders", async () => {
  const { t, image } = await setup(),
    io = transport(image);
  const id = await start(t, "original");
  const threadId = (await t.run((ctx) =>
    ctx.db.get("telegramAgentRequests", id),
  ))!.conversationId;
  await t.run(async (ctx) => {
    for (let n = 0; n < 70; n++)
      await saveMessages(ctx, components.agent, {
        threadId,
        agentName: "Belle",
        messages: [
          {
            role: "assistant",
            content: `TOP: old joke ${n}\nBOTTOM: old punchline ${n}`,
          },
        ],
      });
  });
  await t.action(internal.telegramMemeComposer.prepare, { requestId: id });
  const generation = io.calls.find((c) => c.stage === "belle:telegram-reply")!;
  const body = generation.body as {
    messages: { role: string; content: string }[];
  };
  expect(body.messages.length).toBeLessThanOrEqual(8);
  expect(JSON.stringify(body.messages)).toContain("old joke 69");
  expect(JSON.stringify(body.messages)).not.toContain("old joke 0");
  await t.action(internal.telegramMemeDelivery.deliver, { requestId: id });
  expect(io.sends).toHaveLength(1);
  const history = await t.run((ctx) =>
    listMessages(ctx, components.agent, {
      threadId,
      paginationOpts: { numItems: 1, cursor: null },
    }),
  );
  expect(history.page[0].order).toBeGreaterThan(0);
});
test("v2 requires a reserve, admits one 18-minute intent and never reopens legacy holds", async () => {
  const { t } = await setup(false);
  expect(await t.mutation(internal.telegramMemes.start, {})).toBeNull();
  await t.run(async (ctx) => {
    const c = (await ctx.db.query("telegramMemeConfig").first())!;
    await ctx.db.insert("telegramMemeAssets", {
      key: "reserve",
      kind: "reserve",
      media: "photo",
      storageId: c.storageId,
      text: "TOP: hello\nBOTTOM: world",
      lastUsedAt: 0,
      createdAt: Date.now(),
    });
  });
  const id = await start(t);
  await t.mutation(internal.telegramAgents.finish, {
    requestId: id,
    reason: "old hold",
  });
  expect(await t.mutation(internal.telegramMemes.start, {})).toBeNull();
  vi.setSystemTime(Date.now() + MEME_INTERVAL_MS);
  expect(await t.mutation(internal.telegramMemes.start, {})).not.toBeNull();
  expect(
    (await t.query(internal.telegramMemes.inspect, {})).find(
      (r) =>
        r.key ===
        `meme2:${Math.floor((Date.now() - MEME_INTERVAL_MS) / MEME_INTERVAL_MS)}`,
    )?.status,
  ).toBe("held");
});
test("approved review with advisory notes posts normalized comedy, not a factual-answer review", async () => {
  const { t, image } = await setup(),
    io = transport(image, { issues: ["This is corny, but safe"] });
  const id = await start(t, "original");
  await t.action(internal.telegramMemeComposer.prepare, { requestId: id });
  await t.action(internal.telegramMemeDelivery.deliver, { requestId: id });
  expect(io.calls).toHaveLength(2);
  expect(JSON.stringify(io.calls[1])).toContain("NOT a factual answer");
  expect((await t.query(internal.telegramMemes.inspect, {}))[0]).toMatchObject({
    status: "sent",
    mode: "original",
    review: { approved: true, issues: ["This is corny, but safe"] },
  });
  expect(io.sends).toHaveLength(1);
  expect(io.sends[0]).toMatchObject({
    chat_id: "-1004387387301",
    message_thread_id: 13,
    disable_notification: true,
  });
  expect(String(io.sends[0].caption)).toContain("'quick fix'");
  expect(MEME_REVIEW_INSTRUCTIONS).toContain("profanity");
  expect(
    normalizeMemeText("```\nTOP: “hi”\nBOTTOM: I’m fine—really\n```"),
  ).toContain('TOP: "hi"');
});
test.each(["review", "budget", "format"])(
  "%s problems select a prepared image rather than leaving an empty slot",
  async (kind) => {
    const { t, image } = await setup(),
      io = transport(image, {
        approved: kind !== "review",
        issues: kind === "review" ? ["A specific blocking problem"] : [],
        invalidCaption: kind === "format",
      });
    if (kind === "budget")
      vi.stubEnv("OPENROUTER_DAILY_BUDGET_USD", "0.000001");
    const id = await start(t, "original");
    await t.action(internal.telegramMemeComposer.prepare, { requestId: id });
    await t.action(internal.telegramMemeDelivery.deliver, { requestId: id });
    const row = (await t.query(internal.telegramMemes.inspect, {}))[0];
    expect(row).toMatchObject({ status: "sent", mode: "fallback" });
    expect(io.sends).toHaveLength(1);
    expect(String(io.sends[0].caption)).toContain("prepared joke");
    if (kind === "review")
      expect(row.review).toEqual({
        approved: false,
        issues: ["A specific blocking problem"],
      });
  },
);
test("independent deadline wins once; late results and repeated deliveries cannot overwrite or double send", async () => {
  const { t, image } = await setup(),
    io = transport(image);
  const id = await start(t);
  await t.mutation(internal.telegramAgents.claim, { requestId: id });
  vi.setSystemTime(Date.now() + 60_000);
  await t.mutation(internal.telegramMemeData.fallback, {
    requestId: id,
    reason: "composition_deadline",
  });
  const a = (await t.query(internal.telegramMemeData.library, {})).assets[1];
  expect(
    await t.mutation(internal.telegramMemeData.prepareAsset, {
      requestId: id,
      assetId: a._id,
      mode: "original",
    }),
  ).toBe(false);
  await Promise.all([
    t.action(internal.telegramMemeDelivery.deliver, { requestId: id }),
    t.action(internal.telegramMemeDelivery.deliver, { requestId: id }),
  ]);
  expect(io.sends).toHaveLength(1);
  expect((await t.query(internal.telegramMemes.inspect, {}))[0]).toMatchObject({
    status: "sent",
    fallbackReason: "composition_deadline",
  });
});
test("unknown sends remain held and quarantined; the next independent slot can still post", async () => {
  const { t, image } = await setup(),
    io = transport(image, { unknownSend: true });
  const id = await start(t);
  await t.mutation(internal.telegramMemeData.fallback, {
    requestId: id,
    reason: "test",
  });
  await t.action(internal.telegramMemeDelivery.deliver, { requestId: id });
  await t.action(internal.telegramMemeDelivery.deliver, { requestId: id });
  expect(io.sends).toHaveLength(1);
  expect((await t.query(internal.telegramMemes.inspect, {}))[0]).toMatchObject({
    status: "held",
    reason: "delivery_unconfirmed",
  });
  vi.setSystemTime(Date.now() + MEME_INTERVAL_MS);
  const next = await start(t);
  await t.mutation(internal.telegramMemeData.fallback, {
    requestId: next,
    reason: "test",
  });
  const rows = await t.run((ctx) =>
    ctx.db.query("telegramAgentRequests").collect(),
  );
  expect(rows[0].memeAssetId).not.toEqual(rows[1].memeAssetId);
});
test.each([400, 429])(
  "explicit %s is safely retried, but an ambiguous response is not",
  async (code) => {
    const { t, image } = await setup(),
      io = transport(image, { code });
    const id = await start(t);
    await t.mutation(internal.telegramMemeData.fallback, {
      requestId: id,
      reason: "test",
    });
    await t.action(internal.telegramMemeDelivery.deliver, { requestId: id });
    if (code === 429) {
      await t.action(internal.telegramMemeDelivery.deliver, { requestId: id });
      expect(io.sends).toHaveLength(1);
      vi.setSystemTime(Date.now() + 10_000);
    }
    await t.action(internal.telegramMemeDelivery.deliver, { requestId: id });
    expect(io.sends).toHaveLength(2);
    expect((await t.query(internal.telegramMemes.inspect, {}))[0].status).toBe(
      "sent",
    );
    if (code === 400)
      expect(io.sends[0].caption).not.toEqual(io.sends[1].caption);
  },
);
test("cached GIFs preserve credit; confirmed archive reuse needs no inference and respects six hours", async () => {
  const { t, image } = await setup(),
    io = transport(image);
  const id = await start(t);
  const { assets } = await t.query(internal.telegramMemeData.library, {}),
    gif = assets.find((a) => a.media === "animation")!;
  await t.mutation(internal.telegramMemeData.prepareAsset, {
    requestId: id,
    assetId: gif._id,
    mode: "recycle",
  });
  await t.action(internal.telegramMemeDelivery.deliver, { requestId: id });
  expect(io.sends[0]).toHaveProperty("animation");
  expect(io.sends[0].caption).toContain("Memegen");
  const generated = await t.run(async (ctx) =>
    ctx.db.insert("telegramMemeAssets", {
      key: "generated:approved",
      kind: "generated",
      media: "photo",
      telegramFileId: "old-approved",
      text: "TOP: archived\nBOTTOM: still funny",
      lastUsedAt: Date.now() - 7 * 60 * 60_000,
      createdAt: Date.now() - 8 * 60 * 60_000,
    }),
  );
  vi.setSystemTime(Date.now() + MEME_INTERVAL_MS);
  const next = await start(t, "recycle");
  await t.action(internal.telegramMemeComposer.prepare, { requestId: next });
  await t.action(internal.telegramMemeDelivery.deliver, { requestId: next });
  expect(io.calls).toHaveLength(0);
  expect(io.sends[1].photo).toBe("old-approved");
  await t.run((ctx) =>
    ctx.db.patch("telegramMemeAssets", generated, {
      lastUsedAt: Date.now() - 7 * 60 * 60_000,
      lastAttemptedAt: Date.now(),
    }),
  );
  expect(
    (
      await t.query(internal.telegramMemeData.plan, {
        requestId: next,
        now: Date.now(),
      })
    ).recycle?.asset._id,
  ).not.toBe(generated);
});
test.each(["kill", "topic", "disabled", "membership", "wrongResponse"])(
  "%s cannot send into Main Chat or bypass installation checks",
  async (scenario) => {
    const { t, image } = await setup(),
      io = transport(image, {
        badInstallation: scenario === "membership",
        wrongTopic: scenario === "wrongResponse",
      });
    const id = await start(t);
    await t.mutation(internal.telegramMemeData.fallback, {
      requestId: id,
      reason: "test",
    });
    if (scenario === "disabled")
      await t.run(async (ctx) => {
        const a = (await ctx.db.query("forumAgents").first())!;
        await ctx.db.patch("forumAgents", a._id, { enabled: false });
      });
    if (scenario === "kill") vi.stubEnv("TELEGRAM_MEMES_ENABLED", "false");
    if (scenario === "topic") vi.stubEnv("TELEGRAM_MEMES_TOPIC_ID", "9");
    await t.action(internal.telegramMemeDelivery.deliver, { requestId: id });
    expect(io.sends.length).toBe(scenario === "wrongResponse" ? 1 : 0);
    if (scenario === "wrongResponse")
      expect(
        (await t.query(internal.telegramMemes.inspect, {}))[0].status,
      ).toBe("held");
  },
);
test("only confirmed generated blobs are released; held artifacts remain intact", async () => {
  const { t } = await setup();
  const assets = await t.run(async (ctx) => {
    const c = (await ctx.db.query("telegramMemeConfig").first())!;
    return await Promise.all(
      [true, false].map((confirmed) =>
        ctx.db.insert("telegramMemeAssets", {
          key: `generated:${confirmed}`,
          kind: "generated",
          media: "photo",
          storageId: c.storageId,
          telegramFileId: "file",
          text: "TOP: x\nBOTTOM: y",
          lastUsedAt: confirmed ? Date.now() : 0,
          lastAttemptedAt: confirmed ? Date.now() - 1 : Date.now(),
          createdAt: Date.now(),
        }),
      ),
    );
  });
  await t.mutation(internal.telegramMemeData.dropConfirmedBlob, {
    assetId: assets[1],
  });
  expect(
    (await t.run((ctx) => ctx.db.get("telegramMemeAssets", assets[1])))
      ?.storageId,
  ).toBeDefined();
  await t.mutation(internal.telegramMemeData.dropConfirmedBlob, {
    assetId: assets[0],
  });
  expect(
    (await t.run((ctx) => ctx.db.get("telegramMemeAssets", assets[0])))
      ?.storageId,
  ).toBeUndefined();
});
test("unavailable online catalogs keep the installed cache and do not block fallback", async () => {
  const { t, image } = await setup();
  const io = transport(image);
  expect(await t.action(internal.telegramMemeLibrary.refresh, {})).toBe(0);
  const id = await start(t);
  await t.mutation(internal.telegramMemeData.fallback, {
    requestId: id,
    reason: "source_unavailable",
  });
  await t.action(internal.telegramMemeDelivery.deliver, { requestId: id });
  expect(io.sends).toHaveLength(1);
});
test("new captions can use cached online formats, with source credit", async () => {
  const { t, image } = await setup();
  const io = transport(image);
  const templateId = await t.run(async (ctx) => {
    const c = (await ctx.db.query("telegramMemeConfig").first())!;
    return await ctx.db.insert("telegramMemeTemplates", {
      key: "memegen:fry",
      name: "Futurama Fry",
      description: "suspicious squint",
      storageId: c.storageId,
      sourceUrl: "https://memegen.link/#fry",
      rank: 1,
      updatedAt: Date.now(),
    });
  });
  const id = await start(t, "template");
  await t.run((ctx) =>
    ctx.db.patch("telegramAgentRequests", id, { memeTemplateId: templateId }),
  );
  await t.action(internal.telegramMemeComposer.prepare, { requestId: id });
  await t.action(internal.telegramMemeDelivery.deliver, { requestId: id });
  expect((await t.query(internal.telegramMemes.inspect, {}))[0]).toMatchObject({
    status: "sent",
    mode: "template",
  });
  expect(io.sends[0].caption).toContain("Futurama Fry via Memegen");
});
