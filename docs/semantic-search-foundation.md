# Semantic search foundation

The existing universal search remains lexical and public. This foundation adds
an **off-by-default** OpenRouter-only embedding index for public evidence
documents; it does not alter the current REST, MCP, SDK, CLI, or browser search
contract.

## Activation

An operator must set all of the following in the production Convex environment:

```text
SEMANTIC_SEARCH_ENABLED=true
SEMANTIC_SEARCH_DAILY_BUDGET_USD=0.05
SEMANTIC_SEARCH_EMBEDDING_MODEL=openai/text-embedding-3-small
OPENROUTER_API_KEY=<existing server-side OpenRouter key>
AGENT_SEMANTIC_RELAY_SECRET=<same random 32+ character value as Vercel>
```

The model is deliberately allowlisted until a reviewed price and vector
dimension profile is added. Any other model, absent key, invalid budget, or
disabled switch fails closed. The feature shares the existing OpenRouter spend
control and additionally enforces its own $0.05/day default (maximum $5/day).

## Safety model

- Only `evidenceDocuments` whose document **and live source** are public and
  active are embedded.
- The index stores bounded public discovery text (6,000 characters), never raw
  source payloads or private documents.
- The vector index is never trusted for authorization. Every result is joined
  back to the primary database and its current source visibility is checked
  immediately before returning it.
- Indexing is replay-safe per document/source version and uses a stable RAG key
  so an update replaces the prior embedding. A durable operation lease is
  atomically reserved before OpenRouter is called; its 60-second recovery is
  safely longer than the 12-second provider timeout.
- Each reservation is settled exactly once: actual provider usage replaces the
  conservative reservation, and a network/provider failure refunds it. The
  512 KiB response cap, `redirect: "error"`, and timeout are enforced in the
  OpenRouter fetch wrapper.
- Index operations use a deterministic version key; query operations use a
  fresh nonce so repeated identical searches are never mistaken for a prior
  read. Terminal query accounting rows are explicitly eligible for cleanup
  after 15 minutes, while index idempotency rows remain durable.
- Reservations record their original UTC day and spend bucket. Settlement and
  expired-lease recovery always adjust that exact bucket, including across
  midnight. A recorded semantic health pause stops work before reservation or
  provider access.
- A five-minute Convex cron invokes bounded operation cleanup. It refunds
  expired leases against their original spend bucket, terminalizes each lease
  before pruning, and schedules a one-second continuation for a full batch.
- Semantic metadata carries the document/source fingerprint. A candidate is
  rejected if its live fingerprint no longer matches, even if it remains
  public.
- Backfill pages contain at most five documents and schedule the next page only
  after completion. It has no cron while disabled.
- Retrieval receives at most 25 vector candidates and returns at most 20
  authorized documents.
- Provider failures return no semantic matches. Existing lexical results stay
  available.

## Operator rollout

1. Deploy this schema/function release with the switch unset.
2. Set the five Convex environment values above and the same relay secret in
   Vercel, then run the internal
   `semanticSearch:backfillPublicEvidence` action once.
3. Observe `aiOperationalStates` using the
   `semantic-search-public-evidence:<model>` key and OpenRouter spend buckets.
4. Exercise `semanticSearch:searchPublicSemantic` with public queries and
   verify that hidden/retired sources disappear without re-indexing.
5. Exercise the authenticated first-party REST and MCP transports with an
   enrolled evidence-scoped agent. Reuse an idempotency key and confirm the
   result is replayed without a second usage debit or provider operation.

Public and agent universal search deliberately continue to use the proven
lexical path. The separate authenticated semantic transport is the only public
caller of `semanticSearch:searchHybridPublic`; it preserves lexical ordering
and only appends freshly authorized semantic-only evidence when the switch is
enabled.
