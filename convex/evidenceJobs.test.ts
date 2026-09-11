/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { describe, expect, test, vi } from "vitest";
import { WORKOS_GRANT_CLAIM } from "../lib/workos-config";
import schema from "./schema";

const modules = {
  ...import.meta.glob("./**/*.ts"),
  ...import.meta.glob("./**/*.tsx"),
};
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
} as const;
function setup() {
  return convexTest(schema, modules);
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

  test("keeps commercial dataset selections distinct", async () => {
    const t = setup();
    await fixture(t);
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
      for (const [index, sourceId] of [sourceIds[0], sourceIds[0], sourceIds[1]].entries())
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
      const sourceIds = await Promise.all(["deep-a", "deep-b"].map((sourceKey) =>
        ctx.db.insert("evidenceSources", {
          sourceKey, name: sourceKey, sourceType: "api", ingestionEnabled: true,
          baseUrl: `https://${sourceKey}.example.com`, homepageUrl: `https://${sourceKey}.example.com`,
          status: "active", licenseClass: "open", provenanceClass: "official", visibility: "public",
          termsUrl: `https://${sourceKey}.example.com/terms`, etag: "", lastModified: "", cursor: "",
          lastFetchedAt: now, lastSucceededAt: now, lastErrorAt: 0, lastErrorMessage: "", createdAt: now, updatedAt: now,
        }),
      ));
      for (let index = 0; index <= 500; index += 1)
        for (const [sourceIndex, sourceId] of sourceIds.entries())
          await ctx.db.insert("evidenceDocuments", {
            sourceId, externalKey: `deep-${sourceIndex}-${index}`,
            canonicalUrl: `https://example.com/deep/${sourceIndex}/${index}`,
            canonicalUrlHash: `deep-${sourceIndex}-${index}`, kind: "document", visibility: "public",
            title: `Deep ${sourceIndex} ${index}`, excerpt: "Evidence row", searchText: "Evidence row",
            tags: [], authors: [], licenseClass: "open", currentVersionId: null, publishedAt: null,
            firstSeenAt: now - index, updatedAt: now - index,
          });
      return datasetId;
    });
    const first = await t.query(jobs.records, { datasetId: seeded, limit: 500, selectionStrategy: "balanced" });
    expect(first.records).toHaveLength(500);
    expect(first.records.slice(0, 4).map((row: any) => row.source.sourceKey)).toEqual(["deep-a", "deep-b", "deep-a", "deep-b"]);
    const second = await t.query(jobs.records, { datasetId: seeded, limit: 500, selectionStrategy: "balanced", cursor: first.continueCursor });
    expect(second.records).toHaveLength(500);
    const final = await t.query(jobs.records, { datasetId: seeded, limit: 500, selectionStrategy: "balanced", cursor: second.continueCursor });
    expect(final.records.map((row: any) => row.title)).toEqual(["Deep 0 500", "Deep 1 500"]);
    expect(final.records.map((row: any) => row.source.sourceKey)).toEqual(["deep-a", "deep-b"]);
  });

  test("rotates balanced allocation when a page is smaller than its source set", async () => {
    const t = setup();
    await fixture(t);
    const seeded = await t.run(async (ctx) => {
      const now = Date.now();
      const sourceKeys = ["rotate-a", "rotate-b", "rotate-c"];
      const datasetId = await ctx.db.insert("evidenceDatasets", {
        datasetKey: "rotate-balanced-test", name: "Rotate balanced test", description: "Fair sparse pages",
        visibility: "public", licenseClass: "open", includedKinds: [], includedLicenseClasses: ["open"],
        sourceKeys, status: "active", createdAt: now, updatedAt: now,
      });
      for (const sourceKey of sourceKeys) {
        const sourceId = await ctx.db.insert("evidenceSources", {
          sourceKey, name: sourceKey, sourceType: "api", ingestionEnabled: true,
          baseUrl: `https://${sourceKey}.example.com`, homepageUrl: `https://${sourceKey}.example.com`,
          status: "active", licenseClass: "open", provenanceClass: "official", visibility: "public",
          termsUrl: `https://${sourceKey}.example.com/terms`, etag: "", lastModified: "", cursor: "",
          lastFetchedAt: now, lastSucceededAt: now, lastErrorAt: 0, lastErrorMessage: "", createdAt: now, updatedAt: now,
        });
        for (let index = 0; index < 2; index += 1)
          await ctx.db.insert("evidenceDocuments", {
            sourceId, externalKey: `${sourceKey}-${index}`, canonicalUrl: `https://example.com/${sourceKey}/${index}`,
            canonicalUrlHash: `${sourceKey}-${index}`, kind: "document", visibility: "public", title: `${sourceKey}-${index}`,
            excerpt: "Evidence row", searchText: "Evidence row", tags: [], authors: [], licenseClass: "open",
            currentVersionId: null, publishedAt: null, firstSeenAt: now - index, updatedAt: now - index,
          });
      }
      return datasetId;
    });
    const first = await t.query(jobs.records, { datasetId: seeded, limit: 2, selectionStrategy: "balanced" });
    const second = await t.query(jobs.records, { datasetId: seeded, limit: 2, selectionStrategy: "balanced", cursor: first.continueCursor });
    const third = await t.query(jobs.records, { datasetId: seeded, limit: 2, selectionStrategy: "balanced", cursor: second.continueCursor });
    expect(first.records.map((row: any) => row.source.sourceKey)).toEqual(["rotate-a", "rotate-b"]);
    expect(second.records.map((row: any) => row.source.sourceKey)).toEqual(["rotate-c", "rotate-a"]);
    expect(third.records.map((row: any) => row.source.sourceKey)).toEqual(["rotate-b", "rotate-c"]);
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
    await expect(t.mutation(jobs.cleanupVersions, { limit: 10 })).resolves.toEqual({
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
