"use client";

import { Check, ChevronDown, MessageSquare, Newspaper } from "lucide-react";
import { useEffect, useState } from "react";
import { FORUM_SITE_URL } from "@/lib/site-urls";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export function resolveSiteSurfaceForumHref(href: string, hostname: string) {
  return href === "/forum" &&
    (hostname === "www.symbaiex.com" || hostname === "symbaiex.com")
    ? `${FORUM_SITE_URL}/`
    : href;
}

export function SiteSurfaceSwitcher({
  activeSurface,
  blogHref,
  forumHref,
  className,
  showForumMark = false,
}: {
  activeSurface: "blog" | "forum";
  blogHref: string;
  forumHref: string;
  className?: string;
  showForumMark?: boolean;
}) {
  const [resolvedForumHref, setResolvedForumHref] = useState(forumHref);
  useEffect(() => {
    setResolvedForumHref(
      resolveSiteSurfaceForumHref(forumHref, window.location.hostname),
    );
  }, [forumHref]);
  const surfaces = [
    {
      value: "blog",
      label: "Blog",
      description: "Articles, research & news",
      href: blogHref,
      Icon: Newspaper,
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
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="SYMBaiEX site switcher"
          className={cn(
            "site-surface-trigger focus-ring group inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl text-left",
            className,
          )}
        >
          {showForumMark ? (
            <span className="forum-brand-mark hidden size-9 items-center justify-center rounded-xl bg-primary/10 text-primary sm:flex">
              <MessageSquare
                className="size-5"
                strokeWidth={2.5}
                aria-hidden="true"
              />
            </span>
          ) : null}
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
          const current = activeSurface === value;
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
