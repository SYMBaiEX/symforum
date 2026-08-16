import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

const SOURCE_KEY = "symbaiex-first-party-research";
const PUBLISHED_AT = Date.UTC(2026, 7, 13);
const RESEARCH_PAGES = [
  {
    externalKey: "research-hub",
    canonicalUrl: "https://www.symbaiex.com/research",
    title: "SYMBaiEX research hubs",
    excerpt:
      "Curated research topic hubs with practical guidance, implementation notes, and source-backed references.",
    tags: ["symbaiex", "research", "topic-hub"],
  },
  {
    externalKey: "ai-readable-web",
    canonicalUrl: "https://www.symbaiex.com/research/ai-readable-web",
    title: "AI-readable web architecture",
    excerpt:
      "How SYMBaiEX publishes one truthful content graph across HTML, Markdown, sitemap, feeds, and machine-readable discovery surfaces.",
    tags: ["symbaiex", "research", "ai-readable-web", "aiao", "geo"],
  },
  {
    externalKey: "editorial-trust-and-contracts",
    canonicalUrl:
      "https://www.symbaiex.com/research/editorial-trust-and-contracts",
    title: "Editorial authority and machine contracts",
    excerpt:
      "How policy boundaries, canonical URLs, attribution, and machine-facing surfaces stay aligned.",
    tags: ["symbaiex", "research", "editorial-trust", "machine-contracts"],
  },
] as const;

const upsertSourceRef = makeFunctionReference<
  "mutation",
  Record<string, unknown>,
  { sourceId: Id<"evidenceSources">; created: boolean }
>("evidence:upsertSource");
const upsertVersionRef = makeFunctionReference<
  "mutation",
  Record<string, unknown>,
  {
    documentId: Id<"evidenceDocuments">;
    versionId: Id<"evidenceDocumentVersions">;
    version: number;
    idempotent: boolean;
  }
>("evidence:upsertDocumentVersion");
const upsertEntityRef = makeFunctionReference<
  "mutation",
  Record<string, unknown>,
  { entityId: Id<"evidenceEntities">; created: boolean }
>("evidence:upsertEntity");
const linkEntityRef = makeFunctionReference<
  "mutation",
  Record<string, unknown>,
  { linkId: Id<"evidenceDocumentEntities">; created: boolean }
>("evidence:linkDocumentEntity");
const upsertClaimRef = makeFunctionReference<
  "mutation",
  Record<string, unknown>,
  { claimId: Id<"evidenceClaims">; created: boolean }
>("evidence:upsertClaim");
const recordCitationRef = makeFunctionReference<
  "mutation",
  Record<string, unknown>,
  { citationId: Id<"evidenceClaimCitations">; created: boolean }
>("evidence:recordCitation");
const enqueueWebhookRef = makeFunctionReference<
  "mutation",
  Record<string, unknown>,
  { eventId: Id<"apiWebhookEvents">; enqueued: number }
>("evidenceWebhooks:enqueueEvent");

