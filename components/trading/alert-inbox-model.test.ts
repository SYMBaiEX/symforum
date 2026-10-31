import { expect, test } from "vitest";
import { loadedAlertInbox } from "./alert-inbox-model";
import type { TokenAlert } from "./terminal-api";
const row = (
  id: string,
  direction: "above" | "below",
  acknowledged = false,
): TokenAlert => ({
  id,
  mint: id,
  symbol: "DUP",
  direction,
  acknowledged,
  thresholdUsd: 1,
  priceUsd: 2,
  observedAt: 1,
});
test("loading is not an empty or read sample", () => {
  expect(loadedAlertInbox(undefined, "all")).toBeNull();
  expect(loadedAlertInbox([], "below")).toEqual({
    loadedCount: 0,
    unread: [],
    read: [],
    visibleUnread: [],
  });
});
test("filters only unread directions and preserves original exact mint records and order", () => {
  const a = row("AbCase", "above"),
    b = row("abCase", "below"),
    c = row("read", "above", true);
  const alerts = Object.freeze([a, b, c]);
  expect(loadedAlertInbox(alerts, "all")?.visibleUnread).toEqual([a, b]);
  expect(loadedAlertInbox(alerts, "above")?.visibleUnread).toEqual([a]);
  expect(loadedAlertInbox(alerts, "below")?.visibleUnread).toEqual([b]);
  expect(loadedAlertInbox(alerts, "below")?.read).toEqual([c]);
  expect(alerts).toEqual([a, b, c]);
});
test("no matching direction does not turn a nonempty unread sample into no unread alerts", () => {
  const result = loadedAlertInbox(
    [row("one", "above"), row("two", "below", true)],
    "below",
  )!;
  expect(result.loadedCount).toBe(2);
  expect(result.unread).toHaveLength(1);
  expect(result.visibleUnread).toHaveLength(0);
  expect(result.read).toHaveLength(1);
});
