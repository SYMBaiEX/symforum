/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { register as registerMigrationsComponent } from "@convex-dev/migrations/test";
import { makeFunctionReference } from "convex/server";
import { describe, expect, test, vi } from "vitest";
import { WORKOS_GRANT_CLAIM } from "../lib/workos-config";
import schema from "./schema";
import {
  bumpEvidencePublicationEpoch,
  readEvidencePublicationEpoch,
} from "./evidencePublicationEpoch";

const modules = {
  ...import.meta.glob("./**/*.ts"),
  ...import.meta.glob("./**/*.tsx"),
};

function decodeExportCursorForTest(cursor: string) {
  const encoded = cursor
    .slice("e2.".length)
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const binary = atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "="));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
}

const jobs = {
  createResearch: makeFunctionReference<"mutation", any, any>(
    "evidenceJobs:createResearchJob",
  ),
  createExport: makeFunctionReference<"mutation", any, any>(
    "evidenceJobs:createExportJob",
  ),
  research: makeFunctionReference<"query", any, any>(
    "evidenceJobs:getResearchJob",
  ),
  artifact: makeFunctionReference<"query", any, any>(
    "evidenceJobs:getArtifact",
  ),
  resolveArtifact: makeFunctionReference<"query", any, any>(
    "evidenceJobs:resolveArtifactDownload",
  ),
  catalog: makeFunctionReference<"mutation", any, any>(
    "evidenceJobs:ensureCatalog",
  ),
  records: makeFunctionReference<"query", any, any>(
    "evidenceJobs:readExportDocuments",
  ),
  cleanup: makeFunctionReference<"mutation", any, any>(
    "evidenceJobs:cleanupExpiredArtifacts",
  ),
  cleanupVersions: makeFunctionReference<"mutation", any, any>(
    "evidenceJobs:cleanupDatasetVersions",
  ),
  versions: makeFunctionReference<"query", any, any>(
    "evidenceJobs:listDatasetVersions",
  ),
  versionDiff: makeFunctionReference<"query", any, any>(
    "evidenceJobs:diffDatasetVersions",
  ),
  completeExport: makeFunctionReference<"mutation", any, any>(
    "evidenceJobs:completeExportJob",
  ),
  completeResearch: makeFunctionReference<"mutation", any, any>(
    "evidenceJobs:completeResearchJob",
  ),
  claimResearch: makeFunctionReference<"mutation", any, any>(
    "evidenceJobs:claimResearchExecution",
  ),
  claimExport: makeFunctionReference<"mutation", any, any>(
    "evidenceJobs:claimExportExecution",
  ),
  beginResearch: makeFunctionReference<"mutation", any, any>(
    "evidenceJobs:beginResearchExecution",
  ),
  beginExport: makeFunctionReference<"mutation", any, any>(
    "evidenceJobs:beginExportExecution",
  ),
  legacyResearchInput: makeFunctionReference<"query", any, any>(
    "evidenceJobs:readResearchInput",
  ),
  legacyExportInput: makeFunctionReference<"query", any, any>(
    "evidenceJobs:readExportInput",
  ),
  markResearchRunning: makeFunctionReference<"mutation", any, any>(
    "evidenceJobs:markResearchRunning",
  ),
  failExport: makeFunctionReference<"mutation", any, any>(
    "evidenceJobs:failExportJob",
  ),
  runExport: makeFunctionReference<"action", any, any>(
    "evidenceJobActions:runExport",
  ),
  materializeSnapshot: makeFunctionReference<"action", any, any>(
    "evidenceJobActions:materializeDatasetSnapshot",
  ),
  materializeAllSnapshots: makeFunctionReference<"action", any, any>(
    "evidenceJobActions:materializeAllDatasetSnapshots",
  ),
  backfillExportDigests: makeFunctionReference<"mutation", any, any>(
    "migrations:backfillEvidenceDocumentExportDigests",
  ),
  backfillVersionExportDigests: makeFunctionReference<"mutation", any, any>(
    "migrations:backfillEvidenceDocumentVersionExportDigests",
  ),
  backfillEvidenceExportReadModels: makeFunctionReference<"mutation", any, any>(
    "migrations:backfillEvidenceExportReadModels",
  ),
  backfillAssessmentVisibilityDigests: makeFunctionReference<
    "mutation",
    any,
    any
  >("migrations:backfillResearchQualityAssessmentVisibilityDigests"),
} as const;
function setup() {
  const t = convexTest(schema, modules);
  registerMigrationsComponent(t);
  return t;
}
async function fixture(t: ReturnType<typeof setup>) {
  return t.run(async (ctx) => {
    const owner = await ctx.db.insert("users", {
      name: "Owner",
      username: "owner",
      usernameNormalized: "owner",
      role: "owner",
    });
    const other = await ctx.db.insert("users", {
      name: "Other",
      username: "other",
      usernameNormalized: "other",
      role: "reader",
    });
    const agent = await ctx.db.insert("users", {
      name: "Agent",
      username: "agent",
      usernameNormalized: "agent",
      role: "reader",
      isAgent: true,
      agentSlug: "agent",
      agentStatus: "active",
      agentScopes: ["evidence"],
      agentKeyVersion: 1,
      agentEnrolledAt: 1,
    });
    await ctx.db.insert("agentIdentities", {
      agentId: "agent",
      userId: agent,
      ownerUserId: owner,
      publicKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      scopes: ["evidence"],
      status: "active",
      keyVersion: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    return { owner, other, agent };
  });
}
async function completeOwnedExport(
  t: ReturnType<typeof setup>,
  args: Record<string, unknown> & { jobId: string },
) {
  const claim = await t.mutation(jobs.claimExport, { jobId: args.jobId });
  expect(claim).toMatchObject({ executionToken: expect.any(String) });
  return await t.mutation(jobs.completeExport, {
    ...args,
    executionToken: claim.executionToken,
  });
}
describe("evidence jobs", () => {
  test("revokes old research downloads and inline results while allowing newly generated results", async () => {
    const t = setup();
    const { owner, agent } = await fixture(t);
    await t.mutation(jobs.catalog, {});
    const createAndComplete = async (key: string) => {
      const job = await t.mutation(jobs.createResearch, {
        ownerUserId: owner,
        agentId: "agent",
        query: "public research",
        idempotencyKey: key,
        requestFingerprint: key,
        quotaUnits: 1,
      });
      const claim = await t.mutation(jobs.claimResearch, { jobId: job.jobId });
      const storageId = await t.run((ctx) =>
        ctx.storage.store(new Blob(["{}"], { type: "application/json" })),
      );
      await t.mutation(jobs.completeResearch, {
        jobId: job.jobId,
        executionToken: claim.executionToken,
        resultJson: "{}",
        resultStorageId: storageId,
        artifactContentType: "application/json",
        artifactByteLength: 2,
        artifactSha256: "hash",
      });
      return job.jobId;
    };
    const oldJobId = await createAndComplete("old");
    // Legacy unstamped results remain valid at epoch zero.
    await t.run((ctx) =>
      ctx.db.patch("evidenceResearchJobs", oldJobId, {
        publicationEpoch: undefined,
      }),
    );
    expect(
      await t.query(jobs.resolveArtifact, {
        agentUserId: agent,
        kind: "research",
        researchJobId: oldJobId,
      }),
    ).not.toBeNull();
    expect(await t.run((ctx) => bumpEvidencePublicationEpoch(ctx))).toBe(1);
    expect(
      await t.query(jobs.resolveArtifact, {
        agentUserId: agent,
        kind: "research",
        researchJobId: oldJobId,
      }),
    ).toBeNull();
    expect(
      await t.query(jobs.artifact, {
        ownerUserId: owner,
        researchJobId: oldJobId,
      }),
    ).toBeNull();
    expect(
      await t.query(jobs.research, { ownerUserId: owner, jobId: oldJobId }),
    ).toBeNull();
    const newJobId = await createAndComplete("new");
    expect(
      await t.query(jobs.resolveArtifact, {
        agentUserId: agent,
        kind: "research",
        researchJobId: newJobId,
      }),
    ).not.toBeNull();
  });

  test("fences queued and running jobs across publication changes", async () => {
    const t = setup();
    const { owner } = await fixture(t);
    const catalog = await t.mutation(jobs.catalog, {});
    const research = await t.mutation(jobs.createResearch, {
      ownerUserId: owner,
      agentId: "agent",
      query: "research",
      idempotencyKey: "race-research",
      requestFingerprint: "race-research",
      quotaUnits: 1,
    });
    const exporting = await t.mutation(jobs.createExport, {
      ownerUserId: owner,
      agentId: "agent",
      datasetId: catalog.datasetId,
      format: "jsonl",
      idempotencyKey: "race-export",
      requestFingerprint: "race-export",
      quotaUnits: 1,
    });
    const queued = await t.mutation(jobs.createResearch, {
      ownerUserId: owner,
      agentId: "agent",
      query: "queued",
      idempotencyKey: "queued",
      requestFingerprint: "queued",
      quotaUnits: 1,
    });
    const researchClaim = await t.mutation(jobs.claimResearch, {
      jobId: research.jobId,
    });
    const exportClaim = await t.mutation(jobs.claimExport, {
      jobId: exporting.jobId,
    });
    await t.mutation(jobs.beginResearch, {
      jobId: research.jobId,
      executionToken: researchClaim.executionToken,
    });
    await t.mutation(jobs.beginExport, {
      jobId: exporting.jobId,
      executionToken: exportClaim.executionToken,
    });
    await t.run((ctx) => bumpEvidencePublicationEpoch(ctx));
    expect(
      await t.mutation(jobs.claimResearch, { jobId: queued.jobId }),
    ).toBeNull();
    await t.mutation(jobs.completeResearch, {
      jobId: research.jobId,
      executionToken: researchClaim.executionToken,
      resultJson: '{"private":"must not publish"}',
    });
    const staleBlob = await t.run((ctx) =>
      ctx.storage.store(
        new Blob(["private"], { type: "application/x-ndjson" }),
      ),
    );
    await t.mutation(jobs.completeExport, {
      jobId: exporting.jobId,
      executionToken: exportClaim.executionToken,
      resultJson: "{}",
      resultStorageId: staleBlob,
      datasetManifestStorageId: staleBlob,
      checksum: "stale",
      recordCount: 1,
      artifactContentType: "application/x-ndjson",
      artifactByteLength: 7,
    });
    await t.run(async (ctx) => {
      expect(
        await ctx.db.get("evidenceResearchJobs", research.jobId),
      ).toMatchObject({ status: "failed", resultJson: "" });
      expect(
        await ctx.db.get("evidenceResearchJobs", queued.jobId),
      ).toMatchObject({ status: "failed" });
      expect(
        await ctx.db.get("evidenceExportJobs", exporting.jobId),
      ).toMatchObject({ status: "failed" });
      expect(await ctx.storage.get(staleBlob)).toBeNull();
      expect(await ctx.db.query("evidenceDatasetVersions").take(1)).toEqual([]);
    });
  });

  test("revokes historical dataset downloads and renews only freshly materialized snapshots", async () => {
    const t = setup();
    const { agent } = await fixture(t);
    const catalog = await t.mutation(jobs.catalog, {});
    const first = await t.action(jobs.materializeSnapshot, {
      datasetId: catalog.datasetId,
    });
    const resolveVersion = makeFunctionReference<"query", any, any>(
      "evidenceJobs:resolveDatasetVersionDownload",
    );
    const download = {
      agentUserId: agent,
      datasetId: catalog.datasetId,
      versionId: first.versionId,
      kind: "artifact",
    };
    expect(await t.query(resolveVersion, download)).not.toBeNull();
    await t.run((ctx) => bumpEvidencePublicationEpoch(ctx));
    expect(await t.query(resolveVersion, download)).toBeNull();
    expect(
      await t.query(resolveVersion, { ...download, kind: "manifest" }),
    ).toBeNull();
    const refreshed = await t.action(jobs.materializeSnapshot, {
      datasetId: catalog.datasetId,
    });
    expect(refreshed.created).toBe(true);
    expect(
      await t.query(resolveVersion, {
        ...download,
        versionId: refreshed.versionId,
      }),
    ).not.toBeNull();
    await t.run(async (ctx) => {
      expect(
        await ctx.db.get("evidenceDatasetVersions", refreshed.versionId),
      ).toMatchObject({
        publicationEpoch: await readEvidencePublicationEpoch(ctx),
      });
    });
  });

  test("rejects system snapshot completion if publication changed after its read", async () => {
    const t = setup();
    await fixture(t);
    const catalog = await t.mutation(jobs.catalog, {});
    const input = await t.query(jobs.records, { datasetId: catalog.datasetId });
    const blob = await t.run((ctx) =>
      ctx.storage.store(new Blob(["{}"], { type: "application/json" })),
    );
    await t.run((ctx) => bumpEvidencePublicationEpoch(ctx));
    const record = makeFunctionReference<"mutation", any, any>(
      "evidenceJobs:recordSystemDatasetSnapshot",
    );
    await expect(
      t.mutation(record, {
        publicationEpoch: input.publicationEpoch,
        datasetId: catalog.datasetId,
        checksum: "stale",
        recordCount: 0,
        schemaVersion: "v3",
        artifactByteLength: 2,
        sourceCount: 0,
        configuredSourceCount: 0,
        sourceCoverageScore: 0,
        missingSourceKeys: [],
        citationCount: 0,
        citationCoverageScore: 0,
        entityCount: 0,
        entityCoverageScore: 0,
        claimCount: 0,
        claimCoverageScore: 0,
        completenessScore: 0,
        freshnessScore: 0,
        qualityMetricsJson: "{}",
        manifestStorageId: blob,
        artifactStorageId: blob,
      }),
    ).rejects.toThrow("EVIDENCE_PUBLICATION_CHANGED");
    expect(
      await t.run((ctx) => ctx.db.query("evidenceDatasetVersions").take(1)),
    ).toEqual([]);
  });

  test("materializes idempotent code-owned dataset snapshots", async () => {
    const t = setup();
    await fixture(t);
    const catalog = await t.mutation(jobs.catalog, {});
    const first = await t.action(jobs.materializeSnapshot, {
      datasetId: catalog.datasetId,
    });
    const replay = await t.action(jobs.materializeSnapshot, {
      datasetId: catalog.datasetId,
    });
    expect(first).toMatchObject({ created: true, recordCount: 0 });
    expect(replay).toMatchObject({
      created: false,
      versionId: first.versionId,
      checksum: first.checksum,
    });
    await expect(t.action(jobs.materializeAllSnapshots, {})).resolves.toEqual({
      datasets: 4,
      created: 3,
      unchanged: 1,
      records: 0,
    });
    await t.run(async (ctx) => {
      const versions = await ctx.db
        .query("evidenceDatasetVersions")
        .withIndex("by_datasetId_and_version", (q) =>
          q.eq("datasetId", catalog.datasetId),
        )
        .collect();
      expect(versions).toHaveLength(1);
      expect(versions[0]).toMatchObject({
        schemaVersion: "symbaiex-evidence-document-v3",
        configuredSourceCount: 0,
        sourceCount: 0,
        sourceCoverageScore: 100,
        missingSourceKeys: [],
        citationCoverageScore: 0,
        entityCoverageScore: 0,
        claimCoverageScore: 0,
        artifactStorageId: expect.any(String),
        manifestStorageId: expect.any(String),
      });
    });
  });

  test("creates, replays, rejects mismatch, and isolates owners", async () => {
    const t = setup();
    const { owner, other } = await fixture(t);
    const args = {
      ownerUserId: owner,
      agentId: "agent",
      query: "model release",
      idempotencyKey: "research-1",
      requestFingerprint: "fingerprint-1",
      quotaUnits: 1,
    };
    const first = await t.mutation(jobs.createResearch, args);
    await expect(t.mutation(jobs.createResearch, args)).resolves.toMatchObject({
      jobId: first.jobId,
      idempotent: true,
    });
    await expect(
      t.mutation(jobs.createResearch, {
        ...args,
        requestFingerprint: "different",
      }),
    ).rejects.toThrow(/different request fingerprint/i);
    await expect(
      t.query(jobs.research, { ownerUserId: other, jobId: first.jobId }),
    ).resolves.toBeNull();
  });
  test("seeds a disabled catalog and bounds public export records", async () => {
    const t = setup();
    const ids = await fixture(t);
    const catalog = await t.mutation(jobs.catalog, {});
    await t.run(async (ctx) => {
      const source = await ctx.db.insert("evidenceSources", {
        sourceKey: "source",
        name: "Source",
        sourceType: "manual",
        ingestionEnabled: false,
        baseUrl: "https://example.com",
        homepageUrl: "https://example.com",
        status: "active",
        licenseClass: "open",
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
        sourceId: source,
        externalKey: "one",
        canonicalUrl: "https://example.com/one",
        canonicalUrlHash: "one",
        kind: "document",
        visibility: "public",
        title: "Public",
        excerpt: "excerpt",
        searchText: "public",
        tags: [],
        authors: [],
        licenseClass: "open",
        currentVersionId: null,
        publishedAt: null,
        firstSeenAt: 1,
        updatedAt: 1,
      });
      const versionId = await ctx.db.insert("evidenceDocumentVersions", {
        documentId,
        version: 1,
        contentHash: "content-hash",
        title: "Public",
        excerpt: "excerpt",
        searchText: "public",
        fetchedAt: 1,
        publishedAt: null,
        sourceRevision: "revision-1",
        sourceUpdatedAt: 1,
        rawStorageId: null,
        retrievalUrl: "https://example.com/one",
        licenseClass: "open",
        metadataJson: "{}",
        createdAt: 1,
      });
      await ctx.db.patch("evidenceDocuments", documentId, {
        currentVersionId: versionId,
      });
      const entityId = await ctx.db.insert("evidenceEntities", {
        entityKey: "concept:public-test",
        kind: "concept",
        name: "Public test",
        aliases: [],
        visibility: "public",
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("evidenceDocumentEntities", {
        documentVersionId: versionId,
        entityId,
        role: "subject",
        createdAt: 1,
      });
      const claimId = await ctx.db.insert("evidenceClaims", {
        claimKey: "claim:public-test",
        statement: "The public test exists.",
        subjectEntityId: entityId,
        predicate: "exists",
        objectText: "true",
        status: "supported",
        confidence: 1,
        visibility: "public",
        observedAt: 1,
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("evidenceClaimCitations", {
        claimId,
        documentVersionId: versionId,
        citationKey: "claim:public-test:version:1",
        relation: "supports",
        locator: "https://example.com/one",
        excerpt: "excerpt",
        confidence: 1,
        createdAt: 1,
      });
    });
    const bundle = await t.query(jobs.records, {
      datasetId: catalog.datasetId,
      limit: 999,
    });
    expect(bundle).toMatchObject({
      dataset: {
        datasetKey: "ai-systems-evidence",
        exportSchemaVersion: "symbaiex-evidence-document-v3",
      },
      scannedRecordCount: 1,
      selectionScanTruncated: false,
    });
    expect(bundle.records[0]).toEqual(
      expect.objectContaining({
        schemaVersion: "symbaiex-evidence-document-v3",
        title: "Public",
        excerpt: "excerpt",
        source: expect.objectContaining({ sourceKey: "source" }),
        entities: [
          expect.objectContaining({
            entityKey: "concept:public-test",
            role: "subject",
          }),
        ],
        claims: [
          expect.objectContaining({
            claimKey: "claim:public-test",
            relation: "supports",
          }),
        ],
      }),
    );
    expect(bundle.records[0]?.version).toEqual({
      version: 1,
      contentHash: "content-hash",
      fetchedAt: 1,
      sourceRevision: "revision-1",
      sourceUpdatedAt: 1,
      retrievalUrl: "https://example.com/one",
      metadataJson: "{}",
    });
    expect(JSON.stringify(bundle.records[0])).not.toContain("rawStorageId");
    await expect(
      t.mutation(jobs.createExport, {
        ownerUserId: ids.other,
        agentId: "agent",
        datasetId: catalog.datasetId,
        format: "jsonl",
        idempotencyKey: "export-1",
        requestFingerprint: "export-one",
        quotaUnits: 1,
      }),
    ).rejects.toThrow(/owned/i);
    const exportJob = await t.mutation(jobs.createExport, {
      ownerUserId: ids.owner,
      agentId: "agent",
      datasetId: catalog.datasetId,
      format: "jsonl",
      idempotencyKey: "export-owner-1",
      requestFingerprint: "export-owner-one",
      quotaUnits: 1,
      recordLimit: 250,
    });
    await expect(
      t.query(jobs.legacyExportInput, { jobId: exportJob.jobId }),
    ).resolves.toMatchObject({ recordLimit: 250 });
    const storageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(['{"record":1}\n'])),
    );
    const datasetManifestStorageId = await t.run(async (ctx) =>
      ctx.storage.store(
        new Blob(['{"format":"jsonl"}'], { type: "application/json" }),
      ),
    );
    await completeOwnedExport(t, {
      jobId: exportJob.jobId,
      resultJson: JSON.stringify({ recordCount: 1 }),
      resultStorageId: storageId,
      datasetManifestStorageId,
      checksum: "checksum-one",
      recordCount: 1,
      artifactContentType: "application/x-ndjson",
      artifactByteLength: 13,
    });
    await t.run(async (ctx) => {
      const version = await ctx.db
        .query("evidenceDatasetVersions")
        .withIndex("by_datasetId_and_checksum", (q) =>
          q.eq("datasetId", catalog.datasetId).eq("checksum", "checksum-one"),
        )
        .unique();
      expect(version).toMatchObject({
        datasetId: catalog.datasetId,
        checksum: "checksum-one",
        recordCount: 1,
      });
      expect(version?.manifestStorageId).toBe(datasetManifestStorageId);
      expect(version?.manifestStorageId).not.toBe(storageId);
    });
  });

  test("pins export cursors to their read model across digest backfill", async () => {
    const t = setup();
    await fixture(t);
    const catalog = await t.mutation(jobs.catalog, {});
    const documents = await t.run(async (ctx) => {
      const sourceId = await ctx.db.insert("evidenceSources", {
        sourceKey: "cursor-source",
        name: "Cursor source",
        sourceType: "manual",
        ingestionEnabled: false,
        baseUrl: "https://cursor.example.com",
        homepageUrl: "https://cursor.example.com",
        status: "active",
        licenseClass: "open",
        provenanceClass: "official",
        visibility: "public",
        termsUrl: "https://cursor.example.com/terms",
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
      return await Promise.all(
        ["First", "Second"].map((title) =>
          ctx.db
            .insert("evidenceDocuments", {
              sourceId,
              externalKey: title.toLowerCase(),
              canonicalUrl: `https://cursor.example.com/${title.toLowerCase()}`,
              canonicalUrlHash: title.toLowerCase(),
              kind: "document",
              visibility: "public",
              title,
              excerpt: `${title} excerpt`,
              searchText: `${title} large searchable body`.repeat(200),
              tags: [],
              authors: [],
              licenseClass: "open",
              currentVersionId: null,
              publishedAt: null,
              firstSeenAt: 1,
              updatedAt: 1,
            })
            .then((documentId) => ({ documentId, title })),
        ),
      );
    });

    const firstPage = await t.query(jobs.records, {
      datasetId: catalog.datasetId,
      limit: 1,
    });
    const firstRecentPage = await t.query(jobs.records, {
      datasetId: catalog.datasetId,
      limit: 1,
      selectionStrategy: "recent",
    });
    expect(firstPage.records).toHaveLength(1);
    expect(firstPage.continueCursor).toBeTypeOf("string");
    expect(firstRecentPage.continueCursor).toBeTypeOf("string");
    expect(decodeExportCursorForTest(firstPage.continueCursor!)).toMatchObject({
      documentReadModel: "canonical",
      compactForumAssessment: false,
    });
    expect(
      decodeExportCursorForTest(firstRecentPage.continueCursor!),
    ).toMatchObject({
      documentReadModel: "canonical",
      compactForumAssessment: false,
    });

    // Complete backfill and alter a test-only digest sentinel to prove the
    // old cursor still reads its original canonical index, then new exports
    // switch to the compact projection.
    await t.mutation(jobs.backfillExportDigests, {});
    const secondDocument = documents.find(
      ({ documentId }) => documentId !== firstPage.records[0]?.documentId,
    )!;
    const secondDocumentId = secondDocument.documentId;
    await t.run(async (ctx) => {
      const digest = await ctx.db
        .query("evidenceDocumentExportDigests")
        .withIndex("by_documentId", (q) => q.eq("documentId", secondDocumentId))
        .unique();
      expect(digest).not.toBeNull();
      await ctx.db.patch("evidenceDocumentExportDigests", digest!._id, {
        title: "Digest-only sentinel",
      });
    });

    const continuedPage = await t.query(jobs.records, {
      datasetId: catalog.datasetId,
      limit: 1,
      cursor: firstPage.continueCursor,
    });
    expect(continuedPage.records).toMatchObject([
      { documentId: secondDocumentId, title: secondDocument.title },
    ]);
    const continuedRecentPage = await t.query(jobs.records, {
      datasetId: catalog.datasetId,
      limit: 1,
      selectionStrategy: "recent",
      cursor: firstRecentPage.continueCursor,
    });
    expect(continuedRecentPage.records).toMatchObject([
      { documentId: secondDocumentId, title: secondDocument.title },
    ]);

    const freshPage = await t.query(jobs.records, {
      datasetId: catalog.datasetId,
      limit: 2,
    });
    expect(
      freshPage.records.find(
        (record: { documentId: typeof secondDocumentId }) =>
          record.documentId === secondDocumentId,
      )?.title,
    ).toBe("Digest-only sentinel");
    const freshRecentPage = await t.query(jobs.records, {
      datasetId: catalog.datasetId,
      limit: 2,
      selectionStrategy: "recent",
    });
    expect(
      freshRecentPage.records.find(
        (record: { documentId: typeof secondDocumentId }) =>
          record.documentId === secondDocumentId,
      )?.title,
    ).toBe("Digest-only sentinel");
  });

  test("backfills and prefers compact version export digests for legacy rows", async () => {
    const t = setup();
    await fixture(t);
    const catalog = await t.mutation(jobs.catalog, {});
    const versionId = await t.run(async (ctx) => {
      const sourceId = await ctx.db.insert("evidenceSources", {
        sourceKey: "digest-source",
        name: "Digest source",
        sourceType: "manual",
        ingestionEnabled: false,
        baseUrl: "https://digest.example.com",
        homepageUrl: "https://digest.example.com",
        status: "active",
        licenseClass: "open",
        provenanceClass: "official",
        visibility: "public",
        termsUrl: "https://digest.example.com/terms",
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
        externalKey: "digest-record",
        canonicalUrl: "https://digest.example.com/record",
        canonicalUrlHash: "digest-record",
        kind: "document",
        visibility: "public",
        title: "Digest record",
        excerpt: "The compact document excerpt.",
        searchText: "digest searchable text",
        tags: [],
        authors: [],
        licenseClass: "open",
        currentVersionId: null,
        publishedAt: null,
        firstSeenAt: 1,
        updatedAt: 1,
      });
      const versionId = await ctx.db.insert("evidenceDocumentVersions", {
        documentId,
        version: 3,
        contentHash: "canonical-hash",
        title: "Digest record",
        excerpt: "The compact document excerpt.",
        searchText: "large canonical search text",
        fetchedAt: 10,
        publishedAt: null,
        sourceRevision: "canonical-revision",
        sourceUpdatedAt: 11,
        rawStorageId: null,
        retrievalUrl: "https://digest.example.com/record",
        licenseClass: "open",
        metadataJson: "canonical-metadata",
        createdAt: 12,
      });
      await ctx.db.patch("evidenceDocuments", documentId, {
        currentVersionId: versionId,
      });
      return versionId;
    });

    await t.mutation(jobs.backfillEvidenceExportReadModels, {});
    await t.run(async (ctx) => {
      // Make canonical fallback observable: once the migration has materialized
      // the compact row, export should keep reading that stable projection.
      const version = await ctx.db.get("evidenceDocumentVersions", versionId);
      expect(version).not.toBeNull();
      await ctx.db.patch("evidenceDocumentVersions", version!._id, {
        metadataJson: "canonical-only-sentinel",
      });
    });

    const bundle = await t.query(jobs.records, {
      datasetId: catalog.datasetId,
      limit: 10,
    });

    expect(bundle.records).toHaveLength(1);
    expect(bundle.records[0]?.version).toEqual({
      version: 3,
      contentHash: "canonical-hash",
      fetchedAt: 10,
      sourceRevision: "canonical-revision",
      sourceUpdatedAt: 11,
      retrievalUrl: "https://digest.example.com/record",
      metadataJson: "canonical-metadata",
    });
  });

  test("exports shared claims and entities from repeated source links", async () => {
    const t = setup();
    await fixture(t);
    const catalog = await t.mutation(jobs.catalog, {});
    await t.run(async (ctx) => {
      const sourceId = await ctx.db.insert("evidenceSources", {
        sourceKey: "shared-source",
        name: "Shared source",
        sourceType: "manual",
        ingestionEnabled: false,
        baseUrl: "https://example.com",
        homepageUrl: "https://example.com",
        status: "active",
        licenseClass: "open",
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
      const entityId = await ctx.db.insert("evidenceEntities", {
        entityKey: "concept:shared-public-test",
        kind: "concept",
        name: "Shared public test",
        aliases: [],
        visibility: "public",
        createdAt: 1,
        updatedAt: 1,
      });
      const privateEntityId = await ctx.db.insert("evidenceEntities", {
        entityKey: "concept:private-export-test",
        kind: "concept",
        name: "Private export test",
        aliases: [],
        visibility: "private",
        createdAt: 1,
        updatedAt: 1,
      });
      const claimId = await ctx.db.insert("evidenceClaims", {
        claimKey: "claim:shared-public-test",
        statement: "The shared public test exists.",
        subjectEntityId: entityId,
        predicate: "exists",
        objectText: "true",
        status: "supported",
        confidence: 1,
        visibility: "public",
        observedAt: 1,
        createdAt: 1,
        updatedAt: 1,
      });
      for (const name of ["First", "Second"]) {
        const documentId = await ctx.db.insert("evidenceDocuments", {
          sourceId,
          externalKey: name.toLowerCase(),
          canonicalUrl: `https://example.com/${name.toLowerCase()}`,
          canonicalUrlHash: name.toLowerCase(),
          kind: "document",
          visibility: "public",
          title: name,
          excerpt: "Shared evidence",
          searchText: name,
          tags: [],
          authors: [],
          licenseClass: "open",
          currentVersionId: null,
          publishedAt: null,
          firstSeenAt: 1,
          updatedAt: name === "First" ? 2 : 1,
        });
        const versionId = await ctx.db.insert("evidenceDocumentVersions", {
          documentId,
          version: 1,
          contentHash: `${name}-hash`,
          title: name,
          excerpt: "Shared evidence",
          searchText: name,
          fetchedAt: 1,
          publishedAt: null,
          sourceRevision: "revision-1",
          sourceUpdatedAt: 1,
          rawStorageId: null,
          retrievalUrl: `https://example.com/${name.toLowerCase()}`,
          licenseClass: "open",
          metadataJson: "{}",
          createdAt: 1,
        });
        await ctx.db.patch("evidenceDocuments", documentId, {
          currentVersionId: versionId,
        });
        await ctx.db.insert("evidenceDocumentEntities", {
          documentVersionId: versionId,
          entityId,
          role: "subject",
          createdAt: 1,
        });
        await ctx.db.insert("evidenceDocumentEntities", {
          documentVersionId: versionId,
          entityId: privateEntityId,
          role: "mentioned",
          createdAt: 1,
        });
        await ctx.db.insert("evidenceClaimCitations", {
          claimId,
          documentVersionId: versionId,
          citationKey: `claim:shared-public-test:${name.toLowerCase()}`,
          relation: "supports",
          locator: `https://example.com/${name.toLowerCase()}`,
          excerpt: "Shared evidence",
          confidence: 1,
          createdAt: 1,
        });
      }
    });

    const bundle = await t.query(jobs.records, {
      datasetId: catalog.datasetId,
      limit: 10,
    });

    expect(bundle.records).toHaveLength(2);
    expect(bundle.records.map((record: any) => record.title)).toEqual([
      "First",
      "Second",
    ]);
    for (const record of bundle.records) {
      expect(record.entities).toMatchObject([
        { entityKey: "concept:shared-public-test", role: "subject" },
      ]);
      expect(
        record.entities.map(
          (entity: { entityKey: string }) => entity.entityKey,
        ),
      ).toEqual(["concept:shared-public-test"]);
      expect(record.claims).toMatchObject([
        {
          claimKey: "claim:shared-public-test",
          relation: "supports",
        },
      ]);
    }
  });

  test("chunks large exports under per-query read budgets without losing cursor continuity", async () => {
    const t = setup();
    const { owner } = await fixture(t);
    const seeded = await t.run(async (ctx) => {
      const now = Date.now();
      const datasetId = await ctx.db.insert("evidenceDatasets", {
        datasetKey: "chunked-export-test",
        name: "Chunked export test",
        description: "Dataset for bounded export-query pages",
        visibility: "public",
        licenseClass: "open",
        includedKinds: ["document"],
        includedLicenseClasses: ["open"],
        sourceKeys: ["chunked-export-source"],
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      const sourceId = await ctx.db.insert("evidenceSources", {
        sourceKey: "chunked-export-source",
        name: "Chunked export source",
        sourceType: "manual",
        ingestionEnabled: false,
        baseUrl: "https://example.com",
        homepageUrl: "https://example.com",
        status: "active",
        licenseClass: "open",
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
        createdAt: now,
        updatedAt: now,
      });
      for (let index = 0; index < 250; index += 1)
        await ctx.db.insert("evidenceDocuments", {
          sourceId,
          externalKey: `chunked-${index}`,
          canonicalUrl: `https://example.com/chunked/${index}`,
          canonicalUrlHash: `chunked-${index}`,
          kind: "document",
          visibility: "public",
          title: `Chunked ${index}`,
          excerpt: "Bounded export fixture",
          searchText: `Chunked ${index}`,
          tags: [],
          authors: [],
          licenseClass: "open",
          currentVersionId: null,
          publishedAt: null,
          firstSeenAt: now - index,
          updatedAt: now - index,
        });
      return datasetId;
    });

    const snapshot = await t.action(jobs.materializeSnapshot, {
      datasetId: seeded,
    });
    expect(snapshot).toMatchObject({ created: true, recordCount: 100 });
    const snapshotArtifact = await t.run(async (ctx) => {
      const version = await ctx.db.get(
        "evidenceDatasetVersions",
        snapshot.versionId,
      );
      return version === null || version.artifactStorageId === undefined
        ? null
        : ((await ctx.storage.get(version.artifactStorageId))?.text() ?? null);
    });
    expect(snapshotArtifact).not.toBeNull();
    expect(snapshotArtifact!.trim().split("\n")).toHaveLength(100);

    const runPage = async (cursor: string | undefined, recordLimit: number) => {
      const job = await t.mutation(jobs.createExport, {
        ownerUserId: owner,
        agentId: "agent",
        datasetId: seeded,
        format: "jsonl",
        recordLimit,
        selectionStrategy: "recent",
        ...(cursor === undefined ? {} : { cursor }),
        idempotencyKey:
          cursor === undefined ? "chunked-export-first" : "chunked-export-next",
        requestFingerprint:
          cursor === undefined ? "chunked-export-first" : "chunked-export-next",
        quotaUnits: 1,
      });
      const claim = await t.mutation(jobs.claimExport, { jobId: job.jobId });
      expect(claim).toMatchObject({ executionToken: expect.any(String) });
      const result = await t.action(jobs.runExport, {
        jobId: job.jobId,
        executionToken: claim!.executionToken,
      });
      expect(result).toMatchObject({ started: true });
      if (!result.started) throw new Error("Export unexpectedly did not start");
      const artifact = await t.run(
        async (ctx) =>
          (await ctx.storage.get(result.resultStorageId))?.text() ?? null,
      );
      expect(artifact).not.toBeNull();
      const records = artifact!
        .trim()
        .split("\n")
        .map(
          (line) => JSON.parse(line) as { documentId: string; title: string },
        );
      return { result, records };
    };

    const first = await runPage(undefined, 205);
    expect(first.result).toMatchObject({
      recordCount: 205,
      scannedRecordCount: 205,
      selectionScanTruncated: true,
      continueCursor: expect.any(String),
    });
    expect(first.records).toHaveLength(205);

    const next = await runPage(first.result.continueCursor, 100);
    expect(next.result).toMatchObject({
      recordCount: 45,
      scannedRecordCount: 45,
      selectionScanTruncated: false,
    });
    expect(next.result).not.toHaveProperty("continueCursor");
    expect(next.records).toHaveLength(45);
    const allRecords = [...first.records, ...next.records];
    expect(new Set(allRecords.map((record) => record.documentId)).size).toBe(
      250,
    );
    expect(allRecords.map((record) => record.title)).toContain("Chunked 249");
  });

  test("keeps small snapshot pages balanced across configured sources", async () => {
    const t = setup();
    await fixture(t);
    const sourceKeys = [
      "snapshot-a",
      "snapshot-b",
      "snapshot-c",
      "snapshot-d",
      "snapshot-e",
      "snapshot-f",
    ];
    const datasetId = await t.run(async (ctx) => {
      const now = Date.now();
      const datasetId = await ctx.db.insert("evidenceDatasets", {
        datasetKey: "balanced-snapshot-test",
        name: "Balanced snapshot test",
        description:
          "Verify small snapshot pages preserve cross-source balance",
        visibility: "public",
        licenseClass: "open",
        includedKinds: ["document"],
        includedLicenseClasses: ["open"],
        sourceKeys,
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      for (const sourceKey of sourceKeys) {
        const sourceId = await ctx.db.insert("evidenceSources", {
          sourceKey,
          name: sourceKey,
          sourceType: "manual",
          ingestionEnabled: false,
          baseUrl: `https://${sourceKey}.example.com`,
          homepageUrl: `https://${sourceKey}.example.com`,
          status: "active",
          licenseClass: "open",
          provenanceClass: "official",
          visibility: "public",
          termsUrl: `https://${sourceKey}.example.com/terms`,
          etag: "",
          lastModified: "",
          cursor: "",
          lastFetchedAt: 0,
          lastSucceededAt: 0,
          lastErrorAt: 0,
          lastErrorMessage: "",
          createdAt: now,
          updatedAt: now,
        });
        for (let index = 0; index < 20; index += 1)
          await ctx.db.insert("evidenceDocuments", {
            sourceId,
            externalKey: `${sourceKey}-${index}`,
            canonicalUrl: `https://${sourceKey}.example.com/${index}`,
            canonicalUrlHash: `${sourceKey}-${index}`,
            kind: "document",
            visibility: "public",
            title: `${sourceKey} ${index}`,
            excerpt: "Balanced snapshot fixture",
            searchText: `${sourceKey} ${index}`,
            tags: [],
            authors: [],
            licenseClass: "open",
            currentVersionId: null,
            publishedAt: null,
            firstSeenAt: now - index,
            updatedAt: now - index,
          });
      }
      return datasetId;
    });

    const snapshot = await t.action(jobs.materializeSnapshot, { datasetId });
    expect(snapshot).toMatchObject({ created: true, recordCount: 100 });
    const artifact = await t.run(async (ctx) => {
      const version = await ctx.db.get(
        "evidenceDatasetVersions",
        snapshot.versionId,
      );
      return version?.artifactStorageId === undefined
        ? null
        : ((await ctx.storage.get(version.artifactStorageId))?.text() ?? null);
    });
    expect(artifact).not.toBeNull();
    const records = artifact!
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { source: { sourceKey: string } });
    const counts = new Map<string, number>();
    for (const record of records)
      counts.set(
        record.source.sourceKey,
        (counts.get(record.source.sourceKey) ?? 0) + 1,
      );
    expect(sourceKeys.map((sourceKey) => counts.get(sourceKey))).toEqual([
      17, 17, 17, 17, 16, 16,
    ]);
  });

  test("keeps commercial dataset selections distinct", async () => {
    const t = setup();
    const { agent } = await fixture(t);
    await t.mutation(jobs.catalog, {});
    const datasetIds = await t.run(async (ctx) => {
      const now = 1;
      const insertSource = async (sourceKey: string) =>
        await ctx.db.insert("evidenceSources", {
          sourceKey,
          name: sourceKey,
          sourceType: "api",
          ingestionEnabled: true,
          baseUrl: `https://${sourceKey}.example.com`,
          homepageUrl: `https://${sourceKey}.example.com`,
          status: "active",
          licenseClass: "open",
          provenanceClass: "official",
          visibility: "public",
          termsUrl: `https://${sourceKey}.example.com/terms`,
          etag: "",
          lastModified: "",
          cursor: "",
          lastFetchedAt: now,
          lastSucceededAt: now,
          lastErrorAt: 0,
          lastErrorMessage: "",
          createdAt: now,
          updatedAt: now,
        });
      const cisa = await insertSource("cisa-kev");
      const releases = await insertSource("github-releases-openai-openai-node");
      for (const [sourceId, externalKey, kind] of [
        [cisa, "CVE-TEST", "advisory"],
        [releases, "release-1", "release"],
      ] as const) {
        await ctx.db.insert("evidenceDocuments", {
          sourceId,
          externalKey,
          canonicalUrl: `https://example.com/${externalKey}`,
          canonicalUrlHash: externalKey,
          kind,
          visibility: "public",
          title: externalKey,
          excerpt: `${kind} excerpt`,
          searchText: `${externalKey} ${kind}`,
          tags: [],
          authors: [],
          licenseClass: "open",
          currentVersionId: null,
          publishedAt: null,
          firstSeenAt: now,
          updatedAt: now,
        });
      }
      const datasets = await ctx.db.query("evidenceDatasets").collect();
      return Object.fromEntries(
        datasets.map((dataset) => [dataset.datasetKey, dataset._id]),
      );
    });

    const security = await t.query(jobs.records, {
      datasetId: datasetIds["security-advisories"],
      limit: 100,
    });
    const releases = await t.query(jobs.records, {
      datasetId: datasetIds["software-release-intelligence"],
      limit: 100,
    });

    expect(
      security.records.map((record: { kind: string }) => record.kind),
    ).toEqual(["advisory"]);
    expect(
      releases.records.map((record: { kind: string }) => record.kind),
    ).toEqual(["release"]);
    expect(releases.scannedRecordCount).toBe(1);
    expect(releases.selectionScanTruncated).toBe(false);
    await t.run(async (ctx) => {
      const document = (await ctx.db.query("evidenceDocuments").collect()).find(
        (row) => row.externalKey === "release-1",
      )!;
      const categoryId = await ctx.db.insert("forumCategories", {
        slug: "export-research",
        name: "Export research",
        description: "Export research test category",
        kind: "board",
        status: "active",
        viewAccess: "public",
        position: 1,
        threadCount: 0,
        postCount: 0,
        createdAt: 1,
        updatedAt: 1,
      });
      const threadId = await ctx.db.insert("forumThreads", {
        categoryId,
        categorySlug: "export-research",
        slug: "visible-export-thread",
        title: "Visible export thread",
        body: "A large forum body not needed for visibility validation.".repeat(
          100,
        ),
        authorId: agent,
        status: "active",
        pinned: false,
        replyCount: 0,
        viewCount: 0,
        lastPostAt: 1,
        lastPostUserId: agent,
        searchText: "visible export thread",
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.patch("evidenceDocuments", document._id, {
        externalKey: `forum-research:${threadId}`,
      });
      await ctx.db.insert("researchQualityAssessments", {
        threadId,
        categoryId,
        authorUserId: agent,
        candidateTitle: "Visible export thread",
        candidateExcerpt:
          "A large private excerpt not needed for visibility.".repeat(50),
        status: "passed",
        sourceCount: 2,
        uniqueSourceDomainCount: 2,
        claimEstimate: 3,
        citationCoverageScore: 80,
        originalityScore: 90,
        aiAuthorshipDisclosed: true,
        contentFingerprint: "fixture-fingerprint",
        normalizedTerms: ["visibility", "export"],
        flags: [],
        evaluatedAt: 1,
        createdAt: 1,
        updatedAt: 1,
      });
    });
    // Before backfill completion the canonical assessment remains authoritative.
    const canonicalFallback = await t.query(jobs.records, {
      datasetId: datasetIds["software-release-intelligence"],
      limit: 100,
    });
    expect(canonicalFallback.records).toHaveLength(1);

    await t.mutation(jobs.backfillAssessmentVisibilityDigests, {});
    const assessmentId = await t.run(async (ctx) => {
      const assessment = await ctx.db
        .query("researchQualityAssessments")
        .withIndex("by_threadId")
        .first();
      expect(assessment).not.toBeNull();
      const digest = await ctx.db
        .query("researchQualityAssessmentVisibilityDigests")
        .withIndex("by_assessmentId", (q) =>
          q.eq("assessmentId", assessment!._id),
        )
        .unique();
      expect(digest).toMatchObject({
        threadId: assessment!.threadId,
        authorUserId: agent,
        status: "passed",
      });
      await ctx.db.patch("researchQualityAssessments", assessment!._id, {
        status: "rejected",
      });
      return assessment!._id;
    });
    // A sentinel canonical change proves that the ready projection is read.
    const compactPath = await t.query(jobs.records, {
      datasetId: datasetIds["software-release-intelligence"],
      limit: 100,
    });
    expect(compactPath.records).toHaveLength(1);

    await t.run(async (ctx) => {
      await ctx.db.patch("researchQualityAssessments", assessmentId, {
        status: "passed",
      });
    });
    await t.run(async (ctx) => {
      const digest = await ctx.db
        .query("researchQualityAssessmentVisibilityDigests")
        .withIndex("by_assessmentId", (q) => q.eq("assessmentId", assessmentId))
        .unique();
      expect(digest).not.toBeNull();
      await ctx.db.delete(
        "researchQualityAssessmentVisibilityDigests",
        digest!._id,
      );
    });
    // Missing projections fall back to canonical policy instead of treating
    // absence as approval or silently losing an otherwise public row.
    const missingDigestFallback = await t.query(jobs.records, {
      datasetId: datasetIds["software-release-intelligence"],
      limit: 100,
    });
    expect(missingDigestFallback.records).toHaveLength(1);
    await t.run(async (ctx) => {
      await ctx.db.patch("researchQualityAssessments", assessmentId, {
        status: "rejected",
      });
    });
    const missingRejectedDigestFallback = await t.query(jobs.records, {
      datasetId: datasetIds["software-release-intelligence"],
      limit: 100,
    });
    expect(missingRejectedDigestFallback.records).toEqual([]);
  });

  test("balances sources with a pinned native cursor and exposes lineage diffs", async () => {
    const t = setup();
    await fixture(t);
    const seeded = await t.run(async (ctx) => {
      const now = Date.now();
      const datasetId = await ctx.db.insert("evidenceDatasets", {
        datasetKey: "balanced-test",
        name: "Balanced test",
        description: "Two-source fixture",
        visibility: "public",
        licenseClass: "open",
        includedKinds: [],
        includedLicenseClasses: ["open"],
        sourceKeys: ["source-a", "source-b"],
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      const sourceIds = [];
      for (const sourceKey of ["source-a", "source-b"]) {
        sourceIds.push(
          await ctx.db.insert("evidenceSources", {
            sourceKey,
            name: sourceKey,
            sourceType: "api",
            ingestionEnabled: true,
            baseUrl: `https://${sourceKey}.example.com`,
            homepageUrl: `https://${sourceKey}.example.com`,
            status: "active",
            licenseClass: "open",
            provenanceClass: "official",
            visibility: "public",
            termsUrl: `https://${sourceKey}.example.com/terms`,
            etag: "",
            lastModified: "",
            cursor: "",
            lastFetchedAt: now,
            lastSucceededAt: now,
            lastErrorAt: 0,
            lastErrorMessage: "",
            createdAt: now,
            updatedAt: now,
          }),
        );
      }
      for (const [index, sourceId] of [
        sourceIds[0],
        sourceIds[0],
        sourceIds[1],
      ].entries())
        await ctx.db.insert("evidenceDocuments", {
          sourceId: sourceId!,
          externalKey: `row-${index}`,
          canonicalUrl: `https://example.com/${index}`,
          canonicalUrlHash: `hash-${index}`,
          kind: "document",
          visibility: "public",
          title: `Row ${index}`,
          excerpt: "Evidence row",
          searchText: "Evidence row",
          tags: [],
          authors: [],
          licenseClass: "open",
          currentVersionId: null,
          publishedAt: null,
          firstSeenAt: now - index,
          updatedAt: now - index,
        });
      const firstVersionId = await ctx.db.insert("evidenceDatasetVersions", {
        datasetId,
        version: "2026-01-01",
        checksum: "one",
        recordCount: 1,
        artifactByteLength: 10,
        sourceCoverageScore: 50,
        citationCoverageScore: 50,
        entityCoverageScore: 50,
        claimCoverageScore: 50,
        createdAt: now - 1,
      });
      const secondVersionId = await ctx.db.insert("evidenceDatasetVersions", {
        datasetId,
        version: "2026-01-02",
        checksum: "two",
        recordCount: 3,
        artifactByteLength: 30,
        sourceCoverageScore: 100,
        citationCoverageScore: 100,
        entityCoverageScore: 100,
        claimCoverageScore: 100,
        parentVersionId: firstVersionId,
        createdAt: now,
      });
      return { datasetId, firstVersionId, secondVersionId };
    });
    const first = await t.query(jobs.records, {
      datasetId: seeded.datasetId,
      limit: 2,
      selectionStrategy: "balanced",
    });
    expect(first.records.map((row: any) => row.source.sourceKey)).toEqual([
      "source-a",
      "source-b",
    ]);
    expect(first.continueCursor).toEqual(expect.any(String));
    const second = await t.query(jobs.records, {
      datasetId: seeded.datasetId,
      limit: 2,
      selectionStrategy: "balanced",
      cursor: first.continueCursor,
    });
    expect(second.records).toHaveLength(1);
    expect(second.records[0]?.source.sourceKey).toBe("source-a");
    expect(second.continueCursor).toBeUndefined();
    await expect(
      t.query(jobs.versionDiff, {
        datasetId: seeded.datasetId,
        versionId: seeded.secondVersionId,
      }),
    ).resolves.toMatchObject({
      previous: { versionId: seeded.firstVersionId },
      delta: { records: 2, artifactBytes: 20, sourceCoverage: 50 },
    });
  });

  test("round-trips balanced continuation cursors at the 100-source limit", async () => {
    const t = setup();
    await fixture(t);
    const datasetId = await t.run(async (ctx) => {
      const now = Date.now();
      const sourceKeys = Array.from(
        { length: 100 },
        (_, index) => `cursor-source-${String(index).padStart(3, "0")}`,
      );
      const datasetId = await ctx.db.insert("evidenceDatasets", {
        datasetKey: "maximum-cursor-sources",
        name: "Maximum cursor sources",
        description: "One cursor per active source",
        visibility: "public",
        licenseClass: "open",
        includedKinds: [],
        includedLicenseClasses: ["open"],
        sourceKeys,
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      for (const sourceKey of sourceKeys) {
        const sourceId = await ctx.db.insert("evidenceSources", {
          sourceKey,
          name: sourceKey,
          sourceType: "api",
          ingestionEnabled: true,
          baseUrl: `https://${sourceKey}.example.com`,
          homepageUrl: `https://${sourceKey}.example.com`,
          status: "active",
          licenseClass: "open",
          provenanceClass: "official",
          visibility: "public",
          termsUrl: `https://${sourceKey}.example.com/terms`,
          etag: "",
          lastModified: "",
          cursor: "",
          lastFetchedAt: now,
          lastSucceededAt: now,
          lastErrorAt: 0,
          lastErrorMessage: "",
          createdAt: now,
          updatedAt: now,
        });
        for (let index = 0; index < 2; index += 1)
          await ctx.db.insert("evidenceDocuments", {
            sourceId,
            externalKey: `${sourceKey}-${index}`,
            canonicalUrl: `https://${sourceKey}.example.com/${index}`,
            canonicalUrlHash: `${sourceKey}-${index}`,
            kind: "document",
            visibility: "public",
            title: `${sourceKey} document ${index}`,
            excerpt: "Export cursor test row",
            searchText: "Export cursor test row",
            tags: [],
            authors: [],
            licenseClass: "open",
            currentVersionId: null,
            publishedAt: null,
            firstSeenAt: now - index,
            updatedAt: now - index,
          });
      }
      return datasetId;
    });

    const first = await t.query(jobs.records, {
      datasetId,
      limit: 100,
      selectionStrategy: "balanced",
    });
    expect(first.records).toHaveLength(100);
    expect(first.continueCursor).toEqual(expect.any(String));

    const legacyCursor = encodeURIComponent(
      JSON.stringify({
        v: 2,
        datasetId: String(datasetId),
        selectionStrategy: "balanced",
        snapshotAt: Date.now(),
        documentReadModel: "canonical",
      }),
    );
    const legacyPage = await t.query(jobs.records, {
      datasetId,
      limit: 1,
      selectionStrategy: "balanced",
      cursor: legacyCursor,
    });
    expect(legacyPage.records).toHaveLength(1);
    expect(legacyPage.continueCursor).toMatch(/^e2\./);

    const second = await t.query(jobs.records, {
      datasetId,
      limit: 100,
      selectionStrategy: "balanced",
      cursor: first.continueCursor,
    });
    expect(second.records).toHaveLength(100);
    expect(second.continueCursor).toBeUndefined();
    expect(
      new Set([
        ...first.records.map((record: any) => record.title),
        ...second.records.map((record: any) => record.title),
      ]).size,
    ).toBe(200);
  });

  test("rejects configured export datasets beyond the bounded source fan-out", async () => {
    const t = setup();
    await fixture(t);
    const datasetId = await t.run(async (ctx) => {
      const now = Date.now();
      return await ctx.db.insert("evidenceDatasets", {
        datasetKey: "too-many-export-sources",
        name: "Too many export sources",
        description: "Invalid oversized source selection",
        visibility: "public",
        licenseClass: "open",
        includedKinds: [],
        includedLicenseClasses: ["open"],
        sourceKeys: Array.from(
          { length: 101 },
          (_, index) => `source-${index}`,
        ),
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
    });

    await expect(
      t.query(jobs.records, {
        datasetId,
        selectionStrategy: "balanced",
      }),
    ).rejects.toThrow(/supported export source limit/i);
  });

  test("rejects implicit all-source exports when the public catalog exceeds its bound", async () => {
    const t = setup();
    const datasetId = await t.run(async (ctx) => {
      const now = Date.now();
      const datasetId = await ctx.db.insert("evidenceDatasets", {
        datasetKey: "implicit-all-sources-over-limit",
        name: "All public sources",
        description: "Must not silently omit sources after the export bound",
        visibility: "public",
        licenseClass: "open",
        includedKinds: [],
        includedLicenseClasses: ["open"],
        sourceKeys: [],
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      for (let index = 0; index < 101; index += 1) {
        const sourceKey = `implicit-source-${String(index).padStart(3, "0")}`;
        await ctx.db.insert("evidenceSources", {
          sourceKey,
          name: sourceKey,
          sourceType: "api",
          ingestionEnabled: true,
          baseUrl: `https://${sourceKey}.example.com`,
          homepageUrl: `https://${sourceKey}.example.com`,
          status: "active",
          licenseClass: "open",
          provenanceClass: "official",
          visibility: "public",
          termsUrl: `https://${sourceKey}.example.com/terms`,
          etag: "",
          lastModified: "",
          cursor: "",
          lastFetchedAt: now,
          lastSucceededAt: now,
          lastErrorAt: 0,
          lastErrorMessage: "",
          createdAt: now,
          updatedAt: now,
        });
      }
      return datasetId;
    });

    await expect(
      t.query(jobs.records, {
        datasetId,
        selectionStrategy: "balanced",
      }),
    ).rejects.toThrow(/active public source catalog exceeds/i);
  });

  test("recent exports resolve only sources used by a bounded page", async () => {
    const t = setup();
    await fixture(t);
    const datasetId = await t.run(async (ctx) => {
      const now = Date.now();
      const datasetId = await ctx.db.insert("evidenceDatasets", {
        datasetKey: "recent-large-source-catalog",
        name: "Recent export across a large source catalog",
        description: "Recent pages should not scan unused sources",
        visibility: "public",
        licenseClass: "open",
        includedKinds: [],
        includedLicenseClasses: ["open"],
        sourceKeys: [],
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      for (let index = 0; index < 101; index += 1) {
        const sourceKey = `recent-source-${String(index).padStart(3, "0")}`;
        const sourceId = await ctx.db.insert("evidenceSources", {
          sourceKey,
          name: sourceKey,
          sourceType: "api",
          ingestionEnabled: true,
          baseUrl: `https://${sourceKey}.example.com`,
          homepageUrl: `https://${sourceKey}.example.com`,
          status: "active",
          licenseClass: "open",
          provenanceClass: "official",
          visibility: "public",
          termsUrl: `https://${sourceKey}.example.com/terms`,
          etag: "",
          lastModified: "",
          cursor: "",
          lastFetchedAt: now,
          lastSucceededAt: now,
          lastErrorAt: 0,
          lastErrorMessage: "",
          createdAt: now,
          updatedAt: now,
        });
        await ctx.db.insert("evidenceDocuments", {
          sourceId,
          externalKey: `${sourceKey}-document`,
          canonicalUrl: `https://${sourceKey}.example.com/document`,
          canonicalUrlHash: `${sourceKey}-document`,
          kind: "document",
          visibility: "public",
          title: sourceKey,
          excerpt: "Recent export source fixture",
          searchText: sourceKey,
          tags: [],
          authors: [],
          licenseClass: "open",
          currentVersionId: null,
          publishedAt: null,
          firstSeenAt: now - (101 - index),
          updatedAt: now - (101 - index),
        });
      }
      return datasetId;
    });

    const page = await t.query(jobs.records, {
      datasetId,
      limit: 1,
      selectionStrategy: "recent",
    });

    expect(page.records).toHaveLength(1);
    expect(page.records[0]?.source.sourceKey).toBe("recent-source-100");
  });

  test("keeps balanced exports reachable beyond the former 500-row source prefix", async () => {
    const t = setup();
    await fixture(t);
    const seeded = await t.run(async (ctx) => {
      const now = Date.now();
      const datasetId = await ctx.db.insert("evidenceDatasets", {
        datasetKey: "deep-balanced-test",
        name: "Deep balanced test",
        description: "Two deep sources",
        visibility: "public",
        licenseClass: "open",
        includedKinds: [],
        includedLicenseClasses: ["open"],
        sourceKeys: ["deep-a", "deep-b"],
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      const sourceIds = await Promise.all(
        ["deep-a", "deep-b"].map((sourceKey) =>
          ctx.db.insert("evidenceSources", {
            sourceKey,
            name: sourceKey,
            sourceType: "api",
            ingestionEnabled: true,
            baseUrl: `https://${sourceKey}.example.com`,
            homepageUrl: `https://${sourceKey}.example.com`,
            status: "active",
            licenseClass: "open",
            provenanceClass: "official",
            visibility: "public",
            termsUrl: `https://${sourceKey}.example.com/terms`,
            etag: "",
            lastModified: "",
            cursor: "",
            lastFetchedAt: now,
            lastSucceededAt: now,
            lastErrorAt: 0,
            lastErrorMessage: "",
            createdAt: now,
            updatedAt: now,
          }),
        ),
      );
      for (let index = 0; index <= 500; index += 1)
        for (const [sourceIndex, sourceId] of sourceIds.entries())
          await ctx.db.insert("evidenceDocuments", {
            sourceId,
            externalKey: `deep-${sourceIndex}-${index}`,
            canonicalUrl: `https://example.com/deep/${sourceIndex}/${index}`,
            canonicalUrlHash: `deep-${sourceIndex}-${index}`,
            kind: "document",
            visibility: "public",
            title: `Deep ${sourceIndex} ${index}`,
            excerpt: "Evidence row",
            searchText: "Evidence row",
            tags: [],
            authors: [],
            licenseClass: "open",
            currentVersionId: null,
            publishedAt: null,
            firstSeenAt: now - index,
            updatedAt: now - index,
          });
      return datasetId;
    });
    const first = await t.query(jobs.records, {
      datasetId: seeded,
      limit: 500,
      selectionStrategy: "balanced",
    });
    expect(first.records).toHaveLength(500);
    expect(
      first.records.slice(0, 4).map((row: any) => row.source.sourceKey),
    ).toEqual(["deep-a", "deep-b", "deep-a", "deep-b"]);
    const second = await t.query(jobs.records, {
      datasetId: seeded,
      limit: 500,
      selectionStrategy: "balanced",
      cursor: first.continueCursor,
    });
    expect(second.records).toHaveLength(500);
    const final = await t.query(jobs.records, {
      datasetId: seeded,
      limit: 500,
      selectionStrategy: "balanced",
      cursor: second.continueCursor,
    });
    expect(final.records.map((row: any) => row.title)).toEqual([
      "Deep 0 500",
      "Deep 1 500",
    ]);
    expect(final.records.map((row: any) => row.source.sourceKey)).toEqual([
      "deep-a",
      "deep-b",
    ]);
  });

  test("rotates balanced allocation when a page is smaller than its source set", async () => {
    const t = setup();
    await fixture(t);
    const seeded = await t.run(async (ctx) => {
      const now = Date.now();
      const sourceKeys = ["rotate-a", "rotate-b", "rotate-c"];
      const datasetId = await ctx.db.insert("evidenceDatasets", {
        datasetKey: "rotate-balanced-test",
        name: "Rotate balanced test",
        description: "Fair sparse pages",
        visibility: "public",
        licenseClass: "open",
        includedKinds: [],
        includedLicenseClasses: ["open"],
        sourceKeys,
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      for (const sourceKey of sourceKeys) {
        const sourceId = await ctx.db.insert("evidenceSources", {
          sourceKey,
          name: sourceKey,
          sourceType: "api",
          ingestionEnabled: true,
          baseUrl: `https://${sourceKey}.example.com`,
          homepageUrl: `https://${sourceKey}.example.com`,
          status: "active",
          licenseClass: "open",
          provenanceClass: "official",
          visibility: "public",
          termsUrl: `https://${sourceKey}.example.com/terms`,
          etag: "",
          lastModified: "",
          cursor: "",
          lastFetchedAt: now,
          lastSucceededAt: now,
          lastErrorAt: 0,
          lastErrorMessage: "",
          createdAt: now,
          updatedAt: now,
        });
        for (let index = 0; index < 2; index += 1)
          await ctx.db.insert("evidenceDocuments", {
            sourceId,
            externalKey: `${sourceKey}-${index}`,
            canonicalUrl: `https://example.com/${sourceKey}/${index}`,
            canonicalUrlHash: `${sourceKey}-${index}`,
            kind: "document",
            visibility: "public",
            title: `${sourceKey}-${index}`,
            excerpt: "Evidence row",
            searchText: "Evidence row",
            tags: [],
            authors: [],
            licenseClass: "open",
            currentVersionId: null,
            publishedAt: null,
            firstSeenAt: now - index,
            updatedAt: now - index,
          });
      }
      return datasetId;
    });
    const first = await t.query(jobs.records, {
      datasetId: seeded,
      limit: 2,
      selectionStrategy: "balanced",
    });
    const second = await t.query(jobs.records, {
      datasetId: seeded,
      limit: 2,
      selectionStrategy: "balanced",
      cursor: first.continueCursor,
    });
    const third = await t.query(jobs.records, {
      datasetId: seeded,
      limit: 2,
      selectionStrategy: "balanced",
      cursor: second.continueCursor,
    });
    expect(first.records.map((row: any) => row.source.sourceKey)).toEqual([
      "rotate-a",
      "rotate-b",
    ]);
    expect(second.records.map((row: any) => row.source.sourceKey)).toEqual([
      "rotate-c",
      "rotate-a",
    ]);
    expect(third.records.map((row: any) => row.source.sourceKey)).toEqual([
      "rotate-b",
      "rotate-c",
    ]);
  });

  test("applies configured snapshot retention while preserving the minimum", async () => {
    const t = setup();
    await fixture(t);
    const catalog = await t.mutation(jobs.catalog, {});
    await t.run(async (ctx) => {
      await ctx.db.patch("evidenceDatasets", catalog.datasetId, {
        snapshotRetentionDays: 1,
        minimumRetainedVersions: 2,
      });
      for (let index = 0; index < 4; index += 1)
        await ctx.db.insert("evidenceDatasetVersions", {
          datasetId: catalog.datasetId,
          version: `2025-01-0${index + 1}`,
          checksum: `old-${index}`,
          recordCount: 1,
          createdAt: Date.now() - (10 + index) * 86_400_000,
        });
    });
    await expect(
      t.mutation(jobs.cleanupVersions, { limit: 10 }),
    ).resolves.toEqual({
      deletedVersions: 2,
      deletedBytes: 0,
    });
    const versions = await t.query(jobs.versions, {
      datasetId: catalog.datasetId,
      limit: 10,
    });
    expect(versions.versions).toHaveLength(2);
  });

  test("rechecks agent ownership, activity, entitlement, expiry, and manifest before download", async () => {
    const t = setup();
    const { owner, other, agent } = await fixture(t);
    const catalog = await t.mutation(jobs.catalog, {});
    const job = await t.mutation(jobs.createExport, {
      ownerUserId: owner,
      agentId: "agent",
      datasetId: catalog.datasetId,
      format: "jsonl",
      idempotencyKey: "artifact-owner-1",
      requestFingerprint: "artifact-owner-one",
      quotaUnits: 1,
    });
    const storageId = await t.run(async (ctx) =>
      ctx.storage.store(
        new Blob(['{"record":1}\n'], { type: "application/x-ndjson" }),
      ),
    );
    const datasetManifestStorageId = await t.run(async (ctx) =>
      ctx.storage.store(
        new Blob(['{"format":"jsonl"}'], { type: "application/json" }),
      ),
    );
    await completeOwnedExport(t, {
      jobId: job.jobId,
      resultJson: "{}",
      resultStorageId: storageId,
      datasetManifestStorageId,
      checksum: "artifact-checksum-one",
      recordCount: 1,
      artifactContentType: "application/x-ndjson",
      artifactByteLength: 13,
    });
    await expect(
      t.query(jobs.resolveArtifact, {
        agentUserId: agent,
        kind: "export",
        exportJobId: job.jobId,
      }),
    ).resolves.toMatchObject({
      storageId,
      contentType: "application/x-ndjson",
      sha256: "artifact-checksum-one",
    });
    await expect(
      t.query(jobs.resolveArtifact, {
        agentUserId: agent,
        kind: "export-manifest",
        exportJobId: job.jobId,
      }),
    ).resolves.toMatchObject({
      storageId: datasetManifestStorageId,
      contentType: "application/json",
      filename: expect.stringContaining("manifest.json"),
    });
    const downloaded = await t
      .withIdentity({ subject: agent })
      .fetch("/agent/artifact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "export", jobId: job.jobId }),
      });
    expect(downloaded.status).toBe(200);
    expect(downloaded.headers.get("content-disposition")).toContain(
      "symbaiex-export-",
    );
    expect(downloaded.headers.get("x-artifact-sha256")).toBe(
      "artifact-checksum-one",
    );
    expect(await downloaded.text()).toBe('{"record":1}\n');
    const manifest = await t
      .withIdentity({ subject: agent })
      .fetch("/agent/artifact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "export-manifest", jobId: job.jobId }),
      });
    expect(manifest.status).toBe(200);
    expect(manifest.headers.get("content-disposition")).toContain(
      "manifest.json",
    );
    const human = await t
      .withIdentity({ subject: other })
      .fetch("/agent/artifact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "export", jobId: job.jobId }),
      });
    expect(human.status).toBe(401);
    const issuer = "https://oauth-test.authkit.app";
    vi.stubEnv("WORKOS_CONNECT_ENABLED", "true");
    vi.stubEnv("WORKOS_AUTHKIT_ISSUER", issuer);
    const grantId = await t.run(async (ctx) => {
      const identity = await ctx.db
        .query("agentIdentities")
        .withIndex("by_userId", (q) => q.eq("userId", agent))
        .unique();
      return await ctx.db.insert("agentOAuthGrants", {
        ownerUserId: owner,
        agentIdentityId: identity!._id,
        issuer,
        subject: owner,
        externalAuthHash: "test-artifact-grant",
        keyVersion: 1,
        status: "active",
        createdAt: Date.now(),
      });
    });
    const oauth = t.withIdentity({
      subject: owner,
      issuer,
      [WORKOS_GRANT_CLAIM]: grantId,
    });
    const oauthDownload = await oauth.fetch("/agent/artifact", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "export", jobId: job.jobId }),
    });
    expect(oauthDownload.status).toBe(200);
    expect(await oauthDownload.text()).toBe('{"record":1}\n');
    await t.run((ctx) =>
      ctx.db.patch("agentOAuthGrants", grantId, {
        status: "revoked",
      }),
    );
    const revokedDownload = await oauth.fetch("/agent/artifact", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "export", jobId: job.jobId }),
    });
    expect(revokedDownload.status).toBe(401);
    const otherAgent = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        isAgent: true,
        agentSlug: "other-agent",
        agentStatus: "active",
        agentScopes: ["evidence"],
        agentKeyVersion: 1,
      });
      await ctx.db.insert("agentIdentities", {
        agentId: "other-agent",
        userId,
        ownerUserId: other,
        publicKey: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
        scopes: ["evidence"],
        status: "active",
        keyVersion: 1,
        createdAt: 1,
        updatedAt: 1,
      });
      return userId;
    });
    const crossOwner = await t
      .withIdentity({ subject: otherAgent })
      .fetch("/agent/artifact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "export", jobId: job.jobId }),
      });
    expect(crossOwner.status).toBe(404);
    await t.run(async (ctx) => {
      const artifact = await ctx.db
        .query("evidenceArtifacts")
        .withIndex("by_exportJobId", (q) => q.eq("exportJobId", job.jobId))
        .unique();
      await ctx.db.patch("evidenceArtifacts", artifact!._id, {
        byteLength: 999,
      });
    });
    const metadataMismatch = await t
      .withIdentity({ subject: agent })
      .fetch("/agent/artifact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "export", jobId: job.jobId }),
      });
    expect(metadataMismatch.status).toBe(409);
    expect(await metadataMismatch.json()).toMatchObject({
      code: "ARTIFACT_METADATA_MISMATCH",
    });
    await t.run(async (ctx) => {
      const artifact = await ctx.db
        .query("evidenceArtifacts")
        .withIndex("by_exportJobId", (q) => q.eq("exportJobId", job.jobId))
        .unique();
      await ctx.db.patch("evidenceArtifacts", artifact!._id, {
        byteLength: 13,
      });
    });
    await expect(
      t.query(jobs.resolveArtifact, {
        agentUserId: other,
        kind: "export",
        exportJobId: job.jobId,
      }),
    ).resolves.toBeNull();
    await t.run(async (ctx) => {
      const identity = await ctx.db
        .query("agentIdentities")
        .withIndex("by_userId", (q) => q.eq("userId", agent))
        .unique();
      await ctx.db.patch("agentIdentities", identity!._id, {
        status: "revoked",
      });
    });
    await expect(
      t.query(jobs.resolveArtifact, {
        agentUserId: agent,
        kind: "export",
        exportJobId: job.jobId,
      }),
    ).resolves.toBeNull();
    await t.run(async (ctx) => {
      const identity = await ctx.db
        .query("agentIdentities")
        .withIndex("by_userId", (q) => q.eq("userId", agent))
        .unique();
      await ctx.db.patch("agentIdentities", identity!._id, {
        status: "active",
      });
      await ctx.db.patch("evidenceExportJobs", job.jobId, { expiresAt: 1 });
    });
    await expect(
      t.query(jobs.resolveArtifact, {
        agentUserId: agent,
        kind: "export",
        exportJobId: job.jobId,
      }),
    ).resolves.toBeNull();
  });

  test("keeps a caller-supplied canonical manifest when a duplicate checksum completes", async () => {
    const t = setup();
    const { owner } = await fixture(t);
    const catalog = await t.mutation(jobs.catalog, {});
    const first = await t.mutation(jobs.createExport, {
      ownerUserId: owner,
      agentId: "agent",
      datasetId: catalog.datasetId,
      format: "jsonl",
      idempotencyKey: "canonical-manifest-first",
      requestFingerprint: "canonical-manifest-first",
      quotaUnits: 1,
    });
    const canonicalManifestStorageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(['{"snapshot":"canonical"}'])),
    );
    const firstArtifactStorageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(['{"record":1}\n'])),
    );
    await completeOwnedExport(t, {
      jobId: first.jobId,
      resultJson: "{}",
      resultStorageId: firstArtifactStorageId,
      datasetManifestStorageId: canonicalManifestStorageId,
      checksum: "canonical-manifest-checksum",
      recordCount: 1,
      artifactContentType: "application/x-ndjson",
      artifactByteLength: 13,
    });
    const duplicate = await t.mutation(jobs.createExport, {
      ownerUserId: owner,
      agentId: "agent",
      datasetId: catalog.datasetId,
      format: "jsonl",
      idempotencyKey: "canonical-manifest-duplicate",
      requestFingerprint: "canonical-manifest-duplicate",
      quotaUnits: 1,
    });
    const duplicateArtifactStorageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(['{"record":1}\n'])),
    );
    await completeOwnedExport(t, {
      jobId: duplicate.jobId,
      resultJson: "{}",
      resultStorageId: duplicateArtifactStorageId,
      datasetManifestStorageId: canonicalManifestStorageId,
      checksum: "canonical-manifest-checksum",
      recordCount: 1,
      artifactContentType: "application/x-ndjson",
      artifactByteLength: 13,
    });
    await t.run(async (ctx) => {
      expect(
        await ctx.db.system.get("_storage", canonicalManifestStorageId),
      ).not.toBeNull();
      const version = await ctx.db
        .query("evidenceDatasetVersions")
        .withIndex("by_datasetId_and_checksum", (q) =>
          q
            .eq("datasetId", catalog.datasetId)
            .eq("checksum", "canonical-manifest-checksum"),
        )
        .unique();
      expect(version?.manifestStorageId).toBe(canonicalManifestStorageId);
    });
  });

  test("claims external work once and rejects losing completion and failure mutations", async () => {
    const t = setup();
    const { owner } = await fixture(t);
    const catalog = await t.mutation(jobs.catalog, {});
    const job = await t.mutation(jobs.createExport, {
      ownerUserId: owner,
      agentId: "agent",
      datasetId: catalog.datasetId,
      format: "jsonl",
      idempotencyKey: "execution-owner-export",
      requestFingerprint: "execution-owner-export",
      quotaUnits: 1,
    });
    const claim = await t.mutation(jobs.claimExport, { jobId: job.jobId });
    expect(claim).toMatchObject({ executionToken: expect.any(String) });
    await expect(
      t.mutation(jobs.claimExport, { jobId: job.jobId }),
    ).resolves.toBeNull();
    await expect(
      t.query(jobs.legacyExportInput, { jobId: job.jobId }),
    ).resolves.toBeNull();
    await expect(
      t.mutation(jobs.beginExport, {
        jobId: job.jobId,
        executionToken: "loser",
      }),
    ).resolves.toBeNull();
    await expect(
      t.mutation(jobs.beginExport, {
        jobId: job.jobId,
        executionToken: claim.executionToken,
      }),
    ).resolves.toMatchObject({ datasetId: catalog.datasetId, format: "jsonl" });
    await expect(
      t.mutation(jobs.beginExport, {
        jobId: job.jobId,
        executionToken: claim.executionToken,
      }),
    ).resolves.toBeNull();
    await expect(
      t.action(jobs.runExport, {
        jobId: job.jobId,
        executionToken: claim.executionToken,
      }),
    ).resolves.toEqual({ started: false });

    const losing = await t.run(async (ctx) => ({
      artifact: await ctx.storage.store(new Blob(["losing-artifact"])),
      manifest: await ctx.storage.store(new Blob(["losing-manifest"])),
    }));
    const completion = {
      jobId: job.jobId,
      resultJson: "{}",
      resultStorageId: losing.artifact,
      datasetManifestStorageId: losing.manifest,
      checksum: "execution-owner-checksum",
      recordCount: 1,
      artifactContentType: "application/x-ndjson",
      artifactByteLength: 15,
    };
    await t.mutation(jobs.completeExport, {
      ...completion,
      executionToken: "loser",
    });
    await t.mutation(jobs.failExport, {
      jobId: job.jobId,
      executionToken: "loser",
      errorMessage: "loser failure",
    });
    await t.run(async (ctx) => {
      expect(await ctx.db.system.get("_storage", losing.artifact)).toBeNull();
      expect(await ctx.db.system.get("_storage", losing.manifest)).toBeNull();
      expect((await ctx.db.get("evidenceExportJobs", job.jobId))?.status).toBe(
        "running",
      );
    });

    const winning = await t.run(async (ctx) => ({
      artifact: await ctx.storage.store(new Blob(["winning-artifact"])),
      manifest: await ctx.storage.store(new Blob(["winning-manifest"])),
    }));
    const subscriptionId = await t.run(async (ctx) => {
      const subscriptionId = await ctx.db.insert("apiWebhookSubscriptions", {
        ownerUserId: owner,
        subscriptionKey: "execution-owner",
        url: "https://example.com/evidence-webhook",
        status: "active",
        eventTypes: ["evidence.export.completed"],
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("apiWebhookTargets", {
        subscriptionId,
        ownerUserId: owner,
        eventType: "evidence.export.completed",
        status: "active",
        updatedAt: 1,
      });
      return subscriptionId;
    });
    await t.mutation(jobs.completeExport, {
      ...completion,
      executionToken: claim.executionToken,
      resultStorageId: winning.artifact,
      datasetManifestStorageId: winning.manifest,
    });

    const duplicate = await t.run(async (ctx) => ({
      artifact: await ctx.storage.store(new Blob(["duplicate-artifact"])),
      manifest: await ctx.storage.store(new Blob(["duplicate-manifest"])),
    }));
    await t.mutation(jobs.completeExport, {
      ...completion,
      executionToken: claim.executionToken,
      resultStorageId: duplicate.artifact,
      datasetManifestStorageId: duplicate.manifest,
    });
    await t.mutation(jobs.failExport, {
      jobId: job.jobId,
      executionToken: claim.executionToken,
      errorMessage: "late failure",
    });
    await t.run(async (ctx) => {
      expect(
        await ctx.db.system.get("_storage", duplicate.artifact),
      ).toBeNull();
      expect(
        await ctx.db.system.get("_storage", duplicate.manifest),
      ).toBeNull();
      expect(
        await ctx.db.system.get("_storage", winning.artifact),
      ).not.toBeNull();
      expect(
        await ctx.db.system.get("_storage", winning.manifest),
      ).not.toBeNull();
      expect(
        await ctx.db
          .query("evidenceArtifacts")
          .withIndex("by_exportJobId", (q) => q.eq("exportJobId", job.jobId))
          .take(2),
      ).toHaveLength(1);
      expect(
        await ctx.db
          .query("evidenceDatasetVersions")
          .withIndex("by_datasetId_and_checksum", (q) =>
            q
              .eq("datasetId", catalog.datasetId)
              .eq("checksum", "execution-owner-checksum"),
          )
          .take(2),
      ).toHaveLength(1);
      const version = await ctx.db
        .query("evidenceDatasetVersions")
        .withIndex("by_datasetId_and_checksum", (q) =>
          q
            .eq("datasetId", catalog.datasetId)
            .eq("checksum", "execution-owner-checksum"),
        )
        .unique();
      expect(
        await ctx.db
          .query("evidenceChangeEvents")
          .withIndex("by_eventKey", (q) =>
            q.eq(
              "eventKey",
              `dataset:${catalog.datasetId}:version:${version!.version}`,
            ),
          )
          .take(2),
      ).toHaveLength(1);
      expect(
        await ctx.db
          .query("apiWebhookDeliveries")
          .withIndex("by_subscriptionId_and_eventKey", (q) =>
            q
              .eq("subscriptionId", subscriptionId)
              .eq("eventKey", `export:${job.jobId}:completed`.toLowerCase()),
          )
          .take(2),
      ).toHaveLength(1);
      expect((await ctx.db.get("evidenceExportJobs", job.jobId))?.status).toBe(
        "completed",
      );
    });

    const legacy = await t.mutation(jobs.createResearch, {
      ownerUserId: owner,
      agentId: "agent",
      query: "rolling deployment",
      idempotencyKey: "legacy-running-research",
      requestFingerprint: "legacy-running-research",
      quotaUnits: 1,
    });
    await t.mutation(jobs.markResearchRunning, { jobId: legacy.jobId });
    await expect(
      t.query(jobs.legacyResearchInput, { jobId: legacy.jobId }),
    ).resolves.toMatchObject({
      query: "rolling deployment",
      status: "running",
    });
    await t.mutation(jobs.completeResearch, {
      jobId: legacy.jobId,
      resultJson: '{"legacy":true}',
    });
    await t.run(async (ctx) => {
      expect(
        await ctx.db.get("evidenceResearchJobs", legacy.jobId),
      ).toMatchObject({ status: "completed", resultJson: '{"legacy":true}' });
    });

    const stale = await t.mutation(jobs.createResearch, {
      ownerUserId: owner,
      agentId: "agent",
      query: "stale execution",
      idempotencyKey: "stale-research",
      requestFingerprint: "stale-research",
      quotaUnits: 1,
    });
    const staleClaim = await t.mutation(jobs.claimResearch, {
      jobId: stale.jobId,
    });
    await expect(
      t.query(jobs.legacyResearchInput, { jobId: stale.jobId }),
    ).resolves.toBeNull();
    await t.run(async (ctx) => {
      const staleAt = Date.now() - 31 * 60 * 1_000;
      await ctx.db.patch("evidenceResearchJobs", stale.jobId, {
        executionClaimedAt: staleAt,
        updatedAt: staleAt,
      });
    });
    await expect(
      t.mutation(jobs.claimResearch, { jobId: stale.jobId }),
    ).resolves.toBeNull();
    await expect(
      t.mutation(jobs.beginResearch, {
        jobId: stale.jobId,
        executionToken: staleClaim.executionToken,
      }),
    ).resolves.toBeNull();
    await t.run(async (ctx) => {
      expect(
        await ctx.db.get("evidenceResearchJobs", stale.jobId),
      ).toMatchObject({
        status: "failed",
        errorMessage: expect.stringMatching(/not retried/i),
      });
    });
  });

  test("cleans all expired artifacts in indexed batches without deleting audit jobs", async () => {
    const t = setup();
    const { owner } = await fixture(t);
    const now = Date.now();
    await t.run(async (ctx) => {
      for (let index = 0; index < 52; index += 1) {
        const storageId = await ctx.storage.store(new Blob([String(index)]));
        const jobId = await ctx.db.insert("evidenceResearchJobs", {
          ownerUserId: owner,
          agentId: "agent",
          requestKey: `cleanup-batch:${index}`,
          requestFingerprint: `cleanup-batch:${index}`,
          idempotencyKey: `cleanup-batch:${index}`,
          quotaUnits: 1,
          status: "completed",
          query: "cleanup",
          resultJson: "{}",
          resultStorageId: storageId,
          errorMessage: "",
          expiresAt: now - 1,
          createdAt: now - 2,
          updatedAt: now - 2,
        });
        await ctx.db.insert("evidenceArtifacts", {
          ownerUserId: owner,
          agentId: "agent",
          kind: "research",
          researchJobId: jobId,
          storageId,
          contentType: "application/json",
          byteLength: 1,
          sha256: `cleanup-${index}`,
          generatedAt: now - 2,
          expiresAt: now - 1,
          status: "available",
          createdAt: now - 2,
          updatedAt: now - 2,
        });
      }
    });
    await expect(t.mutation(jobs.cleanup, { limit: 50 })).resolves.toEqual({
      researchCleared: 50,
      exportCleared: 0,
    });
    await expect(t.mutation(jobs.cleanup, { limit: 50 })).resolves.toEqual({
      researchCleared: 2,
      exportCleared: 0,
    });
    await t.run(async (ctx) => {
      const auditJobs = await ctx.db
        .query("evidenceResearchJobs")
        .withIndex("by_status_and_updatedAt", (q) =>
          q.eq("status", "completed"),
        )
        .take(60);
      expect(auditJobs).toHaveLength(52);
      expect(
        await ctx.db
          .query("evidenceArtifacts")
          .withIndex("by_status_and_expiresAt", (q) =>
            q.eq("status", "available"),
          )
          .take(1),
      ).toEqual([]);
    });
  });

  test("purges indexed legacy job storage without deleting an immutable dataset manifest", async () => {
    const t = setup();
    const { owner } = await fixture(t);
    const catalog = await t.mutation(jobs.catalog, {});
    const now = Date.now();
    const ids = await t.run(async (ctx) => {
      const legacyStorageId = await ctx.storage.store(new Blob(["legacy"]));
      const sharedManifestStorageId = await ctx.storage.store(
        new Blob(['{"format":"jsonl","immutable":true}']),
      );
      const researchJobId = await ctx.db.insert("evidenceResearchJobs", {
        ownerUserId: owner,
        agentId: "agent",
        requestKey: "legacy-research",
        requestFingerprint: "legacy-research",
        idempotencyKey: "legacy-research",
        quotaUnits: 1,
        status: "completed",
        query: "legacy",
        resultJson: "{}",
        resultStorageId: legacyStorageId,
        errorMessage: "",
        expiresAt: now - 1,
        createdAt: now - 2,
        updatedAt: now - 2,
      });
      const exportJobId = await ctx.db.insert("evidenceExportJobs", {
        ownerUserId: owner,
        agentId: "agent",
        datasetId: catalog.datasetId,
        requestKey: "legacy-export",
        requestFingerprint: "legacy-export",
        idempotencyKey: "legacy-export",
        quotaUnits: 1,
        status: "completed",
        format: "jsonl",
        checksum: "legacy-checksum",
        recordCount: 1,
        resultJson: "{}",
        resultStorageId: sharedManifestStorageId,
        errorMessage: "",
        expiresAt: now - 1,
        createdAt: now - 2,
        updatedAt: now - 2,
      });
      await ctx.db.insert("evidenceDatasetVersions", {
        datasetId: catalog.datasetId,
        version: "legacy-snapshot",
        checksum: "legacy-checksum",
        recordCount: 1,
        manifestStorageId: sharedManifestStorageId,
        createdAt: now - 2,
      });
      // Historical imports could have created more than one row referencing a
      // shared manifest. Existence, not uniqueness, protects that storage.
      await ctx.db.insert("evidenceDatasetVersions", {
        datasetId: catalog.datasetId,
        version: "legacy-snapshot-duplicate-reference",
        checksum: "legacy-checksum-duplicate-reference",
        recordCount: 1,
        manifestStorageId: sharedManifestStorageId,
        createdAt: now - 2,
      });
      return {
        researchJobId,
        exportJobId,
        legacyStorageId,
        sharedManifestStorageId,
      };
    });
    await expect(t.mutation(jobs.cleanup, { limit: 10 })).resolves.toEqual({
      researchCleared: 1,
      exportCleared: 1,
    });
    await t.run(async (ctx) => {
      const researchJob = await ctx.db.get(
        "evidenceResearchJobs",
        ids.researchJobId,
      );
      const exportJob = await ctx.db.get("evidenceExportJobs", ids.exportJobId);
      expect(researchJob?.resultStorageId).toBeUndefined();
      expect(researchJob?.artifactPurgedAt).toEqual(expect.any(Number));
      expect(exportJob?.resultStorageId).toBeUndefined();
      expect(exportJob?.artifactPurgedAt).toEqual(expect.any(Number));
      expect(
        await ctx.db.system.get("_storage", ids.legacyStorageId),
      ).toBeNull();
      expect(
        await ctx.db.system.get("_storage", ids.sharedManifestStorageId),
      ).not.toBeNull();
    });
  });

  test("leaves expired jobs without artifacts as audit history", async () => {
    const t = setup();
    const { owner } = await fixture(t);
    const job = await t.mutation(jobs.createResearch, {
      ownerUserId: owner,
      agentId: "agent",
      query: "evidence",
      idempotencyKey: "cleanup-1",
      requestFingerprint: "cleanup-one",
      quotaUnits: 1,
    });
    await t.run(async (ctx) => {
      await ctx.db.patch("evidenceResearchJobs", job.jobId, { expiresAt: 1 });
    });
    await expect(
      t.mutation(jobs.cleanup, { limit: 50 }),
    ).resolves.toMatchObject({ researchCleared: 0, exportCleared: 0 });
    await t.run(async (ctx) => {
      expect(
        await ctx.db.get("evidenceResearchJobs", job.jobId),
      ).not.toBeNull();
    });
  });
});
