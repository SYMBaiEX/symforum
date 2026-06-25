import { cronJobs } from "convex/server";
import { makeFunctionReference } from "convex/server";

const crons = cronJobs();

const refreshTopStoriesRef = makeFunctionReference<
  "action",
  { limit?: number },
  unknown
>("news:refreshTopStories");

const runDailyNewsletterRef = makeFunctionReference<
  "action",
  {
    runDate?: string;
    force?: boolean;
    sendEnabled?: boolean;
    testMode?: boolean;
    maxIndexedArticles?: number;
    maxNewsletterStories?: number;
    mode?: "cron" | "manual" | "test";
  },
  unknown
>("dailyNewsletter:runDailyNewsletter");

crons.cron("refresh Hacker News snapshot", "0 11 * * *", refreshTopStoriesRef, {
  limit: 40,
});
crons.cron(
  "send daily SYMBaiEX newsletter",
  "15 12 * * *",
  runDailyNewsletterRef,
  {},
);

export default crons;
