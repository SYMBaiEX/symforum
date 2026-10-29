import { v, ConvexError } from "convex/values";
import { RateLimiter } from "@convex-dev/rate-limiter";
import { components } from "./_generated/api";
import {
  mutation,
  internalMutation,
  internalQuery,
  query,
  type MutationCtx,
} from "./_generated/server";
import { betterAuthUser } from "./betterAuthPrincipal";
import { IDENTITY_ORIGINS, isRecoveryEmail } from "../lib/identity-config";
import { randomBase64Url, sha256Base64Url } from "./agentIdentityCrypto";
import { walletLoginInput, verifyWalletLogin } from "../lib/human-auth-proof";
import {
  identityHandleBase,
  identityHandleCandidate,
} from "../lib/identity-handles";

async function availableInitialHandle(
  ctx: MutationCtx,
  provider: "solana" | "telegram",
  accountId: string,
  telegramUsername?: string,
  authUserId?: string,
) {
  const mapping = authUserId
    ? await ctx.db
        .query("betterAuthIdentityLinks")
        .withIndex("by_authUserId", (q) => q.eq("authUserId", authUserId))
        .unique()
    : null;
  const fingerprint = (await sha256Base64Url(`${provider}:${accountId}`))
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  const base = identityHandleBase(
    provider,
    accountId,
    fingerprint,
    telegramUsername,
  );
  for (let attempt = 0; attempt < 5; attempt++) {
    const username = identityHandleCandidate(base, fingerprint, attempt);
    const occupied = await ctx.db
      .query("users")
      .withIndex("by_usernameNormalized", (q) =>
        q.eq("usernameNormalized", username),
      )
      .unique();
    if (occupied && occupied._id !== mapping?.userId) continue;
    const native = await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: "user",
      where: [{ field: "username", value: username }],
      paginationOpts: { numItems: 2, cursor: null },
    });
    if (
      native.isDone &&
      native.page.every((user: { _id: string }) => user._id === authUserId)
    )
      return username;
  }
  throw new ConvexError("Choose an available username in account settings.");
}

const limiter = new RateLimiter(components.rateLimiter, {
  nonce: { kind: "token bucket", rate: 10, period: 60_000, capacity: 10 },
  global: { kind: "token bucket", rate: 300, period: 3_600_000, capacity: 30 },
  email: { kind: "token bucket", rate: 3, period: 600_000, capacity: 3 },
  mailDaily: { kind: "fixed window", rate: 100, period: 86_400_000 },
  // Same named bucket/key and limits as legacy auth: no second signup quota.
  newAccounts: {
    kind: "token bucket",
    rate: 20,
    period: 3_600_000,
    capacity: 10,
  },
});
const provider = v.union(v.literal("solana"), v.literal("telegram"));

