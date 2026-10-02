import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import {
  getPublicEvidenceSourceWithKnownSource,
  isIndependentPublicEvidenceEntity,
  isPublicEvidenceClaim,
  isPublicEvidenceDocument,
  publicEvidenceDocumentIdForVersion,
  publicEvidenceEntityReference,
  type PublicEvidenceDocumentRef,
} from "./evidenceVisibility";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";

export const UNIVERSAL_SEARCH_PROJECTION_MIGRATION_KEY =
  "universal-search-projections-v1";

const PRIMARY_ORIGIN = "https://www.symbaiex.com";
const FORUM_ORIGIN = "https://forum.symbaiex.com";
const DEFAULT_BACKFILL_PAGE_SIZE = 25;
const MAX_BACKFILL_PAGE_SIZE = 50;
// paginate includes the row that crosses its byte limit. Reserve headroom for
// one maximum-size (1 MiB) row plus projection lookups/writes in this transaction.
const BACKFILL_MAX_BYTES_READ = 512 * 1024;
const FORUM_BACKFILL_KEY = "forum-search-projections-v1";
const forumBackfillRef = makeFunctionReference<
  "mutation",
  Record<string, never>
>("forumSearchProjection:backfill");
const SEARCH_TEXT_LIMIT = 4_096;
const TITLE_LIMIT = 500;
const EXCERPT_LIMIT = 320;
const MAX_FORUM_CATEGORY_DEPTH = 16;

type EvidenceDocumentProjectionInput = PublicEvidenceDocumentRef &
  Pick<
    Doc<"evidenceDocuments">,
    | "canonicalUrl"
    | "title"
    | "excerpt"
    | "searchText"
    | "tags"
    | "authors"
    | "updatedAt"
    | "publishedAt"
    | "currentVersionId"
  >;

const projectionTypeValidator = v.union(
  v.literal("evidence_document"),
  v.literal("evidence_claim"),
  v.literal("evidence_entity"),
  v.literal("blog_post"),
  v.literal("newsletter_issue"),
  v.literal("news_story"),
  v.literal("forum_thread"),
);

type ProjectionType = typeof projectionTypeValidator.type;
type ProjectionValues = Omit<
  Doc<"universalSearchProjections">,
  "_id" | "_creationTime"
>;
type BackfillPhase =
  | "evidenceDocuments"
  | "evidenceEntities"
  | "evidenceClaims"
  | "posts"
  | "newsletterIssues"
  | "hnStories"
  | "forumThreads";

const backfillPhaseValidator = v.union(
  v.literal("evidenceDocuments"),
  v.literal("evidenceEntities"),
  v.literal("evidenceClaims"),
  v.literal("posts"),
  v.literal("newsletterIssues"),
  v.literal("hnStories"),
  v.literal("forumThreads"),
);

const BACKFILL_PHASES: readonly BackfillPhase[] = [
  "evidenceDocuments",
  "evidenceEntities",
  "evidenceClaims",
  "posts",
  "newsletterIssues",
  "hnStories",
  "forumThreads",
];

type BackfillCursor = {
  phase: BackfillPhase;
  cursor: string | null;
};

const backfillRef = makeFunctionReference<
  "mutation",
  { limit?: number },
  {
    phase: BackfillPhase;
    processed: number;
    totalProcessed: number;
    done: boolean;
  }
>("universalSearchProjection:backfill");

/**
 * Invalidates projection reads and starts a complete, resumable visibility
 * rebuild. Call this in the same mutation that changes an ancestor/category or
 * evidence-source publication policy. Duplicate callers and continuations are
 * safe because backfill always advances the cursor persisted here instead of a
 * cursor supplied by the scheduled job.
 */
