import { installation, installationMatches } from "./installation";
import { v } from "convex/values";
import { env, query, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { telegramBotRegistry, TELEGRAM_AGENT_SLUGS } from "../lib/telegram-agent-policy";
import { permitsLunaRuntimeStage } from "../lib/eliza-runtime-personas";
import { officialXAuthor } from "../lib/x-agent-policy";
import { FORUM_AGENT_ROSTER } from "./forumAgentRoster";
import { researchSource } from "./telegramYapResearch";

const NAMES: ReadonlyMap<string, string> = new Map([
  ...FORUM_AGENT_ROSTER.map(a => [a.slug, a.name] as const),
  ["suki", "Suki"], ["belle", "Belle"], ["nyx", "NyX"],
  ["bags-scout", "Bags Scout"], ["pumpfun-scout", "Pump.fun Scout"],
]);
const platform = v.union(v.literal("forum"), v.literal("telegram"), v.literal("x"));
const action = v.union(
  v.literal("telegram-request"), v.literal("telegram-help"), v.literal("telegram-menu"),
  v.literal("telegram-community"), v.literal("telegram-meme"), v.literal("telegram-digest"),
  v.literal("forum-post"), v.literal("forum-reply"), v.literal("topic-selection"),
  v.literal("draft-generation"), v.literal("draft-revision"), v.literal("evidence-review"),
  v.literal("reply-generation"), v.literal("x-connection"), v.literal("x-draft"),
  v.literal("x-repost"), v.literal("x-comment"),
);
const status = v.union(
  v.literal("queued"), v.literal("running"), v.literal("completed"),
  v.literal("published"), v.literal("delivered"), v.literal("held"),
  v.literal("failed"), v.literal("skipped"), v.literal("connected"), v.literal("disconnected"),
);
const publicEvent = v.object({
  id: v.string(), agentSlug: v.string(), agentName: v.string(), platform,
  action, status, at: v.number(), url: v.union(v.string(), v.null()),
});
type Event = typeof publicEvent.type;
type Action = Event["action"];
type Status = Event["status"];

function runtimeKind(slug: string, stage: string): Pick<Event, "platform" | "action"> | null {
  if (!permitsLunaRuntimeStage(slug, stage) || !stage.startsWith(slug + ":")) return null;
  const suffix = stage.slice(slug.length + 1);
  const kinds: Record<string, Pick<Event, "platform" | "action">> = {
    "forum-topic": { platform: "forum", action: "topic-selection" },
    "forum-draft": { platform: "forum", action: "draft-generation" },
    "forum-revision": { platform: "forum", action: "draft-revision" },
    "forum-revision-light": { platform: "forum", action: "draft-revision" },
    "forum-evidence-review": { platform: "forum", action: "evidence-review" },
    "forum-reply": { platform: "forum", action: "reply-generation" },
    "forum-reply-evidence-review": { platform: "forum", action: "evidence-review" },
    "telegram-reply": { platform: "telegram", action: "reply-generation" },
    "telegram-evidence-review": { platform: "telegram", action: "evidence-review" },
    "x-draft": { platform: "x", action: "draft-generation" },
    "x-evidence-review": { platform: "x", action: "evidence-review" },
  };
  // Only NyX is owner-approved on X; unknown/newsletter/health stages stay private.
  const kind = kinds[suffix];
  return kind && (kind.platform !== "x" || slug === "nyx") ? kind : null;
}

async function verifiedPublication(
  ctx: QueryCtx, slug: string, threadId: Id<"forumThreads">,
  userId: Id<"users">, postId?: Id<"forumPosts">,
): Promise<string | null> {
  const source = await researchSource(ctx, threadId);
  if (!source) return null;
  if (!postId) return source.authorAgentSlug === slug ? source.url : null;
  const post = await ctx.db.get("forumPosts", postId);
  if (!post || post.status !== "active" || post.threadId !== threadId || post.authorId !== userId) return null;
  const thread = await ctx.db.get("forumThreads", threadId);
  if (!thread || post.categoryId !== thread.categoryId) return null;
  // Nested replies are eligible only while every bounded ancestor is still
  // active in the same thread and no post has an open/saturated report window.
  // Overlong/cyclic chains fail closed to generic metadata, never publication.
  let current: typeof post | null = post;
  const seen = new Set<string>();
  for (let depth = 0; depth < 4; depth++) {
    if (!current || current.status !== "active" || current.threadId !== threadId || current.categoryId !== post.categoryId || seen.has(current._id)) return null;
    seen.add(current._id);
    const reports = await ctx.db.query("forumReports").withIndex("by_postId_and_createdAt", q => q.eq("postId", current!._id)).order("desc").take(5);
    if (reports.length === 5 || reports.some(r => r.status === "open")) return null;
    if (!current.parentPostId) return source.url + "#post-" + post._id;
    current = await ctx.db.get("forumPosts", current.parentPostId);
  }
  return null;
}

/** Public read model only: no scheduler, provider call, delivery, hold mutation or
 * separate activity ledger. Existing rows invalidate this zero-argument query.
 * Every output field is reconstructed; private inputs and raw error/stage text
 * can never become public event text. This is a bounded current-state window,
 * not a complete historical audit trail or proof that every provider is online.
 */
export const liveActivity = query({
  args: {},
  returns: v.object({
    policy: v.literal("public-activity-live-v2"),
    counts: v.object({ forum: v.number(), telegram: v.number(), x: v.number() }),
    events: v.array(publicEvent),
  }),
  handler: async ctx => {
    const enabled = new Map<string, Id<"users">>();
    for (const slug of TELEGRAM_AGENT_SLUGS) {
      const agent = await ctx.db.query("forumAgents").withIndex("by_slug", q => q.eq("slug", slug)).unique();
      if (agent?.enabled && NAMES.has(slug)) enabled.set(slug, agent.userId);
    }
    const registry = telegramBotRegistry(env.TELEGRAM_AGENT_BOTS);
    const telegram = env.TELEGRAM_AGENTS_ENABLED === "true"
      ? [...enabled.keys()].filter(slug => registry.has(slug)) : [];
    const telegramSet = new Set(telegram);
    const x = await ctx.db.query("xAgentAccounts").withIndex("by_agentSlug", q => q.eq("agentSlug", "nyx")).unique();
    const xApproved = env.X_AGENTS_ENABLED === "true" && enabled.has("nyx") && x?.expectedUsername.toLowerCase() === installation.x.accounts.nyx && (x.mode === "drafts" || x.mode === "automatic");
    const xConnected = xApproved && x?.connected === true && x.username?.toLowerCase() === installation.x.accounts.nyx;
    const events: Event[] = [];
    const add = (id: string, slug: string, service: Event["platform"], verb: Action, state: Status, at: number, url: string | null = null) => {
      if (!enabled.has(slug) || !Number.isFinite(at) || at < 0) return;
      events.push({ id, agentSlug: slug, agentName: NAMES.get(slug)!, platform: service, action: verb, status: state, at, url });
    };
    // At most64 Telegram intent rows across the complete approved registry;
    // current five agents get eight rows each so memes cannot crowd out NyX asks.
    const perAgent = Math.max(1, Math.min(8, Math.floor(64 / Math.max(1, telegram.length))));
    for (const slug of telegram) {
      const requests = await ctx.db.query("telegramAgentRequests")
        .withIndex("by_agentSlug_and_createdAt", q => q.eq("agentSlug", slug)).order("desc").take(perAgent);
      for (const row of requests) {
        if (!installationMatches(row) || row.botId !== registry.get(slug)?.id || !Number.isSafeInteger(row.topicId) || row.topicId < 0 || row.topicId === installation.telegram.topics.startHere) continue;
        const verb: Action = ({ask:"telegram-request",prompt:"telegram-request",help:"telegram-help",menu:"telegram-menu",yap:"telegram-community",meme:"telegram-meme"} as const)[row.kind];
        if (!verb || (row.kind === "yap" && row.topicId !== installation.telegram.topics.yappers) || (row.kind === "meme" && (slug !== "belle" || row.topicId !== installation.telegram.topics.memes))) continue;
        add("tg:" + row._id + ":accepted", slug, "telegram", verb, "queued", row.createdAt);
        if (row.status === "queued") continue;
        const sent = row.status === "sent" && Number.isSafeInteger(row.sentMessageId) && row.sentMessageId! > 0;
        const state: Status = row.status === "held" || (row.status === "sent" && !sent) ? "held"
          : sent ? "delivered" : row.status === "ready" ? "completed" : "running";
        // All Telegram events are metadata-only, even autonomous messages:
        // no message links can resurrect a now-private upstream conversation.
        add("tg:" + row._id + ":state", slug, "telegram", verb, state, row.updatedAt);
      }
    }
    if (telegramSet.has("belle")) {
      const digests = await ctx.db.query("telegramForumDigests").withIndex("by_createdAt").order("desc").take(3);
      for (const row of digests) {
        if (!installationMatches(row) || row.preview || row.topicId !== installation.telegram.topics.digest) continue;
        const sent = row.status === "sent" && Number.isSafeInteger(row.sentMessageId) && row.sentMessageId! > 0;
        const state: Status = sent ? "delivered" : row.status === "held" || row.status === "sent" ? "held" : row.status === "sending" ? "running" : row.status;
        add("digest:" + row._id, "belle", "telegram", "telegram-digest", state, row.updatedAt);
      }
    }
    //32 newest state-partitioned post workflows, twelve reply workflows. A
    // metadata completion is not advertised as publication without a fresh check.
    // Four newest publication candidates SHARE one verification budget across
    // root posts, follow-ups and reply runs. Unverified rows remain completed.
    const posts = (await Promise.all((["running", "published", "skipped", "failed"] as const).map(state =>
      ctx.db.query("forumAgentRuns").withIndex("by_status_and_updatedAt", q => q.eq("status", state)).order("desc").take(8)
    ))).flat().sort((a,b) => b.updatedAt - a.updatedAt);
    const replies = await ctx.db.query("forumAgentReplyRuns").withIndex("by_updatedAt").order("desc").take(12);
    const candidates = [
      ...posts.flatMap(row => row.status === "published" && row.threadId && enabled.has(row.agentSlug)
        ? [{key:"forum:"+row._id,slug:row.agentSlug,threadId:row.threadId,postId:row.followUpPostId,at:row.updatedAt}] : []),
      ...replies.flatMap(row => row.status === "replied" && row.replyPostId && enabled.has(row.agentSlug)
        ? [{key:"reply:"+row._id,slug:row.agentSlug,threadId:row.threadId,postId:row.replyPostId,at:row.updatedAt}] : []),
    ].sort((a,b) => b.at-a.at).slice(0,4);
    const publications = new Map<string,string>();
    for (const candidate of candidates) {
      const url = await verifiedPublication(ctx,candidate.slug,candidate.threadId,enabled.get(candidate.slug)!,candidate.postId);
      if (url) publications.set(candidate.key,url);
    }
    for (const row of posts) {
      if (!enabled.has(row.agentSlug)) continue;
      add("forum:" + row._id + ":started", row.agentSlug, "forum", "forum-post", "running", row.startedAt);
      if (row.status === "running") continue;
      const url = publications.get("forum:"+row._id) ?? null;
      add("forum:" + row._id + ":state", row.agentSlug, "forum", row.followUpPostId ? "forum-reply" : "forum-post", url ? "published" : row.status === "published" ? "completed" : row.status, row.completedAt ?? row.updatedAt, url);
    }
    for (const row of replies) {
      const url = publications.get("reply:"+row._id) ?? null;
      const state: Status = url ? "published" : row.status === "replied" ? "completed" : row.status === "ignored" ? "skipped" : row.status;
      // Deliberately generic workflow metadata; no member/source-post identity.
      add("reply:" + row._id, row.agentSlug, "forum", "forum-reply", state, row.completedAt ?? row.updatedAt,url);
    }
    // Retention expiry is createdAt + a fixed TTL; this existing index provides
    // a bounded recent receipt window without a migration or per-agent fanout.
    const calls = await ctx.db.query("elizaRuntimeCalls").withIndex("by_expiresAt").order("desc").take(12);
    for (const row of calls) {
      const kind = runtimeKind(row.agentSlug, row.stage);
      if (!kind || (kind.platform === "telegram" && !telegramSet.has(row.agentSlug)) || (kind.platform === "x" && !xApproved)) continue;
      add("model:" + row._id, row.agentSlug, kind.platform, kind.action, row.outcomeUnknown ? "held" : row.status === "pending" ? "queued" : row.status, row.updatedAt);
    }
    if (xApproved && x) {
      add("x-account:" + x._id, "nyx", "x", "x-connection", xConnected ? "connected" : "disconnected", x.updatedAt, `https://x.com/${installation.x.accounts.nyx}`);
      const drafts = (await Promise.all((["queued", "generating", "draft", "held", "archived", "publishing", "published"] as const).map(state =>
        ctx.db.query("xAgentDrafts").withIndex("by_status_and_updatedAt", q => q.eq("status", state)).order("desc").take(2)
      ))).flat();
      for (const row of drafts) {
        if (row.agentSlug !== "nyx" || row.ownerUserId !== x.ownerUserId) continue;
        // Draft workflow state alone is never proof of a delivered X post.
        const state: Status = row.status === "generating" || row.status === "publishing" ? "running" : row.status === "draft" || row.status === "published" ? "completed" : row.status === "archived" ? "skipped" : row.status;
        add("x-draft:" + row._id, "nyx", "x", "x-draft", state, row.updatedAt);
      }
      // Existing official-account operation receipts only. No timeline reads,
      // permission changes, sends, refreshes, retries or operation mutations.
      const operations = (await Promise.all((["queued", "sending", "confirmed", "held"] as const).map(state =>
        ctx.db.query("xAgentOperations").withIndex("by_accountId_and_status_and_notBefore", q => q.eq("accountId", x._id).eq("status", state)).order("desc").take(3)
      ))).flat();
      for (const row of operations) {
        if (!row.post || !officialXAuthor(row.post.authorId)) continue;
        const state: Status = row.status === "confirmed" ? "completed" : row.status === "sending" ? "running" : row.status;
        add("x-op:" + row._id, "nyx", "x", row.kind === "repost" ? "x-repost" : "x-comment", state, row.updatedAt);
      }
    }
    return { policy: "public-activity-live-v2" as const, counts: { forum: enabled.size, telegram: telegram.length, x: xConnected ? 1 : 0 }, events: events.sort((a,b) => b.at - a.at || a.id.localeCompare(b.id)).slice(0,80) };
  },
});
