import type { AdapterFactory, DBAdapter } from "better-auth/adapters";
import type { BetterAuthOptions } from "better-auth";
import type { GenericCtx } from "@convex-dev/better-auth";
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import type { DataModel } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
import { components } from "./_generated/api";
import { identityComponent } from "./betterAuthClient";

const comparison = v.union(
  v.literal("eq"),
  v.literal("ne"),
  v.literal("lt"),
  v.literal("lte"),
  v.literal("gt"),
  v.literal("gte"),
);
const condition = v.object({
  field: v.union(
    v.literal("key"),
    v.literal("count"),
    v.literal("lastRequest"),
  ),
  operator: v.optional(comparison),
  value: v.union(v.string(), v.number(), v.null()),
  connector: v.optional(v.literal("AND")),
});
const changes = v.object({
  count: v.optional(v.number()),
  lastRequest: v.optional(v.number()),
});
const args = {
  where: v.array(condition),
  increment: changes,
  set: v.optional(changes),
};
const counter = v.object({
  id: v.string(),
  key: v.string(),
  count: v.number(),
  lastRequest: v.number(),
});
type IncrementArgs = {
  where: (typeof condition.type)[];
  increment: typeof changes.type;
  set?: typeof changes.type;
};
type Counter = typeof counter.type;
const incrementRef = makeFunctionReference<
  "mutation",
  IncrementArgs,
  Counter | null
>("identityRateLimit:increment");

/** Existing database limiter only: its key, thresholds and reset policy stay in Better Auth. */
export const increment = internalMutation({
  args,
  returns: v.union(counter, v.null()),
  handler: async (ctx, request): Promise<Counter | null> => {
    if (
      !request.where.length ||
      request.where.length > 16 ||
      !request.where.some(
        (w) =>
          w.field === "key" &&
          (w.operator ?? "eq") === "eq" &&
          typeof w.value === "string",
      ) ||
      request.where.some(
        (w) => typeof w.value === "number" && !Number.isFinite(w.value),
      ) ||
      ![
        ...Object.values(request.increment),
        ...Object.values(request.set ?? {}),
      ].every((n) => n === undefined || Number.isFinite(n)) ||
      (!Object.values(request.increment).some((n) => n !== undefined) &&
        !Object.values(request.set ?? {}).some((n) => n !== undefined))
    )
      throw new Error("Invalid identity counter increment.");

    // This indexed component read and the write below share THIS transaction.
    // A conflicting writer retries the whole mutation, not an action-side CAS loop.
    const row = await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: "rateLimit",
      where: request.where,
    });
    if (!row) return null;
    const update = { ...request.set };
    for (const field of ["count", "lastRequest"] as const) {
      const delta = request.increment[field];
      if (delta === undefined) continue;
      const previous = row[field];
      const next = previous + delta;
      if (
        !Number.isFinite(previous) ||
        !Number.isFinite(next) ||
        (delta !== 0 && next === previous)
      )
        throw new Error("Identity counter increment is not representable.");
      update[field] = next;
    }
    // Match Better Auth's no-op behavior without claiming exclusive ownership.
    if (
      !Object.entries(update).every(([field, value]) =>
        Object.is(row[field as "count" | "lastRequest"], value),
      )
    ) {
      await ctx.runMutation(components.betterAuth.adapter.updateOne, {
        input: {
          model: "rateLimit",
          where: [{ field: "_id", value: row._id }],
          update,
        },
      });
    }
    return {
      id: row._id,
      key: row.key,
      count: update.count ?? row.count,
      lastRequest: update.lastRequest ?? row.lastRequest,
    };
  },
});

type Request = Parameters<DBAdapter["incrementOne"]>[0];
const numericFields = new Set(["count", "lastRequest"]);
const comparisons = new Set(["eq", "ne", "lt", "lte", "gt", "gte"]);
function nativeRequest(request: Request): IncrementArgs | null {
  if (
    request.model !== "rateLimit" ||
    !request.where.length ||
    request.where.length > 16 ||
    !request.where.some(
      (w) =>
        w.field === "key" &&
        (w.operator ?? "eq") === "eq" &&
        typeof w.value === "string",
    ) ||
    request.where.some(
      (w) =>
        !["key", "count", "lastRequest"].includes(w.field) ||
        (w.connector !== undefined && w.connector !== "AND") ||
        (w.mode !== undefined && w.mode !== "sensitive") ||
        !comparisons.has(w.operator ?? "eq") ||
        (w.value !== null &&
          typeof w.value !== "string" &&
          typeof w.value !== "number") ||
        (typeof w.value === "number" && !Number.isFinite(w.value)),
    ) ||
    [
      ...Object.entries(request.increment),
      ...Object.entries(request.set ?? {}),
    ].some(
      ([field, value]) =>
        !numericFields.has(field) ||
        typeof value !== "number" ||
        !Number.isFinite(value),
    )
  )
    return null;
  return {
    where: request.where.map(
      ({ mode: _mode, ...w }) => w,
    ) as IncrementArgs["where"],
    increment: request.increment,
    ...(request.set ? { set: request.set } : {}),
  };
}

/** Wrap only this fixed model; retain the original factory for every other operation. */
export function identityCounterAdapter(
  ctx: GenericCtx<DataModel>,
): AdapterFactory<BetterAuthOptions> {
  const factory = identityComponent.adapter(ctx);
  return (options) => {
    const adapter = factory(options);
    return {
      ...adapter,
      incrementOne: async <T>(request: Request): Promise<T | null> => {
        const native = nativeRequest(request);
        if (!native || !("runMutation" in ctx))
          return adapter.incrementOne<T>(request);
        return (await ctx.runMutation(incrementRef, native)) as T | null;
      },
    };
  };
}
