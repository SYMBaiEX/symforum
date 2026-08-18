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
    const second = await t.mutation(
      evidence.upsertDocumentVersion,
      versionArgs(sourceId, "hash-v2"),
    );
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
    ).resolves.toMatchObject({ title: "August release" });
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
});
