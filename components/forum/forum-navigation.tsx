"use client";
import { SYMF_TOKEN } from "@/lib/symf-token";

import { Suspense } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useQuery } from "convex-helpers/react/cache/hooks";
import {
  Bookmark,
  Bot,
  CalendarDays,
  ChevronDown,
  Compass,
  Coins,
  ArrowLeftRight,
  Archive,
  ChartCandlestick,
  Handshake,
  HelpCircle,
  LayoutList,
  ListFilter,
  Mail,
  Megaphone,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  MessageSquare,
  Newspaper,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Plus,
  Bell,
  UserRound,
  Users,
} from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { SiteSurfaceSwitcher } from "@/components/site-surface-switcher";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ForumLink } from "./forum-link";
import { forumHomeHref, type ForumHomeView } from "./forum-home-model";
import {
  forumRefs,
  normalizedForumPathname,
  forumHrefForPathname,
  forumPath,
  getCategoryTitle,
  type ForumOverviewRecord,
} from "./forum-refs";
import { primarySiteHrefForPath } from "./forum-host-url";
import { useForumShellContext } from "./forum-shell-context";
import {
  FORUM_PERSONAL_NAVIGATION,
  FORUM_PRIMARY_NAVIGATION,
} from "@/lib/forum-navigation-model";
import { cn } from "@/lib/utils";
import { FORUM_TELEGRAM_URL } from "@/lib/site-urls";

const navigationIcons = {
  feed: MessageSquare,
  news: Newspaper,
  community: Users,
  boards: LayoutList,
  bookmarks: Bookmark,
  following: Bell,
  inbox: Mail,
  agents: Bot,
};
const views = FORUM_PRIMARY_NAVIGATION.map((item) => ({
  ...item,
  icon: navigationIcons[item.icon],
}));

type NavState = {
  authenticated: boolean;
  username: string | null;
  trusted: boolean;
  canModerate?: boolean;
  canManageBoards?: boolean;
  unreadPrivateMessages: number;
  unreadNotifications: number;
};

/** Personal tools stay in the menu; board and thread URLs retain Boards context. */
export function activeForumSection(
  pathname: string | null,
  view: string | null,
): ForumHomeView | null {
  const path = normalizedForumPathname(pathname);
  if (path === "/forum")
    return views.find((item) => item.value === view)?.value ?? "feed";
  if (/^\/forum\/(members|agents|online)(\/|$)/.test(path)) return "community";
  if (
    /^\/forum\/(symf|swap|trade|community|start-here|search|messages|saved|subscriptions|control-panel|moderation|help|calendar|announcements|new-posts|todays-posts|login|register)(\/|$)/.test(
      path,
    )
  )
    return null;
  return "boards";
}

export function ForumNavigation() {
  return (
    <Suspense fallback={<ForumNavigationLayout active={null} />}>
      <ForumNavigationState />
    </Suspense>
  );
}

function ForumNavigationState() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const active = activeForumSection(pathname, searchParams.get("view"));
  if (!process.env.NEXT_PUBLIC_CONVEX_URL)
    return (
      <ForumNavigationLayout
        active={active}
        navState={{
          authenticated: false,
          username: null,
          trusted: false,
          unreadPrivateMessages: 0,
          unreadNotifications: 0,
        }}
      />
    );
  return <ConnectedForumNavigation active={active} />;
}

function ConnectedForumNavigation({
  active,
}: {
  active: ForumHomeView | null;
}) {
  const navState = useQuery(forumRefs.getMyForumNavState, {});
  const overview = useQuery(forumRefs.overview, {});
  return (
    <ForumNavigationLayout
      active={active}
      navState={navState}
      overview={overview}
    />
  );
}

const iconControl =
  "focus-ring relative inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground";

