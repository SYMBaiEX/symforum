import { installationBinding, installationMatches } from "./installation";
import {
  ALPHA_PUBLISHER_SLUG,
  ALPHA_X_USER_ID,
} from "../lib/forum-alpha-editorial";
import { v } from "convex/values";
import { createThread } from "@convex-dev/agent";
import { RateLimiter, HOUR } from "@convex-dev/rate-limiter";
import { components, internal } from "./_generated/api";
import {
  env,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type QueryCtx,
  type MutationCtx,
} from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireOwner } from "./authz";
import { researchSource } from "./telegramYapResearch";
import {
  xSealed,
  xDraftStatus,
  xDraftKind,
  xActivityOptions,
  xOfficialPost,
} from "./xAgentSchema";
import { configureActivity } from "./xAgentActivityData";
import {
  expectedXUsername,
  validXDraft,
  X_AUTH_TTL_MS,
  X_DRAFT_TTL_MS,
  X_AGENT_SLUGS,
  xOriginalKind,
  officialXAuthor,
  X_ACTIVITY_SCOPES,
} from "../lib/x-agent-policy";

const limiter = new RateLimiter(components.rateLimiter, {
  xConnect: { kind: "token bucket", rate: 12, period: HOUR, capacity: 3 },
  xDraft: { kind: "token bucket", rate: 12, period: HOUR, capacity: 3 },
});
async function owner(ctx: QueryCtx | MutationCtx) {
  const user = await requireOwner(ctx);
  if (user.isAgent) throw Error("A human owner is required.");
  return user;
}
async function account(ctx: QueryCtx, slug: string, userId: Id<"users">) {
  const row = await ctx.db
    .query("xAgentAccounts")
    .withIndex("by_agentSlug", (q) => q.eq("agentSlug", slug))
    .unique();
  if (row && row.ownerUserId !== userId)
    throw Error("This account belongs to another owner.");
  return row;
}
const safeAccount = v.object({
  agentSlug: v.string(),
  expectedUsername: v.string(),
  connected: v.boolean(),
  username: v.optional(v.string()),
  connectedAt: v.optional(v.number()),
  mode: v.union(v.literal("drafts"), v.literal("automatic")),
  canWrite: v.boolean(),
  activity: v.optional(
    v.object({
      enabled: v.boolean(),
      reposts: v.boolean(),
      comments: v.boolean(),
      holdReason: v.optional(v.string()),
      originals: v.boolean(),
      nextOriginalAt: v.optional(v.number()),
    }),
  ),
});
const safeDraft = v.object({
  id: v.id("xAgentDrafts"),
  agentSlug: v.string(),
  status: xDraftStatus,
  text: v.optional(v.string()),
  issues: v.optional(v.array(v.string())),
  createdAt: v.number(),
  manuallyEdited: v.optional(v.boolean()),
  kind: v.optional(xDraftKind),
  replyTo: v.optional(v.string()),
});
const source = v.object({
  title: v.string(),
  url: v.string(),
  text: v.string(),
  category: v.string(),
  authorAgentSlug: v.string(),
});