export async function requestUniversalSearchProjectionRebuild(
  ctx: MutationCtx,
) {
  const state = await ctx.db
    .query("optimizationMigrations")
    .withIndex("by_key", (q) =>
      q.eq("key", UNIVERSAL_SEARCH_PROJECTION_MIGRATION_KEY),
    )
    .unique();
  const now = Date.now();
  const values = {
    key: UNIVERSAL_SEARCH_PROJECTION_MIGRATION_KEY,
    status: "running" as const,
    processed: 0,
    cursor: JSON.stringify(initialBackfillCursor()),
    scheduledAt: now,
    updatedAt: now,
  };
  if (state === null) {
    await ctx.db.insert("optimizationMigrations", values);
  } else {
    await ctx.db.patch("optimizationMigrations", state._id, {
      ...values,
      completedAt: undefined,
    });
  }
  await ctx.scheduler.runAfter(0, backfillRef, {});
}

export async function universalSearchProjectionReady(ctx: QueryCtx) {
  const state = await ctx.db
    .query("optimizationMigrations")
    .withIndex("by_key", (q) =>
      q.eq("key", UNIVERSAL_SEARCH_PROJECTION_MIGRATION_KEY),
    )
    .unique();
  return state?.status === "completed" && (await forumProjectionReady(ctx));
}

async function forumProjectionReady(ctx: QueryCtx) {
  const state = await ctx.db
    .query("forumAgentMaintenanceState")
    .withIndex("by_key", (q) => q.eq("key", FORUM_BACKFILL_KEY))
    .unique();
  return (state?.completedAt ?? 0) > 0;
}

