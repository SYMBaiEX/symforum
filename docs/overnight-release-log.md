# Overnight release log — October 31, 2026

This is an append-only public-source delivery log. Keep credentials, private
operations, job/hold records and infrastructure binding metadata out of it.

## Baseline

- PR #253 merged: `860e999b9d8a2ae7b942ffbabee1b466cc1e0094`.
- Dependency remediation and progressive feed restoration are released.
- A bounded signed-out live check showed 24 Feed posts, then restored all 24
  after ordinary Boards → Feed navigation. The test browser was closed.
- At the start of this overnight pass, no additional feature batch had shipped.

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

## Batch 1 released; bounded backend correction released

- PR #255 merged at `a43ebdc63e5ee15166a39ff4ab423ed7aa0b3252`. All original
  website domains were verified on that exact release. Signed-out Feed and
  Community checks passed at desktop and phone sizes without overflow or page
  errors; the bounded deployment-error sample was empty. The test browser closed.
- The owner separately approved the bounty index correction. PR #256 merged at
  `9f807188f9948001464da15b0d9d1dd6efca2424`; all 4,301 unit/backend tests and both
  type checks passed. The reviewed deployment added the compound mint/status
  index; read-only index and public-query checks passed without creating records.
  The result cap remains 32. All original website domains were then verified at
  this newer commit, with an empty bounded error sample.
- Protected/authenticated flows were covered by isolated local regressions, not
  claimed as live wallet or payment acceptance. No keys, financial transitions,
  agent settings, budgets, schedules, limits, holds or publishing behavior changed.

## Batch 2 qualification — 08:54 UTC

- Source: shareable community sections, validated token/section redirects and
  receipt sign-in return; compact utility navigation follows the live selected
  token without replacing URL mint or remounting protected terminal controllers.
- Chart: actual candle count/range, semantic full UTC readings and source volume.
  The numeric transport does not identify volume units, so the UI explicitly says
  unit unknown. No new chart/provider request or freshness-policy change.
- Responsive: valid long affiliation roles wrap; community dialog close targets
  retain 44px; receipt dialogs initially focus a visible heading without changing
  payment handlers, focus trapping, Escape or opener return.
- Final parent qualification: 4,321 unit/backend tests, 307 isolated browser checks,
  both type checks, all five builds, native parity, unsuppressed dependency audits
  and security controls pass. Three existing lint warnings remain, zero errors.
- The first browser run exposed legacy mocks that incorrectly derived identity
  and sample data from changing URLs, plus a missing navigation-hook test export.
  Fixture controls now stay out-of-band; exact first-party return-link and private
  query assertions were strengthened. The complete browser rerun passed without
  production-code workarounds or skipped tests. The first audit attempt lacked
  registry access; its network-enabled, unsuppressed rerun passed all three graphs.
- Responsive zoom checks emulate a 200% CSS viewport/DPR setup; native browser
  zoom, physical touch, Safari and live assistive technology are not certified.
- Batch 2 remains tested, not yet merged/deployed at this entry. Local search
  within the already loaded recent project directory is the next isolated slice.
