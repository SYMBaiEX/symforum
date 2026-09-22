/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { describe, expect, test } from "vitest";
import schema from "./schema";

const modules = {
  ...import.meta.glob("./**/*.ts"),
  ...import.meta.glob("./**/*.tsx"),
};
const benchmark = {
  run: makeFunctionReference<"mutation", any, any>(
    "evidenceBenchmarks:runDailyCitationCoverage",
  ),
  list: makeFunctionReference<"query", any, any>(
    "evidenceBenchmarks:listPublicRuns",
  ),
};

function setup() {
  return convexTest(schema, modules);
}

async function seed(t: ReturnType<typeof setup>) {
  return t.run(async (ctx) => {
    const sourceId = await ctx.db.insert("evidenceSources", {
      sourceKey: "fixture",
      name: "Fixture source",
      sourceType: "manual",
      ingestionEnabled: false,
      baseUrl: "https://example.com",
      homepageUrl: "https://example.com",
      status: "active",
      licenseClass: "attributed",
      provenanceClass: "official",
      visibility: "public",
      termsUrl: "https://example.com/terms",
      etag: "",
      lastModified: "",
      cursor: "",
      lastFetchedAt: 0,
      lastSucceededAt: 0,
      lastErrorAt: 0,
      lastErrorMessage: "",
      createdAt: 1,
      updatedAt: 1,
    });
    const documentId = await ctx.db.insert("evidenceDocuments", {
      sourceId,
      externalKey: "doc-1",
      canonicalUrl: "https://example.com/doc-1",
      canonicalUrlHash: "doc-1",
      kind: "document",
      visibility: "public",
      title: "Public evidence",
      excerpt: "Public excerpt",
      searchText: "Public evidence",
      tags: [],
      authors: [],
      licenseClass: "attributed",
      publishedAt: null,
      currentVersionId: null,
      firstSeenAt: 1,
      updatedAt: 1,
    });
    const versionId = await ctx.db.insert("evidenceDocumentVersions", {
      documentId,
      version: 1,
      contentHash: "doc-1-v1",
      title: "Public evidence",
      excerpt: "Public excerpt",
      searchText: "Public evidence",
      fetchedAt: 1,
      publishedAt: null,
      sourceRevision: "1",
      sourceUpdatedAt: 1,
      rawStorageId: null,
      retrievalUrl: "https://example.com/doc-1",
      licenseClass: "attributed",
      metadataJson: "{}",
      createdAt: 1,
    });
    await ctx.db.patch("evidenceDocuments", documentId, {
      currentVersionId: versionId,
    });
    const citedClaimId = await ctx.db.insert("evidenceClaims", {
      claimKey: "claim-cited",
      statement: "A public claim.",
      subjectEntityId: null,
      predicate: "hasEvidence",
      objectText: "yes",
      status: "supported",
      confidence: 1,
      visibility: "public",
      observedAt: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("evidenceClaimCitations", {
      claimId: citedClaimId,
      documentVersionId: versionId,
      citationKey: "citation-1",
      relation: "supports",
      locator: "p1",
      excerpt: "Public excerpt",
      confidence: 1,
      createdAt: 1,
    });
    await ctx.db.insert("evidenceClaims", {
      claimKey: "claim-uncited",
      statement: "Another public claim.",
      subjectEntityId: null,
      predicate: "hasEvidence",
      objectText: "unknown",
      status: "supported",
      confidence: 0.5,
      visibility: "public",
      observedAt: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("evidenceClaims", {
      claimKey: "claim-private",
      statement: "Private claim.",
      subjectEntityId: null,
      predicate: "hasEvidence",
      objectText: "secret",
      status: "supported",
      confidence: 1,
      visibility: "private",
      observedAt: 1,
      createdAt: 1,
      updatedAt: 1,
    });
  });
}

describe("evidence citation coverage benchmark", () => {
  test("excludes first-party evidence whose current forum owner cannot be resolved", async () => {
    const t = setup();
    await seed(t);
    await t.run(async (ctx) => {
      const document = (await ctx.db.query("evidenceDocuments").collect())[0]!;
      await ctx.db.patch("evidenceDocuments", document._id, {
        externalKey: "forum-research:missing-thread",
      });
    });
    const result = await t.mutation(benchmark.run, { dayKey: "2026-09-22" });
    const metrics = JSON.parse(result.metricsJson);
    expect(metrics.claims.cited).toBe(0);
    expect(metrics.currentVersionDocumentCoverage.current).toBe(0);
  });

  test("is deterministic, scores public claims, and emits one change/webhook", async () => {
    const t = setup();
    await seed(t);
    const first = await t.mutation(benchmark.run, { dayKey: "2026-08-16" });
    const second = await t.mutation(benchmark.run, { dayKey: "2026-08-16" });
    expect(second.runId).toBe(first.runId);
    expect(first.model).toBe("deterministic-rules-v1");
    expect(first.score).toBe(0.5);
    const metrics = JSON.parse(first.metricsJson) as Record<string, any>;
    expect(metrics.claims).toMatchObject({
      scanned: 2,
      cited: 1,
      truncated: false,
    });
    expect(metrics.currentVersionDocumentCoverage).toMatchObject({
      scanned: 1,
      current: 1,
      ratio: 1,
    });
    const counts = await t.run(async (ctx) => ({
      changes: (await ctx.db.query("evidenceChangeEvents").collect()).length,
      webhooks: (await ctx.db.query("apiWebhookEvents").collect()).length,
      runs: (await ctx.db.query("evidenceBenchmarkRuns").collect()).length,
    }));
    expect(counts).toEqual({ changes: 1, webhooks: 0, runs: 1 });
  });

  test("lists only public benchmark runs", async () => {
    const t = setup();
    await seed(t);
    await t.mutation(benchmark.run, { dayKey: "2026-08-16" });
    const rows = await t.query(benchmark.list, { limit: 10 });
    expect(rows).toHaveLength(1);
    expect(rows[0].runKey).toBe("evidence-citation-coverage:2026-08-16");
  });
});
