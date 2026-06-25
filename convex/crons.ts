import { cronJobs } from "convex/server";
import { makeFunctionReference } from "convex/server";

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

crons.cron("refresh Hacker News snapshot", "0 11 * * *", refreshTopStoriesRef, {
  limit: 40,
});
crons.cron(
  "check daily SYMBaiEX newsletter schedule",
  "*/15 * * * *",
  checkDailyNewsletterScheduleRef,
  {},
);

export default crons;
