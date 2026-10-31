"use node";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { env, internalAction, type ActionCtx } from "./_generated/server";
import { providerFetch, ProviderAdmissionError } from "./forumProviderFetch";
import type { Id } from "./_generated/dataModel";
import {
  GECKO_BASE,
  SYMF_MINT,
  SYMF_FEED_TOPIC,
  symfPools,
  poolBuys,
} from "../lib/telegram-trade-feed";
import {
  telegramBotRegistry,
  TELEGRAM_COMMUNITY_ID,
} from "../lib/telegram-agent-policy";
import { tradeFeedEnabled } from "./telegramTradeFeed";
async function read(ctx: ActionCtx, path: string): Promise<unknown> {
  const response = await providerFetch(ctx)(`${GECKO_BASE}${path}`, {
    redirect: "error",
    signal: AbortSignal.timeout(12_000),
    headers: { Accept: "application/json;version=20230203" },
  });
  if (!response.ok) {
    const seconds = Number(response.headers.get("Retry-After"));
    const error = new Error(`provider_http_${response.status}`) as Error & {
      retryAfterAt?: number;
    };
    if (response.status === 429)
      error.retryAfterAt =
        Date.now() +
        (Math.max(300, Number.isFinite(seconds) ? seconds : 300) * 60_000) / 60;
    throw error;
  }
  return (await response.json()) as unknown;
}
export const poll = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx): Promise<null> => {
    const since: number | null = await ctx.runMutation(
      internal.telegramTradeFeed.begin,
      {},
    );
    if (since === null) return null;
    try {
      const discovery = symfPools(
        await read(ctx, `/tokens/${SYMF_MINT}/pools`),
      );
      if (!discovery.pools.length) throw Error("no_matching_pools");
      for (const pool of discovery.pools.slice(0, 6)) {
        const trades = poolBuys(
          await read(
            ctx,
            `/pools/${pool}/trades?trade_volume_in_usd_greater_than=0`,
          ),
          pool,
          since,
          Date.now(),
        );
        await ctx.runMutation(internal.telegramTradeFeed.record, {
          pool,
          ...trades,
        });
      }
      await ctx.runMutation(internal.telegramTradeFeed.health, {
        truncated: discovery.truncated || discovery.pools.length > 6,
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      await ctx.runMutation(internal.telegramTradeFeed.health, {
        ...(error instanceof ProviderAdmissionError &&
        error.retryAt !== null &&
        Number.isSafeInteger(error.retryAt) &&
        error.retryAt > Date.now()
          ? { retryAfterAt: error.retryAt }
          : error instanceof Error &&
              "retryAfterAt" in error &&
              typeof error.retryAfterAt === "number"
            ? { retryAfterAt: error.retryAfterAt }
            : {}),
        reason:
          error instanceof ProviderAdmissionError
            ? "provider_admission_denied"
            : /^(provider_http_[0-9]{3}|invalid_[a-z_]+|no_matching_pools)$/.test(
                  code,
                )
              ? code
              : "provider_poll_unconfirmed",
      });
    }
    const batch: { batchId: Id<"telegramTradeBatches">; text: string } | null =
      await ctx.runMutation(internal.telegramTradeFeed.claim, {});
    if (!batch || !tradeFeedEnabled()) return null;
    const bot = telegramBotRegistry(env.TELEGRAM_AGENT_BOTS).get("suki")!;
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
            message_thread_id: SYMF_FEED_TOPIC,
            text: batch.text,
            parse_mode: "HTML",
            disable_notification: true,
            link_preview_options: { is_disabled: true },
          }),
        },
      );
      const body: unknown = await response.json();
      if (
        response.ok &&
        body &&
        typeof body === "object" &&
        "ok" in body &&
        body.ok === true &&
        "result" in body &&
        body.result &&
        typeof body.result === "object"
      ) {
        const r = body.result;
        if (
          "message_id" in r &&
          typeof r.message_id === "number" &&
          "message_thread_id" in r &&
          r.message_thread_id === SYMF_FEED_TOPIC &&
          "chat" in r &&
          r.chat &&
          typeof r.chat === "object" &&
          "id" in r.chat &&
          String(r.chat.id) === TELEGRAM_COMMUNITY_ID
        )
          messageId = r.message_id;
      }
    } catch {
      /* An uncertain Telegram send stays held. Never replay it. */
    }
    await ctx.runMutation(internal.telegramTradeFeed.finish, {
      batchId: batch.batchId,
      ...(messageId ? { messageId } : {}),
    });
    return null;
  },
});
