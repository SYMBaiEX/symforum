import { describe, expect, test } from "vitest";
import {
  categoryIsReadOnlyInGraph,
  focusDigestStories,
  forumFocusPillarForText,
} from "./forum-taxonomy";

describe("readable archive ancestry", () => {
  test("inherits read-only state without changing visibility or slugs", () => {
    const root = { _id: "archive", readOnlyArchive: true };
    const child = { _id: "projects", parentCategoryId: "archive" };
    const grandchild = {
      _id: "build-logs",
      parentCategoryId: "projects",
      readOnlyArchive: false,
    };
    const graph = new Map(
      [root, child, grandchild].map((category) => [category._id, category]),
    );
    expect(categoryIsReadOnlyInGraph(grandchild, graph)).toBe(true);
    expect(grandchild.readOnlyArchive).toBe(false);
    expect(categoryIsReadOnlyInGraph({ _id: "ai" }, graph)).toBe(false);
  });
  test("missing and cyclic ancestry fail closed for writes", () => {
    expect(
      categoryIsReadOnlyInGraph(
        { _id: "child", parentCategoryId: "missing" },
        new Map(),
      ),
    ).toBe(true);
    const cycle = { _id: "cycle", parentCategoryId: "cycle" };
    expect(categoryIsReadOnlyInGraph(cycle, new Map([["cycle", cycle]]))).toBe(
      true,
    );
  });
});

describe("five-pillar source focus", () => {
  test.each([
    ["Solana stablecoin integration", "crypto"],
    ["CVE-2026-1234 security advisory", "hacking"],
    ["OpenAI releases a language model", "ai"],
    ["Godot game engine release", "gaming"],
    ["Bandcamp album production notes", "music"],
    ["A city council election", null],
  ])("classifies %s conservatively", (text, expected) =>
    expect(forumFocusPillarForText(text!)).toBe(expected),
  );
  test("keeps a coherent existing-size digest and original ordering", () => {
    const stories = [
      { title: "Local election results", rank: 1 },
      ...Array.from({ length: 7 }, (_, index) => ({
        title: `OpenAI language model release ${index}`,
        rank: index + 2,
      })),
      { title: "Solana product launch", rank: 10 },
    ];
    const focused = focusDigestStories(stories, 5);
    expect(focused?.board).toBe("ai");
    expect(focused?.stories.map((story) => story.rank)).toEqual([
      2, 3, 4, 5, 6,
    ]);
    expect(stories).toHaveLength(9);
    expect(focusDigestStories(stories.slice(0, 3), 5)).toBeNull();
    expect(focusDigestStories(stories, 0)).toBeNull();
    expect(
      focusDigestStories(
        [
          ...Array.from({ length: 5 }, (_, index) => ({
            title: `Solana integration ${index}`,
          })),
          ...Array.from({ length: 5 }, (_, index) => ({
            title: `OpenAI release ${index}`,
          })),
        ],
        5,
      )?.board,
    ).toBe("crypto");
  });
});
