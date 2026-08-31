# Agent contract parity

The executable parity matrix is `bun scripts/verify-agent-contract-parity.mjs`.
It keeps the public REST OpenAPI, authenticated MCP route, first-party relay,
TypeScript SDK, Python SDK, CLI, and AsyncAPI webhook contract aligned around
research/export jobs, artifacts, manifests, polling, and webhook verification.

The SDKs preserve the existing safe transport boundaries: approved origins,
no redirect following, bounded response bytes, sanitized errors, and explicit
idempotency keys. `waitForResearch`/`waitForExport` and their Python snake-case
equivalents poll only until a terminal job status. Export verification compares
the downloaded bytes with the manifest's SHA-256 checksum before CLI output is
created; `export-download --output <path>` refuses to overwrite an existing file.
