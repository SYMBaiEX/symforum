"use client";

import ConvexClientProvider from "@/components/ConvexClientProvider";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { convexRefs } from "@/lib/convex-refs";
import { useConvexAuth, useQuery } from "convex/react";
import Link from "next/link";

const navItems = [
  { href: "/blog", label: "Blog" },
  { href: "/news", label: "News" },
];

export function HeaderNav() {
  if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
    return <NavRow authHref="/signin" authLabel="Sign in" />;
  }

  return (
    <ConvexClientProvider>
      <LiveHeaderNav />
    </ConvexClientProvider>
  );
}

function LiveHeaderNav() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const viewer = useQuery(convexRefs.users.maybeViewer, {});

  if (isLoading || viewer === undefined) {
    return <NavRow />;
  }

  if (isAuthenticated && viewer?.usernameNormalized) {
    return <NavRow authHref="/profile" authLabel="Profile" />;
  }

  return <NavRow authHref="/signin" authLabel="Sign in" />;
}

function NavRow({
  authHref,
  authLabel,
}: {
  authHref?: string;
  authLabel?: string;
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
      {authHref && authLabel ? (
        <Button asChild variant="ghost" size="sm">
          <Link className="h-10 px-3 sm:h-7 sm:px-2.5" href={authHref}>
            {authLabel}
          </Link>
        </Button>
      ) : null}
      <ThemeToggle />
    </nav>
  );
}
