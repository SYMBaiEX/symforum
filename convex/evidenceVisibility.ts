import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import {
  FORUM_SEARCH_PROJECTION_BACKFILL_KEY,
  FORUM_THREAD_EDITORIAL_DIGEST_BACKFILL_KEY,
} from "./forumSearchProjectionConstants";

type PublicEvidenceDocumentOptions = {
  ignorePendingSync?: boolean;
  preferCompactForumThread?: boolean;
  preferCompactForumAssessment?: boolean;
};

type PublicForumAssessment = Pick<
  Doc<"researchQualityAssessmentVisibilityDigests">,
  "authorUserId" | "status"
>;

export type PublicEvidenceDocumentRef = Pick<
  Doc<"evidenceDocuments">,
  "_id" | "sourceId" | "externalKey" | "visibility"
>;

const FIRST_PARTY_FORUM_CLAIM_KEY =
  /^symbaiex-forum-(?:research|claim):([^:]+)(?::|$)/;

// A single Convex query can validate many evidence rows against the same
// source. Keep these promises scoped to the request context so concurrent
// validations share source reads without caching across snapshots.
const publicSourceCache = new WeakMap<
  QueryCtx,
  Map<Id<"evidenceSources">, Promise<Doc<"evidenceSources"> | null>>
>();
const publicEvidenceDocumentCache = new WeakMap<
  QueryCtx,
  Map<Id<"evidenceDocuments">, Promise<Doc<"evidenceDocuments"> | null>>
>();
const publicDocumentSourceCache = new WeakMap<
  QueryCtx,
  Map<string, Promise<Doc<"evidenceSources"> | null>>
>();
const publicForumAuthorCache = new WeakMap<
  QueryCtx,
  Map<Id<"users">, Promise<Doc<"users"> | null>>
>();
const publicForumCategoryCache = new WeakMap<
  QueryCtx,
  Map<Id<"forumCategories">, Promise<Doc<"forumCategories"> | null>>
>();
const publicEvidenceVersionDocumentCache = new WeakMap<
  QueryCtx,
  Map<Id<"evidenceDocumentVersions">, Promise<Id<"evidenceDocuments"> | null>>
>();
const forumSearchProjectionsReadyCache = new WeakMap<
  QueryCtx,
  Promise<boolean>
>();
const forumThreadEditorialDigestsReadyCache = new WeakMap<
  QueryCtx,
  Promise<boolean>
>();
const publicForumAssessmentCache = new WeakMap<
  QueryCtx,
  Map<string, Promise<PublicForumAssessment | null>>
>();

function publicSourceFor(ctx: QueryCtx, sourceId: Id<"evidenceSources">) {
  let sources = publicSourceCache.get(ctx);
  if (sources === undefined) {
    sources = new Map();
    publicSourceCache.set(ctx, sources);
  }
  let sourcePromise = sources.get(sourceId);
  if (sourcePromise === undefined) {
    sourcePromise = ctx.db.get("evidenceSources", sourceId);
    sources.set(sourceId, sourcePromise);
  }
  return sourcePromise;
}

function publicEvidenceDocumentFor(
  ctx: QueryCtx,
  documentId: Id<"evidenceDocuments">,
) {
  let documents = publicEvidenceDocumentCache.get(ctx);
  if (documents === undefined) {
    documents = new Map();
    publicEvidenceDocumentCache.set(ctx, documents);
  }
  let documentPromise = documents.get(documentId);
  if (documentPromise === undefined) {
    documentPromise = ctx.db.get("evidenceDocuments", documentId);
    documents.set(documentId, documentPromise);
  }
  return documentPromise;
}

/** Seed a query-local visibility cache with a source already read by its caller. */
export function cachePublicEvidenceSource(
  ctx: QueryCtx,
  source: Doc<"evidenceSources">,
) {
  let sources = publicSourceCache.get(ctx);
  if (sources === undefined) {
    sources = new Map();
    publicSourceCache.set(ctx, sources);
  }
  if (!sources.has(source._id))
    sources.set(source._id, Promise.resolve(source));
}

