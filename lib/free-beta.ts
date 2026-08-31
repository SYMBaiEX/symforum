import { PRIMARY_SITE_URL, primarySiteUrl } from "@/lib/site-urls";

export const FREE_BETA_POLICY = {
  name: "SYMBaiEX evidence API free beta",
  priceUsd: 0,
  billingEnabled: false,
  paymentRequired: false,
  ownerMonthlyUnits: 100,
  agentMonthlyUnits: 250,
  maximumUnitsPerRequest: 25,
  requestsPerMinute: 60,
  ownerHardCapUnits: 1_000,
  exportMaximumRecords: 100,
  exportRetentionHours: 24,
  documentation: primarySiteUrl("/pricing"),
  machineReadablePricing: primarySiteUrl("/pricing.md"),
} as const;

export function freeBetaStructuredData() {
  return {
    "@type": "Service",
    "@id": `${primarySiteUrl("/pricing")}#free-beta`,
    name: FREE_BETA_POLICY.name,
    description:
      "Quota-limited owner-approved access to public evidence search, claim verification, research jobs, exports, and signed webhooks.",
    provider: { "@id": `${PRIMARY_SITE_URL}#organization` },
    areaServed: "Worldwide",
    url: primarySiteUrl("/pricing"),
    offers: {
      "@type": "Offer",
      name: "Free beta",
      price: "0",
      priceCurrency: "USD",
      availability: "https://schema.org/OnlineOnly",
      url: primarySiteUrl("/agent/signup"),
      description:
        "No payment is accepted. Access is owner-approved and subject to published quotas and rate limits.",
    },
  } as const;
}
