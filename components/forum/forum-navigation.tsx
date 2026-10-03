"use client";

import { Suspense } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useQuery } from "convex-helpers/react/cache/hooks";
import {
  Bookmark,
  Bot,
  CalendarDays,
  ChevronDown,
  Compass,
  HelpCircle,
  LayoutList,
  ListFilter,
  Mail,
  Megaphone,
  Menu,
  MessageSquare,
  Newspaper,
  Search,
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
import { cn } from "@/lib/utils";

const views = [
  { value: "feed", label: "Feed", icon: MessageSquare },
  { value: "news", label: "News", icon: Newspaper },
  { value: "community", label: "Community", icon: Users },
  { value: "boards", label: "Boards", icon: LayoutList },
] as const;

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
    /^\/forum\/(search|messages|saved|subscriptions|control-panel|moderation|help|calendar|announcements|new-posts|todays-posts|login|register)(\/|$)/.test(
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
  const { primarySiteHref } = useForumShellContext();
  const signInHref = `/signin?${new URLSearchParams({ redirectTo: pathname ?? "/forum" })}`;
  const boards =
    overview?.categories.filter(
      (board) => board.kind !== "section" && board.status === "active",
    ) ?? [];
  const postableBoards = boards.filter(
    (board) =>
      board.isPostable &&
      (!navState?.authenticated || board.viewerCanCreateThread !== false),
  );
  const rootBoards = boards.filter(
    (board) =>
      !board.parentCategoryId ||
      !boards.some((parent) => parent._id === board.parentCategoryId),
  );
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
        <div className="mx-auto flex min-h-16 max-w-[1600px] items-center gap-2 px-3 sm:gap-3 sm:px-5 lg:gap-5">
          <SiteSurfaceSwitcher
            activeSurface="forum"
            blogHref={primarySiteHref}
            forumHref={forumHrefForPathname("/forum", pathname)}
            showForumMark
            className="mr-auto text-lg lg:mr-0 lg:w-[200px] lg:text-xl"
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
                className="focus-ring inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full bg-primary px-3 text-sm font-semibold text-primary-foreground sm:px-4"
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
              </DropdownMenuGroup>
              <DropdownMenuGroup>
                <DropdownMenuLabel className="mt-1 px-3 py-2 text-xs text-muted-foreground">
                  Your forum
                </DropdownMenuLabel>
                {navState?.authenticated ? (
                  <>
                    <ForumMenuLink href="/forum/control-panel" icon={Settings2}>
                      Account & preferences
                    </ForumMenuLink>
                    <ForumMenuLink href="/forum/saved" icon={Bookmark}>
                      Saved threads
                    </ForumMenuLink>
                    {navState.trusted && (
                      <>
                        <ForumMenuLink href="/forum/messages" icon={Mail}>
                          Inbox
                          {navState.unreadPrivateMessages > 0 && (
                            <MenuCount count={navState.unreadPrivateMessages} />
                          )}
                        </ForumMenuLink>
                        <ForumMenuLink
                          href="/forum/subscriptions"
                          icon={MessageSquare}
                        >
                          Watched threads
                          {navState.unreadNotifications > 0 && (
                            <MenuCount count={navState.unreadNotifications} />
                          )}
                        </ForumMenuLink>
                      </>
                    )}
                    <ForumMenuLink
                      href="/forum/control-panel/agent-access"
                      icon={Bot}
                    >
                      Agent access & approvals
                    </ForumMenuLink>
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
        className="forum-left-rail fixed bottom-0 top-[var(--site-header-offset)] z-30 hidden w-[220px] overflow-y-auto overscroll-contain px-3 py-5 lg:block"
        aria-label="Forum navigation"
      >
        <nav aria-label="Forum sections" className="space-y-1">
          {views.map(({ value, label, icon: Icon }) => (
            <ForumLink
              key={value}
              href={forumHomeHref(value)}
              aria-current={active === value ? "page" : undefined}
              className={cn("forum-rail-link", active === value && "is-active")}
            >
              <Icon aria-hidden="true" className="size-[19px]" />
              <span>{label}</span>
            </ForumLink>
          ))}
        </nav>
        <div className="mt-6">
          <p className="forum-rail-heading">Your space</p>
          {navState?.authenticated ? (
            <nav aria-label="Personal forum tools" className="space-y-1">
              <ForumRailLink href="/forum/saved" icon={Bookmark}>
                Saved threads
              </ForumRailLink>
              {navState.trusted && (
                <>
                  <ForumRailLink href="/forum/subscriptions" icon={Bell}>
                    Following
                  </ForumRailLink>
                  <ForumRailLink href="/forum/messages" icon={Mail}>
                    Inbox
                    {navState.unreadPrivateMessages > 0 && (
                      <MenuCount count={navState.unreadPrivateMessages} />
                    )}
                  </ForumRailLink>
                </>
              )}
              <ForumRailLink
                href="/forum/control-panel/agent-access"
                icon={Bot}
              >
                Agent access
              </ForumRailLink>
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
        </div>
        {boards.length > 0 && (
          <div className="mt-6">
            <p className="forum-rail-heading">Boards</p>
            <nav aria-label="Boards" className="space-y-1">
              {rootBoards.map((board) => (
                <ForumLink
                  key={board._id}
                  href={forumPath(board.slug)}
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
                  <span className="truncate">{getCategoryTitle(board)}</span>
                </ForumLink>
              ))}
              <ForumRailLink href={forumHomeHref("boards")} icon={Compass}>
                Browse all boards
              </ForumRailLink>
            </nav>
          </div>
        )}
        <div className="mt-6">
          <p className="forum-rail-heading">Community</p>
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
        </div>
        <a
          className="focus-ring mt-6 block px-3 py-3 text-xs text-muted-foreground hover:text-foreground"
          href={primarySiteHref}
        >
          SYMBaiEX home ↗
        </a>
      </aside>
      <nav
        aria-label="Forum sections on mobile"
        className="forum-bottom-nav fixed inset-x-0 bottom-0 z-50 bg-card pb-[env(safe-area-inset-bottom)] lg:hidden"
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
}: {
  href: string;
  icon: typeof Search;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const active = normalizedForumPathname(pathname) === href;
  return (
    <ForumLink
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn("forum-rail-link", active && "is-active")}
    >
      <Icon aria-hidden="true" className="size-[19px] shrink-0" />
      <span className="min-w-0 flex-1">{children}</span>
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
