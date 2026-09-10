import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  query,
  type MutationCtx,
} from "./_generated/server";
import {
  requireAgentScope,
  requireAuthenticatedUser,
  type AgentScope,
} from "./authz";
import { sha256Base64Url } from "./agentIdentityCrypto";

const visibilityValidator = v.union(v.literal("public"), v.literal("private"));
const licenseClassValidator = v.union(
  v.literal("public-domain"),
  v.literal("open"),
  v.literal("attributed"),
  v.literal("restricted"),
  v.literal("unknown"),
);
const sourceStatusValidator = v.union(
  v.literal("active"),
  v.literal("paused"),
  v.literal("retired"),
);
const provenanceClassValidator = v.union(
  v.literal("primary"),
  v.literal("official"),
  v.literal("dataset"),
  v.literal("research"),
  v.literal("derived"),
);
const documentKindValidator = v.union(
  v.literal("document"),
  v.literal("advisory"),
  v.literal("release"),
  v.literal("paper"),
  v.literal("dataset"),
  v.literal("benchmark"),
);
const claimStatusValidator = v.union(
  v.literal("supported"),
  v.literal("contradicted"),
  v.literal("unresolved"),
  v.literal("outdated"),
);
const changeKindValidator = v.union(
  v.literal("created"),
  v.literal("updated"),
  v.literal("status-changed"),
);
const claimRevisionChangeKindValidator = v.union(
  v.literal("created"),
  v.literal("legacy-baseline"),
  v.literal("semantic"),
  v.literal("status"),
  v.literal("evidence"),
);
const claimRevisionActorTypeValidator = v.union(
  v.literal("system"),
  v.literal("agent"),
  v.literal("human"),
);
const CLAIM_REVISION_RETENTION_MS = 7 * 365 * 24 * 60 * 60 * 1_000;
const MAX_REVISION_CLEANUP = 100;

const documentResultValidator = v.object({
  documentId: v.id("evidenceDocuments"),
  title: v.string(),
  excerpt: v.string(),
  canonicalUrl: v.string(),
  kind: documentKindValidator,
  updatedAt: v.number(),
  currentVersionId: v.union(v.id("evidenceDocumentVersions"), v.null()),
});
const detailedDocumentResultValidator = v.object({
  documentId: v.id("evidenceDocuments"),
  title: v.string(),
  excerpt: v.string(),
  canonicalUrl: v.string(),
  kind: documentKindValidator,
  licenseClass: licenseClassValidator,
  tags: v.array(v.string()),
  authors: v.array(v.string()),
  publishedAt: v.union(v.number(), v.null()),
  firstSeenAt: v.number(),
  updatedAt: v.number(),
  source: v.object({
    sourceKey: v.string(),
    name: v.string(),
    homepageUrl: v.string(),
    termsUrl: v.string(),
    provenanceClass: provenanceClassValidator,
    licenseClass: licenseClassValidator,
  }),
  currentVersion: v.union(
    v.null(),
    v.object({
      documentVersionId: v.id("evidenceDocumentVersions"),
      version: v.number(),
      contentHash: v.string(),
      fetchedAt: v.number(),
      sourceRevision: v.string(),
      sourceUpdatedAt: v.number(),
      retrievalUrl: v.string(),
      licenseClass: licenseClassValidator,
    }),
  ),
  citationMetrics: v.object({
    total: v.number(),
    supports: v.number(),
    contradicts: v.number(),
    context: v.number(),
    truncated: v.boolean(),
  }),
});

function bounded(value: string, name: string, maximum: number) {
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) {
    throw new ConvexError({
      code: "INVALID_EVIDENCE_VALUE",
      message: `${name} must be between 1 and ${maximum} characters.`,
    });
  }
  return normalized;
}

const DOCUMENT_CHANGE_FIELDS = [
  "title",
  "excerpt",
  "tags",
  "authors",
  "publishedAt",
  // Publication controls are deliberately included as status-like fields.
  "kind",
  "visibility",
  "licenseClass",
] as const;

type DocumentChangeField = (typeof DOCUMENT_CHANGE_FIELDS)[number];

function normalizeDocumentText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function canonicalDocumentList(values: readonly string[], maximum: number) {
  return [...new Set(values.map(normalizeDocumentText).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right))
    .slice(0, maximum);
}

function sameCanonicalDocumentList(
  left: readonly string[],
  right: readonly string[],
) {
  const normalizedLeft = canonicalDocumentList(left, 80);
  const normalizedRight = canonicalDocumentList(right, 80);
  return (
    normalizedLeft.length === normalizedRight.length &&
    normalizedLeft.every((value, index) => value === normalizedRight[index])
  );
}

function documentChangedFields(
  document: Doc<"evidenceDocuments">,
  candidate: {
    kind: Doc<"evidenceDocuments">["kind"];
    visibility: Doc<"evidenceDocuments">["visibility"];
    title: string;
    excerpt: string;
    tags: string[];
    authors: string[];
    publishedAt: number | null;
    licenseClass: Doc<"evidenceDocuments">["licenseClass"];
  },
): DocumentChangeField[] {
  return DOCUMENT_CHANGE_FIELDS.filter((field) => {
    switch (field) {
      case "title":
        return normalizeDocumentText(document.title) !== candidate.title;
      case "excerpt":
        return normalizeDocumentText(document.excerpt) !== candidate.excerpt;
      case "tags":
        return !sameCanonicalDocumentList(document.tags, candidate.tags);
      case "authors":
        return !sameCanonicalDocumentList(document.authors, candidate.authors);
      case "publishedAt":
        return document.publishedAt !== candidate.publishedAt;
      case "kind":
        return document.kind !== candidate.kind;
      case "visibility":
        return document.visibility !== candidate.visibility;
      case "licenseClass":
        return document.licenseClass !== candidate.licenseClass;
    }
  });
}

/** A compact, cryptographic deterministic key used to make ingestion retries append-safe. */
async function stableRevisionKey(parts: readonly string[]) {
  return `claim:${await sha256Base64Url(JSON.stringify(parts))}`;
}

