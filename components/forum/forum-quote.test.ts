import { describe, expect, test } from "vitest";

import { extractForumMentionUsernames } from "@/lib/forum-mentions";
import type { ForumPostRecord } from "./forum-refs";
import { buildPostQuote } from "./forum-quote";

function post(overrides: Partial<ForumPostRecord> = {}): ForumPostRecord {
  return {
    _id: "post-1",
    _creationTime: 1,
    threadId: "thread-1",
    categoryId: "category-1",
    authorId: "user-1",
    author: "Austin Hamilton",
    authorUsername: "austin",
    body: "Useful context.",
    status: "active",
    createdAt: 1,
    updatedAt: 1,
    viewerCanEdit: false,
    viewerCanDelete: false,
    viewerCanGiveReputation: false,
    viewerReputationScore: 0,
    ...overrides,
  };
}

describe("forum quote composer", () => {
  test("places the quoted member handle outside the quote block", () => {
    const quote = buildPostQuote(post());
    expect(quote).toBe(
      "@austin\n\n[quote=austin]\nUseful context.\n[/quote]\n\n",
    );
    expect(extractForumMentionUsernames(quote)).toEqual(["austin"]);
  });

  test("removes nested quotes before composing a reply", () => {
    expect(
      buildPostQuote(
        post({ body: "New point.\n\n[quote=older]\nOld point.\n[/quote]" }),
      ),
    ).toContain("[quote=austin]\nNew point.\n[/quote]");
  });

  test("does not invent a mention for legacy posts without a valid handle", () => {
    expect(
      buildPostQuote(
        post({ author: "Legacy Member", authorUsername: undefined }),
      ),
    ).toBe("[quote=Legacy Member]\nUseful context.\n[/quote]\n\n");
  });
});
