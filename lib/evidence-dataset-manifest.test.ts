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
          entities: [
            {
              entityKey: "cve:CVE-TEST",
              kind: "vulnerability",
              role: "subject",
            },
          ],
          claims: [
            {
              claimKey: "claim:CVE-TEST",
              status: "supported",
              relation: "supports",
              confidence: 0.93,
            },
          ],
        },
      ],
    });

    expect(manifest.schemaVersion).toBe(EVIDENCE_EXPORT_SCHEMA_VERSION);
    expect(manifest.coverage).toMatchObject({
      scannedRecordCount: 500,
      selectionScanTruncated: true,
      sourceCount: 1,
      configuredSourceCount: 1,
      sourceCoverageScore: 100,
      missingSourceKeys: [],
      completenessScore: 100,
      freshnessScore: 100,
      citationCount: 2,
      supportsCitationCount: 1,
      entityCount: 1,
      claimCount: 1,
      entityCoverageScore: 100,
      claimCoverageScore: 100,
      citationCoverageScore: 100,
      averageClaimConfidence: 93,
    });
    expect(manifest.distributions.sources).toEqual({ "nvd-cve-2": 1 });
    expect(manifest.distributions.entityKinds).toEqual({ vulnerability: 1 });
    expect(manifest.distributions.claimStatuses).toEqual({ supported: 1 });
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
      sourceCoverageScore: 100,
      citationCoverageScore: 0,
    });
  });

  test("identifies configured sources missing from a snapshot", () => {
    const manifest = buildEvidenceDatasetManifest({
      datasetKey: "coverage",
      datasetName: "Coverage",
      selection: {
        includedKinds: ["paper"],
        includedLicenseClasses: ["open"],
        sourceKeys: ["present", "missing"],
      },
      scannedRecordCount: 1,
      selectionScanTruncated: false,
      artifactChecksum: "checksum",
      artifactByteLength: 1,
      generatedAt: "2026-08-30T12:00:00.000Z",
      records: [
        {
          kind: "paper",
          licenseClass: "open",
          publishedAt: null,
          updatedAt: Date.parse("2026-08-30T12:00:00.000Z"),
          source: {
            sourceKey: "present",
            provenanceClass: "official",
            termsUrl: "https://example.com/terms",
          },
          version: null,
          citationMetrics: {
            total: 0,
            supports: 0,
            contradicts: 0,
            context: 0,
            truncated: false,
          },
        },
      ],
    });

    expect(manifest.coverage).toMatchObject({
      configuredSourceCount: 2,
      sourceCount: 1,
      sourceCoverageScore: 50,
      missingSourceKeys: ["missing"],
    });
  });
});
