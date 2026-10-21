import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery } from "./_generated/server";
import { elizaRuntimeReceipt, elizaRuntimeRequest } from "./elizaRuntimeSchema";

const RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;

type RequestIdentity = {
  jobId: string;
  inputHash: string;
  agentSlug: string;
  stage: string;
  model: string;
  operationKey: string;
};
function validateIdentity(args: RequestIdentity) {
  if (
    !/^[a-zA-Z0-9:_-]{1,200}$/.test(args.jobId) ||
    !/^[a-f0-9]{64}$/.test(args.inputHash) ||
    !/^[a-z0-9-]{1,80}$/.test(args.agentSlug) ||
    !/^[a-zA-Z0-9:_-]{1,160}$/.test(args.stage) ||
    !/^[a-zA-Z0-9:_-]{1,240}$/.test(args.operationKey) ||
    !args.model ||
    args.model.length > 160
  )
    throw new ConvexError("invalid_eliza_runtime_receipt");
}

/** Atomic durable intent, written before the worker can start inference. */
export const reserveCall = internalMutation({
  args: { ...elizaRuntimeRequest.fields, operationKey: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    validateIdentity(args);
    const operation = await ctx.db
      .query("elizaRuntimeOperations")
      .withIndex("by_operationKey", (q) =>
        q.eq("operationKey", args.operationKey),
      )
      .unique();
    if (
      operation &&
      operation.status !== "ready" &&
      operation.jobId !== args.jobId
    ) {
      throw new ConvexError("eliza_runtime_operation_unresolved");
    }
    const existing = await ctx.db
      .query("elizaRuntimeCalls")
      .withIndex("by_jobId", (q) => q.eq("jobId", args.jobId))
      .unique();
    if (existing) {
      if (
        existing.inputHash !== args.inputHash ||
        existing.operationKey !== args.operationKey ||
        existing.agentSlug !== args.agentSlug ||
        existing.stage !== args.stage ||
        existing.model !== args.model
      ) {
        throw new ConvexError("eliza_runtime_receipt_conflict");
      }
      return null;
    }
    const now = Date.now();
    await ctx.db.insert("elizaRuntimeCalls", {
      ...args,
      status: "pending",
      createdAt: now,
      updatedAt: now,
      expiresAt: now + RETENTION_MS,
    });
    const state = {
      operationKey: args.operationKey,
      status: "pending" as const,
      jobId: args.jobId,
      inputHash: args.inputHash,
      updatedAt: now,
    };
    if (operation)
      await ctx.db.patch("elizaRuntimeOperations", operation._id, state);
    else await ctx.db.insert("elizaRuntimeOperations", state);
    return null;
  },
});

export const recordReceipt = internalMutation({
  args: { ...elizaRuntimeReceipt.fields, operationKey: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    validateIdentity(args);
    if (
      (args.servedModel?.length ?? 0) > 160 ||
      (args.runtimeVersion?.length ?? 0) > 24 ||
      [args.inputTokens, args.outputTokens].some(
        (value) =>
          value !== undefined && (!Number.isSafeInteger(value) || value < 0),
      ) ||
      (args.providerStatus !== undefined &&
        (!Number.isInteger(args.providerStatus) ||
          args.providerStatus < 400 ||
          args.providerStatus > 599))
    )
      throw new ConvexError("invalid_eliza_runtime_receipt");
    const existing = await ctx.db
      .query("elizaRuntimeCalls")
      .withIndex("by_jobId", (q) => q.eq("jobId", args.jobId))
      .unique();
    if (!existing) throw new ConvexError("eliza_runtime_request_not_reserved");
    if (
      existing.inputHash !== args.inputHash ||
      existing.operationKey !== args.operationKey ||
      existing.agentSlug !== args.agentSlug ||
      existing.stage !== args.stage ||
      existing.model !== args.model
    ) {
      throw new ConvexError("eliza_runtime_receipt_conflict");
    }
    if (
      existing.status === "completed" ||
      (existing.outcomeUnknown === true && args.status !== "completed")
    )
      return null;
    const now = Date.now();
    await ctx.db.patch("elizaRuntimeCalls", existing._id, {
      ...args,
      updatedAt: now,
    });
    const operation = await ctx.db
      .query("elizaRuntimeOperations")
      .withIndex("by_operationKey", (q) =>
        q.eq("operationKey", args.operationKey),
      )
      .unique();
    if (operation?.jobId === args.jobId) {
      await ctx.db.patch("elizaRuntimeOperations", operation._id, {
        status: args.outcomeUnknown === true ? "unknown" : "ready",
        updatedAt: now,
      });
    }
    return null;
  },
});

export const assertOperationReady = internalQuery({
  args: { operationKey: v.string() },
  returns: v.null(),
  handler: async (ctx, { operationKey }) => {
    const operation = await ctx.db
      .query("elizaRuntimeOperations")
      .withIndex("by_operationKey", (q) => q.eq("operationKey", operationKey))
      .unique();
    if (operation && operation.status !== "ready")
      throw new ConvexError("eliza_runtime_operation_unresolved");
    return null;
  },
});

const summary = v.object({
  ...elizaRuntimeReceipt.fields,
  status: v.union(
    v.literal("pending"),
    v.literal("completed"),
    v.literal("failed"),
  ),
  operationKey: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
});
export const inspect = internalQuery({
  args: { agentSlug: v.string(), limit: v.optional(v.number()) },
  returns: v.array(summary),
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(40, Math.floor(args.limit ?? 10)));
    if (!Number.isFinite(limit))
      throw new ConvexError("invalid_eliza_runtime_limit");
    const rows = await ctx.db
      .query("elizaRuntimeCalls")
      .withIndex("by_agentSlug_and_createdAt", (q) =>
        q.eq("agentSlug", args.agentSlug),
      )
      .order("desc")
      .take(limit);
    return rows.map(({ _id, _creationTime, expiresAt, ...receipt }) => {
      void _id;
      void _creationTime;
      void expiresAt;
      return receipt;
    });
  },
});

export const cleanup = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("elizaRuntimeCalls")
      .withIndex("by_expiresAt", (q) => q.lte("expiresAt", Date.now()))
      .take(25);
    for (const row of rows) await ctx.db.delete("elizaRuntimeCalls", row._id);
    if (rows.length === 25)
      await ctx.scheduler.runAfter(0, internal.elizaRuntimeData.cleanup, {});
    // Operation holds are intentionally not expired or automatically released.
    return rows.length;
  },
});
