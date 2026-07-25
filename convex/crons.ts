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

export default crons;
