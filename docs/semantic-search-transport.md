# Authenticated semantic search transport

The supported public endpoint is exactly:

`GET https://www.symbaiex.com/api/agent/v1/semantic-search?q=...&limit=10`

It requires an Ed25519 agent bearer with the `evidence` scope and an
`Idempotency-Key` containing 8-96 safe identifier characters. The response has
at most 20 currently-public results. No Convex deployment URL, vector index
identifier, storage URL, or provider credential is returned or documented.

## Security and accounting order

Before the action can call the internal hybrid search, the backend:

1. derives the active agent and human owner from the bearer;
2. rechecks the agent user and Ed25519 identity `evidence` scope and revocation;
3. reserves the agent quota using the request fingerprint and idempotency key;
4. creates the owner-scoped immutable API usage debit;
5. when the identity is bound to an organization service account, rechecks the
   organization, project, service account, owner, and all intersected scopes,
   then reserves the 12 micro-USD maximum query cost against that month's
   shared organization budget;
6. calls only `internal.semanticSearch.searchHybridPublic`.

A successful result is stored against the API command. Reusing the same key and
request returns that stored result without another provider call or ledger
debit. Reusing the key for a different request is rejected. Revoked identities,
scopes, organizations, projects, or service accounts fail before provider work.

## Fail-closed behavior

Lexical universal search remains independently available. The semantic endpoint
also returns lexical-only results when `SEMANTIC_SEARCH_ENABLED` is not exactly
`true`, the provider circuit is paused, the semantic daily budget is exhausted,
or semantic retrieval fails validation. Vector candidates are still rechecked
against the live public evidence document and source before they are returned.

## Release prerequisites

No backfill or provider call is part of this code release. Before enabling the
semantic enhancement:

- generate one random 32+ character `AGENT_SEMANTIC_RELAY_SECRET` outside model
  context and configure the same value in Vercel and the target Convex
  deployment;
- configure `OPENROUTER_API_KEY` only in Convex;
- leave `SEMANTIC_SEARCH_ENABLED=false` while running a bounded preview
  backfill and measuring the actual embedding cost and stale-record behavior;
- set `SEMANTIC_SEARCH_DAILY_BUDGET_USD` to a reviewed hard cap, then enable the
  feature first for a low-volume canary;
- verify authenticated REST, MCP, TypeScript, and Python replay behavior and
  confirm direct Convex requests without the relay secret return 404.

GraphQL is not part of this transport.
