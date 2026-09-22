/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { describe, expect, test } from "vitest";

import schema from "./schema";
import { deriveEvidence, parseKevPayload } from "./evidenceIngestion";

const modules = {
  ...import.meta.glob("./**/*.ts"),
  ...import.meta.glob("./**/*.tsx"),
};

const evidence = {
  upsertSource: makeFunctionReference<"mutation", any, any>(
    "evidence:upsertSource",
  ),
  upsertDocumentVersion: makeFunctionReference<"mutation", any, any>(
    "evidence:upsertDocumentVersion",
  ),
  upsertClaim: makeFunctionReference<"mutation", any, any>(
    "evidence:upsertClaim",
  ),
  upsertEntity: makeFunctionReference<"mutation", any, any>(
    "evidence:upsertEntity",
  ),
  linkDocumentEntity: makeFunctionReference<"mutation", any, any>(
    "evidence:linkDocumentEntity",
  ),
  recordCitation: makeFunctionReference<"mutation", any, any>(
    "evidence:recordCitation",
  ),
  searchPublic: makeFunctionReference<"query", any, any>(
    "evidence:searchPublic",
  ),
  getPublicDocument: makeFunctionReference<"query", any, any>(
    "evidence:getPublicDocument",
  ),
  timeline: makeFunctionReference<"query", any, any>(
    "evidence:listPublicClaimTimeline",
  ),
  backfillLegacy: makeFunctionReference<"mutation", any, any>(
    "evidence:backfillLegacyClaimBaselines",
  ),
} as any;

function setup() {
  return convexTest(schema, modules);
}

async function seedSource(t: ReturnType<typeof setup>) {
  return await t.mutation(evidence.upsertSource, {
    sourceKey: "openai-release-notes",
    name: "OpenAI release notes",
    sourceType: "rss",
    ingestionEnabled: true,
    baseUrl: "https://example.com/feed.xml",
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
  });
}

function versionArgs(sourceId: string, contentHash = "hash-v1") {
  return {
    sourceId: sourceId as never,
    externalKey: "release-2026-08",
    canonicalUrl: "https://example.com/releases/2026-08",
    canonicalUrlHash: "url-hash",
    contentHash,
    kind: "release" as const,
    visibility: "public" as const,
    title: "August release",
    excerpt: "A bounded public evidence excerpt.",
    searchText: "August release model availability public evidence",
    tags: ["release"],
    authors: ["Example"],
    documentLicenseClass: "attributed" as const,
    fetchedAt: 1_800_000_000_000,
    publishedAt: 1_799_000_000_000,
    sourceRevision: contentHash,
    sourceUpdatedAt: 1_800_000_000_000,
    retrievalUrl: "https://example.com/releases/2026-08",
    licenseClass: "attributed" as const,
  };
}

