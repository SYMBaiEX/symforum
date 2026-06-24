import { convexRefs, type NewsTimelineRecord } from "@/lib/convex-refs";
import { fetchHnTopStories, type HnStory } from "@/lib/hn";
import { readThroughServerCache } from "@/lib/server-cache";
import { getServerConvexClient } from "@/lib/server-convex";
import { cache } from "react";

const SERVER_DATA_TTL_MS = 30 * 1000;
const HN_FALLBACK_TTL_MS = 30 * 60 * 1000;

export const getLiveHnFallback = cache(async function getLiveHnFallback(
  limit = 30,
): Promise<HnStory[]> {
  return await readThroughServerCache(
    `hn:fallback:${limit}`,
    HN_FALLBACK_TTL_MS,
    () => fetchHnTopStories(limit),
  );
});

export const getNewsTimeline = cache(async function getNewsTimeline(
  snapshotDate?: string,
): Promise<NewsTimelineRecord | null> {
  const convex = getServerConvexClient();

  if (convex === null) {
    return null;
  }

  return await readThroughServerCache(
    `news:timeline:${snapshotDate ?? "latest"}`,
    SERVER_DATA_TTL_MS,
    async () => {
      try {
        return await convex.query(
          convexRefs.news.timeline,
          snapshotDate ? { snapshotDate } : {},
        );
      } catch (error) {
        console.warn("Unable to load indexed news timeline", error);
        return null;
      }
    },
  );
});

export const getDailyNews = cache(async function getDailyNews(
  limit = 5,
): Promise<HnStory[]> {
  const convex = getServerConvexClient();

  if (convex !== null) {
    const stories = await readThroughServerCache(
      `news:daily:${limit}`,
      SERVER_DATA_TTL_MS,
      async () => {
        try {
          const data = await convex.query(convexRefs.news.latest, {});
          return data.stories;
        } catch (error) {
          console.warn("Falling back to live HN stories", error);
          return [];
        }
      },
    );

    if (stories.length > 0) {
      return stories.slice(0, limit);
    }
  }

  try {
    return await getLiveHnFallback(limit);
  } catch (error) {
    console.warn("Unable to load daily news", error);
    return [];
  }
});
