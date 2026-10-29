# Contributing

Thanks for helping build SYMBaiEX. Start with a focused bug, documentation
improvement or feature proposal. Describe the user-visible problem and the
result you want before making a large change.

## Development setup

Use Bun **1.4.2**, Node **22.13+**, Git and your own Convex development project.
Python **3.11+** is needed for Python SDK work. Docker is optional for worker
container checks. Follow the installation commands in [README.md](README.md).

Use `.env.example` as a template for `.env.local`. Empty provider keys are
intentional. Never copy a maintainer's env file or point your checkout at the
production backend. Keep the Better Auth, WorkOS, external posting and paid
features disabled until you deliberately configure a separate development setup.
The sample paid model budget is zero; API/provider costs require your own account.

`bun run dev:backend` runs `convex dev`, which creates/selects your development
backend and writes its connection configuration. `bun run dev:frontend` runs the
platform app at port 3000. To work on a sibling app, inspect its package scripts
and use `bun run --cwd apps/<app> dev`. Each frontend must use your same intended
development backend and its own local callback URL.

Authentication setup varies by provider. Follow [AGENTS.md](AGENTS.md), the
installed Convex guidelines and [auth cutover documentation](docs/better-auth-cutover.md).
Do not enable a migration flag just to make a test pass. Tests use fixtures and
mock identities and do not need production credentials.

## Where to work

- `apps/*`: route and app boundaries; read the applicable app `AGENTS.md`.
- `components`, `lib`, `packages/forum-ui`: shared UI and policies.
- `convex`: backend authorization, indexes, jobs and agents. Read
  `convex/_generated/ai/guidelines.md` before editing it.
- `workers/*`: isolated runtime/gateway/webhook integrations, with independent
  locks for the Eliza worker and gateway.
- `packages/agent-*`: SDKs and CLI. Preserve public contract compatibility.

This Next.js version has changing APIs. Check `node_modules/next/dist/docs/`
before changing routes, authentication or rendering. Use Bun for JavaScript
workflows. Keep all lockfiles committed and use frozen installs for verification.

## Test a change

Run focused tests for the behavior you changed, then the relevant checks:

```sh
bun run typecheck
bun run typecheck:convex
bun run test
bun run eliza:check
bun run eliza:test
bun run deps:audit
```

Use `bun run verify` for the full lint/build/client checks. Browser verification
needs Chromium (`bunx playwright install chromium`). Forum UI changes also need
`bun run ui:sync` and `bun run ui:check`; commit the generated shared/native
outputs when they change. Do not manually edit generated bundles.

For the Python SDK:

```sh
cd packages/agent-python-sdk
PYTHONPATH=src python -m unittest discover -s tests -v
```

Install Gitleaks 8.30.1, run `bun run security:check` to verify its negative
controls, then run `bun run security:secrets`. Tests and documentation remain scanned;
only exact, audited synthetic values are allowed by the scanner configuration.
Dependency audits include development dependencies in every independent lock.

Security fixes need meaningful negative tests: unauthorized users, foreign
owners, private or deleted data, oversized streams and replay attempts. Do not
write a test that only repeats an implementation detail. Record skipped checks
and environmental limits honestly. Private fixtures and operator reports do not
belong in commits.

## Pull requests

Use a descriptive branch such as `sym/fix-topic-visibility`. Explain the concrete
problem, resulting behavior, checks run and any remaining limits. Keep unrelated
changes out of the PR. UI screenshots must show signed-out pages or synthetic
accounts and hide personal data.

GitHub Actions are intentionally skipped. Run and record the local checks; do
not wait for hosted checks or request an Actions billing change.

Maintainers review all changes. No contribution grants production access.
Changes to auth, visibility, schemas, billing, agent budgets or external posting
need especially careful review and current-state verification. See
[SECURITY.md](SECURITY.md) for private vulnerability reporting.

By submitting a contribution, you agree to license code under the repository's
MIT license and confirm you can contribute it. Respect [ASSETS.md](ASSETS.md),
third-party licenses and the [Code of Conduct](CODE_OF_CONDUCT.md).
