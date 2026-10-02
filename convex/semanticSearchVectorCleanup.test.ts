import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { OPENROUTER_EMBEDDING_MODEL } from "../lib/ai-models";
import { internal } from "./_generated/api";
import schema from "./schema";

const ragState = vi.hoisted(() => ({
  namespaceExists: true,
  namespaceId: "test-evidence-namespace",
  keys: new Set<string>(),
  deleted: [] as string[],
}));

vi.mock("@convex-dev/rag", () => ({
  RAG: class {
    async getNamespace() {
      return ragState.namespaceExists
        ? { namespaceId: ragState.namespaceId }
        : null;
    }

    async deleteByKey(
      _ctx: unknown,
      args: { namespaceId: string; key: string },
    ) {
      expect(args.namespaceId).toBe(ragState.namespaceId);
      ragState.deleted.push(args.key);
      ragState.keys.delete(args.key);
      return true;
    }
  },
}));

const modules = {
  ...import.meta.glob("./**/*.ts"),
  ...import.meta.glob("./**/*.tsx"),
};

afterEach(() => {
  ragState.namespaceExists = true;
  ragState.keys.clear();
  ragState.deleted.length = 0;
});

test("cleanup rechecks visibility, deletes only private vectors, and invalidates their markers", async () => {
  const t = convexTest(schema, modules);
  const { privateDocumentId, publicDocumentId } = await t.run(async (ctx) => {
    const sourceId = await ctx.db.insert("evidenceSources", {
      sourceKey: "vector-cleanup-test",
      name: "Vector cleanup test",
      sourceType: "manual",
      ingestionEnabled: true,
      baseUrl: "https://example.com/",
      homepageUrl: "https://example.com/",
      status: "active",
      licenseClass: "open",
      provenanceClass: "primary",
      visibility: "public",
      termsUrl: "https://example.com/terms",
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
    const privateDocumentId = await ctx.db.insert("evidenceDocuments", {
      sourceId,
      externalKey: "vector-cleanup:private",
      canonicalUrl: "https://example.com/private",
      canonicalUrlHash: "vector-cleanup-private",
      kind: "document",
      visibility: "private",
      title: "Private evidence",
      excerpt: "Private excerpt",
      searchText: "Private research",
      tags: [],
      authors: [],
      licenseClass: "open",
      currentVersionId: null,
      publishedAt: null,
      firstSeenAt: 1,
      updatedAt: 1,
    });
    const publicDocumentId = await ctx.db.insert("evidenceDocuments", {
      sourceId,
      externalKey: "vector-cleanup:public",
      canonicalUrl: "https://example.com/public",
      canonicalUrlHash: "vector-cleanup-public",
      kind: "document",
      visibility: "public",
      title: "Public evidence",
      excerpt: "Public excerpt",
      searchText: "Public research",
      tags: [],
      authors: [],
      licenseClass: "open",
      currentVersionId: null,
      publishedAt: null,
      firstSeenAt: 1,
      updatedAt: 1,
    });

    for (const [documentId, suffix] of [
      [privateDocumentId, "private"],
      [publicDocumentId, "public"],
    ] as const) {
      await ctx.db.insert("aiOperationalStates", {
        key: `semantic-index-content:${documentId}:1:${OPENROUTER_EMBEDDING_MODEL}`,
        healthy: true,
        provider: "openrouter",
        model: OPENROUTER_EMBEDDING_MODEL,
        detail: `${suffix} content marker`,
        checkedAt: 1,
        pauseUntil: 0,
        updatedAt: 1,
      });
    }
    await ctx.db.insert("aiOperationalStates", {
      key: `semantic-index:${privateDocumentId}:1:1:${OPENROUTER_EMBEDDING_MODEL}`,
      healthy: true,
      provider: "openrouter",
      model: OPENROUTER_EMBEDDING_MODEL,
      detail: "legacy private marker",
      checkedAt: 1,
      pauseUntil: 0,
      updatedAt: 1,
    });
    return { privateDocumentId, publicDocumentId };
  });
  const privateKey = `evidence-document:${privateDocumentId}`;
  const publicKey = `evidence-document:${publicDocumentId}`;
  ragState.keys.add(privateKey);
  ragState.keys.add(publicKey);

  await expect(
    t.action(internal.semanticSearch.removeNonPublicEvidenceDocuments, {
      documentIds: [privateDocumentId, publicDocumentId, privateDocumentId],
    }),
  ).resolves.toEqual({ attempted: 1, skipped: 1 });

  expect(ragState.deleted).toEqual([privateKey]);
  expect(ragState.keys).toEqual(new Set([publicKey]));
  const markers = await t.run((ctx) =>
    ctx.db.query("aiOperationalStates").collect(),
  );
  expect(markers.map((marker) => marker.key)).toEqual([
    `semantic-index-content:${publicDocumentId}:1:${OPENROUTER_EMBEDDING_MODEL}`,
  ]);
});

test("cleanup leaves current public vectors alone when the namespace is absent", async () => {
  const t = convexTest(schema, modules);
  const { documentId } = await t.run(async (ctx) => {
    const sourceId = await ctx.db.insert("evidenceSources", {
      sourceKey: "vector-cleanup-absent-namespace",
      name: "Vector cleanup source",
      sourceType: "manual",
      ingestionEnabled: true,
      baseUrl: "https://example.com/",
      homepageUrl: "https://example.com/",
      status: "active",
      licenseClass: "open",
      provenanceClass: "primary",
      visibility: "public",
      termsUrl: "https://example.com/terms",
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
    const documentId = await ctx.db.insert("evidenceDocuments", {
      sourceId,
      externalKey: "vector-cleanup:currently-public",
      canonicalUrl: "https://example.com/current",
      canonicalUrlHash: "vector-cleanup-current",
      kind: "document",
      visibility: "public",
      title: "Current public evidence",
      excerpt: "Public excerpt",
      searchText: "Public research",
      tags: [],
      authors: [],
      licenseClass: "open",
      currentVersionId: null,
      publishedAt: null,
      firstSeenAt: 1,
      updatedAt: 1,
    });
    return { documentId };
  });
  ragState.namespaceExists = false;

  await expect(
    t.action(internal.semanticSearch.removeNonPublicEvidenceDocuments, {
      documentIds: [documentId],
    }),
  ).resolves.toEqual({ attempted: 0, skipped: 1 });
  expect(ragState.deleted).toEqual([]);
});
