import { defineTable } from "convex/server";
import { v } from "convex/values";

export const elizaPilotTables = {
  elizaPilotRuns: defineTable({
    nonce: v.string(),
    kind: v.union(v.literal("suki-reply"), v.literal("belle-newsletter")),
    sourceKey: v.string(),
    status: v.union(
      v.literal("reserved"),
      v.literal("completed"),
      v.literal("blocked"),
      v.literal("failed"),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
    sourceHash: v.optional(v.string()),
    sourceCount: v.optional(v.number()),
    shadowJobId: v.optional(v.id("elizaShadowJobs")),
    shadowStatus: v.optional(v.string()),
    baselineDecision: v.optional(v.string()),
    errorCode: v.optional(v.string()),
  }).index("by_nonce", ["nonce"]),
};
