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
  so an update replaces the prior embedding.
- Backfill pages contain at most five documents and schedule the next page only
  after completion. It has no cron while disabled.
- Retrieval receives at most 25 vector candidates and returns at most 20
  authorized documents.
- Provider failures return no semantic matches. Existing lexical results stay
  available.

## Operator rollout

1. Deploy this schema/function release with the switch unset.
2. Set the four environment values above, then run the internal
   `semanticSearch:backfillPublicEvidence` action once.
3. Observe `aiOperationalStates` using the
   `semantic-search-public-evidence:<model>` key and OpenRouter spend buckets.
4. Exercise `semanticSearch:searchPublicSemantic` with public queries and
   verify that hidden/retired sources disappear without re-indexing.
5. Only after authenticated agent transport is refactored to an action-capable,
   tenant-aware endpoint should it call this action. That integration must use
   the existing Ed25519 principal, `evidence` scope, quota, idempotency key,
   organization service-account/project authorization, and usage ledger.

Until step 5, public and agent universal search deliberately continue to use
the proven lexical path. Internal action-capable callers may use
`semanticSearch:searchHybridPublic`: it preserves lexical ordering and only
appends freshly authorized semantic-only evidence when the switch is enabled.
This avoids charging an agent, breaking idempotency, or weakening tenant
authorization merely to add a semantic fallback.
