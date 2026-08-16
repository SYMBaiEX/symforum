import { ConvexError, v } from "convex/values";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireAuthenticatedUser } from "./authz";

const MAX_IDENTIFIER_LENGTH = 120;
const MAX_FINGERPRINT_LENGTH = 128;
const MAX_JSON_LENGTH = 4_096;
const MAX_UNITS = 1_000_000;

const commandStatusValidator = v.union(
  v.literal("accepted"),
  v.literal("completed"),
  v.literal("failed"),
);

const DEFAULT_PRODUCTS = [
  {
    productKey: "evidence-beta",
    name: "Evidence API beta",
    description: "Bounded beta access to evidence-scoped API operations.",
  },
] as const;

function identifier(
  value: string,
  name: string,
  maximum = MAX_IDENTIFIER_LENGTH,
) {
  const normalized = value.trim().toLowerCase();
  if (
    normalized.length === 0 ||
    normalized.length > maximum ||
    !/^[a-z0-9][a-z0-9._:-]*$/.test(normalized)
  ) {
    throw new ConvexError({
      code: "INVALID_COMMERCE_VALUE",
      message: `${name} must be a bounded identifier.`,
    });
  }
  return normalized;
}

function requestFingerprint(value: string) {
  return identifier(value, "requestFingerprint", MAX_FINGERPRINT_LENGTH);
}

function units(value: number) {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_UNITS) {
    throw new ConvexError({
      code: "INVALID_COMMERCE_UNITS",
      message: `units must be an integer between 1 and ${MAX_UNITS}.`,
    });
  }
  return value;
}

function boundedObjectJson(value: string | undefined, name: string) {
  const json = value ?? "{}";
  if (json.length > MAX_JSON_LENGTH) {
    throw new ConvexError({
      code: "INVALID_COMMERCE_JSON",
      message: `${name} must be at most ${MAX_JSON_LENGTH} characters.`,
    });
  }
  try {
    const parsed: unknown = JSON.parse(json);
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      throw new Error("expected object");
    }
  } catch {
    throw new ConvexError({
      code: "INVALID_COMMERCE_JSON",
      message: `${name} must be a JSON object.`,
    });
  }
  return json;
}

type DatabaseCtx = QueryCtx | MutationCtx;

async function productByKey(ctx: DatabaseCtx, productKey: string) {
  return await ctx.db
    .query("apiProducts")
    .withIndex("by_productKey", (q) => q.eq("productKey", productKey))
    .unique();
}

async function ownedActiveAgent(
  ctx: DatabaseCtx,
  ownerUserId: Id<"users">,
  agentId: string,
) {
  const identity = await ctx.db
    .query("agentIdentities")
    .withIndex("by_agentId", (q) => q.eq("agentId", agentId))
    .unique();
  if (
    identity === null ||
    identity.ownerUserId !== ownerUserId ||
    identity.status !== "active"
  ) {
    throw new ConvexError({
      code: "COMMERCE_AGENT_DENIED",
      message: "Active owned agent required.",
    });
  }
  const agent = await ctx.db.get("users", identity.userId);
  if (agent?.isAgent !== true || agent.agentStatus !== "active") {
    throw new ConvexError({
      code: "COMMERCE_AGENT_DENIED",
      message: "Active owned agent required.",
    });
  }
  return { identity, agent };
}

async function commercePrincipal(ctx: DatabaseCtx) {
  const actor = await requireAuthenticatedUser(ctx);
  if (actor.isAgent !== true) {
    return { actor, ownerUserId: actor._id, agentId: null };
  }
  const identity = await ctx.db
    .query("agentIdentities")
    .withIndex("by_userId", (q) => q.eq("userId", actor._id))
    .unique();
  if (
    identity === null ||
    identity.status !== "active" ||
    identity.ownerUserId === undefined
  ) {
    throw new ConvexError({
      code: "COMMERCE_AGENT_DENIED",
      message: "Active owned agent required.",
    });
  }
  return {
    actor,
    ownerUserId: identity.ownerUserId,
    agentId: identity.agentId,
  };
}

