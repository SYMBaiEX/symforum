import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  type ActionCtx,
  type MutationCtx,
} from "./_generated/server";
import { publishedResearchEvidenceValidator } from "./researchQuality";
import type { Id } from "./_generated/dataModel";
import { bumpEvidencePublicationEpoch } from "./evidencePublicationEpoch";

const SOURCE_KEY = "symbaiex-first-party-research";
const PUBLISHED_AT = Date.UTC(2026, 7, 13);
const RECONCILIATION_KEY = "first-party-forum-research-v1";
const RECONCILIATION_PAGE_SIZE = 20;
const SYNC_BATCH_SIZE = 16;
const FORUM_EXTERNAL_KEY_PREFIX = "forum-research:";
const syncReasonValidator = v.union(
  v.literal("published"),
  v.literal("content_changed"),
  v.literal("visibility_changed"),
  v.literal("category_changed"),
  v.literal("quality_changed"),
  v.literal("reconciliation"),
);
type SyncReason = typeof syncReasonValidator.type;
type PublishedResearch = typeof publishedResearchEvidenceValidator.type;
const RESEARCH_PAGES = [
  {
    externalKey: "research-hub",
    canonicalUrl: "https://www.symbaiex.com/research",
    title: "SYMBaiEX research hubs",
    excerpt:
      "Curated research topic hubs with practical guidance, implementation notes, and source-backed references.",
    tags: ["symbaiex", "research", "topic-hub"],
  },
  {
    externalKey: "ai-readable-web",
    canonicalUrl: "https://www.symbaiex.com/research/ai-readable-web",
    title: "AI-readable web architecture",
    excerpt:
      "How SYMBaiEX publishes one truthful content graph across HTML, Markdown, sitemap, feeds, and machine-readable discovery surfaces.",
    tags: ["symbaiex", "research", "ai-readable-web", "aiao", "geo"],
  },
  {
    externalKey: "editorial-trust-and-contracts",
    canonicalUrl:
      "https://www.symbaiex.com/research/editorial-trust-and-contracts",
    title: "Editorial authority and machine contracts",
    excerpt:
      "How policy boundaries, canonical URLs, attribution, and machine-facing surfaces stay aligned.",
    tags: ["symbaiex", "research", "editorial-trust", "machine-contracts"],
  },
] as const;

const upsertSourceRef = makeFunctionReference<
  "mutation",
  Record<string, unknown>,
  { sourceId: Id<"evidenceSources">; created: boolean }
>("evidence:upsertSource");
const upsertVersionRef = makeFunctionReference<
  "mutation",
  Record<string, unknown>,
  {
    documentId: Id<"evidenceDocuments">;
    versionId: Id<"evidenceDocumentVersions">;
    version: number;
    idempotent: boolean;
  }
>("evidence:upsertDocumentVersion");
const upsertEntityRef = makeFunctionReference<
  "mutation",
  Record<string, unknown>,
  { entityId: Id<"evidenceEntities">; created: boolean }
>("evidence:upsertEntity");
const linkEntityRef = makeFunctionReference<
  "mutation",
  Record<string, unknown>,
  { linkId: Id<"evidenceDocumentEntities">; created: boolean }
>("evidence:linkDocumentEntity");
const upsertClaimRef = makeFunctionReference<
  "mutation",
  Record<string, unknown>,
  { claimId: Id<"evidenceClaims">; created: boolean }
>("evidence:upsertClaim");
const recordCitationRef = makeFunctionReference<
  "mutation",
  Record<string, unknown>,
  { citationId: Id<"evidenceClaimCitations">; created: boolean }
>("evidence:recordCitation");
const enqueueWebhookRef = makeFunctionReference<
  "mutation",
  Record<string, unknown>,
  { eventId: Id<"apiWebhookEvents"> | null; enqueued: number }
>("evidenceWebhooks:enqueueEvent");
const publishedResearchRef = makeFunctionReference<
  "query",
  { threadId: Id<"forumThreads"> },
  | { state: "publish"; research: PublishedResearch }
  | {
      state: "retract";
      threadId: Id<"forumThreads">;
      reason:
        | "not_approved"
        | "thread_unavailable"
        | "category_not_public"
        | "author_unavailable";
    }
