/* eslint-disable @next/next/no-img-element */
import { MarkdownContent } from "@/components/markdown-content";
import { SiteShell } from "@/components/site-shell";
import { Button } from "@/components/ui/button";
import { getSitePage } from "@/lib/site-content";
import { safeImageUrl } from "@/lib/safe-url";
import type { Metadata } from "next";
import Link from "next/link";

export async function generateMetadata(): Promise<Metadata> {
  const page = await getSitePage("about");
  return {
    title: page?.title ?? "About",
    description: page?.heroBody,
  };
}

export default async function AboutPage() {
  const page = await getSitePage("about");
  const imageUrl = safeImageUrl(page?.imageUrl);

  return (
    <SiteShell>
      <article className="mx-auto max-w-7xl px-4 py-9 md:px-8 md:py-14">
        <section className="grid gap-6 md:grid-cols-12 md:items-start md:gap-8">
          <aside className="font-mono text-[11px] uppercase text-muted-foreground md:col-span-3">
            <div className="flex flex-wrap gap-x-4 gap-y-1 md:sticky md:top-24 md:grid md:gap-3">
              <span>About / Austin Hamilton</span>
              <span>Alabama</span>
              <span>Self-taught engineer</span>
              <span>Researcher / father / OSS</span>
            </div>
          </aside>

          <div className="md:col-span-6">
            <h1 className="break-words text-3xl font-bold leading-[0.96] text-balance sm:text-4xl md:text-5xl">
              {page?.heroHeading ?? "About"}
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground md:mt-6 md:text-lg md:leading-8">
              {page?.heroBody}
            </p>
            <div className="mt-5 flex flex-wrap gap-2 md:mt-6">
              <Button asChild>
                <Link href="/portfolio">View portfolio</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/blog">Read notes</Link>
              </Button>
            </div>
          </div>

          <figure className="md:col-span-3">
            {imageUrl ? (
              <img
                src={imageUrl}
                alt={page?.imageAlt ?? "Austin Hamilton"}
                className="aspect-[4/5] w-full border border-row-border object-cover"
              />
            ) : (
              <div
                aria-hidden="true"
                className="aspect-[4/5] border border-row-border bg-[linear-gradient(135deg,hsl(var(--foreground))_0_1px,transparent_1px),linear-gradient(45deg,var(--accent-magenta),var(--accent-cyan),var(--accent-canary))] bg-[length:18px_18px,100%_100%] opacity-80"
              />
            )}
            {page?.imageCredit ? (
              <figcaption className="mt-2 font-mono text-[11px] uppercase text-muted-foreground">
                {page.imageCredit}
              </figcaption>
            ) : null}
          </figure>
        </section>

        <section className="grid gap-6 py-8 md:grid-cols-12 md:gap-8 md:py-12">
          <div className="font-mono text-[11px] uppercase text-muted-foreground md:col-span-3">
            Biography / philosophy
          </div>
          <div className="md:col-span-7">
            <MarkdownContent content={page?.body ?? ""} />
          </div>
        </section>
      </article>
    </SiteShell>
  );
}
