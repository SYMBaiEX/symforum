import { ConvexError, v } from "convex/values";
import { HOUR, MINUTE, RateLimiter } from "@convex-dev/rate-limiter";
import { components, internal } from "./_generated/api";
import { env, internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { getFirstPartyAuthUserId } from "./authz";
import { randomBase64Url, sha256Base64Url } from "./agentIdentityCrypto";
import {
  normalizeServiceAuthEmail,
  serviceAuthEnabled,
  SERVICE_AUTH_ISSUER,
} from "../lib/agent-service-auth-config";

const CLAIM_TTL = 24 * HOUR;
const CODE_TTL = 10 * MINUTE;
const APPROVAL_TTL = HOUR;
const TOKEN_TTL = 15 * MINUTE;
const RETENTION = 30 * 24 * HOUR;
const limiter = new RateLimiter(components.rateLimiter, {
  requestSource: {
    kind: "token bucket",
    rate: 120,
    period: MINUTE,
    capacity: 120,
  },
  requestGlobal: {
    kind: "token bucket",
    rate: 3000,
    period: MINUTE,
    capacity: 3000,
  },
  registrationSource: {
    kind: "token bucket",
    rate: 5,
    period: HOUR,
    capacity: 5,
  },
  registrationGlobal: {
    kind: "token bucket",
    rate: 100,
    period: HOUR,
    capacity: 100,
  },
  claimRetry: {
    kind: "token bucket",
    rate: 3,
    period: 10 * MINUTE,
    capacity: 3,
  },
  tokenExchange: {
    kind: "token bucket",
    rate: 20,
    period: MINUTE,
    capacity: 20,
  },
  claimSubmit: { kind: "token bucket", rate: 10, period: MINUTE, capacity: 10 },
});

export const consumeRequest = internalMutation({
  args: { sourceHash: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { sourceHash }) => {
    requireServiceAuth();
    return (
      (await limiter.limit(ctx, "requestSource", { key: sourceHash })).ok &&
      (await limiter.limit(ctx, "requestGlobal")).ok
    );
  },
});

export function requireServiceAuth() {
  if (!serviceAuthEnabled(env))
    throw new ConvexError("Service authentication is disabled.");
}

async function human(ctx: QueryCtx | MutationCtx) {
  const userId = await getFirstPartyAuthUserId(ctx);
  const owner = userId ? await ctx.db.get("users", userId) : null;
  if (!owner || owner.isAgent || owner.isAnonymous)
    throw new ConvexError("A signed-in human owner is required.");
  return owner;
}

function matchesEmail(owner: Doc<"users">, email: string) {
  return normalizeServiceAuthEmail(owner.contactEmail || owner.email) === email;
}

async function audit(
  ctx: MutationCtx,
  event: string,
  registrationId?: Id<"agentServiceRegistrations">,
  ownerUserId?: Id<"users">,
  sourceHash?: string,
) {
  await ctx.db.insert("agentServiceAuthEvents", {
    event,
    registrationId,
    ownerUserId,
    sourceHash,
    createdAt: Date.now(),
  });
}

function result(error: string, status = 400) {
  return JSON.stringify({ error, status });
}

async function materials() {
  const claimToken = `clm_${randomBase64Url(32)}`;
  const attemptToken = randomBase64Url(32);
  // Rejection sampling avoids modulo bias in the six-digit user code.
  let random: number;
  do {
    random = crypto.getRandomValues(new Uint32Array(1))[0];
  } while (random >= 4_294_000_000);
  const code = String(random % 1_000_000).padStart(6, "0");
  return {
    claimToken,
    attemptToken,
    code,
    claimHash: await sha256Base64Url(claimToken),
    attemptHash: await sha256Base64Url(attemptToken),
    // Attempt salt prevents a stolen database enabling a global code lookup.
    codeHash: await sha256Base64Url(`${attemptToken}:${code}`),
  };
}

function ceremony(attemptToken: string, code: string) {
  return {
    user_code: code,
    expires_in: CODE_TTL / 1000,
    interval: 5,
    verification_uri: `https://www.symbaiex.com/agent/claim?claim_attempt_token=${encodeURIComponent(attemptToken)}`,
  };
}

export const register = internalMutation({
  args: { email: v.string(), sourceHash: v.string() },
  returns: v.string(),
  handler: async (ctx, { email, sourceHash }) => {
    requireServiceAuth();
    const normalized = normalizeServiceAuthEmail(email);
    if (!normalized) return result("invalid_request");
    if (
      !(await limiter.limit(ctx, "registrationSource", { key: sourceHash }))
        .ok ||
      !(await limiter.limit(ctx, "registrationGlobal")).ok
    )
      return result("rate_limited", 429);
    const secret = await materials();
    const now = Date.now();
    const id = await ctx.db.insert("agentServiceRegistrations", {
      email: normalized,
      claimHash: secret.claimHash,
      attemptHash: secret.attemptHash,
      codeHash: secret.codeHash,
      status: "pending",
      createdAt: now,
      claimExpiresAt: now + CLAIM_TTL,
      attemptExpiresAt: now + CODE_TTL,
      pollIntervalMs: 5000,
      failedAttempts: 0,
      cleanupAt: now + CLAIM_TTL + RETENTION,
    });
    for (const event of [
      "registration.created",
      "claim.requested",
      "user_code.minted",
    ])
      await audit(ctx, event, id, undefined, sourceHash);
    return JSON.stringify({
      registration_id: id,
      registration_type: "service_auth",
      claim_url: `${SERVICE_AUTH_ISSUER}/identity/claim`,
      claim_token: secret.claimToken,
      claim_token_expires: new Date(now + CLAIM_TTL).toISOString(),
      post_claim_scopes: ["evidence"],
      claim: ceremony(secret.attemptToken, secret.code),
    });
  },
});

export const retryClaim = internalMutation({
  args: { claimToken: v.string(), email: v.string() },
  returns: v.string(),
  handler: async (ctx, args) => {
    requireServiceAuth();
    const hash = await sha256Base64Url(args.claimToken);
    const registration = await ctx.db
      .query("agentServiceRegistrations")
      .withIndex("by_claimHash", (q) => q.eq("claimHash", hash))
      .unique();
    if (!registration) return result("invalid_claim_token");
    if (
      registration.claimExpiresAt <= Date.now() ||
      registration.status === "expired"
    )
      return result("claim_expired", 410);
    if (registration.status !== "pending")
      return result("claimed_or_in_flight", 409);
    if (normalizeServiceAuthEmail(args.email) !== registration.email)
      return result("invalid_request");
    if (!(await limiter.limit(ctx, "claimRetry", { key: registration._id })).ok)
      return result("rate_limited", 429);
    const secret = await materials();
    const expiresAt = Math.min(
      Date.now() + CODE_TTL,
      registration.claimExpiresAt,
    );
    await ctx.db.patch("agentServiceRegistrations", registration._id, {
      attemptHash: secret.attemptHash,
      codeHash: secret.codeHash,
      attemptExpiresAt: expiresAt,
      failedAttempts: 0,
      lastPollAt: undefined,
      pollIntervalMs: 5000,
    });
    await audit(ctx, "claim.requested", registration._id);
    await audit(ctx, "user_code.minted", registration._id);
    return JSON.stringify({
      registration_id: registration._id,
      claim_attempt_id: secret.attemptHash,
      status: "initiated",
      expires_at: new Date(expiresAt).toISOString(),
      claim_attempt: {
        ...ceremony(secret.attemptToken, secret.code),
        expires_in: Math.floor((expiresAt - Date.now()) / 1000),
      },
    });
  },
});

export const viewClaim = query({
  args: { attemptToken: v.string() },
  returns: v.union(
    v.null(),
    v.object({ status: v.string(), email: v.string(), expiresAt: v.number() }),
  ),
  handler: async (ctx, { attemptToken }) => {
    requireServiceAuth();
    const owner = await human(ctx);
    if (attemptToken.length > 100) return null;
    const hash = await sha256Base64Url(attemptToken);
    const row = await ctx.db
      .query("agentServiceRegistrations")
      .withIndex("by_attemptHash", (q) => q.eq("attemptHash", hash))
      .unique();
    if (!row || !matchesEmail(owner, row.email)) return null;
    return {
      status: row.status,
      email: row.email,
      expiresAt: row.attemptExpiresAt,
    };
  },
});

const completionResult = v.object({
  ok: v.boolean(),
  error: v.optional(v.string()),
});
export const completeClaim = mutation({
  args: { attemptToken: v.string(), userCode: v.string(), agentId: v.string() },
  returns: completionResult,
  handler: async (ctx, { attemptToken, userCode, agentId }) => {
    requireServiceAuth();
    const owner = await human(ctx);
    if (!(await limiter.limit(ctx, "claimSubmit", { key: owner._id })).ok)
      return { ok: false, error: "Too many attempts. Wait a minute." };
    if (
      attemptToken.length > 100 ||
      !/^\d{6}$/.test(userCode) ||
      agentId.length > 64
    )
      return { ok: false, error: "Check the code and selected agent." };
    const hash = await sha256Base64Url(attemptToken);
    const row = await ctx.db
      .query("agentServiceRegistrations")
      .withIndex("by_attemptHash", (q) => q.eq("attemptHash", hash))
      .unique();
    if (
      !row ||
      row.status !== "pending" ||
      row.attemptExpiresAt <= Date.now() ||
      row.claimExpiresAt <= Date.now() ||
      row.failedAttempts >= 5 ||
      !matchesEmail(owner, row.email)
    )
      return {
        ok: false,
        error:
          "This claim is unavailable, expired, or belongs to another account.",
      };
    if (
      row.codeHash !== (await sha256Base64Url(`${attemptToken}:${userCode}`))
    ) {
      await ctx.db.patch("agentServiceRegistrations", row._id, {
        failedAttempts: row.failedAttempts + 1,
      });
      await audit(ctx, "claim.code_rejected", row._id, owner._id);
      return {
        ok: false,
        error:
          "The code is incorrect. Five failed attempts lock this claim attempt.",
      };
    }
    const agent = await ctx.db
      .query("agentIdentities")
      .withIndex("by_agentId", (q) => q.eq("agentId", agentId))
      .unique();
    if (
      !agent ||
      agent.ownerUserId !== owner._id ||
      agent.status !== "active" ||
      !agent.scopes.includes("evidence")
    )
      return { ok: false, error: "Choose an active evidence agent you own." };
    const agentUser = await ctx.db.get("users", agent.userId);
    if (
      !agentUser?.isAgent ||
      agentUser.agentStatus !== "active" ||
      agentUser.agentKeyVersion !== agent.keyVersion ||
      !agentUser.agentScopes?.includes("evidence")
    )
      return { ok: false, error: "This agent is unavailable." };
    const active = await ctx.db
      .query("agentServiceRegistrations")
      .withIndex("by_ownerUserId_and_status", (q) =>
        q.eq("ownerUserId", owner._id).eq("status", "active"),
      )
      .take(50);
    if (active.length >= 50)
      return {
        ok: false,
        error: "Disconnect an existing registration before approving another.",
      };
    await ctx.db.patch("agentServiceRegistrations", row._id, {
      status: "active",
      ownerUserId: owner._id,
      agentIdentityId: agent._id,
      keyVersion: agent.keyVersion,
      approvalExpiresAt: Date.now() + APPROVAL_TTL,
      cleanupAt: Date.now() + APPROVAL_TTL + RETENTION,
    });
    await audit(ctx, "claim.confirmed", row._id, owner._id);
    return { ok: true };
  },
});

/** Shared by issuance and request authorization, never trusts token owner claims. */
export async function serviceRegistrationAgent(
  ctx: QueryCtx | MutationCtx,
  row: Doc<"agentServiceRegistrations">,
) {
  if (
    row.status !== "active" ||
    !row.agentIdentityId ||
    !row.ownerUserId ||
    !row.approvalExpiresAt
  )
    return null;
  const agent = await ctx.db.get("agentIdentities", row.agentIdentityId);
  if (
    !agent ||
    agent.ownerUserId !== row.ownerUserId ||
    agent.status !== "active" ||
    agent.keyVersion !== row.keyVersion ||
    !agent.scopes.includes("evidence")
  )
    return null;
  const owner = await ctx.db.get("users", row.ownerUserId);
  const user = await ctx.db.get("users", agent.userId);
  if (
    !owner ||
    owner.isAgent ||
    owner.isAnonymous ||
    !user?.isAgent ||
    user.agentStatus !== "active" ||
    user.agentKeyVersion !== row.keyVersion ||
    !user.agentScopes?.includes("evidence")
  )
    return null;
  return {
    ...user,
    role: "reader" as const,
    agentScopes: ["evidence" as const],
  };
}

/** Atomic authorization + credential record creation. Signing occurs afterward. */
export const issue = internalMutation({
  args: {
    claimToken: v.optional(v.string()),
    registrationId: v.optional(v.id("agentServiceRegistrations")),
    assertionExpiresAt: v.optional(v.number()),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    requireServiceAuth();
    let row: Doc<"agentServiceRegistrations"> | null;
    if (args.claimToken !== undefined) {
      const hash = await sha256Base64Url(args.claimToken);
      row = await ctx.db
        .query("agentServiceRegistrations")
        .withIndex("by_claimHash", (q) => q.eq("claimHash", hash))
        .unique();
      if (!row || row.claimExpiresAt <= Date.now() || row.status === "expired")
        return result("expired_token");
      if (row.status === "revoked") return result("access_denied");
      if (
        row.lastPollAt !== undefined &&
        Date.now() - row.lastPollAt < row.pollIntervalMs
      ) {
        await ctx.db.patch("agentServiceRegistrations", row._id, {
          lastPollAt: Date.now(),
          pollIntervalMs: Math.min(60_000, row.pollIntervalMs + 5000),
        });
        return result("slow_down");
      }
      await ctx.db.patch("agentServiceRegistrations", row._id, {
        lastPollAt: Date.now(),
      });
      if (row.status === "pending")
        return result(
          row.attemptExpiresAt <= Date.now() || row.failedAttempts >= 5
            ? "expired_token"
            : "authorization_pending",
        );
    } else {
      row = args.registrationId
        ? await ctx.db.get("agentServiceRegistrations", args.registrationId)
        : null;
      if (!args.assertionExpiresAt || args.assertionExpiresAt <= Date.now())
        return result("invalid_grant");
    }
    if (
      !row ||
      !row.approvalExpiresAt ||
      row.approvalExpiresAt <= Date.now() ||
      !(await serviceRegistrationAgent(ctx, row))
    )
      return result("invalid_grant");
    if (!(await limiter.limit(ctx, "tokenExchange", { key: row._id })).ok)
      return result("rate_limited", 429);
    const now = Math.floor(Date.now() / 1000) * 1000;
    const expiresAt = Math.min(now + TOKEN_TTL, row.approvalExpiresAt);
    const jti = randomBase64Url(32);
    await ctx.db.insert("agentServiceTokens", {
      registrationId: row._id,
      jti,
      createdAt: now,
      expiresAt,
    });
    await audit(ctx, "token.issued", row._id, row.ownerUserId);
    if (args.claimToken !== undefined)
      await audit(ctx, "assertion.issued", row._id, row.ownerUserId);
    return JSON.stringify({
      registrationId: row._id,
      jti,
      issuedAt: now,
      expiresAt,
      assertionExpiresAt: row.approvalExpiresAt,
    });
  },
});

export const revokeToken = internalMutation({
  args: { jti: v.string(), registrationId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireServiceAuth();
    const token = await ctx.db
      .query("agentServiceTokens")
      .withIndex("by_jti", (q) => q.eq("jti", args.jti))
      .unique();
    if (
      token &&
      token.registrationId === args.registrationId &&
      token.revokedAt === undefined
    ) {
      await ctx.db.patch("agentServiceTokens", token._id, {
        revokedAt: Date.now(),
      });
      await audit(ctx, "token.revoked", token.registrationId);
    }
    return null;
  },
});

export const listMyRegistrations = query({
  args: {},
  returns: v.array(
    v.object({
      id: v.id("agentServiceRegistrations"),
      agentId: v.string(),
      expiresAt: v.number(),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const owner = await human(ctx);
    const rows = await ctx.db
      .query("agentServiceRegistrations")
      .withIndex("by_ownerUserId_and_status", (q) =>
        q.eq("ownerUserId", owner._id).eq("status", "active"),
      )
      .take(50);
    return await Promise.all(
      rows.map(async (row) => ({
        id: row._id,
        agentId: row.agentIdentityId
          ? ((await ctx.db.get("agentIdentities", row.agentIdentityId))
              ?.agentId ?? "Removed agent")
          : "Unavailable",
        expiresAt: row.approvalExpiresAt ?? 0,
        createdAt: row.createdAt,
      })),
    );
  },
});

export const revokeRegistration = mutation({
  args: { registrationId: v.id("agentServiceRegistrations") },
  returns: v.null(),
  handler: async (ctx, { registrationId }) => {
    const owner = await human(ctx);
    const row = await ctx.db.get("agentServiceRegistrations", registrationId);
    if (!row || row.ownerUserId !== owner._id)
      throw new ConvexError("Registration not found.");
    if (row.status !== "revoked") {
      await ctx.db.patch("agentServiceRegistrations", row._id, {
        status: "revoked",
        revokedAt: Date.now(),
      });
      await audit(ctx, "registration.revoked", row._id, owner._id);
    }
    return null;
  },
});

export const revokeAllMyRegistrations = mutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const owner = await human(ctx);
    const rows = await ctx.db
      .query("agentServiceRegistrations")
      .withIndex("by_ownerUserId_and_status", (q) =>
        q.eq("ownerUserId", owner._id).eq("status", "active"),
      )
      .take(50);
    for (const row of rows) {
      await ctx.db.patch("agentServiceRegistrations", row._id, {
        status: "revoked",
        revokedAt: Date.now(),
      });
      await audit(ctx, "registration.revoked", row._id, owner._id);
    }
    return rows.length;
  },
});

