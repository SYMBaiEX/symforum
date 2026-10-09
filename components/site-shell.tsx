"use client";

import { AppErrorSurface } from "@/components/app-error-surface";
import {
  isForumHostname,
  primarySiteHrefForForumHost,
  shouldUseForumShell,
} from "@/components/forum/forum-host-url";
import { ForumSiteShell } from "@/components/forum/forum-site-shell";
import { HeaderNav } from "@/components/header-nav";
import { SiteSurfaceSwitcher } from "@/components/site-surface-switcher";
import { NewsletterSignup } from "@/components/newsletter-signup";
import { Button } from "@/components/ui/button";
import dynamic from "next/dynamic";
import { Github, Linkedin, Twitter } from "lucide-react";
import {
  CSSProperties,
  ReactNode,
  RefObject,
  Suspense,
  useEffect,
  useRef,
  useState,
} from "react";
import { usePathname } from "next/navigation";
import { WebVitalsReporter } from "@/components/web-vitals-reporter";
import { primarySiteUrl } from "@/lib/site-urls";

const AnalyticsTracker = dynamic(
  () =>
    import("@/components/analytics-tracker").then(
      (module) => module.AnalyticsTracker,
    ),
  { ssr: false },
);

const socialItems = [
  {
    href: "https://github.com/symbaiex",
    label: "GitHub",
    Icon: Github,
  },
  {
    href: "https://linkedin.com/in/austinhamiltonal",
    label: "LinkedIn",
    Icon: Linkedin,
  },
  {
    href: "https://twitter.com/symbiex",
    label: "Twitter",
    Icon: Twitter,
  },
];

export function SiteShell({
  children,
  initialForumHost = false,
  initialNewsletterHost = false,
  initialNewsHost = false,
  initialPrimarySiteHref = "/",
}: {
  children: ReactNode;
  initialForumHost?: boolean;
  initialNewsletterHost?: boolean;
  initialNewsHost?: boolean;
  initialPrimarySiteHref?: string;
}) {
  const pathname = usePathname();
  const footerRef = useRef<HTMLElement | null>(null);
  const [footerOffset, setFooterOffset] = useState<number | null>(null);
  const [forumHost, setForumHost] = useState(initialForumHost);
  const [newsletterHost, setNewsletterHost] = useState(initialNewsletterHost);
  const [primarySiteHref, setPrimarySiteHref] = useState(
    initialPrimarySiteHref,
  );
  const forumShell = shouldUseForumShell({ forumHost, pathname });
  const newsletterShell =
    !forumShell &&
    (newsletterHost ||
      pathname === "/newsletter" ||
      pathname?.startsWith("/newsletter/"));
  const newsShell =
    !forumShell &&
    !newsletterShell &&
    (initialNewsHost || pathname === "/news" || pathname?.startsWith("/news/"));
  const blogShell =
    !forumShell &&
    !newsletterShell &&
    !newsShell &&
    (pathname === "/blog" || pathname?.startsWith("/blog/"));

  useEffect(() => {
    if (isForumHostname(window.location.hostname)) {
      setForumHost(true);
      setNewsletterHost(false);
      setPrimarySiteHref(primarySiteHrefForForumHost("/", window.location));
    } else if (window.location.hostname === "newsletter.symbaiex.com") {
      setForumHost(false);
      setNewsletterHost(true);
      setPrimarySiteHref(primarySiteUrl("/"));
    } else if (window.location.hostname === "news.symbaiex.com") {
      setForumHost(false);
      setNewsletterHost(false);
      setPrimarySiteHref(primarySiteUrl("/"));
    } else if (window.location.hostname === "blog.symbaiex.com") {
      setForumHost(false);
      setNewsletterHost(false);
      setPrimarySiteHref(primarySiteUrl("/"));
    } else {
      setForumHost(false);
      setNewsletterHost(false);
      setPrimarySiteHref("/");
    }
  }, []);

  useEffect(() => {
    const footer = footerRef.current;

    if (!footer) {
      return;
    }

    const updateFooterOffset = () => {
      setFooterOffset(Math.ceil(footer.getBoundingClientRect().height));
    };

    updateFooterOffset();

    const observer = new ResizeObserver(updateFooterOffset);
    observer.observe(footer);
    window.addEventListener("resize", updateFooterOffset);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateFooterOffset);
    };
  }, []);

  if (forumShell || newsletterShell || newsShell || blogShell) {
    return (
      <ForumSiteShell
        footerRef={footerRef}
        forumHost={forumHost}
        primarySiteHref={primarySiteHref}
        surface={
          blogShell
            ? "blog"
            : newsletterShell
              ? "newsletter"
              : newsShell
                ? "news"
                : "forum"
        }
      >
        {children}
      </ForumSiteShell>
    );
  }

  return (
    <div
      data-surface="primary"
      className="forum-app-shell primary-site-shell relative z-10 min-h-dvh overflow-hidden bg-background text-foreground [--site-footer-offset:3.75rem] [--site-header-offset:calc(3.5rem+env(safe-area-inset-top)+1px)]"
      style={
        footerOffset
          ? ({
              "--site-footer-offset": `${footerOffset}px`,
            } as CSSProperties)
          : undefined
      }
    >
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:font-mono focus:text-sm focus:uppercase focus-ring"
      >
        Skip to content
      </a>
      <SiteHeader
        currentPathname={pathname ?? "/"}
        homeHref={primarySiteHref}
        initialForumHost={initialForumHost}
        initialPrimarySiteHref={initialPrimarySiteHref}
      />
      <main
        id="main-content"
        tabIndex={-1}
        className="fixed inset-x-0 bottom-[var(--site-footer-offset)] top-[var(--site-header-offset)] z-10 overflow-y-auto overscroll-contain outline-none"
      >
        {children}
      </main>
      <Suspense fallback={null}>
        <AnalyticsTracker />
      </Suspense>
      <WebVitalsReporter />
      <AppErrorSurface />
      <SiteFooter footerRef={footerRef} agentHref="/agent" />
    </div>
  );
}

