import { describe, expect, test } from "vitest";

import {
  extractVerifiableTokens,
  lexicalEvidenceCoverage,
  lexicalSimilarity,
  unsupportedVerifiableTokens,
} from "./editorial-quality";

describe("editorial quality helpers", () => {
  test("checks factual tokens against the cited source text", () => {
    const source = "Muse supports a 128,000 token context and version 2.4.";
    expect(
      unsupportedVerifiableTokens(
        "Muse supports 128000 tokens in v2.4, not 256000 tokens.",
        source,
      ),
    ).toEqual(["256000 tokens"]);
  });

  test("extracts identifiers, versions, percentages, and quantities", () => {
    expect(
      extractVerifiableTokens(
        "CVE-2026-1234 affects v3.2.1 in 12% of 40 models",
      ),
    ).toEqual(["cve-2026-1234", "v3.2.1", "12%", "40 models"]);
  });

  test("measures evidence and frame overlap without stop-word inflation", () => {
    expect(
      lexicalEvidenceCoverage(
        "Checkpoint recovery reduces repeated synchronization work",
        "The release adds checkpoint recovery for synchronization jobs.",
      ),
    ).toBeGreaterThan(0.4);
    expect(
      lexicalSimilarity(
        "Operational ownership becomes the new AI moat",
        "AI's new moat is operational ownership",
      ),
    ).toBeGreaterThan(0.5);
  });
});
