"use client";

import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { useConvexAuth } from "convex/react";
import Link from "next/link";

const navItems = [
  { href: "/about", label: "About" },
  { href: "/blog", label: "Blog" },
  { href: "/news", label: "News" },
  { href: "/portfolio", label: "Portfolio" },
];

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
  return (
    <nav className="flex min-w-0 items-center gap-1 overflow-x-auto">
      {navItems.map((item) => (
        <Button key={item.href} asChild variant="ghost" size="sm">
          <Link className="h-10 px-3 sm:h-7 sm:px-2.5" href={item.href}>
            {item.label}
          </Link>
        </Button>
      ))}
      <span className="inline-flex w-[4.75rem] shrink-0 justify-center">
        {authPending ? (
          <span
            aria-hidden="true"
            className="inline-flex h-10 w-full items-center justify-center border border-transparent px-3 font-mono text-[10px] uppercase text-muted-foreground sm:h-7 sm:px-2.5"
          >
            Auth
          </span>
        ) : authHref && authLabel ? (
          <Button asChild variant="ghost" size="sm">
            <Link className="h-10 w-full px-3 sm:h-7 sm:px-2.5" href={authHref}>
              {authLabel}
            </Link>
          </Button>
        ) : null}
      </span>
      <ThemeToggle />
    </nav>
  );
}
