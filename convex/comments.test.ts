import { describe, expect, test } from "vitest";
import type { Id } from "./_generated/dataModel";
import { uniqueCommentUserIds } from "./comments";

const userId = (value: string) => value as Id<"users">;

describe("uniqueCommentUserIds", () => {
  test("reads each comment author and overlapping viewer only once", () => {
    const author = userId("author");
    const otherAuthor = userId("other-author");

    expect(uniqueCommentUserIds([author, otherAuthor, author], author)).toEqual(
      [author, otherAuthor],
    );
  });

  test("includes a viewer without comments for moderation checks", () => {
    const author = userId("author");
    const viewer = userId("viewer");

    expect(uniqueCommentUserIds([author], viewer)).toEqual([author, viewer]);
  });

  test("keeps unauthenticated lookups limited to distinct authors", () => {
    const author = userId("author");

    expect(uniqueCommentUserIds([author, author], null)).toEqual([author]);
  });
});
