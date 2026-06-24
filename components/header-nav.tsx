"use client";

import { ThemeToggle } from "@/components/ThemeToggle";
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

const navItems = [
  { href: "/about", label: "About" },
  { href: "/blog", label: "Blog" },
  { href: "/news", label: "News" },
  { href: "/portfolio", label: "Portfolio" },
];

const mobileNavItems = [{ href: "/", label: "Home" }, ...navItems];

export function HeaderNav() {
  if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
    return <NavRow authHref="/signin" authLabel="Sign in" />;
  }

  return <LiveHeaderNav />;
}

function LiveHeaderNav() {
  const { isAuthenticated, isLoading } = useConvexAuth();

  if (isLoading) {
    return <NavRow authPending />;
  }

  if (isAuthenticated) {
    return <NavRow authHref="/profile" authLabel="Profile" />;
  }

  return <NavRow authHref="/signin" authLabel="Sign in" />;
}

function NavRow({
  authHref,
  authLabel,
  authPending = false,
}: {
  authHref?: string;
  authLabel?: string;
  authPending?: boolean;
}) {
  const pathname = usePathname();
  const authIsActive = authHref ? isRouteActive(pathname, authHref) : false;

  return (
    <nav aria-label="Primary" className="flex min-w-0 items-center gap-1.5">
      <div className="hidden min-w-0 items-center gap-1 md:flex">
        {navItems.map((item) => (
          <DesktopNavLink
            active={isRouteActive(pathname, item.href)}
            href={item.href}
            key={item.href}
          >
            {item.label}
          </DesktopNavLink>
        ))}
        <span className="inline-flex w-[4.75rem] shrink-0 justify-center">
          {authPending ? (
            <span
              aria-hidden="true"
              className="inline-flex h-7 w-full items-center justify-center border border-transparent px-2.5 font-mono text-[10px] uppercase text-muted-foreground"
            >
              Auth
            </span>
          ) : authHref && authLabel ? (
            <DesktopNavLink active={authIsActive} href={authHref}>
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
          authPending={authPending}
          pathname={pathname}
        />
      </div>
      <ThemeToggle />
    </nav>
  );
}

function DesktopNavLink({
  active,
  children,
  href,
}: {
  active: boolean;
  children: string;
  href: string;
}) {
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
      <Link aria-current={active ? "page" : undefined} href={href}>
        {children}
      </Link>
    </Button>
  );
}

function MobileNavMenu({
  authHref,
  authIsActive,
  authLabel,
  authPending,
  pathname,
}: {
  authHref?: string;
  authIsActive: boolean;
  authLabel?: string;
  authPending: boolean;
  pathname: string;
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
        className="w-[min(18rem,calc(100vw-2rem))] rounded-none border-row-border bg-background/96 p-2 shadow-none backdrop-blur md:hidden"
      >
        <DropdownMenuLabel className="px-2 pb-2 pt-1 font-mono text-[10px] uppercase text-muted-foreground">
          Navigation
        </DropdownMenuLabel>
        <DropdownMenuGroup>
          {mobileNavItems.map((item) => (
            <MobileNavItem
              active={isRouteActive(pathname, item.href)}
              href={item.href}
              key={item.href}
              label={item.label}
            />
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          {authPending ? (
            <DropdownMenuItem
              className="rounded-none px-2 py-3 font-mono text-[10px] uppercase text-muted-foreground"
              disabled
            >
              Auth
            </DropdownMenuItem>
          ) : authHref && authLabel ? (
            <MobileNavItem
              active={authIsActive}
              href={authHref}
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
  href,
  label,
}: {
  active: boolean;
  href: string;
  label: string;
}) {
  return (
    <DropdownMenuItem
      asChild
      className={cn(
        "rounded-none px-2 py-3 text-base font-medium text-muted-foreground focus:bg-transparent focus:text-foreground",
        active && "bg-foreground text-background focus:bg-foreground focus:text-background",
      )}
    >
      <Link aria-current={active ? "page" : undefined} href={href}>
        <span className="font-mono text-[10px] uppercase">
          {active ? "Current" : "Open"}
        </span>
        <span className="ml-auto">{label}</span>
      </Link>
    </DropdownMenuItem>
  );
}

function isRouteActive(pathname: string, href: string) {
  if (href === "/") {
    return pathname === "/";
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}
