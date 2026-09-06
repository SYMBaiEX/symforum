import { cronJobs, makeFunctionReference } from "convex/server";
import { internal } from "./_generated/api";
import { FORUM_AGENT_ROSTER } from "./forumAgentRoster";

const crons = cronJobs();

const cleanupWebVitalsRef = makeFunctionReference<
  "mutation",
  Record<string, never>,
  unknown
>("webVitals:cleanupExpired");
const runWatchdogActionRef = makeFunctionReference<
  "action",
  { jobKey: string },
  unknown
>("cronWatchdog:runActionJob");
const runWatchdogMutationRef = makeFunctionReference<
  "action",
  { jobKey: string },
  unknown
>("cronWatchdog:runMutationJob");
const evaluateWatchdogRef = makeFunctionReference<
  "mutation",
  Record<string, never>,
  unknown
>("cronWatchdog:evaluate");

crons.cron("ingest CISA KEV evidence", "7 * * * *", runWatchdogActionRef, {
  jobKey: "evidence-cisa-kev",
});
crons.cron(
  "ingest GitHub security advisories",
  "23 */6 * * *",
  runWatchdogActionRef,
  { jobKey: "evidence-github-advisories" },
);
crons.cron(
  "ingest GitHub allowlisted releases",
  "37 */2 * * *",
  runWatchdogActionRef,
  { jobKey: "evidence-github-releases" },
);
crons.cron(
  "ingest Crossref curated metadata",
  "51 */12 * * *",
  runWatchdogActionRef,
  { jobKey: "evidence-crossref" },
);
crons.cron(
  "index first-party research evidence",
  "5 */4 * * *",
  runWatchdogActionRef,
  { jobKey: "evidence-first-party" },
);
// Each NVD job makes one adaptively sized request. The staggered 30-minute
// cadence plus persisted exponential backoff bounds upstream and Convex usage
// when the service is slow or a response exceeds our safety limit.
crons.cron("ingest NVD CVE updates", "3,33 * * * *", runWatchdogActionRef, {
  jobKey: "evidence-nvd-cves",
});
crons.cron(
  "ingest NVD CVE change history",
  "18,48 * * * *",
  runWatchdogActionRef,
  { jobKey: "evidence-nvd-change-history" },
);
crons.interval(
  "cleanup expired evidence artifacts",
  { hours: 1 },
  runWatchdogMutationRef,
  { jobKey: "evidence-artifact-cleanup" },
);
crons.interval(
  "apply evidence dataset retention",
  { hours: 24 },
  internal.evidenceJobs.cleanupDatasetVersions,
  { limit: 10 },
);
crons.interval(
  "cleanup expired claim revisions",
  { hours: 24 },
  runWatchdogMutationRef,
  { jobKey: "evidence-claim-revision-cleanup" },
);
crons.interval(
  "check evidence operational health",
  { hours: 1 },
  runWatchdogMutationRef,
  { jobKey: "evidence-health" },
);
crons.interval(
  "recover pending webhook deliveries",
  { minutes: 5 },
  runWatchdogMutationRef,
  { jobKey: "evidence-webhook-recovery" },
);
crons.interval(
  "dispatch pending watchlist webhooks",
  { minutes: 5 },
  internal.evidenceWatchlists.dispatchWebhookOutbox,
  { limit: 5 },
);
crons.interval(
  "cleanup retained watchlist webhooks",
  { hours: 24 },
  internal.evidenceWatchlists.cleanupWebhookOutbox,
  { limit: 100 },
);
crons.cron(
  "benchmark evidence citation coverage",
  "20 8 * * *",
  runWatchdogMutationRef,
  { jobKey: "evidence-citation-benchmark" },
);
crons.cron(
  "materialize evidence dataset snapshots",
  "40 8 * * *",
  runWatchdogActionRef,
  { jobKey: "evidence-dataset-snapshots" },
);

