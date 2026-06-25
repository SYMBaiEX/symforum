/* eslint-disable @next/next/no-img-element */
import { MarkdownContent } from "@/components/markdown-content";
import { getSitePage } from "@/lib/site-content";
import { AUSTIN_GITHUB_AVATAR_URL } from "@/lib/site-content-defaults";
import { safeImageUrl } from "@/lib/safe-url";
import type { Metadata } from "next";

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
    <>
      <article className="mx-auto max-w-6xl px-4 py-8 md:px-8 md:py-12">
        <section className="mx-auto max-w-5xl">
          <figure className="mb-6 md:float-right md:mb-6 md:ml-8 md:w-[min(38vw,28rem)]">
            <div className="relative aspect-[16/10] overflow-hidden border border-row-border md:aspect-[4/5]">
              {imageUrl ? (
                <img
                  src={imageUrl}
                  alt={page?.imageAlt ?? "Austin Hamilton GitHub avatar"}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div
                  aria-hidden="true"
                  className="h-full w-full bg-[linear-gradient(135deg,hsl(var(--foreground))_0_1px,transparent_1px),linear-gradient(45deg,var(--accent-magenta),var(--accent-cyan),var(--accent-canary))] bg-[length:18px_18px,100%_100%] opacity-80"
                />
              )}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_36%,hsl(var(--background)/0.16)_62%,hsl(var(--background)/0.72)_100%),linear-gradient(180deg,hsl(var(--background)/0.2),transparent_28%,hsl(var(--background)/0.34)_100%)]"
              />
            </div>
            {page?.imageCredit ? (
              <figcaption className="mt-2 font-mono text-[11px] uppercase text-muted-foreground">
                {page.imageCredit}
              </figcaption>
            ) : null}
          </figure>

          <div className="max-w-2xl">
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
          </div>

          <div className="mt-7 max-w-4xl md:mt-8">
            {storySections.length > 0 ? (
              <div className="space-y-7 md:space-y-8">
                {storySections.map((section, index) => (
                  <article
                    key={`${section.title}-${index}`}
                    data-about-story-row
                  >
                    <div data-about-story-content>
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
              <MarkdownContent
                className="markdown-compact about-story-copy"
                content={page?.body ?? ""}
              />
            )}
            <div className="clear-both" />
          </div>
        </section>
      </article>
    </>
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
