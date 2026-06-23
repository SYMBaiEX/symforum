import { cronJobs } from "convex/server";
import { makeFunctionReference } from "convex/server";

const crons = cronJobs();

const refreshTopStoriesRef = makeFunctionReference<
  "action",
  Record<string, never>,
  unknown
>("news:refreshTopStories");

crons.daily(
  "refresh Hacker News snapshot",
  { hourUTC: 11, minuteUTC: 0 },
  refreshTopStoriesRef,
);

export default crons;
