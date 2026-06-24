/* eslint-disable @next/next/no-img-element */
import { MarkdownContent } from "@/components/markdown-content";
import { SiteShell } from "@/components/site-shell";
import { Button } from "@/components/ui/button";
import { getSitePage } from "@/lib/site-content";
import { AUSTIN_GITHUB_AVATAR_URL } from "@/lib/site-content-defaults";
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
  const imageUrl =
    safeImageUrl(page?.imageUrl) ?? safeImageUrl(AUSTIN_GITHUB_AVATAR_URL);
  const storySections = splitMarkdownSections(page?.body ?? "");

  return (
    <SiteShell>
      <article className="mx-auto max-w-7xl px-4 py-8 md:px-8 md:py-12">
        <section className="grid gap-6 md:grid-cols-12 md:items-start md:gap-8">
          <div className="md:col-span-6 md:col-start-2">
            <h1 className="break-words text-3xl font-bold leading-[0.96] text-balance sm:text-4xl md:text-5xl">
              {page?.heroHeading ?? "About"}
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground md:mt-6 md:text-lg md:leading-8">
              {page?.heroBody}
            </p>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-muted-foreground md:text-base">
              The path runs from early game-hacking curiosity into open-source
              systems, AI agents, protocol work, and the long-term lens of
              fatherhood.
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

          <figure className="md:col-span-4">
            {imageUrl ? (
              <img
                src={imageUrl}
                alt={page?.imageAlt ?? "Austin Hamilton GitHub avatar"}
                className="aspect-[16/10] w-full border border-row-border object-cover md:aspect-[4/5]"
              />
            ) : (
              <div
                aria-hidden="true"
                className="aspect-[16/10] border border-row-border bg-[linear-gradient(135deg,hsl(var(--foreground))_0_1px,transparent_1px),linear-gradient(45deg,var(--accent-magenta),var(--accent-cyan),var(--accent-canary))] bg-[length:18px_18px,100%_100%] opacity-80 md:aspect-[4/5]"
              />
            )}
            {page?.imageCredit ? (
              <figcaption className="mt-2 font-mono text-[11px] uppercase text-muted-foreground">
                {page.imageCredit}
              </figcaption>
            ) : null}
          </figure>
        </section>

        <section className="py-7 md:py-10">
          <div className="mx-auto max-w-5xl">
            {storySections.length > 0 ? (
              <div className="grid gap-6 md:gap-8">
                {storySections.map((section, index) => (
                  <article
                    key={`${section.title}-${index}`}
                    className="grid gap-2 md:grid-cols-[3.5rem_minmax(0,1fr)] md:gap-8"
                    data-about-story-row
                  >
                    <div className="font-mono text-[11px] uppercase text-muted-foreground md:pt-1">
                      {String(index + 1).padStart(2, "0")}
                    </div>
                    <div className="max-w-4xl" data-about-story-content>
                      <h2 className="text-lg font-semibold leading-snug text-balance md:text-2xl">
                        {section.title}
                      </h2>
                      <div className="mt-2 md:mt-3">
                        <MarkdownContent
                          className="markdown-compact about-story-copy"
                          content={section.body}
                        />
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="mx-auto max-w-4xl">
                <MarkdownContent
                  className="markdown-compact about-story-copy"
                  content={page?.body ?? ""}
                />
              </div>
            )}
          </div>
        </section>
      </article>
    </SiteShell>
  );
}

function splitMarkdownSections(content: string) {
  const sections: { title: string; body: string }[] = [];
  const lines = content.split("\n");
  let currentTitle = "";
  let currentBody: string[] = [];

  for (const line of lines) {
    if (line.startsWith("## ")) {
      if (currentTitle) {
        sections.push({
          title: currentTitle,
          body: currentBody.join("\n").trim(),
        });
      }
      currentTitle = line.replace(/^##\s+/, "").trim();
      currentBody = [];
    } else {
      currentBody.push(line);
    }
  }

  if (currentTitle) {
    sections.push({
      title: currentTitle,
      body: currentBody.join("\n").trim(),
    });
  }

  return sections;
}
