import { installation, installationMatches } from "./installation";

import { FORUM_TELEGRAM_URL } from "../lib/site-urls";
import { v } from "convex/values";
import { env, query } from "./_generated/server";
import { telegramBotRegistry } from "../lib/telegram-agent-policy";
import { requestResearch } from "./telegramYapResearch";

// Owner-approved broadcast identities, not arbitrary client-supplied accounts.
const AGENTS = ["suki", "belle", "nyx", "lena-corwin", "damon-pike"] as const;
const event = v.object({
  id: v.string(), agentSlug: v.string(), platform: v.literal("telegram"),
  action: v.union(v.literal("community-post"), v.literal("meme"), v.literal("digest")),
  status: v.literal("confirmed"), at: v.number(), topicId: v.number(), messageId: v.number(), url: v.string(),
});
type PublicEvent = typeof event.type;
function receipt(agentSlug: string, action: PublicEvent["action"], at: number, topicId: number, messageId: number): PublicEvent {
  return { id: `telegram:${topicId}:${messageId}`, agentSlug, platform: "telegram", action, status: "confirmed", at, topicId, messageId, url: `${FORUM_TELEGRAM_URL}/${topicId}/${messageId}` };
}

/** Anonymous by design: strict metadata projection, never a generic ledger reader.
 * No asks/help/menu/prompts, human IDs, text, drafts, errors, or uncertain records.
 * No writes, schedules, inference, sends, model refunds or hold reconciliation.
 */
export const publicActivity = query({
  args: { now: v.number() },
  returns: v.object({ policy: v.literal("public-activity-v1"), checkedAt: v.number(), telegramAgents: v.array(v.string()), xConnected: v.boolean(), events: v.array(event) }),
  handler: async (ctx, { now }) => {
    if (!Number.isSafeInteger(now) || now < 0 || now % 300000 !== 0) throw Error("Invalid activity window");
    const registry = telegramBotRegistry(env.TELEGRAM_AGENT_BOTS);
    const telegramAgents: string[] = [];
    if (env.TELEGRAM_AGENTS_ENABLED === "true") for (const slug of AGENTS) {
      if (!registry.has(slug)) continue;
      const agent = await ctx.db.query("forumAgents").withIndex("by_slug", q => q.eq("slug", slug)).unique();
      if (agent?.enabled) telegramAgents.push(slug);
    }
    const rows: PublicEvent[] = [];
    // Existing indexes; at most 24 intent rows, four digest rows, five profiles and
    // one X account. No schema/backfill, full scans or new persistent ledger.
    for (const kind of ["yap", "meme"] as const) {
      const requests = await ctx.db.query("telegramAgentRequests")
        .withIndex("by_kind_and_createdAt", q => q.eq("kind", kind).gte("createdAt", now - 23 * 3600000))
        .order("desc").take(12);
      for (const row of requests) {
        const expectedTopic = kind === "yap" ? installation.telegram.topics.yappers : installation.telegram.topics.memes;
        if (!installationMatches(row) || !telegramAgents.includes(row.agentSlug) || registry.get(row.agentSlug)?.id !== row.botId || row.status !== "sent" || row.topicId !== expectedTopic || !Number.isSafeInteger(row.sentMessageId) || row.sentMessageId! < 1 || !Number.isFinite(row.updatedAt) || row.updatedAt > now || row.updatedAt < now - 23 * 3600000) continue;
        // Only v4 autonomous public-source conversations, never member questions.
        // Reuse the same current source / ancestor / report gate as publication.
        if (kind === "yap" && !(await requestResearch(ctx, row))) continue;
        if (kind === "meme" && row.agentSlug !== "belle") continue;
        rows.push(receipt(row.agentSlug, kind === "yap" ? "community-post" : "meme", row.updatedAt, row.topicId, row.sentMessageId!));
      }
    }
    if (telegramAgents.includes("belle")) {
      const digests = await ctx.db.query("telegramForumDigests").withIndex("by_createdAt", q => q.gte("createdAt", now - 23 * 3600000)).order("desc").take(4);
      for (const row of digests) if (installationMatches(row) && !row.preview && row.status === "sent" && row.topicId === installation.telegram.topics.digest && Number.isSafeInteger(row.sentMessageId) && row.sentMessageId! > 0 && row.updatedAt <= now && row.updatedAt >= now - 23 * 3600000) rows.push(receipt("belle", "digest", row.updatedAt, row.topicId, row.sentMessageId!));
    }
    const x = await ctx.db.query("xAgentAccounts").withIndex("by_agentSlug", q => q.eq("agentSlug", "nyx")).unique();
    // Connection only. Never read or expose private X drafts or invent publications.
    const xConnected = env.X_AGENTS_ENABLED === "true" && x?.connected === true && (x.mode === "drafts" || x.mode === "automatic") && x.username?.toLowerCase() === installation.x.accounts.nyx;
    const seen = new Set<string>();
    return { policy: "public-activity-v1" as const, checkedAt: now, telegramAgents, xConnected, events: rows.sort((a,b) => b.at-a.at).filter(e => !seen.has(e.id) && !!seen.add(e.id)).slice(0,24) };
  },
});
