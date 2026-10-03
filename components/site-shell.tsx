"use client";

import { AppErrorSurface } from "@/components/app-error-surface";
import {
  isForumHostname,
  primarySiteHrefForForumHost,
  shouldUseForumShell,
} from "@/components/forum/forum-host-url";
import { ForumShellContextProvider } from "@/components/forum/forum-shell-context";
import { ForumNavigation } from "@/components/forum/forum-navigation";
import { HeaderNav } from "@/components/header-nav";
import { NewsletterSignup } from "@/components/newsletter-signup";
import { Button } from "@/components/ui/button";
import dynamic from "next/dynamic";
import { Github, Linkedin, Twitter } from "lucide-react";
import Link from "next/link";
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
      <ForumSiteShell
        footerRef={footerRef}
        forumHost={forumHost}
        primarySiteHref={primarySiteHref}
      >
        {children}
      </ForumSiteShell>
    );
  }

  return (
    <div
      className="relative z-10 min-h-dvh overflow-hidden bg-background/92 text-foreground [--site-footer-offset:3.75rem] [--site-header-offset:4rem] md:[--site-header-offset:3.75rem]"
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
      <WebVitalsReporter />
      <AppErrorSurface />
      <SiteFooter footerRef={footerRef} agentHref="/agent" />
    </div>
  );
}

function ForumSiteShell({
  children,
  footerRef,
  forumHost,
  primarySiteHref,
}: {
  children: ReactNode;
  footerRef: RefObject<HTMLElement | null>;
  forumHost: boolean;
  primarySiteHref: string;
}) {
  return (
    <ForumShellContextProvider primarySiteHref={primarySiteHref}>
      <div className="forum-app-shell relative z-10 min-h-dvh min-w-0 bg-background text-foreground [--site-footer-offset:0px] [--site-header-offset:calc(4rem+env(safe-area-inset-top))]">
        <WebVitalsReporter />
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:font-mono focus:text-sm focus:uppercase focus-ring"
        >
          Skip to content
        </a>
        <ForumNavigation />
        <main
          id="main-content"
          tabIndex={-1}
          className="min-h-[calc(100dvh-6rem)] pt-[var(--site-header-offset)] outline-none"
        >
          {children}
        </main>
        <Suspense fallback={null}>
          <AnalyticsTracker />
        </Suspense>
        <AppErrorSurface />
        <footer
          ref={footerRef}
          className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-6 text-xs text-muted-foreground md:px-8 lg:pb-8"
        >
          <a
            className="focus-ring py-2 hover:text-foreground"
            href={primarySiteHref}
          >
            SYMBaiEX
          </a>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <a
              className="focus-ring py-2 hover:text-foreground"
              href={
                forumHost
                  ? "/control-panel/agent-access"
                  : "/forum/control-panel/agent-access"
              }
            >
              Agent access
            </a>
            {socialItems.map(({ href, label }) => (
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
      </div>
    </ForumShellContextProvider>
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
      className="fixed inset-x-0 bottom-0 z-50 border-t border-row-border/70 bg-background/92 backdrop-blur"
    >
      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-2 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 text-xs sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-4 md:px-8">
        <div className="min-w-0">
          <NewsletterSignup source="footer" variant="footer" />
        </div>
        <div className="flex flex-wrap items-center justify-start sm:shrink-0 sm:justify-end">
          <Button
            asChild
            className="h-9 rounded-none px-2.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground sm:px-3"
            size="sm"
            variant="ghost"
          >
            <a href={agentHref}>Agent access</a>
          </Button>
          {socialItems.map(({ href, label, Icon }) => (
            <Button
              key={href}
              asChild
              className="h-9 w-9 px-0 font-mono uppercase text-muted-foreground sm:w-auto sm:px-2.5"
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
        </div>
      </div>
    </footer>
  );
}

function SiteHeader({
  forumContext = false,
  brandHref,
  brandLabel,
  brandPrefetch,
  initialForumHost,
  initialPrimarySiteHref,
}: {
  forumContext?: boolean;
  brandHref: string;
  brandLabel: string;
  brandPrefetch: boolean;
  initialForumHost: boolean;
  initialPrimarySiteHref: string;
}) {
  return (
    <header
      className={
        forumContext
          ? "fixed inset-x-0 top-0 z-50 bg-background/95 backdrop-blur"
          : "fixed inset-x-0 top-0 z-50 border-b border-row-border/70 bg-background/92 backdrop-blur"
      }
    >
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-3 px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))] md:px-8">
        <div className="flex min-w-0 items-center">
          <a
            href={brandHref}
            className={
              forumContext
                ? "focus-ring truncate text-xl font-extrabold tracking-tight"
                : "focus-ring truncate font-mono text-sm font-semibold uppercase"
            }
          >
            {forumContext ? (
              <>
                SYMB<span className="text-primary">ai</span>EX{" "}
                <span className="ml-1 font-normal text-muted-foreground">
                  Forum
                </span>
              </>
            ) : (
              brandLabel
            )}
          </a>
        </div>
        <HeaderNav
          compact={forumContext}
          initialForumHost={initialForumHost}
          initialPrimarySiteHref={initialPrimarySiteHref}
        />
      </div>
    </header>
  );
}
