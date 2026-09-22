import { ConvexError, v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  env,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { requireAgentScope, requireAuthenticatedUser } from "./authz";
import {
  isPublicEvidenceClaim,
  isPublicEvidenceDocument,
} from "./evidenceVisibility";

const MAX_SUBSCRIPTION_KEY_LENGTH = 96;
const MAX_EVENT_TYPES = 12;
const MAX_EVENT_KEY_LENGTH = 160;
const MAX_PAYLOAD_LENGTH = 12_000;
const MAX_SUBSCRIPTIONS_PER_OWNER = 10;
const MAX_DELIVERIES_PER_EVENT = 100;
const MAX_HISTORY_LIMIT = 50;
const MAX_DELIVERY_ATTEMPTS = 4;
const MAX_REPLAY_ATTEMPTS = 3;
const DELIVERY_LEASE_MS = 30_000;
const DELIVERY_ACTION_REF = makeFunctionReference<
  "action",
  { deliveryId: Id<"apiWebhookDeliveries">; deliveryGeneration: number },
  null
>("evidenceWebhookActions:deliver");

const EVENT_TYPES = [
  "evidence.document.changed",
  "evidence.research.completed",
  "evidence.export.completed",
  "evidence.benchmark.completed",
  "evidence.claim.verified",
  "evidence.usage.threshold_reached",
  "evidence.usage.budget_reached",
  "evidence.entitlement.status_changed",
] as const;
const ACCOUNT_SCOPED_EVENT_TYPES = new Set<EventType>([
  "evidence.usage.threshold_reached",
  "evidence.usage.budget_reached",
  "evidence.entitlement.status_changed",
]);
type EventType = (typeof EVENT_TYPES)[number];

const subscriptionStatusValidator = v.union(
  v.literal("active"),
  v.literal("paused"),
  v.literal("revoked"),
);
const safeSubscriptionValidator = v.object({
  subscriptionId: v.id("apiWebhookSubscriptions"),
  subscriptionKey: v.string(),
  url: v.string(),
  status: subscriptionStatusValidator,
  eventTypes: v.array(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
  signingSecret: v.optional(v.string()),
});
const deliveryStatusValidator = v.union(
  v.literal("pending"),
  v.literal("in_flight"),
  v.literal("delivered"),
  v.literal("failed"),
  v.literal("dead_letter"),
);
const safeDeliveryValidator = v.object({
  eventKey: v.string(),
  status: deliveryStatusValidator,
  attempt: v.number(),
  responseCode: v.optional(v.number()),
  nextAttemptAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
});

function base64Url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64Url(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

async function encryptionKey(kek: string) {
  const material = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(kek),
  );
  return crypto.subtle.importKey("raw", material, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encryptWebhookSecret(kek: string, secret: string) {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce },
    await encryptionKey(kek),
    new TextEncoder().encode(secret),
  );
  return {
    ciphertext: base64Url(new Uint8Array(ciphertext)),
    nonce: base64Url(nonce),
  };
}

export async function decryptWebhookSecret(
  kek: string,
  ciphertext: string,
  nonce: string,
) {
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64Url(nonce) },
    await encryptionKey(kek),
    fromBase64Url(ciphertext),
  );
  return new TextDecoder().decode(plaintext);
}

export function configuredWebhookKek() {
  const webhookEnv = env as typeof env & {
    readonly EVIDENCE_WEBHOOK_KEK: string | undefined;
  };
  if (
    !webhookEnv.EVIDENCE_WEBHOOK_KEK ||
    !/^[A-Za-z0-9_-]{32,}$/.test(webhookEnv.EVIDENCE_WEBHOOK_KEK)
  ) {
    throw new ConvexError({
      code: "WEBHOOK_SIGNING_UNAVAILABLE",
      message:
        "Webhook signing is unavailable until EVIDENCE_WEBHOOK_KEK is configured.",
    });
  }
  return webhookEnv.EVIDENCE_WEBHOOK_KEK;
}

export const eventTypeValidator = v.union(
  v.literal("evidence.document.changed"),
  v.literal("evidence.research.completed"),
  v.literal("evidence.export.completed"),
  v.literal("evidence.benchmark.completed"),
  v.literal("evidence.claim.verified"),
  v.literal("evidence.usage.threshold_reached"),
  v.literal("evidence.usage.budget_reached"),
  v.literal("evidence.entitlement.status_changed"),
);

function identifier(value: string, name: string, maximum: number) {
  const normalized = value.trim().toLowerCase();
  if (
    normalized.length === 0 ||
    normalized.length > maximum ||
    !/^[a-z0-9][a-z0-9._:-]*$/.test(normalized)
  ) {
    throw new ConvexError({
      code: "INVALID_WEBHOOK_VALUE",
      message: `${name} must be a bounded identifier.`,
    });
  }
  return normalized;
}

function parseObjectJson(value: string, maximum: number) {
  if (value.length > maximum) {
    throw new ConvexError({
      code: "INVALID_WEBHOOK_PAYLOAD",
      message: `payloadJson must be at most ${maximum} characters.`,
    });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new ConvexError({
      code: "INVALID_WEBHOOK_PAYLOAD",
      message: "payloadJson must be a JSON object.",
    });
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ConvexError({
      code: "INVALID_WEBHOOK_PAYLOAD",
      message: "payloadJson must be a JSON object.",
    });
  }
  assertNoCredentialFields(parsed);
  return JSON.stringify(parsed);
}

function assertNoCredentialFields(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) assertNoCredentialFields(item);
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (
      /(authorization|credential|cookie|password|secret|token|api[_-]?key)/i.test(
        key,
      )
    ) {
      throw new ConvexError({
        code: "WEBHOOK_CREDENTIAL_PAYLOAD_DENIED",
        message: "Webhook payloads cannot contain credential-like fields.",
      });
    }
    assertNoCredentialFields(nested);
  }
}

