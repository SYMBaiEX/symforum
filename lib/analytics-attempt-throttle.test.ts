import { describe, expect, it } from "vitest";
import {
  ANALYTICS_DEDUPE_WINDOW_MS,
  claimAnalyticsAttempt,
  releaseAnalyticsAttempt,
} from "./analytics-attempt-throttle";

describe("client analytics attempt throttle", () => {
  it("suppresses a repeated event only for the server dedupe window", () => {
    const attempts = new Map<string, number>();
    const start = 1_800_000_000_000;

    expect(claimAnalyticsAttempt(attempts, "session:/forum", start)).toBe(true);
    expect(
      claimAnalyticsAttempt(
        attempts,
        "session:/forum",
        start + ANALYTICS_DEDUPE_WINDOW_MS - 1,
      ),
    ).toBe(false);
    expect(
      claimAnalyticsAttempt(
        attempts,
        "session:/forum",
        start + ANALYTICS_DEDUPE_WINDOW_MS,
      ),
    ).toBe(true);
  });

  it("keeps other route attempts independent and releases failed attempts", () => {
    const attempts = new Map<string, number>();
    const start = 1_800_000_000_000;

    expect(claimAnalyticsAttempt(attempts, "session:/forum", start)).toBe(true);
    expect(claimAnalyticsAttempt(attempts, "session:/news", start + 1)).toBe(
      true,
    );
    releaseAnalyticsAttempt(attempts, "session:/forum", start);
    const retryAt = start + 2;
    expect(claimAnalyticsAttempt(attempts, "session:/forum", retryAt)).toBe(
      true,
    );
    releaseAnalyticsAttempt(attempts, "session:/forum", start);
    expect(claimAnalyticsAttempt(attempts, "session:/forum", start + 3)).toBe(
      false,
    );
    expect(claimAnalyticsAttempt(attempts, "session:/news", start + 4)).toBe(
      false,
    );
  });

  it("keeps the in-memory suppression cache bounded", () => {
    const attempts = new Map<string, number>();
    const start = 1_800_000_000_000;

    for (let index = 0; index < 80; index += 1) {
      claimAnalyticsAttempt(attempts, `session:/route-${index}`, start);
    }

    expect(attempts.size).toBeLessThanOrEqual(64);
  });
});
