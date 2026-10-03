import { describe, expect, test } from "vitest";
import {
  adapterCheckpointCursor,
  deriveEvidence,
  evidenceAdapterDescriptor,
  evidenceRequestHeaders,
  parseGithubAdvisories,
  parseCrossrefWorks,
  parseGithubReleases,
  parseKevPayload,
  sha256Hex,
  shouldEnrichDocumentVersion,
  shouldIngestSource,
  stableJson,
  validateParsedEvidenceBatch,
} from "./evidenceIngestion";
import { PUBLIC_EVIDENCE_SOURCE_REGISTRY } from "./evidenceSourceRegistry";

describe("evidence ingestion normalizers", () => {
  test("rejects malformed official payloads", () => {
    expect(
      parseKevPayload({ vulnerabilities: [{ cveID: "not-a-cve" }] }),
    ).toEqual([]);
    expect(parseKevPayload({ vulnerabilities: "not-an-array" })).toEqual([]);
    expect(parseCrossrefWorks({ message: { items: [{ DOI: 42 }] } })).toEqual(
      [],
    );
  });

  test("creates deterministic canonical hashes independent of key order", async () => {
    expect(stableJson({ b: [2, 1], a: "value" })).toBe(
      '{"a":"value","b":[2,1]}',
    );
    await expect(sha256Hex({ b: [2, 1], a: "value" })).resolves.toBe(
      await sha256Hex({ a: "value", b: [2, 1] }),
    );
    expect(stableJson({ omitted: undefined })).toBe('{"omitted":null}');
  });

  test("never sends GitHub credentials to other hosts and honors source pauses", () => {
    const state = {
      etag: "etag",
      lastModified: "yesterday",
      cursor: "",
      lastSucceededAt: 1,
      ingestionEnabled: true,
      status: "active" as const,
    };
    expect(
      evidenceRequestHeaders(
        "https://api.github.com/advisories",
        state,
        "secret",
      ),
    ).toMatchObject({
      Authorization: "Bearer secret",
      "If-None-Match": "etag",
    });
    expect(
      evidenceRequestHeaders("https://api.crossref.org/works", state, "secret"),
    ).not.toHaveProperty("Authorization");
    expect(
      evidenceRequestHeaders(
        "https://api.github.com.evil.example/",
        state,
        "secret",
      ),
    ).not.toHaveProperty("Authorization");
    expect(shouldIngestSource({ ...state, ingestionEnabled: false })).toBe(
      false,
    );
    expect(shouldIngestSource({ ...state, status: "paused" })).toBe(false);
    expect(shouldIngestSource(null)).toBe(true);
  });

  test("uses validator-only checkpoints and ignores generic Link cursors", () => {
    expect(adapterCheckpointCursor()).toBe("");
  });

  test("skips enrichment for idempotent document versions and enriches changed versions", () => {
    expect(shouldEnrichDocumentVersion(true)).toBe(false);
    expect(shouldEnrichDocumentVersion(false)).toBe(true);
  });

  test("never retains Crossref abstracts or full text", () => {
    const documents = parseCrossrefWorks({
      message: {
        items: [
          {
            DOI: "10.1000/example",
            URL: "https://doi.org/10.1000/example",
            title: ["A metadata-only paper"],
            abstract: "This must never be persisted.",
            author: [{ given: "Ada", family: "Lovelace" }],
            publisher: "Example Press",
            type: "journal-article",
            issued: { "date-parts": [[2026, 8, 1]] },
          },
        ],
      },
    });
    expect(documents).toHaveLength(1);
    expect(JSON.stringify(documents[0])).not.toContain(
      "This must never be persisted",
    );
    expect(documents[0]?.searchText).not.toMatch(/abstract/i);
  });

  test("enforces the GitHub releases allowlist and batch limits", () => {
    const release = {
      tag_name: "v1.0.0",
      html_url: "https://github.com/openai/openai-node/releases/tag/v1.0.0",
      name: "Version 1",
      published_at: "2026-08-01T00:00:00Z",
    };
    expect(parseGithubReleases([release], "evil/repository")).toEqual([]);
    expect(
      parseGithubReleases(
        Array.from({ length: 40 }, () => release),
        "openai/openai-node",
      ),
    ).toHaveLength(30);
    const kev = {
      cveID: "CVE-2026-12345",
      vendorProject: "Vendor",
      product: "Product",
      shortDescription: "Issue",
      dateAdded: "2026-08-01",
    };
    expect(
      parseKevPayload(
        { vulnerabilities: Array.from({ length: 140 }, () => kev) },
        140,
      ),
    ).toHaveLength(100);
  });

  test("validates parsed batches before persistence without losing rich fields", () => {
    const descriptor = PUBLIC_EVIDENCE_SOURCE_REGISTRY.find(
      (source) => source.key === "cisa-kev",
    )!;
    const documents = parseKevPayload({
      vulnerabilities: [
        {
          cveID: "CVE-2026-12345",
          vendorProject: "Vendor",
          product: "Product",
          shortDescription: "A detailed issue excerpt.",
          dateAdded: "2026-08-01",
          dueDate: "2026-08-15",
        },
      ],
    });

    const validated = validateParsedEvidenceBatch(
      descriptor,
      descriptor.key,
      documents,
    );
    expect(validated).toBe(documents);
    expect(validated[0]).toMatchObject({
      externalKey: "CVE-2026-12345",
      excerpt: "A detailed issue excerpt.",
      searchText: expect.stringContaining("CVE-2026-12345"),
      tags: ["cisa", "kev", "cve-2026-12345"],
      authors: ["CISA"],
      sourceRevision: "2026-08-01:2026-08-15",
      metadata: { vendorProject: "Vendor", product: "Product" },
    });
    expect(() =>
      validateParsedEvidenceBatch(descriptor, "other-source", documents),
    ).toThrow(/emitted batch/);
    expect(() =>
      validateParsedEvidenceBatch(descriptor, descriptor.key, [
        ...documents,
        ...documents,
      ]),
    ).toThrow(/duplicate documents/);
    expect(() =>
      validateParsedEvidenceBatch(
        descriptor,
        descriptor.key,
        Array.from({ length: descriptor.maxItemsPerRun + 1 }, (_, index) => ({
          ...documents[0]!,
          externalKey: `CVE-2026-${String(12345 + index).padStart(5, "0")}`,
        })),
      ),
    ).toThrow(/exceeded maxItemsPerRun/);
  });

  test("uses a per-repository contract for runtime GitHub release batches", () => {
    const descriptor = evidenceAdapterDescriptor({
      key: "github-releases-vercel-next.js",
      name: "GitHub releases: vercel/next.js",
      sourceType: "api",
      baseUrl: "https://api.github.com/repos/vercel/next.js/releases",
      homepageUrl: "https://github.com/vercel/next.js/releases",
      termsUrl:
        "https://docs.github.com/en/site-policy/github-terms/github-terms-of-service",
      provenanceClass: "official",
      licenseClass: "attributed",
    });
    expect(descriptor.key).toBe("github-releases-vercel-next.js");
    expect(descriptor.name).toBe("GitHub releases: vercel/next.js");
    expect(descriptor.maxItemsPerRun).toBe(30);

    const releases = parseGithubReleases(
      Array.from({ length: 31 }, (_, index) => ({
        tag_name: `v${index + 1}.0.0`,
        html_url: `https://github.com/vercel/next.js/releases/tag/v${index + 1}.0.0`,
        name: `Release ${index + 1}`,
      })),
      "vercel/next.js",
      31,
    );
    expect(releases).toHaveLength(30);
    expect(
      validateParsedEvidenceBatch(descriptor, descriptor.key, releases),
    ).toBe(releases);
    expect(() =>
      validateParsedEvidenceBatch(
        descriptor,
        "github-allowlisted-releases",
        releases,
      ),
    ).toThrow(/emitted batch/);
    expect(() =>
      validateParsedEvidenceBatch(descriptor, descriptor.key, [
        ...releases,
        { ...releases[0]!, externalKey: "vercel/next.js@overflow" },
      ]),
    ).toThrow(/exceeded maxItemsPerRun/);
  });

  test("derives only explicit source facts across every allowlisted record type", () => {
    const [advisory] = parseGithubAdvisories([
      {
        ghsa_id: "GHSA-aaaa-bbbb-cccc",
        html_url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc",
        summary: "Example advisory",
        severity: "high",
        updated_at: "2026-08-01T00:00:00Z",
      },
    ]);
    const [release] = parseGithubReleases(
      [
        {
          tag_name: "v1.0.0",
          html_url: "https://github.com/openai/openai-node/releases/tag/v1.0.0",
          name: "Version 1",
          published_at: "2026-08-01T00:00:00Z",
        },
      ],
      "openai/openai-node",
    );
    const [paper] = parseCrossrefWorks({
      message: {
        items: [
          {
            DOI: "10.1000/example",
            URL: "https://doi.org/10.1000/example",
            title: ["Metadata-only paper"],
            publisher: "Example Press",
          },
        ],
      },
    });
    expect(deriveEvidence(advisory!).claims[0]).toMatchObject({
      claimKey: "github-advisory:ghsa-aaaa-bbbb-cccc",
      predicate: "published-in-github-advisories",
    });
    expect(deriveEvidence(release!).claims[0]).toMatchObject({
      claimKey: "github-release:openai/openai-node:v1.0.0",
      predicate: "published-release",
    });
    expect(deriveEvidence(paper!).claims[0]).toMatchObject({
      claimKey: "crossref-metadata:10.1000/example",
      predicate: "has-crossref-metadata",
    });
    expect(JSON.stringify(deriveEvidence(paper!))).not.toMatch(
      /abstract|full text/i,
    );
  });

  test("retains bounded advisory and release facts as structured, attributable metadata", () => {
    const [advisory] = parseGithubAdvisories([
      {
        ghsa_id: "GHSA-aaaa-bbbb-cccc",
        html_url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc",
        summary: "Example advisory",
        severity: "high",
        identifiers: [{ value: "CVE-2026-12345" }],
        cwes: [{ cwe_id: "CWE-79" }],
        cvss: { score: 8.1, vector_string: "CVSS:3.1/AV:N" },
        vulnerabilities: [
          {
            package: { ecosystem: "npm", name: "example-package" },
            vulnerable_version_range: "< 2.0.0",
            first_patched_version: { identifier: "2.0.0" },
          },
        ],
      },
    ]);
    expect(advisory?.metadata).toMatchObject({
      cwes: ["CWE-79"],
      cvssScore: 8.1,
      vulnerablePackages: [
        expect.objectContaining({ packageName: "example-package", firstPatchedVersion: "2.0.0" }),
      ],
    });
    expect(deriveEvidence(advisory!).entities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ entityKey: "cve:cve-2026-12345" }),
        expect.objectContaining({ entityKey: "cwe:cwe-79" }),
      ]),
    );
    expect(deriveEvidence(advisory!).claims).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ predicate: "has-severity", objectText: "high" }),
      ]),
    );

    const [release] = parseGithubReleases(
      [{
        id: 1,
        tag_name: "v2.0.0",
        html_url: "https://github.com/openai/openai-node/releases/tag/v2.0.0",
        name: "Version 2",
        body: "A bounded release summary.",
        target_commitish: "abc123",
        assets: [{ name: "package.tgz", size: 42, browser_download_url: "https://github.com/example/package.tgz" }],
      }],
      "openai/openai-node",
    );
    expect(release?.metadata).toMatchObject({ assetCount: 1, bodySummary: "A bounded release summary." });
    expect(deriveEvidence(release!).claims).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ predicate: "targets-revision", objectText: "abc123" }),
      ]),
    );
  });
});
