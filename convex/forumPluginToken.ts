import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { ConvexError } from "convex/values";
import { env } from "./_generated/server";
import {
  workosPluginConfig,
  WORKOS_PLUGIN_GRANT_CLAIM,
  WORKOS_PLUGIN_KIND_CLAIM,
  WORKOS_PLUGIN_RESOURCE_CLAIM,
  WORKOS_GRANT_CLAIM,
} from "../lib/workos-config";
import { FORUM_PLUGIN_RESOURCE } from "../lib/forum-plugin-contract";
import type { VerifiedOAuthPrincipal } from "./forumPluginPrincipal";
import type { Id } from "./_generated/dataModel";

const resolvers = new Map<string, JWTVerifyGetKey>();
/** HTTP-only verification: the token never enters Convex's evidence auth provider. */
export async function verifyForumPluginOAuth(
  token: string,
  key?: JWTVerifyGetKey | CryptoKey,
): Promise<VerifiedOAuthPrincipal> {
  const config = workosPluginConfig(env);
  if (!config || token.length > 16_384)
    throw new ConvexError({
      code: "PLUGIN_INVALID_TOKEN",
      message: "Forum OAuth is unavailable or the token is invalid.",
    });
  try {
    let resolver = key ?? resolvers.get(config.jwks);
    if (!resolver) {
      resolver = createRemoteJWKSet(new URL(config.jwks), {
        timeoutDuration: 5_000,
        cooldownDuration: 30_000,
        cacheMaxAge: 600_000,
      });
      resolvers.set(config.jwks, resolver);
    }
    const { payload } = await jwtVerify(token, resolver, {
      issuer: config.issuer,
      audience: FORUM_PLUGIN_RESOURCE,
      algorithms: ["RS256"],
      requiredClaims: [
        "iss",
        "aud",
        "sub",
        "exp",
        WORKOS_PLUGIN_GRANT_CLAIM,
        WORKOS_PLUGIN_RESOURCE_CLAIM,
        WORKOS_PLUGIN_KIND_CLAIM,
      ],
    });
    const grantId = payload[WORKOS_PLUGIN_GRANT_CLAIM];
    if (
      payload.aud !== FORUM_PLUGIN_RESOURCE ||
      payload[WORKOS_PLUGIN_RESOURCE_CLAIM] !== FORUM_PLUGIN_RESOURCE ||
      payload[WORKOS_PLUGIN_KIND_CLAIM] !== "forum-plugin" ||
      payload[WORKOS_GRANT_CLAIM] !== undefined ||
      typeof grantId !== "string" ||
      !grantId ||
      typeof payload.sub !== "string" ||
      !payload.sub
    )
      throw new Error("Wrong forum token boundary");
    return {
      issuer: config.issuer,
      subject: payload.sub,
      grantId: grantId as Id<"forumPluginConnections">,
    };
  } catch {
    throw new ConvexError({
      code: "PLUGIN_INVALID_TOKEN",
      message: "The forum token is invalid or expired. Reconnect your profile.",
    });
  }
}
