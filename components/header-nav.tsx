"use client";
import { installation } from "@/lib/installation";

import { asRoute } from "@/lib/typed-route";

import { ThemeToggle } from "@/components/ThemeToggle";
import {
  isForumHostname,
  primarySiteHrefForForumHost,
} from "@/components/forum/forum-host-url";
import {
  isExternalHeaderHref,
  isHeaderRouteActive,
  resolveHeaderNavActive,
  resolveHeaderNavHref,
  shouldUseHeaderDocumentNavigation,
} from "@/components/header-nav-routing";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { convexRefs } from "@/lib/convex-refs";
import { useConvexAuth, useQuery } from "convex/react";
import {
  Bot,
  ChevronDown,
  Cpu,
  Gauge,
  KeyRound,
  Menu,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const navItems = [
  { href: "/", label: "Home" },
  { href: "/about", label: "About" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/contact", label: "Contact" },
];

const ownerNavItems = [
  {
    href: "/admin",
    label: "Admin",
    note: "Control deck",
    icon: ShieldCheck,
  },
  {
    href: "/admin/telemetry",
    label: "Metrics",
    note: "OpenRouter + agents",
    icon: Gauge,
  },
  {
    href: "/admin/ai",
    label: "AI operator",
    note: "Owner assistant",
    icon: Bot,
  },
  {
    href: "/admin/api",
    label: "API access",
    note: "Keys + routes",
    icon: KeyRound,
  },
  {
    href: installation.links.agentConsole,
    label: "Model host",
    note: "Power + model API",
    icon: Cpu,
  },
] as const;
const configuredOwnerNavItems = ownerNavItems.filter(item => Boolean(item.href));

export function HeaderNav({
  compact = false,
  initialForumHost = false,
  initialPrimarySiteHref = "/",
}: {
  compact?: boolean;
  initialForumHost?: boolean;
  initialPrimarySiteHref?: string;
}) {
  if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
    return (
      <NavRow
        compact={compact}
        authHref="/signin"
        authLabel="Sign in"
        initialForumHost={initialForumHost}
        initialPrimarySiteHref={initialPrimarySiteHref}
      />
    );
  }

  return (
    <LiveHeaderNav
      compact={compact}
      initialForumHost={initialForumHost}
      initialPrimarySiteHref={initialPrimarySiteHref}
    />
  );
}

function LiveHeaderNav({
  compact,
  initialForumHost,
  initialPrimarySiteHref,
}: {
  compact: boolean;
  initialForumHost: boolean;
  initialPrimarySiteHref: string;
}) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const viewer = useQuery(
    convexRefs.admin.viewer,
    isAuthenticated ? {} : "skip",
  );
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || isLoading) {
    return (
      <NavRow
        compact={compact}
        authPending
        initialForumHost={initialForumHost}
        initialPrimarySiteHref={initialPrimarySiteHref}
      />
    );
  }

  if (isAuthenticated) {
    return (
      <NavRow
        compact={compact}
        adminAccess={
          viewer?.canAccessAdmin === true ||
          viewer?.canAdminForum === true ||
          viewer?.canModerateForum === true
        }
        authHref="/profile"
        authLabel="Profile"
        ownerAccess={viewer?.isOwner === true}
        initialForumHost={initialForumHost}
        initialPrimarySiteHref={initialPrimarySiteHref}
      />
    );
  }

  return (
    <NavRow
      compact={compact}
      authHref="/signin"
      authLabel="Sign in"
      initialForumHost={initialForumHost}
      initialPrimarySiteHref={initialPrimarySiteHref}
    />
  );
}

