"use client";
import { ForumMediaGallery } from "./forum-media-gallery";

import { Button } from "@/components/ui/button";
import { ForumAgentContextStrip } from "@/components/forum/forum-webmcp";
import { ForumPageHeader } from "@/components/forum/forum-layout-primitives";
import { safeImageUrl } from "@/lib/safe-url";
import { ForumBbcodeBody } from "@/components/forum/forum-bbcode";
import { decodeForumEntities } from "@/components/forum/forum-bbcode-model";
import { ForumLink } from "@/components/forum/forum-link";
import { cn } from "@/lib/utils";
import { useQuery } from "convex-helpers/react/cache/hooks";
import { useConvexAuth, useMutation } from "convex/react";
import usePresence from "@convex-dev/presence/react";
import { Bookmark, Bot, ChevronDown, Mail, MessageSquare, Star, UserRound, Bell } from "lucide-react";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import {
  Fragment,
  ReactNode,
  useEffect,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import {
  forumAnnouncementPath,
  forumHrefForPathname,
  forumRefs,
  forumPresenceRefs,
  forumPath,
  forumPostPath,
  formatForumCount,
  formatForumDateTime,
  type ForumAttachmentRecord,
  getCategoryDescription,
  getCategoryLatestThread,
  getCategoryPostCount,
  getCategoryThreadCount,
  getCategoryTitle,
  getThreadAuthor,
  getThreadLastActivityAt,
  getThreadLastAuthor,
  getThreadLastPostHref,
  getThreadRatingAverage,
  getThreadRatingCount,
  getThreadReplyCount,
  getThreadStartedAt,
  humanizeSlug,
  isLockedThread,
  isPinnedThread,
  normalizedForumPathname,
  type ForumAnnouncementRecord,
  type ForumCategoryRecord,
  type ForumCategorySectionRecord,
  type ForumPaginationRecord,
  type ForumPresenceLocationType,
  type ForumThreadPrefixRecord,
  type ForumThreadSummaryRecord,
} from "@/components/forum/forum-refs";

const FORUM_PRESENCE_HEARTBEAT_MS = 120_000;
const FORUM_JUMP_PLACEHOLDER_VALUE = "__forum_jump__";
const FORUM_ANNOUNCEMENT_COLLAPSE_KEY = "symbaiex:forum:announcement-collapse";
const FORUM_ANNOUNCEMENT_PANEL_ID = "forum-announcements-panel";
const FORUM_JUMP_STATIC_OPTIONS = [
  { href: "/forum", label: "Board index" },
  { href: "/forum/help", label: "Help / FAQ" },
  { href: "/forum/calendar", label: "Calendar" },
  { href: "/forum/new-posts", label: "New posts" },
  { href: "/forum/todays-posts", label: "Today's posts" },
  { href: "/forum/search", label: "Search" },
  { href: "/forum/agents", label: "Agents" },
  { href: "/forum/members", label: "Members" },
  { href: "/forum/online", label: "Who's online" },
  { href: "/forum/announcements", label: "Announcements" },
];

export function handleForumDisclosureKeyDown(
  event: KeyboardEvent<HTMLDetailsElement>,
) {
  if (event.key !== "Escape" || !event.currentTarget.open) return;
  event.preventDefault();
  event.stopPropagation();
  event.currentTarget.open = false;
  event.currentTarget.querySelector("summary")?.focus();
}

export function ForumStatusBox({
  title,
  body,
  accent = "muted",
  action,
}: {
  title: string;
  body: string;
  accent?: "muted" | "cyan" | "canary" | "magenta";
  action?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "py-4",
        accent === "cyan" && "border-accent/70 bg-accent/10",
        accent === "canary" && "border-accent-canary/60 bg-accent-canary/10",
        accent === "magenta" && "border-primary/50 bg-primary/10",
      )}
    >
      <p className="text-xs text-muted-foreground">{title}</p>
      <p className="mt-1 max-w-3xl text-sm leading-5 text-muted-foreground">
        {body}
      </p>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

type ForumLoadingVariant =
  "line" | "index" | "threads" | "thread" | "ucp" | "subscriptions";

export function ForumLoading({
  label = "Syncing forum",
  variant = "line",
}: {
  label?: string;
  variant?: ForumLoadingVariant;
}) {
  if (variant === "index" || variant === "threads") {
    return (
      <ForumTableSkeleton
        kind={variant === "index" ? "boards" : "threads"}
        label={label}
        rows={variant === "index" ? 5 : 6}
      />
    );
  }
  if (variant === "thread") {
    return <ForumThreadSkeleton label={label} />;
  }
  if (variant === "ucp") {
    return <ForumUserCpSkeleton label={label} />;
  }
  if (variant === "subscriptions") {
    return <ForumSubscriptionsSkeleton label={label} />;
  }

  return (
    <p
      aria-live="polite"
      className="py-4 text-sm text-muted-foreground"
      role="status"
    >
      {label}
    </p>
  );
}

export function ForumBreadcrumbs({
  category,
  categorySlug,
  thread,
}: {
  category?: ForumCategoryRecord | null;
  categorySlug?: string;
  thread?: ForumThreadSummaryRecord | null;
}) {
  const resolvedCategorySlug = category?.slug ?? categorySlug;
  const ancestors = category?.ancestors ?? [];

  return (
    <nav
      aria-label="Forum breadcrumb"
      className="flex min-w-0 items-center gap-x-2 overflow-x-auto whitespace-nowrap py-1 text-xs text-muted-foreground [&>*]:shrink-0"
    >
      <ForumLink
        href="/forum"
        prefetch
        className="focus-ring hover:text-foreground"
      >
        Forum
      </ForumLink>
      {ancestors.map((ancestor) => (
        <ForumBreadcrumbCategory
          key={ancestor._id ?? ancestor.slug}
          category={ancestor}
        />
      ))}
      {resolvedCategorySlug ? (
        <>
          <span>/</span>
          <ForumLink
            href={forumPath(resolvedCategorySlug)}
            prefetch
            className="focus-ring hover:text-foreground"
          >
            {category
              ? getCategoryTitle(category)
              : humanizeSlug(resolvedCategorySlug)}
          </ForumLink>
        </>
      ) : null}
      {thread ? <span className="sr-only">/ {thread.title}</span> : null}
    </nav>
  );
}

function ForumBreadcrumbCategory({
  category,
}: {
  category: ForumCategoryRecord;
}) {
  const isLinkableBoard =
    category.kind !== "section" && category.isPostable !== false;

  return (
    <>
      <span>/</span>
      {isLinkableBoard ? (
        <ForumLink
          href={forumPath(category.slug)}
          prefetch
          className="focus-ring hover:text-foreground"
        >
          {getCategoryTitle(category)}
        </ForumLink>
      ) : (
        <span>{getCategoryTitle(category)}</span>
      )}
    </>
  );
}

export function ForumMetricBar({
  items,
  className,
}: {
  items: Array<{ label: string; value: number | string }>;
  className?: string;
}) {
  return (
    <dl className={cn("flex flex-wrap gap-x-6 gap-y-3", className)}>
      {items.map((item) => (
        <div key={item.label} className="bg-background px-3 py-2">
          <dt className="text-xs text-muted-foreground">{item.label}</dt>
          <dd className="mt-0.5 font-mono text-base font-semibold tabular-nums">
            {typeof item.value === "number"
              ? formatForumCount(item.value)
              : item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function ForumThreadRatingSummary({
  average,
  className,
  count,
}: {
  average: number;
  className?: string;
  count: number;
}) {
  const rounded = Math.max(0, Math.min(5, Math.round(average)));
  const label =
    count === 0
      ? "Thread not rated yet"
      : `Thread rating ${average.toFixed(1)} out of 5 from ${count} ${
          count === 1 ? "vote" : "votes"
        }`;

  return (
    <div className={cn("inline-flex items-center gap-2", className)}>
      <span className="sr-only">{label}</span>
      <span aria-hidden="true" className="inline-flex items-center gap-0.5">
        {[1, 2, 3, 4, 5].map((value) => (
          <Star
            key={value}
            className={cn(
              "size-3.5",
              value <= rounded
                ? "fill-primary text-primary"
                : "text-muted-foreground/45",
            )}
          />
        ))}
      </span>
      <span aria-hidden="true" className="text-xs text-muted-foreground">
        {count === 0 ? "Unrated" : `${average.toFixed(1)} (${count})`}
      </span>
    </div>
  );
}

export function ForumChrome({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  const pathname = usePathname();

  return (
    <header className={cn("min-w-0 bg-background", className)}>
      <ForumPresenceHeartbeat pathname={pathname} />
      <ForumAgentContextStrip />
      {children ? <div className="bg-background py-2">{children}</div> : null}
    </header>
  );
}

function ForumPresenceHeartbeat({ pathname }: { pathname: string | null }) {
  if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
    return null;
  }

  return <LiveForumPresenceHeartbeat pathname={pathname} />;
}

function LiveForumPresenceHeartbeat({ pathname }: { pathname: string | null }) {
  const navState = useQuery(forumRefs.getMyForumNavState, {});

  if (!navState?.authenticated || !navState.trusted || !navState.userId) {
    return null;
  }

  return (
    <ConnectedForumPresenceHeartbeat
      pathname={pathname}
      userId={navState.userId}
    />
  );
}

function ConnectedForumPresenceHeartbeat({
  pathname,
  userId,
}: {
  pathname: string | null;
  userId: string;
}) {
  const recordPresence = useMutation(forumRefs.recordPresence);
  usePresence(forumPresenceRefs, "forum", userId, FORUM_PRESENCE_HEARTBEAT_MS);

  useEffect(() => {
    let canceled = false;
    const payload = forumPresencePayload(pathname);
    const record = async () => {
      try {
        if (!canceled) {
          await recordPresence(payload);
        }
      } catch {
        // Presence should never interrupt forum reading.
      }
    };

    void record();

    return () => {
      canceled = true;
    };
  }, [pathname, recordPresence]);

  return null;
}

function forumPresencePayload(pathname: string | null): {
  locationType: ForumPresenceLocationType;
  path: string;
  label: string;
} {
  const path = normalizedForumPathname(pathname);

  if (path === "/forum") {
    return { locationType: "index", path, label: "Board index" };
  }
  if (path.startsWith("/forum/search")) {
    return { locationType: "search", path, label: "Searching forums" };
  }
  if (path.startsWith("/forum/help")) {
    return { locationType: "help", path, label: "Reading help" };
  }
  if (path.startsWith("/forum/calendar")) {
    return { locationType: "calendar", path, label: "Browsing calendar" };
  }
  if (path.startsWith("/forum/new-posts")) {
    return { locationType: "newPosts", path, label: "Viewing new posts" };
  }
  if (path.startsWith("/forum/todays-posts")) {
    return { locationType: "newPosts", path, label: "Viewing today's posts" };
  }
  if (path.startsWith("/forum/members")) {
    return { locationType: "members", path, label: "Member directory" };
  }
  if (path.startsWith("/forum/online")) {
    return { locationType: "online", path, label: "Who's online" };
  }
  if (path.startsWith("/forum/control-panel")) {
    return { locationType: "userCp", path, label: "User CP" };
  }
  if (path.startsWith("/forum/moderation")) {
    return { locationType: "userCp", path, label: "Moderator CP" };
  }
  if (path.startsWith("/forum/messages")) {
    return { locationType: "messages", path, label: "Private messages" };
  }
  if (path.startsWith("/forum/subscriptions")) {
    return { locationType: "subscriptions", path, label: "Subscriptions" };
  }
  if (path.startsWith("/forum/saved")) {
    return { locationType: "saved", path, label: "Saved threads" };
  }

  const segments = path.split("/").filter(Boolean);
  if (segments.length >= 3) {
    return { locationType: "thread", path, label: "Reading thread" };
  }
  return { locationType: "board", path, label: "Viewing board" };
}

export function ForumUtilityNav({ className }: { className?: string }) {
  return (
    <ForumChrome className={className}>
      <ForumUtilityLinkRow />
    </ForumChrome>
  );
}

function ForumUtilityLinkRow({ className }: { className?: string }) {
  if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
    return <ForumUtilityLinks className={className} />;
  }

  return <LiveForumUtilityLinkRow className={className} />;
}

function LiveForumUtilityLinkRow({ className }: { className?: string }) {
  const categories = useQuery(forumRefs.listCategoryOptions, { limit: 200 });

  return <ForumUtilityLinks categories={categories} className={className} />;
}

function ForumUtilityLinks({
  categories = null,
  className,
}: {
  categories?: ForumCategoryRecord[] | null;
  className?: string;
}) {
  return (
    <details className={cn("group min-w-0", className)}>
      <summary className="focus-ring inline-flex min-h-11 cursor-pointer items-center gap-2 text-xs text-muted-foreground hover:text-foreground">
        Jump to a board
        <ChevronDown
          aria-hidden="true"
          className="size-3.5 transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="max-w-md pb-3">
        <ForumJumpSelect categories={categories} />
      </div>
    </details>
  );
}

function ForumJumpSelect({
  categories,
}: {
  categories: ForumCategoryRecord[] | null | undefined;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const normalizedPathname = normalizedForumPathname(pathname);
  const selectedValue = forumJumpSelectedValue(normalizedPathname, categories);

  return (
    <label className="flex min-h-11 min-w-0 w-full items-center gap-2 text-xs md:ml-auto md:w-auto ">
      <span className="shrink-0 text-muted-foreground">Jump</span>
      <select
        aria-label="Forum jump"
        className="focus-ring min-h-11 min-w-0 flex-1 rounded-none border border-row-border bg-background px-3 text-base text-foreground outline-none disabled:text-muted-foreground md:w-60 md:flex-none md:text-sm"
        value={selectedValue}
        onChange={(event) => {
          const href = event.target.value;
          if (!href || href === FORUM_JUMP_PLACEHOLDER_VALUE) {
            return;
          }
          router.push(forumHrefForPathname(href, pathname));
        }}
      >
        <option value={FORUM_JUMP_PLACEHOLDER_VALUE}>Forum jump</option>
        <optgroup label="Forum">
          {FORUM_JUMP_STATIC_OPTIONS.map((option) => (
            <option key={option.href} value={option.href}>
              {option.label}
            </option>
          ))}
        </optgroup>
        <optgroup label="Boards">
          {categories === undefined ? (
            <option disabled value="__forum_jump_loading__">
              Loading boards
            </option>
          ) : categories === null ? (
            <option disabled value="__forum_jump_unavailable__">
              Boards unavailable
            </option>
          ) : categories.length === 0 ? (
            <option disabled value="__forum_jump_empty__">
              No visible boards
            </option>
          ) : (
            categories.map((category) => (
              <option key={category.slug} value={forumPath(category.slug)}>
                {getCategoryTitle(category)}
              </option>
            ))
          )}
        </optgroup>
      </select>
    </label>
  );
}

function forumJumpSelectedValue(
  normalizedPathname: string,
  categories: ForumCategoryRecord[] | null | undefined,
) {
  const staticOption = FORUM_JUMP_STATIC_OPTIONS.find((option) =>
    option.href === "/forum"
      ? normalizedPathname === "/forum"
      : normalizedPathname === option.href ||
        normalizedPathname.startsWith(`${option.href}/`),
  );
  if (staticOption) {
    return staticOption.href;
  }

  const [, boardSlug] = normalizedPathname.split("/").filter(Boolean);
  const matchingCategory =
    boardSlug && categories
      ? categories.find((category) => category.slug === boardSlug)
      : null;

  return matchingCategory
    ? forumPath(matchingCategory.slug)
    : FORUM_JUMP_PLACEHOLDER_VALUE;
}

export { ForumLink } from "@/components/forum/forum-link";

export function ForumAnnouncementPanel({
  announcements,
  title = "Announcements",
}: {
  announcements: ForumAnnouncementRecord[];
  title?: string;
}) {
  const [collapsed, setCollapsed] = useState(true);
  const announcementSignature = forumAnnouncementSignature(announcements);

  useEffect(() => {
    if (announcementSignature.length === 0) {
      return;
    }

    try {
      setCollapsed(
        window.localStorage.getItem(FORUM_ANNOUNCEMENT_COLLAPSE_KEY) !==
          `expanded:${announcementSignature}`,
      );
    } catch {
      setCollapsed(true);
    }
  }, [announcementSignature]);

  if (announcements.length === 0) {
    return null;
  }

  const latestAnnouncement = announcements[0]!;

  function toggleCollapsed() {
    setCollapsed((current) => {
      const nextCollapsed = !current;

      try {
        if (nextCollapsed) {
          window.localStorage.removeItem(FORUM_ANNOUNCEMENT_COLLAPSE_KEY);
        } else {
          window.localStorage.setItem(
            FORUM_ANNOUNCEMENT_COLLAPSE_KEY,
            `expanded:${announcementSignature}`,
          );
        }
      } catch {
        // Keep the UI usable when storage is blocked.
      }

      return nextCollapsed;
    });
  }

  return (
    <section className="py-3">
      <div className="grid gap-x-3 gap-y-1 lg:grid-cols-[7.5rem_minmax(0,1fr)_auto] lg:items-center">
        <h2 className="min-w-0 text-xs leading-5 text-muted-foreground">
          {title}
        </h2>
        <div
          className={cn("min-w-0", collapsed ? "self-center" : "space-y-2")}
          id={FORUM_ANNOUNCEMENT_PANEL_ID}
        >
          {collapsed ? (
            <p className="truncate text-xs leading-5 text-muted-foreground">
              <span className="font-mono uppercase">Latest</span>
              <span className="px-1.5">/</span>
              <ForumLink
                className="focus-ring font-semibold text-foreground hover:text-primary"
                href={forumAnnouncementPath(latestAnnouncement)}
                prefetch
              >
                {latestAnnouncement.title}
              </ForumLink>
              <span className="px-1.5">/</span>
              <span>
                Updated {formatForumDateTime(latestAnnouncement.updatedAt)}
              </span>
            </p>
          ) : (
            announcements.map((announcement) => (
              <article className="max-w-4xl" key={announcement._id}>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold leading-5">
                    <ForumLink
                      href={forumAnnouncementPath(announcement)}
                      prefetch
                    >
                      {announcement.title}
                    </ForumLink>
                  </h3>
                  {announcement.categoryName ? (
                    <span className="text-xs text-muted-foreground">
                      {announcement.categoryName}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      global
                    </span>
                  )}
                </div>
                <ForumBody
                  body={announcement.body}
                  className="mt-1 text-xs leading-5 text-muted-foreground md:text-xs"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Updated {formatForumDateTime(announcement.updatedAt)}
                </p>
              </article>
            ))
          )}
        </div>
        <div className="flex flex-wrap gap-3 lg:justify-self-end">
          <Button
            aria-controls={FORUM_ANNOUNCEMENT_PANEL_ID}
            aria-expanded={!collapsed}
            className="min-h-11 rounded-none px-2 text-xs text-muted-foreground hover:bg-transparent hover:text-foreground "
            size="sm"
            type="button"
            variant="ghost"
            onClick={toggleCollapsed}
          >
            {collapsed ? "Expand" : "Collapse"}
          </Button>
          <Button
            asChild
            className="min-h-11 rounded-none px-2 text-xs text-muted-foreground hover:bg-transparent hover:text-foreground "
            size="sm"
            variant="ghost"
          >
            <ForumLink href="/forum/announcements" prefetch>
              View all
            </ForumLink>
          </Button>
        </div>
      </div>
    </section>
  );
}

function forumAnnouncementSignature(announcements: ForumAnnouncementRecord[]) {
  return announcements
    .map((announcement) => `${announcement._id}:${announcement.updatedAt}`)
    .join("|");
}

export function ForumUserCpShell({
  children,
  description,
  title,
}: {
  children: ReactNode;
  description: string;
  title: string;
}) {
  const pathname = usePathname();
  const normalizedPathname = normalizedForumPathname(pathname);
  const items = [
    { href: "/forum/control-panel", label: "Profile settings", icon: UserRound },
    { href: "/forum/control-panel/agent-access", label: "Agent access", icon: Bot },
    { href: "/forum/messages", label: "Private messages", icon: Mail },
    { href: "/forum/subscriptions", label: "Subscriptions", icon: Bell },
    { href: "/forum/saved", label: "Saved threads", icon: Bookmark },
  ];

  return (
    <div className="forum-account-space">
      <ForumChrome />
      <header className="forum-account-heading">
        <ForumLink href="/forum" className="focus-ring text-xs text-muted-foreground hover:text-foreground">← Back to forum</ForumLink>
        <h1>{title}</h1>
        <p>{description}</p>
      </header>
      <nav aria-label="Forum user control panel" className="forum-account-navigation">
        {items.map(({ href, label, icon: Icon }) => (
          <ForumLink
            aria-current={normalizedPathname === href ? "page" : undefined}
            className="focus-ring forum-account-link"
            href={href} key={href} prefetch
          >
            <Icon aria-hidden="true" size={16} />
            <span>{label}</span>
          </ForumLink>
        ))}
      </nav>
      <div className="forum-account-content">{children}</div>
    </div>
  );
}

export function ForumPaginationBar({
  buildHref,
  className,
  label,
  nextLabel = "Older",
  pagination,
  previousLabel = "Newer",
}: {
  buildHref: (page: number) => string;
  className?: string;
  label: string;
  nextLabel?: string;
  pagination: ForumPaginationRecord;
  previousLabel?: string;
}) {
  const pages = visiblePages(pagination.page, pagination.totalPages);

  return (
    <nav
      aria-label={`${label} pagination`}
      className={cn(
        "flex flex-col gap-2 py-2 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <p>
        {label} {pagination.startItem}-{pagination.endItem} of{" "}
        {pagination.actualTotalItems ?? pagination.totalItems}
        {pagination.limited ? (
          <span className="ml-2 text-primary">
            Showing newest {pagination.totalItems}
          </span>
        ) : null}
      </p>
      <div className="flex w-full flex-wrap items-center gap-1 sm:w-auto">
        <Button
          asChild={pagination.hasPreviousPage}
          className="min-h-11 rounded-none px-3 text-xs "
          disabled={!pagination.hasPreviousPage}
          size="sm"
          variant="outline"
        >
          {pagination.hasPreviousPage ? (
            <ForumLink href={buildHref(pagination.page - 1)} prefetch>
              {previousLabel}
            </ForumLink>
          ) : (
            <span>{previousLabel}</span>
          )}
        </Button>
        {pages.map((page, index) => (
          <Fragment key={page}>
            {index > 0 && page - pages[index - 1] > 1 ? (
              <span aria-hidden="true" className="px-0.5 text-muted-foreground">
                …
              </span>
            ) : null}
            <Button
              asChild={page !== pagination.page}
              className={cn(
                "min-h-11 min-w-11 rounded-none px-2 text-xs ",
                page === pagination.page && "border-primary text-primary",
              )}
              disabled={page === pagination.page}
              size="sm"
              variant="outline"
            >
              {page === pagination.page ? (
                <span aria-current="page">{page}</span>
              ) : (
                <ForumLink href={buildHref(page)} prefetch>
                  {page}
                </ForumLink>
              )}
            </Button>
          </Fragment>
        ))}
        <Button
          asChild={pagination.hasNextPage}
          className="min-h-11 rounded-none px-3 text-xs "
          disabled={!pagination.hasNextPage}
          size="sm"
          variant="outline"
        >
          {pagination.hasNextPage ? (
            <ForumLink href={buildHref(pagination.page + 1)} prefetch>
              {nextLabel}
            </ForumLink>
          ) : (
            <span>{nextLabel}</span>
          )}
        </Button>
        {pagination.totalPages > 1 ? (
          <Button
            asChild={pagination.page !== pagination.totalPages}
            className="min-h-11 rounded-none px-3 text-xs "
            disabled={pagination.page === pagination.totalPages}
            size="sm"
            variant="outline"
          >
            {pagination.page === pagination.totalPages ? (
              <span>Last</span>
            ) : (
              <ForumLink href={buildHref(pagination.totalPages)} prefetch>
                Last
              </ForumLink>
            )}
          </Button>
        ) : null}
      </div>
    </nav>
  );
}

export function ForumBody({
  body,
  className,
}: {
  body: string;
  className?: string;
}) {
  if (body.trim().length === 0) {
    return (
      <p className={cn("text-sm leading-6 text-muted-foreground", className)}>
        No message body yet.
      </p>
    );
  }

  return (
    <div
      className={cn("min-w-0 space-y-4 text-base leading-[1.625]", className)}
    >
      <ForumBbcodeBody body={body} />
    </div>
  );
}

function visiblePages(currentPage: number, totalPages: number) {
  const pages = new Set<number>([1, currentPage, totalPages]);
  for (
    let page = Math.max(1, currentPage - 1);
    page <= Math.min(totalPages, currentPage + 1);
    page += 1
  ) {
    pages.add(page);
  }
  return [...pages].sort((left, right) => left - right);
}

export function ForumThreadStateBadges({
  thread,
  className,
  showUnread = true,
}: {
  thread: ForumThreadSummaryRecord | null;
  className?: string;
  showUnread?: boolean;
}) {
  if (!thread) {
    return null;
  }

  const pinned = isPinnedThread(thread);
  const locked = isLockedThread(thread);
  const unread = showUnread && thread.viewerUnread === true;

  if (!pinned && !locked && !unread) {
    return null;
  }

  return (
    <div className={cn("flex flex-wrap gap-1", className)}>
      {pinned ? <ForumStateToken label="Pinned" tone="muted" /> : null}
      {locked ? <ForumStateToken label="Locked" tone="primary" /> : null}
      {unread ? <ForumStateToken label="Unread" tone="primarySolid" /> : null}
    </div>
  );
}

export function ForumThreadPrefixBadge({
  thread,
  className,
}: {
  thread: { prefix?: ForumThreadPrefixRecord | null } | null;
  className?: string;
}) {
  const prefix = thread?.prefix;
  if (!prefix) {
    return null;
  }

  return (
    <span
      className={cn(
        "inline-flex min-h-5 shrink-0 items-center px-1.5 text-xs leading-none text-muted-foreground",
        className,
      )}
      style={
        prefix.color
          ? { borderColor: prefix.color, color: prefix.color }
          : undefined
      }
    >
      [{prefix.label}]
    </span>
  );
}

export function ForumJumpLink({
  ariaLabel,
  children,
  className,
  href,
}: {
  ariaLabel: string;
  children: ReactNode;
  className?: string;
  href: string;
}) {
  return (
    <ForumLink
      aria-label={ariaLabel}
      className={cn(
        "focus-ring inline-flex min-h-11 items-center justify-center px-3 text-xs leading-none text-muted-foreground hover:text-primary",
        className,
      )}
      href={href}
      prefetch
    >
      {children}
    </ForumLink>
  );
}

function ForumStateToken({
  label,
  tone,
}: {
  label: string;
  tone: "muted" | "primary" | "primarySolid";
}) {
  return (
    <span
      className={cn(
        "inline-flex min-h-5 items-center px-1.5 text-xs leading-none",
        tone === "muted" && "bg-muted/50 text-muted-foreground",
        tone === "primary" && "bg-primary/10 text-primary",
        tone === "primarySolid" && "bg-primary text-primary-foreground",
      )}
    >
      {label}
    </span>
  );
}

export function ForumIndexTable({
  categories,
  sections,
}: {
  categories: ForumCategoryRecord[];
  sections?: ForumCategorySectionRecord[];
}) {
  const groups =
    sections && sections.length > 0
      ? sections
      : [
          {
            section: null,
            boards: categories,
            threadCount: categories.reduce(
              (total, category) => total + getCategoryThreadCount(category),
              0,
            ),
            postCount: categories.reduce(
              (total, category) => total + getCategoryPostCount(category),
              0,
            ),
          },
        ];
  const boardCount = groups.reduce(
    (total, group) => total + group.boards.length,
    0,
  );
  const threadCount = groups.reduce(
    (total, group) => total + group.threadCount,
    0,
  );
  const postCount = groups.reduce((total, group) => total + group.postCount, 0);
  const sectionCount =
    groups.filter((group) => group.section !== null).length || groups.length;

  if (boardCount === 0) {
    return (
      <ForumStatusBox
        title="Boards"
        body="No categories are published yet. Once the forum data lands, the board index will render here."
      />
    );
  }

  return (
    <div className="space-y-10">
      {groups.map((group, index) => (
        <ForumIndexSection
          key={group.section?.slug ?? `root-${index}`}
          group={group}
        />
      ))}
      <ForumLegendStatStrip
        stats={[
          { label: "Sections", value: sectionCount },
          { label: "Boards", value: boardCount },
          { label: "Threads", value: threadCount },
          { label: "Posts", value: postCount },
        ]}
      />
    </div>
  );
}

export function ForumLegendStatStrip({
  className,
  stats = [],
}: {
  className?: string;
  stats?: Array<{ label: string; value: number | string }>;
}) {
  const legendItems: Array<{ label: string; state: ForumStatusState }> = [
    { label: "Unread board", state: "board-active" },
    { label: "Read board", state: "board-empty" },
    { label: "Unread thread", state: "thread-unread" },
    { label: "Pinned thread", state: "thread-pinned" },
    { label: "Locked thread", state: "thread-locked" },
  ];

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-4 pt-4",
        className,
      )}
    >
      <div className="bg-background px-3 py-2">
        <p className="sr-only">Forum legend</p>
        <div className="flex flex-wrap gap-x-3 gap-y-1.5">
          {legendItems.map((item) => (
            <div
              className="flex items-center gap-1.5 text-xs text-muted-foreground"
              key={item.label}
            >
              <ForumStatusGlyph
                className="size-7"
                decorative
                state={item.state}
              />
              <span>{item.label}</span>
            </div>
          ))}
        </div>
      </div>
      {stats.length > 0 ? (
        <dl className="flex flex-wrap gap-5">
          {stats.map((item) => (
            <div className="min-w-20 bg-background px-3 py-2" key={item.label}>
              <dt className="text-xs text-muted-foreground">{item.label}</dt>
              <dd className="mt-0.5 text-sm font-semibold">
                {typeof item.value === "number"
                  ? formatForumCount(item.value)
                  : item.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}

function ForumIndexSection({ group }: { group: ForumCategorySectionRecord }) {
  const heading = group.section
    ? getCategoryTitle(group.section)
    : "Main boards";
  return (
    <section
      aria-label={group.section ? `${heading} boards` : heading}
      className="space-y-5"
    >
      <h2 className="text-sm font-medium text-muted-foreground">{heading}</h2>
      {group.boards.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No boards in this section yet.
        </p>
      ) : (
        <ul className="space-y-7">
          {group.boards.map((category) => (
            <li key={category.slug}>
              <ForumBoardRow category={category} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ForumBoardRow({ category }: { category: ForumCategoryRecord }) {
  const latestThread = getCategoryLatestThread(category);
  return (
    <article className="grid min-w-0 gap-3 md:grid-cols-[minmax(0,1fr)_minmax(12rem,0.6fr)] md:gap-8">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <ForumStatusGlyph
            className="size-5"
            state={categoryBoardStatusState(category)}
          />
          <h3 className="min-w-0">
            <ForumLink
              href={forumPath(category.slug)}
              prefetch
              className="focus-ring inline-flex min-h-11 items-center break-words text-xl font-semibold leading-7 hover:text-primary"
            >
              {getCategoryTitle(category)}
            </ForumLink>
          </h3>
        </div>
        {getCategoryDescription(category) ? (
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
            {getCategoryDescription(category)}
          </p>
        ) : null}
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>
            {formatForumCount(getCategoryThreadCount(category))} threads
          </span>
          <span>{formatForumCount(getCategoryPostCount(category))} posts</span>
          <ForumCategoryAccessBadges category={category} />
        </div>
        <ForumSubforumLinks category={category} />
      </div>
      {latestThread ? (
        <div className="min-w-0 md:pt-2">
          <ForumLatestPostCell
            category={category}
            latestThread={latestThread}
          />
        </div>
      ) : null}
    </article>
  );
}

function categoryBoardStatusState(
  category: ForumCategoryRecord,
): ForumStatusState {
  if (categoryHasViewerReadState(category)) {
    return categoryHasUnreadContent(category) ? "board-active" : "board-empty";
  }
  return categoryHasBoardActivity(category) ? "board-active" : "board-empty";
}

function categoryHasViewerReadState(category: ForumCategoryRecord): boolean {
  return (
    category.viewerUnread !== undefined ||
    (category.children ?? []).some(categoryHasViewerReadState)
  );
}

function categoryHasUnreadContent(category: ForumCategoryRecord): boolean {
  return (
    category.viewerUnread === true ||
    (category.children ?? []).some(categoryHasUnreadContent)
  );
}

function categoryHasBoardActivity(category: ForumCategoryRecord): boolean {
  return (
    getCategoryLatestThread(category) !== null ||
    (category.children ?? []).some(categoryHasBoardActivity)
  );
}

function ForumLatestPostCell({
  category,
  latestThread,
}: {
  category: ForumCategoryRecord;
  latestThread: ForumThreadSummaryRecord | null;
}) {
  const latestThreadCategorySlug = latestThread?.categorySlug ?? category.slug;
  const latestPostHref = latestThread
    ? getThreadLastPostHref(latestThread, latestThreadCategorySlug)
    : null;
  const latestAuthor = getThreadLastAuthor(latestThread);
  const latestActivityAt = getThreadLastActivityAt(latestThread);
  const latestMetadata = [
    latestAuthor === "SYM-UNKNOWN" ? null : latestAuthor,
    typeof latestActivityAt === "number"
      ? formatForumDateTime(latestActivityAt)
      : null,
  ].filter((value): value is string => Boolean(value));

  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground md:hidden">Latest thread</p>
      {latestThread ? (
        <div className="mt-1 min-w-0 md:mt-0">
          <div className="flex min-w-0 items-start gap-1.5">
            <ForumLink
              href={forumPath(latestThreadCategorySlug, latestThread.slug)}
              prefetch
              className="focus-ring line-clamp-2 min-w-0 flex-1 text-sm font-semibold leading-5 hover:text-primary"
            >
              {latestThread.title}
            </ForumLink>
            {latestPostHref ? (
              <ForumJumpLink
                ariaLabel={`Last » — Go to last post in ${latestThread.title}`}
                className="min-h-9 shrink-0 px-2 md:min-h-7"
                href={latestPostHref}
              >
                Last »
              </ForumJumpLink>
            ) : null}
          </div>
          {latestMetadata.length > 0 ? (
            <p className="mt-0.5 line-clamp-1 text-xs leading-4 text-muted-foreground">
              {latestMetadata.join(" · ")}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="mt-1 text-xs text-muted-foreground md:mt-0">
          No posts yet.
        </p>
      )}
    </div>
  );
}

function ForumSubforumLinks({ category }: { category: ForumCategoryRecord }) {
  const children = category.children ?? [];
  if (children.length === 0) {
    return null;
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs leading-5">
      <span className="mr-0.5 text-muted-foreground">Sub-boards</span>
      {children.map((child) => (
        <ForumLink
          key={child.slug}
          href={forumPath(child.slug)}
          prefetch
          className="focus-ring inline-flex min-h-11 items-center gap-1 text-foreground hover:text-primary"
        >
          <span>{getCategoryTitle(child)}</span>
          <span className="text-muted-foreground">
            {formatForumCount(getCategoryThreadCount(child))}/
            {formatForumCount(getCategoryPostCount(child))}
          </span>
        </ForumLink>
      ))}
    </div>
  );
}

function ForumCategoryAccessBadges({
  category,
  className,
}: {
  category: ForumCategoryRecord;
  className?: string;
}) {
  const tokens = [];
  if (category.viewAccess && category.viewAccess !== "public") {
    tokens.push(`${category.viewAccess} view`);
  }
  if (category.threadAccess && category.threadAccess !== "members") {
    tokens.push(`${category.threadAccess} threads`);
  }
  if (category.replyAccess && category.replyAccess !== "members") {
    tokens.push(`${category.replyAccess} replies`);
  }
  if (category.pollAccess && category.pollAccess !== "members") {
    tokens.push(`${category.pollAccess} polls`);
  }

  if (tokens.length === 0) {
    return null;
  }

  return (
    <div className={cn("flex flex-wrap gap-1", className)}>
      {tokens.map((token) => (
        <ForumStateToken key={token} label={token} tone="muted" />
      ))}
    </div>
  );
}

export function ForumNewestThreads({
  threads,
  heading = "Newest threads",
}: {
  threads: ForumThreadSummaryRecord[];
  heading?: string;
}) {
  return (
    <section className="py-4">
      <div className="text-xs text-muted-foreground">{heading}</div>
      {threads.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">
          No active threads yet.
        </p>
      ) : (
        <div className="mt-5 space-y-7">
          {threads.map((thread) => (
            <div
              key={`${thread.categorySlug ?? "forum"}-${thread.slug}`}
              className="py-2.5"
            >
              <div className="flex flex-wrap items-center gap-2">
                <ForumThreadPrefixBadge thread={thread} />
                <ForumLink
                  href={forumPath(thread.categorySlug, thread.slug)}
                  prefetch
                  className="focus-ring inline-flex min-h-11 min-w-0 items-center text-xl font-semibold leading-7 hover:text-primary"
                >
                  {thread.title}
                </ForumLink>
                <ForumThreadStateBadges thread={thread} />
              </div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {thread.categoryName ??
                  (thread.categorySlug
                    ? humanizeSlug(thread.categorySlug)
                    : "General")}
                {" · "}
                {getThreadAuthor(thread)}
                {" · "}
                {formatForumDateTime(getThreadStartedAt(thread))}
              </p>
              {thread.excerpt ? (
                <p className="mt-1 line-clamp-2 text-sm leading-5 text-muted-foreground">
                  {thread.excerpt}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function ForumThreadTable({
  category,
  density = "standard",
  showFooter = true,
  variant = "stream",
  threads,
}: {
  variant?: "stream" | "grouped";
  category: ForumCategoryRecord | null;
  density?: "compact" | "standard";
  showFooter?: boolean;
  threads: ForumThreadSummaryRecord[];
}) {
  if (threads.length === 0) {
    return (
      <ForumStatusBox
        title={category ? getCategoryTitle(category) : "Threads"}
        body="This board has no public threads yet."
      />
    );
  }
  return (
    <div
      className="space-y-4"
      aria-label={
        category ? `${getCategoryTitle(category)} threads` : "Forum threads"
      }
    >
      {getForumThreadSections(threads).map((section) => (
        <section
          key={section.key}
          className={
            variant === "grouped" ? "forum-panel min-w-0 !p-0" : "min-w-0"
          }
          aria-label={section.label}
        >
          {section.showHeader ? (
            <h3
              className={
                variant === "grouped"
                  ? "px-4 py-3 text-xs font-medium text-muted-foreground"
                  : "text-sm font-medium text-muted-foreground"
              }
            >
              <ForumThreadSectionLabel section={section} />
            </h3>
          ) : null}
          {section.threads.map((thread) => (
            <ForumThreadRow
              key={thread._id}
              category={category}
              density={density}
              variant={variant}
              thread={thread}
            />
          ))}
        </section>
      ))}
      {showFooter ? (
        <p className="text-xs text-muted-foreground">
          {formatForumCount(threads.length)} threads ·{" "}
          {formatForumCount(
            threads.reduce(
              (total, thread) => total + getThreadReplyCount(thread),
              0,
            ),
          )}{" "}
          replies
        </p>
      ) : null}
    </div>
  );
}

function ForumThreadRow({
  category,
  density,
  variant,
  thread,
}: {
  variant: "stream" | "grouped";
  category: ForumCategoryRecord | null;
  density: "compact" | "standard";
  thread: ForumThreadSummaryRecord;
}) {
  const categorySlug = thread.categorySlug ?? category?.slug;
  const displayAuthor =
    thread.authorDisplayName ??
    thread.authorName ??
    thread.createdByName ??
    thread.author ??
    getThreadAuthor(thread);
  const firstUnreadHref =
    thread.viewerUnread === true && thread.firstUnreadPostNumber
      ? forumPostPath(
          categorySlug,
          thread.slug,
          thread.firstUnreadPostNumber,
          thread.firstUnreadPage,
        )
      : null;
  return (
    <article
      className={cn(
        "forum-discussion-row grid min-w-0 grid-cols-[32px_minmax(0,1fr)] items-start gap-x-3 rounded-xl px-3 py-3 transition-colors hover:bg-muted/45 sm:grid-cols-[36px_minmax(0,1fr)_48px_125px] sm:px-4",
        isPinnedThread(thread) && "bg-primary/[0.035]",
        variant === "stream" && "sm:px-2",
      )}
    >
      <div className="relative pt-1">
        {thread.viewerUnread === false ? (
          <span className="sr-only" aria-label="Read thread" role="img">
            Read thread
          </span>
        ) : null}
        <ForumAvatar
          alt={`${displayAuthor} avatar`}
          name={displayAuthor}
          src={thread.authorImage}
          className="size-8 rounded-full sm:size-9"
        />
        {thread.viewerUnread ? (
          <span
            className="absolute right-0 top-1 size-2 rounded-full bg-primary ring-2 ring-background"
            aria-label="Unread thread"
            role="img"
          />
        ) : null}
      </div>
      <div className="min-w-0">
        <h3>
          <ForumLink
            href={forumPath(categorySlug, thread.slug)}
            prefetch
            className="focus-ring flex min-h-11 items-center text-[15px] font-semibold leading-[1.4] hover:text-primary [overflow-wrap:anywhere] sm:text-base"
          >
            {thread.title}
          </ForumLink>
        </h3>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-5 text-muted-foreground">
          <span className="min-w-0 [overflow-wrap:anywhere]">
            {displayAuthor}
          </span>
          {category === null && thread.categorySlug ? (
            <>
              <span aria-hidden="true">·</span>
              <ForumLink
                href={forumPath(thread.categorySlug)}
                prefetch
                className="focus-ring inline-flex min-h-11 items-center hover:text-primary"
              >
                {thread.categoryName ?? humanizeSlug(thread.categorySlug)}
              </ForumLink>
            </>
          ) : null}
          <span className="hidden md:inline">
            · {formatForumDateTime(getThreadStartedAt(thread))}
          </span>
          <ForumThreadPrefixBadge thread={thread} />
          <ForumThreadStateBadges thread={thread} />
        </div>
        {density === "standard" && thread.excerpt ? (
          <p className="mt-1 line-clamp-1 text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]">
            {thread.excerpt}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
          {getThreadRatingCount(thread) > 0 ? (
            <ForumThreadRatingSummary
              average={getThreadRatingAverage(thread)}
              count={getThreadRatingCount(thread)}
            />
          ) : null}
          {firstUnreadHref ? (
            <ForumLink
              aria-label={`First unread » — Go to first unread post in ${thread.title}`}
              href={firstUnreadHref}
              prefetch
              className="focus-ring inline-flex min-h-11 items-center text-primary hover:underline"
            >
              First unread »
            </ForumLink>
          ) : null}
        </div>
      </div>
      <dl className="hidden gap-1 pt-2 text-center sm:grid">
        <div className="flex flex-col gap-1">
          <dt className="order-2 text-[10px] text-muted-foreground">replies</dt>
          <dd className="order-1 font-mono text-base font-medium tabular-nums">
            {formatForumCount(getThreadReplyCount(thread))}
          </dd>
        </div>
        {typeof thread.viewCount === "number" && thread.viewCount > 0 ? (
          <div>
            <dt className="sr-only">Views</dt>
            <dd className="text-[11px] text-muted-foreground">
              {formatForumCount(thread.viewCount)} views
            </dd>
          </div>
        ) : null}
      </dl>
      <div className="col-start-2 flex min-w-0 items-center justify-between gap-x-3 sm:col-start-auto sm:block sm:pt-1">
        <span className="shrink-0 text-[11px] sm:hidden">
          {formatForumCount(getThreadReplyCount(thread))} replies
          {typeof thread.viewCount === "number" && thread.viewCount > 0 ? (
            <> · {formatForumCount(thread.viewCount)} views</>
          ) : null}
        </span>
        <ForumLink
          aria-label={`Last » — Go to last post in ${thread.title}`}
          href={getThreadLastPostHref(thread, categorySlug)}
          prefetch
          className="focus-ring inline-flex min-h-11 min-w-0 flex-1 items-center justify-end gap-2 text-xs text-muted-foreground hover:text-primary sm:flex sm:items-start sm:pt-2"
        >
          <span className="min-w-0 text-right">
            <span className="block truncate">
              <span className="sm:hidden">Latest: </span>
              {getThreadLastAuthor(thread)}
            </span>
            <span className="mt-0.5 block text-[10px] leading-4">
              {formatForumDateTime(getThreadLastActivityAt(thread))}
            </span>
          </span>
        </ForumLink>
      </div>
    </article>
  );
}

type ForumThreadSection = {
  key: "important" | "regular";
  label: string;
  threads: ForumThreadSummaryRecord[];
  emphasized: boolean;
  showHeader: boolean;
};

function getForumThreadSections(
  threads: ForumThreadSummaryRecord[],
): ForumThreadSection[] {
  const pinnedThreads: ForumThreadSummaryRecord[] = [];
  const regularThreads: ForumThreadSummaryRecord[] = [];

  threads.forEach((thread) => {
    if (isPinnedThread(thread)) {
      pinnedThreads.push(thread);
      return;
    }

    regularThreads.push(thread);
  });

  if (pinnedThreads.length === 0) {
    return [
      {
        key: "regular",
        label: "Forum threads",
        threads: regularThreads,
        emphasized: false,
        showHeader: false,
      },
    ];
  }

  const sections: ForumThreadSection[] = [
    {
      key: "important",
      label: "Important threads",
      threads: pinnedThreads,
      emphasized: true,
      showHeader: true,
    },
  ];

  if (regularThreads.length > 0) {
    sections.push({
      key: "regular",
      label: "Forum threads",
      threads: regularThreads,
      emphasized: false,
      showHeader: true,
    });
  }

  return sections;
}

function ForumThreadSectionLabel({ section }: { section: ForumThreadSection }) {
  return (
    <span className="flex items-center justify-between gap-3">
      <span>{section.label}</span>
      <span className={"text-muted-foreground"}>
        {formatForumCount(section.threads.length)}{" "}
        {section.threads.length === 1 ? "thread" : "threads"}
      </span>
    </span>
  );
}

export function ForumPostFrame({
  actions,
  author,
  authorHref,
  avatarUrl,
  location,
  id,
  joinedAt,
  postCount,
  rank,
  reputationScore,
  role,
  signature,
  timestamp,
  postNumber,
  children,
  variant = "plain",
}: {
  variant?: "plain" | "grouped";
  actions?: ReactNode;
  author: string;
  authorHref?: string;
  avatarUrl?: string;
  location?: string;
  id?: string;
  joinedAt?: number;
  postCount?: number;
  rank?: string;
  reputationScore?: number;
  role?: string;
  signature?: string;
  timestamp: string;
  postNumber: number;
  children: ReactNode;
}) {
  const normalizedRole = role?.trim();
  const authorLabel =
    normalizedRole?.startsWith("AI Agent") === true
      ? normalizedRole
      : (rank ?? normalizedRole ?? "Member");
  const showRoleStat =
    normalizedRole !== undefined &&
    normalizedRole !== authorLabel &&
    normalizedRole.toLowerCase() !== "member";

  const showAuthorLabel = !["member", "forum member"].includes(
    authorLabel.trim().toLowerCase(),
  );

  return (
    <article
      className={cn(
        "forum-reader min-w-0 scroll-mt-32",
        variant === "grouped" ? "forum-post-card forum-panel !py-3" : "py-4",
      )}
      id={id}
      aria-label={`Post ${postNumber} by ${author}`}
    >
      <header
        className={cn(
          "flex flex-wrap items-center gap-3 text-xs text-muted-foreground",
          variant === "grouped" && "items-start",
        )}
      >
        <ForumAvatar
          alt={`${author} avatar`}
          className="size-9 rounded-full sm:size-10"
          name={author}
          src={avatarUrl}
        />
        <div className="min-w-0 flex-1">
          {authorHref ? (
            <ForumLink
              href={authorHref}
              prefetch
              title={author}
              className="focus-ring flex min-h-11 min-w-0 items-center text-sm font-semibold text-foreground hover:text-primary"
            >
              <span className="truncate">{author}</span>
            </ForumLink>
          ) : (
            <span className="flex min-h-11 min-w-0 items-center text-sm font-semibold text-foreground">
              <span className="truncate" title={author}>
                {author}
              </span>
            </span>
          )}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] leading-5">
            {showAuthorLabel ? (
              <span
                className={
                  normalizedRole?.startsWith("AI Agent")
                    ? "text-primary"
                    : "text-muted-foreground"
                }
              >
                {authorLabel}
              </span>
            ) : null}
            <span>{timestamp}</span>
          </div>
        </div>
        {id ? (
          <a
            className="focus-ring inline-flex min-h-11 min-w-11 items-center justify-center text-[11px] text-muted-foreground hover:text-primary"
            href={`#${id}`}
            aria-label={`Permalink to post ${postNumber}`}
          >
            #{postNumber}
          </a>
        ) : (
          <span>#{postNumber}</span>
        )}
      </header>
      <div
        className={cn(
          "min-w-0 max-w-[75ch] text-[15px] leading-7",
          variant === "grouped" ? "pt-3" : "mt-4",
        )}
      >
        {children}
      </div>
      <footer className="mt-3 flex flex-wrap items-center gap-1">
        {actions}
        <details
          className="group min-w-0 text-xs text-muted-foreground open:basis-full"
          onKeyDown={handleForumDisclosureKeyDown}
        >
          <summary
            aria-label={`About ${author}`}
            className="focus-ring inline-flex min-h-11 min-w-0 max-w-full cursor-pointer items-center gap-1 rounded-full px-2 hover:bg-muted/40 hover:text-foreground"
          >
            Profile
            <ChevronDown
              aria-hidden="true"
              className="ml-1.5 size-3.5 transition-transform group-open:rotate-180"
            />
          </summary>
          <div className="mb-3 rounded-xl bg-muted/30 px-4 py-3">
            <dl className="flex flex-wrap gap-x-5 gap-y-2">
              {showRoleStat ? (
                <div className="inline-flex gap-1.5">
                  <dt>Role</dt>
                  <dd className="text-foreground">{normalizedRole}</dd>
                </div>
              ) : null}
              {typeof postCount === "number" ? (
                <div className="inline-flex gap-1.5">
                  <dt>Posts</dt>
                  <dd className="text-foreground">
                    {formatForumCount(postCount)}
                  </dd>
                </div>
              ) : null}
              {typeof reputationScore === "number" ? (
                <div className="inline-flex gap-1.5">
                  <dt>Reputation</dt>
                  <dd className="text-foreground">
                    {reputationScore > 0 ? "+" : ""}
                    {formatForumCount(reputationScore)}
                  </dd>
                </div>
              ) : null}
              {location ? (
                <div className="inline-flex gap-1.5">
                  <dt>Location</dt>
                  <dd className="break-words text-foreground">{location}</dd>
                </div>
              ) : null}
              {typeof joinedAt === "number" ? (
                <div className="inline-flex gap-1.5">
                  <dt>Joined</dt>
                  <dd className="text-foreground">
                    {formatForumDateTime(joinedAt)}
                  </dd>
                </div>
              ) : null}
            </dl>
            <ForumAuthorRailShortcuts author={author} authorHref={authorHref} />
            {signature ? (
              <div className="mt-3">
                <p className="mb-2 font-medium">Signature</p>
                <ForumBody
                  body={signature}
                  className="text-sm leading-6 text-muted-foreground"
                />
              </div>
            ) : null}
          </div>
        </details>
      </footer>
    </article>
  );
}

function ForumAuthorRailShortcuts({
  author,
  authorHref,
}: {
  author: string;
  authorHref?: string;
}) {
  const username = forumUsernameFromProfileHref(authorHref);
  const authorActions = [
    authorHref
      ? {
          href: authorHref,
          kind: "profile" as const,
          label: "Profile",
        }
      : null,
    username
      ? {
          href: forumPrivateMessageHref(username),
          kind: "forum" as const,
          label: "PM",
        }
      : null,
    username
      ? {
          href: forumAuthorSearchHref(username, "replies"),
          kind: "forum" as const,
          label: "Find posts",
        }
      : null,
    username
      ? {
          href: forumAuthorSearchHref(username, "threads"),
          kind: "forum" as const,
          label: "Find threads",
        }
      : null,
  ].filter(
    (
      action,
    ): action is {
      href: string;
      kind: "forum" | "profile";
      label: string;
    } => action !== null,
  );

  if (authorActions.length === 0) {
    return null;
  }

  return (
    <nav
      aria-label={`${author} forum shortcuts`}
      className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs"
    >
      {authorActions.map((action) =>
        action.kind === "forum" ? (
          <ForumLink
            className="focus-ring inline-flex min-h-11 items-center text-muted-foreground hover:text-primary"
            href={action.href}
            key={action.label}
            prefetch
          >
            {action.label}
          </ForumLink>
        ) : (
          <ForumLink
            className="focus-ring inline-flex min-h-11 items-center text-muted-foreground hover:text-primary"
            href={action.href}
            key={action.label}
            prefetch
          >
            {action.label}
          </ForumLink>
        ),
      )}
    </nav>
  );
}

function forumUsernameFromProfileHref(authorHref?: string) {
  if (!authorHref) {
    return null;
  }
  const pathname = authorHref.split(/[?#]/)[0] ?? "";
  const profilePrefixes = ["/forum/members/", "/members/", "/u/"];
  const matchingPrefix = profilePrefixes.find((prefix) =>
    pathname.startsWith(prefix),
  );
  if (matchingPrefix === undefined) {
    return null;
  }
  const encodedUsername = pathname.slice(matchingPrefix.length).split("/")[0];
  if (!encodedUsername) {
    return null;
  }
  try {
    return decodeURIComponent(encodedUsername);
  } catch {
    return encodedUsername;
  }
}

function forumPrivateMessageHref(username: string) {
  const params = new URLSearchParams({
    compose: "1",
    recipient: username,
  });
  return `/forum/messages?${params}`;
}

function forumAuthorSearchHref(username: string, type: "threads" | "replies") {
  const params = new URLSearchParams({
    author: username,
    type,
  });
  return `/forum/search?${params}`;
}

export function ForumAttachmentList({
  attachments,
}: {
  attachments?: ForumAttachmentRecord[];
}) {
  return <ForumMediaGallery attachments={attachments} />;
}

export function ForumAvatar({
  alt,
  className,
  name,
  src,
}: {
  alt?: string;
  className?: string;
  name: string;
  src?: string;
}) {
  const imageUrl = safeImageUrl(src);
  const initials = forumAvatarInitials(name);

  return (
    <span
      className={cn(
        "relative flex size-12 shrink-0 items-center justify-center overflow-hidden border border-row-border bg-muted/30 font-mono text-xs uppercase text-muted-foreground",
        className,
      )}
    >
      {imageUrl ? (
        imageUrl.startsWith("/images/") ? (
          <Image
            alt={alt ?? `${name} avatar`}
            className="size-full object-cover"
            height={48}
            loading="lazy"
            sizes="48px"
            src={imageUrl}
            width={48}
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- Auth avatars may come from hosts outside next/image config.
          <img
            alt={alt ?? `${name} avatar`}
            className="size-full object-cover"
            loading="lazy"
            referrerPolicy="no-referrer"
            src={imageUrl}
          />
        )
      ) : (
        <span>{initials}</span>
      )}
    </span>
  );
}

function forumAvatarInitials(name: string) {
  const cleaned = name.trim();
  if (!cleaned) {
    return "SYM";
  }
  const parts = cleaned
    .split(/[\s_-]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const initials = parts
    .slice(0, 2)
    .map((part) => part[0])
    .join("");
  return (initials || cleaned.slice(0, 2)).toUpperCase();
}

type ForumStatusState =
  | "board-active"
  | "board-empty"
  | "thread-unread"
  | "thread-locked"
  | "thread-pinned"
  | "thread-normal";

function ForumStatusGlyph({
  className,
  decorative = false,
  state,
  thread,
}: {
  className?: string;
  decorative?: boolean;
  state?: ForumStatusState;
  thread?: ForumThreadSummaryRecord;
}) {
  const resolvedState =
    state ??
    (thread?.viewerUnread === true
      ? "thread-unread"
      : thread && isLockedThread(thread)
        ? "thread-locked"
        : thread && isPinnedThread(thread)
          ? "thread-pinned"
          : "thread-normal");
  const label = statusGlyphLabel(resolvedState);
  const isBoard =
    resolvedState === "board-active" || resolvedState === "board-empty";

  return (
    <div
      className={cn(
        "flex size-8 shrink-0 items-center justify-center bg-background",
        (resolvedState === "board-active" ||
          resolvedState === "thread-unread") &&
          "border-primary",
        resolvedState === "thread-locked" &&
          "border-foreground text-foreground",
        resolvedState === "thread-pinned" &&
          "border-muted-foreground text-foreground",
        className,
      )}
      aria-hidden={decorative ? true : undefined}
      title={decorative ? undefined : label}
    >
      {isBoard ? (
        <ForumFolderGlyph state={resolvedState} />
      ) : (
        <ForumThreadGlyph state={resolvedState} />
      )}
      {decorative ? null : <span className="sr-only">{label}</span>}
    </div>
  );
}

function statusGlyphLabel(state: ForumStatusState) {
  switch (state) {
    case "board-active":
      return "Board with unread posts";
    case "board-empty":
      return "Board with no unread posts";
    case "thread-unread":
      return "Thread with unread posts";
    case "thread-locked":
      return "Locked thread";
    case "thread-pinned":
      return "Pinned thread";
    case "thread-normal":
      return "Thread";
  }
}

function ForumFolderGlyph({ state }: { state: ForumStatusState }) {
  const active = state === "board-active";

  return (
    <span aria-hidden className="relative block h-5 w-6">
      <span
        className={cn(
          "absolute left-0 top-0 h-2 w-3 border border-b-0 bg-background",
          active ? "border-primary" : "border-muted-foreground",
        )}
      />
      <span
        className={cn(
          "absolute bottom-0 left-0 h-4 w-6 border bg-background",
          active
            ? "border-primary bg-primary/10"
            : "border-muted-foreground bg-muted/20",
        )}
      />
      {active ? (
        <span className="absolute bottom-1.5 right-1.5 size-1.5 bg-primary" />
      ) : null}
    </span>
  );
}

function ForumThreadGlyph({ state }: { state: ForumStatusState }) {
  const unread = state === "thread-unread";
  const locked = state === "thread-locked";
  const pinned = state === "thread-pinned";

  return (
    <span
      aria-hidden
      className={cn(
        "relative block h-5 w-4 border bg-background",
        unread ? "border-primary bg-primary/10" : "border-muted-foreground",
        locked && "border-foreground",
      )}
    >
      <span
        className={cn(
          "absolute right-[-1px] top-[-1px] size-2 border border-r-0 border-t-0 bg-background",
          unread ? "border-primary" : "border-muted-foreground",
          locked && "border-foreground",
        )}
      />
      {unread ? (
        <span className="absolute bottom-1 left-1 size-1.5 bg-primary" />
      ) : null}
      {locked ? (
        <span className="absolute bottom-1 left-1 right-1 h-1 bg-foreground" />
      ) : null}
      {pinned ? (
        <span className="absolute left-1 right-1 top-1 h-1 bg-muted-foreground" />
      ) : null}
    </span>
  );
}

function ForumTableSkeleton({
  label,
  rows,
}: {
  kind: "boards" | "threads";
  label: string;
  rows: number;
}) {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className="space-y-3"
      role="status"
    >
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }).map((_, index) => (
        <div className="flex min-w-0 gap-3 px-3 py-3" key={index}>
          <SkeletonBox className="size-8 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-3">
            <SkeletonBox className="h-5 w-4/5" />
            <SkeletonBox className="h-3 w-1/2" />
            <SkeletonBox className="h-3 w-3/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

function ForumThreadSkeleton({ label }: { label: string }) {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className="space-y-3"
      role="status"
    >
      <span className="sr-only">{label}</span>
      <SkeletonBox className="h-8 w-3/5 max-w-xl" />
      {Array.from({ length: 3 }).map((_, index) => (
        <div className="forum-panel space-y-4" key={index}>
          <div className="flex items-center gap-3">
            <SkeletonBox className="size-9 rounded-full sm:size-10" />
            <SkeletonBox className="h-4 w-32" />
          </div>
          <SkeletonBox className="h-4 w-full max-w-[70ch]" />
          <SkeletonBox className="h-4 w-5/6" />
          <SkeletonBox className="h-4 w-2/3" />
        </div>
      ))}
    </div>
  );
}

function ForumUserCpSkeleton({ label }: { label: string }) {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className="grid gap-8 lg:grid-cols-[14rem_minmax(0,1fr)]"
      role="status"
    >
      <span className="sr-only">{label}</span>
      <aside className="space-y-3 bg-background p-3">
        <p className="text-xs text-muted-foreground">{label}</p>
        <SkeletonBox className="h-8 w-full" />
        <SkeletonBox className="h-8 w-full" />
      </aside>
      <div className="space-y-3 bg-background p-3">
        <SkeletonBox className="h-5 w-40" />
        <SkeletonBox className="h-9 w-full" />
        <SkeletonBox className="h-28 w-full" />
        <SkeletonBox className="h-9 w-32" />
      </div>
    </div>
  );
}

function ForumSubscriptionsSkeleton({ label }: { label: string }) {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className="space-y-3"
      role="status"
    >
      <span className="sr-only">{label}</span>
      <div className="py-2 text-xs text-muted-foreground">{label}</div>
      <div className="border border-row-border">
        <div className="flex flex-wrap items-center justify-between gap-2 py-3">
          <div className="space-y-2">
            <SkeletonBox className="h-3 w-36" />
            <SkeletonBox className="h-4 w-56" />
          </div>
          <SkeletonBox className="h-8 w-28" />
        </div>
        <div className="space-y-6">
          {Array.from({ length: 3 }).map((_, index) => (
            <div
              className="grid gap-2 px-3 py-2.5 odd:bg-muted/15 md:grid-cols-[minmax(0,1fr)_9rem_auto] md:items-center"
              key={index}
            >
              <div className="space-y-2">
                <SkeletonBox className="h-3 w-32" />
                <SkeletonBox className="h-4 w-3/5" />
              </div>
              <SkeletonBox className="h-3 w-24" />
              <div className="flex gap-2 md:justify-end">
                <SkeletonBox className="h-7 w-14" />
                <SkeletonBox className="h-7 w-20" />
              </div>
            </div>
          ))}
        </div>
      </div>
      <ForumTableSkeleton kind="threads" label="Subscribed threads" rows={4} />
    </div>
  );
}

function SkeletonBox({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn("bg-muted/60 opacity-70", className)} />
  );
}