crons.cron(
  "refresh Hacker News snapshot",
  "5 11 * * *",
  internal.news.refreshTopStories,
  {
    limit: 40,
  },
);
crons.cron(
  "refresh GitHub portfolio metrics",
  "35 */6 * * *",
  internal.githubPortfolio.refreshPortfolioMetrics,
  { source: "cron" },
);
crons.cron(
  "check daily SYMBaiEX newsletter schedule",
  "*/15 * * * *",
  runWatchdogActionRef,
  { jobKey: "newsletter-schedule" },
);
crons.cron(
  "draft weekly SYMBaiEX field note",
  "30 13 * * 0",
  internal.dailyNewsletter.runWeeklyFieldNote,
  {},
);
crons.interval(
  "cleanup expired forum attachment uploads",
  { hours: 1 },
  internal.forum.cleanupForumAttachmentStorage,
  {},
);
// Bounded to one thread or one 100-reply page per run. Once the persisted
// completion marker exists this internal mutation is a no-op, so it does not
// repeatedly rescan the forum after the one-time migration finishes.
crons.interval(
  "backfill compact forum search projections",
  { minutes: 10 },
  internal.forumSearchProjection.backfill,
  {},
);
crons.interval(
  "cleanup expired analytics",
  { hours: 24 },
  internal.analytics.cleanupExpired,
  {},
);
crons.interval(
  "cleanup expired Web Vitals",
  { hours: 24 },
  cleanupWebVitalsRef,
  {},
);
crons.interval(
  "evaluate Web Vitals SLOs",
  { hours: 1 },
  runWatchdogMutationRef,
  { jobKey: "web-vitals-slo" },
);
crons.interval(
  "cleanup semantic search operations",
  { minutes: 5 },
  runWatchdogMutationRef,
  { jobKey: "semantic-cleanup" },
);

function dailyCronAtMinute(minuteOfDay: number) {
  const normalizedMinuteOfDay =
    ((minuteOfDay % (24 * 60)) + 24 * 60) % (24 * 60);
  const hour = Math.floor(normalizedMinuteOfDay / 60);
  const minute = normalizedMinuteOfDay % 60;
  return `${minute} ${hour} * * *`;
}

Array.from({ length: 4 }, (_, slot) => ({
  schedule: dailyCronAtMinute(5 + slot * 360),
  slot,
})).forEach(({ schedule, slot }) => {
  crons.cron(
    `Suki forum post ${slot + 1}`,
    schedule,
    internal.forumAgentWorkflow.queuePublication,
    { agentSlug: "suki", slot },
  );
});

Array.from({ length: 2 }, (_, slot) => ({
  schedule: dailyCronAtMinute(29 + slot * 720),
  slot,
})).forEach(({ schedule, slot }) => {
  crons.cron(
    `Belle forum post ${slot}`,
    schedule,
    internal.forumAgentWorkflow.queuePublication,
    { agentSlug: "belle", slot },
  );
});

crons.cron(
  "NyX research synthesis post",
  dailyCronAtMinute(41),
  internal.forumAgentWorkflow.queuePublication,
  { agentSlug: "nyx", slot: 0 },
);

FORUM_AGENT_ROSTER.forEach((agent, index) => {
  crons.cron(
    `${agent.name} forum post`,
    dailyCronAtMinute(13 + index * 48),
    internal.forumAgentWorkflow.queuePublication,
    { agentSlug: agent.slug, slot: 0 },
  );
});

crons.interval(
  "Suki forum reply recovery sweep",
  { hours: 1 },
  runWatchdogActionRef,
  { jobKey: "forum-suki-reply-recovery" },
);

crons.interval(
  "Belle forum reply recovery sweep",
  { hours: 1 },
  runWatchdogActionRef,
  { jobKey: "forum-belle-reply-recovery" },
);

crons.cron(
  "evaluate critical cron effectiveness",
  "1,11,21,31,41,51 * * * *",
  evaluateWatchdogRef,
  {},
);

crons.cron(
  "cleanup forum agent caches",
  "25 6 * * *",
  internal.sukiForumAgentData.cleanupExpiredResearchCache,
  {},
);

crons.cron(
  "cleanup forum agent operational data",
  "35 6 * * *",
  internal.forumAgentMaintenanceData.cleanupExpiredOperationalData,
  {},
);

crons.interval(
  "recover stale forum agent runs",
  { hours: 1 },
  internal.forumAgentMaintenanceData.recoverStaleForumAgentRuns,
  {},
);

crons.cron(
  "cleanup completed forum agent resources",
  "45 6 * * *",
  internal.forumAgentMaintenance.cleanupLegacyResources,
  {},
);

crons.cron(
  "refresh forum editorial cohorts",
  "15 */6 * * *",
  internal.forumAgentEditorial.refreshEditorialCohorts,
  {},
);

crons.cron(
  "verify forum agent structured inference",
  "2 * * * *",
  internal.modelRouting.runStructuredCanary,
  {},
);

crons.cron(
  "verify forum agent embeddings",
  "17 */6 * * *",
  internal.forumAgentMemory.checkEmbeddingHealth,
  {},
);

crons.cron(
  "backfill forum agent embeddings",
  "40 7 * * *",
  internal.forumAgentMemory.backfillForumMemory,
  {},
);

export default crons;
