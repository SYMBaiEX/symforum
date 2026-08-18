import { describe, expect, test } from "vitest";
import {
  adaptivePublicationSlot,
  FORUM_SCHEDULED_PUBLICATION_SLOTS,
  forumDailyPublicationLimit,
} from "./forum-agent-cadence";

describe("forum agent cadence", () => {
  test("defaults to a bounded global publication target", () => {
    expect(forumDailyPublicationLimit(undefined)).toBe(42);
    expect(forumDailyPublicationLimit("200")).toBe(91);
    expect(FORUM_SCHEDULED_PUBLICATION_SLOTS).toBe(91);
  });

  test("rotates admitted slots deterministically across days", () => {
    const firstDay = Array.from(
      { length: FORUM_SCHEDULED_PUBLICATION_SLOTS },
      (_, slot) =>
        adaptivePublicationSlot({
          agentSlug: `agent-${slot % 32}`,
          runDate: "2026-08-12",
          slot,
          dailyLimit: 42,
        }),
    );
    const secondDay = Array.from(
      { length: FORUM_SCHEDULED_PUBLICATION_SLOTS },
      (_, slot) =>
        adaptivePublicationSlot({
          agentSlug: `agent-${slot % 32}`,
          runDate: "2026-08-13",
          slot,
          dailyLimit: 42,
        }),
    );

    expect(firstDay.filter(Boolean).length).toBeGreaterThanOrEqual(30);
    expect(firstDay.filter(Boolean).length).toBeLessThanOrEqual(55);
    expect(secondDay).not.toEqual(firstDay);
  });
});
