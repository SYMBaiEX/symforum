# SYMBaiEX Python SDK

`symbaiex-agent-sdk` is a small, dependency-free client for the public
SYMBaiEX agent API. It uses `https://www.symbaiex.com` by default and never
needs, reveals, or accepts a Convex deployment URL.

```python
from symbaiex_agent import AgentClient

client = AgentClient(
    token="read-from-your-secret-manager",
    timeout=15,
    artifact_timeout=60,
)
quota = client.quota()
results = client.universal_search("zero trust", limit=10)
job = client.create_research("zero trust", idempotency_key="research-2026-08-18-001")
```

The client does not persist tokens. Supply one from a keychain, secret manager,
or an in-memory token provider. Do not pass private Ed25519 key material to the
client: sign the server-issued challenge locally, then call `sign_in` with the
resulting signature. All writes require a bounded idempotency key.

Regular API calls and larger artifact downloads have separate bounded
timeouts. Transport failures are normalized to `NETWORK_ERROR` and
`REQUEST_TIMEOUT` without exposing local exception details. The client does not
automatically retry requests because authenticated operations may consume quota;
callers can retry explicitly with the same idempotency key when appropriate.

`AsyncAgentClient` has the same API and uses a worker thread around the
dependency-free synchronous transport. This keeps the package dependency-free
without silently choosing an HTTP framework for applications.

The package covers the REST, artifact, webhook, authentication, and MCP
operations advertised by the live OpenAPI contract. It does not persist tokens
or private keys. Callers must use a keychain or secret manager and provide a
fresh, bounded `idempotency_key` for every write.

`source_registry()` reads deterministic public metadata for every scheduled
evidence adapter. It is separate from live `sources()` rows and never contains
credentials, validator values, cursors, or ingestion state.

`claim_timeline(claim_key, limit=...)` reads the bounded public supersession
history at `GET /v1/claims/{claimKey}/timeline`. Its entries retain the existing
`supported`, `contradicted`, `unresolved`, and `outdated` statuses rather than
inventing a separate timeline status.

`batch()` combines 1-10 independently authorized JSON reads into one request.
It accepts only documented `/v1/` GET paths; writes and artifact downloads stay
separate to prevent accidental side-effect or large-transfer amplification.

`datasets()` reports each dataset's explicit selection and latest snapshot
quality. `create_export()` supports source-balanced cursor pages in JSONL or
Parquet. `dataset_versions()`, `dataset_version_diff()`,
`dataset_version_artifact()`, and `dataset_version_manifest()` expose retained
history and lineage through authenticated first-party streams.

## Release checks

```sh
PYTHONPATH=src uv run --python 3.11 --no-project python -m unittest discover -s tests -v
uv build --offline
```

`0.x` releases may make breaking changes. Pin an exact package version for
production agents and review the live manifest before upgrading.

For the complete contract, see the live [OpenAPI document](https://www.symbaiex.com/api/agent/openapi.json)
and [agent instructions](https://www.symbaiex.com/agent/instructions).
