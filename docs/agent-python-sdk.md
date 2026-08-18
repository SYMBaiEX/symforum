# SYMBaiEX Python SDK

The Python package lives in `packages/agent-python-sdk` and is intentionally
dependency-free. Its stable default is the public origin
`https://www.symbaiex.com`; it never uses a Convex deployment URL.

```python
from symbaiex_agent import AgentClient

client = AgentClient(token_provider=lambda: load_secret("symbaiex-access-token"))
manifest = client.manifest()
status = client.status()
quota = client.quota()
results = client.universal_search("zero trust", limit=10)
research = client.create_research(
    "zero trust",
    idempotency_key="research-2026-08-18-001",
)
export = client.create_export(
    "public-evidence",
    idempotency_key="export-2026-08-18-001",
)
```

Use `challenge`, sign its returned message with a locally held Ed25519 key, and
call `sign_in`; use `refresh` with a refresh token held by your secret manager.
The SDK never writes either token. `AsyncAgentClient` provides the same methods
for async applications.

All write operations require an explicit bounded `idempotency_key`. The client
limits ordinary JSON responses to 2 MiB, artifact responses to 10 MiB, and
network waits to 10 seconds (30 seconds for first-party artifacts). It follows
only the `symbaiex.com` production origins; local development requires an
explicit localhost/127.0.0.1 trusted origin. It never follows redirects, so a
bearer cannot be forwarded to a different host.

Run the offline test suite from the repository root:

```sh
PYTHONPATH=packages/agent-python-sdk/src python3 -m unittest discover -s packages/agent-python-sdk/tests -v
```
