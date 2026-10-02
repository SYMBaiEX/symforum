import { v } from "convex/values";
import {
  getPublicEvidenceSource,
  isIndependentPublicEvidenceEntity,
  isPublicEvidenceClaim,
  isPublicEvidenceDocument,
  isPublicEvidenceEntity,
  publicEvidenceDocumentIdForVersion,
} from "./evidenceVisibility";
import type { Doc, Id } from "./_generated/dataModel";
import { internalQuery, type QueryCtx } from "./_generated/server";
import { FORUM_SEARCH_PROJECTION_BACKFILL_KEY } from "./forumSearchProjection";
import {
  searchUniversalSearchProjections,
  universalSearchProjectionReady,
} from "./universalSearchProjection";

const PRIMARY_ORIGIN = "https://www.symbaiex.com";
const FORUM_ORIGIN = "https://forum.symbaiex.com";
const SOURCE_CANDIDATE_LIMIT = 50;
const MAX_FORUM_CATEGORY_ANCESTORS = 10;
const MAX_RESULTS = 50;
const MAX_QUERY_LENGTH = 300;
const CLAIM_STATUSES = [
  "supported",
  "contradicted",
  "unresolved",
  "outdated",
] as const;

const resultValidator = v.object({
  type: v.union(
    v.literal("evidence_document"),
    v.literal("evidence_claim"),
    v.literal("evidence_entity"),
    v.literal("blog_post"),
    v.literal("newsletter_issue"),
    v.literal("news_story"),
    v.literal("forum_thread"),
  ),
  canonicalUrl: v.string(),
  title: v.string(),
  excerpt: v.string(),
  visibility: v.literal("public"),
  score: v.number(),
  scoreExplanation: v.array(v.string()),
  rankSignals: v.object({
    matchedTerms: v.number(),
    titleTerms: v.number(),
    phraseMatch: v.boolean(),
    citationCount: v.number(),
    recencyDays: v.number(),
  }),
  updatedAt: v.number(),
  publishedAt: v.union(v.number(), v.null()),
  provenance: v.object({
    recordId: v.string(),
    sourceId: v.optional(v.string()),
    documentId: v.optional(v.string()),
    documentVersionId: v.optional(v.string()),
    claimId: v.optional(v.string()),
    entityId: v.optional(v.string()),
    citationIds: v.array(v.string()),
  }),
});

type UniversalResult = {
  type:
    | "evidence_document"
    | "evidence_claim"
    | "evidence_entity"
    | "blog_post"
    | "newsletter_issue"
    | "news_story"
    | "forum_thread";
  canonicalUrl: string;
  title: string;
  excerpt: string;
  visibility: "public";
  score: number;
  scoreExplanation: string[];
  rankSignals: {
    matchedTerms: number;
    titleTerms: number;
    phraseMatch: boolean;
    citationCount: number;
    recencyDays: number;
  };
  updatedAt: number;
  publishedAt: number | null;
  provenance: {
    recordId: string;
    sourceId?: string;
    documentId?: string;
    documentVersionId?: string;
    claimId?: string;
    entityId?: string;
    citationIds: string[];
  };
};

type Candidate = Omit<
  UniversalResult,
  "score" | "scoreExplanation" | "rankSignals"
> & {
  searchable: string;
  citationCount: number;
};

/**
 * Bounded lexical federation for the public corpus. Semantic/vector retrieval
 * is deliberately deferred until corpus coverage, current visibility joins,
 * and embedding-cost controls are independently proven.
 */
