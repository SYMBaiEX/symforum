import { describe, expect, it, vi } from "vitest";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import {
  cachePublicEvidenceSource,
  firstPartyForumClaimMatchesEvidenceDocument,
  getPublicEvidenceSource,
  getPublicEvidenceSourceWithKnownSource,
  isPublicEvidenceClaim,
  publicEvidenceDocumentIdForVersion,
} from "./evidenceVisibility";

describe("firstPartyForumClaimMatchesEvidenceDocument", () => {
  it("recognizes only a claim that names the already-validated evidence document", () => {
    const claim = {
      claimKey: "symbaiex-forum-research:thread-123:claim-4",
    } as unknown as Doc<"evidenceClaims">;
    const matchingDocument = {
      externalKey: "forum-research:thread-123",
    } as unknown as Doc<"evidenceDocuments">;
    const unrelatedDocument = {
      externalKey: "forum-research:thread-456",
    } as unknown as Doc<"evidenceDocuments">;
    const unrelatedClaim = {
      claimKey: "claim:external-source",
    } as unknown as Doc<"evidenceClaims">;

    expect(
      firstPartyForumClaimMatchesEvidenceDocument(claim, matchingDocument),
    ).toBe(true);
    expect(
      firstPartyForumClaimMatchesEvidenceDocument(claim, unrelatedDocument),
    ).toBe(false);
    expect(
      firstPartyForumClaimMatchesEvidenceDocument(
        unrelatedClaim,
        matchingDocument,
      ),
    ).toBe(false);
  });
});

describe("publicEvidenceDocumentIdForVersion", () => {
  it("uses and caches the compact version digest when present", async () => {
    const versionId = "version-1" as Id<"evidenceDocumentVersions">;
    const documentId = "document-1" as Id<"evidenceDocuments">;
    const unique = vi.fn(async () => ({ documentId }));
    const versionRead = vi.fn(async () => ({ documentId: "wrong-doc" }));
    const ctx = {
      db: {
        get: versionRead,
        query: () => ({ withIndex: () => ({ unique }) }),
      },
    } as unknown as QueryCtx;

    const results = await Promise.all([
      publicEvidenceDocumentIdForVersion(ctx, versionId),
      publicEvidenceDocumentIdForVersion(ctx, versionId),
    ]);

    expect(results).toEqual([documentId, documentId]);
    expect(unique).toHaveBeenCalledTimes(1);
    expect(versionRead).not.toHaveBeenCalled();
  });

  it("falls back to the canonical version until its digest is backfilled", async () => {
    const versionId = "version-1" as Id<"evidenceDocumentVersions">;
    const documentId = "document-1" as Id<"evidenceDocuments">;
    const unique = vi.fn(async () => null);
    const versionRead = vi.fn(async () => ({ documentId }));
    const ctx = {
      db: {
        get: versionRead,
        query: () => ({ withIndex: () => ({ unique }) }),
      },
    } as unknown as QueryCtx;

    await expect(
      publicEvidenceDocumentIdForVersion(ctx, versionId),
    ).resolves.toBe(documentId);
    expect(unique).toHaveBeenCalledTimes(1);
    expect(versionRead).toHaveBeenCalledTimes(1);
  });
});