function NavRow({
  compact = false,
  adminAccess = false,
  authHref,
  authLabel,
  authPending = false,
  initialForumHost = false,
  initialPrimarySiteHref = "/",
  ownerAccess = false,
}: {
  adminAccess?: boolean;
  authHref?: string;
  authLabel?: string;
  authPending?: boolean;
  compact?: boolean;
  initialForumHost?: boolean;
  initialPrimarySiteHref?: string;
  ownerAccess?: boolean;
}) {
  const pathname = usePathname() ?? "/";
  const [forumHost, setForumHost] = useState(initialForumHost);
  const [primarySiteHref, setPrimarySiteHref] = useState(
    initialPrimarySiteHref,
  );
  const browserLocation =
    typeof window === "undefined" ? undefined : window.location;

  useEffect(() => {
    if (isForumHostname(window.location.hostname)) {
      setForumHost(true);
      setPrimarySiteHref(primarySiteHrefForForumHost("/", window.location));
    } else {
      setForumHost(false);
      setPrimarySiteHref("/");
    }
  }, []);

  const authIsActive = authHref
    ? isHeaderRouteActive(pathname, authHref)
    : false;
  const resolveHref = (href: string) => {
    return resolveHeaderNavHref({
      forumHost,
      href,
      location: forumHost ? browserLocation : undefined,
      pathname,
      primarySiteHref,
    });
  };
  const resolveActive = (href: string) => {
    return resolveHeaderNavActive({ forumHost, href, pathname });
  };
  const resolvedAuthHref = authHref ? resolveHref(authHref) : undefined;
  const authLinkHref =
    resolvedAuthHref && authHref === "/signin" && pathname !== "/signin"
      ? `${resolvedAuthHref}?redirectTo=${encodeURIComponent(pathname)}`
      : resolvedAuthHref;

  return (
    <nav aria-label="Primary" className="flex min-w-0 items-center gap-1.5">
      <div className="hidden min-w-0 items-center gap-1 lg:flex">
        {(compact
          ? navItems.filter((item) => item.href === "/")
          : navItems
        ).map((item) => {
          const href = resolveHref(item.href);
          return (
            <DesktopNavLink
              active={resolveActive(item.href)}
              documentNavigation={shouldUseHeaderDocumentNavigation({
                forumHost,
                href: item.href,
                resolvedHref: href,
              })}
              href={href}
              key={item.href}
            >
              {item.label}
            </DesktopNavLink>
          );
        })}
        {adminAccess ? (
          <DesktopOwnerMenu
            active={isHeaderRouteActive(pathname, "/admin")}
            ownerAccess={ownerAccess}
            resolveHref={resolveHref}
          />
        ) : null}
        <span className="inline-flex w-[4.75rem] shrink-0 justify-center">
          {authPending ? (
            <span
              aria-hidden="true"
              className="inline-flex h-9 w-full items-center justify-center px-2.5"
            >
              <span className="h-3.5 w-12 animate-pulse rounded-md bg-muted" />
            </span>
          ) : authHref && authLabel ? (
            <DesktopNavLink
              active={authIsActive}
              href={authLinkHref ?? resolveHref(authHref)}
            >
              {authLabel}
            </DesktopNavLink>
          ) : null}
        </span>
      </div>
      <div className="flex items-center gap-1.5 lg:hidden">
        <MobileNavMenu
          authHref={authHref}
          authIsActive={authIsActive}
          authLabel={authLabel}
          authLinkHref={authLinkHref}
          authPending={authPending}
          adminAccess={adminAccess}
          forumHost={forumHost}
          ownerAccess={ownerAccess}
          resolveActive={resolveActive}
          resolveHref={resolveHref}
        />
      </div>
      <ThemeToggle />
    </nav>
  );
}

function DesktopNavLink({
  active,
  children,
  documentNavigation = false,
  href,
}: {
  active: boolean;
  children: string;
  documentNavigation?: boolean;
  href: string;
}) {
  const linkContent = documentNavigation ? (
    <a aria-current={active ? "page" : undefined} href={href}>
      {children}
    </a>
  ) : (
    <Link
      aria-current={active ? "page" : undefined}
      href={asRoute(href)}
      prefetch={!isExternalHeaderHref(href)}
    >
      {children}
    </Link>
  );

  return (
    <Button
      asChild
      className={cn(
        "forum-action-pill focus-ring h-9 rounded-lg border border-transparent px-3 text-xs text-muted-foreground hover:border-border hover:bg-muted/60 hover:text-foreground",
        active &&
          "border-primary/20 bg-primary/10 font-semibold text-primary hover:border-primary/20 hover:bg-primary/10 hover:text-primary",
      )}
      size="sm"
      variant="ghost"
    >
      {linkContent}
    </Button>
  );
}

