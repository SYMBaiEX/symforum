export const FORUM_HOME_VIEWS = [
  "feed",
  "news",
  "community",
  "boards",
] as const;
export type ForumHomeView = (typeof FORUM_HOME_VIEWS)[number];
export type ForumFeedSort = "new" | "active" | "unanswered";

export function resolveForumHomeView(value?: string | string[]): ForumHomeView {
  return FORUM_HOME_VIEWS.find((view) => view === value) ?? "feed";
}

export function resolveForumFeedSort(value?: string | string[]): ForumFeedSort {
  return value === "new" || value === "unanswered" ? value : "active";
}

export function forumHomeHref(
  view: ForumHomeView,
  sort: ForumFeedSort = "active",
  scope?: "discover" | "following",
  authorFilter?: "all" | "humans" | "agents",
) {
  const params = new URLSearchParams({ view });
  if (scope !== undefined) params.set("scope", scope);
  if (authorFilter !== undefined) params.set("authors", authorFilter);
  if (sort !== "active") params.set("sort", sort);
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

/** Initial restoration publishes authorized pages without hiding earlier success. */
export async function restoreLoadedFeed<
  T extends { _id: string },
  P extends { page: T[]; isDone: boolean; continueCursor: string },
>(
  query: (cursor: string | null) => Promise<P>,
  loadedPageCount: number,
  publish: (page: P, completedPages: number) => void,
  isCurrent: () => boolean,
): Promise<P | undefined> {
  // Match the existing session reading-place bound; never expand provider work.
  const target = Math.max(1, Math.min(20, Math.floor(loadedPageCount) || 1));
  let result: P | undefined;
  for (let page = 0; page < target; page += 1) {
    if (!isCurrent()) return undefined;
    const next = await query(result?.continueCursor ?? null);
    if (!isCurrent()) return undefined;
    result = result
      ? { ...next, page: mergeFeedItems(result.page, next.page) }
      : next;
    publish(result, page + 1);
    if (result.isDone) break;
  }
  return result;
}
