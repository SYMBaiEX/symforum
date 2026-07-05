"use client";

import { ThemeToggle } from "@/components/ThemeToggle";
import { primarySiteHrefForPath } from "@/components/forum/forum-host-url";
import { useForumShellContext } from "@/components/forum/forum-shell-context";
import { Button } from "@/components/ui/button";
import { safeExternalUrl, safeImageUrl } from "@/lib/safe-url";
import { cn } from "@/lib/utils";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { Star } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ReactNode,
  forwardRef,
  useEffect,
  useState,
  type ComponentProps,
  type FormEvent,
} from "react";
import {
  forumAnnouncementPath,
  forumHrefForPathname,
  forumRefs,
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
  type ForumBoardRulesRecord,
  type ForumCategoryRecord,
  type ForumCategorySectionRecord,
  type ForumPaginationRecord,
  type ForumPresenceLocationType,
  type ForumThreadPrefixRecord,
  type ForumThreadSummaryRecord,
} from "@/components/forum/forum-refs";

const FORUM_PRESENCE_HEARTBEAT_MS = 120_000;
const FORUM_SMILIES = new Map([
  [":)", ":)"],
  [":D", ":D"],
  [";)", ";)"],
  [":P", ":P"],
  [":(", ":("],
  [":o", ":o"],
  [":cool:", "cool"],
  [":heart:", "<3"],
]);
const FORUM_JUMP_PLACEHOLDER_VALUE = "__forum_jump__";
const FORUM_JUMP_STATIC_OPTIONS = [
  { href: "/forum", label: "Board index" },
  { href: "/forum/help", label: "Help / FAQ" },
  { href: "/forum/calendar", label: "Calendar" },
  { href: "/forum/new-posts", label: "New posts" },
  { href: "/forum/todays-posts", label: "Today's posts" },
  { href: "/forum/search", label: "Search" },
  { href: "/forum/members", label: "Members" },
  { href: "/forum/online", label: "Who's online" },
  { href: "/forum/announcements", label: "Announcements" },
];
const PRIMARY_SITE_NAV_ITEMS = [
  { href: "/", label: "Main" },
  { href: "/news", label: "News" },
  { href: "/blog", label: "Blog" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
];
const GUEST_FORUM_NAV_STATE: ForumWelcomeNavState = {
  authenticated: false,
  trusted: false,
  canModerate: false,
  canManageBoards: false,
  username: null,
  rank: null,
  postCount: 0,
  reputationScore: 0,
  unreadNotifications: 0,
  unreadNotificationsLimited: false,
  unreadPrivateMessages: 0,
  unreadPrivateMessagesLimited: false,
};

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
        "border border-row-border p-4",
        accent === "cyan" && "border-accent/70 bg-accent/10",
        accent === "canary" && "border-accent-canary/60 bg-accent-canary/10",
        accent === "magenta" && "border-primary/50 bg-primary/10",
      )}
    >
      <p className="font-mono text-[11px] uppercase text-muted-foreground">
        {title}
      </p>
      <p className="mt-2 max-w-3xl text-sm leading-7 text-muted-foreground md:text-base">
        {body}
      </p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

