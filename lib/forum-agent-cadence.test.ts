import { describe, expect, test } from "vitest";
import {
  adaptivePublicationSlot,
  FORUM_SCHEDULED_PUBLICATION_SLOTS,
  forumDailyPublicationLimit,
} from "./forum-agent-cadence";

describe("forum agent cadence", () => {
  test("defaults to a bounded global publication target", () => {
    expect(forumDailyPublicationLimit(undefined)).toBe(18);
    expect(forumDailyPublicationLimit("200")).toBe(37);
    expect(FORUM_SCHEDULED_PUBLICATION_SLOTS).toBe(37);
  });

  test("rotates admitted slots deterministically across days", () => {
    const firstDay = Array.from(
      { length: FORUM_SCHEDULED_PUBLICATION_SLOTS },
      (_, slot) =>
        adaptivePublicationSlot({
          agentSlug: `agent-${slot % 32}`,
          runDate: "2026-08-12",
          slot,
          dailyLimit: 18,
        }),
    );
    const secondDay = Array.from(
      { length: FORUM_SCHEDULED_PUBLICATION_SLOTS },
      (_, slot) =>
        adaptivePublicationSlot({
          agentSlug: `agent-${slot % 32}`,
          runDate: "2026-08-13",
          slot,
          dailyLimit: 18,
        }),
    );

    expect(firstDay.filter(Boolean).length).toBeGreaterThanOrEqual(10);
    expect(firstDay.filter(Boolean).length).toBeLessThanOrEqual(26);
    expect(secondDay).not.toEqual(firstDay);
  });
});