/** Parse exact hostname allowlist entries. An empty value means webhooks are disabled. */
export function parseAllowedHosts(value: string | undefined) {
  if (!value?.trim()) return new Set<string>();
  const hosts = value
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  for (const host of hosts) {
    if (
      !/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(
        host,
      )
    ) {
      throw new ConvexError({
        code: "INVALID_WEBHOOK_ALLOWLIST",
        message:
          "EVIDENCE_WEBHOOK_ALLOWED_HOSTS must contain exact DNS hostnames only.",
      });
    }
  }
  return new Set(hosts);
}

/** Require a public HTTPS URL on a configured exact hostname; never permit IP/private destinations. */
export function validateWebhookUrl(
  urlValue: string,
  allowedHosts: ReadonlySet<string>,
) {
  if (allowedHosts.size === 0) {
    throw new ConvexError({
      code: "WEBHOOKS_DISABLED",
      message: "Webhook delivery is not enabled for this deployment.",
    });
  }
  let parsed: URL;
  try {
    parsed = new URL(urlValue);
  } catch {
    throw new ConvexError({
      code: "INVALID_WEBHOOK_URL",
      message: "Webhook URL must be a valid HTTPS URL.",
    });
  }
  const hostname = parsed.hostname.toLowerCase();
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.hash ||
    (parsed.port !== "" && parsed.port !== "443") ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) ||
    hostname.includes(":") ||
    !allowedHosts.has(hostname)
  ) {
    throw new ConvexError({
      code: "INVALID_WEBHOOK_URL",
      message:
        "Webhook URL must use HTTPS and an exact configured public hostname.",
    });
  }
  return parsed.toString();
}

function assertEventTypes(eventTypes: string[]) {
  const unique = [...new Set(eventTypes)];
  if (unique.length === 0 || unique.length > MAX_EVENT_TYPES) {
    throw new ConvexError({
      code: "INVALID_WEBHOOK_EVENT_TYPES",
      message: `Select between 1 and ${MAX_EVENT_TYPES} event types.`,
    });
  }
  for (const eventType of unique) {
    if (!(EVENT_TYPES as readonly string[]).includes(eventType)) {
      throw new ConvexError({
        code: "INVALID_WEBHOOK_EVENT_TYPES",
        message: "Unsupported webhook event type.",
      });
    }
  }
  return unique;
}

type DatabaseCtx = QueryCtx | MutationCtx;
type Principal = { ownerUserId: Id<"users">; agentId: string | null };

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
      code: "WEBHOOK_AGENT_DENIED",
      message: "An active owned evidence agent is required.",
    });
  }
  return { ownerUserId: identity.ownerUserId, agentId: identity.agentId };
}

function safeSubscription(subscription: Doc<"apiWebhookSubscriptions">) {
  return {
    subscriptionId: subscription._id,
    subscriptionKey: subscription.subscriptionKey,
    url: subscription.url,
    status: subscription.status,
    eventTypes: subscription.eventTypes,
    createdAt: subscription.createdAt,
    updatedAt: subscription.updatedAt,
  };
}

async function syncSubscriptionTargets(
  ctx: MutationCtx,
  subscription: Doc<"apiWebhookSubscriptions">,
) {
  const desired = new Set(subscription.eventTypes);
  const existing = await ctx.db
    .query("apiWebhookTargets")
    .withIndex("by_subscriptionId", (q) =>
      q.eq("subscriptionId", subscription._id),
    )
    .take(MAX_EVENT_TYPES + 1);
  for (const target of existing) {
    if (!desired.has(target.eventType)) {
      await ctx.db.delete("apiWebhookTargets", target._id);
      continue;
    }
    if (target.status !== subscription.status) {
      await ctx.db.patch("apiWebhookTargets", target._id, {
        status: subscription.status,
        updatedAt: subscription.updatedAt,
      });
    }
    desired.delete(target.eventType);
  }
  for (const eventType of desired) {
    await ctx.db.insert("apiWebhookTargets", {
      subscriptionId: subscription._id,
      ownerUserId: subscription.ownerUserId,
      eventType,
      status: subscription.status,
      updatedAt: subscription.updatedAt,
    });
  }
}

function configuredAllowedHosts() {
  // Environment access is intentionally deferred so a missing value disables rather than fails startup.
  const webhookEnv = env as typeof env & {
    readonly EVIDENCE_WEBHOOK_ALLOWED_HOSTS: string | undefined;
  };
  return parseAllowedHosts(webhookEnv.EVIDENCE_WEBHOOK_ALLOWED_HOSTS);
}

/**
 * Reports whether delivery can be configured without exposing the destination
 * allowlist. This is intentionally owner-scoped: public discovery must not
 * reveal an operator's webhook infrastructure.
 */
export const getMyWebhookAvailability = query({
  args: {},
  returns: v.object({ enabled: v.boolean() }),
  handler: async (ctx) => {
    await evidencePrincipal(ctx);
    return { enabled: configuredAllowedHosts().size > 0 };
  },
});

