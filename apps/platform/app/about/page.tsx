import { MarkdownContent } from "@/components/markdown-content";
import { StructuredData } from "@/components/structured-data";
import { getSitePage } from "@/lib/site-content";
import { AUTHOR_NAME, AUTHOR_URL, breadcrumbStructuredData } from "@/lib/seo";
import { primarySiteUrl } from "@/lib/site-urls";
import { safeImageUrl } from "@/lib/safe-url";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { PrimaryPageSurface } from "@/components/primary-page-surface";
import {
  ForumBodyGrid,
  ForumPageHeader,
  ForumSectionHeader,
} from "@/components/forum/forum-layout-primitives";
import { Button } from "@/components/ui/button";

export async function generateMetadata(): Promise<Metadata> {
  const page = await getSitePage("about");
  return {
    title: page?.title ?? "About",
    description: page?.heroBody,
    alternates: { canonical: "/about" },
    authors: [{ name: AUTHOR_NAME, url: AUTHOR_URL }],
    openGraph: {
      type: "profile",
      url: primarySiteUrl("/about"),
      title: page?.title ?? "About Austin Hamilton",
      description: page?.heroBody,
      firstName: "Austin",
      lastName: "Hamilton",
      username: "symbiex",
      images: [
        {
          url: "/opengraph-image",
          width: 1200,
          height: 630,
          alt: "About Austin Hamilton at SYMBaIEX.",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: page?.title ?? "About Austin Hamilton",
      description: page?.heroBody,
      images: [
        {
          url: "/opengraph-image",
          width: 1200,
          height: 630,
          alt: "About Austin Hamilton at SYMBaIEX.",
        },
      ],
    },
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
    <PrimaryPageSurface>
      <article className="page-frame page-frame-dense">
        <StructuredData
          data={[
            {
              "@type": "ProfilePage",
              url: primarySiteUrl("/about"),
              name: page?.title ?? "About Austin Hamilton",
              description: page?.heroBody,
              mainEntity: {
                "@type": "Person",
                name: AUTHOR_NAME,
                url: AUTHOR_URL,
                description: page?.heroBody,
              },
              dateModified: page?.updatedAt
                ? new Date(page.updatedAt).toISOString()
                : undefined,
            },
            breadcrumbStructuredData([
              { name: "Home", url: primarySiteUrl("/") },
              { name: "About", url: primarySiteUrl("/about") },
            ]),
          ]}
        />
        <ForumPageHeader
          title={page?.heroHeading ?? "About"}
          description={page?.heroBody}
          breadcrumbs={<p className="page-kicker">SYMBiEX / About</p>}
          actions={
            <Button asChild size="sm" variant="outline">
              <Link href="/contact">Contact</Link>
            </Button>
          }
        />
        <ForumBodyGrid
          mobileSidebarLabel="Explore"
          sidebar={
            <section className="forum-panel p-4" aria-labelledby="about-links">
              <ForumSectionHeader title="Explore" id="about-links" />
              <nav aria-label="More about Austin" className="mt-2 grid gap-1">
                <Link
                  className="forum-action-pill focus-ring flex w-full justify-between"
                  href="/portfolio"
                >
                  <span>Portfolio</span>
                  <span aria-hidden="true">↗</span>
                </Link>
                <Link
                  className="forum-action-pill focus-ring flex w-full justify-between"
                  href="/blog"
                >
                  <span>Writing</span>
                  <span aria-hidden="true">↗</span>
                </Link>
                <Link
                  className="forum-action-pill focus-ring flex w-full justify-between"
                  href="/contact"
                >
                  <span>Contact</span>
                  <span aria-hidden="true">↗</span>
                </Link>
              </nav>
            </section>
          }
        >
          <article className="forum-panel p-4 md:p-5">
            {imageUrl ? (
              <div className="grid gap-4 border-b border-row-border pb-4 sm:grid-cols-[minmax(0,1fr)_12rem] sm:items-start">
                <figure className="min-w-0">
                  <div className="relative aspect-[16/10] overflow-hidden rounded-lg bg-muted sm:aspect-[4/5]">
                    {lightImageUrl ? (
                      <Image
                        src={lightImageUrl}
                        alt={page?.imageAlt ?? "Portrait of Austin Hamilton"}
                        fill
                        sizes="(max-width: 640px) calc(100vw - 4rem), 12rem"
                        className={
                          darkImageUrl
                            ? "h-full w-full object-cover object-[center_10%] dark:hidden sm:object-center"
                            : "h-full w-full object-cover object-[center_10%] sm:object-center"
                        }
                        decoding="async"
                      />
                    ) : null}
                    {darkImageUrl ? (
                      <Image
                        src={darkImageUrl}
                        alt={page?.imageAlt ?? "Portrait of Austin Hamilton"}
                        fill
                        fetchPriority="high"
                        loading="eager"
                        sizes="(max-width: 640px) calc(100vw - 4rem), 12rem"
                        className={
                          lightImageUrl
                            ? "hidden h-full w-full object-cover object-[center_10%] dark:block sm:object-center"
                            : "h-full w-full object-cover object-[center_10%] sm:object-center"
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
                <p className="text-sm leading-6 text-muted-foreground md:text-base md:leading-7">
                  The path runs from early game-hacking curiosity into
                  open-source systems, AI agents, protocol work, and the
                  long-term lens of fatherhood.
                </p>
              </div>
            ) : (
              <p className="max-w-3xl text-sm leading-6 text-muted-foreground md:text-base md:leading-7">
                The path runs from early game-hacking curiosity into open-source
                systems, AI agents, protocol work, and the long-term lens of
                fatherhood.
              </p>
            )}

            {storySections.length > 0 ? (
              <div className="mt-5 space-y-7 md:mt-6 md:space-y-8">
                {storySections.map((section, index) => (
                  <section
                    key={`${section.title}-${index}`}
                    className="border-t border-row-border pt-4"
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
                          headingLevelOffset={1}
                        />
                      </div>
                    </div>
                  </section>
                ))}
              </div>
            ) : (
              <MarkdownContent
                className="markdown-compact about-story-copy mt-5"
                content={page?.body ?? ""}
                headingLevelOffset={1}
              />
            )}
          </article>
        </ForumBodyGrid>
      </article>
    </PrimaryPageSurface>
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
