import { expect, test } from "vitest";
import {
  selectedPromotionSlots,
  promotionCalendarSlots,
  PROMOTION_HOUR as HOUR,
} from "./promotion-calendar";
const now = Date.parse("2026-10-31T19:00:00Z"),
  day = 24 * HOUR;
test("selected dates are exact, nonoverlapping and independently allocated", () => {
  const start = now + HOUR;
  const inventory = [{ lane: 0, startsAt: start, endsAt: start + day }];
  expect(
    selectedPromotionSlots(now, [start + 2 * day, start], day, inventory),
  ).toEqual([
    { lane: 1, startsAt: start, endsAt: start + day },
    { lane: 0, startsAt: start + 2 * day, endsAt: start + 3 * day },
  ]);
  expect(() =>
    selectedPromotionSlots(now, [start, start + HOUR], day, []),
  ).toThrow("overlap");
  expect(() => selectedPromotionSlots(now, [start, start], day, [])).toThrow(
    "different",
  );
  expect(() => selectedPromotionSlots(now, [now - HOUR], day, [])).toThrow(
    "no longer",
  );
});
test("a sixth concurrent placement is refused atomically, not moved to another day", () => {
  const start = now + HOUR;
  const inventory = Array.from({ length: 5 }, (_, lane) => ({
    lane,
    startsAt: start,
    endsAt: start + day,
  }));
  expect(() =>
    selectedPromotionSlots(now, [start, start + 2 * day], day, inventory),
  ).toThrow("just booked");
  const slots = promotionCalendarSlots(now, day, inventory, 600_000);
  expect(slots.find((s) => s.startsAt === start)?.remaining).toBe(0);
  expect(slots.find((s) => s.startsAt === start + day)?.remaining).toBe(5);
});
test("UTC intervals stay exactly 24 hours across the daylight-saving change", () => {
  const start = Date.parse("2026-11-01T06:00:00Z");
  const [slot] = selectedPromotionSlots(now, [start], day, []);
  expect(slot.endsAt - slot.startsAt).toBe(day);
  expect(promotionCalendarSlots(now, day, [], 600_000)).toHaveLength(168);
});
