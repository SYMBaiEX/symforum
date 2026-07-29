"use client";

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
import { useConvexAuth } from "convex/react";
import { Menu } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const navItems = [
  { href: "/", label: "Home" },
  { href: "/about", label: "About" },
  { href: "/blog", label: "Blog" },
  { href: "/news", label: "News" },
  { href: "/forum", label: "Forum" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/contact", label: "Contact" },
];

export function HeaderNav({
  initialForumHost = false,
  initialPrimarySiteHref = "/",
}: {
  initialForumHost?: boolean;
  initialPrimarySiteHref?: string;
}) {
  if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
    return (
      <NavRow
        authHref="/signin"
        authLabel="Sign in"
        initialForumHost={initialForumHost}
        initialPrimarySiteHref={initialPrimarySiteHref}
      />
    );
  }

  return (
    <LiveHeaderNav
      initialForumHost={initialForumHost}
      initialPrimarySiteHref={initialPrimarySiteHref}
    />
  );
}

function LiveHeaderNav({
  initialForumHost,
  initialPrimarySiteHref,
}: {
  initialForumHost: boolean;
  initialPrimarySiteHref: string;
}) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || isLoading) {
    return (
      <NavRow
        authPending
        initialForumHost={initialForumHost}
        initialPrimarySiteHref={initialPrimarySiteHref}
      />
    );
  }

  if (isAuthenticated) {
    return (
      <NavRow
        authHref="/profile"
        authLabel="Profile"
        initialForumHost={initialForumHost}
        initialPrimarySiteHref={initialPrimarySiteHref}
      />
    );
  }

  return (
    <NavRow
      authHref="/signin"
      authLabel="Sign in"
      initialForumHost={initialForumHost}
      initialPrimarySiteHref={initialPrimarySiteHref}
    />
  );
}

function NavRow({
  authHref,
  authLabel,
  authPending = false,
  initialForumHost = false,
  initialPrimarySiteHref = "/",
}: {
  authHref?: string;
  authLabel?: string;
  authPending?: boolean;
  initialForumHost?: boolean;
  initialPrimarySiteHref?: string;
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
      <div className="hidden min-w-0 items-center gap-1 md:flex">
        {navItems.map((item) => {
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
        <span className="inline-flex w-[4.75rem] shrink-0 justify-center">
          {authPending ? (
            <span
              aria-hidden="true"
              className="inline-flex h-7 w-full items-center justify-center border border-transparent px-2.5"
            >
              <span className="h-3.5 w-12 animate-pulse rounded-none bg-muted" />
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
      <div className="flex items-center gap-1.5 md:hidden">
        <MobileNavMenu
          authHref={authHref}
          authIsActive={authIsActive}
          authLabel={authLabel}
          authLinkHref={authLinkHref}
          authPending={authPending}
          forumHost={forumHost}
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
      href={href}
      prefetch={!isExternalHeaderHref(href)}
    >
      {children}
    </Link>
  );

  return (
    <Button
      asChild
      className={cn(
        "h-7 rounded-none border border-transparent px-2.5 text-xs text-muted-foreground hover:border-row-border hover:bg-transparent hover:text-foreground",
        active &&
          "border-foreground bg-foreground text-background hover:border-foreground hover:bg-foreground hover:text-background",
      )}
      size="sm"
      variant="ghost"
    >
      {linkContent}
    </Button>
  );
}

function MobileNavMenu({
  authHref,
  authIsActive,
  authLabel,
  authLinkHref,
  authPending,
  forumHost,
  resolveActive,
  resolveHref,
}: {
  authHref?: string;
  authIsActive: boolean;
  authLabel?: string;
  authLinkHref?: string;
  authPending: boolean;
  forumHost: boolean;
  resolveActive: (href: string) => boolean;
  resolveHref: (href: string) => string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label="Open navigation menu"
          className="rounded-none border border-row-border bg-background/70 hover:border-foreground"
          size="icon"
          variant="ghost"
        >
          <Menu aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-[min(16rem,calc(100vw-2rem))] rounded-none border-row-border bg-background p-1.5 text-foreground shadow-[0_18px_70px_rgba(0,0,0,0.55)] dark:bg-[#030303] md:hidden"
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
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          {authPending ? (
            <DropdownMenuItem
              className="h-10 rounded-none px-3"
              disabled
            >
              <span
                aria-hidden="true"
                className="h-3 w-16 animate-pulse rounded-none bg-muted"
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
        "h-10 rounded-none px-3 text-base font-semibold text-foreground focus:bg-muted focus:text-foreground",
        active &&
          "bg-foreground text-background focus:bg-foreground focus:text-background",
      )}
    >
      {documentNavigation ? (
        <a aria-current={active ? "page" : undefined} href={href}>
          {content}
        </a>
      ) : (
        <Link
          aria-current={active ? "page" : undefined}
          href={href}
          prefetch={!isExternalHeaderHref(href)}
        >
          {content}
        </Link>
      )}
    </DropdownMenuItem>
  );
}
