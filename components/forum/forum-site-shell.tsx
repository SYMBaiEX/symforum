"use client";
import { type ReactNode, type RefObject, Suspense } from "react";
import {
  ForumShellContextProvider,
  useForumShellContext,
} from "./forum-shell-context";
import { ForumNavigation } from "./forum-navigation";
import { BlogNavigation } from "@/components/blog-navigation";
import { NewsletterNavigation } from "@/components/newsletter-navigation";
import { NewsNavigation } from "@/components/news-navigation";
import { ForumLink } from "./forum-link";
import { AppErrorSurface } from "@/components/app-error-surface";
import { WebVitalsReporter } from "@/components/web-vitals-reporter";
import { AnalyticsTracker } from "@/components/analytics-tracker";
import { SurfaceScope } from "@/components/ui/surface-scope";
import { installation } from "@/lib/installation";
import { forumCommunityLinks } from "@/lib/forum-community-links";
import {
  forumSiteUrl,
  newsletterSiteUrl,
} from "@/lib/site-urls";
const socialItems = [
  { href: "https://github.com/symbaiex", label: "GitHub" },
  { href: "https://linkedin.com/in/austinhamiltonal", label: "LinkedIn" },
  { href: "https://twitter.com/symbiex", label: "Twitter" },
];
const communityLinks = forumCommunityLinks(installation);
export function ForumSiteShell({
  children,
  footerRef,
  forumHost,
  primarySiteHref,
  surface = "forum",
}: {
  children: ReactNode;
  footerRef?: RefObject<HTMLElement | null>;
  forumHost: boolean;
  primarySiteHref: string;
  surface?: "blog" | "forum" | "newsletter" | "news";
}) {
  return (
    <ForumShellContextProvider primarySiteHref={primarySiteHref}>
      <SurfaceScope.Provider value="forum">
        <ForumShellFrame surface={surface}>
          <WebVitalsReporter />
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:font-mono focus:text-sm focus:uppercase focus-ring"
          >
            Skip to content
          </a>
          {surface === "blog" ? (
            <BlogNavigation />
          ) : surface === "newsletter" ? (
            <NewsletterNavigation />
          ) : surface === "news" ? (
            <NewsNavigation />
          ) : (
            <ForumNavigation />
          )}
          <main
            id="main-content"
            tabIndex={-1}
            className="forum-main min-h-[calc(100dvh-6rem)] pt-[var(--site-header-offset)] outline-none"
          >
            {surface === "blog" ||
            surface === "newsletter" ||
            surface === "news" ? (
              <div
                className={`forum-surface ${
                  surface === "news"
                    ? "news-surface"
                    : surface === "newsletter"
                      ? "newsletter-surface"
                      : "blog-surface"
                }`}
              >
                {children}
              </div>
            ) : (
              children
            )}
          </main>
          <Suspense fallback={null}>
            <AnalyticsTracker />
          </Suspense>
          <AppErrorSurface />
          <footer
            ref={footerRef}
            className={`forum-footer flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-6 text-xs text-muted-foreground md:px-8 lg:pb-8 ${surface === "newsletter" ? "newsletter-footer" : ""}`}
          >
            <a
              className="focus-ring py-2 hover:text-foreground"
              href={
                surface === "newsletter"
                  ? "/newsletter"
                  : surface === "blog"
                    ? "/blog"
                    : primarySiteHref
              }
            >
              {surface === "newsletter"
                ? "SYMBaiEX Newsletter"
                : surface === "news"
                  ? "SYMBaiEX News"
                  : surface === "blog"
                    ? "SYMBaiEX Blog"
                    : "SYMBaiEX"}
            </a>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              {surface === "blog" ? (
                <>
                  <a
                    className="focus-ring py-2 hover:text-foreground"
                    href="/feed/blog.xml"
                  >
                    RSS feed
                  </a>
                  <a
                    className="focus-ring py-2 hover:text-foreground"
                    href={newsletterSiteUrl("/newsletter")}
                  >
                    Newsletter
                  </a>
                </>
              ) : surface === "newsletter" ? (
                <>
                  <a
                    className="focus-ring py-2 hover:text-foreground"
                    href="/newsletter/preferences"
                  >
                    Subscription preferences
                  </a>
                  <a
                    className="focus-ring py-2 hover:text-foreground"
                    href={forumSiteUrl("/")}
                  >
                    Forum
                  </a>
                </>
              ) : surface === "news" ? (
                <>
                  <a
                    className="focus-ring py-2 hover:text-foreground"
                    href={newsletterSiteUrl("/newsletter")}
                  >
                    Newsletter
                  </a>
                  <a
                    className="focus-ring py-2 hover:text-foreground"
                    href={forumSiteUrl("/")}
                  >
                    Forum
                  </a>
                </>
              ) : (
                <ForumLink
                  className="focus-ring py-2 hover:text-foreground"
                  href={
                    forumHost
                      ? "/control-panel/agent-access"
                      : "/forum/control-panel/agent-access"
                  }
                >
                  Agent access
                </ForumLink>
              )}
              {surface === "forum" ? (
                <>
                  <nav aria-label="Official forum links" className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-2">
                    {[communityLinks.forum, communityLinks.telegram, communityLinks.x, communityLinks.token].map((link) => link ? (
                      <a key={link.href} className="focus-ring inline-flex min-h-11 min-w-11 max-w-full items-center py-2 hover:text-foreground [overflow-wrap:anywhere]" href={link.href} rel="noopener noreferrer" target="_blank">
                        {link.label}
                      </a>
                    ) : null)}
                  </nav>
                  <nav aria-label="Austin Hamilton personal profiles" className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-2">
                    <span>Personal profiles · Austin Hamilton</span>
                    {socialItems.map(({ href, label }) => (
                      <a key={href} className="focus-ring inline-flex min-h-11 min-w-11 items-center py-2 hover:text-foreground" href={href} rel="noopener noreferrer" target="_blank">{label}</a>
                    ))}
                  </nav>
                </>
              ) : socialItems.map(({ href, label }) => (
                <a
                  key={href}
                  className="focus-ring py-2 hover:text-foreground"
                  href={href}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  {label}
                </a>
              ))}
            </div>
          </footer>
        </ForumShellFrame>
      </SurfaceScope.Provider>
    </ForumShellContextProvider>
  );
}

function ForumShellFrame({
  children,
  surface,
}: {
  children: ReactNode;
  surface: "blog" | "forum" | "newsletter" | "news";
}) {
  const { compactNavigation, density } = useForumShellContext();
  return (
    <div
      data-navigation={compactNavigation ? "compact" : "expanded"}
      data-surface={surface}
      data-density={surface === "forum" ? density : undefined}
      className="forum-app-shell relative z-10 min-h-dvh min-w-0 bg-background text-foreground [--site-footer-offset:0px]"
    >
      {children}
    </div>
  );
}