async function resolveEntitlement(
  ctx: DatabaseCtx,
  ownerUserId: Id<"users">,
  product: Doc<"apiProducts">,
  agent: Doc<"users">,
  now: number,
) {
  const explicit = await ctx.db
    .query("apiEntitlements")
    .withIndex("by_ownerUserId_and_productId", (q) =>
      q.eq("ownerUserId", ownerUserId).eq("productId", product._id),
    )
    .unique();
  if (
    explicit !== null &&
    explicit.status === "active" &&
    explicit.startsAt <= now &&
    (explicit.expiresAt === undefined || explicit.expiresAt > now)
  ) {
    return {
      granted: true,
      grant: "entitlement" as const,
      entitlement: explicit,
    };
  }
  // A recorded entitlement is authoritative: revocation and expiry must not
  // silently fall back to the beta grant.
  if (explicit !== null) {
    return { granted: false, grant: "none" as const, entitlement: explicit };
  }
  if (
    product.productKey.startsWith("evidence-") &&
    product.unitPriceMicroUsd === undefined &&
    product.status === "active" &&
    product.visibility === "public" &&
    agent.agentScopes?.includes("evidence")
  ) {
    return { granted: true, grant: "free-beta" as const, entitlement: null };
  }
  return { granted: false, grant: "none" as const, entitlement: explicit };
}

/** Idempotently seed only the disabled-by-default product catalog; no provider is contacted. */
export const seedDefaultProducts = internalMutation({
  args: {},
  returns: v.object({
    productIds: v.array(v.id("apiProducts")),
    billingEnabled: v.boolean(),
  }),
  handler: async (ctx) => {
    const now = Date.now();
    const productIds: Id<"apiProducts">[] = [];
    for (const product of DEFAULT_PRODUCTS) {
      const existing = await productByKey(ctx, product.productKey);
      if (existing !== null) {
        productIds.push(existing._id);
        continue;
      }
      productIds.push(
        await ctx.db.insert("apiProducts", {
          ...product,
          status: "active",
          visibility: "public",
          createdAt: now,
          updatedAt: now,
        }),
      );
    }
    return { productIds, billingEnabled: false };
  },
});

export const listAvailableProducts = query({
  args: {},
  returns: v.array(
    v.object({
      productId: v.id("apiProducts"),
      productKey: v.string(),
      name: v.string(),
      description: v.string(),
      status: v.union(v.literal("active"), v.literal("archived")),
      visibility: v.union(v.literal("public"), v.literal("private")),
      updatedAt: v.number(),
      billingEnabled: v.boolean(),
    }),
  ),
  handler: async (ctx) => {
    await requireAuthenticatedUser(ctx);
    const products = await ctx.db
      .query("apiProducts")
      .withIndex("by_visibility_and_status_and_updatedAt", (q) =>
        q.eq("visibility", "public").eq("status", "active"),
      )
      .take(50);
    return products.map(
      ({
        _id,
        productKey,
        name,
        description,
        status,
        visibility,
        updatedAt,
      }) => ({
        productId: _id,
        productKey,
        name,
        description,
        status,
        visibility,
        updatedAt,
        billingEnabled: false,
      }),
    );
  },
});

export const getMyEntitlements = query({
  args: {},
  returns: v.array(
    v.object({
      productId: v.id("apiProducts"),
      status: v.union(
        v.literal("active"),
        v.literal("revoked"),
        v.literal("expired"),
      ),
      startsAt: v.number(),
      expiresAt: v.optional(v.number()),
      updatedAt: v.number(),
      billingEnabled: v.boolean(),
    }),
  ),
  handler: async (ctx) => {
    const principal = await commercePrincipal(ctx);
    const entitlements = await ctx.db
      .query("apiEntitlements")
      .withIndex("by_ownerUserId_and_productId", (q) =>
        q.eq("ownerUserId", principal.ownerUserId),
      )
      .take(100);
    return entitlements.map(
      ({ productId, status, startsAt, expiresAt, updatedAt }) => ({
        productId,
        status,
        startsAt,
        expiresAt,
        updatedAt,
        billingEnabled: false,
      }),
    );
  },
});

/** Effective product access for the authenticated principal, including free-beta grants. */
export const getMyAccessSummary = query({
  args: {},
  returns: v.array(
    v.object({
      productId: v.id("apiProducts"),
      productKey: v.string(),
      status: v.union(v.literal("active"), v.literal("denied")),
      grant: v.union(
        v.literal("entitlement"),
        v.literal("free-beta"),
        v.literal("none"),
      ),
      expiresAt: v.optional(v.number()),
      billingEnabled: v.boolean(),
    }),
  ),
  handler: async (ctx) => {
    const principal = await commercePrincipal(ctx);
    const products = await ctx.db
      .query("apiProducts")
      .withIndex("by_visibility_and_status_and_updatedAt", (q) =>
        q.eq("visibility", "public").eq("status", "active"),
      )
      .take(50);
    const now = Date.now();
    const results = [];
    for (const product of products) {
      const access = await resolveEntitlement(
        ctx,
        principal.ownerUserId,
        product,
        principal.actor,
        now,
      );
      results.push({
        productId: product._id,
        productKey: product.productKey,
        status: access.granted ? ("active" as const) : ("denied" as const),
        grant: access.grant,
        expiresAt: access.entitlement?.expiresAt,
        billingEnabled: false,
      });
    }
    return results;
  },
});

