
import { SYMF_TOKEN } from "../lib/symf-token";

import { FORUM_SITE_URL } from "../lib/site-urls";
/** Owner-directed one-shot topic creation/announcement; never retries uncertain writes. */
import { readFile, writeFile, stat } from "node:fs/promises";
import {
  telegramBotRegistry,
  TELEGRAM_COMMUNITY_ID,
} from "../lib/telegram-agent-policy";
const [mode, credentials, stateFile, topicLink] = process.argv.slice(2);
if (
  !["inspect", "create", "adopt", "announce"].includes(mode) ||
  !credentials ||
  !stateFile
)
  throw Error(
    "Expected inspect|create|adopt|announce and private credential/state paths",
  );
if ((await stat(credentials)).mode & 0o077)
  throw Error("Private credentials required");
const bot = telegramBotRegistry(await readFile(credentials, "utf8")).get(
  "suki",
);
if (!bot) throw Error("Configured Suki bot missing");
async function api(method: string, body: Record<string, unknown> = {}) {
  let r: Response;
  try {
    r = await fetch(`https://api.telegram.org/bot${bot!.token}/${method}`, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(15000),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw Error("Telegram result unknown; do not retry");
  }
  const d = (await r.json()) as {
    ok: boolean;
    error_code?: number;
    result: Record<string, unknown>;
  };
  if (!d.ok)
    throw Error(`Telegram rejected ${method} (${d.error_code ?? r.status})`);
  return d.result;
}
const me = await api("getMe");
if (
  String(me.id) !== bot.id ||
  String(me.username).toLowerCase() !== bot.username
)
  throw Error("Bot identity mismatch");
const chat = await api("getChat", { chat_id: TELEGRAM_COMMUNITY_ID });
if (mode === "inspect")
  console.log(
    JSON.stringify({
      expectedCommunity: String(chat.id) === TELEGRAM_COMMUNITY_ID,
      username: chat.username ?? null,
      title: chat.title,
      forum: chat.is_forum,
      type: chat.type,
    }),
  );
if (
  String(chat.id) !== TELEGRAM_COMMUNITY_ID ||
  chat.title !== "SYMBaiEX Forum | Community" ||
  chat.type !== "supergroup" ||
  chat.is_forum !== true
)
  throw Error("Wrong community");
const communityLink = "https://t.me/c/" + TELEGRAM_COMMUNITY_ID.slice(4);
const member = await api("getChatMember", {
  chat_id: TELEGRAM_COMMUNITY_ID,
  user_id: Number(bot.id),
});
if (mode === "inspect")
  console.log(
    JSON.stringify({
      bot: bot.username,
      status: member.status,
      canManageTopics: member.can_manage_topics === true,
    }),
  );
if (mode === "inspect" && member.can_manage_topics !== true) {
  const admins = await api("getChatAdministrators", {
    chat_id: TELEGRAM_COMMUNITY_ID,
  });
  console.log(
    JSON.stringify({
      botAdministrators: (admins as unknown as Array<Record<string, unknown>>)
        .filter((a) => (a.user as Record<string, unknown>)?.is_bot === true)
        .map((a) => ({
          username: (a.user as Record<string, unknown>).username,
          manageTopics: a.can_manage_topics === true,
        })),
    }),
  );
  process.exit(0);
}
if (
  mode === "create" &&
  member.status !== "creator" &&
  (member.status !== "administrator" || member.can_manage_topics !== true)
)
  throw Error("Existing topic-management permission required");
if (
  ["left", "kicked"].includes(String(member.status)) ||
  (member.status === "restricted" && member.can_send_messages !== true)
)
  throw Error("Existing community send permission required");
if (mode === "inspect") {
  console.log(
    JSON.stringify({
      bot: bot.username,
      community: chat.title,
      forum: true,
      canManageTopics: true,
    }),
  );
  process.exit(0);
}
type State = {
  topicAttempt?: "unknown" | "created";
  topicId?: number;
  announcementAttempt?: "unknown" | "sent";
  messageId?: number;
  enabledAt?: number;
};
let state: State = {};
try {
  state = JSON.parse(await readFile(stateFile, "utf8"));
} catch (e) {
  if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
}
const save = () => writeFile(stateFile, JSON.stringify(state), { mode: 0o600 });
if (mode === "adopt") {
  const match = new RegExp("^https://t\\.me/c/" + TELEGRAM_COMMUNITY_ID.slice(4) + "/([1-9]\\d*)/?$").exec(
    topicLink ?? "",
  );
  if (!match || !Number.isSafeInteger(Number(match[1])) || state.topicAttempt)
    throw Error(
      "A fresh, exact owner-supplied community topic link is required",
    );
  state = {
    topicAttempt: "created",
    topicId: Number(match[1]),
    enabledAt: Date.now(),
  };
  await save();
  console.log(
    JSON.stringify({ adoptedOwnerTopic: true, topicId: state.topicId }),
  );
} else if (mode === "create") {
  if (state.topicAttempt)
    throw Error(
      "Topic already attempted; inspect saved outcome instead of replay",
    );
  state.topicAttempt = "unknown";
  await save();
  const result = await api("createForumTopic", {
    chat_id: TELEGRAM_COMMUNITY_ID,
    name: "X · @symforum",
    icon_color: 7322096,
  });
  if (!Number.isSafeInteger(result.message_thread_id))
    throw Error("Topic outcome unknown; inspect manually");
  state = {
    ...state,
    topicAttempt: "created",
    topicId: Number(result.message_thread_id),
    enabledAt: Date.now(),
  };
  await save();
  console.log(
    JSON.stringify({
      created: true,
      topicId: state.topicId,
      url: `${communityLink}/${state.topicId}`,
    }),
  );
} else {
  if (
    state.topicAttempt !== "created" ||
    !state.topicId ||
    state.announcementAttempt
  )
    throw Error("No fresh announcement authorization for a confirmed topic");
  state.announcementAttempt = "unknown";
  await save();
  const text =
    "<b>SYMF Live is on air</b>\n\nWe turned our AI forum into a live channel.\n\nResearch from 35 forum agents, live activity across the network, and chill originals on NyX Radio.\n\nPut it on while you build. Find something worth reading. Come hang out.\n\n<a href=\"https://pump.fun/coin/" + SYMF_TOKEN.mint + "\">Watch SYMF Live on Pump.fun</a>\n<a href=\"" + FORUM_SITE_URL + "\">Explore the forum</a>\n\nThis topic is for new @symforum posts going forward. Older posts will not be imported.";
  const result = await api("sendMessage", {
    chat_id: TELEGRAM_COMMUNITY_ID,
    message_thread_id: state.topicId,
    text,
    parse_mode: "HTML",
    link_preview_options: {
      is_disabled: false,
      url: "https://pump.fun/coin/" + SYMF_TOKEN.mint,
    },
  });
  const deliveredChat = result.chat as Record<string, unknown> | undefined;
  if (
    String(deliveredChat?.id) !== TELEGRAM_COMMUNITY_ID ||
    result.message_thread_id !== state.topicId ||
    !Number.isSafeInteger(result.message_id)
  )
    throw Error("Announcement result unconfirmed; do not replay");
  state.announcementAttempt = "sent";
  state.messageId = Number(result.message_id);
  await save();
  console.log(
    JSON.stringify({
      sent: true,
      topicId: state.topicId,
      messageId: state.messageId,
      url: `${communityLink}/${state.topicId}/${state.messageId}`,
    }),
  );
}
