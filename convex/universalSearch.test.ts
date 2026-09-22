/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { describe, expect, test, vi } from "vitest";

import { internal } from "./_generated/api";
import schema from "./schema";
import {
  requestUniversalSearchProjectionRebuild,
  syncForumThreadUniversalSearchProjection,
  syncPostUniversalSearchProjection,
  UNIVERSAL_SEARCH_PROJECTION_MIGRATION_KEY,
} from "./universalSearchProjection";

const modules = {
  ...import.meta.glob("./**/*.ts"),
  ...import.meta.glob("./**/*.tsx"),
};

function setup() {
  return convexTest(schema, modules);
}

const backfillRef = makeFunctionReference<
  "mutation",
  { limit?: number },
  { phase: string; processed: number; totalProcessed: number; done: boolean }
>("universalSearchProjection:backfill");

async function finishUniversalProjectionBackfill(t: ReturnType<typeof setup>) {
  vi.useFakeTimers();
  try {
    await t.mutation(backfillRef, { limit: 5 });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
  } finally {
    vi.useRealTimers();
  }
}

type SearchResult = {
  provenance: { recordId: string };
  title: string;
  type: string;
};

async function seedPublicCorpus(t: ReturnType<typeof setup>) {
  await t.run(async (ctx) => {
    await ctx.db.insert("forumAgentMaintenanceState", {
      key: "forum-search-projections-v1",
      completedAt: 100,
      updatedAt: 100,
    });
    const author = await ctx.db.insert("users", {
      name: "Public author",
      username: "public-author",
      usernameNormalized: "public-author",
      role: "reader",
    });
    const publicBoard = await ctx.db.insert("forumCategories", {
      slug: "research",
      name: "Research",
      description: "Public research",
      kind: "board",
      status: "active",
      viewAccess: "public",
      position: 1,
      threadCount: 1,
      postCount: 1,
      createdAt: 100,
      updatedAt: 200,
    });
    const privateBoard = await ctx.db.insert("forumCategories", {
      slug: "private-research",
      name: "Private research",
      description: "Private research",
      kind: "board",
      status: "active",
      viewAccess: "members",
      position: 2,
      threadCount: 1,
      postCount: 1,
      createdAt: 100,
      updatedAt: 200,
    });
    for (const [categoryId, categorySlug, slug, title] of [
      [publicBoard, "research", "alpha-public-thread", "Alpha forum thread"],
      [
        privateBoard,
        "private-research",
        "alpha-private-thread",
        "Alpha private thread",
      ],
    ] as const) {
      const threadId = await ctx.db.insert("forumThreads", {
        categoryId,
        categorySlug,
        slug,
        title,
        body: "Alpha body",
        authorId: author,
        status: "active",
        pinned: false,
        replyCount: 2,
        viewCount: 3,
        lastPostAt: 300,
        lastPostUserId: author,
        searchText: `${title} alpha`,
        createdAt: 250,
        updatedAt: 300,
      });
      await ctx.db.insert("forumThreadSearchProjections", {
        threadId,
        categoryId,
        categorySlug,
        slug,
        title,
        authorId: author,
        lastPostUserId: author,
        status: "active",
        pinned: false,
        replyCount: 2,
        viewCount: 3,
        createdAt: 250,
        updatedAt: 300,
        lastPostAt: 300,
        searchText: `${title} alpha`,
        excerpt: "Alpha body",
      });
    }
    await ctx.db.insert("posts", {
      slug: "alpha-public-post",
      title: "Alpha blog post",
      excerpt: "Alpha publication excerpt",
      body: "Alpha body",
      tags: ["alpha"],
      status: "published",
      publishedAt: 400,
      readingMinutes: 1,
      featured: false,
    });
    await ctx.db.insert("posts", {
      slug: "alpha-draft-post",
      title: "Alpha private draft",
      excerpt: "not public",
      body: "not public",
      tags: ["alpha"],
      status: "draft",
      publishedAt: 500,
      readingMinutes: 1,
      featured: false,
    });
    await ctx.db.insert("newsletterIssueDigests", {
      issueId: await ctx.db.insert("newsletterIssues", {
        slug: "alpha-newsletter",
        subject: "Alpha newsletter",
        previewText: "Alpha preview",
        body: "{}",
        status: "sent",
        createdAt: 500,
        updatedAt: 500,
        sentAt: 500,
      }),
      issueCreatedAt: 500,
      slug: "alpha-newsletter",
      subject: "Alpha newsletter",
      previewText: "Alpha preview",
      headline: "Alpha newsletter",
      dek: "Alpha digest",
      sourceCount: 2,
      status: "sent",
      sentAt: 500,
      createdAt: 500,
      updatedAt: 500,
    });
    const sourceId = await ctx.db.insert("evidenceSources", {
      sourceKey: "alpha-source",
      name: "Alpha source",
      sourceType: "api",
      ingestionEnabled: true,
      baseUrl: "https://example.test",
      homepageUrl: "https://example.test",
      status: "active",
      licenseClass: "open",
      provenanceClass: "official",
      visibility: "public",
      termsUrl: "https://example.test/terms",
      etag: "",
      lastModified: "",
      cursor: "",
      lastFetchedAt: 600,
      lastSucceededAt: 600,
      lastErrorAt: 0,
      lastErrorMessage: "",
      createdAt: 600,
      updatedAt: 600,
    });
    const publicDocumentId = await ctx.db.insert("evidenceDocuments", {
      sourceId,
      externalKey: "alpha-document",
      canonicalUrl: "https://example.test/alpha",
      canonicalUrlHash: "alpha-url",
      kind: "document",
      visibility: "public",
      title: "Alpha evidence document",
      excerpt: "Alpha evidence excerpt",
      searchText: "alpha evidence document",
      tags: ["alpha"],
      authors: ["Example"],
      licenseClass: "open",
      currentVersionId: null,
      publishedAt: 600,
      firstSeenAt: 600,
      updatedAt: 600,
    });
    await ctx.db.insert("evidenceDocuments", {
      sourceId,
      externalKey: "alpha-private-document",
      canonicalUrl: "https://example.test/private-alpha",
      canonicalUrlHash: "private-alpha-url",
      kind: "document",
      visibility: "private",
      title: "Alpha private evidence",
      excerpt: "not public",
      searchText: "alpha private evidence",
      tags: ["alpha"],
      authors: ["Example"],
      licenseClass: "restricted",
      currentVersionId: null,
      publishedAt: 600,
      firstSeenAt: 600,
      updatedAt: 600,
    });
    const entityId = await ctx.db.insert("evidenceEntities", {
      entityKey: "alpha",
      kind: "concept",
      name: "Alpha entity",
      aliases: ["alpha"],
      visibility: "public",
      createdAt: 700,
      updatedAt: 700,
    });
    const publicVersionId = await ctx.db.insert("evidenceDocumentVersions", {
      documentId: publicDocumentId,
      version: 1,
      contentHash: "alpha-content",
      title: "Alpha evidence document",
      excerpt: "Alpha evidence excerpt",
      searchText: "alpha evidence document",
      fetchedAt: 700,
      publishedAt: 600,
      sourceRevision: "v1",
      sourceUpdatedAt: 600,
      rawStorageId: null,
      retrievalUrl: "https://example.test/alpha",
      licenseClass: "open",
      metadataJson: "{}",
      createdAt: 700,
    });
    await ctx.db.patch("evidenceDocuments", publicDocumentId, {
      currentVersionId: publicVersionId,
    });
    await ctx.db.insert("evidenceDocumentEntities", {
      documentVersionId: publicVersionId,
      entityId,
      role: "subject",
      createdAt: 700,
    });
    const publicClaimId = await ctx.db.insert("evidenceClaims", {
      claimKey: "alpha-public-claim",
      statement: "Alpha claim is public.",
      subjectEntityId: entityId,
      predicate: "is",
      objectText: "public",
      status: "supported",
      confidence: 0.9,
      visibility: "public",
      observedAt: 700,
      createdAt: 700,
      updatedAt: 700,
    });
    await ctx.db.insert("evidenceClaimCitations", {
      claimId: publicClaimId,
      documentVersionId: publicVersionId,
      citationKey: "alpha-public-claim-v1",
      relation: "supports",
      locator: "alpha section",
      excerpt: "Alpha support.",
      confidence: 0.9,
      createdAt: 700,
    });
  });
}

