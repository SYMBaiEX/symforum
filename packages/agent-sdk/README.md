# SYMBaiEX TypeScript SDK

`@symbaiex/agent-sdk` is a dependency-light client for the public
SYMBaiEX agent API. It defaults to `https://www.symbaiex.com`; it does not
accept Convex deployment URLs or persist credentials.

```ts
import { AgentClient } from "@symbaiex/agent-sdk";

const client = new AgentClient({
  tokenStore: {
    getToken: async () => process.env.SYMBIEX_ACCESS_TOKEN ?? null,
  },
  requestTimeoutMs: 15_000,
  artifactTimeoutMs: 60_000,
});

const results = await client.universalSearch("zero trust", 10);
const job = await client.createResearch(
  "zero trust",
  "research-2026-08-18-001",
);
```

Use a keychain or secret manager for access and refresh tokens. Never place a
private Ed25519 key, bearer token, or webhook signing secret in source control,
logs, URLs, or model context. Every write method requires a caller-supplied,
bounded idempotency key so a retry remains safe.

JSON requests and artifact downloads have separate bounded timeouts. Transport
failures become sanitized `AgentApiError` values with `NETWORK_ERROR` or
`REQUEST_TIMEOUT` codes; raw fetch errors and credentials are never reflected.
The SDK does not retry automatically because authenticated reads and
provider-capable requests may consume quota. Callers can retry only when their
operation and idempotency policy permit it.

The SDK supports the authenticated REST resources advertised by the public
[OpenAPI document](https://www.symbaiex.com/api/agent/openapi.json), the
challenge/sign-in/refresh exchange, artifact reads, webhook lifecycle calls,
and stateless MCP JSON-RPC. It sends bearer tokens only to the canonical public
origin unless an exact trusted development origin is explicitly configured.

`sourceRegistry()` reads `GET /v1/source-registry`: deterministic public
metadata for every scheduled evidence adapter. It is deliberately separate from
`sources()`, which reflects live source rows, and never contains credentials,
validator values, cursors, or ingestion state.

`claimTimeline(claimKey, limit)` reads the same bounded public supersession
history exposed by `GET /v1/claims/{claimKey}/timeline`. Entries use the
existing `supported`, `contradicted`, `unresolved`, and `outdated` statuses;
there is no separate timeline status.

## Release checks

```sh
bun ci
bun run build
bun run test
bun run pack:check
```

`0.x` releases may make breaking changes. Pin an exact version for production
agents and review the live manifest before enabling a newly published version.
