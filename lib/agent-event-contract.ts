/**
 * The public body delivered by the evidence webhook action.
 *
 * This intentionally describes the bounded, public projection emitted today;
 * it is not a serialization of database records or job inputs.
 */
export const AGENT_EVENT_TYPES = [
  "evidence.document.changed",
  "evidence.research.completed",
  "evidence.export.completed",
  "evidence.benchmark.completed",
  "evidence.claim.verified",
] as const;

export type AgentEventType = (typeof AGENT_EVENT_TYPES)[number];

export type AgentEventData = {
  "evidence.document.changed": {
    documentId: string;
    documentVersionId: string;
    version: number;
    canonicalUrl: string;
    kind?: "document" | "advisory" | "release" | "paper";
    changedFields?: string[];
  };
  "evidence.research.completed": {
    researchJobId: string;
    status: "completed";
    expiresAt: number;
  };
  "evidence.export.completed": {
    exportJobId: string;
    status: "completed";
    checksum: string;
    recordCount: number;
    expiresAt: number;
  };
  "evidence.benchmark.completed": {
    runId: string;
    runKey: string;
    score: number;
    model: string;
  };
  "evidence.claim.verified": {
    claimId: string;
    documentVersionId: string;
    status: "supported";
    confidence: number;
  };
};

export type AgentEventEnvelope<T extends AgentEventType = AgentEventType> = {
  id: string;
  type: T;
  occurredAt: number;
  data: AgentEventData[T];
};

type UnknownRecord = Record<string, unknown>;
const MAX_CHANGED_FIELDS = 32;
const MAX_CHANGED_FIELD_LENGTH = 128;

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value: UnknownRecord, keys: readonly string[]) {
  return Object.keys(value).every((key) => keys.includes(key));
}

function isNonEmptyString(value: unknown) {
  return typeof value === "string" && value.length > 0;
}

function isTimestamp(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isBoundedChangedFields(value: unknown) {
  return (
    Array.isArray(value) &&
    value.length <= MAX_CHANGED_FIELDS &&
    value.every(
      (field) =>
        typeof field === "string" &&
        field.length > 0 &&
        field.length <= MAX_CHANGED_FIELD_LENGTH,
    )
  );
}

function isDocumentChangedData(value: unknown) {
  if (!isRecord(value)) return false;
  if (
    !hasOnlyKeys(value, [
      "documentId",
      "documentVersionId",
      "version",
      "canonicalUrl",
      "kind",
      "changedFields",
    ]) ||
    !isNonEmptyString(value.documentId) ||
    !isNonEmptyString(value.documentVersionId) ||
    !isTimestamp(value.version) ||
    !isNonEmptyString(value.canonicalUrl)
  ) {
    return false;
  }
  return (
    value.kind === undefined ||
    value.kind === "document" ||
    value.kind === "advisory" ||
    value.kind === "release" ||
    value.kind === "paper"
  ) && (
    value.changedFields === undefined || isBoundedChangedFields(value.changedFields)
  );
}

function isResearchCompletedData(value: unknown) {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["researchJobId", "status", "expiresAt"]) &&
    isNonEmptyString(value.researchJobId) &&
    value.status === "completed" &&
    isTimestamp(value.expiresAt)
  );
}

function isExportCompletedData(value: unknown) {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      "exportJobId",
      "status",
      "checksum",
      "recordCount",
      "expiresAt",
    ]) &&
    isNonEmptyString(value.exportJobId) &&
    value.status === "completed" &&
    isNonEmptyString(value.checksum) &&
    isTimestamp(value.recordCount) &&
    isTimestamp(value.expiresAt)
  );
}

function isBenchmarkCompletedData(value: unknown) {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["runId", "runKey", "score", "model"]) &&
    isNonEmptyString(value.runId) &&
    isNonEmptyString(value.runKey) &&
    isFiniteNumber(value.score) &&
    isNonEmptyString(value.model)
  );
}

function isClaimVerifiedData(value: unknown) {
  if (!isRecord(value)) return false;
  const confidence = value.confidence;
  if (
    !hasOnlyKeys(value, [
      "claimId",
      "documentVersionId",
      "status",
      "confidence",
    ]) ||
    !isNonEmptyString(value.claimId) ||
    !isNonEmptyString(value.documentVersionId) ||
    value.status !== "supported" ||
    !isFiniteNumber(confidence)
  ) {
    return false;
  }
  return confidence >= 0 && confidence <= 1;
}

/**
 * Validates an untrusted webhook body without parsing, coercing, or mutating it.
 * This checks the public body shape only; it does not establish delivery authenticity.
 */
export function isAgentEventEnvelope(
  value: unknown,
): value is AgentEventEnvelope {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["id", "type", "occurredAt", "data"]) ||
    !isNonEmptyString(value.id) ||
    !isTimestamp(value.occurredAt) ||
    !AGENT_EVENT_TYPES.includes(value.type as AgentEventType)
  ) {
    return false;
  }

  switch (value.type) {
    case "evidence.document.changed":
      return isDocumentChangedData(value.data);
    case "evidence.research.completed":
      return isResearchCompletedData(value.data);
    case "evidence.export.completed":
      return isExportCompletedData(value.data);
    case "evidence.benchmark.completed":
      return isBenchmarkCompletedData(value.data);
    case "evidence.claim.verified":
      return isClaimVerifiedData(value.data);
    default:
      return false;
  }
}