async function recordClaimRevision(
  ctx: MutationCtx,
  args: {
    claim: Doc<"evidenceClaims">;
    changeKind:
      "created" | "legacy-baseline" | "semantic" | "status" | "evidence";
    actorType: "system" | "agent" | "human";
    actorId: string;
    source: string;
    citationId?: Doc<"evidenceClaimCitations">["_id"] | null;
    createdAt: number;
  },
) {
  const citationId = args.citationId ?? null;
  const revisionKey = await stableRevisionKey([
    args.claim._id,
    args.changeKind,
    args.claim.statement,
    args.claim.subjectEntityId ?? "",
    args.claim.predicate,
    args.claim.objectText,
    args.claim.status,
    String(args.claim.confidence),
    args.claim.visibility,
    String(args.claim.observedAt),
    args.actorType,
    args.actorId,
    args.source,
    citationId ?? "",
  ]);
  const existing = await ctx.db
    .query("evidenceClaimRevisions")
    .withIndex("by_revisionKey", (q) => q.eq("revisionKey", revisionKey))
    .unique();
  if (existing !== null) return existing._id;
  return await ctx.db.insert("evidenceClaimRevisions", {
    claimId: args.claim._id,
    revisionKey,
    changeKind: args.changeKind,
    statement: args.claim.statement,
    subjectEntityId: args.claim.subjectEntityId,
    predicate: args.claim.predicate,
    objectText: args.claim.objectText,
    status: args.claim.status,
    confidence: args.claim.confidence,
    visibility: args.claim.visibility,
    observedAt: args.claim.observedAt,
    actorType: args.actorType,
    actorId: args.actorId,
    source: args.source,
    citationId,
    createdAt: args.createdAt,
    retentionExpiresAt: args.createdAt + CLAIM_REVISION_RETENTION_MS,
  });
}

async function requireEvidenceAgent(
  ctx: Parameters<typeof requireAuthenticatedUser>[0],
) {
  const user = await requireAuthenticatedUser(ctx);
  // authz owns the authoritative union. This cast keeps this core additive while
  // the authz wave adds the evidence literal to enrollment validation.
  return requireAgentScope(user, "evidence" as AgentScope);
}

