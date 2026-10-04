"use client";
import { type ReactNode, type RefObject, Suspense } from "react";
import { ForumShellContextProvider } from "./forum-shell-context";
import { ForumNavigation } from "./forum-navigation";
import { ForumLink } from "./forum-link";
import { AppErrorSurface } from "@/components/app-error-surface";
import { WebVitalsReporter } from "@/components/web-vitals-reporter";
import { AnalyticsTracker } from "@/components/analytics-tracker";
const socialItems = [
  { href: "https://github.com/symbaiex", label: "GitHub" },
  { href: "https://linkedin.com/in/austinhamiltonal", label: "LinkedIn" },
  { href: "https://twitter.com/symbiex", label: "Twitter" },
];
export function ForumSiteShell({
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
          className="forum-main min-h-[calc(100dvh-6rem)] pt-[var(--site-header-offset)] outline-none lg:ml-[220px]"
        >
          {children}
        </main>
        <Suspense fallback={null}>
          <AnalyticsTracker />
        </Suspense>
        <AppErrorSurface />
        <footer
          ref={footerRef}
          className="forum-footer flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-6 text-xs text-muted-foreground md:px-8 lg:ml-[220px] lg:pb-8"
        >
          <a
            className="focus-ring py-2 hover:text-foreground"
            href={primarySiteHref}
          >
            SYMBaiEX
          </a>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
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