type ForumLoadingVariant =
  | "line"
  | "index"
  | "threads"
  | "thread"
  | "ucp"
  | "subscriptions";

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
      className="border-y border-row-border py-4 font-mono text-[11px] uppercase text-muted-foreground"
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
      className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px] uppercase text-muted-foreground"
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
      {thread ? (
        <>
          <span>/</span>
          <span className="truncate text-foreground">{thread.title}</span>
        </>
      ) : null}
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
    <dl
      className={cn(
        "grid gap-px border border-row-border bg-row-border sm:grid-cols-3",
        className,
      )}
    >
      {items.map((item) => (
        <div key={item.label} className="bg-background px-3 py-3">
          <dt className="font-mono text-[10px] uppercase text-muted-foreground">
            {item.label}
          </dt>
          <dd className="mt-1 text-lg font-semibold">
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
      <span
        aria-hidden="true"
        className="font-mono text-[10px] uppercase text-muted-foreground"
      >
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
  const routeLabel = forumChromeRouteLabel(pathname);

  return (
    <header className={cn("border border-row-border bg-background", className)}>
      <ForumPresenceHeartbeat pathname={pathname} />
      <div className="grid border-b border-row-border bg-foreground text-background lg:grid-cols-[minmax(0,1fr)_22rem]">
        <ForumLink
          href="/forum"
          prefetch
          className="focus-ring block min-w-0 px-4 py-4 hover:text-accent-canary md:px-5"
        >
          <p className="font-mono text-[10px] uppercase text-background/65">
            forum.symbaiex.com
          </p>
          <h1 className="mt-2 text-3xl font-semibold leading-none md:text-5xl">
            SYMBiEX Forum
          </h1>
        </ForumLink>
        <div className="grid grid-cols-3 border-t border-background/25 font-mono text-[10px] uppercase lg:border-l lg:border-t-0">
          <div className="border-r border-background/25 px-3 py-3">
            <span className="block text-background/55">Route</span>
            <span className="mt-1 block text-accent-canary">{routeLabel}</span>
          </div>
          <div className="border-r border-background/25 px-3 py-3">
            <span className="block text-background/55">Host</span>
            <span className="mt-1 block text-accent-cyan">Forum</span>
          </div>
          <div className="px-3 py-3">
            <span className="block text-background/55">Build</span>
            <span className="mt-1 block text-primary">2026</span>
          </div>
        </div>
      </div>
      <div aria-hidden className="grid h-1 grid-cols-3">
        <span className="bg-primary" />
        <span className="bg-accent-cyan" />
        <span className="bg-accent-canary" />
      </div>
      <ForumWelcomeStrip />
      <div className="grid gap-px bg-row-border md:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="bg-background px-4 py-3 md:px-5">
          <p className="font-mono text-[10px] uppercase text-muted-foreground">
            SYMBiEX / Forum / {routeLabel}
          </p>
        </div>
        <div className="bg-background px-4 py-3 font-mono text-[10px] uppercase text-muted-foreground md:px-5 md:text-right">
          Convex board
        </div>
      </div>
      {children ? (
        <div className="border-t border-row-border bg-background px-2 py-2">
          {children}
        </div>
      ) : null}
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
  const { isAuthenticated, isLoading } = useConvexAuth();
  const recordPresence = useMutation(forumRefs.recordPresence);

  useEffect(() => {
    if (isLoading || !isAuthenticated) {
      return;
    }

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
    const interval = window.setInterval(() => {
      void record();
    }, FORUM_PRESENCE_HEARTBEAT_MS);

    return () => {
      canceled = true;
      window.clearInterval(interval);
    };
  }, [isAuthenticated, isLoading, pathname, recordPresence]);

  return null;
}

function ForumWelcomeStrip() {
  const pathname = usePathname();
  const { primarySiteHref } = useForumShellContext();

  if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
    return (
      <ForumWelcomeStripLayout
        navState={GUEST_FORUM_NAV_STATE}
        pathname={pathname}
        primarySiteHref={primarySiteHref}
      />
    );
  }

  return (
    <LiveForumWelcomeStrip
      pathname={pathname}
      primarySiteHref={primarySiteHref}
    />
  );
}

function LiveForumWelcomeStrip({
  pathname,
  primarySiteHref,
}: {
  pathname: string | null;
  primarySiteHref: string;
}) {
  const navState = useQuery(forumRefs.getMyForumNavState, {});

  return (
    <ForumWelcomeStripLayout
      navState={navState}
      pathname={pathname}
      primarySiteHref={primarySiteHref}
    />
  );
}

type ForumWelcomeNavState = {
  authenticated: boolean;
  trusted: boolean;
  canModerate?: boolean;
  canManageBoards?: boolean;
  username: string | null;
  rank: string | null;
  postCount: number;
  reputationScore: number;
  unreadNotifications: number;
  unreadNotificationsLimited: boolean;
  unreadPrivateMessages: number;
  unreadPrivateMessagesLimited: boolean;
};

function ForumWelcomeStripLayout({
  navState,
  pathname,
  primarySiteHref,
}: {
  navState?: ForumWelcomeNavState;
  pathname: string | null;
  primarySiteHref: string;
}) {
  const signInHref = forumSignInHref(pathname);
  const privateMessageBadge = forumNavBadgeLabel(
    navState?.unreadPrivateMessages ?? 0,
    navState?.unreadPrivateMessagesLimited ?? false,
  );
  const subscriptionBadge = forumNavBadgeLabel(
    navState?.unreadNotifications ?? 0,
    navState?.unreadNotificationsLimited ?? false,
  );

  return (
    <div className="grid gap-px border-t border-row-border bg-row-border lg:grid-cols-[minmax(0,1fr)_auto]">
      <div className="bg-muted/20 px-4 py-2 md:px-5">
        <p className="font-mono text-[10px] uppercase leading-5 text-muted-foreground">
          {forumWelcomeMessage(navState)}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-1 bg-background px-2 py-2">
        {navState === undefined ? (
          <span className="inline-flex h-7 items-center border border-transparent px-2 font-mono text-[10px] uppercase text-muted-foreground">
            Session
          </span>
        ) : navState.authenticated ? (
          <>
            <ForumMastheadLink href="/profile" label="Profile" />
            <ForumMastheadLink href="/forum/control-panel" label="User CP" />
            {navState.trusted ? (
              <>
                <ForumMastheadLink
                  badge={privateMessageBadge}
                  href="/forum/messages"
                  label="PMs"
                />
                <ForumMastheadLink
                  badge={subscriptionBadge}
                  href="/forum/subscriptions"
                  label="Watched"
                />
              </>
            ) : null}
            {navState.canModerate ? (
              <ForumMastheadLink href="/forum/moderation" label="Mod CP" />
            ) : null}
            {navState.canManageBoards ? (
              <ForumMastheadLink href="/admin" label="Admin CP" />
            ) : null}
          </>
        ) : (
          <>
            <ForumMastheadLink href={signInHref} label="Sign in" />
            <ForumMastheadLink href="/forum" label="Browse" />
          </>
        )}
        <ForumPrimarySiteNav primarySiteHref={primarySiteHref} />
        <ForumQuickSearch pathname={pathname} />
        <ThemeToggle />
      </div>
    </div>
  );
}

function ForumPrimarySiteNav({ primarySiteHref }: { primarySiteHref: string }) {
  return (
    <nav aria-label="SYMBiEX site" className="contents">
      {PRIMARY_SITE_NAV_ITEMS.map((item) => {
        const href = primarySiteHrefForPath(primarySiteHref, item.href);
        return (
          <Button
            asChild
            className="h-7 rounded-none border-row-border px-2 font-mono text-[10px] uppercase shadow-none"
            key={item.href}
            size="sm"
            variant="outline"
          >
            <Link href={href} prefetch={href.startsWith("/")}>
              {item.label}
            </Link>
          </Button>
        );
      })}
    </nav>
  );
}

function ForumQuickSearch({ pathname }: { pathname: string | null }) {
  const router = useRouter();
  const [query, setQuery] = useState("");

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedQuery = query.trim();
    const params = new URLSearchParams();
    if (normalizedQuery.length > 0) {
      params.set("q", normalizedQuery);
    }
    const queryString = params.toString();
    const searchHref = `/forum/search${queryString ? `?${queryString}` : ""}`;
    router.push(forumHrefForPathname(searchHref, pathname));
  }

  return (
    <form
      aria-label="Quick forum search"
      className="grid h-7 min-w-[min(18rem,100%)] grid-cols-[minmax(8rem,1fr)_auto]"
      onSubmit={submitSearch}
    >
      <label className="sr-only" htmlFor="forum-masthead-search">
        Search forums
      </label>
      <input
        className="focus-ring h-7 min-w-0 rounded-none border border-row-border bg-background px-2 font-mono text-[10px] uppercase text-foreground outline-none placeholder:text-muted-foreground"
        id="forum-masthead-search"
        maxLength={120}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search forums"
        value={query}
      />
      <Button
        className="h-7 rounded-none border-l-0 border-row-border px-2 font-mono text-[10px] uppercase shadow-none"
        size="sm"
        type="submit"
        variant="outline"
      >
        Search
      </Button>
    </form>
  );
}

function ForumMastheadLink({
  badge,
  href,
  label,
}: {
  badge?: string | null;
  href: string;
  label: string;
}) {
  return (
    <Button
      asChild
      className="h-7 rounded-none border-row-border px-2 font-mono text-[10px] uppercase shadow-none"
      size="sm"
      variant="outline"
    >
      <ForumLink href={href} prefetch>
        <span className="inline-flex items-center gap-1.5">
          <span>{label}</span>
          {badge ? (
            <span className="min-w-4 border border-current px-1 text-center leading-4">
              {badge}
            </span>
          ) : null}
        </span>
      </ForumLink>
    </Button>
  );
}

function forumWelcomeMessage(navState: ForumWelcomeNavState | undefined) {
  if (navState === undefined) {
    return "Checking session / forum tools loading";
  }
  if (!navState.authenticated) {
    return "Welcome, Guest. Public boards are readable; sign in for posting, private messages, and subscriptions.";
  }
  const username = navState.username ?? "member";
  if (!navState.trusted) {
    return `Welcome, ${username}. Forum access is pending owner approval.`;
  }
  const stats = [
    navState.rank ?? "Member",
    `${formatForumCount(navState.postCount)} posts`,
    `${formatForumSignedCount(navState.reputationScore)} rep`,
  ];
  return `Welcome back, ${username}. ${stats.join(" / ")}`;
}

function formatForumSignedCount(value: number) {
  if (value > 0) {
    return `+${formatForumCount(value)}`;
  }
  return formatForumCount(value);
}

function forumSignInHref(pathname: string | null) {
  const redirectTo = pathname ?? "/forum";
  const params = new URLSearchParams({ redirectTo });
  return `/signin?${params.toString()}`;
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

  const segments = path.split("/").filter(Boolean);
  if (segments.length >= 3) {
    return { locationType: "thread", path, label: "Reading thread" };
  }
  return { locationType: "board", path, label: "Viewing board" };
}

function forumChromeRouteLabel(pathname: string | null) {
  const path = normalizedForumPathname(pathname);
  if (path === "/forum") {
    return "Index";
  }
  if (path.startsWith("/forum/announcements")) {
    return "Announcements";
  }
  if (path.startsWith("/forum/help")) {
    return "Help / FAQ";
  }
  if (path.startsWith("/forum/calendar")) {
    return "Calendar";
  }
  if (path.startsWith("/forum/search")) {
    return "Search";
  }
  if (path.startsWith("/forum/new-posts")) {
    return "New Posts";
  }
  if (path.startsWith("/forum/todays-posts")) {
    return "Today";
  }
  if (path.startsWith("/forum/members")) {
    return "Members";
  }
  if (path.startsWith("/forum/online")) {
    return "Online";
  }
  if (path.startsWith("/forum/messages")) {
    return "Messages";
  }
  if (path.startsWith("/forum/subscriptions")) {
    return "Watched";
  }
  if (path.startsWith("/forum/control-panel")) {
    return "User CP";
  }
  if (path.startsWith("/forum/moderation")) {
    return "Moderator CP";
  }
  if (path.split("/").filter(Boolean).length === 2) {
    return "Board";
  }
  return "Thread";
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
  const { isAuthenticated, isLoading } = useConvexAuth();
  const categories = useQuery(forumRefs.listCategories, { limit: 200 });
  const navState = useQuery(
    forumRefs.getMyForumNavState,
    !isLoading && isAuthenticated ? {} : "skip",
  );

  return (
    <ForumUtilityLinks
      categories={categories}
      className={className}
      navState={navState}
    />
  );
}

function ForumUtilityLinks({
  categories = null,
  className,
  navState,
}: {
  categories?: ForumCategoryRecord[] | null;
  className?: string;
  navState?: {
    unreadNotifications: number;
    unreadNotificationsLimited: boolean;
    unreadPrivateMessages: number;
    unreadPrivateMessagesLimited: boolean;
    canModerate?: boolean;
  };
}) {
  const pathname = usePathname();
  const normalizedPathname = normalizedForumPathname(pathname);
  const privateMessageBadge = forumNavBadgeLabel(
    navState?.unreadPrivateMessages ?? 0,
    navState?.unreadPrivateMessagesLimited ?? false,
  );
  const subscriptionBadge = forumNavBadgeLabel(
    navState?.unreadNotifications ?? 0,
    navState?.unreadNotificationsLimited ?? false,
  );
  const items = [
    { href: "/forum", label: "Board index" },
    { href: "/forum/help", label: "Help / FAQ" },
    { href: "/forum/calendar", label: "Calendar" },
    { href: "/forum/announcements", label: "Announcements" },
    { href: "/forum/new-posts", label: "New posts" },
    { href: "/forum/todays-posts", label: "Today's posts" },
    { href: "/forum/search", label: "Search" },
    { href: "/forum/members", label: "Members" },
    { href: "/forum/online", label: "Who's online" },
    { href: "/forum/control-panel", label: "User CP" },
    ...(navState?.canModerate
      ? [{ href: "/forum/moderation", label: "Moderator CP" }]
      : []),
    {
      href: "/forum/messages",
      label: "Private messages",
      badge: privateMessageBadge,
    },
    {
      href: "/forum/subscriptions",
      label: "Subscriptions",
      badge: subscriptionBadge,
    },
  ];

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <nav aria-label="Forum tools" className="flex flex-wrap gap-1">
        {items.map((item) => {
          const badge = item.badge ?? null;
          const active =
            item.href === "/forum"
              ? normalizedPathname === "/forum"
              : normalizedPathname === item.href ||
                normalizedPathname.startsWith(`${item.href}/`);

          return (
            <Button
              asChild
              className={cn(
                "h-7 rounded-none border-row-border px-2.5 font-mono text-[10px] uppercase shadow-none",
                active &&
                  "border-foreground bg-foreground text-background hover:bg-foreground hover:text-background",
              )}
              key={item.href}
              size="sm"
              variant="outline"
            >
              <Link
                aria-current={active ? "page" : undefined}
                aria-label={
                  badge === null ? item.label : `${item.label}, ${badge} unread`
                }
                href={forumHrefForPathname(item.href, pathname)}
                prefetch
              >
                <span className="inline-flex items-center gap-1.5">
                  <span>{item.label}</span>
                  {badge !== null ? (
                    <span className="min-w-4 border border-current px-1 text-center leading-4">
                      {badge}
                    </span>
                  ) : null}
                </span>
              </Link>
            </Button>
          );
        })}
      </nav>
      <ForumJumpSelect categories={categories} />
    </div>
  );
}