/** Dependency completion wakes a paused migration, without a polling loop. */
export async function resumeUniversalSearchAfterForumBackfill(
  ctx: MutationCtx,
) {
  const state = await ctx.db
    .query("optimizationMigrations")
    .withIndex("by_key", (q) =>
      q.eq("key", UNIVERSAL_SEARCH_PROJECTION_MIGRATION_KEY),
    )
    .unique();
  if (
    state?.status === "running" &&
    state.scheduledAt === undefined &&
    parseBackfillCursor(state.cursor).phase === "forumThreads"
  ) {
    await ctx.db.patch("optimizationMigrations", state._id, {
      scheduledAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, backfillRef, {});
  }
}

export async function searchUniversalSearchProjections(
  ctx: QueryCtx,
  query: string,
  limit: number,
) {
  return await ctx.db
    .query("universalSearchProjections")
    .withSearchIndex("search_by_searchText", (q) =>
      q.search("searchText", query),
    )
    .take(Math.max(1, Math.min(limit, 100)));
}

export async function deleteUniversalSearchProjection(
  ctx: MutationCtx,
  type: ProjectionType,
  recordId: string,
) {
  const existing = await projectionByRecordKey(ctx, recordKey(type, recordId));
  if (existing !== null) {
    await ctx.db.delete("universalSearchProjections", existing._id);
  }
}

export async function syncEvidenceDocumentUniversalSearchProjection(
  ctx: MutationCtx,
  document: EvidenceDocumentProjectionInput,
  options: { knownSource?: Doc<"evidenceSources"> | null } = {},
) {
  const type = "evidence_document" as const;
  const canonicalUrl = safeCanonicalUrl(document.canonicalUrl);
  if (document.visibility !== "public" || canonicalUrl === null) {
    await deleteUniversalSearchProjection(ctx, type, document._id);
    return;
  }
  const sourceRow =
    options.knownSource === undefined
      ? await ctx.db.get("evidenceSources", document.sourceId)
      : options.knownSource;
  const source = await getPublicEvidenceSourceWithKnownSource(
    ctx,
    document,
    sourceRow,
    {
      ignorePendingSync: true,
    },
  );
  if (source === null) {
    await deleteUniversalSearchProjection(ctx, type, document._id);
    return;
  }
  await upsertProjection(ctx, {
    recordKey: recordKey(type, document._id),
    type,
    canonicalUrl,
    title: normalized(document.title, TITLE_LIMIT),
    excerpt: normalized(document.excerpt, EXCERPT_LIMIT),
    searchText: normalized(
      `${document.title} ${document.excerpt} ${document.searchText} ${document.tags.join(" ")} ${document.authors.join(" ")}`,
      SEARCH_TEXT_LIMIT,
    ),
    updatedAt: document.updatedAt,
    publishedAt: document.publishedAt ?? undefined,
    citationCount: 0,
    sourceId: String(document.sourceId),
    documentId: String(document._id),
    documentVersionId:
      document.currentVersionId === null
        ? undefined
        : String(document.currentVersionId),
    citationIds: [],
  });
}

export async function syncEvidenceEntityUniversalSearchProjection(
  ctx: MutationCtx,
  entity: Doc<"evidenceEntities">,
) {
  const type = "evidence_entity" as const;
  const entityRecordKey = recordKey(type, entity._id);
  const existing = await projectionByRecordKey(ctx, entityRecordKey);
  if (entity.visibility !== "public") {
    if (existing !== null) {
      await ctx.db.delete("universalSearchProjections", existing._id);
    }
    return;
  }
  const independent = isIndependentPublicEvidenceEntity(entity);
  const reference = independent
    ? null
    : ((await currentPublicEvidenceEntityReference(ctx, entity, existing)) ??
      (await publicEvidenceEntityReference(ctx, entity, {
        ignorePendingSync: true,
      })));
  if (!independent && reference === null) {
    if (existing !== null) {
      await ctx.db.delete("universalSearchProjections", existing._id);
    }
    return;
  }
  await upsertProjection(
    ctx,
    {
      recordKey: entityRecordKey,
      type,
      canonicalUrl: `${PRIMARY_ORIGIN}/research`,
      title: normalized(entity.name, TITLE_LIMIT),
      excerpt: normalized(
        `${entity.kind} entity${entity.aliases.length > 0 ? ` · aliases: ${entity.aliases.join(", ")}` : ""}`,
        EXCERPT_LIMIT,
      ),
      searchText: normalized(
        `${entity.entityKey} ${entity.name} ${entity.aliases.join(" ")}`,
        SEARCH_TEXT_LIMIT,
      ),
      updatedAt: entity.updatedAt,
      publishedAt: entity.createdAt,
      citationCount: 0,
      documentId:
        reference === null ? undefined : String(reference.document._id),
      documentVersionId:
        reference === null ? undefined : String(reference.versionId),
      entityId: String(entity._id),
      citationIds: [],
    },
    existing,
  );
}

/**
 * Reuse a still-current public citation already stored on the compact search
 * projection. Entity metadata changes are common, while discovering a valid
 * reference by walking up to 50 historical links can be expensive. If that
 * cached reference is stale or revoked, the caller falls back to the complete
 * bounded visibility scan so another public document can still keep the entity
 * discoverable.
 */
async function currentPublicEvidenceEntityReference(
  ctx: MutationCtx,
  entity: Doc<"evidenceEntities">,
  projection: Doc<"universalSearchProjections"> | null,
) {
  if (projection?.entityId !== String(entity._id)) return null;
  const documentId = ctx.db.normalizeId(
    "evidenceDocuments",
    projection.documentId ?? "",
  );
  const versionId = ctx.db.normalizeId(
    "evidenceDocumentVersions",
    projection.documentVersionId ?? "",
  );
  if (documentId === null || versionId === null) return null;
  const [document, versionDocumentId, link] = await Promise.all([
    ctx.db.get("evidenceDocuments", documentId),
    publicEvidenceDocumentIdForVersion(ctx, versionId),
    ctx.db
      .query("evidenceDocumentEntities")
      .withIndex("by_documentVersionId_and_entityId", (q) =>
        q.eq("documentVersionId", versionId).eq("entityId", entity._id),
      )
      .unique(),
  ]);
  if (
    document === null ||
    versionDocumentId !== document._id ||
    link === null ||
    document.currentVersionId !== versionId ||
    !(await isPublicEvidenceDocument(ctx, document, {
      ignorePendingSync: true,
    }))
  ) {
    return null;
  }
  return { document, versionId };
}

export async function syncEvidenceClaimUniversalSearchProjection(
  ctx: MutationCtx,
  claim: Doc<"evidenceClaims">,
) {
  const type = "evidence_claim" as const;
  if (!(await isPublicEvidenceClaim(ctx, claim, { ignorePendingSync: true }))) {
    await deleteUniversalSearchProjection(ctx, type, claim._id);
    return;
  }
  const citations = await ctx.db
    .query("evidenceClaimCitations")
    .withIndex("by_claimId", (q) => q.eq("claimId", claim._id))
    .take(5);
  const publicCitations: Array<{
    citationId: Id<"evidenceClaimCitations">;
    documentId: Id<"evidenceDocuments">;
    documentVersionId: Id<"evidenceDocumentVersions">;
  }> = [];
  for (const citation of citations) {
    const documentId = await publicEvidenceDocumentIdForVersion(
      ctx,
      citation.documentVersionId,
    );
    if (documentId === null) continue;
    const document = await ctx.db.get("evidenceDocuments", documentId);
    if (document === null || safeCanonicalUrl(document.canonicalUrl) === null) {
      continue;
    }
    const sourceRow = await ctx.db.get("evidenceSources", document.sourceId);
    if (
      (await getPublicEvidenceSourceWithKnownSource(ctx, document, sourceRow, {
        ignorePendingSync: true,
      })) === null
    )
      continue;
    publicCitations.push({
      citationId: citation._id,
      documentId: document._id,
      documentVersionId: citation.documentVersionId,
    });
  }
  const firstCitation = publicCitations[0];
  if (firstCitation === undefined) {
    await deleteUniversalSearchProjection(ctx, type, claim._id);
    return;
  }
  await upsertProjection(ctx, {
    recordKey: recordKey(type, claim._id),
    type,
    canonicalUrl: `${PRIMARY_ORIGIN}/research`,
    title: normalized(claim.statement, TITLE_LIMIT),
    excerpt: normalized(
      `${claim.status} claim · ${claim.predicate}: ${claim.objectText}`,
      EXCERPT_LIMIT,
    ),
    searchText: normalized(
      `${claim.claimKey} ${claim.statement} ${claim.predicate} ${claim.objectText}`,
      SEARCH_TEXT_LIMIT,
    ),
    updatedAt: claim.updatedAt,
    publishedAt: claim.observedAt,
    citationCount: publicCitations.length,
    documentId: String(firstCitation.documentId),
    documentVersionId: String(firstCitation.documentVersionId),
    claimId: String(claim._id),
    entityId:
      claim.subjectEntityId === null
        ? undefined
        : String(claim.subjectEntityId),
    citationIds: publicCitations.map(({ citationId }) => String(citationId)),
  });
}

export async function syncPostUniversalSearchProjection(
  ctx: MutationCtx,
  post: Doc<"posts">,
) {
  const type = "blog_post" as const;
  if (post.status !== "published") {
    await deleteUniversalSearchProjection(ctx, type, post._id);
    return;
  }
  await upsertProjection(ctx, {
    recordKey: recordKey(type, post._id),
    type,
    canonicalUrl: `${PRIMARY_ORIGIN}/blog/${encodeURIComponent(post.slug)}`,
    title: normalized(post.title, TITLE_LIMIT),
    excerpt: normalized(post.excerpt, EXCERPT_LIMIT),
    searchText: normalized(
      `${post.title} ${post.excerpt} ${post.tags.join(" ")}`,
      SEARCH_TEXT_LIMIT,
    ),
    updatedAt: post.publishedAt,
    publishedAt: post.publishedAt,
    citationCount: 0,
    sourceId: "symbaiex-blog",
    citationIds: [],
  });
}

export async function syncNewsletterIssueUniversalSearchProjection(
  ctx: MutationCtx,
  issue: Doc<"newsletterIssues">,
) {
  const type = "newsletter_issue" as const;
  if (issue.status !== "sent") {
    await deleteUniversalSearchProjection(ctx, type, issue._id);
    return;
  }
  await upsertProjection(ctx, {
    recordKey: recordKey(type, issue._id),
    type,
    canonicalUrl: `${PRIMARY_ORIGIN}/newsletter/${encodeURIComponent(issue.slug)}`,
    title: normalized(issue.subject, TITLE_LIMIT),
    excerpt: normalized(issue.previewText, EXCERPT_LIMIT),
    searchText: normalized(
      `${issue.subject} ${issue.previewText}`,
      SEARCH_TEXT_LIMIT,
    ),
    updatedAt: issue.updatedAt,
    publishedAt: issue.sentAt ?? issue.createdAt,
    citationCount: 0,
    sourceId: "symbaiex-newsletter",
    citationIds: [],
  });
}

type NewsStoryProjectionSource = Pick<
  Doc<"hnStories">,
  | "_id"
  | "hnItemId"
  | "snapshotDate"
  | "fetchedAt"
  | "title"
  | "host"
  | "text"
  | "timePosted"
>;

export async function syncNewsStoryUniversalSearchProjection(
  ctx: MutationCtx,
  story: NewsStoryProjectionSource,
  options?: { snapshotIsComplete?: true },
) {
  const type = "news_story" as const;
  const recordId = String(story.hnItemId);
  const key = recordKey(type, recordId);
  let snapshotIsComplete = options?.snapshotIsComplete === true;
  if (!snapshotIsComplete) {
    const snapshot = await ctx.db
      .query("newsSnapshots")
      .withIndex("by_snapshotDate", (q) =>
        q.eq("snapshotDate", story.snapshotDate),
      )
      .first();
    snapshotIsComplete =
      snapshot?.status === "complete" && snapshot.storyCount > 0;
  }
  if (!snapshotIsComplete) {
    const stale = await projectionByRecordKey(ctx, key);
    if (
      stale !== null &&
      (stale.newsSnapshotDate === undefined ||
        stale.newsSnapshotDate === story.snapshotDate)
    ) {
      await deleteUniversalSearchProjection(ctx, type, recordId);
      await ctx.scheduler.runAfter(
        0,
        makeFunctionReference<"mutation", { hnItemId: number }, null>(
          "news:reconcileStoryProjection",
        ),
        { hnItemId: story.hnItemId },
      );
    }
    return;
  }
  const existing = await projectionByRecordKey(ctx, key);
  if (
    existing !== null &&
    existing.updatedAt > story.fetchedAt &&
    existing.newsSnapshotDate
  ) {
    const previousSnapshot = await ctx.db
      .query("newsSnapshots")
      .withIndex("by_snapshotDate", (q) =>
        q.eq("snapshotDate", existing.newsSnapshotDate!),
      )
      .first();
    if (
      previousSnapshot?.status === "complete" &&
      previousSnapshot.storyCount > 0
    )
      return;
  }
  await upsertProjection(ctx, {
    recordKey: key,
    newsSnapshotDate: story.snapshotDate,
    newsStoryId: story._id,
    type,
    canonicalUrl: `${PRIMARY_ORIGIN}/news/${recordId}`,
    title: normalized(story.title, TITLE_LIMIT),
    excerpt: normalized(
      [story.host, story.text].filter(Boolean).join(" · ") ||
        "SYMBaiEX news index item.",
      EXCERPT_LIMIT,
    ),
    searchText: normalized(
      `${story.title} ${story.host ?? ""} ${story.text ?? ""}`,
      SEARCH_TEXT_LIMIT,
    ),
    updatedAt: story.fetchedAt,
    publishedAt:
      story.timePosted === undefined ? undefined : story.timePosted * 1_000,
    citationCount: 0,
    sourceId: "hacker-news",
    citationIds: [],
  });
}

export async function syncForumThreadUniversalSearchProjection(
  ctx: MutationCtx,
  thread: Doc<"forumThreadSearchProjections">,
) {
  const type = "forum_thread" as const;
  const category = await publicForumBoard(ctx, thread.categoryId);
  if (
    category === null ||
    (thread.status !== "active" && thread.status !== "locked")
  ) {
    await deleteUniversalSearchProjection(ctx, type, thread.threadId);
    return;
  }
  await upsertProjection(ctx, {
    recordKey: recordKey(type, thread.threadId),
    type,
    canonicalUrl: `${FORUM_ORIGIN}/${encodeURIComponent(category.slug)}/${encodeURIComponent(thread.slug)}`,
    title: normalized(thread.title, TITLE_LIMIT),
    excerpt: normalized(
      thread.excerpt ||
        `Forum thread in ${category.slug} · ${thread.replyCount} replies · ${thread.viewCount} views`,
      EXCERPT_LIMIT,
    ),
    searchText: normalized(
      `${thread.title} ${thread.searchText}`,
      SEARCH_TEXT_LIMIT,
    ),
    updatedAt: thread.updatedAt,
    publishedAt: thread.createdAt,
    citationCount: 0,
    sourceId: "symbaiex-forum",
    citationIds: [],
  });
}

/**
 * Operator-started, resumable migration. Source writers must be wired to the
 * sync/delete helpers before this marker is allowed to complete in production;
 * search keeps using the live legacy path until then.
 */
export const backfill = internalMutation({
  args: { limit: v.optional(v.number()) },
  returns: v.object({
    phase: backfillPhaseValidator,
    processed: v.number(),
    totalProcessed: v.number(),
    done: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const state = await ctx.db
      .query("optimizationMigrations")
      .withIndex("by_key", (q) =>
        q.eq("key", UNIVERSAL_SEARCH_PROJECTION_MIGRATION_KEY),
      )
      .unique();
    const forumReady = await forumProjectionReady(ctx);
    if (state?.status === "completed" && forumReady) {
      return {
        phase: BACKFILL_PHASES[BACKFILL_PHASES.length - 1]!,
        processed: 0,
        totalProcessed: state.processed,
        done: true,
      };
    }
    const limit = Math.max(
      1,
      Math.min(
        Math.floor(args.limit ?? DEFAULT_BACKFILL_PAGE_SIZE),
        MAX_BACKFILL_PAGE_SIZE,
      ),
    );
    const cursor: BackfillCursor =
      state?.status === "completed"
        ? { phase: "forumThreads", cursor: null }
        : parseBackfillCursor(state?.cursor);
    if (cursor.phase === "forumThreads" && !forumReady) {
      const values = {
        key: UNIVERSAL_SEARCH_PROJECTION_MIGRATION_KEY,
        status: "running" as const,
        processed: state?.processed ?? 0,
        cursor: JSON.stringify({ phase: "forumThreads", cursor: null }),
        scheduledAt: undefined,
        completedAt: undefined,
        updatedAt: Date.now(),
      };
      if (state === null) await ctx.db.insert("optimizationMigrations", values);
      else await ctx.db.patch("optimizationMigrations", state._id, values);
      // This advances/starts the dependency once. Its own scheduled continuation
      // finishes it and the completion hook wakes us; no waiting cron is needed.
      await ctx.runMutation(forumBackfillRef, {});
      return {
        phase: cursor.phase,
        processed: 0,
        totalProcessed: values.processed,
        done: false,
      };
    }
    const page = await backfillPhase(ctx, cursor, limit);
    const totalProcessed = (state?.processed ?? 0) + page.processed;
    const phaseIndex = BACKFILL_PHASES.indexOf(cursor.phase);
    const finalPhase = phaseIndex === BACKFILL_PHASES.length - 1;
    const done = page.isDone && finalPhase;
    const nextCursor: BackfillCursor = page.isDone
      ? {
          phase:
            BACKFILL_PHASES[
              Math.min(phaseIndex + 1, BACKFILL_PHASES.length - 1)
            ]!,
          cursor: null,
        }
      : { phase: cursor.phase, cursor: page.continueCursor };
    const now = Date.now();
    const values = {
      key: UNIVERSAL_SEARCH_PROJECTION_MIGRATION_KEY,
      status: done ? ("completed" as const) : ("running" as const),
      processed: totalProcessed,
      cursor: done ? undefined : JSON.stringify(nextCursor),
      scheduledAt: done ? undefined : now,
      updatedAt: now,
      ...(done ? { completedAt: now } : {}),
    };
    if (state === null) {
      await ctx.db.insert("optimizationMigrations", values);
    } else {
      await ctx.db.patch("optimizationMigrations", state._id, values);
    }
    if (!done) {
      await ctx.scheduler.runAfter(0, backfillRef, { limit });
    }
    return {
      phase: cursor.phase,
      processed: page.processed,
      totalProcessed,
      done,
    };
  },
});

async function backfillPhase(
  ctx: MutationCtx,
  cursor: BackfillCursor,
  limit: number,
) {
  switch (cursor.phase) {
    case "evidenceDocuments": {
      const page = await ctx.db.query("evidenceDocuments").paginate({
        cursor: cursor.cursor,
        numItems: limit,
        maximumRowsRead: limit + 1,
        maximumBytesRead: BACKFILL_MAX_BYTES_READ,
      });
      for (const document of page.page) {
        await syncEvidenceDocumentUniversalSearchProjection(ctx, document);
      }
      return pageResult(page);
    }
    case "evidenceEntities": {
      const page = await ctx.db.query("evidenceEntities").paginate({
        cursor: cursor.cursor,
        numItems: limit,
        maximumRowsRead: limit + 1,
        maximumBytesRead: BACKFILL_MAX_BYTES_READ,
      });
      for (const entity of page.page) {
        await syncEvidenceEntityUniversalSearchProjection(ctx, entity);
      }
      return pageResult(page);
    }
    case "evidenceClaims": {
      const page = await ctx.db.query("evidenceClaims").paginate({
        cursor: cursor.cursor,
        numItems: limit,
        maximumRowsRead: limit + 1,
        maximumBytesRead: BACKFILL_MAX_BYTES_READ,
      });
      for (const claim of page.page) {
        await syncEvidenceClaimUniversalSearchProjection(ctx, claim);
      }
      return pageResult(page);
    }
    case "posts": {
      const page = await ctx.db.query("posts").paginate({
        cursor: cursor.cursor,
        numItems: limit,
        maximumRowsRead: limit + 1,
        maximumBytesRead: BACKFILL_MAX_BYTES_READ,
      });
      for (const post of page.page) {
        await syncPostUniversalSearchProjection(ctx, post);
      }
      return pageResult(page);
    }
    case "newsletterIssues": {
      const page = await ctx.db.query("newsletterIssues").paginate({
        cursor: cursor.cursor,
        numItems: limit,
        maximumRowsRead: limit + 1,
        maximumBytesRead: BACKFILL_MAX_BYTES_READ,
      });
      for (const issue of page.page) {
        await syncNewsletterIssueUniversalSearchProjection(ctx, issue);
      }
      return pageResult(page);
    }
    case "hnStories": {
      const page = await ctx.db.query("hnStories").paginate({
        cursor: cursor.cursor,
        numItems: limit,
        maximumRowsRead: limit + 1,
        maximumBytesRead: BACKFILL_MAX_BYTES_READ,
      });
      for (const story of page.page) {
        await syncNewsStoryUniversalSearchProjection(ctx, story);
      }
      return pageResult(page);
    }
    case "forumThreads": {
      const page = await ctx.db.query("forumThreadSearchProjections").paginate({
        cursor: cursor.cursor,
        numItems: limit,
        maximumRowsRead: limit + 1,
        maximumBytesRead: BACKFILL_MAX_BYTES_READ,
      });
      for (const thread of page.page) {
        await syncForumThreadUniversalSearchProjection(ctx, thread);
      }
      return pageResult(page);
    }
  }
}

function pageResult(page: {
  page: unknown[];
  isDone: boolean;
  continueCursor: string;
}) {
  return {
    processed: page.page.length,
    isDone: page.isDone,
    continueCursor: page.continueCursor,
  };
}

function parseBackfillCursor(value: string | undefined): BackfillCursor {
  if (value === undefined) {
    return initialBackfillCursor();
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      "phase" in parsed &&
      "cursor" in parsed &&
      typeof parsed.phase === "string" &&
      BACKFILL_PHASES.includes(parsed.phase as BackfillPhase) &&
      (parsed.cursor === null || typeof parsed.cursor === "string")
    ) {
      return parsed as BackfillCursor;
    }
  } catch {
    // A malformed operator-supplied state restarts safely from the first page.
  }
  return initialBackfillCursor();
}

function initialBackfillCursor(): BackfillCursor {
  return { phase: BACKFILL_PHASES[0]!, cursor: null };
}

async function publicForumBoard(
  ctx: MutationCtx,
  categoryId: Id<"forumCategories">,
) {
  const requested = await ctx.db.get("forumCategories", categoryId);
  if (requested === null || (requested.kind ?? "board") !== "board") {
    return null;
  }
  const visited = new Set<Id<"forumCategories">>();
  let current: Doc<"forumCategories"> | null = requested;
  for (
    let depth = 0;
    current !== null && depth < MAX_FORUM_CATEGORY_DEPTH;
    depth += 1
  ) {
    if (
      current.status !== "active" ||
      (current.viewAccess ?? "public") !== "public" ||
      visited.has(current._id)
    ) {
      return null;
    }
    visited.add(current._id);
    if (current.parentCategoryId === undefined) return requested;
    current = await ctx.db.get("forumCategories", current.parentCategoryId);
  }
  return null;
}

async function upsertProjection(
  ctx: MutationCtx,
  values: ProjectionValues,
  knownExisting?: Doc<"universalSearchProjections"> | null,
) {
  const existing =
    knownExisting !== undefined
      ? knownExisting
      : await projectionByRecordKey(ctx, values.recordKey);
  if (existing === null) {
    await ctx.db.insert("universalSearchProjections", values);
    return;
  }
  if (projectionMatches(existing, values)) return;
  await ctx.db.patch("universalSearchProjections", existing._id, values);
}

async function projectionByRecordKey(ctx: MutationCtx, key: string) {
  return await ctx.db
    .query("universalSearchProjections")
    .withIndex("by_recordKey", (q) => q.eq("recordKey", key))
    .unique();
}

function projectionMatches(
  existing: Doc<"universalSearchProjections">,
  values: ProjectionValues,
) {
  return Object.entries(values).every(([key, value]) => {
    const current = existing[key as keyof typeof existing];
    return Array.isArray(value)
      ? Array.isArray(current) &&
          value.length === current.length &&
          value.every((item, index) => item === current[index])
      : current === value;
  });
}

function recordKey(type: ProjectionType, recordId: string) {
  return `${type}:${recordId}`;
}

function normalized(value: string, limit: number) {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length <= limit ? clean : `${clean.slice(0, limit - 1)}…`;
}

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
      host.endsWith(".local") ||
      isPrivateAddress(host)
    ) {
      return null;
    }
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
  ) {
    return true;
  }
  if (host.startsWith("::ffff:")) return isPrivateAddress(host.slice(7));
  const parts = host.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part))) {
    return false;
  }
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