function publicForumAuthorFor(ctx: QueryCtx, userId: Id<"users">) {
  let authors = publicForumAuthorCache.get(ctx);
  if (authors === undefined) {
    authors = new Map();
    publicForumAuthorCache.set(ctx, authors);
  }
  let authorPromise = authors.get(userId);
  if (authorPromise === undefined) {
    authorPromise = ctx.db.get("users", userId);
    authors.set(userId, authorPromise);
  }
  return authorPromise;
}

function publicForumCategoryFor(
  ctx: QueryCtx,
  categoryId: Id<"forumCategories">,
) {
  let categories = publicForumCategoryCache.get(ctx);
  if (categories === undefined) {
    categories = new Map();
    publicForumCategoryCache.set(ctx, categories);
  }
  let categoryPromise = categories.get(categoryId);
  if (categoryPromise === undefined) {
    categoryPromise = ctx.db.get("forumCategories", categoryId);
    categories.set(categoryId, categoryPromise);
  }
  return categoryPromise;
}

export function isIndependentPublicEvidenceEntity(
  entity: Doc<"evidenceEntities">,
) {
  return (
    entity.entityKey === "project:symbaiex" ||
    entity.entityKey === "person:austin-hamilton"
  );
}

/**
 * True only when a first-party forum claim names this exact evidence document.
 * Callers may use this as a fast path only after validating the document's
 * current publication policy and confirming the citation belongs to its
 * current version.
 */
export function firstPartyForumClaimMatchesEvidenceDocument(
  claim: Doc<"evidenceClaims">,
  document: Pick<Doc<"evidenceDocuments">, "externalKey">,
) {
  const match = FIRST_PARTY_FORUM_CLAIM_KEY.exec(claim.claimKey);
  return (
    match !== null &&
    document.externalKey.toLowerCase() === `forum-research:${match[1]}`
  );
}

/** Resolve a version's owner through its compact row when available. */
export function publicEvidenceDocumentIdForVersion(
  ctx: QueryCtx,
  versionId: Id<"evidenceDocumentVersions">,
): Promise<Id<"evidenceDocuments"> | null> {
  let versions = publicEvidenceVersionDocumentCache.get(ctx);
  if (versions === undefined) {
    versions = new Map();
    publicEvidenceVersionDocumentCache.set(ctx, versions);
  }
  let documentIdPromise = versions.get(versionId);
  if (documentIdPromise === undefined) {
    documentIdPromise = ctx.db
      .query("evidenceDocumentVersionExportDigests")
      .withIndex("by_versionId", (q) => q.eq("versionId", versionId))
      .unique()
      .then(async (digest) => {
        if (digest !== null) return digest.documentId;
        return (
          (await ctx.db.get("evidenceDocumentVersions", versionId))
            ?.documentId ?? null
        );
      });
    versions.set(versionId, documentIdPromise);
  }
  return documentIdPromise;
}