>("researchQuality:readResearchForEvidenceSync");
const setDocumentExposureRef = makeFunctionReference<
  "mutation",
  {
    sourceId: Id<"evidenceSources">;
    externalKey: string;
    visibility: "public" | "private";
    claimKeyPrefixes: string[];
    observedAt: number;
  },
  {
    documentId: Id<"evidenceDocuments"> | null;
    changed: boolean;
    claimsChanged: number;
  }
>("evidence:setFirstPartyDocumentExposure");
const syncActionRef = makeFunctionReference<
  "action",
  Record<string, never>,
  { processed: number; newVersions: number; claims: number; more: boolean }
>("evidenceFirstParty:syncForumResearch");

async function sha256(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/** Index the explicitly curated first-party research registry without scraping HTML. */
export const syncRegistry = internalMutation({
  args: {},
  returns: v.object({
    sourceId: v.id("evidenceSources"),
    projectId: v.id("evidenceEntities"),
    documents: v.number(),
    newVersions: v.number(),
    claims: v.number(),
  }),
  handler: async (ctx) => {
    const now = Date.now();
    const source = await ctx.runMutation(upsertSourceRef, {
      sourceKey: SOURCE_KEY,
      name: "SYMBaiEX first-party research",
      sourceType: "manual",
      ingestionEnabled: true,
      baseUrl: "https://www.symbaiex.com/research",
      homepageUrl: "https://www.symbaiex.com/research",
      status: "active",
      licenseClass: "attributed",
      provenanceClass: "primary",
      visibility: "public",
      termsUrl: "https://www.symbaiex.com/ai-policy",
      etag: "",
      lastModified: "2026-08-13",
      cursor: "",
      lastFetchedAt: now,
      lastSucceededAt: now,
      lastErrorAt: 0,
      lastErrorMessage: "",
    });
    const author = await ctx.runMutation(upsertEntityRef, {
      entityKey: "person:austin-hamilton",
      kind: "person",
      name: "Austin Hamilton",
      aliases: [],
      visibility: "public",
    });
    const project = await ctx.runMutation(upsertEntityRef, {
      entityKey: "project:symbaiex",
      kind: "project",
      name: "SYMBaiEX",
      aliases: ["SYMBaIEX"],
      visibility: "public",
    });
    let newVersions = 0;
    let claims = 0;
    for (const page of RESEARCH_PAGES) {
      const contentHash = await sha256(
        JSON.stringify({
          title: page.title,
          excerpt: page.excerpt,
          tags: page.tags,
          publishedAt: PUBLISHED_AT,
        }),
      );
      if (await isComplete(ctx, page.externalKey, contentHash)) continue;
      const stored = await ctx.runMutation(upsertVersionRef, {
        requireContentHashMatch: true,
        sourceId: source.sourceId,
        externalKey: page.externalKey,
        canonicalUrl: page.canonicalUrl,
        canonicalUrlHash: await sha256(page.canonicalUrl),
        contentHash,
        kind: "document",
        visibility: "public",
        title: page.title,
        excerpt: page.excerpt,
        searchText: `${page.title} ${page.excerpt} ${page.tags.join(" ")}`,
        tags: [...page.tags],
        authors: ["Austin Hamilton"],
        documentLicenseClass: "attributed",
        fetchedAt: now,
        publishedAt: PUBLISHED_AT,
        sourceRevision: "research-registry-v1",
        sourceUpdatedAt: PUBLISHED_AT,
        retrievalUrl: page.canonicalUrl,
        licenseClass: "attributed",
        metadataJson: JSON.stringify({
          authorship: "Austin Hamilton",
          contentClass: "first-party research metadata",
          canonicalUrl: page.canonicalUrl,
        }),
      });
      await ctx.runMutation(linkEntityRef, {
        documentVersionId: stored.versionId,
        entityId: author.entityId,
        role: "publisher",
      });
      await ctx.runMutation(linkEntityRef, {
        documentVersionId: stored.versionId,
        entityId: project.entityId,
        role: "subject",
      });
      const claim = await ctx.runMutation(upsertClaimRef, {
        claimKey: `symbaiex-research:${page.externalKey}`,
        statement: `SYMBaiEX publishes ${page.title} at its canonical research URL.`,
        subjectEntityId: project.entityId,
        predicate: "publishes-research-page",
        objectText: page.canonicalUrl,
        status: "supported",
        confidence: 1,
        visibility: "public",
        observedAt: PUBLISHED_AT,
      });
      const citation = await ctx.runMutation(recordCitationRef, {
        claimId: claim.claimId,
        documentVersionId: stored.versionId,
        citationKey: `symbaiex-research:${page.externalKey}:version:${stored.versionId}`,
        relation: "supports",
        locator: page.canonicalUrl,
        excerpt: page.excerpt,
        confidence: 1,
      });
      if (!stored.idempotent) {
        newVersions += 1;
        await ctx.runMutation(enqueueWebhookRef, {
          eventKey: `document:${stored.documentId}:version:${stored.version}`,
          eventType: "evidence.document.changed",
          payloadJson: JSON.stringify({
            documentId: stored.documentId,
            documentVersionId: stored.versionId,
            version: stored.version,
            canonicalUrl: page.canonicalUrl,
          }),
        });
      }
      if (citation.created) {
        claims += 1;
        await ctx.runMutation(enqueueWebhookRef, {
          eventKey: `claim:${claim.claimId}:version:${stored.versionId}`,
          eventType: "evidence.claim.verified",
          payloadJson: JSON.stringify({
            claimId: claim.claimId,
            documentVersionId: stored.versionId,
            status: "supported",
            confidence: 1,
          }),
        });
      }
      await markComplete(ctx, page.externalKey, contentHash);
    }
    return {
      sourceId: source.sourceId,
      projectId: project.entityId,
      documents: RESEARCH_PAGES.length,
      newVersions,
      claims,
    };
  },
});

/** Each document and its provenance commit together; failed enrichment rolls back. */
export const syncResearch = internalMutation({
  args: {
    research: publishedResearchEvidenceValidator,
    sourceId: v.id("evidenceSources"),
    projectId: v.id("evidenceEntities"),
    generation: v.optional(v.number()),
    queueId: v.optional(v.id("evidenceFirstPartySyncQueue")),
  },
  returns: v.object({ newVersions: v.number(), claims: v.number() }),
  handler: async (
    ctx,
    { research: snapshot, sourceId, projectId, generation, queueId },
  ) => {
    const queued = await ctx.db
      .query("evidenceFirstPartySyncQueue")
      .withIndex("by_threadId", (q) => q.eq("threadId", snapshot.threadId))
      .unique();
    if (
      (generation !== undefined || queueId !== undefined) &&
      (queued?.generation !== generation || queued?._id !== queueId)
    )
      return { newVersions: 0, claims: 0 };
    // Actions can race a moderation/content write between reading and publishing.
    // Re-read eligibility and content inside the publication transaction.
    const decision = await ctx.runQuery(publishedResearchRef, {
      threadId: snapshot.threadId,
    });
    if (decision.state === "retract") {
      await ctx.runMutation(
        makeFunctionReference<
          "mutation",
          {
            threadId: Id<"forumThreads">;
            sourceId: Id<"evidenceSources">;
            generation?: number;
            queueId?: Id<"evidenceFirstPartySyncQueue">;
          },
          { changed: boolean; claimsChanged: number; skipped: boolean }
        >("evidenceFirstParty:retractResearch"),
        { threadId: snapshot.threadId, sourceId, generation, queueId },
      );
      return { newVersions: 0, claims: 0 };
    }
    const research = decision.research;
    const source = { sourceId };
    const project = { entityId: projectId };
    const now = Date.now();
    let newVersions = 0;
    let claims = 0;
    const canonicalUrl = `https://forum.symbaiex.com/forum/${encodeURIComponent(research.categorySlug)}/${encodeURIComponent(research.slug)}`;
    const plainBody = research.body
      .replace(/\[(?:\/?)[a-z0-9*]+(?:=[^\]]*)?\]/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    const bodyUrls = [...research.body.matchAll(/https?:\/\/[^\s\])>"']+/gi)]
      .map((match) => match[0])
      .slice(0, 12);
    const sourceUrls = [...new Set([...research.sourceUrls, ...bodyUrls])];
    const metadata = {
      contentClass: "first-party disclosed agent research",
      authorship: {
        name: research.authorName,
        agentSlug: research.agentSlug,
        synthetic: true,
      },
      publication: {
        threadId: research.threadId,
        categorySlug: research.categorySlug,
        contentFormat: research.contentFormat ?? null,
        bodyBbcode: research.body,
      },
      generation: {
        provider: "openrouter",
        model: research.model ?? null,
        promptVersion: research.promptVersion ?? null,
      },
      quality: {
        schemaVersion: research.qualitySchemaVersion ?? null,
        contentQualityScore: research.contentQualityScore ?? null,
        citationCoverageScore: research.citationCoverageScore,
        originalityScore: research.originalityScore,
        naturalnessScore: research.naturalnessScore ?? null,
        structureScore: research.structureScore ?? null,
        sourceDiversityScore: research.sourceDiversityScore ?? null,
      },
      sources: {
        domains: research.sourceDomains,
        urls: sourceUrls,
      },
    };
    const externalKey = `forum-research:${research.threadId}`;
    // Operational activity (views/replies) is not a new research revision.
    // Claims and canonical location ARE semantic inputs and must not be skipped.
    const contentHash = await sha256(
      JSON.stringify({
        title: research.title,
        body: research.body,
        metadata,
        canonicalUrl,
        claims: research.claims,
      }),
    );
    if (await isComplete(ctx, externalKey, contentHash))
      return { newVersions, claims };
    const stored = await ctx.runMutation(upsertVersionRef, {
      requireContentHashMatch: true,
      sourceId: source.sourceId,
      externalKey,
      canonicalUrl,
      canonicalUrlHash: await sha256(canonicalUrl),
      contentHash,
      kind: "document",
      visibility: "public",
      title: research.title,
      excerpt: plainBody.slice(0, 1_200),
      searchText: `${research.title} ${plainBody}`.slice(0, 60_000),
      tags: [
        "symbaiex",
        "forum-research",
        "ai-assisted",
        `agent:${research.agentSlug}`,
        `board:${research.categorySlug}`,
      ],
      authors: [research.authorName],
      documentLicenseClass: "attributed",
      fetchedAt: now,
      publishedAt: research.createdAt,
      sourceRevision: `forum-content:${contentHash}`,
      sourceUpdatedAt: research.updatedAt,
      retrievalUrl: canonicalUrl,
      licenseClass: "attributed",
      metadataJson: JSON.stringify(metadata),
    });
    await ctx.runMutation(setDocumentExposureRef, {
      sourceId,
      externalKey,
      visibility: "public",
      claimKeyPrefixes: [],
      observedAt: now,
    });
    const agentEntity = await ctx.runMutation(upsertEntityRef, {
      entityKey: `agent:${research.agentSlug}`,
      kind: "concept",
      name: research.authorName,
      aliases: [research.agentSlug],
      visibility: "public",
    });
    await ctx.runMutation(linkEntityRef, {
      documentVersionId: stored.versionId,
      entityId: agentEntity.entityId,
      role: "publisher",
    });
    await ctx.runMutation(linkEntityRef, {
      documentVersionId: stored.versionId,
      entityId: project.entityId,
      role: "subject",
    });
    const claim = await ctx.runMutation(upsertClaimRef, {
      claimKey: `symbaiex-forum-research:${research.threadId}`,
      statement: `${research.authorName} published the disclosed AI-assisted research thread ${research.title} on the SYMBaiEX forum.`,
      subjectEntityId: project.entityId,
      predicate: "publishes-agent-research-thread",
      objectText: canonicalUrl,
      status: "supported",
      confidence: 1,
      visibility: "public",
      observedAt: research.updatedAt,
    });
    const citation = await ctx.runMutation(recordCitationRef, {
      claimId: claim.claimId,
      documentVersionId: stored.versionId,
      citationKey: `symbaiex-forum-research:${research.threadId}:version:${stored.versionId}`,
      relation: "supports",
      locator: canonicalUrl,
      excerpt: plainBody.slice(0, 800),
      confidence: 1,
    });
    if (!stored.idempotent) {
      newVersions += 1;
      await ctx.runMutation(enqueueWebhookRef, {
        eventKey: `document:${stored.documentId}:version:${stored.version}`,
        eventType: "evidence.document.changed",
        payloadJson: JSON.stringify({
          documentId: stored.documentId,
          documentVersionId: stored.versionId,
          version: stored.version,
          canonicalUrl,
        }),
      });
    }
    if (citation.created) claims += 1;
    for (const researchClaim of research.claims) {
      const status =
        researchClaim.supportStatus === "supported"
          ? ("supported" as const)
          : ("unresolved" as const);
      const groundedClaim = await ctx.runMutation(upsertClaimRef, {
        claimKey: `symbaiex-forum-claim:${research.threadId}:${researchClaim.claimHash}`,
        statement: researchClaim.claimText,
        subjectEntityId: project.entityId,
        predicate: "forum-research-assertion",
        objectText: researchClaim.claimText,
        status,
        confidence: Math.max(0, Math.min(1, researchClaim.supportScore / 100)),
        visibility: "public",
        observedAt: research.updatedAt,
      });
      const groundedCitation = await ctx.runMutation(recordCitationRef, {
        claimId: groundedClaim.claimId,
        documentVersionId: stored.versionId,
        citationKey: `symbaiex-forum-claim:${research.threadId}:${researchClaim.claimHash}:version:${stored.versionId}`,
        relation: "context",
        locator: researchClaim.sourceUrl,
        excerpt:
          researchClaim.bodySpanText?.trim() ||
          researchClaim.claimText.slice(0, 800),
        confidence: Math.max(0, Math.min(1, researchClaim.supportScore / 100)),
        actorType: "agent",
        actorId: research.agentSlug,
        source: `forum-ledger:${researchClaim.snapshotHash}`,
      });
      if (groundedCitation.created) claims += 1;
    }
    await markComplete(ctx, externalKey, contentHash, "public");
    return {
      newVersions,
      claims,
    };
  },
});

async function enqueueThread(
  ctx: MutationCtx,
  threadId: Id<"forumThreads">,
  reason: SyncReason,
  schedule: boolean,
) {
  const now = Date.now();
  // Invalidate materialized exports in the writer's transaction, not later
  // when the scheduled reconciler retracts/rebuilds the evidence document.
  // New publications and safety scans do not invalidate existing artifacts.
  if (reason !== "published" && reason !== "reconciliation") {
    const source = await ctx.db
      .query("evidenceSources")
      .withIndex("by_sourceKey", (q) => q.eq("sourceKey", SOURCE_KEY))
      .unique();
    const document = source
      ? await ctx.db
          .query("evidenceDocuments")
          .withIndex("by_sourceId_and_externalKey", (q) =>
            q
              .eq("sourceId", source._id)
              .eq("externalKey", `${FORUM_EXTERNAL_KEY_PREFIX}${threadId}`),
          )
          .unique()
      : null;
    if (document?.visibility === "public")
      await bumpEvidencePublicationEpoch(ctx);
  }
  const existing = await ctx.db
    .query("evidenceFirstPartySyncQueue")
    .withIndex("by_threadId", (q) => q.eq("threadId", threadId))
    .unique();
  const generation = (existing?.generation ?? 0) + 1;
  let queueId = existing?._id;
  if (existing === null)
    queueId = await ctx.db.insert("evidenceFirstPartySyncQueue", {
      threadId,
      generation,
      reason,
      enqueuedAt: now,
      updatedAt: now,
    });
  else
    await ctx.db.patch("evidenceFirstPartySyncQueue", existing._id, {
      generation,
      reason,
      updatedAt: now,
    });
  if (schedule) await ctx.scheduler.runAfter(0, syncActionRef, {});
  return { generation, queueId: queueId! };
}

/** Atomic dirty marker used by forum and quality write paths. */
export const enqueueForumResearchThread = internalMutation({
  args: {
    threadId: v.id("forumThreads"),
    reason: syncReasonValidator,
  },
  returns: v.object({
    generation: v.number(),
    queueId: v.id("evidenceFirstPartySyncQueue"),
  }),
  handler: async (ctx, args) =>
    await enqueueThread(ctx, args.threadId, args.reason, true),
});

/** Category-policy changes restart the bounded safety pass immediately. */
export const requestHistoricalReconciliation = internalMutation({
  args: {},
  returns: v.object({ scheduled: v.boolean() }),
  handler: async (ctx) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("evidenceFirstPartyReconciliationState")
      .withIndex("by_key", (q) => q.eq("key", RECONCILIATION_KEY))
      .unique();
    const value = {
      key: RECONCILIATION_KEY,
      phase: "assessments" as const,
      cursor: undefined,
      completedAt: 0,
      updatedAt: now,
    };
    if (existing === null)
      await ctx.db.insert("evidenceFirstPartyReconciliationState", value);
    else
      await ctx.db.patch(
        "evidenceFirstPartyReconciliationState",
        existing._id,
        value,
      );
    await ctx.scheduler.runAfter(0, syncActionRef, {});
    return { scheduled: true };
  },
});

export const retractResearch = internalMutation({
  args: {
    threadId: v.id("forumThreads"),
    sourceId: v.id("evidenceSources"),
    generation: v.optional(v.number()),
    queueId: v.optional(v.id("evidenceFirstPartySyncQueue")),
  },
  returns: v.object({
    changed: v.boolean(),
    claimsChanged: v.number(),
    skipped: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const queued = await ctx.db
      .query("evidenceFirstPartySyncQueue")
      .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId))
      .unique();
    if (
      (args.generation !== undefined || args.queueId !== undefined) &&
      (queued?.generation !== args.generation || queued?._id !== args.queueId)
    )
      return { changed: false, claimsChanged: 0, skipped: true };
    // The action's retract decision can become obsolete while a newer worker
    // republishes. Fence the generation and re-read eligibility in this same
    // transaction before touching exposure, claims, or the checkpoint.
    const decision = await ctx.runQuery(publishedResearchRef, {
      threadId: args.threadId,
    });
    if (decision.state !== "retract")
      return { changed: false, claimsChanged: 0, skipped: true };
    const externalKey = `${FORUM_EXTERNAL_KEY_PREFIX}${args.threadId}`;
    const result = await ctx.runMutation(setDocumentExposureRef, {
      sourceId: args.sourceId,
      externalKey,
      visibility: "private",
      claimKeyPrefixes: [
        `symbaiex-forum-research:${args.threadId}`,
        `symbaiex-forum-claim:${args.threadId}:`,
      ],
      observedAt: Date.now(),
    });
    const checkpoint = await ctx.db
      .query("evidenceFirstPartyCheckpoints")
      .withIndex("by_externalKey", (q) => q.eq("externalKey", externalKey))
      .unique();
    if (checkpoint !== null)
      await ctx.db.patch("evidenceFirstPartyCheckpoints", checkpoint._id, {
        exposure: "private",
        completedAt: Date.now(),
      });
    return {
      changed: result.changed,
      claimsChanged: result.claimsChanged,
      skipped: false,
    };
  },
});

