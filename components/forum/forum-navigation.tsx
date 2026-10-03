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
  UserRound,
  Users,
} from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
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
import { forumRefs, normalizedForumPathname } from "./forum-refs";
import { primarySiteHrefForPath } from "./forum-host-url";
import { useForumShellContext } from "./forum-shell-context";
import { cn } from "@/lib/utils";

const views = [
  { value: "boards", label: "Boards", icon: LayoutList },
  { value: "feed", label: "Feed", icon: MessageSquare },
  { value: "news", label: "News", icon: Newspaper },
  { value: "community", label: "Community", icon: Users },
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
    return views.find((item) => item.value === view)?.value ?? "boards";
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
  return <ForumNavigationLayout active={active} navState={navState} />;
}

const iconControl =
  "focus-ring relative inline-flex size-11 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground";

export function ForumNavigationLayout({
  active,
  navState,
}: {
  active: ForumHomeView | null;
  navState?: NavState;
}) {
  const pathname = usePathname();
  const { primarySiteHref } = useForumShellContext();
  const signInHref = `/signin?${new URLSearchParams({ redirectTo: pathname ?? "/forum" })}`;
  return (
    <>
      <header className="forum-topbar fixed inset-x-0 top-0 z-50 bg-background">
        <div className="mx-auto flex min-h-16 max-w-7xl items-center gap-2 px-4 pt-[env(safe-area-inset-top)] md:px-8 lg:gap-5">
          <ForumLink
            href="/forum"
            className="focus-ring mr-auto flex min-h-11 shrink-0 items-center gap-2.5 text-xl font-extrabold tracking-tight lg:mr-0"
          >
            <span>
              SYMB<span className="text-primary">ai</span>EX
            </span>
            <span className="hidden text-sm font-medium tracking-normal text-muted-foreground sm:inline">
              Forum
            </span>
            <span className="sr-only sm:hidden"> Forum</span>
          </ForumLink>
          <nav
            aria-label="Forum sections"
            className="mr-auto hidden items-center gap-1 lg:flex"
          >
            {views.map(({ value, label }) => (
              <ForumLink
                key={value}
                href={forumHomeHref(value)}
                aria-current={active === value ? "page" : undefined}
                className={cn(
                  "focus-ring inline-flex min-h-11 items-center rounded-sm px-3 text-sm font-medium",
                  active === value
                    ? "bg-primary/10 text-primary hover:bg-primary/15"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {label}
              </ForumLink>
            ))}
          </nav>
          <ForumLink
            href="/forum/search"
            aria-label="Search the forum"
            className={iconControl}
          >
            <Search aria-hidden="true" className="size-[18px]" />
          </ForumLink>
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
              className="forum-shell-menu max-h-[calc(100dvh-6rem)] w-72 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-sm border-0 bg-popover p-2 shadow-lg"
            >
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
      <nav
        aria-label="Forum sections on mobile"
        className="forum-bottom-nav fixed inset-x-0 bottom-0 z-50 bg-background pb-[env(safe-area-inset-bottom)] lg:hidden"
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
      className="min-h-11 rounded-sm px-3 focus:bg-muted focus:text-foreground"
    >
      <ForumLink href={href}>
        <Icon aria-hidden="true" className="text-muted-foreground" />
        {children}
      </ForumLink>
    </DropdownMenuItem>
  );
}

function MenuCount({ count }: { count: number }) {
  return (
    <span className="ml-auto font-mono text-xs text-primary">
      {count > 99 ? "99+" : count}
    </span>
  );
}
