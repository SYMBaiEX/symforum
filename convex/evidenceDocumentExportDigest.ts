import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

export type EvidenceDocumentExportData = Pick<
  Doc<"evidenceDocuments">,
  | "_id"
  | "sourceId"
  | "externalKey"
  | "canonicalUrl"
  | "kind"
  | "visibility"
  | "title"
  | "excerpt"
  | "tags"
  | "authors"
  | "licenseClass"
  | "currentVersionId"
  | "publishedAt"
  | "firstSeenAt"
  | "updatedAt"
>;

export function evidenceDocumentExportDataFromDigest(
  digest: Doc<"evidenceDocumentExportDigests">,
): EvidenceDocumentExportData {
  return {
    _id: digest.documentId,
    sourceId: digest.sourceId,
    externalKey: digest.externalKey,
    canonicalUrl: digest.canonicalUrl,
    kind: digest.kind,
    visibility: digest.visibility,
    title: digest.title,
    excerpt: digest.excerpt,
    tags: digest.tags,
    authors: digest.authors,
    licenseClass: digest.licenseClass,
    currentVersionId: digest.currentVersionId,
    publishedAt: digest.publishedAt,
    firstSeenAt: digest.firstSeenAt,
    updatedAt: digest.updatedAt,
  };
}

function evidenceDocumentExportDigestFromData(
  document: EvidenceDocumentExportData,
) {
  return {
    documentId: document._id,
    sourceId: document.sourceId,
    externalKey: document.externalKey,
    canonicalUrl: document.canonicalUrl,
    kind: document.kind,
    visibility: document.visibility,
    title: document.title,
    excerpt: document.excerpt,
    tags: document.tags,
    authors: document.authors,
    licenseClass: document.licenseClass,
    currentVersionId: document.currentVersionId,
    publishedAt: document.publishedAt,
    firstSeenAt: document.firstSeenAt,
    updatedAt: document.updatedAt,
  };
}

function sameFields(
  left: Doc<"evidenceDocumentExportDigests">,
  right: ReturnType<typeof evidenceDocumentExportDigestFromData>,
) {
  return (
    left.documentId === right.documentId &&
    left.sourceId === right.sourceId &&
    left.externalKey === right.externalKey &&
    left.canonicalUrl === right.canonicalUrl &&
    left.kind === right.kind &&
    left.visibility === right.visibility &&
    left.title === right.title &&
    left.excerpt === right.excerpt &&
    JSON.stringify(left.tags) === JSON.stringify(right.tags) &&
    JSON.stringify(left.authors) === JSON.stringify(right.authors) &&
    left.licenseClass === right.licenseClass &&
    left.currentVersionId === right.currentVersionId &&
    left.publishedAt === right.publishedAt &&
    left.firstSeenAt === right.firstSeenAt &&
    left.updatedAt === right.updatedAt
  );
}

/** Keep the export-only projection transactionally aligned with its source. */
export async function upsertEvidenceDocumentExportDigest(
  ctx: MutationCtx,
  document: EvidenceDocumentExportData,
): Promise<Id<"evidenceDocumentExportDigests">> {
  const digest = evidenceDocumentExportDigestFromData(document);
  const existing = await ctx.db
    .query("evidenceDocumentExportDigests")
    .withIndex("by_documentId", (q) => q.eq("documentId", document._id))
    .unique();
  if (existing === null)
    return await ctx.db.insert("evidenceDocumentExportDigests", digest);
  if (!sameFields(existing, digest))
    await ctx.db.patch("evidenceDocumentExportDigests", existing._id, digest);
  return existing._id;
}
