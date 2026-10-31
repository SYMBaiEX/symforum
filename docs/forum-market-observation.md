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

## Independently checked display markets

The hourly source pipeline is healthy even when its retained rows are older
than the 15-minute freshness window. A completed empty cap-segment scan does
not change an older token's timestamp. Source observation, generation and
publication are different outcomes; neither a held model call nor an old
retained row alone establishes a failed source refresh.

An active Markets view can additionally request `forumTerminalRefresh:refresh`
with no arguments. This is a display-only read, not another scout run:

- One globally shared intent admits at most one batch per full ten minutes,
  measured from admission rather than rounded clock buckets. Two hundred
  simultaneous viewers coalesce to one transport. Closed/hidden/offline views
  do not request refreshes; there is no new background cron.
- The server selects at most 30 distinct retained, previously validated scout
  mints. It reads at most 30 recent rows per platform and interleaves them so a
  productive Pump.fun cohort cannot exclude the only eligible Bags.fm token.
  Clients cannot supply mints, URLs, filters or a force/retry flag.
- One fixed public DEX Screener Solana batch is requested, with a one-megabyte
  streaming ceiling, eight-second timeout, strict pool/base/quote binding and
  no redirect, fallback or automatic retry. Per-token pool candidates remain
  bounded to 100. Missing or ambiguous tokens produce unavailable fields.
- Each transport reserves one unit of the **existing** shared terminal100/day
  and commerce1000/day allowances before fetching. A stricter refresh-only
  48/day ceiling limits this feature to 48 of those terminal units. Existing
  chart, wallet and risk reads retain their original admission and costs;
  other traffic can still exhaust the shared allowances earlier.
- The ten-minute fence is saved before transport. A failed or abandoned read
  is not reopened after its short lease expires. Its allowance is not refunded.
  A later interval is a new read; an old writer cannot commit after its lease,
  admission interval or ownership has changed. Budget denial returns a capped
  state rather than buying another request.
  A shared-burst denial before any intent, daily reservation or transport is
  explicitly `deferred`; only that proven no-I/O state can try admission after
  its short server deadline instead of waiting for an admitted interval.

The single bounded display cache never writes scout snapshots, ingestion
timestamps, source ranks, alert baselines, model inputs, publication runs or
payment/inference holds. Original discovery time remains the 24-hour identity
allowlist anchor; checking a quote cannot keep an untracked token listed
forever. Eligibility is checked again when a batch completes.

Price, reported cap, FDV, liquidity, rolling-hour/24-hour volume and hourly
change have an independent `marketData.checkedAt` and DEX Screener pool link.
This timestamp means the response was retrieved and bound, not that a trade
occurred or an on-chain price was independently proven then. Holders and scout
evidence retain the original `metricsAsOf` and source link. No current holder
count is inferred from the refreshed price response. A newer scout observation
supersedes an older display overlay. Stale overlays remain dated; unavailable
tokens do not inherit old prices under a new checked timestamp.

Cap filters apply after merging a bounded sample of at most 60 retained rows,
so a refreshed token cannot remain under the wrong old scout cap band. Only
returned rows have discussion links hydrated. This is still sampled coverage,
not an exhaustive market query. Refreshing is demand- and budget-dependent,
not a promise of uninterrupted real-time or 24/7 data. All stale and unavailable
states remain explicit, and the 15-minute freshness threshold is unchanged.

Local tests additionally cover 200-viewer transport coalescing, all three
allowances, the ten-full-minute boundary, failed/expired lease fencing, source
fairness, exact cohort binding, missing fields, cap-band changes, holder/scout
provenance, expiry during transport and unchanged uncertain holds/alerts.