async function sha256(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/** Index the explicitly curated first-party research registry without scraping HTML. */
export const sync = internalAction({
  args: {},
  returns: v.object({
    documents: v.number(),
    newVersions: v.number(),
    claims: v.number(),
  }),
  handler: async (ctx) => {
    const now = Date.now();
    const source = await ctx.runMutation(upsertSourceRef, {
      sourceKey: SOURCE_KEY,
      name: "SYMBaiEX first-party research",
      sourceType: "manual",
      ingestionEnabled: true,
      baseUrl: "https://www.symbaiex.com/research",
      homepageUrl: "https://www.symbaiex.com/research",
      status: "active",
      licenseClass: "attributed",
      provenanceClass: "primary",
      visibility: "public",
      termsUrl: "https://www.symbaiex.com/ai-policy",
      etag: "",
      lastModified: "2026-08-13",
      cursor: "",
      lastFetchedAt: now,
      lastSucceededAt: now,
      lastErrorAt: 0,
      lastErrorMessage: "",
    });
    const author = await ctx.runMutation(upsertEntityRef, {
      entityKey: "person:austin-hamilton",
      kind: "person",
      name: "Austin Hamilton",
      aliases: [],
      visibility: "public",
    });
    const project = await ctx.runMutation(upsertEntityRef, {
      entityKey: "project:symbaiex",
      kind: "project",
      name: "SYMBaiEX",
      aliases: ["SYMBaIEX"],
      visibility: "public",
    });
    let newVersions = 0;
    let claims = 0;
    for (const page of RESEARCH_PAGES) {
      const contentHash = await sha256(
        JSON.stringify({
          title: page.title,
          excerpt: page.excerpt,
          tags: page.tags,
          publishedAt: PUBLISHED_AT,
        }),
      );
      const stored = await ctx.runMutation(upsertVersionRef, {
        sourceId: source.sourceId,
        externalKey: page.externalKey,
        canonicalUrl: page.canonicalUrl,
        canonicalUrlHash: await sha256(page.canonicalUrl),
        contentHash,
        kind: "document",
        visibility: "public",
        title: page.title,
        excerpt: page.excerpt,
        searchText: `${page.title} ${page.excerpt} ${page.tags.join(" ")}`,
        tags: [...page.tags],
        authors: ["Austin Hamilton"],
        documentLicenseClass: "attributed",
        fetchedAt: now,
        publishedAt: PUBLISHED_AT,
        sourceRevision: "research-registry-v1",
        sourceUpdatedAt: PUBLISHED_AT,
        retrievalUrl: page.canonicalUrl,
        licenseClass: "attributed",
        metadataJson: JSON.stringify({
          authorship: "Austin Hamilton",
          contentClass: "first-party research metadata",
          canonicalUrl: page.canonicalUrl,
        }),
      });
      await ctx.runMutation(linkEntityRef, {
        documentVersionId: stored.versionId,
        entityId: author.entityId,
        role: "publisher",
      });
      await ctx.runMutation(linkEntityRef, {
        documentVersionId: stored.versionId,
        entityId: project.entityId,
        role: "subject",
      });
      const claim = await ctx.runMutation(upsertClaimRef, {
        claimKey: `symbaiex-research:${page.externalKey}`,
        statement: `SYMBaiEX publishes ${page.title} at its canonical research URL.`,
        subjectEntityId: project.entityId,
        predicate: "publishes-research-page",
        objectText: page.canonicalUrl,
        status: "supported",
        confidence: 1,
        visibility: "public",
        observedAt: now,
      });
      const citation = await ctx.runMutation(recordCitationRef, {
        claimId: claim.claimId,
        documentVersionId: stored.versionId,
        citationKey: `symbaiex-research:${page.externalKey}:version:${stored.versionId}`,
        relation: "supports",
        locator: page.canonicalUrl,
        excerpt: page.excerpt,
        confidence: 1,
      });
      if (!stored.idempotent) {
        newVersions += 1;
        await ctx.runMutation(enqueueWebhookRef, {
          eventKey: `document:${stored.documentId}:version:${stored.version}`,
          eventType: "evidence.document.changed",
          payloadJson: JSON.stringify({
            documentId: stored.documentId,
            documentVersionId: stored.versionId,
            version: stored.version,
            canonicalUrl: page.canonicalUrl,
          }),
        });
      }
      if (citation.created) {
        claims += 1;
        await ctx.runMutation(enqueueWebhookRef, {
          eventKey: `claim:${claim.claimId}:version:${stored.versionId}`,
          eventType: "evidence.claim.verified",
          payloadJson: JSON.stringify({
            claimId: claim.claimId,
            documentVersionId: stored.versionId,
            status: "supported",
            confidence: 1,
          }),
        });
      }
    }
    return { documents: RESEARCH_PAGES.length, newVersions, claims };
  },
});
