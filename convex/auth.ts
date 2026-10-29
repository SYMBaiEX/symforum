import Google from "@auth/core/providers/google";
import { ConvexCredentials } from "@convex-dev/auth/providers/ConvexCredentials";
import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";
import { HOUR, RateLimiter } from "@convex-dev/rate-limiter";
import { ConvexError, type Value } from "convex/values";
import type { DataModel, Id } from "./_generated/dataModel";
import { components, internal } from "./_generated/api";
import { env, type MutationCtx } from "./_generated/server";
import { verifyEd25519Signature } from "./agentIdentityCrypto";

const USERNAME_PATTERN = /^sym-\d{1,8}$|^[a-z0-9][a-z0-9_-]{2,31}$/;
const AUTH_SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1_000;
const accountCreationRateLimiter = new RateLimiter(components.rateLimiter, {
  newAccounts: {
    kind: "token bucket",
    rate: 20,
    period: HOUR,
    capacity: 10,
  },
});
const AUTH_REDIRECT_ORIGINS = new Set([
  "http://localhost:3000",
  "http://symbaiex.localhost:3000",
  "http://forum.localhost:3000",
  "https://symbaiex.com",
  "https://www.symbaiex.com",
  "https://forum.symbaiex.com",
]);

function normalizeUsername(value: unknown) {
  if (typeof value !== "string") {
    throw new ConvexError("Username is required");
  }
  const usernameNormalized = value.trim().toLowerCase();
  if (!USERNAME_PATTERN.test(usernameNormalized)) {
    throw new ConvexError(
      "Use 3-32 letters, numbers, underscores, or dashes. SYM handles are also supported.",
    );
  }
  return usernameNormalized;
}

function usernameCredential(usernameNormalized: string) {
  return `${usernameNormalized}@users.symbaiex.local`;
}

function oauthUsernameBase(
  name: string | undefined,
  email: string | undefined,
) {
  const source = name?.trim() || email?.split("@")[0]?.trim() || "sym-user";
  const normalized = source
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "")
    .slice(0, 24);
  return normalized.length >= 3 ? normalized : "sym-user";
}

async function availableOauthUsername(
  ctx: MutationCtx,
  userId: Id<"users">,
  base: string,
) {
  const current = await ctx.db
    .query("users")
    .withIndex("by_usernameNormalized", (q) => q.eq("usernameNormalized", base))
    .take(2);
  if (
    current.length === 0 ||
    (current.length === 1 && current[0]._id === userId)
  ) {
    return base;
  }

  const suffix = userId.slice(-6).toLowerCase();
  const candidate = `${base.slice(0, 25)}-${suffix}`;
  const collision = await ctx.db
    .query("users")
    .withIndex("by_usernameNormalized", (q) =>
      q.eq("usernameNormalized", candidate),
    )
    .take(2);
  return collision.length === 0 ||
    (collision.length === 1 && collision[0]._id === userId)
    ? candidate
    : `sym-${userId.slice(-8).toLowerCase()}`;
}

async function ensureUserDefaults(
  ctx: MutationCtx,
  userId: Id<"users">,
  type: "oauth" | "credentials" | "email" | "phone" | "verification",
) {
  const user = await ctx.db.get("users", userId);
  if (user === null) {
    throw new Error("Authenticated user could not be loaded");
  }

  const patch: {
    username?: string;
    usernameNormalized?: string;
    usernameSource?: "auto";
    role?: "reader";
    roleAssignedAt?: number;
    contactEmail?: string;
    onboardedAt?: number;
  } = {};
  if (!user.username || !user.usernameNormalized) {
    const username = await availableOauthUsername(
      ctx,
      userId,
      oauthUsernameBase(user.name, user.email),
    );
    patch.username = username;
    patch.usernameNormalized = username;
    patch.usernameSource = "auto";
  }
  if (user.role === undefined) {
    patch.role = "reader";
    patch.roleAssignedAt = Date.now();
  }
  if (
    type === "oauth" &&
    user.contactEmail === undefined &&
    user.email !== undefined &&
    !user.email.endsWith("@users.symbaiex.local")
  ) {
    patch.contactEmail = user.email.trim().toLowerCase();
  }
  if (user.onboardedAt === undefined) {
    patch.onboardedAt = Date.now();
  }

  if (Object.keys(patch).length > 0) {
    await ctx.db.patch("users", userId, patch);
  }
}

