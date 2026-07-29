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
crons.interval(
  "cleanup expired forum attachment uploads",
  { hours: 1 },
  internal.forum.cleanupForumAttachmentStorage,
  {},
);

const sukiForumPostSchedules = [
  "5 12 * * *",
  "35 13 * * *",
  "5 15 * * *",
  "35 16 * * *",
  "5 18 * * *",
  "35 19 * * *",
  "5 21 * * *",
  "35 22 * * *",
  "5 0 * * *",
  "5 2 * * *",
] as const;

sukiForumPostSchedules.forEach((schedule, slot) => {
  crons.cron(
    `Suki forum post ${slot + 1}`,
    schedule,
    internal.sukiForumAgent.runDailySlot,
    { slot },
  );
});

crons.interval(
  "Suki relevant forum replies",
  { minutes: 10 },
  internal.sukiForumReplyAgent.runReplySweep,
  {},
);

crons.cron(
  "cleanup Suki caches",
  "25 6 * * *",
  internal.sukiForumAgentData.cleanupExpiredResearchCache,
  {},
);

export default crons;
