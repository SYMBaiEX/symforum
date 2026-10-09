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
  const story = splitMarkdownSections(page?.body ?? "");

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
        <header
          className={`forum-panel grid overflow-hidden p-0 ${imageUrl ? "lg:grid-cols-[minmax(0,1.08fr)_minmax(16rem,0.92fr)]" : ""}`}
        >
          <div className="flex min-w-0 flex-col justify-center p-5 sm:p-7 md:p-9">
            <p className="page-kicker">SYMBiEX / About</p>
            <h1 className="mt-3 max-w-3xl text-3xl font-bold leading-tight tracking-tight text-balance sm:text-4xl md:text-[2.75rem]">
              {page?.heroHeading ?? page?.title ?? "About"}
            </h1>
            {page?.heroBody ? (
              <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground md:text-lg md:leading-8">
                {page.heroBody}
              </p>
            ) : null}
            <nav
              aria-label="About page actions"
              className="mt-6 flex flex-wrap gap-2"
            >
              <Button asChild>
                <Link href="/portfolio">Explore the portfolio</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/contact">Get in touch</Link>
              </Button>
            </nav>
          </div>
          {imageUrl ? (
            <figure className="relative min-h-64 overflow-hidden bg-muted sm:min-h-80 lg:min-h-full">
              {lightImageUrl ? (
                <Image
                  src={lightImageUrl}
                  alt={page?.imageAlt ?? "Portrait of Austin Hamilton"}
                  fill
                  sizes="(max-width: 1023px) 100vw, 44vw"
                  className={
                    darkImageUrl
                      ? "object-cover object-[center_12%] dark:hidden"
                      : "object-cover object-[center_12%]"
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
                  sizes="(max-width: 1023px) 100vw, 44vw"
                  className={
                    lightImageUrl
                      ? "hidden object-cover object-[center_12%] dark:block"
                      : "object-cover object-[center_12%]"
                  }
                  decoding="async"
                />
              ) : null}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,transparent_55%,hsl(var(--background)/0.48))]"
              />
              {page?.imageCredit ? (
                <figcaption className="absolute bottom-3 left-3 rounded-md bg-background/80 px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground backdrop-blur">
                  {page.imageCredit}
                </figcaption>
              ) : null}
            </figure>
          ) : null}
        </header>

        <ForumBodyGrid
          mobileSidebarLabel="Story chapters"
          sidebar={
            <div className="space-y-3">
              {story.sections.length > 0 ? (
                <nav
                  className="forum-panel overflow-hidden p-0"
                  aria-label="About story chapters"
                >
                  <ForumSectionHeader title="On this page" />
                  <ol className="grid gap-1 p-2">
                    {story.sections.map((section, index) => (
                      <li key={section.id}>
                        <a
                          className="forum-action-pill focus-ring flex min-h-10 w-full items-center gap-3 px-3 text-sm"
                          href={`#${section.id}`}
                        >
                          <span className="font-mono text-[10px] text-primary">
                            {String(index + 1).padStart(2, "0")}
                          </span>
                          <span className="min-w-0 truncate">
                            {section.title}
                          </span>
                        </a>
                      </li>
                    ))}
                  </ol>
                </nav>
              ) : null}
              <section
                className="forum-panel p-4"
                aria-labelledby="about-links"
              >
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
            </div>
          }
        >
          <section
            className="forum-panel overflow-hidden p-0"
            aria-labelledby="about-story-heading"
          >
            <ForumSectionHeader title="The story" id="about-story-heading">
              {story.sections.length > 0 ? (
                <span>{story.sections.length} chapters</span>
              ) : null}
            </ForumSectionHeader>
            {story.introduction ? (
              <div className="border-b border-row-border px-4 py-5 sm:px-6">
                <MarkdownContent
                  className="markdown-compact about-story-copy max-w-3xl"
                  content={story.introduction}
                  headingLevelOffset={1}
                />
              </div>
            ) : null}
            {story.sections.length > 0 ? (
              <ol className="divide-y divide-row-border">
                {story.sections.map((section, index) => (
                  <li
                    key={section.id}
                    className="grid gap-2 px-4 py-5 sm:grid-cols-[2.5rem_minmax(0,1fr)] sm:gap-4 sm:px-6 sm:py-7"
                  >
                    <span
                      aria-hidden="true"
                      className="pt-1 font-mono text-xs font-semibold tracking-wider text-primary"
                    >
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div className="min-w-0">
                      <h3
                        id={section.id}
                        className="scroll-mt-20 text-lg font-semibold leading-snug text-balance md:text-2xl"
                      >
                        {section.title}
                      </h3>
                      <MarkdownContent
                        className="markdown-compact about-story-copy mt-3 max-w-3xl"
                        content={section.body}
                        headingLevelOffset={1}
                      />
                    </div>
                  </li>
                ))}
              </ol>
            ) : !story.introduction ? (
              <MarkdownContent
                className="markdown-compact about-story-copy px-4 py-5 sm:px-6"
                content={page?.body ?? ""}
                headingLevelOffset={1}
              />
            ) : null}
          </section>
        </ForumBodyGrid>
        <section className="forum-panel mt-3 flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div>
            <p className="page-kicker">Continue exploring</p>
            <h2 className="mt-1 text-lg font-semibold">
              Work and conversation
            </h2>
          </div>
          <nav aria-label="Continue exploring" className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant="outline">
              <Link href="/portfolio">Selected work</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/contact">Contact</Link>
            </Button>
          </nav>
        </section>
      </article>
    </PrimaryPageSurface>
  );
}

function splitMarkdownSections(content: string) {
  const sections: { id: string; title: string; body: string }[] = [];
  const lines = content.split("\n");
  let currentTitle = "";
  let currentBody: string[] = [];
  const introduction: string[] = [];
  const headingCounts = new Map<string, number>();

  const pushSection = () => {
    if (!currentTitle) {
      return;
    }

    sections.push({
      id: createSectionId(currentTitle, headingCounts),
      title: currentTitle,
      body: currentBody.join("\n").trim(),
    });
  };

  for (const line of lines) {
    if (line.startsWith("## ")) {
      pushSection();
      currentTitle = line.replace(/^##\s+/, "").trim();
      currentBody = [];
    } else {
      (currentTitle ? currentBody : introduction).push(line);
    }
  }

  pushSection();

  return { introduction: introduction.join("\n").trim(), sections };
}

function createSectionId(title: string, counts: Map<string, number>) {
  const base =
    title
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "chapter";
  const count = counts.get(base) ?? 0;
  counts.set(base, count + 1);
  return count === 0 ? `about-${base}` : `about-${base}-${count + 1}`;
}