export const getMyUsageStatus = query({
  args: { limit: v.optional(v.number()) },
  returns: v.array(
    v.object({
      entryId: v.id("apiUsageLedger"),
      productId: v.optional(v.id("apiProducts")),
      commandId: v.optional(v.id("apiCommands")),
      operation: v.string(),
      entryType: v.union(
        v.literal("debit"),
        v.literal("credit"),
        v.literal("reversal"),
      ),
      units: v.number(),
      createdAt: v.number(),
      billingEnabled: v.boolean(),
    }),
  ),
  handler: async (ctx, args) => {
    const principal = await commercePrincipal(ctx);
    const limit = args.limit ?? 50;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new ConvexError({
        code: "INVALID_COMMERCE_LIMIT",
        message: "limit must be between 1 and 100.",
      });
    }
    const entries = await ctx.db
      .query("apiUsageLedger")
      .withIndex("by_ownerUserId_and_createdAt", (q) =>
        q.eq("ownerUserId", principal.ownerUserId),
      )
      .order("desc")
      .take(limit);
    return entries.map(
      ({
        _id,
        productId,
        commandId,
        operation,
        entryType,
        units,
        createdAt,
      }) => ({
        entryId: _id,
        productId,
        commandId,
        operation,
        entryType,
        units,
        createdAt,
        billingEnabled: false,
      }),
    );
  },
});

