import { describe, expect, test, vi } from "vitest";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import {
  enqueueForumAgentMemoryIndex,
  forumAgentMemorySourceChanged,
} from "./forumAgentMemoryQueue";

const categoryA = "forumCategories:category-a" as Id<"forumCategories">;
const categoryB = "forumCategories:category-b" as Id<"forumCategories">;

describe("forum agent memory reindex scheduling", () => {
  test("only source title, body, or category changes require a reindex", () => {
    const source = { title: "Title", body: "Body", categoryId: categoryA };

    expect(forumAgentMemorySourceChanged(source, { ...source })).toBe(false);
    expect(
      forumAgentMemorySourceChanged(source, { ...source, title: "New title" }),
    ).toBe(true);
    expect(
      forumAgentMemorySourceChanged(source, { ...source, body: "New body" }),
    ).toBe(true);
    expect(
      forumAgentMemorySourceChanged(source, {
        ...source,
        categoryId: categoryB,
      }),
    ).toBe(true);
  });

  test("enqueues the internal index action without calling a provider", async () => {
    const threadId = "forumThreads:thread-a" as Id<"forumThreads">;
    const runAfter = vi.fn().mockResolvedValue("scheduled");
    const scheduler = { runAfter } as unknown as Pick<
      MutationCtx["scheduler"],
      "runAfter"
    >;

    await enqueueForumAgentMemoryIndex(scheduler, threadId);

    expect(runAfter).toHaveBeenCalledExactlyOnceWith(
      0,
      internal.forumAgentMemory.indexForumThread,
      { threadId },
    );
  });
});
