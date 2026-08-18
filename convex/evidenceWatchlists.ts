import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { requireAgentScope, requireAuthenticatedUser } from "./authz";

const MAX_WATCHLISTS_PER_PRINCIPAL = 50;
const MAX_LIST_RESULTS = 100;
const MAX_EVENTS_PER_DRAIN = 20;
const MAX_MATCHES_PER_DRAIN = 20;
const MAX_OUTBOX_FANOUT_PER_EVENT = 1;
const MAX_ENTITY_LINKS_PER_DOCUMENT = 24;
const targetTypeValidator = v.union(
  v.literal("source"),
  v.literal("entity"),
  v.literal("claim"),
  v.literal("document"),
  v.literal("topic"),
  v.literal("repository"),
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

function targetIdentifier(
  targetType:
    | "source"
    | "entity"
    | "claim"
    | "document"
    | "topic"
    | "repository",
  value: string,
) {
  if (targetType === "document") {
    const documentId = value.trim();
    if (!/^[A-Za-z0-9]+$/.test(documentId) || documentId.length > 128) {
      throw new ConvexError({
        code: "INVALID_WATCHLIST_VALUE",
        message: "document targetKey must be a bounded document identifier.",
      });
    }
    return documentId;
  }
  const targetKey = value.trim().toLowerCase();
  if (
    targetKey.length === 0 ||
    targetKey.length > 200 ||
    !/^[a-z0-9][a-z0-9._:/-]*$/.test(targetKey)
  ) {
    throw new ConvexError({
      code: "INVALID_WATCHLIST_VALUE",
      message: "targetKey must be a bounded identifier.",
    });
  }
  if (targetType === "topic" && !targetKey.startsWith("topic:")) {
    throw new ConvexError({
      code: "INVALID_WATCHLIST_VALUE",
      message: "topic targets must use the topic: key namespace.",
    });
  }
  if (targetType === "repository" && !targetKey.startsWith("repository:")) {
    throw new ConvexError({
      code: "INVALID_WATCHLIST_VALUE",
      message: "repository targets must use the repository: key namespace.",
    });
  }
  return targetKey;
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
  targetType:
    | "source"
    | "entity"
    | "claim"
    | "document"
    | "topic"
    | "repository",
  targetKey: string,
) {
  if (targetType === "source") {
    const source = await ctx.db
      .query("evidenceSources")
      .withIndex("by_sourceKey", (q) => q.eq("sourceKey", targetKey))
      .unique();
    if (source?.visibility === "public" && source.status !== "retired") return;
  } else if (
    targetType === "entity" ||
    targetType === "topic" ||
    targetType === "repository"
  ) {
    const entity = await ctx.db
      .query("evidenceEntities")
      .withIndex("by_entityKey", (q) => q.eq("entityKey", targetKey))
      .unique();
    if (
      entity?.visibility === "public" &&
      (targetType === "entity" ||
        (targetType === "topic" && entity.kind === "concept") ||
        (targetType === "repository" && entity.kind === "project"))
    )
      return;
  } else if (targetType === "claim") {
    const claim = await ctx.db
      .query("evidenceClaims")
      .withIndex("by_claimKey", (q) => q.eq("claimKey", targetKey))
      .unique();
    if (claim?.visibility === "public") return;
  } else {
    const document = await ctx.db.get(
      "evidenceDocuments",
      targetKey as Id<"evidenceDocuments">,
    );
    if (document?.visibility === "public") return;
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
    const targetKey = targetIdentifier(args.targetType, args.targetKey);
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

async function eventMatchesWatchlist(
  ctx: MutationCtx,
  watchlist: Doc<"evidenceWatchlists">,
  event: Doc<"evidenceChangeEvents">,
) {
  if (event.visibility !== "public") return false;
  if (watchlist.targetType === "claim") {
    if (event.entityType !== "claim") return false;
    const claim = await ctx.db.get(
      "evidenceClaims",
      event.entityId as Id<"evidenceClaims">,
    );
    return (
      claim?.visibility === "public" && claim.claimKey === watchlist.targetKey
    );
  }
  if (watchlist.targetType === "document") {
    if (
      event.entityType !== "document" ||
      event.entityId !== watchlist.targetKey
    )
      return false;
    const document = await ctx.db.get(
      "evidenceDocuments",
      event.entityId as Id<"evidenceDocuments">,
    );
    return document?.visibility === "public";
  }
  if (event.entityType === "claim") {
    const claim = await ctx.db.get(
      "evidenceClaims",
      event.entityId as Id<"evidenceClaims">,
    );
    if (claim?.visibility !== "public") return false;
    if (
      watchlist.targetType === "entity" ||
      watchlist.targetType === "topic" ||
      watchlist.targetType === "repository"
    ) {
      const entity =
        claim.subjectEntityId === null
          ? null
          : await ctx.db.get("evidenceEntities", claim.subjectEntityId);
      return (
        entity?.visibility === "public" &&
        entity.entityKey === watchlist.targetKey
      );
    }
    return false;
  }
  if (event.entityType !== "document") return false;
  const document = await ctx.db.get(
    "evidenceDocuments",
    event.entityId as Id<"evidenceDocuments">,
  );
  if (document?.visibility !== "public") return false;
  if (watchlist.targetType === "source") {
    const source = await ctx.db.get("evidenceSources", document.sourceId);
    return (
      source?.visibility === "public" &&
      source.status !== "retired" &&
      source.sourceKey === watchlist.targetKey
    );
  }
  if (
    watchlist.targetType === "entity" ||
    watchlist.targetType === "topic" ||
    watchlist.targetType === "repository"
  ) {
    if (document.currentVersionId === null) return false;
    const links = await ctx.db
      .query("evidenceDocumentEntities")
      .withIndex("by_documentVersionId", (q) =>
        q.eq("documentVersionId", document.currentVersionId!),
      )
      .take(MAX_ENTITY_LINKS_PER_DOCUMENT);
    for (const link of links) {
      const entity = await ctx.db.get("evidenceEntities", link.entityId);
      if (
        entity?.visibility === "public" &&
        entity.entityKey === watchlist.targetKey
      )
        return true;
    }
  }
  return false;
}

const drainResultValidator = v.object({
  scanned: v.number(),
  matched: v.number(),
  enqueued: v.number(),
  eventCursor: v.union(v.string(), v.null()),
});

async function drain(ctx: MutationCtx, watchlist: Doc<"evidenceWatchlists">) {
  if (watchlist.status !== "active") {
    return {
      scanned: 0,
      matched: 0,
      enqueued: 0,
      eventCursor: watchlist.eventCursor ?? null,
    };
  }
  // Re-check the target at dispatch time. A retired/private target never
  // produces an outbox record, even when an older event was public.
  try {
    await requirePublicTarget(ctx, watchlist.targetType, watchlist.targetKey);
  } catch {
    return {
      scanned: 0,
      matched: 0,
      enqueued: 0,
      eventCursor: watchlist.eventCursor ?? null,
    };
  }
  const page = await ctx.db
    .query("evidenceChangeEvents")
    .withIndex("by_visibility_and_occurredAt", (q) =>
      q.eq("visibility", "public"),
    )
    .order("asc")
    .paginate({
      cursor: watchlist.eventCursor ?? null,
      numItems: MAX_EVENTS_PER_DRAIN,
    });
  let matched = 0;
  let enqueued = 0;
  for (const event of page.page) {
    if (matched >= MAX_MATCHES_PER_DRAIN) break;
    if (!(await eventMatchesWatchlist(ctx, watchlist, event))) continue;
    matched += 1;
    const existing = await ctx.db
      .query("evidenceWatchlistOutbox")
      .withIndex("by_watchlistId_and_eventId", (q) =>
        q.eq("watchlistId", watchlist._id).eq("eventId", event._id),
      )
      .unique();
    if (existing === null) {
      await ctx.db.insert("evidenceWatchlistOutbox", {
        watchlistId: watchlist._id,
        eventId: event._id,
        ownerUserId: watchlist.ownerUserId,
        agentId: watchlist.agentId,
        deliveryPreference: watchlist.deliveryPreference,
        eventKey: event.eventKey,
        status: "pending",
        createdAt: Date.now(),
      });
      enqueued += MAX_OUTBOX_FANOUT_PER_EVENT;
    }
  }
  const eventCursor = page.continueCursor;
  await ctx.db.patch("evidenceWatchlists", watchlist._id, {
    eventCursor,
    updatedAt: Date.now(),
  });
  return { scanned: page.page.length, matched, enqueued, eventCursor };
}

/** Owner/agent-gated pull for the future delivery bridge; it never delivers externally. */
export const drainMine = mutation({
  args: { watchlistKey: v.string() },
  returns: drainResultValidator,
  handler: async (ctx, args) => {
    const principal = await evidencePrincipal(ctx);
    return await drain(
      ctx,
      await findWatchlist(
        ctx,
        principal,
        identifier(args.watchlistKey, "watchlistKey", 96),
      ),
    );
  },
});

/** Trusted bridge entrypoint: one watchlist transaction, one bounded event page. */
export const drainOutbox = internalMutation({
  args: { watchlistId: v.id("evidenceWatchlists") },
  returns: drainResultValidator,
  handler: async (ctx, args) => {
    const watchlist = await ctx.db.get("evidenceWatchlists", args.watchlistId);
    if (watchlist === null) {
      throw new ConvexError({
        code: "WATCHLIST_NOT_FOUND",
        message: "Watchlist was not found.",
      });
    }
    return await drain(ctx, watchlist);
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