const queueEntryValidator = v.object({
  threadId: v.id("forumThreads"),
  generation: v.number(),
  // Numeric generations restart after acknowledgement deletes a row. The ID
  // distinguishes that new work from delayed workers holding the old number.
  queueId: v.id("evidenceFirstPartySyncQueue"),
});

/**
 * Advance one resumable reconciliation page and return one compact dirty
 * batch. No thread body or provenance rows are read in this transaction.
 */
export const prepareForumResearchSyncBatch = internalMutation({
  args: { sourceId: v.id("evidenceSources") },
  returns: v.object({
    entries: v.array(queueEntryValidator),
    hasMore: v.boolean(),
    reconciliationPending: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const now = Date.now();
    let state = await ctx.db
      .query("evidenceFirstPartyReconciliationState")
      .withIndex("by_key", (q) => q.eq("key", RECONCILIATION_KEY))
      .unique();
    if (state === null) {
      const stateId = await ctx.db.insert(
        "evidenceFirstPartyReconciliationState",
        {
          key: RECONCILIATION_KEY,
          phase: "assessments",
          completedAt: 0,
          updatedAt: now,
        },
      );
      state = (await ctx.db.get(
        "evidenceFirstPartyReconciliationState",
        stateId,
      ))!;
    }

    let nextPhase = state.phase;
    let nextCursor: string | undefined = state.cursor;
    if (state.phase === "assessments") {
      const page = await ctx.db
        .query("researchQualityAssessments")
        .withIndex("by_threadId")
        .paginate({
          cursor: state.cursor ?? null,
          numItems: RECONCILIATION_PAGE_SIZE,
        });
      for (const assessment of page.page)
        if (assessment.threadId !== undefined)
          await enqueueThread(
            ctx,
            assessment.threadId,
            "reconciliation",
            false,
          );
      nextPhase = page.isDone ? "documents" : "assessments";
      nextCursor = page.isDone ? undefined : page.continueCursor;
    } else if (state.phase === "documents") {
      const page = await ctx.db
        .query("evidenceDocuments")
        .withIndex("by_sourceId_and_externalKey", (q) =>
          q
            .eq("sourceId", args.sourceId)
            .gte("externalKey", FORUM_EXTERNAL_KEY_PREFIX)
            .lt("externalKey", `${FORUM_EXTERNAL_KEY_PREFIX}\uffff`),
        )
        .paginate({
          cursor: state.cursor ?? null,
          numItems: RECONCILIATION_PAGE_SIZE,
        });
      for (const document of page.page) {
        const rawThreadId = document.externalKey.slice(
          FORUM_EXTERNAL_KEY_PREFIX.length,
        );
        const threadId = ctx.db.normalizeId("forumThreads", rawThreadId);
        if (threadId !== null)
          await enqueueThread(ctx, threadId, "reconciliation", false);
      }
      nextPhase = page.isDone ? "complete" : "documents";
      nextCursor = page.isDone ? undefined : page.continueCursor;
    }
    if (state.phase !== "complete")
      await ctx.db.patch("evidenceFirstPartyReconciliationState", state._id, {
        phase: nextPhase,
        cursor: nextCursor,
        completedAt: nextPhase === "complete" ? now : 0,
        updatedAt: now,
      });

    const queued = await ctx.db
      .query("evidenceFirstPartySyncQueue")
      .withIndex("by_updatedAt")
      .order("asc")
      .take(SYNC_BATCH_SIZE + 1);
    return {
      entries: queued
        .slice(0, SYNC_BATCH_SIZE)
        .map(({ _id: queueId, threadId, generation }) => ({
          threadId,
          generation,
          queueId,
        })),
      hasMore: queued.length > SYNC_BATCH_SIZE,
      reconciliationPending: nextPhase !== "complete",
    };
  },
});

export const acknowledgeForumResearchSync = internalMutation({
  args: queueEntryValidator.fields,
  returns: v.object({ acknowledged: v.boolean() }),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("evidenceFirstPartySyncQueue")
      .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId))
      .unique();
    if (
      row === null ||
      row._id !== args.queueId ||
      row.generation !== args.generation
    )
      return { acknowledged: false };
    await ctx.db.delete("evidenceFirstPartySyncQueue", row._id);
    return { acknowledged: true };
  },
});

