import { HeaderNav } from "@/components/header-nav";
import { NewsletterSignup } from "@/components/newsletter-signup";
import { Button } from "@/components/ui/button";
import { Github, Twitter } from "lucide-react";
import Link from "next/link";
import { ReactNode } from "react";

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

export function SiteShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative z-10 min-h-dvh overflow-hidden bg-background/92 text-foreground [--site-footer-offset:6.25rem] [--site-header-offset:4rem] sm:[--site-footer-offset:4.5rem] sm:[--site-header-offset:3.75rem]">
      <header className="fixed inset-x-0 top-0 z-50 bg-background/92 backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-3 px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))] md:px-8">
          <div className="flex min-w-0 items-center">
            <Link
              href="/"
              className="focus-ring truncate font-mono text-sm font-semibold uppercase"
            >
              SYMBaiEX
            </Link>
          </div>
          <HeaderNav />
        </div>
      </header>
      <main className="fixed inset-x-0 bottom-[var(--site-footer-offset)] top-[var(--site-header-offset)] z-10 overflow-y-auto overscroll-contain">
        {children}
      </main>
      <footer className="fixed inset-x-0 bottom-0 z-50 bg-background/92 backdrop-blur">
        <div className="mx-auto grid max-w-7xl items-end gap-2 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 text-xs md:grid-cols-12 md:px-8">
          <div className="md:col-span-4">
            <p className="font-mono uppercase">SYMBaiEX</p>
          </div>
          <div className="md:col-span-5">
            <NewsletterSignup source="footer" variant="footer" />
          </div>
          <div className="flex flex-wrap items-end justify-end gap-1 md:col-span-3">
            {socialItems.map(({ href, label, Icon }) => (
              <Button
                key={href}
                asChild
                className="font-mono uppercase text-muted-foreground"
                size="sm"
                variant="ghost"
              >
                <Link href={href} target="_blank" rel="noopener noreferrer">
                  <Icon data-icon="inline-start" />
                  {label}
                </Link>
              </Button>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}
