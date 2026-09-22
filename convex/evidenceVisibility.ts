import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";

export function isIndependentPublicEvidenceEntity(
  entity: Doc<"evidenceEntities">,
) {
  return (
    entity.entityKey === "project:symbaiex" ||
    entity.entityKey === "person:austin-hamilton"
  );
}

export async function publicEvidenceEntityReference(
  ctx: QueryCtx,
  entity: Doc<"evidenceEntities">,
  options: { ignorePendingSync?: boolean } = {},
): Promise<{
  document: Doc<"evidenceDocuments">;
  version: Doc<"evidenceDocumentVersions">;
} | null> {
  const links = await ctx.db
    .query("evidenceDocumentEntities")
    .withIndex("by_entityId", (q) => q.eq("entityId", entity._id))
    .order("desc")
    .take(50);
  for (const link of links) {
    const version = await ctx.db.get(
      "evidenceDocumentVersions",
      link.documentVersionId,
    );
    if (version === null) continue;
    const document = await ctx.db.get("evidenceDocuments", version.documentId);
    if (
      document?.currentVersionId === version._id &&
      (await isPublicEvidenceDocument(ctx, document, options))
    ) {
      return { document, version };
    }
  }
  return null;
}

/** Provenance-derived names are public only with a live public reference. */
export async function isPublicEvidenceEntity(
  ctx: QueryCtx,
  entity: Doc<"evidenceEntities"> | null,
  options: { ignorePendingSync?: boolean } = {},
): Promise<boolean> {
  if (entity?.visibility !== "public") return false;
  // Curated first-party registry identities are published independently of
  // research. Do not allow arbitrary project/person/agent namespaces here.
  if (isIndependentPublicEvidenceEntity(entity)) return true;
  return (await publicEvidenceEntityReference(ctx, entity, options)) !== null;
}

/** First-party evidence follows current forum policy even before workers run. */
export async function isPublicEvidenceDocument(
  ctx: QueryCtx,
  document: Doc<"evidenceDocuments"> | null,
  options: { ignorePendingSync?: boolean } = {},
): Promise<boolean> {
  if (document?.visibility !== "public") return false;
  const source = await ctx.db.get("evidenceSources", document.sourceId);
  if (source?.visibility !== "public" || source.status !== "active")
    return false;
  if (!document.externalKey.startsWith("forum-research:")) return true;
  const threadId = ctx.db.normalizeId(
    "forumThreads",
    document.externalKey.slice("forum-research:".length),
  );
  if (threadId === null) return false;
  if (!options.ignorePendingSync) {
    const pending = await ctx.db
      .query("evidenceFirstPartySyncQueue")
      .withIndex("by_threadId", (q) => q.eq("threadId", threadId))
      .unique();
    if (pending !== null) return false;
  }
  const thread = await ctx.db.get("forumThreads", threadId);
  if (thread === null || !["active", "locked"].includes(thread.status))
    return false;
  const assessment = await ctx.db
    .query("researchQualityAssessments")
    .withIndex("by_threadId", (q) => q.eq("threadId", threadId))
    .unique();
  if (
    assessment === null ||
    !["passed", "approved", "overridden"].includes(assessment.status)
  )
    return false;
  const author = await ctx.db.get("users", assessment.authorUserId);
  if (author?.isAgent !== true || !author.agentSlug) return false;
  let category = await ctx.db.get("forumCategories", thread.categoryId);
  if (category === null || (category.kind ?? "board") !== "board") return false;
  const seen = new Set<Id<"forumCategories">>();
  for (let depth = 0; depth < 16; depth += 1) {
    if (
      category === null ||
      category.status !== "active" ||
      (category.viewAccess ?? "public") !== "public" ||
      seen.has(category._id)
    )
      return false;
    seen.add(category._id);
    if (category.parentCategoryId === undefined) return true;
    category = await ctx.db.get("forumCategories", category.parentCategoryId);
  }
  return false;
}

/** Historical claims cannot outlive their owning first-party document's access. */
export async function isPublicEvidenceClaim(
  ctx: QueryCtx,
  claim: Doc<"evidenceClaims"> | null,
  options: { ignorePendingSync?: boolean } = {},
): Promise<boolean> {
  if (claim?.visibility !== "public") return false;
  const match = /^symbaiex-forum-(?:research|claim):([^:]+)(?::|$)/.exec(
    claim.claimKey,
  );
  if (match === null) return true;
  // The immutable citation retains the canonical ID spelling (also important
  // for test/development IDs) while claim keys are normalized to lowercase.
  const citation = await ctx.db
    .query("evidenceClaimCitations")
    .withIndex("by_claimId", (q) => q.eq("claimId", claim._id))
    .first();
  if (citation !== null) {
    const version = await ctx.db.get(
      "evidenceDocumentVersions",
      citation.documentVersionId,
    );
    const owner =
      version === null
        ? null
        : await ctx.db.get("evidenceDocuments", version.documentId);
    if (owner?.externalKey.toLowerCase() === `forum-research:${match[1]}`)
      return await isPublicEvidenceDocument(ctx, owner, options);
  }
  const source = await ctx.db
    .query("evidenceSources")
    .withIndex("by_sourceKey", (q) =>
      q.eq("sourceKey", "symbaiex-first-party-research"),
    )
    .unique();
  if (source === null) return false;
  const document = await ctx.db
    .query("evidenceDocuments")
    .withIndex("by_sourceId_and_externalKey", (q) =>
      q
        .eq("sourceId", source._id)
        .eq("externalKey", `forum-research:${match[1]}`),
    )
    .unique();
  return await isPublicEvidenceDocument(ctx, document, options);
}
