import type { HttpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { env, httpAction } from "./_generated/server";
import {
  secretEqual,
  telegramBotRegistry,
  telegramRequest,
  telegramWebhookSecret,
} from "../lib/telegram-agent-policy";

const response = (status: number) =>
  new Response(null, { status, headers: { "Cache-Control": "no-store" } });
export function addTelegramAgentRoutes(http: HttpRouter) {
  http.route({
    pathPrefix: "/telegram/agents/",
    method: "POST",
    handler: httpAction(async (ctx, request) => {
      const slug = new URL(request.url).pathname.slice(
        "/telegram/agents/".length,
      );
      const bot = telegramBotRegistry(env.TELEGRAM_AGENT_BOTS).get(slug);
      if (
        env.TELEGRAM_AGENTS_ENABLED !== "true" ||
        !bot ||
        !secretEqual(
          request.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "",
          await telegramWebhookSecret(bot.token),
        )
      )
        return response(404);
      if (
        request.headers.get("Content-Type")?.split(";")[0].trim() !==
        "application/json"
      )
        return response(415);
      if (Number(request.headers.get("Content-Length") ?? 0) > 32768)
        return response(413);
      const reader = request.body?.getReader();
      if (!reader) return response(400);
      const chunks: Uint8Array[] = [];
      let length = 0;
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        length += part.value.byteLength;
        if (length > 32768) {
          await reader.cancel();
          return response(413);
        }
        chunks.push(part.value);
      }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      let input: unknown;
      try {
        input = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        return response(400);
      }
      const message = telegramRequest(input, bot, Date.now());
      if (message)
        await ctx.runMutation(internal.telegramAgents.accept, {
          agentSlug: slug,
          botId: bot.id,
          ...message,
        });
      return response(200);
    }),
  });
}
