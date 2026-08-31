import { describe, expect, test } from "vitest";
import {
  buildEvidenceDatasetManifest,
  EVIDENCE_EXPORT_SCHEMA_VERSION,
} from "./evidence-dataset-manifest";

describe("evidence dataset manifests", () => {
  test("summarizes provenance, freshness, completeness, and citations", () => {
    const now = "2026-08-30T12:00:00.000Z";
    const manifest = buildEvidenceDatasetManifest({
      datasetKey: "security-advisories",
      datasetName: "Security advisories",
      selection: {
        includedKinds: ["advisory"],
        includedLicenseClasses: ["public-domain"],
        sourceKeys: ["nvd-cve-2"],
      },
      scannedRecordCount: 500,
      selectionScanTruncated: true,
      artifactChecksum: "abc123",
      artifactByteLength: 1234,
      generatedAt: now,
      records: [
        {
          kind: "advisory",
          licenseClass: "public-domain",
          publishedAt: Date.parse("2026-08-25T12:00:00.000Z"),
          updatedAt: Date.parse("2026-08-29T12:00:00.000Z"),
          source: {
            sourceKey: "nvd-cve-2",
            provenanceClass: "official",
            termsUrl: "https://nvd.nist.gov/general/terms-of-use",
          },
          version: {
            contentHash: "hash",
            fetchedAt: Date.parse("2026-08-29T12:00:00.000Z"),
            sourceRevision: "revision",
            sourceUpdatedAt: Date.parse("2026-08-29T12:00:00.000Z"),
          },
          citationMetrics: {
            total: 2,
            supports: 1,
            contradicts: 1,
            context: 0,
            truncated: false,
          },
        },
      ],
    });

    expect(manifest.schemaVersion).toBe(EVIDENCE_EXPORT_SCHEMA_VERSION);
    expect(manifest.coverage).toMatchObject({
      scannedRecordCount: 500,
      selectionScanTruncated: true,
      sourceCount: 1,
      completenessScore: 100,
      freshnessScore: 100,
      citationCount: 2,
      supportsCitationCount: 1,
    });
    expect(manifest.distributions.sources).toEqual({ "nvd-cve-2": 1 });
  });

  test("reports empty snapshots honestly", () => {
    const manifest = buildEvidenceDatasetManifest({
      datasetKey: "empty",
      datasetName: "Empty",
      selection: {
        includedKinds: [],
        includedLicenseClasses: [],
        sourceKeys: [],
      },
      scannedRecordCount: 0,
      selectionScanTruncated: false,
      artifactChecksum: "empty",
      artifactByteLength: 0,
      generatedAt: "2026-08-30T12:00:00.000Z",
      records: [],
    });
    expect(manifest.coverage).toMatchObject({
      completenessScore: 0,
      freshnessScore: 0,
      earliestObservedAt: null,
      latestObservedAt: null,
    });
  });
});
