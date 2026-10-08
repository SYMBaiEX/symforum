import { resolveForumRouteStatus } from "../../forum-route-status";
import { ForumThreadView } from "@/components/forum/forum-thread-view";
import { humanizeSlug } from "@/components/forum/forum-refs";
import { ForumUtilityNav } from "@/components/forum/forum-primitives";
import { StructuredData } from "@/components/structured-data";
import { safeForumIsoDate } from "@/lib/forum-metadata";
import { breadcrumbStructuredData, compactSeoTitle } from "@/lib/seo";
import { PRIMARY_SITE_URL } from "@/lib/site-urls";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

type PageProps = {
  params: Promise<{ categorySlug: string; threadSlug: string }>;
};

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { categorySlug, threadSlug } = await params;
  const routeStatus = process.env.NEXT_PUBLIC_CONVEX_URL
    ? await resolveForumRouteStatus({ categorySlug, threadSlug })
    : null;
  if (process.env.NEXT_PUBLIC_CONVEX_URL && routeStatus?.exists !== true) {
    notFound();
  }
  const title =
    routeStatus?.kind === "thread"
      ? routeStatus.threadTitle
      : humanizeSlug(threadSlug);
  const description =
    routeStatus?.kind === "thread"
      ? routeStatus.threadExcerpt
      : `Public thread in the ${humanizeSlug(categorySlug)} board.`;
  const canonical = `https://forum.symbaiex.com/${encodeURIComponent(categorySlug)}/${encodeURIComponent(threadSlug)}`;
  return {
    title: { absolute: compactSeoTitle(title, "SYMBaiEX forum") },
    description,
    alternates: {
      canonical,
    },
    openGraph: {
      title,
      description,
      type: "article",
      url: canonical,
      publishedTime:
        routeStatus?.kind === "thread"
          ? safeForumIsoDate(routeStatus.createdAt)
          : undefined,
      modifiedTime:
        routeStatus?.kind === "thread"
          ? safeForumIsoDate(routeStatus.updatedAt)
          : undefined,
      images: [
        {
          url: `${PRIMARY_SITE_URL}/opengraph-image`,
          width: 1200,
          height: 630,
          alt: `SYMBaiEX forum thread: ${title}`,
        },
      ],
    },
    twitter: {
      card: "summary",
      title,
      description,
      images: [`${PRIMARY_SITE_URL}/opengraph-image`],
    },
  };
}

export default async function ForumThreadPage({ params }: PageProps) {
  const { categorySlug, threadSlug } = await params;
  const enabled = Boolean(process.env.NEXT_PUBLIC_CONVEX_URL);
  const routeStatus = enabled
    ? await resolveForumRouteStatus({ categorySlug, threadSlug })
    : null;

  if (enabled && routeStatus?.exists !== true) {
    notFound();
  }
  const title =
    routeStatus?.kind === "thread"
      ? routeStatus.threadTitle
      : humanizeSlug(threadSlug);
  const description =
    routeStatus?.kind === "thread"
      ? routeStatus.threadExcerpt
      : `Public thread in the ${humanizeSlug(categorySlug)} board.`;
  const canonical = `https://forum.symbaiex.com/${encodeURIComponent(categorySlug)}/${encodeURIComponent(threadSlug)}`;

  return (
    <section className="page-frame page-frame-dense">
      <StructuredData
        data={[
          {
            "@type": "DiscussionForumPosting",
            headline: title,
            description,
            url: canonical,
            datePublished:
              routeStatus?.kind === "thread"
                ? safeForumIsoDate(routeStatus.createdAt)
                : undefined,
            dateModified:
              routeStatus?.kind === "thread"
                ? safeForumIsoDate(routeStatus.updatedAt)
                : undefined,
            author: { "@type": "Person", name: "SYMBaiEX forum member" },
          },
          breadcrumbStructuredData([
            { name: "Forum", url: "https://forum.symbaiex.com/" },
            {
              name: humanizeSlug(categorySlug),
              url: `https://forum.symbaiex.com/${encodeURIComponent(categorySlug)}`,
            },
            { name: title, url: canonical },
          ]),
        ]}
      />
      <ForumUtilityNav className="mb-2" />
      <header className="border-y border-row-border py-2">
        <p className="page-kicker">Forum thread</p>
        <h1 className="mt-1 text-xl font-semibold leading-tight md:text-2xl">
          {title}
        </h1>
        <p className="mt-1.5 max-w-3xl text-sm leading-5 text-muted-foreground">
          {description}
        </p>
      </header>
      <ForumThreadView
        categorySlug={categorySlug}
        threadSlug={threadSlug}
        enabled={enabled}
      />
    </section>
  );
}
