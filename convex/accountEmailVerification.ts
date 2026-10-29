import { installation } from "./installation";
import { HOUR, RateLimiter } from "@convex-dev/rate-limiter";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import {
  env,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { components } from "./_generated/api";
import { requireAuthenticatedUser } from "./authz";
import { IDENTITY_MARKER } from "../lib/identity-config";
import {
  bytesToBase64Url,
} from "./agentIdentityCrypto";
import { resend } from "./resendClient";

const CODE_TTL_MS = 15 * 60 * 1_000;
const MAX_CODE_ATTEMPTS = 5;
const MAX_SEND_DELAY_MS = 5 * 60 * 1_000;
const verificationLimiter = new RateLimiter(components.rateLimiter, {
  sendsPerAccount: {
    kind: "token bucket",
    rate: 3,
    period: HOUR,
    capacity: 2,
  },
  sendsPerEmail: {
    kind: "token bucket",
    rate: 3,
    period: HOUR,
    capacity: 2,
  },
  sendsGlobal: {
    kind: "token bucket",
    rate: 20,
    period: HOUR,
    capacity: 8,
    shards: 4,
  },
  checksPerAccount: {
    kind: "token bucket",
    rate: 10,
    period: HOUR,
    capacity: 5,
  },
});

const requestResult = v.object({
  status: v.union(v.literal("queued"), v.literal("already_verified")),
});

const verificationResult = v.object({
  verified: v.boolean(),
  status: v.union(
    v.literal("verified"),
    v.literal("invalid"),
    v.literal("expired"),
    v.literal("not_ready"),
    v.literal("locked"),
  ),
  attemptsRemaining: v.optional(v.number()),
});

function normalizeEmail(value: string) {
  const email = value.trim().toLowerCase();
  if (
    email.length > 254 ||
    !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) ||
    /[\r\n\u0000-\u001f\u007f]/.test(email)
  ) {
    throw new ConvexError({
      code: "INVALID_EMAIL",
      message: "Enter a valid email address.",
    });
  }
  return email;
}

function isSameHash(left: string, right: string) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

function randomCode() {
  const range = 100_000_000;
  const maxUnbiased = Math.floor(0x1_0000_0000 / range) * range;
  let value: number;
  do {
    value = crypto.getRandomValues(new Uint32Array(1))[0]!;
  } while (value >= maxUnbiased);
  return String(value % range).padStart(8, "0");
}

