import { expect, test } from "vitest";
import type { ResearchState } from "@/lib/forum-research";
import {
  researchReceiptView,
  type ReceiptFilter,
} from "./research-receipt-view";
const row = (state: ResearchState, intentKey: string = state) => ({
  state,
  intentKey,
  mint: "ExactCaseMint",
  expiresAt: 200,
});
const rows = (
  [
    "unknown",
    "verifying",
    "settlement_claimed",
    "fulfilled",
    "quoted",
    "rejected",
    "expired",
  ] as const
).map((state) => row(state));
test.each([
  "all",
  "fulfilled",
  "quoted",
  "expired",
  "rejected",
] as ReceiptFilter[])(
  "%s never hides protected attempts even without a search match",
  (filter) => {
    const view = researchReceiptView(rows, "no-match", filter, 100);
    expect(view.pinned.map((item) => item.state)).toEqual([
      "unknown",
      "verifying",
      "settlement_claimed",
    ]);
    expect(view.matches).toEqual([]);
    expect(view.loaded).toBe(7);
    expect(view.shown).toBe(3);
    expect(view.pinnedSearchMatches).toBe(0);
  },
);
test("status applies only to other loaded receipts and expiry uses the existing supplied clock", () => {
  expect(
    researchReceiptView(rows, "", "fulfilled", 100).matches.map(
      (item) => item.state,
    ),
  ).toEqual(["fulfilled"]);
  expect(
    researchReceiptView(rows, "", "quoted", 199).matches.map(
      (item) => item.state,
    ),
  ).toEqual(["quoted"]);
  expect(researchReceiptView(rows, "", "quoted", 200).matches).toEqual([]);
  expect(
    researchReceiptView(rows, "", "expired", 200).matches.map(
      (item) => item.state,
    ),
  ).toEqual(["quoted", "expired"]);
});
test("mint search is original-case; receipt IDs are searchable without ticker invention", () => {
  expect(researchReceiptView(rows, "ExactCase", "all", 100).shown).toBe(7);
  expect(researchReceiptView(rows, "exactcase", "all", 100).shown).toBe(3);
  const view = researchReceiptView(
    [row("fulfilled", "abc123")],
    "ABC123",
    "all",
    100,
  );
  expect(view.matches).toHaveLength(1);
});
test("dedupes loaded intents conservatively without mutating records or input ordering", () => {
  const input = Object.freeze([
    Object.freeze(row("fulfilled", "same")),
    Object.freeze(row("unknown", "same")),
    ...rows,
  ]);
  const before = JSON.stringify(input);
  const view = researchReceiptView(input, "", "all", 100);
  expect(view.loaded).toBe(8);
  expect(view.pinned.filter((item) => item.intentKey === "same")).toHaveLength(
    1,
  );
  expect(view.matches.some((item) => item.intentKey === "same")).toBe(false);
  expect(JSON.stringify(input)).toBe(before);
});
test("zero loaded is not a claim about all owner history", () => {
  expect(researchReceiptView([], "", "all", 100)).toEqual({
    pinned: [],
    matches: [],
    loaded: 0,
    shown: 0,
    pinnedSearchMatches: 0,
  });
});
