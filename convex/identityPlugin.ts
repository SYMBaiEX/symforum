import type { BetterAuthPlugin } from "better-auth";
import {
  APIError,
  createAuthEndpoint,
  getSessionFromCtx,
} from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { z } from "zod";
import type { GenericCtx } from "@convex-dev/better-auth";
import type { DataModel } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { env } from "./_generated/server";
import {
  IDENTITY_ORIGINS,
  isRecoveryEmail,
  isFreshIdentitySession,
} from "../lib/identity-config";
import { randomBase64Url, sha256Base64Url } from "./agentIdentityCrypto";
import { walletLoginInput } from "../lib/human-auth-proof";
import { retrieveAccount } from "@convex-dev/auth/server";
import type { ActionCtx } from "./_generated/server";

const telegramKeys = createRemoteJWKSet(
  new URL("https://oauth.telegram.org/.well-known/jwks.json"),
);
function writableBackend(ctx: GenericCtx<DataModel>) {
  if (!("runMutation" in ctx))
    throw new Error("Identity writes require an action or mutation.");
  return ctx;
}
const nonceBody = z.object({
  provider: z.enum(["solana", "telegram"]),
  purpose: z.enum(["login", "link"]),
});
const proofBody = z.object({
  nonce: z.string().min(16).max(80),
  address: z.string().max(64).optional(),
  publicKey: z.string().max(100).optional(),
  signature: z.string().max(160).optional(),
  signedMessage: z.string().max(4096).optional(),
  idToken: z.string().max(16_000).optional(),
});

