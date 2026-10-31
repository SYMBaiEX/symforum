import { MAX_PROMOTION_LANES, MAX_PROMOTION_QUEUE_MS } from "./forum-commerce";

export const PROMOTION_HOUR = 3_600_000;
export const MAX_PROMOTION_SELECTIONS = 5;
export type PromotionSlot = { lane: number; startsAt: number; endsAt: number };
export const overlapsPromotion = (
  a: Pick<PromotionSlot, "startsAt" | "endsAt">,
  b: Pick<PromotionSlot, "startsAt" | "endsAt">,
) => a.startsAt < b.endsAt && b.startsAt < a.endsAt;

/** Exact, future intervals. Never shift a paid selection to another date. */
export function selectedPromotionSlots(
  now: number,
  starts: readonly number[],
  duration: number,
  inventory: readonly PromotionSlot[],
  leadMs = 0,
): PromotionSlot[] {
  if (
    !Number.isSafeInteger(now) ||
    !Number.isSafeInteger(duration) ||
    duration <= 0 ||
    duration > MAX_PROMOTION_QUEUE_MS ||
    !starts.length ||
    starts.length > MAX_PROMOTION_SELECTIONS ||
    new Set(starts).size !== starts.length
  )
    throw Error("Choose between one and five different promotion slots.");
  const sorted = [...starts].sort((a, b) => a - b);
  const chosen: PromotionSlot[] = [];
  for (const startsAt of sorted) {
    if (
      !Number.isSafeInteger(startsAt) ||
      startsAt % PROMOTION_HOUR !== 0 ||
      startsAt < now + leadMs ||
      startsAt > now + MAX_PROMOTION_QUEUE_MS
    )
      throw Error(
        "A selected start time is no longer available. Refresh the calendar.",
      );
    const slot = { lane: 0, startsAt, endsAt: startsAt + duration };
    if (chosen.some((s) => overlapsPromotion(s, slot)))
      throw Error("Selected placements for the same post cannot overlap.");
    let lane = -1;
    for (let i = 0; i < MAX_PROMOTION_LANES; i++) {
      if (!inventory.some((s) => s.lane === i && overlapsPromotion(s, slot))) {
        lane = i;
        break;
      }
    }
    if (lane < 0)
      throw Error(
        "A selected slot was just booked. Choose another start time.",
      );
    chosen.push({ ...slot, lane });
  }
  return chosen;
}

export function promotionCalendarSlots(
  now: number,
  duration: number,
  inventory: readonly PromotionSlot[],
  leadMs: number,
) {
  const first =
    Math.ceil((now + leadMs + 60_000) / PROMOTION_HOUR) * PROMOTION_HOUR;
  const result: { startsAt: number; endsAt: number; remaining: number }[] = [];
  for (
    let startsAt = first;
    startsAt <= now + MAX_PROMOTION_QUEUE_MS;
    startsAt += PROMOTION_HOUR
  ) {
    const slot = { startsAt, endsAt: startsAt + duration };
    let remaining = 0;
    for (let lane = 0; lane < MAX_PROMOTION_LANES; lane++)
      if (!inventory.some((s) => s.lane === lane && overlapsPromotion(s, slot)))
        remaining++;
    result.push({ ...slot, remaining });
  }
  return result;
}
