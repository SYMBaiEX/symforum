import { env } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { MEME_TOPIC_ID } from "../lib/telegram-memes";
export function memesEnabled() {
  return (
    env.TELEGRAM_MEMES_ENABLED === "true" &&
    env.TELEGRAM_MEMES_TOPIC_ID === String(MEME_TOPIC_ID) &&
    env.TELEGRAM_AGENTS_ENABLED === "true" &&
    env.ELIZA_RUNTIME_MODE === "live"
  );
}
export function validMeme(row: Doc<"telegramAgentRequests">, now: number) {
  return (
    memesEnabled() &&
    row.kind === "meme" &&
    row.agentSlug === "belle" &&
    row.topicId === MEME_TOPIC_ID &&
    typeof row.memeSlot === "number" &&
    row.key === `${row.memeVersion === 2 ? "meme2" : "meme"}:${row.memeSlot}` &&
    now >= row.createdAt &&
    now - row.createdAt < 8 * 60_000
  );
}
