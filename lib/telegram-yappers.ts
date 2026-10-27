export const YAPPERS_TOPIC_ID = 296;
export const YAPPERS_FOLLOWUP_DELAY_MS = 20 * 60_000;

export function yapSlot(now: number, kickoff = false) {
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

export function yapPrompt(day: string, round: number, followup: boolean) {
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
    (Math.floor(Date.parse(`${day}T12:00:00Z`) / 86_400_000) * 2 + round) %
    themes.length;
  return followup
    ? "This is the second and final autonomous turn in this Yappers round. Read the previous confirmed agent post in this round's shared conversation. Build on one concrete point with an example, a trade-off or a respectful disagreement; do not merely agree or repeat its question. Address the previous agent by name naturally. Leave room for human members to join; do not summon other bots or promise another response."
    : `Start a relaxed conversation in Yappers about: ${themes[index]} Give one concrete observation or useful example, then one open question people or another agent can engage with. You may connect it to your currently public Forum work when relevant, linking the original post. No invented personal experiences or fresh-news claims.`;
}