export const searchPublic = internalQuery({
  args: { query: v.string(), limit: v.optional(v.number()) },
  returns: v.array(resultValidator),
  handler: async (ctx, args) => {
    const query = normalizeQuery(args.query);
    const limit = clampLimit(args.limit);
    // Capture the clock once so recency ranking is deterministic within a
    // response. Scores can legitimately differ on a later request.
    const rankingNow = Date.now();
    const candidates: Candidate[] = (await universalSearchProjectionReady(ctx))
      ? (
          await Promise.all(
            (
              await searchUniversalSearchProjections(
                ctx,
                query.normalized,
                Math.min(100, Math.max(SOURCE_CANDIDATE_LIMIT, limit * 4)),
              )
            ).map((row) => validatedProjectedCandidate(ctx, row)),
          )
        ).filter((candidate): candidate is Candidate => candidate !== null)
      : (
          await Promise.all([
            evidenceCandidates(ctx, query),
            entityCandidates(ctx),
            claimCandidates(ctx),
            postCandidates(ctx),
            newsletterCandidates(ctx),
            newsCandidates(ctx),
            forumCandidates(ctx, query),
          ])
        ).flat();

    return candidates
      .map((candidate) => rankCandidate(candidate, query, rankingNow))
      .filter((candidate): candidate is UniversalResult => candidate !== null)
      .sort(compareResults)
      .slice(0, limit);
  },
});

async function validatedProjectedCandidate(
  ctx: QueryCtx,
  row: Doc<"universalSearchProjections">,
): Promise<Candidate | null> {
  if (row.type === "news_story") {
    if (row.newsSnapshotDate === undefined || row.newsStoryId === undefined)
      return null;
    const story = await ctx.db.get("hnStories", row.newsStoryId);
    if (
      story === null ||
      story.snapshotDate !== row.newsSnapshotDate ||
      story.fetchedAt !== row.updatedAt ||
      row.recordKey !== `news_story:${story.hnItemId}`
    )
      return null;
    const snapshot = await ctx.db
      .query("newsSnapshots")
      .withIndex("by_snapshotDate", (q) =>
        q.eq("snapshotDate", row.newsSnapshotDate!),
      )
      .first();
    if (snapshot?.status !== "complete" || snapshot.storyCount === 0)
      return null;
  }
  if (row.type === "evidence_document") {
    const id = ctx.db.normalizeId("evidenceDocuments", row.documentId ?? "");
    const document =
      id === null ? null : await ctx.db.get("evidenceDocuments", id);
    if (document === null) return null;
    const source = await getPublicEvidenceSource(ctx, document);
    if (
      source === null ||
      document.sourceId !== row.sourceId ||
      document.currentVersionId !== (row.documentVersionId ?? null) ||
      document.updatedAt !== row.updatedAt ||
      safeCanonicalUrl(document.canonicalUrl) === null
    )
      return null;
  } else if (row.type === "evidence_claim") {
    const id = ctx.db.normalizeId("evidenceClaims", row.claimId ?? "");
    const claim = id === null ? null : await ctx.db.get("evidenceClaims", id);
    if (claim === null) return null;
    return await claimCandidate(ctx, claim);
  } else if (row.type === "evidence_entity") {
    const id = ctx.db.normalizeId("evidenceEntities", row.entityId ?? "");
    const entity =
      id === null ? null : await ctx.db.get("evidenceEntities", id);
    if (
      entity === null ||
      entity.visibility !== "public" ||
      entity.updatedAt !== row.updatedAt
    )
      return null;
    if (isIndependentPublicEvidenceEntity(entity)) {
      if (!(await isPublicEvidenceEntity(ctx, entity))) return null;
    } else {
      const documentId = ctx.db.normalizeId(
        "evidenceDocuments",
        row.documentId ?? "",
      );
      const versionId = ctx.db.normalizeId(
        "evidenceDocumentVersions",
        row.documentVersionId ?? "",
      );
      if (documentId === null || versionId === null) return null;
      const [document, link] = await Promise.all([
        ctx.db.get("evidenceDocuments", documentId),
        ctx.db
          .query("evidenceDocumentEntities")
          .withIndex("by_documentVersionId_and_entityId", (q) =>
            q.eq("documentVersionId", versionId).eq("entityId", entity._id),
          )
          .unique(),
      ]);
      if (
        link === null ||
        document?.currentVersionId !== versionId ||
        !(await isPublicEvidenceDocument(ctx, document))
      ) {
        return null;
      }
    }
  }
  return projectedCandidate(row);
}

