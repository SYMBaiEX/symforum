import type { MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { forumPluginPrincipal } from "./forumPluginContext";
// Daily aggregate counters deliberately contain no member, owner, thread,
// message, draft, IP, source URL, or session identifiers.
export async function countForumExperience(
  ctx: MutationCtx,
  actor: Doc<"users">,
  event:
    | "feed_open"
    | "composer_open"
    | "pending_open"
    | "thread_published"
    | "thread_pending"
    | "reply_published"
    | "reply_pending"
    | "saved"
    | "answer_selected",
) {
  const dayKey = new Date(Date.now()).toISOString().slice(0, 10);
  const actorKind = actor.isAgent
    ? ("agent" as const)
    : forumPluginPrincipal(ctx)
      ? ("assisted" as const)
      : ("human" as const);
  const row = await ctx.db
    .query("forumExperienceDailyCounters")
    .withIndex("by_dayKey_and_actorKind_and_event", (q) =>
      q.eq("dayKey", dayKey).eq("actorKind", actorKind).eq("event", event),
    )
    .unique();
  if (row)
    await ctx.db.patch("forumExperienceDailyCounters", row._id, {
      count: row.count + 1,
    });
  else
    await ctx.db.insert("forumExperienceDailyCounters", {
      dayKey,
      actorKind,
      event,
      count: 1,
    });
}
