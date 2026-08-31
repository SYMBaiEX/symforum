/**
 * Shared contract for evidence-source adapters.
 *
 * Adapters may fetch different upstream shapes, but every adapter must declare
 * its legal/operational boundaries and emit the same deterministic data model.
 * This module is intentionally runtime-agnostic so fixtures can validate an
 * adapter before it is allowed into a scheduled ingestion path.
 */

export type EvidenceLicenseClass = "public-domain" | "attributed";
export type EvidenceAccessClass =
  "public" | "public-optional-token" | "first-party";

export type EvidenceRetryPolicy = Readonly<{
  maximumAttempts: number;
  initialDelayMs: number;
  maximumDelayMs: number;
  retryableStatusCodes: readonly number[];
}>;

export type EvidenceSourceAdapterDescriptor = Readonly<{
  key: string;
  name: string;
  officialApiUrl: string;
  officialTermsUrl: string;
  officialAttributionUrl: string;
  licenseClass: EvidenceLicenseClass;
  accessClass: EvidenceAccessClass;
  capability: string;
  checkpointModel: string;
  conditionalRequestModel: string;
  timeoutMs: number;
  maxResponseBytes: number;
  maxItemsPerRun: number;
  maxPagesPerRun: number;
  cadence: string;
  fixtureProvenance: string;
  retryPolicy?: EvidenceRetryPolicy;
}>;

export type NormalizedEvidenceDocument = Readonly<{
  sourceKey: string;
  externalId: string;
  canonicalUrl: string;
  title: string;
  observedAt: number;
  publishedAt?: number;
  version?: string;
  attribution: string;
}>;

export type NormalizedEvidenceEntity = Readonly<{
  sourceKey: string;
  externalId: string;
  kind: string;
  name: string;
  canonicalUrl?: string;
}>;

export type NormalizedEvidenceClaim = Readonly<{
  sourceKey: string;
  externalId: string;
  documentExternalId: string;
  subjectExternalId?: string;
  predicate: string;
  value: string;
  support: "asserted" | "withdrawn" | "superseded";
}>;

export type EvidenceAdapterCheckpoint = Readonly<{
  cursor?: string;
  etag?: string;
  lastModified?: string;
  windowStart?: number;
  windowEnd?: number;
  startIndex?: number;
}>;

export type NormalizedEvidenceBatch = Readonly<{
  sourceKey: string;
  checkpoint: EvidenceAdapterCheckpoint;
  documents: readonly NormalizedEvidenceDocument[];
  entities: readonly NormalizedEvidenceEntity[];
  claims: readonly NormalizedEvidenceClaim[];
}>;

const DEFAULT_RETRY_POLICY: EvidenceRetryPolicy = Object.freeze({
  maximumAttempts: 3,
  initialDelayMs: 500,
  maximumDelayMs: 8_000,
  retryableStatusCodes: Object.freeze([408, 425, 429, 500, 502, 503, 504]),
});

export function evidenceRetryPolicy(
  descriptor: EvidenceSourceAdapterDescriptor,
): EvidenceRetryPolicy {
  return descriptor.retryPolicy ?? DEFAULT_RETRY_POLICY;
}

export function validateEvidenceAdapterDescriptor(
  descriptor: EvidenceSourceAdapterDescriptor,
) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(descriptor.key)) {
    throw new Error(`Invalid evidence source key: ${descriptor.key}`);
  }
  for (const [field, value] of [
    ["officialApiUrl", descriptor.officialApiUrl],
    ["officialTermsUrl", descriptor.officialTermsUrl],
    ["officialAttributionUrl", descriptor.officialAttributionUrl],
  ] as const) {
    const url = new URL(value);
    if (url.protocol !== "https:") {
      throw new Error(`${field} must use HTTPS for ${descriptor.key}`);
    }
  }
  for (const [field, value] of [
    ["timeoutMs", descriptor.timeoutMs],
    ["maxResponseBytes", descriptor.maxResponseBytes],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${field} must be a non-negative integer`);
    }
  }
  for (const [field, value] of [
    ["maxItemsPerRun", descriptor.maxItemsPerRun],
    ["maxPagesPerRun", descriptor.maxPagesPerRun],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new Error(`${field} must be a positive integer`);
    }
  }
  const retry = evidenceRetryPolicy(descriptor);
  if (
    !Number.isSafeInteger(retry.maximumAttempts) ||
    retry.maximumAttempts < 1 ||
    !Number.isSafeInteger(retry.initialDelayMs) ||
    retry.initialDelayMs < 0 ||
    !Number.isSafeInteger(retry.maximumDelayMs) ||
    retry.maximumDelayMs < retry.initialDelayMs
  ) {
    throw new Error(`Invalid retry policy for ${descriptor.key}`);
  }
  return descriptor;
}

function compareExternalId(
  left: { externalId: string },
  right: { externalId: string },
) {
  return left.externalId.localeCompare(right.externalId, "en");
}

/**
 * Validates ownership and returns a detached, stable ordering. Scheduled
 * ingestion can therefore compare fixture output byte-for-byte across runs.
 */
export function normalizeEvidenceBatch(
  descriptor: EvidenceSourceAdapterDescriptor,
  batch: NormalizedEvidenceBatch,
): NormalizedEvidenceBatch {
  validateEvidenceAdapterDescriptor(descriptor);
  if (batch.sourceKey !== descriptor.key) {
    throw new Error(
      `Adapter ${descriptor.key} emitted batch for ${batch.sourceKey}`,
    );
  }
  const allRows = [...batch.documents, ...batch.entities, ...batch.claims];
  if (allRows.some((row) => row.sourceKey !== descriptor.key)) {
    throw new Error(`Adapter ${descriptor.key} emitted a foreign source key`);
  }
  if (batch.documents.length > descriptor.maxItemsPerRun) {
    throw new Error(`Adapter ${descriptor.key} exceeded maxItemsPerRun`);
  }
  const documentIds = new Set(batch.documents.map((row) => row.externalId));
  if (documentIds.size !== batch.documents.length) {
    throw new Error(`Adapter ${descriptor.key} emitted duplicate documents`);
  }
  for (const claim of batch.claims) {
    if (!documentIds.has(claim.documentExternalId)) {
      throw new Error(
        `Claim ${claim.externalId} references an unknown normalized document`,
      );
    }
  }
  return {
    sourceKey: batch.sourceKey,
    checkpoint: { ...batch.checkpoint },
    documents: batch.documents
      .map((row) => ({ ...row }))
      .sort(compareExternalId),
    entities: batch.entities.map((row) => ({ ...row })).sort(compareExternalId),
    claims: batch.claims.map((row) => ({ ...row })).sort(compareExternalId),
  };
}
