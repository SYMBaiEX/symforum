import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { requireAgentScope, requireAuthenticatedUser } from "./authz";

const MAX_WATCHLISTS_PER_PRINCIPAL = 50;
const MAX_LIST_RESULTS = 100;
const targetTypeValidator = v.union(
  v.literal("source"),
  v.literal("entity"),
  v.literal("claim"),
);
const statusValidator = v.union(v.literal("active"), v.literal("paused"));
const deliveryPreferenceValidator = v.union(
  v.literal("in_app"),
  v.literal("webhook"),
  v.literal("none"),
);

type DatabaseCtx = QueryCtx | MutationCtx;
type Principal = { ownerUserId: Id<"users">; agentId: string | null };

function identifier(value: string, name: string, maximum: number) {
  const normalized = value.trim().toLowerCase();
  if (
    normalized.length === 0 ||
    normalized.length > maximum ||
    !/^[a-z0-9][a-z0-9._:-]*$/.test(normalized)
  ) {
    throw new ConvexError({
      code: "INVALID_WATCHLIST_VALUE",
      message: `${name} must be a bounded identifier.`,
    });
  }
  return normalized;
}

function cursor(value: string | undefined) {
  if (value === undefined) return undefined;
  if (value.length > 2_000 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new ConvexError({
      code: "INVALID_WATCHLIST_CURSOR",
      message: "eventCursor must be a bounded opaque cursor.",
    });
  }
  return value;
}

async function evidencePrincipal(ctx: DatabaseCtx): Promise<Principal> {
  const actor = await requireAuthenticatedUser(ctx);
  if (actor.isAgent !== true) return { ownerUserId: actor._id, agentId: null };
  requireAgentScope(actor, "evidence");
  const identity = await ctx.db
    .query("agentIdentities")
    .withIndex("by_userId", (q) => q.eq("userId", actor._id))
    .unique();
  if (
    identity === null ||
    identity.status !== "active" ||
    identity.ownerUserId === undefined ||
    identity.agentId !== actor.agentSlug
  ) {
    throw new ConvexError({
      code: "WATCHLIST_AGENT_DENIED",
      message: "An active owned evidence agent is required.",
    });
  }
  return { ownerUserId: identity.ownerUserId, agentId: identity.agentId };
}

async function requirePublicTarget(
  ctx: DatabaseCtx,
  targetType: "source" | "entity" | "claim",
  targetKey: string,
) {
  if (targetType === "source") {
    const source = await ctx.db
      .query("evidenceSources")
      .withIndex("by_sourceKey", (q) => q.eq("sourceKey", targetKey))
      .unique();
    if (source?.visibility === "public") return;
  } else if (targetType === "entity") {
    const entity = await ctx.db
      .query("evidenceEntities")
      .withIndex("by_entityKey", (q) => q.eq("entityKey", targetKey))
      .unique();
    if (entity?.visibility === "public") return;
  } else {
    const claim = await ctx.db
      .query("evidenceClaims")
      .withIndex("by_claimKey", (q) => q.eq("claimKey", targetKey))
      .unique();
    if (claim?.visibility === "public") return;
  }
  throw new ConvexError({
    code: "WATCHLIST_TARGET_UNAVAILABLE",
    message: "Only current public evidence targets may be watched.",
  });
}

