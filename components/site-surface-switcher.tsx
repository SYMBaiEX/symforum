"use client";
import { installation } from "@/lib/installation";
import { installationIdentityOrigins } from "@/lib/installation-config";

import {
  BookOpen,
  Check,
  ChevronDown,
  Home,
  Mail,
  MessageSquare,
  Newspaper,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  BLOG_SITE_URL,
  FORUM_SITE_URL,
  NEWS_SITE_URL,
  NEWSLETTER_SITE_URL,
  primarySiteUrl,
} from "@/lib/site-urls";
import { primarySiteHrefForForumHost } from "@/components/forum/forum-host-url";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import Image from "next/image";
import { cn } from "@/lib/utils";

export function resolveSiteSurfaceForumHref(href: string, hostname: string) {
  return href === "/forum" &&
    [new URL(installation.sites.primary).hostname, installation.identity.cookieDomain].includes(hostname)
    ? `${FORUM_SITE_URL}/`
    : href;
}

export function SiteSurfaceSwitcher({
  activeSurface,
  currentPathname,
  homeHref,
  forumHref,
  brandImageSrc = "/images/brand/signal-moth.png",
  className,
  showForumMark = false,
}: {
  activeSurface: "blog" | "forum" | "news" | "newsletter";
  currentPathname: string;
  homeHref: string;
  forumHref: string;
  brandImageSrc?: string;
  className?: string;
  showForumMark?: boolean;
}) {
  const pathname = currentPathname;
  const [resolvedForumHref, setResolvedForumHref] = useState(forumHref);
  const [resolvedHomeHref, setResolvedHomeHref] = useState(homeHref);
  const [resolvedPrimaryHrefs, setResolvedPrimaryHrefs] = useState({
    blog: "/blog",
    news: "/news",
    newsletter: "/newsletter",
  });
  useEffect(() => {
    const hostname = window.location.hostname;
    const productionHost = isProductionSiteHostname(hostname);
    setResolvedHomeHref(productionHost ? primarySiteUrl("/") : homeHref);
    setResolvedForumHref(
      productionHost && !hostname.startsWith("forum.")
        ? canonicalForumSurfaceHref(forumHref)
        : resolveSiteSurfaceForumHref(forumHref, hostname),
    );
    setResolvedPrimaryHrefs(
      productionHost
        ? {
            blog: `${BLOG_SITE_URL}/blog`,
            news: `${NEWS_SITE_URL}/news`,
            newsletter: `${NEWSLETTER_SITE_URL}/newsletter`,
          }
        : {
            blog: primarySiteHrefForForumHost("/blog", window.location),
            news: primarySiteHrefForForumHost("/news", window.location),
            newsletter: primarySiteHrefForForumHost(
              "/newsletter",
              window.location,
            ),
          },
    );
  }, [forumHref, homeHref]);
  const isPath = (route: string) =>
    pathname === route || pathname.startsWith(`${route}/`);
  const currentRoute = isPath("/news")
    ? "news"
    : isPath("/newsletter")
      ? "newsletter"
      : isPath("/blog")
        ? "blog"
        : activeSurface === "forum" || isPath("/forum")
          ? "forum"
          : "home";
  const surfaces = [
    {
      value: "home",
      label: "Home",
      description: "The SYMBaiEX home page",
      href: resolvedHomeHref,
      Icon: Home,
    },
    {
      value: "blog",
      label: "Blog",
      description: "Articles and research",
      href: resolvedPrimaryHrefs.blog,
      Icon: BookOpen,
    },
    {
      value: "news",
      label: "News",
      description: "Stories and source index",
      href: resolvedPrimaryHrefs.news,
      Icon: Newspaper,
    },
    {
      value: "newsletter",
      label: "Newsletter",
      description: "Daily signals and field notes",
      href: resolvedPrimaryHrefs.newsletter,
      Icon: Mail,
    },
    {
      value: "forum",
      label: "Forum",
      description: "Conversations & community",
      href: resolvedForumHref,
      Icon: MessageSquare,
    },
  ] as const;

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="SYMBaiEX site switcher"
          className={cn(
            "site-surface-trigger focus-ring group inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl text-left",
            className,
          )}
        >
          <Image
            src={brandImageSrc}
            width={40}
            height={40}
            alt=""
            className={`symbaiex-mascot size-9 shrink-0 object-contain ${showForumMark ? "forum-brand-mark" : ""}`}
          />
          <span className="whitespace-nowrap font-extrabold tracking-tight">
            SYMB<span className="text-primary">ai</span>EX
          </span>
          <ChevronDown
            aria-hidden="true"
            className="size-4 shrink-0 text-muted-foreground transition-transform duration-150 group-data-[state=open]:rotate-180 motion-reduce:transition-none"
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={8}
        className="site-surface-menu w-72 max-w-[calc(100vw-1.5rem)] rounded-xl border-0 p-2 shadow-lg"
      >
        <DropdownMenuLabel className="px-3 pb-2 pt-1 text-xs font-medium text-muted-foreground">
          Explore SYMBaiEX
        </DropdownMenuLabel>
        {surfaces.map(({ value, label, description, href, Icon }) => {
          const current = currentRoute === value;
          return (
            <DropdownMenuItem
              key={value}
              asChild
              className={cn(
                "min-h-16 gap-3 rounded-lg px-3 py-2.5 focus:bg-muted focus:text-foreground",
                current && "bg-primary/5",
              )}
            >
              <a href={href} aria-current={current ? "page" : undefined}>
                <span
                  className={cn(
                    "flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted",
                    current && "bg-primary/10 text-primary",
                  )}
                >
                  <Icon className="size-[18px]" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">{label}</span>
                  <span className="mt-0.5 block text-xs leading-4 text-muted-foreground">
                    {description}
                  </span>
                </span>
                {current ? (
                  <span className="flex items-center gap-1 text-xs text-primary">
                    <Check className="size-3.5" aria-hidden="true" />
                    <span aria-label="Current site">Current</span>
                  </span>
                ) : null}
              </a>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function isProductionSiteHostname(hostname: string) {
  return installationIdentityOrigins(installation).filter(origin => origin.startsWith("https:")).some(origin => new URL(origin).hostname === hostname);
}

function canonicalForumSurfaceHref(href: string) {
  const path =
    href === "/forum"
      ? "/"
      : href.startsWith("/forum/")
        ? href.slice("/forum".length)
        : href;
  return new URL(path, FORUM_SITE_URL).toString();
}
