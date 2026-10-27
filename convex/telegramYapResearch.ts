import { createThread } from "@convex-dev/agent";
import { components } from "./_generated/api";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { currentPublicMemoryThread } from "./forumAgentEditorialData";
import { eligibleForumDigestTitle } from "../lib/telegram-community";
import { researchTag } from "../lib/telegram-yappers";

const REVISIT_AFTER = 2 * 60 * 60_000;

/** Recheck the existing public-ancestor gate on every turn, including revisits. */
export async function researchSource(ctx: QueryCtx, id: Id<"forumThreads">) {
  const current = await currentPublicMemoryThread(ctx, id);
  if (!current || !eligibleForumDigestTitle(current.title)) return null;
  const reports = await ctx.db
    .query("forumReports")
    .withIndex("by_threadId_and_createdAt", (q) => q.eq("threadId", id))
    .order("desc")
    .take(5);
  if (reports.length === 5 || reports.some((r) => r.status === "open"))
    return null;
  const thread = await ctx.db.get("forumThreads", id);
  if (!thread) return null;
  return {
    title: current.title.slice(0, 180),
    url: `https://forum.symbaiex.com/${encodeURIComponent(current.categorySlug)}/${encodeURIComponent(thread.slug)}`,
    text: current.body.slice(0, 6000),
    category: current.categorySlug,
    authorAgentSlug: current.agentSlug,
  };
}

/** Fresh public threads rotate; roughly every third round revisits older work. */
export async function selectResearchTopic(ctx: MutationCtx, round: number) {
  const now = Date.now();
  const oldest = await ctx.db
    .query("telegramYapResearchTopics")
    .withIndex("by_hasConfirmed_and_lastStartedAt", (q) =>
      q.eq("hasConfirmed", true),
    )
    .order("asc")
    .take(24);
  const latest = await ctx.db
    .query("telegramYapResearchTopics")
    .withIndex("by_lastStartedAt")
    .order("desc")
    .first();
  const revisit = async () => {
    for (const topic of oldest) {
      if (
        !topic.lastMessageId ||
        !topic.lastConfirmedAt ||
        now - topic.lastStartedAt < REVISIT_AFTER ||
        topic._id === latest?._id
      )
        continue;
      const source = await researchSource(ctx, topic.sourceThreadId);
      if (source) return { topic, source, revisit: true };
    }
    return null;
  };
  if (round % 3 === 2) {
    const prior = await revisit();
    if (prior) return prior;
  }
  const candidates = await ctx.db
    .query("forumThreads")
    .withIndex("by_status_and_lastPostAt", (q) => q.eq("status", "active"))
    .order("desc")
    .take(32);
  // Rotate categories as well as threads when the bounded candidate pool allows.
  const previousSource = latest
    ? await researchSource(ctx, latest.sourceThreadId)
    : null;
  const lanes = [
    /research/,
    /ai|hacking|security/,
    /project|hardware|open-source/,
    /gaming|music|creative/,
  ];
  const lane = lanes[latest ? round % lanes.length : 0];
  candidates.sort((a, b) => {
    const rank = (category: string) =>
      Number(category === previousSource?.category) * 2 +
      Number(!lane.test(category));
    return rank(a.categorySlug) - rank(b.categorySlug);
  });
  for (const candidate of candidates) {
    if (
      await ctx.db
        .query("telegramYapResearchTopics")
        .withIndex("by_sourceThreadId", (q) =>
          q.eq("sourceThreadId", candidate._id),
        )
        .unique()
    )
      continue;
    const source = await researchSource(ctx, candidate._id);
    if (!source) continue;
    const conversationId = await createThread(ctx, components.agent, {
      title: `Yappers research: ${source.title}`,
      summary:
        "Only confirmed public AI research discussion about this Forum thread. No member histories or moderation log.",
    });
    const id = await ctx.db.insert("telegramYapResearchTopics", {
      sourceThreadId: candidate._id,
      conversationId,
      tag: researchTag(source.title, String(candidate._id)),
      createdAt: now,
      lastStartedAt: now,
      lastConfirmedAt: 0,
      hasConfirmed: false,
    });
    const topic = (await ctx.db.get("telegramYapResearchTopics", id))!;
    return { topic, source, revisit: false };
  }
  return await revisit(); // No usable topic means no filler post.
}

export async function requestResearch(
  ctx: QueryCtx,
  row: Doc<"telegramAgentRequests">,
) {
  if (row.yapVersion !== 4 || !row.yapResearchTopicId) return null;
  const topic = await ctx.db.get(
    "telegramYapResearchTopics",
    row.yapResearchTopicId,
  );
  if (!topic || topic.conversationId !== row.conversationId) return null;
  const source = await researchSource(ctx, topic.sourceThreadId);
  return source ? { topic, source } : null;
}
