import { ConvexError } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";

export type PublicEntityType = "post" | "hnStory" | "portfolioProject";

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,159}$/;

export async function requirePublicEntity(
  ctx: QueryCtx | MutationCtx,
  entityType: PublicEntityType,
  entityId: string,
) {
  const entity = await getPublicEntity(ctx, entityType, entityId);
  if (entity === null) {
    throw unavailableTarget();
  }
  return entity;
}

export async function getPublicEntity(
  ctx: QueryCtx | MutationCtx,
  entityType: PublicEntityType,
  entityId: string,
) {
  const normalizedId = entityId.trim();
  if (normalizedId.length === 0 || normalizedId.length > 180) {
    return null;
  }

  if (entityType === "hnStory") {
    const hnItemId = Number(normalizedId);
    if (
      !Number.isSafeInteger(hnItemId) ||
      hnItemId <= 0 ||
      String(hnItemId) !== normalizedId
    ) {
      return null;
    }
    const stories = await ctx.db
      .query("hnStories")
      .withIndex("by_hnItemId", (q) => q.eq("hnItemId", hnItemId))
      .take(1);
    if (stories.length === 0) {
      return null;
    }
    return stories[0];
  }

  if (!SLUG_PATTERN.test(normalizedId)) {
    return null;
  }

  if (entityType === "post") {
    const post = await ctx.db
      .query("posts")
      .withIndex("by_slug", (q) => q.eq("slug", normalizedId))
      .unique();
    if (post === null || post.status !== "published") {
      return null;
    }
    return post;
  }

  const project = await ctx.db
    .query("portfolioProjects")
    .withIndex("by_slug", (q) => q.eq("slug", normalizedId))
    .unique();
  if (project === null || project.status !== "published") {
    return null;
  }
  return project;
}

function unavailableTarget() {
  return new ConvexError({
    code: "TARGET_NOT_PUBLIC",
    message: "That public discussion target is not available.",
  });
}
