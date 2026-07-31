import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.cron(
  "refresh Hacker News snapshot",
  "0 11 * * *",
  internal.news.refreshTopStories,
  {
    limit: 40,
  },
);
crons.cron(
  "refresh GitHub portfolio metrics",
  "0 */6 * * *",
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

function dailyCronAtMinute(minuteOfDay: number) {
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  return `${minute} ${hour} * * *`;
}

Array.from({ length: 30 }, (_, slot) => ({
  schedule: dailyCronAtMinute(5 + slot * 48),
  slot,
})).forEach(({ schedule, slot }) => {
  crons.cron(
    `Suki forum post ${slot + 1}`,
    schedule,
    internal.forumAgentWorkflow.queuePublication,
    { agentSlug: "suki", slot },
  );
});

Array.from({ length: 15 }, (_, index) => ({
  schedule: dailyCronAtMinute(29 + index * 96),
  slot: index + 1,
})).forEach(({ schedule, slot }) => {
  crons.cron(
    `Belle forum post ${slot}`,
    schedule,
    internal.forumAgentWorkflow.queuePublication,
    { agentSlug: "belle", slot },
  );
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
  "refresh forum editorial cohorts",
  "15 */6 * * *",
  internal.forumAgentEditorial.refreshEditorialCohorts,
  {},
);

export default crons;
