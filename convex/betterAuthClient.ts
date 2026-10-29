import { createClient } from "@convex-dev/better-auth";
import type { DataModel } from "./_generated/dataModel";
import { components, internal } from "./_generated/api";
import type { MutationCtx } from "./_generated/server";
import { ConvexError } from "convex/values";

async function uniqueUser(
  ctx: MutationCtx,
  doc: { _id: string; email: string; username?: string | null },
) {
  for (const [field, value] of [
    ["email", doc.email.toLowerCase()],
    ["username", doc.username?.toLowerCase()],
  ] as const) {
    if (!value) continue;
    const result = await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: "user",
      where: [{ field, value }],
      paginationOpts: { numItems: 2, cursor: null },
    });
    if (
      !result.isDone ||
      result.page.length !== 1 ||
      result.page[0]._id !== doc._id
    )
      throw new ConvexError(
        "Identity is already registered. No accounts were merged.",
      );
  }
}
async function uniqueAccount(
  ctx: MutationCtx,
  doc: { _id: string; accountId: string; providerId: string },
) {
  const result = await ctx.runQuery(components.betterAuth.adapter.findMany, {
    model: "account",
    where: [
      { field: "accountId", value: doc.accountId },
      { field: "providerId", value: doc.providerId },
    ],
    paginationOpts: { numItems: 2, cursor: null },
  });
  if (
    !result.isDone ||
    result.page.length !== 1 ||
    result.page[0]._id !== doc._id
  )
    throw new ConvexError(
      "This identity is already connected. No accounts were merged.",
    );
}
// Component triggers execute inside the original write transaction, so parallel
// OAuth links or username claims cannot create duplicate provider ownership.
export const identityComponent: ReturnType<typeof createClient<DataModel>> =
  createClient<DataModel>(components.betterAuth, {
    authFunctions: internal.betterAuthClient,
    triggers: {
      user: {
        onCreate: uniqueUser,
        onUpdate: (ctx, doc) => uniqueUser(ctx, doc),
      },
      account: {
        onCreate: uniqueAccount,
        onUpdate: (ctx, doc) => uniqueAccount(ctx, doc),
      },
    },
  });
export const { onCreate, onUpdate, onDelete } = identityComponent.triggersApi();
