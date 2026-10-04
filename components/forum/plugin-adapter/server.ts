import { makeFunctionReference } from "convex/server";
import { pluginClient } from "./data";
import { forumHost, record } from "./host";
export async function resolveForumRouteStatus(args: {
  categorySlug: string;
  threadSlug?: string;
}) {
  const operation = args.threadSlug ? "forum_get_thread" : "forum_list_threads";
  const result = await forumHost.tool(
    operation,
    args.threadSlug ? args : { ...args, page: 1, pageSize: 20 },
  );
  const data = record(result.data);
  const category = record(data.category);
  const thread = record(data.thread);
  return args.threadSlug
    ? {
        kind: "thread",
        exists: Boolean(thread._id),
        threadTitle: thread.title,
        threadExcerpt: thread.body,
        createdAt: thread.createdAt,
        updatedAt: thread.updatedAt,
      }
    : {
        kind: "category",
        exists: Boolean(category._id),
        categoryName: category.name,
        categoryDescription: category.description,
      };
}
export async function getNewsPageData() {
  const timeline = await pluginClient.query(
    makeFunctionReference<"query">("news:timeline"),
    {},
  );
  return { initialTimeline: timeline, initialStories: [] };
}
export async function resolveForumAnnouncementRouteStatus(args: {
  slug: string;
  board?: string;
}) {
  const result = await forumHost.tool("forum_get_announcement", {
    slug: args.slug,
    ...(args.board ? { categorySlug: args.board } : {}),
  });
  return result.data;
}

export function forumAnnouncementCanonicalPath(slug: string, board?: string) {
  return `/announcements/${encodeURIComponent(slug)}${board ? "?board=" + encodeURIComponent(board) : ""}`;
}
