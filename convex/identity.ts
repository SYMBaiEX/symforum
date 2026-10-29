
import { PRIMARY_SITE_URL } from "../lib/site-urls";
import { installation } from "./installation";
import { betterAuth } from "better-auth/minimal";
import {
  APIError,
  createAuthMiddleware,
  getSessionFromCtx,
} from "better-auth/api";
import { emailOTP, username } from "better-auth/plugins";
import { convex } from "@convex-dev/better-auth/plugins";
import type { GenericCtx } from "@convex-dev/better-auth";
import type { DataModel } from "./_generated/dataModel";
import { env } from "./_generated/server";
import { identityComponent } from "./betterAuthClient";
import { internal } from "./_generated/api";
import { humanIdentityPlugin } from "./identityPlugin";
import { resend } from "./resendClient";
import {
  IDENTITY_BASE_PATH,
  IDENTITY_MARKER,
  IDENTITY_ORIGINS,
  isRecoveryEmail,
  isFreshIdentitySession,
} from "../lib/identity-config";
import { getAuthConfigProvider } from "@convex-dev/better-auth/auth-config";

// These require a fresh interactive sign-in, not merely a refreshed JWT.
const sensitive = new Set([
  "/link-social",
  "/unlink-account",
  "/change-email",
  "/change-password",
  "/set-password",
  "/delete-user",
  "/update-user",
  "/email-otp/request-email-change",
  "/email-otp/change-email",
]);

