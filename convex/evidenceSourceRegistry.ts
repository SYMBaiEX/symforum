
import { PRIMARY_SITE_URL } from "../lib/site-urls";
/**
 * Public, code-owned contract for scheduled evidence adapters.
 *
 * This deliberately describes adapter behavior rather than live source rows:
 * validators, cursors, timestamps, failures, and credentials remain operational
 * state in `evidenceSources` and are never returned from this registry.
 */
import type { EvidenceSourceAdapterDescriptor } from "./evidenceSourceAdapter";

export type PublicEvidenceSourceRegistryRow = EvidenceSourceAdapterDescriptor;

const MEBIBYTE = 1024 * 1024;

/** The public-release adapter's code-owned, bounded repository allowlist. */
export const GITHUB_ALLOWLISTED_RELEASE_REPOSITORIES = [
  "openai/openai-node",
  "vercel/next.js",
  "get-convex/convex-backend",
] as const;
export const GITHUB_RELEASES_PER_REPOSITORY = 30;

export const PUBLIC_EVIDENCE_SOURCE_REGISTRY = [
  {
    key: "cisa-kev",
    name: "CISA Known Exploited Vulnerabilities",
    officialApiUrl:
      "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json",
    officialTermsUrl: "https://www.cisa.gov/website-information",
    officialAttributionUrl:
      "https://www.cisa.gov/known-exploited-vulnerabilities-catalog",
    licenseClass: "public-domain",
    accessClass: "public",
    capability: "bounded KEV catalog snapshot",
    checkpointModel: "HTTP validators only; no pagination cursor",
    conditionalRequestModel: "ETag and Last-Modified request validators",
    timeoutMs: 12_000,
    maxResponseBytes: 2 * MEBIBYTE,
    maxItemsPerRun: 100,
    maxPagesPerRun: 1,
    cadence: "7 * * * *",
    fixtureProvenance:
      "Synthetic minimal CISA KEV-shaped payloads in convex/evidenceIngestion.test.ts; no copied catalog records.",
  },
  {
    key: "github-global-advisories",
    name: "GitHub Global Security Advisories",
    officialApiUrl: "https://api.github.com/advisories",
    officialTermsUrl:
      "https://docs.github.com/en/site-policy/github-terms/github-terms-of-service",
    officialAttributionUrl:
      "https://docs.github.com/en/rest/security-advisories/global-advisories",
    licenseClass: "attributed",
    accessClass: "public-optional-token",
    capability: "bounded reviewed global advisory metadata",
    checkpointModel:
      "HTTP validators only; Link pagination intentionally ignored",
    conditionalRequestModel: "ETag and Last-Modified request validators",
    timeoutMs: 12_000,
    maxResponseBytes: 2 * MEBIBYTE,
    maxItemsPerRun: 100,
    maxPagesPerRun: 1,
    cadence: "23 */6 * * *",
    fixtureProvenance:
      "Synthetic minimal GitHub advisory-shaped payloads in convex/evidenceIngestion.test.ts; no copied advisory text.",
  },
  {
    key: "github-allowlisted-releases",
    name: "GitHub allowlisted releases",
    officialApiUrl: "https://api.github.com/repos/{owner}/{repo}/releases",
    officialTermsUrl:
      "https://docs.github.com/en/site-policy/github-terms/github-terms-of-service",
    officialAttributionUrl: "https://docs.github.com/en/rest/releases/releases",
    licenseClass: "attributed",
    accessClass: "public-optional-token",
    capability:
      "bounded release metadata for the code allowlist; one page per repository",
    checkpointModel: "per-repository HTTP validators only; no page cursor",
    conditionalRequestModel: "ETag and Last-Modified request validators",
    timeoutMs: 12_000,
    maxResponseBytes: 2 * MEBIBYTE,
    maxItemsPerRun:
      GITHUB_ALLOWLISTED_RELEASE_REPOSITORIES.length *
      GITHUB_RELEASES_PER_REPOSITORY,
    maxPagesPerRun: GITHUB_ALLOWLISTED_RELEASE_REPOSITORIES.length,
    cadence: "37 */2 * * *",
    fixtureProvenance:
      "Synthetic minimal GitHub release-shaped payloads in convex/evidenceIngestion.test.ts; no copied release notes.",
  },
  {
    key: "crossref-curated-metadata",
    name: "Crossref curated research metadata",
    officialApiUrl: "https://api.crossref.org/works",
    officialTermsUrl: "https://www.crossref.org/terms/",
    officialAttributionUrl:
      "https://www.crossref.org/documentation/retrieve-metadata/rest-api/",
    licenseClass: "attributed",
    accessClass: "public",
    capability:
      "bounded bibliographic metadata only; no abstracts or full text",
    checkpointModel: "HTTP validators only; no pagination cursor",
    conditionalRequestModel: "ETag and Last-Modified request validators",
    timeoutMs: 12_000,
    maxResponseBytes: 2 * MEBIBYTE,
    maxItemsPerRun: 100,
    maxPagesPerRun: 1,
    cadence: "51 */12 * * *",
    fixtureProvenance:
      "Synthetic minimal Crossref work-shaped payloads in convex/evidenceIngestion.test.ts; no copied abstracts or papers.",
  },
  {
    key: "symbaiex-first-party-research",
    name: "SYMBaiEX first-party research",
    officialApiUrl: PRIMARY_SITE_URL + "/research",
    officialTermsUrl: PRIMARY_SITE_URL + "/ai-policy",
    officialAttributionUrl: PRIMARY_SITE_URL + "/research",
    licenseClass: "attributed",
    accessClass: "first-party",
    capability:
      "explicit curated research registry plus approved disclosed forum-agent research; no HTML scraping",
    checkpointModel:
      "deterministic code registry and latest 100 approved research assessments; no external cursor",
    conditionalRequestModel: "not applicable; no network fetch",
    timeoutMs: 0,
    maxResponseBytes: 0,
    maxItemsPerRun: 103,
    maxPagesPerRun: 1,
    cadence: "5 */4 * * *",
    fixtureProvenance:
      "Code-owned RESEARCH_PAGES registry in convex/evidenceFirstParty.ts plus public approved forum threads and their persisted quality/source metadata; no fetched page bodies.",
  },
  {
    key: "nvd-cve-2",
    name: "NVD CVE API 2.0",
    officialApiUrl: "https://services.nvd.nist.gov/rest/json/cves/2.0",
    officialTermsUrl: "https://nvd.nist.gov/general/terms-of-use",
    officialAttributionUrl: "https://nvd.nist.gov/developers/vulnerabilities",
    licenseClass: "public-domain",
    accessClass: "public-optional-token",
    capability: "incremental bounded CVE update page",
    checkpointModel:
      "persisted bounded time window, start index, adaptive page size, and exponential retry marker",
    conditionalRequestModel:
      "time-window query checkpoint; no HTTP validator reuse",
    timeoutMs: 20_000,
    maxResponseBytes: 2 * MEBIBYTE,
    maxItemsPerRun: 25,
    maxPagesPerRun: 1,
    cadence: "3,33 * * * *",
    fixtureProvenance:
      "Synthetic minimal NVD CVE 2.0 payloads in convex/evidenceNvd.test.ts; no copied NVD records.",
  },
  {
    key: "nvd-cve-change-history-2",
    name: "NVD CVE Change History API 2.0",
    officialApiUrl: "https://services.nvd.nist.gov/rest/json/cvehistory/2.0",
    officialTermsUrl: "https://nvd.nist.gov/general/terms-of-use",
    officialAttributionUrl: "https://nvd.nist.gov/developers/vulnerabilities",
    licenseClass: "public-domain",
    accessClass: "public-optional-token",
    capability: "incremental bounded immutable CVE change-event page",
    checkpointModel:
      "persisted bounded time window, start index, adaptive page size, and exponential retry marker",
    conditionalRequestModel:
      "time-window query checkpoint; no HTTP validator reuse",
    timeoutMs: 20_000,
    maxResponseBytes: 2 * MEBIBYTE,
    maxItemsPerRun: 25,
    maxPagesPerRun: 1,
    cadence: "18,48 * * * *",
    fixtureProvenance:
      "Synthetic minimal NVD history 2.0 payloads in convex/evidenceNvd.test.ts; no copied NVD records.",
  },
] as const satisfies readonly PublicEvidenceSourceRegistryRow[];

/** Returns detached metadata so callers cannot mutate the singleton registry. */
export function listPublicEvidenceSourceRegistry() {
  return PUBLIC_EVIDENCE_SOURCE_REGISTRY.map((source) => ({ ...source }));
}
