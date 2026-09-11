"use node";

import { WorkOS } from "@workos-inc/node";
import { ConvexError, v } from "convex/values";
import { action, env } from "./_generated/server";
import { internal } from "./_generated/api";
import { workosConfig, WORKOS_GRANT_CLAIM } from "../lib/workos-config";

export const complete = action({
  args: { agentId: v.string(), externalAuthId: v.string() },
  returns: v.object({ redirectUri: v.string() }),
  handler: async (ctx, args): Promise<{ redirectUri: string }> => {
    const config = workosConfig(env);
    if (!config || !env.WORKOS_API_KEY)
      throw new ConvexError("OAuth connections are unavailable.");
    const grant = await ctx.runMutation(
      internal.agentOAuth.prepareConnection,
      args,
    );
    const workos = new WorkOS(env.WORKOS_API_KEY, { timeout: 15_000 });
    try {
      const result = await workos.connect.completeOAuth2({
        externalAuthId: args.externalAuthId,
        user: { id: grant.ownerId, email: grant.email },
        userConsentOptions: [
          {
            claim: WORKOS_GRANT_CLAIM,
            type: "enum",
            label: "SYMBaiEX agent",
            choices: [{ value: grant.grantId, label: grant.agentId }],
          },
        ],
      });
      const redirect = new URL(result.redirectUri);
      if (
        redirect.origin !== config.issuer ||
        redirect.username ||
        redirect.password
      ) {
        throw new Error("Unexpected authorization redirect.");
      }
      // Standalone Connect signs the exact external user.id supplied above as
      // sub, not the separately provisioned AuthKit user_... directory ID.
      const active = await ctx.runMutation(
        internal.agentOAuth.finishConnection,
        {
          grantId: grant.grantId,
          subject: grant.ownerId,
        },
      );
      if (!active) throw new Error("Connection expired.");
      return { redirectUri: redirect.toString() };
    } catch {
      await ctx
        .runMutation(internal.agentOAuth.finishConnection, {
          grantId: grant.grantId,
        })
        .catch(() => undefined);
      throw new ConvexError(
        "The connection could not be completed. Restart authorization from your client.",
      );
    }
  },
});
