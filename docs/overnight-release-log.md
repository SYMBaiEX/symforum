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