export const createIdentityAuth = (ctx: GenericCtx<DataModel>) => {
  const enabled = env.BETTER_AUTH_ENABLED === "true";
  if (
    enabled &&
    (!env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length < 32)
  ) {
    throw new Error("Better Auth secret is missing.");
  }
  const baseURL = env.IDENTITY_SITE_URL ?? PRIMARY_SITE_URL;
  const production = new URL(baseURL).protocol === "https:";
  return betterAuth({
    appName: "SYMBaiEX",
    baseURL,
    basePath: IDENTITY_BASE_PATH,
    secret:
      env.BETTER_AUTH_SECRET ??
      "disabled-better-auth-never-enable-without-a-secret",
    logger: { disabled: production },
    database: identityComponent.adapter(ctx),
    trustedOrigins: IDENTITY_ORIGINS.filter(
      (origin) => !production || origin.startsWith("https:"),
    ),
    advanced: {
      cookiePrefix: "symbaiex.identity",
      useSecureCookies: production,
      defaultCookieAttributes: {
        httpOnly: true,
        secure: production,
        sameSite: "lax",
        path: "/",
      },
      crossSubDomainCookies: {
        enabled: production && Boolean(installation.identity.cookieDomain),
        domain: production && installation.identity.cookieDomain ? `.${installation.identity.cookieDomain}` : undefined,
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 12,
      freshAge: 300,
      cookieCache: { enabled: false },
    },
    account: {
      encryptOAuthTokens: true,
      accountLinking: {
        enabled: true,
        trustedProviders: [],
        requireLocalEmailVerified: true,
        allowDifferentEmails: true,
        allowUnlinkingAll: false,
      },
    },
    emailAndPassword: {
      // Prove email before attaching a password, avoiding password pre-claim
      // attacks against people who later use email-code or Google sign-in.
      enabled: true,
      disableSignUp: true,
      requireEmailVerification: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            if (
              "username" in user &&
              typeof user.username === "string" &&
              !(await ctx.runQuery(internal.identityData.handleAvailable, {
                username: user.username,
              }))
            ) {
              throw new APIError("CONFLICT", {
                message:
                  "This handle belongs to an existing account. Use existing-account sign-in.",
              });
            }
            return { data: user };
          },
        },
      },
    },
    socialProviders: {
      ...(env.BETTER_AUTH_GOOGLE_CLIENT_ID &&
      env.BETTER_AUTH_GOOGLE_CLIENT_SECRET
        ? {
            google: {
              clientId: env.BETTER_AUTH_GOOGLE_CLIENT_ID,
              clientSecret: env.BETTER_AUTH_GOOGLE_CLIENT_SECRET,
              prompt: "select_account" as const,
            },
          }
        : {}),
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 30,
      customRules: {
        "/sign-in/*": { window: 60, max: 5 },
        "/sign-up/*": { window: 3600, max: 5 },
        "/identity/challenge": { window: 60, max: 10 },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (request) => {
        if (!enabled)
          throw new APIError("NOT_FOUND", {
            message: "Sign-in is not enabled.",
          });
        if (request.path === "/unlink-account") {
          throw new APIError("BAD_REQUEST", {
            message: "Use the atomic account-connections endpoint.",
          });
        }
        if (
          (request.path === "/sign-in/social" ||
            request.path === "/link-social") &&
          request.body?.idToken
        ) {
          throw new APIError("BAD_REQUEST", {
            message: "Use the provider redirect flow.",
          });
        }
        if (sensitive.has(request.path)) {
          const session = await getSessionFromCtx(request, {
            disableCookieCache: true,
          });
          if (!session || !isFreshIdentitySession(session.session.createdAt)) {
            throw new APIError("UNAUTHORIZED", {
              message: "Sign in again to change account connections.",
            });
          }
          if (
            request.path === "/update-user" &&
            typeof request.body?.username === "string" &&
            !(await ctx.runQuery(internal.identityData.handleAvailable, {
              username: request.body.username,
              authUserId: session.user.id,
            }))
          ) {
            throw new APIError("CONFLICT", {
              message: "This username is already reserved.",
            });
          }
        }
        // Never send recovery mail to internal wallet/Telegram identifiers.
        if (
          request.body?.email &&
          typeof request.body.email === "string" &&
          !isRecoveryEmail(request.body.email)
        ) {
          throw new APIError("BAD_REQUEST", {
            message: "Use a valid recovery email address.",
          });
        }
      }),
    },
    plugins: [
      username({
        minUsernameLength: 3,
        maxUsernameLength: 32,
        usernameValidator: (value) =>
          /^[a-zA-Z0-9][a-zA-Z0-9_-]{2,31}$/.test(value),
      }),
      emailOTP({
        expiresIn: 300,
        allowedAttempts: 5,
        storeOTP: "hashed",
        sendVerificationOnSignUp: true,
        overrideDefaultEmailVerification: true,
        // A fresh interactive session proves the current method; a new OTP
        // proves the new recovery email, including for wallet-first accounts.
        changeEmail: { enabled: true, verifyCurrentEmail: false },
        rateLimit: { window: 60, max: 3 },
        sendVerificationOTP: async ({ email, otp }) => {
          if (!isRecoveryEmail(email))
            throw new APIError("BAD_REQUEST", {
              message: "A recovery email is required.",
            });
          if (!("runMutation" in ctx))
            throw new Error("Email requires a writable context.");
          const reserved = await ctx.runMutation(
            internal.identityData.reserveEmail,
            { email },
          );
          if (!reserved)
            throw new APIError("TOO_MANY_REQUESTS", {
              message: "Email limit reached. Try again later.",
            });
          await resend.sendEmail(ctx, {
            from: env.CONTACT_FROM_EMAIL ?? `${installation.name} <${installation.supportEmail}>`,
            to: email,
            subject: "Your SYMBaiEX verification code",
            text:
              "Your SYMBaiEX verification code is " +
              otp +
              ". It expires in 5 minutes. Never share this code. If you did not request it, ignore this email.",
          });
        },
      }),
      humanIdentityPlugin(ctx),
      convex({
        authConfig: {
          providers: [getAuthConfigProvider({ basePath: IDENTITY_BASE_PATH })],
        },
        jwt: {
          expirationSeconds: 300,
          definePayload: () => ({ authSystem: IDENTITY_MARKER }),
        },
        options: { basePath: IDENTITY_BASE_PATH },
      }),
    ],
  });
};
