import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import {
  env,
  internalAction,
  internalQuery,
  type ActionCtx,
} from "./_generated/server";
import {
  GITHUB_ALLOWLISTED_RELEASE_REPOSITORIES as RELEASE_REPOSITORIES,
  GITHUB_RELEASES_PER_REPOSITORY,
} from "./evidenceSourceRegistry";

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 12_000;
const MAX_ITEMS_PER_RUN = 100;
const USER_AGENT = "SYMBaiEX-Evidence-Ingestion/1.0 (+https://symbaiex.com)";
const ENRICHMENT_BACKFILL_SOURCES = [
  "nvd-cve-change-history",
  "cisa-kev",
  "github-advisories",
  "github-releases",
] as const;

type EvidenceKind = "document" | "advisory" | "release" | "paper";
type LicenseClass =
  | "public-domain"
  | "open"
  | "attributed"
  | "restricted"
  | "unknown";
type NormalizedDocument = {
  externalKey: string;
  canonicalUrl: string;
  kind: EvidenceKind;
  title: string;
  excerpt: string;
  searchText: string;
  tags: string[];
  authors: string[];
  publishedAt?: number;
  sourceRevision: string;
  sourceUpdatedAt: number;
  metadata: Record<string, unknown>;
};

type EvidenceEntityFact = {
  entityKey: string;
  kind: "organization" | "product" | "project" | "concept";
  name: string;
  aliases: string[];
  role: "subject" | "publisher" | "mentioned";
};

type EvidenceClaimFact = {
  claimKey: string;
  subjectEntityKey: string;
  statement: string;
  predicate: string;
  objectText: string;
  locator: string;
  excerpt: string;
};

type DerivedEvidence = {
  entities: EvidenceEntityFact[];
  claims: EvidenceClaimFact[];
};

type SourceConfig = {
  key: string;
  name: string;
  baseUrl: string;
  homepageUrl: string;
  termsUrl: string;
  sourceType: "api" | "dataset";
  provenanceClass: "official" | "research";
  licenseClass: LicenseClass;
};

type IngestionState = {
  etag: string;
  lastModified: string;
  cursor: string;
  lastSucceededAt: number;
  ingestionEnabled: boolean;
  status: "active" | "paused" | "retired";
};

// These bounded adapters are single-request snapshots. They do not implement
// pagination, so a generic RFC 8288 Link header is never a safe checkpoint.
const UNSUPPORTED_ADAPTER_CURSOR = "";

const backfillCandidatesRef = makeFunctionReference<
  "query",
  { limit: number },
  Array<{
    documentVersionId: string;
    externalKey: string;
    canonicalUrl: string;
    kind: EvidenceKind;
    title: string;
    excerpt: string;
    searchText: string;
    tags: string[];
    authors: string[];
    publishedAt?: number;
    sourceRevision: string;
    sourceUpdatedAt: number;
    metadataJson: string;
  }>
>("evidenceIngestion:listEnrichmentBackfillCandidates");

/** These adapters only checkpoint HTTP validators; Link pagination is ignored. */
export function adapterCheckpointCursor() {
  return UNSUPPORTED_ADAPTER_CURSOR;
}

const sourceStateRef = makeFunctionReference<
  "query",
  { sourceKey: string },
  IngestionState | null
>("evidenceIngestion:sourceState");
const upsertSourceRef = makeFunctionReference<
  "mutation",
  Record<string, unknown>,
  { sourceId: string }
>("evidence:upsertSource");
const upsertDocumentVersionRef = makeFunctionReference<
  "mutation",
  Record<string, unknown>,
  {
    documentId: string;
    versionId: string;
    version: number;
    idempotent: boolean;
    changedFields: string[];
  }
>("evidence:upsertDocumentVersion");
const upsertEntityRef = makeFunctionReference<
  "mutation",
  Record<string, unknown>,
  { entityId: string; created: boolean }
>("evidence:upsertEntity");
const linkDocumentEntityRef = makeFunctionReference<
  "mutation",
  Record<string, unknown>,
  { linkId: string; created: boolean }
>("evidence:linkDocumentEntity");
const upsertClaimRef = makeFunctionReference<
  "mutation",
  Record<string, unknown>,
  { claimId: string; created: boolean }
>("evidence:upsertClaim");
const recordCitationRef = makeFunctionReference<
  "mutation",
  Record<string, unknown>,
  { citationId: string; created: boolean }
>("evidence:recordCitation");
const recordSystemLogRef = makeFunctionReference<
  "mutation",
  Record<string, unknown>,
  unknown