export const upsertSource = internalMutation({
  args: {
    sourceKey: v.string(),
    name: v.string(),
    sourceType: v.union(
      v.literal("rss"),
      v.literal("api"),
      v.literal("dataset"),
      v.literal("manual"),
      v.literal("derived"),
    ),
    ingestionEnabled: v.boolean(),
    baseUrl: v.string(),
    homepageUrl: v.string(),
    status: sourceStatusValidator,
    licenseClass: licenseClassValidator,
    provenanceClass: v.union(
      v.literal("primary"),
      v.literal("official"),
      v.literal("dataset"),
      v.literal("research"),
      v.literal("derived"),
    ),
    visibility: visibilityValidator,
    termsUrl: v.string(),
    etag: v.string(),
    lastModified: v.string(),
    cursor: v.string(),
    lastFetchedAt: v.number(),
    lastSucceededAt: v.number(),
    lastErrorAt: v.number(),
    lastErrorMessage: v.string(),
  },
  returns: v.object({
    sourceId: v.id("evidenceSources"),
    created: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const sourceKey = bounded(args.sourceKey, "sourceKey", 160).toLowerCase();
    const now = Date.now();
    const existing = await ctx.db
      .query("evidenceSources")
      .withIndex("by_sourceKey", (q) => q.eq("sourceKey", sourceKey))
      .unique();
    const value = {
      ...args,
      sourceKey,
      name: bounded(args.name, "name", 240),
      baseUrl: bounded(args.baseUrl, "baseUrl", 2_000),
      homepageUrl: bounded(args.homepageUrl, "homepageUrl", 2_000),
      termsUrl: bounded(args.termsUrl, "termsUrl", 2_000),
      etag: args.etag.slice(0, 1_000),
      lastModified: args.lastModified.slice(0, 1_000),
      cursor: args.cursor.slice(0, 4_000),
      lastErrorMessage: args.lastErrorMessage.slice(0, 4_000),
      updatedAt: now,
    };
    if (existing !== null) {
      await ctx.db.patch("evidenceSources", existing._id, value);
      return { sourceId: existing._id, created: false };
    }
    const sourceId = await ctx.db.insert("evidenceSources", {
      ...value,
      createdAt: now,
    });
    return { sourceId, created: true };
  },
});

export const upsertDocumentVersion = internalMutation({
  args: {
    sourceId: v.id("evidenceSources"),
    externalKey: v.string(),
    canonicalUrl: v.string(),
    canonicalUrlHash: v.string(),
    contentHash: v.string(),
    kind: documentKindValidator,
    visibility: visibilityValidator,
    title: v.string(),
    excerpt: v.string(),
    searchText: v.string(),
    tags: v.array(v.string()),
    authors: v.array(v.string()),
    documentLicenseClass: licenseClassValidator,
    fetchedAt: v.number(),
    publishedAt: v.optional(v.number()),
    sourceRevision: v.string(),
    sourceUpdatedAt: v.number(),
    rawStorageId: v.optional(v.id("_storage")),
    retrievalUrl: v.string(),
    licenseClass: licenseClassValidator,
    metadataJson: v.optional(v.string()),
  },
  returns: v.object({
    documentId: v.id("evidenceDocuments"),
    versionId: v.id("evidenceDocumentVersions"),
    version: v.number(),
    idempotent: v.boolean(),
    changedFields: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    const source = await ctx.db.get("evidenceSources", args.sourceId);
    if (source === null || source.status !== "active")
      throw new ConvexError({
        code: "EVIDENCE_SOURCE_UNAVAILABLE",
        message: "Evidence source is not active.",
      });
    const externalKey = bounded(args.externalKey, "externalKey", 320);
    const title = bounded(normalizeDocumentText(args.title), "title", 1_000);
    const excerpt = bounded(
      normalizeDocumentText(args.excerpt),
      "excerpt",
      8_000,
    );
    const searchText = bounded(args.searchText, "searchText", 60_000);
    const contentHash = bounded(args.contentHash, "contentHash", 256);
    const now = Date.now();
    const tags = canonicalDocumentList(args.tags, 40);
    const authors = canonicalDocumentList(args.authors, 80);
    let document = await ctx.db
      .query("evidenceDocuments")
      .withIndex("by_sourceId_and_externalKey", (q) =>
        q.eq("sourceId", args.sourceId).eq("externalKey", externalKey),
      )
      .unique();
    const isNewDocument = document === null;
    if (document !== null) {
      const existing = await ctx.db
        .query("evidenceDocumentVersions")
        .withIndex("by_documentId_and_contentHash", (q) =>
          q.eq("documentId", document!._id).eq("contentHash", contentHash),
        )
        .unique();
      if (existing !== null)
        return {
          documentId: document._id,
          versionId: existing._id,
          version: existing.version,
          idempotent: true,
          changedFields: [],
        };
      const changedFields = documentChangedFields(document, {
        kind: args.kind,
        visibility: args.visibility,
        title,
        excerpt,
        tags,
        authors,
        publishedAt: args.publishedAt ?? null,
        licenseClass: args.documentLicenseClass,
      });
      if (changedFields.length === 0 && document.currentVersionId !== null) {
        return {
          documentId: document._id,
          versionId: document.currentVersionId,
          version: (await ctx.db.get(
            "evidenceDocumentVersions",
            document.currentVersionId,
          ))!.version,
          idempotent: true,
          changedFields,
        };
      }
    }
    if (document === null) {
      const documentId = await ctx.db.insert("evidenceDocuments", {
        sourceId: args.sourceId,
        externalKey,
        canonicalUrl: bounded(args.canonicalUrl, "canonicalUrl", 2_000),
        canonicalUrlHash: bounded(
          args.canonicalUrlHash,
          "canonicalUrlHash",
          256,
        ),
        kind: args.kind,
        visibility: args.visibility,
        title,
        excerpt,
        searchText,
        tags,
        authors,
        licenseClass: args.documentLicenseClass,
        publishedAt: args.publishedAt ?? null,
        currentVersionId: null,
        firstSeenAt: args.fetchedAt,
        updatedAt: now,
      });
      document = (await ctx.db.get("evidenceDocuments", documentId))!;
    }
    const version =
      document.currentVersionId === null
        ? 1
        : (await ctx.db
            .query("evidenceDocumentVersions")
            .withIndex("by_documentId_and_version", (q) =>
              q.eq("documentId", document!._id),
            )
            .order("desc")
            .first())!.version + 1;
    const versionId = await ctx.db.insert("evidenceDocumentVersions", {
      documentId: document._id,
      version,
      contentHash,
      title,
      excerpt,
      searchText,
      fetchedAt: args.fetchedAt,
      publishedAt: args.publishedAt ?? null,
      sourceRevision: bounded(args.sourceRevision, "sourceRevision", 1_000),
      sourceUpdatedAt: args.sourceUpdatedAt,
      rawStorageId: args.rawStorageId ?? null,
      retrievalUrl: bounded(args.retrievalUrl, "retrievalUrl", 2_000),
      licenseClass: args.licenseClass,
      metadataJson: args.metadataJson ?? "",
      createdAt: now,
    });
    await ctx.db.patch("evidenceDocuments", document._id, {
      canonicalUrl: bounded(args.canonicalUrl, "canonicalUrl", 2_000),
      canonicalUrlHash: bounded(args.canonicalUrlHash, "canonicalUrlHash", 256),
      kind: args.kind,
      visibility: args.visibility,
      title,
      excerpt,
      searchText,
      tags,
      authors,
      licenseClass: args.documentLicenseClass,
      currentVersionId: versionId,
      publishedAt: args.publishedAt ?? null,
      updatedAt: now,
    });
    const changedFields = isNewDocument
      ? [...DOCUMENT_CHANGE_FIELDS]
      : documentChangedFields(document, {
          kind: args.kind,
          visibility: args.visibility,
          title,
          excerpt,
          tags,
          authors,
          publishedAt: args.publishedAt ?? null,
          licenseClass: args.documentLicenseClass,
        });
    await ctx.db.insert("evidenceChangeEvents", {
      eventKey: `document:${document._id}:${version}`,
      entityType: "document",
      entityId: document._id,
      kind: version === 1 ? "created" : "updated",
      visibility: args.visibility,
      summary: `${version === 1 ? "Added" : "Updated"} ${title}`.slice(
        0,
        1_000,
      ),
      changedFields,
      occurredAt: args.fetchedAt,
      createdAt: now,
    });
    return {
      documentId: document._id,
      versionId,
      version,
      idempotent: false,
      changedFields,
    };
  },
});

export const upsertEntity = internalMutation({
  args: {
    entityKey: v.string(),
    kind: v.union(
      v.literal("organization"),
      v.literal("product"),
      v.literal("model"),
      v.literal("project"),
      v.literal("person"),
      v.literal("concept"),
    ),
    name: v.string(),
    aliases: v.array(v.string()),
    visibility: visibilityValidator,
  },
  returns: v.object({
    entityId: v.id("evidenceEntities"),
    created: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const entityKey = bounded(args.entityKey, "entityKey", 160).toLowerCase();
    const now = Date.now();
    const existing = await ctx.db
      .query("evidenceEntities")
      .withIndex("by_entityKey", (q) => q.eq("entityKey", entityKey))
      .unique();
    const value = {
      ...args,
      entityKey,
      name: bounded(args.name, "name", 400),
      aliases: args.aliases
        .slice(0, 40)
        .map((alias) => bounded(alias, "alias", 400)),
      updatedAt: now,
    };
    if (existing !== null) {
      const unchanged =
        existing.kind === value.kind &&
        existing.name === value.name &&
        existing.visibility === value.visibility &&
        sameCanonicalDocumentList(existing.aliases, value.aliases);
      if (unchanged) {
        return { entityId: existing._id, created: false };
      }
      await ctx.db.patch("evidenceEntities", existing._id, value);
      return { entityId: existing._id, created: false };
    }
    return {
      entityId: await ctx.db.insert("evidenceEntities", {
        ...value,
        createdAt: now,
      }),
      created: true,
    };
  },
});

/**
 * Attach an entity to one immutable document version. Links deliberately live
 * on versions (rather than the mutable document) so a later ingestion cannot
 * rewrite the provenance of an earlier extraction.
 */
export const linkDocumentEntity = internalMutation({
  args: {
    documentVersionId: v.id("evidenceDocumentVersions"),
    entityId: v.id("evidenceEntities"),
    role: v.union(
      v.literal("subject"),
      v.literal("publisher"),
      v.literal("mentioned"),
    ),
  },
  returns: v.object({
    linkId: v.id("evidenceDocumentEntities"),
    created: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("evidenceDocumentEntities")
      .withIndex("by_documentVersionId_and_entityId", (q) =>
        q
          .eq("documentVersionId", args.documentVersionId)
          .eq("entityId", args.entityId),
      )
      .unique();
    if (existing !== null) return { linkId: existing._id, created: false };
    const [version, entity] = await Promise.all([
      ctx.db.get("evidenceDocumentVersions", args.documentVersionId),
      ctx.db.get("evidenceEntities", args.entityId),
    ]);
    if (version === null || entity === null) {
      throw new ConvexError({
        code: "EVIDENCE_REFERENCE_NOT_FOUND",
        message: "Document version and entity must exist before linking.",
      });
    }
    return {
      linkId: await ctx.db.insert("evidenceDocumentEntities", {
        ...args,
        createdAt: Date.now(),
      }),
      created: true,
    };
  },
});

export const upsertClaim = internalMutation({
  args: {
    claimKey: v.string(),
    statement: v.string(),
    subjectEntityId: v.optional(v.id("evidenceEntities")),
    predicate: v.string(),
    objectText: v.string(),
    status: claimStatusValidator,
    confidence: v.number(),
    visibility: visibilityValidator,
    observedAt: v.number(),
    actorType: v.optional(claimRevisionActorTypeValidator),
    actorId: v.optional(v.string()),
    source: v.optional(v.string()),
  },
  returns: v.object({ claimId: v.id("evidenceClaims"), created: v.boolean() }),
  handler: async (ctx, args) => {
    if (
      !Number.isFinite(args.confidence) ||
      args.confidence < 0 ||
      args.confidence > 1
    )
      throw new ConvexError({
        code: "INVALID_EVIDENCE_CONFIDENCE",
        message: "confidence must be between 0 and 1.",
      });
    const claimKey = bounded(args.claimKey, "claimKey", 200).toLowerCase();
    const now = Date.now();
    const existing = await ctx.db
      .query("evidenceClaims")
      .withIndex("by_claimKey", (q) => q.eq("claimKey", claimKey))
      .unique();
    const {
      actorType: _actorType,
      actorId: _actorId,
      source: _source,
      ...claimArgs
    } = args;
    const value = {
      ...claimArgs,
      subjectEntityId: args.subjectEntityId ?? null,
      claimKey,
      statement: bounded(args.statement, "statement", 12_000),
      predicate: bounded(args.predicate, "predicate", 200),
      objectText: bounded(args.objectText, "objectText", 4_000),
      updatedAt: now,
    };
    const actorType = args.actorType ?? "system";
    const actorId = bounded(
      args.actorId ?? "evidence-ingestion",
      "actorId",
      160,
    );
    const source = bounded(
      args.source ?? "evidence.upsertClaim",
      "source",
      240,
    );
    if (existing !== null) {
      const changed =
        existing.statement !== value.statement ||
        existing.subjectEntityId !== value.subjectEntityId ||
        existing.predicate !== value.predicate ||
        existing.objectText !== value.objectText ||
        existing.status !== value.status ||
        existing.confidence !== value.confidence ||
        existing.visibility !== value.visibility ||
        existing.observedAt !== value.observedAt;
      if (!changed) return { claimId: existing._id, created: false };
    }
    if (
      args.subjectEntityId !== undefined &&
      (await ctx.db.get("evidenceEntities", args.subjectEntityId)) === null
    )
      throw new ConvexError({
        code: "EVIDENCE_ENTITY_NOT_FOUND",
        message: "Claim subject entity does not exist.",
      });
    if (existing !== null) {
      await ctx.db.patch("evidenceClaims", existing._id, value);
      const updated = { ...existing, ...value };
      await recordClaimRevision(ctx, {
        claim: updated,
        changeKind: existing.status === value.status ? "semantic" : "status",
        actorType,
        actorId,
        source,
        createdAt: now,
      });
      if (existing.status !== args.status) {
        const eventKey = `claim:${existing._id}:status:${args.status}`;
        const event = await ctx.db
          .query("evidenceChangeEvents")
          .withIndex("by_eventKey", (q) => q.eq("eventKey", eventKey))
          .unique();
        if (event === null) {
          await ctx.db.insert("evidenceChangeEvents", {
            eventKey,
            entityType: "claim",
            entityId: existing._id,
            kind: "status-changed",
            visibility: args.visibility,
            summary:
              `Claim status changed to ${args.status}: ${value.statement}`.slice(
                0,
                1_000,
              ),
            occurredAt: args.observedAt,
            createdAt: now,
          });
        }
      }
      return { claimId: existing._id, created: false };
    }
    const claimId = await ctx.db.insert("evidenceClaims", {
      ...value,
      createdAt: now,
    });
    const claim = (await ctx.db.get("evidenceClaims", claimId))!;
    await recordClaimRevision(ctx, {
      claim,
      changeKind: "created",
      actorType,
      actorId,
      source,
      createdAt: now,
    });
    await ctx.db.insert("evidenceChangeEvents", {
      eventKey: `claim:${claimId}:created`,
      entityType: "claim",
      entityId: claimId,
      kind: "created",
      visibility: args.visibility,
      summary: `Verified claim: ${value.statement}`.slice(0, 1_000),
      occurredAt: args.observedAt,
      createdAt: now,
    });
    return { claimId, created: true };
  },
});

export const recordCitation = internalMutation({
  args: {
    claimId: v.id("evidenceClaims"),
    documentVersionId: v.id("evidenceDocumentVersions"),
    citationKey: v.string(),
    relation: v.union(
      v.literal("supports"),
      v.literal("contradicts"),
      v.literal("context"),
    ),
    locator: v.string(),
    excerpt: v.string(),
    confidence: v.number(),
    actorType: v.optional(claimRevisionActorTypeValidator),
    actorId: v.optional(v.string()),
    source: v.optional(v.string()),
  },
  returns: v.object({
    citationId: v.id("evidenceClaimCitations"),
    created: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const citationKey = bounded(args.citationKey, "citationKey", 240);
    const existing = await ctx.db
      .query("evidenceClaimCitations")
      .withIndex("by_citationKey", (q) => q.eq("citationKey", citationKey))
      .unique();
    if (existing !== null) return { citationId: existing._id, created: false };
    const [claim, version] = await Promise.all([
      ctx.db.get("evidenceClaims", args.claimId),
      ctx.db.get("evidenceDocumentVersions", args.documentVersionId),
    ]);
    if (claim === null || version === null)
      throw new ConvexError({
        code: "EVIDENCE_REFERENCE_NOT_FOUND",
        message: "Claim and document version must exist before citation.",
      });
    const document = await ctx.db.get("evidenceDocuments", version.documentId);
    if (document === null)
      throw new ConvexError({
        code: "EVIDENCE_REFERENCE_NOT_FOUND",
        message: "Citation document must exist before citation.",
      });
    if (claim.visibility === "public" && document.visibility !== "public")
      throw new ConvexError({
        code: "EVIDENCE_VISIBILITY_MISMATCH",
        message: "A public claim cannot cite a private document version.",
      });
    if (
      !Number.isFinite(args.confidence) ||
      args.confidence < 0 ||
      args.confidence > 1
    )
      throw new ConvexError({
        code: "INVALID_EVIDENCE_CONFIDENCE",
        message: "confidence must be between 0 and 1.",
      });
    const createdAt = Date.now();
    const {
      actorType: _actorType,
      actorId: _actorId,
      source: _source,
      ...citationArgs
    } = args;
    const citationId = await ctx.db.insert("evidenceClaimCitations", {
      ...citationArgs,
      citationKey,
      locator: bounded(args.locator, "locator", 1_000),
      excerpt: bounded(args.excerpt, "excerpt", 8_000),
      createdAt,
    });
    await recordClaimRevision(ctx, {
      claim,
      changeKind: "evidence",
      actorType: args.actorType ?? "system",
      actorId: bounded(args.actorId ?? "evidence-ingestion", "actorId", 160),
      source: bounded(args.source ?? "evidence.recordCitation", "source", 240),
      citationId,
      createdAt,
    });
    return { citationId, created: true };
  },
});

export const recordChange = internalMutation({
  args: {
    eventKey: v.string(),
    entityType: v.union(
      v.literal("document"),
      v.literal("claim"),
      v.literal("dataset"),
      v.literal("benchmark"),
    ),
    entityId: v.string(),
    kind: changeKindValidator,
    visibility: visibilityValidator,
    summary: v.string(),
    occurredAt: v.number(),
  },
  returns: v.object({
    eventId: v.id("evidenceChangeEvents"),
    created: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const eventKey = bounded(args.eventKey, "eventKey", 300);
    const existing = await ctx.db
      .query("evidenceChangeEvents")
      .withIndex("by_eventKey", (q) => q.eq("eventKey", eventKey))
      .unique();
    if (existing !== null) return { eventId: existing._id, created: false };
    return {
      eventId: await ctx.db.insert("evidenceChangeEvents", {
        ...args,
        eventKey,
        entityId: bounded(args.entityId, "entityId", 300),
        summary: bounded(args.summary, "summary", 1_000),
        createdAt: Date.now(),
      }),
      created: true,
    };
  },
});

export const searchPublic = internalQuery({
  args: { search: v.string(), limit: v.optional(v.number()) },
  returns: v.array(documentResultValidator),
  handler: async (ctx, args) => {
    const search = bounded(args.search, "search", 300);
    const limit = Math.min(25, Math.max(1, Math.floor(args.limit ?? 10)));
    const rows = await ctx.db
      .query("evidenceDocuments")
      .withSearchIndex("search_by_searchText", (q) =>
        q.search("searchText", search).eq("visibility", "public"),
      )
      .take(limit);
    const visible = await Promise.all(
      rows.map(async (row) => {
        const source = await ctx.db.get("evidenceSources", row.sourceId);
        return source?.visibility === "public" ? row : null;
      }),
    );
    return visible
      .filter((row): row is NonNullable<typeof row> => row !== null)
      .map((row) => ({
        documentId: row._id,
        title: row.title,
        excerpt: row.excerpt,
        canonicalUrl: row.canonicalUrl,
        kind: row.kind,
        updatedAt: row.updatedAt,
        currentVersionId: row.currentVersionId,
      }));
  },
});

export const getPublicDocument = internalQuery({
  args: { documentId: v.id("evidenceDocuments") },
  returns: v.union(v.null(), detailedDocumentResultValidator),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("evidenceDocuments", args.documentId);
    if (row === null || row.visibility !== "public") return null;
    const [source, version] = await Promise.all([
      ctx.db.get("evidenceSources", row.sourceId),
      row.currentVersionId === null
        ? null
        : ctx.db.get("evidenceDocumentVersions", row.currentVersionId),
    ]);
    if (source === null || source.visibility !== "public") return null;
    const citations =
      version === null
        ? []
        : await ctx.db
            .query("evidenceClaimCitations")
            .withIndex("by_documentVersionId", (q) =>
              q.eq("documentVersionId", version._id),
            )
            .take(51);
    const boundedCitations = citations.slice(0, 50);
    return {
      documentId: row._id,
      title: row.title,
      excerpt: row.excerpt,
      canonicalUrl: row.canonicalUrl,
      kind: row.kind,
      licenseClass: row.licenseClass,
      tags: row.tags,
      authors: row.authors,
      publishedAt: row.publishedAt,
      firstSeenAt: row.firstSeenAt,
      updatedAt: row.updatedAt,
      source: {
        sourceKey: source.sourceKey,
        name: source.name,
        homepageUrl: source.homepageUrl,
        termsUrl: source.termsUrl,
        provenanceClass: source.provenanceClass,
        licenseClass: source.licenseClass,
      },
      currentVersion:
        version === null
          ? null
          : {
              documentVersionId: version._id,
              version: version.version,
              contentHash: version.contentHash,
              fetchedAt: version.fetchedAt,
              sourceRevision: version.sourceRevision,
              sourceUpdatedAt: version.sourceUpdatedAt,
              retrievalUrl: version.retrievalUrl,
              licenseClass: version.licenseClass,
            },
      citationMetrics: {
        total: boundedCitations.length,
        supports: boundedCitations.filter(
          (citation) => citation.relation === "supports",
        ).length,
        contradicts: boundedCitations.filter(
          (citation) => citation.relation === "contradicts",
        ).length,
        context: boundedCitations.filter(
          (citation) => citation.relation === "context",
        ).length,
        truncated: citations.length > 50,
      },
    };
  },
});

export const listPublicChanges = internalQuery({
  args: { limit: v.optional(v.number()) },
  returns: v.array(
    v.object({
      eventId: v.id("evidenceChangeEvents"),
      entityType: v.union(
        v.literal("document"),
        v.literal("claim"),
        v.literal("dataset"),
        v.literal("benchmark"),
      ),
      entityId: v.string(),
      kind: changeKindValidator,
      summary: v.string(),
      occurredAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const limit = Math.min(50, Math.max(1, Math.floor(args.limit ?? 20)));
    const rows = await ctx.db
      .query("evidenceChangeEvents")
      .withIndex("by_visibility_and_occurredAt", (q) =>
        q.eq("visibility", "public"),
      )
      .order("desc")
      .take(limit);
    return rows.map(
      ({ _id, entityType, entityId, kind, summary, occurredAt }) => ({
        eventId: _id,
        entityType,
        entityId,
        kind,
        summary,
        occurredAt,
      }),
    );
  },
});

const entityResultValidator = v.object({
  entityId: v.id("evidenceEntities"),
  entityKey: v.string(),
  kind: v.union(
    v.literal("organization"),
    v.literal("product"),
    v.literal("model"),
    v.literal("project"),
    v.literal("person"),
    v.literal("concept"),
  ),
  name: v.string(),
  aliases: v.array(v.string()),
  updatedAt: v.number(),
});

const claimResultValidator = v.object({
  claimId: v.id("evidenceClaims"),
  claimKey: v.string(),
  statement: v.string(),
  subjectEntityId: v.union(v.id("evidenceEntities"), v.null()),
  predicate: v.string(),
  objectText: v.string(),
  status: claimStatusValidator,
  confidence: v.number(),
  observedAt: v.number(),
  citationId: v.id("evidenceClaimCitations"),
  locator: v.string(),
  excerpt: v.string(),
});

/** Bounded internal read used by the agent data API, never exposed directly. */
export const searchEntities = internalQuery({
  args: { search: v.string(), limit: v.optional(v.number()) },
  returns: v.array(entityResultValidator),
  handler: async (ctx, args) => {
    const search = bounded(args.search, "search", 200).toLowerCase();
    const limit = Math.min(25, Math.max(1, Math.floor(args.limit ?? 10)));
    // This table intentionally has no broad text search index yet. Bound the
    // scan so an API search cannot grow with the whole corpus.
    const rows = await ctx.db
      .query("evidenceEntities")
      .withIndex("by_visibility_and_updatedAt", (q) =>
        q.eq("visibility", "public"),
      )
      .order("desc")
      .take(200);
    return rows
      .filter((row) => {
        const haystack =
          `${row.entityKey} ${row.name} ${row.aliases.join(" ")}`.toLowerCase();
        return haystack.includes(search);
      })
      .slice(0, limit)
      .map(({ _id, entityKey, kind, name, aliases, updatedAt }) => ({
        entityId: _id,
        entityKey,
        kind,
        name,
        aliases,
        updatedAt,
      }));
  },
});

/**
 * Return exact, immutable support for one stored version. This lets callers
 * verify a claim without accidentally treating the document's latest version
 * as support for a historical assertion.
 */
export const listClaimsForDocumentVersion = internalQuery({
  args: {
    documentVersionId: v.id("evidenceDocumentVersions"),
    limit: v.optional(v.number()),
  },
  returns: v.array(claimResultValidator),
  handler: async (ctx, args) => {
    const limit = Math.min(50, Math.max(1, Math.floor(args.limit ?? 20)));
    const version = await ctx.db.get(
      "evidenceDocumentVersions",
      args.documentVersionId,
    );
    if (version === null) return [];
    const document = await ctx.db.get("evidenceDocuments", version.documentId);
    if (document === null || document.visibility !== "public") return [];
    const citations = await ctx.db
      .query("evidenceClaimCitations")
      .withIndex("by_documentVersionId", (q) =>
        q.eq("documentVersionId", args.documentVersionId),
      )
      .take(limit);
    const results = [];
    for (const citation of citations) {
      const claim = await ctx.db.get("evidenceClaims", citation.claimId);
      if (claim !== null && claim.visibility === "public") {
        results.push({
          claimId: claim._id,
          claimKey: claim.claimKey,
          statement: claim.statement,
          subjectEntityId: claim.subjectEntityId,
          predicate: claim.predicate,
          objectText: claim.objectText,
          status: claim.status,
          confidence: claim.confidence,
          observedAt: claim.observedAt,
          citationId: citation._id,
          locator: citation.locator,
          excerpt: citation.excerpt,
        });
      }
    }
    return results;
  },
});

const publicClaimTimelineEntryValidator = v.object({
  revisionId: v.id("evidenceClaimRevisions"),
  changeKind: claimRevisionChangeKindValidator,
  statement: v.string(),
  subjectEntityId: v.union(v.id("evidenceEntities"), v.null()),
  predicate: v.string(),
  objectText: v.string(),
  status: claimStatusValidator,
  confidence: v.number(),
  observedAt: v.number(),
  actorType: claimRevisionActorTypeValidator,
  actorId: v.string(),
  source: v.string(),
  citation: v.union(
    v.null(),
    v.object({
      citationId: v.id("evidenceClaimCitations"),
      documentId: v.id("evidenceDocuments"),
      documentVersionId: v.id("evidenceDocumentVersions"),
      canonicalUrl: v.string(),
      relation: v.union(
        v.literal("supports"),
        v.literal("contradicts"),
        v.literal("context"),
      ),
      locator: v.string(),
      excerpt: v.string(),
      confidence: v.number(),
    }),
  ),
});

/**
 * A bounded, public-only audit timeline for authenticated transports. Revision
 * visibility is checked separately from the mutable claim so a later
 * publication cannot reveal a prior private conclusion or citation.
 */
export const listPublicClaimTimeline = internalQuery({
  args: { claimKey: v.string(), limit: v.optional(v.number()) },
  returns: v.array(publicClaimTimelineEntryValidator),
  handler: async (ctx, args) => {
    const claimKey = bounded(args.claimKey, "claimKey", 200).toLowerCase();
    const limit = Math.min(50, Math.max(1, Math.floor(args.limit ?? 20)));
    const claim = await ctx.db
      .query("evidenceClaims")
      .withIndex("by_claimKey", (q) => q.eq("claimKey", claimKey))
      .unique();
    if (claim === null || claim.visibility !== "public") return [];
    if (claim.subjectEntityId !== null) {
      const subject = await ctx.db.get(
        "evidenceEntities",
        claim.subjectEntityId,
      );
      if (subject?.visibility !== "public") return [];
    }
    const revisions = await ctx.db
      .query("evidenceClaimRevisions")
      .withIndex("by_claimId_and_observedAt", (q) => q.eq("claimId", claim._id))
      .order("desc")
      .take(Math.min(100, limit * 3));
    const timeline = [];
    for (const revision of revisions) {
      if (revision.visibility !== "public") continue;
      if (revision.subjectEntityId !== null) {
        const subject = await ctx.db.get(
          "evidenceEntities",
          revision.subjectEntityId,
        );
        if (subject?.visibility !== "public") continue;
      }
      let citation: {
        citationId: Doc<"evidenceClaimCitations">["_id"];
        documentId: Doc<"evidenceDocuments">["_id"];
        documentVersionId: Doc<"evidenceDocumentVersions">["_id"];
        canonicalUrl: string;
        relation: "supports" | "contradicts" | "context";
        locator: string;
        excerpt: string;
        confidence: number;
      } | null = null;
      if (revision.citationId !== null) {
        const storedCitation = await ctx.db.get(
          "evidenceClaimCitations",
          revision.citationId,
        );
        const version =
          storedCitation === null
            ? null
            : await ctx.db.get(
                "evidenceDocumentVersions",
                storedCitation.documentVersionId,
              );
        const document =
          version === null
            ? null
            : await ctx.db.get("evidenceDocuments", version.documentId);
        const source =
          document === null
            ? null
            : await ctx.db.get("evidenceSources", document.sourceId);
        // An evidence revision derived only from private material is omitted,
        // including its timestamp, rather than returning a redacted pointer.
        if (
          storedCitation !== null &&
          version !== null &&
          document?.visibility === "public" &&
          source?.visibility === "public"
        ) {
          citation = {
            citationId: storedCitation._id,
            documentId: document._id,
            documentVersionId: version._id,
            canonicalUrl: document.canonicalUrl,
            relation: storedCitation.relation,
            locator: storedCitation.locator,
            excerpt: storedCitation.excerpt,
            confidence: storedCitation.confidence,
          };
        } else {
          continue;
        }
      }
      timeline.push({
        revisionId: revision._id,
        changeKind: revision.changeKind,
        statement: revision.statement,
        subjectEntityId: revision.subjectEntityId,
        predicate: revision.predicate,
        objectText: revision.objectText,
        status: revision.status,
        confidence: revision.confidence,
        observedAt: revision.observedAt,
        actorType: revision.actorType,
        actorId: revision.actorId,
        source: revision.source,
        citation,
      });
      if (timeline.length === limit) break;
    }
    return timeline;
  },
});

/**
 * One-time migration helper for claims written before revisions existed. It
 * records the current state as a clearly labeled baseline, never inventing a
 * historical event. Replays and page restarts are safe.
 */
export const backfillLegacyClaimBaselines = internalMutation({
  args: { cursor: v.optional(v.string()), limit: v.optional(v.number()) },
  returns: v.object({
    processed: v.number(),
    nextCursor: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    const cursor =
      args.cursor === undefined
        ? undefined
        : bounded(args.cursor, "cursor", 200).toLowerCase();
    const limit = Math.min(100, Math.max(1, Math.floor(args.limit ?? 50)));
    const rows =
      cursor === undefined
        ? await ctx.db
            .query("evidenceClaims")
            .withIndex("by_claimKey")
            .take(limit + 1)
        : await ctx.db
            .query("evidenceClaims")
            .withIndex("by_claimKey", (q) => q.gt("claimKey", cursor))
            .take(limit + 1);
    const page = rows.slice(0, limit);
    const now = Date.now();
    for (const claim of page) {
      const existingRevision = await ctx.db
        .query("evidenceClaimRevisions")
        .withIndex("by_claimId_and_observedAt", (q) =>
          q.eq("claimId", claim._id),
        )
        .take(1);
      // A legacy baseline is only meaningful for claims with no retained
      // history. Never append it to a claim that already has real revisions.
      if (existingRevision.length > 0) continue;
      await recordClaimRevision(ctx, {
        claim,
        changeKind: "legacy-baseline",
        actorType: "system",
        actorId: "legacy-backfill",
        source: "legacy-baseline",
        createdAt: now,
      });
    }
    return {
      processed: page.length,
      nextCursor: rows.length > limit ? page.at(-1)!.claimKey : null,
    };
  },
});

/** Retention is explicit and bounded; callers may schedule this internal task. */
export const cleanupExpiredClaimRevisions = internalMutation({
  args: { now: v.optional(v.number()), limit: v.optional(v.number()) },
  returns: v.object({ deleted: v.number() }),
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const limit = Math.min(
      MAX_REVISION_CLEANUP,
      Math.max(1, Math.floor(args.limit ?? MAX_REVISION_CLEANUP)),
    );
    const expired = await ctx.db
      .query("evidenceClaimRevisions")
      .withIndex("by_retentionExpiresAt", (q) =>
        q.lte("retentionExpiresAt", now),
      )
      .take(limit);
    for (const revision of expired)
      await ctx.db.delete("evidenceClaimRevisions", revision._id);
    return { deleted: expired.length };
  },
});

export const listProducts = query({
  args: { limit: v.optional(v.number()) },
  returns: v.array(
    v.object({
      productId: v.id("apiProducts"),
      productKey: v.string(),
      name: v.string(),
      description: v.string(),
      unitPriceMicroUsd: v.optional(v.number()),
    }),
  ),
  handler: async (ctx, args) => {
    await requireEvidenceAgent(ctx);
    const limit = Math.min(50, Math.max(1, Math.floor(args.limit ?? 20)));
    const rows = await ctx.db
      .query("apiProducts")
      .withIndex("by_visibility_and_status_and_updatedAt", (q) =>
        q.eq("visibility", "public").eq("status", "active"),
      )
      .order("desc")
      .take(limit);
    return rows.map(
      ({ _id, productKey, name, description, unitPriceMicroUsd }) => ({
        productId: _id,
        productKey,
        name,
        description,
        unitPriceMicroUsd,
      }),
    );
  },
});

export const listDatasets = query({
  args: { limit: v.optional(v.number()) },
  returns: v.array(
    v.object({
      datasetId: v.id("evidenceDatasets"),
      datasetKey: v.string(),
      name: v.string(),
      description: v.string(),
      licenseClass: licenseClassValidator,
      exportSchemaVersion: v.string(),
      selection: v.object({
        includedKinds: v.array(v.string()),
        includedLicenseClasses: v.array(v.string()),
        sourceKeys: v.array(v.string()),
      }),
      latestVersion: v.union(
        v.null(),
        v.object({
          datasetVersionId: v.id("evidenceDatasetVersions"),
          version: v.string(),
          checksum: v.string(),
          recordCount: v.number(),
          schemaVersion: v.string(),
          artifactByteLength: v.number(),
          sourceCount: v.number(),
          configuredSourceCount: v.number(),
          sourceCoverageScore: v.number(),
          missingSourceKeys: v.array(v.string()),
          citationCount: v.number(),
          citationCoverageScore: v.number(),
          entityCount: v.number(),
          entityCoverageScore: v.number(),
          claimCount: v.number(),
          claimCoverageScore: v.number(),
          completenessScore: v.number(),
          freshnessScore: v.number(),
          earliestObservedAt: v.union(v.number(), v.null()),
          latestObservedAt: v.union(v.number(), v.null()),
          createdAt: v.number(),
        }),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    await requireEvidenceAgent(ctx);
    const limit = Math.min(50, Math.max(1, Math.floor(args.limit ?? 20)));
    const rows = await ctx.db
      .query("evidenceDatasets")
      .withIndex("by_visibility_and_status_and_updatedAt", (q) =>
        q.eq("visibility", "public").eq("status", "active"),
      )
      .order("desc")
      .take(limit);
    const results = [];
    for (const {
      _id,
      datasetKey,
      name,
      description,
      licenseClass,
      exportSchemaVersion,
      includedKinds,
      includedLicenseClasses,
      sourceKeys,
    } of rows) {
      const version = await ctx.db
        .query("evidenceDatasetVersions")
        .withIndex("by_datasetId_and_version", (q) => q.eq("datasetId", _id))
        .order("desc")
        .first();
      results.push({
        datasetId: _id,
        datasetKey,
        name,
        description,
        licenseClass,
        exportSchemaVersion:
          exportSchemaVersion ?? "symbaiex-evidence-document-v3",
        selection: {
          includedKinds: includedKinds ?? [],
          includedLicenseClasses: includedLicenseClasses ?? [
            "public-domain",
            "open",
            "attributed",
          ],
          sourceKeys: sourceKeys ?? [],
        },
        latestVersion:
          version === null
            ? null
            : {
                datasetVersionId: version._id,
                version: version.version,
                checksum: version.checksum,
                recordCount: version.recordCount,
                schemaVersion:
                  version.schemaVersion ?? "symbaiex-evidence-document-v1",
                artifactByteLength: version.artifactByteLength ?? 0,
                sourceCount: version.sourceCount ?? 0,
                configuredSourceCount: version.configuredSourceCount ?? 0,
                sourceCoverageScore: version.sourceCoverageScore ?? 0,
                missingSourceKeys: version.missingSourceKeys ?? [],
                citationCount: version.citationCount ?? 0,
                citationCoverageScore: version.citationCoverageScore ?? 0,
                entityCount: version.entityCount ?? 0,
                entityCoverageScore: version.entityCoverageScore ?? 0,
                claimCount: version.claimCount ?? 0,
                claimCoverageScore: version.claimCoverageScore ?? 0,
                completenessScore: version.completenessScore ?? 0,
                freshnessScore: version.freshnessScore ?? 0,
                earliestObservedAt: version.earliestObservedAt ?? null,
                latestObservedAt: version.latestObservedAt ?? null,
                createdAt: version.createdAt,
              },
      });
    }
    return results;
  },
});

export const listBenchmarks = query({
  args: { limit: v.optional(v.number()) },
  returns: v.array(
    v.object({
      benchmarkId: v.id("evidenceBenchmarks"),
      benchmarkKey: v.string(),
      name: v.string(),
      description: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    await requireEvidenceAgent(ctx);
    const limit = Math.min(50, Math.max(1, Math.floor(args.limit ?? 20)));
    const rows = await ctx.db
      .query("evidenceBenchmarks")
      .withIndex("by_visibility_and_status_and_updatedAt", (q) =>
        q.eq("visibility", "public").eq("status", "active"),
      )
      .order("desc")
      .take(limit);
    return rows.map(({ _id, benchmarkKey, name, description }) => ({
      benchmarkId: _id,
      benchmarkKey,
      name,
      description,
    }));
  },
});
