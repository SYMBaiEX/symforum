import { RateLimiter } from "@convex-dev/rate-limiter";
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { action, internalQuery } from "./_generated/server";
import { components } from "./_generated/api";
import { requireSiteAdmin } from "./authz";
import {
  providerLedgerRequests,
  providerUsageSnapshot,
  type ProviderUsageSnapshot,
} from "../lib/provider-usage-model";

const limiter = new RateLimiter(components.rateLimiter, {});
const nullable = v.union(v.number(), v.null());
const result = v.object({
  asOf: v.number(),
  complete: v.boolean(),
  scope: v.literal("application-reservations"),
  accountUsageKnown: v.literal(false),
  denialHistoryRecorded: v.literal(false),
  counters: v.array(
    v.object({
      id: v.union(
        v.literal("helius-rpc"),
        v.literal("helius-send"),
        v.literal("helius-daily"),
        v.literal("helius-rolling"),
        v.literal("dexscreener"),
        v.literal("geckoterminal"),
      ),
      used: nullable,
      limit: v.number(),
      unit: v.union(v.literal("requests"), v.literal("credits")),
      windowStart: v.number(),
      windowEnd: v.number(),
      eligibleAt: nullable,
    }),
  ),
});
const readSnapshotRef = makeFunctionReference<
  "query",
  { asOf: number },
  ProviderUsageSnapshot
>("forumProviderUsage:readSnapshot");

/** Internal timestamp only. Authorization precedes all component reads. */
export const readSnapshot = internalQuery({
  args: { asOf: v.number() },
  returns: result,
  handler: async (ctx, { asOf }): Promise<ProviderUsageSnapshot> => {
    await requireSiteAdmin(ctx);
    const requests = providerLedgerRequests(asOf);
    const states = await Promise.all(
      requests.map(async ({ name, key, config }) => {
        try {
          const value = await limiter.getValue(ctx, name, { key, config });
          return { value: value.value, ts: value.ts };
        } catch {
          // A missing transport/component is unknown, never free capacity. Raw
          // errors/keys/provider bodies are neither returned nor logged.
          return null;
        }
      }),
    );
    return providerUsageSnapshot(asOf, states);
  },
});

/** Explicit read-only refresh. No caller clock, mutations or provider I/O. */
export const snapshot = action({
  args: {},
  returns: result,
  handler: async (ctx): Promise<ProviderUsageSnapshot> =>
    ctx.runQuery(readSnapshotRef, { asOf: Date.now() }),
});
