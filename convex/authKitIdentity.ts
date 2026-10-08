import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  env,
  internalQuery,
  mutation,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { isWorkOSAuthKitIdentity } from "./authz";

const HANDLE_PATTERN = /^sym-\d{1,8}$|^[a-z0-9][a-z0-9_-]{2,31}$/;
const SYNTHETIC_EMAIL_SUFFIX = "@users.symbaiex.local";
const LINK_CHALLENGE_TTL_MS = 15 * 60 * 1_000;

type ReadCtx = QueryCtx | MutationCtx;

export const getVerifiedEmailForHandle = internalQuery({
  args: { handle: v.string() },
  handler: async (ctx, args) => {
    const normalized = normalizeHandle(args.handle);
    const user = await ctx.db
      .query("users")
      .withIndex("by_usernameNormalized", (q) =>
        q.eq("usernameNormalized", normalized),
      )
      .unique();
    if (
      !user ||
      user.emailVerificationTime === undefined ||
      !user.email ||
      user.email.toLowerCase().endsWith(SYNTHETIC_EMAIL_SUFFIX)
    ) {
      return null;
    }
    return { email: user.email.toLowerCase() };
  },
});

export const ensureAuthKitIdentity = mutation({
  args: { requestedHandle: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity || !isWorkOSAuthKitIdentity(identity)) {
      return { status: "not_authenticated" as const };
    }
    const existingLink = await ctx.db
      .query("authIdentityLinks")
      .withIndex("by_tokenIdentifier", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();
    if (existingLink) {
      return { status: "linked" as const, userId: existingLink.userId };
    }

    const email = verifiedIdentityEmail(identity);
    if (email === null) {
      return { status: "verified_email_required" as const };
    }
    const existingUser = await userForEmail(ctx, email);
    if (existingUser) {
      return { status: "link_required" as const };
    }

    let username: string;
    let usernameSource: "auto" | "chosen" = "auto";
    if (args.requestedHandle !== undefined) {
      username = normalizeHandle(args.requestedHandle);
      if (await handleExists(ctx, username)) {
        return { status: "handle_unavailable" as const };
      }
      usernameSource = "chosen";
    } else {
      username = await newSymHandle(ctx);
    }

    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      name: identity.name ?? email.split("@")[0],
      email,
      emailVerificationTime: now,
      contactEmail: email,
      username,
      usernameNormalized: username,
      usernameSource,
      role: "reader",
      roleAssignedAt: now,
      onboardedAt: now,
    });
    await insertAuthKitLink(ctx, {
      identity,
      userId,
      email,
      linkedAt: now,
    });
    return { status: "created" as const, userId };
  },
});

export const beginAuthKitLink = mutation({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity || identity.issuer !== env.CONVEX_SITE_URL) {
      throw new ConvexError({
        code: "LEGACY_AUTH_REQUIRED",
        message: "Sign in to the existing SYMBaiEX account first.",
      });
    }
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new ConvexError({
        code: "AUTH_REQUIRED",
        message: "Sign in to the existing SYMBaiEX account first.",
      });
    }
    const user = await ctx.db.get("users", userId);
    if (!user) throw new Error("Existing account was not found.");

    const email = normalizeEmail(args.email);
    const existingEmailOwner = await userForEmail(ctx, email);
    if (existingEmailOwner && existingEmailOwner._id !== userId) {
      throw new ConvexError({
        code: "EMAIL_IN_USE",
        message:
          "That email belongs to another SYMBaiEX account. Sign in to that account to connect it.",
      });
    }
    if (
      user.emailVerificationTime !== undefined &&
      user.email &&
      !user.email.toLowerCase().endsWith(SYNTHETIC_EMAIL_SUFFIX) &&
      user.email.toLowerCase() !== email
    ) {
      throw new ConvexError({
        code: "EMAIL_MISMATCH",
        message:
          "Use the verified email already on this account, or update it from the signed-in account first.",
      });
    }

    const challenge = crypto.randomUUID();
    const now = Date.now();
    await ctx.db.insert("authIdentityLinkChallenges", {
      challengeHash: await hashChallenge(challenge),
      userId,
      expectedEmail: email,
      createdAt: now,
      expiresAt: now + LINK_CHALLENGE_TTL_MS,
    });
    return { challenge, expiresAt: now + LINK_CHALLENGE_TTL_MS };
  },
});

