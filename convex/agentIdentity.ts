import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { requireOwner } from "./authz";
import {
  buildAgentLoginMessage,
  randomBase64Url,
  sha256Base64Url,
  validateEd25519PublicKey,
} from "./agentIdentityCrypto";
import { agentScopeValidator, type AgentScope } from "./authz";
import type { MutationCtx, QueryCtx } from "./_generated/server";

const CHALLENGE_TTL_MS = 5 * 60 * 1_000;
const CHALLENGE_COOLDOWN_MS = 2 * 1_000;
const CHALLENGE_WINDOW_MS = 15 * 60 * 1_000;
const MAX_CHALLENGES_PER_WINDOW = 5;
const MAX_AGENT_ID_LENGTH = 64;
const MAX_AUDIENCE_LENGTH = 128;

const agentIdentifierArgs = {
  agentId: v.optional(v.string()),
  agentSlug: v.optional(v.string()),
};

function resolveAgentId(args: { agentId?: string; agentSlug?: string }) {
  const raw = args.agentId ?? args.agentSlug;
  if (raw === undefined) {
    throw new ConvexError({
      code: "AGENT_ID_REQUIRED",
      message: "agentId is required.",
    });
  }
  const agentId = raw.trim().toLowerCase();
  if (
    agentId.length < 2 ||
    agentId.length > MAX_AGENT_ID_LENGTH ||
    !/^[a-z0-9][a-z0-9._-]*$/.test(agentId)
  ) {
    throw new ConvexError({
      code: "INVALID_AGENT_ID",
      message: "agentId must be 2-64 lowercase letters, numbers, dots, dashes, or underscores.",
    });
  }
  if (args.agentId !== undefined && args.agentSlug !== undefined) {
    const alias = args.agentSlug.trim().toLowerCase();
    if (alias !== agentId) {
      throw new ConvexError({
        code: "AGENT_ID_MISMATCH",
        message: "agentId and agentSlug must identify the same agent.",
      });
    }
  }
  return agentId;
}

function normalizeAudience(audience: string) {
  const value = audience.trim();
  if (
    value.length === 0 ||
    value.length > MAX_AUDIENCE_LENGTH ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new ConvexError({
      code: "INVALID_AUDIENCE",
      message: "audience must be between 1 and 128 characters.",
    });
  }
  return value;
}

function normalizeScopes(scopes: AgentScope[]) {
  const unique = [...new Set(scopes)];
  if (unique.length !== scopes.length) {
    throw new ConvexError({
      code: "DUPLICATE_AGENT_SCOPE",
      message: "Agent scopes must be unique.",
    });
  }
  return unique;
}

async function findIdentityByAgentId(ctx: QueryCtx | MutationCtx, agentId: string) {
  return await ctx.db
    .query("agentIdentities")
    .withIndex("by_agentId", (q) => q.eq("agentId", agentId))
    .unique();
}

export const enrollAgent = mutation({
  args: {
    ...agentIdentifierArgs,
    publicKey: v.string(),
    scopes: v.array(agentScopeValidator),
  },
  handler: async (ctx, args) => {
    const owner = await requireOwner(ctx);
    const agentId = resolveAgentId(args);
    const scopes = normalizeScopes(args.scopes);
    if (!validateEd25519PublicKey(args.publicKey)) {
      throw new ConvexError({
        code: "INVALID_AGENT_PUBLIC_KEY",
        message: "publicKey must be an Ed25519 public key encoded as base64url.",
      });
    }
    if (await findIdentityByAgentId(ctx, agentId)) {
      throw new ConvexError({
        code: "AGENT_ALREADY_ENROLLED",
        message: `Agent ${agentId} is already enrolled. Rotate its key instead.`,
      });
    }
    const existingUser = await ctx.db
      .query("users")
      .withIndex("by_agentSlug", (q) => q.eq("agentSlug", agentId))
      .unique();
    const existingUsername = await ctx.db
      .query("users")
      .withIndex("by_usernameNormalized", (q) =>
        q.eq("usernameNormalized", agentId),
      )
      .unique();
    if (existingUser !== null || existingUsername !== null) {
      throw new ConvexError({
        code: "AGENT_ID_IN_USE",
        message: `Agent ${agentId} is already associated with a user.`,
      });
    }

    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      name: agentId,
      username: agentId,
      usernameNormalized: agentId,
      usernameSource: "auto",
      email: `${agentId}@agents.users.symbaiex.local`,
      role: "reader",
      roleAssignedAt: now,
      roleAssignedBy: owner._id,
      onboardedAt: now,
      isAgent: true,
      agentSlug: agentId,
      agentStatus: "active",
      agentScopes: scopes,
      agentKeyVersion: 1,
      agentEnrolledAt: now,
    });
    const identityId = await ctx.db.insert("agentIdentities", {
      agentId,
      userId,
      publicKey: args.publicKey,
      scopes,
      status: "active",
      keyVersion: 1,
      createdAt: now,
      updatedAt: now,
    });
    return {
      agentId,
      userId,
      identityId,
      keyVersion: 1,
      scopes,
    };
  },
});

