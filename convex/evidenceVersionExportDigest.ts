import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

export type EvidenceVersionExportDigest = {
  versionId: Id<"evidenceDocumentVersions">;
  documentId: Id<"evidenceDocuments">;
  version: number;
  contentHash: string;
  fetchedAt: number;
  sourceRevision: string;
  sourceUpdatedAt: number;
  retrievalUrl: string;
  metadataJson: string;
};

export function evidenceVersionExportDigestFromVersion(
  version: Pick<
    Doc<"evidenceDocumentVersions">,
    | "_id"
    | "documentId"
    | "version"
    | "contentHash"
    | "fetchedAt"
    | "sourceRevision"
    | "sourceUpdatedAt"
    | "retrievalUrl"
    | "metadataJson"
  >,
): EvidenceVersionExportDigest {
  return {
    versionId: version._id,
    documentId: version.documentId,
    version: version.version,
    contentHash: version.contentHash,
    fetchedAt: version.fetchedAt,
    sourceRevision: version.sourceRevision,
    sourceUpdatedAt: version.sourceUpdatedAt,
    retrievalUrl: version.retrievalUrl,
    metadataJson: version.metadataJson,
  };
}

export async function ensureEvidenceVersionExportDigest(
  ctx: MutationCtx,
  version: Doc<"evidenceDocumentVersions">,
) {
  const existing = await ctx.db
    .query("evidenceDocumentVersionExportDigests")
    .withIndex("by_versionId", (q) => q.eq("versionId", version._id))
    .unique();
  if (existing !== null) return false;
  await ctx.db.insert(
    "evidenceDocumentVersionExportDigests",
    evidenceVersionExportDigestFromVersion(version),
  );
  return true;
}
