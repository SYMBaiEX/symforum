# Convex usage optimization

This release addresses the production read/write hotspots identified from
`bunx convex insights --prod`, production logs, and bounded production data
sampling on 2026-08-17.

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
  `@convex-dev/aggregate` after a migration-safe backfill.
- Newsletter archive lists use compact issue digests and never read full issue
  bodies after the digest backfill completes.

## Production migration order

Deploy the Convex functions first. The new reads retain legacy fallbacks until
their migration status is marked complete.

Run each backfill until it returns `done: true`, passing the returned cursor to
the next call when present:

```sh
bunx convex run contentAggregates:backfillContentAggregates '{"phase":"interactions"}' --prod
bunx convex run contentAggregates:backfillContentAggregates '{"phase":"comments"}' --prod
bunx convex run newsletterDigests:backfillNewsletterIssueDigests '{}' --prod
bunx convex run evidenceWebhooks:backfillSubscriptionTargets '{}' --prod
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
