import { cronJobs } from "convex/server";
import { makeFunctionReference } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

const refreshTopStoriesRef = makeFunctionReference<
  "action",
  { limit?: number },
  unknown
>("news:refreshTopStories");

const checkDailyNewsletterScheduleRef = makeFunctionReference<
  "action",
  Record<string, never>,
  unknown
>("dailyNewsletter:checkDailyNewsletterSchedule");

const refreshPortfolioMetricsRef = makeFunctionReference<
  "action",
  { source?: "cron" },
  unknown
>("githubPortfolio:refreshPortfolioMetrics");

crons.cron("refresh Hacker News snapshot", "0 11 * * *", refreshTopStoriesRef, {
  limit: 40,
});
crons.cron(
  "refresh GitHub portfolio metrics",
  "0 */6 * * *",
  refreshPortfolioMetricsRef,
  { source: "cron" },
);
crons.cron(
  "check daily SYMBaiEX newsletter schedule",
  "*/15 * * * *",
  checkDailyNewsletterScheduleRef,
  {},
);
crons.interval(
  "cleanup expired forum attachment uploads",
  { hours: 1 },
  internal.forum.cleanupForumAttachmentStorage,
  {},
);

export default crons;
