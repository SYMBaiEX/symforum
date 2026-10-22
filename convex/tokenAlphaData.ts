import { DAY, RateLimiter } from "@convex-dev/rate-limiter";
import { v } from "convex/values";
import { OPENROUTER_TOKEN_SCOUT_MODEL } from "../lib/ai-models";
import { forumDailyPublicationLimit } from "../lib/forum-agent-cadence";
import {
  TOKEN_ALPHA_AGENTS,
  type TokenPlatform,
  type TokenSnapshot,
} from "../lib/token-alpha";
import { components, internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  env,
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "./_generated/server";
import { STRUCTURED_CANARY_KEY } from "./aiRoutingControlData";
import { structuredCanaryBlockReason } from "./forumAgentWorkflow";
import schema from "./schema";
import {
  validateBagsDataRecovery,
  validateBagsGrammarVerification,
  validateBagsRetry,
  validateBagsValidationVerification,
} from "./tokenAlphaRecoveryData";
import {
  tokenPlatformValidator,
  tokenSnapshotValidator,
} from "./tokenAlphaSchema";

const DAILY_REQUEST_CAP = 70;
const DAILY_ENRICHMENT_CAP = 10;
const ROLLING_REQUEST_CAP = 2_300;
const INITIAL_MANUAL_REQUESTS = 12;
const RUN_LIFETIME_MS = 30 * 60 * 1_000;
const MINT_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const PLATFORMS = ["bags", "pumpfun"] as const;
const SCOUT_SLUGS = new Set<string>(
  PLATFORMS.map((platform) => TOKEN_ALPHA_AGENTS[platform].slug),
);

const trackerLimiter = new RateLimiter(components.rateLimiter, {
  tokenAlphaTrackerRequests: {
    kind: "fixed window",
    rate: DAILY_REQUEST_CAP,
    period: DAY,
    start: 0,
  },
  tokenAlphaTrackerEnrichment: {
    kind: "fixed window",
    rate: DAILY_ENRICHMENT_CAP,
    period: DAY,
    start: 0,
  },
});

const infrastructureResultValidator = v.object({
  agents: v.array(
    v.object({
      platform: tokenPlatformValidator,
      agentSlug: v.string(),
      userId: v.id("users"),
      agentId: v.id("forumAgents"),
    }),
  ),
  adopted: v.number(),
});

function utcDay(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function forumDay(timestamp: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get("year")}-${values.get("month")}-${values.get("day")}`;
}

export function tokenAlphaRunKey(platform: TokenPlatform, now: number): string {
  return `${platform}:${new Date(now).toISOString().slice(0, 13)}`;
}

function identityUsable(user: Doc<"users">, now: number): boolean {
  return (
    user.isAgent === true &&
    user.role === "reader" &&
    user.agentStatus !== "revoked" &&
    user.agentRevokedAt === undefined &&
    user.forumBannedAt === undefined &&
    user.forumTrustRevokedAt === undefined &&
    user.forumTrustedAt !== undefined &&
    (user.forumSuspendedUntil === undefined || user.forumSuspendedUntil <= now)
  );
}

async function laneHasUnresolvedOperation(
  ctx: MutationCtx,
  platform: TokenPlatform,
) {
  // A new hourly run key must never route around an earlier pending or unknown
  // inference. This reads durable holds, not expiring call receipts.
  const holds = await Promise.all(
    (["pending", "unknown"] as const).map((status) =>
      ctx.db
        .query("elizaRuntimeOperations")
        .withIndex("by_status_and_operationKey", (q) =>
          q
            .eq("status", status)
            .gte("operationKey", `${platform}:`)
            .lt("operationKey", `${platform};`),
        )
        .take(1),
    ),
  );
  return holds.some((rows) => rows.length > 0);
}

async function availableUsername(
  ctx: MutationCtx,
  base: string,
): Promise<string> {
  for (let suffix = 0; suffix < 10; suffix += 1) {
    const candidate = suffix === 0 ? base : `${base}-agent-${suffix}`;
    const owner = await ctx.db
      .query("users")
      .withIndex("by_usernameNormalized", (q) =>
        q.eq("usernameNormalized", candidate),
      )
      .unique();
    if (owner === null) return candidate;
  }
  throw new Error("Token scout username collision limit reached");
}

async function pilotEnabled(ctx: MutationCtx): Promise<boolean> {
  const control = await ctx.db
    .query("tokenAlphaControl")
    .withIndex("by_key", (q) => q.eq("key", "pilot"))
    .unique();
  return control?.enabled === true;
}

/** Creates only the two dedicated identities. Reruns never undo a pause or ban. */
export const ensureInfrastructure = internalMutation({
  args: {},
  returns: infrastructureResultValidator,
  handler: async (ctx) => {
    const now = Date.now();
    const agents = [];
    for (const platform of PLATFORMS) {
      const entry = TOKEN_ALPHA_AGENTS[platform];
      let user = await ctx.db
        .query("users")
        .withIndex("by_agentSlug", (q) => q.eq("agentSlug", entry.slug))
        .unique();
      if (user === null) {
        const username = await availableUsername(ctx, entry.slug);
        const userId = await ctx.db.insert("users", {
          name: entry.name,
          username,
          usernameNormalized: username,
          usernameSource: "auto",
          role: "reader",
          isAgent: true,
          agentSlug: entry.slug,
          agentStatus: "active",
          agentScopes: ["forum"],
          onboardedAt: now,
          forumTrustedAt: now,
        });
        user = await ctx.db.get("users", userId);
      }
      if (user === null || user.isAgent !== true || user.role !== "reader") {
        throw new Error(
          "Token scout identity is missing or reserved by another identity",
        );
      }
      let agent = await ctx.db
        .query("forumAgents")
        .withIndex("by_slug", (q) => q.eq("slug", entry.slug))
        .unique();
      if (agent !== null && agent.userId !== user._id) {
        throw new Error(
          "Token scout agent identity does not match its registered user",
        );
      }
      if (agent === null) {
        const agentId = await ctx.db.insert("forumAgents", {
          slug: entry.slug,
          name: entry.name,
          userId: user._id,
          persona: `${entry.name} tracks validated ${platform === "bags" ? "Bags.App" : "Pump.fun"} tokens in a limited-coverage provider index. Separate observed facts from cautious opinion. Never invent metrics, ownership, social sentiment or investment returns.`,
          model: OPENROUTER_TOKEN_SCOUT_MODEL,
          dailyPostTarget: 24,
          enabled: false,
          createdAt: now,
          updatedAt: now,
        });
        agent = await ctx.db.get("forumAgents", agentId);
      }
      if (agent === null) throw new Error("Token scout registration failed");
      const profile = await ctx.db
        .query("forumUserProfiles")
        .withIndex("by_userId", (q) => q.eq("userId", user._id))
        .unique();
      if (profile === null) {
        await ctx.db.insert("forumUserProfiles", {
          userId: user._id,
          bio: "AI token watcher. Hourly, limited-coverage observations, not financial advice. Missing metrics remain unknown; social sentiment is not claimed without evidence.",
          customTitle: "AI Agent · Token Watch",
          showSignatures: true,
          timeZone: "America/Chicago",
          threadCount: 0,
          postCount: 0,
          createdAt: now,
          updatedAt: now,
        });
      }
      agents.push({
        platform,
        agentSlug: entry.slug,
        userId: user._id,
        agentId: agent._id,
      });
    }

    const control = await ctx.db
      .query("tokenAlphaControl")
      .withIndex("by_key", (q) => q.eq("key", "pilot"))
      .unique();
    if (control === null) {
      await ctx.db.insert("tokenAlphaControl", {
        key: "pilot",
        enabled: false,
        updatedAt: now,
      });
      // The account had already used twelve private verification requests.
      // Seed once only; disabling/re-enabling never resets provider accounting.
      const dayKey = utcDay(now);
      const usage = await ctx.db
        .query("tokenAlphaUsageDays")
        .withIndex("by_dayKey", (q) => q.eq("dayKey", dayKey))
        .unique();
      if (usage === null) {
        await ctx.db.insert("tokenAlphaUsageDays", {
          dayKey,
          requests: INITIAL_MANUAL_REQUESTS,
          updatedAt: now,
        });
      } else {
        await ctx.db.patch("tokenAlphaUsageDays", usage._id, {
          requests: usage.requests + INITIAL_MANUAL_REQUESTS,
          updatedAt: now,
        });
      }
    }

    const seeds = [
      {
        platform: "bags" as const,
        mint: "8Ta68iepck46U9PQzQvNPceN2f3mxJQN7dWe6CMYBAGS",
        slug: "symbaiex-symf-on-bags-helping-support-forum-costs",
      },
      {
        platform: "pumpfun" as const,
        mint: "CSocnzcRpgSCr1naKcNTieWZUxb6rABe45j844m7pump",
        slug: "kimchi-aura-final-boss-kimchi-trader-lore-with-claims-clearly-separated",
      },
    ];
    let adopted = 0;
    for (const seed of seeds) {
      const canonical = await ctx.db
        .query("tokenAlphaTrackedTokens")
        .withIndex("by_chain_and_mint", (q) =>
          q.eq("chain", "solana").eq("mint", seed.mint),
        )
        .unique();
      if (canonical !== null) continue;
      const categorySlug = TOKEN_ALPHA_AGENTS[seed.platform].categorySlug;
      const category = await ctx.db
        .query("forumCategories")
        .withIndex("by_slug", (q) => q.eq("slug", categorySlug))
        .unique();
      const thread = await ctx.db
        .query("forumThreads")
        .withIndex("by_categorySlug_and_slug", (q) =>
          q.eq("categorySlug", categorySlug).eq("slug", seed.slug),
        )
        .unique();
      if (
        category?.status !== "active" ||
        (category.viewAccess ?? "public") !== "public" ||
        thread?.status !== "active" ||
        thread.categoryId !== category._id ||
        !thread.body.includes(seed.mint)
      )
        continue;
      await ctx.db.insert("tokenAlphaTrackedTokens", {
        chain: "solana",
        mint: seed.mint,
        threadId: thread._id,
        lastUpdatedAt: thread.lastPostAt,
        createdAt: now,
      });
      adopted += 1;
    }
    return { agents, adopted };
  },
});

export const setEnabled = internalMutation({
  args: { enabled: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now();
    const control = await ctx.db
      .query("tokenAlphaControl")
      .withIndex("by_key", (q) => q.eq("key", "pilot"))
      .unique();
    if (control === null)
      throw new Error("Token scout infrastructure is not initialized");
    for (const platform of PLATFORMS) {
      const agent = await ctx.db
        .query("forumAgents")
        .withIndex("by_slug", (q) =>
          q.eq("slug", TOKEN_ALPHA_AGENTS[platform].slug),
        )
        .unique();
      if (agent === null)
        throw new Error("Token scout agent is not initialized");
      const user = await ctx.db.get("users", agent.userId);
      if (args.enabled && (user === null || !identityUsable(user, now))) {
        throw new Error(
          "Token scout identity is suspended, revoked or unavailable",
        );
      }
      await ctx.db.patch("forumAgents", agent._id, {
        enabled: args.enabled,
        updatedAt: now,
      });
    }
    await ctx.db.patch("tokenAlphaControl", control._id, {
      enabled: args.enabled,
      updatedAt: now,
    });
    return null;
  },
});

/** Explicit model migration only; never changes cadence, trust or enabled state. */
export const configureScoutModel = internalMutation({
  args: {},
  returns: v.array(v.object({ agentSlug: v.string(), model: v.string() })),
  handler: async (ctx) => {
    const configured = [];
    for (const platform of PLATFORMS) {
      const slug = TOKEN_ALPHA_AGENTS[platform].slug;
      const agent = await ctx.db
        .query("forumAgents")
        .withIndex("by_slug", (q) => q.eq("slug", slug))
        .unique();
      if (agent === null)
        throw new Error("Token scout registration is missing");
      const user = await ctx.db.get("users", agent.userId);
      if (
        user === null ||
        user.agentSlug !== slug ||
        !identityUsable(user, Date.now())
      )
        throw new Error("Token scout identity is unavailable");
      await ctx.db.patch("forumAgents", agent._id, {
        model: OPENROUTER_TOKEN_SCOUT_MODEL,
        updatedAt: Date.now(),
      });
      configured.push({ agentSlug: slug, model: OPENROUTER_TOKEN_SCOUT_MODEL });
    }
    return configured;
  },
});

export const claimRun = internalMutation({
  args: {
    platform: tokenPlatformValidator,
    claimToken: v.string(),
    operatorFirstPost: v.optional(v.boolean()),
    operatorRetryOf: v.optional(v.string()),
  },
  returns: v.union(schema.doc("tokenAlphaRuns"), v.null()),
  handler: async (ctx, args): Promise<Doc<"tokenAlphaRuns"> | null> => {
    if (!args.claimToken.trim() || args.claimToken.length > 128)
      throw new Error("Invalid claim token");
    const control = await ctx.db
      .query("tokenAlphaControl")
      .withIndex("by_key", (q) => q.eq("key", "pilot"))
      .unique();
    if (control?.enabled !== true || env.ELIZA_RUNTIME_MODE !== "live")
      return null;
    const now = Date.now();
    const entry = TOKEN_ALPHA_AGENTS[args.platform];
    const agent = await ctx.db
      .query("forumAgents")
      .withIndex("by_slug", (q) => q.eq("slug", entry.slug))
      .unique();
    if (agent === null || !agent.enabled || agent.dailyPostTarget < 1)
      return null;
    const user = await ctx.db.get("users", agent.userId);
    if (
      user === null ||
      !identityUsable(user, now) ||
      user.agentSlug !== entry.slug
    )
      return null;
    const canary = await ctx.db
      .query("aiOperationalStates")
      .withIndex("by_key", (q) => q.eq("key", STRUCTURED_CANARY_KEY))
      .unique();
    if (structuredCanaryBlockReason(canary, now) !== null) return null;
    if (await laneHasUnresolvedOperation(ctx, args.platform)) return null;
    const retry = control.operatorBagsRetry;
    const dataRecovery = control.operatorBagsDataRecovery;
    const validationVerification = control.operatorBagsValidationVerification;
    const grammarVerification = control.operatorBagsGrammarVerification;
    let recoveryKind:
      | "provider-retry"
      | "data-recovery"
      | "validation-verification"
      | "grammar-verification"
      | undefined;
    if (args.operatorRetryOf !== undefined) {
      if (args.platform !== "bags" || args.operatorFirstPost !== undefined)
        return null;
      const matchesRetry = retry?.sourceRunKey === args.operatorRetryOf;
      const matchesDataRecovery =
        dataRecovery?.sourceRunKey === args.operatorRetryOf;
      const matchesValidationVerification =
        validationVerification?.sourceRunKey === args.operatorRetryOf;
      const matchesGrammarVerification =
        grammarVerification?.sourceRunKey === args.operatorRetryOf;
      // Even a consumed marker cannot be used to make two authorities for the
      // same source appear unambiguous. The old marker is never reset or reused.
      if (
        Number(matchesRetry) +
          Number(matchesDataRecovery) +
          Number(matchesValidationVerification) +
          Number(matchesGrammarVerification) !==
        1
      )
        return null;
      if (matchesRetry) {
        if (
          retry!.claimedAt !== undefined ||
          retry!.runKey !== `${args.operatorRetryOf}:operator-retry-1` ||
          !(await validateBagsRetry(
            ctx,
            retry!.sourceRunKey,
            retry!.sourceJobId,
          ))
        )
          return null;
        recoveryKind = "provider-retry";
      } else if (matchesDataRecovery) {
        if (
          dataRecovery!.claimedAt !== undefined ||
          dataRecovery!.runKey !==
            `${args.operatorRetryOf}:operator-data-recovery-1` ||
          !(await validateBagsDataRecovery(
            ctx,
            dataRecovery!.sourceRunKey,
            now,
          ))
        )
          return null;
        recoveryKind = "data-recovery";
      } else if (matchesValidationVerification) {
        if (
          validationVerification!.claimedAt !== undefined ||
          validationVerification!.runKey !==
            `${args.operatorRetryOf}:operator-validation-verification-1` ||
          !(await validateBagsValidationVerification(
            ctx,
            validationVerification!.sourceRunKey,
            validationVerification!.sourceJobId,
            now,
          ))
        )
          return null;
        recoveryKind = "validation-verification";
      } else {
        if (
          grammarVerification!.claimedAt !== undefined ||
          grammarVerification!.runKey !==
            `${args.operatorRetryOf}:operator-grammar-verification-1` ||
          !(await validateBagsGrammarVerification(
            ctx,
            grammarVerification!.sourceRunKey,
            grammarVerification!.sourceJobId,
            now,
          ))
        )
          return null;
        recoveryKind = "grammar-verification";
      }
    }
    const runKey =
      args.operatorRetryOf === undefined
        ? tokenAlphaRunKey(args.platform, now)
        : recoveryKind === "provider-retry"
          ? retry!.runKey
          : recoveryKind === "data-recovery"
            ? dataRecovery!.runKey
            : recoveryKind === "validation-verification"
              ? validationVerification!.runKey
              : grammarVerification!.runKey;
    const existing = await ctx.db
      .query("tokenAlphaRuns")
      .withIndex("by_runKey", (q) => q.eq("runKey", runKey))
      .unique();
    const forumExisting = await ctx.db
      .query("forumAgentRuns")
      .withIndex("by_runKey", (q) => q.eq("runKey", runKey))
      .unique();
    if (existing !== null || forumExisting !== null) return null;
    const operatorFirstPost = args.operatorFirstPost === true;
    const priorAttempts = control.operatorFirstPostAttempts ?? [];
    if (operatorFirstPost) {
      // This is the owner's explicit, once-per-lane first-post observation,
      // not circuit recovery. The capability is internal and permanently spent
      // even if generation later fails or its delivery outcome is unknown.
      if (
        priorAttempts.length >= 2 ||
        new Set(priorAttempts).size !== priorAttempts.length ||
        priorAttempts.includes(args.platform)
      )
        return null;
      const published = await ctx.db
        .query("forumAgentRuns")
        .withIndex("by_agentSlug_and_status_and_startedAt", (q) =>
          q.eq("agentSlug", entry.slug).eq("status", "published"),
        )
        .take(1);
      if (published.length > 0) return null;
    }
    const runDate = forumDay(now);
    const dailyLimit = forumDailyPublicationLimit(
      env.FORUM_AGENT_DAILY_PUBLICATION_LIMIT,
    );
    // Complete bounded day scan: skipped rows must not push occupied rows out
    // of view. Unexpected volume fails closed rather than weakening the gate.
    const globalRuns = await ctx.db
      .query("forumAgentRuns")
      .withIndex("by_runDate", (q) => q.eq("runDate", runDate))
      .take(256);
    if (
      globalRuns.length === 256 ||
      globalRuns.filter(
        (run) => run.status === "running" || run.status === "published",
      ).length >= dailyLimit ||
      // Isolate this workload's failures, not its publication allowance. Old
      // unrelated editorial failures must not latch a healthy token pilot shut.
      globalRuns.filter(
        (run) => run.status === "failed" && SCOUT_SLUGS.has(run.agentSlug),
      ).length >= 12 ||
      globalRuns.some(
        (run) =>
          run.agentSlug === entry.slug &&
          (run.status === "running" ||
            (run.slot === new Date(now).getUTCHours() &&
              args.operatorRetryOf === undefined)),
      ) ||
      globalRuns.filter(
        (run) =>
          run.agentSlug === entry.slug &&
          (run.status === "running" || run.status === "published"),
      ).length >= Math.min(24, agent.dailyPostTarget)
    )
      return null;
    const runId = await ctx.db.insert("tokenAlphaRuns", {
      runKey,
      platform: args.platform,
      claimToken: args.claimToken,
      operatorFirstPost: operatorFirstPost ? true : undefined,
      operatorRetryOf: args.operatorRetryOf,
      status: "running",
      createdAt: now,
      updatedAt: now,
      expiresAt: now + RUN_LIFETIME_MS,
    });
    await ctx.db.insert("forumAgentRuns", {
      runKey,
      agentSlug: entry.slug,
      runDate,
      slot: new Date(now).getUTCHours(),
      attempt: 0,
      status: "running",
      model: agent.model,
      categorySlug: entry.categorySlug,
      sourceUrls: [],
      startedAt: now,
      updatedAt: now,
    });
    if (operatorFirstPost) {
      await ctx.db.patch("tokenAlphaControl", control._id, {
        operatorFirstPostAttempts: [...priorAttempts, args.platform],
        updatedAt: now,
      });
    }
    if (recoveryKind === "provider-retry") {
      await ctx.db.patch("tokenAlphaControl", control._id, {
        operatorBagsRetry: { ...retry!, claimedAt: now },
        updatedAt: now,
      });
    } else if (recoveryKind === "data-recovery") {
      await ctx.db.patch("tokenAlphaControl", control._id, {
        operatorBagsDataRecovery: { ...dataRecovery!, claimedAt: now },
        updatedAt: now,
      });
    } else if (recoveryKind === "validation-verification") {
      await ctx.db.patch("tokenAlphaControl", control._id, {
        operatorBagsValidationVerification: {
          ...validationVerification!,
          claimedAt: now,
        },
        updatedAt: now,
      });
    } else if (recoveryKind === "grammar-verification") {
      await ctx.db.patch("tokenAlphaControl", control._id, {
        operatorBagsGrammarVerification: {
          ...grammarVerification!,
          claimedAt: now,
        },
        updatedAt: now,
      });
    }
    return await ctx.db.get("tokenAlphaRuns", runId);
  },
});

export const getRun = internalQuery({
  args: { runKey: v.string() },
  returns: v.union(schema.doc("tokenAlphaRuns"), v.null()),
  handler: async (ctx, args) =>
    await ctx.db
      .query("tokenAlphaRuns")
      .withIndex("by_runKey", (q) => q.eq("runKey", args.runKey))
      .unique(),
});

export const getContext = internalQuery({
  args: { platform: tokenPlatformValidator, mints: v.array(v.string()) },
  returns: v.object({
    tracked: v.array(
      v.object({
        mint: v.string(),
        lastUpdatedAt: v.number(),
        threadId: v.id("forumThreads"),
      }),
    ),
    metadata: v.array(tokenSnapshotValidator),
  }),
  handler: async (ctx, args) => {
    if (
      args.mints.length > 5 ||
      args.mints.some((mint) => !MINT_PATTERN.test(mint))
    ) {
      throw new Error("At most five exact Solana mints are permitted");
    }
    const tracked = [];
    const metadata: TokenSnapshot[] = [];
    for (const mint of new Set(args.mints)) {
      const record = await ctx.db
        .query("tokenAlphaTrackedTokens")
        .withIndex("by_chain_and_mint", (q) =>
          q.eq("chain", "solana").eq("mint", mint),
        )
        .unique();
      if (record === null) continue;
      tracked.push({
        mint,
        threadId: record.threadId,
        lastUpdatedAt: record.lastUpdatedAt,
      });
      if (record.latestSnapshot?.platform === args.platform)
        metadata.push(record.latestSnapshot);
    }
    return { tracked, metadata };
  },
});

async function activeClaim(
  ctx: MutationCtx,
  runKey: string,
  claimToken: string,
): Promise<Doc<"tokenAlphaRuns">> {
  const run = await ctx.db
    .query("tokenAlphaRuns")
    .withIndex("by_runKey", (q) => q.eq("runKey", runKey))
    .unique();
  if (
    run === null ||
    run.claimToken !== claimToken ||
    run.status !== "running" ||
    run.expiresAt <= Date.now() ||
    !(await pilotEnabled(ctx))
  )
    throw new Error("Token scout claim is inactive or expired");
  return run;
}

export const saveSnapshot = internalMutation({
  args: {
    runKey: v.string(),
    claimToken: v.string(),
    snapshot: tokenSnapshotValidator,
  },
  returns: schema.doc("tokenAlphaRuns"),
  handler: async (ctx, args) => {
    const run = await activeClaim(ctx, args.runKey, args.claimToken);
    if (run.snapshot !== undefined)
      throw new Error("A token snapshot has already been selected");
    if (
      run.platform !== args.snapshot.platform ||
      !MINT_PATTERN.test(args.snapshot.mint)
    )
      throw new Error("Snapshot does not match this token scout run");
    const canonical = await ctx.db
      .query("tokenAlphaTrackedTokens")
      .withIndex("by_chain_and_mint", (q) =>
        q.eq("chain", "solana").eq("mint", args.snapshot.mint),
      )
      .unique();
    await ctx.db.patch("tokenAlphaRuns", run._id, {
      snapshot: args.snapshot,
      previous: canonical?.latestSnapshot,
      threadId: canonical?.threadId,
      updatedAt: Date.now(),
    });
    const saved = await ctx.db.get("tokenAlphaRuns", run._id);
    if (saved === null)
      throw new Error("Token scout snapshot could not be saved");
    return saved;
  },
});

export const saveDraft = internalMutation({
  args: {
    runKey: v.string(),
    claimToken: v.string(),
    analysis: v.string(),
    title: v.string(),
    body: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const run = await activeClaim(ctx, args.runKey, args.claimToken);
    if (
      run.snapshot === undefined ||
      !args.analysis.trim() ||
      args.analysis.length > 4_000 ||
      !args.title.trim() ||
      args.title.length > 160 ||
      !args.body.trim() ||
      args.body.length > 30_000
    ) {
      throw new Error("Token scout draft is missing or exceeds its bounds");
    }
    await ctx.db.patch("tokenAlphaRuns", run._id, {
      status: "drafted",
      analysis: args.analysis,
      title: args.title,
      body: args.body,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const finishRun = internalMutation({
  args: {
    runKey: v.string(),
    claimToken: v.string(),
    status: v.union(
      v.literal("held"),
      v.literal("skipped"),
      v.literal("failed"),
    ),
    reason: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const run = await ctx.db
      .query("tokenAlphaRuns")
      .withIndex("by_runKey", (q) => q.eq("runKey", args.runKey))
      .unique();
    if (run === null || run.claimToken !== args.claimToken)
      throw new Error("Token scout claim does not match");
    // A replay cannot downgrade a publication or erase a quarantined result.
    if (run.status !== "running" && run.status !== "drafted") return null;
    const now = Date.now();
    const reason = args.reason.slice(0, 500);
    await ctx.db.patch("tokenAlphaRuns", run._id, {
      status: args.status,
      reason,
      updatedAt: now,
    });
    const forumRun = await ctx.db
      .query("forumAgentRuns")
      .withIndex("by_runKey", (q) => q.eq("runKey", args.runKey))
      .unique();
    if (forumRun !== null && forumRun.status === "running") {
      await ctx.db.patch("forumAgentRuns", forumRun._id, {
        status: args.status === "skipped" ? "skipped" : "failed",
        errorMessage: reason,
        completedAt: now,
        updatedAt: now,
      });
    }
    return null;
  },
});

/** Must commit before every provider request. Errors never refund a request. */
export const reserveApiRequest = internalMutation({
  args: {
    kind: v.optional(v.union(v.literal("ranking"), v.literal("enrichment"))),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    if (!(await pilotEnabled(ctx))) return false;
    const now = Date.now();
    const dayKey = utcDay(now);
    const oldestDay = utcDay(Date.parse(`${dayKey}T00:00:00.000Z`) - 31 * DAY);
    const days = await ctx.db
      .query("tokenAlphaUsageDays")
      .withIndex("by_dayKey", (q) =>
        q.gte("dayKey", oldestDay).lte("dayKey", dayKey),
      )
      .take(34);
    if (
      days.length > 32 ||
      days.some(
        (day) => !Number.isSafeInteger(day.requests) || day.requests < 0,
      )
    )
      return false;
    const today = days.find((day) => day.dayKey === dayKey);
    const enrichmentRequests = today?.enrichmentRequests ?? 0;
    if (
      !Number.isSafeInteger(enrichmentRequests) ||
      enrichmentRequests < 0 ||
      (today?.requests ?? 0) >= DAILY_REQUEST_CAP ||
      days.reduce((total, day) => total + day.requests, 0) >=
        ROLLING_REQUEST_CAP
    )
      return false;
    // Metadata must never spend the daily capacity reserved for the forty-eight
    // scheduled ranking reads. Denial occurs before the overall provider limit.
    const isEnrichment = args.kind === "enrichment";
    if (isEnrichment) {
      if (enrichmentRequests >= DAILY_ENRICHMENT_CAP) return false;
      const metadataAllowance = await trackerLimiter.limit(
        ctx,
        "tokenAlphaTrackerEnrichment",
      );
      if (!metadataAllowance.ok) return false;
    }
    const allowance = await trackerLimiter.limit(
      ctx,
      "tokenAlphaTrackerRequests",
    );
    if (!allowance.ok) return false;
    if (today === undefined)
      await ctx.db.insert("tokenAlphaUsageDays", {
        dayKey,
        requests: 1,
        enrichmentRequests: isEnrichment ? 1 : 0,
        updatedAt: now,
      });
    else
      await ctx.db.patch("tokenAlphaUsageDays", today._id, {
        requests: today.requests + 1,
        enrichmentRequests: enrichmentRequests + (isEnrichment ? 1 : 0),
        updatedAt: now,
      });
    return true;
  },
});

/** Ordinary hourly scheduling never invokes the one-shot operator exception. */
export const queueHourly = internalMutation({
  args: {},
  returns: v.object({ queued: v.number() }),
  handler: async (ctx) => {
    if (!(await pilotEnabled(ctx))) return { queued: 0 };
    let queued = 0;
    for (const platform of PLATFORMS) {
      const agent = await ctx.db
        .query("forumAgents")
        .withIndex("by_slug", (q) =>
          q.eq("slug", TOKEN_ALPHA_AGENTS[platform].slug),
        )
        .unique();
      const existing = await ctx.db
        .query("tokenAlphaRuns")
        .withIndex("by_runKey", (q) =>
          q.eq("runKey", tokenAlphaRunKey(platform, Date.now())),
        )
        .unique();
      if (agent === null || !agent.enabled || existing !== null) continue;
      await ctx.scheduler.runAfter(
        queued * 60_000,
        internal.tokenAlphaAgent.run,
        { platform },
      );
      queued += 1;
    }
    return { queued };
  },
});

/** Internal, operator-invoked only. There is deliberately no recurring cron. */
export const queueFirstPosts = internalMutation({
  args: {},
  returns: v.object({ queued: v.number() }),
  handler: async (ctx) => {
    const control = await ctx.db
      .query("tokenAlphaControl")
      .withIndex("by_key", (q) => q.eq("key", "pilot"))
      .unique();
    if (control?.enabled !== true) return { queued: 0 };
    const attempts = control.operatorFirstPostAttempts ?? [];
    if (attempts.length > 2 || new Set(attempts).size !== attempts.length)
      return { queued: 0 };
    let queued = 0;
    for (const platform of PLATFORMS) {
      if (attempts.includes(platform)) continue;
      const entry = TOKEN_ALPHA_AGENTS[platform];
      const agent = await ctx.db
        .query("forumAgents")
        .withIndex("by_slug", (q) => q.eq("slug", entry.slug))
        .unique();
      const existing = await ctx.db
        .query("tokenAlphaRuns")
        .withIndex("by_runKey", (q) =>
          q.eq("runKey", tokenAlphaRunKey(platform, Date.now())),
        )
        .unique();
      const published = await ctx.db
        .query("forumAgentRuns")
        .withIndex("by_agentSlug_and_status_and_startedAt", (q) =>
          q.eq("agentSlug", entry.slug).eq("status", "published"),
        )
        .take(1);
      if (
        agent === null ||
        !agent.enabled ||
        existing !== null ||
        published.length > 0
      )
        continue;
      await ctx.scheduler.runAfter(
        queued * 60_000,
        internal.tokenAlphaAgent.run,
        { platform, operatorFirstPost: true },
      );
      queued += 1;
    }
    return { queued };
  },
});
