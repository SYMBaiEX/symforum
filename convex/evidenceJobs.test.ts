/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { describe, expect, test } from "vitest";
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
  completeExport: makeFunctionReference<"mutation", any, any>(
    "evidenceJobs:completeExportJob",
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
describe("evidence jobs", () => {
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
      await ctx.db.insert("evidenceDocuments", {
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
    });
    const rows = await t.query(jobs.records, {
      datasetId: catalog.datasetId,
      limit: 999,
    });
    expect(rows[0]).toEqual(
      expect.objectContaining({ title: "Public", excerpt: "excerpt" }),
    );
    expect(JSON.stringify(rows[0])).not.toContain("rawStorageId");
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
    });
    const storageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(['{"record":1}\n'])),
    );
    await t.mutation(jobs.completeExport, {
      jobId: exportJob.jobId,
      resultJson: JSON.stringify({ recordCount: 1 }),
      resultStorageId: storageId,
      checksum: "checksum-one",
      recordCount: 1,
      artifactContentType: "application/x-ndjson",
      artifactByteLength: 13,
    });
    await t.run(async (ctx) => {
      const version = await ctx.db.query("evidenceDatasetVersions").unique();
      expect(version).toMatchObject({
        datasetId: catalog.datasetId,
        checksum: "checksum-one",
        recordCount: 1,
      });
    });
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
    await t.mutation(jobs.completeExport, {
      jobId: job.jobId,
      resultJson: "{}",
      resultStorageId: storageId,
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
    const crossOwner = await t
      .withIdentity({ subject: other })
      .fetch("/agent/artifact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "export", jobId: job.jobId }),
      });
    expect(crossOwner.status).toBe(404);
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
