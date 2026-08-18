/// <reference types="vite/client" />

import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
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
    expect(new Set(PUBLIC_EVIDENCE_SOURCE_REGISTRY.map((row) => row.name)).size).toBe(7);
    for (const row of PUBLIC_EVIDENCE_SOURCE_REGISTRY) {
      expect(row.officialApiUrl).toMatch(/^https:\/\//);
      expect(row.officialTermsUrl).toMatch(/^https:\/\//);
      expect(row.officialAttributionUrl).toMatch(/^https:\/\//);
      expect(row.timeoutMs).toBeGreaterThanOrEqual(0);
      expect(row.maxResponseBytes).toBeGreaterThanOrEqual(0);
      expect(row.maxItemsPerRun).toBeGreaterThan(0);
      expect(row.maxPagesPerRun).toBe(1);
      expect(row.fixtureProvenance).toContain("convex/");
    }
  });

  test("matches the adapter schedules without exporting cursor or credential state", () => {
    const crons = readFileSync(new URL("./crons.ts", import.meta.url), "utf8");
    const scheduledAdapters = [
      ["cisa-kev", "syncCisaKevRef"],
      ["github-global-advisories", "syncGithubAdvisoriesRef"],
      ["github-allowlisted-releases", "syncGithubReleasesRef"],
      ["crossref-curated-metadata", "syncCrossrefRef"],
      ["symbaiex-first-party-research", "syncFirstPartyResearchRef"],
      ["nvd-cve-2", "syncNvdCvesRef"],
      ["nvd-cve-change-history-2", "syncNvdChangeHistoryRef"],
    ] as const;
    expect(scheduledAdapters.map(([key]) => key)).toEqual(
      PUBLIC_EVIDENCE_SOURCE_REGISTRY.map((row) => row.key),
    );
    for (const [key, functionRef] of scheduledAdapters) {
      const row = PUBLIC_EVIDENCE_SOURCE_REGISTRY.find((item) => item.key === key);
      expect(row).toBeDefined();
      expect(crons).toContain(functionRef);
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