>("systemLogs:record");
const enqueueWebhookRef = makeFunctionReference<
  "mutation",
  {
    eventKey: string;
    eventType: "evidence.document.changed" | "evidence.claim.verified";
    payloadJson: string;
  },
  { eventId: string | null; enqueued: number }
>("evidenceWebhooks:enqueueEvent");

export function sanitizeExcerpt(value: unknown, maximum = 700) {
  if (typeof value !== "string") return "";
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum);
}

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export async function sha256Hex(value: unknown) {
  const bytes = new TextEncoder().encode(stableJson(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function shouldIngestSource(state: IngestionState | null) {
  return (
    state === null || (state.ingestionEnabled && state.status === "active")
  );
}

export function shouldEnrichDocumentVersion(idempotent: boolean) {
  return !idempotent;
}

export function evidenceRequestHeaders(
  endpoint: string,
  state: IngestionState | null,
  githubToken = env.GITHUB_TOKEN ?? env.GH_TOKEN,
) {
  const endpointUrl = new URL(endpoint);
  return {
    ...(state?.etag ? { "If-None-Match": state.etag } : {}),
    ...(state?.lastModified ? { "If-Modified-Since": state.lastModified } : {}),
    ...(githubToken && endpointUrl.hostname === "api.github.com"
      ? { Authorization: `Bearer ${githubToken}` }
      : {}),
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}
function asArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}
function timestamp(value: unknown) {
  const parsed = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}
function url(value: unknown) {
  const candidate = asString(value);
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? parsed.toString()
      : "";
  } catch {
    return "";
  }
}

export function parseKevPayload(
  payload: unknown,
  limit = MAX_ITEMS_PER_RUN,
): NormalizedDocument[] {
  const root = asRecord(payload);
  const vulnerabilities = asArray(root?.vulnerabilities).slice(
    0,
    Math.max(0, Math.min(limit, MAX_ITEMS_PER_RUN)),
  );
  return vulnerabilities.flatMap((item) => {
    const row = asRecord(item);
    const cve = asString(row?.cveID);
    if (!row || !/^CVE-\d{4}-\d{4,}$/i.test(cve)) return [];
    const title = sanitizeExcerpt(
      `${asString(row.vendorProject)} ${asString(row.product)} ${cve}`,
      300,
    );
    if (!title) return [];
    const canonicalUrl = `https://www.cisa.gov/known-exploited-vulnerabilities-catalog?search_api_fulltext=${encodeURIComponent(cve)}`;
    const publishedAt = timestamp(row.dateAdded);
    const updatedAt = timestamp(row.dueDate) ?? publishedAt ?? 0;
    const excerpt = sanitizeExcerpt(row.shortDescription);
    return [
      {
        externalKey: cve.toUpperCase(),
        canonicalUrl,
        kind: "advisory" as const,
        title,
        excerpt:
          excerpt || "CISA Known Exploited Vulnerabilities catalog entry.",
        searchText: sanitizeExcerpt(
          `${title} ${excerpt} ${asString(row.knownRansomwareCampaignUse)}`,
          2_000,
        ),
        tags: ["cisa", "kev", cve.toLowerCase()],
        authors: ["CISA"],
        publishedAt,
        sourceRevision: `${asString(row.dateAdded)}:${asString(row.dueDate)}`,
        sourceUpdatedAt: updatedAt,
        metadata: {
          cve,
          vendorProject: sanitizeExcerpt(row.vendorProject, 180),
          product: sanitizeExcerpt(row.product, 180),
          dateAdded: asString(row.dateAdded),
          dueDate: asString(row.dueDate),
          ransomware: asString(row.knownRansomwareCampaignUse),
        },
      },
    ];
  });
}

export function parseGithubAdvisories(
  payload: unknown,
  limit = MAX_ITEMS_PER_RUN,
): NormalizedDocument[] {
  return asArray(payload)
    .slice(0, Math.max(0, Math.min(limit, MAX_ITEMS_PER_RUN)))
    .flatMap((item) => {
      const row = asRecord(item);
      const ghsa = asString(row?.ghsa_id);
      const canonicalUrl = url(row?.html_url);
      const title = sanitizeExcerpt(row?.summary, 300);
      if (!row || !/^GHSA-[\w-]+$/i.test(ghsa) || !canonicalUrl || !title)
        return [];
      const identifiers = asArray(row.identifiers)
        .flatMap((entry) => {
          const identifier = asRecord(entry);
          return identifier ? [sanitizeExcerpt(identifier.value, 100)] : [];
        })
        .filter(Boolean);
      const publishedAt = timestamp(row.published_at);
      const updatedAt = timestamp(row.updated_at) ?? publishedAt ?? 0;
      return [
        {
          externalKey: ghsa.toUpperCase(),
          canonicalUrl,
          kind: "advisory" as const,
          title,
          excerpt: title,
          searchText: sanitizeExcerpt(
            `${title} ${identifiers.join(" ")} ${asString(row.severity)}`,
            2_000,
          ),
          tags: [
            "github",
            "security-advisory",
            sanitizeExcerpt(row.severity, 30).toLowerCase(),
          ].filter(Boolean),
          authors: ["GitHub Security Advisory"],
          publishedAt,
          sourceRevision: asString(row.updated_at) || ghsa,
          sourceUpdatedAt: updatedAt,
          metadata: {
            ghsaId: ghsa,
            cveIds: identifiers.filter((id) => id.startsWith("CVE-")),
            severity: sanitizeExcerpt(row.severity, 30),
            publishedAt: asString(row.published_at),
            updatedAt: asString(row.updated_at),
          },
        },
      ];
    });
}

export function parseGithubReleases(
  payload: unknown,
  repository: string,
  limit = GITHUB_RELEASES_PER_REPOSITORY,
): NormalizedDocument[] {
  if (
    !RELEASE_REPOSITORIES.includes(
      repository as (typeof RELEASE_REPOSITORIES)[number],
    )
  )
    return [];
  return asArray(payload)
    .slice(0, Math.max(0, Math.min(limit, GITHUB_RELEASES_PER_REPOSITORY)))
    .flatMap((item) => {
      const row = asRecord(item);
      const tag = sanitizeExcerpt(row?.tag_name, 160);
      const canonicalUrl = url(row?.html_url);
      const title = sanitizeExcerpt(row?.name) || `${repository} ${tag}`;
      if (!row || !tag || !canonicalUrl || !title || row.draft === true)
        return [];
      const publishedAt = timestamp(row.published_at);
      const updatedAt = timestamp(row.created_at) ?? publishedAt ?? 0;
      return [
        {
          externalKey: `${repository}@${tag}`,
          canonicalUrl,
          kind: "release" as const,
          title: title.slice(0, 300),
          excerpt: sanitizeExcerpt(`Release ${tag} for ${repository}.`, 300),
          searchText: sanitizeExcerpt(`${repository} ${tag} ${title}`, 1_000),
          tags: ["github", "release", ...repository.split("/")],
          authors: [repository],
          publishedAt,
          sourceRevision: asString(row.target_commitish) || tag,
          sourceUpdatedAt: updatedAt,
          metadata: {
            repository,
            tag,
            prerelease: row.prerelease === true,
            publishedAt: asString(row.published_at),
            targetCommitish: sanitizeExcerpt(row.target_commitish, 100),
          },
        },
      ];
    });
}

export function parseCrossrefWorks(
  payload: unknown,
  limit = MAX_ITEMS_PER_RUN,
): NormalizedDocument[] {
  const root = asRecord(payload);
  const message = asRecord(root?.message);
  return asArray(message?.items)
    .slice(0, Math.max(0, Math.min(limit, MAX_ITEMS_PER_RUN)))
    .flatMap((item) => {
      const row = asRecord(item);
      const doi = sanitizeExcerpt(row?.DOI, 300);
      const canonicalUrl = url(row?.URL);
      const title = sanitizeExcerpt(asArray(row?.title)[0], 500);
      if (!row || !doi || !canonicalUrl || !title) return [];
      const authors = asArray(row.author)
        .flatMap((person) => {
          const author = asRecord(person);
          const name = sanitizeExcerpt(
            `${asString(author?.given)} ${asString(author?.family)}`,
            160,
          );
          return name ? [name] : [];
        })
        .slice(0, 20);
      const issued = asRecord(row.issued);
      const dateParts = asArray(issued?.["date-parts"])[0];
      const publishedAt =
        Array.isArray(dateParts) &&
        dateParts.every((part) => typeof part === "number")
          ? Date.UTC(
              dateParts[0] as number,
              ((dateParts[1] as number | undefined) ?? 1) - 1,
              (dateParts[2] as number | undefined) ?? 1,
            )
          : undefined;
      return [
        {
          externalKey: doi.toLowerCase(),
          canonicalUrl,
          kind: "paper" as const,
          title,
          excerpt: sanitizeExcerpt(
            `${asString(row.publisher)} metadata record for ${title}.`,
            500,
          ),
          searchText: sanitizeExcerpt(
            `${title} ${authors.join(" ")} ${asString(row.publisher)} ${asString(row.type)}`,
            2_000,
          ),
          tags: [
            "crossref",
            sanitizeExcerpt(row.type, 80).toLowerCase(),
          ].filter(Boolean),
          authors,
          publishedAt,
          sourceRevision:
            asString(row.indexed && asRecord(row.indexed)?.["date-time"]) ||
            doi,
          sourceUpdatedAt: publishedAt ?? 0,
          metadata: {
            doi,
            publisher: sanitizeExcerpt(row.publisher, 240),
            type: sanitizeExcerpt(row.type, 80),
            publishedAt: publishedAt ?? null,
          },
        },
      ];
    });
}

function entityKey(prefix: string, value: string) {
  return `${prefix}:${sanitizeExcerpt(value, 140).toLowerCase()}`;
}

function supportedClaim(
  claimKey: string,
  subjectEntityKey: string,
  statement: string,
  predicate: string,
  objectText: string,
  locator: string,
  excerpt: string,
): EvidenceClaimFact {
  return {
    claimKey,
    subjectEntityKey,
    statement: sanitizeExcerpt(statement, 1_000),
    predicate: sanitizeExcerpt(predicate, 160),
    objectText: sanitizeExcerpt(objectText, 1_000),
    locator: sanitizeExcerpt(locator, 600),
    excerpt: sanitizeExcerpt(excerpt, 2_000),
  };
}

/**
 * Extract only facts that are explicit in the normalized upstream record. The
 * result is intentionally deterministic: no model, fuzzy matching, or
 * inferred relationship is permitted on the ingestion path.
 */
export function deriveEvidence(document: NormalizedDocument): DerivedEvidence {
  const metadata = document.metadata;
  const nvdCve = sanitizeExcerpt(metadata.cveId, 100).toUpperCase();
  if (nvdCve && /^CVE-\d{4}-\d{4,}$/i.test(nvdCve)) {
    const cveKey = entityKey("cve", nvdCve);
    return {
      entities: [
        {
          entityKey: cveKey,
          kind: "concept",
          name: nvdCve,
          aliases: [],
          role: "subject",
        },
        {
          entityKey: "organization:nvd",
          kind: "organization",
          name: "National Vulnerability Database",
          aliases: ["NVD"],
          role: "publisher",
        },
      ],
      claims: [
        supportedClaim(
          `nvd-cve:${nvdCve.toLowerCase()}`,
          cveKey,
          `${nvdCve} has a record in the National Vulnerability Database.`,
          "published-in-nvd",
          "National Vulnerability Database",
          document.canonicalUrl,
          document.excerpt,
        ),
      ],
    };
  }
  const cve = sanitizeExcerpt(metadata.cve, 100).toUpperCase();
  if (cve && /^CVE-\d{4}-\d{4,}$/i.test(cve)) {
    const cveKey = entityKey("cve", cve);
    const entities: EvidenceEntityFact[] = [
      {
        entityKey: cveKey,
        kind: "concept",
        name: cve,
        aliases: [],
        role: "subject",
      },
      {
        entityKey: "organization:cisa",
        kind: "organization",
        name: "CISA",
        aliases: ["Cybersecurity and Infrastructure Security Agency"],
        role: "publisher",
      },
    ];
    const vendor = sanitizeExcerpt(metadata.vendorProject, 180);
    const product = sanitizeExcerpt(metadata.product, 180);
    if (vendor) {
      entities.push({
        entityKey: entityKey("organization", vendor),
        kind: "organization",
        name: vendor,
        aliases: [],
        role: "mentioned",
      });
    }
    if (product) {
      entities.push({
        entityKey: entityKey("product", product),
        kind: "product",
        name: product,
        aliases: [],
        role: "mentioned",
      });
    }
    return {
      entities,
      claims: [
        supportedClaim(
          `cisa-kev:${cve.toLowerCase()}`,
          cveKey,
          `${cve} is listed in CISA's Known Exploited Vulnerabilities catalog.`,
          "listed-in-cisa-kev",
          "CISA Known Exploited Vulnerabilities catalog",
          `CISA KEV entry ${cve}`,
          document.excerpt,
        ),
      ],
    };
  }

  const ghsa = sanitizeExcerpt(metadata.ghsaId, 100).toUpperCase();
  if (ghsa && /^GHSA-[\w-]+$/i.test(ghsa)) {
    const advisoryKey = entityKey("ghsa", ghsa);
    return {
      entities: [
        {
          entityKey: advisoryKey,
          kind: "concept",
          name: ghsa,
          aliases: [],
          role: "subject",
        },
        {
          entityKey: "organization:github",
          kind: "organization",
          name: "GitHub",
          aliases: [],
          role: "publisher",
        },
      ],
      claims: [
        supportedClaim(
          `github-advisory:${ghsa.toLowerCase()}`,
          advisoryKey,
          `${ghsa} is published in GitHub's Global Security Advisories.`,
          "published-in-github-advisories",
          "GitHub Global Security Advisories",
          `GitHub advisory ${ghsa}`,
          document.excerpt,
        ),
      ],
    };
  }

  const repository = sanitizeExcerpt(metadata.repository, 200);
  const tag = sanitizeExcerpt(metadata.tag, 160);
  if (repository && tag) {
    const projectKey = entityKey("repository", repository);
    return {
      entities: [
        {
          entityKey: projectKey,
          kind: "project",
          name: repository,
          aliases: [],
          role: "subject",
        },
        {
          entityKey: "organization:github",
          kind: "organization",
          name: "GitHub",
          aliases: [],
          role: "publisher",
        },
      ],
      claims: [
        supportedClaim(
          `github-release:${repository.toLowerCase()}:${tag.toLowerCase()}`,
          projectKey,
          `${repository} published release ${tag}.`,
          "published-release",
          tag,
          `GitHub release ${repository}@${tag}`,
          document.excerpt,
        ),
      ],
    };
  }

  const doi = sanitizeExcerpt(metadata.doi, 300).toLowerCase();
  if (doi) {
    const paperKey = entityKey("doi", doi);
    const publisher = sanitizeExcerpt(metadata.publisher, 240);
    return {
      entities: [
        {
          entityKey: paperKey,
          kind: "concept",
          name: doi,
          aliases: [],
          role: "subject",
        },
        ...(publisher
          ? [
              {
                entityKey: entityKey("organization", publisher),
                kind: "organization" as const,
                name: publisher,
                aliases: [],
                role: "publisher" as const,
              },
            ]
          : []),
      ],
      claims: [
        supportedClaim(
          `crossref-metadata:${doi}`,
          paperKey,
          `Crossref provides a metadata record for DOI ${doi}.`,
          "has-crossref-metadata",
          doi,
          `Crossref work ${doi}`,
          document.excerpt,
        ),
      ],
    };
  }

  return { entities: [], claims: [] };
}

async function enrichDocument(
  ctx: ActionCtx,
  document: NormalizedDocument,
  documentVersionId: string,
  observedAt: number,
) {
  const derived = deriveEvidence(document);
  const entities = new Map<string, string>();
  for (const fact of derived.entities) {
    const result = await ctx.runMutation(upsertEntityRef, {
      entityKey: fact.entityKey,
      kind: fact.kind,
      name: fact.name,
      aliases: fact.aliases,
      visibility: "public",
    });
    entities.set(fact.entityKey, result.entityId);
    await ctx.runMutation(linkDocumentEntityRef, {
      documentVersionId,
      entityId: result.entityId,
      role: fact.role,
    });
  }
  for (const claimFact of derived.claims) {
    const subjectEntityId = entities.get(claimFact.subjectEntityKey);
    if (!subjectEntityId) continue;
    const claim = await ctx.runMutation(upsertClaimRef, {
      claimKey: claimFact.claimKey,
      statement: claimFact.statement,
      subjectEntityId,
      predicate: claimFact.predicate,
      objectText: claimFact.objectText,
      status: "supported",
      confidence: 1,
      visibility: "public",
      observedAt,
    });
    const citation = await ctx.runMutation(recordCitationRef, {
      claimId: claim.claimId,
      documentVersionId,
      citationKey: `${claimFact.claimKey}:version:${documentVersionId}`,
      relation: "supports",
      locator: claimFact.locator,
      excerpt: claimFact.excerpt,
      confidence: 1,
    });
    if (citation.created) {
      await ctx.runMutation(enqueueWebhookRef, {
        eventKey: `claim:${claim.claimId}:version:${documentVersionId}`,
        eventType: "evidence.claim.verified",
        payloadJson: JSON.stringify({
          claimId: claim.claimId,
          documentVersionId,
          status: "supported",
          confidence: 1,
        }),
      });
    }
  }
}

/** Finds a bounded batch of legacy versions that predate deterministic enrichment. */
export const listEnrichmentBackfillCandidates = internalQuery({
  args: { limit: v.number() },
  returns: v.array(
    v.object({
      documentVersionId: v.id("evidenceDocumentVersions"),
      externalKey: v.string(),
      canonicalUrl: v.string(),
      kind: v.union(
        v.literal("document"),
        v.literal("advisory"),
        v.literal("release"),
        v.literal("paper"),
      ),
      title: v.string(),
      excerpt: v.string(),
      searchText: v.string(),
      tags: v.array(v.string()),
      authors: v.array(v.string()),
      publishedAt: v.optional(v.number()),
      sourceRevision: v.string(),
      sourceUpdatedAt: v.number(),
      metadataJson: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(100, Math.floor(args.limit)));
    const results = [];
    for (const sourceKey of ENRICHMENT_BACKFILL_SOURCES) {
      if (results.length >= limit) break;
      const source = await ctx.db
        .query("evidenceSources")
        .withIndex("by_sourceKey", (q) => q.eq("sourceKey", sourceKey))
        .unique();
      if (source === null) continue;
      const documents = await ctx.db
        .query("evidenceDocuments")
        .withIndex("by_sourceId_and_visibility_and_updatedAt", (q) =>
          q.eq("sourceId", source._id).eq("visibility", "public"),
        )
        .order("desc")
        .take(250);
      for (const document of documents) {
        if (results.length >= limit || document.currentVersionId === null)
          break;
        const version = await ctx.db.get(
          "evidenceDocumentVersions",
          document.currentVersionId,
        );
        if (version === null) continue;
        const existing = await ctx.db
          .query("evidenceClaimCitations")
          .withIndex("by_documentVersionId", (q) =>
            q.eq("documentVersionId", version._id),
          )
          .first();
        if (existing !== null) continue;
        results.push({
          documentVersionId: version._id,
          externalKey: document.externalKey,
          canonicalUrl: document.canonicalUrl,
          kind: document.kind as EvidenceKind,
          title: document.title,
          excerpt: document.excerpt,
          searchText: document.searchText,
          tags: document.tags,
          authors: document.authors,
          ...(document.publishedAt === null
            ? {}
            : { publishedAt: document.publishedAt }),
          sourceRevision: version.sourceRevision,
          sourceUpdatedAt: version.sourceUpdatedAt,
          metadataJson: version.metadataJson,
        });
      }
    }
    return results;
  },
});

/** Reconstructs entity, claim, and citation rows without model inference. */
export const backfillDerivedEvidence = internalAction({
  args: { limit: v.optional(v.number()) },
  returns: v.object({ examined: v.number(), enriched: v.number() }),
  handler: async (ctx, args) => {
    const candidates = await ctx.runQuery(backfillCandidatesRef, {
      limit: Math.max(1, Math.min(100, Math.floor(args.limit ?? 50))),
    });
    let enriched = 0;
    for (const candidate of candidates) {
      let metadata: Record<string, unknown> = {};
      try {
        const parsed: unknown = JSON.parse(candidate.metadataJson);
        if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed))
          metadata = parsed as Record<string, unknown>;
      } catch {
        continue;
      }
      const document: NormalizedDocument = {
        externalKey: candidate.externalKey,
        canonicalUrl: candidate.canonicalUrl,
        kind: candidate.kind,
        title: candidate.title,
        excerpt: candidate.excerpt,
        searchText: candidate.searchText,
        tags: candidate.tags,
        authors: candidate.authors,
        publishedAt: candidate.publishedAt,
        sourceRevision: candidate.sourceRevision,
        sourceUpdatedAt: candidate.sourceUpdatedAt,
        metadata,
      };
      if (deriveEvidence(document).claims.length === 0) continue;
      await enrichDocument(ctx, document, candidate.documentVersionId, Date.now());
      enriched += 1;
    }
    return { examined: candidates.length, enriched };
  },
});

export const sourceState = internalQuery({
  args: { sourceKey: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      etag: v.string(),
      lastModified: v.string(),
      cursor: v.string(),
      lastSucceededAt: v.number(),
      ingestionEnabled: v.boolean(),
      status: v.union(
        v.literal("active"),
        v.literal("paused"),
        v.literal("retired"),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    const source = await ctx.db
      .query("evidenceSources")
      .withIndex("by_sourceKey", (q) =>
        q.eq("sourceKey", args.sourceKey.toLowerCase()),
      )
      .unique();
    return source
      ? {
          etag: source.etag,
          lastModified: source.lastModified,
          cursor: adapterCheckpointCursor(),
          lastSucceededAt: source.lastSucceededAt,
          ingestionEnabled: source.ingestionEnabled,
          status: source.status,
        }
      : null;
  },
});

async function fetchJsonOnce(
  urlValue: string,
  headers: Record<string, string>,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(urlValue, {
      headers: {
        Accept: "application/json",
        "User-Agent": USER_AGENT,
        ...headers,
      },
      signal: controller.signal,
      redirect: "error",
    });
    if (response.status === 304)
      return {
        status: 304 as const,
        payload: null,
        etag: response.headers.get("etag") ?? "",
        lastModified: response.headers.get("last-modified") ?? "",
      };
    if (!response.ok) {
      const error = new Error(`Upstream returned HTTP ${response.status}`);
      Object.assign(error, { status: response.status });
      throw error;
    }
    const body = await response.arrayBuffer();
    if (body.byteLength > MAX_BODY_BYTES)
      throw new Error("Upstream response exceeded 2 MiB limit");
    return {
      status: 200 as const,
      payload: JSON.parse(new TextDecoder().decode(body)) as unknown,
      etag: response.headers.get("etag") ?? "",
      lastModified: response.headers.get("last-modified") ?? "",
    };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(urlValue: string, headers: Record<string, string>) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await fetchJsonOnce(urlValue, headers);
    } catch (error) {
      lastError = error;
      const status =
        error instanceof Error && "status" in error
          ? Number((error as Error & { status?: number }).status)
          : 0;
      const retryable = status === 0 || status === 429 || status >= 500;
      if (!retryable || attempt === 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
  throw lastError;
}

async function logFailure(ctx: ActionCtx, scope: string, error: unknown) {
  const message =
    sanitizeExcerpt(
      error instanceof Error ? error.message : "Evidence ingestion failed",
      500,
    ) || "Evidence ingestion failed";
  await ctx.runMutation(recordSystemLogRef, {
    level: "error",
    source: "convex",
    scope: "evidence-ingestion",
    eventType: "upstream_fetch_failed",
    message,
    component: "evidenceIngestion",
    action: scope,
    fingerprint: `evidence-ingestion:${scope}:${message}`,
  });
  return message;
}

async function ingest(
  ctx: ActionCtx,
  config: SourceConfig,
  endpoint: string,
  parser: (payload: unknown) => NormalizedDocument[],
) {
  const state = await ctx.runQuery(sourceStateRef, { sourceKey: config.key });
  const now = Date.now();
  if (!shouldIngestSource(state)) {
    return { ok: true, skipped: true, ingested: 0, failed: 0 };
  }
  try {
    const response = await fetchJson(
      endpoint,
      evidenceRequestHeaders(endpoint, state),
    );
    const source = await ctx.runMutation(upsertSourceRef, {
      sourceKey: config.key,
      name: config.name,
      sourceType: config.sourceType,
      ingestionEnabled: state?.ingestionEnabled ?? true,
      baseUrl: config.baseUrl,
      homepageUrl: config.homepageUrl,
      status: state?.status ?? "active",
      licenseClass: config.licenseClass,
      provenanceClass: config.provenanceClass,
      visibility: "public",
      termsUrl: config.termsUrl,
      etag: response.etag || state?.etag || "",
      lastModified: response.lastModified || state?.lastModified || "",
      // Deliberately clear any legacy Link header: adapter checkpoints are
      // validator-only (ETag/Last-Modified) until a source-specific cursor is
      // implemented and tested.
      cursor: adapterCheckpointCursor(),
      lastFetchedAt: now,
      lastSucceededAt: now,
      lastErrorAt: 0,
      lastErrorMessage: "",
    });
    if (response.status === 304)
      return { ok: true, skipped: true, ingested: 0, failed: 0 };
    const documents = parser(response.payload);
    let ingested = 0;
    let failed = 0;
    for (const document of documents) {
      try {
        const contentHash = await sha256Hex(document);
        const stored = await ctx.runMutation(upsertDocumentVersionRef, {
          sourceId: source.sourceId,
          externalKey: document.externalKey,
          canonicalUrl: document.canonicalUrl,
          canonicalUrlHash: await sha256Hex(document.canonicalUrl),
          contentHash,
          kind: document.kind,
          visibility: "public",
          title: document.title,
          excerpt: document.excerpt,
          searchText: document.searchText,
          tags: document.tags.slice(0, 40),
          authors: document.authors.slice(0, 80),
          documentLicenseClass: config.licenseClass,
          fetchedAt: now,
          publishedAt: document.publishedAt,
          sourceRevision: document.sourceRevision || contentHash,
          sourceUpdatedAt: document.sourceUpdatedAt || now,
          retrievalUrl: document.canonicalUrl,
          licenseClass: config.licenseClass,
          metadataJson: stableJson(document.metadata).slice(0, 8_000),
        });
        if (shouldEnrichDocumentVersion(stored.idempotent)) {
          await enrichDocument(ctx, document, stored.versionId, now);
          await ctx.runMutation(enqueueWebhookRef, {
            eventKey: `document:${stored.documentId}:version:${stored.version}`,
            eventType: "evidence.document.changed",
            payloadJson: JSON.stringify({
              documentId: stored.documentId,
              documentVersionId: stored.versionId,
              version: stored.version,
              kind: document.kind,
              canonicalUrl: document.canonicalUrl,
              changedFields: stored.changedFields,
            }),
          });
        }
        ingested++;
      } catch {
        failed++;
      }
    }
    return { ok: true, skipped: false, ingested, failed };
  } catch (error) {
    const message = await logFailure(ctx, config.key, error);
    try {
      await ctx.runMutation(upsertSourceRef, {
        sourceKey: config.key,
        name: config.name,
        sourceType: config.sourceType,
        ingestionEnabled: state?.ingestionEnabled ?? true,
        baseUrl: config.baseUrl,
        homepageUrl: config.homepageUrl,
        status: state?.status ?? "active",
        licenseClass: config.licenseClass,
        provenanceClass: config.provenanceClass,
        visibility: "public",
        termsUrl: config.termsUrl,
        etag: state?.etag || "",
        lastModified: state?.lastModified || "",
        cursor: adapterCheckpointCursor(),
        lastFetchedAt: now,
        lastSucceededAt: state?.lastSucceededAt || 0,
        lastErrorAt: Date.now(),
        lastErrorMessage: message,
      });
    } catch {
      // The original error is already captured in the central system log.
    }
    return {
      ok: false,
      skipped: false,
      ingested: 0,
      failed: 1,
      error: message,
    };
  }
}

const resultValidator = v.object({
  ok: v.boolean(),
  skipped: v.boolean(),
  ingested: v.number(),
  failed: v.number(),
  error: v.optional(v.string()),
});
export const syncCisaKev = internalAction({
  args: {},
  returns: resultValidator,
  handler: async (ctx) =>
    ingest(
      ctx,
      {
        key: "cisa-kev",
        name: "CISA Known Exploited Vulnerabilities",
        sourceType: "dataset",
        baseUrl:
          "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json",
        homepageUrl:
          "https://www.cisa.gov/known-exploited-vulnerabilities-catalog",
        termsUrl: "https://www.cisa.gov/website-information",
        provenanceClass: "official",
        licenseClass: "public-domain",
      },
      "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json",
      parseKevPayload,
    ),
});
export const syncGithubAdvisories = internalAction({
  args: {},
  returns: resultValidator,
  handler: async (ctx) =>
    ingest(
      ctx,
      {
        key: "github-global-advisories",
        name: "GitHub Global Security Advisories",
        sourceType: "api",
        baseUrl: "https://api.github.com/advisories",
        homepageUrl: "https://github.com/advisories",
        termsUrl:
          "https://docs.github.com/en/site-policy/github-terms/github-terms-of-service",
        provenanceClass: "official",
        licenseClass: "attributed",
      },
      "https://api.github.com/advisories?per_page=100",
      parseGithubAdvisories,
    ),
});
export const syncGithubReleases = internalAction({
  args: {},
  returns: resultValidator,
  handler: async (ctx) => {
    let ingested = 0;
    let failed = 0;
    for (const repository of RELEASE_REPOSITORIES) {
      const result = await ingest(
        ctx,
        {
          key: `github-releases-${repository.replace("/", "-")}`,
          name: `GitHub releases: ${repository}`,
          sourceType: "api",
          baseUrl: `https://api.github.com/repos/${repository}/releases`,
          homepageUrl: `https://github.com/${repository}/releases`,
          termsUrl:
            "https://docs.github.com/en/site-policy/github-terms/github-terms-of-service",
          provenanceClass: "official",
          licenseClass: "attributed",
        },
        `https://api.github.com/repos/${repository}/releases?per_page=${GITHUB_RELEASES_PER_REPOSITORY}`,
        (payload) => parseGithubReleases(payload, repository),
      );
      ingested += result.ingested;
      failed += result.failed;
    }
    return { ok: failed === 0, skipped: false, ingested, failed };
  },
});
export const syncCrossref = internalAction({
  args: {},
  returns: resultValidator,
  handler: async (ctx) =>
    ingest(
      ctx,
      {
        key: "crossref-curated-metadata",
        name: "Crossref curated research metadata",
        sourceType: "api",
        baseUrl: "https://api.crossref.org/works",
        homepageUrl: "https://www.crossref.org/",
        termsUrl: "https://www.crossref.org/terms/",
        provenanceClass: "research",
        licenseClass: "attributed",
      },
      "https://api.crossref.org/works?query.bibliographic=software%20supply%20chain%20security&rows=100&select=DOI,title,author,published,URL,type,publisher,issued,indexed",
      parseCrossrefWorks,
    ),
});
