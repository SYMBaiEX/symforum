# Convex usage optimization

## September 22 projection and lifecycle pass

This release removes the remaining large-document reads from common public
paths and makes the corresponding compact projections lifecycle-safe:

- Public post lists use `postDigests`, so article bodies are not read merely to
  render cards. Featured-post selection keeps the existing newest-50 contract.
- Newsletter click routing is stored in the compact issue digest. Engagement
  deduplication uses one exact compound-index lookup instead of overlapping
  scans of the engagement table.
- Universal search reads one bounded compact projection across evidence, blog,
  newsletter, news, and forum content instead of loading hundreds of full
  source records. Every source writer updates the projection transactionally;
  visibility-policy changes invalidate the projection and start a resumable
  rebuild. It remains on the live fallback until its forum-search dependency is
  complete, and full-document migration pages have both row and byte ceilings.
- News projections retain their exact story and snapshot provenance. Search
  rejects removed stories and running or failed snapshots immediately, while
  bounded reconciliation repairs the compact index in the background.
- Forum search performs one bounded point-in-time pass. Route lookup and agent
  duplicate-title checks use compact projections, and exact view counters are
  isolated from subscriber-facing thread rows. Thread/search counters update at
  view 1 and then every 25 accepted views.
- First-party forum evidence is dirty-driven. Publication, edits, moderation,
  moves, category access changes, quality decisions, and deletions enqueue one
  generation-guarded item. A resumable reconciliation covers historical and
  orphaned records. Public reads fail closed while retraction is pending, and
  claim retraction continues in bounded pages after the owning document is
  hidden. Queue row identity plus generation fences stale workers, including a
  delete-and-recreate ABA case, before publication, retraction, or acknowledgement.
- Research jobs, exports, and retained dataset snapshots carry the current
  publication epoch. Restrictive source or record changes advance that epoch,
  so previously generated artifacts fail closed until regenerated against the
  current visibility policy.
- Webhook attempts acquire a lease only when the delivery action actually
  starts. Scheduler delay no longer consumes retry attempts.
- The analytics write limiter keeps the existing global budget but uses three
  contention shards, reducing optimistic-concurrency retries under bursts.

The existing-table indexes added here were measured before rollout: 5,143
newsletter engagement rows and 642 rows in each affected forum projection
table. They are intentionally enabled in the release rather than staged; these
are bounded, small backfills, while staged indexes cannot be queried by the new
functions until a second schema deploy.

### One-time production rollout

Deploy functions first. These reads retain their legacy fallbacks until the
matching marker is complete. Start each migration once; it stores its own
cursor and schedules bounded continuations:

```sh
bunx convex run postDigests:backfillPostDigests '{}' --deployment strong-bee-384
bunx convex run newsletterDigests:backfillNewsletterIssueDigests '{}' --deployment strong-bee-384
bunx convex run universalSearchProjection:backfill '{}' --deployment strong-bee-384
bunx convex run evidenceFirstParty:requestHistoricalReconciliation '{}' --deployment strong-bee-384
bunx convex run evidenceFirstParty:syncForumResearch '{}' --deployment strong-bee-384
```

Do not loop these commands from cron. Each migration persists progress and
self-schedules; the evidence sync queue is then maintained by writer hooks and
the existing low-frequency safety job.

## September 22 read-cost follow-up

The bounded production sample preceding this release contained about 18 MB of
database reads over 38 minutes. `forum:search` accounted for 11.67 MB and
`forum:listCategories` for 2.05 MB. This is an execution sample, not a monthly
bill or proof that every request originated from an agent.

- Opening a thread no longer starts an automatic related-search subscription.
  The explicit discovery link opens the existing point-in-time search page;
  it does not prefetch a search on hover or viewport entry.
- Relevance searches start with the requested candidate count and expand only
  when visibility/filtering requires it. The existing hard caps, private-board
  and ancestor checks, and advanced-sort scans remain. Reply hydration dedupes
  thread IDs before loading their compact projections.
- Board navigation reads editorial digests and projected last-post numbers.
  Missing legacy projections retain the original read/position fallback.
- Recording a view no longer changes a thread's content timestamp. First-party
  evidence hashes include content, canonical location, quality, and provenance,
  not engagement timestamps. Strict content-hash matching retains changes to
  metadata and content reversions as real versions.
- First-party enrichment commits one document and its provenance atomically.
  A small content-keyed checkpoint skips completed unchanged work. A failed
  transaction cannot leave a completion marker or a half-enriched version.
  The four-hour bounded reconciliation of up to 100 research records remains;
  this is incremental enrichment, not a claim that source discovery reads zero
  rows or that all historical research is backfilled.
- Webhook delivery and semantic-budget leases schedule recovery at expiry.
  Generation/terminal-state checks make old wake-ups harmless. Crashed webhook
  attempts consume retry budget rather than retrying forever.
- Watchlist outbox inserts schedule bounded dispatch, which continues while a
  batch is full. Webhook, watchlist, and semantic recovery retain hourly safety
  sweeps instead of five-minute polling. Their watchdog thresholds follow the
  new cadence. Research generation, ingestion, and health canaries are unchanged.
- Completed search-projection and embedding migrations no longer have recurring
  cron jobs. On a fresh deployment, an operator starts them once; they persist
  progress and schedule bounded continuations themselves:

```sh
bunx convex run forumSearchProjection:backfill '{}' --deployment strong-bee-384
bunx convex run forumAgentMemory:backfillForumMemory '{}' --deployment strong-bee-384
```

Do not rerun these on production merely to measure costs. Both migrations were
already complete there before this release. The new first-party checkpoint
table needs no backfill: the next normal synchronization establishes checkpoints
transactionally. Existing first-party research may receive one content-keyed
version when transitioning from the older timestamp-based fingerprint.

The three recovery cron schedules drop from 864 to 72 wake-ups per day, plus
145 eliminated migration cron wake-ups. Actual work still schedules recovery
and continuations, so these are idle-schedule reductions, not promised billing
savings. Verify database I/O and Search Query-GB separately over a full day in
the Convex dashboard; a low response size does not establish low database cost.

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
  and stays below 0.5 MB of database reads for a normal page. The first
  production measurement after the migration was 417,452 bytes, down from the
  5.38 MB sampled baseline (about a 92% reduction).
