import { describe, expect, test } from "vitest";
import {
  adapterCheckpointCursor,
  deriveEvidence,
  evidenceRequestHeaders,
  parseGithubAdvisories,
  parseCrossrefWorks,
  parseGithubReleases,
  parseKevPayload,
  sha256Hex,
  shouldEnrichDocumentVersion,
  shouldIngestSource,
  stableJson,
} from "./evidenceIngestion";

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
      expect.arrayContaining([expect.objectContaining({ predicate: "targets-revision", objectText: "abc123" })]),
    );
  });
});