function forumNavBadgeLabel(count: number, limited: boolean) {
  if (count <= 0) {
    return null;
  }
  if (limited || count > 99) {
    return "99+";
  }
  return String(count);
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
    <label className="ml-0 flex h-7 min-w-0 max-w-full items-center gap-1 font-mono text-[10px] uppercase sm:ml-auto">
      <span className="shrink-0 text-muted-foreground">Jump</span>
      <select
        aria-label="Forum jump"
        className="focus-ring h-7 w-[min(16rem,calc(100vw-3rem))] rounded-none border border-row-border bg-background px-2 font-mono text-[10px] uppercase text-foreground outline-none disabled:text-muted-foreground"
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

export const ForumLink = forwardRef<
  HTMLAnchorElement,
  Omit<ComponentProps<typeof Link>, "href"> & {
    href: string;
  }
>(function ForumLink({ href, prefetch, ...props }, ref) {
  const pathname = usePathname();
  return (
    <Link
      {...props}
      href={forumHrefForPathname(href, pathname)}
      prefetch={prefetch}
      ref={ref}
    />
  );
});

export function ForumAnnouncementPanel({
  announcements,
  title = "Announcements",
}: {
  announcements: ForumAnnouncementRecord[];
  title?: string;
}) {
  if (announcements.length === 0) {
    return null;
  }

  return (
    <section className="border-y border-row-border py-4">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase text-muted-foreground">
            Forum bulletin
          </p>
          <h2 className="mt-1 text-xl font-semibold">{title}</h2>
        </div>
        <Button
          asChild
          className="h-7 rounded-none px-2 font-mono text-[10px] uppercase"
          size="sm"
          variant="outline"
        >
          <ForumLink href="/forum/announcements" prefetch>
            View all
          </ForumLink>
        </Button>
      </div>
      <div className="divide-y divide-row-border border border-row-border">
        {announcements.map((announcement) => (
          <article className="px-4 py-3" key={announcement._id}>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-semibold">
                <ForumLink href={forumAnnouncementPath(announcement)} prefetch>
                  {announcement.title}
                </ForumLink>
              </h3>
              {announcement.categoryName ? (
                <span className="border border-row-border px-1.5 font-mono text-[10px] uppercase text-muted-foreground">
                  {announcement.categoryName}
                </span>
              ) : (
                <span className="border border-row-border px-1.5 font-mono text-[10px] uppercase text-muted-foreground">
                  global
                </span>
              )}
            </div>
            <ForumBody
              body={announcement.body}
              className="mt-3 text-sm md:text-sm"
            />
            <p className="mt-3 font-mono text-[10px] uppercase text-muted-foreground">
              Updated {formatForumDateTime(announcement.updatedAt)}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}

export function ForumBoardRulesPanel({
  rules,
}: {
  rules: ForumBoardRulesRecord | null;
}) {
  if (!rules) {
    return null;
  }

  return (
    <section className="border border-row-border">
      <div className="border-b border-row-border px-4 py-3">
        <p className="font-mono text-[10px] uppercase text-muted-foreground">
          Board rules
        </p>
        <h2 className="mt-1 text-lg font-semibold">{rules.title}</h2>
      </div>
      <div className="px-4 py-3">
        <ForumBody body={rules.body} className="text-sm md:text-sm" />
        <p className="mt-3 font-mono text-[10px] uppercase text-muted-foreground">
          Updated {formatForumDateTime(rules.updatedAt)}
        </p>
      </div>
    </section>
  );
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
    { href: "/forum/control-panel", label: "Profile settings" },
    { href: "/forum/messages", label: "Private messages" },
    { href: "/forum/subscriptions", label: "Subscriptions" },
  ];

  return (
    <div className="space-y-5">
      <ForumChrome>
        <ForumUtilityLinkRow />
      </ForumChrome>
      <section className="grid gap-px border border-row-border bg-row-border lg:grid-cols-[14rem_minmax(0,1fr)]">
        <aside className="bg-background p-4">
          <p className="font-mono text-[11px] uppercase text-muted-foreground">
            User CP
          </p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {description}
          </p>
          <nav
            aria-label="Forum user control panel"
            className="mt-4 flex gap-1 overflow-x-auto lg:grid lg:gap-px lg:bg-row-border"
          >
            {items.map((item) => {
              const active = normalizedPathname === item.href;
              return (
                <ForumLink
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "focus-ring whitespace-nowrap border border-row-border px-3 py-2 font-mono text-[10px] uppercase hover:text-primary lg:border-0 lg:bg-background",
                    active &&
                      "border-foreground bg-foreground text-background lg:bg-foreground lg:text-background",
                  )}
                  href={item.href}
                  key={item.href}
                  prefetch
                >
                  {item.label}
                </ForumLink>
              );
            })}
          </nav>
        </aside>
        <div className="min-w-0 bg-background p-4 md:p-5">
          <h2 className="font-mono text-[11px] uppercase text-muted-foreground">
            {title}
          </h2>
          <div className="mt-4">{children}</div>
        </div>
      </section>
    </div>
  );
}

export function ForumPaginationBar({
  buildHref,
  className,
  label,
  pagination,
}: {
  buildHref: (page: number) => string;
  className?: string;
  label: string;
  pagination: ForumPaginationRecord;
}) {
  const pages = visiblePages(pagination.page, pagination.totalPages);

  return (
    <nav
      aria-label={`${label} pagination`}
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 border border-row-border px-3 py-2 font-mono text-[10px] uppercase text-muted-foreground",
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
      <div className="flex flex-wrap items-center gap-1">
        <Button
          asChild={pagination.hasPreviousPage}
          className="h-7 rounded-none px-2 font-mono text-[10px] uppercase"
          disabled={!pagination.hasPreviousPage}
          size="sm"
          variant="outline"
        >
          {pagination.hasPreviousPage ? (
            <ForumLink href={buildHref(pagination.page - 1)} prefetch>
              Newer
            </ForumLink>
          ) : (
            <span>Newer</span>
          )}
        </Button>
        {pages.map((page) => (
          <Button
            asChild={page !== pagination.page}
            className={cn(
              "h-7 min-w-7 rounded-none px-2 font-mono text-[10px] uppercase",
              page === pagination.page && "border-primary text-primary",
            )}
            disabled={page === pagination.page}
            key={page}
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
        ))}
        <Button
          asChild={pagination.hasNextPage}
          className="h-7 rounded-none px-2 font-mono text-[10px] uppercase"
          disabled={!pagination.hasNextPage}
          size="sm"
          variant="outline"
        >
          {pagination.hasNextPage ? (
            <ForumLink href={buildHref(pagination.page + 1)} prefetch>
              Older
            </ForumLink>
          ) : (
            <span>Older</span>
          )}
        </Button>
        {pagination.totalPages > 1 ? (
          <Button
            asChild={pagination.page !== pagination.totalPages}
            className="h-7 rounded-none px-2 font-mono text-[10px] uppercase"
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
  const blocks = body
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (blocks.length === 0) {
    return (
      <p className={cn("text-sm leading-7 text-muted-foreground", className)}>
        No message body yet.
      </p>
    );
  }

  return (
    <div className={cn("space-y-4 text-sm leading-7 md:text-base", className)}>
      {blocks.map((block, index) => (
        <ForumBodyBlock key={`${index}-${block.slice(0, 24)}`} block={block} />
      ))}
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

function ForumBodyBlock({ block }: { block: string }) {
  const quote = block.match(
    /^\[quote(?:=([^\]]+))?\]\n?([\s\S]*?)\[\/quote\]$/i,
  );
  if (quote) {
    const author = quote[1]?.trim();
    const quotedBody = quote[2]?.trim() ?? "";

    return (
      <blockquote className="border-l-2 border-primary/60 bg-muted/35 px-4 py-3">
        {author ? (
          <p className="mb-2 font-mono text-[10px] uppercase text-muted-foreground">
            {author} wrote
          </p>
        ) : null}
        <p className="whitespace-pre-wrap break-words text-muted-foreground">
          {quotedBody}
        </p>
      </blockquote>
    );
  }

  const code = block.match(/^\[code\]\n?([\s\S]*?)\[\/code\]$/i);
  if (code) {
    return (
      <pre className="overflow-x-auto border border-row-border bg-muted/35 p-3 font-mono text-xs leading-6">
        <code>{code[1]?.trim() ?? ""}</code>
      </pre>
    );
  }

  const list = block.match(/^\[list\]\n?([\s\S]*?)\[\/list\]$/i);
  if (list) {
    const items = (list[1] ?? "")
      .split(/\[\*\]/g)
      .map((item) => item.trim())
      .filter(Boolean);
    if (items.length > 0) {
      return (
        <ul className="list-disc space-y-2 pl-5">
          {items.map((item, index) => (
            <li key={`${index}-${item.slice(0, 24)}`}>
              {renderInlineBbcode(item)}
            </li>
          ))}
        </ul>
      );
    }
  }

  return (
    <p className="whitespace-pre-wrap break-words">
      {renderInlineBbcode(block)}
    </p>
  );
}

function renderInlineBbcode(text: string): ReactNode[] {
  const pattern =
    /(\[b\][\s\S]*?\[\/b\]|\[i\][\s\S]*?\[\/i\]|\[u\][\s\S]*?\[\/u\]|\[s\][\s\S]*?\[\/s\]|\[code\][\s\S]*?\[\/code\]|\[url(?:=[^\]]+)?\][\s\S]*?\[\/url\]|\[img\][\s\S]*?\[\/img\])/gi;
  const parts = text.split(pattern).filter((part) => part.length > 0);

  return parts.map((part, index) => {
    const bold = part.match(/^\[b\]([\s\S]*?)\[\/b\]$/i);
    if (bold) {
      return (
        <strong key={`${index}-b`}>{renderInlineBbcode(bold[1] ?? "")}</strong>
      );
    }

    const italic = part.match(/^\[i\]([\s\S]*?)\[\/i\]$/i);
    if (italic) {
      return <em key={`${index}-i`}>{renderInlineBbcode(italic[1] ?? "")}</em>;
    }

    const underline = part.match(/^\[u\]([\s\S]*?)\[\/u\]$/i);
    if (underline) {
      return (
        <span key={`${index}-u`} className="underline underline-offset-2">
          {renderInlineBbcode(underline[1] ?? "")}
        </span>
      );
    }

    const strike = part.match(/^\[s\]([\s\S]*?)\[\/s\]$/i);
    if (strike) {
      return <s key={`${index}-s`}>{renderInlineBbcode(strike[1] ?? "")}</s>;
    }

    const code = part.match(/^\[code\]([\s\S]*?)\[\/code\]$/i);
    if (code) {
      return (
        <code
          key={`${index}-code`}
          className="border border-row-border bg-muted/35 px-1 py-0.5 font-mono text-[0.9em]"
        >
          {code[1] ?? ""}
        </code>
      );
    }

    const url = part.match(/^\[url(?:=([^\]]+))?\]([\s\S]*?)\[\/url\]$/i);
    if (url) {
      const href = safeExternalUrl(url[1] ?? url[2]);
      const label = (url[2] ?? "").trim() || href;
      if (href && label) {
        return (
          <a
            key={`${index}-url`}
            className="underline underline-offset-2 hover:text-primary"
            href={href}
            rel="noreferrer"
            target="_blank"
          >
            {renderInlineBbcode(label)}
          </a>
        );
      }
      return `[url]${url[2] ?? ""}[/url]`;
    }

    const image = part.match(/^\[img\]([\s\S]*?)\[\/img\]$/i);
    if (image) {
      const src = safeImageUrl(image[1]);
      if (src) {
        return (
          // eslint-disable-next-line @next/next/no-img-element -- Forum BBCode images can be external user content.
          <img
            key={`${index}-img`}
            alt=""
            className="my-2 max-h-96 max-w-full border border-row-border object-contain"
            loading="lazy"
            referrerPolicy="no-referrer"
            src={src}
          />
        );
      }
      return `[img]${image[1] ?? ""}[/img]`;
    }

    return renderForumSmilies(part, index);
  });
}

function renderForumSmilies(text: string, partIndex: number): ReactNode[] {
  const pattern = /(:\)|:D|;\)|:P|:\(|:o|:cool:|:heart:)/g;
  const parts = text.split(pattern).filter((part) => part.length > 0);

  return parts.map((part, index) => {
    const label = FORUM_SMILIES.get(part);
    if (!label) {
      return part;
    }
    return (
      <span
        key={`${partIndex}-smilie-${index}`}
        aria-label="smilie"
        className="mx-0.5 inline-flex h-5 min-w-5 items-center justify-center border border-row-border bg-muted/35 px-1 font-mono text-[10px] uppercase leading-none text-muted-foreground"
      >
        {label}
      </span>
    );
  });
}

export function ForumThreadStateBadges({
  thread,
  className,
}: {
  thread: ForumThreadSummaryRecord | null;
  className?: string;
}) {
  if (!thread) {
    return null;
  }

  const pinned = isPinnedThread(thread);
  const locked = isLockedThread(thread);
  const unread = thread.viewerUnread === true;

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
        "inline-flex min-h-5 shrink-0 items-center border border-row-border px-1.5 font-mono text-[10px] uppercase leading-none text-muted-foreground",
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
        "focus-ring inline-flex min-h-10 items-center justify-center border border-row-border bg-background px-3 font-mono text-[10px] uppercase leading-none text-foreground hover:border-primary hover:bg-primary hover:text-primary-foreground",
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
        "inline-flex min-h-5 items-center border px-1.5 font-mono text-[10px] uppercase leading-none",
        tone === "muted" && "border-row-border text-muted-foreground",
        tone === "primary" && "border-primary text-primary",
        tone === "primarySolid" &&
          "border-primary bg-primary text-primary-foreground",
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
    <div className="space-y-4">
      {groups.map((group, index) => (
        <ForumIndexSection
          key={group.section?.slug ?? `root-${index}`}
          group={group}
          index={index}
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
        "grid gap-px border border-row-border bg-row-border xl:grid-cols-[minmax(0,1fr)_minmax(20rem,0.45fr)]",
        className,
      )}
    >
      <div className="bg-background px-3 py-3">
        <p className="sr-only">Forum legend</p>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {legendItems.map((item) => (
            <div
              className="flex items-center gap-2 font-mono text-[10px] uppercase text-muted-foreground"
              key={item.label}
            >
              <ForumStatusGlyph decorative state={item.state} />
              <span>{item.label}</span>
            </div>
          ))}
        </div>
      </div>
      {stats.length > 0 ? (
        <dl className="grid grid-cols-2 gap-px bg-row-border sm:grid-cols-4 xl:grid-cols-2">
          {stats.map((item) => (
            <div className="bg-background px-3 py-3" key={item.label}>
              <dt className="font-mono text-[10px] uppercase text-muted-foreground">
                {item.label}
              </dt>
              <dd className="mt-1 text-sm font-semibold">
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

function ForumIndexSection({
  group,
  index,
}: {
  group: ForumCategorySectionRecord;
  index: number;
}) {
  const heading = group.section
    ? getCategoryTitle(group.section)
    : "Main boards";
  const description = group.section
    ? getCategoryDescription(group.section)
    : "";

  return (
    <section className="border border-row-border">
      <div className="border-b border-row-border bg-foreground px-4 py-3 text-background">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase opacity-70">
              Section {index + 1}
            </p>
            <h3 className="mt-1 text-lg font-semibold leading-tight md:text-xl">
              {heading}
            </h3>
            {description ? (
              <p className="mt-1 max-w-3xl text-sm leading-6 opacity-75">
                {description}
              </p>
            ) : null}
          </div>
          <p className="font-mono text-[10px] uppercase opacity-70">
            {formatForumCount(group.threadCount)} threads /{" "}
            {formatForumCount(group.postCount)} posts
          </p>
        </div>
      </div>
      {group.boards.length === 0 ? (
        <p className="px-4 py-4 text-sm text-muted-foreground">
          No boards in this section yet.
        </p>
      ) : (
        <>
          <div className="divide-y divide-row-border md:hidden">
            {group.boards.map((category) => (
              <ForumMobileBoardRow key={category.slug} category={category} />
            ))}
          </div>
          <table className="hidden w-full table-fixed border-collapse md:table">
            <caption className="sr-only">{heading} boards</caption>
            <thead>
              <tr className="border-b border-row-border font-mono text-[10px] uppercase text-muted-foreground">
                <th
                  className="w-14 px-4 py-3 text-left font-normal"
                  scope="col"
                >
                  Status
                </th>
                <th className="px-4 py-3 text-left font-normal" scope="col">
                  Board
                </th>
                <th
                  className="w-28 px-4 py-3 text-left font-normal"
                  scope="col"
                >
                  Threads
                </th>
                <th
                  className="w-28 px-4 py-3 text-left font-normal"
                  scope="col"
                >
                  Posts
                </th>
                <th
                  className="w-56 px-4 py-3 text-left font-normal"
                  scope="col"
                >
                  Latest thread
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-row-border">
              {group.boards.map((category) => (
                <ForumDesktopBoardRow key={category.slug} category={category} />
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

function ForumMobileBoardRow({ category }: { category: ForumCategoryRecord }) {
  const latestThread = getCategoryLatestThread(category);
  const categoryHref = forumPath(category.slug);
  const statusState = categoryBoardStatusState(category);

  return (
    <div className="grid gap-4 px-4 py-4 odd:bg-muted/15">
      <div className="min-w-0">
        <div className="flex items-start gap-2">
          <ForumStatusGlyph className="mt-1" state={statusState} />
          <div className="min-w-0">
            <ForumLink
              href={categoryHref}
              prefetch
              className="focus-ring text-lg font-semibold leading-tight hover:text-primary md:text-xl"
            >
              {getCategoryTitle(category)}
            </ForumLink>
            <ForumCategoryAccessBadges category={category} className="mt-2" />
          </div>
        </div>
        {getCategoryDescription(category) ? (
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            {getCategoryDescription(category)}
          </p>
        ) : null}
        <ForumSubforumLinks category={category} />
      </div>
      <ForumCell label="Threads">
        {formatForumCount(getCategoryThreadCount(category))}
      </ForumCell>
      <ForumCell label="Posts">
        {formatForumCount(getCategoryPostCount(category))}
      </ForumCell>
      <ForumLatestPostCell category={category} latestThread={latestThread} />
    </div>
  );
}

function ForumDesktopBoardRow({ category }: { category: ForumCategoryRecord }) {
  const latestThread = getCategoryLatestThread(category);
  const categoryHref = forumPath(category.slug);
  const statusState = categoryBoardStatusState(category);

  return (
    <tr className="odd:bg-muted/15">
      <td className="px-4 py-4 align-middle">
        <ForumStatusGlyph state={statusState} />
      </td>
      <th className="px-4 py-4 text-left align-middle font-normal" scope="row">
        <ForumLink
          href={categoryHref}
          prefetch
          className="focus-ring text-xl font-semibold leading-tight hover:text-primary"
        >
          {getCategoryTitle(category)}
        </ForumLink>
        <ForumCategoryAccessBadges category={category} className="mt-2" />
        {getCategoryDescription(category) ? (
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            {getCategoryDescription(category)}
          </p>
        ) : null}
        <ForumSubforumLinks category={category} />
      </th>
      <td className="px-4 py-4 align-middle">
        <p className="text-sm font-medium">
          {formatForumCount(getCategoryThreadCount(category))}
        </p>
      </td>
      <td className="px-4 py-4 align-middle">
        <p className="text-sm font-medium">
          {formatForumCount(getCategoryPostCount(category))}
        </p>
      </td>
      <td className="px-4 py-4 align-middle">
        <ForumLatestPostCell category={category} latestThread={latestThread} />
      </td>
    </tr>
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
  const latestPostHref = latestThread
    ? getThreadLastPostHref(latestThread, category.slug)
    : null;

  return (
    <div className="min-w-0">
      <p className="font-mono text-[10px] uppercase text-muted-foreground md:hidden">
        Latest thread
      </p>
      {latestThread ? (
        <div className="mt-1 flex min-w-0 flex-wrap items-start gap-2 md:mt-0">
          <ForumLink
            href={forumPath(category.slug, latestThread.slug)}
            prefetch
            className="focus-ring min-w-0 flex-1 basis-36 text-sm font-semibold hover:text-primary"
          >
            {latestThread.title}
          </ForumLink>
          {latestPostHref ? (
            <ForumJumpLink
              ariaLabel={`Go to last post in ${latestThread.title}`}
              className="px-2"
              href={latestPostHref}
            >
              Last »
            </ForumJumpLink>
          ) : null}
          <p className="w-full text-xs leading-5 text-muted-foreground">
            {getThreadLastAuthor(latestThread)} ·{" "}
            {formatForumDateTime(getThreadLastActivityAt(latestThread))}
          </p>
        </div>
      ) : (
        <p className="mt-1 text-sm text-muted-foreground md:mt-0">
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
    <div className="mt-3 flex flex-wrap gap-x-2 gap-y-1 font-mono text-[10px] uppercase leading-5">
      <span className="text-muted-foreground">Subforums:</span>
      {children.map((child) => (
        <ForumLink
          key={child.slug}
          href={forumPath(child.slug)}
          prefetch
          className="focus-ring text-primary hover:underline"
        >
          {getCategoryTitle(child)}
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
  if (category.threadAccess) {
    tokens.push(`${category.threadAccess} threads`);
  }
  if (category.replyAccess) {
    tokens.push(`${category.replyAccess} replies`);
  }
  if (category.pollAccess) {
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
    <section className="border border-row-border">
      <div className="border-b border-row-border px-4 py-3 font-mono text-[10px] uppercase text-muted-foreground">
        {heading}
      </div>
      {threads.length === 0 ? (
        <p className="px-4 py-4 text-sm text-muted-foreground">
          No active threads yet.
        </p>
      ) : (
        <div className="divide-y divide-row-border">
          {threads.map((thread) => (
            <div
              key={`${thread.categorySlug ?? "forum"}-${thread.slug}`}
              className="px-4 py-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <ForumThreadPrefixBadge thread={thread} />
                <ForumLink
                  href={forumPath(thread.categorySlug, thread.slug)}
                  prefetch
                  className="focus-ring min-w-0 text-base font-semibold hover:text-primary md:text-lg"
                >
                  {thread.title}
                </ForumLink>
                <ForumThreadStateBadges thread={thread} />
              </div>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
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
                <p className="mt-2 line-clamp-2 text-sm leading-6 text-muted-foreground">
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
  threads,
}: {
  category: ForumCategoryRecord | null;
  threads: ForumThreadSummaryRecord[];
}) {
  const threadSections = getForumThreadSections(threads);

  if (threads.length === 0) {
    return (
      <ForumStatusBox
        title={category ? getCategoryTitle(category) : "Threads"}
        body="This board has no public threads yet."
      />
    );
  }

  return (
    <div className="border border-row-border">
      <div className="lg:hidden">
        {threadSections.map((section) => (
          <div
            key={section.key}
            className={cn(
              "divide-y divide-row-border",
              section.showHeader &&
                "border-t border-row-border first:border-t-0",
            )}
          >
            {section.showHeader ? (
              <div
                className={cn(
                  "border-b border-row-border px-4 py-2 font-mono text-[10px] uppercase",
                  section.emphasized
                    ? "bg-foreground text-background"
                    : "bg-muted/25 text-muted-foreground",
                )}
              >
                <ForumThreadSectionLabel section={section} />
              </div>
            ) : null}
            {section.threads.map((thread, index) => {
              const categorySlug = thread.categorySlug ?? category?.slug;
              const threadHref = forumPath(categorySlug, thread.slug);
              const firstUnreadHref =
                thread.viewerUnread === true && thread.firstUnreadPostNumber
                  ? forumPostPath(
                      categorySlug,
                      thread.slug,
                      thread.firstUnreadPostNumber,
                      thread.firstUnreadPage,
                    )
                  : null;
              const lastPostHref = getThreadLastPostHref(thread, categorySlug);

              return (
                <div
                  key={thread._id}
                  className={cn(
                    "grid gap-4 border-l-2 border-transparent px-4 py-4",
                    section.showHeader
                      ? index % 2 === 0 && "bg-muted/15"
                      : "odd:bg-muted/15",
                    thread.viewerUnread === true && "border-l-primary",
                  )}
                >
                  <div className="min-w-0">
                    <div className="flex items-start gap-2">
                      <ForumStatusGlyph thread={thread} />
                      <div className="min-w-0">
                        <ForumLink
                          href={threadHref}
                          prefetch
                          className="focus-ring block min-w-0 text-base font-semibold leading-tight hover:text-primary"
                        >
                          <ForumThreadPrefixBadge
                            className="mb-1 mr-2 inline-flex"
                            thread={thread}
                          />
                          {thread.title}
                        </ForumLink>
                        <ForumThreadStateBadges
                          thread={thread}
                          className="mt-2"
                        />
                      </div>
                    </div>
                    {firstUnreadHref ? (
                      <ForumJumpLink
                        ariaLabel={`Go to first unread post in ${thread.title}`}
                        className="mt-3"
                        href={firstUnreadHref}
                      >
                        New / First unread »
                      </ForumJumpLink>
                    ) : null}
                    <p className="mt-2 font-mono text-[10px] uppercase leading-5 text-muted-foreground">
                      Starter: {getThreadAuthor(thread)} /{" "}
                      {formatForumDateTime(getThreadStartedAt(thread))}
                    </p>
                    {category === null && thread.categorySlug ? (
                      <p className="mt-1 font-mono text-[10px] uppercase leading-5 text-muted-foreground">
                        Board:{" "}
                        <ForumLink
                          className="focus-ring hover:text-foreground"
                          href={forumPath(thread.categorySlug)}
                          prefetch
                        >
                          {thread.categoryName ??
                            humanizeSlug(thread.categorySlug)}
                        </ForumLink>
                      </p>
                    ) : null}
                    {thread.excerpt ? (
                      <p className="mt-2 line-clamp-2 text-sm leading-6 text-muted-foreground">
                        {thread.excerpt}
                      </p>
                    ) : null}
                    <ForumThreadRatingSummary
                      average={getThreadRatingAverage(thread)}
                      className="mt-3"
                      count={getThreadRatingCount(thread)}
                    />
                  </div>
                  <ForumCell label="Replies">
                    {formatForumCount(getThreadReplyCount(thread))}
                  </ForumCell>
                  <ForumCell label="Views">
                    {formatForumCount(thread.viewCount)}
                  </ForumCell>
                  <div>
                    <p className="font-mono text-[10px] uppercase text-muted-foreground">
                      Last post
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <ForumJumpLink
                        ariaLabel={`Go to last post in ${thread.title}`}
                        className="px-2"
                        href={lastPostHref}
                      >
                        Last »
                      </ForumJumpLink>
                      <div className="min-w-0">
                        <span className="block text-sm font-medium">
                          {getThreadLastAuthor(thread)}
                        </span>
                        <span className="block text-xs leading-5 text-muted-foreground">
                          {formatForumDateTime(getThreadLastActivityAt(thread))}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <table className="hidden w-full table-fixed border-collapse lg:table">
        <caption className="sr-only">
          {category ? `${getCategoryTitle(category)} threads` : "Forum threads"}
        </caption>
        <thead>
          <tr className="border-b border-row-border font-mono text-[10px] uppercase text-muted-foreground">
            <th className="w-12 px-3 py-2 text-left font-normal" scope="col">
              Status
            </th>
            <th className="px-3 py-2 text-left font-normal" scope="col">
              Topic
            </th>
            <th className="w-28 px-3 py-2 text-left font-normal" scope="col">
              Rating
            </th>
            <th className="w-20 px-3 py-2 text-left font-normal" scope="col">
              Replies
            </th>
            <th className="w-20 px-3 py-2 text-left font-normal" scope="col">
              Views
            </th>
            <th className="w-36 px-3 py-2 text-left font-normal" scope="col">
              Starter
            </th>
            <th className="w-48 px-3 py-2 text-left font-normal" scope="col">
              Last
            </th>
          </tr>
        </thead>
        {threadSections.map((section) => (
          <tbody key={section.key} className="divide-y divide-row-border">
            {section.showHeader ? (
              <tr
                className={cn(
                  "border-y border-row-border font-mono text-[10px] uppercase",
                  section.emphasized
                    ? "bg-foreground text-background"
                    : "bg-muted/25 text-muted-foreground",
                )}
              >
                <th
                  className="px-3 py-2 text-left font-normal"
                  colSpan={7}
                  scope="rowgroup"
                >
                  <ForumThreadSectionLabel section={section} />
                </th>
              </tr>
            ) : null}
            {section.threads.map((thread, index) => {
              const categorySlug = thread.categorySlug ?? category?.slug;
              const threadHref = forumPath(categorySlug, thread.slug);
              const firstUnreadHref =
                thread.viewerUnread === true && thread.firstUnreadPostNumber
                  ? forumPostPath(
                      categorySlug,
                      thread.slug,
                      thread.firstUnreadPostNumber,
                      thread.firstUnreadPage,
                    )
                  : null;
              const lastPostHref = getThreadLastPostHref(thread, categorySlug);

              return (
                <tr
                  className={cn(
                    "border-l-2 border-transparent",
                    section.showHeader
                      ? index % 2 === 0 && "bg-muted/15"
                      : "odd:bg-muted/15",
                    thread.viewerUnread === true && "border-l-primary",
                  )}
                  key={thread._id}
                >
                  <td className="px-3 py-3 align-middle">
                    <ForumStatusGlyph thread={thread} />
                  </td>
                  <th
                    className="px-3 py-3 text-left align-middle font-normal"
                    scope="row"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <ForumThreadPrefixBadge thread={thread} />
                      <ForumLink
                        href={threadHref}
                        prefetch
                        className="focus-ring min-w-0 text-base font-semibold leading-tight hover:text-primary"
                      >
                        {thread.title}
                      </ForumLink>
                      <ForumThreadStateBadges thread={thread} />
                    </div>
                    {firstUnreadHref ? (
                      <ForumJumpLink
                        ariaLabel={`Go to first unread post in ${thread.title}`}
                        className="mt-3 px-2"
                        href={firstUnreadHref}
                      >
                        New / First unread »
                      </ForumJumpLink>
                    ) : null}
                    {thread.excerpt ? (
                      <p className="mt-1 line-clamp-1 text-xs leading-5 text-muted-foreground">
                        {thread.excerpt}
                      </p>
                    ) : null}
                    {category === null && thread.categorySlug ? (
                      <p className="mt-1 font-mono text-[10px] uppercase leading-4 text-muted-foreground">
                        Board:{" "}
                        <ForumLink
                          className="focus-ring hover:text-foreground"
                          href={forumPath(thread.categorySlug)}
                          prefetch
                        >
                          {thread.categoryName ??
                            humanizeSlug(thread.categorySlug)}
                        </ForumLink>
                      </p>
                    ) : null}
                  </th>
                  <td className="px-3 py-3 align-middle">
                    <ForumThreadRatingSummary
                      average={getThreadRatingAverage(thread)}
                      count={getThreadRatingCount(thread)}
                    />
                  </td>
                  <td className="px-3 py-3 align-middle">
                    <p className="font-mono text-xs font-medium">
                      {formatForumCount(getThreadReplyCount(thread))}
                    </p>
                  </td>
                  <td className="px-3 py-3 align-middle">
                    <p className="font-mono text-xs font-medium">
                      {formatForumCount(thread.viewCount)}
                    </p>
                  </td>
                  <td className="px-3 py-3 align-middle">
                    <p className="truncate text-sm font-medium">
                      {getThreadAuthor(thread)}
                    </p>
                    <p className="mt-1 font-mono text-[10px] uppercase leading-4 text-muted-foreground">
                      {formatForumDateTime(getThreadStartedAt(thread))}
                    </p>
                  </td>
                  <td className="px-3 py-3 align-middle">
                    <div className="flex flex-wrap items-center gap-2">
                      <ForumJumpLink
                        ariaLabel={`Go to last post in ${thread.title}`}
                        className="px-2"
                        href={lastPostHref}
                      >
                        Last »
                      </ForumJumpLink>
                      <div className="min-w-0">
                        <span className="block truncate text-sm font-medium">
                          {getThreadLastAuthor(thread)}
                        </span>
                        <span className="block font-mono text-[10px] uppercase leading-4 text-muted-foreground">
                          {formatForumDateTime(getThreadLastActivityAt(thread))}
                        </span>
                      </div>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        ))}
      </table>
      <ForumThreadTableFooter threads={threads} />
    </div>
  );
}

function ForumThreadTableFooter({
  threads,
}: {
  threads: ForumThreadSummaryRecord[];
}) {
  const replyCount = threads.reduce(
    (total, thread) => total + getThreadReplyCount(thread),
    0,
  );
  const viewCount = threads.reduce(
    (total, thread) => total + (thread.viewCount ?? 0),
    0,
  );

  return (
    <div className="grid gap-px border-t border-row-border bg-row-border font-mono text-[10px] uppercase text-muted-foreground md:grid-cols-[minmax(0,1fr)_minmax(18rem,0.5fr)]">
      <div className="bg-background px-3 py-2">
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          <span className="inline-flex items-center gap-2">
            <ForumStatusGlyph decorative state="thread-unread" />
            Unread
          </span>
          <span className="inline-flex items-center gap-2">
            <ForumStatusGlyph decorative state="thread-pinned" />
            Pinned
          </span>
          <span className="inline-flex items-center gap-2">
            <ForumStatusGlyph decorative state="thread-locked" />
            Locked
          </span>
        </div>
      </div>
      <dl className="grid grid-cols-3 gap-px bg-row-border">
        <div className="bg-background px-3 py-2">
          <dt>Shown</dt>
          <dd className="mt-1 text-foreground">
            {formatForumCount(threads.length)}
          </dd>
        </div>
        <div className="bg-background px-3 py-2">
          <dt>Replies</dt>
          <dd className="mt-1 text-foreground">
            {formatForumCount(replyCount)}
          </dd>
        </div>
        <div className="bg-background px-3 py-2">
          <dt>Views</dt>
          <dd className="mt-1 text-foreground">
            {formatForumCount(viewCount)}
          </dd>
        </div>
      </dl>
    </div>
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
      <span
        className={
          section.emphasized ? "text-background/70" : "text-muted-foreground"
        }
      >
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
}: {
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
  return (
    <article className="border border-row-border" id={id}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-row-border bg-muted/20 px-3 py-2 font-mono text-[10px] uppercase text-muted-foreground">
        <span>
          Post #{String(postNumber).padStart(2, "0")} / {timestamp}
        </span>
        {actions ? (
          <div className="flex flex-wrap justify-end gap-1.5">{actions}</div>
        ) : null}
      </div>
      <div className="grid gap-px bg-row-border md:grid-cols-[11rem_minmax(0,1fr)]">
        <aside className="bg-background px-3 py-3">
          <div className="grid grid-cols-[3.25rem_minmax(0,1fr)] gap-3 md:grid-cols-1">
            <ForumAvatar
              alt={`${author} avatar`}
              className="size-12 md:size-20"
              name={author}
              src={avatarUrl}
            />
            <div className="min-w-0">
              {authorHref ? (
                <ForumLink
                  href={authorHref}
                  prefetch
                  className="focus-ring break-words text-base font-semibold hover:text-primary md:text-lg"
                >
                  {author}
                </ForumLink>
              ) : (
                <p className="break-words text-base font-semibold md:text-lg">
                  {author}
                </p>
              )}
              <p className="mt-1 font-mono text-[10px] uppercase text-muted-foreground">
                {rank ?? role ?? "Member"}
              </p>
            </div>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-px bg-row-border font-mono text-[10px] uppercase text-muted-foreground md:grid-cols-1">
            {role ? (
              <div className="bg-background px-2 py-2">
                <dt>Role</dt>
                <dd className="mt-1 text-foreground">{role}</dd>
              </div>
            ) : null}
            {typeof postCount === "number" ? (
              <div className="bg-background px-2 py-2">
                <dt>Posts</dt>
                <dd className="mt-1 text-foreground">
                  {formatForumCount(postCount)}
                </dd>
              </div>
            ) : null}
            {typeof reputationScore === "number" ? (
              <div className="bg-background px-2 py-2">
                <dt>Reputation</dt>
                <dd className="mt-1 text-foreground">
                  {reputationScore > 0 ? "+" : ""}
                  {formatForumCount(reputationScore)}
                </dd>
              </div>
            ) : null}
            {location ? (
              <div className="bg-background px-2 py-2">
                <dt>Location</dt>
                <dd className="mt-1 break-words text-foreground">{location}</dd>
              </div>
            ) : null}
            {typeof joinedAt === "number" ? (
              <div className="bg-background px-2 py-2">
                <dt>Joined</dt>
                <dd className="mt-1 text-foreground">
                  {formatForumDateTime(joinedAt)}
                </dd>
              </div>
            ) : null}
          </dl>
          <ForumAuthorRailShortcuts author={author} authorHref={authorHref} />
        </aside>
        <div className="min-w-0 bg-background px-4 py-4">
          {children}
          {signature ? (
            <div className="mt-6 border-t border-row-border pt-3">
              <p className="mb-2 font-mono text-[10px] uppercase text-muted-foreground">
                Signature
              </p>
              <ForumBody
                body={signature}
                className="text-xs leading-6 text-muted-foreground md:text-sm"
              />
            </div>
          ) : null}
        </div>
      </div>
      <div className="border-t border-row-border bg-muted/15 px-3 py-2 font-mono text-[10px] uppercase text-muted-foreground">
        {author} / post #{postNumber}
      </div>
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
      className="mt-3 grid grid-cols-2 gap-px bg-row-border font-mono text-[10px] uppercase md:grid-cols-1"
    >
      {authorActions.map((action) =>
        action.kind === "forum" ? (
          <ForumLink
            className="focus-ring bg-background px-2 py-2 text-center text-muted-foreground hover:bg-foreground hover:text-background md:text-left"
            href={action.href}
            key={action.label}
            prefetch
          >
            {action.label}
          </ForumLink>
        ) : (
          <ForumLink
            className="focus-ring bg-background px-2 py-2 text-center text-muted-foreground hover:bg-foreground hover:text-background md:text-left"
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
  if (!attachments || attachments.length === 0) {
    return null;
  }

  return (
    <div className="mt-6 border-t border-row-border pt-3">
      <p className="mb-3 font-mono text-[10px] uppercase text-muted-foreground">
        Attached files
      </p>
      <div className="grid gap-2">
        {attachments.map((attachment) => {
          const isImage = attachment.contentType.startsWith("image/");
          return (
            <a
              className="focus-ring grid gap-3 border border-row-border p-3 hover:border-foreground sm:grid-cols-[4.5rem_minmax(0,1fr)]"
              href={attachment.url}
              key={attachment._id}
              rel="noopener noreferrer"
              target="_blank"
            >
              <span className="flex aspect-square items-center justify-center border border-row-border bg-muted/20 font-mono text-[10px] uppercase text-muted-foreground">
                {isImage ? (
                  // eslint-disable-next-line @next/next/no-img-element -- Convex attachment URLs are signed runtime URLs.
                  <img
                    alt=""
                    className="size-full object-cover"
                    loading="lazy"
                    src={safeImageUrl(attachment.url) ?? attachment.url}
                  />
                ) : (
                  "File"
                )}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-foreground">
                  {attachment.filename}
                </span>
                <span className="mt-1 block font-mono text-[10px] uppercase text-muted-foreground">
                  {attachment.contentType} / {formatFileSize(attachment.size)}
                </span>
              </span>
            </a>
          );
        })}
      </div>
    </div>
  );
}

function formatFileSize(size: number) {
  if (size >= 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (size >= 1024) {
    return `${Math.ceil(size / 1024)} KB`;
  }
  return `${size} B`;
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
        // eslint-disable-next-line @next/next/no-img-element -- Auth avatars may come from hosts outside next/image config.
        <img
          alt={alt ?? `${name} avatar`}
          className="size-full object-cover"
          loading="lazy"
          referrerPolicy="no-referrer"
          src={imageUrl}
        />
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

function ForumCell({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <p className="font-mono text-[10px] uppercase text-muted-foreground md:hidden">
        {label}
      </p>
      <p className="mt-1 text-sm font-medium md:mt-0">{children}</p>
    </div>
  );
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
        "flex size-8 shrink-0 items-center justify-center border border-row-border bg-background",
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
  kind,
  label,
  rows,
}: {
  kind: "boards" | "threads";
  label: string;
  rows: number;
}) {
  const boardSkeleton = kind === "boards";
  const gridClass = boardSkeleton
    ? "md:grid-cols-[2.5rem_minmax(0,1.4fr)_7rem_7rem_minmax(12rem,0.95fr)]"
    : "lg:grid-cols-[2.5rem_minmax(0,1.25fr)_5rem_5rem_9rem_minmax(12rem,0.8fr)]";
  const desktopGridClass = boardSkeleton ? "md:grid" : "lg:grid";
  const desktopItemClass = boardSkeleton
    ? "md:items-center"
    : "lg:items-center";
  const desktopStatusClass = boardSkeleton ? "md:block" : "lg:block";
  const mobileStatusClass = boardSkeleton ? "md:hidden" : "lg:hidden";
  const mobileLabelClass = boardSkeleton ? "md:hidden" : "lg:hidden";
  const titleLabel = boardSkeleton ? "Board" : "Thread";
  const firstCountLabel = boardSkeleton ? "Threads" : "Replies";
  const secondCountLabel = boardSkeleton ? "Posts" : "Views";
  const lastLabel = boardSkeleton ? "Latest post" : "Last";

  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className="border border-row-border"
      role="status"
    >
      <span className="sr-only">{label}</span>
      <div
        className={cn(
          "hidden gap-4 border-b border-row-border px-4 py-3 font-mono text-[10px] uppercase text-muted-foreground",
          desktopGridClass,
          gridClass,
        )}
      >
        <span>Status</span>
        <span>{titleLabel}</span>
        <span>{firstCountLabel}</span>
        <span>{secondCountLabel}</span>
        {boardSkeleton ? null : <span>Starter</span>}
        <span>{lastLabel}</span>
      </div>
      <div className="divide-y divide-row-border">
        {Array.from({ length: rows }).map((_, index) => (
          <div
            className={cn(
              "grid gap-4 px-4 py-4 odd:bg-muted/15",
              desktopItemClass,
              gridClass,
            )}
            key={index}
          >
            <SkeletonBox className={cn("hidden size-7", desktopStatusClass)} />
            <div className="space-y-2">
              <div
                className={cn(
                  "flex items-center gap-2",
                  boardSkeleton ? "md:block" : "lg:block",
                )}
              >
                <SkeletonBox
                  className={cn("size-7 shrink-0", mobileStatusClass)}
                />
                <SkeletonBox className="h-4 w-3/5" />
              </div>
              <SkeletonBox className="h-3 w-4/5" />
              {boardSkeleton ? null : <SkeletonBox className="h-3 w-28" />}
            </div>
            <SkeletonMetric label={firstCountLabel} />
            <SkeletonMetric label={secondCountLabel} />
            {boardSkeleton ? null : (
              <div className="space-y-2">
                <p className="font-mono text-[10px] uppercase text-muted-foreground lg:hidden">
                  Starter
                </p>
                <SkeletonBox className="h-4 w-24" />
                <SkeletonBox className="h-3 w-16" />
              </div>
            )}
            <div className="space-y-2">
              <p
                className={cn(
                  "font-mono text-[10px] uppercase text-muted-foreground",
                  mobileLabelClass,
                )}
              >
                {lastLabel}
              </p>
              <SkeletonBox className="h-4 w-28" />
              <SkeletonBox className="h-3 w-20" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ForumThreadSkeleton({ label }: { label: string }) {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className="space-y-4"
      role="status"
    >
      <span className="sr-only">{label}</span>
      <div className="border-y border-row-border py-4">
        <SkeletonBox className="h-3 w-44" />
        <SkeletonBox className="mt-3 h-7 w-3/5 max-w-xl" />
        <div className="mt-3 flex flex-wrap gap-2">
          <SkeletonBox className="h-8 w-24" />
          <SkeletonBox className="h-8 w-24" />
          <SkeletonBox className="h-8 w-28" />
        </div>
      </div>
      <div className="border border-row-border px-3 py-2">
        <SkeletonBox className="h-3 w-48" />
      </div>
      {Array.from({ length: 3 }).map((_, index) => (
        <div
          className="grid gap-px border border-row-border bg-row-border md:grid-cols-[13rem_minmax(0,1fr)]"
          key={index}
        >
          <div className="space-y-3 bg-background p-4">
            <SkeletonBox className="h-5 w-28" />
            <SkeletonBox className="h-3 w-20" />
            <SkeletonBox className="h-16 w-full" />
          </div>
          <div className="space-y-4 bg-background p-4">
            <SkeletonBox className="h-3 w-44" />
            <SkeletonBox className="h-4 w-full" />
            <SkeletonBox className="h-4 w-5/6" />
            <SkeletonBox className="h-4 w-2/3" />
          </div>
        </div>
      ))}
      <div className="border border-row-border p-4">
        <SkeletonBox className="h-3 w-32" />
        <SkeletonBox className="mt-3 h-24 w-full" />
        <SkeletonBox className="mt-4 h-9 w-32" />
      </div>
    </div>
  );
}

function ForumUserCpSkeleton({ label }: { label: string }) {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className="grid gap-px border border-row-border bg-row-border lg:grid-cols-[14rem_minmax(0,1fr)]"
      role="status"
    >
      <span className="sr-only">{label}</span>
      <aside className="space-y-3 bg-background p-4">
        <p className="font-mono text-[11px] uppercase text-muted-foreground">
          {label}
        </p>
        <SkeletonBox className="h-8 w-full" />
        <SkeletonBox className="h-8 w-full" />
      </aside>
      <div className="space-y-4 bg-background p-4">
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
      className="space-y-4"
      role="status"
    >
      <span className="sr-only">{label}</span>
      <div className="border-y border-row-border py-3 font-mono text-[11px] uppercase text-muted-foreground">
        {label}
      </div>
      <div className="border border-row-border">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-row-border px-4 py-3">
          <div className="space-y-2">
            <SkeletonBox className="h-3 w-36" />
            <SkeletonBox className="h-4 w-56" />
          </div>
          <SkeletonBox className="h-8 w-28" />
        </div>
        <div className="divide-y divide-row-border">
          {Array.from({ length: 3 }).map((_, index) => (
            <div
              className="grid gap-3 px-4 py-3 odd:bg-muted/15 md:grid-cols-[minmax(0,1fr)_9rem_auto] md:items-center"
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

function SkeletonMetric({ label }: { label: string }) {
  return (
    <div>
      <p className="font-mono text-[10px] uppercase text-muted-foreground md:hidden">
        {label}
      </p>
      <SkeletonBox className="mt-1 h-4 w-10 md:mt-0" />
    </div>
  );
}