export const dashboard = query({
  args: {},
  returns: v.object({
    configured: v.boolean(),
    accounts: v.array(safeAccount),
    agents: v.array(v.object({ slug: v.string(), name: v.string() })),
    sources: v.array(v.object({ id: v.id("forumThreads"), title: v.string() })),
    drafts: v.array(safeDraft),
    operations: v.array(
      v.object({
        agentSlug: v.string(),
        kind: v.string(),
        status: v.string(),
        url: v.optional(v.string()),
        issue: v.optional(v.string()),
        resultId: v.optional(v.string()),
      }),
    ),
  }),
  handler: async (ctx) => {
    const user = await owner(ctx);
    const accounts = await ctx.db
      .query("xAgentAccounts")
      .withIndex("by_ownerUserId", (q) => q.eq("ownerUserId", user._id))
      .take(40);
    const agents = await ctx.db.query("forumAgents").take(40);
    const threads = await ctx.db
      .query("forumThreads")
      .withIndex("by_status_and_lastPostAt", (q) => q.eq("status", "active"))
      .order("desc")
      .take(24);
    const sources = [];
    for (const t of threads) {
      const s = await researchSource(ctx, t._id);
      if (s) sources.push({ id: t._id, title: s.title });
    }
    const drafts = await ctx.db
      .query("xAgentDrafts")
      .withIndex("by_ownerUserId", (q) => q.eq("ownerUserId", user._id))
      .order("desc")
      .take(40);
    const operations = [];
    for (const a of accounts) {
      for (const status of [
        "queued",
        "sending",
        "confirmed",
        "held",
      ] as const) {
        const rows = await ctx.db
          .query("xAgentOperations")
          .withIndex("by_accountId_and_status_and_notBefore", (q) =>
            q.eq("accountId", a._id).eq("status", status),
          )
          .order("desc")
          .take(4);
        for (const r of rows)
          operations.push({
            agentSlug: a.agentSlug,
            kind: r.kind,
            status: r.status,
            url: r.post
              ? `https://x.com/${officialXAuthor(r.post.authorId)?.username}/status/${r.post.id}`
              : undefined,
            issue: r.issue,
            resultId: r.resultId,
          });
      }
    }
    return {
      operations,
      configured:
        env.X_AGENTS_ENABLED === "true" &&
        Boolean(
          env.X_AGENT_CLIENT_ID &&
          env.X_AGENT_CLIENT_SECRET &&
          env.X_AGENT_TOKEN_KEK,
        ),
      accounts: await Promise.all(
        accounts.map(async (a) => {
          const activity = await ctx.db
            .query("xAgentActivity")
            .withIndex("by_accountId", (q) => q.eq("accountId", a._id))
            .unique();
          return {
            agentSlug: a.agentSlug,
            expectedUsername: a.expectedUsername,
            connected: a.connected,
            username: a.username,
            connectedAt: a.connectedAt,
            mode: a.mode,
            canWrite: X_ACTIVITY_SCOPES.every((s) =>
              a.scope?.split(" ").includes(s),
            ),
            activity: activity
              ? {
                  enabled: activity.enabled,
                  reposts: activity.options.reposts,
                  comments: activity.options.comments,
                  holdReason: activity.holdReason,
                  originals: activity.options.originals === true,
                  nextOriginalAt: activity.nextOriginalAt,
                }
              : undefined,
          };
        }),
      ),
      agents: agents
        .filter((a) => a.enabled && X_AGENT_SLUGS.has(a.slug))
        .map((a) => ({ slug: a.slug, name: a.name })),
      sources,
      drafts: drafts.map((d) => ({
        id: d._id,
        agentSlug: d.agentSlug,
        status: d.status,
        text: d.text,
        issues: d.issues,
        createdAt: d.createdAt,
        manuallyEdited: d.manuallyEdited,
        kind: d.kind,
        replyTo: d.officialPost
          ? `https://x.com/${officialXAuthor(d.officialPost.authorId)?.username}/status/${d.officialPost.id}`
          : undefined,
      })),
    };
  },
});

