import { RESEARCH_PRODUCT } from "@/lib/forum-research";

const text = { type: "string" } as const;
// Shape documentation only: no observations, quote or generated report.
export const researchExportSchema = {
  type: "object",
  properties: {
    product: { const: RESEARCH_PRODUCT },
    mint: { type: "string", description: "Exact Solana token mint" },
    title: text,
    generatedAt: {
      type: "integer",
      description: "Export creation time, Unix milliseconds",
    },
    metricsAsOf: {
      type: "integer",
      description: "Source observation time, Unix milliseconds",
    },
    facts: {
      type: "array",
      items: {
        type: "object",
        properties: { label: text, value: text },
        required: ["label", "value"],
      },
    },
    analysis: { type: "array", items: text },
    sources: {
      type: "array",
      items: {
        type: "object",
        properties: { label: text, url: { type: "string", format: "uri" } },
        required: ["label", "url"],
      },
    },
    methodology: text,
  },
  required: [
    "product",
    "mint",
    "title",
    "generatedAt",
    "metricsAsOf",
    "facts",
    "analysis",
    "sources",
    "methodology",
  ],
} as const;

export const researchExportPreviewJson = JSON.stringify(
  researchExportSchema,
  null,
  2,
);
