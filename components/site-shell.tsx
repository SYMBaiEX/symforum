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
      className="relative z-10 min-h-dvh overflow-hidden bg-background/92 text-foreground [--site-footer-offset:3.75rem] [--site-header-offset:calc(4rem+env(safe-area-inset-top)+1px)] md:[--site-header-offset:calc(3.75rem+env(safe-area-inset-top)+1px)]"
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
    <header className="fixed inset-x-0 top-0 z-50 border-b border-row-border/70 bg-background/92 pt-[env(safe-area-inset-top)] backdrop-blur">
      <div className="mx-auto flex min-h-16 w-full max-w-7xl items-center justify-between gap-3 px-4 py-2 md:min-h-[3.75rem] md:px-8">
        <div className="flex min-w-0 items-center">
          <SiteSurfaceSwitcher
            activeSurface="blog"
            currentPathname={currentPathname}
            homeHref={homeHref}
            forumHref={initialForumHost ? "/" : "/forum"}
            className="font-mono text-sm"
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
