import { Button } from "@/components/ui/button";
import { ArrowUpRight, Github, Mail, Twitter } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Contact",
  description:
    "Contact Austin Hamilton (SYMBaiEX) for AI systems, software engineering, open-source, and research conversations.",
};

const contactRoutes = [
  {
    detail: "Best for project notes, consulting, research, and anything that needs context.",
    href: "mailto:solsymbaiex@gmail.com?subject=SYMBaiEX%20contact",
    label: "Email",
    value: "solsymbaiex@gmail.com",
    Icon: Mail,
  },
  {
    detail: "Open-source work, issue context, code trails, and public technical artifacts.",
    href: "https://github.com/symbaiex",
    label: "GitHub",
    value: "github.com/symbaiex",
    Icon: Github,
  },
  {
    detail: "Short-form updates, public thoughts, and quick surface-level signals.",
    href: "https://twitter.com/symbiex",
    label: "Twitter",
    value: "twitter.com/symbiex",
    Icon: Twitter,
  },
];

const contactScopes = [
  "AI agents and memory systems",
  "Product engineering and interface architecture",
  "Open-source collaboration",
  "Protocol, automation, and research tooling",
];

export default function ContactPage() {
  return (
    <article className="page-frame page-frame-dense">
      <section className="grid gap-8 md:grid-cols-12 md:items-end">
        <div className="md:col-span-8">
          <p className="page-kicker">Contact</p>
          <h1 className="page-title mt-3">Open a loop.</h1>
          <p className="page-lede mt-5">
            Send the sharp version first: what you are building, where it is
            stuck, and what kind of collaboration would make the next step
            easier.
          </p>
        </div>

        <aside className="md:col-span-4 md:justify-self-end">
          <div className="grid max-w-sm grid-cols-3 gap-1" aria-hidden="true">
            <span className="h-1.5 bg-[var(--accent-magenta)]" />
            <span className="h-1.5 bg-[var(--accent-cyan)]" />
            <span className="h-1.5 bg-[var(--accent-canary)]" />
          </div>
          <p className="mt-4 max-w-sm font-mono text-[11px] uppercase leading-5 text-muted-foreground md:text-right">
            Useful work, clear constraints, fast iteration.
          </p>
        </aside>
      </section>

      <section className="mt-10 grid gap-10 md:grid-cols-12 md:gap-8">
        <div className="md:col-span-8">
          <h2 className="text-2xl font-semibold md:text-3xl">
            Direct routes
          </h2>
          <div className="mt-6 grid gap-1">
            {contactRoutes.map(({ Icon, detail, href, label, value }) => (
              <Link
                className="focus-ring group grid gap-3 py-3 transition-colors hover:bg-muted/25 sm:grid-cols-[8rem_minmax(0,1fr)_1.75rem] sm:items-center sm:px-2"
                href={href}
                key={label}
                rel={href.startsWith("http") ? "noopener noreferrer" : undefined}
                target={href.startsWith("http") ? "_blank" : undefined}
              >
                <span className="flex items-center gap-2 font-mono text-[11px] uppercase text-muted-foreground">
                  <Icon className="size-3.5" aria-hidden="true" />
                  {label}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-base font-semibold text-foreground md:text-lg">
                    {value}
                  </span>
                  <span className="mt-1 block max-w-2xl text-sm leading-6 text-muted-foreground">
                    {detail}
                  </span>
                </span>
                <ArrowUpRight
                  className="hidden size-4 justify-self-end text-muted-foreground transition-colors group-hover:text-foreground sm:block"
                  aria-hidden="true"
                />
              </Link>
            ))}
          </div>
        </div>

        <div className="md:col-span-4">
          <h2 className="text-2xl font-semibold md:text-3xl">
            Good fits
          </h2>
          <div className="mt-6 grid gap-3">
            {contactScopes.map((scope, index) => (
              <div
                className="grid grid-cols-[2.75rem_minmax(0,1fr)] items-baseline gap-3"
                key={scope}
              >
                <span className="font-mono text-[11px] uppercase text-muted-foreground">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <p className="text-sm leading-6 text-muted-foreground md:text-base">
                  {scope}
                </p>
              </div>
            ))}
          </div>
          <div className="mt-7">
            <Button asChild className="rounded-none" variant="outline">
              <Link href="/portfolio">
                Review portfolio
                <ArrowUpRight data-icon="inline-end" />
              </Link>
            </Button>
          </div>
        </div>
      </section>
    </article>
  );
}
