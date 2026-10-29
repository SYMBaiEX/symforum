import { internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { env } from "./_generated/server";
import {
  parseInstallationConfig,
  installationRoutingBinding,
  matchesInstallationBinding,
} from "../lib/installation-config";

/** Typed, owner-controlled public deployment configuration; no credentials. */
export const installation = parseInstallationConfig(
  env.NEXT_PUBLIC_INSTALLATION_CONFIG,
);
export const installationBinding = installationRoutingBinding(installation);
export function installationMatches(row: {
  installationBinding?: string;
}): boolean {
  return matchesInstallationBinding(
    row,
    installationBinding,
    env.INSTALLATION_LEGACY_BINDING,
  );
}

/** Operator-only readback. Public identity and a compatibility boolean, no secrets. */
export const status = internalQuery({
  args: {},
  returns: v.object({
    configuration: v.string(),
    binding: v.string(),
    legacyMatches: v.boolean(),
    convexSiteUrl: v.string(),
  }),
  handler: async () => ({
    configuration: JSON.stringify(installation),
    binding: installationBinding,
    legacyMatches: env.INSTALLATION_LEGACY_BINDING === installationBinding,
    convexSiteUrl: env.CONVEX_SITE_URL,
  }),
});