/** Native Better Auth sessions; no separate wallet/Telegram JWT authority. */
export function humanIdentityPlugin(backend: GenericCtx<DataModel>) {
  return {
    id: "symbaiex-identity",
    endpoints: {
      identityUnlink: createAuthEndpoint(
        "/identity/unlink",
        {
          method: "POST",
          requireRequest: true,
          body: z.object({
            providerId: z.enum(["solana", "telegram", "google", "credential"]),
            accountId: z.string().min(1).max(256),
          }),
        },
        async (ctx) => {
          const session = await getSessionFromCtx(ctx, {
            disableCookieCache: true,
          });
          if (!session || !isFreshIdentitySession(session.session.createdAt))
            throw new APIError("UNAUTHORIZED", {
              message: "Sign in again before unlinking an account.",
            });
          try {
            await writableBackend(backend).runMutation(
              internal.identityData.unlinkAccount,
              { ...ctx.body, authUserId: session.user.id },
            );
          } catch {
            throw new APIError("BAD_REQUEST", {
              message:
                "Keep at least one sign-in method. The connection may already have changed.",
            });
          }
          return ctx.json({ unlinked: true });
        },
      ),
      identityPassword: createAuthEndpoint(
        "/identity/password",
        {
          method: "POST",
          requireRequest: true,
          body: z.object({ password: z.string().min(12).max(128) }),
        },
        async (ctx) => {
          const session = await getSessionFromCtx(ctx, {
            disableCookieCache: true,
          });
          if (
            !session ||
            !isFreshIdentitySession(session.session.createdAt) ||
            !session.user.emailVerified ||
            !isRecoveryEmail(session.user.email)
          ) {
            throw new APIError("UNAUTHORIZED", {
              message: "Sign in again and verify a recovery email first.",
            });
          }
          await writableBackend(backend).runMutation(
            internal.identityData.addPassword,
            {
              authUserId: session.user.id,
              passwordHash: await ctx.context.password.hash(ctx.body.password),
            },
          );
          return ctx.json({ added: true });
        },
      ),
      signInLegacy: createAuthEndpoint(
        "/sign-in/legacy",
        {
          method: "POST",
          requireRequest: true,
          body: z.object({
            username: z.string().min(3).max(32),
            password: z.string().min(1).max(128),
          }),
        },
        async (ctx) => {
          if (!("runAction" in backend))
            throw new Error("Password migration requires an action.");
          const handle = ctx.body.username.trim().toLowerCase();
          if (!/^[a-z0-9][a-z0-9_-]{2,31}$/.test(handle))
            throw new APIError("UNAUTHORIZED", {
              message: "Unable to verify this account.",
            });
          let legacy;
          try {
            legacy = await retrieveAccount<DataModel>(backend as ActionCtx, {
              provider: "password",
              account: {
                id: handle + "@users.symbaiex.local",
                secret: ctx.body.password,
              },
            });
          } catch {
            throw new APIError("UNAUTHORIZED", {
              message: "Unable to verify this account.",
            });
          }
          if (!legacy?.user || legacy.user.isAgent)
            throw new APIError("UNAUTHORIZED", {
              message: "Unable to verify this account.",
            });
          const id = await backend.runMutation(
            internal.identityData.migratePassword,
            {
              legacyUserId: legacy.user._id,
              passwordHash: await ctx.context.password.hash(ctx.body.password),
            },
          );
          const user = await ctx.context.internalAdapter.findUserById(id);
          if (
            !user ||
            ("twoFactorEnabled" in user && user.twoFactorEnabled === true)
          ) {
            throw new APIError("UNAUTHORIZED", {
              message: "Use your primary sign-in method.",
            });
          }
          const session = await ctx.context.internalAdapter.createSession(id);
          await setSessionCookie(ctx, { session, user });
          return ctx.json({ authenticated: true });
        },
      ),
      identityChallenge: createAuthEndpoint(
        "/identity/challenge",
        {
          method: "POST",
          body: nonceBody,
          requireRequest: true,
        },
        async (ctx) => {
          const origin = ctx.headers?.get("origin");
          if (
            !origin ||
            !IDENTITY_ORIGINS.includes(
              origin as (typeof IDENTITY_ORIGINS)[number],
            )
          ) {
            throw new APIError("FORBIDDEN", {
              message: "Untrusted sign-in origin.",
            });
          }
          const session = await getSessionFromCtx(ctx, {
            disableCookieCache: true,
          });
          if (
            ctx.body.purpose === "link" &&
            (!session || !isFreshIdentitySession(session.session.createdAt))
          ) {
            throw new APIError("UNAUTHORIZED", {
              message: "Sign in again before linking an account.",
            });
          }
          if (
            ctx.body.provider === "telegram" &&
            !env.TELEGRAM_LOGIN_CLIENT_ID
          ) {
            throw new APIError("SERVICE_UNAVAILABLE", {
              message: "Telegram sign-in is not configured.",
            });
          }
          const cookie = ctx.context.createAuthCookie("identity_browser", {
            maxAge: 600,
          });
          let binder = ctx.getCookie(cookie.name);
          if (!binder) {
            binder = randomBase64Url(32);
            ctx.setCookie(cookie.name, binder, cookie.attributes);
          }
          const challenge = await writableBackend(backend).runMutation(
            internal.identityData.nonce,
            {
              ...ctx.body,
              origin,
              browserHash: await sha256Base64Url(binder),
              ...(ctx.body.purpose === "link" && session
                ? { authUserId: session.user.id }
                : {}),
            },
          );
          return ctx.json({
            ...challenge,
            ...(ctx.body.provider === "solana"
              ? {
                  input: walletLoginInput({
                    ...challenge,
                    origin,
                    purpose: ctx.body.purpose,
                  }),
                }
              : { clientId: env.TELEGRAM_LOGIN_CLIENT_ID }),
          });
        },
      ),
      signInSolana: createAuthEndpoint(
        "/sign-in/solana",
        {
          method: "POST",
          body: proofBody,
          requireRequest: true,
        },
        async (ctx) => {
          const cookie = ctx.context.createAuthCookie("identity_browser", {
            maxAge: 600,
          });
          const binder = ctx.getCookie(cookie.name);
          if (!binder)
            throw new APIError("UNAUTHORIZED", {
              message: "Start wallet sign-in again.",
            });
          const session = await getSessionFromCtx(ctx, {
            disableCookieCache: true,
          });
          const result = await writableBackend(backend).runMutation(
            internal.identityData.consumeChallenge,
            {
              nonce: ctx.body.nonce,
              provider: "solana",
              browserHash: await sha256Base64Url(binder),
              ...(session && isFreshIdentitySession(session.session.createdAt)
                ? { authUserId: session.user.id }
                : {}),
              address: ctx.body.address,
              publicKey: ctx.body.publicKey,
              signature: ctx.body.signature,
              signedMessage: ctx.body.signedMessage,
            },
          );
          if (result.purpose === "link") return ctx.json({ linked: true });
          const user =
            result.authUserId &&
            (await ctx.context.internalAdapter.findUserById(result.authUserId));
          if (
            !user ||
            ("twoFactorEnabled" in user && user.twoFactorEnabled === true)
          )
            throw new APIError("UNAUTHORIZED", {
              message:
                "Use your primary sign-in method to complete verification.",
            });
          const newSession = await ctx.context.internalAdapter.createSession(
            user.id,
          );
          await setSessionCookie(ctx, { session: newSession, user });
          return ctx.json({ authenticated: true });
        },
      ),
      signInTelegram: createAuthEndpoint(
        "/sign-in/telegram",
        {
          method: "POST",
          body: proofBody,
          requireRequest: true,
        },
        async (ctx) => {
          const cookie = ctx.context.createAuthCookie("identity_browser", {
            maxAge: 600,
          });
          const binder = ctx.getCookie(cookie.name);
          if (!binder || !ctx.body.idToken || !env.TELEGRAM_LOGIN_CLIENT_ID) {
            throw new APIError("UNAUTHORIZED", {
              message: "Start Telegram sign-in again.",
            });
          }
          let subject: string;
          try {
            const { payload } = await jwtVerify(
              ctx.body.idToken,
              telegramKeys,
              {
                issuer: "https://oauth.telegram.org",
                audience: env.TELEGRAM_LOGIN_CLIENT_ID,
                algorithms: ["RS256"],
                maxTokenAge: "5m",
              },
            );
            if (
              payload.nonce !== ctx.body.nonce ||
              typeof payload.sub !== "string" ||
              !/^\d{1,30}$/.test(payload.sub)
            )
              throw new Error("Invalid proof");
            subject = payload.sub;
          } catch {
            throw new APIError("UNAUTHORIZED", {
              message: "Invalid or expired Telegram proof.",
            });
          }
          const session = await getSessionFromCtx(ctx, {
            disableCookieCache: true,
          });
          const result = await writableBackend(backend).runMutation(
            internal.identityData.consumeChallenge,
            {
              nonce: ctx.body.nonce,
              provider: "telegram",
              browserHash: await sha256Base64Url(binder),
              telegramSubject: subject,
              ...(session && isFreshIdentitySession(session.session.createdAt)
                ? { authUserId: session.user.id }
                : {}),
            },
          );
          if (result.purpose === "link") return ctx.json({ linked: true });
          const user =
            result.authUserId &&
            (await ctx.context.internalAdapter.findUserById(result.authUserId));
          if (
            !user ||
            ("twoFactorEnabled" in user && user.twoFactorEnabled === true)
          )
            throw new APIError("UNAUTHORIZED", {
              message:
                "Use your primary sign-in method to complete verification.",
            });
          const newSession = await ctx.context.internalAdapter.createSession(
            user.id,
          );
          await setSessionCookie(ctx, { session: newSession, user });
          return ctx.json({ authenticated: true });
        },
      ),
    },
  } satisfies BetterAuthPlugin;
}
