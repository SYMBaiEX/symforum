import type { FrozenReportReceipt } from "../../../lib/forum-research-report-html";

// Invented frozen content only. No session, transaction, transport or payment.
export const reportReceipt: FrozenReportReceipt = {
  intentKey: "a".repeat(64),
  mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  createdAt: Date.parse("2024-01-01T01:00:00Z"),
  expiresAt: Date.parse("2024-01-01T01:05:00Z"),
  finalizedAt: Date.parse("2024-01-01T01:01:00Z"),
  signature: "invented-recorded-signature-not-a-transaction".repeat(2),
  report: {
    product: "solana-token-brief-v1",
    mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    title: "Invented frozen token report <not live>",
    generatedAt: Date.parse("2024-01-01T01:01:30Z"),
    metricsAsOf: Date.parse("2023-12-31T23:40:00Z"),
    facts: [
      { label: "Recorded price", value: "$0.0000000001" },
      { label: "Recorded liquidity", value: "$0" },
      { label: "Market cap", value: "Unavailable" },
      { label: "FDV", value: "$123,456,789.12" },
    ],
    analysis: [
      "Invented historical observation. No current safety or value claim.",
      "A".repeat(180),
    ],
    sources: [
      {
        label: "Invented external reference",
        url:
          "https://source.example/" +
          "original-mint-reference".repeat(8) +
          "?a=1&b=2",
      },
      {
        label: "Unsafe recorded reference",
        url: "javascript:alert('not executed')",
      },
    ],
    methodology:
      "Frozen fixture text, not purchased research. <script>alert('inert')</script>",
  },
};