describe("public evidence owner document request cache", () => {
  it("coalesces repeated owner-document reads across claims in one query", async () => {
    const documentId = "document-1" as Id<"evidenceDocuments">;
    const versionId = "version-1" as Id<"evidenceDocumentVersions">;
    const sourceId = "source-1" as Id<"evidenceSources">;
    const authorId = "user-1" as Id<"users">;
    const ownerDocument = {
      _id: documentId,
      visibility: "public",
      sourceId,
      externalKey: "forum-research:thread-1",
    };
    const thread = { status: "active", categoryId: "category-1" };
    const assessment = { status: "passed", authorUserId: authorId };
    const documentReads = vi.fn(async () => ownerDocument);
    const otherReads = vi.fn(async (table: string) => {
      if (table === "evidenceSources")
        return { visibility: "public", status: "active" };
      if (table === "forumThreads") return thread;
      if (table === "users") return { isAgent: true, agentSlug: "suki" };
      if (table === "forumCategories")
        return { status: "active", kind: "board", viewAccess: "public" };
      return null;
    });
    const uniqueReads = vi.fn(async (table: string) => {
      if (table === "evidenceDocumentVersionExportDigests")
        return { documentId };
      if (table === "researchQualityAssessments") return assessment;
      return null;
    });
    const makeContext = () =>
      ({
        db: {
          get: (table: string, id: string) =>
            table === "evidenceDocuments" && id === documentId
              ? documentReads()
              : otherReads(table),
          normalizeId: (_table: string, id: string) => id as never,
          query: (table: string) => ({
            withIndex: (_index: string, range?: (q: never) => unknown) => ({
              unique: () => uniqueReads(table),
              first: () => ({
                claimId: (range as unknown as { claimId?: string })?.claimId,
                documentVersionId: versionId,
              }),
            }),
          }),
        },
      }) as unknown as QueryCtx;
    const ctx = makeContext();
    const claims = ["claim-1", "claim-2"].map(
      (id) =>
        ({
          _id: id,
          visibility: "public",
          claimKey: `symbaiex-forum-research:thread-1:${id}`,
        }) as never,
    );

    await expect(
      Promise.all(claims.map((claim) => isPublicEvidenceClaim(ctx, claim))),
    ).resolves.toEqual([true, true]);
    expect(documentReads).toHaveBeenCalledTimes(1);
    await expect(isPublicEvidenceClaim(makeContext(), claims[0])).resolves.toBe(
      true,
    );
    expect(documentReads).toHaveBeenCalledTimes(2);
  });
});