export function ForumNavigationLayout({
  active,
  navState,
  overview,
}: {
  active: ForumHomeView | null;
  navState?: NavState;
  overview?: ForumOverviewRecord;
}) {
  const pathname = usePathname();
  const { primarySiteHref, compactNavigation, toggleNavigation } =
    useForumShellContext();
  const signInHref = `/signin?${new URLSearchParams({ redirectTo: pathname ?? "/forum" })}`;
  const boards =
    overview?.categories.filter(
      (board) => board.kind !== "section" && board.status === "active",
    ) ?? [];
  const postableBoards = boards.filter(
    (board) =>
      board.readOnlyArchive !== true &&
      board.isPostable &&
      (!navState?.authenticated || board.viewerCanCreateThread !== false),
  );
  const rootBoards = boards
    .filter(
      (board) =>
        board.readOnlyArchive !== true &&
        (!board.parentCategoryId ||
          !boards.some((parent) => parent._id === board.parentCategoryId)),
    )
    .sort(
      (a, b) =>
        (a.position ?? Number.MAX_SAFE_INTEGER) -
        (b.position ?? Number.MAX_SAFE_INTEGER),
    );
  const archive =
    overview?.sections.find(
      ({ section }) =>
        section?.slug === "archive" &&
        section.kind === "section" &&
        section.status === "active",
    )?.section ?? undefined;
  const path = normalizedForumPathname(pathname);
  let currentBoard = boards.find(
    (board) =>
      path === forumPath(board.slug) ||
      path.startsWith(`${forumPath(board.slug)}/`),
  );
  for (
    let depth = 0;
    currentBoard?.parentCategoryId && depth < boards.length;
    depth++
  ) {
    const parent = boards.find(
      (board) => board._id === currentBoard?.parentCategoryId,
    );
    if (!parent) break;
    currentBoard = parent;
  }
  return (
    <>
      <header className="forum-topbar fixed inset-x-0 top-0 z-50 bg-card pt-[env(safe-area-inset-top)]">
        <div className="forum-topbar-inner flex items-center gap-2 px-3 sm:gap-3">
          <button
            type="button"
            onClick={toggleNavigation}
            aria-label={
              compactNavigation ? "Expand navigation" : "Collapse navigation"
            }
            aria-expanded={!compactNavigation}
            aria-controls="forum-navigation-rail"
            className={`${iconControl} forum-navigation-toggle hidden md:inline-flex`}
            title={
              compactNavigation ? "Expand navigation" : "Collapse navigation"
            }
          >
            {compactNavigation ? (
              <PanelLeftOpen className="size-[18px]" aria-hidden="true" />
            ) : (
              <PanelLeftClose className="size-[18px]" aria-hidden="true" />
            )}
          </button>
          <SiteSurfaceSwitcher
            activeSurface="forum"
            currentPathname={pathname}
            homeHref={primarySiteHref}
            forumHref={forumHrefForPathname("/forum", pathname)}
            showForumMark
            className="forum-brand mr-auto text-lg sm:mr-2"
          />
          <form
            action={forumHrefForPathname("/forum/search", pathname)}
            method="get"
            role="search"
            className="forum-global-search hidden min-w-0 max-w-[640px] flex-1 items-center gap-3 rounded-full bg-muted/65 px-4 sm:flex"
          >
            <Search
              className="size-[18px] shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <input
              name="q"
              aria-label="Search SYMBaiEX Forum"
              placeholder="Search SYMBaiEX Forum"
              className="h-11 min-w-0 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </form>
          <ForumLink
            href="/forum/search"
            aria-label="Search the forum"
            className={`${iconControl} sm:hidden`}
          >
            <Search aria-hidden="true" className="size-[18px]" />
          </ForumLink>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="forum-primary-action focus-ring inline-flex shrink-0 items-center gap-1.5 rounded-full bg-primary px-3 text-sm font-semibold text-primary-foreground sm:px-4"
                aria-label="Create post"
              >
                <Plus aria-hidden="true" className="size-[18px]" />
                <span className="hidden md:inline">Create post</span>
                <span className="hidden min-[360px]:inline md:hidden">
                  Post
                </span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              sideOffset={8}
              className="forum-shell-menu max-h-[60dvh] w-72 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border-0 bg-popover p-2 shadow-lg"
            >
              <DropdownMenuLabel className="px-3 py-2 text-xs text-muted-foreground">
                Choose a board for your post
              </DropdownMenuLabel>
              {postableBoards.map((board) => (
                <ForumMenuLink
                  key={board._id}
                  href={`${forumPath(board.slug)}?compose=1`}
                  icon={MessageSquare}
                >
                  {getCategoryTitle(board)}
                </ForumMenuLink>
              ))}
              {!postableBoards.length && (
                <ForumMenuLink href={forumHomeHref("boards")} icon={LayoutList}>
                  Browse boards
                </ForumMenuLink>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          {navState?.authenticated && navState.trusted ? (
            <ForumLink
              href="/forum/messages"
              aria-label={
                navState.unreadPrivateMessages
                  ? `Inbox, ${navState.unreadPrivateMessages} unread messages`
                  : "Inbox"
              }
              className={`${iconControl} hidden sm:inline-flex`}
            >
              <Mail aria-hidden="true" className="size-[18px]" />
              {navState.unreadPrivateMessages > 0 && (
                <span className="absolute right-1 top-1 size-1.5 bg-primary" />
              )}
            </ForumLink>
          ) : null}
          <div className="hidden sm:block">
            <ThemeToggle />
          </div>
          {navState?.authenticated === false && (
            <ForumLink
              href={signInHref}
              className="focus-ring hidden min-h-11 items-center px-3 text-sm font-medium sm:inline-flex"
            >
              Sign in
            </ForumLink>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={`${iconControl} lg:w-auto lg:gap-2 lg:px-3`}
                aria-label="Forum menu"
              >
                <Menu aria-hidden="true" className="size-[18px] lg:hidden" />
                <UserRound
                  aria-hidden="true"
                  className="hidden size-[18px] lg:block"
                />
                <span className="hidden max-w-28 truncate text-sm lg:inline">
                  {navState?.authenticated
                    ? (navState.username ?? "Account")
                    : "More"}
                </span>
                <ChevronDown
                  aria-hidden="true"
                  className="hidden size-3 lg:block"
                />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              sideOffset={8}
              className="forum-shell-menu max-h-[calc(100dvh-6rem)] w-72 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border-0 bg-popover p-2 shadow-lg"
            >
              <DropdownMenuGroup className="lg:hidden">
                <DropdownMenuLabel className="px-3 py-2 text-xs text-muted-foreground">
                  Browse
                </DropdownMenuLabel>
                {views.map(({ value, label, icon }) => (
                  <ForumMenuLink
                    key={value}
                    href={forumHomeHref(value)}
                    icon={icon}
                  >
                    {label}
                  </ForumMenuLink>
                ))}
              </DropdownMenuGroup>
              <DropdownMenuGroup>
                <DropdownMenuLabel className="px-3 py-2 text-xs text-muted-foreground">
                  Around the forum
                </DropdownMenuLabel>
                <ForumMenuLink href="/forum/start-here" icon={Compass}>
                  Start here
                </ForumMenuLink>
                <ForumMenuLink href="/forum/symf" icon={Coins}>
                  ${SYMF_TOKEN.symbol}
                </ForumMenuLink>
                <ForumMenuLink href="/forum/swap" icon={ArrowLeftRight}>
                  Swap tokens
                </ForumMenuLink>
                <ForumMenuLink href="/forum/trade" icon={ChartCandlestick}>
                  Trading terminal
                </ForumMenuLink>
                <ForumMenuLink href="/forum/community" icon={Handshake}>
                  Community utilities
                </ForumMenuLink>
                <ForumMenuLink href="/forum/new-posts" icon={Compass}>
                  New posts
                </ForumMenuLink>
                <ForumMenuLink href="/forum/todays-posts" icon={ListFilter}>
                  Today’s posts
                </ForumMenuLink>
                <ForumMenuLink href="/forum/members" icon={Users}>
                  Members
                </ForumMenuLink>
                <ForumMenuLink href="/forum/online" icon={UserRound}>
                  Who’s online
                </ForumMenuLink>
                <ForumMenuLink href="/forum/agents" icon={Bot}>
                  Agents
                </ForumMenuLink>
                <ForumMenuLink href="/forum/calendar" icon={CalendarDays}>
                  Calendar
                </ForumMenuLink>
                <ForumMenuLink href="/forum/announcements" icon={Megaphone}>
                  Announcements
                </ForumMenuLink>
                <ForumMenuLink href="/forum/help" icon={HelpCircle}>
                  Help
                </ForumMenuLink>
                <DropdownMenuItem
                  asChild
                  className="min-h-11 rounded-lg px-3 focus:bg-muted focus:text-foreground"
                >
                  <a
                    href={FORUM_TELEGRAM_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Send
                      aria-hidden="true"
                      className="text-muted-foreground"
                    />
                    Telegram community
                  </a>
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuGroup>
                <DropdownMenuLabel className="mt-1 px-3 py-2 text-xs text-muted-foreground">
                  Your forum
                </DropdownMenuLabel>
                {navState?.authenticated ? (
                  <>
                    {FORUM_PERSONAL_NAVIGATION.filter(
                      (item) => !item.trusted || navState.trusted,
                    ).map((item) => (
                      <ForumMenuLink
                        key={item.view}
                        href={item.href}
                        icon={navigationIcons[item.icon]}
                      >
                        {item.label}
                        {item.view === "inbox" &&
                          navState.unreadPrivateMessages > 0 && (
                            <MenuCount count={navState.unreadPrivateMessages} />
                          )}
                        {item.view === "following" &&
                          navState.unreadNotifications > 0 && (
                            <MenuCount count={navState.unreadNotifications} />
                          )}
                      </ForumMenuLink>
                    ))}
                    {navState.canModerate && (
                      <ForumMenuLink
                        href="/forum/moderation"
                        icon={ShieldCheck}
                      >
                        Moderation
                      </ForumMenuLink>
                    )}
                    {navState.canManageBoards && (
                      <DropdownMenuItem asChild className="min-h-11 px-3">
                        <a
                          href={primarySiteHrefForPath(
                            primarySiteHref,
                            "/admin",
                          )}
                        >
                          <ShieldCheck aria-hidden="true" />
                          Administration
                        </a>
                      </DropdownMenuItem>
                    )}
                  </>
                ) : navState ? (
                  <ForumMenuLink href={signInHref} icon={UserRound}>
                    Sign in to participate
                  </ForumMenuLink>
                ) : (
                  <p
                    className="px-3 py-2 text-xs text-muted-foreground"
                    role="status"
                  >
                    Checking your session…
                  </p>
                )}
              </DropdownMenuGroup>
              <div className="mt-2 flex items-center justify-between gap-2 px-3 py-1">
                <a
                  href={primarySiteHref}
                  className="focus-ring inline-flex min-h-11 items-center text-xs text-muted-foreground hover:text-foreground"
                >
                  SYMBaiEX home
                </a>
                <ThemeToggle />
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      <aside
        id="forum-navigation-rail"
        className="forum-left-rail fixed bottom-0 top-[var(--site-header-offset)] z-30 hidden overflow-y-auto overscroll-contain md:block"
        aria-label="Forum navigation"
      >
        <nav aria-label="Forum sections" className="space-y-1">
          {views.map(({ value, label, icon: Icon }) => (
            <ForumLink
              key={value}
              href={forumHomeHref(value)}
              title={label}
              aria-label={label}
              aria-current={active === value ? "page" : undefined}
              className={cn("forum-rail-link", active === value && "is-active")}
            >
              <Icon aria-hidden="true" className="size-[19px]" />
              <span className="forum-nav-label">{label}</span>
            </ForumLink>
          ))}
        </nav>
        <ForumRailLink href="/forum/start-here" icon={Compass}>
          Start here
        </ForumRailLink>
        <ForumRailLink href="/forum/symf" icon={Coins}>
          {`$${SYMF_TOKEN.symbol}`}
        </ForumRailLink>
        <ForumRailLink href="/forum/swap" icon={ArrowLeftRight}>
          Swap tokens
        </ForumRailLink>
        <ForumRailLink href="/forum/trade" icon={ChartCandlestick}>
          Trading terminal
        </ForumRailLink>
        <ForumRailLink href="/forum/community" icon={Handshake}>
          Community utilities
        </ForumRailLink>
        <a
          href={FORUM_TELEGRAM_URL}
          target="_blank"
          rel="noopener noreferrer"
          title="Telegram community"
          aria-label="SYMBaiEX Forum Telegram community"
          className="forum-rail-link"
        >
          <Send aria-hidden="true" className="size-[19px] shrink-0" />
          <span className="forum-nav-label">Telegram community</span>
        </a>
        {navState?.authenticated && (
          <nav
            aria-label="Quick personal tools"
            className="forum-compact-shortcuts"
          >
            {FORUM_PERSONAL_NAVIGATION.filter(
              (item) =>
                ["catch-up", "bookmarks", "access", "inbox"].includes(
                  item.view,
                ) &&
                (!item.trusted || navState.trusted),
            ).map((item) => {
              const Icon = navigationIcons[item.icon];
              return (
                <ForumLink
                  key={item.view}
                  href={item.href}
                  className="forum-rail-link"
                  aria-label={item.label}
                  title={item.label}
                  aria-current={path === item.href ? "page" : undefined}
                >
                  <Icon className="size-[18px]" aria-hidden="true" />
                </ForumLink>
              );
            })}
          </nav>
        )}
        <RailGroup label="Your space" open>
          {navState?.authenticated ? (
            <nav aria-label="Personal forum tools" className="space-y-1">
              {FORUM_PERSONAL_NAVIGATION.filter(
                (item) => !item.trusted || navState.trusted,
              ).map((item) => (
                <ForumRailLink
                  key={item.view}
                  href={item.href}
                  icon={navigationIcons[item.icon]}
                >
                  {item.label}
                  {item.view === "inbox" &&
                    navState.unreadPrivateMessages > 0 && (
                      <MenuCount count={navState.unreadPrivateMessages} />
                    )}
                </ForumRailLink>
              ))}
              {navState.canModerate && (
                <ForumRailLink href="/forum/moderation" icon={ShieldCheck}>
                  Moderation
                </ForumRailLink>
              )}
            </nav>
          ) : (
            <ForumLink href={signInHref} className="forum-rail-link">
              <UserRound aria-hidden="true" className="size-[19px]" />
              Sign in to join in
            </ForumLink>
          )}
        </RailGroup>
        {(boards.length > 0 || archive !== undefined) && (
          <RailGroup
            label="Boards"
            open={active === "boards"}
            count={rootBoards.length}
          >
            <nav aria-label="Boards" className="space-y-1">
              {rootBoards.map((board) => (
                <ForumLink
                  key={board._id}
                  href={forumPath(board.slug)}
                  title={getCategoryTitle(board)}
                  aria-label={getCategoryTitle(board)}
                  className={cn(
                    "forum-rail-link",
                    currentBoard?._id === board._id && "is-active",
                  )}
                  aria-current={
                    currentBoard?._id === board._id ? "page" : undefined
                  }
                >
                  <span
                    aria-hidden="true"
                    className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-xs font-bold text-accent"
                  >
                    {getCategoryTitle(board).slice(0, 1)}
                  </span>
                  <span className="forum-nav-label truncate">
                    {getCategoryTitle(board)}
                  </span>
                </ForumLink>
              ))}
              {archive && (
                <ForumRailLink
                  href={forumPath(archive.slug)}
                  icon={Archive}
                  active={
                    currentBoard?.readOnlyArchive === true ||
                    path === forumPath(archive.slug)
                  }
                >
                  Archive
                </ForumRailLink>
              )}
              <ForumRailLink href={forumHomeHref("boards")} icon={Compass}>
                Browse all boards
              </ForumRailLink>
            </nav>
          </RailGroup>
        )}
        <RailGroup label="Explore" open={active === "community"}>
          <nav aria-label="Community resources" className="space-y-1">
            <ForumRailLink href="/forum/members" icon={Users}>
              Members
            </ForumRailLink>
            <ForumRailLink href="/forum/agents" icon={Bot}>
              Agents
            </ForumRailLink>
            <ForumRailLink href="/forum/announcements" icon={Megaphone}>
              Announcements
            </ForumRailLink>
            <ForumRailLink href="/forum/calendar" icon={CalendarDays}>
              Calendar
            </ForumRailLink>
            <ForumRailLink href="/forum/help" icon={HelpCircle}>
              Help & rules
            </ForumRailLink>
          </nav>
        </RailGroup>
        <a
          className="forum-rail-home focus-ring mt-4 block px-3 py-3 text-xs text-muted-foreground hover:text-foreground"
          href={primarySiteHref}
        >
          SYMBaiEX home ↗
        </a>
      </aside>
      <nav
        aria-label="Forum sections on mobile"
        className="forum-bottom-nav fixed inset-x-0 bottom-0 z-50 bg-card pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        <div className="mx-auto grid max-w-lg grid-cols-4 px-2">
          {views.map(({ value, label, icon: Icon }) => (
            <ForumLink
              key={value}
              href={forumHomeHref(value)}
              aria-current={active === value ? "page" : undefined}
              className={cn(
                "focus-ring flex min-h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium",
                active === value
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon aria-hidden="true" className="size-[19px]" />
              <span>{label}</span>
            </ForumLink>
          ))}
        </div>
      </nav>
    </>
  );
}

function ForumMenuLink({
  href,
  icon: Icon,
  children,
}: {
  href: string;
  icon: typeof Search;
  children: React.ReactNode;
}) {
  return (
    <DropdownMenuItem
      asChild
      className="min-h-11 rounded-lg px-3 focus:bg-muted focus:text-foreground"
    >
      <ForumLink href={href}>
        <Icon aria-hidden="true" className="text-muted-foreground" />
        {children}
      </ForumLink>
    </DropdownMenuItem>
  );
}

function ForumRailLink({
  href,
  icon: Icon,
  children,
  active: activeOverride,
}: {
  href: string;
  icon: typeof Search;
  children: React.ReactNode;
  active?: boolean;
}) {
  const pathname = usePathname();
  const active = activeOverride ?? (normalizedForumPathname(pathname) === href);
  return (
    <ForumLink
      href={href}
      title={typeof children === "string" ? children : undefined}
      aria-label={typeof children === "string" ? children : undefined}
      aria-current={active ? "page" : undefined}
      className={cn("forum-rail-link", active && "is-active")}
    >
      <Icon aria-hidden="true" className="size-[19px] shrink-0" />
      <span className="forum-nav-label min-w-0 flex-1">{children}</span>
    </ForumLink>
  );
}

function MenuCount({ count }: { count: number }) {
  return (
    <span className="ml-auto font-mono text-xs text-primary">
      {count > 99 ? "99+" : count}
    </span>
  );
}

function RailGroup({
  label,
  open,
  count,
  children,
}: {
  label: string;
  open?: boolean;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <details className="forum-rail-group group/rail" open={open || undefined}>
      <summary className="forum-rail-heading focus-ring flex cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
        <span className="flex-1">{label}</span>
        {count !== undefined && (
          <span className="font-mono text-[10px] tabular-nums">{count}</span>
        )}
        <ChevronDown
          className="size-3 transition-transform group-open/rail:rotate-180"
          aria-hidden="true"
        />
      </summary>
      {children}
    </details>
  );
}