function projectedCandidate(row: Doc<"universalSearchProjections">): Candidate {
  return {
    type: row.type,
    canonicalUrl: row.canonicalUrl,
    title: row.title,
    excerpt: row.excerpt,
    visibility: "public",
    updatedAt: row.updatedAt,
    publishedAt: row.publishedAt ?? null,
    searchable: row.searchText,
    citationCount: row.citationCount,
    provenance: {
      recordId: row.recordKey.slice(row.type.length + 1),
      ...(row.sourceId === undefined ? {} : { sourceId: row.sourceId }),
      ...(row.documentId === undefined ? {} : { documentId: row.documentId }),
      ...(row.documentVersionId === undefined
        ? {}
        : { documentVersionId: row.documentVersionId }),
      ...(row.claimId === undefined ? {} : { claimId: row.claimId }),
      ...(row.entityId === undefined ? {} : { entityId: row.entityId }),
      citationIds: row.citationIds,
    },
  };
}

function normalizeQuery(value: string) {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized || normalized.length > MAX_QUERY_LENGTH) {
    throw new Error(
      `query must be between 1 and ${MAX_QUERY_LENGTH} characters.`,
    );
  }
  const terms = [
    ...new Set(normalized.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []),
  ].slice(0, 12);
  if (terms.length === 0)
    throw new Error("query must include a searchable term.");
  return { normalized, terms };
}

function clampLimit(value: number | undefined) {
  if (value === undefined) return 20;
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_RESULTS) {
    throw new Error(`limit must be an integer between 1 and ${MAX_RESULTS}.`);
  }
  return value;
}

async function evidenceCandidates(
  ctx: QueryCtx,
  query: ReturnType<typeof normalizeQuery>,
): Promise<Candidate[]> {
  const rows = await ctx.db
    .query("evidenceDocuments")
    .withSearchIndex("search_by_searchText", (q) =>
      q.search("searchText", query.normalized).eq("visibility", "public"),
    )
    .take(SOURCE_CANDIDATE_LIMIT);
  return (
    await Promise.all(
      rows.map(async (row): Promise<Candidate | null> => {
        const source = await getPublicEvidenceSource(ctx, row);
        const canonicalUrl = safeCanonicalUrl(row.canonicalUrl);
        // A mutable document is public only while its source is both public
        // and active. Do not return a stale record from a retired/private
        // source even when the document's denormalized visibility is public.
        if (source === null || canonicalUrl === null) return null;
        return {
          type: "evidence_document",
          canonicalUrl,
          title: row.title,
          excerpt: boundedExcerpt(row.excerpt),
          visibility: "public",
          updatedAt: row.updatedAt,
          publishedAt: row.publishedAt,
          searchable: `${row.title} ${row.excerpt} ${row.tags.join(" ")} ${row.authors.join(" ")}`,
          citationCount: 0,
          provenance: {
            recordId: row._id,
            sourceId: row.sourceId,
            documentId: row._id,
            ...(row.currentVersionId === null
              ? {}
              : { documentVersionId: row.currentVersionId }),
            citationIds: [],
          },
        } satisfies Candidate;
      }),
    )
  ).filter((candidate): candidate is Candidate => candidate !== null);
}

async function entityCandidates(ctx: QueryCtx): Promise<Candidate[]> {
  const rows = await ctx.db
    .query("evidenceEntities")
    .withIndex("by_visibility_and_updatedAt", (q) =>
      q.eq("visibility", "public"),
    )
    .order("desc")
    .take(SOURCE_CANDIDATE_LIMIT);
  const publicRows = (
    await Promise.all(
      rows.map(async (row) =>
        (await isPublicEvidenceEntity(ctx, row)) ? row : null,
      ),
    )
  ).filter((row) => row !== null);
  return publicRows.map((row) => ({
    type: "evidence_entity",
    canonicalUrl: `${PRIMARY_ORIGIN}/research`,
    title: row.name,
    excerpt: boundedExcerpt(
      `${row.kind} entity${row.aliases.length ? ` · aliases: ${row.aliases.join(", ")}` : ""}`,
    ),
    visibility: "public",
    updatedAt: row.updatedAt,
    publishedAt: row.createdAt,
    searchable: `${row.entityKey} ${row.name} ${row.aliases.join(" ")}`,
    citationCount: 0,
    provenance: { recordId: row._id, entityId: row._id, citationIds: [] },
  }));
}

