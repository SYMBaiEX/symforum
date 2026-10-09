"use client";

import {
  Archive,
  BookOpen,
  ChevronDown,
  Mail,
  Menu,
  MessageSquare,
  Newspaper,
  Radio,
  Settings2,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SiteSurfaceSwitcher } from "@/components/site-surface-switcher";
import { ThemeToggle } from "@/components/ThemeToggle";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useForumShellContext } from "@/components/forum/forum-shell-context";
import { forumSiteUrl, newsSiteUrl } from "@/lib/site-urls";
import { cn } from "@/lib/utils";

const newsletterNavigation = [
  {
    href: "/newsletter#latest-edition",
    label: "Latest",
    icon: BookOpen,
    id: "latest",
  },
  {
    href: "/newsletter#newsletter-archive",
    label: "Archive",
    icon: Archive,
    id: "archive",
  },
  {
    href: newsSiteUrl("/news"),
    label: "Live desk",
    icon: Radio,
    id: "live-desk",
  },
  {
    href: "/newsletter#newsletter-subscribe",
    label: "Subscribe",
    icon: Mail,
    id: "subscribe",
  },
] as const;
const newsletterUtilityRoutes = new Set([
  "confirm",
  "preferences",
  "unsubscribe",
]);

function isNewsletterContentPath(pathname: string | null) {
  if (pathname === "/newsletter") return true;
  if (!pathname?.startsWith("/newsletter/")) return false;
  const segments = pathname.slice("/newsletter/".length).split("/");
  return segments.length === 1 && !newsletterUtilityRoutes.has(segments[0]);
}

const iconControl =
  "focus-ring relative inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground";

export function NewsletterNavigation() {
  const pathname = usePathname();
  const { primarySiteHref } = useForumShellContext();
  const signInHref = `/signin?${new URLSearchParams({ redirectTo: pathname ?? "/newsletter" })}`;

  return (
    <>
      <header className="forum-topbar fixed inset-x-0 top-0 z-50 bg-card pt-[env(safe-area-inset-top)]">
        <div className="forum-topbar-inner flex items-center gap-2 px-3 sm:gap-3">
          <SiteSurfaceSwitcher
            activeSurface="newsletter"
            currentPathname={pathname ?? "/newsletter"}
            homeHref={primarySiteHref}
            forumHref="/forum"
            className="forum-brand mr-auto text-lg sm:mr-2"
          />
          <Link
            href="/newsletter#newsletter-subscribe"
            className="forum-primary-action focus-ring inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full bg-primary px-3 text-sm font-semibold text-primary-foreground sm:px-4"
          >
            <Mail aria-hidden="true" className="size-[17px]" />
            <span>Subscribe</span>
          </Link>
          <div className="hidden sm:block">
            <ThemeToggle />
          </div>
          <Link
            href={signInHref}
            className="focus-ring hidden min-h-11 items-center px-2 text-sm font-medium sm:inline-flex"
          >
            Sign in
          </Link>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={iconControl}
                aria-label="Newsletter menu"
              >
                <Menu aria-hidden="true" className="size-[18px] lg:hidden" />
                <UserRound
                  aria-hidden="true"
                  className="hidden size-[18px] lg:block"
                />
                <ChevronDown
                  aria-hidden="true"
                  className="hidden size-3 lg:block"
                />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              sideOffset={8}
              className="forum-shell-menu w-72 max-w-[calc(100vw-2rem)] rounded-xl border-0 bg-popover p-2 shadow-lg"
            >
              <DropdownMenuLabel className="px-3 py-2 text-xs text-muted-foreground">
                Newsletter
              </DropdownMenuLabel>
              <NewsletterMenuLink href="/newsletter" icon={BookOpen}>
                Latest edition
              </NewsletterMenuLink>
              <NewsletterMenuLink
                href="/newsletter/preferences"
                icon={Settings2}
              >
                Subscription preferences
              </NewsletterMenuLink>
              <NewsletterMenuLink href={newsSiteUrl("/news")} icon={Newspaper}>
                News index
              </NewsletterMenuLink>
              <NewsletterMenuLink href={forumSiteUrl("/")} icon={MessageSquare}>
                Forum
              </NewsletterMenuLink>
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
        aria-label="Newsletter sections on mobile"
        className="forum-bottom-nav fixed inset-x-0 bottom-0 z-50 bg-card pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        <div className="mx-auto grid max-w-lg grid-cols-4 px-2">
          {newsletterNavigation.map(({ href, label, icon: Icon, id }) => {
            const current =
              id === "latest" && isNewsletterContentPath(pathname);
            return (
              <Link
                key={id}
                href={href}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "focus-ring flex min-h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium",
                  current
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon aria-hidden="true" className="size-[19px]" />
                <span>{label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}

function NewsletterMenuLink({
  children,
  href,
  icon: Icon,
}: {
  children: React.ReactNode;
  href: string;
  icon: typeof Mail;
}) {
  return (
    <DropdownMenuItem
      asChild
      className="min-h-11 rounded-lg px-3 focus:bg-muted focus:text-foreground"
    >
      <Link href={href}>
        <Icon aria-hidden="true" className="text-muted-foreground" />
        {children}
      </Link>
    </DropdownMenuItem>
  );
}
