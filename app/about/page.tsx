import { MarkdownContent } from "@/components/markdown-content";
import { getSitePage } from "@/lib/site-content";
import { isLocalImageUrl, safeImageUrl } from "@/lib/safe-url";
import type { Metadata } from "next";
import Image from "next/image";

export async function generateMetadata(): Promise<Metadata> {
  const page = await getSitePage("about");
  return {
    title: page?.title ?? "About",
    description: page?.heroBody,
  };
}

export default async function AboutPage() {
  const page = await getSitePage("about");
  const darkImageUrl = page?.showImage ? safeImageUrl(page.imageUrl) : null;
  const lightImageUrl = page?.showImage
    ? safeImageUrl(page.imageLightUrl)
    : null;
  const imageUrl = darkImageUrl ?? lightImageUrl;
  const storySections = splitMarkdownSections(page?.body ?? "");

  return (
    <>
      <article className="page-frame page-frame-dense">
        <section className="page-content-wide mx-auto">
          {imageUrl ? (
            <figure className="mb-6 md:float-right md:mb-6 md:ml-8 md:w-[min(38vw,28rem)]">
              <div className="relative aspect-[16/10] overflow-hidden border border-row-border md:aspect-[4/5]">
                {lightImageUrl ? (
                  <Image
                    src={lightImageUrl}
                    alt={page?.imageAlt ?? "Austin Hamilton GitHub avatar"}
                    fill
                    priority
                    sizes="(max-width: 768px) calc(100vw - 2rem), min(38vw, 28rem)"
                    unoptimized={isLocalImageUrl(lightImageUrl)}
                    className="h-full w-full object-cover object-[center_24%] dark:hidden md:object-center"
                    decoding="async"
                  />
                ) : null}
                {darkImageUrl ? (
                  <Image
                    src={darkImageUrl}
                    alt={page?.imageAlt ?? "Austin Hamilton GitHub avatar"}
                    fill
                    priority
                    sizes="(max-width: 768px) calc(100vw - 2rem), min(38vw, 28rem)"
                    unoptimized={isLocalImageUrl(darkImageUrl)}
                    className={
                      lightImageUrl
                        ? "hidden h-full w-full object-cover object-[center_24%] dark:block md:object-center"
                        : "h-full w-full object-cover object-[center_24%] md:object-center"
                    }
                    decoding="async"
                  />
                ) : null}
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
          ) : null}

          <div className="page-content-readable">
            <h1 className="page-title">
              {page?.heroHeading ?? "About"}
            </h1>
            <p className="page-lede mt-5 md:mt-6">
              {page?.heroBody}
            </p>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-muted-foreground md:text-base">
              The path runs from early game-hacking curiosity into open-source
              systems, AI agents, protocol work, and the long-term lens of
              fatherhood.
            </p>
          </div>

          <div className="mt-7 page-content md:mt-8">
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