export const beginOrReplayCommand = mutation({
  args: {
    agentId: v.string(),
    productKey: v.string(),
    idempotencyKey: v.string(),
    requestFingerprint: v.string(),
    operation: v.string(),
    units: v.number(),
    metadataJson: v.optional(v.string()),
  },
  returns: v.object({
    commandId: v.id("apiCommands"),
    ledgerEntryId: v.optional(v.id("apiUsageLedger")),
    status: commandStatusValidator,
    idempotent: v.boolean(),
    billingEnabled: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const principal = await commercePrincipal(ctx);
    const agentId = identifier(args.agentId, "agentId");
    const productKey = identifier(args.productKey, "productKey");
    const idempotencyKey = identifier(args.idempotencyKey, "idempotencyKey");
    const fingerprint = requestFingerprint(args.requestFingerprint);
    const operation = identifier(args.operation, "operation", 80);
    const requestedUnits = units(args.units);
    const metadataJson = boundedObjectJson(args.metadataJson, "metadataJson");
    const { identity, agent } = await ownedActiveAgent(
      ctx,
      principal.ownerUserId,
      agentId,
    );
    if (
      principal.actor._id !== identity.ownerUserId &&
      principal.actor._id !== identity.userId
    ) {
      throw new ConvexError({
        code: "COMMERCE_AGENT_DENIED",
        message: "Active owned agent required.",
      });
    }
    if (principal.agentId !== null && principal.agentId !== agentId) {
      throw new ConvexError({
        code: "COMMERCE_AGENT_DENIED",
        message: "An agent can spend only its own entitlement.",
      });
    }
    const product = await productByKey(ctx, productKey);
    if (product === null || product.status !== "active") {
      throw new ConvexError({
        code: "PRODUCT_UNAVAILABLE",
        message: "Product is unavailable.",
      });
    }
    const commandKey = `${agentId}:${productKey}:${idempotencyKey}`;
    const existing = await ctx.db
      .query("apiCommands")
      .withIndex("by_ownerUserId_and_commandKey", (q) =>
        q.eq("ownerUserId", principal.ownerUserId).eq("commandKey", commandKey),
      )
      .unique();
    if (existing !== null) {
      if (existing.requestFingerprint !== fingerprint) {
        throw new ConvexError({
          code: "COMMAND_IDEMPOTENCY_MISMATCH",
          message:
            "idempotencyKey was already used with a different request fingerprint.",
        });
      }
      return {
        commandId: existing._id,
        status: existing.status,
        idempotent: true,
        billingEnabled: false,
      };
    }
    const now = Date.now();
    const entitlement = await resolveEntitlement(
      ctx,
      principal.ownerUserId,
      product,
      agent,
      now,
    );
    if (!entitlement.granted) {
      throw new ConvexError({
        code: "ENTITLEMENT_REQUIRED",
        message: "An active entitlement is required.",
      });
    }
    const payloadJson = JSON.stringify({
      agentId,
      productKey,
      operation,
      units: requestedUnits,
      metadata: JSON.parse(metadataJson),
    });
    const commandId = await ctx.db.insert("apiCommands", {
      ownerUserId: principal.ownerUserId,
      commandKey,
      requestFingerprint: fingerprint,
      kind: operation,
      status: "accepted",
      payloadJson,
      resultJson: JSON.stringify({ billingEnabled: false }),
      createdAt: now,
      updatedAt: now,
    });
    const entryKey = `debit:${commandId}`;
    const ledgerEntryId = await ctx.db.insert("apiUsageLedger", {
      entryKey,
      ownerUserId: principal.ownerUserId,
      agentId,
      productId: product._id,
      commandId,
      idempotencyKey,
      operation,
      entryType: "debit",
      units: requestedUnits,
      entitlementSnapshotJson: JSON.stringify({
        grant: entitlement.grant,
        status: entitlement.entitlement?.status ?? "active",
        expiresAt: entitlement.entitlement?.expiresAt,
      }),
      costBasisJson: JSON.stringify({ billingEnabled: false }),
      metadataJson,
      createdAt: now,
    });
    const eventKey = `usage:${entryKey}`;
    await ctx.db.insert("apiBillingOutbox", {
      eventKey,
      kind: "usage",
      status: "pending",
      providerEventId: "disabled",
      attempts: 0,
      payloadJson: JSON.stringify({
        ledgerEntryId,
        commandId,
        billingEnabled: false,
      }),
      availableAt: now,
      createdAt: now,
      updatedAt: now,
    });
    return {
      commandId,
      ledgerEntryId,
      status: "accepted" as const,
      idempotent: false,
      billingEnabled: false,
    };
  },
});

/** Inserts one compensating reversal; the original debit remains immutable. */
export const reverseCommandUsage = internalMutation({
  args: { commandId: v.id("apiCommands"), reason: v.string() },
  returns: v.object({
    ledgerEntryId: v.id("apiUsageLedger"),
    idempotent: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const reason = identifier(args.reason, "reason", 80);
    const debit = await ctx.db
      .query("apiUsageLedger")
      .withIndex("by_entryKey", (q) =>
        q.eq("entryKey", `debit:${args.commandId}`),
      )
      .unique();
    if (debit === null || debit.entryType !== "debit") {
      throw new ConvexError({
        code: "USAGE_DEBIT_NOT_FOUND",
        message: "Usage debit not found.",
      });
    }
    const entryKey = `reversal:${debit._id}`;
    const existing = await ctx.db
      .query("apiUsageLedger")
      .withIndex("by_entryKey", (q) => q.eq("entryKey", entryKey))
      .unique();
    if (existing !== null)
      return { ledgerEntryId: existing._id, idempotent: true };
    const ledgerEntryId = await ctx.db.insert("apiUsageLedger", {
      entryKey,
      ownerUserId: debit.ownerUserId,
      agentId: debit.agentId,
      productId: debit.productId,
      commandId: debit.commandId,
      idempotencyKey: debit.idempotencyKey,
      operation: debit.operation,
      entryType: "reversal",
      units: debit.units,
      entitlementSnapshotJson: debit.entitlementSnapshotJson,
      costBasisJson: debit.costBasisJson,
      metadataJson: JSON.stringify({ reason }),
      createdAt: Date.now(),
    });
    return { ledgerEntryId, idempotent: false };
  },
});

export const enqueueBillingOutbox = internalMutation({
  args: {
    eventKey: v.string(),
    kind: v.union(
      v.literal("usage"),
      v.literal("entitlement"),
      v.literal("invoice"),
    ),
    payloadJson: v.string(),
  },
  returns: v.object({
    outboxId: v.id("apiBillingOutbox"),
    idempotent: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const eventKey = identifier(args.eventKey, "eventKey", 160);
    const payloadJson = boundedObjectJson(args.payloadJson, "payloadJson");
    const existing = await ctx.db
      .query("apiBillingOutbox")
      .withIndex("by_eventKey", (q) => q.eq("eventKey", eventKey))
      .unique();
    if (existing !== null) return { outboxId: existing._id, idempotent: true };
    const now = Date.now();
    const outboxId = await ctx.db.insert("apiBillingOutbox", {
      eventKey,
      kind: args.kind,
      status: "pending",
      providerEventId: "disabled",
      attempts: 0,
      payloadJson,
      availableAt: now,
      createdAt: now,
      updatedAt: now,
    });
    return { outboxId, idempotent: false };
  },
});
