"use node";
import { WorkOS } from "@workos-inc/node";
import { ConvexError, v } from "convex/values";
import { action, env } from "./_generated/server";
import { internal } from "./_generated/api";
import { pluginConnectionOptions } from "./forumPluginSchema";
import {
  workosPluginConfig,
  WORKOS_PLUGIN_GRANT_CLAIM,
  WORKOS_PLUGIN_RESOURCE_CLAIM,
  WORKOS_PLUGIN_KIND_CLAIM,
} from "../lib/workos-config";
import type { Id } from "./_generated/dataModel";

export const complete = action({
  args: { externalAuthId: v.string(), ...pluginConnectionOptions },
  returns: v.object({ redirectUri: v.string() }),
  handler: async (ctx, args): Promise<{ redirectUri: string }> => {
    const config = workosPluginConfig(env);
    if (!config || !env.WORKOS_API_KEY)
      throw new ConvexError("OAuth connections are unavailable.");
    const grant: {
      grantId: Id<"forumPluginConnections">;
      ownerId: Id<"users">;
      email: string;
      actorLabel: string;
    } = await ctx.runMutation(
      internal.forumPluginAccess.prepareConnection,
      args,
    );
    try {
      const workos = new WorkOS(env.WORKOS_API_KEY, { timeout: 15_000 });
      const result = await workos.connect.completeOAuth2({
        externalAuthId: args.externalAuthId,
        user: { id: grant.ownerId, email: grant.email },
        userConsentOptions: [
          {
            claim: WORKOS_PLUGIN_GRANT_CLAIM,
            type: "enum",
            label: "SYMBaiEX forum profile",
            choices: [{ value: grant.grantId, label: grant.actorLabel }],
          },
          {
            claim: WORKOS_PLUGIN_RESOURCE_CLAIM,
            type: "enum",
            label: "Forum access",
            choices: [{ value: config.audience, label: "SYMBaiEX forum" }],
          },
          {
            claim: WORKOS_PLUGIN_KIND_CLAIM,
            type: "enum",
            label: "Connection type",
            choices: [{ value: "forum-plugin", label: "Forum plugin" }],
          },
        ],
      });
      const redirect = new URL(result.redirectUri);
      if (
        redirect.origin !== config.issuer ||
        redirect.username ||
        redirect.password
      )
        throw new Error("Unexpected OAuth redirect.");
      const active: boolean = await ctx.runMutation(
        internal.forumPluginAccess.finishConnection,
        { grantId: grant.grantId, subject: grant.ownerId },
      );
      if (!active) throw new Error("Connection expired.");
      return { redirectUri: redirect.toString() };
    } catch {
      await ctx
        .runMutation(internal.forumPluginAccess.finishConnection, {
          grantId: grant.grantId,
        })
        .catch(() => undefined);
      throw new ConvexError(
        "The connection could not be completed. Restart authorization from your client.",
      );
    }
  },
});
