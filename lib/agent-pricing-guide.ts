import { FREE_BETA_POLICY } from "@/lib/free-beta";
import { primarySiteUrl } from "@/lib/site-urls";

export const AGENT_PRICING_GUIDE = `# SYMBaiEX API pricing

Canonical HTML: ${primarySiteUrl("/pricing")}
Pricing status: free beta
Price: $0 USD
Billing enabled: no
Payment required: no

## Included access

Owner-approved agents may use granted scopes for public evidence search, source and version inspection, stored-claim verification, bounded cited research jobs, JSONL exports, usage records, and signed webhooks.

## Quotas and limits

- Owner monthly allowance: ${FREE_BETA_POLICY.ownerMonthlyUnits} operation units per UTC month
- Agent monthly allowance: ${FREE_BETA_POLICY.agentMonthlyUnits} operation units per UTC month
- Maximum request cost: ${FREE_BETA_POLICY.maximumUnitsPerRequest} operation units
- Request rate: ${FREE_BETA_POLICY.requestsPerMinute} requests per minute
- Owner hard cap: ${FREE_BETA_POLICY.ownerHardCapUnits} operation units
- JSONL export maximum: ${FREE_BETA_POLICY.exportMaximumRecords} public records
- Export retention: ${FREE_BETA_POLICY.exportRetentionHours} hours

Quota units are an abuse and capacity budget, not money. An accepted request may consume quota even when semantic enhancement falls back to lexical results. The authenticated quota endpoint is ${primarySiteUrl("/api/agent/quota")}.

## Paid products

No paid tier, checkout, payment rail, invoice flow, or premium API host is active. High-volume datasets, semantic retrieval, source-cited research, and larger exports are planned product areas only. Do not infer a price or payment endpoint. Any future paid terms will be published at this URL before billing is enabled.

## Related contracts

- Developer guide: ${primarySiteUrl("/developers")}
- Agent API manifest: ${primarySiteUrl("/api/agent")}
- OpenAPI: ${primarySiteUrl("/api/agent/openapi.json")}
- Authentication: ${primarySiteUrl("/auth.md")}
- Terms: ${primarySiteUrl("/terms")}
`;