async function isComplete(
  ctx: MutationCtx,
  externalKey: string,
  contentHash: string,
) {
  const checkpoint = await ctx.db
    .query("evidenceFirstPartyCheckpoints")
    .withIndex("by_externalKey", (q) => q.eq("externalKey", externalKey))
    .unique();
  return (
    checkpoint?.contentHash === contentHash && checkpoint.exposure !== "private"
  );
}

async function markComplete(
  ctx: MutationCtx,
  externalKey: string,
  contentHash: string,
  exposure: "public" | "private" = "public",
) {
  const checkpoint = await ctx.db
    .query("evidenceFirstPartyCheckpoints")
    .withIndex("by_externalKey", (q) => q.eq("externalKey", externalKey))
    .unique();
  const value = {
    externalKey,
    contentHash,
    exposure,
    completedAt: Date.now(),
  };
  if (checkpoint === null)
    await ctx.db.insert("evidenceFirstPartyCheckpoints", value);
  else
    await ctx.db.patch("evidenceFirstPartyCheckpoints", checkpoint._id, value);
}

type ForumBatchResult = {
  processed: number;
  newVersions: number;
  claims: number;
  more: boolean;
};

async function processForumResearchBatch(
  ctx: ActionCtx,
  sourceId: Id<"evidenceSources">,
  projectId: Id<"evidenceEntities">,
): Promise<ForumBatchResult> {
  const batch = await ctx.runMutation(
    makeFunctionReference<
      "mutation",
      { sourceId: Id<"evidenceSources"> },
      {
        entries: Array<{
          threadId: Id<"forumThreads">;
          generation: number;
          queueId: Id<"evidenceFirstPartySyncQueue">;
        }>;
        hasMore: boolean;
        reconciliationPending: boolean;
      }
    >("evidenceFirstParty:prepareForumResearchSyncBatch"),
    { sourceId },
  );
  let newVersions = 0;
  let claims = 0;
  for (const entry of batch.entries) {
    const decision = await ctx.runQuery(publishedResearchRef, {
      threadId: entry.threadId,
    });
    if (decision.state === "publish") {
      const result = await ctx.runMutation(
        makeFunctionReference<
          "mutation",
          {
            research: PublishedResearch;
            sourceId: Id<"evidenceSources">;
            projectId: Id<"evidenceEntities">;
            generation: number;
            queueId: Id<"evidenceFirstPartySyncQueue">;
          },
          { newVersions: number; claims: number }
        >("evidenceFirstParty:syncResearch"),
        {
          research: decision.research,
          sourceId,
          projectId,
          generation: entry.generation,
          queueId: entry.queueId,
        },
      );
      newVersions += result.newVersions;
      claims += result.claims;
    } else {
      const result = await ctx.runMutation(
        makeFunctionReference<
          "mutation",
          {
            threadId: Id<"forumThreads">;
            sourceId: Id<"evidenceSources">;
            generation: number;
            queueId: Id<"evidenceFirstPartySyncQueue">;
          },
          { changed: boolean; claimsChanged: number; skipped: boolean }
        >("evidenceFirstParty:retractResearch"),
        { ...entry, sourceId },
      );
      if (result.skipped) continue;
    }
    await ctx.runMutation(
      makeFunctionReference<
        "mutation",
        {
          threadId: Id<"forumThreads">;
          generation: number;
          queueId: Id<"evidenceFirstPartySyncQueue">;
        },
        { acknowledged: boolean }
      >("evidenceFirstParty:acknowledgeForumResearchSync"),
      entry,
    );
  }
  const more = batch.hasMore || batch.reconciliationPending;
  if (more)
    await ctx.scheduler.runAfter(
      0,
      makeFunctionReference<
        "action",
        {
          sourceId: Id<"evidenceSources">;
          projectId: Id<"evidenceEntities">;
        },
        ForumBatchResult
      >("evidenceFirstParty:continueForumResearchSync"),
      { sourceId, projectId },
    );
  return {
    processed: batch.entries.length,
    newVersions,
    claims,
    more,
  };
}

