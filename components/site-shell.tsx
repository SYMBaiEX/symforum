"use client";

import { AppErrorSurface } from "@/components/app-error-surface";
import { AnalyticsTracker } from "@/components/analytics-tracker";
import {
  isForumHostname,
  primarySiteHrefForForumHost,
  shouldUseForumShell,
} from "@/components/forum/forum-host-url";
import { ForumShellContextProvider } from "@/components/forum/forum-shell-context";
import { HeaderNav } from "@/components/header-nav";
import { NewsletterSignup } from "@/components/newsletter-signup";
import { RouteImagePreloader } from "@/components/route-image-preloader";
import { Button } from "@/components/ui/button";
import { Github, Twitter } from "lucide-react";
import Link from "next/link";
import {
  CSSProperties,
  ReactNode,
  Suspense,
  useEffect,
  useRef,
  useState,
} from "react";
import { usePathname } from "next/navigation";

const socialItems = [
  {
    href: "https://github.com/symbaiex",
    label: "GitHub",
    Icon: Github,
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
  initialPrimarySiteHref = "/",
}: {
  children: ReactNode;
  initialForumHost?: boolean;
  initialPrimarySiteHref?: string;
}) {
  const pathname = usePathname();
  const footerRef = useRef<HTMLElement | null>(null);
  const [footerOffset, setFooterOffset] = useState<number | null>(null);
  const [forumHost, setForumHost] = useState(initialForumHost);
  const [primarySiteHref, setPrimarySiteHref] = useState(
    initialPrimarySiteHref,
  );
  const forumShell = shouldUseForumShell({ forumHost, pathname });

  useEffect(() => {
    if (isForumHostname(window.location.hostname)) {
      setForumHost(true);
      setPrimarySiteHref(primarySiteHrefForForumHost("/", window.location));
    } else {
      setForumHost(false);
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

  if (forumShell) {
    return (
      <ForumSiteShell forumHost={forumHost} primarySiteHref={primarySiteHref}>
        {children}
      </ForumSiteShell>
    );
  }

  return (
    <div
      className="relative z-10 min-h-dvh overflow-hidden bg-background/92 text-foreground [--site-footer-offset:8.75rem] [--site-header-offset:4rem] md:[--site-footer-offset:4.5rem] md:[--site-header-offset:3.75rem]"
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
        brandHref={primarySiteHref}
        brandLabel="SYMBaiEX"
        brandPrefetch={primarySiteHref === "/"}
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
      <RouteImagePreloader />
      <AppErrorSurface />
      <footer
        ref={footerRef}
        className="fixed inset-x-0 bottom-0 z-50 bg-background/92 backdrop-blur"
      >
        <div className="mx-auto grid max-w-7xl grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 text-xs md:gap-4 md:px-8">
          <div className="min-w-0">
            <p className="font-mono uppercase">SYMBaiEX</p>
          </div>
          <div className="min-w-0">
            <NewsletterSignup source="footer" variant="footer" />
          </div>
          <div className="flex shrink-0 items-center justify-end">
            {socialItems.map(({ href, label, Icon }) => (
              <Button
                key={href}
                asChild
                className="h-9 w-9 px-0 font-mono uppercase text-muted-foreground sm:w-auto sm:px-2.5"
                size="sm"
                variant="ghost"
              >
                <Link
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={label}
                >
                  <Icon data-icon="inline-start" />
                  <span aria-hidden="true" className="hidden sm:inline">
                    {label}
                  </span>
                </Link>
              </Button>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}

function ForumSiteShell({
  children,
  forumHost,
  primarySiteHref,
}: {
  children: ReactNode;
  forumHost: boolean;
  primarySiteHref: string;
}) {
  const forumBrandHref = forumHost ? "/" : "/forum";

  return (
    <ForumShellContextProvider primarySiteHref={primarySiteHref}>
      <div className="relative z-10 min-h-dvh overflow-x-hidden bg-background/96 text-foreground [--site-header-offset:4rem] md:[--site-header-offset:3.75rem]">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:font-mono focus:text-sm focus:uppercase focus-ring"
        >
          Skip to content
        </a>
        <SiteHeader
          brandHref={forumBrandHref}
          brandLabel="SYMBaiEX Forum"
          brandPrefetch={!forumHost}
          initialForumHost={forumHost}
          initialPrimarySiteHref={primarySiteHref}
        />
        <main
          id="main-content"
          tabIndex={-1}
          className="min-h-dvh pt-[var(--site-header-offset)] outline-none"
        >
          {children}
        </main>
        <Suspense fallback={null}>
          <AnalyticsTracker />
        </Suspense>
        <RouteImagePreloader />
        <AppErrorSurface />
        <footer className="border-t border-row-border bg-background/95">
          <div className="mx-auto flex w-full max-w-7xl flex-col gap-2 px-4 py-4 font-mono text-[10px] uppercase text-muted-foreground md:flex-row md:items-center md:justify-between md:px-8">
            <p>SYMBaiEX Forum</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <Link
                className="focus-ring hover:text-foreground"
                href={primarySiteHref}
                prefetch={primarySiteHref === "/"}
              >
                Main site
              </Link>
              <Link
                className="focus-ring hover:text-foreground"
                href="https://github.com/symbaiex"
                rel="noopener noreferrer"
                target="_blank"
              >
                GitHub
              </Link>
            </div>
          </div>
        </footer>
      </div>
    </ForumShellContextProvider>
  );
}

function SiteHeader({
  brandHref,
  brandLabel,
  brandPrefetch,
  initialForumHost,
  initialPrimarySiteHref,
}: {
  brandHref: string;
  brandLabel: string;
  brandPrefetch: boolean;
  initialForumHost: boolean;
  initialPrimarySiteHref: string;
}) {
  return (
    <header className="fixed inset-x-0 top-0 z-50 bg-background/92 backdrop-blur">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-3 px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))] md:px-8">
        <div className="flex min-w-0 items-center">
          <Link
            href={brandHref}
            prefetch={brandPrefetch}
            className="focus-ring truncate font-mono text-sm font-semibold uppercase"
          >
            {brandLabel}
          </Link>
        </div>
        <HeaderNav
          initialForumHost={initialForumHost}
          initialPrimarySiteHref={initialPrimarySiteHref}
        />
      </div>
    </header>
  );
}
