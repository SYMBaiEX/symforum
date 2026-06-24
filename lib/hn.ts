import { safeExternalUrl } from "@/lib/safe-url";

export type HnStory = {
  hnItemId: number;
  rank: number;
  title: string;
  url?: string;
  host?: string;
  by?: string;
  score?: number;
  descendants?: number;
  timePosted?: number;
  text?: string;
  fetchedAt?: number;
  platformStats?: {
    comments: number;
    score: number;
    saves: number;
  };
};

const HN_TOP_STORIES_URL =
  "https://hacker-news.firebaseio.com/v0/topstories.json";
const HN_ITEM_URL = "https://hacker-news.firebaseio.com/v0/item/";

export function storyHost(url: string | undefined) {
  const safeUrl = safeExternalUrl(url);
  if (!safeUrl) {
    return undefined;
  }
  try {
    return new URL(safeUrl).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

export async function fetchHnTopStories(limit = 30): Promise<HnStory[]> {
  const topResponse = await fetch(HN_TOP_STORIES_URL, {
    next: { revalidate: 60 * 30 },
  });
  if (!topResponse.ok) {
    throw new Error(`HN topstories failed: ${topResponse.status}`);
  }
  const ids = (await topResponse.json()) as number[];
  const topIds = ids.slice(0, limit);
  const rows = await Promise.all(
    topIds.map(async (id, index) => {
      const story = await fetchHnStory(id, index + 1);
      return story;
    }),
  );
  return rows.filter((story) => story !== null);
}

export async function fetchHnStory(
  id: number,
  rank = 0,
): Promise<HnStory | null> {
  const response = await fetch(`${HN_ITEM_URL}${id}.json`, {
    next: { revalidate: 60 * 30 },
  });
  if (!response.ok) {
    return null;
  }
  const item = (await response.json()) as {
    id: number;
    title?: string;
    url?: string;
    by?: string;
    score?: number;
    descendants?: number;
    time?: number;
    text?: string;
    deleted?: boolean;
    dead?: boolean;
    type?: string;
  } | null;
  if (!item || item.deleted || item.dead || !item.title) {
    return null;
  }
  const url = safeExternalUrl(item.url);
  return {
    hnItemId: item.id,
    rank,
    title: item.title,
    url,
    host: storyHost(url),
    by: item.by,
    score: item.score,
    descendants: item.descendants,
    timePosted: item.time,
    text: item.text,
    fetchedAt: Date.now(),
  };
}