export const continueForumResearchSync = internalAction({
  args: {
    sourceId: v.id("evidenceSources"),
    projectId: v.id("evidenceEntities"),
  },
  returns: v.object({
    processed: v.number(),
    newVersions: v.number(),
    claims: v.number(),
    more: v.boolean(),
  }),
  handler: async (ctx, args): Promise<ForumBatchResult> =>
    await processForumResearchBatch(ctx, args.sourceId, args.projectId),
});

export const readForumResearchSyncContext = internalQuery({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      sourceId: v.id("evidenceSources"),
      projectId: v.id("evidenceEntities"),
    }),
  ),
  handler: async (ctx) => {
    const source = await ctx.db
      .query("evidenceSources")
      .withIndex("by_sourceKey", (q) => q.eq("sourceKey", SOURCE_KEY))
      .unique();
    const project = await ctx.db
      .query("evidenceEntities")
      .withIndex("by_entityKey", (q) => q.eq("entityKey", "project:symbaiex"))
      .unique();
    return source === null ||
      source.status !== "active" ||
      source.visibility !== "public" ||
      project === null ||
      project.visibility !== "public"
      ? null
      : { sourceId: source._id, projectId: project._id };
  },
});

/** Dirty forum changes do not re-read/rewrite the static research registry. */
export const syncForumResearch = internalAction({
  args: {},
  returns: v.object({
    processed: v.number(),
    newVersions: v.number(),
    claims: v.number(),
    more: v.boolean(),
  }),
  handler: async (ctx): Promise<ForumBatchResult> => {
    const existing = await ctx.runQuery(
      makeFunctionReference<
        "query",
        Record<string, never>,
        {
          sourceId: Id<"evidenceSources">;
          projectId: Id<"evidenceEntities">;
        } | null
      >("evidenceFirstParty:readForumResearchSyncContext"),
      {},
    );
    const registry =
      existing ??
      (await ctx.runMutation(
        makeFunctionReference<
          "mutation",
          Record<string, never>,
          { sourceId: Id<"evidenceSources">; projectId: Id<"evidenceEntities"> }
        >("evidenceFirstParty:syncRegistry"),
        {},
      ));
    return await processForumResearchBatch(
      ctx,
      registry.sourceId,
      registry.projectId,
    );
  },
});

export const sync = internalAction({
  args: {},
  returns: v.object({
    documents: v.number(),
    newVersions: v.number(),
    claims: v.number(),
  }),
  handler: async (
    ctx,
  ): Promise<{ documents: number; newVersions: number; claims: number }> => {
    const registry = await ctx.runMutation(
      makeFunctionReference<
        "mutation",
        Record<string, never>,
        {
          sourceId: Id<"evidenceSources">;
          projectId: Id<"evidenceEntities">;
          documents: number;
          newVersions: number;
          claims: number;
        }
      >("evidenceFirstParty:syncRegistry"),
      {},
    );
    const forum = await processForumResearchBatch(
      ctx,
      registry.sourceId,
      registry.projectId,
    );
    return {
      documents: registry.documents + forum.processed,
      newVersions: registry.newVersions + forum.newVersions,
      claims: registry.claims + forum.claims,
    };
  },
});
