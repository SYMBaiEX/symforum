# Critical cron watchdog

`CRON_WATCHDOG_ENABLED=true` routes the monitored jobs through
`convex/cronWatchdog.ts`. Each execution writes a current heartbeat and one
bounded run summary; the five-minute evaluator materializes healthy, failed,
stale, or missing state and maintains deduplicated operational logs. With the
flag unset or false, wrappers do not execute their target jobs and the
evaluator does not report the watchdog as healthy.

## Monitored critical jobs

- Evidence adapters: CISA KEV, GitHub advisories and releases, Crossref,
  first-party research, NVD CVEs, and NVD change history.
- Evidence artifact and claim-revision cleanup, evidence health, and the daily
  citation benchmark.
- Semantic-search operation cleanup and the Web Vitals SLO evaluator.
- Suki and Belle forum reply-recovery sweeps.

The explicit staleness windows live beside their job keys in
`convex/cronWatchdog.ts`; they are intentionally longer than their scheduled
cadence to absorb ordinary scheduling delay while still detecting a missed
critical run.

## Intentionally unmonitored crons

This is not full cron coverage. The watchdog deliberately does not wrap:

- High-volume forum publication roster slots, including Suki, Belle, NyX, and
  the rotating roster. These enqueue workflow work with their own reservation,
  rate-limit, and publication-result records; a heartbeat per slot would add
  high-churn writes without establishing whether publication completed.
- Newsletter scheduling and weekly field-note generation. Their issue/send
  records already provide the source of truth for operator review.
- Analytics and Web Vitals retention cleanup, Hacker News and portfolio
  refreshes, forum attachment cleanup, search-projection backfill, editorial
  cohort refresh, model canary, embedding checks/backfill, webhook recovery,
  and forum-agent cache/resource cleanup. These are either non-critical,
  independently observable, one-time/bounded maintenance, or require a
  job-specific completion signal before being safely treated as effective.

## Expanding coverage

Before adding an omitted cron, define a bounded completion signal and a
staleness threshold that reflects its actual cadence and retry behavior. Add a
typed watchdog key, route the cron through the correct action or mutation
wrapper, include it in evaluator and access-control tests, and update this
runbook. Do not use the watchdog as a substitute for workflow, newsletter,
or publication domain records.