export const prepareAuthorization = internalMutation({
  args: {
    agentSlug: v.string(),
    expectedUsername: v.string(),
    stateHash: v.string(),
    verifier: xSealed,
    activity: v.optional(xActivityOptions),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await owner(ctx);
    if (args.agentSlug === ALPHA_PUBLISHER_SLUG && args.activity)
      throw Error(
        "Project coverage uses its own publisher, not agent activity.",
      );
    if (args.activity?.comments && !args.activity.aiRepliesApproved)
      throw Error("X approval is required for automatic AI replies.");
    if (env.X_AGENTS_ENABLED !== "true")
      throw Error("X connections are paused.");
    const agent = await ctx.db
      .query("forumAgents")
      .withIndex("by_slug", (q) => q.eq("slug", args.agentSlug))
      .unique();
    if (
      args.agentSlug !== ALPHA_PUBLISHER_SLUG &&
      (!agent?.enabled || !X_AGENT_SLUGS.has(args.agentSlug))
    )
      throw Error("Agent unavailable.");
    await limiter.limit(ctx, "xConnect", { key: user._id, throws: true });
    const expectedUsername = expectedXUsername(
      args.agentSlug,
      args.expectedUsername,
    );
    const prior = await account(ctx, args.agentSlug, user._id);
    if (prior?.connected && prior.expectedUsername !== expectedUsername)
      throw Error("Disconnect the current account first.");
    const epoch = (prior?.epoch ?? 0) + 1;
    const values = {
      agentSlug: args.agentSlug,
      ownerUserId: user._id,
      expectedUsername,
      epoch,
      connected: false,
      mode: prior?.mode ?? ("drafts" as const),
      updatedAt: Date.now(),
      grant: undefined,
      publisherRefreshClaim: undefined,
      publisherHold: undefined,
    };
    const accountId =
      prior?._id ?? (await ctx.db.insert("xAgentAccounts", values));
    if (prior) await ctx.db.patch("xAgentAccounts", prior._id, values);
    await ctx.db.insert("xAgentAuthorizations", {
      stateHash: args.stateHash,
      accountId,
      ownerUserId: user._id,
      epoch,
      verifier: args.verifier,
      consumed: false,
      expiresAt: Date.now() + X_AUTH_TTL_MS,
      activity: args.activity,
    });
    return null;
  },
});

export const ownerIdentity = internalQuery({
  args: {},
  returns: v.id("users"),
  handler: async (ctx) => (await owner(ctx))._id,
});
export const claimAuthorization = internalMutation({
  args: { stateHash: v.string() },
  returns: v.object({
    id: v.id("xAgentAuthorizations"),
    accountId: v.id("xAgentAccounts"),
    agentSlug: v.string(),
    expectedUsername: v.string(),
    epoch: v.number(),
    ownerUserId: v.id("users"),
    verifier: xSealed,
    activity: v.optional(xActivityOptions),
  }),
  handler: async (ctx, { stateHash }) => {
    const user = await owner(ctx);
    const row = await ctx.db
      .query("xAgentAuthorizations")
      .withIndex("by_stateHash", (q) => q.eq("stateHash", stateHash))
      .unique();
    if (
      !row ||
      row.ownerUserId !== user._id ||
      row.consumed ||
      !row.verifier ||
      row.expiresAt <= Date.now()
    )
      throw Error("Authorization expired or already used. Connect again.");
    const a = await ctx.db.get("xAgentAccounts", row.accountId);
    if (
      !a ||
      a.epoch !== row.epoch ||
      a.ownerUserId !== user._id ||
      env.X_AGENTS_ENABLED !== "true"
    )
      throw Error("Authorization was replaced or canceled.");
    await ctx.db.patch("xAgentAuthorizations", row._id, {
      consumed: true,
      verifier: undefined,
    });
    return {
      id: row._id,
      accountId: a._id,
      agentSlug: a.agentSlug,
      expectedUsername: a.expectedUsername,
      epoch: a.epoch,
      ownerUserId: user._id,
      verifier: row.verifier,
      activity: row.activity,
    };
  },
});
export const completeAuthorization = internalMutation({
  args: {
    authorizationId: v.id("xAgentAuthorizations"),
    xUserId: v.string(),
    username: v.string(),
    grant: xSealed,
    scope: v.string(),
    expiresAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await owner(ctx);
    const pending = await ctx.db.get(
      "xAgentAuthorizations",
      args.authorizationId,
    );
    const a = pending
      ? await ctx.db.get("xAgentAccounts", pending.accountId)
      : null;
    if (
      !pending?.consumed ||
      !a ||
      a.ownerUserId !== user._id ||
      pending.ownerUserId !== user._id ||
      a.epoch !== pending.epoch ||
      pending.expiresAt <= Date.now() ||
      env.X_AGENTS_ENABLED !== "true"
    )
      throw Error("Authorization was canceled or expired.");
    if (
      expectedXUsername(a.agentSlug, args.username) !== a.expectedUsername ||
      (a.xUserId && a.xUserId !== args.xUserId) ||
      (a.agentSlug === ALPHA_PUBLISHER_SLUG && args.xUserId !== ALPHA_X_USER_ID)
    )
      throw Error("Wrong X account. Connect the expected account.");
    const duplicate = await ctx.db
      .query("xAgentAccounts")
      .withIndex("by_xUserId", (q) => q.eq("xUserId", args.xUserId))
      .unique();
    if (duplicate && duplicate._id !== a._id)
      throw Error("This X account is already assigned to another agent.");
    await ctx.db.patch("xAgentAccounts", a._id, {
      connected: true,
      xUserId: args.xUserId,
      username: args.username,
      grant: args.grant,
      scope: args.scope,
      expiresAt: args.expiresAt,
      connectedAt: Date.now(),
      updatedAt: Date.now(),
    });
    await ctx.db.delete("xAgentAuthorizations", pending._id);
    if (pending.activity) {
      const connected = await ctx.db.get("xAgentAccounts", a._id);
      if (connected) await configureActivity(ctx, connected, pending.activity);
    }
    return null;
  },
});
export const disconnect = mutation({
  args: { agentSlug: v.string() },
  returns: v.null(),
  handler: async (ctx, { agentSlug }) => {
    const user = await owner(ctx);
    const a = await account(ctx, agentSlug, user._id);
    if (a)
      await ctx.db.patch("xAgentAccounts", a._id, {
        connected: false,
        grant: undefined,
        scope: undefined,
        expiresAt: undefined,
        epoch: a.epoch + 1,
        updatedAt: Date.now(),
      });
    return null;
  },
});

