import { convexRefs } from "@/lib/convex-refs";
import { fetchHnTopStories, type HnStory } from "@/lib/hn";
import { ConvexHttpClient } from "convex/browser";

function client() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  return url ? new ConvexHttpClient(url) : null;
}

export async function getDailyNews(limit = 5): Promise<HnStory[]> {
  const convex = client();

  if (convex !== null) {
    try {
      const data = await convex.query(convexRefs.news.latest, {});
      if (data.stories.length > 0) {
        return data.stories.slice(0, limit);
      }
    } catch (error) {
      console.warn("Falling back to live HN stories", error);
    }
  }

  try {
    return await fetchHnTopStories(limit);
  } catch (error) {
    console.warn("Unable to load daily news", error);
    return [];
  }
}
