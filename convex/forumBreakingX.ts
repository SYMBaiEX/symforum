import { createThread } from "@convex-dev/agent";
import { components } from "./_generated/api";
import { v } from "convex/values";
import { newsPriority, primarySolanaSource } from "../lib/forum-breaking-news";
import { alphaShareText } from "../lib/forum-alpha-editorial";
import { X_ACTIVITY_SCOPES, validXDraft } from "../lib/x-agent-policy";
import { internalMutation, env, type MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import {
  installation,
  installationBinding,
  installationMatches,
} from "./installation";
import { researchSource } from "./telegramYapResearch";

/** Breaking news joins NyX's existing delivery worker and shared original/action
 * quotas. No second token refresher, posting loop, inference or retry path. */
export const queue = internalMutation({
  args: { id: v.id("forumAlphaDeliveries") },
  returns: v.boolean(),
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get("forumAlphaDeliveries", id);
    if (row?.newsPriority !== "urgent") return false;
    if (
      !installationMatches(row) ||
      row.xStatus !== "queued" ||
      row.xOperationId ||
      row.telegramStatus !== "sent" ||
      !row.telegramMessageId ||
      !row.telegramSentAt ||
      row.notBefore > Date.now() ||
      !newsEnabled()
    )
      return true;
    const source = await researchSource(ctx, row.threadId);
    const thread = await ctx.db.get("forumThreads", row.threadId);
    if (
      !source ||
      thread?.body !== row.body ||
      source.title !== row.title ||
      source.url !== row.url ||
      row.expiresAt <= Date.now()
    ) {
      await ctx.db.patch("forumAlphaDeliveries", id, {
        xStatus: "skipped",
        issue: "breaking_source_changed_or_expired",
        updatedAt: Date.now(),
      });
      return true;
    }
    const a = await ctx.db
      .query("xAgentAccounts")
      .withIndex("by_agentSlug", (q) => q.eq("agentSlug", "nyx"))
      .unique();
    if (
      !a?.connected ||
      a.mode !== "automatic" ||
      !a.grant ||
      !a.xUserId ||
      a.publisherHold ||
      a.publisherRefreshClaim ||
      a.username !== installation.x.accounts.nyx ||
      a.expectedUsername !== installation.x.accounts.nyx ||
      !X_ACTIVITY_SCOPES.every((s) => a.scope?.split(" ").includes(s))
    )
      return true;
    const owner = await ctx.db.get("users", a.ownerUserId);
    const activity = await ctx.db
      .query("xAgentActivity")
      .withIndex("by_accountId", (q) => q.eq("accountId", a._id))
      .unique();
    if (
      owner?.role !== "owner" ||
      owner.isAgent ||
      !activity?.enabled ||
      !installationMatches(activity) ||
      activity.epoch !== a.epoch ||
      !activity.options.originals ||
      activity.holdReason
    )
      return true;
    const text = alphaShareText(row.title, row.url);
    if (!text || !validXDraft(text)) return true;
    const key = `breaking:${row._id}`;
    if (
      await ctx.db
        .query("xAgentOperations")
        .withIndex("by_key", (q) => q.eq("key", key))
        .unique()
    )
      return true; // An existing uncertain intent is never recreated.
    const conversationId = await createThread(ctx, components.agent, {
      userId: String(a.ownerUserId),
    });
    const draftId = await ctx.db.insert("xAgentDrafts", {
      installationBinding,
      ownerUserId: a.ownerUserId,
      agentSlug: "nyx",
      accountEpoch: a.epoch,
      key,
      sourceThreadId: row.threadId,
      kind: "forum",
      brief:
        "Reviewed breaking Forum news. Exact approved headline and source link.",
      conversationId,
      status: "draft",
      text,
      issues: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const operationId = await ctx.db.insert("xAgentOperations", {
      installationBinding,
      accountId: a._id,
      epoch: a.epoch,
      key,
      kind: "original",
      draftId,
      alphaDeliveryId: row._id,
      approvedText: text,
      status: "queued",
      notBefore: Date.now(),
      expiresAt: row.expiresAt,
      updatedAt: Date.now(),
    });
    await ctx.db.patch("forumAlphaDeliveries", id, {
      xStatus: "preparing",
      xOperationId: operationId,
      accountId: a._id,
      accountEpoch: a.epoch,
      xText: text,
      updatedAt: Date.now(),
    });
    await ctx.db.patch("xAgentActivity", activity._id, {
      nextPollAt: Date.now(),
    });
    return true;
  },
});

function newsEnabled() {
  return (
    env.FORUM_BREAKING_NEWS_ENABLED === "true" &&
    env.FORUM_ALPHA_EDITORIAL_ENABLED === "true" &&
    env.FORUM_ALPHA_DISTRIBUTION_ENABLED === "true" &&
    env.X_AGENTS_ENABLED === "true"
  );
}

/** Called within existing X send authorization, immediately before POST. */
export async function breakingOperationEligible(
  ctx: MutationCtx,
  op: Doc<"xAgentOperations">,
  a: Doc<"xAgentAccounts">,
) {
  if (!op.alphaDeliveryId) return true;
  const row = await ctx.db.get("forumAlphaDeliveries", op.alphaDeliveryId);
  if (
    !newsEnabled() ||
    !row ||
    !installationMatches(row) ||
    row.newsPriority !== "urgent" ||
    row.xStatus !== "preparing" ||
    row.xOperationId !== op._id ||
    row.accountId !== a._id ||
    row.accountEpoch !== a.epoch ||
    a.agentSlug !== "nyx" ||
    a.username !== installation.x.accounts.nyx ||
    row.expiresAt <= Date.now() ||
    row.sourcePublishedAt > Date.now() + 5 * 60_000 ||
    Date.now() - row.sourcePublishedAt > 60 * 60_000 ||
    row.telegramStatus !== "sent" ||
    !row.telegramMessageId ||
    !row.telegramSentAt ||
    row.xText !== op.approvedText
  )
    return false;
  const projects = await ctx.db
    .query("forumAlphaProjects")
    .withIndex("by_updatedAt", (q) =>
      q.gte("updatedAt", Date.now() - 30 * 86_400_000),
    )
    .order("desc")
    .take(80);
  const verified = new Set(projects.map((p) => p.host));
  const stillBreaking = row.sourceUrls.some((url) => {
    try {
      return (
        newsPriority(
          {
            title: row.title,
            summary: row.body,
            url,
            publishedAt: row.sourcePublishedAt,
            verifiedPrimary:
              primarySolanaSource(url) ||
              verified.has(new URL(url).hostname.toLowerCase()),
          },
          Date.now(),
        ) === "urgent"
      );
    } catch {
      return false;
    }
  });
  if (!stillBreaking) return false;
  const source = await researchSource(ctx, row.threadId);
  const thread = await ctx.db.get("forumThreads", row.threadId);
  return (
    !!source &&
    source.title === row.title &&
    thread?.body === row.body &&
    source.url === row.url
  );
}