export const requestLoginChallenge = mutation({
  args: {
    ...agentIdentifierArgs,
    audience: v.string(),
  },
  handler: async (ctx, args) => {
    const agentId = resolveAgentId(args);
    const audience = normalizeAudience(args.audience);
    const identity = await findIdentityByAgentId(ctx, agentId);
    if (identity === null || identity.status !== "active") {
      throw new ConvexError({
        code: "AGENT_NOT_ACTIVE",
        message: "The requested agent is not active.",
      });
    }

    const now = Date.now();
    const recent = await ctx.db
      .query("agentLoginChallenges")
      .withIndex("by_agentId_and_createdAt", (q) =>
        q.eq("agentId", agentId).gte("createdAt", now - CHALLENGE_WINDOW_MS),
      )
      .order("desc")
      .take(MAX_CHALLENGES_PER_WINDOW + 1);
    const last = recent[0];
    if (last !== undefined && now - last.createdAt < CHALLENGE_COOLDOWN_MS) {
      throw new ConvexError({
        code: "CHALLENGE_COOLDOWN",
        message: "Wait briefly before requesting another login challenge.",
      });
    }
    if (recent.length >= MAX_CHALLENGES_PER_WINDOW) {
      throw new ConvexError({
        code: "CHALLENGE_RATE_LIMITED",
        message: "Too many outstanding login challenges. Try again later.",
      });
    }

    const challenge = randomBase64Url(32);
    const expiresAt = now + CHALLENGE_TTL_MS;
    const challengeHash = await sha256Base64Url(challenge);
    await ctx.db.insert("agentLoginChallenges", {
      agentId,
      challengeHash,
      audience,
      expiresAt,
      createdAt: now,
    });
    return {
      agentId,
      audience,
      challenge,
      expiresAt,
      message: buildAgentLoginMessage({
        agentId,
        audience,
        challenge,
        expiresAt,
      }),
      keyVersion: identity.keyVersion,
    };
  },
});

export const getAgentEnrollmentStatus = query({
  args: agentIdentifierArgs,
  handler: async (ctx, args) => {
    await requireOwner(ctx);
    const agentId = resolveAgentId(args);
    const identity = await findIdentityByAgentId(ctx, agentId);
    if (identity === null) return null;
    return {
      agentId: identity.agentId,
      userId: identity.userId,
      identityId: identity._id,
      publicKey: identity.publicKey,
      scopes: identity.scopes,
      status: identity.status,
      keyVersion: identity.keyVersion,
      createdAt: identity.createdAt,
      updatedAt: identity.updatedAt,
      revokedAt: identity.revokedAt,
    };
  },
});

export const revokeAgent = mutation({
  args: agentIdentifierArgs,
  handler: async (ctx, args) => {
    const owner = await requireOwner(ctx);
    const agentId = resolveAgentId(args);
    const identity = await findIdentityByAgentId(ctx, agentId);
    if (identity === null) {
      throw new ConvexError({ code: "AGENT_NOT_FOUND", message: "Agent not found." });
    }
    const now = Date.now();
    const revokedAt = identity.revokedAt ?? now;
    if (identity.status === "active") {
      await ctx.db.patch("agentIdentities", identity._id, {
        status: "revoked",
        revokedAt,
        updatedAt: now,
      });
      await ctx.db.patch("users", identity.userId, {
        agentStatus: "revoked",
        agentRevokedAt: revokedAt,
      });
    }
    return { agentId, userId: identity.userId, revokedBy: owner._id, revokedAt };
  },
});

