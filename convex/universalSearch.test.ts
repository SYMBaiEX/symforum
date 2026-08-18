/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { internal } from "./_generated/api";
import schema from "./schema";

const modules = {
  ...import.meta.glob("./**/*.ts"),
  ...import.meta.glob("./**/*.tsx"),
};

function setup() {
  return convexTest(schema, modules);
}

async function seedPublicCorpus(t: ReturnType<typeof setup>) {
  await t.run(async (ctx) => {
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
      await ctx.db.insert("forumThreads", {
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

    expect(first.map((result) => result.provenance.recordId)).toEqual(
      second.map((result) => result.provenance.recordId),
    );
    expect(first.map((result) => result.type)).toEqual(
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
    const { retiredSourceId } = await t.run(async (ctx) => {
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
      return { retiredSourceId };
    });

    const results = await t.query(internal.universalSearch.searchPublic, {
      query: "alpha",
      limit: 50,
    });
    const titles = results.map((result) => result.title);
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
      (result) => result.title,
    );
    expect(privateSourceTitles).not.toContain("Retired alpha document");
    expect(privateSourceTitles).not.toContain("Retired alpha claim");
  });
});
