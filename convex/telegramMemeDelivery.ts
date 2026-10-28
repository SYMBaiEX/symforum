"use node";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { env, internalAction } from "./_generated/server";
import {
  telegramBotRegistry,
  TELEGRAM_COMMUNITY_ID,
} from "../lib/telegram-agent-policy";
import { MEME_TOPIC_ID } from "../lib/telegram-memes";
import { verifyYapInstallation } from "./telegramAgentReply";
const object = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === "object" && !Array.isArray(x);
export const deliver = internalAction({
  args: { requestId: v.id("telegramAgentRequests") },
  returns: v.null(),
  handler: async (ctx, { requestId }): Promise<null> => {
    const bot = telegramBotRegistry(env.TELEGRAM_AGENT_BOTS).get("belle");
    if (!bot) return null;
    const data = await ctx.runMutation(
      internal.telegramMemeData.claimDelivery,
      { requestId },
    );
    if (!data || data.botId !== bot.id) return null;
    try {
      await verifyYapInstallation(bot.token, bot.id, "belle");
    } catch {
      await ctx.runMutation(internal.telegramAgents.finish, {
        requestId,
        reason: "configuration_unconfirmed",
      });
      return null;
    }
    try {
      const r = await fetch(
        `https://api.telegram.org/bot${bot.token}/${data.media === "animation" ? "sendAnimation" : "sendPhoto"}`,
        {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(20_000),
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: TELEGRAM_COMMUNITY_ID,
            message_thread_id: MEME_TOPIC_ID,
            [data.media === "animation" ? "animation" : "photo"]: data.input,
            caption: data.caption,
            disable_notification: true,
          }),
        },
      );
      const body: unknown = await r.json();
      if (
        object(body) &&
        body.ok === false &&
        typeof body.error_code === "number" &&
        [400, 403, 404, 429].includes(body.error_code)
      ) {
        const retry =
          object(body.parameters) &&
          typeof body.parameters.retry_after === "number"
            ? body.parameters.retry_after
            : undefined;
        await ctx.runMutation(internal.telegramMemeData.failedDelivery, {
          requestId,
          code: body.error_code,
          ...(retry !== undefined ? { retrySeconds: retry } : {}),
        });
        return null;
      }
      const m = object(body) ? body.result : null;
      if (
        !r.ok ||
        !object(body) ||
        body.ok !== true ||
        !object(m) ||
        typeof m.message_id !== "number" ||
        m.message_thread_id !== MEME_TOPIC_ID ||
        !object(m.chat) ||
        String(m.chat.id) !== TELEGRAM_COMMUNITY_ID
      )
        throw Error("delivery_unconfirmed");
      const media =
        data.media === "animation"
          ? m.animation
          : Array.isArray(m.photo)
            ? m.photo.at(-1)
            : null;
      const fileId =
        object(media) && typeof media.file_id === "string"
          ? media.file_id
          : undefined;
      await ctx.runMutation(internal.telegramMemeData.confirmDelivery, {
        requestId,
        messageId: m.message_id,
        ...(fileId ? { fileId } : {}),
      });
    } catch {
      await ctx.runMutation(internal.telegramMemeData.failedDelivery, {
        requestId,
      });
    }
    return null;
  },
});