export const createSubscription = mutation({
  args: {
    subscriptionKey: v.string(),
    url: v.string(),
    eventTypes: v.array(eventTypeValidator),
  },
  returns: safeSubscriptionValidator,
  handler: async (ctx, args) => {
    const principal = await evidencePrincipal(ctx);
    const kek = configuredWebhookKek();
    const subscriptionKey = identifier(
      args.subscriptionKey,
      "subscriptionKey",
      MAX_SUBSCRIPTION_KEY_LENGTH,
    );
    const url = validateWebhookUrl(args.url, configuredAllowedHosts());
    const eventTypes = assertEventTypes(args.eventTypes);
    const existing = await ctx.db
      .query("apiWebhookSubscriptions")
      .withIndex("by_ownerUserId_and_subscriptionKey", (q) =>
        q
          .eq("ownerUserId", principal.ownerUserId)
          .eq("subscriptionKey", subscriptionKey),
      )
      .unique();
    if (existing !== null) {
      const sameEvents =
        [...existing.eventTypes].sort().join("\n") ===
        [...eventTypes].sort().join("\n");
      if (existing.url !== url || !sameEvents) {
        throw new ConvexError({
          code: "WEBHOOK_SUBSCRIPTION_MISMATCH",
          message:
            "subscriptionKey was already used with a different URL or event set.",
        });
      }
      await syncSubscriptionTargets(ctx, existing);
      return safeSubscription(existing);
    }
    const ownerSubscriptions = await ctx.db
      .query("apiWebhookSubscriptions")
      .withIndex("by_ownerUserId_and_subscriptionKey", (q) =>
        q.eq("ownerUserId", principal.ownerUserId),
      )
      .take(MAX_SUBSCRIPTIONS_PER_OWNER + 1);
    if (ownerSubscriptions.length >= MAX_SUBSCRIPTIONS_PER_OWNER) {
      throw new ConvexError({
        code: "WEBHOOK_SUBSCRIPTION_LIMIT",
        message: `Each account can configure at most ${MAX_SUBSCRIPTIONS_PER_OWNER} webhook subscriptions.`,
      });
    }
    const secret = base64Url(crypto.getRandomValues(new Uint8Array(32)));
    const encrypted = await encryptWebhookSecret(kek, secret);
    const now = Date.now();
    const subscriptionId = await ctx.db.insert("apiWebhookSubscriptions", {
      ownerUserId: principal.ownerUserId,
      subscriptionKey,
      url,
      status: "active",
      eventTypes,
      signingSecretCiphertext: encrypted.ciphertext,
      signingSecretNonce: encrypted.nonce,
      signingSecretVersion: 1,
      createdAt: now,
      updatedAt: now,
    });
    const subscription = (await ctx.db.get(
      "apiWebhookSubscriptions",
      subscriptionId,
    ))!;
    await syncSubscriptionTargets(ctx, subscription);
    return { ...safeSubscription(subscription), signingSecret: secret };
  },
});

export const listMySubscriptions = query({
  args: {},
  returns: v.array(safeSubscriptionValidator),
  handler: async (ctx) => {
    const principal = await evidencePrincipal(ctx);
    const subscriptions = await ctx.db
      .query("apiWebhookSubscriptions")
      .withIndex("by_ownerUserId_and_subscriptionKey", (q) =>
        q.eq("ownerUserId", principal.ownerUserId),
      )
      .take(MAX_SUBSCRIPTIONS_PER_OWNER);
    return subscriptions.map(safeSubscription);
  },
});

export const setSubscriptionStatus = mutation({
  args: {
    subscriptionKey: v.string(),
    status: subscriptionStatusValidator,
  },
  returns: safeSubscriptionValidator,
  handler: async (ctx, args) => {
    const principal = await evidencePrincipal(ctx);
    const subscriptionKey = identifier(
      args.subscriptionKey,
      "subscriptionKey",
      MAX_SUBSCRIPTION_KEY_LENGTH,
    );
    const subscription = await ctx.db
      .query("apiWebhookSubscriptions")
      .withIndex("by_ownerUserId_and_subscriptionKey", (q) =>
        q
          .eq("ownerUserId", principal.ownerUserId)
          .eq("subscriptionKey", subscriptionKey),
      )
      .unique();
    if (subscription === null) {
      throw new ConvexError({
        code: "WEBHOOK_SUBSCRIPTION_NOT_FOUND",
        message: "Webhook subscription was not found.",
      });
    }
    if (subscription.status === "revoked" && args.status !== "revoked") {
      throw new ConvexError({
        code: "WEBHOOK_SUBSCRIPTION_REVOKED",
        message: "Revoked subscriptions cannot be reactivated.",
      });
    }
    const now = Date.now();
    await ctx.db.patch("apiWebhookSubscriptions", subscription._id, {
      status: args.status,
      updatedAt: now,
    });
    const updated = {
      ...subscription,
      status: args.status,
      updatedAt: now,
    };
    await syncSubscriptionTargets(ctx, updated);
    return safeSubscription(updated);
  },
});

/** Returns a replacement secret exactly once to the authenticated owner. */
export const rotateSigningSecret = mutation({
  args: { subscriptionKey: v.string() },
  returns: safeSubscriptionValidator,
  handler: async (ctx, args) => {
    const principal = await evidencePrincipal(ctx);
    const subscriptionKey = identifier(
      args.subscriptionKey,
      "subscriptionKey",
      MAX_SUBSCRIPTION_KEY_LENGTH,
    );
    const subscription = await ctx.db
      .query("apiWebhookSubscriptions")
      .withIndex("by_ownerUserId_and_subscriptionKey", (q) =>
        q
          .eq("ownerUserId", principal.ownerUserId)
          .eq("subscriptionKey", subscriptionKey),
      )
      .unique();
    if (subscription === null)
      throw new ConvexError({
        code: "WEBHOOK_SUBSCRIPTION_NOT_FOUND",
        message: "Webhook subscription was not found.",
      });
    const secret = base64Url(crypto.getRandomValues(new Uint8Array(32)));
    const encrypted = await encryptWebhookSecret(
      configuredWebhookKek(),
      secret,
    );
    const now = Date.now();
    await ctx.db.patch("apiWebhookSubscriptions", subscription._id, {
      signingSecretCiphertext: encrypted.ciphertext,
      signingSecretNonce: encrypted.nonce,
      signingSecretVersion: (subscription.signingSecretVersion ?? 0) + 1,
      updatedAt: now,
    });
    return {
      ...safeSubscription({ ...subscription, updatedAt: now }),
      signingSecret: secret,
    };
  },
});

async function ownedSubscription(ctx: DatabaseCtx, subscriptionKey: string) {
  const principal = await evidencePrincipal(ctx);
  const subscription = await ctx.db
    .query("apiWebhookSubscriptions")
    .withIndex("by_ownerUserId_and_subscriptionKey", (q) =>
      q
        .eq("ownerUserId", principal.ownerUserId)
        .eq("subscriptionKey", subscriptionKey),
    )
    .unique();
  if (subscription === null)
    throw new ConvexError({
      code: "WEBHOOK_SUBSCRIPTION_NOT_FOUND",
      message: "Webhook subscription was not found.",
    });
  return subscription;
}

