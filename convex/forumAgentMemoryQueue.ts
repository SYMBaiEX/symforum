import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

type ForumAgentMemorySource = Pick<
  Doc<"forumThreads">,
  "title" | "body" | "categoryId"
>;

type ForumAgentMemoryScheduler = Pick<MutationCtx["scheduler"], "runAfter">;

export function forumAgentMemorySourceChanged(
  previous: ForumAgentMemorySource,
  next: ForumAgentMemorySource,
): boolean {
  return (
    previous.title !== next.title ||
    previous.body !== next.body ||
    previous.categoryId !== next.categoryId
  );
}

export async function enqueueForumAgentMemoryIndex(
  scheduler: ForumAgentMemoryScheduler,
  threadId: Id<"forumThreads">,
): Promise<void> {
  await scheduler.runAfter(0, internal.forumAgentMemory.indexForumThread, {
    threadId,
  });
}