describe("getPublicEvidenceSource request cache", () => {
  it("validates an already-loaded source without reading it again", async () => {
    const sourceId = "source-1" as Id<"evidenceSources">;
    const source = {
      _id: sourceId,
      visibility: "public",
      status: "active",
    } as unknown as Doc<"evidenceSources">;
    const sourceRead = vi.fn(async () => source);
    const ctx = {
      db: { get: sourceRead },
    } as unknown as QueryCtx;
    const document = {
      _id: "document-1",
      visibility: "public",
      sourceId,
      externalKey: "report:one",
    } as unknown as Doc<"evidenceDocuments">;

    await expect(
      getPublicEvidenceSourceWithKnownSource(ctx, document, source),
    ).resolves.toBe(source);
    expect(sourceRead).not.toHaveBeenCalled();
  });

  it("coalesces concurrent reads for a shared source within one query", async () => {
    const sourceId = "source-1" as Id<"evidenceSources">;
    const source = {
      visibility: "public",
      status: "active",
    };
    const sourceRead = vi.fn(async () => {
      await Promise.resolve();
      return source;
    });
    const ctx = {
      db: {
        get: (table: string) =>
          table === "evidenceSources" ? sourceRead() : Promise.resolve(null),
      },
    } as unknown as QueryCtx;
    const documents = [
      {
        visibility: "public",
        sourceId,
        externalKey: "report:one",
      },
      {
        visibility: "public",
        sourceId,
        externalKey: "report:two",
      },
    ];

    const results = await Promise.all(
      documents.map((document) =>
        getPublicEvidenceSource(ctx, document as never),
      ),
    );

    expect(results).toEqual([source, source]);
    expect(sourceRead).toHaveBeenCalledTimes(1);
  });

  it("does not reuse source reads across query contexts", async () => {
    const sourceId = "source-1" as Id<"evidenceSources">;
    const source = { visibility: "public", status: "active" };
    const sourceRead = vi.fn(async () => source);
    const createContext = () =>
      ({
        db: {
          get: () => sourceRead(),
        },
      }) as unknown as QueryCtx;
    const document = {
      visibility: "public",
      sourceId,
      externalKey: "report:one",
    } as never;

    await getPublicEvidenceSource(createContext(), document);
    await getPublicEvidenceSource(createContext(), document);

    expect(sourceRead).toHaveBeenCalledTimes(2);
  });

  it("reuses an already-loaded source supplied by the caller", async () => {
    const sourceId = "source-1" as Id<"evidenceSources">;
    const source = {
      _id: sourceId,
      visibility: "public",
      status: "active",
    };
    const sourceRead = vi.fn(async () => source);
    const ctx = {
      db: { get: () => sourceRead() },
    } as unknown as QueryCtx;
    cachePublicEvidenceSource(ctx, source as never);

    const result = await getPublicEvidenceSource(ctx, {
      visibility: "public",
      sourceId,
      externalKey: "report:one",
    } as never);

    expect(result).toBe(source);
    expect(sourceRead).not.toHaveBeenCalled();
  });

  it("coalesces first-party publication checks for a repeated document", async () => {
    const sourceId = "source-1" as Id<"evidenceSources">;
    const source = { visibility: "public", status: "active" };
    const thread = {
      status: "active",
      categoryId: "category-1",
    };
    const assessment = {
      status: "passed",
      authorUserId: "user-1",
    };
    const category = {
      status: "active",
      kind: "board",
      viewAccess: "public",
    };
    const reads = vi.fn(async (table: string) => {
      if (table === "evidenceSources") return source;
      if (table === "forumThreads") return thread;
      if (table === "users") return { isAgent: true, agentSlug: "suki" };
      if (table === "forumCategories") return category;
      return null;
    });
    const uniqueReads = vi.fn(async (table: string) =>
      table === "researchQualityAssessments" ? assessment : null,
    );
    const ctx = {
      db: {
        get: (table: string) => reads(table),
        normalizeId: vi.fn(() => "thread-1"),
        query: (table: string) => ({
          withIndex: () => ({ unique: () => uniqueReads(table) }),
        }),
      },
    } as unknown as QueryCtx;
    const document = {
      _id: "document-1",
      visibility: "public",
      sourceId,
      externalKey: "forum-research:thread-1",
    } as never;

    const results = await Promise.all([
      getPublicEvidenceSource(ctx, document),
      getPublicEvidenceSource(ctx, document),
    ]);

    expect(results).toEqual([source, source]);
    expect(ctx.db.normalizeId).toHaveBeenCalledTimes(1);
    expect(uniqueReads).toHaveBeenCalledTimes(2);
    expect(reads).toHaveBeenCalledTimes(4);
  });

  it("reuses authors and category ancestors across distinct forum documents", async () => {
    const sourceId = "source-1" as Id<"evidenceSources">;
    const categoryId = "category-1" as Id<"forumCategories">;
    const authorId = "user-1" as Id<"users">;
    const source = { visibility: "public", status: "active" };
    const reads = vi.fn(async (table: string) => {
      if (table === "evidenceSources") return source;
      if (table === "forumThreads") return { status: "active", categoryId };
      if (table === "users") return { isAgent: true, agentSlug: "suki" };
      if (table === "forumCategories")
        return { status: "active", kind: "board", viewAccess: "public" };
      return null;
    });
    const uniqueReads = vi.fn(async (table: string) =>
      table === "researchQualityAssessments"
        ? { status: "passed", authorUserId: authorId }
        : null,
    );
    const ctx = {
      db: {
        get: (table: string) => reads(table),
        normalizeId: (_table: string, id: string) => id as never,
        query: (table: string) => ({
          withIndex: () => ({ unique: () => uniqueReads(table) }),
        }),
      },
    } as unknown as QueryCtx;
    const documents = ["thread-1", "thread-2"].map(
      (threadId) =>
        ({
          _id: `document-${threadId}`,
          visibility: "public",
          sourceId,
          externalKey: `forum-research:${threadId}`,
        }) as never,
    );

    const results = await Promise.all(
      documents.map((document) => getPublicEvidenceSource(ctx, document)),
    );

    expect(results).toEqual([source, source]);
    expect(
      reads.mock.calls.filter(([table]) => table === "evidenceSources"),
    ).toHaveLength(1);
    expect(
      reads.mock.calls.filter(([table]) => table === "users"),
    ).toHaveLength(1);
    expect(
      reads.mock.calls.filter(([table]) => table === "forumCategories"),
    ).toHaveLength(1);
    expect(
      reads.mock.calls.filter(([table]) => table === "forumThreads"),
    ).toHaveLength(2);
  });

  it("uses the smaller editorial digest for export visibility when ready", async () => {
    const sourceId = "source-1" as Id<"evidenceSources">;
    const categoryId = "category-1" as Id<"forumCategories">;
    const source = { visibility: "public", status: "active" };
    const reads = vi.fn(async (table: string) => {
      if (table === "evidenceSources") return source;
      if (table === "users") return { isAgent: true, agentSlug: "suki" };
      if (table === "forumCategories")
        return { status: "active", kind: "board", viewAccess: "public" };
      return null;
    });
    const uniqueReads = vi.fn(async (table: string) => {
      if (table === "forumAgentMaintenanceState") return { completedAt: 1 };
      if (table === "forumThreadEditorialDigests")
        return { status: "active", categoryId };
      if (table === "researchQualityAssessmentVisibilityDigests")
        return { status: "passed", authorUserId: "user-1" };
      return null;
    });
    const ctx = {
      db: {
        get: (table: string) => reads(table),
        normalizeId: (_table: string, id: string) => id as never,
        query: (table: string) => ({
          withIndex: () => ({ unique: () => uniqueReads(table) }),
        }),
      },
    } as unknown as QueryCtx;
    const document = {
      _id: "document-1",
      visibility: "public",
      sourceId,
      externalKey: "forum-research:thread-1",
    } as never;

    await expect(
      getPublicEvidenceSource(ctx, document, {
        preferCompactForumThread: true,
        preferCompactForumAssessment: true,
      }),
    ).resolves.toBe(source);

    expect(
      uniqueReads.mock.calls.filter(
        ([table]) => table === "forumThreadEditorialDigests",
      ),
    ).toHaveLength(1);
    expect(
      uniqueReads.mock.calls.filter(
        ([table]) => table === "forumThreadSearchProjections",
      ),
    ).toHaveLength(0);
    expect(
      reads.mock.calls.filter(([table]) => table === "forumThreads"),
    ).toHaveLength(0);
  });

  it("does not let a stale search projection override a hidden editorial digest", async () => {
    const sourceId = "source-1" as Id<"evidenceSources">;
    const source = { visibility: "public", status: "active" };
    const reads = vi.fn(async (table: string) =>
      table === "evidenceSources" ? source : null,
    );
    const uniqueReads = vi.fn(async (table: string) => {
      if (table === "forumAgentMaintenanceState") return { completedAt: 1 };
      if (table === "forumThreadEditorialDigests")
        return {
          status: "hidden",
          categoryId: "category-1" as Id<"forumCategories">,
        };
      if (table === "forumThreadSearchProjections")
        return {
          status: "active",
          categoryId: "category-1" as Id<"forumCategories">,
        };
      return null;
    });
    const ctx = {
      db: {
        get: (table: string) => reads(table),
        normalizeId: (_table: string, id: string) => id as never,
        query: (table: string) => ({
          withIndex: () => ({ unique: () => uniqueReads(table) }),
        }),
      },
    } as unknown as QueryCtx;
    const document = {
      _id: "document-1",
      visibility: "public",
      sourceId,
      externalKey: "forum-research:thread-1",
    } as never;

    await expect(
      getPublicEvidenceSource(ctx, document, {
        preferCompactForumThread: true,
      }),
    ).resolves.toBeNull();

    expect(
      uniqueReads.mock.calls.filter(
        ([table]) => table === "forumThreadSearchProjections",
      ),
    ).toHaveLength(0);
    expect(reads.mock.calls.some(([table]) => table === "forumThreads")).toBe(
      false,
    );
  });

  it("falls back to the compact search projection when the editorial digest is missing", async () => {
    const sourceId = "source-1" as Id<"evidenceSources">;
    const categoryId = "category-1" as Id<"forumCategories">;
    const source = { visibility: "public", status: "active" };
    const reads = vi.fn(async (table: string) => {
      if (table === "evidenceSources") return source;
      if (table === "forumThreads") return { status: "active", categoryId };
      if (table === "users") return { isAgent: true, agentSlug: "suki" };
      if (table === "forumCategories")
        return { status: "active", kind: "board", viewAccess: "public" };
      return null;
    });
    const uniqueReads = vi.fn(async (table: string) => {
      if (table === "forumAgentMaintenanceState") return { completedAt: 1 };
      if (table === "forumThreadSearchProjections")
        return { status: "active", categoryId };
      if (table === "researchQualityAssessments")
        return { status: "passed", authorUserId: "user-1" };
      return null;
    });
    const ctx = {
      db: {
        get: (table: string) => reads(table),
        normalizeId: (_table: string, id: string) => id as never,
        query: (table: string) => ({
          withIndex: () => ({ unique: () => uniqueReads(table) }),
        }),
      },
    } as unknown as QueryCtx;
    const document = {
      _id: "document-1",
      visibility: "public",
      sourceId,
      externalKey: "forum-research:thread-1",
    } as never;

    await expect(
      getPublicEvidenceSource(ctx, document, {
        preferCompactForumThread: true,
      }),
    ).resolves.toBe(source);

    expect(
      uniqueReads.mock.calls.filter(
        ([table]) => table === "forumThreadSearchProjections",
      ),
    ).toHaveLength(1);
    expect(
      reads.mock.calls.filter(([table]) => table === "forumThreads"),
    ).toHaveLength(0);
  });

  it("falls back to the canonical thread when compact migrations are incomplete", async () => {
    const sourceId = "source-1" as Id<"evidenceSources">;
    const categoryId = "category-1" as Id<"forumCategories">;
    const source = { visibility: "public", status: "active" };
    const reads = vi.fn(async (table: string) => {
      if (table === "evidenceSources") return source;
      if (table === "forumThreads") return { status: "hidden", categoryId };
      if (table === "users") return { isAgent: true, agentSlug: "suki" };
      if (table === "forumCategories")
        return { status: "active", kind: "board", viewAccess: "public" };
      return null;
    });
    const uniqueReads = vi.fn(async (table: string) => {
      if (table === "forumAgentMaintenanceState") return { completedAt: 0 };
      if (table === "researchQualityAssessments")
        return { status: "passed", authorUserId: "user-1" };
      return null;
    });
    const ctx = {
      db: {
        get: (table: string) => reads(table),
        normalizeId: (_table: string, id: string) => id as never,
        query: (table: string) => ({
          withIndex: () => ({ unique: () => uniqueReads(table) }),
        }),
      },
    } as unknown as QueryCtx;
    const document = {
      _id: "document-1",
      visibility: "public",
      sourceId,
      externalKey: "forum-research:thread-1",
    } as never;

    await expect(
      getPublicEvidenceSource(ctx, document, {
        preferCompactForumThread: true,
      }),
    ).resolves.toBeNull();

    expect(
      reads.mock.calls.filter(([table]) => table === "forumThreads"),
    ).toHaveLength(1);
    expect(
      uniqueReads.mock.calls.filter(
        ([table]) => table === "forumThreadSearchProjections",
      ),
    ).toHaveLength(0);
  });
});
