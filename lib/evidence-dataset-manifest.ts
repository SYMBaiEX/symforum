export const EVIDENCE_EXPORT_SCHEMA_VERSION =
  "symbaiex-evidence-document-v2" as const;

export type EvidenceExportManifestRecord = {
  kind: string;
  licenseClass: string;
  publishedAt: number | null;
  updatedAt: number;
  source: {
    sourceKey: string;
    provenanceClass: string;
    termsUrl: string;
  };
  version: null | {
    contentHash: string;
    fetchedAt: number;
    sourceRevision: string;
    sourceUpdatedAt: number;
  };
  citationMetrics: {
    total: number;
    supports: number;
    contradicts: number;
    context: number;
    truncated: boolean;
  };
};

type ManifestInput = {
  datasetKey: string;
  datasetName: string;
  selection: {
    includedKinds: string[];
    includedLicenseClasses: string[];
    sourceKeys: string[];
  };
  scannedRecordCount: number;
  selectionScanTruncated: boolean;
  artifactChecksum: string;
  artifactByteLength: number;
  generatedAt: string;
  records: EvidenceExportManifestRecord[];
};

function increment(target: Record<string, number>, key: string) {
  target[key || "unknown"] = (target[key || "unknown"] ?? 0) + 1;
}
function roundedRatio(numerator: number, denominator: number) {
  return denominator === 0 ? 0 : Math.round((numerator / denominator) * 100);
}

function freshnessValue(timestamp: number, generatedAt: number) {
  const ageDays = Math.max(0, generatedAt - timestamp) / 86_400_000;
  if (ageDays <= 7) return 100;
  if (ageDays <= 30) return 75;
  if (ageDays <= 90) return 40;
  return 10;
}

/** Builds the immutable, buyer-readable evidence snapshot contract. */
export function buildEvidenceDatasetManifest(input: ManifestInput) {
  const sourceDistribution: Record<string, number> = {};
  const kindDistribution: Record<string, number> = {};
  const licenseDistribution: Record<string, number> = {};
  const provenanceDistribution: Record<string, number> = {};
  const observedTimes: number[] = [];
  let completenessSignals = 0;
  let citationCount = 0;
  let supportsCitationCount = 0;
  let truncatedCitationRecords = 0;
  let freshnessTotal = 0;

  for (const record of input.records) {
    increment(sourceDistribution, record.source.sourceKey);
    increment(kindDistribution, record.kind);
    increment(licenseDistribution, record.licenseClass);
    increment(provenanceDistribution, record.source.provenanceClass);
    const observedAt =
      record.version?.sourceUpdatedAt ||
      record.version?.fetchedAt ||
      record.publishedAt ||
      record.updatedAt;
    observedTimes.push(observedAt);
    freshnessTotal += freshnessValue(observedAt, Date.parse(input.generatedAt));
    completenessSignals += Number(Boolean(record.source.sourceKey));
    completenessSignals += Number(Boolean(record.source.provenanceClass));
    completenessSignals += Number(Boolean(record.licenseClass));
    completenessSignals += Number(Boolean(record.source.termsUrl));
    completenessSignals += Number(Boolean(record.version?.contentHash));
    completenessSignals += Number(Boolean(record.version?.sourceRevision));
    completenessSignals += Number(Boolean(record.version?.fetchedAt));
    completenessSignals += Number(Boolean(record.version?.sourceUpdatedAt));
    citationCount += record.citationMetrics.total;
    supportsCitationCount += record.citationMetrics.supports;
    truncatedCitationRecords += Number(record.citationMetrics.truncated);
  }

  const recordCount = input.records.length;
  const completenessScore = roundedRatio(completenessSignals, recordCount * 8);
  const freshnessScore =
    recordCount === 0 ? 0 : Math.round(freshnessTotal / recordCount);
  const earliestObservedAt = observedTimes.length
    ? Math.min(...observedTimes)
    : null;
  const latestObservedAt = observedTimes.length
    ? Math.max(...observedTimes)
    : null;

  return {
    schemaVersion: EVIDENCE_EXPORT_SCHEMA_VERSION,
    dataset: {
      key: input.datasetKey,
      name: input.datasetName,
      selection: input.selection,
    },
    artifact: {
      format: "jsonl",
      checksumAlgorithm: "sha256",
      checksum: input.artifactChecksum,
      byteLength: input.artifactByteLength,
      recordCount,
      containsRawPayload: false,
    },
    coverage: {
      scannedRecordCount: input.scannedRecordCount,
      selectionScanTruncated: input.selectionScanTruncated,
      sourceCount: Object.keys(sourceDistribution).length,
      earliestObservedAt,
      latestObservedAt,
      completenessScore,
      freshnessScore,
      citationCount,
      supportsCitationCount,
      truncatedCitationRecords,
    },
    distributions: {
      sources: sourceDistribution,
      kinds: kindDistribution,
      licenses: licenseDistribution,
      provenance: provenanceDistribution,
    },
    generatedAt: input.generatedAt,
  };
}