function safeWatchlist(row: Doc<"evidenceWatchlists">) {
  return {
    watchlistId: row._id,
    watchlistKey: row.watchlistKey,
    targetType: row.targetType,
    targetKey: row.targetKey,
    status: row.status,
    deliveryPreference: row.deliveryPreference,
    eventCursor: row.eventCursor ?? null,
    agentId: row.agentId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const safeWatchlistValidator = v.object({
  watchlistId: v.id("evidenceWatchlists"),
  watchlistKey: v.string(),
  targetType: targetTypeValidator,
  targetKey: v.string(),
  status: statusValidator,
  deliveryPreference: deliveryPreferenceValidator,
  eventCursor: v.union(v.string(), v.null()),
  agentId: v.union(v.string(), v.null()),
  createdAt: v.number(),
  updatedAt: v.number(),
});

async function findWatchlist(
  ctx: DatabaseCtx,
  principal: Principal,
  watchlistKey: string,
) {
  const row = await ctx.db
    .query("evidenceWatchlists")
    .withIndex("by_ownerUserId_and_watchlistKey", (q) =>
      q
        .eq("ownerUserId", principal.ownerUserId)
        .eq("watchlistKey", watchlistKey),
    )
    .unique();
  if (
    row === null ||
    (principal.agentId !== null && row.agentId !== principal.agentId)
  ) {
    throw new ConvexError({
      code: "WATCHLIST_NOT_FOUND",
      message: "Watchlist was not found.",
    });
  }
  return row;
}

/** Creates one exact public-target watchlist for the authenticated owner or agent. */
export const create = mutation({
  args: {
    watchlistKey: v.string(),
    targetType: targetTypeValidator,
    targetKey: v.string(),
    deliveryPreference: deliveryPreferenceValidator,
    eventCursor: v.optional(v.string()),
  },
  returns: safeWatchlistValidator,
  handler: async (ctx, args) => {
    const principal = await evidencePrincipal(ctx);
    const watchlistKey = identifier(args.watchlistKey, "watchlistKey", 96);
    const targetKey = identifier(args.targetKey, "targetKey", 200);
    const eventCursor = cursor(args.eventCursor);
    await requirePublicTarget(ctx, args.targetType, targetKey);
    const existing = await ctx.db
      .query("evidenceWatchlists")
      .withIndex("by_ownerUserId_and_watchlistKey", (q) =>
        q
          .eq("ownerUserId", principal.ownerUserId)
          .eq("watchlistKey", watchlistKey),
      )
      .unique();
    if (existing !== null) {
      if (existing.agentId !== principal.agentId) {
        throw new ConvexError({
          code: "WATCHLIST_KEY_IN_USE",
          message: "watchlistKey is already in use by this account.",
        });
      }
      if (
        existing.targetType !== args.targetType ||
        existing.targetKey !== targetKey ||
        existing.deliveryPreference !== args.deliveryPreference ||
        (existing.eventCursor ?? undefined) !== eventCursor
      ) {
        throw new ConvexError({
          code: "WATCHLIST_IDEMPOTENCY_MISMATCH",
          message:
            "watchlistKey was already used with different watch settings.",
        });
      }
      return safeWatchlist(existing);
    }
    const existingForPrincipal = await ctx.db
      .query("evidenceWatchlists")
      .withIndex("by_ownerUserId_and_agentId_and_updatedAt", (q) =>
        q
          .eq("ownerUserId", principal.ownerUserId)
          .eq("agentId", principal.agentId),
      )
      .take(MAX_WATCHLISTS_PER_PRINCIPAL + 1);
    if (existingForPrincipal.length >= MAX_WATCHLISTS_PER_PRINCIPAL) {
      throw new ConvexError({
        code: "WATCHLIST_LIMIT",
        message: `Each principal can maintain at most ${MAX_WATCHLISTS_PER_PRINCIPAL} watchlists.`,
      });
    }
    const now = Date.now();
    const watchlistId = await ctx.db.insert("evidenceWatchlists", {
      ownerUserId: principal.ownerUserId,
      agentId: principal.agentId,
      watchlistKey,
      targetType: args.targetType,
      targetKey,
      status: "active",
      deliveryPreference: args.deliveryPreference,
      eventCursor,
      createdAt: now,
      updatedAt: now,
    });
    return safeWatchlist(
      (await ctx.db.get("evidenceWatchlists", watchlistId))!,
    );
  },
});

export const listMine = query({
  args: {},
  returns: v.array(safeWatchlistValidator),
  handler: async (ctx) => {
    const principal = await evidencePrincipal(ctx);
    const rows =
      principal.agentId === null
        ? await ctx.db
            .query("evidenceWatchlists")
            .withIndex("by_ownerUserId_and_updatedAt", (q) =>
              q.eq("ownerUserId", principal.ownerUserId),
            )
            .order("desc")
            .take(MAX_LIST_RESULTS)
        : await ctx.db
            .query("evidenceWatchlists")
            .withIndex("by_ownerUserId_and_agentId_and_updatedAt", (q) =>
              q
                .eq("ownerUserId", principal.ownerUserId)
                .eq("agentId", principal.agentId),
            )
            .order("desc")
            .take(MAX_LIST_RESULTS);
    return rows.map(safeWatchlist);
  },
});

export const setStatus = mutation({
  args: { watchlistKey: v.string(), status: statusValidator },
  returns: safeWatchlistValidator,
  handler: async (ctx, args) => {
    const principal = await evidencePrincipal(ctx);
    const watchlist = await findWatchlist(
      ctx,
      principal,
      identifier(args.watchlistKey, "watchlistKey", 96),
    );
    const updatedAt = Date.now();
    await ctx.db.patch("evidenceWatchlists", watchlist._id, {
      status: args.status,
      updatedAt,
    });
    return safeWatchlist({ ...watchlist, status: args.status, updatedAt });
  },
});

/** Deletion revokes the saved preference only; it cannot emit or replay an event. */
export const remove = mutation({
  args: { watchlistKey: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const principal = await evidencePrincipal(ctx);
    const watchlist = await findWatchlist(
      ctx,
      principal,
      identifier(args.watchlistKey, "watchlistKey", 96),
    );
    await ctx.db.delete("evidenceWatchlists", watchlist._id);
    return null;
  },
});