function SiteFooter({
  agentHref,
  footerRef,
}: {
  agentHref: string;
  footerRef: RefObject<HTMLElement | null>;
}) {
  return (
    <footer
      ref={footerRef}
      className="fixed inset-x-0 bottom-0 z-50 px-2 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] sm:px-3"
    >
      <div className="mx-auto grid w-full max-w-7xl grid-cols-1 items-center gap-2 p-3 text-xs sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-4">
        <div className="min-w-0">
          <NewsletterSignup source="footer" variant="footer" />
        </div>
        <nav
          aria-label="Footer links and social profiles"
          className="flex flex-wrap items-center justify-start gap-1 sm:shrink-0 sm:justify-end"
        >
          <Button
            asChild
            className="forum-action-pill focus-ring h-9 px-2.5 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground sm:px-3"
            size="sm"
            variant="ghost"
          >
            <a href={agentHref}>Agent access</a>
          </Button>
          {socialItems.map(({ href, label, Icon }) => (
            <Button
              key={href}
              asChild
              className="forum-action-pill focus-ring h-9 font-mono uppercase text-muted-foreground"
              size="sm"
              variant="ghost"
            >
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={label}
              >
                <Icon data-icon="inline-start" />
                <span aria-hidden="true" className="hidden sm:inline">
                  {label}
                </span>
              </a>
            </Button>
          ))}
        </nav>
      </div>
    </footer>
  );
}

function SiteHeader({
  currentPathname,
  homeHref,
  initialForumHost,
  initialPrimarySiteHref,
}: {
  currentPathname: string;
  homeHref: string;
  initialForumHost: boolean;
  initialPrimarySiteHref: string;
}) {
  return (
    <header className="forum-topbar fixed inset-x-0 top-0 z-50 border-b border-border pt-[env(safe-area-inset-top)]">
      <div className="forum-topbar-inner mx-auto flex min-h-14 w-full max-w-7xl items-center justify-between gap-3 px-3 py-1.5 sm:px-4 md:px-8">
        <div className="flex min-w-0 items-center">
          <SiteSurfaceSwitcher
            activeSurface="blog"
            currentPathname={currentPathname}
            homeHref={homeHref}
            forumHref={initialForumHost ? "/" : "/forum"}
            className="forum-brand text-sm"
          />
        </div>
        <HeaderNav
          initialForumHost={initialForumHost}
          initialPrimarySiteHref={initialPrimarySiteHref}
        />
      </div>
    </header>
  );
}
