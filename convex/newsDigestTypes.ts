export const BELLE_DAILY_DIGEST_STORY_LIMIT = 12;

export type ReusableDailyDigestStory = {
  hnItemId: number;
  snapshotDate: string;
  rank: number;
  title: string;
  url?: string;
  host?: string;
  summary: string;
  score?: number;
  descendants?: number;
  timePosted?: number;
};