export const listDeliveryHistory = query({
  args: { subscriptionKey: v.string(), limit: v.optional(v.number()) },
  returns: v.array(safeDeliveryValidator),
  handler: async (ctx, args) => {
    const subscription = await ownedSubscription(
      ctx,
      identifier(
        args.subscriptionKey,
        "subscriptionKey",
        MAX_SUBSCRIPTION_KEY_LENGTH,
      ),
    );
    const limit = Math.max(
      1,
      Math.min(Math.floor(args.limit ?? 20), MAX_HISTORY_LIMIT),
    );
    const rows = await ctx.db
      .query("apiWebhookDeliveries")
      .withIndex("by_subscriptionId_and_updatedAt", (q) =>
        q.eq("subscriptionId", subscription._id),
      )
      .order("desc")
      .take(limit);
    return rows.map(
      ({
        eventKey,
        status,
        attempt,
        responseCode,
        nextAttemptAt,
        createdAt,
        updatedAt,
      }) => ({
        eventKey,
        status,
        attempt,
        responseCode,
        nextAttemptAt,
        createdAt,
        updatedAt,
      }),
    );
  },
});

export const getSubscriptionHealth = query({
  args: { subscriptionKey: v.string() },
  returns: v.object({
    delivered: v.number(),
    failed: v.number(),
    deadLetter: v.number(),
    pending: v.number(),
  }),
  handler: async (ctx, args) => {
    const subscription = await ownedSubscription(
      ctx,
      identifier(
        args.subscriptionKey,
        "subscriptionKey",
        MAX_SUBSCRIPTION_KEY_LENGTH,
      ),
    );
    const rows = await ctx.db
      .query("apiWebhookDeliveries")
      .withIndex("by_subscriptionId_and_updatedAt", (q) =>
        q.eq("subscriptionId", subscription._id),
      )
      .order("desc")
      .take(MAX_HISTORY_LIMIT);
    return rows.reduce(
      (health, row) => {
        if (row.status === "delivered") health.delivered += 1;
        else if (row.status === "dead_letter") health.deadLetter += 1;
        else if (row.status === "pending" || row.status === "in_flight")
          health.pending += 1;
        else health.failed += 1;
        return health;
      },
      { delivered: 0, failed: 0, deadLetter: 0, pending: 0 },
    );
  },
});

async function scheduleDeliveryAttempt(
  ctx: MutationCtx,
  delivery: Doc<"apiWebhookDeliveries">,
  delayMs: number,
  now = Date.now(),
) {
  const boundedDelayMs = Math.max(0, Math.floor(delayMs));
  const deliveryGeneration = (delivery.deliveryGeneration ?? 0) + 1;
  const nextAttemptAt = now + boundedDelayMs;
  await ctx.db.patch("apiWebhookDeliveries", delivery._id, {
    status: "pending",
    deliveryGeneration,
    nextAttemptAt,
    leaseExpiresAt: undefined,
    updatedAt: now,
  });
  await ctx.scheduler.runAfter(boundedDelayMs, DELIVERY_ACTION_REF, {
    deliveryId: delivery._id,
    deliveryGeneration,
  });
  return { deliveryGeneration, nextAttemptAt };
}

/**
 * Starts a delivery lease when the worker actually begins, not when its action
 * is merely placed on the scheduler. A delayed scheduler therefore cannot
 * consume retry budget or dead-letter an event that made no HTTP attempt.
 */