describe("universal public lexical search", () => {
  test.each(["missing", "running", "missing-after-completion"] as const)(
    "waits for a %s forum migration and resumes on dependency completion",
    async (dependencyStatus) => {
      const t = setup();
      await seedPublicCorpus(t);
      await t.run(async (ctx) => {
        const marker = await ctx.db
          .query("forumAgentMaintenanceState")
          .withIndex("by_key", (q) =>
            q.eq("key", "forum-search-projections-v1"),
          )
          .unique();
        if (marker !== null) {
          if (dependencyStatus !== "running")
            await ctx.db.delete("forumAgentMaintenanceState", marker._id);
          else
            await ctx.db.patch("forumAgentMaintenanceState", marker._id, {
              completedAt: 0,
            });
        }
        for (const row of await ctx.db
          .query("forumThreadSearchProjections")
          .take(100)) {
          await ctx.db.delete("forumThreadSearchProjections", row._id);
        }
        await ctx.db.insert("optimizationMigrations", {
          key: UNIVERSAL_SEARCH_PROJECTION_MIGRATION_KEY,
          status:
            dependencyStatus === "missing-after-completion"
              ? "completed"
              : "running",
          processed: 0,
          cursor: JSON.stringify({ phase: "forumThreads", cursor: null }),
          updatedAt: 1,
        });
      });
      vi.useFakeTimers();
      try {
        expect(
          await t.query(internal.universalSearch.searchPublic, {
            query: "alpha",
            limit: 50,
          }),
        ).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              type: "forum_thread",
              title: "Alpha forum thread",
            }),
          ]),
        );
        await expect(t.mutation(backfillRef, {})).resolves.toMatchObject({
          done: false,
          processed: 0,
        });
        const marker = await t.run(async (ctx) =>
          ctx.db
            .query("optimizationMigrations")
            .withIndex("by_key", (q) =>
              q.eq("key", UNIVERSAL_SEARCH_PROJECTION_MIGRATION_KEY),
            )
            .unique(),
        );
        expect(marker).toMatchObject({ status: "running" });
        expect(marker?.scheduledAt).toBeUndefined();
        const results = await t.query(internal.universalSearch.searchPublic, {
          query: "alpha",
          limit: 50,
        });
        expect(results).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              type: "forum_thread",
              title: "Alpha forum thread",
            }),
          ]),
        );
        await t.finishAllScheduledFunctions(() => vi.runAllTimers());
        const complete = await t.run(async (ctx) =>
          ctx.db
            .query("optimizationMigrations")
            .withIndex("by_key", (q) =>
              q.eq("key", UNIVERSAL_SEARCH_PROJECTION_MIGRATION_KEY),
            )
            .unique(),
        );
        expect(complete?.status).toBe("completed");
        expect(
          await t.query(internal.universalSearch.searchPublic, {
            query: "alpha",
            limit: 50,
          }),
        ).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              type: "forum_thread",
              title: "Alpha forum thread",
            }),
          ]),
        );
      } finally {
        vi.useRealTimers();
      }
    },
  );
  test.each([false, true])(
    "fails closed for pending forum evidence in search and semantic hydration (projection=%s)",
    async (projection) => {
      const t = setup();
      await seedPublicCorpus(t);
      const ids = await t.run(async (ctx) => {
        const document = (
          await ctx.db.query("evidenceDocuments").collect()
        ).find((row) => row.externalKey === "alpha-document")!;
        const thread = (await ctx.db.query("forumThreads").collect()).find(
          (row) => row.categorySlug === "research",
        )!;
        const claim = (await ctx.db.query("evidenceClaims").collect())[0]!;
        await ctx.db.patch("evidenceSources", document.sourceId, {
          sourceKey: "symbaiex-first-party-research",
        });
        await ctx.db.patch("evidenceDocuments", document._id, {
          externalKey: `forum-research:${thread._id}`,
        });
        await ctx.db.patch("evidenceClaims", claim._id, {
          claimKey: `symbaiex-forum-claim:${thread._id}:claim`,
        });
        await ctx.db.patch("users", thread.authorId, {
          isAgent: true,
          agentSlug: "alpha",
        });
        await ctx.db.insert("researchQualityAssessments", {
          threadId: thread._id,
          categoryId: thread.categoryId,
          authorUserId: thread.authorId,
          runKey: "alpha",
          candidateTitle: thread.title,
          candidateExcerpt: "Alpha",
          status: "passed",
          sourceCount: 1,
          uniqueSourceDomainCount: 1,
          claimEstimate: 1,
          citationCoverageScore: 100,
          originalityScore: 99,
          aiAuthorshipDisclosed: true,
          contentFingerprint: "alpha",
          normalizedTerms: ["alpha"],
          flags: [],
          evaluatedAt: 1,
          createdAt: 1,
          updatedAt: 1,
        });
        return { documentId: document._id, threadId: thread._id };
      });
      if (projection) await finishUniversalProjectionBackfill(t);
      const before = await t.query(internal.universalSearch.searchPublic, {
        query: "alpha",
        limit: 50,
      });
      expect(before.some((row) => row.type === "evidence_document")).toBe(true);
      expect(before.some((row) => row.type === "evidence_claim")).toBe(true);
      expect(
        await t.query(internal.semanticSearch.readPublicDocumentForIndex, {
          documentId: ids.documentId,
          embeddingModel: "test",
        }),
      ).not.toBeNull();
      await t.run(async (ctx) => {
        await ctx.db.insert("evidenceFirstPartySyncQueue", {
          threadId: ids.threadId,
          generation: 1,
          reason: "content_changed",
          enqueuedAt: 1,
          updatedAt: 1,
        });
      });
      const after = await t.query(internal.universalSearch.searchPublic, {
        query: "alpha",
        limit: 50,
      });
      expect(
        after.some((row) =>
          ["evidence_document", "evidence_claim", "evidence_entity"].includes(
            row.type,
          ),
        ),
      ).toBe(false);
      expect(
        await t.query(internal.evidence.searchEntities, { search: "alpha" }),
      ).toEqual([]);
      expect(
        await t.query(internal.semanticSearch.readPublicDocumentForIndex, {
          documentId: ids.documentId,
          embeddingModel: "test",
        }),
      ).toBeNull();
      expect(
        await t.query(internal.semanticSearch.readCurrentPublicCandidates, {
          candidates: [
            {
              documentId: ids.documentId,
              score: 1,
              fingerprint: "600:600:test",
            },
          ],
        }),
      ).toEqual([]);
    },
  );

  test("revalidates evidence source policy despite stale completed search projections", async () => {
    const t = setup();
    await seedPublicCorpus(t);
    await finishUniversalProjectionBackfill(t);
    await t.run(async (ctx) => {
      const source = (await ctx.db.query("evidenceSources").collect())[0]!;
      await ctx.db.patch("evidenceSources", source._id, {
        visibility: "private",
      });
    });
    const result = await t.query(internal.universalSearch.searchPublic, {
      query: "alpha",
      limit: 50,
    });
    expect(
      result.some((row) =>
        ["evidence_document", "evidence_claim", "evidence_entity"].includes(
          row.type,
        ),
      ),
    ).toBe(false);
  });

  test("only curated general identities may be exposed without provenance links", async () => {
    const t = setup();
    await t.run(async (ctx) => {
      for (const entityKey of [
        "project:symbaiex",
        "person:austin-hamilton",
        "agent:private-researcher",
        "project:orphan",
      ]) {
        await ctx.db.insert("evidenceEntities", {
          entityKey,
          kind: "project",
          name: `Alpha ${entityKey}`,
          aliases: [],
          visibility: "public",
          createdAt: 1,
          updatedAt: 1,
        });
      }
    });
    const direct = await t.query(internal.evidence.searchEntities, {
      search: "alpha",
    });
    expect(direct.map((row) => row.entityKey).sort()).toEqual([
      "person:austin-hamilton",
      "project:symbaiex",
    ]);
    await finishUniversalProjectionBackfill(t);
    const results = await t.query(internal.universalSearch.searchPublic, {
      query: "alpha",
      limit: 50,
    });
    expect(results).toHaveLength(2);
    expect(results.every((row) => row.type === "evidence_entity")).toBe(true);
  });

  test("backfills one compact public-only projection and excludes private corpus rows", async () => {
    const t = setup();
    await seedPublicCorpus(t);

    await finishUniversalProjectionBackfill(t);

    const { state, projections } = await t.run(async (ctx) => ({
      state: await ctx.db
        .query("optimizationMigrations")
        .withIndex("by_key", (q) =>
          q.eq("key", UNIVERSAL_SEARCH_PROJECTION_MIGRATION_KEY),
        )
        .unique(),
      projections: await ctx.db.query("universalSearchProjections").take(100),
    }));
    expect(state?.status).toBe("completed");
    expect(projections.map((row) => row.type)).toEqual(
      expect.arrayContaining([
        "evidence_document",
        "evidence_claim",
        "evidence_entity",
        "blog_post",
        "newsletter_issue",
        "forum_thread",
      ]),
    );
    expect(JSON.stringify(projections)).not.toContain("private");

    const results = await t.query(internal.universalSearch.searchPublic, {
      query: "alpha",
      limit: 50,
    });
    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "evidence_document",
          title: "Alpha evidence document",
        }),
        expect.objectContaining({
          type: "forum_thread",
          title: "Alpha forum thread",
        }),
      ]),
    );
    expect(JSON.stringify(results)).not.toContain("private");
  });

  test("projection search recalls older matching rows outside the legacy recent window", async () => {
    const t = setup();
    const targetPostId = await t.run(async (ctx) => {
      const targetId = await ctx.db.insert("posts", {
        slug: "needle-archive-post",
        title: "Needle archive post",
        excerpt: "A durable historical match",
        body: "Large body deliberately absent from the search projection.",
        tags: ["needle"],
        status: "published",
        publishedAt: 1,
        readingMinutes: 1,
        featured: false,
      });
      for (let index = 0; index < 55; index += 1) {
        await ctx.db.insert("posts", {
          slug: `newer-filler-${index}`,
          title: `Newer filler ${index}`,
          excerpt: "Recent nonmatching filler",
          body: "Recent body",
          tags: ["filler"],
          status: "published",
          publishedAt: 100 + index,
          readingMinutes: 1,
          featured: false,
        });
      }
      return targetId;
    });

    const beforeBackfill = await t.query(
      internal.universalSearch.searchPublic,
      {
        query: "needle",
        limit: 20,
      },
    );
    expect(
      beforeBackfill.some(
        (row) => row.provenance.recordId === String(targetPostId),
      ),
    ).toBe(false);

    await finishUniversalProjectionBackfill(t);
    const afterBackfill = await t.query(internal.universalSearch.searchPublic, {
      query: "needle",
      limit: 20,
    });
    expect(afterBackfill).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "blog_post",
          title: "Needle archive post",
          provenance: expect.objectContaining({
            recordId: String(targetPostId),
          }),
        }),
      ]),
    );
  });

  test("transactional sync helpers retract content when public visibility changes", async () => {
    const t = setup();
    await seedPublicCorpus(t);
    await finishUniversalProjectionBackfill(t);

    await t.run(async (ctx) => {
      const post = await ctx.db
        .query("posts")
        .withIndex("by_slug", (q) => q.eq("slug", "alpha-public-post"))
        .unique();
      expect(post).not.toBeNull();
      await ctx.db.patch("posts", post!._id, { status: "draft" });
      const updatedPost = await ctx.db.get("posts", post!._id);
      expect(updatedPost).not.toBeNull();
      await syncPostUniversalSearchProjection(ctx, updatedPost!);

      const forumProjection = await ctx.db
        .query("forumThreadSearchProjections")
        .withSearchIndex("search_by_searchText", (q) =>
          q.search("searchText", "Alpha forum thread").eq("status", "active"),
        )
        .first();
      expect(forumProjection).not.toBeNull();
      const category = await ctx.db.get(
        "forumCategories",
        forumProjection!.categoryId,
      );
      expect(category).not.toBeNull();
      await ctx.db.patch("forumCategories", category!._id, {
        viewAccess: "members",
      });
      await syncForumThreadUniversalSearchProjection(ctx, forumProjection!);
    });

    const results = await t.query(internal.universalSearch.searchPublic, {
      query: "alpha",
      limit: 50,
    });
    expect(results.map((row) => row.title)).not.toContain("Alpha blog post");
    expect(results.map((row) => row.title)).not.toContain("Alpha forum thread");
  });

  test("policy rebuild immediately falls back and duplicate continuations resume safely", async () => {
    const t = setup();
    await seedPublicCorpus(t);
    await finishUniversalProjectionBackfill(t);

    await t.run(async (ctx) => {
      const post = await ctx.db
        .query("posts")
        .withIndex("by_slug", (q) => q.eq("slug", "alpha-public-post"))
        .unique();
      expect(post).not.toBeNull();
      await ctx.db.patch("posts", post!._id, {
        title: "Restart fallback live title",
      });
      await requestUniversalSearchProjectionRebuild(ctx);
    });
    // A duplicate policy event resets the same persisted cursor and leaves an
    // older scheduled continuation queued. Both must advance shared state
    // safely rather than replay a caller-supplied cursor.
    await t.run(async (ctx) => {
      await requestUniversalSearchProjectionRebuild(ctx);
    });

    const runningState = await t.run(async (ctx) =>
      ctx.db
        .query("optimizationMigrations")
        .withIndex("by_key", (q) =>
          q.eq("key", UNIVERSAL_SEARCH_PROJECTION_MIGRATION_KEY),
        )
        .unique(),
    );
    expect(runningState).toMatchObject({ status: "running", processed: 0 });
    expect(JSON.parse(runningState!.cursor!)).toEqual({
      phase: "evidenceDocuments",
      cursor: null,
    });
    expect(runningState?.completedAt).toBeUndefined();

    const fallbackResults = await t.query(
      internal.universalSearch.searchPublic,
      { query: "restart fallback", limit: 20 },
    );
    expect(fallbackResults.map((row) => row.title)).toContain(
      "Restart fallback live title",
    );

    vi.useFakeTimers();
    try {
      await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    } finally {
      vi.useRealTimers();
    }
    const completedState = await t.run(async (ctx) =>
      ctx.db
        .query("optimizationMigrations")
        .withIndex("by_key", (q) =>
          q.eq("key", UNIVERSAL_SEARCH_PROJECTION_MIGRATION_KEY),
        )
        .unique(),
    );
    expect(completedState?.status).toBe("completed");

    const projectedResults = await t.query(
      internal.universalSearch.searchPublic,
      { query: "restart fallback", limit: 20 },
    );
    expect(projectedResults.map((row) => row.title)).toContain(
      "Restart fallback live title",
    );
  });

  test("falls back to live thread search until the projection backfill completes", async () => {
    const t = setup();
    await seedPublicCorpus(t);
    await t.run(async (ctx) => {
      const marker = await ctx.db
        .query("forumAgentMaintenanceState")
        .withIndex("by_key", (q) => q.eq("key", "forum-search-projections-v1"))
        .unique();
      if (marker !== null)
        await ctx.db.delete("forumAgentMaintenanceState", marker._id);
      for (const projection of await ctx.db
        .query("forumThreadSearchProjections")
        .collect()) {
        await ctx.db.delete("forumThreadSearchProjections", projection._id);
      }
    });

    const results = await t.query(internal.universalSearch.searchPublic, {
      query: "alpha",
      limit: 50,
    });
    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "forum_thread",
          title: "Alpha forum thread",
        }),
      ]),
    );
  });

  test("federates public records with stable rank signals and excludes private records", async () => {
    const t = setup();
    await seedPublicCorpus(t);

    const first = await t.query(internal.universalSearch.searchPublic, {
      query: "alpha",
      limit: 50,
    });
    const second = await t.query(internal.universalSearch.searchPublic, {
      query: " alpha ",
      limit: 50,
    });

    expect(
      first.map((result: SearchResult) => result.provenance.recordId),
    ).toEqual(second.map((result: SearchResult) => result.provenance.recordId));
    expect(first.map((result: SearchResult) => result.type)).toEqual(
      expect.arrayContaining([
        "evidence_document",
        "evidence_claim",
        "evidence_entity",
        "blog_post",
        "newsletter_issue",
        "forum_thread",
      ]),
    );
    expect(first).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "forum_thread",
          canonicalUrl:
            "https://forum.symbaiex.com/research/alpha-public-thread",
          visibility: "public",
          scoreExplanation: expect.any(Array),
          rankSignals: expect.objectContaining({ matchedTerms: 1 }),
        }),
      ]),
    );
    expect(JSON.stringify(first)).not.toContain("private");
  });

  test("honors result bounds and rejects empty or non-searchable queries", async () => {
    const t = setup();
    await seedPublicCorpus(t);
    await expect(
      t.query(internal.universalSearch.searchPublic, {
        query: "alpha",
        limit: 1,
      }),
    ).resolves.toHaveLength(1);
    await expect(
      t.query(internal.universalSearch.searchPublic, { query: "   " }),
    ).rejects.toThrow(/query/i);
    await expect(
      t.query(internal.universalSearch.searchPublic, { query: "!!!" }),
    ).rejects.toThrow(/searchable/i);
  });

  test("fails closed for retired/private sources and unsafe URLs, and uses the live forum slug", async () => {
    const t = setup();
    await seedPublicCorpus(t);
    const { retiredSourceId, sectionId } = await t.run(async (ctx) => {
      const publicSource = await ctx.db
        .query("evidenceSources")
        .withIndex("by_sourceKey", (q) => q.eq("sourceKey", "alpha-source"))
        .unique();
      const research = await ctx.db
        .query("forumCategories")
        .withIndex("by_slug", (q) => q.eq("slug", "research"))
        .unique();
      expect(publicSource).not.toBeNull();
      expect(research).not.toBeNull();
      await ctx.db.patch("forumCategories", research!._id, {
        slug: "research-current",
      });
      const sectionId = await ctx.db.insert("forumCategories", {
        slug: "public-research-section",
        name: "Public research section",
        description: "Public ancestor section",
        kind: "section",
        status: "active",
        viewAccess: "public",
        position: 0,
        threadCount: 0,
        postCount: 0,
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.patch("forumCategories", research!._id, {
        parentCategoryId: sectionId,
      });
      const retiredSourceId = await ctx.db.insert("evidenceSources", {
        sourceKey: "retired-alpha-source",
        name: "Retired alpha source",
        sourceType: "api",
        ingestionEnabled: false,
        baseUrl: "https://retired.example.test",
        homepageUrl: "https://retired.example.test",
        status: "retired",
        licenseClass: "open",
        provenanceClass: "official",
        visibility: "public",
        termsUrl: "https://retired.example.test/terms",
        etag: "",
        lastModified: "",
        cursor: "",
        lastFetchedAt: 1,
        lastSucceededAt: 1,
        lastErrorAt: 0,
        lastErrorMessage: "",
        createdAt: 1,
        updatedAt: 1,
      });
      const retiredDocumentId = await ctx.db.insert("evidenceDocuments", {
        sourceId: retiredSourceId,
        externalKey: "retired-alpha-document",
        canonicalUrl: "https://retired.example.test/alpha",
        canonicalUrlHash: "retired-alpha",
        kind: "document",
        visibility: "public",
        title: "Retired alpha document",
        excerpt: "Retired alpha evidence",
        searchText: "retired alpha evidence",
        tags: ["alpha"],
        authors: [],
        licenseClass: "open",
        currentVersionId: null,
        publishedAt: 1,
        firstSeenAt: 1,
        updatedAt: 1,
      });
      const retiredVersionId = await ctx.db.insert("evidenceDocumentVersions", {
        documentId: retiredDocumentId,
        version: 1,
        contentHash: "retired-alpha-content",
        title: "Retired alpha document",
        excerpt: "Retired alpha evidence",
        searchText: "retired alpha evidence",
        fetchedAt: 1,
        publishedAt: 1,
        sourceRevision: "v1",
        sourceUpdatedAt: 1,
        rawStorageId: null,
        retrievalUrl: "https://retired.example.test/alpha",
        licenseClass: "open",
        metadataJson: "{}",
        createdAt: 1,
      });
      const retiredClaimId = await ctx.db.insert("evidenceClaims", {
        claimKey: "retired-alpha-claim",
        statement: "Retired alpha claim",
        subjectEntityId: null,
        predicate: "is",
        objectText: "retired",
        status: "supported",
        confidence: 1,
        visibility: "public",
        observedAt: 1,
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("evidenceClaimCitations", {
        claimId: retiredClaimId,
        documentVersionId: retiredVersionId,
        citationKey: "retired-alpha-claim-v1",
        relation: "supports",
        locator: "section",
        excerpt: "Retired alpha support",
        confidence: 1,
        createdAt: 1,
      });
      await ctx.db.insert("evidenceDocuments", {
        sourceId: publicSource!._id,
        externalKey: "unsafe-alpha-document",
        canonicalUrl: "https://user:password@127.0.0.1/private",
        canonicalUrlHash: "unsafe-alpha",
        kind: "document",
        visibility: "public",
        title: "Unsafe alpha document",
        excerpt: "Unsafe alpha evidence",
        searchText: "unsafe alpha evidence",
        tags: ["alpha"],
        authors: [],
        licenseClass: "open",
        currentVersionId: null,
        publishedAt: 1,
        firstSeenAt: 1,
        updatedAt: 1,
      });
      return { retiredSourceId, sectionId };
    });

    const results = await t.query(internal.universalSearch.searchPublic, {
      query: "alpha",
      limit: 50,
    });
    const titles = results.map((result: SearchResult) => result.title);
    expect(titles).not.toContain("Retired alpha document");
    expect(titles).not.toContain("Retired alpha claim");
    expect(titles).not.toContain("Unsafe alpha document");
    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "forum_thread",
          canonicalUrl:
            "https://forum.symbaiex.com/research-current/alpha-public-thread",
        }),
      ]),
    );
    await t.run(async (ctx) => {
      await ctx.db.patch("evidenceSources", retiredSourceId, {
        status: "active",
        visibility: "private",
      });
    });
    const privateSourceResults = await t.query(
      internal.universalSearch.searchPublic,
      {
        query: "alpha",
        limit: 50,
      },
    );
    const privateSourceTitles = privateSourceResults.map(
      (result: SearchResult) => result.title,
    );
    expect(privateSourceTitles).not.toContain("Retired alpha document");
    expect(privateSourceTitles).not.toContain("Retired alpha claim");
    await t.run(async (ctx) => {
      await ctx.db.patch("forumCategories", sectionId, {
        viewAccess: "members",
      });
    });
    const privateAncestorResults = await t.query(
      internal.universalSearch.searchPublic,
      { query: "alpha", limit: 50 },
    );
    expect(
      privateAncestorResults.map((result: SearchResult) => result.type),
    ).not.toContain("forum_thread");
    await t.run(async (ctx) => {
      await ctx.db.patch("forumCategories", sectionId, {
        viewAccess: "public",
        status: "archived",
      });
    });
    const inactiveAncestorResults = await t.query(
      internal.universalSearch.searchPublic,
      { query: "alpha", limit: 50 },
    );
    expect(
      inactiveAncestorResults.map((result: SearchResult) => result.type),
    ).not.toContain("forum_thread");
  });
});
