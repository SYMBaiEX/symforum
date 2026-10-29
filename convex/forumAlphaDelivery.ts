"use node";
import { v } from "convex/values";
import { internalAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { sealX, unsealX } from "../lib/x-agent-crypto";
import {
  ALPHA_X_USER_ID,
  ALPHA_SOCIAL_INTERVAL_MS,
} from "../lib/forum-alpha-editorial";
import { X_ACTIVITY_SCOPES } from "../lib/x-agent-policy";
import {
  TELEGRAM_COMMUNITY_ID,
  telegramBotRegistry,
} from "../lib/telegram-agent-policy";
async function access(
  ctx: ActionCtx,
  id: Id<"forumAlphaDeliveries">,
  a: Doc<"xAgentAccounts">,
) {
  if (!process.env.X_AGENT_TOKEN_KEK || !a.grant)
    throw Error("Grant unavailable");
  const binding = `${a.ownerUserId}:${a.agentSlug}:grant:v1`;
  const g = JSON.parse(
    await unsealX(process.env.X_AGENT_TOKEN_KEK, a.grant, binding),
  );
  if (typeof g.accessToken !== "string" || typeof g.refreshToken !== "string")
    throw Error("Invalid grant");
  if ((a.expiresAt ?? 0) > Date.now() + 5 * 60_000)
    return g.accessToken as string;
  if (
    !process.env.X_AGENT_CLIENT_ID ||
    !process.env.X_AGENT_CLIENT_SECRET ||
    !(await ctx.runMutation(internal.forumAlphaDistribution.refreshBrand, {
      id,
    }))
  )
    throw Error("Refresh unavailable");
  const r = await fetch("https://api.x.com/2/oauth2/token", {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${encodeURIComponent(process.env.X_AGENT_CLIENT_ID)}:${encodeURIComponent(process.env.X_AGENT_CLIENT_SECRET)}`).toString("base64")}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: g.refreshToken,
    }).toString(),
  });
  if (!r.ok) throw Error("Refresh failed");
  const raw = await r.text();
  if (raw.length > 16384) throw Error("Invalid response");
  const t = JSON.parse(raw);
  if (
    typeof t.access_token !== "string" ||
    typeof t.refresh_token !== "string" ||
    typeof t.scope !== "string" ||
    !X_ACTIVITY_SCOPES.every((s) => t.scope.split(" ").includes(s)) ||
    String(t.token_type).toLowerCase() !== "bearer" ||
    typeof t.expires_in !== "number" ||
    t.expires_in <= 0 ||
    t.expires_in > 86400
  )
    throw Error("Invalid refreshed grant");
  const grant = await sealX(
    process.env.X_AGENT_TOKEN_KEK,
    JSON.stringify({
      accessToken: t.access_token,
      refreshToken: t.refresh_token,
    }),
    binding,
  );
  if (
    !(await ctx.runMutation(internal.forumAlphaDistribution.refreshBrand, {
      id,
      grant,
      scope: t.scope,
      expiresAt: Date.now() + t.expires_in * 1000,
    }))
  )
    throw Error("Refresh ownership changed");
  return t.access_token as string;
}
export const deliver = internalAction({
  args: {
    id: v.id("forumAlphaDeliveries"),
    destination: v.union(v.literal("telegram"), v.literal("x")),
  },
  returns: v.null(),
  handler: async (ctx, { id, destination }): Promise<null> => {
    if (destination === "telegram") {
      const bot = telegramBotRegistry(process.env.TELEGRAM_AGENT_BOTS).get(
        "suki",
      );
      if (!bot) return null;
      const c = await ctx.runMutation(
        internal.forumAlphaDistribution.claimTelegram,
        { id },
      );
      if (!c) return null;
      let messageId: number | undefined;
      try {
        const response = await fetch(
          `https://api.telegram.org/bot${bot.token}/sendMessage`,
          {
            method: "POST",
            redirect: "error",
            signal: AbortSignal.timeout(20_000),
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: TELEGRAM_COMMUNITY_ID,
              message_thread_id: c.topicId,
              text: c.text,
              disable_notification: true,
              link_preview_options: { is_disabled: true },
              reply_markup: {
                inline_keyboard: [
                  [{ text: "Forum finding & sources", url: c.url }],
                ],
              },
            }),
          },
        );
        const raw = await response.text();
        if (raw.length > 16384) throw Error("Invalid receipt");
        const b = JSON.parse(raw);
        if (
          response.ok &&
          b.ok === true &&
          String(b.result?.chat?.id) === TELEGRAM_COMMUNITY_ID &&
          b.result?.message_thread_id === c.topicId &&
          Number.isSafeInteger(b.result?.message_id) &&
          b.result.message_id > 0
        )
          messageId = b.result.message_id;
      } catch {
        /* Unknown sends remain held, never replayed. */
      }
      await ctx.runMutation(internal.forumAlphaDistribution.finishTelegram, {
        id,
        messageId,
      });
      return null;
    }
    const c = await ctx.runMutation(internal.forumAlphaDistribution.claimX, {
      id,
    });
    if (!c) return null;
    let postId: string | undefined;
    try {
      const token = await access(ctx, id, c.account);
      // One read per admitted attempt gives recent manual/Typefully originals room.
      const recentUrl = new URL(
        `https://api.x.com/2/users/${ALPHA_X_USER_ID}/tweets`,
      );
      recentUrl.search = new URLSearchParams({
        max_results: "5",
        exclude: "replies,retweets",
        "post.fields": "created_at",
      }).toString();
      const recent = await fetch(recentUrl, {
        headers: { Authorization: `Bearer ${token}` },
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
      const rawRecent = await recent.text();
      if (!recent.ok || rawRecent.length > 32000)
        throw Error("Recent posting window unavailable");
      const timeline = JSON.parse(rawRecent);
      if (
        timeline.errors ||
        (!Array.isArray(timeline.data) && timeline.meta?.result_count !== 0)
      )
        throw Error("Recent posting window unconfirmed");
      let lastAt = 0;
      for (const post of timeline.data ?? []) {
        const at =
          typeof post.created_at === "string"
            ? Date.parse(post.created_at)
            : NaN;
        if (!Number.isFinite(at) || at > Date.now() + 60_000)
          throw Error("Invalid timeline receipt");
        lastAt = Math.max(lastAt, at);
      }
      if (lastAt + ALPHA_SOCIAL_INTERVAL_MS > Date.now()) {
        await ctx.runMutation(internal.forumAlphaDistribution.deferX, {
          id,
          notBefore: lastAt + ALPHA_SOCIAL_INTERVAL_MS,
        });
        return null;
      }
      const text = await ctx.runMutation(
        internal.forumAlphaDistribution.authorizeXSend,
        { id },
      );
      if (!text) throw Error("Publication canceled");
      const response = await fetch("https://api.x.com/2/tweets", {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(20_000),
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text }),
      });
      const raw = await response.text();
      if (raw.length > 16384) throw Error("Invalid receipt");
      const b = JSON.parse(raw);
      if (
        response.ok &&
        typeof b.data?.id === "string" &&
        /^\d{1,22}$/.test(b.data.id)
      )
        postId = b.data.id;
    } catch {
      /* Neither ambiguous sends nor rotating refreshes are retried. */
    }
    await ctx.runMutation(internal.forumAlphaDistribution.finishX, {
      id,
      postId,
    });
    return null;
  },
});
