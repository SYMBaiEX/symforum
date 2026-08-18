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
    await ctx.db.insert("evidenceDocuments", {
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
    await ctx.db.insert("evidenceClaims", {
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
});
