import { cronJobs, makeFunctionReference } from "convex/server";
import { internal } from "./_generated/api";
import { FORUM_AGENT_ROSTER } from "./forumAgentRoster";

const crons = cronJobs();

const syncCisaKevRef = makeFunctionReference<
  "action",
  Record<string, never>,
  unknown
>("evidenceIngestion:syncCisaKev");
const syncGithubAdvisoriesRef = makeFunctionReference<
  "action",
  Record<string, never>,
  unknown
>("evidenceIngestion:syncGithubAdvisories");
const syncGithubReleasesRef = makeFunctionReference<
  "action",
  Record<string, never>,
  unknown
>("evidenceIngestion:syncGithubReleases");
const syncCrossrefRef = makeFunctionReference<
  "action",
  Record<string, never>,
  unknown
>("evidenceIngestion:syncCrossref");
const syncFirstPartyResearchRef = makeFunctionReference<
  "action",
  Record<string, never>,
  unknown
>("evidenceFirstParty:sync");

crons.cron("ingest CISA KEV evidence", "7 * * * *", syncCisaKevRef, {});
crons.cron(
  "ingest GitHub security advisories",
  "23 */6 * * *",
  syncGithubAdvisoriesRef,
  {},
);
crons.cron(
  "ingest GitHub allowlisted releases",
  "37 */2 * * *",
  syncGithubReleasesRef,
  {},
);
crons.cron(
  "ingest Crossref curated metadata",
  "51 */12 * * *",
  syncCrossrefRef,
  {},
);
crons.cron(
  "index first-party research evidence",
  "5 8 * * *",
  syncFirstPartyResearchRef,
  {},
);
crons.interval(
  "cleanup expired evidence artifacts",
  { hours: 1 },
  internal.evidenceJobs.cleanupExpiredArtifacts,
  {},
);
crons.interval(
  "check evidence operational health",
  { hours: 1 },
  internal.evidenceHealth.check,
  {},
);
crons.cron(
  "benchmark evidence citation coverage",
  "20 8 * * *",
  internal.evidenceBenchmarks.runDailyCitationCoverage,
  {},
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
  internal.dailyNewsletter.checkDailyNewsletterSchedule,
  {},
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
crons.interval(
  "cleanup expired analytics",
  { hours: 24 },
  internal.analytics.cleanupExpired,
  {},
);

function dailyCronAtMinute(minuteOfDay: number) {
  const normalizedMinuteOfDay =
    ((minuteOfDay % (24 * 60)) + 24 * 60) % (24 * 60);
  const hour = Math.floor(normalizedMinuteOfDay / 60);
  const minute = normalizedMinuteOfDay % 60;
  return `${minute} ${hour} * * *`;
}

Array.from({ length: 24 }, (_, slot) => ({
  schedule: dailyCronAtMinute(5 + slot * 60),
  slot,
})).forEach(({ schedule, slot }) => {
  crons.cron(
    `Suki forum post ${slot + 1}`,
    schedule,
    internal.forumAgentWorkflow.queuePublication,
    { agentSlug: "suki", slot },
  );
});

Array.from({ length: 6 }, (_, index) => ({
  schedule: dailyCronAtMinute(29 + index * 240),
  slot: index + 1,
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
  [0, 1].forEach((slot) => {
    crons.cron(
      `${agent.name} forum post ${slot + 1}`,
      dailyCronAtMinute(13 + index * 48 + slot * 12 * 60),
      internal.forumAgentWorkflow.queuePublication,
      { agentSlug: agent.slug, slot },
    );
  });
});

crons.interval(
  "Suki forum reply recovery sweep",
  { hours: 1 },
  internal.sukiForumReplyAgent.runReplySweep,
  {},
);

crons.interval(
  "Belle forum reply recovery sweep",
  { hours: 1 },
  internal.sukiForumReplyAgent.runBelleReplySweep,
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
