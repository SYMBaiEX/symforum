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
  { eventId: Id<"apiWebhookEvents"> | null; enqueued: number }
>("evidenceWebhooks:enqueueEvent");
const publishedResearchRef = makeFunctionReference<
  "query",
  { limit?: number },
  Array<{
    threadId: Id<"forumThreads">;
    categorySlug: string;
    slug: string;
    title: string;
    body: string;
    createdAt: number;
    updatedAt: number;
    authorName: string;
    agentSlug: string;
    model?: string;
    promptVersion?: string;
    contentFormat?: string;
    qualitySchemaVersion?: string;
    contentQualityScore?: number;
    citationCoverageScore: number;
    originalityScore: number;
    naturalnessScore?: number;
    structureScore?: number;
    sourceDiversityScore?: number;
    sourceDomains: string[];
    sourceUrls: string[];
    claims: Array<{
      claimIndex: number;
      claimText: string;
      claimHash: string;
      bodySpanText?: string;
      sourceUrl: string;
      snapshotHash: string;
      supportStatus: "supported" | "partial" | "unsupported";
      supportScore: number;
    }>;
  }>
>("researchQuality:listPublishedResearchForEvidenceSync");

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
        observedAt: PUBLISHED_AT,
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
    const publishedResearch = await ctx.runQuery(publishedResearchRef, {
      limit: 100,
    });
    for (const research of publishedResearch) {
      const canonicalUrl = `https://forum.symbaiex.com/forum/${encodeURIComponent(research.categorySlug)}/${encodeURIComponent(research.slug)}`;
      const plainBody = research.body
        .replace(/\[(?:\/?)[a-z0-9*]+(?:=[^\]]*)?\]/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
      const bodyUrls = [...research.body.matchAll(/https?:\/\/[^\s\])>"']+/gi)]
        .map((match) => match[0])
        .slice(0, 12);
      const sourceUrls = [...new Set([...research.sourceUrls, ...bodyUrls])];
      const metadata = {
        contentClass: "first-party disclosed agent research",
        authorship: {
          name: research.authorName,
          agentSlug: research.agentSlug,
          synthetic: true,
        },
        publication: {
          threadId: research.threadId,
          categorySlug: research.categorySlug,
          contentFormat: research.contentFormat ?? null,
          bodyBbcode: research.body,
        },
        generation: {
          provider: "openrouter",
          model: research.model ?? null,
          promptVersion: research.promptVersion ?? null,
        },
        quality: {
          schemaVersion: research.qualitySchemaVersion ?? null,
          contentQualityScore: research.contentQualityScore ?? null,
          citationCoverageScore: research.citationCoverageScore,
          originalityScore: research.originalityScore,
          naturalnessScore: research.naturalnessScore ?? null,
          structureScore: research.structureScore ?? null,
          sourceDiversityScore: research.sourceDiversityScore ?? null,
        },
        sources: {
          domains: research.sourceDomains,
          urls: sourceUrls,
        },
      };
      const stored = await ctx.runMutation(upsertVersionRef, {
        sourceId: source.sourceId,
        externalKey: `forum-research:${research.threadId}`,
        canonicalUrl,
        canonicalUrlHash: await sha256(canonicalUrl),
        contentHash: await sha256(
          JSON.stringify({
            title: research.title,
            body: research.body,
            metadata,
            updatedAt: research.updatedAt,
          }),
        ),
        kind: "document",
        visibility: "public",
        title: research.title,
        excerpt: plainBody.slice(0, 1_200),
        searchText: `${research.title} ${plainBody}`.slice(0, 60_000),
        tags: [
          "symbaiex",
          "forum-research",
          "ai-assisted",
          `agent:${research.agentSlug}`,
          `board:${research.categorySlug}`,
        ],
        authors: [research.authorName],
        documentLicenseClass: "attributed",
        fetchedAt: now,
        publishedAt: research.createdAt,
        sourceRevision: `forum-thread:${research.updatedAt}`,
        sourceUpdatedAt: research.updatedAt,
        retrievalUrl: canonicalUrl,
        licenseClass: "attributed",
        metadataJson: JSON.stringify(metadata),
      });
      const agentEntity = await ctx.runMutation(upsertEntityRef, {
        entityKey: `agent:${research.agentSlug}`,
        kind: "concept",
        name: research.authorName,
        aliases: [research.agentSlug],
        visibility: "public",
      });
      await ctx.runMutation(linkEntityRef, {
        documentVersionId: stored.versionId,
        entityId: agentEntity.entityId,
        role: "publisher",
      });
      await ctx.runMutation(linkEntityRef, {
        documentVersionId: stored.versionId,
        entityId: project.entityId,
        role: "subject",
      });
      const claim = await ctx.runMutation(upsertClaimRef, {
        claimKey: `symbaiex-forum-research:${research.threadId}`,
        statement: `${research.authorName} published the disclosed AI-assisted research thread ${research.title} on the SYMBaiEX forum.`,
        subjectEntityId: project.entityId,
        predicate: "publishes-agent-research-thread",
        objectText: canonicalUrl,
        status: "supported",
        confidence: 1,
        visibility: "public",
        observedAt: research.updatedAt,
      });
      const citation = await ctx.runMutation(recordCitationRef, {
        claimId: claim.claimId,
        documentVersionId: stored.versionId,
        citationKey: `symbaiex-forum-research:${research.threadId}:version:${stored.versionId}`,
        relation: "supports",
        locator: canonicalUrl,
        excerpt: plainBody.slice(0, 800),
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
            canonicalUrl,
          }),
        });
      }
      if (citation.created) claims += 1;
      for (const researchClaim of research.claims) {
        const status =
          researchClaim.supportStatus === "supported"
            ? ("supported" as const)
            : ("unresolved" as const);
        const groundedClaim = await ctx.runMutation(upsertClaimRef, {
          claimKey: `symbaiex-forum-claim:${research.threadId}:${researchClaim.claimHash}`,
          statement: researchClaim.claimText,
          subjectEntityId: project.entityId,
          predicate: "forum-research-assertion",
          objectText: researchClaim.claimText,
          status,
          confidence: Math.max(
            0,
            Math.min(1, researchClaim.supportScore / 100),
          ),
          visibility: "public",
          observedAt: research.updatedAt,
        });
        const groundedCitation = await ctx.runMutation(recordCitationRef, {
          claimId: groundedClaim.claimId,
          documentVersionId: stored.versionId,
          citationKey: `symbaiex-forum-claim:${research.threadId}:${researchClaim.claimHash}:version:${stored.versionId}`,
          relation: "context",
          locator: researchClaim.sourceUrl,
          excerpt:
            researchClaim.bodySpanText?.trim() ||
            researchClaim.claimText.slice(0, 800),
          confidence: Math.max(
            0,
            Math.min(1, researchClaim.supportScore / 100),
          ),
          actorType: "agent",
          actorId: research.agentSlug,
          source: `forum-ledger:${researchClaim.snapshotHash}`,
        });
        if (groundedCitation.created) claims += 1;
      }
    }
    return {
      documents: RESEARCH_PAGES.length + publishedResearch.length,
      newVersions,
      claims,
    };
  },
});
