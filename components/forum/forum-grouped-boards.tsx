"use client";

import { ForumLink, ForumStatusBox } from "./forum-primitives";
import { MessageSquare } from "lucide-react";
import {
  formatForumCount,
  formatForumDateTime,
  forumPath,
  getCategoryDescription,
  getCategoryLatestThread,
  getCategoryPostCount,
  getCategoryThreadCount,
  getCategoryTitle,
  getThreadLastActivityAt,
  getThreadLastAuthor,
  getThreadLastPostHref,
  type ForumCategoryRecord,
  type ForumOverviewRecord,
} from "./forum-refs";

const accents = [
  "var(--accent-magenta)",
  "var(--accent-cyan)",
  "var(--accent-canary)",
];

export function ForumGroupedBoards({
  overview,
}: {
  overview: ForumOverviewRecord;
}) {
  const groups = overview.sections.length
    ? overview.sections
    : [{ section: null, boards: overview.categories }];
  if (!groups.some((group) => group.boards.length))
    return (
      <ForumStatusBox
        title="No boards yet"
        body="Published boards will appear here."
      />
    );
  return (
    <div className="space-y-5">
      {groups.map((group, index) => (
        <section
          key={group.section?.slug ?? `group-${index}`}
          aria-label={`${group.section ? getCategoryTitle(group.section) : "Main"} boards`}
          className="overflow-hidden rounded-sm bg-muted/20"
        >
          <div className="flex min-h-11 items-center gap-2.5 bg-muted/70 px-4 py-2">
            <span
              className="size-2 shrink-0"
              aria-hidden="true"
              style={{ backgroundColor: accents[index % accents.length] }}
            />
            <h2 className="text-sm font-semibold">
              {group.section ? getCategoryTitle(group.section) : "Main boards"}
            </h2>
            <span className="ml-auto font-mono text-[11px] tabular-nums text-muted-foreground">
              {group.boards.length}{" "}
              {group.boards.length === 1 ? "board" : "boards"}
            </span>
          </div>
          <ul className="px-3 sm:px-4">
            {group.boards.map((category) => (
              <li key={category.slug}>
                <GroupedBoardRow category={category} />
              </li>
            ))}
          </ul>
        </section>
      ))}
      <dl className="flex flex-wrap gap-x-6 gap-y-2 px-1 font-mono text-[11px] text-muted-foreground">
        {[
          { label: "Boards", value: overview.totals.categories },
          { label: "Threads", value: overview.totals.threads },
          { label: "Posts", value: overview.totals.posts },
        ].map((item) => (
          <div className="flex gap-2" key={item.label}>
            <dt>{item.label}</dt>
            <dd className="tabular-nums text-foreground">
              {formatForumCount(item.value)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function unread(category: ForumCategoryRecord): boolean {
  return (
    category.viewerUnread === true || (category.children ?? []).some(unread)
  );
}
function hasReadState(category: ForumCategoryRecord): boolean {
  return (
    category.viewerUnread !== undefined ||
    (category.children ?? []).some(hasReadState)
  );
}
function hasActivity(category: ForumCategoryRecord): boolean {
  return (
    getCategoryLatestThread(category) !== null ||
    (category.children ?? []).some(hasActivity)
  );
}

function GroupedBoardRow({ category }: { category: ForumCategoryRecord }) {
  const latest = getCategoryLatestThread(category);
  const author = getThreadLastAuthor(latest);
  const activity = getThreadLastActivityAt(latest);
  const isUnread = hasReadState(category)
    ? unread(category)
    : hasActivity(category);
  const access = [
    category.viewAccess && category.viewAccess !== "public"
      ? `${category.viewAccess} view`
      : null,
    category.threadAccess && category.threadAccess !== "members"
      ? `${category.threadAccess} threads`
      : null,
    category.replyAccess && category.replyAccess !== "members"
      ? `${category.replyAccess} replies`
      : null,
    category.pollAccess && category.pollAccess !== "members"
      ? `${category.pollAccess} polls`
      : null,
  ].filter(Boolean);
  return (
    <article className="grid min-w-0 grid-cols-[24px_minmax(0,1fr)] items-start gap-x-3 gap-y-2 py-3 lg:grid-cols-[24px_minmax(0,1fr)_60px_190px] xl:grid-cols-[28px_minmax(0,1fr)_70px_210px]">
      <span
        className={`mt-3 ${isUnread ? "text-primary" : "text-muted-foreground"}`}
        role="img"
        aria-label={
          hasReadState(category)
            ? isUnread
              ? "Unread board"
              : "Read board"
            : isUnread
              ? "Board has activity"
              : "Quiet board"
        }
      >
        <MessageSquare className="size-6" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <h3>
          <ForumLink
            href={forumPath(category.slug)}
            className="focus-ring inline-flex min-h-11 items-center text-base font-semibold leading-5 hover:text-primary"
          >
            {getCategoryTitle(category)}
          </ForumLink>
        </h3>
        {getCategoryDescription(category) ? (
          <p className="-mt-1 text-xs leading-5 text-muted-foreground">
            {getCategoryDescription(category)}
          </p>
        ) : null}
        {access.length ? (
          <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
            {access.join(" · ")}
          </p>
        ) : null}
        <div className="mt-1 flex flex-wrap gap-x-3 font-mono text-[10px] leading-5 text-muted-foreground lg:hidden">
          <span>
            {formatForumCount(getCategoryThreadCount(category))} threads
          </span>
          <span>{formatForumCount(getCategoryPostCount(category))} posts</span>
        </div>
        {category.children?.length ? (
          <div className="mt-1 flex flex-wrap gap-x-3 text-xs">
            <span className="inline-flex min-h-11 items-center text-muted-foreground">
              Subforums:
            </span>
            {category.children.map((child) => (
              <ForumLink
                className="focus-ring inline-flex min-h-11 items-center hover:text-primary"
                href={forumPath(child.slug)}
                key={child.slug}
              >
                {getCategoryTitle(child)}
                <span className="sr-only">
                  {" "}
                  ({formatForumCount(getCategoryThreadCount(child))} threads)
                </span>
              </ForumLink>
            ))}
          </div>
        ) : null}
      </div>
      <dl className="hidden pt-3 font-mono text-[10px] text-muted-foreground lg:block">
        <div className="flex flex-col">
          <dt className="order-2">threads</dt>
          <dd className="order-1 text-sm tabular-nums text-foreground">
            {formatForumCount(getCategoryThreadCount(category))}
          </dd>
        </div>
        <div className="mt-2 flex flex-col">
          <dt className="order-2">posts</dt>
          <dd className="order-1 tabular-nums text-foreground">
            {formatForumCount(getCategoryPostCount(category))}
          </dd>
        </div>
      </dl>
      <div className="col-start-2 min-w-0 lg:col-start-auto lg:pt-2">
        {latest ? (
          <>
            <p className="sr-only">Latest thread</p>
            <ForumLink
              className="focus-ring block min-h-11 content-center text-xs font-medium leading-5 hover:text-primary"
              href={getThreadLastPostHref(latest, category.slug)}
            >
              {latest.title}
            </ForumLink>
            <p className="text-[11px] leading-5 text-muted-foreground">
              {author !== "SYM-UNKNOWN" ? author : ""}
              {activity ? ` · ${formatForumDateTime(activity)}` : ""}
            </p>
          </>
        ) : (
          <p className="py-3 text-xs text-muted-foreground">No posts yet</p>
        )}
      </div>
    </article>
  );
}
