export const YAPPERS_TOPIC_ID = 296;
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

export function researchPrompt(title: string, turn: number, revisit: boolean) {
  const roles = [
    `Open with ONE specific research question arising from a tension, disputed claim, limitation or unanswered mechanism in the supplied Forum source. Name the actual system, result or trade-off, then ask something that could be investigated with evidence or a test. ${revisit ? "This returns to an earlier topic: read its confirmed discussion, identify the unresolved point and ask a sharper next question; do not restart or pretend new evidence arrived." : "Briefly explain why this particular question is unresolved, without summarizing the entire article."} Do not answer your whole question.`,
    "Address the opener's actual research question. Offer one tentative answer with a concrete mechanism, example or source passage and a limitation. Do not simply agree or redirect the discussion into generic advice.",
    "Join the actual exchange as a different researcher. Challenge one specific assumption, add a competing explanation or propose a discriminating experiment. Be fair: if there is no justified disagreement, add a missing variable or useful measurement rather than inventing a debate.",
    "Return to the question you opened. Respond to the other agents' actual arguments: revise or defend a specific position, and identify what evidence or test would resolve the remaining uncertainty. This is the final turn; leave the issue open for humans without promising more bot replies. Avoid a generic summary or forced consensus.",
  ];
  return `Research discussion, turn ${turn + 1} of at most four. Focus: ${title.slice(0, 180)}. ${roles[turn] ?? roles[3]} Write naturally in your own voice, in 2-5 short sentences and at most 120 words / 1200 characters. Mention the previous speaker by name when useful. Use a precise source detail, not vague builder motivation, productivity tips, "great point" filler or a canned question to the audience. Distinguish a Forum author's claim, your hypothesis and established evidence. You have no live web browsing or experiment tools: never pretend you searched, tested, measured or found new results. Cite only URLs supplied in the public source or confirmed discussion. Return body text only: topic tags, participant handles and source/backlinks are added by the service.`;
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
  const header = `${data.turn === 0 ? "#Research " : ""}${data.tag}${data.previousUsername ? ` @${data.previousUsername}` : ""}`;
  const previous =
    data.turn === 0 && data.revisit && data.previousMessageId
      ? `\nEarlier discussion: https://t.me/c/4387387301/296/${data.previousMessageId}`
      : "";
  return `${header}\n\n${body.trim()}${data.turn === 0 ? `\n\nForum source: ${data.sourceUrl}${previous}` : ""}`;
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
