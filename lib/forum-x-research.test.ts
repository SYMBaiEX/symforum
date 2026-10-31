import { expect, test } from "vitest";
import { publicXResearchPosts } from "./forum-x-research";
const now = Date.UTC(2026, 9, 31, 12);
function response(protectedValue: unknown) {
  return {
    data: [
      {
        id: "2116000000000000001",
        author_id: "123",
        text: "Bagsapp announces $TEST launch on Solana",
        created_at: new Date(now - 1000).toISOString(),
      },
    ],
    includes: {
      users: [{ id: "123", username: "project", protected: protectedValue }],
    },
  };
}
test("accepts only explicitly public author evidence with real recent post dates", () => {
  expect(publicXResearchPosts(response(false), now)).toHaveLength(1);
  for (const protection of [true, undefined, "false", null])
    expect(publicXResearchPosts(response(protection), now)).toEqual([]);
  const bad = response(false);
  bad.data[0].created_at = new Date(now - 25 * 3600_000).toISOString();
  expect(publicXResearchPosts(bad, now)).toEqual([]);
  expect(
    publicXResearchPosts(
      { ...response(false), errors: [{ message: "partial" }] },
      now,
    ),
  ).toEqual([]);
  expect(
    publicXResearchPosts(
      { data: Array(11).fill(response(false).data[0]) },
      now,
    ),
  ).toEqual([]);
});