/** Bounded hourly retention sweep also runs when issuance is disabled. */
export const cleanup = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const now = Date.now();
    const pending = await ctx.db
      .query("agentServiceRegistrations")
      .withIndex("by_status_and_claimExpiresAt", (q) =>
        q.eq("status", "pending").lte("claimExpiresAt", now),
      )
      .take(100);
    for (const row of pending) {
      await ctx.db.patch("agentServiceRegistrations", row._id, {
        status: "expired",
      });
      await audit(ctx, "registration.expired", row._id);
    }
    const active = await ctx.db
      .query("agentServiceRegistrations")
      .withIndex("by_status_and_approvalExpiresAt", (q) =>
        q.eq("status", "active").lte("approvalExpiresAt", now),
      )
      .take(100);
    for (const row of active) {
      await ctx.db.patch("agentServiceRegistrations", row._id, {
        status: "expired",
      });
      await audit(ctx, "registration.expired", row._id, row.ownerUserId);
    }
    const tokens = await ctx.db
      .query("agentServiceTokens")
      .withIndex("by_expiresAt", (q) => q.lte("expiresAt", now))
      .take(500);
    for (const token of tokens)
      await ctx.db.delete("agentServiceTokens", token._id);
    const registrations = await ctx.db
      .query("agentServiceRegistrations")
      .withIndex("by_cleanupAt", (q) => q.lte("cleanupAt", now))
      .take(100);
    for (const row of registrations)
      await ctx.db.delete("agentServiceRegistrations", row._id);
    const events = await ctx.db
      .query("agentServiceAuthEvents")
      .withIndex("by_createdAt", (q) => q.lt("createdAt", now - RETENTION))
      .take(500);
    for (const event of events)
      await ctx.db.delete("agentServiceAuthEvents", event._id);
    if (
      pending.length === 100 ||
      active.length === 100 ||
      tokens.length === 500 ||
      registrations.length === 100 ||
      events.length === 500
    )
      await ctx.scheduler.runAfter(100, internal.agentServiceAuth.cleanup, {});
    return null;
  },
});