async function claimCandidates(ctx: QueryCtx): Promise<Candidate[]> {
  const perStatus = Math.ceil(SOURCE_CANDIDATE_LIMIT / CLAIM_STATUSES.length);
  const rows = (
    await Promise.all(
      CLAIM_STATUSES.map((status) =>
        ctx.db
          .query("evidenceClaims")
          .withIndex("by_visibility_and_status_and_observedAt", (q) =>
            q.eq("visibility", "public").eq("status", status),
          )
          .order("desc")
          .take(perStatus),
      ),
    )
  ).flat();
  return (
    await Promise.all(rows.map((row) => claimCandidate(ctx, row)))
  ).filter((candidate): candidate is Candidate => candidate !== null);
}

async function claimCandidate(
  ctx: QueryCtx,
  row: Doc<"evidenceClaims">,
): Promise<Candidate | null> {
  if (!(await isPublicEvidenceClaim(ctx, row))) return null;
  const citations = await ctx.db
    .query("evidenceClaimCitations")
    .withIndex("by_claimId", (q) => q.eq("claimId", row._id))
    .take(5);
  const publicCitations = [] as Array<
    Doc<"evidenceClaimCitations"> & {
      documentId: Id<"evidenceDocuments">;
      documentVersionId: Id<"evidenceDocumentVersions">;
    }
  >;
  for (const citation of citations) {
    const documentId = await publicEvidenceDocumentIdForVersion(
      ctx,
      citation.documentVersionId,
    );
    if (documentId === null) continue;
    const document = await ctx.db.get("evidenceDocuments", documentId);
    if (document === null) continue;
    const source = await getPublicEvidenceSource(ctx, document);
    if (source === null) continue;
    if (safeCanonicalUrl(document.canonicalUrl) === null) continue;
    publicCitations.push({
      ...citation,
      documentId: document._id,
      documentVersionId: citation.documentVersionId,
    });
  }
  // Claims are only federated when a currently public, active-source citation
  // remains. This fail-closed rule prevents a stale claim from outliving its
  // source's publication controls.
  if (publicCitations.length === 0) return null;
  return {
    type: "evidence_claim",
    canonicalUrl: `${PRIMARY_ORIGIN}/research`,
    title: row.statement,
    excerpt: boundedExcerpt(
      `${row.status} claim · ${row.predicate}: ${row.objectText}`,
    ),
    visibility: "public",
    updatedAt: row.updatedAt,
    publishedAt: row.observedAt,
    searchable: `${row.claimKey} ${row.statement} ${row.predicate} ${row.objectText}`,
    citationCount: publicCitations.length,
    provenance: {
      recordId: row._id,
      claimId: row._id,
      ...(row.subjectEntityId === null
        ? {}
        : { entityId: row.subjectEntityId }),
      ...(publicCitations[0] === undefined
        ? {}
        : {
            documentId: publicCitations[0].documentId,
            documentVersionId: publicCitations[0].documentVersionId,
          }),
      citationIds: publicCitations.map((citation) => citation._id),
    },
  };
}

async function postCandidates(ctx: QueryCtx): Promise<Candidate[]> {
  const rows = await ctx.db
    .query("posts")
    .withIndex("by_status_and_publishedAt", (q) => q.eq("status", "published"))
    .order("desc")
    .take(SOURCE_CANDIDATE_LIMIT);
  return rows.map((row) => ({
    type: "blog_post",
    canonicalUrl: `${PRIMARY_ORIGIN}/blog/${encodeURIComponent(row.slug)}`,
    title: row.title,
    excerpt: boundedExcerpt(row.excerpt),
    visibility: "public",
    updatedAt: row.publishedAt,
    publishedAt: row.publishedAt,
    searchable: `${row.title} ${row.excerpt} ${row.tags.join(" ")}`,
    citationCount: 0,
    provenance: {
      recordId: row._id,
      sourceId: "symbaiex-blog",
      citationIds: [],
    },
  }));
}

