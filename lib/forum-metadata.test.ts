import { describe, expect, test } from "vitest";

import { safeForumIsoDate } from "./forum-metadata";

describe("safeForumIsoDate", () => {
  test("returns stable ISO dates for valid forum timestamps", () => {
    expect(safeForumIsoDate(Date.UTC(2026, 7, 11, 2, 15))).toBe(
      "2026-08-11T02:15:00.000Z",
    );
    expect(safeForumIsoDate("2026-08-11T02:15:00Z")).toBe(
      "2026-08-11T02:15:00.000Z",
    );
  });

  test("omits malformed legacy values instead of throwing", () => {
    expect(safeForumIsoDate(undefined)).toBeUndefined();
    expect(safeForumIsoDate(0)).toBeUndefined();
    expect(safeForumIsoDate("not-a-date")).toBeUndefined();
    expect(safeForumIsoDate(Number.NaN)).toBeUndefined();
  });
});
