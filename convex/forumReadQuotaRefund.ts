import { ConvexError, v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { normalizeAgentQuotaMonthKey, MAX_QUOTA_UNITS } from "./agentQuota";
import { sha256Base64Url } from "./agentIdentityCrypto";
import { canonicalForumJson } from "./forumPluginValidation";

const MAX_SCAN = 300;

/** Operator-only correction: deploy read-rate separation before preview/apply. */
export const refund = internalMutation({
  args: {
    connectionId: v.id("forumPluginConnections"),
    ownerUserId: v.id("users"),
    agentId: v.string(),
    monthKey: v.string(),
    dryRun: v.optional(v.boolean()),
    expectedFingerprint: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? true;
    const now = Date.now();
    const monthKey = normalizeAgentQuotaMonthKey(args.monthKey);
    if (monthKey !== new Date(now).toISOString().slice(0, 7))
      throw new ConvexError("Refund only the current UTC month.");
    const connection = await ctx.db.get(
      "forumPluginConnections",
      args.connectionId,
    );
    const credential = connection
      ? await ctx.db.get(
          "agentIdentities",
          connection.credentialAgentIdentityId,
        )
      : null;
    if (
      !connection ||
      !credential ||
      connection.ownerUserId !== args.ownerUserId ||
      credential.ownerUserId !== args.ownerUserId ||
      credential.agentId !== args.agentId
    )
      throw new ConvexError(
        "Refund owner, credential and connection must match.",
      );
    const prior = await ctx.db
      .query("forumReadQuotaRefunds")
      .withIndex(
        "by_connectionId_and_monthKey_and_ownerUserId_and_agentId",
        (q) =>
          q
            .eq("connectionId", args.connectionId)
            .eq("monthKey", monthKey)
            .eq("ownerUserId", args.ownerUserId)
            .eq("agentId", args.agentId),
      )
      .unique();
    if (prior) return { dryRun, alreadyApplied: true, receipt: prior };
    const rows = await ctx.db
      .query("agentQuotaUsage")
      .withIndex("by_ownerUserId_and_agentId_and_monthKey_and_createdAt", (q) =>
        q
          .eq("ownerUserId", args.ownerUserId)
          .eq("agentId", args.agentId)
          .eq("monthKey", monthKey),
      )
      .take(MAX_SCAN + 1);
    if (rows.length > MAX_SCAN)
      throw new ConvexError(
        "Refund scan exceeds 300 rows; use a separately reviewed batch correction.",
      );
    const sources = rows.filter((row) => {
      if (!row.operation.startsWith("forum.read.")) return false;
      try {
        const metadata: unknown = JSON.parse(row.metadataJson ?? "null");
        return (
          !!metadata &&
          typeof metadata === "object" &&
          !Array.isArray(metadata) &&
          (metadata as Record<string, unknown>).connectionId ===
            args.connectionId
        );
      } catch {
        return false;
      }
    });
    let refundedUnits = 0;
    for (const source of sources) {
      if (
        !Number.isSafeInteger(source.units) ||
        source.units <= 0 ||
        source.units > MAX_QUOTA_UNITS
      )
        throw new ConvexError("Historical usage contains invalid units.");
      refundedUnits += source.units;
    }
    if (!Number.isSafeInteger(refundedUnits) || refundedUnits > MAX_QUOTA_UNITS)
      throw new ConvexError("Refund amount exceeds safe bounds.");
    const fingerprint = await sha256Base64Url(
      canonicalForumJson({
        connectionId: args.connectionId,
        ownerUserId: args.ownerUserId,
        agentId: args.agentId,
        monthKey,
        sources: sources.map((row) => ({
          id: row._id,
          units: row.units,
          operation: row.operation,
          createdAt: row.createdAt,
        })),
      }),
    );
    const [budget, counter] = await Promise.all([
      ctx.db
        .query("agentQuotaBudgets")
        .withIndex("by_ownerUserId_and_monthKey", (q) =>
          q.eq("ownerUserId", args.ownerUserId).eq("monthKey", monthKey),
        )
        .unique(),
      ctx.db
        .query("agentQuotaUsageCounters")
        .withIndex("by_ownerUserId_and_agentId_and_monthKey", (q) =>
          q
            .eq("ownerUserId", args.ownerUserId)
            .eq("agentId", args.agentId)
            .eq("monthKey", monthKey),
        )
        .unique(),
    ]);
    const canApply =
      refundedUnits > 0 &&
      !!budget &&
      !!counter &&
      budget.usedUnits >= refundedUnits &&
      counter.usedUnits >= refundedUnits;
    const preview = {
      fingerprint,
      scannedCount: rows.length,
      sourceCount: sources.length,
      refundedUnits,
      ownerUsedBefore: budget?.usedUnits ?? 0,
      agentUsedBefore: counter?.usedUnits ?? 0,
      canApply,
    };
    if (dryRun) return { dryRun: true, alreadyApplied: false, preview };
    if (!args.expectedFingerprint || args.expectedFingerprint !== fingerprint)
      throw new ConvexError(
        "Refund sources changed or preview is missing. Preview again before applying.",
      );
    if (!canApply || !budget || !counter)
      throw new ConvexError(
        "Refund requires positive sources and sufficient owner and credential counters.",
      );
    const ownerUsedAfter = budget.usedUnits - refundedUnits;
    const agentUsedAfter = counter.usedUnits - refundedUnits;
    await ctx.db.patch("agentQuotaBudgets", budget._id, {
      usedUnits: ownerUsedAfter,
      hardCapReachedAt:
        ownerUsedAfter < budget.hardCapUnits
          ? undefined
          : budget.hardCapReachedAt,
      updatedAt: now,
    });
    await ctx.db.patch("agentQuotaUsageCounters", counter._id, {
      usedUnits: agentUsedAfter,
      updatedAt: now,
    });
    const receiptId = await ctx.db.insert("forumReadQuotaRefunds", {
      connectionId: args.connectionId,
      ownerUserId: args.ownerUserId,
      agentId: args.agentId,
      monthKey,
      fingerprint,
      sourceCount: sources.length,
      refundedUnits,
      ownerUsedBefore: budget.usedUnits,
      ownerUsedAfter,
      agentUsedBefore: counter.usedUnits,
      agentUsedAfter,
      appliedAt: now,
    });
    return {
      dryRun: false,
      alreadyApplied: false,
      receipt: await ctx.db.get("forumReadQuotaRefunds", receiptId),
    };
  },
});
