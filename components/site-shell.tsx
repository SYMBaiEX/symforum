import { HeaderNav } from "@/components/header-nav";
import { Button } from "@/components/ui/button";
import { Github, Twitter } from "lucide-react";
import Link from "next/link";
import { ReactNode } from "react";

const leftNavItems = [
  { href: "/about", label: "About" },
  { href: "/portfolio", label: "Portfolio" },
];

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
    <div className="relative z-10 min-h-screen bg-background/92 text-foreground">
      <header className="sticky top-0 z-40 bg-background/92 backdrop-blur">
        <div className="mx-auto grid w-full max-w-7xl gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-4 md:px-8">
          <div className="flex min-w-0 flex-wrap items-center gap-1">
            <Link
              href="/"
              className="focus-ring mr-1 font-mono text-sm font-semibold uppercase"
            >
              SYMBaiEX
            </Link>
            {leftNavItems.map((item) => (
              <Button key={item.href} asChild variant="ghost" size="sm">
                <Link className="h-10 px-3 sm:h-7 sm:px-2.5" href={item.href}>
                  {item.label}
                </Link>
              </Button>
            ))}
          </div>
          <HeaderNav />
        </div>
      </header>
      <main>{children}</main>
      <footer>
        <div className="mx-auto grid max-w-7xl items-end gap-8 px-4 py-10 text-sm md:grid-cols-12 md:px-8">
          <div className="md:col-span-5">
            <p className="font-mono uppercase">SYMBaiEX</p>
          </div>
          <div className="text-muted-foreground md:col-span-4 md:whitespace-nowrap">
            Software, AI systems, and design notes.
          </div>
          <div className="flex flex-wrap items-end justify-start gap-1 md:col-span-3 md:justify-end">
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