async function authRedirect({ redirectTo }: { redirectTo: string }) {
  const siteUrl = env.SITE_URL?.trim() || "http://localhost:3000";
  let destination: URL;
  try {
    destination = new URL(redirectTo, siteUrl);
  } catch {
    return siteUrl;
  }
  return AUTH_REDIRECT_ORIGINS.has(destination.origin)
    ? destination.toString()
    : siteUrl;
}

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  session: {
    totalDurationMs: AUTH_SESSION_DURATION_MS,
    inactiveDurationMs: AUTH_SESSION_DURATION_MS,
  },
  providers: [
    Google,
    ConvexCredentials<DataModel>({
      id: "agent-key",
      authorize: async (credentials, ctx) => {
        const agentId =
          typeof credentials.agentId === "string"
            ? credentials.agentId
            : undefined;
        const challenge =
          typeof credentials.challenge === "string"
            ? credentials.challenge
            : undefined;
        const audience =
          typeof credentials.audience === "string"
            ? credentials.audience
            : undefined;
        const signature =
          typeof credentials.signature === "string"
            ? credentials.signature
            : undefined;
        if (
          agentId === undefined ||
          challenge === undefined ||
          audience === undefined ||
          signature === undefined
        ) {
          return null;
        }

        const loginContext = await ctx.runQuery(
          internal.agentIdentity.getLoginContext,
          { agentId, challenge, audience },
        );
        if (loginContext === null) return null;
        const valid = await verifyEd25519Signature({
          publicKey: loginContext.publicKey,
          signature,
          message: loginContext.message,
        });
        if (!valid) return null;
        try {
          const userId = await ctx.runMutation(
            internal.agentIdentity.consumeLoginChallenge,
            {
              challengeId: loginContext.challengeId,
              challengeHash: loginContext.challengeHash,
              agentId: loginContext.agentId,
              keyVersion: loginContext.keyVersion,
            },
          );
          return { userId };
        } catch {
          // Revocation, key rotation, expiry, and replay all fail closed.
          return null;
        }
      },
    }),
    Password<DataModel>({
      profile(params: Record<string, Value | undefined>) {
        if (env.BETTER_AUTH_ENABLED === "true") throw new ConvexError("Create your account through the new sign-in screen.");
        const usernameNormalized = normalizeUsername(params.username);
        const username = usernameNormalized.toUpperCase().startsWith("SYM-")
          ? usernameNormalized.toUpperCase()
          : usernameNormalized;
        const contactEmail =
          typeof params.contactEmail === "string" &&
          params.contactEmail.includes("@")
            ? params.contactEmail.trim().toLowerCase()
            : undefined;

        return {
          email: usernameCredential(usernameNormalized),
          name: username,
          username,
          usernameNormalized,
          usernameSource: username.startsWith("SYM-") ? "auto" : "chosen",
          role: "reader",
          roleAssignedAt: Date.now(),
          contactEmail,
          onboardedAt: Date.now(),
        };
      },
      validatePasswordRequirements(password: string) {
        if (password.length < 8) {
          throw new ConvexError("Password must be at least 8 characters.");
        }
      },
    }),
  ],
  callbacks: {
    redirect: authRedirect,
    async afterUserCreatedOrUpdated(ctx, args) {
      if (env.BETTER_AUTH_ENABLED === "true") {
        const appCtx = ctx as MutationCtx;
        const user = await appCtx.db.get("users", args.userId);
        const migrated = await appCtx.db.query("betterAuthIdentityLinks").withIndex("by_userId", q => q.eq("userId", args.userId)).unique();
        if (user?.isAgent !== true && (args.existingUserId === null || migrated)) {
          throw new ConvexError("Use the new sign-in screen. Your existing account is preserved.");
        }
      }
      if (args.existingUserId === null) {
        const capacity = await accountCreationRateLimiter.limit(
          ctx,
          "newAccounts",
          { key: "global" },
        );
        if (!capacity.ok) {
          throw new ConvexError({
            code: "SIGNUP_RATE_LIMITED",
            message:
              "Account creation is temporarily busy. Please try again later.",
            retryAfter: capacity.retryAfter,
          });
        }
      }
      await ensureUserDefaults(
        ctx as MutationCtx,
        args.userId as Id<"users">,
        args.type,
      );
    },
  },
});
