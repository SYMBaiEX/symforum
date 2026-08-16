import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import {
  requireAgentScope,
  requireAuthenticatedUser,
  type AgentScope,
} from "./authz";

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

const documentResultValidator = v.object({
  documentId: v.id("evidenceDocuments"),
  title: v.string(),
  excerpt: v.string(),
  canonicalUrl: v.string(),
  kind: documentKindValidator,
  updatedAt: v.number(),
  currentVersionId: v.union(v.id("evidenceDocumentVersions"), v.null()),
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
  }),
  handler: async (ctx, args) => {
    const source = await ctx.db.get("evidenceSources", args.sourceId);
    if (source === null || source.status !== "active")
      throw new ConvexError({
        code: "EVIDENCE_SOURCE_UNAVAILABLE",
        message: "Evidence source is not active.",
      });
    const externalKey = bounded(args.externalKey, "externalKey", 320);
    const title = bounded(args.title, "title", 1_000);
    const excerpt = bounded(args.excerpt, "excerpt", 8_000);
    const searchText = bounded(args.searchText, "searchText", 60_000);
    const contentHash = bounded(args.contentHash, "contentHash", 256);
    const now = Date.now();
    let document = await ctx.db
      .query("evidenceDocuments")
      .withIndex("by_sourceId_and_externalKey", (q) =>
        q.eq("sourceId", args.sourceId).eq("externalKey", externalKey),
      )
      .unique();
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
        };
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
        tags: args.tags.slice(0, 40),
        authors: args.authors.slice(0, 80),
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
      tags: args.tags.slice(0, 40),
      authors: args.authors.slice(0, 80),
      licenseClass: args.documentLicenseClass,
      currentVersionId: versionId,
      publishedAt: args.publishedAt ?? null,
      updatedAt: now,
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
      occurredAt: args.fetchedAt,
      createdAt: now,
    });
    return { documentId: document._id, versionId, version, idempotent: false };
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
    const existing = await ctx.db
      .query("evidenceDocumentEntities")
      .withIndex("by_documentVersionId_and_entityId", (q) =>
        q
          .eq("documentVersionId", args.documentVersionId)
          .eq("entityId", args.entityId),
      )
      .unique();
    if (existing !== null) return { linkId: existing._id, created: false };
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
  },
  returns: v.object({ claimId: v.id("evidenceClaims"), created: v.boolean() }),
  handler: async (ctx, args) => {
    if (
      args.subjectEntityId !== undefined &&
      (await ctx.db.get("evidenceEntities", args.subjectEntityId)) === null
    )
      throw new ConvexError({
        code: "EVIDENCE_ENTITY_NOT_FOUND",
        message: "Claim subject entity does not exist.",
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
    const claimKey = bounded(args.claimKey, "claimKey", 200).toLowerCase();
    const now = Date.now();
    const existing = await ctx.db
      .query("evidenceClaims")
      .withIndex("by_claimKey", (q) => q.eq("claimKey", claimKey))
      .unique();
    const value = {
      ...args,
      subjectEntityId: args.subjectEntityId ?? null,
      claimKey,
      statement: bounded(args.statement, "statement", 12_000),
      predicate: bounded(args.predicate, "predicate", 200),
      objectText: bounded(args.objectText, "objectText", 4_000),
      updatedAt: now,
    };
    if (existing !== null) {
      await ctx.db.patch("evidenceClaims", existing._id, value);
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
  },
  returns: v.object({
    citationId: v.id("evidenceClaimCitations"),
    created: v.boolean(),
  }),
  handler: async (ctx, args) => {
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
    const citationKey = bounded(args.citationKey, "citationKey", 240);
    const existing = await ctx.db
      .query("evidenceClaimCitations")
      .withIndex("by_citationKey", (q) => q.eq("citationKey", citationKey))
      .unique();
    if (existing !== null) return { citationId: existing._id, created: false };
    return {
      citationId: await ctx.db.insert("evidenceClaimCitations", {
        ...args,
        citationKey,
        locator: bounded(args.locator, "locator", 1_000),
        excerpt: bounded(args.excerpt, "excerpt", 8_000),
        createdAt: Date.now(),
      }),
      created: true,
    };
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
    return rows.map((row) => ({
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
  returns: v.union(v.null(), documentResultValidator),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("evidenceDocuments", args.documentId);
    if (row === null || row.visibility !== "public") return null;
    return {
      documentId: row._id,
      title: row.title,
      excerpt: row.excerpt,
      canonicalUrl: row.canonicalUrl,
      kind: row.kind,
      updatedAt: row.updatedAt,
      currentVersionId: row.currentVersionId,
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
      latestVersion: v.union(
        v.null(),
        v.object({
          datasetVersionId: v.id("evidenceDatasetVersions"),
          version: v.string(),
          checksum: v.string(),
          recordCount: v.number(),
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
    for (const { _id, datasetKey, name, description, licenseClass } of rows) {
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
        latestVersion:
          version === null
            ? null
            : {
                datasetVersionId: version._id,
                version: version.version,
                checksum: version.checksum,
                recordCount: version.recordCount,
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
