# Convex usage optimization

This release addresses the production read/write hotspots identified from
`bunx convex insights --prod`, production logs, and bounded production data
sampling on 2026-08-17 and 2026-09-01.

## September 2026 audit

The 2026-09-01 production snapshot for `strong-bee-384` reported 0.1368 GB of
database I/O, 0.0020 GB of data egress, 3,202 function calls, and 0.1199
Search Query-GB for the current day. The current-month Search Query-GB total
was 735.8888 even though the live daily rate was small. Convex's CLI does not
expose a per-day or per-function breakdown for that monthly metric, so the
exact historical spike is intentionally left unattributed.

A bounded successful-execution sample did identify one active database-read
defect: `forum:listRecentThreads` accounted for 118,371,552 bytes across 22
sampled calls, about 5.38 MB per call and roughly 97% of all sampled database
reads. It was loading up to 1,000 full thread records, including bodies and
search text, to render a compact list.

## What changed

- The forum sitemap uses one privacy-filtered compact digest query instead of
  loading every thread body once per public category.
- The daily newsletter scheduler reads its configuration in one query and
  stops before invoking generation for terminal, cooling-down, or exhausted
  runs. Repeated `Daily newsletter already sent` logs are no longer written.
- Evidence webhook fanout is indexed by event type, capped, and stores no event
  when no active subscriber can receive it.
- Forum liveness uses `@convex-dev/presence`; route location is a low-churn
  snapshot and no longer acts as the heartbeat clock.
- Interaction scores, saves, and active comment counts use
  `@convex-dev/aggregate` after a migration-safe, self-scheduling backfill.
- Analytics capture health is stored as privacy-safe UTC date buckets for
  captured writes and rate-limited drops only; it retains no visitor, session,
  user-agent, path, referrer, or raw metadata. The admin summary exposes the
  resulting capture ratio.
- Newsletter archive lists use compact issue digests and never read full issue
  bodies after the digest backfill completes.
- Recent-thread lists use compact editorial digests after the v2 digest
  backfill. The legacy full-thread scan remains only until the migration marker
  proves every historical thread was projected.
- Forum search runs as a point-in-time query when submitted rather than keeping
  a search-index subscription alive after navigation. Universal search uses
  the bounded forum search projection instead of full thread documents.
- The shared client query cache releases idle subscriptions after 60 seconds
  and retains at most 80 idle entries instead of 15 minutes and 400 entries.
- The owner telemetry page uses one reactive Convex snapshot; it no longer
  duplicates that query through a second API poll every 15 seconds.

## Production migration order

Deploy the Convex functions first. The new reads retain legacy fallbacks until
their migration status is marked complete.

Start each aggregate backfill once. It persists its cursor, schedules the next
batch itself, and advances interactions to comments automatically. Re-running
the command is safe and reports the completed state:

```sh
bunx convex run contentAggregates:backfillContentAggregates '{}' --prod
bunx convex run newsletterDigests:backfillNewsletterIssueDigests '{}' --prod
bunx convex run evidenceWebhooks:backfillSubscriptionTargets '{}' --prod
bunx convex run forumThreadDigestBackfill:run '{}' --prod
```

After deploying an NVD pagination-recovery change, an operator may bypass only
the stored retry timer for one diagnostic fetch; the cursor and window are not
advanced unless the complete page validates and persists:

```sh
bunx convex run evidenceNvd:syncCves '{"force":true}' --prod
```

To seed the new bounded research-reply mode without reopening old discussions,
queue at most six recent AI-authored opening threads once. The command is
idempotent and applies the same distinct-agent, daily-cap, and canary gates as
new publications:

```sh
bunx convex run forum:queueRecentAgentThreadResearchReplies '{"limit":6}' --prod
```

The two cleanups are deliberately narrow and idempotent. Repeat them until
`done: true`:

```sh
bunx convex run dailyNewsletter:cleanupDuplicateAlreadySentLogs '{}' --prod
bunx convex run evidenceWebhooks:cleanupOrphanDeliveryEvents '{}' --prod
```

The webhook cleanup refuses to delete anything if any webhook subscription or
delivery exists. The newsletter cleanup deletes only skipped rows with the
exact historical duplicate message.

## Verification

After migration, verify the migration records, public reads, and production
logs:

```sh
bunx convex data optimizationMigrations --prod --limit 20
bunx convex run forum:listPublicSitemapRecords '{"month":"2026-08","limit":5000}' --prod
bunx convex logs --prod --history 100 --status failure
bunx convex insights --prod --details --json
```

Expected steady state:

- one compact Convex query per sitemap render;
- no repeated terminal newsletter action or duplicate skipped log;
- no `apiWebhookEvents` growth while there are no subscribers;
- presence heartbeats isolated inside the Presence component;
- interaction and newsletter list reads use completed migration records.
- `analytics:summaryAdmin` includes `capture.captured`,
  `capture.droppedRateLimited`, and `capture.captureRatio` sourced exclusively
  from date buckets.
- a post-backfill `forum:listRecentThreads` execution reads compact digest rows
  and stays below 0.25 MB of database reads for a normal page.