export async function publicEvidenceEntityReference(
  ctx: QueryCtx,
  entity: Doc<"evidenceEntities">,
  options: { ignorePendingSync?: boolean } = {},
): Promise<{
  document: Doc<"evidenceDocuments">;
  versionId: Id<"evidenceDocumentVersions">;
} | null> {
  const links = await ctx.db
    .query("evidenceDocumentEntities")
    .withIndex("by_entityId", (q) => q.eq("entityId", entity._id))
    .order("desc")
    .take(50);
  for (const link of links) {
    const documentId = await publicEvidenceDocumentIdForVersion(
      ctx,
      link.documentVersionId,
    );
    if (documentId === null) continue;
    const document = await publicEvidenceDocumentFor(ctx, documentId);
    if (
      document?.currentVersionId === link.documentVersionId &&
      (await isPublicEvidenceDocument(ctx, document, options))
    ) {
      return { document, versionId: link.documentVersionId };
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
export function getPublicEvidenceSource(
  ctx: QueryCtx,
  document: PublicEvidenceDocumentRef | null,
  options: PublicEvidenceDocumentOptions = {},
): Promise<Doc<"evidenceSources"> | null> {
  if (document?.visibility !== "public") return Promise.resolve(null);
  let documents = publicDocumentSourceCache.get(ctx);
  if (documents === undefined) {
    documents = new Map();
    publicDocumentSourceCache.set(ctx, documents);
  }
  const cacheKey = `${document._id}:${options.ignorePendingSync === true}:${options.preferCompactForumThread === true}:${options.preferCompactForumAssessment === true}`;
  let sourcePromise = documents.get(cacheKey);
  if (sourcePromise !== undefined) return sourcePromise;
  sourcePromise = resolvePublicEvidenceSource(ctx, document, options);
  documents.set(cacheKey, sourcePromise);
  return sourcePromise;
}

/** Validate with a source row the caller already read in this transaction. */
export function getPublicEvidenceSourceWithKnownSource(
  ctx: QueryCtx,
  document: PublicEvidenceDocumentRef | null,
  source: Doc<"evidenceSources"> | null,
  options: PublicEvidenceDocumentOptions = {},
): Promise<Doc<"evidenceSources"> | null> {
  if (
    document?.visibility !== "public" ||
    source === null ||
    source._id !== document.sourceId ||
    source.visibility !== "public" ||
    source.status !== "active"
  ) {
    return Promise.resolve(null);
  }
  return resolvePublicEvidenceSource(ctx, document, options, source);
}

async function resolvePublicEvidenceSource(
  ctx: QueryCtx,
  document: PublicEvidenceDocumentRef,
  options: PublicEvidenceDocumentOptions,
  knownSource?: Doc<"evidenceSources"> | null,
): Promise<Doc<"evidenceSources"> | null> {
  const source =
    knownSource === undefined
      ? await publicSourceFor(ctx, document.sourceId)
      : knownSource;
  if (source?.visibility !== "public" || source.status !== "active")
    return null;
  if (!document.externalKey.startsWith("forum-research:")) return source;
  const threadId = ctx.db.normalizeId(
    "forumThreads",
    document.externalKey.slice("forum-research:".length),
  );
  if (threadId === null) return null;
  if (!options.ignorePendingSync) {
    const pending = await ctx.db
      .query("evidenceFirstPartySyncQueue")
      .withIndex("by_threadId", (q) => q.eq("threadId", threadId))
      .unique();
    if (pending !== null) return null;
  }
  const thread = await publicForumThreadForEvidence(
    ctx,
    threadId,
    options.preferCompactForumThread === true,
  );
  if (thread === null || !["active", "locked"].includes(thread.status))
    return null;
  const assessment = await publicForumAssessmentFor(
    ctx,
    threadId,
    options.preferCompactForumAssessment === true,
  );
  if (
    assessment === null ||
    !["passed", "approved", "overridden"].includes(assessment.status)
  )
    return null;
  const author = await publicForumAuthorFor(ctx, assessment.authorUserId);
  if (author?.isAgent !== true || !author.agentSlug) return null;
  let category = await publicForumCategoryFor(ctx, thread.categoryId);
  if (category === null || (category.kind ?? "board") !== "board") return null;
  const seen = new Set<Id<"forumCategories">>();
  for (let depth = 0; depth < 16; depth += 1) {
    if (
      category === null ||
      category.status !== "active" ||
      (category.viewAccess ?? "public") !== "public" ||
      seen.has(category._id)
    )
      return null;
    seen.add(category._id);
    if (category.parentCategoryId === undefined) return source;
    category = await publicForumCategoryFor(ctx, category.parentCategoryId);
  }
  return null;
}

function forumSearchProjectionsReady(ctx: QueryCtx) {
  let ready = forumSearchProjectionsReadyCache.get(ctx);
  if (ready === undefined) {
    ready = ctx.db
      .query("forumAgentMaintenanceState")
      .withIndex("by_key", (q) =>
        q.eq("key", FORUM_SEARCH_PROJECTION_BACKFILL_KEY),
      )
      .unique()
      .then((state) => state !== null && state.completedAt > 0);
    forumSearchProjectionsReadyCache.set(ctx, ready);
  }
  return ready;
}

function forumThreadEditorialDigestsReady(ctx: QueryCtx) {
  let ready = forumThreadEditorialDigestsReadyCache.get(ctx);
  if (ready === undefined) {
    ready = ctx.db
      .query("forumAgentMaintenanceState")
      .withIndex("by_key", (q) =>
        q.eq("key", FORUM_THREAD_EDITORIAL_DIGEST_BACKFILL_KEY),
      )
      .unique()
      .then((state) => state !== null && state.completedAt > 0);
    forumThreadEditorialDigestsReadyCache.set(ctx, ready);
  }
  return ready;
}

function publicForumAssessmentFor(
  ctx: QueryCtx,
  threadId: Id<"forumThreads">,
  preferCompact: boolean,
) {
  let assessments = publicForumAssessmentCache.get(ctx);
  if (assessments === undefined) {
    assessments = new Map();
    publicForumAssessmentCache.set(ctx, assessments);
  }
  const cacheKey = `${threadId}:${preferCompact}`;
  let assessment = assessments.get(cacheKey);
  if (assessment === undefined) {
    assessment = (async () => {
      if (preferCompact) {
        const digest = await ctx.db
          .query("researchQualityAssessmentVisibilityDigests")
          .withIndex("by_threadId", (q) => q.eq("threadId", threadId))
          .unique();
        if (digest !== null) return digest;
        // A missing projection is not evidence of approval. Fall back to the
        // canonical record to preserve visibility correctness.
      }
      const canonical = await ctx.db
        .query("researchQualityAssessments")
        .withIndex("by_threadId", (q) => q.eq("threadId", threadId))
        .unique();
      return canonical === null
        ? null
        : {
            authorUserId: canonical.authorUserId,
            status: canonical.status,
          };
    })();
    assessments.set(cacheKey, assessment);
  }
  return assessment;
}

async function publicForumThreadForEvidence(
  ctx: QueryCtx,
  threadId: Id<"forumThreads">,
  preferCompact: boolean,
): Promise<Pick<Doc<"forumThreads">, "categoryId" | "status"> | null> {
  if (preferCompact && (await forumThreadEditorialDigestsReady(ctx))) {
    const digest = await ctx.db
      .query("forumThreadEditorialDigests")
      .withIndex("by_threadId", (q) => q.eq("threadId", threadId))
      .unique();
    if (digest !== null) return digest;
    // A missing digest is not evidence of publication. Try the already
    // bounded search projection before falling back to the canonical thread.
  }
  if (preferCompact && (await forumSearchProjectionsReady(ctx))) {
    const projection = await ctx.db
      .query("forumThreadSearchProjections")
      .withIndex("by_threadId", (q) => q.eq("threadId", threadId))
      .unique();
    if (projection !== null) return projection;
    // Missing projections are not evidence of publication. Fall back to the
    // canonical row, preserving existing behavior for partially migrated data.
  }
  return await ctx.db.get("forumThreads", threadId);
}

export async function isPublicEvidenceDocument(
  ctx: QueryCtx,
  document: PublicEvidenceDocumentRef | null,
  options: PublicEvidenceDocumentOptions = {},
): Promise<boolean> {
  return (await getPublicEvidenceSource(ctx, document, options)) !== null;
}

/** Historical claims cannot outlive their owning first-party document's access. */
export async function isPublicEvidenceClaim(
  ctx: QueryCtx,
  claim: Doc<"evidenceClaims"> | null,
  options: { ignorePendingSync?: boolean } = {},
): Promise<boolean> {
  if (claim?.visibility !== "public") return false;
  const match = FIRST_PARTY_FORUM_CLAIM_KEY.exec(claim.claimKey);
  if (match === null) return true;
  // The immutable citation retains the canonical ID spelling (also important
  // for test/development IDs) while claim keys are normalized to lowercase.
  const citation = await ctx.db
    .query("evidenceClaimCitations")
    .withIndex("by_claimId", (q) => q.eq("claimId", claim._id))
    .first();
  if (citation !== null) {
    const documentId = await publicEvidenceDocumentIdForVersion(
      ctx,
      citation.documentVersionId,
    );
    const owner =
      documentId === null
        ? null
        : await publicEvidenceDocumentFor(ctx, documentId);
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
