# Overnight release log — October 31, 2026

This is an append-only public-source delivery log. Keep credentials, private
operations, job/hold records and infrastructure binding metadata out of it.

## Baseline

- PR #253 merged: `860e999b9d8a2ae7b942ffbabee1b466cc1e0094`.
- Dependency remediation and progressive feed restoration are released.
- A bounded signed-out live check showed 24 Feed posts, then restored all 24
  after ordinary Boards → Feed navigation. The test browser was closed.
- This overnight pass has not yet shipped an additional feature batch.

## Batch 1 — in progress

- Planning: four independent source audits and a validated dependency inventory.
- Selected source work: private submission editing and dirty-settings protection.
- Implementation, review, final tests, merge and live rollout are separate gates.

## Batch 1 qualification — 08:15 UTC

- Planning PR #254 merged: 240 source-backed tasks and 53 acyclic dependency links.
- Qualified source: account-local settings drafts, safe private deliverable editing
  and explicit conflict recovery, reversible per-threshold watch edits, full-price
  precision and associated errors, omission-safe concurrent updates, token-logo
  source recovery, motion-aware reply focus, and retained confirmed attachments.
- Independent reviews caught and closed stale-write, canonicalization,
  subscription-ordering, sync-recovery and unknown-upload-copy issues. Existing
  financial and authorization paths are unchanged.
- Final integrated local verification: 4,296 unit/backend tests and 274 isolated
  browser checks pass; application and Convex types, all five app builds, native
  parity, unsuppressed dependency audits and secret-scanner controls pass.
- ESLint has zero errors and three unchanged existing warnings. The first unit
  attempt hit local permission restrictions and missing locked worker test
  dependencies; the complete rerun passed after correcting only the test setup.
- No Convex/worker deployment, payment, model call, publication, replay or hold
  change is part of this frontend batch. Merge and actual live verification remain
  separate, pending gates; none of these tasks is marked deployed yet.

## Next candidates

- Shareable community section URLs and scoped sign-in return are in independent
  review. A compact-terminal mint/remount issue was found and is being corrected
  before integration; that candidate is not in batch 1.
- A bounded bounty status-filter index fix is source-tested and reviewed. Its
  backend activation requires a separate production approval and backfill check;
  it is not activated by this website release.
- Upload callback fencing covers observable existing route, token, acting-profile,
  permissions and mount changes. Stronger synchronous owner-context detection
  remains a separate acceptance item; no new auth query was added.
