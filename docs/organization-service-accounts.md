# Organizations and service accounts foundation

Status: backend foundation, disabled from public monetization surfaces  
Owner: PLAT-15  
Data authority: Convex

## What this foundation provides

The organization model is intentionally separate from the site-wide
`users.role` field. A human may belong to several organizations with one of
four tenant-local roles:

- `owner`: the sole owner; controls budgets, roles, and ownership transfer.
- `admin`: manages projects, non-owner members, invites, and service accounts.
- `developer`: reads tenant configuration and may leave the organization.
- `auditor`: reads members, projects, budgets, usage, and audit history.

Each organization owns projects. Projects declare the exact SYMBaiEX agent
scopes they permit. A service account binds one existing, owner-enrolled
Ed25519 agent identity to exactly one project and narrows its scopes again.
Service accounts do not mint passwords, bearer API keys, private keys, or
reusable administrator credentials.

The current public agent/API manifest does not advertise organizations,
service accounts, organization usage, or payment acceptance. This code does
not contact a payment provider and cannot move money. It is an authorization,
budget, and immutable-usage foundation for a later reviewed rollout.

## Security invariants

All organization functions derive the caller from Convex Auth on the server.
No mutation accepts an actor, owner, or organization principal from a request.
User and agent IDs accepted as arguments identify a target only.

- Organization reads require an active membership in that exact organization.
- Administrative writes require the authenticated member's tenant-local role.
- Organization management requires a human account; enrolled agents cannot
  become members or create organizations.
- Exactly one active owner is required for role and ownership transitions.
  The owner cannot be removed or demoted; ownership moves atomically to an
  existing active member and the prior owner becomes an admin.
- Admins cannot create, change, remove, or invite other admins. Those actions
  are owner-only.
- A service account may bind only an active Ed25519 agent owned by the human
  creating the binding. The requested scopes must be a subset of the project,
  agent identity, and agent-user scopes.
- Agent-side usage selects no tenant identifiers. The authenticated agent is
  resolved to its single active service-account record, which supplies the
  organization and project IDs.
- Usage rechecks service-account status, global agent revocation, agent owner,
  project status, organization status, and every scope layer on each charge.
- Removing a human member revokes every active service account they own in the
  organization in the same transaction.
- Per-service-account idempotency keys prevent a retried request from spending
  twice. Reusing a key with different charge data fails closed.
- The current month's shared organization budget is updated transactionally.
  A charge cannot exceed the USD micro-unit limit, and the limit cannot be
  reduced below recorded spend.
- Collection reads use tenant-prefixed indexes and hard result caps. No
  organization function scans an unbounded table.

## Tables

| Table                         | Purpose                                              |
| ----------------------------- | ---------------------------------------------------- |
| `organizations`               | Tenant identity and lifecycle.                       |
| `organizationMembers`         | One tenant-local role per human user.                |
| `organizationInvites`         | Target-user invites with expiry and terminal status. |
| `organizationProjects`        | Project boundary and allowed agent scopes.           |
| `organizationServiceAccounts` | One Ed25519 agent bound to one project.              |
| `organizationBudgets`         | Shared monthly USD micro-unit limit and spend.       |
| `organizationUsageLedger`     | Append-only, idempotent service-account charges.     |
| `organizationAuditRecords`    | Append-only management event history.                |

Management audit records cover organization creation, budget changes, invite
creation/acceptance/revocation, role transitions, ownership transfers, member
removal, project creation/scope narrowing, and service-account
creation/revocation. Usage has its own immutable ledger and is not duplicated
into the management audit stream.

## Operator workflow

This foundation has no client-facing enrollment UI yet. Do not instruct a
customer to call Convex functions or disclose a Convex deployment URL.

1. A human enrolls a durable Ed25519 agent through the existing public agent
   enrollment flow. The private key remains on the agent host.
2. After a reviewed first-party organization UI/API exists, the organization
   owner creates an organization and project, selects the least project scopes,
   and binds one of their enrolled agents.
3. The owner sets the current monthly budget. A zero or missing budget keeps
   organization spend disabled.
4. The service account records idempotent usage only through a first-party API
   operation that has independently completed its work and knows the exact
   billable amount.
5. Owners and auditors reconcile the budget against the immutable usage ledger.

## Incident and recovery runbook

### Compromised agent or service account

1. Revoke the global Ed25519 agent identity through the existing owner console.
   Organization usage fails immediately even if the tenant service-account row
   is still marked active.
2. Revoke the organization service account as defense in depth.
3. Inspect organization usage and management audit records for the affected
   project and time range.
4. Rotate the agent key only after generating its replacement locally. Never
   paste private key material or session tokens into a prompt, ticket, or log.

### Member departure

Remove the member through the organization mutation. The transaction marks the
membership removed and revokes every active service account that member owns.
The sole owner must transfer ownership before departure.

### Owner loss

There is deliberately no public owner-recovery or administrator bypass. A
future recovery path must be an internal, audited, identity-verified operator
procedure. Until that procedure is designed, preserve at least one accessible
owner account and do not expose organizations as a paid production product.

### Budget incident

Set the current monthly limit to the already-recorded spend to stop additional
usage without rewriting history. A lower limit is rejected. Revoking the
affected service accounts is the stronger emergency stop.

## Activation checklist

Keep payment and organization capabilities disabled in machine-readable public
manifests until all of the following are complete:

- first-party organization UI and API routes use the same Convex functions;
- authenticated production tests cover owner, admin, developer, auditor,
  service account, revoked service account, outsider, and unauthenticated paths;
- an operator-only owner recovery procedure exists and is exercised;
- usage-unit policy, refunds, taxes, reconciliation, and dispute handling are
  approved;
- a real payment provider is provisioned and its signed webhook reconciliation
  is verified in test mode;
- logs and public responses are checked for membership, billing, token, and key
  leakage;
- the public API and SDK contracts are versioned before they advertise the
  feature.

Only after this checklist passes should the lead update the agent manifest or
claim payment/organization support publicly.
