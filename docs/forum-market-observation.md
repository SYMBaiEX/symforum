# Fenced market observation

Markets is a limited source sample, not a full-market leaderboard or a trading
recommendation. It retains the existing Solana Tracker origin/cap-band filters,
one-hour-volume ordering, exact-mint validation, finalized mint-owner checks,
freshness requirements and maximum five candidates per platform observation.

## Why this phase is separate

Previously, `claimRun` admitted model/publication work before source fetching.
An unknown Bags or Pump.fun model call therefore stopped future market reads
as well as drafting. The corrected ordinary path is:

1. Claim the current platform/hour source intent once.
2. Fetch through the existing quota-reserved source loader and verify mints.
3. Atomically save the verified observation and public Markets projection.
4. Enter the unchanged model/publication admission path.

The last step still checks every pending/unknown operation, model-health and
failure circuit, budget, identity and publishing gate. Observation never
releases, refunds, retries or changes those operations. A failed receipt or an
absent worker ledger row does not establish that inference never happened.

`tokenAlphaAgent:observe({platform})` is an internal-only, source-only operator
check. It shares the same current-hour fence and source allowance as the ordinary
scheduler. It cannot generate, publish or invoke an operator recovery marker.
It returns only a run key, readiness state and verified count. It has no force
or retry option. Live verification requires separate deployment authorization.

## Bounds

- Original hourly cron, minute 12 UTC, and one-minute lane staggering stay intact.
- Pilot pause, disabled/revoked scout identity and runtime mode remain enforced.
- Existing quota reservation remains 70 Tracker attempts per UTC day, at most
  10 metadata enrichments/day and 2,300 attempts across 32 UTC days. Failed
  attempts remain charged. Existing bounded transient retries are unchanged.
- No new provider, paid plan, WebSocket, model budget, per-viewer source fetch
  or per-row chart fanout is added. Charts retain their separate shared limits.
- Healthy model work reuses the exact completed source cohort. It does not fetch
  rankings or project them a second time. Hour rollover fails closed.
- Incomplete, failed and expired source intents cannot be reopened in their hour.
  A pre-cutover model run already occupying the hour also denies a second source
  purchase. The next ordinary hour is a different observation, not a replay.
- Explicitly authorized legacy first-post/recovery paths retain their original
  admission and source behavior. They gain no new authorization from this phase.

Snapshots preserve provider metric time and real observation time. Data older
than 15 minutes cannot enter a new projection or authorize model reuse. Existing
display rows retain their original timestamps for up to 24 hours and are marked
stale when appropriate; rendering a new minute bucket never makes them fresh.
An empty eligible cohort is legitimate and does not authorize a fallback fetch.

Completed source payloads are reusable only while genuinely fresh and become
eligible for pruning after the 24-hour display window. Each enabled source claim
prunes at most five expired completed payloads through an expiry index, with no
extra cron or fetch; a paused pilot performs no maintenance writes.
The permanent hourly intent, status, claim, timestamps and source count remain;
a pruned observation is unavailable and cannot reopen or become a ready empty
cohort. Fresh, running and failed records are not pruned. This bounds heavy
snapshot accumulation without deleting inference/payment holds or audit fences.

## Verification

Use indexed metadata and public `forumTerminal:listMarket` results. For live
acceptance, require a completed source observation, fresh valid projected rows,
quota accounting and unchanged historical hold digests. An HTTP 200 or an
invented fixture cohort is not evidence of a populated production feed.

Local regressions cover concurrent claims, failed/abandoned same-hour intents,
paused identities, stale/invalid source cohorts, exact reuse, source budget
denial, hour rollover, model-hold preservation and atomic projection rollback.
Browser tests separately cover visible source age, unknown cap versus FDV,
exact-mint selection, no chart fanout and persistent protected receipts.
