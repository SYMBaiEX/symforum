import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { ReactNode } from "react";

const navItems = [
  { href: "/blog", label: "Blog" },
  { href: "/news", label: "News" },
  { href: "/signin", label: "Sign in" },
];

export function SiteShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative z-10 min-h-screen bg-background/92 text-foreground">
      <header className="sticky top-0 z-40 bg-background/92 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-4 md:px-8">
          <Link
            href="/"
            className="focus-ring font-mono text-sm font-semibold uppercase"
          >
            SYMBiEX
          </Link>
          <nav className="flex items-center gap-1">
            {navItems.map((item) => (
              <Button key={item.href} asChild variant="ghost" size="sm">
                <Link href={item.href}>{item.label}</Link>
              </Button>
            ))}
            <ThemeToggle />
          </nav>
        </div>
      </header>
      <main>{children}</main>
      <footer>
        <div className="mx-auto grid max-w-7xl items-end gap-8 px-4 py-10 text-sm md:grid-cols-12 md:px-8">
          <div className="md:col-span-5">
            <p className="font-mono uppercase">Austin Hamilton / SYMBiEX</p>
          </div>
          <div className="text-muted-foreground md:col-span-4 md:whitespace-nowrap">
            Software, AI systems, and design notes.
          </div>
          <div className="flex items-end justify-start md:col-span-3 md:justify-end">
            <Link
              href="https://news.ycombinator.com/"
              className={cn(
                "focus-ring inline-flex items-center gap-2 font-mono text-xs uppercase text-muted-foreground",
                "transition-colors hover:text-foreground",
              )}
            >
              HN source <ArrowUpRight />
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