export const startDeliveryAttempt = internalMutation({
  args: {
    deliveryId: v.id("apiWebhookDeliveries"),
    deliveryGeneration: v.number(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("apiWebhookDeliveries", args.deliveryId);
    const now = Date.now();
    if (
      row === null ||
      row.status !== "pending" ||
      row.deliveryGeneration !== args.deliveryGeneration ||
      row.nextAttemptAt === undefined ||
      row.nextAttemptAt > now
    ) {
      return false;
    }
    const leaseExpiresAt = now + DELIVERY_LEASE_MS;
    await ctx.db.patch("apiWebhookDeliveries", row._id, {
      status: "in_flight",
      nextAttemptAt: undefined,
      leaseExpiresAt,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(
      DELIVERY_LEASE_MS + 1,
      makeFunctionReference<"mutation">(
        "evidenceWebhooks:recoverDeliveryLease",
      ),
      {
        deliveryId: row._id,
        deliveryGeneration: args.deliveryGeneration,
      },
    );
    return true;
  },
});

export const replayDelivery = mutation({
  args: { subscriptionKey: v.string(), eventKey: v.string() },
  returns: safeDeliveryValidator,
  handler: async (ctx, args) => {
    const subscription = await ownedSubscription(
      ctx,
      identifier(
        args.subscriptionKey,
        "subscriptionKey",
        MAX_SUBSCRIPTION_KEY_LENGTH,
      ),
    );
    const eventKey = identifier(
      args.eventKey,
      "eventKey",
      MAX_EVENT_KEY_LENGTH,
    );
    const delivery = await ctx.db
      .query("apiWebhookDeliveries")
      .withIndex("by_subscriptionId_and_eventKey", (q) =>
        q.eq("subscriptionId", subscription._id).eq("eventKey", eventKey),
      )
      .unique();
    if (delivery === null)
      throw new ConvexError({
        code: "WEBHOOK_DELIVERY_NOT_FOUND",
        message: "Webhook delivery was not found.",
      });
    if (subscription.status !== "active")
      throw new ConvexError({
        code: "WEBHOOK_REPLAY_DENIED",
        message: "Only active subscriptions can replay deliveries.",
      });
    if (delivery.status === "pending" || delivery.status === "in_flight") {
      throw new ConvexError({
        code: "WEBHOOK_REPLAY_IN_PROGRESS",
        message: "An active webhook delivery cannot be replayed.",
      });
    }
    if ((delivery.replayCount ?? 0) >= MAX_REPLAY_ATTEMPTS)
      throw new ConvexError({
        code: "WEBHOOK_REPLAY_LIMIT",
        message: "Webhook replay budget exhausted.",
      });
    const now = Date.now();
    const replayCount = (delivery.replayCount ?? 0) + 1;
    const replay = {
      ...delivery,
      status: "pending" as const,
      attempt: 0,
      replayCount,
      updatedAt: now,
    };
    await ctx.db.patch("apiWebhookDeliveries", delivery._id, {
      status: "pending",
      attempt: 0,
      replayCount,
      responseCode: undefined,
      nextAttemptAt: now,
      leaseExpiresAt: undefined,
      updatedAt: now,
    });
    const scheduled = await scheduleDeliveryAttempt(ctx, replay, 0, now);
    return {
      eventKey: delivery.eventKey,
      status: "pending" as const,
      attempt: 0,
      nextAttemptAt: scheduled.nextAttemptAt,
      createdAt: delivery.createdAt,
      updatedAt: now,
    };
  },
});

/** Queues a bounded synthetic event for the owner-selected subscription only. */
export const sendTestEvent = mutation({
  args: { subscriptionKey: v.string(), eventType: eventTypeValidator },
  returns: safeDeliveryValidator,
  handler: async (ctx, args) => {
    const subscription = await ownedSubscription(
      ctx,
      identifier(
        args.subscriptionKey,
        "subscriptionKey",
        MAX_SUBSCRIPTION_KEY_LENGTH,
      ),
    );
    if (
      subscription.status !== "active" ||
      !subscription.eventTypes.includes(args.eventType)
    ) {
      throw new ConvexError({
        code: "WEBHOOK_TEST_EVENT_DENIED",
        message: "An active subscription to this event type is required.",
      });
    }
    const now = Date.now();
    const eventKey = `test:${subscription._id}:${now}:${base64Url(crypto.getRandomValues(new Uint8Array(8)))}`;
    await ctx.db.insert("apiWebhookEvents", {
      provider: "evidence-delivery",
      eventKey,
      payloadJson: JSON.stringify({
        eventType: args.eventType,
        payloadJson: JSON.stringify({ test: true }),
      }),
      receivedAt: now,
    });
    const deliveryId = await ctx.db.insert("apiWebhookDeliveries", {
      subscriptionId: subscription._id,
      eventKey,
      status: "pending",
      attempt: 0,
      createdAt: now,
      updatedAt: now,
      nextAttemptAt: now,
    });
    const delivery = (await ctx.db.get("apiWebhookDeliveries", deliveryId))!;
    const scheduled = await scheduleDeliveryAttempt(ctx, delivery, 0, now);
    return {
      eventKey,
      status: "pending" as const,
      attempt: 0,
      nextAttemptAt: scheduled.nextAttemptAt,
      createdAt: now,
      updatedAt: now,
    };
  },
});

/** Store a single event and idempotently create deliveries for matching active subscriptions. */
export const enqueueEvent = internalMutation({
  args: {
    eventKey: v.string(),
    eventType: eventTypeValidator,
    payloadJson: v.string(),
    ownerUserId: v.optional(v.id("users")),
  },
  returns: v.object({
    eventId: v.union(v.id("apiWebhookEvents"), v.null()),
    enqueued: v.number(),
  }),
  handler: async (ctx, args) => {
    const eventKey = identifier(
      args.eventKey,
      "eventKey",
      MAX_EVENT_KEY_LENGTH,
    );
    const payloadJson = parseObjectJson(args.payloadJson, MAX_PAYLOAD_LENGTH);
    const accountScoped = ACCOUNT_SCOPED_EVENT_TYPES.has(args.eventType);
    if (accountScoped !== (args.ownerUserId !== undefined)) {
      throw new ConvexError({
        code: "WEBHOOK_OWNER_SCOPE_REQUIRED",
        message: accountScoped
          ? "Account-scoped webhook events require an owner scope."
          : "Global webhook events cannot include an owner scope.",
      });
    }
    const targets = await ctx.db
      .query("apiWebhookTargets")
      .withIndex(
        accountScoped
          ? "by_ownerUserId_and_eventType_and_status_and_updatedAt"
          : "by_eventType_and_status_and_updatedAt",
        (q) =>
          accountScoped
            ? q
                .eq("ownerUserId", args.ownerUserId!)
                .eq("eventType", args.eventType)
                .eq("status", "active")
            : q.eq("eventType", args.eventType).eq("status", "active"),
      )
      .take(MAX_DELIVERIES_PER_EVENT + 1);
    if (targets.length === 0) {
      return { eventId: null, enqueued: 0 };
    }
    if (targets.length > MAX_DELIVERIES_PER_EVENT) {
      throw new ConvexError({
        code: "WEBHOOK_FANOUT_LIMIT",
        message: `Webhook fanout exceeds the ${MAX_DELIVERIES_PER_EVENT}-delivery safety limit.`,
      });
    }
    const subscriptions: Doc<"apiWebhookSubscriptions">[] = [];
    for (const target of targets) {
      const subscription = await ctx.db.get(
        "apiWebhookSubscriptions",
        target.subscriptionId,
      );
      if (
        subscription === null ||
        subscription.status !== "active" ||
        !subscription.eventTypes.includes(args.eventType)
      ) {
        await ctx.db.delete("apiWebhookTargets", target._id);
      } else {
        subscriptions.push(subscription);
      }
    }
    if (subscriptions.length === 0) {
      return { eventId: null, enqueued: 0 };
    }
    const existing = await ctx.db
      .query("apiWebhookEvents")
      .withIndex("by_provider_and_eventKey", (q) =>
        q.eq("provider", "evidence-delivery").eq("eventKey", eventKey),
      )
      .unique();
    const eventId =
      existing?._id ??
      (await ctx.db.insert("apiWebhookEvents", {
        provider: "evidence-delivery",
        eventKey,
        payloadJson: JSON.stringify({ eventType: args.eventType, payloadJson }),
        receivedAt: Date.now(),
      }));
    let enqueued = 0;
    for (const subscription of subscriptions) {
      const delivery = await ctx.db
        .query("apiWebhookDeliveries")
        .withIndex("by_subscriptionId_and_eventKey", (q) =>
          q.eq("subscriptionId", subscription._id).eq("eventKey", eventKey),
        )
        .unique();
      if (delivery !== null) continue;
      const now = Date.now();
      const deliveryId = await ctx.db.insert("apiWebhookDeliveries", {
        subscriptionId: subscription._id,
        eventKey,
        status: "pending",
        attempt: 0,
        createdAt: now,
        updatedAt: now,
        nextAttemptAt: now,
      });
      const inserted = (await ctx.db.get("apiWebhookDeliveries", deliveryId))!;
      await scheduleDeliveryAttempt(ctx, inserted, 0, now);
      enqueued += 1;
    }
    return { eventId, enqueued };
  },
});

/**
 * Queues an event only for one owner's active, explicitly joined targets.
 * Watchlist delivery uses this rather than the global fanout path so a tenant
 * can never receive another tenant's saved alert.
 */
export const enqueueEventForOwner = internalMutation({
  args: {
    ownerUserId: v.id("users"),
    eventKey: v.string(),
    eventType: eventTypeValidator,
    payloadJson: v.string(),
  },
  returns: v.object({
    eventId: v.union(v.id("apiWebhookEvents"), v.null()),
    eligible: v.number(),
    enqueued: v.number(),
  }),
  handler: async (ctx, args) => {
    const eventKey = identifier(
      args.eventKey,
      "eventKey",
      MAX_EVENT_KEY_LENGTH,
    );
    const payloadJson = parseObjectJson(args.payloadJson, MAX_PAYLOAD_LENGTH);
    const subscriptions = await ctx.db
      .query("apiWebhookSubscriptions")
      .withIndex("by_ownerUserId_and_subscriptionKey", (q) =>
        q.eq("ownerUserId", args.ownerUserId),
      )
      .take(MAX_SUBSCRIPTIONS_PER_OWNER + 1);
    if (subscriptions.length > MAX_SUBSCRIPTIONS_PER_OWNER) {
      throw new ConvexError({
        code: "WEBHOOK_FANOUT_LIMIT",
        message: `Webhook fanout exceeds the ${MAX_SUBSCRIPTIONS_PER_OWNER}-delivery owner safety limit.`,
      });
    }
    const eligibleSubscriptions: Doc<"apiWebhookSubscriptions">[] = [];
    for (const subscription of subscriptions) {
      if (
        subscription.status !== "active" ||
        !subscription.eventTypes.includes(args.eventType)
      ) {
        continue;
      }
      const target = await ctx.db
        .query("apiWebhookTargets")
        .withIndex("by_subscriptionId_and_eventType", (q) =>
          q
            .eq("subscriptionId", subscription._id)
            .eq("eventType", args.eventType),
        )
        .unique();
      if (
        target?.ownerUserId !== args.ownerUserId ||
        target.status !== "active"
      ) {
        continue;
      }
      eligibleSubscriptions.push(subscription);
    }
    if (eligibleSubscriptions.length === 0) {
      return { eventId: null, eligible: 0, enqueued: 0 };
    }
    const existing = await ctx.db
      .query("apiWebhookEvents")
      .withIndex("by_provider_and_eventKey", (q) =>
        q.eq("provider", "evidence-delivery").eq("eventKey", eventKey),
      )
      .unique();
    const eventId =
      existing?._id ??
      (await ctx.db.insert("apiWebhookEvents", {
        provider: "evidence-delivery",
        eventKey,
        payloadJson: JSON.stringify({ eventType: args.eventType, payloadJson }),
        receivedAt: Date.now(),
      }));
    let enqueued = 0;
    for (const subscription of eligibleSubscriptions) {
      const delivery = await ctx.db
        .query("apiWebhookDeliveries")
        .withIndex("by_subscriptionId_and_eventKey", (q) =>
          q.eq("subscriptionId", subscription._id).eq("eventKey", eventKey),
        )
        .unique();
      if (delivery !== null) continue;
      const now = Date.now();
      const deliveryId = await ctx.db.insert("apiWebhookDeliveries", {
        subscriptionId: subscription._id,
        eventKey,
        status: "pending",
        attempt: 0,
        createdAt: now,
        updatedAt: now,
        nextAttemptAt: now,
      });
      const inserted = (await ctx.db.get("apiWebhookDeliveries", deliveryId))!;
      await scheduleDeliveryAttempt(ctx, inserted, 0, now);
      enqueued += 1;
    }
    return { eventId, eligible: eligibleSubscriptions.length, enqueued };
  },
});

export const backfillSubscriptionTargets = internalMutation({
  args: { cursor: v.optional(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(Math.floor(args.limit ?? 50), 100));
    const page = await ctx.db.query("apiWebhookSubscriptions").paginate({
      cursor: args.cursor ?? null,
      numItems: limit,
    });
    for (const subscription of page.page) {
      await syncSubscriptionTargets(ctx, subscription);
    }
    return {
      processed: page.page.length,
      cursor: page.continueCursor,
      done: page.isDone,
    };
  },
});

export const cleanupOrphanDeliveryEvents = internalMutation({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const [subscription, delivery] = await Promise.all([
      ctx.db.query("apiWebhookSubscriptions").first(),
      ctx.db.query("apiWebhookDeliveries").first(),
    ]);
    if (subscription !== null || delivery !== null) {
      return { removed: 0, done: true, blocked: true };
    }
    const limit = Math.max(1, Math.min(Math.floor(args.limit ?? 100), 200));
    const events = await ctx.db
      .query("apiWebhookEvents")
      .withIndex("by_provider_and_receivedAt", (q) =>
        q.eq("provider", "evidence-delivery"),
      )
      .order("asc")
      .take(limit);
    for (const event of events) {
      await ctx.db.delete("apiWebhookEvents", event._id);
    }
    return {
      removed: events.length,
      done: events.length < limit,
      blocked: false,
    };
  },
});

async function recoverExpiredStartedAttempt(
  ctx: MutationCtx,
  row: Doc<"apiWebhookDeliveries">,
  now: number,
) {
  const attempt = row.attempt + 1;
  // Only an expired lease proves that a worker started and failed to record an
  // outcome. Scheduler wait time is represented by `pending` and costs no try.
  if (attempt >= MAX_DELIVERY_ATTEMPTS) {
    await ctx.db.patch("apiWebhookDeliveries", row._id, {
      status: "dead_letter",
      attempt,
      nextAttemptAt: undefined,
      leaseExpiresAt: undefined,
      updatedAt: now,
    });
    return "dead_lettered" as const;
  }
  await ctx.db.patch("apiWebhookDeliveries", row._id, { attempt });
  await scheduleDeliveryAttempt(ctx, { ...row, attempt }, 0, now);
  return "rescheduled" as const;
}

/** A stale wake-up must never reclaim a newer attempt or a delivered event. */
export const recoverDeliveryLease = internalMutation({
  args: {
    deliveryId: v.id("apiWebhookDeliveries"),
    deliveryGeneration: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("apiWebhookDeliveries", args.deliveryId);
    const now = Date.now();
    if (
      row === null ||
      row.status !== "in_flight" ||
      row.deliveryGeneration !== args.deliveryGeneration ||
      row.leaseExpiresAt === undefined ||
      row.leaseExpiresAt > now
    )
      return null;
    await recoverExpiredStartedAttempt(ctx, row, now);
    return null;
  },
});

export const recoverPendingDeliveries = internalMutation({
  args: { limit: v.optional(v.number()) },
  returns: v.object({ rescheduled: v.number(), deadLettered: v.number() }),
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(Math.floor(args.limit ?? 50), 50));
    const now = Date.now();
    // Give the scheduler the same grace window as an active HTTP lease before
    // rotating a pending generation. Besides tolerating normal scheduler lag,
    // this makes concurrent watchdog runs idempotent: the first reschedule
    // moves nextAttemptAt to `now`, outside the second run's recovery window.
    const pendingRecoveryCutoff = now - DELIVERY_LEASE_MS;
    const duePending = await ctx.db
      .query("apiWebhookDeliveries")
      .withIndex("by_status_and_nextAttemptAt", (q) =>
        q.eq("status", "pending").lte("nextAttemptAt", pendingRecoveryCutoff),
      )
      .order("asc")
      .take(limit);
    const expiredInFlight =
      duePending.length >= limit
        ? []
        : await ctx.db
            .query("apiWebhookDeliveries")
            .withIndex("by_status_and_leaseExpiresAt", (q) =>
              q.eq("status", "in_flight").lte("leaseExpiresAt", now),
            )
            .order("asc")
            .take(limit - duePending.length);
    let rescheduled = 0;
    let deadLettered = 0;
    for (const row of duePending) {
      if (row.attempt >= MAX_DELIVERY_ATTEMPTS) {
        await ctx.db.patch("apiWebhookDeliveries", row._id, {
          status: "dead_letter",
          nextAttemptAt: undefined,
          leaseExpiresAt: undefined,
          updatedAt: now,
        });
        deadLettered += 1;
        continue;
      }
      // A scheduler-delayed row never started, so rescheduling rotates its
      // generation without consuming an attempt.
      await scheduleDeliveryAttempt(ctx, row, 0, now);
      rescheduled += 1;
    }
    for (const row of expiredInFlight) {
      const result = await recoverExpiredStartedAttempt(ctx, row, now);
      if (result === "dead_lettered") deadLettered += 1;
      else rescheduled += 1;
    }
    return { rescheduled, deadLettered };
  },
});

