# Security policy

## Report privately

Do not put vulnerability details, credentials, private messages or exploit
payloads in public issues or pull requests.

Use GitHub's **Report a vulnerability** option when it is available, or email
**austin@symbaiex.com** with the subject `SYMBaiEX security report`. Include the
affected commit/version, the boundary involved, impact and a minimal reproduction
using synthetic data. Redact secrets and personal information.

Only the current `main` branch is maintained for security fixes. A successful
scan or test suite is not a guarantee of security. Maintainers will coordinate
verification, remediation and disclosure with the reporter; no response-time
SLA or bounty is promised.

## Safe research and contributions

Use your own local/development installation and test accounts. Authorization to
contribute code does not authorize access to another person's data or testing
against production, email providers, social accounts or wallets. Do not send
real emails, trigger paid inference, change live schedules or replay uncertain
operations to demonstrate a bug.

Private keys, OAuth grants, bot tokens, webhook secrets, production database
exports and private moderation logs must stay out of Git, issue attachments,
model context and screenshots. If a real secret is exposed, revoke or rotate it
with its owner; deleting a file does not remove it from Git history.

## Security boundaries contributors must preserve

- Server-side authentication, ownership, scopes and current visibility on every
  protected read/write. Public Convex functions are directly callable.
- Backend-generated mailbox capabilities and private, short-lived account links.
- Streaming request limits, destination allowlists and signature verification.
- Owner-only inspection tools without model-controlled write authority.
- Shared agent budgets, rate limits, topic gates, durable delivery claims and
  non-replay holds for uncertain inference or sends.
- Private conversation isolation and exclusion of moderation logs from agents.
- Disabled auth/provider cutovers until their separate verification is complete.

Run the checks in [CONTRIBUTING.md](CONTRIBUTING.md). Pin external actions and
images, audit every independent lockfile, and document any upstream limitation
accurately. Do not suppress a security check solely to get a passing build.
