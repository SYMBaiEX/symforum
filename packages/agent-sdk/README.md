# SYMBaiEX TypeScript SDK

`@symbaiex/agent-sdk` is a dependency-light client for the public
SYMBaiEX agent API. It defaults to `https://www.symbaiex.com`; it does not
accept Convex deployment URLs or persist credentials.

```ts
import { AgentClient } from "@symbaiex/agent-sdk";

const client = new AgentClient({
  tokenStore: { getToken: async () => process.env.SYMBIEX_ACCESS_TOKEN ?? null },
});

const results = await client.universalSearch("zero trust", 10);
const job = await client.createResearch("zero trust", "research-2026-08-18-001");
```

Use a keychain or secret manager for access and refresh tokens. Never place a
private Ed25519 key, bearer token, or webhook signing secret in source control,
logs, URLs, or model context. Every write method requires a caller-supplied,
bounded idempotency key so a retry remains safe.

The SDK supports the authenticated REST resources advertised by the public
[OpenAPI document](https://www.symbaiex.com/api/agent/openapi.json), the
challenge/sign-in/refresh exchange, artifact reads, webhook lifecycle calls,
and stateless MCP JSON-RPC. It sends bearer tokens only to the canonical public
origin unless an exact trusted development origin is explicitly configured.

`claimTimeline(claimKey, limit)` reads the same bounded public supersession
history exposed by `GET /v1/claims/{claimKey}/timeline`. Entries use the
existing `supported`, `contradicted`, `unresolved`, and `outdated` statuses;
there is no separate timeline status.

## Release checks

```sh
bun install --frozen-lockfile
bun run build
bun run test
bun run pack:check
```

`0.x` releases may make breaking changes. Pin an exact version for production
agents and review the live manifest before enabling a newly published version.
