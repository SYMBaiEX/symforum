import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, env } from "./_generated/server";
import {
  TELEGRAM_COMMUNITY_ID,
  telegramBotRegistry,
} from "../lib/telegram-agent-policy";
import { relayMessage } from "../lib/x-telegram-relay";

export const deliver = internalAction({
  args: { id: v.id("xTelegramDeliveries") },
  returns: v.null(),
  handler: async (ctx, { id }): Promise<null> => {
    const d = await ctx.runMutation(internal.xTelegramRelayData.claim, { id });
    if (!d) return null;
    const bot = telegramBotRegistry(env.TELEGRAM_AGENT_BOTS).get("suki");
    if (!bot || !d.text) {
      await ctx.runMutation(internal.xTelegramRelayData.settle, {
        id,
        issue: "bot_unavailable",
      });
      return null;
    }
    let messageId: number | undefined;
    let issue: "delivery_unknown" | "telegram_rejected" = "delivery_unknown";
    try {
      const r = await fetch(
        `https://api.telegram.org/bot${bot.token}/sendMessage`,
        {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(15000),
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: TELEGRAM_COMMUNITY_ID,
            message_thread_id: d.topicId,
            text: relayMessage(d.text, d.postId),
            link_preview_options: {
              is_disabled: false,
              url: `https://x.com/symforum/status/${d.postId}`,
            },
          }),
        },
      );
      const raw = await r.text();
      if (raw.length > 64000) throw Error("Invalid receipt");
      const data = JSON.parse(raw);
      if (
        r.ok &&
        data.ok === true &&
        String(data.result?.chat?.id) === TELEGRAM_COMMUNITY_ID &&
        data.result?.message_thread_id === d.topicId &&
        Number.isSafeInteger(data.result?.message_id) &&
        data.result.message_id > 0
      )
        messageId = data.result.message_id;
      else if (
        data.ok === false &&
        Number.isInteger(data.error_code) &&
        data.error_code >= 400 &&
        data.error_code < 500
      )
        issue = "telegram_rejected";
    } catch {
      /* Intentionally no retry and no raw provider log. */
    }
    await ctx.runMutation(
      internal.xTelegramRelayData.settle,
      messageId ? { id, messageId } : { id, issue },
    );
    return null;
  },
});
