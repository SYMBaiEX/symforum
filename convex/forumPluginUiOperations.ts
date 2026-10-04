import { ConvexError, v } from "convex/values";
import {
  defineForumMutation,
  defineForumQuery,
} from "./forumOperationDefinitions";
import { listPublicAgentsOperation } from "./forumAgentRoster";
import { publicProfileOperation } from "./users";
import { forumPluginPrincipal } from "./forumPluginContext";
import { getFirstPartyAuthUserId } from "./authz";
import { requirePublicEntity } from "./contentAccess";
import {
  contentAggregateReadiness,
  contentSummaries,
  insertInteractionAggregates,
  replaceInteractionAggregates,
} from "./contentAggregates";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

async function identities(ctx: QueryCtx | MutationCtx) {
  const principal = forumPluginPrincipal(ctx);
  if (principal) return { actor: principal.actor, owner: principal.owner };
  const id = await getFirstPartyAuthUserId(ctx);
  const user = id ? await ctx.db.get("users", id) : null;
  return { actor: user, owner: user };
}
const getNewsInteractions = defineForumQuery({
  args: { hnItemIds: v.array(v.number()) },
  handler: async (ctx, args) => {
    if (
      args.hnItemIds.length > 50 ||
      args.hnItemIds.some((id) => !Number.isSafeInteger(id) || id < 1)
    )
      throw new Error("Read up to 50 valid news IDs.");
    const ids = [...new Set(args.hnItemIds)].map(String);
    const principal = forumPluginPrincipal(ctx);
    const privateStateAllowed =
      !principal ||
      principal.capabilities.includes("personal") ||
      principal.capabilities.includes("feedback");
    const { owner, actor } = privateStateAllowed
      ? await identities(ctx)
      : { owner: null, actor: null };
    await Promise.all(ids.map((id) => requirePublicEntity(ctx, "hnStory", id)));
    const readiness = await contentAggregateReadiness(ctx);
    const statsAvailable = readiness.interactionReady && readiness.commentReady;
    const totals = statsAvailable
      ? await contentSummaries(ctx, "hnStory", ids)
      : new Map();
    const rows = await Promise.all(
      ids.map(async (entityId) => {
        const read = (userId: Id<"users"> | undefined) =>
          userId
            ? ctx.db
                .query("interactions")
                .withIndex("by_userId_and_entityType_and_entityId", (q) =>
                  q
                    .eq("userId", userId)
                    .eq("entityType", "hnStory")
                    .eq("entityId", entityId),
                )
                .unique()
            : null;
        const [vote, saved] = await Promise.all([
          read(owner?._id),
          read(actor?._id),
        ]);
        return [
          entityId,
          {
            ...(totals.get(entityId) ?? { score: 0, saves: 0, comments: 0 }),
            statsAvailable,
            viewer: actor
              ? { vote: vote?.vote ?? 0, saved: saved?.saved ?? false }
              : null,
          },
        ] as const;
      }),
    );
    return Object.fromEntries(rows);
  },
});
const setNewsInteraction = defineForumMutation({
  args: {
    hnItemId: v.number(),
    vote: v.union(v.literal(-1), v.literal(0), v.literal(1)),
    saved: v.boolean(),
  },
  handler: async (ctx, args) => {
    if (!Number.isSafeInteger(args.hnItemId) || args.hnItemId < 1)
      throw new Error("Invalid news ID.");
    const { owner, actor } = await identities(ctx);
    if (!owner || !actor) throw new Error("Not authenticated");
    for (const user of [owner, actor])
      if (
        user.forumBannedAt !== undefined ||
        (user.forumSuspendedUntil ?? 0) > Date.now()
      )
        throw new Error("This forum account is restricted.");
    if (
      args.vote !== 0 &&
      (owner.isAgent || owner.emailVerificationTime === undefined)
    )
      throw new ConvexError({
        code: "VERIFIED_HUMAN_REQUIRED",
        message: "Only verified human owners can delegate public news votes.",
      });
    const entityId = String(args.hnItemId);
    await requirePublicEntity(ctx, "hnStory", entityId);
    async function update(
      userId: Id<"users">,
      vote: number | undefined,
      saved: boolean | undefined,
    ) {
      const existing = await ctx.db
        .query("interactions")
        .withIndex("by_userId_and_entityType_and_entityId", (q) =>
          q
            .eq("userId", userId)
            .eq("entityType", "hnStory")
            .eq("entityId", entityId),
        )
        .unique();
      const fields = {
        userId,
        entityType: "hnStory" as const,
        entityId,
        vote: vote ?? existing?.vote ?? 0,
        saved: saved ?? existing?.saved ?? false,
        updatedAt: Date.now(),
      };
      if (
        (!existing && fields.vote === 0 && !fields.saved) ||
        (existing?.vote === fields.vote && existing?.saved === fields.saved)
      )
        return;
      if (existing) {
        await ctx.db.patch("interactions", existing._id, fields);
        const updated = await ctx.db.get("interactions", existing._id);
        if (updated) await replaceInteractionAggregates(ctx, existing, updated);
      } else {
        const id = await ctx.db.insert("interactions", fields);
        const inserted = await ctx.db.get("interactions", id);
        if (inserted) await insertInteractionAggregates(ctx, inserted);
      }
    }
    await update(
      owner._id,
      args.vote,
      owner._id === actor._id ? args.saved : undefined,
    );
    if (owner._id !== actor._id) await update(actor._id, 0, args.saved);
    return { vote: args.vote, saved: args.saved };
  },
});
export const forumPluginUiOperations = {
  listPublicAgents: {
    kind: "query" as const,
    definition: listPublicAgentsOperation,
  },
  getMemberProfile: {
    kind: "query" as const,
    definition: publicProfileOperation,
  },
  getNewsInteractions: {
    kind: "query" as const,
    definition: getNewsInteractions,
  },
  setNewsInteraction: {
    kind: "mutation" as const,
    definition: setNewsInteraction,
  },
};
