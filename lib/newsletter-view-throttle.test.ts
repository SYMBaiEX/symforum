import { describe, expect, it } from "vitest";
import {
  claimNewsletterViewAttempt,
  releaseNewsletterViewAttempt,
} from "./newsletter-view-throttle";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

describe("newsletter view request throttle", () => {
  it("suppresses same-issue calls for the server dedupe window", () => {
    const storage = memoryStorage();
    const start = 1_800_000_000_000;

    expect(claimNewsletterViewAttempt(storage, "weekly-1", start)).toBe(true);
    expect(
      claimNewsletterViewAttempt(storage, "weekly-1", start + 30 * 60_000),
    ).toBe(false);
    expect(
      claimNewsletterViewAttempt(storage, "weekly-1", start + 60 * 60_000),
    ).toBe(true);
  });

  it("keeps a bounded cross-issue window and suppresses interleaved repeats", () => {
    const storage = memoryStorage();
    const start = 1_800_000_000_000;

    expect(claimNewsletterViewAttempt(storage, "issue-a", start)).toBe(true);
    expect(claimNewsletterViewAttempt(storage, "issue-b", start + 1)).toBe(
      true,
    );
    expect(claimNewsletterViewAttempt(storage, "issue-a", start + 2)).toBe(
      false,
    );
    const stored = JSON.parse(
      storage.getItem("symbaiex.newsletter.recent-views") ?? "[]",
    ) as unknown[];
    expect(stored).toHaveLength(2);
  });

  it("fails open when storage is unavailable or malformed", () => {
    expect(claimNewsletterViewAttempt(null, "issue-a", 10)).toBe(true);

    const storage = memoryStorage();
    storage.setItem("symbaiex.newsletter.recent-views", "{broken");
    expect(claimNewsletterViewAttempt(storage, "issue-a", 10)).toBe(true);
  });

  it("releases only the failed attempt it owns", () => {
    const storage = memoryStorage();
    const firstAttempt = 100;

    claimNewsletterViewAttempt(storage, "issue-a", firstAttempt);
    claimNewsletterViewAttempt(storage, "issue-b", firstAttempt + 1);
    releaseNewsletterViewAttempt(storage, "issue-a", firstAttempt);
    expect(
      claimNewsletterViewAttempt(storage, "issue-a", firstAttempt + 2),
    ).toBe(true);
    expect(
      claimNewsletterViewAttempt(storage, "issue-b", firstAttempt + 3),
    ).toBe(false);
  });
});
