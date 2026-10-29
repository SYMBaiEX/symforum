import { v } from "convex/values";

// Keep schema dependencies separate from runtime principal/session resolution.
export const agentScopeValidator = v.union(
  v.literal("forum"),
  v.literal("newsletter"),
  v.literal("interactions"),
  v.literal("comments"),
  v.literal("evidence"),
);
