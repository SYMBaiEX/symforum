"use node";

import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action, env } from "./_generated/server";
import {
  pkceChallenge,
  randomXSecret,
  sealX,
  unsealX,
  xHash,
} from "../lib/x-agent-crypto";
import {
  X_CALLBACK_URL,
  X_DRAFT_SCOPES,
  xAuthorizationUrl,
  xUsername,
} from "../lib/x-agent-policy";

function config() {
  if (
    env.X_AGENTS_ENABLED !== "true" ||
    !env.X_AGENT_CLIENT_ID ||
    !env.X_AGENT_CLIENT_SECRET ||
    !env.X_AGENT_TOKEN_KEK
  )
    throw Error("The shared SymForum X app is not configured.");
  return {
    clientId: env.X_AGENT_CLIENT_ID,
    clientSecret: env.X_AGENT_CLIENT_SECRET,
    kek: env.X_AGENT_TOKEN_KEK,
  };
}
async function jsonResponse(response: Response) {
  // Errors can contain credentials or the authorization code. Never echo them.
  if (!response.ok)
    throw Error(
      `X authorization failed (${response.status}). Connect again after checking the app settings.`,
    );
  const text = await response.text();
  if (text.length > 16384) throw Error("Invalid X authorization response.");
  return JSON.parse(text) as Record<string, unknown>;
}
export const begin = action({
  args: { agentSlug: v.string(), expectedUsername: v.string() },
  returns: v.object({ authorizationUrl: v.string() }),
  handler: async (ctx, args): Promise<{ authorizationUrl: string }> => {
    const ownerId = await ctx.runQuery(
      internal.xAgentAccounts.ownerIdentity,
      {},
    );
    const c = config();
    const state = randomXSecret();
    const verifier = randomXSecret();
    const encrypted = await sealX(
      c.kek,
      verifier,
      `${ownerId}:${args.agentSlug}:pkce:v1`,
    );
    await ctx.runMutation(internal.xAgentAccounts.prepareAuthorization, {
      ...args,
      stateHash: await xHash(state),
      verifier: encrypted,
    });
    const url = xAuthorizationUrl(state, await pkceChallenge(verifier));
    url.searchParams.set("client_id", c.clientId);
    return { authorizationUrl: url.toString() };
  },
});
export const finish = action({
  args: { state: v.string(), code: v.string() },
  returns: v.object({ username: v.string(), agentSlug: v.string() }),
  handler: async (
    ctx,
    args,
  ): Promise<{ username: string; agentSlug: string }> => {
    if (
      !/^[a-f0-9]{64}$/.test(args.state) ||
      !args.code ||
      args.code.length > 2048
    )
      throw Error("Invalid X authorization callback.");
    const c = config();
    // Claim and erase PKCE material transactionally before the one-time exchange.
    // A timeout/unknown exchange is never automatically retried.
    const pending = await ctx.runMutation(
      internal.xAgentAccounts.claimAuthorization,
      { stateHash: await xHash(args.state) },
    );
    try {
      const verifier = await unsealX(
        c.kek,
        pending.verifier,
        `${pending.ownerUserId}:${pending.agentSlug}:pkce:v1`,
      );
      const token = await jsonResponse(
        await fetch("https://api.x.com/2/oauth2/token", {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(15_000),
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: `Basic ${Buffer.from(`${encodeURIComponent(c.clientId)}:${encodeURIComponent(c.clientSecret)}`).toString("base64")}`,
          },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            code: args.code,
            redirect_uri: X_CALLBACK_URL,
            code_verifier: verifier,
          }).toString(),
        }),
      );
      if (
        typeof token.access_token !== "string" ||
        typeof token.refresh_token !== "string" ||
        typeof token.scope !== "string" ||
        typeof token.expires_in !== "number" ||
        token.expires_in <= 0 ||
        token.expires_in > 86400 ||
        String(token.token_type).toLowerCase() !== "bearer" ||
        !X_DRAFT_SCOPES.every((s) =>
          (token.scope as string).split(" ").includes(s),
        )
      )
        throw Error("Invalid X account grant.");
      const me = await jsonResponse(
        await fetch("https://api.x.com/2/users/me", {
          headers: { Authorization: `Bearer ${token.access_token}` },
          redirect: "error",
          signal: AbortSignal.timeout(15_000),
        }),
      );
      const data = me.data as Record<string, unknown> | undefined;
      if (
        !data ||
        typeof data.id !== "string" ||
        !/^\d{1,22}$/.test(data.id) ||
        typeof data.username !== "string" ||
        xUsername(data.username) !== pending.expectedUsername
      )
        throw Error(
          "Wrong X account. Sign in as the expected agent account and connect again.",
        );
      const grant = await sealX(
        c.kek,
        JSON.stringify({
          accessToken: token.access_token,
          refreshToken: token.refresh_token,
        }),
        `${pending.ownerUserId}:${pending.agentSlug}:grant:v1`,
      );
      await ctx.runMutation(internal.xAgentAccounts.completeAuthorization, {
        authorizationId: pending.id,
        xUserId: data.id,
        username: xUsername(data.username),
        grant,
        scope: token.scope,
        expiresAt: Date.now() + token.expires_in * 1000,
      });
      return {
        username: xUsername(data.username),
        agentSlug: pending.agentSlug,
      };
    } catch {
      throw Error(
        "X connection could not be verified. Sign in to the expected X account, check the app callback, and start a fresh connection. This attempt will not be replayed.",
      );
    }
  },
});
