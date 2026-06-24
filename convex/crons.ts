import { cronJobs } from "convex/server";
import { makeFunctionReference } from "convex/server";

const crons = cronJobs();

const refreshTopStoriesRef = makeFunctionReference<
  "action",
  Record<string, never>,
  unknown
>("news:refreshTopStories");

crons.cron("refresh Hacker News snapshot", "0 11 * * *", refreshTopStoriesRef);

export default crons;