export const requestDraft = mutation({
  args: {
    agentSlug: v.string(),
    sourceThreadId: v.optional(v.id("forumThreads")),
    kind: v.optional(
      v.union(v.literal("auto"), v.literal("mascot"), v.literal("forum")),
    ),
    brief: v.string(),
    requestKey: v.string(),
    writtenText: v.optional(v.string()),
  },
  returns: v.id("xAgentDrafts"),
  handler: async (ctx, args) => {
    const user = await owner(ctx);
    if (env.X_AGENTS_ENABLED !== "true" || env.ELIZA_RUNTIME_MODE !== "live")
      throw Error("Draft generation is paused.");
    if (!/^[a-f0-9-]{36}$/.test(args.requestKey) || args.brief.length > 600)
      throw Error("Invalid draft request.");
    const key = `${user._id}:${args.requestKey}`;
    const prior = await ctx.db
      .query("xAgentDrafts")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    if (prior) return prior._id;
    const agent = await ctx.db
      .query("forumAgents")
      .withIndex("by_slug", (q) => q.eq("slug", args.agentSlug))
      .unique();
    if (!agent?.enabled || !X_AGENT_SLUGS.has(args.agentSlug))
      throw Error("Agent or public source unavailable.");
    await limiter.limit(ctx, "xDraft", { key: user._id, throws: true });
    const a = await account(ctx, args.agentSlug, user._id);
    if (
      args.writtenText !== undefined &&
      (!validXDraft(args.writtenText) || args.kind !== "mascot")
    )
      throw Error("An owner-written draft must fit one X post.");
    const kind = !args.kind
      ? "forum"
      : args.kind === "auto"
        ? xOriginalKind(args.agentSlug, a?.originalOrdinal ?? 0)
        : args.kind;
    let sourceThreadId = kind === "forum" ? args.sourceThreadId : undefined;
    if (kind === "forum" && !sourceThreadId) {
      const threads = await ctx.db
        .query("forumThreads")
        .withIndex("by_status_and_lastPostAt", (q) => q.eq("status", "active"))
        .order("desc")
        .take(24);
      const interest = (title: string) =>
        /agent|security|hardware|retro|robot|privacy|memory|game|weird|obsolete/i.test(
          title,
        )
          ? 1
          : 0;
      threads.sort((a, b) => interest(b.title) - interest(a.title));
      for (const t of threads)
        if (await researchSource(ctx, t._id)) {
          sourceThreadId = t._id;
          break;
        }
    }
    if (
      kind === "forum" &&
      (!sourceThreadId || !(await researchSource(ctx, sourceThreadId)))
    )
      throw Error("Choose an available public Forum source.");
    if (a)
      await ctx.db.patch("xAgentAccounts", a._id, {
        originalOrdinal: (a.originalOrdinal ?? 0) + 1,
      });
    const conversationId = await createThread(ctx, components.agent, {
      title: `Private X draft: ${args.agentSlug}`,
      summary:
        "Owner-only one-off draft. No member messages, Telegram history or moderation data.",
    });
    const id = await ctx.db.insert("xAgentDrafts", {
      installationBinding,
      key,
      ownerUserId: user._id,
      agentSlug: args.agentSlug,
      accountEpoch: a?.epoch ?? 0,
      sourceThreadId,
      kind,
      brief: args.brief.trim(),
      status: args.writtenText !== undefined ? "draft" : "queued",
      text: args.writtenText?.trim(),
      manuallyEdited: args.writtenText !== undefined ? true : undefined,
      conversationId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    if (args.writtenText === undefined)
      await ctx.scheduler.runAfter(0, internal.xAgentDraft.generate, {
        draftId: id,
      });
    return id;
  },
});
export const claimDraft = internalMutation({
  args: { draftId: v.id("xAgentDrafts") },
  returns: v.union(
    v.null(),
    v.object({
      agentSlug: v.string(),
      name: v.string(),
      persona: v.string(),
      brief: v.string(),
      conversationId: v.string(),
      source: v.union(v.null(), source),
      kind: xDraftKind,
      officialPost: v.optional(xOfficialPost),
      recentOwnPosts: v.array(v.string()),
    }),
  ),
  handler: async (ctx, { draftId }) => {
    const d = await ctx.db.get("xAgentDrafts", draftId);
    if (!d || d.status !== "queued" || !installationMatches(d)) return null;
    const user = await ctx.db.get("users", d.ownerUserId);
    const agent = await ctx.db
      .query("forumAgents")
      .withIndex("by_slug", (q) => q.eq("slug", d.agentSlug))
      .unique();
    const a = await account(ctx, d.agentSlug, d.ownerUserId);
    const s = d.sourceThreadId
      ? await researchSource(ctx, d.sourceThreadId)
      : null;
    const kind = d.kind ?? "forum";
    if (
      env.X_AGENTS_ENABLED !== "true" ||
      env.ELIZA_RUNTIME_MODE !== "live" ||
      user?.role !== "owner" ||
      user.isAgent ||
      !agent?.enabled ||
      !X_AGENT_SLUGS.has(d.agentSlug) ||
      (kind === "forum" && !s) ||
      (kind === "reply" &&
        (!d.officialPost || !officialXAuthor(d.officialPost.authorId))) ||
      (a?.epoch ?? 0) !== d.accountEpoch ||
      Date.now() - d.createdAt > X_DRAFT_TTL_MS
    ) {
      await ctx.db.patch("xAgentDrafts", d._id, {
        status: "held",
        issues: ["Source, account or authorization changed."],
        updatedAt: Date.now(),
      });
      return null;
    }
    await ctx.db.patch("xAgentDrafts", d._id, {
      status: "generating",
      updatedAt: Date.now(),
    });
    return {
      agentSlug: d.agentSlug,
      name: agent.name,
      persona: agent.persona,
      brief: d.brief,
      conversationId: d.conversationId,
      source: s,
      kind,
      officialPost: d.officialPost,
      recentOwnPosts: (
        await ctx.db
          .query("xAgentDrafts")
          .withIndex("by_ownerUserId", (q) =>
            q.eq("ownerUserId", d.ownerUserId),
          )
          .order("desc")
          .take(40)
      )
        .filter(
          (p) =>
            p.agentSlug === d.agentSlug && p.status === "published" && p.text,
        )
        .slice(0, 6)
        .map((p) => p.text!),
    };
  },
});
export const finishDraft = internalMutation({
  args: {
    draftId: v.id("xAgentDrafts"),
    text: v.optional(v.string()),
    issues: v.array(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const d = await ctx.db.get("xAgentDrafts", args.draftId);
    if (!d || d.status !== "generating") return null;
    const user = await ctx.db.get("users", d.ownerUserId);
    const a = await account(ctx, d.agentSlug, d.ownerUserId);
    const agent = await ctx.db
      .query("forumAgents")
      .withIndex("by_slug", (q) => q.eq("slug", d.agentSlug))
      .unique();
    const valid =
      env.X_AGENTS_ENABLED === "true" &&
      user?.role === "owner" &&
      !user.isAgent &&
      agent?.enabled &&
      X_AGENT_SLUGS.has(d.agentSlug) &&
      (a?.epoch ?? 0) === d.accountEpoch &&
      Date.now() - d.createdAt <= X_DRAFT_TTL_MS &&
      ((d.kind ?? "forum") === "mascot" ||
        (d.kind === "reply"
          ? Boolean(d.officialPost && officialXAuthor(d.officialPost.authorId))
          : Boolean(
              d.sourceThreadId && (await researchSource(ctx, d.sourceThreadId)),
            )));
    const issues = valid
      ? args.issues
      : ["Source, account or authorization changed."];
    const ready =
      valid && !issues.length && args.text && validXDraft(args.text);
    await ctx.db.patch("xAgentDrafts", d._id, {
      status: ready ? "draft" : "held",
      text: ready ? args.text : undefined,
      issues: ready
        ? []
        : issues.length
          ? issues
          : ["Draft formatting failed."],
      updatedAt: Date.now(),
    });
    return null;
  },
});
export const editDraft = mutation({
  args: { draftId: v.id("xAgentDrafts"), text: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await owner(ctx);
    const d = await ctx.db.get("xAgentDrafts", args.draftId);
    if (
      !d ||
      d.ownerUserId !== user._id ||
      d.status !== "draft" ||
      !validXDraft(args.text)
    )
      throw Error(
        "Only a ready draft of up to 280 weighted characters can be edited.",
      );
    await ctx.db.patch("xAgentDrafts", d._id, {
      text: args.text.trim(),
      manuallyEdited: true,
      updatedAt: Date.now(),
    });
    return null;
  },
});
export const archiveDraft = mutation({
  args: { draftId: v.id("xAgentDrafts") },
  returns: v.null(),
  handler: async (ctx, { draftId }) => {
    const user = await owner(ctx);
    const d = await ctx.db.get("xAgentDrafts", draftId);
    if (
      !d ||
      d.ownerUserId !== user._id ||
      !["draft", "held"].includes(d.status)
    )
      throw Error("Draft unavailable.");
    await ctx.db.patch("xAgentDrafts", draftId, {
      status: "archived",
      updatedAt: Date.now(),
    });
    return null;
  },
});
export const cleanup = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    for (const p of await ctx.db
      .query("xAgentAuthorizations")
      .withIndex("by_expiresAt", (q) => q.lt("expiresAt", Date.now()))
      .take(50))
      await ctx.db.delete("xAgentAuthorizations", p._id);
    for (const status of ["queued", "generating"] as const)
      for (const d of await ctx.db
        .query("xAgentDrafts")
        .withIndex("by_status_and_updatedAt", (q) =>
          q.eq("status", status).lt("updatedAt", Date.now() - X_DRAFT_TTL_MS),
        )
        .take(50))
        await ctx.db.patch("xAgentDrafts", d._id, {
          status: "held",
          issues: [
            "Execution expired. Never retry an uncertain model operation.",
          ],
          updatedAt: Date.now(),
        });
    return null;
  },
});
