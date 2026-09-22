import type { MutationCtx, QueryCtx } from "./_generated/server";

const PUBLICATION_KEY = "evidence-publication";

/** Missing rows/fields are epoch zero for rolling-deployment compatibility. */
export async function readEvidencePublicationEpoch(
  ctx: QueryCtx | MutationCtx,
) {
  const state = await ctx.db
    .query("evidencePublicationState")
    .withIndex("by_key", (q) => q.eq("key", PUBLICATION_KEY))
    .unique();
  return state?.epoch ?? 0;
}

export async function isEvidencePublicationEpochCurrent(
  ctx: QueryCtx | MutationCtx,
  epoch: number | undefined,
) {
  return (epoch ?? 0) === (await readEvidencePublicationEpoch(ctx));
}

/** Call in the SAME mutation as a publication restriction or retraction. */
export async function bumpEvidencePublicationEpoch(ctx: MutationCtx) {
  const state = await ctx.db
    .query("evidencePublicationState")
    .withIndex("by_key", (q) => q.eq("key", PUBLICATION_KEY))
    .unique();
  const epoch = (state?.epoch ?? 0) + 1;
  if (state === null) {
    await ctx.db.insert("evidencePublicationState", {
      key: PUBLICATION_KEY,
      epoch,
      updatedAt: Date.now(),
    });
  } else {
    await ctx.db.patch("evidencePublicationState", state._id, {
      epoch,
      updatedAt: Date.now(),
    });
  }
  return epoch;
}
