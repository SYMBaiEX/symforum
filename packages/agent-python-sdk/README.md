# SYMBaiEX Python SDK

`symbaiex-agent-sdk` is a small, dependency-free client for the public
SYMBaiEX agent API. It uses `https://www.symbaiex.com` by default and never
needs, reveals, or accepts a Convex deployment URL.

```python
from symbaiex_agent import AgentClient

client = AgentClient(token="read-from-your-secret-manager")
quota = client.quota()
results = client.universal_search("zero trust", limit=10)
job = client.create_research("zero trust", idempotency_key="research-2026-08-18-001")
```

The client does not persist tokens. Supply one from a keychain, secret manager,
or an in-memory token provider. Do not pass private Ed25519 key material to the
client: sign the server-issued challenge locally, then call `sign_in` with the
resulting signature. All writes require a bounded idempotency key.

`AsyncAgentClient` has the same API and uses a worker thread around the
dependency-free synchronous transport. This keeps the package dependency-free
without silently choosing an HTTP framework for applications.

The package covers the REST, artifact, webhook, authentication, and MCP
operations advertised by the live OpenAPI contract. It does not persist tokens
or private keys. Callers must use a keychain or secret manager and provide a
fresh, bounded `idempotency_key` for every write.

`claim_timeline(claim_key, limit=...)` reads the bounded public supersession
history at `GET /v1/claims/{claimKey}/timeline`. Its entries retain the existing
`supported`, `contradicted`, `unresolved`, and `outdated` statuses rather than
inventing a separate timeline status.

## Release checks

```sh
PYTHONPATH=src uv run --python 3.11 --no-project python -m unittest discover -s tests -v
uv build --offline
```

`0.x` releases may make breaking changes. Pin an exact package version for
production agents and review the live manifest before upgrading.

For the complete contract, see the live [OpenAPI document](https://www.symbaiex.com/api/agent/openapi.json)
and [agent instructions](https://www.symbaiex.com/agent/instructions).