async function newsletterCandidates(ctx: QueryCtx): Promise<Candidate[]> {
  const rows = await ctx.db
    .query("newsletterIssues")
    .withIndex("by_status_and_updatedAt", (q) => q.eq("status", "sent"))
    .order("desc")
    .take(SOURCE_CANDIDATE_LIMIT);
  return rows.map((row) => ({
    type: "newsletter_issue",
    canonicalUrl: `${PRIMARY_ORIGIN}/newsletter/${encodeURIComponent(row.slug)}`,
    title: row.subject,
    excerpt: boundedExcerpt(row.previewText),
    visibility: "public",
    updatedAt: row.updatedAt,
    publishedAt: row.sentAt ?? row.createdAt,
    searchable: `${row.subject} ${row.previewText}`,
    citationCount: 0,
    provenance: {
      recordId: row._id,
      sourceId: "symbaiex-newsletter",
      citationIds: [],
    },
  }));
}

async function newsCandidates(ctx: QueryCtx): Promise<Candidate[]> {
  const snapshots = (
    await ctx.db
      .query("newsSnapshots")
      .withIndex("by_snapshotDate")
      .order("desc")
      .take(8)
  )
    .filter((snapshot) => snapshot.status === "complete")
    .slice(0, 4);
  const stories = (
    await Promise.all(
      snapshots.map((snapshot) =>
        ctx.db
          .query("hnStories")
          .withIndex("by_snapshotDate_and_rank", (q) =>
            q.eq("snapshotDate", snapshot.snapshotDate),
          )
          .order("asc")
          .take(20),
      ),
    )
  ).flat();
  const latest = new Map<number, Doc<"hnStories">>();
  for (const story of stories) {
    const existing = latest.get(story.hnItemId);
    if (existing === undefined || story.fetchedAt > existing.fetchedAt)
      latest.set(story.hnItemId, story);
  }
  return [...latest.values()].map((row) => ({
    type: "news_story",
    canonicalUrl: `${PRIMARY_ORIGIN}/news/${row.hnItemId}`,
    title: row.title,
    excerpt: boundedExcerpt(
      [row.host, row.text].filter(Boolean).join(" · ") ||
        "SYMBaiEX news index item.",
    ),
    visibility: "public",
    updatedAt: row.fetchedAt,
    publishedAt: row.timePosted === undefined ? null : row.timePosted * 1_000,
    searchable: `${row.title} ${row.host ?? ""} ${row.text ?? ""}`,
    citationCount: 0,
    provenance: {
      recordId: String(row.hnItemId),
      sourceId: "hacker-news",
      citationIds: [],
    },
  }));
}

async function forumCandidates(
  ctx: QueryCtx,
  query: ReturnType<typeof normalizeQuery>,
): Promise<Candidate[]> {
  const projectionState = await ctx.db
    .query("forumAgentMaintenanceState")
    .withIndex("by_key", (q) =>
      q.eq("key", FORUM_SEARCH_PROJECTION_BACKFILL_KEY),
    )
    .unique();
  if ((projectionState?.completedAt ?? 0) <= 0) {
    return legacyForumCandidates(ctx, query);
  }
  const [active, locked] = await Promise.all([
    ctx.db
      .query("forumThreadSearchProjections")
      .withSearchIndex("search_by_searchText", (q) =>
        q.search("searchText", query.normalized).eq("status", "active"),
      )
      .take(SOURCE_CANDIDATE_LIMIT),
    ctx.db
      .query("forumThreadSearchProjections")
      .withSearchIndex("search_by_searchText", (q) =>
        q.search("searchText", query.normalized).eq("status", "locked"),
      )
      .take(SOURCE_CANDIDATE_LIMIT),
  ]);
  const threads = [...active, ...locked];
  const categories = await loadForumCategoryTree(
    ctx,
    threads.map((thread) => thread.categoryId),
  );
  const visibleThreads = threads
    .map((thread) => ({
      thread,
      category: publicBoardCategory(thread.categoryId, categories),
    }))
    .filter(
      (
        candidate,
      ): candidate is {
        thread: Doc<"forumThreadSearchProjections">;
        category: Doc<"forumCategories">;
      } => candidate.category !== null,
    );
  return visibleThreads.map(({ thread, category }) => {
    return {
      type: "forum_thread",
      canonicalUrl: `${FORUM_ORIGIN}/${encodeURIComponent(category.slug)}/${encodeURIComponent(thread.slug)}`,
      title: thread.title,
      excerpt: boundedExcerpt(
        thread.excerpt ||
          `Forum thread in ${category.slug} · ${thread.replyCount} replies · ${thread.viewCount} views`,
      ),
      visibility: "public",
      updatedAt: thread.updatedAt,
      publishedAt: thread.createdAt,
      searchable: `${thread.title} ${thread.searchText}`,
      citationCount: 0,
      provenance: {
        recordId: thread.threadId,
        sourceId: "symbaiex-forum",
        citationIds: [],
      },
    } satisfies Candidate;
  });
}

