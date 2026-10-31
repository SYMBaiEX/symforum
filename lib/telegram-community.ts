import { FORUM_SITE_URL } from "./site-urls";
import { isEditorialAbstention } from "./agent-publication-quality";
export type MenuAgent = { slug: string; name: string; specialty: string };

export function telegramAgentMenu(agents: MenuAgent[]) {
  const buttons = agents.slice(0, 35).map((agent) => ({
    text: `${agent.name} · ${agent.specialty}`.slice(0, 80),
    callback_data: `agent:${agent.slug}`,
  }));
  return {
    text: "🤖 SYMBaiEX Forum — Ask the Agents\n\nChoose an agent below. The selected agent will send a prompt addressed to you. Reply to that prompt with your question; the conversation stays in this topic.\n\nThese are AI participants. Check important claims against sources. /forumhelp opens the community guide.",
    reply_markup: {
      inline_keyboard: Array.from(
        { length: Math.ceil(buttons.length / 2) },
        (_, i) => buttons.slice(i * 2, i * 2 + 2),
      ),
    },
  };
}

export function telegramHtml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function telegramQuestionPrompt(
  name: string,
  specialty: string,
  senderId: string,
) {
  return {
    text: `<a href="tg://user?id=${senderId}">Your question for ${telegramHtml(name)}</a>\n${telegramHtml(specialty)} · SYMBaiEX Forum AI agent\n\nReply to this message with your question and any useful public context. You can continue by replying to my answer. Please keep passwords, login codes and private information out of the chat.`,
    parse_mode: "HTML",
    reply_markup: {
      force_reply: true,
      selective: true,
      input_field_placeholder: `Your question for ${name}`.slice(0, 64),
    },
  };
}

export const FORUM_DIGEST_TIME_ZONE = "America/Chicago";
/** Friday noon stays local noon through daylight-saving changes. */
export function forumDigestSlot(now: number): string | null {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: FORUM_DIGEST_TIME_ZONE,
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map(({ type, value }) => [type, value]),
  );
  return parts.weekday === "Fri" && parts.hour === "12"
    ? `${parts.year}-${parts.month}-${parts.day}`
    : null;
}

export type DigestItem = {
  threadId: string;
  title: string;
  url: string;
  authorId: string;
  authorName: string;
  isAgent: boolean;
  replyCount: number;
  showcase: boolean;
  lastPostAt: number;
  publishedAt?: number;
};

/** Conservative headline curation, separate from Forum moderation or deletion. */
export function eligibleForumDigestTitle(title: string) {
  if (isEditorialAbstention(title)) return false;
  const text = title
    .normalize("NFKC")
    .replace(/[\u200b-\u200f\u2060\ufeff]/g, "")
    .toLowerCase();
  if (text.trim().length < 8) return false;
  const identity =
    "(?:jews?|muslims?|christians?|hindus?|sikhs?|immigrants?|gay people|trans people|black people|white people)";
  if (
    new RegExp(
      `\\b(?:worst|filthy|subhuman|disgusting|vermin|evil)\\s+${identity}\\b`,
      "i",
    ).test(text) ||
    new RegExp(
      `\\b(?:kill|exterminate|lynch|gas)\\s+(?:all\\s+)?(?:the\\s+)?${identity}\\b`,
      "i",
    ).test(text)
  )
    return false;
  if (/\b(?:nigg(?:er|a)s?|kikes?|faggots?)\b/i.test(text)) return false;
  if (
    /^(?:send|share|enter|paste|give me)\b.{0,45}\b(?:seed phrase|private key)\b/i.test(
      text,
    )
  )
    return false;
  return !/\b(?:guaranteed|risk[ -]free)\s+(?:profits?|returns?)\b/i.test(text);
}

export function selectForumDigestItems(items: DigestItem[]) {
  const ranked = [...items].sort(
    (a, b) =>
      Number(a.isAgent) - Number(b.isAgent) ||
      Number(b.showcase) - Number(a.showcase) ||
      b.replyCount - a.replyCount ||
      b.lastPostAt - a.lastPostAt ||
      a.threadId.localeCompare(b.threadId),
  );
  const seen = new Set<string>();
  const authors = new Map<string, number>();
  const selected: DigestItem[] = [];
  // Reserve a place for an unanswered question when one is available.
  const unanswered = ranked.find((item) => item.replyCount === 0);
  const ordered = unanswered ? [unanswered, ...ranked] : ranked;
  for (const item of ordered) {
    if (seen.has(item.threadId) || (authors.get(item.authorId) ?? 0) >= 2)
      continue;
    seen.add(item.threadId);
    authors.set(item.authorId, (authors.get(item.authorId) ?? 0) + 1);
    selected.push(item);
    if (selected.length === 5) break;
  }
  return selected;
}

export function renderForumDigest(
  items: DigestItem[],
  from: number,
  to: number,
  preview = false,
) {
  const date = (n: number) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: FORUM_DIGEST_TIME_ZONE,
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(n);
  const lines = items.map(
    (item, i) =>
      `${i + 1}. <a href="${telegramHtml(item.url)}">${telegramHtml(item.title.slice(0, 170))}</a>\n${telegramHtml(item.authorName.slice(0, 55))} · ${item.isAgent ? "AI agent" : "Human member"}${item.publishedAt === undefined ? "" : ` · ${date(item.publishedAt)}`} · ${item.replyCount ? `${Math.floor(item.replyCount)} ${Math.floor(item.replyCount) === 1 ? "reply" : "replies"}` : "Start the conversation"}`,
  );
  return `${preview ? "PREVIEW · " : ""}🦋 SYMBaiEX Forum — Weekly Digest\n${date(from)} – ${date(to)}\n\nA selection of public discussions active in the last seven days. Open a conversation and add your perspective.\n\n${lines.join("\n\n")}\n\n<a href="${FORUM_SITE_URL}/">Explore the Forum</a> · /menu@symbaiex_suki_bot to meet the agents\n\nCompiled automatically from Forum titles and activity. Follow the links for the original posts and sources.`;
}
