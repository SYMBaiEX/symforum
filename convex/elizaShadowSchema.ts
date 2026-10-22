import { defineTable } from "convex/server";
import { v } from "convex/values";

export const shadowKind = v.union(
  v.literal("suki-reply"),
  v.literal("belle-newsletter"),
);
export const shadowStatus = v.union(
  v.literal("queued"),
  v.literal("running"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("expired"),
  v.literal("disabled"),
);
export const elizaShadowTables = {
  elizaShadowJobs: defineTable({
    jobKey: v.string(),
    kind: shadowKind,
    sourceRunKey: v.string(),
    promptVersion: v.string(),
    inputHash: v.string(),
    inputJson: v.string(),
    baselineJson: v.string(),
    evaluationJson: v.string(),
    status: shadowStatus,
    createdAt: v.number(),
    updatedAt: v.number(),
    expiresAt: v.number(),
    deadline: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    reservationKey: v.optional(v.string()),
    model: v.optional(v.string()),
    reservedMicroUsd: v.optional(v.number()),
    outputJson: v.optional(v.string()),
    comparisonJson: v.optional(v.string()),
    servedModel: v.optional(v.string()),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    providerCostMicroUsd: v.optional(v.number()),
    durationMs: v.optional(v.number()),
    runtimeVersion: v.optional(v.string()),
    errorCode: v.optional(v.string()),
    isCanary: v.boolean(),
  })
    .index("by_jobKey", ["jobKey"])
    .index("by_kind_and_createdAt", ["kind", "createdAt"])
    .index("by_status_and_createdAt", ["status", "createdAt"])
    .index("by_expiresAt", ["expiresAt"]),
};
