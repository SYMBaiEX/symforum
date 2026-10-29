import { installationBinding } from "./installation";
import { RateLimiter } from "@convex-dev/rate-limiter";
import { createThread, saveMessages } from "@convex-dev/agent";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import {
  env,
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";
import {
  MEME_INTERVAL_MS,
  MEME_TOPIC_ID,
  memePrompt,
} from "../lib/telegram-memes";
import { telegramBotRegistry } from "../lib/telegram-agent-policy";
import { memesEnabled, validMeme } from "./telegramMemePolicy";
import { telegramWorkflow } from "./telegramAgentWorkflow";
const cadence = new RateLimiter(components.rateLimiter, {
  belleMemeSlotsV2: {
    kind: "token bucket",
    rate: 1,
    period: MEME_INTERVAL_MS,
    capacity: 1,
  },
});
const argsId = { requestId: v.id("telegramAgentRequests") };
const assetInput = {
  key: v.string(),
  kind: v.union(v.literal("reserve"), v.literal("generated")),
  media: v.union(v.literal("photo"), v.literal("animation")),
  storageId: v.id("_storage"),
  text: v.string(),
  sourceUrl: v.optional(v.string()),
  sourceName: v.optional(v.string()),
};
const assetRef = v.object({
  asset: schema.doc("telegramMemeAssets"),
  input: v.union(v.string(), v.null()),
});
async function config(ctx: MutationCtx) {
  return await ctx.db
    .query("telegramMemeConfig")
    .withIndex("by_key", (q) => q.eq("key", "belle"))
    .unique();
}
/** New delivery intents never reopen held requests, including the legacy rejected slot. */
export async function startMemeV2(
  ctx: MutationCtx,
): Promise<Id<"telegramAgentRequests"> | null> {
  if (!memesEnabled()) return null;
  const now = Date.now(),
    slot = Math.floor(now / MEME_INTERVAL_MS),
    key = `meme2:${slot}`;
  const bot = telegramBotRegistry(env.TELEGRAM_AGENT_BOTS).get("belle"),
    c = await config(ctx);
  const agent = await ctx.db
    .query("forumAgents")
    .withIndex("by_slug", (q) => q.eq("slug", "belle"))
    .unique();
  if (!bot || !agent?.enabled || !c) return null;
  const recent = await ctx.db
    .query("telegramAgentRequests")
    .withIndex("by_kind_and_createdAt", (q) => q.eq("kind", "meme"))
    .order("desc")
    .take(12);
  if (
    recent.some(
      (r) =>
        !["sent", "held"].includes(r.status) && now - r.createdAt < 8 * 60_000,
    )
  )
    return null;
  const lastConfirmed = Math.max(
    c.lastConfirmedAt ?? 0,
    ...recent.filter((r) => r.status === "sent").map((r) => r.updatedAt),
  );
  if (lastConfirmed && now - lastConfirmed < 15 * 60_000) return null;
  if (
    await ctx.db
      .query("telegramAgentRequests")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique()
  )
    return null;
  if (
    !(await ctx.db
      .query("telegramMemeAssets")
      .withIndex("by_kind_and_lastUsedAt", (q) => q.eq("kind", "reserve"))
      .first())
  )
    return null;
  if (
    !(
      await cadence.limit(ctx, "belleMemeSlotsV2", {
        key: "community:13:belle",
      })
    ).ok
  )
    return null;
  const threadId =
    c.threadId ??
    (await createThread(ctx, components.agent, {
      title: "Belle public meme captions",
      summary:
        "Confirmed public memes only. No member messages, private chats or moderation history.",
    }));
  const templates = await ctx.db
    .query("telegramMemeTemplates")
    .withIndex("by_rank")
    .take(16);
  const template =
    slot % 5 === 0 || !templates.length
      ? undefined
      : templates[(slot * 7) % templates.length];
  const mode = slot % 5 === 4 ? "recycle" : template ? "template" : "original";
  const requestId = await ctx.db.insert("telegramAgentRequests", {
      installationBinding,
    key,
    agentSlug: "belle",
    botId: bot.id,
    updateId: now,
    messageId: 0,
    topicId: MEME_TOPIC_ID,
    senderId: "autonomous-memes",
    conversationId: threadId,
    kind: "meme",
    memeVersion: 2,
    memeSlot: slot,
    memeMode: mode,
    ...(template ? { memeTemplateId: template._id } : {}),
    prompt: memePrompt(
      slot,
      template,
      templates.slice(0, 8).map((t) => t.name),
    ),
    status: "queued",
    createdAt: now,
    updatedAt: now,
  });
  await ctx.db.patch("telegramMemeConfig", c._id, {
    threadId,
    lastQueuedAt: now,
  });
  await telegramWorkflow.start(ctx, internal.telegramAgentWorkflow.reply, {
    requestId,
  });
  // Independent of the model queue: a cached approved meme fills the same slot.
  await ctx.scheduler.runAfter(60_000, internal.telegramMemeData.fallback, {
    requestId,
    reason: "composition_deadline",
  });
  await ctx.scheduler.runAfter(8 * 60_000, internal.telegramMemes.expire, {
    requestId,
  });
  await ctx.scheduler.runAfter(
    7 * 24 * 60 * 60_000,
    internal.telegramAgents.redact,
    { requestId },
  );
  return requestId;
}
export const library = internalQuery({
  args: {},
  returns: v.object({
    assets: v.array(schema.doc("telegramMemeAssets")),
    templates: v.array(schema.doc("telegramMemeTemplates")),
  }),
  handler: async (ctx) => ({
    assets: [
      ...(await ctx.db
        .query("telegramMemeAssets")
        .withIndex("by_kind_and_lastUsedAt", (q) => q.eq("kind", "reserve"))
        .take(64)),
      ...(await ctx.db
        .query("telegramMemeAssets")
        .withIndex("by_kind_and_lastUsedAt", (q) => q.eq("kind", "generated"))
        .order("desc")
        .take(100)),
    ],
    templates: await ctx.db
      .query("telegramMemeTemplates")
      .withIndex("by_rank")
      .take(24),
  }),
});
export const installAsset = internalMutation({
  args: assetInput,
  returns: v.id("telegramMemeAssets"),
  handler: async (ctx, args) => {
    if (args.key.length > 160 || args.text.length > 700)
      throw Error("invalid_asset");
    const prior = await ctx.db
      .query("telegramMemeAssets")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    if (prior) return prior._id;
    return await ctx.db.insert("telegramMemeAssets", {
      ...args,
      lastUsedAt: 0,
      createdAt: Date.now(),
    });
  },
});
export const installTemplate = internalMutation({
  args: {
    key: v.string(),
    name: v.string(),
    description: v.string(),
    storageId: v.id("_storage"),
    sourceUrl: v.string(),
    rank: v.number(),
  },
  returns: v.id("telegramMemeTemplates"),
  handler: async (ctx, args) => {
    const prior = await ctx.db
      .query("telegramMemeTemplates")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    if (prior) {
      await ctx.db.patch("telegramMemeTemplates", prior._id, {
        rank: args.rank,
        updatedAt: Date.now(),
      });
      return prior._id;
    }
    return await ctx.db.insert("telegramMemeTemplates", {
      ...args,
      updatedAt: Date.now(),
    });
  },
});
export const sourceHealth = internalMutation({
  args: {
    error: v.optional(v.string()),
    ranks: v.optional(v.array(v.object({ key: v.string(), rank: v.number() }))),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if ((args.ranks?.length ?? 0) > 24) throw Error("source_limit");
    for (const rank of args.ranks ?? []) {
      const t = await ctx.db
        .query("telegramMemeTemplates")
        .withIndex("by_key", (q) => q.eq("key", rank.key))
        .unique();
      if (t)
        await ctx.db.patch("telegramMemeTemplates", t._id, {
          rank: rank.rank,
          updatedAt: Date.now(),
        });
    }
    const c = await config(ctx);
    if (c)
      await ctx.db.patch("telegramMemeConfig", c._id, {
        sourceError: args.error,
        sourceRefreshedAt: Date.now(),
      });
    return null;
  },
});
export const plan = internalQuery({
  args: { ...argsId, now: v.number() },
  returns: v.object({
    atlasUrl: v.union(v.string(), v.null()),
    template: v.union(
      v.null(),
      v.object({
        template: schema.doc("telegramMemeTemplates"),
        url: v.union(v.string(), v.null()),
      }),
    ),
    recycle: v.union(assetRef, v.null()),
  }),
  handler: async (ctx, { requestId, now }) => {
    const row = await ctx.db.get("telegramAgentRequests", requestId),
      c = await ctx.db
        .query("telegramMemeConfig")
        .withIndex("by_key", (q) => q.eq("key", "belle"))
        .unique();
    const template = row?.memeTemplateId
      ? await ctx.db.get("telegramMemeTemplates", row.memeTemplateId)
      : null;
    const candidates = await ctx.db
      .query("telegramMemeAssets")
      .withIndex("by_kind_and_lastUsedAt", (q) =>
        q
          .eq("kind", "generated")
          .gte("lastUsedAt", 1)
          .lte("lastUsedAt", now - 6 * 60 * 60_000),
      )
      .take(24);
    const a = candidates.find(
      (a) =>
        a._id !== c?.lastAssetId &&
        (a.lastAttemptedAt ?? 0) <= a.lastUsedAt &&
        (a.telegramFileId || a.storageId),
    );
    const gifs = await ctx.db
      .query("telegramMemeAssets")
      .withIndex("by_kind_and_lastUsedAt", (q) => q.eq("kind", "reserve"))
      .take(64);
    const gif = gifs.find(
      (a) =>
        a.media === "animation" &&
        a._id !== c?.lastAssetId &&
        (a.lastAttemptedAt ?? 0) <= a.lastUsedAt &&
        (a.storageId || a.telegramFileId),
    );
    // Alternate classic GIF picks and the confirmed archive on recycling turns.
    const recycled =
      row?.memeSlot !== undefined && row.memeSlot % 10 === 4
        ? (gif ?? a)
        : (a ?? gif);
    return {
      atlasUrl: c ? await ctx.storage.getUrl(c.storageId) : null,
      template: template
        ? { template, url: await ctx.storage.getUrl(template.storageId) }
        : null,
      recycle: recycled
        ? {
            asset: recycled,
            input:
              recycled.telegramFileId ??
              (recycled.storageId
                ? await ctx.storage.getUrl(recycled.storageId)
                : null),
          }
        : null,
    };
  },
});
export const review = internalMutation({
  args: {
    ...argsId,
    approved: v.boolean(),
    issues: v.array(v.string()),
    draft: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("telegramAgentRequests", args.requestId);
    if (row?.memeVersion === 2 && row.status === "generating")
      await ctx.db.patch("telegramAgentRequests", row._id, {
        memeReview: {
          approved: args.approved,
          issues: args.issues.slice(0, 6).map((s) => s.slice(0, 180)),
        },
        ...(args.approved
          ? {}
          : { memeRejectedDraft: args.draft.slice(0, 700) }),
      });
    return null;
  },
});
async function enqueueDelivery(
  ctx: MutationCtx,
  row: Doc<"telegramAgentRequests">,
  a: Doc<"telegramMemeAssets">,
  mode: "original" | "template" | "recycle" | "fallback",
  reason?: string,
) {
  await ctx.db.patch("telegramAgentRequests", row._id, {
    status: "ready",
    reply: a.text,
    prompt: undefined,
    memeAssetId: a._id,
    memeMode: mode,
    ...(reason ? { memeFallbackReason: reason.slice(0, 80) } : {}),
    updatedAt: Date.now(),
  });
  await ctx.scheduler.runAfter(0, internal.telegramMemeDelivery.deliver, {
    requestId: row._id,
  });
}
export const prepareAsset = internalMutation({
  args: {
    ...argsId,
    assetId: v.id("telegramMemeAssets"),
    mode: v.union(
      v.literal("original"),
      v.literal("template"),
      v.literal("recycle"),
    ),
  },
  returns: v.boolean(),
  handler: async (ctx, { requestId, assetId, mode }) => {
    const row = await ctx.db.get("telegramAgentRequests", requestId),
      asset = await ctx.db.get("telegramMemeAssets", assetId);
    if (
      !row ||
      !asset ||
      row.memeVersion !== 2 ||
      !validMeme(row, Date.now()) ||
      !["queued", "generating"].includes(row.status)
    )
      return false;
    await enqueueDelivery(ctx, row, asset, mode);
    return true;
  },
});
export const fallback = internalMutation({
  args: { ...argsId, reason: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { requestId, reason }) => {
    const row = await ctx.db.get("telegramAgentRequests", requestId);
    if (
      !row ||
      row.memeVersion !== 2 ||
      !validMeme(row, Date.now()) ||
      !["queued", "generating", "ready"].includes(row.status)
    )
      return false;
    const readyAsset =
      row.status === "ready" && row.memeAssetId
        ? await ctx.db.get("telegramMemeAssets", row.memeAssetId)
        : null;
    if (
      readyAsset &&
      (readyAsset.telegramFileId ||
        (readyAsset.storageId &&
          (await ctx.storage.getUrl(readyAsset.storageId))))
    ) {
      await ctx.scheduler.runAfter(0, internal.telegramMemeDelivery.deliver, {
        requestId,
      });
      return true;
    }
    const c = await config(ctx),
      candidates = await ctx.db
        .query("telegramMemeAssets")
        .withIndex("by_kind_and_lastUsedAt", (q) => q.eq("kind", "reserve"))
        .take(64);
    const a = candidates.find(
      (a) =>
        a._id !== row.memeAssetId &&
        a._id !== c?.lastAssetId &&
        (a.lastAttemptedAt ?? 0) <= a.lastUsedAt &&
        (a.storageId || a.telegramFileId),
    );
    if (!a) return false;
    await enqueueDelivery(ctx, row, a, "fallback", reason);
    return true;
  },
});
export const claimDelivery = internalMutation({
  args: argsId,
  returns: v.union(
    v.null(),
    v.object({
      botId: v.string(),
      input: v.string(),
      media: v.union(v.literal("photo"), v.literal("animation")),
      caption: v.string(),
    }),
  ),
  handler: async (ctx, { requestId }) => {
    const row = await ctx.db.get("telegramAgentRequests", requestId),
      bot = telegramBotRegistry(env.TELEGRAM_AGENT_BOTS).get("belle");
    if (
      !row ||
      row.memeVersion !== 2 ||
      row.status !== "ready" ||
      !validMeme(row, Date.now()) ||
      !bot ||
      bot.id !== row.botId ||
      (row.memeRetryAt ?? 0) > Date.now() ||
      !row.memeAssetId
    )
      return null;
    const agent = await ctx.db
      .query("forumAgents")
      .withIndex("by_slug", (q) => q.eq("slug", "belle"))
      .unique();
    if (!agent?.enabled) return null;
    const a = await ctx.db.get("telegramMemeAssets", row.memeAssetId);
    const input =
      a?.telegramFileId ??
      (a?.storageId ? await ctx.storage.getUrl(a.storageId) : null);
    if (!a || !input) {
      await ctx.scheduler.runAfter(0, internal.telegramMemeData.fallback, {
        requestId,
        reason: "asset_unavailable",
      });
      return null;
    }
    const marker =
      row.memeMode === "recycle"
        ? "Archive pick"
        : row.memeMode === "fallback"
          ? "From the meme vault"
          : "Belle's meme lab";
    const caption = `${a.text.replace(/^TOP: /, "").replace(/\nBOTTOM: /, "\n")}\n\n${marker} · SYMBaiEX Forum AI meme host${a.sourceName ? `\n${a.sourceName}${a.sourceUrl ? ": " + a.sourceUrl : ""}` : ""}`;
    await ctx.db.patch("telegramAgentRequests", row._id, {
      status: "sending",
      memeDeliveryAttempts: (row.memeDeliveryAttempts ?? 0) + 1,
      updatedAt: Date.now(),
    });
    await ctx.db.patch("telegramMemeAssets", a._id, {
      lastAttemptedAt: Date.now(),
    });
    return {
      botId: row.botId,
      input,
      media: a.media,
      caption: caption.slice(0, 1000),
    };
  },
});
/** A late composer can discard only its own never-selected artifact. */
export const discardUnused = internalMutation({
  args: { ...argsId, assetId: v.id("telegramMemeAssets") },
  returns: v.null(),
  handler: async (ctx, { requestId, assetId }) => {
    const row = await ctx.db.get("telegramAgentRequests", requestId);
    const a = await ctx.db.get("telegramMemeAssets", assetId);
    if (
      a?.kind === "generated" &&
      a.key === `generated:${row?.key}` &&
      row?.memeAssetId !== assetId &&
      !a.lastAttemptedAt &&
      !a.lastUsedAt
    ) {
      if (a.storageId) await ctx.storage.delete(a.storageId);
      await ctx.db.delete("telegramMemeAssets", assetId);
    }
    return null;
  },
});
export const confirmDelivery = internalMutation({
  args: { ...argsId, messageId: v.number(), fileId: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { requestId, messageId, fileId }) => {
    const row = await ctx.db.get("telegramAgentRequests", requestId);
    if (row?.memeVersion !== 2 || row.status !== "sending") return null;
    const now = Date.now(),
      c = await config(ctx);
    if (row.reply)
      await saveMessages(ctx, components.agent, {
        threadId: row.conversationId,
        agentName: "Belle",
        order: "next",
        messages: [{ role: "assistant", content: row.reply }],
      });
    await ctx.db.patch("telegramAgentRequests", requestId, {
      status: "sent",
      sentMessageId: messageId,
      updatedAt: now,
      reply: undefined,
      prompt: undefined,
    });
    if (row.memeAssetId) {
      await ctx.db.patch("telegramMemeAssets", row.memeAssetId, {
        lastUsedAt: now,
        ...(fileId && fileId.length <= 1024 ? { telegramFileId: fileId } : {}),
      });
      if (c)
        await ctx.db.patch("telegramMemeConfig", c._id, {
          lastConfirmedAt: now,
          lastAssetId: row.memeAssetId,
        });
      if (fileId)
        await ctx.scheduler.runAfter(
          15 * 60_000,
          internal.telegramMemeData.dropConfirmedBlob,
          { assetId: row.memeAssetId },
        );
    }
    return null;
  },
});
export const failedDelivery = internalMutation({
  args: {
    ...argsId,
    code: v.optional(v.number()),
    retrySeconds: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("telegramAgentRequests", args.requestId);
    if (row?.memeVersion !== 2 || row.status !== "sending") return null;
    if (
      args.code === 429 &&
      (row.memeDeliveryAttempts ?? 1) < 3 &&
      typeof args.retrySeconds === "number" &&
      args.retrySeconds >= 0 &&
      args.retrySeconds <= 120
    ) {
      await ctx.db.patch("telegramAgentRequests", row._id, {
        status: "ready",
        memeRetryAt: Date.now() + Math.max(1, args.retrySeconds) * 1000,
      });
      await ctx.scheduler.runAfter(
        Math.max(1, args.retrySeconds) * 1000,
        internal.telegramMemeDelivery.deliver,
        { requestId: row._id },
      );
      return null;
    }
    if (args.code === 400 && (row.memeDeliveryAttempts ?? 1) < 2) {
      const c = await config(ctx),
        pool = await ctx.db
          .query("telegramMemeAssets")
          .withIndex("by_kind_and_lastUsedAt", (q) => q.eq("kind", "reserve"))
          .take(64);
      const a = pool.find(
        (a) =>
          a._id !== row.memeAssetId &&
          a._id !== c?.lastAssetId &&
          (a.lastAttemptedAt ?? 0) <= a.lastUsedAt &&
          (a.storageId || a.telegramFileId),
      );
      if (a) {
        await ctx.db.patch("telegramAgentRequests", row._id, {
          status: "generating",
        });
        await enqueueDelivery(
          ctx,
          row,
          a,
          "fallback",
          "telegram_explicit_media_rejection",
        );
        return null;
      }
    }
    await ctx.db.patch("telegramAgentRequests", row._id, {
      status: "held",
      reason: args.code
        ? `telegram_rejected_${args.code}`
        : "delivery_unconfirmed",
      reply: undefined,
      prompt: undefined,
      updatedAt: Date.now(),
    });
    return null;
  },
});
export const dropConfirmedBlob = internalMutation({
  args: { assetId: v.id("telegramMemeAssets") },
  returns: v.null(),
  handler: async (ctx, { assetId }) => {
    const a = await ctx.db.get("telegramMemeAssets", assetId);
    if (
      a?.kind === "generated" &&
      a.telegramFileId &&
      a.storageId &&
      a.lastUsedAt > 0 &&
      (a.lastAttemptedAt ?? 0) <= a.lastUsedAt
    ) {
      await ctx.storage.delete(a.storageId);
      await ctx.db.patch("telegramMemeAssets", a._id, { storageId: undefined });
    }
    return null;
  },
});
