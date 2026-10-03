"use client";

import { ForumLink, ForumStatusBox } from "./forum-primitives";
import { ChevronDown, MessageSquare } from "lucide-react";
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
  query = "",
}: {
  overview: ForumOverviewRecord;
  query?: string;
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
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleGroups = groups
    .map((group) => ({
      ...group,
      boards: group.boards.filter((board) =>
        matchesBoard(board, normalizedQuery),
      ),
    }))
    .filter((group) => group.boards.length);
  if (!visibleGroups.length)
    return (
      <ForumStatusBox
        title="No matching boards"
        body={`No board names, descriptions, or subforums match “${query.trim()}”. Try a shorter search or clear the filter.`}
      />
    );
  return (
    <div className="space-y-4">
      {visibleGroups.map((group, index) => (
        <section
          key={group.section?.slug ?? `group-${index}`}
          aria-label={`${group.section ? getCategoryTitle(group.section) : "Main"} boards`}
          className="overflow-hidden rounded-xl bg-card p-2 sm:p-3"
        >
          <div className="flex min-h-11 items-center gap-2.5 px-2 py-2 sm:px-3">
            <span
              className="size-2 shrink-0 rounded-full"
              aria-hidden="true"
              style={{ backgroundColor: accents[index % accents.length] }}
            />
            <h2 className="text-base font-semibold tracking-tight">
              {group.section ? getCategoryTitle(group.section) : "Main boards"}
            </h2>
            <span className="ml-auto font-mono text-[11px] tabular-nums text-muted-foreground">
              {group.boards.length}{" "}
              {group.boards.length === 1 ? "board" : "boards"}
            </span>
          </div>
          <ul className="py-1">
            {group.boards.map((category) => (
              <li key={category.slug}>
                <GroupedBoardRow
                  category={category}
                  searching={Boolean(normalizedQuery)}
                />
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

function matchesBoard(category: ForumCategoryRecord, query: string): boolean {
  return (
    !query ||
    `${getCategoryTitle(category)} ${getCategoryDescription(category)}`
      .toLocaleLowerCase()
      .includes(query) ||
    Boolean(category.children?.some((child) => matchesBoard(child, query)))
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

function GroupedBoardRow({
  category,
  searching,
}: {
  category: ForumCategoryRecord;
  searching: boolean;
}) {
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
    <article className="grid min-w-0 grid-cols-[36px_minmax(0,1fr)] items-start gap-x-3 rounded-lg px-2 py-3 hover:bg-muted/50 focus-within:bg-muted/50 sm:grid-cols-[40px_minmax(0,1fr)] sm:px-3 xl:grid-cols-[40px_minmax(0,1fr)_56px_160px]">
      <span
        className={`mt-1.5 flex size-9 items-center justify-center rounded-full sm:size-10 ${isUnread ? "bg-primary/10 text-primary" : "bg-accent/15 text-foreground"}`}
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
        <MessageSquare className="size-4 sm:size-5" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <h3>
          <ForumLink
            href={forumPath(category.slug)}
            className="focus-ring inline-flex min-h-11 max-w-full items-center text-base font-semibold leading-5 hover:text-primary [overflow-wrap:anywhere] sm:text-base"
          >
            {getCategoryTitle(category)}
          </ForumLink>
        </h3>
        {getCategoryDescription(category) ? (
          <p className="-mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
            {getCategoryDescription(category)}
          </p>
        ) : null}
        {access.length ? (
          <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
            {access.join(" · ")}
          </p>
        ) : null}
        <div className="mt-1 flex flex-wrap gap-x-3 font-mono text-[10px] leading-5 text-muted-foreground xl:hidden">
          <span>
            {formatForumCount(getCategoryThreadCount(category))} threads
          </span>
          <span>{formatForumCount(getCategoryPostCount(category))} posts</span>
        </div>
        {category.children?.length ? (
          <details
            className="group/subforums mt-0.5"
            open={searching || undefined}
          >
            <summary className="focus-ring inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
              <ChevronDown
                className="size-3.5 transition-transform group-open/subforums:rotate-180"
                aria-hidden="true"
              />
              {category.children.length}{" "}
              {category.children.length === 1 ? "subforum" : "subforums"}
              <span className="sr-only"> in {getCategoryTitle(category)}</span>
            </summary>
            <ul className="mb-1 flex flex-wrap gap-2 text-xs">
              {category.children.map((child) => (
                <li key={child.slug}>
                  <ForumLink
                    className="forum-action-pill focus-ring inline-flex min-h-11 items-center gap-2 px-3 hover:text-primary"
                    href={forumPath(child.slug)}
                  >
                    {getCategoryTitle(child)}
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {formatForumCount(getCategoryThreadCount(child))}
                      <span className="sr-only"> threads</span>
                    </span>
                  </ForumLink>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
      <dl className="hidden pt-2 text-right font-mono text-[10px] text-muted-foreground xl:block">
        <div className="flex flex-col">
          <dt className="order-2">threads</dt>
          <dd className="order-1 text-sm tabular-nums text-foreground">
            {formatForumCount(getCategoryThreadCount(category))}
          </dd>
        </div>
        <div className="mt-1 flex flex-col">
          <dt className="order-2">posts</dt>
          <dd className="order-1 tabular-nums text-foreground">
            {formatForumCount(getCategoryPostCount(category))}
          </dd>
        </div>
      </dl>
      <div className="col-start-2 min-w-0 xl:col-start-auto xl:pt-1">
        {latest ? (
          <>
            <p className="sr-only">Latest thread</p>
            <ForumLink
              className="focus-ring flex min-h-11 items-center text-xs font-medium leading-5 hover:text-primary [overflow-wrap:anywhere]"
              href={getThreadLastPostHref(latest, category.slug)}
              title={latest.title}
            >
              <span className="line-clamp-2">{latest.title}</span>
            </ForumLink>
            <div className="flex min-w-0 items-center gap-2 text-[11px] leading-5 text-muted-foreground">
              {author !== "SYM-UNKNOWN" ? (
                <span className="min-w-0 flex-1 truncate" title={author}>
                  {author}
                </span>
              ) : null}
              {activity ? (
                <time
                  className="shrink-0 whitespace-nowrap text-[10px]"
                  dateTime={new Date(activity).toISOString()}
                  title={formatForumDateTime(activity)}
                >
                  {new Intl.DateTimeFormat("en", {
                    month: "short",
                    day: "numeric",
                    timeZone: "UTC",
                  }).format(activity)}
                </time>
              ) : null}
            </div>
          </>
        ) : (
          <p className="py-3 text-xs text-muted-foreground">
            {getCategoryPostCount(category) > 0 ||
            getCategoryThreadCount(category) > 0
              ? "Latest activity unavailable"
              : "No posts yet"}
          </p>
        )}
      </div>
    </article>
  );
}
