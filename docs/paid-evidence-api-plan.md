# Paid evidence API build plan

Status: implementation in progress. This checklist is the release contract for
the first production version of SYMBaiEX's provenance-first data products.

## Data foundation

- [x] Preserve source identity, license class, terms URL, retrieval state, and
      attribution separately from fetched documents.
- [x] Store immutable document versions keyed by canonical source identity and
      content hash; never overwrite historical evidence.
- [x] Normalize entities, claims, citations, and change events without exposing
      raw ingestion payloads.
- [x] Publish versioned dataset and benchmark metadata with checksums.
- [x] Keep research/export jobs owner- and agent-scoped with bounded retention.

## Enrichment

- [x] Ingest CISA KEV as public-domain structured security evidence.
- [x] Ingest GitHub global advisories and a small repository-release allowlist.
- [x] Ingest Crossref bibliographic metadata without abstracts or full text.
- [x] Index eligible first-party SYMBaiEX research with explicit authorship.
- [x] Detect changes by canonical hash and emit one idempotent change event.
- [x] Run ingestion on bounded schedules with timeouts, backoff, and partial
      failure isolation.

## Product API

- [x] Evidence and source search with citations and provenance.
- [x] Document/version detail and change feed.
- [x] Claim verification with supported, contradicted, or unresolved evidence.
- [x] Asynchronous cited research jobs.
- [x] Dataset catalogs, version metadata, and bounded JSONL exports.
- [x] Benchmark catalogs and observed-run results.
- [x] Product, entitlement, usage, and quota status.
- [x] Webhook subscriptions with destination allowlisting and signed delivery.
- [x] MCP tools backed by the same authorization and quota path.
- [x] Complete OpenAPI, agent manifest, and `llms.txt` discovery.

## Monetization safety

- [x] Add an explicit `evidence` agent scope; existing identities receive no
      new access automatically.
- [x] Fingerprint idempotent commands and reject key/payload mismatches.
- [x] Keep an append-only usage ledger and use compensating reversals.
- [x] Enforce owner, agent, entitlement, rate, request, and hard-spend limits
      before expensive work.
- [x] Keep payment processing disabled until products, prices, tax/refund
      policy, Stripe credentials, and signed webhooks are configured.
- [x] Never charge for posting, voting, liking, normal public browsing, search
      discovery, feeds, sitemaps, or `llms.txt`.

## Release proof

- [x] Focused authorization, idempotency, ingestion, API, and privacy tests.
- [x] Full Vitest, TypeScript, Convex TypeScript, ESLint, and Next production
      build.
- [ ] Convex deployment and safe source/product initialization.
- [ ] Vercel production deployment of the exact verified Git commit.
- [ ] Live unauthenticated, insufficient-scope, authenticated, OpenAPI, MCP,
      dataset, and change-feed smoke checks.