/** Recheck queued evidence references against current access before any HTTP. */
async function isDeliveryEvidencePublic(ctx: QueryCtx, payloadJson: string) {
  let payload: unknown;
  try {
    payload = JSON.parse(payloadJson);
  } catch {
    return false;
  }
  if (payload === null || typeof payload !== "object" || Array.isArray(payload))
    return false;
  const data = payload as Record<string, unknown>;
  const documentRefs = [data.documentId];
  const claimRefs = [data.claimId];
  if (data.entityType === "document") documentRefs.push(data.entityId ?? null);
  if (data.entityType === "claim") claimRefs.push(data.entityId ?? null);
  for (const value of documentRefs) {
    if (value === undefined) continue;
    const id =
      typeof value === "string"
        ? ctx.db.normalizeId("evidenceDocuments", value)
        : null;
    if (
      id === null ||
      !(await isPublicEvidenceDocument(
        ctx,
        await ctx.db.get("evidenceDocuments", id),
      ))
    )
      return false;
  }
  for (const value of claimRefs) {
    if (value === undefined) continue;
    const id =
      typeof value === "string"
        ? ctx.db.normalizeId("evidenceClaims", value)
        : null;
    if (
      id === null ||
      !(await isPublicEvidenceClaim(
        ctx,
        await ctx.db.get("evidenceClaims", id),
      ))
    )
      return false;
  }
  if (data.documentVersionId !== undefined) {
    const id =
      typeof data.documentVersionId === "string"
        ? ctx.db.normalizeId("evidenceDocumentVersions", data.documentVersionId)
        : null;
    const version =
      id === null ? null : await ctx.db.get("evidenceDocumentVersions", id);
    if (
      version === null ||
      !(await isPublicEvidenceDocument(
        ctx,
        await ctx.db.get("evidenceDocuments", version.documentId),
      ))
    )
      return false;
  }
  // Usage, job completion, entitlement, and test payloads need no public evidence lookup.
  return true;
}

