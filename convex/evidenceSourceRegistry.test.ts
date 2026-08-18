/// <reference types="vite/client" />

import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  GITHUB_ALLOWLISTED_RELEASE_REPOSITORIES,
  GITHUB_RELEASES_PER_REPOSITORY,
  PUBLIC_EVIDENCE_SOURCE_REGISTRY,
  listPublicEvidenceSourceRegistry,
} from "./evidenceSourceRegistry";

describe("public evidence source registry", () => {
  test("has exactly one complete public row for every scheduled evidence adapter", () => {
    expect(PUBLIC_EVIDENCE_SOURCE_REGISTRY.map((row) => row.key)).toEqual([
      "cisa-kev",
      "github-global-advisories",
      "github-allowlisted-releases",
      "crossref-curated-metadata",
      "symbaiex-first-party-research",
      "nvd-cve-2",
      "nvd-cve-change-history-2",
    ]);
    expect(
      new Set(PUBLIC_EVIDENCE_SOURCE_REGISTRY.map((row) => row.name)).size,
    ).toBe(7);
    for (const row of PUBLIC_EVIDENCE_SOURCE_REGISTRY) {
      expect(row.officialApiUrl).toMatch(/^https:\/\//);
      expect(row.officialTermsUrl).toMatch(/^https:\/\//);
      expect(row.officialAttributionUrl).toMatch(/^https:\/\//);
      expect(row.timeoutMs).toBeGreaterThanOrEqual(0);
      expect(row.maxResponseBytes).toBeGreaterThanOrEqual(0);
      expect(row.maxItemsPerRun).toBeGreaterThan(0);
      expect(row.maxPagesPerRun).toBeGreaterThan(0);
      expect(row.fixtureProvenance).toContain("convex/");
    }
  });

  test("derives aggregate GitHub release bounds from the adapter allowlist and page size", () => {
    const releases = PUBLIC_EVIDENCE_SOURCE_REGISTRY.find(
      (row) => row.key === "github-allowlisted-releases",
    );
    expect(releases).toMatchObject({
      maxPagesPerRun: GITHUB_ALLOWLISTED_RELEASE_REPOSITORIES.length,
      maxItemsPerRun:
        GITHUB_ALLOWLISTED_RELEASE_REPOSITORIES.length *
        GITHUB_RELEASES_PER_REPOSITORY,
    });
    const ingestion = readFileSync(
      new URL("./evidenceIngestion.ts", import.meta.url),
      "utf8",
    );
    expect(ingestion).toContain("GITHUB_ALLOWLISTED_RELEASE_REPOSITORIES");
    expect(ingestion).toContain("GITHUB_RELEASES_PER_REPOSITORY");
    expect(ingestion).toContain("per_page=${GITHUB_RELEASES_PER_REPOSITORY}");
  });

  test("matches the adapter schedules without exporting cursor or credential state", () => {
    const crons = readFileSync(new URL("./crons.ts", import.meta.url), "utf8");
    const scheduledAdapters = [
      ["cisa-kev", "evidence-cisa-kev"],
      ["github-global-advisories", "evidence-github-advisories"],
      ["github-allowlisted-releases", "evidence-github-releases"],
      ["crossref-curated-metadata", "evidence-crossref"],
      ["symbaiex-first-party-research", "evidence-first-party"],
      ["nvd-cve-2", "evidence-nvd-cves"],
      ["nvd-cve-change-history-2", "evidence-nvd-change-history"],
    ] as const;
    expect(scheduledAdapters.map(([key]) => key)).toEqual(
      PUBLIC_EVIDENCE_SOURCE_REGISTRY.map((row) => row.key),
    );
    expect(crons).toContain('"cronWatchdog:runActionJob"');
    for (const [key, jobKey] of scheduledAdapters) {
      const row = PUBLIC_EVIDENCE_SOURCE_REGISTRY.find(
        (item) => item.key === key,
      );
      expect(row).toBeDefined();
      expect(crons).toContain(`jobKey: "${jobKey}"`);
      expect(crons).toContain(`"${row!.cadence}"`);
    }
    for (const row of listPublicEvidenceSourceRegistry()) {
      expect(row).not.toHaveProperty("cursor");
      expect(row).not.toHaveProperty("etag");
      expect(row).not.toHaveProperty("lastModified");
      expect(row).not.toHaveProperty("apiKey");
      expect(row).not.toHaveProperty("token");
      expect(row).not.toHaveProperty("secret");
    }
  });

  test("returns detached deterministic rows", () => {
    const first = listPublicEvidenceSourceRegistry();
    (first[0] as { name: string }).name = "changed";
    expect(listPublicEvidenceSourceRegistry()[0]!.name).toBe(
      "CISA Known Exploited Vulnerabilities",
    );
  });
});
