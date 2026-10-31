import { defineTable } from "convex/server";
import { v } from "convex/values";

export const tokenPlatformValidator = v.union(
  v.literal("bags"),
  v.literal("pumpfun"),
);

const nullableNumber = v.union(v.number(), v.null());
const nullableString = v.union(v.string(), v.null());

/** Mirrors TokenSnapshot in lib/token-alpha; null is unavailable, never zero. */
export const tokenSnapshotValidator = v.object({
  platform: tokenPlatformValidator,
  mint: v.string(),
  name: v.string(),
  symbol: v.string(),
  observedAt: v.number(),
  metricsAsOf: v.number(),
  metadataAsOf: v.optional(v.number()),
  priceUsd: nullableNumber,
  marketCapUsd: nullableNumber,
  holders: nullableNumber,
  volume1hUsd: nullableNumber,
  liquidityUsd: nullableNumber,
  priceChange1hPercent: nullableNumber,
  imageUrl: nullableString,
  website: nullableString,
  twitter: nullableString,
  telegram: nullableString,
  description: nullableString,
  sourceUrl: v.string(),
  sourceRank: v.number(),
  warnings: v.optional(v.array(v.string())),
});

export const tokenAlphaTables = {
  // One source-only observation per ordinary platform/hour. The permanent
  // intent is separate from model/publication runs: neither a crashed source
  // worker nor an ambiguous model call can authorize a duplicate source fetch.
  tokenAlphaObservations: defineTable({
    runKey: v.string(),
    platform: tokenPlatformValidator,
    claimToken: v.string(),
    status: v.union(
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
    expiresAt: v.number(),
    // Strictly bounded to five verified candidates by the committing mutation.
    snapshots: v.optional(v.array(tokenSnapshotValidator)),
    payloadExpiresAt: v.optional(v.number()),
    sourceCount: v.optional(v.number()),
    reason: v.optional(v.string()),
  })
    .index("by_runKey", ["runKey"])
    .index("by_status_and_payloadExpiresAt", ["status", "payloadExpiresAt"]),
  tokenAlphaControl: defineTable({
    key: v.literal("pilot"),
    enabled: v.boolean(),
    operatorFirstPostAttempts: v.optional(v.array(tokenPlatformValidator)),
    operatorBagsRetry: v.optional(
      v.object({
        sourceRunKey: v.string(),
        sourceJobId: v.string(),
        runKey: v.string(),
        authorizedAt: v.number(),
        claimedAt: v.optional(v.number()),
      }),
    ),
    operatorBagsDataRecovery: v.optional(
      v.object({
        sourceRunKey: v.string(),
        runKey: v.string(),
        authorizedAt: v.number(),
        claimedAt: v.optional(v.number()),
      }),
    ),
    operatorBagsValidationVerification: v.optional(
      v.object({
        sourceRunKey: v.string(),
        sourceJobId: v.string(),
        runKey: v.string(),
        authorizedAt: v.number(),
        claimedAt: v.optional(v.number()),
      }),
    ),
    operatorBagsGrammarVerification: v.optional(
      v.object({
        sourceRunKey: v.string(),
        sourceJobId: v.string(),
        runKey: v.string(),
        authorizedAt: v.number(),
        claimedAt: v.optional(v.number()),
      }),
    ),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),
  // Durable run keys never become retryable: an ambiguous model outcome must
  // not be turned into a fresh purchase or a second public contribution.
  tokenAlphaRuns: defineTable({
    runKey: v.string(),
    platform: tokenPlatformValidator,
    claimToken: v.string(),
    operatorFirstPost: v.optional(v.boolean()),
    operatorRetryOf: v.optional(v.string()),
    status: v.union(
      v.literal("running"),
      v.literal("drafted"),
      v.literal("published"),
      v.literal("held"),
      v.literal("skipped"),
      v.literal("failed"),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
    expiresAt: v.number(),
    snapshot: v.optional(tokenSnapshotValidator),
    previous: v.optional(tokenSnapshotValidator),
    analysis: v.optional(v.string()),
    title: v.optional(v.string()),
    body: v.optional(v.string()),
    threadId: v.optional(v.id("forumThreads")),
    postId: v.optional(v.id("forumPosts")),
    reason: v.optional(v.string()),
  })
    .index("by_runKey", ["runKey"])
    .index("by_status_and_expiresAt", ["status", "expiresAt"]),
  // Solana addresses are case-sensitive. The canonical key is chain + mint,
  // not platform, so one asset cannot acquire duplicate board threads.
  tokenAlphaTrackedTokens: defineTable({
    chain: v.literal("solana"),
    mint: v.string(),
    threadId: v.id("forumThreads"),
    latestSnapshot: v.optional(tokenSnapshotValidator),
    lastUpdatedAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_chain_and_mint", ["chain", "mint"])
    .index("by_threadId", ["threadId"]),
  // Aggregate accounting per UTC day; no credentials or provider payloads.
  tokenAlphaUsageDays: defineTable({
    dayKey: v.string(),
    requests: v.number(),
    enrichmentRequests: v.optional(v.number()),
    candleRequests: v.optional(v.number()),
    updatedAt: v.number(),
  }).index("by_dayKey", ["dayKey"]),
};
