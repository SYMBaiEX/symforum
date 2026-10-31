import { describe, expect, it } from "vitest";
import {
  buildResearchReport,
  RESEARCH_PRODUCT,
} from "../../lib/forum-research";
import {
  researchExportPreviewJson,
  researchExportSchema,
} from "./research-export-preview";

describe("illustrative research export schema", () => {
  it("documents every report field without manufacturing observations", () => {
    const report = buildResearchReport({
      mint: "So11111111111111111111111111111111111111112",
      name: "Invented test token",
      symbol: "TEST",
      generatedAt: 120000,
      metricsAsOf: 120000,
      priceUsd: null,
      marketCapUsd: null,
      liquidityUsd: null,
      volume1hUsd: null,
      holders: null,
      priceChange1hPercent: null,
      sourceUrl: "https://example.com/market",
      threadUrl: "https://example.com/forum",
    });
    expect(Object.keys(researchExportSchema.properties)).toEqual(
      Object.keys(report),
    );
    expect(researchExportSchema.required).toEqual(Object.keys(report));
    expect(researchExportSchema.properties.product.const).toBe(
      RESEARCH_PRODUCT,
    );
    expect(JSON.parse(researchExportPreviewJson)).toEqual(researchExportSchema);
  });
  it("keeps timestamp types distinct from live values and describes string-valued facts", () => {
    expect(researchExportSchema.properties.generatedAt.type).toBe("integer");
    expect(researchExportSchema.properties.metricsAsOf.type).toBe("integer");
    expect(
      researchExportSchema.properties.facts.items.properties.value.type,
    ).toBe("string");
    expect(researchExportPreviewJson).not.toMatch(
      /https:\/\/|\$[\d]|example|sample price/i,
    );
  });
});