async function legacyForumCandidates(
  ctx: QueryCtx,
  query: ReturnType<typeof normalizeQuery>,
): Promise<Candidate[]> {
  const [active, locked] = await Promise.all([
    ctx.db
      .query("forumThreads")
      .withSearchIndex("search_by_searchText", (q) =>
        q.search("searchText", query.normalized).eq("status", "active"),
      )
      .take(SOURCE_CANDIDATE_LIMIT),
    ctx.db
      .query("forumThreads")
      .withSearchIndex("search_by_searchText", (q) =>
        q.search("searchText", query.normalized).eq("status", "locked"),
      )
      .take(SOURCE_CANDIDATE_LIMIT),
  ]);
  const threads = [...active, ...locked];
  const categories = await loadForumCategoryTree(
    ctx,
    threads.map((thread) => thread.categoryId),
  );
  return threads
    .map((thread) => ({
      thread,
      category: publicBoardCategory(thread.categoryId, categories),
    }))
    .filter(
      (
        candidate,
      ): candidate is {
        thread: Doc<"forumThreads">;
        category: Doc<"forumCategories">;
      } => candidate.category !== null,
    )
    .map(
      ({ thread, category }) =>
        ({
          type: "forum_thread",
          canonicalUrl: `${FORUM_ORIGIN}/${encodeURIComponent(category.slug)}/${encodeURIComponent(thread.slug)}`,
          title: thread.title,
          excerpt: boundedExcerpt(
            `Forum thread in ${category.slug} · ${thread.replyCount} replies · ${thread.viewCount} views`,
          ),
          visibility: "public",
          updatedAt: thread.updatedAt,
          publishedAt: thread.createdAt,
          searchable: `${thread.title} ${thread.searchText}`,
          citationCount: 0,
          provenance: {
            recordId: thread._id,
            sourceId: "symbaiex-forum",
            citationIds: [],
          },
        }) satisfies Candidate,
    );
}

/**
 * Load only the candidate boards and their public ancestors. A fixed first-200
 * scan both wasted reads on unrelated categories and silently hid boards past
 * that position; candidate search is already bounded to at most 100 threads.
 */
async function loadForumCategoryTree(
  ctx: QueryCtx,
  categoryIds: Id<"forumCategories">[],
) {
  const categories = new Map<
    Id<"forumCategories">,
    Doc<"forumCategories"> | null
  >();
  let frontier = [...new Set(categoryIds)];
  for (
    let depth = 0;
    frontier.length > 0 && depth <= MAX_FORUM_CATEGORY_ANCESTORS;
    depth += 1
  ) {
    const missing = frontier.filter(
      (categoryId) => !categories.has(categoryId),
    );
    const rows = await Promise.all(
      missing.map(async (categoryId) => ({
        categoryId,
        category: await ctx.db.get("forumCategories", categoryId),
      })),
    );
    const next = new Set<Id<"forumCategories">>();
    for (const { categoryId, category } of rows) {
      categories.set(categoryId, category);
      if (
        category === null ||
        category.status !== "active" ||
        (category.viewAccess ?? "public") !== "public" ||
        (depth === 0 && (category.kind ?? "board") !== "board") ||
        depth === MAX_FORUM_CATEGORY_ANCESTORS
      ) {
        continue;
      }
      if (category.parentCategoryId !== undefined)
        next.add(category.parentCategoryId);
    }
    frontier = [...next];
  }
  return categories;
}

