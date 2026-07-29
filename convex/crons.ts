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
    internal.sukiForumAgent.runDailySlot,
    { slot },
  );
});

Array.from({ length: 15 }, (_, index) => ({
  schedule: dailyCronAtMinute(29 + index * 96),
  slot: index + 1,
})).forEach(({ schedule, slot }) => {
  crons.cron(
    `Belle forum post ${slot}`,
    schedule,
    internal.belleForumAgent.runDailySlot,
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
  "cleanup forum agent caches",
  "25 6 * * *",
  internal.sukiForumAgentData.cleanupExpiredResearchCache,
  {},
);

export default crons;
