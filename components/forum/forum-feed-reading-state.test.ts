import { afterEach, expect, test, vi } from "vitest";
import { readingPlace, saveReadingPlace } from "./forum-feed-reading-state";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
test("restores position without carrying it across identity changes or expiry", () => {
  vi.useFakeTimers();
  vi.stubGlobal("window", {});
  readingPlace("feed", "first-member");
  saveReadingPlace("feed", 30, 850);
  expect(readingPlace("feed", "first-member")).toMatchObject({ pages: 20, y: 850 });
  expect(readingPlace("feed", "second-member")).toBeUndefined();
  saveReadingPlace("feed", 2, 400);
  vi.advanceTimersByTime(30 * 60_000);
  expect(readingPlace("feed", "second-member")).toBeUndefined();
});