export const rotateAgentKey = mutation({
  args: {
    ...agentIdentifierArgs,
    publicKey: v.optional(v.string()),
    newPublicKey: v.optional(v.string()),
    scopes: v.optional(v.array(agentScopeValidator)),
  },
  handler: async (ctx, args) => {
    await requireOwner(ctx);
    const agentId = resolveAgentId(args);
    const publicKey = args.newPublicKey ?? args.publicKey;
    if (publicKey === undefined || !validateEd25519PublicKey(publicKey)) {
      throw new ConvexError({
        code: "INVALID_AGENT_PUBLIC_KEY",
        message: "newPublicKey must be an Ed25519 public key encoded as base64url.",
      });
    }
    const identity = await findIdentityByAgentId(ctx, agentId);
    if (identity === null) {
      throw new ConvexError({ code: "AGENT_NOT_FOUND", message: "Agent not found." });
    }
    if (identity.status !== "active") {
      throw new ConvexError({
        code: "AGENT_NOT_ACTIVE",
        message: "Re-enroll a revoked agent through an owner-controlled recovery process.",
      });
    }
    const scopes = args.scopes === undefined
      ? identity.scopes
      : normalizeScopes(args.scopes);
    const now = Date.now();
    const keyVersion = identity.keyVersion + 1;
    await ctx.db.patch("agentIdentities", identity._id, {
      publicKey,
      scopes,
      keyVersion,
      updatedAt: now,
    });
    await ctx.db.patch("users", identity.userId, {
      agentScopes: scopes,
      agentKeyVersion: keyVersion,
    });
    return { agentId, userId: identity.userId, keyVersion, scopes };
  },
});

export const getLoginContext = internalQuery({
  args: {
    agentId: v.string(),
    challenge: v.string(),
    audience: v.string(),
  },
  handler: async (ctx, args) => {
    const challengeHash = await sha256Base64Url(args.challenge);
    const challenge = await ctx.db
      .query("agentLoginChallenges")
      .withIndex("by_challengeHash", (q) => q.eq("challengeHash", challengeHash))
      .unique();
    if (
      challenge === null ||
      challenge.agentId !== args.agentId ||
      challenge.audience !== args.audience ||
      challenge.consumedAt !== undefined ||
      challenge.expiresAt <= Date.now()
    ) {
      return null;
    }
    const identity = await findIdentityByAgentId(ctx, args.agentId);
    if (identity === null || identity.status !== "active") return null;
    return {
      challengeId: challenge._id,
      challengeHash,
      agentId: identity.agentId,
      audience: challenge.audience,
      expiresAt: challenge.expiresAt,
      publicKey: identity.publicKey,
      keyVersion: identity.keyVersion,
      userId: identity.userId,
      message: buildAgentLoginMessage({
        agentId: identity.agentId,
        audience: challenge.audience,
        challenge: args.challenge,
        expiresAt: challenge.expiresAt,
      }),
    };
  },
});

export const consumeLoginChallenge = internalMutation({
  args: {
    challengeId: v.id("agentLoginChallenges"),
    challengeHash: v.string(),
    agentId: v.string(),
    keyVersion: v.number(),
  },
  handler: async (ctx, args) => {
    const challenge = await ctx.db.get("agentLoginChallenges", args.challengeId);
    if (
      challenge === null ||
      challenge.challengeHash !== args.challengeHash ||
      challenge.agentId !== args.agentId ||
      challenge.consumedAt !== undefined ||
      challenge.expiresAt <= Date.now()
    ) {
      throw new ConvexError({
        code: "LOGIN_CHALLENGE_INVALID",
        message: "The login challenge is invalid, expired, or already consumed.",
      });
    }
    const identity = await findIdentityByAgentId(ctx, args.agentId);
    if (
      identity === null ||
      identity.status !== "active" ||
      identity.keyVersion !== args.keyVersion
    ) {
      throw new ConvexError({
        code: "AGENT_NOT_ACTIVE",
        message: "The agent key is no longer active.",
      });
    }
    await ctx.db.patch("agentLoginChallenges", challenge._id, {
      consumedAt: Date.now(),
    });
    return identity.userId;
  },
});
