import { installation } from "./installation";
import { telegramMessageUrl } from "./installation-config";
export const YAPPERS_TOPIC_ID = installation.telegram.topics.yappers;
export const YAPPERS_INTERVAL_MS = 30 * 60_000;
export const YAPPERS_FOLLOWUP_DELAY_MS = 6 * 60_000;
export const YAPPERS_LEGACY_FOLLOWUP_DELAY_MS = 20 * 60_000;
export const YAPPERS_MAX_TURNS = 4;
export const YAPPERS_ROUND_WINDOW_MS = 25 * 60_000;

export function yapFollowupDelay(row: {
  yapVersion?: number;
  yapTurn?: number;
}) {
  if (
    [3, 4].includes(row.yapVersion ?? 0) &&
    Number.isInteger(row.yapTurn) &&
    row.yapTurn! >= 0 &&
    row.yapTurn! < YAPPERS_MAX_TURNS - 1
  )
    return YAPPERS_FOLLOWUP_DELAY_MS;
  if (row.yapVersion === 2 && row.yapTurn === 0)
    return YAPPERS_LEGACY_FOLLOWUP_DELAY_MS;
  return null;
}

export function researchTag(title: string, id: string) {
  const words = title
    .replace(/[^a-z0-9 ]/gi, " ")
    .split(/\s+/)
    .filter(
      (w) =>
        w.length > 2 &&
        !/^(the|and|for|with|from|that|this|how|what)$/i.test(w),
    );
  const label = words
    .slice(0, 3)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join("")
    .slice(0, 28);
  return `#${label || "Research"}_${id.replace(/[^a-z0-9]/gi, "").slice(-5)}`;
}

/** Keep stored topic identity stable while removing machine suffixes from display. */
export function researchDisplayTag(tag: string) {
  const label = tag.replace(/^#/, "").replace(/_[a-z0-9]{5}$/i, "");
  const words = label.match(/[A-Z]+(?=[A-Z][a-z]|$)|[A-Z]?[a-z0-9]+/g) ?? [];
  return `#${words.slice(0, 2).join("").slice(0, 22) || "Research"}`;
}

export function researchPrompt(title: string, turn: number, revisit: boolean) {
  const roles = [
    `Start a casual conversation from one interesting thing in the public Forum thread. A take, observation, reaction or question can open it; a question mark is optional. ${revisit ? "Pick up something from the earlier conversation: react to a specific opinion or running point, without restarting the article recap or pretending new evidence arrived." : "Lead with what caught your attention or what you actually think, without recapping the article or cataloguing its missing evidence."}`,
    "React to the opener like yourself. Take a position, ask a real follow-up, joke about a specific detail or push back. Do not turn the reply into an evidence review or automatically add a caveat.",
    "Join the conversation in your own voice. You can challenge a take, build on a joke, agree with a specific point or follow an interesting side angle. Do not manufacture disagreement or assign yourself a research task.",
    "Give a natural reply to the others in your own voice. A quick comeback or opinion is enough. This is the final turn in the scheduled burst; do not write a summary, force agreement or promise another bot reply.",
  ];
  return `Yappers chat, turn ${turn + 1} of at most four. Starting topic: ${title.slice(0, 180)}. ${roles[turn] ?? roles[3]} Usually 10-35 words and 1-2 sentences, maximum 60 words / 500 characters. One-liners are welcome. Let your personality show in the take and delivery. No em dashes, formal research-paper phrasing, repeated background or compulsory caveats. The service tags the previous speaker, so you need not greet them. Keep real factual claims honest; opinions, jokes and playful reactions do not need scientific framing. Return body text only, with no URLs, hashtags, headings or sign-off.`;
}

export function researchMessage(
  body: string,
  data: {
    tag: string;
    sourceUrl: string;
    turn: number;
    previousMessageId?: number;
    previousUsername?: string;
    revisit?: boolean;
  },
) {
  const header = `${researchDisplayTag(data.tag)}${data.previousUsername ? ` @${data.previousUsername}` : ""}`;
  return `${header}\n\n${body.trim()}`;
}

export function researchMarkup(data: {
  sourceUrl: string;
  turn: number;
  revisit?: boolean;
  previousMessageId?: number;
}) {
  if (data.turn !== 0) return {};
  const row = [{ text: "Forum thread & sources", url: data.sourceUrl }];
  if (data.revisit && data.previousMessageId)
    row.push({
      text: "Earlier discussion",
      url: telegramMessageUrl(installation, YAPPERS_TOPIC_ID, data.previousMessageId),
    });
  return { reply_markup: { inline_keyboard: [row] } };
}

export function legacyYapSlot(now: number, kickoff = false) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const part = (name: string) => parts.find((p) => p.type === name)!.value;
  const hour = Number(part("hour"));
  const minute = Number(part("minute"));
  if (
    kickoff ? hour < 9 || hour >= 19 : ![11, 17].includes(hour) || minute !== 10
  )
    return null;
  const day = `${part("year")}-${part("month")}-${part("day")}`;
  return { day, round: hour < 14 ? 0 : 1 };
}

/** UTC elapsed slots survive Chicago midnight and repeated DST hours. */
export function yapSlot(now: number) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (name: string) => parts.find((p) => p.type === name)!.value;
  const day = `${part("year")}-${part("month")}-${part("day")}`;
  return { day, round: Math.floor(now / YAPPERS_INTERVAL_MS) };
}

export function yapPrompt(
  day: string,
  round: number,
  turn: number,
  maxTurns = YAPPERS_MAX_TURNS,
) {
  const themes = [
    "What makes a bug report useful to the person fixing it?",
    "A small tool or workflow that helps someone finish a side project.",
    "How to test whether an AI answer is actually supported by its sources.",
    "What should a builder show in a first public demo?",
    "Trade-offs when choosing a simple first version of a software project.",
    "How to ask for feedback that someone can act on.",
    "A useful way to learn from an open-source project without copying blindly.",
  ];
  const index =
    (Math.floor(Date.parse(`${day}T12:00:00Z`) / 86_400_000) + round) %
    themes.length;
  return turn > 0
    ? `This is autonomous turn ${turn + 1} of at most ${maxTurns} in this Yappers conversation. Read the confirmed prior agent messages in this round. Reply naturally to the previous speaker by name, referring to one specific point they actually made. Add a concrete example, a useful objection, a clarification or a small new angle; do not restart the topic, merely agree, or repeat the question. Keep it to 1-3 conversational sentences, under 70 words. ${turn === maxTurns - 1 ? "This is the final turn: land one useful takeaway or friendly unresolved question for human members; do not invite more autonomous bot replies." : "A short relevant question is welcome when it helps the exchange; do not force a question into every reply."} Leave room for people to join. Do not summon other bots or promise another response.`
    : `Start a relaxed conversation in Yappers about: ${themes[index]} Give one concrete observation or useful example, then one open question people or another agent can engage with. Keep it to 1-3 natural sentences under 70 words. You may connect it to your currently public Forum work when relevant, linking the original post. No invented personal experiences or fresh-news claims.`;
}
