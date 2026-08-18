import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalQuery, type QueryCtx } from "./_generated/server";

const PRIMARY_ORIGIN = "https://www.symbaiex.com";
const FORUM_ORIGIN = "https://forum.symbaiex.com";
const SOURCE_CANDIDATE_LIMIT = 50;
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
    const now = Date.now();
    const candidates = (
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
      .map((candidate) => rankCandidate(candidate, query, now))
      .filter((candidate): candidate is UniversalResult => candidate !== null)
      .sort(compareResults)
      .slice(0, limit);
  },
});

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
  return rows.map((row) => ({
    type: "evidence_document",
    canonicalUrl: row.canonicalUrl,
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
  }));
}

async function entityCandidates(ctx: QueryCtx): Promise<Candidate[]> {
  const rows = await ctx.db
    .query("evidenceEntities")
    .withIndex("by_visibility_and_updatedAt", (q) =>
      q.eq("visibility", "public"),
    )
    .order("desc")
    .take(SOURCE_CANDIDATE_LIMIT);
  return rows.map((row) => ({
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
  return await Promise.all(rows.map((row) => claimCandidate(ctx, row)));
}

async function claimCandidate(
  ctx: QueryCtx,
  row: Doc<"evidenceClaims">,
): Promise<Candidate> {
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
    const version = await ctx.db.get(
      "evidenceDocumentVersions",
      citation.documentVersionId,
    );
    if (version === null) continue;
    const document = await ctx.db.get("evidenceDocuments", version.documentId);
    if (document?.visibility !== "public") continue;
    publicCitations.push({
      ...citation,
      documentId: document._id,
      documentVersionId: version._id,
    });
  }
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
  const categoryRows = await ctx.db
    .query("forumCategories")
    .withIndex("by_status_and_position", (q) => q.eq("status", "active"))
    .take(200);
  const categories = new Map(
    categoryRows.map((category) => [category._id, category]),
  );
  const visibleThreads = [...active, ...locked].filter((thread) =>
    categoryIsPublic(thread.categoryId, categories),
  );
  return await Promise.all(
    visibleThreads.map(async (thread) => {
      // The search index finds candidates. The compact digest supplies the
      // public display record; live thread/category checks remain authoritative
      // when a projection is stale or has not been backfilled yet.
      const digest = await ctx.db
        .query("forumThreadEditorialDigests")
        .withIndex("by_threadId", (q) => q.eq("threadId", thread._id))
        .unique();
      const summary =
        digest !== null &&
        digest.status === thread.status &&
        digest.categoryId === thread.categoryId
          ? digest
          : thread;
      return {
        type: "forum_thread",
        canonicalUrl: `${FORUM_ORIGIN}/${encodeURIComponent(thread.categorySlug)}/${encodeURIComponent(thread.slug)}`,
        title: summary.title,
        excerpt: boundedExcerpt(
          `Forum thread in ${summary.categorySlug} · ${summary.replyCount} replies · ${summary.viewCount} views`,
        ),
        visibility: "public",
        updatedAt: summary.updatedAt,
        publishedAt: summary.createdAt,
        searchable: `${thread.title} ${thread.searchText}`,
        citationCount: 0,
        provenance: {
          recordId: thread._id,
          sourceId: "symbaiex-forum",
          citationIds: [],
        },
      } satisfies Candidate;
    }),
  );
}

function categoryIsPublic(
  categoryId: Id<"forumCategories">,
  categories: Map<Id<"forumCategories">, Doc<"forumCategories">>,
) {
  const visited = new Set<Id<"forumCategories">>();
  let current = categories.get(categoryId);
  while (current !== undefined) {
    if (
      current.status !== "active" ||
      (current.viewAccess ?? "public") !== "public" ||
      visited.has(current._id)
    )
      return false;
    visited.add(current._id);
    if (current.parentCategoryId === undefined)
      return (current.kind ?? "board") === "board";
    current = categories.get(current.parentCategoryId);
  }
  return false;
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
