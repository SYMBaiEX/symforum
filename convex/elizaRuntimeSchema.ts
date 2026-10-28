import { defineTable } from "convex/server";
import { v } from "convex/values";

// Metadata only. Prompts, private thread history, completions and credentials
// must never be included in these receipts.
export const elizaRuntimeReceipt = v.object({
  jobId: v.string(),
  inputHash: v.string(),
  agentSlug: v.string(),
  stage: v.string(),
  model: v.string(),
  status: v.union(v.literal("completed"), v.literal("failed")),
  runtimeVersion: v.optional(v.string()),
  providerStatus: v.optional(v.number()),
  outcomeUnknown: v.optional(v.boolean()),
  workerErrorCode: v.optional(v.string()),
  workerHttpStatus: v.optional(v.number()),
  recoveredReceipt: v.optional(v.boolean()),
  inputTokens: v.optional(v.number()),
  outputTokens: v.optional(v.number()),
  servedModel: v.optional(v.string()),
});

export const elizaRuntimeRequest = elizaRuntimeReceipt.pick(
  "jobId",
  "inputHash",
  "agentSlug",
  "stage",
  "model",
);

export const elizaRuntimeTables = {
  elizaRuntimeCalls: defineTable({
    ...elizaRuntimeReceipt.fields,
    status: v.union(
      v.literal("pending"),
      v.literal("completed"),
      v.literal("failed"),
    ),
    operationKey: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_jobId", ["jobId"])
    .index("by_agentSlug_and_createdAt", ["agentSlug", "createdAt"])
    .index("by_expiresAt", ["expiresAt"]),
  // Durable intent/unknown holds do not expire: a later scheduled invocation
  // must not purchase a fresh inference after receipt persistence failed.
  elizaRuntimeOperations: defineTable({
    operationKey: v.string(),
    status: v.union(
      v.literal("ready"),
      v.literal("pending"),
      v.literal("unknown"),
    ),
    jobId: v.string(),
    inputHash: v.string(),
    updatedAt: v.number(),
  })
    .index("by_operationKey", ["operationKey"])
    .index("by_status_and_operationKey", ["status", "operationKey"]),
};