describe("durable evidence graph", () => {
  test("evidence writers maintain compact search rows and invalidate policy changes", async () => {
    const t = setup();
    const { sourceId } = await seedSource(t);
    const stored = await t.mutation(
      evidence.upsertDocumentVersion,
      versionArgs(sourceId),
    );
    const entityArgs = {
      entityKey: "project:projection-test",
      kind: "project",
      name: "Projection test",
      aliases: [],
      visibility: "public",
    };
    const entity = await t.mutation(evidence.upsertEntity, entityArgs);
    await t.mutation(evidence.linkDocumentEntity, {
      documentVersionId: stored.versionId,
      entityId: entity.entityId,
      role: "subject",
    });
    const claimArgs = {
      claimKey: "projection-claim",
      statement: "A searchable grounded claim",
      subjectEntityId: entity.entityId,
      predicate: "documents",
      objectText: "Search",
      status: "supported",
      confidence: 1,
      visibility: "public",
      observedAt: 1_800_000_000_000,
    };
    const claim = await t.mutation(evidence.upsertClaim, claimArgs);
    const projections = () =>
      t.run((ctx) => ctx.db.query("universalSearchProjections").collect());
    expect((await projections()).map((row) => row.type).sort()).toEqual([
      "evidence_document",
      "evidence_entity",
    ]);
    expect(
      (await projections()).find((row) => row.type === "evidence_entity"),
    ).toMatchObject({
      documentId: stored.documentId,
      documentVersionId: stored.versionId,
    });
    await t.mutation(evidence.recordCitation, {
      claimId: claim.claimId,
      documentVersionId: stored.versionId,
      citationKey: "projection-citation",
      relation: "supports",
      locator: "Example",
      excerpt: "Grounded citation",
      confidence: 1,
    });
    expect(
      (await projections()).find((row) => row.type === "evidence_claim")
        ?.citationCount,
    ).toBe(1);
    await t.mutation(evidence.upsertClaim, {
      ...claimArgs,
      statement: "Updated grounded claim",
    });
    expect(
      (await projections()).find((row) => row.type === "evidence_claim")?.title,
    ).toBe("Updated grounded claim");
    await t.mutation(evidence.upsertEntity, {
      ...entityArgs,
      visibility: "private",
    });
    expect(
      (await projections()).some((row) => row.type === "evidence_entity"),
    ).toBe(false);
    expect(
      await t.run(async (ctx) =>
        ctx.db
          .query("evidencePublicationState")
          .withIndex("by_key", (q) => q.eq("key", "evidence-publication"))
          .unique(),
      ),
    ).toMatchObject({ epoch: 1 });
    await t.mutation(evidence.upsertClaim, {
      ...claimArgs,
      visibility: "private",
    });
    expect(
      (await projections()).some((row) => row.type === "evidence_claim"),
    ).toBe(false);
    expect(
      await t.run(async (ctx) =>
        ctx.db
          .query("evidencePublicationState")
          .withIndex("by_key", (q) => q.eq("key", "evidence-publication"))
          .unique(),
      ),
    ).toMatchObject({ epoch: 2 });
    const source = await t.run((ctx) =>
      ctx.db.get("evidenceSources", sourceId),
    );
    const {
      _id: _sourceId,
      _creationTime: _creationTime,
      createdAt: _createdAt,
      updatedAt: _updatedAt,
      ...sourceArgs
    } = source!;
    await t.mutation(evidence.upsertSource, {
      ...sourceArgs,
      visibility: "private",
    });
    expect(
      await t.run(async (ctx) =>
        ctx.db
          .query("evidencePublicationState")
          .withIndex("by_key", (q) => q.eq("key", "evidence-publication"))
          .unique(),
      ),
    ).toMatchObject({ epoch: 3 });
    expect(
      await t.run(
        async (ctx) =>
          (
            await ctx.db
              .query("optimizationMigrations")
              .withIndex("by_key", (q) =>
                q.eq("key", "universal-search-projections-v1"),
              )
              .unique()
          )?.status,
      ),
    ).toBe("running");
  });

  test("derives CISA KEV entities, an exact-version claim citation, and replays idempotently", async () => {
    const t = setup();
    const [kev] = parseKevPayload({
      vulnerabilities: [
        {
          cveID: "CVE-2026-12345",
          vendorProject: "Example Vendor",
          product: "Example Product",
          shortDescription: "An actively exploited example vulnerability.",
          dateAdded: "2026-08-01",
          dueDate: "2026-08-15",
        },
      ],
    });
    expect(kev).toBeDefined();
    const { sourceId } = await seedSource(t);
    const stored = await t.mutation(evidence.upsertDocumentVersion, {
      ...versionArgs(sourceId, "kev-hash-v1"),
      externalKey: kev!.externalKey,
      canonicalUrl: kev!.canonicalUrl,
      canonicalUrlHash: "kev-url-hash",
      kind: kev!.kind,
      title: kev!.title,
      excerpt: kev!.excerpt,
      searchText: kev!.searchText,
      tags: kev!.tags,
      authors: kev!.authors,
      sourceRevision: kev!.sourceRevision,
      sourceUpdatedAt: kev!.sourceUpdatedAt,
    });
    const derived = deriveEvidence(kev!);
    async function persistDerived() {
      const ids = new Map<string, string>();
      for (const entity of derived.entities) {
        const { role, ...entityArgs } = entity;
        const upserted = await t.mutation(evidence.upsertEntity, {
          ...entityArgs,
          visibility: "public",
        });
        ids.set(entity.entityKey, upserted.entityId);
        await t.mutation(evidence.linkDocumentEntity, {
          documentVersionId: stored.versionId,
          entityId: upserted.entityId,
          role,
        });
      }
      for (const claim of derived.claims) {
        const upserted = await t.mutation(evidence.upsertClaim, {
          claimKey: claim.claimKey,
          statement: claim.statement,
          subjectEntityId: ids.get(claim.subjectEntityKey),
          predicate: claim.predicate,
          objectText: claim.objectText,
          status: "supported",
          confidence: 1,
          visibility: "public",
          observedAt: 1_800_000_000_000,
        });
        await t.mutation(evidence.recordCitation, {
          claimId: upserted.claimId,
          documentVersionId: stored.versionId,
          citationKey: `${claim.claimKey}:version:${stored.versionId}`,
          relation: "supports",
          locator: claim.locator,
          excerpt: claim.excerpt,
          confidence: 1,
        });
      }
    }
    await persistDerived();
    await persistDerived();
    await t.run(async (ctx) => {
      const entities = await ctx.db.query("evidenceEntities").collect();
      const links = await ctx.db.query("evidenceDocumentEntities").collect();
      const claims = await ctx.db.query("evidenceClaims").collect();
      const citations = await ctx.db.query("evidenceClaimCitations").collect();
      expect(entities.map((entity) => entity.entityKey)).toContain(
        "cve:cve-2026-12345",
      );
      expect(links).toHaveLength(4);
      expect(claims).toMatchObject([
        {
          claimKey: "cisa-kev:cve-2026-12345",
          status: "supported",
          statement:
            "CVE-2026-12345 is listed in CISA's Known Exploited Vulnerabilities catalog.",
        },
      ]);
      expect(citations).toMatchObject([
        {
          documentVersionId: stored.versionId,
          relation: "supports",
          excerpt: "An actively exploited example vulnerability.",
        },
      ]);
      expect(citations).toHaveLength(1);
    });
  });
  test("makes same source/external-key/hash idempotent and versions changed content", async () => {
    const t = setup();
    const { sourceId } = await seedSource(t);
    const first = await t.mutation(
      evidence.upsertDocumentVersion,
      versionArgs(sourceId),
    );
    const replay = await t.mutation(
      evidence.upsertDocumentVersion,
      versionArgs(sourceId),
    );
    const second = await t.mutation(evidence.upsertDocumentVersion, {
      ...versionArgs(sourceId, "hash-v2"),
      title: "September release",
    });
    expect(first).toMatchObject({ version: 1, idempotent: false });
    expect(replay).toMatchObject({
      version: 1,
      idempotent: true,
      versionId: first.versionId,
    });
    expect(second).toMatchObject({
      version: 2,
      idempotent: false,
      documentId: first.documentId,
    });
    await t.run(async (ctx) => {
      const events = await ctx.db
        .query("evidenceChangeEvents")
        .withIndex("by_visibility_and_occurredAt", (q) =>
          q.eq("visibility", "public"),
        )
        .take(10);
      expect(events).toHaveLength(2);
      expect(events.filter((event) => event.kind === "updated")).toHaveLength(
        1,
      );
    });
  });

  test("persists deterministic allowlisted field diffs and ignores non-semantic replay changes", async () => {
    const t = setup();
    const { sourceId } = await seedSource(t);
    const first = await t.mutation(
      evidence.upsertDocumentVersion,
      versionArgs(sourceId, "canonical-v1"),
    );
    expect(first.changedFields).toEqual([
      "title",
      "excerpt",
      "tags",
      "authors",
      "publishedAt",
      "kind",
      "visibility",
      "licenseClass",
    ]);
    const replay = await t.mutation(evidence.upsertDocumentVersion, {
      ...versionArgs(sourceId, "metadata-only-v2"),
      title: "  August   release ",
      excerpt: "A  bounded public evidence excerpt.",
      tags: ["release"],
      authors: ["Example"],
    });
    expect(replay).toMatchObject({
      idempotent: true,
      versionId: first.versionId,
      changedFields: [],
    });
    const updated = await t.mutation(evidence.upsertDocumentVersion, {
      ...versionArgs(sourceId, "semantic-v2"),
      title: "September release",
      tags: ["release", "platform"],
      authors: ["Example", "Editor"],
      publishedAt: 1_799_100_000_000,
      kind: "advisory",
      visibility: "private",
      documentLicenseClass: "restricted",
    });
    expect(updated).toMatchObject({
      idempotent: false,
      version: 2,
      changedFields: [
        "title",
        "tags",
        "authors",
        "publishedAt",
        "kind",
        "visibility",
        "licenseClass",
      ],
    });
    await t.run(async (ctx) => {
      const events = await ctx.db.query("evidenceChangeEvents").collect();
      expect(events).toHaveLength(2);
      expect(events[1]).toMatchObject({ changedFields: updated.changedFields });
    });
  });

  test("keeps non-public documents out of bounded search and document reads", async () => {
    const t = setup();
    const { sourceId } = await seedSource(t);
    const publicDocument = await t.mutation(
      evidence.upsertDocumentVersion,
      versionArgs(sourceId),
    );
    await t.mutation(evidence.upsertDocumentVersion, {
      ...versionArgs(sourceId, "private-hash"),
      externalKey: "private-release",
      canonicalUrl: "https://example.com/private",
      canonicalUrlHash: "private-url",
      visibility: "private",
    });
    const search = await t.query(evidence.searchPublic, {
      search: "release evidence",
      limit: 50,
    });
    expect(search).toHaveLength(1);
    expect(search[0]?.documentId).toBe(publicDocument.documentId);
    await expect(
      t.query(evidence.getPublicDocument, {
        documentId: publicDocument.documentId,
      }),
    ).resolves.toMatchObject({
      title: "August release",
      licenseClass: "attributed",
      source: {
        sourceKey: "openai-release-notes",
        provenanceClass: "official",
      },
      currentVersion: {
        documentVersionId: publicDocument.versionId,
        contentHash: "hash-v1",
      },
      citationMetrics: { total: 0, truncated: false },
    });
    await t.run((ctx) =>
      ctx.db.patch("evidenceSources", sourceId, { visibility: "private" }),
    );
    await expect(
      t.query(evidence.searchPublic, {
        search: "release evidence",
        limit: 50,
      }),
    ).resolves.toEqual([]);
    await expect(
      t.query(evidence.getPublicDocument, {
        documentId: publicDocument.documentId,
      }),
    ).resolves.toBeNull();
  });

  test("requires extant claim and immutable document version for citations", async () => {
    const t = setup();
    const { sourceId } = await seedSource(t);
    const document = await t.mutation(
      evidence.upsertDocumentVersion,
      versionArgs(sourceId),
    );
    const claim = await t.mutation(evidence.upsertClaim, {
      claimKey: "release-available",
      statement: "The release is available.",
      predicate: "availability",
      objectText: "available",
      status: "supported",
      confidence: 0.9,
      visibility: "public",
      observedAt: 1_800_000_000_000,
    });
    await expect(
      t.mutation(evidence.recordCitation, {
        claimId: claim.claimId,
        documentVersionId: document.versionId,
        citationKey: "release-available-v1",
        relation: "supports",
        locator: "paragraph 1",
        excerpt: "The release is available.",
        confidence: 0.9,
      }),
    ).resolves.toMatchObject({ created: true });
    await t.run(async (ctx) => {
      await ctx.db.delete("evidenceDocumentVersions", document.versionId);
    });
    await expect(
      t.mutation(evidence.recordCitation, {
        claimId: claim.claimId,
        documentVersionId: document.versionId,
        citationKey: "bad",
        relation: "supports",
        locator: "paragraph 1",
        excerpt: "Bad.",
        confidence: 0.9,
      }),
    ).rejects.toThrow(/must exist/i);
  });

  test("prevents public claims from citing private document versions", async () => {
    const t = setup();
    const { sourceId } = await seedSource(t);
    const document = await t.mutation(evidence.upsertDocumentVersion, {
      ...versionArgs(sourceId),
      externalKey: "private-release",
      canonicalUrl: "https://example.test/private-release",
      canonicalUrlHash: "private-url-hash",
      contentHash: "private-content-hash",
      visibility: "private",
    });
    const claim = await t.mutation(evidence.upsertClaim, {
      claimKey: "public-private-mismatch",
      statement: "This public statement must not expose private support.",
      predicate: "privacy",
      objectText: "protected",
      status: "supported",
      confidence: 0.9,
      visibility: "public",
      observedAt: 1_800_000_000_000,
    });
    await expect(
      t.mutation(evidence.recordCitation, {
        claimId: claim.claimId,
        documentVersionId: document.versionId,
        citationKey: "public-private-mismatch-v1",
        relation: "supports",
        locator: "private paragraph",
        excerpt: "Private evidence must not escape.",
        confidence: 0.9,
      }),
    ).rejects.toThrow(/public claim cannot cite a private document/i);
  });

  test("keeps an idempotent, public-only claim revision timeline with exact citations", async () => {
    const t = setup();
    const { sourceId } = await seedSource(t);
    const document = await t.mutation(
      evidence.upsertDocumentVersion,
      versionArgs(sourceId),
    );
    const first = await t.mutation(evidence.upsertClaim, {
      claimKey: "timeline-claim",
      statement: "The release is available to the public.",
      predicate: "availability",
      objectText: "available",
      status: "unresolved",
      confidence: 0.5,
      visibility: "public",
      observedAt: 1_800_000_000_000,
      actorType: "agent",
      actorId: "evidence-bot",
      source: "fixture",
    });
    await t.mutation(evidence.upsertClaim, {
      claimKey: "timeline-claim",
      statement: "The release is available to the public.",
      predicate: "availability",
      objectText: "available",
      status: "unresolved",
      confidence: 0.5,
      visibility: "public",
      observedAt: 1_800_000_000_000,
      actorType: "agent",
      actorId: "evidence-bot",
      source: "fixture",
    });
    await t.mutation(evidence.upsertClaim, {
      claimKey: "timeline-claim",
      statement: "The release is available to the public.",
      predicate: "availability",
      objectText: "available",
      status: "supported",
      confidence: 0.9,
      visibility: "public",
      observedAt: 1_800_000_000_001,
      actorType: "agent",
      actorId: "evidence-bot",
      source: "fixture",
    });
    await t.mutation(evidence.recordCitation, {
      claimId: first.claimId,
      documentVersionId: document.versionId,
      citationKey: "timeline-claim-v1",
      relation: "supports",
      locator: "paragraph 2",
      excerpt: "The release is available to the public.",
      confidence: 0.9,
      actorType: "agent",
      actorId: "evidence-bot",
      source: "fixture",
    });
    const timeline = await t.query(evidence.timeline, {
      claimKey: "timeline-claim",
      limit: 20,
    });
    expect(timeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          changeKind: "created",
          actorType: "agent",
          actorId: "evidence-bot",
          status: "unresolved",
        }),
        expect.objectContaining({ changeKind: "status", status: "supported" }),
        expect.objectContaining({
          changeKind: "evidence",
          citation: expect.objectContaining({
            documentVersionId: document.versionId,
            locator: "paragraph 2",
          }),
        }),
      ]),
    );
    await t.run(async (ctx) => {
      await ctx.db.patch("evidenceSources", sourceId, {
        visibility: "private",
      });
    });
    const afterPrivateSource = await t.query(evidence.timeline, {
      claimKey: "timeline-claim",
      limit: 20,
    });
    expect(
      afterPrivateSource.some(
        (entry: { changeKind: string }) => entry.changeKind === "evidence",
      ),
    ).toBe(false);
    await t.run(async (ctx) => {
      const revisions = await ctx.db
        .query("evidenceClaimRevisions")
        .withIndex("by_claimId_and_observedAt", (q) =>
          q.eq("claimId", first.claimId),
        )
        .collect();
      expect(revisions).toHaveLength(3);
      const evidenceRevision = revisions.find(
        (revision) => revision.changeKind === "evidence",
      )!;
      await ctx.db.patch("evidenceClaimRevisions", evidenceRevision._id, {
        visibility: "private",
      });
    });
    const afterPrivateRevision = await t.query(evidence.timeline, {
      claimKey: "timeline-claim",
      limit: 20,
    });
    expect(
      afterPrivateRevision.some(
        (entry: { changeKind: string }) => entry.changeKind === "evidence",
      ),
    ).toBe(false);
  });

  test("does not expose a public claim whose subject entity is private", async () => {
    const t = setup();
    await t.run(async (ctx) => {
      const privateEntityId = await ctx.db.insert("evidenceEntities", {
        entityKey: "private-subject",
        kind: "organization",
        name: "Private subject",
        aliases: [],
        visibility: "private",
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("evidenceClaims", {
        claimKey: "public-claim-private-subject",
        statement: "This must not leak its private subject.",
        subjectEntityId: privateEntityId,
        predicate: "visibility",
        objectText: "private",
        status: "unresolved",
        confidence: 0.5,
        visibility: "public",
        observedAt: 1,
        createdAt: 1,
        updatedAt: 1,
      });
    });
    await expect(
      t.query(evidence.timeline, {
        claimKey: "public-claim-private-subject",
        limit: 20,
      }),
    ).resolves.toEqual([]);
  });

  test("backfills bounded legacy baselines by cursor without inventing history", async () => {
    const t = setup();
    await t.run(async (ctx) => {
      for (const claimKey of ["legacy-a", "legacy-b"]) {
        await ctx.db.insert("evidenceClaims", {
          claimKey,
          statement: `${claimKey} current state`,
          subjectEntityId: null,
          predicate: "state",
          objectText: "current",
          status: "unresolved",
          confidence: 0.5,
          visibility: "public",
          observedAt: 1,
          createdAt: 1,
          updatedAt: 1,
        });
      }
    });
    const first = await t.mutation(evidence.backfillLegacy, { limit: 1 });
    expect(first).toMatchObject({ processed: 1, nextCursor: "legacy-a" });
    const second = await t.mutation(evidence.backfillLegacy, {
      cursor: first.nextCursor,
      limit: 1,
    });
    expect(second).toMatchObject({ processed: 1, nextCursor: null });
    await t.mutation(evidence.backfillLegacy, { limit: 100 });
    await t.run(async (ctx) => {
      const revisions = await ctx.db.query("evidenceClaimRevisions").collect();
      expect(revisions).toHaveLength(2);
      expect(revisions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            changeKind: "legacy-baseline",
            actorId: "legacy-backfill",
            source: "legacy-baseline",
          }),
        ]),
      );
    });
  });

  test("skips claims with created, semantic, or evidence revision history", async () => {
    const t = setup();
    await t.run(async (ctx) => {
      for (const changeKind of ["created", "semantic", "evidence"] as const) {
        const claimId = await ctx.db.insert("evidenceClaims", {
          claimKey: `already-${changeKind}`,
          statement: `${changeKind} claim`,
          subjectEntityId: null,
          predicate: "state",
          objectText: "current",
          status: "unresolved",
          confidence: 0.5,
          visibility: "public",
          observedAt: 1,
          createdAt: 1,
          updatedAt: 1,
        });
        await ctx.db.insert("evidenceClaimRevisions", {
          claimId,
          revisionKey: `existing-${changeKind}`,
          changeKind,
          statement: `${changeKind} claim`,
          subjectEntityId: null,
          predicate: "state",
          objectText: "current",
          status: "unresolved",
          confidence: 0.5,
          visibility: "public",
          observedAt: 1,
          actorType: "system",
          actorId: "test",
          source: "test",
          citationId: null,
          createdAt: 1,
          retentionExpiresAt: 9_999_999_999_999,
        });
      }
    });
    await t.mutation(evidence.backfillLegacy, { limit: 100 });
    await t.mutation(evidence.backfillLegacy, { limit: 100 });
    await t.run(async (ctx) => {
      const revisions = await ctx.db.query("evidenceClaimRevisions").collect();
      expect(revisions).toHaveLength(3);
      expect(
        revisions.every(
          (revision) => revision.changeKind !== "legacy-baseline",
        ),
      ).toBe(true);
    });
  });
});