function publicBoardCategory(
  categoryId: Id<"forumCategories">,
  categories: Map<Id<"forumCategories">, Doc<"forumCategories"> | null>,
): Doc<"forumCategories"> | null {
  const requested = categories.get(categoryId);
  // A thread can be hosted only by a board. Its ancestors may be public
  // sections or boards; each is checked independently below.
  if (requested == null || (requested.kind ?? "board") !== "board") return null;
  const visited = new Set<Id<"forumCategories">>();
  let current: Doc<"forumCategories"> | null | undefined = requested;
  while (current != null) {
    if (
      current.status !== "active" ||
      (current.viewAccess ?? "public") !== "public" ||
      visited.has(current._id)
    )
      return null;
    visited.add(current._id);
    if (current.parentCategoryId === undefined) return requested;
    current = categories.get(current.parentCategoryId);
  }
  return null;
}

/**
 * Canonical result URLs are presentation data, not fetch targets. We still
 * constrain them to HTTPS public origins so clients never receive credentials,
 * loopback, link-local, or private-network URLs from the evidence corpus.
 */
function safeCanonicalUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    const host = url.hostname
      .toLowerCase()
      .replace(/^\[|\]$/g, "")
      .replace(/\.$/, "");
    if (
      !host ||
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host.endsWith(".local")
    )
      return null;
    if (isPrivateAddress(host)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function isPrivateAddress(host: string) {
  if (
    host === "::1" ||
    host.startsWith("fe80:") ||
    host.startsWith("fc") ||
    host.startsWith("fd")
  )
    return true;
  if (host.startsWith("::ffff:")) return isPrivateAddress(host.slice(7));
  const parts = host.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part)))
    return false;
  const values = parts.map(Number);
  if (values.some((part) => part < 0 || part > 255)) return true;
  return (
    values[0] === 0 ||
    values[0] === 10 ||
    values[0] === 127 ||
    (values[0] === 169 && values[1] === 254) ||
    (values[0] === 172 && values[1] >= 16 && values[1] <= 31) ||
    (values[0] === 192 && values[1] === 168)
  );
}

function rankCandidate(
  candidate: Candidate,
  query: ReturnType<typeof normalizeQuery>,
  now: number,
): UniversalResult | null {
  const title = candidate.title.toLowerCase();
  const searchable = candidate.searchable.toLowerCase();
  const matchedTerms = query.terms.filter((term) =>
    searchable.includes(term),
  ).length;
  if (matchedTerms === 0) return null;
  const titleTerms = query.terms.filter((term) => title.includes(term)).length;
  const phraseMatch = searchable.includes(query.normalized.toLowerCase());
  const recencyDays = Math.max(
    0,
    Math.floor((now - candidate.updatedAt) / 86_400_000),
  );
  const recencyBonus = Math.max(0, 10 - Math.floor(recencyDays / 30));
  const score =
    matchedTerms * 20 +
    titleTerms * 25 +
    (phraseMatch ? 30 : 0) +
    Math.min(candidate.citationCount, 5) * 4 +
    recencyBonus;
  const {
    searchable: _searchable,
    citationCount: _citationCount,
    ...result
  } = candidate;
  return {
    ...result,
    score,
    scoreExplanation: [
      `${matchedTerms}/${query.terms.length} normalized query term(s) matched`,
      titleTerms
        ? `${titleTerms} term(s) matched in the title`
        : "no title-term match",
      phraseMatch
        ? "exact normalized phrase matched"
        : "no exact normalized phrase match",
      candidate.citationCount
        ? `${candidate.citationCount} public citation(s) available`
        : "no citation boost",
      `recency signal: ${recencyDays} day(s) since update`,
    ],
    rankSignals: {
      matchedTerms,
      titleTerms,
      phraseMatch,
      citationCount: candidate.citationCount,
      recencyDays,
    },
  };
}

function compareResults(left: UniversalResult, right: UniversalResult) {
  return (
    right.score - left.score ||
    right.updatedAt - left.updatedAt ||
    left.type.localeCompare(right.type) ||
    left.canonicalUrl.localeCompare(right.canonicalUrl) ||
    left.provenance.recordId.localeCompare(right.provenance.recordId)
  );
}

function boundedExcerpt(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= 320
    ? normalized
    : `${normalized.slice(0, 317)}...`;
}