export const completeAuthKitLink = mutation({
  args: { challenge: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity || !isWorkOSAuthKitIdentity(identity)) {
      throw new ConvexError({
        code: "WORKOS_AUTH_REQUIRED",
        message: "Sign in with WorkOS to finish account migration.",
      });
    }
    const email = verifiedIdentityEmail(identity);
    if (email === null) {
      throw new ConvexError({
        code: "VERIFIED_EMAIL_REQUIRED",
        message: "Verify this email with WorkOS before linking accounts.",
      });
    }
    const challengeHash = await hashChallenge(args.challenge);
    const challenge = await ctx.db
      .query("authIdentityLinkChallenges")
      .withIndex("by_challengeHash", (q) => q.eq("challengeHash", challengeHash))
      .unique();
    if (
      !challenge ||
      challenge.consumedAt !== undefined ||
      challenge.expiresAt <= Date.now()
    ) {
      throw new ConvexError({
        code: "LINK_CHALLENGE_INVALID",
        message: "The account-link request expired. Start again from your existing account.",
      });
    }
    if (email !== challenge.expectedEmail) {
      throw new ConvexError({
        code: "LINK_EMAIL_MISMATCH",
        message: "Sign in with the verified email entered for this account link.",
      });
    }

    const tokenLink = await ctx.db
      .query("authIdentityLinks")
      .withIndex("by_tokenIdentifier", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();
    if (tokenLink && tokenLink.userId !== challenge.userId) {
      throw new ConvexError({
        code: "IDENTITY_ALREADY_LINKED",
        message: "This WorkOS identity is already connected to another account.",
      });
    }
    const workosUserLink = await ctx.db
      .query("authIdentityLinks")
      .withIndex("by_workosUserId", (q) => q.eq("workosUserId", identity.subject))
      .unique();
    if (workosUserLink && workosUserLink.userId !== challenge.userId) {
      throw new ConvexError({
        code: "IDENTITY_ALREADY_LINKED",
        message: "This WorkOS identity is already connected to another account.",
      });
    }

    const existingEmailOwner = await userForEmail(ctx, email);
    if (existingEmailOwner && existingEmailOwner._id !== challenge.userId) {
      throw new ConvexError({
        code: "EMAIL_IN_USE",
        message: "This verified email belongs to another SYMBaiEX account.",
      });
    }
    const user = await ctx.db.get("users", challenge.userId);
    if (!user) throw new Error("Existing account was not found.");
    const now = Date.now();
    await ctx.db.patch("users", challenge.userId, {
      ...(user.email?.toLowerCase().endsWith(SYNTHETIC_EMAIL_SUFFIX) ||
      !user.email
        ? { email }
        : {}),
      emailVerificationTime: user.emailVerificationTime ?? now,
      contactEmail: user.contactEmail ?? email,
    });
    if (!tokenLink) {
      await insertAuthKitLink(ctx, {
        identity,
        userId: challenge.userId,
        email,
        linkedAt: now,
      });
    }
    await ctx.db.patch("authIdentityLinkChallenges", challenge._id, {
      consumedAt: now,
    });
    return { status: "linked" as const, userId: challenge.userId };
  },
});

function verifiedIdentityEmail(identity: {
  email?: string;
  emailVerified?: unknown;
  email_verified?: unknown;
}) {
  const isVerified =
    identity.emailVerified === true || identity.email_verified === true;
  if (!isVerified || typeof identity.email !== "string") return null;
  try {
    return normalizeEmail(identity.email);
  } catch {
    return null;
  }
}

function normalizeEmail(value: string) {
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new ConvexError("Enter a valid email address.");
  }
  return email;
}

function normalizeHandle(value: string) {
  const handle = value.trim().toLowerCase();
  if (!HANDLE_PATTERN.test(handle)) {
    throw new ConvexError(
      "Use 3-32 letters, numbers, underscores, or dashes for the handle.",
    );
  }
  return handle;
}

async function handleExists(ctx: ReadCtx, handle: string) {
  const user = await ctx.db
    .query("users")
    .withIndex("by_usernameNormalized", (q) => q.eq("usernameNormalized", handle))
    .unique();
  return user !== null;
}

async function newSymHandle(ctx: MutationCtx) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const candidate = `sym-${Math.floor(Math.random() * 100_000_000)
      .toString()
      .padStart(8, "0")}`;
    if (!(await handleExists(ctx, candidate))) return candidate;
  }
  throw new ConvexError("A handle could not be generated. Please try again.");
}

async function userForEmail(
  ctx: ReadCtx,
  email: string,
): Promise<Doc<"users"> | null> {
  return await ctx.db
    .query("users")
    .withIndex("email", (q) => q.eq("email", email))
    .unique();
}

async function insertAuthKitLink(
  ctx: MutationCtx,
  args: {
    identity: { tokenIdentifier: string; subject: string };
    userId: Id<"users">;
    email: string;
    linkedAt: number;
  },
) {
  await ctx.db.insert("authIdentityLinks", {
    tokenIdentifier: args.identity.tokenIdentifier,
    provider: "workos-authkit",
    workosUserId: args.identity.subject,
    userId: args.userId,
    email: args.email,
    linkedAt: args.linkedAt,
  });
}

async function hashChallenge(value: string) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
