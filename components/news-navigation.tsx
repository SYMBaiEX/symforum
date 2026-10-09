"use client";

import {
  Archive,
  ChevronDown,
  Mail,
  Menu,
  MessageSquare,
  Newspaper,
  Radio,
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
import { forumSiteUrl, newsletterSiteUrl } from "@/lib/site-urls";
import { cn } from "@/lib/utils";

const mobileLinks = [
  { href: "/news", label: "Index", icon: Newspaper, id: "index" },
  { href: "/news#top-stories", label: "Stories", icon: Archive, id: "stories" },
  {
    href: newsletterSiteUrl("/newsletter"),
    label: "Newsletter",
    icon: Mail,
    id: "newsletter",
  },
  {
    href: forumSiteUrl("/"),
    label: "Forum",
    icon: MessageSquare,
    id: "forum",
  },
] as const;

const iconControl =
  "focus-ring relative inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground";

export function NewsNavigation() {
  const pathname = usePathname();
  const { primarySiteHref } = useForumShellContext();
  const signInHref = `/signin?${new URLSearchParams({ redirectTo: pathname ?? "/news" })}`;
  const onNews = pathname === "/news" || pathname?.startsWith("/news/");
  const newsletterArchiveHref = newsletterSiteUrl("/newsletter");

  return (
    <>
      <header className="forum-topbar fixed inset-x-0 top-0 z-50 bg-card pt-[env(safe-area-inset-top)]">
        <div className="forum-topbar-inner flex items-center justify-between gap-2 px-3 sm:gap-3">
          <SiteSurfaceSwitcher
            activeSurface="news"
            currentPathname={pathname ?? "/news"}
            homeHref={primarySiteHref}
            forumHref="/forum"
            className="forum-brand text-lg"
          />
          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <Link
              href={newsletterSiteUrl("/newsletter#newsletter-subscribe")}
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
                  aria-label="News menu"
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
                  News index
                </DropdownMenuLabel>
                <NewsMenuLink href="/news#top-stories" icon={Newspaper}>
                  Top stories
                </NewsMenuLink>
                <NewsMenuLink href="/news#how-to-read" icon={Radio}>
                  About the index
                </NewsMenuLink>
                <NewsMenuLink href={newsletterArchiveHref} icon={Mail}>
                  Newsletter archive
                </NewsMenuLink>
                <NewsMenuLink href={forumSiteUrl("/")} icon={MessageSquare}>
                  Forum
                </NewsMenuLink>
                <DropdownMenuItem asChild className="min-h-11 rounded-lg px-3">
                  <a href={primarySiteHref}>SYMBaiEX home</a>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <nav
        aria-label="News navigation on mobile"
        className="forum-bottom-nav fixed inset-x-0 bottom-0 z-50 bg-card pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        <div className="mx-auto grid max-w-lg grid-cols-4 px-2">
          {mobileLinks.map(({ href, label, icon: Icon, id }) => {
            const current =
              id === "index"
                ? onNews
                : id === "stories"
                  ? false
                  : id === "newsletter"
                    ? pathname === "/newsletter" ||
                      pathname?.startsWith("/newsletter/")
                    : pathname === "/forum" || pathname?.startsWith("/forum/");
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

function NewsMenuLink({
  children,
  href,
  icon: Icon,
}: {
  children: React.ReactNode;
  href: string;
  icon: typeof Newspaper;
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
