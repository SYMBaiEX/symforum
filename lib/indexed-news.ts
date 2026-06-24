import { convexRefs } from "@/lib/convex-refs";
import { fetchHnStory, type HnStory } from "@/lib/hn";
import { ConvexHttpClient } from "convex/browser";
import { cache } from "react";

export const getIndexedStory = cache(async function getIndexedStory(
  hnItemId: number,
): Promise<HnStory | null> {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (convexUrl) {
    try {
      const client = new ConvexHttpClient(convexUrl);
      const story = await client.query(convexRefs.news.getStory, { hnItemId });
      if (story) {
        return story;
      }
    } catch {
      // Fall back to the public HN item API so article routes still resolve.
    }
  }
  return await fetchHnStory(hnItemId);
});

export function stripHnHtml(text: string | undefined) {
  return (text ?? "")
    .replace(/<p>/g, "\n\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .trim();
}