/** Never mutate an existing user's roles, content, or human/agent classification. */
export const ensureIdentity = mutation({
  args: {},
  returns: v.object({ userId: v.id("users"), created: v.boolean() }),
  handler: async (ctx) => {
    const authUser = await betterAuthUser(ctx);
    if (!authUser) throw new ConvexError("Sign in to continue.");
    const existing = await ctx.db
      .query("betterAuthIdentityLinks")
      .withIndex("by_authUserId", (q) => q.eq("authUserId", authUser._id))
      .unique();
    if (existing) {
      const profile = await ctx.db.get("users", existing.userId);
      if (!profile || profile.isAgent)
        throw new ConvexError("Account verification is required.");
      if (authUser.username && authUser.username !== existing.authUsername) {
        const handle = authUser.username.toLowerCase();
        const occupied = await ctx.db
          .query("users")
          .withIndex("by_usernameNormalized", (q) =>
            q.eq("usernameNormalized", handle),
          )
          .unique();
        if (occupied && occupied._id !== profile._id)
          throw new ConvexError("This username belongs to another profile.");
        await ctx.db.patch("users", profile._id, {
          username: handle,
          usernameNormalized: handle,
          usernameSource: "chosen",
        });
        await ctx.db.patch("betterAuthIdentityLinks", existing._id, {
          authUsername: authUser.username,
        });
      }
      if (
        authUser.emailVerified &&
        isRecoveryEmail(authUser.email) &&
        (authUser.email !== profile.email ||
          profile.emailVerificationTime === undefined)
      ) {
        const matches = await ctx.db
          .query("users")
          .withIndex("email", (q) =>
            q.eq("email", authUser.email.toLowerCase()),
          )
          .take(2);
        if (matches.some((candidate) => candidate._id !== profile._id))
          throw new ConvexError(
            "This email belongs to an existing profile. No profiles were merged.",
          );
        await ctx.db.patch("users", profile._id, {
          email: authUser.email.toLowerCase(),
          contactEmail: authUser.email.toLowerCase(),
          emailVerificationTime: Date.now(),
        });
      }
      return { userId: existing.userId, created: false };
    }
    const email =
      authUser.emailVerified && isRecoveryEmail(authUser.email)
        ? authUser.email.toLowerCase()
        : null;
    const candidates = email
      ? await ctx.db
          .query("users")
          .withIndex("email", (q) => q.eq("email", email))
          .take(3)
      : [];
    // Only proof of a unique, previously verified recovery email can migrate an
    // account automatically. Unverified/contact-only emails cannot claim it.
    if (
      candidates.some((u) => u.isAgent) ||
      candidates.length > 1 ||
      candidates.some((u) => u.emailVerificationTime === undefined)
    ) {
      throw new ConvexError(
        "Sign in to your existing account to link it. No accounts were merged.",
      );
    }
    let userId = candidates[0]?._id;
    const created = !userId;
    if (
      userId &&
      (await ctx.db
        .query("betterAuthIdentityLinks")
        .withIndex("by_userId", (q) => q.eq("userId", userId!))
        .unique())
    ) {
      throw new ConvexError(
        "This account is already connected. Sign in with its existing method.",
      );
    }
    if (!userId) {
      if (!(await limiter.limit(ctx, "newAccounts", { key: "global" })).ok)
        throw new ConvexError(
          "Account creation limit reached. Please try later.",
        );
      const requested = authUser.username?.trim().toLowerCase();
      const handle =
        requested ||
        "sym-" +
          randomBase64Url(12)
            .toLowerCase()
            .replace(/[^a-z0-9]/g, "");
      const occupied = await ctx.db
        .query("users")
        .withIndex("by_usernameNormalized", (q) =>
          q.eq("usernameNormalized", handle),
        )
        .unique();
      if (occupied)
        throw new ConvexError(
          "This handle belongs to an existing account. Use account recovery.",
        );
      userId = await ctx.db.insert("users", {
        name: authUser.name,
        username: handle,
        usernameNormalized: handle,
        usernameSource: requested ? "chosen" : "auto",
        ...(email
          ? { email, emailVerificationTime: Date.now(), contactEmail: email }
          : {}),
        role: "reader",
        roleAssignedAt: Date.now(),
        onboardedAt: Date.now(),
      });
    }
    await ctx.db.insert("betterAuthIdentityLinks", {
      authUserId: authUser._id,
      userId,
      linkedAt: Date.now(),
      ...(authUser.username ? { authUsername: authUser.username } : {}),
    });
    return { userId, created };
  },
});

export const nonce = internalMutation({
  args: {
    provider,
    purpose: v.union(v.literal("login"), v.literal("link")),
    browserHash: v.string(),
    origin: v.string(),
    authUserId: v.optional(v.string()),
  },
  returns: v.object({
    nonce: v.string(),
    createdAt: v.number(),
    expiresAt: v.number(),
  }),
  handler: async (ctx, args) => {
    if (
      !IDENTITY_ORIGINS.includes(
        args.origin as (typeof IDENTITY_ORIGINS)[number],
      ) ||
      (args.purpose === "link" && !args.authUserId)
    )
      throw new ConvexError("Invalid identity request.");
    const source = await limiter.limit(ctx, "nonce", { key: args.browserHash });
    const global = await limiter.limit(ctx, "global", { key: "all" });
    if (!source.ok || !global.ok)
      throw new ConvexError("Too many sign-in requests. Try again later.");
    const now = Date.now();
    const expired = await ctx.db
      .query("identityChallenges")
      .withIndex("by_expiresAt", (q) => q.lt("expiresAt", now - 86_400_000))
      .take(20);
    for (const challenge of expired)
      await ctx.db.delete("identityChallenges", challenge._id);
    const value = randomBase64Url(24).replace(/[-_]/g, "A");
    await ctx.db.insert("identityChallenges", {
      ...args,
      nonce: value,
      createdAt: now,
      expiresAt: now + 300_000,
    });
    return { nonce: value, createdAt: now, expiresAt: now + 300_000 };
  },
});