async function codeDigest(challengeId: string, code: string) {
  const pepper = env.RESEND_API_KEY;
  if (!pepper) {
    throw new ConvexError({
      code: "EMAIL_VERIFICATION_UNAVAILABLE",
      message: "Email verification is temporarily unavailable.",
    });
  }
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pepper),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${challengeId}:${code}`),
  );
  return bytesToBase64Url(new Uint8Array(digest));
}

export const request = mutation({
  args: { email: v.string() },
  returns: requestResult,
  handler: async (ctx, args) => {
    if ((await ctx.auth.getUserIdentity())?.authSystem === IDENTITY_MARKER) throw new ConvexError("Use Account connections to verify your recovery email.");
    const user = await requireAuthenticatedUser(ctx);
    if (user.isAgent === true) {
      throw new ConvexError({
        code: "HUMAN_ACCOUNT_REQUIRED",
        message: "A human account is required to verify an email address.",
      });
    }
    if (user.emailVerificationTime !== undefined) {
      return { status: "already_verified" as const };
    }
    if (!env.RESEND_API_KEY) {
      throw new ConvexError({
        code: "EMAIL_VERIFICATION_UNAVAILABLE",
        message: "Email verification is temporarily unavailable.",
      });
    }

    const email = normalizeEmail(args.email);
    const emailKey = await codeDigest("email-rate-limit", email);
    const [accountCapacity, emailCapacity, globalCapacity] = await Promise.all([
      verificationLimiter.limit(ctx, "sendsPerAccount", { key: user._id }),
      verificationLimiter.limit(ctx, "sendsPerEmail", { key: emailKey }),
      verificationLimiter.limit(ctx, "sendsGlobal", { key: "global" }),
    ]);
    if (!accountCapacity.ok || !emailCapacity.ok || !globalCapacity.ok) {
      throw new ConvexError({
        code: "EMAIL_VERIFICATION_RATE_LIMITED",
        message: "Too many verification requests. Please try again later.",
        retryAfter: Math.max(
          accountCapacity.ok ? 0 : accountCapacity.retryAfter,
          emailCapacity.ok ? 0 : emailCapacity.retryAfter,
          globalCapacity.ok ? 0 : globalCapacity.retryAfter,
        ),
      });
    }

    const previous = await ctx.db
      .query("accountEmailVerificationChallenges")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .unique();
    if (previous !== null) {
      await ctx.db.delete("accountEmailVerificationChallenges", previous._id);
    }
    const now = Date.now();
    const challengeId = await ctx.db.insert(
      "accountEmailVerificationChallenges",
      {
        userId: user._id,
        email,
        status: "queued",
        expiresAt: now + CODE_TTL_MS,
        attempts: 0,
        createdAt: now,
      },
    );
    await ctx.scheduler.runAfter(0, internal.accountEmailVerification.sendCode, {
      challengeId,
    });
    // A second cleanup is scheduled after successful delivery using the actual
    // expiry time. This one covers a delayed or failed send action.
    await ctx.scheduler.runAfter(
      CODE_TTL_MS + MAX_SEND_DELAY_MS,
      internal.accountEmailVerification.cleanChallenge,
      { challengeId },
    );
    return { status: "queued" as const };
  },
});

export const status = query({
  args: {},
  returns: v.union(v.literal("queued"), v.literal("sent"), v.null()),
  handler: async (ctx) => {
    const user = await requireAuthenticatedUser(ctx);
    if (user.isAgent === true) return null;
    const challenge = await ctx.db
      .query("accountEmailVerificationChallenges")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .unique();
    if (challenge === null || challenge.expiresAt <= Date.now()) return null;
    return challenge.status;
  },
});

export const verify = mutation({
  args: { code: v.string() },
  returns: verificationResult,
  handler: async (ctx, args) => {
    if ((await ctx.auth.getUserIdentity())?.authSystem === IDENTITY_MARKER) throw new ConvexError("Use Account connections to verify your recovery email.");
    const user = await requireAuthenticatedUser(ctx);
    if (user.isAgent === true) {
      throw new ConvexError({
        code: "HUMAN_ACCOUNT_REQUIRED",
        message: "A human account is required to verify an email address.",
      });
    }
    const verificationCapacity = await verificationLimiter.limit(
      ctx,
      "checksPerAccount",
      { key: user._id },
    );
    if (!verificationCapacity.ok) {
      throw new ConvexError({
        code: "EMAIL_VERIFICATION_RATE_LIMITED",
        message: "Too many code attempts. Please try again later.",
        retryAfter: verificationCapacity.retryAfter,
      });
    }
    const challenge = await ctx.db
      .query("accountEmailVerificationChallenges")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .unique();
    if (
      challenge === null ||
      challenge.status !== "sent" ||
      challenge.codeHash === undefined
    ) {
      return { verified: false, status: "not_ready" as const };
    }
    const now = Date.now();
    if (challenge.expiresAt <= now) {
      await ctx.db.delete("accountEmailVerificationChallenges", challenge._id);
      return { verified: false, status: "expired" as const };
    }
    if (challenge.attempts >= MAX_CODE_ATTEMPTS) {
      await ctx.db.delete("accountEmailVerificationChallenges", challenge._id);
      return { verified: false, status: "locked" as const };
    }

    const code = args.code.trim();
    const hasValidFormat = args.code.length <= 16 && /^\d{8}$/.test(code);
    const codeHash = hasValidFormat
      ? await codeDigest(challenge._id, code)
      : "";
    if (!hasValidFormat || !isSameHash(challenge.codeHash, codeHash)) {
      const attempts = challenge.attempts + 1;
      if (attempts >= MAX_CODE_ATTEMPTS) {
        await ctx.db.delete(
          "accountEmailVerificationChallenges",
          challenge._id,
        );
        return { verified: false, status: "locked" as const };
      }
      await ctx.db.patch("accountEmailVerificationChallenges", challenge._id, {
        attempts,
      });
      return {
        verified: false,
        status: "invalid" as const,
        attemptsRemaining: MAX_CODE_ATTEMPTS - attempts,
      };
    }

    await ctx.db.patch("users", user._id, {
      contactEmail: challenge.email,
      emailVerificationTime: now,
    });
    await ctx.db.delete("accountEmailVerificationChallenges", challenge._id);
    return { verified: true, status: "verified" as const };
  },
});

export const readChallenge = internalQuery({
  args: { challengeId: v.id("accountEmailVerificationChallenges") },
  handler: async (ctx, args) => {
    const challenge = await ctx.db.get(
      "accountEmailVerificationChallenges",
      args.challengeId,
    );
    if (challenge === null) return null;
    return {
      _id: challenge._id,
      email: challenge.email,
      status: challenge.status,
      createdAt: challenge.createdAt,
    };
  },
});

export const prepareCode = internalMutation({
  args: {
    challengeId: v.id("accountEmailVerificationChallenges"),
    codeHash: v.string(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const challenge = await ctx.db.get(
      "accountEmailVerificationChallenges",
      args.challengeId,
    );
    if (
      challenge === null ||
      challenge.status !== "queued" ||
      Date.now() - challenge.createdAt > MAX_SEND_DELAY_MS
    ) {
      return false;
    }
    await ctx.db.patch("accountEmailVerificationChallenges", challenge._id, {
      codeHash: args.codeHash,
      expiresAt: args.expiresAt,
      attempts: 0,
    });
    return true;
  },
});

export const markSent = internalMutation({
  args: { challengeId: v.id("accountEmailVerificationChallenges") },
  handler: async (ctx, args) => {
    const challenge = await ctx.db.get(
      "accountEmailVerificationChallenges",
      args.challengeId,
    );
    if (
      challenge === null ||
      challenge.status !== "queued" ||
      challenge.codeHash === undefined
    ) {
      return null;
    }
    await ctx.db.patch("accountEmailVerificationChallenges", challenge._id, {
      status: "sent",
    });
    await ctx.scheduler.runAfter(
      Math.max(0, challenge.expiresAt - Date.now()),
      internal.accountEmailVerification.cleanChallenge,
      { challengeId: challenge._id },
    );
    return null;
  },
});

export const removeChallenge = internalMutation({
  args: { challengeId: v.id("accountEmailVerificationChallenges") },
  handler: async (ctx, args) => {
    const challenge = await ctx.db.get(
      "accountEmailVerificationChallenges",
      args.challengeId,
    );
    if (challenge !== null) {
      await ctx.db.delete("accountEmailVerificationChallenges", challenge._id);
    }
    return null;
  },
});

export const cleanChallenge = internalMutation({
  args: { challengeId: v.id("accountEmailVerificationChallenges") },
  handler: async (ctx, args) => {
    const challenge = await ctx.db.get(
      "accountEmailVerificationChallenges",
      args.challengeId,
    );
    if (challenge !== null && challenge.expiresAt <= Date.now()) {
      await ctx.db.delete("accountEmailVerificationChallenges", challenge._id);
    }
    return null;
  },
});

export const sendCode = internalAction({
  args: { challengeId: v.id("accountEmailVerificationChallenges") },
  handler: async (ctx, args) => {
    const challenge = await ctx.runQuery(
      internal.accountEmailVerification.readChallenge,
      { challengeId: args.challengeId },
    );
    if (
      challenge === null ||
      challenge.status !== "queued" ||
      Date.now() - challenge.createdAt > MAX_SEND_DELAY_MS
    ) {
      await ctx.runMutation(internal.accountEmailVerification.removeChallenge, {
        challengeId: args.challengeId,
      });
      return null;
    }
    if (!env.RESEND_API_KEY) {
      await ctx.runMutation(internal.accountEmailVerification.removeChallenge, {
        challengeId: args.challengeId,
      });
      return null;
    }

    const code = randomCode();
    const expiresAt = Date.now() + CODE_TTL_MS;
    const prepared = await ctx.runMutation(
      internal.accountEmailVerification.prepareCode,
      {
        challengeId: args.challengeId,
        codeHash: await codeDigest(args.challengeId, code),
        expiresAt,
      },
    );
    if (!prepared) return null;

    try {
      await resend.sendEmail(ctx, {
        from:
          env.CONTACT_FROM_EMAIL ||
          env.NEWSLETTER_FROM_EMAIL ||
          `${installation.name} <${installation.supportEmail}>`,
        to: challenge.email,
        subject: "Verify your SYMBaiEX account email",
        text: `Your SYMBaiEX email verification code is ${code}. It expires in 15 minutes. If you did not request this, you can ignore this email.`,
        html: `<p>Your SYMBaiEX email verification code is:</p><p style="font-size:28px;font-weight:700;letter-spacing:0.2em">${code}</p><p>It expires in 15 minutes. If you did not request this, you can ignore this email.</p>`,
      });
      await ctx.runMutation(internal.accountEmailVerification.markSent, {
        challengeId: args.challengeId,
      });
    } catch {
      await ctx.runMutation(internal.accountEmailVerification.removeChallenge, {
        challengeId: args.challengeId,
      });
    }
    return null;
  },
});
