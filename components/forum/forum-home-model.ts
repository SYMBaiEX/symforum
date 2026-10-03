export const FORUM_HOME_VIEWS = [
  "feed",
  "news",
  "community",
  "boards",
] as const;
export type ForumHomeView = (typeof FORUM_HOME_VIEWS)[number];
export type ForumFeedSort = "new" | "active";

export function resolveForumHomeView(value?: string | string[]): ForumHomeView {
  return FORUM_HOME_VIEWS.find((view) => view === value) ?? "feed";
}

export function resolveForumFeedSort(value?: string | string[]): ForumFeedSort {
  return value === "new" ? "new" : "active";
}

export function forumHomeHref(
  view: ForumHomeView,
  sort: ForumFeedSort = "active",
) {
  const params = new URLSearchParams({ view });
  if (sort === "new") params.set("sort", sort);
  return `/forum?${params}`;
}

export function mergeFeedItems<T extends { _id: string }>(
  existing: T[],
  incoming: T[],
) {
  const seen = new Set(existing.map((item) => item._id));
  return [
    ...existing,
    ...incoming.filter((item) => {
      if (seen.has(item._id)) return false;
      seen.add(item._id);
      return true;
    }),
  ];
}

export async function refreshLoadedFeed<
  T extends { _id: string },
  P extends {
    page: T[];
    isDone: boolean;
    continueCursor: string;
  },
>(
  query: (cursor: string | null) => Promise<P>,
  loadedPageCount: number,
): Promise<P> {
  let result = await query(null);
  for (let page = 1; page < loadedPageCount && !result.isDone; page += 1) {
    const following = await query(result.continueCursor);
    result = {
      ...following,
      page: mergeFeedItems(result.page, following.page),
    };
  }
  return result;
}
