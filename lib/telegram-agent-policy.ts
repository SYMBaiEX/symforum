import { ELIZA_EDITORIAL_PERSONAS } from "./eliza-runtime-personas";

export const TELEGRAM_COMMUNITY_ID = "-1004387387301";
export const TELEGRAM_AGENT_SLUGS = [
  ...ELIZA_EDITORIAL_PERSONAS,
  "bags-scout",
  "pumpfun-scout",
] as const;
const agents = new Set<string>(TELEGRAM_AGENT_SLUGS);
export type TelegramBot = { token: string; username: string; id: string };

/** Secrets remain in the deployment environment, never in public profiles. */
export function telegramBotRegistry(
  value: string | undefined,
): Map<string, TelegramBot> {
  const result = new Map<string, TelegramBot>();
  if (!value) return result;
  try {
    const input: unknown = JSON.parse(value);
    if (!record(input) || Object.keys(input).length > 35) return result;
    const ids = new Set<string>();
    const usernames = new Set<string>();
    for (const [slug, entry] of Object.entries(input)) {
      if (
        !agents.has(slug) ||
        !record(entry) ||
        typeof entry.token !== "string" ||
        !/^\d{6,14}:[A-Za-z0-9_-]{30,100}$/.test(entry.token) ||
        typeof entry.username !== "string" ||
        !/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(entry.username)
      )
        return new Map();
      const id = entry.token.split(":")[0];
      const username = entry.username.toLowerCase();
      if (ids.has(id) || usernames.has(username)) return new Map();
      ids.add(id);
      usernames.add(username);
      result.set(slug, { token: entry.token, username, id });
    }
  } catch {
    return new Map();
  }
  return result;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function integer(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export type TelegramRequest = {
  updateId: number;
  messageId: number;
  topicId: number;
  senderId: string;
  text: string;
  kind: "ask" | "help" | "menu" | "prompt";
};

/** Only explicit human requests in our community can purchase generation. */
export function telegramRequest(
  input: unknown,
  bot: TelegramBot,
  now: number,
): TelegramRequest | null {
  if (!record(input) || !integer(input.update_id) || !record(input.message))
    return null;
  const m = input.message;
  if (
    !record(m.chat) ||
    String(m.chat.id) !== TELEGRAM_COMMUNITY_ID ||
    m.chat.type !== "supergroup" ||
    !record(m.from) ||
    m.from.is_bot !== false ||
    !integer(m.from.id) ||
    m.sender_chat !== undefined ||
    !integer(m.message_id) ||
    !integer(m.date) ||
    Math.abs(now / 1000 - m.date) > 3600 ||
    typeof m.text !== "string" ||
    m.text.length > 1600 ||
    (m.message_thread_id !== undefined && !integer(m.message_thread_id))
  )
    return null;
  const topicId = (m.message_thread_id as number | undefined) ?? 0;
  if (topicId === 7) return null; // Closed Start Here & Rules topic.
  let text = m.text.trim();
  let kind: TelegramRequest["kind"] = "ask";
  const command = /^\/([a-z]+)(?:@([A-Za-z0-9_]+))?(?:\s|$)/i.exec(text);
  if (command) {
    if (
      command[2]?.toLowerCase() !== bot.username ||
      !["ask", "help", "start", "about", "menu", "agents"].includes(
        command[1].toLowerCase(),
      )
    )
      return null;
    const verb = command[1].toLowerCase();
    kind =
      verb === "ask"
        ? "ask"
        : ["menu", "agents"].includes(verb)
          ? "menu"
          : "help";
    text = text.slice(command[0].length).trim();
  } else {
    if (
      !record(m.reply_to_message) ||
      !record(m.reply_to_message.from) ||
      String(m.reply_to_message.from.id) !== bot.id
    )
      return null;
  }
  if (!text && kind === "ask") kind = "help";
  return {
    updateId: input.update_id,
    messageId: m.message_id,
    topicId,
    senderId: String(m.from.id),
    text: text.slice(0, 1400),
    kind,
  };
}

/** A pinned menu may be old; the authenticated callback itself is the new event. */
export function telegramMenuCallback(
  input: unknown,
  bot: TelegramBot,
  registry: Map<string, TelegramBot>,
) {
  if (
    !record(input) ||
    !integer(input.update_id) ||
    !record(input.callback_query)
  )
    return null;
  const c = input.callback_query;
  if (
    typeof c.id !== "string" ||
    !c.id.length ||
    c.id.length > 128 ||
    typeof c.data !== "string" ||
    !record(c.from) ||
    c.from.is_bot !== false ||
    !integer(c.from.id) ||
    !record(c.message)
  )
    return null;
  const m = c.message;
  const choice = /^agent:([a-z0-9-]{1,40})$/.exec(c.data)?.[1];
  if (
    !choice ||
    !registry.has(choice) ||
    !record(m.chat) ||
    String(m.chat.id) !== TELEGRAM_COMMUNITY_ID ||
    m.chat.type !== "supergroup" ||
    !record(m.from) ||
    String(m.from.id) !== bot.id ||
    m.from.is_bot !== true ||
    !integer(m.message_id) ||
    !integer(m.date) ||
    m.date === 0 ||
    (m.message_thread_id !== undefined && !integer(m.message_thread_id))
  )
    return null;
  const topicId = (m.message_thread_id as number | undefined) ?? 0;
  if (topicId === 7) return null;
  return {
    callbackId: c.id,
    agentSlug: choice,
    request: {
      updateId: input.update_id,
      messageId: m.message_id,
      topicId,
      senderId: String(c.from.id),
      text: "",
      kind: "prompt" as const,
    },
  };
}

export async function telegramWebhookSecret(token: string): Promise<string> {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`symforum:telegram:webhook:v1:${token}`),
  );
  return Array.from(new Uint8Array(hash), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

export function secretEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++)
    difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}
