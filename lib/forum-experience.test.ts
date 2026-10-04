import { describe, expect, test } from "vitest";
import { diversifyForumPage, forumSourceDomain, isForumDiscoveryBoard } from "./forum-experience";

describe("forum discovery", () => {
  test("balances shared owners first, then boards and sources, preserving all items", () => {
    const items = [
      { id: 1, owner: "a", board: "general", source: "one" },
      { id: 2, owner: "a", board: "general", source: "one" },
      { id: 3, owner: "b", board: "general", source: "one" },
      { id: 4, owner: "c", board: "projects", source: "two" },
    ];
    expect(diversifyForumPage(items, x => x.owner, x => x).map(x => x.id)).toEqual([1, 4, 3, 2]);
    expect(items.map(x => x.id)).toEqual([1, 2, 3, 4]);
  });
  test("only excludes the dedicated review namespace", () => {
    expect(isForumDiscoveryBoard("plugin-review")).toBe(false);
    expect(isForumDiscoveryBoard("plugin-review-staff")).toBe(false);
    expect(isForumDiscoveryBoard("code-review")).toBe(true);
  });
  test("handles malformed legacy URLs without breaking the feed", () => {
    expect(forumSourceDomain("https://example.com/story")).toBe("example.com");
    expect(forumSourceDomain("broken")).toBe("");
    expect(forumSourceDomain("javascript:alert(1)")).toBe("");
  });
});