export const consumeChallenge = internalMutation({
  args: {
    nonce: v.string(),
    browserHash: v.string(),
    provider,
    authUserId: v.optional(v.string()),
    address: v.optional(v.string()),
    publicKey: v.optional(v.string()),
    signature: v.optional(v.string()),
    signedMessage: v.optional(v.string()),
    telegramSubject: v.optional(v.string()),
    telegramUsername: v.optional(v.string()),
  },
  returns: v.object({
    purpose: v.union(v.literal("login"), v.literal("link")),
    authUserId: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("identityChallenges")
      .withIndex("by_nonce", (q) => q.eq("nonce", args.nonce))
      .unique();
    if (
      !row ||
      row.expiresAt <= Date.now() ||
      row.consumedAt !== undefined ||
      row.browserHash !== args.browserHash ||
      row.provider !== args.provider
    )
      throw new ConvexError("Invalid or expired sign-in proof.");
    if (
      row.purpose === "link" &&
      (!args.authUserId || row.authUserId !== args.authUserId)
    )
      throw new ConvexError("Account changed. Start the connection again.");
    let accountId: string;
    if (row.provider === "solana") {
      const proof = {
        address: args.address ?? "",
        publicKey: args.publicKey ?? "",
        signature: args.signature ?? "",
        signedMessage: args.signedMessage ?? "",
      };
      if (!verifyWalletLogin(walletLoginInput(row), proof))
        throw new ConvexError("Invalid wallet signature.");
      accountId = proof.address;
    } else {
      // Only the server plugin may supply a Telegram subject, after full JWT
      // signature, issuer, audience, expiry and challenge-nonce validation.
      if (!args.telegramSubject || !/^\d{1,30}$/.test(args.telegramSubject))
        throw new ConvexError("Invalid Telegram identity.");
      accountId = args.telegramSubject;
    }
    const existing = await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: "account",
      where: [
        { field: "accountId", value: accountId },
        { field: "providerId", value: row.provider },
      ],
    });
    if (
      existing &&
      row.purpose === "link" &&
      existing.userId !== args.authUserId
    )
      throw new ConvexError(
        "This identity belongs to another account. No accounts were merged.",
      );
    let authUserId: string = existing?.userId ?? args.authUserId ?? "";
    if (!existing) {
      if (row.purpose === "link") {
        const count = await ctx.runQuery(
          components.betterAuth.adapter.findMany,
          {
            model: "account",
            where: [{ field: "userId", value: authUserId }],
            paginationOpts: { numItems: 20, cursor: null },
          },
        );
        if (count.page.length >= 20 || !count.isDone)
          throw new ConvexError("Account connection limit reached.");
      }
      if (row.purpose === "login") {
        const username = await availableInitialHandle(
          ctx,
          row.provider,
          accountId,
          args.telegramUsername,
        );
        // Internal non-deliverable identifier required by Better Auth's user
        // schema; never exposed as a verified/recovery email or sent mail.
        const authUser = await ctx.runMutation(
          components.betterAuth.adapter.create,
          {
            input: {
              model: "user",
              data: {
                name:
                  row.provider === "solana"
                    ? "Wallet " + accountId.slice(0, 5)
                    : "Telegram member",
                email: accountId + "@" + row.provider + ".symbaiex.invalid",
                emailVerified: false,
                username,
                displayUsername: username,
                createdAt: Date.now(),
                updatedAt: Date.now(),
              },
            },
          },
        );
        authUserId = authUser._id;
      }
      // Component writes and the nonce consume share this root transaction.
      // Concurrent sign-ins cannot assign one external identity to two users.
      await ctx.runMutation(components.betterAuth.adapter.create, {
        input: {
          model: "account",
          data: {
            accountId,
            providerId: row.provider,
            userId: authUserId,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        },
      });
    }
    if (row.purpose === "login") {
      const user = await ctx.runQuery(components.betterAuth.adapter.findOne, {
        model: "user",
        where: [{ field: "_id", value: authUserId }],
      });
      if (!user || user.twoFactorEnabled === true)
        throw new ConvexError(
          "Use your primary sign-in method to complete verification.",
        );
      if (!user.username) {
        const mapping = await ctx.db
          .query("betterAuthIdentityLinks")
          .withIndex("by_authUserId", (q) => q.eq("authUserId", authUserId))
          .unique();
        const profile = mapping
          ? await ctx.db.get("users", mapping.userId)
          : null;
        // Only fill a missing native handle for a new/unmapped or explicitly
        // auto-named profile. Existing chosen/legacy handles are never renamed.
        if (!mapping || profile?.usernameSource === "auto") {
          const username = await availableInitialHandle(
            ctx,
            row.provider,
            accountId,
            args.telegramUsername,
            authUserId,
          );
          await ctx.runMutation(components.betterAuth.adapter.updateOne, {
            input: {
              model: "user",
              where: [{ field: "_id", value: authUserId }],
              update: {
                username,
                displayUsername: username,
                updatedAt: Date.now(),
              },
            },
          });
        }
      }
    }
    await ctx.db.patch("identityChallenges", row._id, {
      consumedAt: Date.now(),
    });
    return { purpose: row.purpose, authUserId };
  },
});