function MobileNavMenu({
  adminAccess,
  authHref,
  authIsActive,
  authLabel,
  authLinkHref,
  authPending,
  forumHost,
  ownerAccess,
  resolveActive,
  resolveHref,
}: {
  adminAccess: boolean;
  authHref?: string;
  authIsActive: boolean;
  authLabel?: string;
  authLinkHref?: string;
  authPending: boolean;
  forumHost: boolean;
  ownerAccess: boolean;
  resolveActive: (href: string) => boolean;
  resolveHref: (href: string) => string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label="Open navigation menu"
          className="focus-ring h-10 w-10 rounded-lg border border-border bg-card text-foreground hover:border-muted-foreground hover:bg-muted"
          size="icon"
          variant="outline"
        >
          <Menu aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="max-h-[calc(100vh-5rem)] w-[min(18rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-border bg-popover p-1.5 text-foreground shadow-lg lg:hidden"
      >
        <DropdownMenuLabel className="px-2 pb-1.5 pt-1 font-mono text-[10px] uppercase text-muted-foreground">
          Menu
        </DropdownMenuLabel>
        <DropdownMenuGroup>
          {navItems.map((item) => {
            const href = resolveHref(item.href);
            return (
              <MobileNavItem
                active={resolveActive(item.href)}
                documentNavigation={shouldUseHeaderDocumentNavigation({
                  forumHost,
                  href: item.href,
                  resolvedHref: href,
                })}
                href={href}
                key={item.href}
                label={item.label}
              />
            );
          })}
        </DropdownMenuGroup>
        {adminAccess ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="px-2 pb-1.5 pt-1 font-mono text-[10px] uppercase text-muted-foreground">
              Owner console
            </DropdownMenuLabel>
            <DropdownMenuGroup>
              {(ownerAccess ? configuredOwnerNavItems : configuredOwnerNavItems.slice(0, 1)).map(
                (item) => (
                  <MobileNavItem
                    active={resolveActive(item.href)}
                    href={asRoute(resolveHref(item.href))}
                    key={item.href}
                    label={item.label}
                  />
                ),
              )}
            </DropdownMenuGroup>
          </>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          {authPending ? (
            <DropdownMenuItem className="h-10 rounded-lg px-3" disabled>
              <span
                aria-hidden="true"
                className="h-3 w-16 animate-pulse rounded-md bg-muted"
              />
            </DropdownMenuItem>
          ) : authHref && authLabel ? (
            <MobileNavItem
              active={authIsActive}
              href={authLinkHref ?? resolveHref(authHref)}
              label={authLabel}
            />
          ) : null}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DesktopOwnerMenu({
  active,
  ownerAccess,
  resolveHref,
}: {
  active: boolean;
  ownerAccess: boolean;
  resolveHref: (href: string) => string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label="Open owner console navigation"
          className={cn(
            "forum-action-pill focus-ring h-9 rounded-lg border border-transparent px-3 text-xs text-muted-foreground hover:border-border hover:bg-muted/60 hover:text-foreground",
            active &&
              "border-primary/20 bg-primary/10 font-semibold text-primary hover:border-primary/20 hover:bg-primary/10 hover:text-primary",
          )}
          size="sm"
          variant="ghost"
        >
          Console
          <ChevronDown className="size-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-64 rounded-xl border border-border bg-popover p-1.5 shadow-lg"
      >
        <DropdownMenuLabel className="px-2 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          Owner routes
        </DropdownMenuLabel>
        <DropdownMenuGroup>
          {(ownerAccess ? configuredOwnerNavItems : configuredOwnerNavItems.slice(0, 1)).map(
            (item) => {
              const Icon = item.icon;
              return (
                <DropdownMenuItem
                  asChild
                  className="rounded-lg p-0 focus:bg-muted"
                  key={item.href}
                >
                  <Link
                    className="grid w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-3 px-3 py-2.5"
                    href={asRoute(resolveHref(item.href))}
                    prefetch={!isExternalHeaderHref(item.href)}
                  >
                    <Icon className="size-4 text-emerald-500" />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">
                        {item.label}
                      </span>
                      <span className="block font-mono text-[9px] uppercase text-muted-foreground">
                        {item.note}
                      </span>
                    </span>
                  </Link>
                </DropdownMenuItem>
              );
            },
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MobileNavItem({
  active,
  documentNavigation = false,
  href,
  label,
}: {
  active: boolean;
  documentNavigation?: boolean;
  href: string;
  label: string;
}) {
  const content = (
    <>
      <span>{label}</span>
      {active ? (
        <span className="ml-auto font-mono text-[9px] uppercase opacity-70">
          Current
        </span>
      ) : null}
    </>
  );

  return (
    <DropdownMenuItem
      asChild
      className={cn(
        "h-10 rounded-lg px-3 text-base font-semibold text-foreground focus:bg-muted focus:text-foreground",
        active &&
          "bg-primary/10 text-primary focus:bg-primary/10 focus:text-primary",
      )}
    >
      {documentNavigation ? (
        <a aria-current={active ? "page" : undefined} href={href}>
          {content}
        </a>
      ) : (
        <Link
          aria-current={active ? "page" : undefined}
          href={asRoute(href)}
          prefetch={!isExternalHeaderHref(href)}
        >
          {content}
        </Link>
      )}
    </DropdownMenuItem>
  );
}
