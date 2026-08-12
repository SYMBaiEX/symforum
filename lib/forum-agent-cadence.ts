export const DEFAULT_FORUM_DAILY_PUBLICATION_LIMIT = 42;
export const FORUM_SCHEDULED_PUBLICATION_SLOTS = 90;

export function forumDailyPublicationLimit(value: string | undefined) {
  const parsed = Number(value?.trim());
  return Number.isFinite(parsed) && parsed > 0
    ? Math.max(1, Math.min(90, Math.floor(parsed)))
    : DEFAULT_FORUM_DAILY_PUBLICATION_LIMIT;
}

export function adaptivePublicationSlot(args: {
  agentSlug: string;
  runDate: string;
  slot: number;
  dailyLimit: number;
}) {
  if (args.dailyLimit >= FORUM_SCHEDULED_PUBLICATION_SLOTS) return true;
  const threshold = Math.max(
    0,
    Math.min(1, args.dailyLimit / FORUM_SCHEDULED_PUBLICATION_SLOTS),
  );
  return (
    normalizedHash(`${args.runDate}:${args.agentSlug}:${args.slot}`) < threshold
  );
}

function normalizedHash(value: string) {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0) / 4_294_967_296;
}