export const wallets = query({
  args: {},
  returns: v.array(v.object({ address: v.string(), createdAt: v.number() })),
  handler: async (ctx) => {
    const user = await betterAuthUser(ctx);
    if (!user) throw new ConvexError("Sign in to continue.");
    const records = await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: "account",
      where: [
        { field: "userId", value: user._id },
        { field: "providerId", value: "solana" },
      ],
      paginationOpts: { numItems: 20, cursor: null },
    });
    return records.page.map(
      (row: { accountId: string; createdAt: number }) => ({
        address: row.accountId,
        createdAt: row.createdAt,
      }),
    );
  },
});

export const reserveEmail = internalMutation({
  args: { email: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { email }) => {
    if (!isRecoveryEmail(email)) return false;
    const individual = await limiter.limit(ctx, "email", {
      key: email.toLowerCase(),
    });
    if (!individual.ok) return false;
    return (await limiter.limit(ctx, "mailDaily", { key: "all" })).ok;
  },
});

export const handleAvailable = internalQuery({
  args: { username: v.string(), authUserId: v.optional(v.string()) },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const occupied = await ctx.db
      .query("users")
      .withIndex("by_usernameNormalized", (q) =>
        q.eq("usernameNormalized", args.username.trim().toLowerCase()),
      )
      .unique();
    if (!occupied) return true;
    if (!args.authUserId) return false;
    const mapping = await ctx.db
      .query("betterAuthIdentityLinks")
      .withIndex("by_authUserId", (q) => q.eq("authUserId", args.authUserId!))
      .unique();
    return mapping?.userId === occupied._id;
  },
});

export const addPassword = internalMutation({
  args: { authUserId: v.string(), passwordHash: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: "user",
      where: [{ field: "_id", value: args.authUserId }],
    });
    if (!user?.emailVerified || !isRecoveryEmail(user.email))
      throw new ConvexError("Verify a recovery email first.");
    const credential = await ctx.runQuery(
      components.betterAuth.adapter.findOne,
      {
        model: "account",
        where: [
          { field: "userId", value: args.authUserId },
          { field: "providerId", value: "credential" },
        ],
      },
    );
    if (credential)
      throw new ConvexError("Use change password for an existing password.");
    await ctx.runMutation(components.betterAuth.adapter.create, {
      input: {
        model: "account",
        data: {
          providerId: "credential",
          accountId: args.authUserId,
          userId: args.authUserId,
          password: args.passwordHash,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      },
    });
    return null;
  },
});