export const getDeliveryInput = internalQuery({
  args: {
    deliveryId: v.id("apiWebhookDeliveries"),
    deliveryGeneration: v.number(),
  },
  returns: v.union(
    v.null(),
    v.object({
      kind: v.literal("invalid"),
      deliveryId: v.id("apiWebhookDeliveries"),
      deliveryGeneration: v.number(),
      errorMessage: v.string(),
    }),
    v.object({
      kind: v.literal("ready"),
      deliveryId: v.id("apiWebhookDeliveries"),
      deliveryGeneration: v.number(),
      subscriptionId: v.id("apiWebhookSubscriptions"),
      attempt: v.number(),
      eventKey: v.string(),
      url: v.string(),
      status: subscriptionStatusValidator,
      eventType: eventTypeValidator,
      payloadJson: v.string(),
      signingSecretCiphertext: v.optional(v.string()),
      signingSecretNonce: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const delivery = await ctx.db.get("apiWebhookDeliveries", args.deliveryId);
    if (
      delivery === null ||
      delivery.status !== "in_flight" ||
      delivery.deliveryGeneration !== args.deliveryGeneration
    ) {
      return null;
    }
    const subscription = await ctx.db.get(
      "apiWebhookSubscriptions",
      delivery.subscriptionId,
    );
    if (subscription === null) {
      return {
        kind: "invalid" as const,
        deliveryId: delivery._id,
        deliveryGeneration: args.deliveryGeneration,
        errorMessage: "Webhook subscription is missing",
      };
    }
    const event = await ctx.db
      .query("apiWebhookEvents")
      .withIndex("by_provider_and_eventKey", (q) =>
        q.eq("provider", "evidence-delivery").eq("eventKey", delivery.eventKey),
      )
      .unique();
    if (event === null) {
      return {
        kind: "invalid" as const,
        deliveryId: delivery._id,
        deliveryGeneration: args.deliveryGeneration,
        errorMessage: "Stored webhook event is missing",
      };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(event.payloadJson);
    } catch {
      return {
        kind: "invalid" as const,
        deliveryId: delivery._id,
        deliveryGeneration: args.deliveryGeneration,
        errorMessage: "Stored webhook event envelope is invalid",
      };
    }
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      !Object.prototype.hasOwnProperty.call(parsed, "eventType") ||
      !Object.prototype.hasOwnProperty.call(parsed, "payloadJson") ||
      !(EVENT_TYPES as readonly string[]).includes(
        (parsed as { eventType?: unknown }).eventType as string,
      ) ||
      typeof (parsed as { payloadJson?: unknown }).payloadJson !== "string"
    ) {
      return {
        kind: "invalid" as const,
        deliveryId: delivery._id,
        deliveryGeneration: args.deliveryGeneration,
        errorMessage: "Stored webhook event envelope is invalid",
      };
    }
    if (
      !(await isDeliveryEvidencePublic(
        ctx,
        (parsed as { payloadJson: string }).payloadJson,
      ))
    ) {
      return {
        kind: "invalid" as const,
        deliveryId: delivery._id,
        deliveryGeneration: args.deliveryGeneration,
        errorMessage: "Webhook evidence is no longer publicly available",
      };
    }
    return {
      kind: "ready" as const,
      deliveryId: delivery._id,
      deliveryGeneration: args.deliveryGeneration,
      subscriptionId: subscription._id,
      attempt: delivery.attempt,
      eventKey: delivery.eventKey,
      url: subscription.url,
      status: subscription.status,
      eventType: (parsed as { eventType: EventType }).eventType,
      payloadJson: (parsed as { payloadJson: string }).payloadJson,
      signingSecretCiphertext: subscription.signingSecretCiphertext,
      signingSecretNonce: subscription.signingSecretNonce,
    };
  },
});

export const markDelivery = internalMutation({
  args: {
    deliveryId: v.id("apiWebhookDeliveries"),
    deliveryGeneration: v.number(),
    outcome: v.union(
      v.literal("delivered"),
      v.literal("transient_failure"),
      v.literal("permanent_failure"),
    ),
    responseCode: v.optional(v.number()),
    errorMessage: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const delivery = await ctx.db.get("apiWebhookDeliveries", args.deliveryId);
    if (
      delivery === null ||
      delivery.status !== "in_flight" ||
      delivery.deliveryGeneration !== args.deliveryGeneration
    ) {
      return null;
    }
    const responseCode = args.responseCode;
    const errorMessage = args.errorMessage?.slice(0, 400);
    const attempt = Math.min(delivery.attempt + 1, 10);
    const retry =
      args.outcome === "transient_failure" && attempt < MAX_DELIVERY_ATTEMPTS;
    const now = Date.now();
    const terminalStatus =
      args.outcome === "delivered" ? "delivered" : "dead_letter";
    await ctx.db.patch("apiWebhookDeliveries", delivery._id, {
      status: retry ? "pending" : terminalStatus,
      attempt,
      responseCode,
      nextAttemptAt: undefined,
      leaseExpiresAt: undefined,
      updatedAt: now,
    });
    if (retry) {
      await scheduleDeliveryAttempt(
        ctx,
        {
          ...delivery,
          status: "pending",
          attempt,
          responseCode,
          nextAttemptAt: undefined,
          leaseExpiresAt: undefined,
          updatedAt: now,
        },
        1_000 * 2 ** (attempt - 1),
        now,
      );
    }
    if (args.outcome !== "delivered" && errorMessage) {
      await ctx.db.insert("systemLogs", {
        createdAt: now,
        updatedAt: now,
        lastSeenAt: now,
        occurrences: 1,
        level: "warn",
        status: "open",
        source: "convex",
        scope: "evidence-webhooks",
        eventType: "delivery_failed",
        message: errorMessage,
        fingerprint:
          `evidence-webhook:${delivery._id}:${args.deliveryGeneration}:${errorMessage}`.slice(
            0,
            500,
          ),
        component: "evidenceWebhooks",
        action: "deliver",
        entityType: "apiWebhookDeliveries",
        entityId: delivery._id,
        ...(responseCode === undefined ? {} : { statusCode: responseCode }),
      });
    }
    return null;
  },
});

export const validateConfiguredDestination = internalQuery({
  args: { url: v.string() },
  returns: v.object({ url: v.string(), enabled: v.boolean() }),
  handler: async (_ctx, args) => {
    const allowedHosts = configuredAllowedHosts();
    return {
      url: validateWebhookUrl(args.url, allowedHosts),
      enabled: allowedHosts.size > 0,
    };
  },
});