export const unlinkAccount = internalMutation({
  args: {
    authUserId: v.string(),
    providerId: v.string(),
    accountId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const accounts = await ctx.runQuery(
      components.betterAuth.adapter.findMany,
      {
        model: "account",
        where: [{ field: "userId", value: args.authUserId }],
        paginationOpts: { numItems: 21, cursor: null },
      },
    );
    if (accounts.page.length < 2)
      throw new ConvexError("Keep at least one sign-in method.");
    const account = accounts.page.find(
      (row: { providerId: string; accountId: string }) =>
        row.providerId === args.providerId && row.accountId === args.accountId,
    );
    if (!account) throw new ConvexError("Account connection not found.");
    await ctx.runMutation(components.betterAuth.adapter.deleteOne, {
      input: {
        model: "account",
        where: [
          { field: "_id", value: account._id },
          { field: "userId", value: args.authUserId },
        ],
      },
    });
    return null;
  },
});

/** Called only after the old password was verified by legacy Convex Auth. */
export const migratePassword = internalMutation({
  args: {
    legacyUserId: v.id("users"),
    passwordHash: v.string(),
    authUserId: v.optional(v.string()),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const user = await ctx.db.get("users", args.legacyUserId);
    if (!user || user.isAgent || !user.usernameNormalized)
      throw new ConvexError("Use account recovery.");
    const mapped = await ctx.db
      .query("betterAuthIdentityLinks")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .unique();
    if (mapped)
      throw new ConvexError(
        "This account already migrated. Use its current sign-in methods.",
      );
    const occupied = await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: "user",
      where: [{ field: "username", value: user.usernameNormalized }],
    });
    if (occupied && occupied._id !== args.authUserId)
      throw new ConvexError(
        "Account recovery is required. No accounts were merged.",
      );
    const now = Date.now();
    let current = args.authUserId
      ? await ctx.runQuery(components.betterAuth.adapter.findOne, {
          model: "user",
          where: [{ field: "_id", value: args.authUserId }],
        })
      : null;
    if (args.authUserId) {
      const linked = await ctx.db
        .query("betterAuthIdentityLinks")
        .withIndex("by_authUserId", (q) => q.eq("authUserId", args.authUserId!))
        .unique();
      if (!current || linked || current.twoFactorEnabled === true)
        throw new ConvexError(
          "Sign out before migrating a separate existing profile. No profiles were merged.",
        );
    }
    const created =
      current ??
      (await ctx.runMutation(components.betterAuth.adapter.create, {
        input: {
          model: "user",
          data: {
            name: user.name ?? user.usernameNormalized,
            username: user.usernameNormalized,
            // An internal password identifier, not a deliverable recovery identity.
            email: user._id + "@legacy.symbaiex.invalid",
            emailVerified: true,
            createdAt: now,
            updatedAt: now,
          },
        },
      }));
    if (current && !current.username) {
      await ctx.runMutation(components.betterAuth.adapter.updateOne, {
        input: {
          model: "user",
          where: [{ field: "_id", value: current._id }],
          update: { username: user.usernameNormalized, updatedAt: now },
        },
      });
      current = { ...current, username: user.usernameNormalized };
    }
    const credential = await ctx.runQuery(
      components.betterAuth.adapter.findOne,
      {
        model: "account",
        where: [
          { field: "userId", value: created._id },
          { field: "providerId", value: "credential" },
        ],
      },
    );
    if (!credential)
      await ctx.runMutation(components.betterAuth.adapter.create, {
        input: {
          model: "account",
          data: {
            providerId: "credential",
            accountId: created._id,
            userId: created._id,
            password: args.passwordHash,
            createdAt: now,
            updatedAt: now,
          },
        },
      });
    await ctx.db.insert("betterAuthIdentityLinks", {
      authUserId: created._id,
      userId: user._id,
      linkedAt: now,
      authUsername: current?.username ?? user.usernameNormalized,
    });
    const oldAccounts = await ctx.db
      .query("authAccounts")
      .withIndex("userIdAndProvider", (q) =>
        q.eq("userId", user._id).eq("provider", "password"),
      )
      .take(10);
    for (const account of oldAccounts)
      await ctx.db.patch("authAccounts", account._id, { secret: undefined });
    return created._id;
  },
});
